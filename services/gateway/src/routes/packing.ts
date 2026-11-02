import { Router, Request, Response, NextFunction } from 'express';
import { DomainError, packOrderSchema } from '@dark-storage/shared';
import { authMiddleware } from '../middleware/auth.js';
import { rbacMiddleware } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const packingRouter = Router();

packingRouter.use(authMiddleware);

// GET /api/packing/queue (all authenticated roles can read)
packingRouter.get('/queue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: '/internal/v1/packing/queue',
      requestId: req.requestId
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/packing/:ref/pack or directly on orders
packingRouter.post(
  '/:ref/pack',
  rbacMiddleware(['STAFF', 'MANAGER']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const parsed = packOrderSchema.parse(req.body);
      const actor = {
        id: req.user!.id,
        role: req.user!.role,
        display_name: req.user!.name
      };

      const result = await callEngine3({
        method: 'POST',
        path: `/internal/v1/orders/${req.params.ref}/pack`,
        body: parsed,
        requestId: req.requestId,
        actor,
        idempotencyKey: key
      });

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);
