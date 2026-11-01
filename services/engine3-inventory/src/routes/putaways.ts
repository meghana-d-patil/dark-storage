import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { shelfOfBin } from '@dark-storage/shared';

export function createPutawaysRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const receipt = req.query.receipt as string | undefined;
      const sku = req.query.sku as string | undefined;
      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
      const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '50', 10)));
      const offset = (page - 1) * limit;

      let query = `
        SELECT p.id, p.ref, p.receipt_line_id, p.sku, p.qty, p.dest_bin,
               p.selection_mode, p.recommended_bin, p.movement_ref, p.created_at,
               r.ref AS receipt_ref, r.status AS receipt_status,
               pr.name AS product_name,
               u.display_name AS performed_by
        FROM putaways p
        JOIN receipt_lines l ON p.receipt_line_id = l.id
        JOIN receipts r ON l.receipt_id = r.id
        JOIN products pr ON p.sku = pr.sku
        JOIN users u ON p.performed_by = u.id
        WHERE 1=1
      `;
      const params: unknown[] = [];

      if (receipt) {
        query += ' AND (r.ref = ? OR r.id = ?)';
        params.push(receipt, isNaN(Number(receipt)) ? -1 : Number(receipt));
      }
      if (sku) {
        query += ' AND UPPER(p.sku) = UPPER(?)';
        params.push(sku);
      }

      query += ' ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = db.prepare(query).all(...params) as Array<{
        id: number;
        ref: string;
        receipt_line_id: number;
        sku: string;
        qty: number;
        dest_bin: string;
        selection_mode: 'RECOMMENDED' | 'MANUAL';
        recommended_bin: string | null;
        movement_ref: string;
        created_at: string;
        receipt_ref: string;
        receipt_status: string;
        product_name: string;
        performed_by: string;
      }>;

      const formatted = rows.map((r) => ({
        id: r.id,
        ref: r.ref,
        receipt_ref: r.receipt_ref,
        receipt_line_id: r.receipt_line_id,
        sku: r.sku,
        product_name: r.product_name,
        qty: r.qty,
        source: `Receiving staging (${r.receipt_ref})`,
        dest_shelf: shelfOfBin(r.dest_bin),
        dest_bin: r.dest_bin,
        selection_mode: r.selection_mode,
        recommended_bin: r.recommended_bin,
        movement_ref: r.movement_ref,
        performed_by: r.performed_by,
        status: 'COMPLETED',
        created_at: r.created_at,
        receipt_status: r.receipt_status
      }));

      res.json({
        putaways: formatted,
        page,
        limit
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
