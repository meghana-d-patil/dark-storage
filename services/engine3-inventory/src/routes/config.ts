import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { requirePerm } from '../middleware/rbac.js';
import { getAllConfigRows, setConfig } from '../domain/configRepo.js';
import { AppError } from '@dark-storage/shared';

export function createConfigRouter(db: Database.Database): Router {
  const router = Router();

  // GET /api/config or /internal/v1/config (perm: config:view)
  router.get(
    ['/api/config', '/internal/v1/config'],
    requirePerm('config:view'),
    (_req: Request, res: Response) => {
      const rows = getAllConfigRows(db);
      res.json({ items: rows });
    }
  );

  // PUT /api/config/:key or /internal/v1/config/:key
  // Perm by grp: config:weights for WEIGHT, config:thresholds for THRESHOLD
  router.put(
    ['/api/config/:key', '/internal/v1/config/:key'],
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const { key } = req.params;
        const { value } = req.body;

        if (value === undefined || value === null) {
          throw new AppError('VALIDATION_FAILED', 400, "Body must contain 'value'");
        }

        const existing = db.prepare('SELECT grp FROM system_config WHERE key = ?').get(key) as { grp: 'WEIGHT' | 'THRESHOLD' } | undefined;
        if (!existing) {
          throw new AppError('NOT_FOUND', 404, `Config key '${key}' not found`);
        }

        // Check permission based on group
        const requiredPerm = existing.grp === 'WEIGHT' ? 'config:weights' : 'config:thresholds';
        if (!req.actor) {
          throw new AppError('AUTH_REQUIRED', 401, 'Authentication required');
        }
        if (!req.actor.permissions.includes(requiredPerm)) {
          throw new AppError('FORBIDDEN', 403, `Permission denied: required '${requiredPerm}' for ${existing.grp} config`, {
            required: requiredPerm
          });
        }

        const updated = setConfig(db, key, String(value), String(req.actor.id));

        // Audit config change
        db.prepare(`
          INSERT INTO audit_log (actor_user_id, actor_role, action, entity_type, entity_id, details)
          VALUES (?, ?, 'config.changed', 'system_config', ?, ?)
        `).run(req.actor.id, req.actor.role, key, JSON.stringify({ key, value: String(value) }));

        res.json({ ok: true, item: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
