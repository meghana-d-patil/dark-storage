import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { requirePerm } from '../middleware/rbac.js';
import { verifyAuditChain, appendAudit } from '../audit/appendAudit.js';

export function createAuditRouter(db: Database.Database): Router {
  const router = Router();

  // GET /api/audit/verify (audit:verify)
  router.get(
    ['/api/audit/verify', '/internal/v1/audit/verify'],
    requirePerm('audit:verify'),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = verifyAuditChain(db);

        // Append audit row for the verification
        appendAudit(db, {
          actor: req.actor,
          action: 'audit.verified',
          entityType: 'audit_log',
          entityRef: 'chain',
          after: { ok: result.ok, checked: result.checked, brokenAtSeq: result.brokenAtSeq }
        });

        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/audit/export (audit:export)
  router.get(
    ['/api/audit/export', '/internal/v1/audit/export'],
    requirePerm('audit:export'),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const from = req.query.from as string | undefined;
        const to = req.query.to as string | undefined;

        const whereClauses: string[] = ['1=1'];
        const params: any[] = [];

        if (from) {
          whereClauses.push('a.occurred_at >= ?');
          params.push(from);
        }
        if (to) {
          whereClauses.push('a.occurred_at <= ?');
          params.push(to);
        }

        const rows = db.prepare(`
          SELECT
            a.seq,
            a.occurred_at AS at,
            COALESCE(u.username, u.display_name, 'System') AS actor,
            COALESCE(u.role, a.actor_role, 'SYSTEM') AS role,
            a.action,
            a.entity_type,
            a.entity_id,
            a.prev_hash,
            a.row_hash,
            a.details_json
          FROM audit_log a
          LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE ${whereClauses.join(' AND ')}
          ORDER BY a.seq ASC
        `).all(...params) as any[];

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="audit_log.csv"');

        // CSV Header
        res.write('seq,at,actor,role,action,entity_type,entity_id,prev_hash,row_hash,details\n');

        for (const row of rows) {
          const safeDetails = row.details_json ? `"${row.details_json.replace(/"/g, '""')}"` : '""';
          const line = [
            row.seq ?? '',
            row.at ?? '',
            `"${(row.actor || '').replace(/"/g, '""')}"`,
            row.role ?? '',
            `"${(row.action || '').replace(/"/g, '""')}"`,
            `"${(row.entity_type || '').replace(/"/g, '""')}"`,
            `"${(row.entity_id || '').replace(/"/g, '""')}"`,
            row.prev_hash ?? '',
            row.row_hash ?? '',
            safeDetails
          ].join(',');
          res.write(line + '\n');
        }

        res.end();
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/audit (audit:view)
  router.get(
    ['/api/audit', '/internal/v1/audit'],
    requirePerm('audit:view'),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const entityType = (req.query.entityType || req.query.entity_type) as string | undefined;
        const entityRef = (req.query.entityRef || req.query.entity_id) as string | undefined;
        const action = req.query.action as string | undefined;
        const actor = req.query.actor as string | undefined;
        const cursor = req.query.cursor ? parseInt(req.query.cursor as string, 10) : undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : (req.query.page_size ? parseInt(req.query.page_size as string, 10) : 50);

        const whereClauses: string[] = ['1=1'];
        const params: any[] = [];

        if (entityType) {
          whereClauses.push('a.entity_type = ?');
          params.push(entityType);
        }
        if (entityRef) {
          whereClauses.push('a.entity_id = ?');
          params.push(entityRef);
        }
        if (action) {
          whereClauses.push('a.action = ?');
          params.push(action);
        }
        if (actor) {
          whereClauses.push('(u.username = ? OR u.display_name = ?)');
          params.push(actor, actor);
        }
        if (cursor !== undefined) {
          whereClauses.push('a.seq < ?');
          params.push(cursor);
        }

        const whereSql = whereClauses.join(' AND ');

        const countRow = db.prepare(`
          SELECT COUNT(*) AS c
          FROM audit_log a
          LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE ${whereSql}
        `).get(...params) as { c: number };

        const rows = db.prepare(`
          SELECT
            a.id,
            a.seq,
            a.occurred_at AS at,
            COALESCE(u.display_name, 'System') AS actor,
            COALESCE(u.role, a.actor_role, 'SYSTEM') AS role,
            a.action,
            a.entity_type,
            a.entity_id,
            a.details_json,
            a.prev_hash,
            a.row_hash
          FROM audit_log a
          LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE ${whereSql}
          ORDER BY a.seq DESC
          LIMIT ?
        `).all(...params, limit) as any[];

        const items = rows.map((r) => ({
          id: r.id,
          seq: r.seq,
          at: r.at,
          actor: r.actor,
          role: r.role,
          action: r.action,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          prev_hash: r.prev_hash,
          row_hash: r.row_hash,
          details: r.details_json ? JSON.parse(r.details_json) : null
        }));

        res.json({
          items,
          total: countRow.c,
          limit,
          nextCursor: items.length === limit ? items[items.length - 1].seq : null
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /api/orders/:ref/events (order:view)
  router.get(
    ['/api/orders/:ref/events', '/internal/v1/orders/:ref/events'],
    requirePerm('order:view'),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const orderRef = req.params.ref;
        const events = db.prepare(`
          SELECT id, order_ref, event, actor_id, actor_role, payload, at
          FROM order_events
          WHERE order_ref = ?
          ORDER BY id ASC
        `).all(orderRef) as any[];

        const parsedEvents = events.map((e) => ({
          id: e.id,
          order_ref: e.order_ref,
          event: e.event,
          actor_id: e.actor_id,
          actor_role: e.actor_role,
          payload: e.payload ? JSON.parse(e.payload) : {},
          at: e.at
        }));

        res.json({ events: parsedEvents });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
