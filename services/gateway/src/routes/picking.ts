import { Router, Request, Response, NextFunction } from 'express';
import { DomainError, confirmPickSchema, reportProblemSchema } from '@dark-storage/shared';
import { authMiddleware } from '../middleware/auth.js';
import { rbacMiddleware } from '../middleware/rbac.js';
import { runViaEngine1 } from '../clients/engine1.js';
import { callEngine3 } from '../clients/engine3.js';

export const pickStopsRouter = Router();

pickStopsRouter.use(authMiddleware);

// POST /api/pick-stops/:stop_ref/confirm (PICKER, own mission) - E1
pickStopsRouter.post(
  '/:stop_ref/confirm',
  rbacMiddleware(['PICKER', 'MANAGER']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const parsed = confirmPickSchema.parse(req.body);

      // Read stop first to derive shelf and verify ownership
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
        display_name: req.user!.name,
        name: req.user!.name
      };

      const result = await runViaEngine1({
        type: 'PICK_CONFIRM',
        priority: 2,
        key,
        actor,
        payload: {
          ...parsed,
          stop_ref: req.params.stop_ref
        },
        resources: [`shelf:${stop.shelf_code}`]
      });

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/pick-stops/:stop_ref/exception (PICKER, own mission) - PROXY
pickStopsRouter.post(
  '/:stop_ref/exception',
  rbacMiddleware(['PICKER', 'MANAGER']),
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
