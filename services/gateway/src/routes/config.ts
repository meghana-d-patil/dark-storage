import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const configRouter = Router();

configRouter.use(authMiddleware);

// GET /api/config
configRouter.get('/', requirePerm('config:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: '/api/config',
      requestId: req.requestId,
      actor: {
        id: req.user!.id,
        role: req.user!.role,
        username: req.user!.name
      }
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// PUT /api/config/:key
configRouter.put('/:key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'PUT',
      path: `/api/config/${encodeURIComponent(req.params.key)}`,
      body: req.body,
      requestId: req.requestId,
      actor: {
        id: req.user!.id,
        role: req.user!.role,
        username: req.user!.name
      }
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
