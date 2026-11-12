import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const floorTasksRouter = Router();

floorTasksRouter.use(authMiddleware);

// GET /api/floor-tasks
floorTasksRouter.get(
  '/',
  requirePerm(['floortask:claim', 'floortask:claim_pick']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = new URLSearchParams(req.query as Record<string, string>).toString();
      const actor = req.user
        ? { id: req.user.id, role: req.user.role, username: req.user.username, display_name: req.user.name }
        : null;

      const result = await callEngine3({
        method: 'GET',
        path: `/internal/v1/floor-tasks?${query}`,
        requestId: req.requestId,
        actor,
      });

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/floor-tasks/:ref/claim
floorTasksRouter.post(
  '/:ref/claim',
  requirePerm(['floortask:claim', 'floortask:claim_pick']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.user
        ? { id: req.user.id, role: req.user.role, username: req.user.username, display_name: req.user.name }
        : null;

      const result = await callEngine3({
        method: 'POST',
        path: `/internal/v1/floor-tasks/${encodeURIComponent(req.params.ref)}/claim`,
        requestId: req.requestId,
        actor,
      });

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/floor-tasks/:ref/heartbeat
floorTasksRouter.post('/:ref/heartbeat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.user
      ? { id: req.user.id, role: req.user.role, username: req.user.username, display_name: req.user.name }
      : null;

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/floor-tasks/${encodeURIComponent(req.params.ref)}/heartbeat`,
      requestId: req.requestId,
      actor,
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/floor-tasks/:ref/release
floorTasksRouter.post('/:ref/release', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.user
      ? { id: req.user.id, role: req.user.role, username: req.user.username, display_name: req.user.name }
      : null;

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/floor-tasks/${encodeURIComponent(req.params.ref)}/release`,
      requestId: req.requestId,
      actor,
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
