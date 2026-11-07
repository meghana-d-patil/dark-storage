import { Router } from 'express';
import Database from 'better-sqlite3';
import { runIntegrityChecks } from '../domain/integrity.js';

export function createIntegrityRouter(db: Database.Database): Router {
  const router = Router();

  const handleIntegrity = (req: any, res: any, next: any) => {
    try {
      const report = runIntegrityChecks(db);
      res.json(report);
    } catch (err) {
      next(err);
    }
  };

  // Mount both paths
  router.get('/internal/v1/integrity', handleIntegrity);
  router.get('/internal/v1/admin/integrity', handleIntegrity);

  return router;
}
