import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { DomainError, orderQuerySchema, cancelOrderSchema } from '@dark-storage/shared';
import { runIdempotent } from '../domain/idempotency.js';
import { getOrder, listOrders, cancelOrder } from '../domain/ordersRepo.js';

export function createOrdersRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/orders
  router.get('/internal/v1/orders', (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = orderQuerySchema.parse(req.query);
      const data = listOrders(db, parsed);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/orders/:ref
  router.get('/internal/v1/orders/:ref', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const order = getOrder(db, ref);
      if (!order) {
        throw new DomainError('NOT_FOUND', `Order ${ref} not found`);
      }
      res.json(order);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/orders/:ref/cancel
  router.post('/internal/v1/orders/:ref/cancel', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const key =
        (req.headers['x-idempotency-key'] as string) ||
        (req.headers['idempotency-key'] as string) ||
        req.body?.idempotency_key;

      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const parsed = cancelOrderSchema.parse(req.body);
      const actor = req.actor || req.body?.actor || { id: 1, role: 'MANAGER' };

      const result = runIdempotent(
        db,
        {
          key,
          scope: `order:cancel:${ref}`,
          body: parsed,
          actor
        },
        (txDb) => {
          const cancelled = cancelOrder(txDb, ref, parsed.reason, actor);
          return { status: 200, body: cancelled };
        }
      );

      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
