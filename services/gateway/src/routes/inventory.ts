import { Router, Request, Response, NextFunction } from 'express';
import { DomainError, shelfOfBin, relocateSchema } from '@dark-storage/shared';
import { callEngine3 } from '../clients/engine3.js';
import { runViaEngine1 } from '../clients/engine1.js';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';

export const inventoryRouter = Router();

// Protect all inventory routes with authentication
inventoryRouter.use(authMiddleware);

// GET /api/inventory (alias for /summary)
inventoryRouter.get('/', requirePerm('inventory:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/inventory/summary?${query}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/bins/:code/status
inventoryRouter.post('/bins/:code/status', requirePerm(['exception:resolve', 'inventory:view']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.params.code;
    const actor = req.user ? { id: req.user.id, role: req.user.role } : null;

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/inventory/bins/${encodeURIComponent(code)}/status`,
      body: req.body,
      requestId: req.requestId,
      actor
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/bins/:code/recount - D11 REMOVED
inventoryRouter.post('/bins/:code/recount', async (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'Endpoint removed',
    code: 'ENDPOINT_REMOVED',
    details: { replacement: 'Phase 7: /api/adjustments blind count' }
  });
});

// GET /api/inventory/summary
inventoryRouter.get('/summary', requirePerm('inventory:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/inventory/summary?${query}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/inventory/bins
inventoryRouter.get('/bins', requirePerm('inventory:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/inventory/bins?${query}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/inventory/bins/:code
inventoryRouter.get('/bins/:code', requirePerm('inventory:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.params.code;
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/inventory/bins/${encodeURIComponent(code)}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/inventory/movements
inventoryRouter.get('/movements', requirePerm('inventory:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/inventory/movements?${query}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/relocate (relocate:execute)
inventoryRouter.post('/relocate', requirePerm('relocate:execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
    if (!key) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }

    const parsed = relocateSchema.parse(req.body);
    const fromShelf = shelfOfBin(parsed.from_bin);
    const toShelf = shelfOfBin(parsed.to_bin);
    const resources = Array.from(new Set([`shelf:${fromShelf}`, `shelf:${toShelf}`])).sort();

    const actor = {
      id: req.user!.id,
      display_name: req.user!.name || (req.user as any).display_name,
      name: req.user!.name,
      role: req.user!.role
    };

    const result = await runViaEngine1({
      type: 'RELOCATE',
      priority: 1, // LOW
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
