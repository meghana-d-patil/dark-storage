import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { callEngine3 } from '../clients/engine3.js';

interface ClientMeta {
  userId: number;
  role: string;
  isAlive: boolean;
}

interface OutboxEventItem {
  seq: number;
  event_type: string;
  entity_type: string;
  entity_id: string;
  data: any;
  created_at: string;
}

interface OutboxResponse {
  latest_seq: number;
  events: OutboxEventItem[];
}

export class WebSocketHub {
  public readonly wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientMeta>();
  private currentGatewaySeq = 0;
  private lastPolledSeq = 0;
  private pollerTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isPolling = false;

  constructor(server: http.Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    this.startHeartbeat();
    this.startPoller();
  }

  public getCurrentSeq(): number {
    return this.currentGatewaySeq;
  }

  public getConnectedClientsCount(): number {
    return this.clients.size;
  }

  private async handleConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
    try {
      const url = new URL(req.url || '', 'http://127.0.0.1');
      const token = url.searchParams.get('token');
      const sinceParam = url.searchParams.get('since');
      const since = sinceParam !== null ? parseInt(sinceParam, 10) : 0;

      if (!token) {
        ws.close(4401, 'UNAUTHENTICATED');
        return;
      }

      let payload: any;
      try {
        payload = jwt.verify(token, config.JWT_SECRET);
      } catch {
        ws.close(4401, 'UNAUTHENTICATED');
        return;
      }

      const clientMeta: ClientMeta = {
        userId: payload.id,
        role: payload.role,
        isAlive: true
      };
      this.clients.set(ws, clientMeta);

      ws.on('pong', () => {
        const meta = this.clients.get(ws);
        if (meta) {
          meta.isAlive = true;
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      // 1. Send connected greeting
      ws.send(
        JSON.stringify({
          type: 'connected',
          latest_seq: this.currentGatewaySeq
        })
      );

      // 2. Initial handshake & replay
      if (since > 0 && since < this.currentGatewaySeq) {
        try {
          const res = await callEngine3<OutboxResponse>({
            method: 'GET',
            path: `/internal/v1/outbox?after_seq=${since}&limit=500`,
            timeoutMs: 3000
          });

          const missedEvents = res.data.events;
          if (missedEvents.length >= 500) {
            ws.send(
              JSON.stringify({
                type: 'resync_required',
                latest_seq: this.currentGatewaySeq
              })
            );
          } else {
            for (const ev of missedEvents) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: 'event',
                    seq: ev.seq,
                    event_type: ev.event_type,
                    entity_type: ev.entity_type,
                    entity_id: ev.entity_id,
                    data: ev.data,
                    created_at: ev.created_at,
                    replay: true
                  })
                );
              }
            }
          }
        } catch (e) {
          console.warn('[WS] Failed to fetch replay events from Engine 3:', e);
        }
      } else if (since > this.currentGatewaySeq && this.currentGatewaySeq > 0) {
        ws.send(
          JSON.stringify({
            type: 'resync_required',
            latest_seq: this.currentGatewaySeq
          })
        );
      }
    } catch (err) {
      console.error('[WS] Connection setup error:', err);
      ws.close(4401, 'UNAUTHENTICATED');
    }
  }

  private startPoller(): void {
    this.pollerTimer = setInterval(() => {
      this.pollOutbox();
    }, 250);
  }

  public async pollOutbox(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const res = await callEngine3<OutboxResponse>({
        method: 'GET',
        path: `/internal/v1/outbox?after_seq=${this.lastPolledSeq}&limit=100`,
        timeoutMs: 2000
      });

      if (res.data) {
        if (res.data.latest_seq > this.currentGatewaySeq) {
          this.currentGatewaySeq = res.data.latest_seq;
        }

        for (const ev of res.data.events) {
          if (ev.seq > this.lastPolledSeq) {
            this.lastPolledSeq = ev.seq;
          }
          if (ev.seq > this.currentGatewaySeq) {
            this.currentGatewaySeq = ev.seq;
          }

          const message = JSON.stringify({
            type: 'event',
            seq: ev.seq,
            event_type: ev.event_type,
            entity_type: ev.entity_type,
            entity_id: ev.entity_id,
            data: ev.data,
            created_at: ev.created_at,
            replay: false
          });

          this.broadcast(message);
        }
      }
    } catch {
      // Temporary network glitch or Engine 3 restarting; keep connections open
    } finally {
      this.isPolling = false;
    }
  }

  private broadcast(message: string): void {
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message);
        } catch {
          // Socket write failed, cleanup on next heartbeat
        }
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [ws, meta] of this.clients) {
        if (!meta.isAlive) {
          ws.terminate();
          this.clients.delete(ws);
        } else {
          meta.isAlive = false;
          try {
            ws.ping();
          } catch {
            ws.terminate();
            this.clients.delete(ws);
          }
        }
      }
    }, 20000);
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.pollerTimer) {
        clearInterval(this.pollerTimer);
        this.pollerTimer = null;
      }
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }

      for (const [ws] of this.clients) {
        try {
          ws.close();
        } catch {}
      }
      this.clients.clear();

      this.wss.close(() => {
        resolve();
      });
    });
  }
}
