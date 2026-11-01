import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { planRoute } from '../routing/planRoute.js';

export function createRoutingRouter(db: Database.Database): Router {
  const router = Router();

  // POST /internal/v1/routes/plan
  router.post('/plan', (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = planRoute(db, req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
