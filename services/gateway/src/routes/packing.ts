import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const packingRouter = Router();

packingRouter.use(authMiddleware);

// GET /api/packing/queue (pack:execute or order:view)
packingRouter.get('/queue', requirePerm(['pack:execute', 'order:view']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: '/internal/v1/packing/queue',
      requestId: req.requestId,
      user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username || req.user.name } : undefined,
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/packing/open (pack:execute)
packingRouter.post('/open', requirePerm('pack:execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'POST',
      path: '/internal/v1/packing/open',
      body: req.body,
      requestId: req.requestId,
      user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username || req.user.name } : undefined,
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/packing/sessions/:id (pack:execute)
packingRouter.get('/sessions/:id', requirePerm('pack:execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/packing/sessions/${req.params.id}`,
      requestId: req.requestId,
      user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username || req.user.name } : undefined,
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/packing/sessions/:id/scan-item (pack:execute)
packingRouter.post('/sessions/:id/scan-item', requirePerm('pack:execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/packing/sessions/${req.params.id}/scan-item`,
      body: req.body,
      requestId: req.requestId,
      user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username || req.user.name } : undefined,
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/packing/sessions/:id/flag-item (pack:execute, repick:request)
packingRouter.post('/sessions/:id/flag-item', requirePerm(['pack:execute', 'repick:request']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/packing/sessions/${req.params.id}/flag-item`,
      body: req.body,
      requestId: req.requestId,
      user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username || req.user.name } : undefined,
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/packing/sessions/:id/weigh (pack:execute)
packingRouter.post('/sessions/:id/weigh', requirePerm('pack:execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/packing/sessions/${req.params.id}/weigh`,
      body: req.body,
      requestId: req.requestId,
      user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username || req.user.name } : undefined,
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/packing/sessions/:id/complete (pack:execute)
packingRouter.post('/sessions/:id/complete', requirePerm('pack:execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/packing/sessions/${req.params.id}/complete`,
      body: req.body,
      requestId: req.requestId,
      user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username || req.user.name } : undefined,
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/packing/:ref/pack - D11 REMOVED
packingRouter.post('/:ref/pack', async (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'Endpoint removed',
    code: 'ENDPOINT_REMOVED',
    details: { replacement: 'Phase 6: /floor/pack workflow' }
  });
});
