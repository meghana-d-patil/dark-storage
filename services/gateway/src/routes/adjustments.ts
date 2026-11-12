import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const adjustmentsRouter = Router();

adjustmentsRouter.use(authMiddleware);

// POST /api/adjustments/request (adjust:request)
adjustmentsRouter.post('/request', requirePerm('adjust:request'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.user
      ? { id: req.user.id, role: req.user.role, username: req.user.username, display_name: req.user.name }
      : null;

    const result = await callEngine3({
      method: 'POST',
      path: '/internal/v1/adjustments/request',
      body: req.body,
      requestId: req.requestId,
      actor,
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/adjustments (adjust:approve, adjust:approve_high, audit:view)
adjustmentsRouter.get(
  '/',
  requirePerm(['adjust:approve', 'adjust:approve_high', 'audit:view']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = new URLSearchParams(req.query as Record<string, string>).toString();
      const actor = req.user
        ? { id: req.user.id, role: req.user.role, username: req.user.username, display_name: req.user.name }
        : null;

      const result = await callEngine3({
        method: 'GET',
        path: `/internal/v1/adjustments?${query}`,
        requestId: req.requestId,
        actor,
      });

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/adjustments/:ref/approve (adjust:approve, adjust:approve_high)
adjustmentsRouter.post(
  '/:ref/approve',
  requirePerm(['adjust:approve', 'adjust:approve_high']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.user
        ? { id: req.user.id, role: req.user.role, username: req.user.username, display_name: req.user.name }
        : null;

      const result = await callEngine3({
        method: 'POST',
        path: `/internal/v1/adjustments/${encodeURIComponent(req.params.ref)}/approve`,
        body: req.body,
        requestId: req.requestId,
        actor,
      });

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/adjustments/:ref/reject (adjust:approve, adjust:approve_high)
adjustmentsRouter.post(
  '/:ref/reject',
  requirePerm(['adjust:approve', 'adjust:approve_high']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.user
        ? { id: req.user.id, role: req.user.role, username: req.user.username, display_name: req.user.name }
        : null;

      const result = await callEngine3({
        method: 'POST',
        path: `/internal/v1/adjustments/${encodeURIComponent(req.params.ref)}/reject`,
        body: req.body,
        requestId: req.requestId,
        actor,
      });

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);
