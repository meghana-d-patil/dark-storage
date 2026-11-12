import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { claimNextMission } from '../../services/engine3-inventory/src/domain/pickerRepo.js';

describe('P5-T9: Claim Race Integration Test', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
    seedMinimal(db);

    // Seed 20 test pickers
    const insertPicker = db.prepare(`
      INSERT INTO users (id, username, display_name, password_hash, role, badge_id, pin_hash, zones, shift, active)
      VALUES (?, ?, ?, 'dummy_hash', 'PICKER', ?, 'pin_hash', '[]', 'MORNING', 1)
    `);
    for (let i = 1; i <= 20; i++) {
      insertPicker.run(100 + i, `picker_race_${i}`, `Picker Race ${i}`, `BDG-RACE-${i}`);
    }

    // Insert 5 orders and 5 QUEUED missions
    for (let i = 1; i <= 5; i++) {
      const orderRes = db.prepare(`
        INSERT INTO orders (ref, customer_ref, status, priority, order_type, requested_by)
        VALUES (?, 'CUST-RACE', 'RESERVED', 'NORMAL', 'CUSTOMER', 1)
      `).run(`ORD-RACE-00${i}`);
      const orderId = Number(orderRes.lastInsertRowid);

      const lineRes = db.prepare(`
        INSERT INTO order_lines (order_id, line_no, sku, qty_ordered)
        VALUES (?, 1, 'SKU-TEST-001', 2)
      `).run(orderId);
      const lineId = Number(lineRes.lastInsertRowid);

      const res = db.prepare(`
        INSERT INTO reservations (order_id, order_line_id, sku, bin_code, qty, status)
        VALUES (?, ?, 'SKU-TEST-001', 'BIN-A01-1', 2, 'HELD')
      `).run(orderId, lineId);

      const mRes = db.prepare(`
        INSERT INTO missions (
          ref, order_id, status, route_json, route_distance, route_algorithm,
          priority, version
        ) VALUES (?, ?, 'QUEUED', '[]', 10.0, 'TRIVIAL', 5, 0)
      `).run(`MIS-RACE-00${i}`, orderId);
      const missionId = Number(mRes.lastInsertRowid);

      db.prepare(`
        INSERT INTO pick_stops (
          mission_id, stop_no, stop_ref, seq, reservation_id,
          bin_code, sku, qty_required, step, status
        ) VALUES (?, 1, ?, 1, ?, 'BIN-A01-1', 'SKU-TEST-001', 2, 'PENDING', 'PENDING')
      `).run(missionId, `STP-RACE-00${i}`, Number(res.lastInsertRowid));
    }
  });

  it('20 pickers concurrently claiming 5 missions: each mission has exactly 1 owner and no picker has >1', async () => {
    const pickers = Array.from({ length: 20 }, (_, i) => ({
      id: 100 + i + 1,
      username: `picker_race_${i + 1}`,
      role: 'PICKER',
      zones: [],
    }));

    // Concurrently attempt to claim
    const results = await Promise.allSettled(
      pickers.map((picker) =>
        new Promise((resolve, reject) => {
          try {
            const mission = claimNextMission(db, picker);
            resolve({ picker: picker.username, mission });
          } catch (err) {
            reject(err);
          }
        })
      )
    );

    const successfulClaims = results.filter((r) => r.status === 'fulfilled') as Array<
      PromiseFulfilledResult<{ picker: string; mission: any }>
    >;

    // Exactly 5 missions should be claimed
    expect(successfulClaims.length).toBe(5);

    // Assert all 5 missions are in CLAIMED status with unique owners
    const claimedMissions = db.prepare(`SELECT * FROM missions WHERE status = 'CLAIMED' AND ref LIKE 'MIS-RACE-%'`).all() as any[];
    expect(claimedMissions.length).toBe(5);

    const owners = claimedMissions.map((m) => m.assigned_to);
    const uniqueOwners = new Set(owners);
    expect(uniqueOwners.size).toBe(5); // Each mission has a distinct owner

    // Assert that remaining 15 pickers got NO_MISSION_AVAILABLE
    const failedClaims = results.filter((r) => r.status === 'rejected') as Array<
      PromiseRejectedResult
    >;
    expect(failedClaims.length).toBe(15);
    for (const fail of failedClaims) {
      expect((fail.reason as any).code).toBe('NO_MISSION_AVAILABLE');
    }
  });
});
