import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { CreateReceiptSchema, ReceiptsQuerySchema, DomainError } from '@dark-storage/shared';
import { runIdempotent } from '../domain/idempotency.js';
import { createReceipt } from '../domain/receivingRepo.js';

export function createReceiptsRouter(db: Database.Database): Router {
  const router = Router();

  // POST /internal/v1/receipts
  router.post('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreateReceiptSchema.parse(req.body);
      const idemKey = (req.headers['x-idempotency-key'] as string) || (req.headers['idempotency-key'] as string);

      if (!idemKey) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const actorId = req.headers['x-actor-id'] ? Number(req.headers['x-actor-id']) : 1;
      const actorRole = (req.headers['x-actor-role'] as string) || 'OPERATOR';

      const userRow = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(actorId) as {
        id: number;
        display_name: string;
      } | undefined;

      const actorName = userRow ? userRow.display_name : 'System';

      const result = runIdempotent(
        db,
        {
          key: idemKey,
          scope: 'receipt:create',
          body: parsed,
          actor: { id: actorId, role: actorRole }
        },
        (txDb) => {
          const detail = createReceipt(txDb, {
            ...parsed,
            actor: { id: actorId, name: actorName, role: actorRole }
          });
          return { status: 201, body: detail };
        }
      );

      if (result.replay) {
        res.setHeader('Idempotent-Replay', 'true');
      }

      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/receipts/staged (MUST be registered before /:ref)
  router.get('/staged', (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = db.prepare(`
        SELECT
          rl.id as line_id,
          r.ref as receipt_ref,
          rl.sku,
          p.name as product_name,
          p.category,
          p.storage_class,
          rl.qty_received,
          rl.qty_put_away,
          (rl.qty_received - rl.qty_put_away) as qty_staged,
          r.received_at
        FROM receipt_lines rl
        JOIN receipts r ON r.id = rl.receipt_id
        JOIN products p ON p.sku = rl.sku
        WHERE (rl.qty_received - rl.qty_put_away) > 0
        ORDER BY r.received_at ASC, rl.id ASC
      `).all() as Array<{
        line_id: number;
        receipt_ref: string;
        sku: string;
        product_name: string;
        category: string;
        storage_class: string;
        qty_received: number;
        qty_put_away: number;
        qty_staged: number;
        received_at: string;
      }>;

      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/receipts/lines/:id
  router.get('/lines/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const lineId = Number(req.params.id);
      const row = db.prepare(`
        SELECT
          rl.id as line_id,
          rl.line_no,
          r.ref as receipt_ref,
          rl.sku,
          p.name as product_name,
          p.category,
          p.storage_class,
          rl.qty_received,
          rl.qty_put_away,
          (rl.qty_received - rl.qty_put_away) as qty_staged,
          rl.movement_ref,
          r.received_at
        FROM receipt_lines rl
        JOIN receipts r ON r.id = rl.receipt_id
        JOIN products p ON p.sku = rl.sku
        WHERE rl.id = ?
      `).get(lineId);

      if (!row) {
        throw new DomainError('NOT_FOUND', `Receipt line ${lineId} not found`);
      }

      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/receipts
  router.get('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, search, page, limit } = ReceiptsQuerySchema.parse(req.query);
      const offset = (page - 1) * limit;

      let whereClause = '1=1';
      const params: unknown[] = [];

      if (status) {
        whereClause += ' AND r.status = ?';
        params.push(status);
      }

      if (search) {
        whereClause += ` AND (
          UPPER(r.ref) LIKE ?
          OR UPPER(COALESCE(r.supplier, '')) LIKE ?
          OR UPPER(COALESCE(r.reference_no, '')) LIKE ?
          OR EXISTS (
            SELECT 1 FROM receipt_lines rl
            JOIN products p ON p.sku = rl.sku
            WHERE rl.receipt_id = r.id AND (UPPER(rl.sku) LIKE ? OR UPPER(p.name) LIKE ?)
          )
        )`;
        const searchPat = `%${search.toUpperCase()}%`;
        params.push(searchPat, searchPat, searchPat, searchPat, searchPat);
      }

      const countSql = `SELECT COUNT(*) as total FROM receipts r WHERE ${whereClause}`;
      const countRow = db.prepare(countSql).get(...params) as { total: number };

      const selectSql = `
        SELECT
          r.id,
          r.ref,
          r.status,
          r.supplier,
          r.reference_no,
          r.notes,
          r.received_at,
          r.created_at,
          u.display_name as received_by_name,
          (SELECT COUNT(*) FROM receipt_lines rl WHERE rl.receipt_id = r.id) as line_count,
          (SELECT COALESCE(SUM(rl.qty_received), 0) FROM receipt_lines rl WHERE rl.receipt_id = r.id) as total_units
        FROM receipts r
        JOIN users u ON u.id = r.received_by
        WHERE ${whereClause}
        ORDER BY r.id DESC
        LIMIT ? OFFSET ?
      `;

      const rows = db.prepare(selectSql).all(...params, limit, offset) as Array<{
        id: number;
        ref: string;
        status: string;
        supplier: string | null;
        reference_no: string | null;
        notes: string | null;
        received_at: string;
        created_at: string;
        received_by_name: string;
        line_count: number;
        total_units: number;
      }>;

      res.json({
        items: rows,
        page,
        limit,
        total: countRow.total
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/receipts/:ref
  router.get('/:ref', (req: Request, res: Response, next: NextFunction) => {
    try {
      const ref = req.params.ref;

      const receipt = db.prepare(`
        SELECT
          r.id,
          r.ref,
          r.status,
          r.supplier,
          r.reference_no,
          r.notes,
          r.received_at,
          r.created_at,
          r.received_by,
          u.display_name as received_by_name
        FROM receipts r
        JOIN users u ON u.id = r.received_by
        WHERE r.ref = ?
      `).get(ref) as {
        id: number;
        ref: string;
        status: string;
        supplier: string | null;
        reference_no: string | null;
        notes: string | null;
        received_at: string;
        created_at: string;
        received_by: number;
        received_by_name: string;
      } | undefined;

      if (!receipt) {
        throw new DomainError('NOT_FOUND', `Receipt ${ref} not found`);
      }

      const lines = db.prepare(`
        SELECT
          rl.id as line_id,
          rl.line_no,
          rl.sku,
          p.name as product_name,
          p.category,
          p.storage_class,
          rl.qty_received,
          rl.qty_put_away,
          (rl.qty_received - rl.qty_put_away) as qty_staged,
          rl.movement_ref
        FROM receipt_lines rl
        JOIN products p ON p.sku = rl.sku
        WHERE rl.receipt_id = ?
        ORDER BY rl.line_no ASC
      `).all(receipt.id);

      const auditEntries = db.prepare(`
        SELECT
          a.id,
          a.occurred_at,
          a.action,
          a.details_json,
          u.display_name as actor_name
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.entity_type = 'RECEIPT' AND a.entity_id = ?
        ORDER BY a.id ASC
      `).all(ref);

      res.json({
        ref: receipt.ref,
        status: receipt.status,
        supplier: receipt.supplier,
        reference_no: receipt.reference_no,
        notes: receipt.notes,
        received_at: receipt.received_at,
        received_by: {
          id: receipt.received_by,
          name: receipt.received_by_name
        },
        lines,
        audit_log: auditEntries
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
