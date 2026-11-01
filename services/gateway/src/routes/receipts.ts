import { Router, Request, Response, NextFunction } from 'express';
import { DomainError } from '@dark-storage/shared';
import { callEngine3 } from '../clients/engine3.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbacMiddleware } from '../middleware/rbac.js';

export const receiptsRouter = Router();

receiptsRouter.use(authMiddleware);

// POST /api/receipts (MANAGER, OPERATOR) - PROXY, Idempotency-Key required
receiptsRouter.post('/', rbacMiddleware(['MANAGER', 'OPERATOR']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const idemKey = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
    if (!idemKey) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }

    const actor = req.user ? { id: req.user.id, role: req.user.role } : null;

    const result = await callEngine3({
      method: 'POST',
      path: '/internal/v1/receipts',
      body: req.body,
      requestId: req.requestId,
      actor,
      idempotencyKey: idemKey
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/receipts/staged
receiptsRouter.get('/staged', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: '/internal/v1/receipts/staged',
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/receipts
receiptsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/receipts?${query}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/receipts/:ref
receiptsRouter.get('/:ref', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ref = req.params.ref;
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/receipts/${encodeURIComponent(ref)}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
