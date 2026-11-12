import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { DomainError } from '@dark-storage/shared';
import { getDispatchQueue, handoverDispatch, regenOtp, getDemoOtp } from '../domain/dispatchRepo.js';

function extractActor(req: Request) {
  const actorId = req.headers['x-actor-id'] ? Number(req.headers['x-actor-id']) : (req.actor?.id || 1);
  const actorRole = (req.headers['x-actor-role'] as string) || req.actor?.role || 'DISPATCH';
  const username = (req.headers['x-actor-username'] as string) || req.actor?.username || req.actor?.display_name || 'dispatch1';
  return { id: actorId, role: actorRole, username };
}

export function createDispatchRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/dispatch/queue
  router.get('/internal/v1/dispatch/queue', (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = getDispatchQueue(db);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/dispatch/:orderRef/handover
  router.post('/internal/v1/dispatch/:orderRef/handover', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderRef } = req.params;
      const { slotScan, otp, riderName } = req.body;
      if (!slotScan || !otp) {
        throw new DomainError('VALIDATION_FAILED', 'slotScan and otp are required', {}, 400);
      }
      const actor = extractActor(req);

      const result = handoverDispatch(db, orderRef, { slotScan, otp, riderName }, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/dispatch/:orderRef/regen-otp
  router.post('/internal/v1/dispatch/:orderRef/regen-otp', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderRef } = req.params;
      const { reasonCode } = req.body;
      const actor = extractActor(req);

      const result = regenOtp(db, orderRef, reasonCode, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/dispatch/demo-otp/:orderRef
  router.get('/internal/v1/dispatch/demo-otp/:orderRef', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderRef } = req.params;
      const result = getDemoOtp(db, orderRef);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
