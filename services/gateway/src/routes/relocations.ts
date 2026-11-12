import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const relocationsRouter = Router();

relocationsRouter.use(authMiddleware);

// POST /api/relocations/request (relocate:request)
relocationsRouter.post('/request', requirePerm('relocate:request'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.user
      ? { id: req.user.id, role: req.user.role, username: req.user.username, display_name: req.user.name }
      : null;

    const result = await callEngine3({
      method: 'POST',
      path: '/internal/v1/relocations/request',
      body: req.body,
      requestId: req.requestId,
      actor,
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
