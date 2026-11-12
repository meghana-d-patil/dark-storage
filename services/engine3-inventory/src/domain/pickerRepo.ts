import Database from 'better-sqlite3';
import {
  DomainError,
  matchesBin,
  matchesSku,
  matchesTote,
  normalizeScan,
  transition,
  PickerMissionDTO,
} from '@dark-storage/shared';
import { nextRef } from './ids.js';
import { audit } from './audit.js';
import { appendOrderEvent } from '../audit/appendAudit.js';
import { emit } from './outbox.js';
import { postLedger, ensureLot } from '../ledger/postLedger.js';
import { toPickerMissionDTO, RawMissionRow, RawStopRow } from '../dto/floorDtos.js';

export function getMissionLeaseSeconds(db: Database.Database): number {
  const row = db.prepare("SELECT value FROM system_config WHERE key = 'lease.mission_seconds'").get() as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) || 60 : 60;
}

export function getFloorTaskLeaseSeconds(db: Database.Database): number {
  const row = db.prepare("SELECT value FROM system_config WHERE key = 'lease.floor_task_seconds'").get() as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) || 120 : 120;
}

export function buildRawMission(db: Database.Database, missionRef: string): RawMissionRow | null {
  const mission = db.prepare('SELECT * FROM missions WHERE ref = ?').get(missionRef) as any;
  if (!mission) return null;

  const order = db.prepare('SELECT ref FROM orders WHERE id = ?').get(mission.order_id) as { ref: string } | undefined;

  const stops = db
    .prepare(
      `
    SELECT
      ps.id,
      ps.stop_no,
      ps.stop_ref,
      ps.seq,
      ps.reservation_id,
      ps.bin_code,
      s.aisle,
      ps.sku,
      p.name AS product_name,
      p.barcode,
      ps.qty_required,
      ps.qty_picked,
      ps.step,
      ps.status
    FROM pick_stops ps
    JOIN products p ON ps.sku = p.sku
    JOIN bins b ON ps.bin_code = b.code
    JOIN shelves s ON b.shelf_code = s.code
    WHERE ps.mission_id = ?
    ORDER BY ps.seq ASC
  `
    )
    .all(mission.id) as any[];

  return {
    ref: mission.ref,
    status: mission.status,
    lease_expires_at: mission.lease_expires_at || null,
    tote_code: mission.tote_code || null,
    stops: stops.map((s) => ({
      stop_ref: s.stop_ref,
      seq: s.seq,
      bin_code: s.bin_code,
      aisle: s.aisle,
      sku: s.sku,
      product_name: s.product_name,
      qty_required: s.qty_required,
      qty_picked: s.qty_picked || 0,
      step: s.step || 'PENDING',
      tote_code: mission.tote_code || null,
      order_ref: order?.ref || null,
    })),
  };
}

export function getActivePickerMission(
  db: Database.Database,
  actor: { username: string; id?: number }
): PickerMissionDTO {
  const mission = db
    .prepare(
      `
    SELECT ref FROM missions
    WHERE (assigned_to = ? OR picker_id = ?)
      AND status IN ('CLAIMED', 'IN_PROGRESS')
    ORDER BY claimed_at DESC LIMIT 1
  `
    )
    .get(actor.username, actor.id || 0) as { ref: string } | undefined;

  if (!mission) {
    throw new DomainError('NO_MISSION_AVAILABLE', 'No active mission found for this picker', {}, 404);
  }

  const raw = buildRawMission(db, mission.ref);
  if (!raw) {
    throw new DomainError('NO_MISSION_AVAILABLE', 'Mission record not found', {}, 404);
  }

  return toPickerMissionDTO(raw);
}

export function claimNextMission(
  db: Database.Database,
  actor: { id: number; username: string; role: string; zones?: string[] }
): PickerMissionDTO {
  const leaseSec = getMissionLeaseSeconds(db);

  return db.transaction(() => {
    // 1. Check if user already holds active mission
    const active = db
      .prepare(
        `
      SELECT ref FROM missions
      WHERE assigned_to = ? AND status IN ('CLAIMED', 'IN_PROGRESS')
      LIMIT 1
    `
      )
      .get(actor.username) as { ref: string } | undefined;

    if (active) {
      throw new DomainError('ACTIVE_MISSION_EXISTS', 'You already have an active mission claimed', {
        mission_ref: active.ref,
      });
    }

    // 2. Query QUEUED or unassigned ASSIGNED candidate missions
    const candidates = db
      .prepare(
        `
      SELECT m.id, m.ref, m.order_id, m.priority, m.version, m.status, o.ref as order_ref
      FROM missions m
      JOIN orders o ON m.order_id = o.id
      WHERE m.status IN ('QUEUED', 'ASSIGNED')
        AND (m.assigned_to IS NULL OR m.assigned_to = '')
      ORDER BY m.priority DESC, m.sla_due_at ASC, m.assigned_at ASC
    `
      )
      .all() as Array<{
      id: number;
      ref: string;
      order_id: number;
      priority: number;
      version: number;
      status: string;
      order_ref: string;
    }>;

    if (candidates.length === 0) {
      throw new DomainError('NO_MISSION_AVAILABLE', 'No missions available to claim', {}, 404);
    }

    const zones = actor.zones || [];
    const nowIso = new Date().toISOString();
    const leaseExpiresIso = new Date(Date.now() + leaseSec * 1000).toISOString();

    for (const cand of candidates) {
      // Zone match check: if zones array is not empty, check if candidate's stops match any zone
      if (zones.length > 0) {
        const stopBins = db
          .prepare('SELECT bin_code FROM pick_stops WHERE mission_id = ?')
          .all(cand.id) as Array<{ bin_code: string }>;
        const matchesAnyZone = stopBins.some((sb) => zones.some((z) => sb.bin_code.startsWith(z)));
        if (!matchesAnyZone) {
          continue;
        }
      }

      // Valid transition check
      transition('MISSION', cand.status === 'ASSIGNED' ? 'QUEUED' : cand.status, 'claim');

      // Optimistic lock update
      const res = db
        .prepare(
          `
        UPDATE missions
        SET status = 'CLAIMED',
            assigned_to = @assigned_to,
            picker_id = @picker_id,
            claimed_at = @now,
            lease_expires_at = @lease_expires,
            last_heartbeat_at = @now,
            version = version + 1
        WHERE id = @id AND version = @version AND status IN ('QUEUED', 'ASSIGNED')
      `
        )
        .run({
          assigned_to: actor.username,
          picker_id: actor.id,
          now: nowIso,
          lease_expires: leaseExpiresIso,
          id: cand.id,
          version: cand.version,
        });

      if (res.changes === 1) {
        // Also transition order to ASSIGNED
        const orderRow = db.prepare('SELECT status, ref FROM orders WHERE id = ?').get(cand.order_id) as
          | { status: string; ref: string }
          | undefined;

        if (orderRow && orderRow.status !== 'ASSIGNED') {
          db.prepare('UPDATE orders SET status = \'ASSIGNED\', updated_at = ? WHERE id = ?').run(
            nowIso,
            cand.order_id
          );
        }

        appendOrderEvent(db, {
          orderRef: cand.order_ref,
          event: 'mission.claimed',
          actor: { id: actor.id, role: actor.role },
          payload: { mission_ref: cand.ref, picker: actor.username },
        });

        audit(db, {
          actor: { id: actor.id, role: actor.role },
          action: 'MISSION_CLAIMED',
          entity_type: 'MISSION',
          entity_id: cand.ref,
          details: {
            order_ref: cand.order_ref,
            picker: actor.username,
            lease_expires_at: leaseExpiresIso,
          },
        });

        emit(db, {
          event_type: 'mission.claimed',
          entity_type: 'MISSION',
          entity_id: cand.ref,
          data: { ref: cand.ref, order_ref: cand.order_ref, picker: actor.username },
        });

        const raw = buildRawMission(db, cand.ref)!;
        return toPickerMissionDTO(raw);
      }
    }

    throw new DomainError('NO_MISSION_AVAILABLE', 'No matching missions available to claim', {}, 404);
  })();
}

export function heartbeatMission(
  db: Database.Database,
  missionRef: string,
  actor: { username: string }
): { ok: boolean; lease_expires_at: string } {
  const mission = db.prepare('SELECT * FROM missions WHERE ref = ?').get(missionRef) as any;
  if (!mission) {
    throw new DomainError('NOT_FOUND', `Mission ${missionRef} not found`, {}, 404);
  }

  if (mission.assigned_to !== actor.username) {
    throw new DomainError('MISSION_NOT_OWNED', 'You do not own this mission', {}, 403);
  }

  const now = Date.now();
  if (mission.lease_expires_at && new Date(mission.lease_expires_at).getTime() < now) {
    throw new DomainError('MISSION_LEASE_EXPIRED', 'Mission lease expired, please claim again', {}, 409);
  }

  const leaseSec = getMissionLeaseSeconds(db);
  const leaseExpiresIso = new Date(now + leaseSec * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  db.prepare(
    `
    UPDATE missions
    SET lease_expires_at = ?, last_heartbeat_at = ?
    WHERE id = ?
  `
  ).run(leaseExpiresIso, nowIso, mission.id);

  return { ok: true, lease_expires_at: leaseExpiresIso };
}

export function releaseMission(
  db: Database.Database,
  missionRef: string,
  actor: { username: string; id?: number; role?: string }
): { ok: boolean } {
  return db.transaction(() => {
    const mission = db.prepare('SELECT * FROM missions WHERE ref = ?').get(missionRef) as any;
    if (!mission) {
      throw new DomainError('NOT_FOUND', `Mission ${missionRef} not found`, {}, 404);
    }

    if (mission.assigned_to !== actor.username) {
      throw new DomainError('MISSION_NOT_OWNED', 'You do not own this mission', {}, 403);
    }

    transition('MISSION', mission.status, 'release');

    db.prepare(
      `
      UPDATE missions
      SET status = 'QUEUED', assigned_to = NULL, lease_expires_at = NULL, version = version + 1
      WHERE id = ?
    `
    ).run(mission.id);

    audit(db, {
      actor: { id: actor.id || 0, role: actor.role || 'PICKER' },
      action: 'MISSION_RELEASED',
      entity_type: 'MISSION',
      entity_id: missionRef,
      details: { picker: actor.username },
    });

    emit(db, {
      event_type: 'mission.released',
      entity_type: 'MISSION',
      entity_id: missionRef,
      data: { ref: missionRef, picker: actor.username },
    });

    return { ok: true };
  })();
}

export function forceUnassignMission(
  db: Database.Database,
  missionRef: string,
  actor: { id: number; role: string },
  reasonCode: string,
  note?: string
): { ok: boolean } {
  return db.transaction(() => {
    const mission = db.prepare('SELECT * FROM missions WHERE ref = ?').get(missionRef) as any;
    if (!mission) {
      throw new DomainError('NOT_FOUND', `Mission ${missionRef} not found`, {}, 404);
    }

    const prevPicker = mission.assigned_to;
    db.prepare(
      `
      UPDATE missions
      SET status = 'QUEUED', assigned_to = NULL, lease_expires_at = NULL, version = version + 1
      WHERE id = ?
    `
    ).run(mission.id);

    const order = db.prepare('SELECT ref FROM orders WHERE id = ?').get(mission.order_id) as
      | { ref: string }
      | undefined;

    if (order) {
      appendOrderEvent(db, {
        orderRef: order.ref,
        event: 'mission.force_unassigned',
        actor: { id: actor.id, role: actor.role },
        payload: { mission_ref: missionRef, previous_picker: prevPicker, reason_code: reasonCode, note },
      });
    }

    audit(db, {
      actor: { id: actor.id, role: actor.role },
      action: 'MISSION_FORCE_UNASSIGNED',
      entity_type: 'MISSION',
      entity_id: missionRef,
      details: { previous_picker: prevPicker, reason_code: reasonCode, note },
    });

    emit(db, {
      event_type: 'mission.unassigned',
      entity_type: 'MISSION',
      entity_id: missionRef,
      data: { ref: missionRef, previous_picker: prevPicker, reason_code: reasonCode },
    });

    return { ok: true };
  })();
}

function checkPickerOwnsStop(
  db: Database.Database,
  stopRef: string,
  actorUsername: string
): { stop: any; mission: any; order: any } {
  const stop = db.prepare('SELECT * FROM pick_stops WHERE stop_ref = ?').get(stopRef) as any;
  if (!stop) {
    throw new DomainError('NOT_FOUND', `Pick stop ${stopRef} not found`, {}, 404);
  }

  const mission = db.prepare('SELECT * FROM missions WHERE id = ?').get(stop.mission_id) as any;
  if (!mission) {
    throw new DomainError('NOT_FOUND', 'Mission not found', {}, 404);
  }

  if (mission.assigned_to !== actorUsername) {
    throw new DomainError('MISSION_NOT_OWNED', 'You are not the assigned picker for this mission', {}, 403);
  }

  const now = Date.now();
  if (mission.lease_expires_at && new Date(mission.lease_expires_at).getTime() < now) {
    throw new DomainError('MISSION_LEASE_EXPIRED', 'Mission lease expired, please claim again', {}, 409);
  }

  // Stop sequence check: must be the first stop with step NOT IN ('DONE', 'SHORT')
  const priorPending = db
    .prepare(
      `
    SELECT stop_ref FROM pick_stops
    WHERE mission_id = ? AND seq < ? AND step NOT IN ('DONE', 'SHORT')
    ORDER BY seq ASC LIMIT 1
  `
    )
    .get(mission.id, stop.seq) as { stop_ref: string } | undefined;

  if (priorPending) {
    throw new DomainError(
      'SCAN_OUT_OF_SEQUENCE',
      `Please complete prior stop ${priorPending.stop_ref} first`,
      { expectedStop: priorPending.stop_ref },
      422
    );
  }

  const order = db.prepare('SELECT id, ref, status FROM orders WHERE id = ?').get(mission.order_id) as any;

  return { stop, mission, order };
}

function recordScanRejection(
  db: Database.Database,
  orderRef: string | null | undefined,
  actor: { id: number; role: string },
  payload: Record<string, any>
) {
  if (!orderRef) return;
  try {
    appendOrderEvent(db, {
      orderRef,
      event: 'scan.rejected',
      actor,
      payload,
    });
  } catch (err) {
    // Best effort logging
  }
}

export function scanBin(
  db: Database.Database,
  stopRef: string,
  scan: string,
  actor: { username: string; id: number; role: string }
): { ok: boolean; step: string; mission: PickerMissionDTO } {
  const { stop, mission, order } = checkPickerOwnsStop(db, stopRef, actor.username);

  if (stop.step !== 'PENDING') {
    throw new DomainError('STATE_CONFLICT', `Stop is in step ${stop.step}, expected PENDING`, {}, 409);
  }

  if (!matchesBin(scan, stop.bin_code)) {
    recordScanRejection(db, order?.ref, actor, {
      stop_ref: stopRef,
      expected_bin: stop.bin_code,
      scanned: scan,
      step: 'SCAN_BIN',
    });
    throw new DomainError(
      'SCAN_WRONG_BIN',
      `Scanned bin '${scan}' does not match expected bin '${stop.bin_code}'`,
      { expectedBin: stop.bin_code, scanned: scan },
      422
    );
  }

  return db.transaction(() => {
    const nowIso = new Date().toISOString();
    const leaseSec = getMissionLeaseSeconds(db);
    const leaseExpiresIso = new Date(Date.now() + leaseSec * 1000).toISOString();

    // Valid transition on pick_stop
    transition('PICK_STOP', 'PENDING', 'scan_bin');

    db.prepare("UPDATE pick_stops SET step = 'BIN_OK', bin_scanned_at = ? WHERE id = ?").run(nowIso, stop.id);

    // If first scan of mission: CLAIMED -> IN_PROGRESS, order -> PICKING
    if (mission.status === 'CLAIMED') {
      transition('MISSION', 'CLAIMED', 'first_scan');
      db.prepare(
        `
        UPDATE missions
        SET status = 'IN_PROGRESS', started_at = ?, lease_expires_at = ?, last_heartbeat_at = ?
        WHERE id = ?
      `
      ).run(nowIso, leaseExpiresIso, nowIso, mission.id);

      if (order && order.status !== 'PICKING') {
        transition('ORDER', order.status, 'start_pick');
        db.prepare("UPDATE orders SET status = 'PICKING', updated_at = ? WHERE id = ?").run(nowIso, order.id);
      }
    } else {
      db.prepare('UPDATE missions SET lease_expires_at = ?, last_heartbeat_at = ? WHERE id = ?').run(
        leaseExpiresIso,
        nowIso,
        mission.id
      );
    }

    const raw = buildRawMission(db, mission.ref)!;
    return { ok: true, step: 'SCAN_ITEM', mission: toPickerMissionDTO(raw) };
  })();
}

export function scanItem(
  db: Database.Database,
  stopRef: string,
  scan: string,
  qty: number,
  actor: { username: string; id: number; role: string }
): { ok: boolean; step: string; mission: PickerMissionDTO } {
  const { stop, mission, order } = checkPickerOwnsStop(db, stopRef, actor.username);

  if (stop.step !== 'BIN_OK') {
    throw new DomainError('STATE_CONFLICT', `Stop is in step ${stop.step}, expected BIN_OK`, {}, 409);
  }

  const product = db.prepare('SELECT sku, barcode FROM products WHERE sku = ?').get(stop.sku) as
    | { sku: string; barcode?: string | null }
    | undefined;

  if (!product || !matchesSku(scan, product)) {
    recordScanRejection(db, order?.ref, actor, {
      stop_ref: stopRef,
      expected_sku: stop.sku,
      scanned: scan,
      step: 'SCAN_ITEM',
    });
    throw new DomainError(
      'SCAN_WRONG_ITEM',
      `Scanned item '${scan}' does not match expected SKU '${stop.sku}'`,
      { expectedSku: stop.sku, scanned: scan },
      422
    );
  }

  const remainingQty = stop.qty_required - (stop.qty_picked || 0);
  if (!Number.isInteger(qty) || qty <= 0 || qty > remainingQty) {
    throw new DomainError(
      'SCAN_QTY_EXCEEDS',
      `Quantity ${qty} exceeds remaining required quantity ${remainingQty}`,
      { requested: qty, remaining: remainingQty },
      422
    );
  }

  return db.transaction(() => {
    const nowIso = new Date().toISOString();
    const leaseSec = getMissionLeaseSeconds(db);
    const leaseExpiresIso = new Date(Date.now() + leaseSec * 1000).toISOString();

    transition('PICK_STOP', 'BIN_OK', 'scan_item');

    db.prepare(
      `
      UPDATE pick_stops
      SET step = 'ITEM_OK', qty_picked = qty_picked + ?, item_scanned_at = ?
      WHERE id = ?
    `
    ).run(qty, nowIso, stop.id);

    db.prepare('UPDATE missions SET lease_expires_at = ?, last_heartbeat_at = ? WHERE id = ?').run(
      leaseExpiresIso,
      nowIso,
      mission.id
    );

    const raw = buildRawMission(db, mission.ref)!;
    return { ok: true, step: 'SCAN_TOTE', mission: toPickerMissionDTO(raw) };
  })();
}

export function scanTote(
  db: Database.Database,
  stopRef: string,
  scan: string,
  actor: { username: string; id: number; role: string }
): { ok: boolean; step: string; mission: PickerMissionDTO } {
  const { stop, mission, order } = checkPickerOwnsStop(db, stopRef, actor.username);

  if (stop.step !== 'ITEM_OK') {
    throw new DomainError('STATE_CONFLICT', `Stop is in step ${stop.step}, expected ITEM_OK`, {}, 409);
  }

  const normalizedScan = normalizeScan(scan);
  if (!matchesTote(normalizedScan, normalizedScan)) {
    throw new DomainError('VALIDATION_FAILED', `Invalid tote format '${scan}'`, {}, 400);
  }

  let assignedTote = mission.tote_code;
  if (!assignedTote) {
    const toteRow = db.prepare('SELECT tote_code, status FROM totes WHERE tote_code = ?').get(normalizedScan) as
      | { tote_code: string; status: string }
      | undefined;

    if (!toteRow) {
      throw new DomainError('NOT_FOUND', `Tote '${normalizedScan}' not found`, {}, 404);
    }

    if (toteRow.status !== 'FREE') {
      throw new DomainError('TOTE_IN_USE', `Tote '${normalizedScan}' is currently ${toteRow.status}`, {}, 422);
    }
  } else {
    if (!matchesTote(normalizedScan, assignedTote)) {
      recordScanRejection(db, order?.ref, actor, {
        stop_ref: stopRef,
        expected_tote: assignedTote,
        scanned: scan,
        step: 'SCAN_TOTE',
      });
      throw new DomainError(
        'SCAN_WRONG_TOTE',
        `Scanned tote '${scan}' does not match assigned mission tote '${assignedTote}'`,
        { expectedTote: assignedTote, scanned: scan },
        422
      );
    }
  }

  return db.transaction(() => {
    const nowIso = new Date().toISOString();
    let effectiveTote = mission.tote_code;

    if (!effectiveTote) {
      const toteRow = db.prepare('SELECT tote_code, status FROM totes WHERE tote_code = ?').get(normalizedScan) as
        | { tote_code: string; status: string }
        | undefined;

      if (!toteRow || toteRow.status !== 'FREE') {
        throw new DomainError('TOTE_IN_USE', `Tote '${normalizedScan}' is currently in use`, {}, 422);
      }

      effectiveTote = toteRow.tote_code;
      db.prepare(
        `
        UPDATE totes
        SET status = 'IN_USE', mission_ref = ?, order_ref = ?, updated_at = ?
        WHERE tote_code = ?
      `
      ).run(mission.ref, order?.ref || null, nowIso, effectiveTote);

      db.prepare('UPDATE missions SET tote_code = ? WHERE id = ?').run(effectiveTote, mission.id);
    }

    // 1. Post to ledger: BIN -> TOTE
    const lotRow = db
      .prepare(
        `
      SELECT lot_id FROM location_balances
      WHERE location_key = ? AND sku = ? AND qty > 0
      ORDER BY qty DESC LIMIT 1
    `
      )
      .get(`BIN:${stop.bin_code}`, stop.sku) as { lot_id: string } | undefined;

    const lotId = lotRow?.lot_id || stop.lot_id || `LOT-LEGACY-${stop.sku}`;
    ensureLot(db, {
      lotId,
      sku: stop.sku,
    });

    postLedger(
      db,
      [
        {
          sku: stop.sku,
          lotId,
          qty: stop.qty_picked,
          from: `BIN:${stop.bin_code}`,
          to: `TOTE:${effectiveTote}`,
          type: 'PICK',
          orderRef: order?.ref || undefined,
          refType: 'PICK_STOP',
          refId: stop.stop_ref,
        },
      ],
      { id: String(actor.id) }
    );

    // 2. Consume reservation
    db.prepare(
      `
      UPDATE reservations
      SET consumed_qty = consumed_qty + @qty,
          status = CASE WHEN consumed_qty + @qty + released_qty >= qty THEN 'CONSUMED' ELSE 'HELD' END,
          updated_at = @now
      WHERE id = @res_id
    `
    ).run({
      qty: stop.qty_picked,
      now: nowIso,
      res_id: stop.reservation_id,
    });

    // 3. Mark stop DONE
    transition('PICK_STOP', 'ITEM_OK', 'scan_tote');

    db.prepare(
      `
      UPDATE pick_stops
      SET step = 'DONE', status = 'PICKED', tote_scanned_at = ?, confirmed_at = ?, lot_id = ?
      WHERE id = ?
    `
    ).run(nowIso, nowIso, lotId, stop.id);

    // 4. Check if all stops in mission are DONE or SHORT
    const allStops = db
      .prepare('SELECT step FROM pick_stops WHERE mission_id = ?')
      .all(mission.id) as Array<{ step: string }>;

    const allFinished = allStops.every((s) => s.step === 'DONE' || s.step === 'SHORT');

    if (allFinished) {
      transition('MISSION', 'IN_PROGRESS', 'complete');
      db.prepare("UPDATE missions SET status = 'COMPLETED', completed_at = ? WHERE id = ?").run(
        nowIso,
        mission.id
      );

      // Tote lifecycle: AWAITING_PACK
      db.prepare("UPDATE totes SET status = 'AWAITING_PACK', updated_at = ? WHERE tote_code = ?").run(
        nowIso,
        assignedTote
      );

      if (order) {
        transition('ORDER', 'PICKING', 'pick_complete');
        db.prepare("UPDATE orders SET status = 'PICKED', updated_at = ? WHERE id = ?").run(nowIso, order.id);

        appendOrderEvent(db, {
          orderRef: order.ref,
          event: 'order.picked',
          actor: { id: actor.id, role: actor.role },
          payload: { mission_ref: mission.ref, tote_code: assignedTote },
        });
      }

      audit(db, {
        actor: { id: actor.id, role: actor.role },
        action: 'MISSION_COMPLETED',
        entity_type: 'MISSION',
        entity_id: mission.ref,
        details: { order_ref: order?.ref, tote_code: assignedTote },
      });

      emit(db, {
        event_type: 'mission.completed',
        entity_type: 'MISSION',
        entity_id: mission.ref,
        data: { ref: mission.ref, order_ref: order?.ref, tote_code: assignedTote },
      });
    }

    const leaseSec = getMissionLeaseSeconds(db);
    const leaseExpiresIso = new Date(Date.now() + leaseSec * 1000).toISOString();
    db.prepare('UPDATE missions SET lease_expires_at = ?, last_heartbeat_at = ? WHERE id = ?').run(
      leaseExpiresIso,
      nowIso,
      mission.id
    );

    const raw = buildRawMission(db, mission.ref)!;
    return { ok: true, step: 'DONE', mission: toPickerMissionDTO(raw) };
  })();
}

// Floor Tasks
export interface CreateFloorTaskInput {
  type: 'COUNT' | 'RELOCATE' | 'REPLENISH' | 'PUTBACK' | 'REPICK' | 'EXPIRY_REMOVE';
  binCode?: string;
  destBinCode?: string;
  sku?: string;
  lotId?: string;
  qty?: number;
  orderRef?: string;
  sourceRef?: string;
  priority?: number;
  dueAt?: string;
  payload?: any;
  createdBy?: string;
}

export function createFloorTask(db: Database.Database, input: CreateFloorTaskInput): string {
  const taskRef = nextRef(db, 'FT');
  const nowIso = new Date().toISOString();

  db.prepare(
    `
    INSERT INTO floor_tasks (
      task_ref, type, status, bin_code, dest_bin_code, sku, lot_id,
      qty, order_ref, source_ref, priority, due_at, payload, created_by, created_at
    ) VALUES (
      @task_ref, @type, 'OPEN', @bin_code, @dest_bin_code, @sku, @lot_id,
      @qty, @order_ref, @source_ref, @priority, @due_at, @payload, @created_by, @created_at
    )
  `
  ).run({
    task_ref: taskRef,
    type: input.type,
    bin_code: input.binCode || null,
    dest_bin_code: input.destBinCode || null,
    sku: input.sku || null,
    lot_id: input.lotId || null,
    qty: input.qty || null,
    order_ref: input.orderRef || null,
    source_ref: input.sourceRef || null,
    priority: input.priority || 0,
    due_at: input.dueAt || null,
    payload: input.payload ? JSON.stringify(input.payload) : null,
    created_by: input.createdBy || 'SYSTEM',
    created_at: nowIso,
  });

  audit(db, {
    actor: { id: 0, role: 'SYSTEM' },
    action: 'FLOOR_TASK_CREATED',
    entity_type: 'FLOOR_TASK',
    entity_id: taskRef,
    details: { type: input.type, bin_code: input.binCode, sku: input.sku },
  });

  emit(db, {
    event_type: 'floortask.created',
    entity_type: 'FLOOR_TASK',
    entity_id: taskRef,
    data: { ref: taskRef, type: input.type },
  });

  return taskRef;
}

export function getFloorTasks(
  db: Database.Database,
  filters: { status?: string; type?: string; assigned_to?: string }
): any[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.type) {
    conditions.push('type = ?');
    params.push(filters.type);
  }
  if (filters.assigned_to) {
    conditions.push('assigned_to = ?');
    params.push(filters.assigned_to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db
    .prepare(
      `
    SELECT id, task_ref, type, status, bin_code, dest_bin_code, sku, lot_id,
           qty, order_ref, source_ref, priority, due_at, assigned_to, lease_expires_at,
           payload, created_by, created_at, completed_at, version
    FROM floor_tasks
    ${whereClause}
    ORDER BY priority DESC, created_at ASC
  `
    )
    .all(...params);
}

export function claimFloorTask(
  db: Database.Database,
  taskRef: string,
  actor: { username: string; id: number; role: string }
): any {
  const leaseSec = getFloorTaskLeaseSeconds(db);

  return db.transaction(() => {
    const task = db.prepare('SELECT * FROM floor_tasks WHERE task_ref = ?').get(taskRef) as any;
    if (!task) {
      throw new DomainError('NOT_FOUND', `Floor task ${taskRef} not found`, {}, 404);
    }

    if (task.status !== 'OPEN') {
      throw new DomainError('STATE_CONFLICT', `Floor task is in status ${task.status}, expected OPEN`, {}, 409);
    }

    transition('FLOOR_TASK', 'OPEN', 'claim');

    const now = Date.now();
    const leaseExpiresIso = new Date(now + leaseSec * 1000).toISOString();

    const res = db
      .prepare(
        `
      UPDATE floor_tasks
      SET status = 'CLAIMED', assigned_to = ?, lease_expires_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = 'OPEN'
    `
      )
      .run(actor.username, leaseExpiresIso, task.id, task.version);

    if (res.changes !== 1) {
      throw new DomainError('VERSION_CONFLICT', 'Floor task was claimed by another worker', {}, 409);
    }

    audit(db, {
      actor: { id: actor.id, role: actor.role },
      action: 'FLOOR_TASK_CLAIMED',
      entity_type: 'FLOOR_TASK',
      entity_id: taskRef,
      details: { assigned_to: actor.username },
    });

    return db.prepare('SELECT * FROM floor_tasks WHERE id = ?').get(task.id);
  })();
}

export function heartbeatFloorTask(
  db: Database.Database,
  taskRef: string,
  actor: { username: string }
): { ok: boolean; lease_expires_at: string } {
  const task = db.prepare('SELECT * FROM floor_tasks WHERE task_ref = ?').get(taskRef) as any;
  if (!task) {
    throw new DomainError('NOT_FOUND', `Floor task ${taskRef} not found`, {}, 404);
  }

  if (task.assigned_to !== actor.username) {
    throw new DomainError('FORBIDDEN', 'You do not own this floor task', {}, 403);
  }

  const leaseSec = getFloorTaskLeaseSeconds(db);
  const leaseExpiresIso = new Date(Date.now() + leaseSec * 1000).toISOString();

  db.prepare('UPDATE floor_tasks SET lease_expires_at = ? WHERE id = ?').run(leaseExpiresIso, task.id);

  return { ok: true, lease_expires_at: leaseExpiresIso };
}

export function releaseFloorTask(
  db: Database.Database,
  taskRef: string,
  actor: { username: string; id?: number; role?: string }
): { ok: boolean } {
  return db.transaction(() => {
    const task = db.prepare('SELECT * FROM floor_tasks WHERE task_ref = ?').get(taskRef) as any;
    if (!task) {
      throw new DomainError('NOT_FOUND', `Floor task ${taskRef} not found`, {}, 404);
    }

    if (task.assigned_to !== actor.username) {
      throw new DomainError('FORBIDDEN', 'You do not own this floor task', {}, 403);
    }

    transition('FLOOR_TASK', task.status, 'release');

    db.prepare(
      `
      UPDATE floor_tasks
      SET status = 'OPEN', assigned_to = NULL, lease_expires_at = NULL, version = version + 1
      WHERE id = ?
    `
    ).run(task.id);

    return { ok: true };
  })();
}
