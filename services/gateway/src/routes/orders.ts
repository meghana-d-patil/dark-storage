import { Router, Request, Response, NextFunction } from 'express';
import { DomainError, createOrderSchema, cancelOrderSchema } from '@dark-storage/shared';
import { authMiddleware } from '../middleware/auth.js';
import { rbacMiddleware } from '../middleware/rbac.js';
import { runViaEngine1 } from '../clients/engine1.js';
import { callEngine3 } from '../clients/engine3.js';

export const ordersRouter = Router();

ordersRouter.use(authMiddleware);

// POST /api/orders (MANAGER) - E1
ordersRouter.post('/', rbacMiddleware(['MANAGER']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
    if (!key) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }

    const parsed = createOrderSchema.parse(req.body);
    const resources = Array.from(new Set(parsed.lines.map((l) => `sku:${l.sku.toUpperCase()}`))).sort();

    const priorityMap: Record<string, number> = {
      LOW: 1,
      NORMAL: 2,
      HIGH: 3,
      URGENT: 4
    };
    const priority = priorityMap[parsed.priority] || 2;

    const actor = {
      id: req.user!.id,
      display_name: req.user!.name,
      name: req.user!.name,
      role: req.user!.role
    };

    const result = await runViaEngine1({
      type: 'RESERVE_ORDER',
      priority,
      key,
      actor,
      payload: parsed,
      resources
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:ref/cancel (MANAGER) - PROXY
ordersRouter.post('/:ref/cancel', rbacMiddleware(['MANAGER']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
    if (!key) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }

    const parsed = cancelOrderSchema.parse(req.body);

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/orders/${req.params.ref}/cancel`,
      body: parsed,
      requestId: req.requestId,
      actor: { id: req.user!.id, role: req.user!.role },
      idempotencyKey: key
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/orders?status=&priority=&search=&page=
ordersRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/orders?${query}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/orders/:ref
ordersRouter.get('/:ref', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/orders/${req.params.ref}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
