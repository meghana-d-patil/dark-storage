import { Router } from 'express';
import Database from 'better-sqlite3';
import { runIntegrityChecks } from '../../../../scripts/verify-integrity.js';

export function createIntegrityRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/internal/v1/integrity', (req, res, next) => {
    try {
      const report = runIntegrityChecks(db);
      res.json(report);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
