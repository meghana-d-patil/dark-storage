import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { DomainError, PackingQueueItemDto, PackingResultDto, transition, PackSessionDTO, PackLineDTO } from '@dark-storage/shared';
import { nextRef } from './ids.js';
import { audit } from './audit.js';
import { appendOrderEvent } from '../audit/appendAudit.js';
import { emit } from './outbox.js';
import { postLedger } from '../ledger/postLedger.js';
import { createFloorTask } from './pickerRepo.js';

export const demoOtpStore = new Map<string, string>();

function getConfigNumber(db: Database.Database, key: string, defaultValue: number): number {
  try {
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(key) as { value: string } | undefined;
    if (row && row.value) {
      const parsed = parseFloat(row.value);
      if (!isNaN(parsed)) return parsed;
    }
  } catch (err) {
    // ignore
  }
  return defaultValue;
}

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

export function buildPackSessionDTO(db: Database.Database, sessionId: number): PackSessionDTO {
  const session = db.prepare('SELECT * FROM pack_sessions WHERE id = ?').get(sessionId) as any;
  if (!session) throw new DomainError('NOT_FOUND', 'Pack session not found', {}, 404);

  const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(session.order_ref) as any;
  if (!order) throw new DomainError('NOT_FOUND', 'Order not found', {}, 404);

  const lines = db.prepare(`
    SELECT ol.sku, p.name as product_name, ol.qty_ordered as expected_qty
    FROM order_lines ol
    JOIN products p ON ol.sku = p.sku COLLATE NOCASE
    WHERE ol.order_id = ?
    ORDER BY ol.line_no ASC
  `).all(order.id) as Array<{ sku: string; product_name: string; expected_qty: number }>;

  const scans = db.prepare(`
    SELECT sku, kind, SUM(qty) as qty
    FROM pack_scans
    WHERE session_id = ?
    GROUP BY sku, kind
  `).all(sessionId) as Array<{ sku: string; kind: string; qty: number }>;

  const scanMap = new Map<string, { scanned: number; flagged: number }>();
  for (const s of scans) {
    const cur = scanMap.get(s.sku) || { scanned: 0, flagged: 0 };
    if (s.kind === 'SCANNED') cur.scanned += s.qty;
    else cur.flagged += s.qty;
    scanMap.set(s.sku, cur);
  }

  const lineDtos: PackLineDTO[] = lines.map((l) => {
    const counts = scanMap.get(l.sku) || { scanned: 0, flagged: 0 };
    return {
      sku: l.sku,
      productName: l.product_name,
      expectedQty: l.expected_qty,
      scannedQty: counts.scanned,
      flaggedQty: counts.flagged,
    };
  });

  const allLinesComplete = lineDtos.every((l) => l.scannedQty + l.flaggedQty === l.expectedQty);
  const weightOk = session.weight_ok === 1;
  const canComplete = allLinesComplete && weightOk && session.status === 'OPEN';

  return {
    sessionId: String(session.id),
    orderRef: session.order_ref,
    toteCode: session.tote_code,
    lines: lineDtos,
    weightExpectedG: session.expected_weight_g ?? undefined,
    weightOk,
    canComplete,
  };
}

export function openPackSession(
  db: Database.Database,
  params: {
    toteScan: string;
    benchCode?: string;
    actor: { id: number; role: string; username: string };
  }
): PackSessionDTO {
  const toteCode = params.toteScan.trim().toUpperCase();
  const benchCode = params.benchCode || 'BENCH-1';

  return db.transaction(() => {
    const tote = db.prepare('SELECT * FROM totes WHERE tote_code = ?').get(toteCode) as any;
    if (!tote) {
      throw new DomainError('NOT_FOUND', `Tote ${toteCode} not found`, {}, 404);
    }

    if (!tote.order_ref) {
      throw new DomainError('STATE_CONFLICT', `Tote ${toteCode} has no associated order`, {}, 409);
    }

    const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(tote.order_ref) as any;
    if (!order) {
      throw new DomainError('NOT_FOUND', `Order ${tote.order_ref} not found`, {}, 404);
    }

    // Check if open session exists for this tote
    const existingSession = db.prepare(`
      SELECT * FROM pack_sessions
      WHERE tote_code = ? AND status = 'OPEN'
      ORDER BY id DESC LIMIT 1
    `).get(toteCode) as any;

    if (existingSession) {
      if (existingSession.opened_by === params.actor.username) {
        return buildPackSessionDTO(db, existingSession.id);
      } else {
        throw new DomainError('STATE_CONFLICT', `Tote is currently being packed by ${existingSession.opened_by}`, {}, 409);
      }
    }

    // New session: tote status must be AWAITING_PACK and order must be PICKED
    if (order.status !== 'PICKED') {
      throw new DomainError('ORDER_NOT_PICKED', `Order is in status ${order.status}, expected PICKED`, { status: order.status }, 409);
    }

    if (tote.status !== 'AWAITING_PACK') {
      throw new DomainError('STATE_CONFLICT', `Tote is in status ${tote.status}, expected AWAITING_PACK`, { status: tote.status }, 409);
    }

    transition('ORDER', order.status, 'open_pack');

    const nowIso = new Date().toISOString();
    const res = db.prepare(`
      INSERT INTO pack_sessions (order_ref, tote_code, bench_code, opened_by, status, opened_at)
      VALUES (?, ?, ?, ?, 'OPEN', ?)
    `).run(order.ref, toteCode, benchCode, params.actor.username, nowIso);
    const sessionId = Number(res.lastInsertRowid);

    db.prepare(`UPDATE totes SET status = 'PACKING', updated_at = ? WHERE tote_code = ?`).run(nowIso, toteCode);
    db.prepare(`UPDATE orders SET status = 'PACKING', updated_at = ? WHERE id = ?`).run(nowIso, order.id);

    audit(db, {
      actor: params.actor,
      action: 'PACK_SESSION_OPENED',
      entity_type: 'PACK_SESSION',
      entity_id: String(sessionId),
      details: { order_ref: order.ref, tote_code: toteCode, bench_code: benchCode },
    });

    appendOrderEvent(db, {
      orderRef: order.ref,
      event: 'pack.session_opened',
      actor: params.actor,
      payload: { session_id: sessionId, tote_code: toteCode, bench: benchCode },
    });

    return buildPackSessionDTO(db, sessionId);
  })();
}

export function getPackSession(db: Database.Database, sessionId: number): PackSessionDTO {
  return buildPackSessionDTO(db, sessionId);
}

export function scanPackItem(
  db: Database.Database,
  sessionId: number,
  scan: string,
  actor: { id: number; role: string; username: string }
): PackSessionDTO {
  return db.transaction(() => {
    const session = db.prepare('SELECT * FROM pack_sessions WHERE id = ?').get(sessionId) as any;
    if (!session || session.status !== 'OPEN') {
      throw new DomainError('NOT_FOUND', 'Active pack session not found', {}, 404);
    }

    const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(session.order_ref) as any;
    if (!order) {
      throw new DomainError('NOT_FOUND', 'Order not found', {}, 404);
    }

    const cleanScan = scan.trim().toUpperCase();
    const product = db.prepare(`
      SELECT sku, barcode, name, weight_g FROM products
      WHERE sku = ? OR barcode = ? COLLATE NOCASE
    `).get(cleanScan, cleanScan) as { sku: string; barcode?: string | null; name: string; weight_g: number } | undefined;

    if (!product) {
      throw new DomainError('PACK_ITEM_NOT_IN_ORDER', `Scanned barcode '${scan}' does not match any product`, {}, 422);
    }

    const line = db.prepare(`
      SELECT * FROM order_lines WHERE order_id = ? AND sku = ? COLLATE NOCASE
    `).get(order.id, product.sku) as { id: number; qty_ordered: number } | undefined;

    if (!line) {
      throw new DomainError('PACK_ITEM_NOT_IN_ORDER', `Product '${product.sku}' is not part of order ${order.ref}`, {}, 422);
    }

    const scanCount = db.prepare(`
      SELECT COALESCE(SUM(qty), 0) as total FROM pack_scans
      WHERE session_id = ? AND sku = ?
    `).get(sessionId, product.sku) as { total: number };

    if (scanCount.total >= line.qty_ordered) {
      throw new DomainError('PACK_ITEM_OVERSCAN', `Product '${product.sku}' is already fully packed`, {}, 422);
    }

    // Find lot from tote balances
    const lotRow = db.prepare(`
      SELECT lot_id FROM location_balances
      WHERE location_key = ? AND sku = ? AND qty > 0
      ORDER BY qty DESC LIMIT 1
    `).get(`TOTE:${session.tote_code}`, product.sku) as { lot_id: string } | undefined;

    const lotId = lotRow?.lot_id || `LOT-LEGACY-${product.sku}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO pack_scans (session_id, sku, qty, kind, lot_id, at, actor_id)
      VALUES (?, ?, 1, 'SCANNED', ?, ?, ?)
    `).run(sessionId, product.sku, lotId, nowIso, String(actor.id));

    // Ledger move: TOTE -> BENCH:benchCode
    postLedger(
      db,
      [
        {
          sku: product.sku,
          lotId,
          qty: 1,
          from: `TOTE:${session.tote_code}`,
          to: `BENCH:${session.bench_code}`,
          type: 'PACK',
          orderRef: order.ref,
          refType: 'PACK_SESSION',
          refId: String(sessionId),
        },
      ],
      { id: String(actor.id) }
    );

    appendOrderEvent(db, {
      orderRef: order.ref,
      event: 'pack.item_scanned',
      actor,
      payload: { session_id: sessionId, sku: product.sku, lot_id: lotId },
    });

    return buildPackSessionDTO(db, sessionId);
  })();
}

export function flagPackItem(
  db: Database.Database,
  sessionId: number,
  params: { sku: string; qty: number; kind: 'MISSING' | 'DAMAGED'; note?: string },
  actor: { id: number; role: string; username: string }
): PackSessionDTO {
  return db.transaction(() => {
    const session = db.prepare('SELECT * FROM pack_sessions WHERE id = ?').get(sessionId) as any;
    if (!session || session.status !== 'OPEN') {
      throw new DomainError('NOT_FOUND', 'Active pack session not found', {}, 404);
    }

    const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(session.order_ref) as any;
    if (!order) {
      throw new DomainError('NOT_FOUND', 'Order not found', {}, 404);
    }

    const line = db.prepare(`
      SELECT * FROM order_lines WHERE order_id = ? AND sku = ? COLLATE NOCASE
    `).get(order.id, params.sku) as { id: number; qty_ordered: number } | undefined;

    if (!line) {
      throw new DomainError('PACK_ITEM_NOT_IN_ORDER', `Product '${params.sku}' is not part of order ${order.ref}`, {}, 422);
    }

    const scanCount = db.prepare(`
      SELECT COALESCE(SUM(qty), 0) as total FROM pack_scans
      WHERE session_id = ? AND sku = ?
    `).get(sessionId, params.sku) as { total: number };

    const remaining = line.qty_ordered - scanCount.total;
    if (params.qty <= 0 || params.qty > remaining) {
      throw new DomainError('PACK_ITEM_OVERSCAN', `Flagged quantity ${params.qty} exceeds remaining required quantity ${remaining}`, {}, 422);
    }

    const nowIso = new Date().toISOString();
    let lotId = `LOT-LEGACY-${params.sku}`;

    if (params.kind === 'DAMAGED') {
      const lotRow = db.prepare(`
        SELECT lot_id FROM location_balances
        WHERE location_key = ? AND sku = ? AND qty > 0
        ORDER BY qty DESC LIMIT 1
      `).get(`TOTE:${session.tote_code}`, params.sku) as { lot_id: string } | undefined;
      if (lotRow) lotId = lotRow.lot_id;

      postLedger(
        db,
        [
          {
            sku: params.sku,
            lotId,
            qty: params.qty,
            from: `TOTE:${session.tote_code}`,
            to: 'QUAR',
            type: 'QUARANTINE',
            orderRef: order.ref,
            refType: 'PACK_SESSION',
            refId: String(sessionId),
          },
        ],
        { id: String(actor.id) }
      );
    }

    db.prepare(`
      INSERT INTO pack_scans (session_id, sku, qty, kind, lot_id, at, actor_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, params.sku, params.qty, params.kind, lotId, nowIso, String(actor.id));

    // Create REPICK floor task for pickers
    createFloorTask(db, {
      type: 'REPICK',
      orderRef: order.ref,
      sku: params.sku,
      qty: params.qty,
      priority: 10,
      createdBy: actor.username,
      payload: { note: params.note, kind: params.kind },
    });

    appendOrderEvent(db, {
      orderRef: order.ref,
      event: 'pack.item_flagged',
      actor,
      payload: { session_id: sessionId, sku: params.sku, qty: params.qty, kind: params.kind, note: params.note },
    });

    audit(db, {
      actor,
      action: 'PACK_ITEM_FLAGGED',
      entity_type: 'PACK_SESSION',
      entity_id: String(sessionId),
      details: { sku: params.sku, qty: params.qty, kind: params.kind },
    });

    return buildPackSessionDTO(db, sessionId);
  })();
}

export function weighPackSession(
  db: Database.Database,
  sessionId: number,
  grams: number
): { ok: boolean; weight_ok: boolean; expected_weight_g: number; weight_g: number } {
  const session = db.prepare('SELECT * FROM pack_sessions WHERE id = ?').get(sessionId) as any;
  if (!session || session.status !== 'OPEN') {
    throw new DomainError('NOT_FOUND', 'Active pack session not found', {}, 404);
  }

  const scans = db.prepare(`
    SELECT ps.sku, SUM(ps.qty) as qty, COALESCE(p.weight_g, 0) as weight_g
    FROM pack_scans ps
    JOIN products p ON ps.sku = p.sku COLLATE NOCASE
    WHERE ps.session_id = ? AND ps.kind = 'SCANNED'
    GROUP BY ps.sku
  `).all(sessionId) as Array<{ sku: string; qty: number; weight_g: number }>;

  const bagTareG = getConfigNumber(db, 'pack.bag_tare_g', 40);
  const tolerancePct = getConfigNumber(db, 'pack.weight_tolerance_pct', 8);

  const productWeight = scans.reduce((sum, s) => sum + s.weight_g * s.qty, 0);
  const allWeightsZero = scans.length > 0 && scans.every((s) => s.weight_g === 0);
  const expectedWeightG = allWeightsZero ? grams : productWeight + bagTareG;

  let weightOk = 0;
  if (allWeightsZero) {
    weightOk = 1;
  } else {
    const tolerance = expectedWeightG * (tolerancePct / 100);
    if (Math.abs(grams - expectedWeightG) <= tolerance) {
      weightOk = 1;
    }
  }

  db.prepare(`
    UPDATE pack_sessions
    SET weight_g = ?, expected_weight_g = ?, weight_ok = ?
    WHERE id = ?
  `).run(grams, expectedWeightG, weightOk, sessionId);

  if (weightOk === 0) {
    throw new DomainError(
      'WEIGHT_MISMATCH',
      `Weight ${grams}g deviates from expected ${expectedWeightG}g beyond tolerance ${tolerancePct}%`,
      { expected: expectedWeightG, actual: grams, tolerancePct },
      422
    );
  }

  return { ok: true, weight_ok: true, expected_weight_g: expectedWeightG, weight_g: grams };
}

export function completePackSession(
  db: Database.Database,
  sessionId: number,
  slotScan: string,
  actor: { id: number; role: string; username: string }
): { ok: boolean; orderRef: string; status: string; slot: string } {
  return db.transaction(() => {
    const session = db.prepare('SELECT * FROM pack_sessions WHERE id = ?').get(sessionId) as any;
    if (!session || session.status !== 'OPEN') {
      throw new DomainError('NOT_FOUND', 'Active pack session not found', {}, 404);
    }

    const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(session.order_ref) as any;
    if (!order) {
      throw new DomainError('NOT_FOUND', 'Order not found', {}, 404);
    }

    // 1. Verify all lines complete
    const lines = db.prepare(`
      SELECT ol.sku, ol.qty_ordered
      FROM order_lines ol
      WHERE ol.order_id = ?
    `).all(order.id) as Array<{ sku: string; qty_ordered: number }>;

    const scans = db.prepare(`
      SELECT sku, kind, SUM(qty) as qty
      FROM pack_scans
      WHERE session_id = ?
      GROUP BY sku, kind
    `).all(sessionId) as Array<{ sku: string; kind: string; qty: number }>;

    const scanMap = new Map<string, number>();
    for (const s of scans) {
      scanMap.set(s.sku, (scanMap.get(s.sku) || 0) + s.qty);
    }

    for (const line of lines) {
      const done = scanMap.get(line.sku) || 0;
      if (done < line.qty_ordered) {
        throw new DomainError('PACK_INCOMPLETE', `Line ${line.sku} incomplete: ${done}/${line.qty_ordered}`, {}, 422);
      }
    }

    // 2. Verify weight_ok
    if (session.weight_ok !== 1) {
      // Check if products have 0 weight
      const nonZeroWeights = db.prepare(`
        SELECT 1 FROM pack_scans ps
        JOIN products p ON ps.sku = p.sku COLLATE NOCASE
        WHERE ps.session_id = ? AND ps.kind = 'SCANNED' AND p.weight_g > 0
        LIMIT 1
      `).get(sessionId);
      if (nonZeroWeights) {
        throw new DomainError('WEIGHT_MISMATCH', 'Weigh step must pass before completing pack session', {}, 422);
      }
    }

    // 3. Verify dispatch slot
    const cleanSlot = slotScan.trim().toUpperCase();
    const slot = db.prepare('SELECT * FROM dispatch_slots WHERE slot_code = ?').get(cleanSlot) as any;
    if (!slot || slot.status !== 'FREE') {
      throw new DomainError('SLOT_MISMATCH', `Dispatch slot ${cleanSlot} is not available`, {}, 422);
    }

    // 4. Ledger: move all scanned units BENCH -> DISP:slot
    const benchBalances = db.prepare(`
      SELECT sku, lot_id, qty
      FROM location_balances
      WHERE location_key = ? AND qty > 0
    `).all(`BENCH:${session.bench_code}`) as Array<{ sku: string; lot_id: string; qty: number }>;

    if (benchBalances.length > 0) {
      postLedger(
        db,
        benchBalances.map((b) => ({
          sku: b.sku,
          lotId: b.lot_id,
          qty: b.qty,
          from: `BENCH:${session.bench_code}`,
          to: `DISP:${cleanSlot}`,
          type: 'STAGE_DISPATCH',
          orderRef: order.ref,
          refType: 'PACK_SESSION',
          refId: String(sessionId),
        })),
        { id: String(actor.id) }
      );
    }

    const nowIso = new Date().toISOString();

    // 5. Update slot & session
    db.prepare(`UPDATE dispatch_slots SET status = 'OCCUPIED', order_ref = ? WHERE slot_code = ?`).run(order.ref, cleanSlot);
    db.prepare(`UPDATE pack_sessions SET status = 'COMPLETE', completed_at = ? WHERE id = ?`).run(nowIso, sessionId);

    // 6. Free tote
    db.prepare(`UPDATE totes SET status = 'FREE', mission_ref = NULL, order_ref = NULL, updated_at = ? WHERE tote_code = ?`).run(nowIso, session.tote_code);

    // 7. Order transition -> PACKED
    transition('ORDER', order.status, 'pack_complete');
    db.prepare(`UPDATE orders SET status = 'PACKED', packed_at = ?, updated_at = ? WHERE id = ?`).run(nowIso, nowIso, order.id);

    // 8. Packing record
    const hasFlagged = scans.some((s) => s.kind === 'MISSING' || s.kind === 'DAMAGED');
    const fulfilmentType = hasFlagged ? 'PARTIAL' : 'FULL';
    const totalOrdered = lines.reduce((sum, l) => sum + l.qty_ordered, 0);
    const totalPicked = scans.filter((s) => s.kind === 'SCANNED').reduce((sum, s) => sum + s.qty, 0);
    const packRef = nextRef(db, 'PCK');

    db.prepare(`
      INSERT INTO packing_records (ref, order_id, packed_by, packed_at, fulfilment_type, total_ordered, total_picked, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(packRef, order.id, actor.id, nowIso, fulfilmentType, totalOrdered, totalPicked, sessionId);

    // 9. Generate OTP (4-digit)
    const otp = String(crypto.randomInt(1000, 10000));
    const otpHash = crypto.createHash('sha256').update(otp + order.ref).digest('hex');
    const otpExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO dispatch_handovers (order_ref, slot_code, otp_hash, otp_expires_at, attempts, locked)
      VALUES (?, ?, ?, ?, 0, 0)
    `).run(order.ref, cleanSlot, otpHash, otpExpiresAt);

    demoOtpStore.set(order.ref, otp);

    // 10. Audit & events
    audit(db, {
      actor,
      action: 'ORDER_PACKED',
      entity_type: 'ORDER',
      entity_id: order.ref,
      details: { packing_ref: packRef, slot_code: cleanSlot, fulfilment_type: fulfilmentType },
    });

    appendOrderEvent(db, {
      orderRef: order.ref,
      event: 'pack.completed',
      actor,
      payload: { session_id: sessionId, slot_code: cleanSlot, fulfilment_type: fulfilmentType },
    });

    return { ok: true, orderRef: order.ref, status: 'PACKED', slot: cleanSlot };
  })();
}
