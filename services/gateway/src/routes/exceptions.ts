import { Router, Request, Response, NextFunction } from 'express';
import { DomainError, resolveExceptionSchema } from '@dark-storage/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { runViaEngine1 } from '../clients/engine1.js';
import { callEngine3 } from '../clients/engine3.js';

export const exceptionsRouter = Router();

exceptionsRouter.use(authMiddleware);

// GET /api/exceptions?status=&mission=&page= (exception:view or exception:raise)
exceptionsRouter.get('/', requirePerm(['exception:view', 'exception:raise']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryParams = new URLSearchParams(req.query as Record<string, string>);

    if (req.user!.role === 'PICKER') {
      queryParams.set('picker_id', String(req.user!.id));
    }

    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/exceptions?${queryParams.toString()}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/exceptions/:ref
exceptionsRouter.get('/:ref', requirePerm(['exception:view', 'exception:raise']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3<any>({
      method: 'GET',
      path: `/internal/v1/exceptions/${req.params.ref}`,
      requestId: req.requestId
    });

    const exc = result.data;
    if (!exc) {
      throw new DomainError('NOT_FOUND', `Exception ${req.params.ref} not found`);
    }

    if (req.user!.role === 'PICKER' && exc.reported_by !== req.user!.id) {
      throw new DomainError('FORBIDDEN', 'Access denied to this exception');
    }

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/exceptions/:ref/resolve (exception:resolve) - ORCH + E1
exceptionsRouter.post(
  '/:ref/resolve',
  requirePerm('exception:resolve'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const parsed = resolveExceptionSchema.parse(req.body);

      // Load exception to find SKU and mission
      const excRes = await callEngine3<any>({
        method: 'GET',
        path: `/internal/v1/exceptions/${req.params.ref}`,
        requestId: req.requestId
      });

      const exc = excRes.data;
      if (!exc) {
        throw new DomainError('NOT_FOUND', `Exception ${req.params.ref} not found`);
      }

      const sku = exc.sku.toUpperCase();

      const actor = {
        id: req.user!.id,
        role: req.user!.role,
        display_name: req.user!.name,
        name: req.user!.name
      };

      const result = await runViaEngine1({
        type: 'EXCEPTION_RESOLVE',
        priority: 2,
        key,
        actor,
        payload: {
          ...parsed,
          exception_ref: req.params.ref
        },
        resources: [`sku:${sku}`]
      });

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);
