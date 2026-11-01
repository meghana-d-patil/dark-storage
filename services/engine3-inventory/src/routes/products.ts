import { Router } from 'express';
import Database from 'better-sqlite3';
import { DomainError, paginationQuerySchema } from '@dark-storage/shared';

export function createProductsRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/internal/v1/products', (req, res, next) => {
    try {
      const { page, page_size, search } = paginationQuerySchema.parse(req.query);

      let whereClause = 'WHERE active = 1';
      const params: unknown[] = [];

      if (search && search.trim().length > 0) {
        whereClause += ' AND (sku LIKE ? OR name LIKE ?)';
        const term = `%${search.trim()}%`;
        params.push(term, term);
      }

      const countRow = db.prepare(`SELECT COUNT(*) as total FROM products ${whereClause}`).get(...params) as { total: number };
      const total = countRow.total;

      const offset = (page - 1) * page_size;
      const items = db.prepare(`
        SELECT sku, name, category, storage_class, unit, max_receive_qty, active, created_at
        FROM products
        ${whereClause}
        ORDER BY sku ASC
        LIMIT ? OFFSET ?
      `).all(...params, page_size, offset);

      res.json({
        items,
        page,
        page_size,
        total
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/internal/v1/products/:sku', (req, res, next) => {
    try {
      const sku = req.params.sku;
      const product = db.prepare(`
        SELECT sku, name, category, storage_class, unit, max_receive_qty, active, created_at
        FROM products
        WHERE sku = ? COLLATE NOCASE
      `).get(sku);

      if (!product) {
        throw new DomainError('NOT_FOUND', `Product not found for SKU: ${sku}`);
      }

      res.json(product);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
