import Database from 'better-sqlite3';
import { AuditItemDto, AuditQueryInput, DashboardDto } from '@dark-storage/shared';
import { formatMovementLabel } from '../routes/inventory.js';

export function getDashboardMetrics(db: Database.Database): Omit<DashboardDto, 'engine'> {
  // 1. Receiving
  const receiptsTodayRow = db
    .prepare("SELECT COUNT(*) AS c FROM receipts WHERE strftime('%Y-%m-%d', received_at) = strftime('%Y-%m-%d', 'now')")
    .get() as { c: number };
  const unitsReceivedTodayRow = db
    .prepare(
      `
    SELECT COALESCE(SUM(rl.qty_received), 0) AS c
    FROM receipt_lines rl
    JOIN receipts r ON r.id = rl.receipt_id
    WHERE strftime('%Y-%m-%d', r.received_at) = strftime('%Y-%m-%d', 'now')
  `
    )
    .get() as { c: number };
  const stagedUnitsRow = db
    .prepare('SELECT COALESCE(SUM(qty_received - qty_put_away), 0) AS c FROM receipt_lines')
    .get() as { c: number };
  const stagedLinesRow = db
    .prepare('SELECT COUNT(*) AS c FROM receipt_lines WHERE qty_received - qty_put_away > 0')
    .get() as { c: number };

  // 2. Inventory
  const storedUnitsRow = db.prepare('SELECT COALESCE(SUM(qty), 0) AS c FROM inventory').get() as { c: number };
  const reservedUnitsRow = db.prepare('SELECT COALESCE(SUM(reserved_qty), 0) AS c FROM inventory').get() as { c: number };
  const availableUnitsRow = db.prepare('SELECT COALESCE(SUM(available_qty), 0) AS c FROM v_available_stock').get() as {
    c: number;
  };
  const storedUnits = storedUnitsRow.c;
  const reservedUnits = reservedUnitsRow.c;
  const availableUnits = availableUnitsRow.c;
  const unavailableUnits = Math.max(0, storedUnits - reservedUnits - availableUnits);

  const occupiedBinsRow = db.prepare('SELECT COUNT(*) AS c FROM inventory WHERE qty > 0').get() as { c: number };
  const totalBinsRow = db.prepare('SELECT COUNT(*) AS c FROM bins').get() as { c: number };
  const occupiedBins = occupiedBinsRow.c;
  const totalBins = totalBinsRow.c;
  const fillPct = totalBins > 0 ? Number(((occupiedBins / totalBins) * 100).toFixed(1)) : 0;

  // 3. Orders
  const ordersReservedRow = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'RESERVED'").get() as { c: number };
  const ordersAssignedRow = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'ASSIGNED'").get() as { c: number };
  const ordersPickingRow = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'PICKING'").get() as { c: number };
  const ordersPickedRow = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'PICKED'").get() as { c: number };
  const ordersCompletedTodayRow = db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'COMPLETED' AND strftime('%Y-%m-%d', completed_at) = strftime('%Y-%m-%d', 'now')")
    .get() as { c: number };
  const ordersCancelledTodayRow = db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'CANCELLED' AND strftime('%Y-%m-%d', updated_at) = strftime('%Y-%m-%d', 'now')")
    .get() as { c: number };
  const ordersCompletedTotalRow = db
    .prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'COMPLETED'")
    .get() as { c: number };

  // 4. Missions
  const missionsAssignedRow = db
    .prepare("SELECT COUNT(*) AS c FROM missions WHERE status = 'ASSIGNED'")
    .get() as { c: number };
  const missionsInProgressRow = db
    .prepare("SELECT COUNT(*) AS c FROM missions WHERE status = 'IN_PROGRESS'")
    .get() as { c: number };
  const missionsCompletedTodayRow = db
    .prepare("SELECT COUNT(*) AS c FROM missions WHERE status = 'COMPLETED' AND strftime('%Y-%m-%d', completed_at) = strftime('%Y-%m-%d', 'now')")
    .get() as { c: number };

  // 5. Exceptions
  const exceptionsOpenRow = db
    .prepare("SELECT COUNT(*) AS c FROM pick_exceptions WHERE status = 'OPEN'")
    .get() as { c: number };

  // 6. Movements
  const getMovCount = (type: string) => {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS c FROM stock_movements WHERE movement_type = ? AND strftime('%Y-%m-%d', created_at) = strftime('%Y-%m-%d', 'now')"
      )
      .get(type) as { c: number };
    return row.c;
  };

  const latestMovRows = db
    .prepare(
      `
    SELECT m.ref, m.movement_type AS type, m.sku, p.name AS product_name, m.qty,
           m.from_kind, m.from_ref, m.to_kind, m.to_ref, m.created_at
    FROM stock_movements m
    JOIN products p ON p.sku = m.sku COLLATE NOCASE
    ORDER BY m.id DESC LIMIT 10
  `
    )
    .all() as any[];

  const latest = latestMovRows.map((m) => ({
    ref: m.ref,
    type: m.type,
    sku: m.sku,
    product_name: m.product_name,
    qty: m.qty,
    from_label: formatMovementLabel(m.from_kind, m.from_ref),
    to_label: formatMovementLabel(m.to_kind, m.to_ref),
    created_at: m.created_at
  }));

  return {
    generated_at: new Date().toISOString(),
    receiving: {
      receipts_today: receiptsTodayRow.c,
      units_received_today: unitsReceivedTodayRow.c,
      staged_units: stagedUnitsRow.c,
      staged_lines: stagedLinesRow.c
    },
    inventory: {
      stored_units: storedUnits,
      reserved_units: reservedUnits,
      available_units: availableUnits,
      unavailable_units: unavailableUnits,
      occupied_bins: occupiedBins,
      total_bins: totalBins,
      fill_pct: fillPct
    },
    orders: {
      reserved: ordersReservedRow.c,
      assigned: ordersAssignedRow.c,
      picking: ordersPickingRow.c,
      picked: ordersPickedRow.c,
      completed_today: ordersCompletedTodayRow.c,
      cancelled_today: ordersCancelledTodayRow.c,
      completed_total: ordersCompletedTotalRow.c
    },
    missions: {
      assigned: missionsAssignedRow.c,
      in_progress: missionsInProgressRow.c,
      completed_today: missionsCompletedTodayRow.c
    },
    exceptions: {
      open: exceptionsOpenRow.c
    },
    movements: {
      today: {
        RECEIVE: getMovCount('RECEIVE'),
        PUTAWAY: getMovCount('PUTAWAY'),
        PICK: getMovCount('PICK'),
        RELOCATE: getMovCount('RELOCATE'),
        ADJUSTMENT: getMovCount('ADJUSTMENT')
      },
      latest
    }
  };
}

export function getAuditLogs(
  db: Database.Database,
  query: AuditQueryInput
): { items: AuditItemDto[]; total: number; page: number; page_size: number } {
  const whereClauses: string[] = ['1=1'];
  const params: any[] = [];

  if (query.entity_type) {
    whereClauses.push('a.entity_type = ?');
    params.push(query.entity_type);
  }
  if (query.entity_id) {
    whereClauses.push('a.entity_id = ?');
    params.push(query.entity_id);
  }
  if (query.action) {
    whereClauses.push('a.action = ?');
    params.push(query.action);
  }
  if (query.actor) {
    whereClauses.push('(u.username = ? OR u.display_name = ?)');
    params.push(query.actor, query.actor);
  }

  const whereSql = whereClauses.join(' AND ');

  const countRow = db.prepare(`SELECT COUNT(*) AS c FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id WHERE ${whereSql}`).get(...params) as { c: number };
  const total = countRow.c;

  const page = query.page ?? 1;
  const pageSize = query.page_size ?? 25;
  const offset = (page - 1) * pageSize;

  const rows = db
    .prepare(
      `
    SELECT
      a.id,
      a.occurred_at AS at,
      COALESCE(u.display_name, 'System') AS actor,
      COALESCE(u.role, a.actor_role, 'SYSTEM') AS role,
      a.action,
      a.entity_type,
      a.entity_id,
      a.details_json
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE ${whereSql}
    ORDER BY a.id DESC
    LIMIT ? OFFSET ?
  `
    )
    .all(...params, pageSize, offset) as any[];

  const items: AuditItemDto[] = rows.map((r) => ({
    id: r.id,
    at: r.at,
    actor: r.actor,
    role: r.role,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    details: r.details_json ? JSON.parse(r.details_json) : null
  }));

  return { items, total, page, page_size: pageSize };
}
