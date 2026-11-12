import { Router, Request, Response, NextFunction } from 'express';
import { DomainError, createOrderSchema, cancelOrderSchema, assignMissionSchema, reassignMissionSchema, packOrderSchema } from '@dark-storage/shared';
import { authMiddleware } from '../middleware/auth.js';
import { rbacMiddleware } from '../middleware/rbac.js';
import { runViaEngine1 } from '../clients/engine1.js';
import { callEngine2 } from '../clients/engine2.js';
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

async function executeAssign(ref: string, pickerId: number, idempotencyKey: string, requestId: string, actor: any) {
  // 1. Get pick-plan from Engine 3
  const planRes = await callEngine3<any>({
    method: 'GET',
    path: `/internal/v1/orders/${ref}/pick-plan`,
    requestId
  });
  const pickPlan = planRes.data;

  // 2. Call Engine 2 to plan route
  const planStops = pickPlan.reservations.map((r: any) => ({
    key: r.reservation_id,
    bin_code: r.bin_code,
    node: r.node,
    shelf_code: r.shelf_code,
    level: r.level
  }));

  const routeRes = await callEngine2<any>({
    method: 'POST',
    path: '/internal/v1/routes/plan',
    body: {
      start: 'DOCK',
      end: 'PACK',
      stops: planStops
    },
    requestId
  });
  const route = routeRes.data;

  // 3. Call Engine 3 to assign mission
  return await callEngine3<any>({
    method: 'POST',
    path: `/internal/v1/orders/${ref}/assign`,
    body: {
      picker_id: pickerId,
      plan_token: pickPlan.plan_token,
      route
    },
    requestId,
    actor,
    idempotencyKey
  });
}

// POST /api/orders/:ref/assign (MANAGER) - ORCH
ordersRouter.post('/:ref/assign', rbacMiddleware(['MANAGER']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
    if (!key) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }

    const parsed = assignMissionSchema.parse(req.body);
    const actor = { id: req.user!.id, role: req.user!.role, display_name: req.user!.name };

    try {
      const result = await executeAssign(req.params.ref, parsed.picker_id, key, req.requestId, actor);
      res.status(result.status).json(result.data);
    } catch (err) {
      if (err instanceof DomainError && err.code === 'PLAN_STALE') {
        // Auto-retry once
        const retryResult = await executeAssign(req.params.ref, parsed.picker_id, key, req.requestId, actor);
        res.status(retryResult.status).json(retryResult.data);
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:ref/reassign (MANAGER)
ordersRouter.post('/:ref/reassign', rbacMiddleware(['MANAGER']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
    if (!key) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }

    const parsed = reassignMissionSchema.parse(req.body);
    const actor = { id: req.user!.id, role: req.user!.role, display_name: req.user!.name };

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/orders/${req.params.ref}/reassign`,
      body: parsed,
      requestId: req.requestId,
      actor,
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

// POST /api/orders/:ref/pack (STAFF, MANAGER) - PROXY
ordersRouter.post(
  '/:ref/pack',
  rbacMiddleware(['STAFF', 'MANAGER']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const parsed = packOrderSchema.parse(req.body);
      const actor = {
        id: req.user!.id,
        role: req.user!.role,
        display_name: req.user!.name
      };

      const result = await callEngine3({
        method: 'POST',
        path: `/internal/v1/orders/${req.params.ref}/pack`,
        body: parsed,
        requestId: req.requestId,
        actor,
        idempotencyKey: key
      });

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);
