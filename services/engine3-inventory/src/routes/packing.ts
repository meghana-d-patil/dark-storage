import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { DomainError, packOrderSchema } from '@dark-storage/shared';
import { runIdempotent } from '../domain/idempotency.js';
import { getPackingQueue, executePackOrder } from '../domain/packingRepo.js';

export function createPackingRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/packing/queue
  router.get('/internal/v1/packing/queue', (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = getPackingQueue(db);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/orders/:ref/pack
  router.post('/internal/v1/orders/:ref/pack', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const key =
        (req.headers['x-idempotency-key'] as string) ||
        (req.headers['idempotency-key'] as string) ||
        req.body?.idempotency_key;

      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const parsed = packOrderSchema.parse(req.body);
      const actor = req.actor || req.body?.actor || { id: 1, role: 'STAFF' };

      const result = runIdempotent(
        db,
        {
          key,
          scope: `order:pack:${ref}`,
          body: parsed,
          actor
        },
        (txDb) => {
          const packResult = executePackOrder(txDb, {
            order_ref: ref,
            notes: parsed.notes,
            accept_partial: parsed.accept_partial,
            actor
          });
          return { status: 201, body: packResult };
        }
      );

      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
