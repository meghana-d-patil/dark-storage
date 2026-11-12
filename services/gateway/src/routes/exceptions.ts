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

// GET /api/exceptions/rates (exception:view)
exceptionsRouter.get('/rates', requirePerm('exception:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: '/internal/v1/exceptions/rates',
      requestId: req.requestId,
      user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username || req.user.name } : undefined,
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/exceptions/:ref/request-count (count:request)
exceptionsRouter.post('/:ref/request-count', requirePerm('count:request'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/exceptions/${req.params.ref}/request-count`,
      body: req.body,
      requestId: req.requestId,
      user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username || req.user.name } : undefined,
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/exceptions/:ref/resolve (exception:resolve)
exceptionsRouter.post(
  '/:ref/resolve',
  requirePerm('exception:resolve'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await callEngine3({
        method: 'POST',
        path: `/internal/v1/exceptions/${req.params.ref}/resolve`,
        body: req.body,
        requestId: req.requestId,
        user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username || req.user.name } : undefined,
      });

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);
