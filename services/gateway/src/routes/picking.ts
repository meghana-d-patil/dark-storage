import { Router, Request, Response, NextFunction } from 'express';
import { DomainError, reportProblemSchema } from '@dark-storage/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const pickStopsRouter = Router();

pickStopsRouter.use(authMiddleware);

// POST /api/pick-stops/:stop_ref/confirm - D11 REMOVED
pickStopsRouter.post('/:stop_ref/confirm', async (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'Endpoint removed',
    code: 'ENDPOINT_REMOVED',
    details: { replacement: 'Phase 5: 3-step scan workflow' }
  });
});

// POST /api/pick-stops/:stop_ref/exception (PICKER or roles with exception:raise / pick:execute)
pickStopsRouter.post(
  '/:stop_ref/exception',
  requirePerm(['pick:execute', 'exception:raise']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const parsed = reportProblemSchema.parse(req.body);

      // Verify ownership
      const stopRes = await callEngine3<any>({
        method: 'GET',
        path: `/internal/v1/pick-stops/${req.params.stop_ref}`,
        requestId: req.requestId
      });

      const stop = stopRes.data;
      if (!stop) {
        throw new DomainError('NOT_FOUND', `Stop ${req.params.stop_ref} not found`);
      }

      if (req.user!.role === 'PICKER' && stop.picker_id !== req.user!.id) {
        throw new DomainError('NOT_YOUR_MISSION', 'You do not own this mission');
      }

      const actor = {
        id: req.user!.id,
        role: req.user!.role,
        display_name: req.user!.name
      };

      const result = await callEngine3({
        method: 'POST',
        path: `/internal/v1/pick-stops/${req.params.stop_ref}/exception`,
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
