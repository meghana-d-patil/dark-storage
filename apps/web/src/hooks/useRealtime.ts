import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore.js';
import { useRealtimeStore, FeedEvent } from '../stores/realtimeStore.js';

const EVENT_KEY_MAP: Record<string, string[][]> = {
  'receipt.created': [['receipts'], ['staged'], ['inventory'], ['dashboard']],
  'putaway.completed': [['putaways'], ['receipts'], ['staged'], ['inventory'], ['warehouse'], ['dashboard']],
  'inventory.changed': [['inventory'], ['warehouse'], ['dashboard']],
  'bin.status_changed': [['inventory'], ['warehouse'], ['dashboard']],
  'order.created': [['orders'], ['packing'], ['dashboard']],
  'order.status_changed': [['orders'], ['packing'], ['dashboard']],
  'order.completed': [['orders'], ['packing'], ['dashboard']],
  'reservation.changed': [['orders'], ['inventory'], ['warehouse'], ['dashboard']],
  'mission.assigned': [['missions'], ['orders'], ['packing'], ['dashboard']],
  'mission.started': [['missions'], ['orders'], ['packing'], ['dashboard']],
  'mission.completed': [['missions'], ['orders'], ['packing'], ['dashboard']],
  'pick.confirmed': [['missions'], ['orders'], ['inventory'], ['warehouse'], ['packing'], ['dashboard']],
  'exception.opened': [['exceptions'], ['missions'], ['orders'], ['inventory'], ['packing'], ['dashboard']],
  'exception.resolved': [['exceptions'], ['missions'], ['orders'], ['inventory'], ['packing'], ['dashboard']]
};

export function useRealtime(): void {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const { setConnected, updateSeq } = useRealtimeStore();

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const backoffRef = useRef(500);
  const isUnmountedRef = useRef(false);

  const pendingEventsRef = useRef<FeedEvent[]>([]);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    isUnmountedRef.current = false;

    if (!token) {
      setConnected(false, 'Disconnected');
      return;
    }

    function connect() {
      if (isUnmountedRef.current) return;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const currentSeq = useRealtimeStore.getState().lastSeq;
      const wsUrl = `${proto}//${host}/ws?token=${encodeURIComponent(token!)}&since=${currentSeq}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmountedRef.current) {
          ws.close();
          return;
        }
        backoffRef.current = 500;
        setConnected(true, 'Live');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'connected') {
            setConnected(true, 'Live');
            if (typeof msg.latest_seq === 'number') {
              updateSeq(msg.latest_seq);
            }
          } else if (msg.type === 'resync_required') {
            queryClient.invalidateQueries();
            if (typeof msg.latest_seq === 'number') {
              updateSeq(msg.latest_seq);
            }
          } else if (msg.type === 'event') {
            if (typeof msg.seq === 'number') {
              updateSeq(msg.seq);
            }

            // Buffer feed event and flush on single rAF frame
            if (typeof msg.seq === 'number' && msg.event_type) {
              pendingEventsRef.current.push({
                seq: msg.seq,
                event_type: msg.event_type,
                entity_type: msg.entity_type,
                entity_id: msg.entity_id,
                data: (msg.data && typeof msg.data === 'object') ? msg.data : {},
                created_at: msg.created_at || new Date().toISOString(),
                replay: Boolean(msg.replay)
              });

              if (rafIdRef.current === null) {
                const schedule = typeof requestAnimationFrame === 'function'
                  ? requestAnimationFrame
                  : (cb: FrameRequestCallback) => setTimeout(cb, 0);

                rafIdRef.current = schedule(() => {
                  rafIdRef.current = null;
                  const pending = pendingEventsRef.current;
                  pendingEventsRef.current = [];
                  if (pending.length > 0) {
                    useRealtimeStore.getState().pushEvents(pending);
                  }
                }) as unknown as number;
              }
            }

            // Preserved query invalidation untouched
            const keys = EVENT_KEY_MAP[msg.event_type];
            if (keys) {
              for (const k of keys) {
                queryClient.invalidateQueries({ queryKey: k });
              }
            } else {
              // General invalidation fallback
              queryClient.invalidateQueries();
            }
          }
        } catch (e) {
          console.warn('[WS] Error parsing message:', e);
        }
      };

      ws.onclose = (event) => {
        if (isUnmountedRef.current) return;
        setConnected(false, 'Reconnecting…');
        wsRef.current = null;

        // Don't reconnect if unauthenticated
        if (event.code === 4401) {
          setConnected(false, 'Unauthenticated');
          return;
        }

        // Exponential backoff: 500ms -> 1s -> 2s -> max 5s
        const delay = backoffRef.current;
        backoffRef.current = Math.min(5000, backoffRef.current * 2);

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };

      ws.onerror = () => {
        // Handled by onclose
      };
    }

    connect();

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (rafIdRef.current !== null) {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafIdRef.current);
        } else {
          clearTimeout(rafIdRef.current);
        }
        rafIdRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token, queryClient, setConnected, updateSeq]);
}
