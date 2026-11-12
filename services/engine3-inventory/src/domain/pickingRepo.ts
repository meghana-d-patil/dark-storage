import Database from 'better-sqlite3';
import { DomainError, PickExceptionDto, PickConfirmationResultDto, ExceptionQueryInput } from '@dark-storage/shared';
import { nextRef } from './ids.js';
import { stockOut, reserve, release, recordMovement, applyRecount } from './inventoryRepo.js';
import { closeReservationIfDone, allocateStock } from './ordersRepo.js';
import { audit } from './audit.js';
import { appendOrderEvent } from '../audit/appendAudit.js';
import { emit } from './outbox.js';

export function maybeCompleteMission(db: Database.Database, missionId: number): boolean {
  const pendingRow = db
    .prepare("SELECT COUNT(*) AS c FROM pick_stops WHERE mission_id = ? AND status IN ('PENDING', 'EXCEPTION_OPEN')")
    .get(missionId) as { c: number };

  if (pendingRow.c === 0) {
    const mission = db.prepare('SELECT id, ref, order_id, status FROM missions WHERE id = ?').get(missionId) as any;
    if (!mission || mission.status === 'COMPLETED' || mission.status === 'CANCELLED') {
      return false;
    }

    const order = db.prepare('SELECT id, ref FROM orders WHERE id = ?').get(mission.order_id) as any;
    const nowIso = new Date().toISOString();

    db.prepare("UPDATE missions SET status = 'COMPLETED', completed_at = ? WHERE id = ?").run(nowIso, mission.id);
    db.prepare("UPDATE orders SET status = 'PICKED', updated_at = ? WHERE id = ?").run(nowIso, mission.order_id);

    audit(db, {
      actor: { id: 1, role: 'SYSTEM' },
      action: 'MISSION_COMPLETED',
      entity_type: 'MISSION',
      entity_id: mission.ref,
      details: { order_ref: order?.ref }
    });

    emit(db, {
      event_type: 'mission.completed',
      entity_type: 'MISSION',
      entity_id: mission.ref,
      data: { ref: mission.ref, order_ref: order?.ref }
    });

    if (order) {
      emit(db, {
        event_type: 'order.status_changed',
        entity_type: 'ORDER',
        entity_id: order.ref,
        data: { ref: order.ref, status: 'PICKED' }
      });

      appendOrderEvent(db, {
        orderRef: order.ref,
        event: 'order.picked',
        actor: { id: 1, role: 'SYSTEM' },
        payload: { mission_ref: mission.ref }
      });
    }

    return true;
  }

  return false;
}

export function executePickConfirm(
  db: Database.Database,
  params: {
    stop_ref: string;
    scanned_bin: string;
    scanned_sku: string;
    picked_qty: number;
    exception?: { type: string; notes: string };
    actor: { id: number; role: string; display_name?: string };
  },
  hooks?: { afterStep?: (step: string) => void }
): PickConfirmationResultDto {
  const row = db
    .prepare(
      `
    SELECT
      ps.*,
      m.picker_id,
      m.status AS mission_status,
      m.ref AS mission_ref,
      o.ref AS order_ref,
      o.id AS order_id,
      o.status AS order_status,
      r.id AS res_id,
      r.qty AS res_qty,
      r.consumed_qty AS res_consumed,
      r.released_qty AS res_released,
      p.name AS product_name
    FROM pick_stops ps
    JOIN missions m ON m.id = ps.mission_id
    JOIN orders o ON o.id = m.order_id
    JOIN reservations r ON r.id = ps.reservation_id
    JOIN products p ON p.sku = ps.sku COLLATE NOCASE
    WHERE ps.stop_ref = ?
  `
    )
    .get(params.stop_ref) as any;

  if (!row) {
    throw new DomainError('NOT_FOUND', `Stop ${params.stop_ref} not found`);
  }

  // 2. Validate actor and state
  if (params.actor.role === 'PICKER' && params.actor.id !== row.picker_id) {
    throw new DomainError('NOT_YOUR_MISSION', 'You are not assigned to this mission');
  }

  if (row.mission_status !== 'IN_PROGRESS') {
    throw new DomainError('MISSION_STATE_INVALID', `Mission is in status ${row.mission_status}, must be IN_PROGRESS`);
  }

  if (row.status !== 'PENDING') {
    throw new DomainError('STOP_STATE_INVALID', `Stop is in status ${row.status}, must be PENDING`);
  }

  // 3. Scan verification
  if (params.scanned_bin !== row.bin_code) {
    throw new DomainError('BIN_MISMATCH', `Wrong location scanned. Expected ${row.bin_code}`, {
      expected_bin: row.bin_code
    });
  }

  if (params.scanned_sku.toUpperCase() !== row.sku.toUpperCase()) {
    throw new DomainError('PRODUCT_MISMATCH', `Wrong product scanned. Expected ${row.sku}`, {
      expected_sku: row.sku,
      name: row.product_name
    });
  }

  // 4. Quantity calculation
  const outstanding = row.res_qty - row.res_consumed - row.res_released;

  if (!Number.isInteger(params.picked_qty) || params.picked_qty < 1) {
    throw new DomainError('QUANTITY_INVALID', 'Picked quantity must be an integer >= 1', {
      picked_qty: params.picked_qty
    });
  }

  if (params.picked_qty > outstanding) {
    throw new DomainError('QUANTITY_EXCEEDS_RESERVATION', `Quantity exceeds outstanding reservation of ${outstanding}`, {
      outstanding,
      picked_qty: params.picked_qty
    });
  }

  // 5. Short pick requires exception block
  if (params.picked_qty < outstanding && !params.exception) {
    throw new DomainError('SHORT_PICK_REQUIRES_EXCEPTION', 'Exception required for partial pick');
  }

  const nowIso = new Date().toISOString();

  // 6. Stock deduction (consumeReserved = true)
  stockOut(db, {
    bin: row.bin_code,
    qty: params.picked_qty,
    consumeReserved: true
  });

  hooks?.afterStep?.('stockOut');

  // 7. Update reservation
  const newConsumed = row.res_consumed + params.picked_qty;
  const nextResStatus = newConsumed + row.res_released >= row.res_qty ? 'CONSUMED' : 'HELD';
  db.prepare('UPDATE reservations SET consumed_qty = ?, status = ?, updated_at = ? WHERE id = ?').run(
    newConsumed,
    nextResStatus,
    nowIso,
    row.res_id
  );

  // 8. Record stock movement
  recordMovement(db, {
    type: 'PICK',
    sku: row.sku,
    qty: params.picked_qty,
    from: { kind: 'BIN', ref: row.bin_code },
    to: { kind: 'ORDER_PACKING', ref: row.order_ref },
    related: { type: 'STOP', ref: row.stop_ref },
    actorId: params.actor.id
  });

  // 9. Order lines & stop picked counts
  db.prepare('UPDATE order_lines SET qty_picked = qty_picked + ? WHERE order_id = ? AND sku = ? COLLATE NOCASE').run(
    params.picked_qty,
    row.order_id,
    row.sku
  );

  db.prepare('UPDATE pick_stops SET qty_picked = qty_picked + ? WHERE id = ?').run(params.picked_qty, row.id);

  let openedException: PickExceptionDto | null = null;

  // 10. Status transition
  if (params.picked_qty === outstanding) {
    db.prepare("UPDATE pick_stops SET status = 'PICKED', confirmed_at = ? WHERE id = ?").run(nowIso, row.id);
  } else {
    db.prepare("UPDATE pick_stops SET status = 'EXCEPTION_OPEN' WHERE id = ?").run(row.id);

    const excRef = nextRef(db, 'exception');
    db.prepare(
      `
      INSERT INTO pick_exceptions (ref, mission_id, order_id, stop_id, bin_code, sku, exception_type, expected_qty, actual_qty, notes, reported_by, reported_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
    `
    ).run(
      excRef,
      row.mission_id,
      row.order_id,
      row.id,
      row.bin_code,
      row.sku,
      params.exception!.type,
      outstanding,
      params.picked_qty,
      params.exception!.notes,
      params.actor.id,
      nowIso
    );

    if (['SHORT_PICK', 'DAMAGED'].includes(params.exception!.type)) {
      db.prepare('UPDATE bins SET recount_required = 1 WHERE code = ?').run(row.bin_code);
    }

    openedException = getException(db, excRef);
  }

  // 11. Maybe complete mission
  maybeCompleteMission(db, row.mission_id);

  // 12. Audit and events
  audit(db, {
    actor: { id: params.actor.id, role: params.actor.role },
    action: 'PICK_CONFIRMED',
    entity_type: 'STOP',
    entity_id: row.stop_ref,
    details: {
      mission_ref: row.mission_ref,
      picked_qty: params.picked_qty,
      outstanding,
      bin: row.bin_code,
      sku: row.sku
    }
  });

  emit(db, {
    event_type: 'pick.confirmed',
    entity_type: 'STOP',
    entity_id: row.stop_ref,
    data: { stop_ref: row.stop_ref, mission_ref: row.mission_ref, picked_qty: params.picked_qty }
  });

  emit(db, {
    event_type: 'inventory.changed',
    entity_type: 'BIN',
    entity_id: row.bin_code,
    data: { bins: [row.bin_code] }
  });

  emit(db, {
    event_type: 'reservation.changed',
    entity_type: 'ORDER',
    entity_id: row.order_ref,
    data: { order_ref: row.order_ref }
  });

  if (openedException) {
    emit(db, {
      event_type: 'exception.opened',
      entity_type: 'EXCEPTION',
      entity_id: openedException.ref,
      data: { ref: openedException.ref, stop_ref: row.stop_ref }
    });
  }

  // Return fresh state
  const updatedStop = db.prepare('SELECT * FROM pick_stops WHERE id = ?').get(row.id) as any;
  const updatedOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(row.order_id) as any;
  const allStops = db.prepare('SELECT * FROM pick_stops WHERE mission_id = ?').all(row.mission_id) as any[];

  let finishedStops = 0;
  let openExceptions = 0;
  let unitsRequired = 0;
  let unitsPicked = 0;

  for (const s of allStops) {
    unitsRequired += s.qty_required;
    unitsPicked += s.qty_picked;
    if (s.status === 'PICKED' || s.status === 'RESOLVED') finishedStops++;
    else if (s.status === 'EXCEPTION_OPEN') openExceptions++;
  }

  return {
    stop: {
      id: updatedStop.id,
      stop_ref: updatedStop.stop_ref,
      seq: updatedStop.seq,
      bin_code: updatedStop.bin_code,
      sku: updatedStop.sku,
      qty_required: updatedStop.qty_required,
      qty_picked: updatedStop.qty_picked,
      status: updatedStop.status,
      confirmed_at: updatedStop.confirmed_at
    },
    mission_progress: {
      total_stops: allStops.length,
      finished_stops: finishedStops,
      open_exceptions: openExceptions,
      units_required: unitsRequired,
      units_picked: unitsPicked
    },
    order_status: updatedOrder.status,
    exception: openedException
  };
}

export function executeReportProblem(
  db: Database.Database,
  params: {
    stop_ref: string;
    type: string;
    notes: string;
    actor: { id: number; role: string; display_name?: string };
  }
): PickExceptionDto {
  const row = db
    .prepare(
      `
    SELECT
      ps.*,
      m.picker_id,
      m.status AS mission_status,
      m.ref AS mission_ref,
      o.ref AS order_ref,
      o.id AS order_id,
      r.qty AS res_qty,
      r.consumed_qty AS res_consumed,
      r.released_qty AS res_released
    FROM pick_stops ps
    JOIN missions m ON m.id = ps.mission_id
    JOIN orders o ON o.id = m.order_id
    JOIN reservations r ON r.id = ps.reservation_id
    WHERE ps.stop_ref = ?
  `
    )
    .get(params.stop_ref) as any;

  if (!row) {
    throw new DomainError('NOT_FOUND', `Stop ${params.stop_ref} not found`);
  }

  if (params.actor.role === 'PICKER' && params.actor.id !== row.picker_id) {
    throw new DomainError('NOT_YOUR_MISSION', 'You are not assigned to this mission');
  }

  if (row.mission_status !== 'IN_PROGRESS') {
    throw new DomainError('MISSION_STATE_INVALID', `Mission is in status ${row.mission_status}, must be IN_PROGRESS`);
  }

  if (row.status !== 'PENDING') {
    throw new DomainError('STOP_STATE_INVALID', `Stop is in status ${row.status}, must be PENDING`);
  }

  const outstanding = row.res_qty - row.res_consumed - row.res_released;
  const excRef = nextRef(db, 'exception');
  const nowIso = new Date().toISOString();

  db.prepare(
    `
    INSERT INTO pick_exceptions (ref, mission_id, order_id, stop_id, bin_code, sku, exception_type, expected_qty, actual_qty, notes, reported_by, reported_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'OPEN')
  `
  ).run(
    excRef,
    row.mission_id,
    row.order_id,
    row.id,
    row.bin_code,
    row.sku,
    params.type,
    outstanding,
    params.notes,
    params.actor.id,
    nowIso
  );

  db.prepare("UPDATE pick_stops SET status = 'EXCEPTION_OPEN' WHERE id = ?").run(row.id);

  if (params.type !== 'OTHER') {
    db.prepare('UPDATE bins SET recount_required = 1 WHERE code = ?').run(row.bin_code);
  }

  audit(db, {
    actor: { id: params.actor.id, role: params.actor.role },
    action: 'EXCEPTION_REPORTED',
    entity_type: 'EXCEPTION',
    entity_id: excRef,
    details: {
      stop_ref: row.stop_ref,
      type: params.type,
      bin: row.bin_code,
      sku: row.sku,
      expected_qty: outstanding
    }
  });

  emit(db, {
    event_type: 'exception.opened',
    entity_type: 'EXCEPTION',
    entity_id: excRef,
    data: { ref: excRef, stop_ref: row.stop_ref, type: params.type }
  });

  return getException(db, excRef)!;
}

export function executeResolveException(
  db: Database.Database,
  params: {
    exception_ref: string;
    action: 'REALLOCATE' | 'ACCEPT_SHORT';
    notes?: string;
    recount?: { counted_qty: number };
    actor: { id: number; role: string; display_name?: string };
  }
): { exception: PickExceptionDto; new_stops: any[] } {
  const row = db
    .prepare(
      `
    SELECT
      e.*,
      ps.stop_no,
      ps.stop_ref,
      ps.status AS stop_status,
      m.id AS mission_id,
      m.ref AS mission_ref,
      m.status AS mission_status,
      o.id AS order_id,
      o.ref AS order_ref,
      r.id AS res_id,
      r.qty AS res_qty,
      r.consumed_qty AS res_consumed,
      r.released_qty AS res_released
    FROM pick_exceptions e
    JOIN pick_stops ps ON ps.id = e.stop_id
    JOIN missions m ON m.id = e.mission_id
    JOIN orders o ON o.id = e.order_id
    JOIN reservations r ON r.id = ps.reservation_id
    WHERE e.ref = ?
  `
    )
    .get(params.exception_ref) as any;

  if (!row) {
    throw new DomainError('NOT_FOUND', `Exception ${params.exception_ref} not found`);
  }

  if (row.status !== 'OPEN') {
    throw new DomainError('EXCEPTION_STATE_INVALID', `Exception is already resolved (${row.status})`);
  }

  if (row.stop_status !== 'EXCEPTION_OPEN') {
    throw new DomainError('STOP_STATE_INVALID', `Stop is in status ${row.stop_status}, expected EXCEPTION_OPEN`);
  }

  if (row.mission_status !== 'IN_PROGRESS') {
    throw new DomainError('MISSION_STATE_INVALID', `Mission is in status ${row.mission_status}, expected IN_PROGRESS`);
  }

  const outstanding = row.res_qty - row.res_consumed - row.res_released;
  const nowIso = new Date().toISOString();

  // 3. Release remaining unpicked reservation
  if (outstanding > 0) {
    release(db, { bin: row.bin_code, qty: outstanding });
    const newReleased = row.res_released + outstanding;
    const nextResStatus = row.res_consumed > 0 ? 'CONSUMED' : 'RELEASED';
    db.prepare('UPDATE reservations SET released_qty = ?, status = ?, updated_at = ? WHERE id = ?').run(
      newReleased,
      nextResStatus,
      nowIso,
      row.res_id
    );
  }

  // 4. Apply recount if provided
  if (params.recount) {
    applyRecount(db, {
      bin_code: row.bin_code,
      counted_qty: params.recount.counted_qty,
      reason: params.notes || 'Exception recount',
      actorId: params.actor.id
    });
    db.prepare('UPDATE bins SET recount_required = 0 WHERE code = ?').run(row.bin_code);
  }

  const newStops: any[] = [];

  // 5. Handle action
  if (params.action === 'ACCEPT_SHORT') {
    db.prepare('UPDATE order_lines SET qty_short = qty_short + ? WHERE order_id = ? AND sku = ? COLLATE NOCASE').run(
      outstanding,
      row.order_id,
      row.sku
    );
    db.prepare("UPDATE pick_stops SET status = 'RESOLVED' WHERE id = ?").run(row.stop_id);
  } else if (params.action === 'REALLOCATE') {
    const plan = allocateStock(db, row.sku, outstanding, { excludeBins: [row.bin_code] });
    if (!plan) {
      throw new DomainError('INSUFFICIENT_STOCK', `No stock elsewhere to reallocate ${outstanding} units of ${row.sku}`, {
        sku: row.sku,
        requested: outstanding
      });
    }

    // Get order line id for this SKU
    const orderLine = db
      .prepare('SELECT id FROM order_lines WHERE order_id = ? AND sku = ? COLLATE NOCASE')
      .get(row.order_id, row.sku) as { id: number };

    // Get max stop_no and max seq for this mission
    const maxRow = db
      .prepare('SELECT COALESCE(MAX(stop_no), 0) AS max_stop, COALESCE(MAX(seq), 0) AS max_seq FROM pick_stops WHERE mission_id = ?')
      .get(row.mission_id) as { max_stop: number; max_seq: number };

    let nextStopNo = maxRow.max_stop + 1;
    let nextSeq = maxRow.max_seq + 1;

    for (const alloc of plan) {
      reserve(db, { bin: alloc.bin, qty: alloc.qty });

      const resResult = db
        .prepare(
          `
        INSERT INTO reservations (order_id, order_line_id, sku, bin_code, qty, consumed_qty, released_qty, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 0, 'HELD', ?, ?)
      `
        )
        .run(row.order_id, orderLine.id, row.sku, alloc.bin, alloc.qty, nowIso, nowIso);
      const newResId = Number(resResult.lastInsertRowid);

      const newStopRef = `${row.mission_ref}-S${String(nextStopNo).padStart(2, '0')}`;
      const stopResult = db
        .prepare(
          `
        INSERT INTO pick_stops (mission_id, stop_no, stop_ref, seq, reservation_id, bin_code, sku, qty_required, qty_picked, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING')
      `
        )
        .run(row.mission_id, nextStopNo, newStopRef, nextSeq, newResId, alloc.bin, row.sku, alloc.qty);

      newStops.push({
        id: Number(stopResult.lastInsertRowid),
        stop_ref: newStopRef,
        bin_code: alloc.bin,
        sku: row.sku,
        qty_required: alloc.qty,
        seq: nextSeq
      });

      nextStopNo++;
      nextSeq++;
    }

    db.prepare("UPDATE pick_stops SET status = 'RESOLVED' WHERE id = ?").run(row.stop_id);
  }

  // 6. Mark exception resolved
  db.prepare(
    `
    UPDATE pick_exceptions
    SET status = 'RESOLVED', resolution = ?, resolved_by = ?, resolved_at = ?, resolution_notes = ?
    WHERE id = ?
  `
  ).run(params.action, params.actor.id, nowIso, params.notes || null, row.id);

  // 7. Maybe complete mission
  maybeCompleteMission(db, row.mission_id);

  // 8. Audit & events
  audit(db, {
    actor: { id: params.actor.id, role: params.actor.role },
    action: 'EXCEPTION_RESOLVED',
    entity_type: 'EXCEPTION',
    entity_id: row.ref,
    details: {
      action: params.action,
      notes: params.notes,
      new_stops_count: newStops.length
    }
  });

  emit(db, {
    event_type: 'exception.resolved',
    entity_type: 'EXCEPTION',
    entity_id: row.ref,
    data: { ref: row.ref, resolution: params.action }
  });

  emit(db, {
    event_type: 'inventory.changed',
    entity_type: 'BIN',
    entity_id: row.bin_code,
    data: { bins: [row.bin_code] }
  });

  emit(db, {
    event_type: 'reservation.changed',
    entity_type: 'ORDER',
    entity_id: row.order_ref,
    data: { order_ref: row.order_ref }
  });

  return {
    exception: getException(db, row.ref)!,
    new_stops: newStops
  };
}

export function getException(db: Database.Database, ref: string): PickExceptionDto | null {
  const row = db
    .prepare(
      `
    SELECT
      e.*,
      m.ref AS mission_ref,
      o.ref AS order_ref,
      ps.stop_ref,
      p.name AS product_name,
      u1.display_name AS reporter_name,
      u2.display_name AS resolver_name
    FROM pick_exceptions e
    JOIN missions m ON m.id = e.mission_id
    JOIN orders o ON o.id = e.order_id
    JOIN pick_stops ps ON ps.id = e.stop_id
    JOIN products p ON p.sku = e.sku COLLATE NOCASE
    JOIN users u1 ON u1.id = e.reported_by
    LEFT JOIN users u2 ON u2.id = e.resolved_by
    WHERE e.ref = ?
  `
    )
    .get(ref) as any;

  if (!row) return null;

  return {
    id: row.id,
    ref: row.ref,
    mission_id: row.mission_id,
    mission_ref: row.mission_ref,
    order_id: row.order_id,
    order_ref: row.order_ref,
    stop_id: row.stop_id,
    stop_ref: row.stop_ref,
    bin_code: row.bin_code,
    sku: row.sku,
    product_name: row.product_name,
    type: row.exception_type,
    expected_qty: row.expected_qty,
    actual_qty: row.actual_qty,
    notes: row.notes,
    reported_by: {
      id: row.reported_by,
      name: row.reporter_name
    },
    reported_at: row.reported_at,
    status: row.status,
    resolution: row.resolution,
    resolved_by: row.resolved_by ? { id: row.resolved_by, name: row.resolver_name } : null,
    resolved_at: row.resolved_at,
    resolution_notes: row.resolution_notes
  };
}

export function listExceptions(
  db: Database.Database,
  query: ExceptionQueryInput & { picker_id?: number }
): { exceptions: PickExceptionDto[]; total: number; page: number; page_size: number } {
  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (query.status) {
    where += ' AND e.status = ?';
    params.push(query.status);
  }

  if (query.mission) {
    where += ' AND m.ref = ?';
    params.push(query.mission);
  }

  if (query.mission_id) {
    where += ' AND e.mission_id = ?';
    params.push(query.mission_id);
  }

  if (query.picker_id) {
    where += ' AND m.picker_id = ?';
    params.push(query.picker_id);
  }

  const countRow = db
    .prepare(
      `
    SELECT COUNT(*) AS total
    FROM pick_exceptions e
    JOIN missions m ON m.id = e.mission_id
    ${where}
  `
    )
    .get(...params) as { total: number };

  const total = countRow.total;
  const page = query.page ?? 1;
  const pageSize = query.page_size ?? 25;
  const offset = (page - 1) * pageSize;

  const excRefs = db
    .prepare(
      `
    SELECT e.ref
    FROM pick_exceptions e
    JOIN missions m ON m.id = e.mission_id
    ${where}
    ORDER BY e.id DESC
    LIMIT ? OFFSET ?
  `
    )
    .all(...params, pageSize, offset) as Array<{ ref: string }>;

  const exceptions = excRefs.map((r) => getException(db, r.ref)!).filter(Boolean);

  return {
    exceptions,
    total,
    page,
    page_size: pageSize
  };
}

export function getRerouteInput(
  db: Database.Database,
  missionRef: string
): { start_node: string; pending: Array<{ key: number; bin_code: string; node: string; shelf_code: string; level: number }> } {
  const mission = db.prepare('SELECT id, ref FROM missions WHERE ref = ?').get(missionRef) as any;
  if (!mission) {
    throw new DomainError('NOT_FOUND', `Mission ${missionRef} not found`);
  }

  // Find last finished stop's node
  const lastFinished = db
    .prepare(
      `
    SELECT s.nav_node_id AS node
    FROM pick_stops ps
    JOIN bins b ON b.code = ps.bin_code
    JOIN shelves s ON s.code = b.shelf_code
    WHERE ps.mission_id = ? AND ps.status IN ('PICKED', 'RESOLVED')
    ORDER BY ps.seq DESC
    LIMIT 1
  `
    )
    .get(mission.id) as { node: string } | undefined;

  const start_node = lastFinished?.node || 'DOCK';

  // Get pending stops
  const pendingStops = db
    .prepare(
      `
    SELECT ps.id AS key, ps.bin_code, s.nav_node_id AS node, b.shelf_code, b.level
    FROM pick_stops ps
    JOIN bins b ON b.code = ps.bin_code
    JOIN shelves s ON s.code = b.shelf_code
    WHERE ps.mission_id = ? AND ps.status = 'PENDING'
    ORDER BY ps.seq ASC
  `
    )
    .all(mission.id) as any[];

  return {
    start_node,
    pending: pendingStops
  };
}

export function rerouteMission(
  db: Database.Database,
  missionRef: string,
  route: any,
  orderedStopIds: number[]
): void {
  const mission = db.prepare('SELECT id, ref FROM missions WHERE ref = ?').get(missionRef) as any;
  if (!mission) return;

  // Verify set of pending stop IDs matches
  const currentPending = db
    .prepare("SELECT id FROM pick_stops WHERE mission_id = ? AND status = 'PENDING' ORDER BY seq ASC")
    .all(mission.id) as Array<{ id: number }>;

  const currentIds = new Set(currentPending.map((p) => p.id));
  if (currentIds.size !== orderedStopIds.length || !orderedStopIds.every((id) => currentIds.has(id))) {
    // Set changed, skip reroute silently
    return;
  }

  // Find max finished seq
  const maxFinishedRow = db
    .prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM pick_stops WHERE mission_id = ? AND status IN ('PICKED', 'RESOLVED')")
    .get(mission.id) as { max_seq: number };

  let nextSeq = maxFinishedRow.max_seq + 1;
  for (const stopId of orderedStopIds) {
    db.prepare('UPDATE pick_stops SET seq = ? WHERE id = ?').run(nextSeq++, stopId);
  }

  const updatedRouteJson = JSON.stringify({ ...route, rerouted: true });
  db.prepare('UPDATE missions SET route_json = ?, route_distance = ? WHERE id = ?').run(
    updatedRouteJson,
    route.total_distance,
    mission.id
  );
}
