import { Router, Request, Response, NextFunction } from 'express';
import { callEngine3 } from '../clients/engine3.js';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';

export const warehouseRouter = Router();

warehouseRouter.use(authMiddleware);

// GET /api/warehouse/layout (inventory:view)
warehouseRouter.get('/layout', requirePerm('inventory:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: '/internal/v1/warehouse/layout',
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/warehouse/search?q= (inventory:view)
warehouseRouter.get('/search', requirePerm('inventory:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/warehouse/search?${query}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
