import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { DomainError, packOrderSchema } from '@dark-storage/shared';
import { runIdempotent } from '../domain/idempotency.js';
import {
  getPackingQueue,
  executePackOrder,
  openPackSession,
  getPackSession,
  scanPackItem,
  flagPackItem,
  weighPackSession,
  completePackSession,
} from '../domain/packingRepo.js';

function extractActor(req: Request) {
  const actorId = req.headers['x-actor-id'] ? Number(req.headers['x-actor-id']) : (req.actor?.id || 1);
  const actorRole = (req.headers['x-actor-role'] as string) || req.actor?.role || 'STAFF';
  const username = (req.headers['x-actor-username'] as string) || req.actor?.username || req.actor?.display_name || 'staff1';
  return { id: actorId, role: actorRole, username };
}

export function createPackingRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/packing/queue
  router.get('/internal/v1/packing/queue', (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = getPackingQueue(db);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/packing/open
  router.post('/internal/v1/packing/open', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { toteScan } = req.body;
      if (!toteScan) {
        throw new DomainError('VALIDATION_FAILED', 'toteScan is required', {}, 400);
      }
      const benchCode = (req.headers['x-bench'] as string) || req.body?.benchCode || 'BENCH-1';
      const actor = extractActor(req);

      const session = openPackSession(db, {
        toteScan,
        benchCode,
        actor,
      });

      res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/packing/sessions/:id
  router.get('/internal/v1/packing/sessions/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = Number(req.params.id);
      const session = getPackSession(db, sessionId);
      res.json(session);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/packing/sessions/:id/scan-item
  router.post('/internal/v1/packing/sessions/:id/scan-item', (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = Number(req.params.id);
      const { scan } = req.body;
      if (!scan) {
        throw new DomainError('VALIDATION_FAILED', 'scan is required', {}, 400);
      }
      const actor = extractActor(req);

      const session = scanPackItem(db, sessionId, scan, actor);
      res.json(session);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/packing/sessions/:id/flag-item
  router.post('/internal/v1/packing/sessions/:id/flag-item', (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = Number(req.params.id);
      const { sku, qty, kind, note } = req.body;
      if (!sku || !qty || !kind) {
        throw new DomainError('VALIDATION_FAILED', 'sku, qty, and kind are required', {}, 400);
      }
      if (kind !== 'MISSING' && kind !== 'DAMAGED') {
        throw new DomainError('VALIDATION_FAILED', 'kind must be MISSING or DAMAGED', {}, 400);
      }
      const actor = extractActor(req);

      const session = flagPackItem(
        db,
        sessionId,
        { sku, qty: Number(qty), kind, note },
        actor
      );
      res.json(session);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/packing/sessions/:id/weigh
  router.post('/internal/v1/packing/sessions/:id/weigh', (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = Number(req.params.id);
      const { grams } = req.body;
      if (grams === undefined || grams === null || isNaN(Number(grams))) {
        throw new DomainError('VALIDATION_FAILED', 'grams is required', {}, 400);
      }

      const result = weighPackSession(db, sessionId, Number(grams));
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/packing/sessions/:id/complete
  router.post('/internal/v1/packing/sessions/:id/complete', (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = Number(req.params.id);
      const { slotScan } = req.body;
      if (!slotScan) {
        throw new DomainError('VALIDATION_FAILED', 'slotScan is required', {}, 400);
      }
      const actor = extractActor(req);

      const result = completePackSession(db, sessionId, slotScan, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // Legacy POST /internal/v1/orders/:ref/pack
  router.post('/internal/v1/orders/:ref/pack', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const key =
        (req.headers['x-idempotency-key'] as string) ||
        (req.headers['idempotency-key'] as string) ||
        req.body?.idempotency_key;

      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const parsed = packOrderSchema.parse(req.body);
      const actor = req.actor || req.body?.actor || { id: 1, role: 'STAFF' };

      const result = runIdempotent(
        db,
        {
          key,
          scope: `order:pack:${ref}`,
          body: parsed,
          actor
        },
        (txDb) => {
          const packResult = executePackOrder(txDb, {
            order_ref: ref,
            notes: parsed.notes,
            accept_partial: parsed.accept_partial,
            actor
          });
          return { status: 201, body: packResult };
        }
      );

      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
