import Database from 'better-sqlite3';
import { DomainError, transition } from '@dark-storage/shared';
import { nextRef } from './ids.js';
import { audit } from './audit.js';
import { appendOrderEvent } from '../audit/appendAudit.js';
import { emit } from './outbox.js';
import { buildRawMission, createFloorTask } from './pickerRepo.js';
import { toPickerMissionDTO } from '../dto/floorDtos.js';

export function assertBinFree(db: Database.Database, binCode: string): void {
  const bin = db.prepare('SELECT pick_frozen, status FROM bins WHERE code = ?').get(binCode) as
    | { pick_frozen: number; status: string }
    | undefined;

  if (!bin) {
    throw new DomainError('NOT_FOUND', `Bin ${binCode} not found`, {}, 404);
  }

  if (bin.pick_frozen === 1) {
    throw new DomainError('BIN_FROZEN', `Bin ${binCode} is frozen for picking and movements`, { binCode }, 409);
  }

  // Active pick check
  const activePick = db.prepare(`
    SELECT ps.stop_ref
    FROM pick_stops ps
    JOIN missions m ON ps.mission_id = m.id
    WHERE ps.bin_code = ?
      AND m.status IN ('CLAIMED', 'IN_PROGRESS')
      AND ps.step NOT IN ('DONE', 'CANCELLED', 'SHORT')
    LIMIT 1
  `).get(binCode);

  if (activePick) {
    throw new DomainError('BIN_LOCKED', `Bin ${binCode} has an active pick in progress`, { binCode }, 409);
  }
}

export function reportPickException(
  db: Database.Database,
  stopRef: string,
  params: { kind: 'MISSING' | 'DAMAGED' | 'BIN_BLOCKED'; note?: string },
  actor: { id: number; role: string; username: string }
): any {
  return db.transaction(() => {
    const stop = db.prepare('SELECT * FROM pick_stops WHERE stop_ref = ?').get(stopRef) as any;
    if (!stop) {
      throw new DomainError('NOT_FOUND', `Pick stop ${stopRef} not found`, {}, 404);
    }

    const mission = db.prepare('SELECT * FROM missions WHERE id = ?').get(stop.mission_id) as any;
    if (!mission) {
      throw new DomainError('NOT_FOUND', 'Mission not found', {}, 404);
    }

    if (mission.assigned_to !== actor.username) {
      throw new DomainError('MISSION_NOT_OWNED', 'You do not own this mission', {}, 403);
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(mission.order_id) as any;
    const nowIso = new Date().toISOString();
    const excRef = nextRef(db, 'EXC');

    // 1. Insert exception record
    db.prepare(`
      INSERT INTO pick_exceptions (
        ref, exc_ref, mission_id, order_id, stop_id, order_ref, bin_code, sku,
        kind, status, expected_qty, actual_qty, notes, raised_by, raised_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, 'OPEN', ?, ?, ?, ?, ?
      )
    `).run(
      excRef,
      excRef,
      mission.id,
      mission.order_id,
      stop.id,
      order?.ref || null,
      stop.bin_code,
      stop.sku,
      params.kind,
      stop.qty_required,
      stop.qty_picked || 0,
      params.note || null,
      actor.username,
      nowIso
    );

    // 2. Freeze bin
    db.prepare(`
      UPDATE bins
      SET pick_frozen = 1, frozen_reason = ?, frozen_at = ?, frozen_exception_ref = ?
      WHERE code = ?
    `).run(params.kind, nowIso, excRef, stop.bin_code);

    emit(db, {
      event_type: 'bin.frozen',
      entity_type: 'BIN',
      entity_id: stop.bin_code,
      data: { bin_code: stop.bin_code, reason: params.kind, exception_ref: excRef },
    });

    // 3. Reroute attempt: find alternate bin in v_available_stock
    const requiredQty = stop.qty_required - (stop.qty_picked || 0);

    const candidate = db.prepare(`
      SELECT bin_code, available_qty, shelf_code, level
      FROM v_available_stock
      WHERE sku = ? COLLATE NOCASE
        AND bin_code != ?
        AND available_qty >= ?
        AND bin_code NOT IN (
          SELECT ps.bin_code
          FROM pick_stops ps
          JOIN missions m ON ps.mission_id = m.id
          WHERE m.status IN ('CLAIMED', 'IN_PROGRESS')
            AND ps.step NOT IN ('DONE', 'CANCELLED', 'SHORT')
        )
      ORDER BY level ASC, bin_code ASC
      LIMIT 1
    `).get(stop.sku, stop.bin_code, requiredQty) as { bin_code: string; available_qty: number; shelf_code: string } | undefined;

    if (candidate) {
      // Re-route possible!
      // Cancel current stop
      transition('PICK_STOP', stop.step, 'reroute');
      db.prepare(`UPDATE pick_stops SET step = 'CANCELLED', status = 'RESOLVED' WHERE id = ?`).run(stop.id);

      // Renumber subsequent stops in this mission: seq = seq + 1
      db.prepare(`
        UPDATE pick_stops
        SET seq = seq + 1
        WHERE mission_id = ? AND seq > ?
      `).run(mission.id, stop.seq);

      // Create new reservation on candidate bin and release old reservation
      let newReservationId = stop.reservation_id;
      if (stop.reservation_id) {
        const oldRes = db.prepare('SELECT * FROM reservations WHERE id = ?').get(stop.reservation_id) as any;
        db.prepare(`
          UPDATE reservations
          SET released_qty = qty, status = 'RELEASED', updated_at = ?
          WHERE id = ?
        `).run(nowIso, stop.reservation_id);

        const resIns = db.prepare(`
          INSERT INTO reservations (
            order_id, order_line_id, sku, bin_code, qty, consumed_qty, released_qty, status, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, 0, 0, 'HELD', ?, ?
          )
        `).run(
          oldRes?.order_id || (order ? order.id : mission.order_id),
          oldRes?.order_line_id || null,
          stop.sku,
          candidate.bin_code,
          requiredQty,
          nowIso,
          nowIso
        );
        newReservationId = Number(resIns.lastInsertRowid);
      }

      // Create replacement stop right after current stop
      const repStopRef = `${mission.ref}-S${String(stop.seq + 1).padStart(2, '0')}-R`;
      db.prepare(`
        INSERT INTO pick_stops (
          mission_id, stop_no, stop_ref, seq, reservation_id,
          bin_code, sku, qty_required, qty_picked, step, status
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, 0, 'PENDING', 'PENDING'
        )
      `).run(
        mission.id,
        stop.stop_no + 1,
        repStopRef,
        stop.seq + 1,
        newReservationId,
        candidate.bin_code,
        stop.sku,
        requiredQty
      );

      if (order) {
        appendOrderEvent(db, {
          orderRef: order.ref,
          event: 'pick.rerouted',
          actor,
          payload: { stop_ref: stopRef, original_bin: stop.bin_code, new_bin: candidate.bin_code, sku: stop.sku },
        });
      }

      emit(db, {
        event_type: 'pick.rerouted',
        entity_type: 'MISSION',
        entity_id: mission.ref,
        data: { stop_ref: stopRef, original_bin: stop.bin_code, new_bin: candidate.bin_code },
      });
    } else {
      // No alternate bin: mark stop SHORT
      transition('PICK_STOP', stop.step, 'short');
      db.prepare(`UPDATE pick_stops SET step = 'SHORT' WHERE id = ?`).run(stop.id);

      // Record shortfall on order_lines
      if (order) {
        db.prepare(`
          UPDATE order_lines
          SET qty_short = qty_short + ?
          WHERE order_id = ? AND sku = ? COLLATE NOCASE
        `).run(requiredQty, order.id, stop.sku);

        // Release unpicked portion of reservation
        if (stop.reservation_id) {
          db.prepare(`
            UPDATE reservations
            SET released_qty = qty - consumed_qty,
                status = 'RELEASED',
                updated_at = ?
            WHERE id = ?
          `).run(nowIso, stop.reservation_id);
        }

        appendOrderEvent(db, {
          orderRef: order.ref,
          event: 'pick.short',
          actor,
          payload: { stop_ref: stopRef, bin_code: stop.bin_code, sku: stop.sku, short_qty: requiredQty },
        });
      }

      emit(db, {
        event_type: 'pick.short',
        entity_type: 'MISSION',
        entity_id: mission.ref,
        data: { stop_ref: stopRef, short_qty: requiredQty },
      });
    }

    // 4. Create COUNT floor task for frozen bin
    const recountSlaMin = 30;
    const dueAt = new Date(Date.now() + recountSlaMin * 60000).toISOString();

    const countTaskRef = createFloorTask(db, {
      type: 'COUNT',
      binCode: stop.bin_code,
      sku: stop.sku,
      priority: 90,
      dueAt,
      createdBy: actor.username,
      orderRef: order?.ref || undefined,
    });

    db.prepare(`
      UPDATE pick_exceptions
      SET count_task_ref = ?, status = 'COUNT_REQUESTED', due_at = ?
      WHERE ref = ?
    `).run(countTaskRef, dueAt, excRef);

    audit(db, {
      actor,
      action: 'EXCEPTION_RAISED',
      entity_type: 'EXCEPTION',
      entity_id: excRef,
      details: { kind: params.kind, bin_code: stop.bin_code, sku: stop.sku, count_task_ref: countTaskRef },
    });

    emit(db, {
      event_type: 'exception.raised',
      entity_type: 'EXCEPTION',
      entity_id: excRef,
      data: { exc_ref: excRef, kind: params.kind, bin_code: stop.bin_code },
    });

    // Return refreshed PickerMissionDTO
    const raw = buildRawMission(db, mission.ref)!;
    return toPickerMissionDTO(raw);
  })();
}

export function getExceptions(db: Database.Database, queryStatus?: string): { items: any[] } {
  const where = queryStatus ? 'WHERE status = ?' : '';
  const rows = db.prepare(`
    SELECT id, ref, exc_ref, mission_id, order_id, order_ref, bin_code, sku,
           kind, status, expected_qty, actual_qty, notes, raised_by, raised_at,
           escalated, due_at, resolved_by, resolution, resolution_reason, resolved_at,
           count_task_ref
    FROM pick_exceptions
    ${where}
    ORDER BY escalated DESC, raised_at ASC
  `).all(...(queryStatus ? [queryStatus] : [])) as any[];

  const now = Date.now();
  const items = rows.map((r) => {
    const ageMinutes = r.raised_at ? Math.round((now - new Date(r.raised_at).getTime()) / 60000) : 0;
    return {
      ...r,
      age_minutes: ageMinutes,
      escalated: r.escalated === 1,
    };
  });

  return { items, exceptions: items, total: items.length, page: 1, page_size: items.length };
}

export function requestCountForException(
  db: Database.Database,
  excRef: string,
  note: string | undefined,
  actor: { id: number; role: string; username: string }
): { ok: boolean; taskRef: string } {
  return db.transaction(() => {
    const exc = db.prepare('SELECT * FROM pick_exceptions WHERE ref = ?').get(excRef) as any;
    if (!exc) {
      throw new DomainError('NOT_FOUND', `Exception ${excRef} not found`, {}, 404);
    }

    const taskRef = createFloorTask(db, {
      type: 'COUNT',
      binCode: exc.bin_code,
      sku: exc.sku,
      priority: 90,
      createdBy: actor.username,
      orderRef: exc.order_ref || undefined,
      payload: { note },
    });

    db.prepare(`
      UPDATE pick_exceptions
      SET count_task_ref = ?, status = 'COUNT_REQUESTED', notes = COALESCE(notes, '') || ' ' || ?
      WHERE ref = ?
    `).run(taskRef, note || '', excRef);

    audit(db, {
      actor,
      action: 'COUNT_REQUESTED',
      entity_type: 'EXCEPTION',
      entity_id: excRef,
      details: { task_ref: taskRef, note },
    });

    return { ok: true, taskRef };
  })();
}

export function resolveException(
  db: Database.Database,
  excRef: string,
  params: { reasonCode: string; note?: string; unfreeze?: boolean },
  actor: { id: number; role: string; username: string }
): { ok: boolean; status: string; unfreeze: boolean } {
  return db.transaction(() => {
    const exc = db.prepare('SELECT * FROM pick_exceptions WHERE ref = ?').get(excRef) as any;
    if (!exc) {
      throw new DomainError('NOT_FOUND', `Exception ${excRef} not found`, {}, 404);
    }

    // Allowed in COUNT_SUBMITTED or OPEN with reason OTHER
    if (exc.status !== 'COUNT_SUBMITTED' && !(exc.status === 'OPEN' && exc.kind === 'BIN_BLOCKED')) {
      throw new DomainError('STATE_CONFLICT', `Exception is in status ${exc.status}, expected COUNT_SUBMITTED`, {}, 409);
    }

    // Require no pending adjustments on the same bin
    const pendingAdj = db.prepare(`
      SELECT id FROM inventory_adjustments
      WHERE bin_code = ? AND status IN ('PENDING_MANAGER', 'PENDING_ADMIN')
      LIMIT 1
    `).get(exc.bin_code);

    if (pendingAdj) {
      throw new DomainError('STATE_CONFLICT', 'Approve or reject pending adjustments for this bin before resolving exception', {}, 409);
    }

    const nowIso = new Date().toISOString();
    transition('EXCEPTION', exc.status, 'resolve');

    db.prepare(`
      UPDATE pick_exceptions
      SET status = 'RESOLVED',
          resolution = ?,
          resolution_reason = ?,
          resolved_by = ?,
          resolved_at = ?
      WHERE ref = ?
    `).run(params.reasonCode, params.note || null, actor.username, nowIso, excRef);

    const shouldUnfreeze = params.unfreeze !== false;
    if (shouldUnfreeze) {
      db.prepare(`
        UPDATE bins
        SET pick_frozen = 0, frozen_reason = NULL, frozen_at = NULL, frozen_exception_ref = NULL
        WHERE code = ?
      `).run(exc.bin_code);

      emit(db, {
        event_type: 'bin.unfrozen',
        entity_type: 'BIN',
        entity_id: exc.bin_code,
        data: { bin_code: exc.bin_code, exception_ref: excRef },
      });
    }

    audit(db, {
      actor,
      action: 'EXCEPTION_RESOLVED',
      entity_type: 'EXCEPTION',
      entity_id: excRef,
      details: { resolution: params.reasonCode, unfreeze: shouldUnfreeze },
    });

    return { ok: true, status: 'RESOLVED', unfreeze: shouldUnfreeze };
  })();
}

export function getExceptionRates(db: Database.Database): { rates: any[] } {
  const rows = db.prepare(`
    SELECT pe.raised_by as picker,
           COUNT(*) as exception_count
    FROM pick_exceptions pe
    GROUP BY pe.raised_by
    ORDER BY exception_count DESC
  `).all() as any[];

  return { rates: rows };
}
