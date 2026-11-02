import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { auditQuerySchema } from '@dark-storage/shared';
import { getDashboardMetrics, getAuditLogs } from '../domain/dashboardRepo.js';

export function createDashboardRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/dashboard
  router.get('/internal/v1/dashboard', (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = getDashboardMetrics(db);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/audit
  router.get('/internal/v1/audit', (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = auditQuerySchema.parse(req.query);
      const data = getAuditLogs(db, parsed);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
