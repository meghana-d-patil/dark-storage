import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { DomainError } from '@dark-storage/shared';
import {
  claimNextMission,
  heartbeatMission,
  releaseMission,
  forceUnassignMission,
  getActivePickerMission,
  scanBin,
  scanItem,
  scanTote,
  getFloorTasks,
  claimFloorTask,
  heartbeatFloorTask,
  releaseFloorTask,
} from '../domain/pickerRepo.js';

export function createPickerRouter(db: Database.Database): Router {
  const router = Router();

  // POST /internal/v1/missions/claim-next
  router.post('/missions/claim-next', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw new DomainError('AUTH_REQUIRED', 'Actor is required', {}, 401);
      }

      // Load zones from user profile
      const userRow = db.prepare('SELECT zones FROM users WHERE id = ?').get(actor.id) as
        | { zones: string }
        | undefined;
      const zones = userRow && userRow.zones ? JSON.parse(userRow.zones) : [];

      const missionDto = claimNextMission(db, {
        id: actor.id,
        username: actor.username,
        role: actor.role,
        zones,
      });

      res.json({ ok: true, mission: missionDto });
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/missions/:ref/heartbeat
  router.post('/missions/:ref/heartbeat', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw new DomainError('AUTH_REQUIRED', 'Actor is required', {}, 401);
      }

      const result = heartbeatMission(db, req.params.ref, { username: actor.username });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/missions/:ref/release
  router.post('/missions/:ref/release', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw new DomainError('AUTH_REQUIRED', 'Actor is required', {}, 401);
      }

      const result = releaseMission(db, req.params.ref, {
        username: actor.username,
        id: actor.id,
        role: actor.role,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/missions/:ref/force-unassign
  router.post('/missions/:ref/force-unassign', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw new DomainError('AUTH_REQUIRED', 'Actor is required', {}, 401);
      }

      const { reasonCode, note } = req.body || {};
      if (!reasonCode) {
        throw new DomainError('VALIDATION_FAILED', 'reasonCode is required', {}, 400);
      }

      const result = forceUnassignMission(
        db,
        req.params.ref,
        { id: actor.id, role: actor.role },
        reasonCode,
        note
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/picker/mission
  router.get('/picker/mission', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw new DomainError('AUTH_REQUIRED', 'Actor is required', {}, 401);
      }

      const mission = getActivePickerMission(db, {
        username: actor.username,
        id: actor.id,
      });
      res.json(mission);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/pick-stops/:stopRef/scan-bin
  router.post('/pick-stops/:stopRef/scan-bin', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw new DomainError('AUTH_REQUIRED', 'Actor is required', {}, 401);
      }

      const { scan } = req.body || {};
      if (!scan) {
        throw new DomainError('VALIDATION_FAILED', 'Scan is required', {}, 400);
      }

      const result = scanBin(db, req.params.stopRef, scan, {
        username: actor.username,
        id: actor.id,
        role: actor.role,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/pick-stops/:stopRef/scan-item
  router.post('/pick-stops/:stopRef/scan-item', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw new DomainError('AUTH_REQUIRED', 'Actor is required', {}, 401);
      }

      const { scan, qty } = req.body || {};
      if (!scan) {
        throw new DomainError('VALIDATION_FAILED', 'Scan is required', {}, 400);
      }
      const parsedQty = parseInt(qty, 10) || 1;

      const result = scanItem(db, req.params.stopRef, scan, parsedQty, {
        username: actor.username,
        id: actor.id,
        role: actor.role,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/pick-stops/:stopRef/scan-tote
  router.post('/pick-stops/:stopRef/scan-tote', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw new DomainError('AUTH_REQUIRED', 'Actor is required', {}, 401);
      }

      const { scan } = req.body || {};
      if (!scan) {
        throw new DomainError('VALIDATION_FAILED', 'Scan is required', {}, 400);
      }

      const result = scanTote(db, req.params.stopRef, scan, {
        username: actor.username,
        id: actor.id,
        role: actor.role,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/floor-tasks
  router.get('/floor-tasks', (req: Request, res: Response, next: NextFunction) => {
    try {
      const tasks = getFloorTasks(db, req.query as any);
      res.json({ ok: true, data: tasks });
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/floor-tasks/:ref/claim
  router.post('/floor-tasks/:ref/claim', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw new DomainError('AUTH_REQUIRED', 'Actor is required', {}, 401);
      }

      const task = claimFloorTask(db, req.params.ref, {
        username: actor.username,
        id: actor.id,
        role: actor.role,
      });
      res.json({ ok: true, data: task });
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/floor-tasks/:ref/heartbeat
  router.post('/floor-tasks/:ref/heartbeat', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw new DomainError('AUTH_REQUIRED', 'Actor is required', {}, 401);
      }

      const result = heartbeatFloorTask(db, req.params.ref, { username: actor.username });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/floor-tasks/:ref/release
  router.post('/floor-tasks/:ref/release', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor;
      if (!actor) {
        throw new DomainError('AUTH_REQUIRED', 'Actor is required', {}, 401);
      }

      const result = releaseFloorTask(db, req.params.ref, {
        username: actor.username,
        id: actor.id,
        role: actor.role,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
