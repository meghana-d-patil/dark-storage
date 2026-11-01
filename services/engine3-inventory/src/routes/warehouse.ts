import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { WarehouseSearchQuerySchema } from '@dark-storage/shared';

export function createWarehouseRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/warehouse/layout
  router.get('/layout', (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = db.prepare(`
        SELECT
          s.aisle,
          s.code as shelf_code,
          s.bay,
          s.side,
          s.status as shelf_status,
          s.storage_class,
          s.x,
          s.y,
          b.code as bin_code,
          b.level,
          b.capacity,
          b.status as bin_status,
          b.recount_required,
          i.sku,
          p.name as product_name,
          COALESCE(i.qty, 0) as qty,
          COALESCE(i.reserved_qty, 0) as reserved_qty
        FROM shelves s
        JOIN bins b ON b.shelf_code = s.code
        LEFT JOIN inventory i ON i.bin_code = b.code
        LEFT JOIN products p ON p.sku = i.sku
        ORDER BY s.aisle ASC, s.bay ASC, s.side ASC, b.level ASC
      `).all() as Array<{
        aisle: string;
        shelf_code: string;
        bay: number;
        side: string;
        shelf_status: string;
        storage_class: string;
        x: number;
        y: number;
        bin_code: string;
        level: number;
        capacity: number;
        bin_status: string;
        recount_required: number;
        sku: string | null;
        product_name: string | null;
        qty: number;
        reserved_qty: number;
      }>;

      // Group into aisles -> shelves -> bins
      const aisleMap = new Map<string, Map<string, {
        code: string;
        bay: number;
        side: string;
        status: string;
        storage_class: string;
        x: number;
        y: number;
        bins: Array<{
          code: string;
          level: number;
          capacity: number;
          status: string;
          recount_required: boolean;
          sku: string | null;
          product_name: string | null;
          qty: number;
          reserved_qty: number;
        }>;
      }>>();

      for (const row of rows) {
        if (!aisleMap.has(row.aisle)) {
          aisleMap.set(row.aisle, new Map());
        }
        const shelfMap = aisleMap.get(row.aisle)!;
        if (!shelfMap.has(row.shelf_code)) {
          shelfMap.set(row.shelf_code, {
            code: row.shelf_code,
            bay: row.bay,
            side: row.side,
            status: row.shelf_status,
            storage_class: row.storage_class,
            x: row.x,
            y: row.y,
            bins: []
          });
        }

        shelfMap.get(row.shelf_code)!.bins.push({
          code: row.bin_code,
          level: row.level,
          capacity: row.capacity,
          status: row.bin_status,
          recount_required: Boolean(row.recount_required),
          sku: row.sku,
          product_name: row.product_name,
          qty: row.qty,
          reserved_qty: row.reserved_qty
        });
      }

      const aisles = Array.from(aisleMap.entries()).map(([aisle, shelvesMap]) => ({
        aisle,
        shelves: Array.from(shelvesMap.values())
      }));

      res.json({ aisles });
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/warehouse/search?q=
  router.get('/search', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { q } = WarehouseSearchQuerySchema.parse(req.query);
      const queryPattern = `%${q.toUpperCase()}%`;

      // Check if q matches any product
      const productMatches = db.prepare(`
        SELECT sku FROM products
        WHERE UPPER(sku) LIKE ? OR UPPER(name) LIKE ?
      `).all(queryPattern, queryPattern) as { sku: string }[];

      let sql = `
        SELECT
          b.code as bin_code,
          b.shelf_code,
          i.sku,
          p.name as product_name,
          COALESCE(i.qty, 0) as qty,
          COALESCE(i.reserved_qty, 0) as reserved_qty
        FROM bins b
        LEFT JOIN inventory i ON i.bin_code = b.code
        LEFT JOIN products p ON p.sku = i.sku
      `;

      let rows: Array<{
        bin_code: string;
        shelf_code: string;
        sku: string | null;
        product_name: string | null;
        qty: number;
        reserved_qty: number;
      }>;

      if (productMatches.length > 0) {
        // Product match -> return only bins with stock for that product OR matching bin/shelf
        sql += `
          WHERE (
            (i.qty > 0 AND (UPPER(i.sku) LIKE ? OR UPPER(p.name) LIKE ?))
            OR UPPER(b.code) LIKE ?
            OR UPPER(b.shelf_code) LIKE ?
          )
          ORDER BY b.code ASC
          LIMIT 50
        `;
        rows = db.prepare(sql).all(queryPattern, queryPattern, queryPattern, queryPattern) as typeof rows;
      } else {
        // Bin or shelf search
        sql += `
          WHERE (UPPER(b.code) LIKE ? OR UPPER(b.shelf_code) LIKE ?)
          ORDER BY b.code ASC
          LIMIT 50
        `;
        rows = db.prepare(sql).all(queryPattern, queryPattern) as typeof rows;
      }

      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
