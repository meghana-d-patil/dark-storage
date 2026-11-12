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
      requestId: req.requestId
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
