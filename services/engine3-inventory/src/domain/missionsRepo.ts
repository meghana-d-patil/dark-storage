import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { DomainError, MissionDto, PickStopDto, MissionProgressDto, MissionQueryInput } from '@dark-storage/shared';
import { nextRef } from './ids.js';
import { audit } from './audit.js';
import { appendOrderEvent } from '../audit/appendAudit.js';
import { emit } from './outbox.js';

export interface PickPlanReservation {
  reservation_id: number;
  bin_code: string;
  shelf_code: string;
  level: number;
  sku: string;
  product_name: string;
  qty: number;
  node: string;
}

export interface PickPlanResponse {
  order_ref: string;
  status: string;
  plan_token: string;
  reservations: PickPlanReservation[];
}

export function computePlanToken(reservations: Array<{ reservation_id: number; bin_code: string; qty: number }>): string {
  const sorted = [...reservations].sort((a, b) => a.reservation_id - b.reservation_id);
  const payload = sorted.map((r) => ({
    reservation_id: r.reservation_id,
    bin_code: r.bin_code,
    qty: r.qty
  }));
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function getPickPlan(db: Database.Database, orderRef: string): PickPlanResponse {
  const order = db.prepare('SELECT id, ref, status FROM orders WHERE ref = ?').get(orderRef) as
    | { id: number; ref: string; status: string }
    | undefined;

  if (!order) {
    throw new DomainError('NOT_FOUND', `Order ${orderRef} not found`);
  }

  if (order.status !== 'RESERVED') {
    throw new DomainError('ORDER_STATE_INVALID', `Order ${orderRef} is in status ${order.status}, must be RESERVED`, {
      status: order.status
    });
  }

  const rows = db
    .prepare(
      `
    SELECT
      r.id AS reservation_id,
      r.bin_code,
      b.shelf_code,
      b.level,
      r.sku,
      p.name AS product_name,
      r.qty,
      s.nav_node_id AS node
    FROM reservations r
    JOIN bins b ON b.code = r.bin_code
    JOIN shelves s ON s.code = b.shelf_code
    JOIN products p ON p.sku = r.sku COLLATE NOCASE
    WHERE r.order_id = ? AND r.status = 'HELD'
    ORDER BY r.id ASC
  `
    )
    .all(order.id) as PickPlanReservation[];

  const plan_token = computePlanToken(rows);

  return {
    order_ref: order.ref,
    status: order.status,
    plan_token,
    reservations: rows
  };
}

export function assignMission(
  db: Database.Database,
  params: {
    order_ref: string;
    picker_id: number;
    plan_token: string;
    route: any;
    actor: { id: number; display_name?: string; name?: string; role: string };
  }
): MissionDto {
  const order = db.prepare('SELECT id, ref, status FROM orders WHERE ref = ?').get(params.order_ref) as
    | { id: number; ref: string; status: string }
    | undefined;

  if (!order) {
    throw new DomainError('NOT_FOUND', `Order ${params.order_ref} not found`);
  }

  if (order.status !== 'RESERVED') {
    throw new DomainError('ORDER_STATE_INVALID', `Order ${params.order_ref} is in status ${order.status}, must be RESERVED`, {
      status: order.status
    });
  }

  // Validate picker
  const picker = db.prepare('SELECT id, username, display_name, active, role FROM users WHERE id = ?').get(params.picker_id) as
    | { id: number; username: string; display_name: string; active: number; role: string }
    | undefined;

  if (!picker || picker.active !== 1 || picker.role !== 'PICKER') {
    throw new DomainError('PICKER_INVALID', 'Specified user is not an active PICKER', { picker_id: params.picker_id });
  }

  // Check plan token freshness against current reservations
  const currentPlan = getPickPlan(db, params.order_ref);
  if (currentPlan.plan_token !== params.plan_token) {
    throw new DomainError('PLAN_STALE', 'Reservation plan changed, please re-plan', {
      expected: params.plan_token,
      current: currentPlan.plan_token
    });
  }

  const nowIso = new Date().toISOString();
  const missionRef = nextRef(db, 'mission');

  const missionResult = db
    .prepare(
      `
    INSERT INTO missions (ref, order_id, picker_id, status, route_json, route_distance, route_algorithm, assigned_by, assigned_at)
    VALUES (?, ?, ?, 'ASSIGNED', ?, ?, ?, ?, ?)
  `
    )
    .run(
      missionRef,
      order.id,
      picker.id,
      JSON.stringify(params.route),
      params.route.total_distance,
      params.route.algorithm,
      params.actor.id,
      nowIso
    );
  const missionId = Number(missionResult.lastInsertRowid);

  // Map reservations by id
  const resMap = new Map<number, PickPlanReservation>();
  for (const r of currentPlan.reservations) {
    resMap.set(r.reservation_id, r);
  }

  // Insert pick stops in route order
  const orderKeys: Array<number | string> = params.route.order || [];
  let stopNo = 1;

  for (const key of orderKeys) {
    const resId = typeof key === 'string' ? parseInt(key, 10) : key;
    const res = resMap.get(resId);
    if (!res) continue;

    const stopRef = `${missionRef}-S${String(stopNo).padStart(2, '0')}`;
    db.prepare(
      `
      INSERT INTO pick_stops (mission_id, stop_no, stop_ref, seq, reservation_id, bin_code, sku, qty_required, qty_picked, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING')
    `
    ).run(missionId, stopNo, stopRef, stopNo, res.reservation_id, res.bin_code, res.sku, res.qty);

    stopNo++;
  }

  // Update order status
  db.prepare(
    `
    UPDATE orders
    SET status = 'ASSIGNED', assigned_picker = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(picker.id, nowIso, order.id);

  appendOrderEvent(db, {
    orderRef: order.ref,
    event: 'order.assigned',
    actor: { id: params.actor.id, role: params.actor.role },
    payload: { mission_ref: missionRef, picker_id: picker.id, picker_name: picker.display_name }
  });

  // Audit
  audit(db, {
    actor: { id: params.actor.id, role: params.actor.role },
    action: 'MISSION_ASSIGNED',
    entity_type: 'MISSION',
    entity_id: missionRef,
    details: {
      order_ref: order.ref,
      picker_id: picker.id,
      picker_name: picker.display_name,
      route_algorithm: params.route.algorithm,
      route_distance: params.route.total_distance,
      stops_count: stopNo - 1
    }
  });

  // Outbox events
  emit(db, {
    event_type: 'mission.assigned',
    entity_type: 'MISSION',
    entity_id: missionRef,
    data: { ref: missionRef, order_ref: order.ref, picker_id: picker.id }
  });

  emit(db, {
    event_type: 'order.status_changed',
    entity_type: 'ORDER',
    entity_id: order.ref,
    data: { ref: order.ref, status: 'ASSIGNED' }
  });

  return getMission(db, missionRef)!;
}

export function reassignMission(
  db: Database.Database,
  orderRef: string,
  newPickerId: number,
  actor: { id: number; display_name?: string; role: string }
): MissionDto {
  const order = db.prepare('SELECT id, ref, status FROM orders WHERE ref = ?').get(orderRef) as
    | { id: number; ref: string; status: string }
    | undefined;

  if (!order) {
    throw new DomainError('NOT_FOUND', `Order ${orderRef} not found`);
  }

  const mission = db.prepare('SELECT * FROM missions WHERE order_id = ? AND status IN (' + "'ASSIGNED', 'IN_PROGRESS'" + ')').get(order.id) as any;
  if (!mission || mission.status !== 'ASSIGNED') {
    throw new DomainError('MISSION_STATE_INVALID', 'Mission can only be reassigned while in ASSIGNED status');
  }

  // Validate picker
  const picker = db.prepare('SELECT id, display_name, active, role FROM users WHERE id = ?').get(newPickerId) as any;
  if (!picker || picker.active !== 1 || picker.role !== 'PICKER') {
    throw new DomainError('PICKER_INVALID', 'Specified user is not an active PICKER');
  }

  const nowIso = new Date().toISOString();
  db.prepare('UPDATE missions SET picker_id = ? WHERE id = ?').run(picker.id, mission.id);
  db.prepare('UPDATE orders SET assigned_picker = ?, updated_at = ? WHERE id = ?').run(picker.id, nowIso, order.id);

  appendOrderEvent(db, {
    orderRef: order.ref,
    event: 'order.assigned',
    actor: { id: actor.id, role: actor.role },
    payload: { mission_ref: mission.ref, old_picker_id: mission.picker_id, new_picker_id: picker.id }
  });

  audit(db, {
    actor: { id: actor.id, role: actor.role },
    action: 'MISSION_REASSIGNED',
    entity_type: 'MISSION',
    entity_id: mission.ref,
    details: {
      order_ref: order.ref,
      old_picker_id: mission.picker_id,
      new_picker_id: picker.id
    }
  });

  emit(db, {
    event_type: 'mission.reassigned',
    entity_type: 'MISSION',
    entity_id: mission.ref,
    data: { ref: mission.ref, order_ref: order.ref, picker_id: picker.id }
  });

  return getMission(db, mission.ref)!;
}

export function startMission(
  db: Database.Database,
  missionRef: string,
  actor: { id: number; role: string }
): MissionDto {
  const mission = db.prepare('SELECT * FROM missions WHERE ref = ?').get(missionRef) as any;
  if (!mission) {
    throw new DomainError('NOT_FOUND', `Mission ${missionRef} not found`);
  }

  if (actor.role === 'PICKER' && actor.id !== mission.picker_id) {
    throw new DomainError('NOT_YOUR_MISSION', 'You are not the assigned picker for this mission');
  }

  if (mission.status !== 'ASSIGNED') {
    throw new DomainError('MISSION_STATE_INVALID', `Mission cannot be started in status ${mission.status}`);
  }

  const nowIso = new Date().toISOString();
  db.prepare("UPDATE missions SET status = 'IN_PROGRESS', started_at = ? WHERE id = ?").run(nowIso, mission.id);
  db.prepare("UPDATE orders SET status = 'PICKING', updated_at = ? WHERE id = ?").run(nowIso, mission.order_id);

  const order = db.prepare('SELECT ref FROM orders WHERE id = ?').get(mission.order_id) as { ref: string };
  if (order) {
    appendOrderEvent(db, {
      orderRef: order.ref,
      event: 'order.picking_started',
      actor: { id: actor.id, role: actor.role },
      payload: { mission_ref: missionRef, picker_id: mission.picker_id }
    });
  }

  audit(db, {
    actor: { id: actor.id, role: actor.role },
    action: 'MISSION_STARTED',
    entity_type: 'MISSION',
    entity_id: missionRef,
    details: {
      order_id: mission.order_id,
      picker_id: mission.picker_id
    }
  });

  emit(db, {
    event_type: 'mission.started',
    entity_type: 'MISSION',
    entity_id: missionRef,
    data: { ref: missionRef, order_ref: order.ref }
  });

  emit(db, {
    event_type: 'order.status_changed',
    entity_type: 'ORDER',
    entity_id: order.ref,
    data: { ref: order.ref, status: 'PICKING' }
  });

  return getMission(db, missionRef)!;
}

export function getMission(db: Database.Database, ref: string): MissionDto | null {
  const mission = db.prepare('SELECT * FROM missions WHERE ref = ?').get(ref) as any;
  if (!mission) return null;

  const order = db.prepare('SELECT ref FROM orders WHERE id = ?').get(mission.order_id) as { ref: string };
  const picker = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(mission.picker_id) as { id: number; display_name: string };
  const assigner = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(mission.assigned_by) as { id: number; display_name: string };

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
      b.shelf_code,
      ps.sku,
      p.name AS product_name,
      ps.qty_required,
      ps.qty_picked,
      ps.status,
      ps.confirmed_at
    FROM pick_stops ps
    JOIN bins b ON b.code = ps.bin_code
    JOIN products p ON p.sku = ps.sku COLLATE NOCASE
    WHERE ps.mission_id = ?
    ORDER BY ps.seq ASC
  `
    )
    .all(mission.id) as PickStopDto[];

  let finishedStops = 0;
  let openExceptions = 0;
  let unitsRequired = 0;
  let unitsPicked = 0;

  for (const s of stops) {
    unitsRequired += s.qty_required;
    unitsPicked += s.qty_picked;
    if (s.status === 'PICKED' || s.status === 'RESOLVED') {
      finishedStops++;
    } else if (s.status === 'EXCEPTION_OPEN') {
      openExceptions++;
    }
  }

  const progress: MissionProgressDto = {
    total_stops: stops.length,
    finished_stops: finishedStops,
    open_exceptions: openExceptions,
    units_required: unitsRequired,
    units_picked: unitsPicked
  };

  const route = JSON.parse(mission.route_json);

  return {
    id: mission.id,
    ref: mission.ref,
    order_id: mission.order_id,
    order_ref: order?.ref || '',
    status: mission.status,
    picker: {
      id: picker?.id ?? 0,
      name: picker?.display_name || ''
    },
    route,
    stops,
    progress,
    assigned_by: {
      id: assigner?.id ?? 0,
      name: assigner?.display_name || ''
    },
    assigned_at: mission.assigned_at,
    started_at: mission.started_at,
    completed_at: mission.completed_at
  };
}

export function listMissions(
  db: Database.Database,
  query: MissionQueryInput
): { missions: MissionDto[]; total: number; page: number; page_size: number } {
  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (query.status) {
    where += ' AND m.status = ?';
    params.push(query.status);
  }

  if (query.picker_id) {
    where += ' AND m.picker_id = ?';
    params.push(query.picker_id);
  }

  const countRow = db.prepare(`SELECT COUNT(*) AS total FROM missions m ${where}`).get(...params) as { total: number };
  const total = countRow.total;

  const page = query.page ?? 1;
  const pageSize = query.page_size ?? 25;
  const offset = (page - 1) * pageSize;

  const missionRefs = db
    .prepare(`SELECT m.ref FROM missions m ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as Array<{ ref: string }>;

  const missions = missionRefs.map((r) => getMission(db, r.ref)!).filter(Boolean);

  return {
    missions,
    total,
    page,
    page_size: pageSize
  };
}

export function getActivePickers(db: Database.Database): Array<{ id: number; username: string; display_name: string; open_missions: number }> {
  const rows = db
    .prepare(
      `
    SELECT
      u.id,
      u.username,
      u.display_name,
      COUNT(m.id) AS open_missions
    FROM users u
    LEFT JOIN missions m ON m.picker_id = u.id AND m.status IN ('ASSIGNED', 'IN_PROGRESS')
    WHERE u.role = 'PICKER' AND u.active = 1
    GROUP BY u.id
    ORDER BY u.id ASC
  `
    )
    .all() as Array<{ id: number; username: string; display_name: string; open_missions: number }>;

  return rows;
}
