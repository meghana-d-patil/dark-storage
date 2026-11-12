import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const dispatchRouter = Router();

dispatchRouter.use(authMiddleware);

// GET /api/dispatch/queue (dispatch:view)
dispatchRouter.get('/queue', requirePerm('dispatch:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: '/internal/v1/dispatch/queue',
      requestId: req.requestId,
      user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username || req.user.name } : undefined,
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/:orderRef/handover (dispatch:handover)
dispatchRouter.post('/:orderRef/handover', requirePerm('dispatch:handover'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/dispatch/${req.params.orderRef}/handover`,
      body: req.body,
      requestId: req.requestId,
      user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username || req.user.name } : undefined,
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/:orderRef/regen-otp (dispatch:regen_otp)
dispatchRouter.post('/:orderRef/regen-otp', requirePerm('dispatch:regen_otp'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/dispatch/${req.params.orderRef}/regen-otp`,
      body: req.body,
      requestId: req.requestId,
      user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username || req.user.name } : undefined,
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/demo-otp/:orderRef (MANAGER/ADMIN/order:view)
dispatchRouter.get('/demo-otp/:orderRef', requirePerm(['order:view', 'dispatch:view', 'mission:reassign']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/dispatch/demo-otp/${req.params.orderRef}`,
      requestId: req.requestId,
      user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username || req.user.name } : undefined,
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
