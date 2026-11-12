import Database from 'better-sqlite3';
import { DomainError, PackingQueueItemDto, PackingResultDto } from '@dark-storage/shared';
import { nextRef } from './ids.js';
import { audit } from './audit.js';
import { appendOrderEvent } from '../audit/appendAudit.js';
import { emit } from './outbox.js';

export function getPackingQueue(db: Database.Database): { items: PackingQueueItemDto[] } {
  const orders = db
    .prepare(
      `
    SELECT id, ref, customer_ref, priority
    FROM orders
    WHERE status = 'PICKED'
    ORDER BY priority = 'URGENT' DESC, priority = 'HIGH' DESC, priority = 'NORMAL' DESC, id ASC
  `
    )
    .all() as Array<{ id: number; ref: string; customer_ref: string | null; priority: string }>;

  const items: PackingQueueItemDto[] = [];

  for (const o of orders) {
    // Latest mission
    const mission = db
      .prepare('SELECT ref FROM missions WHERE order_id = ? ORDER BY id DESC LIMIT 1')
      .get(o.id) as { ref: string } | undefined;

    // Lines
    const lines = db
      .prepare(
        `
      SELECT
        ol.sku,
        p.name AS product_name,
        ol.qty_ordered,
        ol.qty_picked,
        ol.qty_short
      FROM order_lines ol
      JOIN products p ON p.sku = ol.sku COLLATE NOCASE
      WHERE ol.order_id = ?
      ORDER BY ol.line_no ASC
    `
      )
      .all(o.id) as Array<{
      sku: string;
      product_name: string;
      qty_ordered: number;
      qty_picked: number;
      qty_short: number;
    }>;

    const totalOrdered = lines.reduce((acc, l) => acc + l.qty_ordered, 0);
    const totalPicked = lines.reduce((acc, l) => acc + l.qty_picked, 0);
    const totalShort = lines.reduce((acc, l) => acc + l.qty_short, 0);
    const fulfilmentPreview: 'FULL' | 'PARTIAL' = totalShort > 0 ? 'PARTIAL' : 'FULL';
    const needsManagerApproval = totalShort > 0;

    // Exceptions
    const exceptions = db
      .prepare(
        `
      SELECT ref, exception_type AS type, resolution, notes
      FROM pick_exceptions
      WHERE order_id = ?
      ORDER BY id ASC
    `
      )
      .all(o.id) as Array<{
      ref: string;
      type: string;
      resolution: string | null;
      notes: string | null;
    }>;

    items.push({
      order_ref: o.ref,
      customer_ref: o.customer_ref,
      priority: o.priority,
      mission_ref: mission?.ref || null,
      lines,
      total_ordered: totalOrdered,
      total_picked: totalPicked,
      total_short: totalShort,
      fulfilment_preview: fulfilmentPreview,
      needs_manager_approval: needsManagerApproval,
      exceptions
    });
  }

  return { items };
}

export function executePackOrder(
  db: Database.Database,
  params: {
    order_ref: string;
    notes?: string | null;
    accept_partial?: boolean;
    actor: { id: number; role: string; display_name?: string };
  }
): PackingResultDto {
  // 1. order.status == PICKED -> else ORDER_STATE_INVALID {status}
  const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(params.order_ref) as any;
  if (!order) {
    throw new DomainError('NOT_FOUND', `Order ${params.order_ref} not found`);
  }

  if (order.status !== 'PICKED') {
    throw new DomainError('ORDER_STATE_INVALID', `Order ${params.order_ref} is in status ${order.status}, expected PICKED`, {
      status: order.status
    });
  }

  // 2. latest mission of the order is COMPLETED -> else PACK_INCOMPLETE
  const mission = db.prepare('SELECT * FROM missions WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(order.id) as any;
  if (!mission || mission.status !== 'COMPLETED') {
    throw new DomainError('PACK_INCOMPLETE', 'Latest mission of the order is not COMPLETED', {
      mission_status: mission?.status
    });
  }

  // 3. no stop PENDING/EXCEPTION_OPEN, no OPEN exception for the order -> else PACK_INCOMPLETE
  const openStops = db
    .prepare("SELECT COUNT(*) AS c FROM pick_stops WHERE mission_id = ? AND status IN ('PENDING', 'EXCEPTION_OPEN')")
    .get(mission.id) as { c: number };
  if (openStops.c > 0) {
    throw new DomainError('PACK_INCOMPLETE', 'Order has pending or exception-open pick stops');
  }

  const openExcs = db
    .prepare("SELECT COUNT(*) AS c FROM pick_exceptions WHERE order_id = ? AND status = 'OPEN'")
    .get(order.id) as { c: number };
  if (openExcs.c > 0) {
    throw new DomainError('PACK_INCOMPLETE', 'Order has unresolved pick exceptions');
  }

  // 4. every line: qty_picked + qty_short == qty_ordered -> else PACK_INCOMPLETE {lines}
  const lines = db
    .prepare('SELECT sku, qty_ordered, qty_picked, qty_short FROM order_lines WHERE order_id = ?')
    .all(order.id) as Array<{ sku: string; qty_ordered: number; qty_picked: number; qty_short: number }>;

  for (const l of lines) {
    if (l.qty_picked + l.qty_short !== l.qty_ordered) {
      throw new DomainError(
        'PACK_INCOMPLETE',
        `Line ${l.sku} has shortfall: picked ${l.qty_picked} + short ${l.qty_short} != ordered ${l.qty_ordered}`,
        { lines }
      );
    }
  }

  // 5. committed-deduction check: ∑ PICK movements with to_ref = order ref == ∑ order_lines.qty_picked == ∑ reservations.consumed_qty
  const movPickedRow = db
    .prepare(
      "SELECT COALESCE(SUM(qty), 0) AS s FROM stock_movements WHERE movement_type = 'PICK' AND to_kind = 'ORDER_PACKING' AND to_ref = ?"
    )
    .get(order.ref) as { s: number };
  const totalPicked = lines.reduce((acc, l) => acc + l.qty_picked, 0);
  const resConsumedRow = db
    .prepare('SELECT COALESCE(SUM(consumed_qty), 0) AS s FROM reservations WHERE order_id = ?')
    .get(order.id) as { s: number };

  if (movPickedRow.s !== totalPicked || totalPicked !== resConsumedRow.s) {
    throw new DomainError('INVENTORY_DRIFT', 'Committed inventory deductions do not match order picked quantities', {
      movements_picked: movPickedRow.s,
      lines_picked: totalPicked,
      reservations_consumed: resConsumedRow.s
    });
  }

  // 6. total_picked == 0 -> PACK_INCOMPLETE {reason: 'NOTHING_PICKED'} (order must be cancelled instead)
  if (totalPicked === 0) {
    throw new DomainError('PACK_INCOMPLETE', 'No items were picked for this order; order must be cancelled instead', {
      reason: 'NOTHING_PICKED'
    });
  }

  // 7. ∑ qty_short > 0 -> PARTIAL: actor.role must be MANAGER, accept_partial must be true; else FULL
  const totalShort = lines.reduce((acc, l) => acc + l.qty_short, 0);
  let fulfilmentType: 'FULL' | 'PARTIAL' = 'FULL';

  if (totalShort > 0) {
    if (params.actor.role !== 'MANAGER') {
      throw new DomainError('PARTIAL_PACK_FORBIDDEN', 'Only managers can approve partial order packing');
    }
    if (!params.accept_partial) {
      throw new DomainError('PACK_INCOMPLETE', 'Partial order packing requires explicit manager acceptance', {
        requires_accept_partial: true,
        shortfall: totalShort
      });
    }
    fulfilmentType = 'PARTIAL';
  }

  // 8. INSERT packing_records(ref = nextRef('packing'), packed_by, fulfilment_type, totals, notes)
  const packRef = nextRef(db, 'packing');
  const nowIso = new Date().toISOString();
  const totalOrdered = lines.reduce((acc, l) => acc + l.qty_ordered, 0);

  db.prepare(
    `
    INSERT INTO packing_records (ref, order_id, mission_id, packed_by, packed_at, fulfilment_type, total_ordered, total_picked, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(packRef, order.id, mission.id, params.actor.id, nowIso, fulfilmentType, totalOrdered, totalPicked, params.notes || null);

  db.prepare(
    `
    UPDATE orders
    SET status = 'COMPLETED', fulfilment_type = ?, completed_at = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(fulfilmentType, nowIso, nowIso, order.id);

  // 9. audit ORDER_PACKED ; emit 'order.completed' {ref, fulfilment_type} ; 'order.status_changed'
  audit(db, {
    actor: params.actor,
    action: 'ORDER_PACKED',
    entity_type: 'ORDER',
    entity_id: order.ref,
    details: {
      packing_ref: packRef,
      fulfilment_type: fulfilmentType,
      total_ordered: totalOrdered,
      total_picked: totalPicked
    }
  });

  emit(db, {
    event_type: 'order.completed',
    entity_type: 'ORDER',
    entity_id: order.ref,
    data: { ref: order.ref, fulfilment_type: fulfilmentType }
  });

  appendOrderEvent(db, {
    orderRef: order.ref,
    event: 'order.packed',
    actor: params.actor,
    payload: {
      packing_ref: packRef,
      fulfilment_type: fulfilmentType,
      total_ordered: totalOrdered,
      total_picked: totalPicked
    }
  });

  emit(db, {
    event_type: 'order.status_changed',
    entity_type: 'ORDER',
    entity_id: order.ref,
    data: { ref: order.ref, status: 'COMPLETED' }
  });

  // 10. return 201
  return {
    packing_ref: packRef,
    order_ref: order.ref,
    fulfilment_type: fulfilmentType,
    total_ordered: totalOrdered,
    total_picked: totalPicked,
    packed_by: params.actor.id,
    packed_at: nowIso
  };
}
