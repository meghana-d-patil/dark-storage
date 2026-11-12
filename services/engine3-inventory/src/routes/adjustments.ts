import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { DomainError } from '@dark-storage/shared';
import {
  submitBlindCount,
  requestAdjustment,
  getAdjustments,
  approveAdjustment,
  rejectAdjustment,
  flagDamageStock,
  requestRelocationTask,
  executeRelocationTask,
  cancelOrderBeforePick,
} from '../domain/adjustmentsRepo.js';

function extractActor(req: Request) {
  const actorId = req.headers['x-actor-id'] ? Number(req.headers['x-actor-id']) : (req.actor?.id || 1);
  const actorRole = (req.headers['x-actor-role'] as string) || req.actor?.role || 'OPERATOR';
  const username = (req.headers['x-actor-username'] as string) || req.actor?.username || req.actor?.display_name || 'operator1';
  return { id: actorId, role: actorRole, username };
}

export function createAdjustmentsRouter(db: Database.Database): Router {
  const router = Router();

  // POST /internal/v1/floor-tasks/:ref/count
  router.post('/internal/v1/floor-tasks/:ref/count', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const { binScan, countedQty } = req.body;
      if (!binScan || countedQty === undefined || countedQty === null || isNaN(Number(countedQty))) {
        throw new DomainError('VALIDATION_FAILED', 'binScan and countedQty are required', {}, 400);
      }
      const actor = extractActor(req);

      const result = submitBlindCount(db, ref, { binScan, countedQty: Number(countedQty) }, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/adjustments/request
  router.post('/internal/v1/adjustments/request', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { binCode, sku, deltaQty, reasonCode, note } = req.body;
      if (!binCode || !sku || deltaQty === undefined || !reasonCode) {
        throw new DomainError('VALIDATION_FAILED', 'binCode, sku, deltaQty, and reasonCode are required', {}, 400);
      }
      const actor = extractActor(req);

      const result = requestAdjustment(
        db,
        { binCode, sku, deltaQty: Number(deltaQty), reasonCode, note },
        actor
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/adjustments
  router.get('/internal/v1/adjustments', (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query.status as string | undefined;
      const data = getAdjustments(db, status);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/adjustments/:ref/approve
  router.post('/internal/v1/adjustments/:ref/approve', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const { note } = req.body;
      const actor = extractActor(req);

      const result = approveAdjustment(db, ref, { note }, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/adjustments/:ref/reject
  router.post('/internal/v1/adjustments/:ref/reject', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const { reasonCode, note } = req.body;
      if (!reasonCode) {
        throw new DomainError('REASON_REQUIRED', 'reasonCode is required to reject adjustment', {}, 400);
      }
      const actor = extractActor(req);

      const result = rejectAdjustment(db, ref, { reasonCode, note }, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/inventory/damage-flag
  router.post('/internal/v1/inventory/damage-flag', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { binCode, qty, note } = req.body;
      if (!binCode || !qty || Number(qty) <= 0) {
        throw new DomainError('VALIDATION_FAILED', 'binCode and positive qty are required', {}, 400);
      }
      const actor = extractActor(req);

      const result = flagDamageStock(db, { binCode, qty: Number(qty), note }, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/relocations/request
  router.post('/internal/v1/relocations/request', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { fromBin, toBin, sku, qty, reasonCode } = req.body;
      if (!fromBin || !toBin || !sku || !qty) {
        throw new DomainError('VALIDATION_FAILED', 'fromBin, toBin, sku, and qty are required', {}, 400);
      }
      const actor = extractActor(req);

      const result = requestRelocationTask(
        db,
        { fromBin, toBin, sku, qty: Number(qty), reasonCode: reasonCode || 'RELOCATE' },
        actor
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/floor-tasks/:ref/relocate
  router.post('/internal/v1/floor-tasks/:ref/relocate', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const { fromScan, itemScan, toScan } = req.body;
      if (!fromScan || !itemScan || !toScan) {
        throw new DomainError('VALIDATION_FAILED', 'fromScan, itemScan, and toScan are required', {}, 400);
      }
      const actor = extractActor(req);

      const result = executeRelocationTask(db, ref, { fromScan, itemScan, toScan }, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/orders/:ref/cancel
  router.post('/internal/v1/orders/:ref/cancel', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const { reasonCode, note } = req.body;
      const actor = extractActor(req);

      const result = cancelOrderBeforePick(db, ref, { reasonCode, note }, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
