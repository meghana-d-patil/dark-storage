import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import {
  InternalRecommendPlacementSchema,
  InternalValidatePlacementSchema,
  DomainError
} from '@dark-storage/shared';
import { recommendPlacement } from '../placement/recommend.js';
import { loadPlacementSnapshot } from '../placement/snapshot.js';
import { evaluateBin } from '../placement/filter.js';

export function createPlacementRouter(db: Database.Database): Router {
  const router = Router();

  // POST /internal/v1/placement/recommend
  router.post('/recommend', (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = InternalRecommendPlacementSchema.parse(req.body);
      const result = recommendPlacement(db, parsed);
      res.json(result);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('UNKNOWN_SKU')) {
        next(new DomainError('UNKNOWN_SKU', err.message));
        return;
      }
      next(err);
    }
  });

  // POST /internal/v1/placement/validate
  router.post('/validate', (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = InternalValidatePlacementSchema.parse(req.body);
      const snapshot = loadPlacementSnapshot(db, parsed.sku);
      const targetBin = snapshot.bins.find(b => b.bin_code === parsed.bin);

      if (!targetBin) {
        throw new DomainError('UNKNOWN_BIN', `Bin ${parsed.bin} not found`);
      }

      const evalResult = evaluateBin(targetBin, snapshot.product, parsed.qty, parsed.allow_partial);

      res.json({
        valid: evalResult.valid,
        reason: evalResult.valid ? undefined : evalResult.reason,
        free_capacity: evalResult.free_capacity,
        max_acceptable_qty: evalResult.max_acceptable_qty
      });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('UNKNOWN_SKU')) {
        next(new DomainError('UNKNOWN_SKU', err.message));
        return;
      }
      next(err);
    }
  });

  return router;
}
