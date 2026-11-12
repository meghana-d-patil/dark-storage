import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { sweepExpiredLeases } from '../../services/engine3-inventory/src/jobs/leaseSweep.js';

describe('P5-T9: Lease Sweep Integration Test', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
    seedMinimal(db);
  });

  it('sets lease_expires_at in the past, runs sweep, mission returns to QUEUED with tote and done stops intact', () => {
    const orderRes = db.prepare(`
      INSERT INTO orders (ref, customer_ref, status, priority, order_type, requested_by)
      VALUES ('ORD-LEASE-01', 'Cust Lease', 'PICKING', 'NORMAL', 'CUSTOMER', 1)
    `).run();
    const orderId = Number(orderRes.lastInsertRowid);

    const lineRes = db.prepare(`
      INSERT INTO order_lines (order_id, line_no, sku, qty_ordered)
      VALUES (?, 1, 'SKU-TEST-001', 5)
    `).run(orderId);
    const lineId = Number(lineRes.lastInsertRowid);

    const res1 = db.prepare(`
      INSERT INTO reservations (order_id, order_line_id, sku, bin_code, qty, consumed_qty, released_qty, status)
      VALUES (?, ?, 'SKU-TEST-001', 'BIN-A01-1', 2, 2, 0, 'CONSUMED')
    `).run(orderId, lineId);

    const res2 = db.prepare(`
      INSERT INTO reservations (order_id, order_line_id, sku, bin_code, qty, consumed_qty, released_qty, status)
      VALUES (?, ?, 'SKU-TEST-001', 'BIN-A01-2', 3, 0, 0, 'HELD')
    `).run(orderId, lineId);

    // Mission in IN_PROGRESS, assigned to test-picker, with TOTE-001, but lease expired 1 minute ago
    const pastDate = new Date(Date.now() - 60000).toISOString();
    const mRes = db.prepare(`
      INSERT INTO missions (
        ref, order_id, status, assigned_to, picker_id, claimed_at,
        lease_expires_at, tote_code, route_json, route_distance, route_algorithm,
        priority, version
      ) VALUES (
        'MIS-LEASE-01', ?, 'IN_PROGRESS', 'test-picker', 4, ?,
        ?, 'TOTE-001', '[]', 10.0, 'TRIVIAL',
        5, 2
      )
    `).run(orderId, pastDate, pastDate);
    const missionId = Number(mRes.lastInsertRowid);

    // Stop 1 is DONE
    db.prepare(`
      INSERT INTO pick_stops (
        mission_id, stop_no, stop_ref, seq, reservation_id,
        bin_code, sku, qty_required, qty_picked, step, status
      ) VALUES (?, 1, 'STP-LEASE-01', 1, ?, 'BIN-A01-1', 'SKU-TEST-001', 2, 2, 'DONE', 'PICKED')
    `).run(missionId, Number(res1.lastInsertRowid));

    // Stop 2 is PENDING
    db.prepare(`
      INSERT INTO pick_stops (
        mission_id, stop_no, stop_ref, seq, reservation_id,
        bin_code, sku, qty_required, qty_picked, step, status
      ) VALUES (?, 2, 'STP-LEASE-02', 2, ?, 'BIN-A01-2', 'SKU-TEST-001', 3, 0, 'PENDING', 'PENDING')
    `).run(missionId, Number(res2.lastInsertRowid));

    // Tote is IN_USE
    db.prepare(`
      UPDATE totes
      SET status = 'IN_USE', mission_ref = 'MIS-LEASE-01', order_ref = 'ORD-LEASE-01'
      WHERE tote_code = 'TOTE-001'
    `).run();

    // Floor task expired
    db.prepare(`
      INSERT INTO floor_tasks (
        task_ref, type, status, assigned_to, lease_expires_at, version
      ) VALUES (
        'TSK-LEASE-01', 'COUNT', 'CLAIMED', 'test-picker', ?, 1
      )
    `).run(pastDate);

    // Execute lease sweep
    const sweepResult = sweepExpiredLeases(db);
    expect(sweepResult.sweptMissions).toBe(1);
    expect(sweepResult.sweptTasks).toBe(1);

    // Assert mission returned to QUEUED
    const updatedMission = db.prepare('SELECT * FROM missions WHERE id = ?').get(missionId) as any;
    expect(updatedMission.status).toBe('QUEUED');
    expect(updatedMission.assigned_to).toBeNull();
    expect(updatedMission.lease_expires_at).toBeNull();
    // Tote code kept intact!
    expect(updatedMission.tote_code).toBe('TOTE-001');

    // Assert stops intact
    const stop1 = db.prepare('SELECT * FROM pick_stops WHERE stop_ref = ?').get('STP-LEASE-01') as any;
    expect(stop1.step).toBe('DONE');
    expect(stop1.qty_picked).toBe(2);

    const stop2 = db.prepare('SELECT * FROM pick_stops WHERE stop_ref = ?').get('STP-LEASE-02') as any;
    expect(stop2.step).toBe('PENDING');

    // Assert floor task returned to OPEN
    const updatedTask = db.prepare('SELECT * FROM floor_tasks WHERE task_ref = ?').get('TSK-LEASE-01') as any;
    expect(updatedTask.status).toBe('OPEN');
    expect(updatedTask.assigned_to).toBeNull();
    expect(updatedTask.lease_expires_at).toBeNull();

    // Assert order event was logged
    const event = db.prepare(`SELECT * FROM order_events WHERE order_ref = 'ORD-LEASE-01' AND event = 'mission.lease_expired'`).get() as any;
    expect(event).toBeDefined();
    expect(JSON.parse(event.payload).previous_picker).toBe('test-picker');
  });
});
