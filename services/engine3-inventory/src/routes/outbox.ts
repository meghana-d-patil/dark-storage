import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';

export function createOutboxRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/outbox?after_seq=0&limit=100
  router.get('/internal/v1/outbox', (req: Request, res: Response, next: NextFunction) => {
    try {
      const afterSeq = Math.max(0, parseInt((req.query.after_seq as string) || '0', 10) || 0);
      const rawLimit = parseInt((req.query.limit as string) || '100', 10) || 100;
      const limit = Math.min(500, Math.max(1, rawLimit));

      const maxRow = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM outbox_events').get() as { m: number };
      const latestSeq = maxRow.m;

      const rows = db
        .prepare(
          `
        SELECT seq, event_type, entity_type, entity_id, data_json, created_at
        FROM outbox_events
        WHERE seq > ?
        ORDER BY seq ASC
        LIMIT ?
      `
        )
        .all(afterSeq, limit) as Array<{
        seq: number;
        event_type: string;
        entity_type: string;
        entity_id: string;
        data_json: string;
        created_at: string;
      }>;

      const events = rows.map((r) => {
        let parsedData: any = {};
        try {
          parsedData = JSON.parse(r.data_json);
        } catch {
          parsedData = {};
        }
        return {
          seq: r.seq,
          event_type: r.event_type,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          data: parsedData,
          created_at: r.created_at
        };
      });

      res.json({
        latest_seq: latestSeq,
        events
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
