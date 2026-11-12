import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';

export function createLedgerRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/ledger
  router.get('/ledger', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sku, location, orderRef, limit } = req.query as {
        sku?: string;
        location?: string;
        orderRef?: string;
        limit?: string;
      };

      const conditions: string[] = [];
      const params: any[] = [];

      if (sku) {
        conditions.push('UPPER(sku) = UPPER(?)');
        params.push(sku);
      }
      if (location) {
        conditions.push('(from_loc = ? OR to_loc = ?)');
        params.push(location, location);
      }
      if (orderRef) {
        conditions.push('order_ref = ?');
        params.push(orderRef);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const maxLimit = Math.min(Math.max(parseInt(limit || '50', 10) || 50, 1), 500);

      const rows = db
        .prepare(
          `
        SELECT id, entry_ref, ts, sku, lot_id, qty, from_loc, to_loc,
               entry_type, ref_type, ref_id, order_ref, actor_id, reason_code, note
        FROM ledger_entries
        ${whereClause}
        ORDER BY id DESC
        LIMIT ?
      `
        )
        .all(...params, maxLimit);

      res.json({
        ok: true,
        data: rows,
        count: rows.length,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/ledger/reconcile
  router.get('/ledger/reconcile', (_req: Request, res: Response, next: NextFunction) => {
    try {
      const mismatches = db
        .prepare(
          `
        WITH ledger_bins AS (
          SELECT
            substr(location_key, 5) AS bin_code,
            sku,
            SUM(qty) AS ledger_qty
          FROM location_balances
          WHERE location_key GLOB 'BIN:*'
          GROUP BY location_key, sku
          HAVING SUM(qty) <> 0
        ),
        inv_bins AS (
          SELECT
            bin_code,
            sku,
            qty AS proj_qty
          FROM inventory
          WHERE qty > 0 AND sku IS NOT NULL
        ),
        all_keys AS (
          SELECT bin_code, sku FROM ledger_bins
          UNION
          SELECT bin_code, sku FROM inv_bins
        )
        SELECT
          k.bin_code AS binCode,
          k.sku,
          COALESCE(i.proj_qty, 0) AS projectionQty,
          COALESCE(l.ledger_qty, 0) AS ledgerQty
        FROM all_keys k
        LEFT JOIN inv_bins i ON i.bin_code = k.bin_code AND i.sku = k.sku
        LEFT JOIN ledger_bins l ON l.bin_code = k.bin_code AND l.sku = k.sku
        WHERE COALESCE(i.proj_qty, 0) <> COALESCE(l.ledger_qty, 0)
      `
        )
        .all() as Array<{
        binCode: string;
        sku: string;
        projectionQty: number;
        ledgerQty: number;
      }>;

      res.json({
        ok: mismatches.length === 0,
        mismatches,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
