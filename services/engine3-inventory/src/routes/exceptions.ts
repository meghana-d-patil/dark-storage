import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { DomainError } from '@dark-storage/shared';
import {
  reportPickException,
  getExceptions,
  requestCountForException,
  resolveException,
  getExceptionRates,
} from '../domain/exceptionsRepo.js';

function extractActor(req: Request) {
  const actorId = req.headers['x-actor-id'] ? Number(req.headers['x-actor-id']) : (req.actor?.id || 1);
  const actorRole = (req.headers['x-actor-role'] as string) || req.actor?.role || 'MANAGER';
  const username = (req.headers['x-actor-username'] as string) || req.actor?.username || req.actor?.display_name || 'manager1';
  return { id: actorId, role: actorRole, username };
}

export function createExceptionsRouter(db: Database.Database): Router {
  const router = Router();

  // POST /internal/v1/pick-stops/:stopRef/report-exception
  router.post('/internal/v1/pick-stops/:stopRef/report-exception', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { stopRef } = req.params;
      const { kind, note } = req.body;
      if (!kind) {
        throw new DomainError('VALIDATION_FAILED', 'kind is required', {}, 400);
      }
      const actor = extractActor(req);

      const refreshedMission = reportPickException(db, stopRef, { kind, note }, actor);
      res.json(refreshedMission);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/exceptions
  router.get('/internal/v1/exceptions', (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query.status as string | undefined;
      const data = getExceptions(db, status);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/exceptions/:ref/request-count
  router.post('/internal/v1/exceptions/:ref/request-count', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const { note } = req.body;
      const actor = extractActor(req);

      const result = requestCountForException(db, ref, note, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/exceptions/:ref/resolve
  router.post('/internal/v1/exceptions/:ref/resolve', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const { reasonCode, note, unfreeze } = req.body;
      if (!reasonCode) {
        throw new DomainError('REASON_REQUIRED', 'reasonCode is required to resolve exception', {}, 400);
      }
      const actor = extractActor(req);

      const result = resolveException(db, ref, { reasonCode, note, unfreeze }, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/exceptions/rates
  router.get('/internal/v1/exceptions/rates', (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = getExceptionRates(db);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
