import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import {
  BinStatusUpdateSchema,
  BinRecountSchema,
  InventorySummaryQuerySchema,
  InventoryBinsQuerySchema,
  InventoryMovementsQuerySchema,
  DomainError
} from '@dark-storage/shared';
import { runTx } from '../db/tx.js';
import { runIdempotent } from '../domain/idempotency.js';
import { applyRecount } from '../domain/inventoryRepo.js';
import { recordAudit } from '../domain/audit.js';
import { insertOutboxEvent } from '../domain/outbox.js';

export function createInventoryRouter(db: Database.Database): Router {
  const router = Router();

  // POST /internal/v1/inventory/bins/:code/status
  router.post('/bins/:code/status', (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = req.params.code;
      const parsed = BinStatusUpdateSchema.parse(req.body);
      const actorId = req.headers['x-actor-id'] ? Number(req.headers['x-actor-id']) : null;

      runTx(db, () => {
        const bin = db.prepare('SELECT code, status FROM bins WHERE code = ?').get(code) as {
          code: string;
          status: string;
        } | undefined;

        if (!bin) {
          throw new DomainError('UNKNOWN_BIN', `Bin ${code} not found`);
        }

        const inv = db.prepare('SELECT qty, reserved_qty FROM inventory WHERE bin_code = ?').get(code) as {
          qty: number;
          reserved_qty: number;
        } | undefined;

        if ((parsed.status === 'BLOCKED' || parsed.status === 'DAMAGED') && inv && inv.reserved_qty > 0) {
          throw new DomainError('BIN_HAS_RESERVATIONS', 'Cannot block or damage bin with active reservations', {
            reserved_qty: inv.reserved_qty
          });
        }

        const prevStatus = bin.status;
        db.prepare('UPDATE bins SET status = ? WHERE code = ?').run(parsed.status, code);

        recordAudit(db, {
          entity_type: 'BIN',
          entity_id: code,
          action: 'BIN_STATUS_CHANGED',
          before: { status: prevStatus },
          after: { status: parsed.status, reason: parsed.reason },
          actor_id: actorId
        });

        insertOutboxEvent(db, {
          event_type: 'bin.status_changed',
          entity_type: 'BIN',
          entity_id: code,
          data: { bin_code: code, status: parsed.status, reason: parsed.reason }
        });
      });

      res.status(200).json({ code, status: parsed.status, reason: parsed.reason });
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/inventory/bins/:code/recount
  router.post('/bins/:code/recount', (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = req.params.code;
      const parsed = BinRecountSchema.parse(req.body);
      const actorId = req.headers['x-actor-id'] ? Number(req.headers['x-actor-id']) : null;
      const actorRole = (req.headers['x-actor-role'] as string) || 'MANAGER';
      const idemKey = req.headers['x-idempotency-key'] as string | undefined;

      const execute = (d: Database.Database) => {
        const result = applyRecount(d, {
          bin_code: code,
          counted_qty: parsed.counted_qty,
          sku: parsed.sku,
          reason: parsed.reason,
          actorId
        });
        return { status: 200, body: result };
      };

      if (idemKey) {
        const result = runIdempotent(
          db,
          {
            key: idemKey,
            scope: `recount:${code}`,
            body: parsed,
            actor: actorId ? { id: actorId, role: actorRole } : null
          },
          execute
        );
        res.status(result.status).json(result.body);
      } else {
        const result = runTx(db, () => execute(db));
        res.status(result.status).json(result.body);
      }
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/inventory/summary
  router.get('/summary', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { search, page, limit } = InventorySummaryQuerySchema.parse(req.query);
      const offset = (page - 1) * limit;

      const hasReceiptLines = Boolean(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='receipt_lines'").get()
      );

      const stagedSubquery = hasReceiptLines
        ? `(SELECT COALESCE(SUM(rl.qty_received - rl.qty_put_away), 0) FROM receipt_lines rl WHERE UPPER(rl.sku) = UPPER(p.sku))`
        : `0`;

      const baseQuery = `
        FROM products p
        LEFT JOIN inventory i ON UPPER(i.sku) = UPPER(p.sku)
        LEFT JOIN v_available_stock v ON UPPER(v.sku) = UPPER(p.sku) AND v.bin_code = i.bin_code
        WHERE (? = '' OR UPPER(p.name) LIKE ? OR UPPER(p.sku) LIKE ?)
        GROUP BY p.sku
      `;

      const searchPattern = `%${search.toUpperCase()}%`;

      const countRow = db.prepare(`
        SELECT COUNT(DISTINCT p.sku) as total
        FROM products p
        WHERE (? = '' OR UPPER(p.name) LIKE ? OR UPPER(p.sku) LIKE ?)
      `).get(search, searchPattern, searchPattern) as { total: number };

      const rows = db.prepare(`
        SELECT
          p.sku,
          p.name as product_name,
          p.category,
          COALESCE(SUM(i.qty), 0) as stored_qty,
          COALESCE(SUM(i.reserved_qty), 0) as reserved_qty,
          COALESCE(SUM(v.available_qty), 0) as available_to_promise,
          COUNT(DISTINCT CASE WHEN i.qty > 0 THEN i.bin_code END) as bins_used,
          ${stagedSubquery} as staged_qty
        ${baseQuery}
        ORDER BY p.sku ASC
        LIMIT ? OFFSET ?
      `).all(search, searchPattern, searchPattern, limit, offset) as Array<{
        sku: string;
        product_name: string;
        category: string;
        stored_qty: number;
        reserved_qty: number;
        available_to_promise: number;
        bins_used: number;
        staged_qty: number;
      }>;

      const items = rows.map(r => ({
        sku: r.sku,
        product_name: r.product_name,
        category: r.category,
        stored_qty: r.stored_qty,
        reserved_qty: r.reserved_qty,
        available_to_promise: r.available_to_promise,
        unavailable_qty: Math.max(0, r.stored_qty - r.reserved_qty - r.available_to_promise),
        staged_qty: r.staged_qty,
        bins_used: r.bins_used
      }));

      res.json({
        items,
        page,
        limit,
        total: countRow.total
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/inventory/bins
  router.get('/bins', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sku, shelf, status, occupied, page, limit } = InventoryBinsQuerySchema.parse(req.query);
      const offset = (page - 1) * limit;

      let whereClause = '1=1';
      const params: unknown[] = [];

      if (sku) {
        whereClause += ' AND (UPPER(i.sku) LIKE ? OR UPPER(p.name) LIKE ?)';
        params.push(`%${sku.toUpperCase()}%`, `%${sku.toUpperCase()}%`);
      }
      if (shelf) {
        whereClause += ' AND UPPER(b.shelf_code) = ?';
        params.push(shelf.toUpperCase());
      }
      if (status) {
        whereClause += ' AND b.status = ?';
        params.push(status);
      }
      if (occupied === 'true') {
        whereClause += ' AND i.qty > 0';
      } else if (occupied === 'false') {
        whereClause += ' AND (i.qty IS NULL OR i.qty = 0)';
      }

      const countSql = `
        SELECT COUNT(*) as total
        FROM bins b
        LEFT JOIN inventory i ON i.bin_code = b.code
        LEFT JOIN products p ON p.sku = i.sku
        WHERE ${whereClause}
      `;
      const countRow = db.prepare(countSql).get(...params) as { total: number };

      const selectSql = `
        SELECT
          b.code as bin_code,
          b.shelf_code,
          b.level,
          b.capacity,
          b.status,
          b.recount_required,
          i.sku,
          p.name as product_name,
          COALESCE(i.qty, 0) as qty,
          COALESCE(i.reserved_qty, 0) as reserved_qty,
          CASE
            WHEN b.status = 'ACTIVE' AND s.status = 'ACTIVE' AND b.recount_required = 0
            THEN MAX(0, COALESCE(i.qty, 0) - COALESCE(i.reserved_qty, 0))
            ELSE 0
          END as available_qty
        FROM bins b
        JOIN shelves s ON s.code = b.shelf_code
        LEFT JOIN inventory i ON i.bin_code = b.code
        LEFT JOIN products p ON p.sku = i.sku
        WHERE ${whereClause}
        ORDER BY b.code ASC
        LIMIT ? OFFSET ?
      `;

      const rows = db.prepare(selectSql).all(...params, limit, offset) as Array<{
        bin_code: string;
        shelf_code: string;
        level: number;
        capacity: number;
        status: string;
        recount_required: number;
        sku: string | null;
        product_name: string | null;
        qty: number;
        reserved_qty: number;
        available_qty: number;
      }>;

      const items = rows.map(r => ({
        bin_code: r.bin_code,
        shelf_code: r.shelf_code,
        level: r.level,
        capacity: r.capacity,
        status: r.status,
        recount_required: Boolean(r.recount_required),
        sku: r.sku,
        product_name: r.product_name,
        qty: r.qty,
        reserved_qty: r.reserved_qty,
        available_qty: r.available_qty,
        free_capacity: Math.max(0, r.capacity - r.qty)
      }));

      res.json({
        items,
        page,
        limit,
        total: countRow.total
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/inventory/bins/:code
  router.get('/bins/:code', (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = req.params.code;

      const bin = db.prepare(`
        SELECT
          b.code as bin_code,
          b.shelf_code,
          b.level,
          b.capacity,
          b.status,
          b.recount_required,
          s.storage_class,
          s.status as shelf_status,
          i.sku,
          p.name as product_name,
          COALESCE(i.qty, 0) as qty,
          COALESCE(i.reserved_qty, 0) as reserved_qty,
          CASE
            WHEN b.status = 'ACTIVE' AND s.status = 'ACTIVE' AND b.recount_required = 0
            THEN MAX(0, COALESCE(i.qty, 0) - COALESCE(i.reserved_qty, 0))
            ELSE 0
          END as available_qty
        FROM bins b
        JOIN shelves s ON s.code = b.shelf_code
        LEFT JOIN inventory i ON i.bin_code = b.code
        LEFT JOIN products p ON p.sku = i.sku
        WHERE b.code = ?
      `).get(code) as {
        bin_code: string;
        shelf_code: string;
        level: number;
        capacity: number;
        status: string;
        recount_required: number;
        storage_class: string;
        shelf_status: string;
        sku: string | null;
        product_name: string | null;
        qty: number;
        reserved_qty: number;
        available_qty: number;
      } | undefined;

      if (!bin) {
        throw new DomainError('UNKNOWN_BIN', `Bin ${code} not found`);
      }

      // Recent 10 movements involving this bin
      const recentMovementsRaw = db.prepare(`
        SELECT
          m.ref,
          m.movement_type,
          m.sku,
          p.name as product_name,
          m.qty,
          m.from_kind,
          m.from_ref,
          m.to_kind,
          m.to_ref,
          m.related_type,
          m.related_ref,
          u.display_name as performed_by_name,
          m.created_at
        FROM stock_movements m
        JOIN products p ON p.sku = m.sku
        LEFT JOIN users u ON u.id = m.performed_by
        WHERE (m.from_kind = 'BIN' AND m.from_ref = ?)
           OR (m.to_kind = 'BIN' AND m.to_ref = ?)
        ORDER BY m.id DESC
        LIMIT 10
      `).all(code, code) as Array<{
        ref: string;
        movement_type: string;
        sku: string;
        product_name: string;
        qty: number;
        from_kind: string;
        from_ref: string | null;
        to_kind: string;
        to_ref: string | null;
        related_type: string | null;
        related_ref: string | null;
        performed_by_name: string | null;
        created_at: string;
      }>;

      const recent_movements = recentMovementsRaw.map(m => ({
        ref: m.ref,
        type: m.movement_type,
        sku: m.sku,
        product_name: m.product_name,
        qty: m.qty,
        from_label: formatMovementLabel(m.from_kind, m.from_ref),
        to_label: formatMovementLabel(m.to_kind, m.to_ref),
        related_ref: m.related_ref,
        performed_by_name: m.performed_by_name,
        created_at: m.created_at
      }));

      // Held reservations (from reservations when table exists)
      const hasOrderRes = Boolean(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reservations'").get()
      );

      let held_reservations: Array<{ id: number; order_ref: string; qty: number }> = [];
      if (hasOrderRes) {
        held_reservations = db.prepare(`
          SELECT r.id, o.ref as order_ref, (r.qty - r.consumed_qty - r.released_qty) as qty
          FROM reservations r
          JOIN orders o ON o.id = r.order_id
          WHERE r.bin_code = ? AND r.status = 'HELD'
        `).all(code) as Array<{ id: number; order_ref: string; qty: number }>;
      }

      res.json({
        ...bin,
        recount_required: Boolean(bin.recount_required),
        free_capacity: Math.max(0, bin.capacity - bin.qty),
        recent_movements,
        held_reservations
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/inventory/movements
  router.get('/movements', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sku, bin, type, page, limit } = InventoryMovementsQuerySchema.parse(req.query);
      const offset = (page - 1) * limit;

      let whereClause = '1=1';
      const params: unknown[] = [];

      if (sku) {
        whereClause += ' AND (UPPER(m.sku) LIKE ? OR UPPER(p.name) LIKE ?)';
        params.push(`%${sku.toUpperCase()}%`, `%${sku.toUpperCase()}%`);
      }
      if (bin) {
        whereClause += " AND ((m.from_kind = 'BIN' AND UPPER(m.from_ref) = ?) OR (m.to_kind = 'BIN' AND UPPER(m.to_ref) = ?))";
        params.push(bin.toUpperCase(), bin.toUpperCase());
      }
      if (type) {
        whereClause += ' AND m.movement_type = ?';
        params.push(type.toUpperCase());
      }

      const countRow = db.prepare(`
        SELECT COUNT(*) as total
        FROM stock_movements m
        JOIN products p ON p.sku = m.sku
        WHERE ${whereClause}
      `).get(...params) as { total: number };

      const rows = db.prepare(`
        SELECT
          m.ref,
          m.movement_type,
          m.sku,
          p.name as product_name,
          m.qty,
          m.from_kind,
          m.from_ref,
          m.to_kind,
          m.to_ref,
          m.related_type,
          m.related_ref,
          u.display_name as performed_by_name,
          m.created_at
        FROM stock_movements m
        JOIN products p ON p.sku = m.sku
        LEFT JOIN users u ON u.id = m.performed_by
        WHERE ${whereClause}
        ORDER BY m.id DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as Array<{
        ref: string;
        movement_type: string;
        sku: string;
        product_name: string;
        qty: number;
        from_kind: string;
        from_ref: string | null;
        to_kind: string;
        to_ref: string | null;
        related_type: string | null;
        related_ref: string | null;
        performed_by_name: string | null;
        created_at: string;
      }>;

      const items = rows.map(m => ({
        ref: m.ref,
        type: m.movement_type,
        sku: m.sku,
        product_name: m.product_name,
        qty: m.qty,
        from_label: formatMovementLabel(m.from_kind, m.from_ref),
        to_label: formatMovementLabel(m.to_kind, m.to_ref),
        related_ref: m.related_ref,
        performed_by_name: m.performed_by_name,
        created_at: m.created_at
      }));

      res.json({
        items,
        page,
        limit,
        total: countRow.total
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function formatMovementLabel(kind: string, ref: string | null): string {
  switch (kind) {
    case 'EXTERNAL':
      return 'External Receiving';
    case 'STAGING':
      return ref ? `Receiving (${ref})` : 'Staging Area';
    case 'BIN':
      return ref ? `Bin ${ref}` : 'Bin';
    case 'ORDER_PACKING':
      return ref ? `Order ${ref} (packing)` : 'Order Packing';
    case 'ADJUSTMENT':
      return ref ? `Adjustment (${ref})` : 'Adjustment';
    default:
      return ref ? `${kind} (${ref})` : kind;
  }
}
