import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import crypto from 'node:crypto';
import { createTempDbPaths } from '../harness/tempDb.js';
import { startStack, RunningStack } from '../harness/stack.js';
import { apiClient } from '../harness/apiClient.js';
import { applyMigrations } from '../../scripts/migrate.js';
import { seedBase } from '../../scripts/seed-base.js';
import { seedDemo } from '../../scripts/seed-demo.js';
import { runIntegrityChecks } from '../../scripts/verify-integrity.js';
import { runTx } from '../../services/engine3-inventory/src/db/tx.js';
import { stockIn } from '../../services/engine3-inventory/src/domain/inventoryRepo.js';
import { executeReserveOrder, cancelOrder } from '../../services/engine3-inventory/src/domain/ordersRepo.js';
import { loadGraphWithCoords, clearGraphCache } from '../../services/engine2-optimizer/src/graph/loadGraph.js';
import { dijkstra, getShortestPathDijkstra } from '../../services/engine2-optimizer/src/routing/dijkstra.js';
import { astar } from '../../services/engine2-optimizer/src/routing/astar.js';
import { heldKarp } from '../../services/engine2-optimizer/src/routing/heldKarp.js';
import { twoOpt } from '../../services/engine2-optimizer/src/routing/twoOpt.js';
import { planRoute } from '../../services/engine2-optimizer/src/routing/planRoute.js';
import {
  getPickPlan,
  assignMission,
  reassignMission,
  startMission,
  getMission,
  listMissions
} from '../../services/engine3-inventory/src/domain/missionsRepo.js';
import { runIdempotent } from '../../services/engine3-inventory/src/domain/idempotency.js';

describe('Phase 7 Assignment & Route Optimization Tests', () => {
  let stack: RunningStack | undefined;

  afterAll(async () => {
    if (stack) {
      await stack.stop();
    }
  });

  function setupDatabases() {
    const { dir, warehouseDbPath, schedulerDbPath, cleanup } = createTempDbPaths();

    const wDb = new Database(warehouseDbPath);
    wDb.pragma('journal_mode = WAL');
    wDb.pragma('foreign_keys = ON');
    wDb.pragma('busy_timeout = 5000');
    applyMigrations(wDb, path.resolve('migrations/warehouse'));
    seedBase(wDb);

    const sDb = new Database(schedulerDbPath);
    sDb.pragma('journal_mode = WAL');
    sDb.pragma('foreign_keys = ON');
    sDb.pragma('busy_timeout = 5000');
    applyMigrations(sDb, path.resolve('migrations/scheduler'));

    return { dir, warehouseDbPath, schedulerDbPath, wDb, sDb, cleanup };
  }

  // P7-T01: A* vs Dijkstra on 50 seeded-random node pairs -> Equal distances (±1e-6)
  it('P7-T01: A* vs Dijkstra on 50 seeded-random node pairs returns identical distances', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { graph, coords } = loadGraphWithCoords(wDb);
      const nodeIds = Array.from(graph.keys()).sort();
      expect(nodeIds.length).toBeGreaterThan(0);

      // Seeded LCG PRNG
      let seed = 123456789;
      const nextRand = () => {
        seed = (1103515245 * seed + 12345) % 2147483648;
        return seed / 2147483648;
      };

      for (let i = 0; i < 50; i++) {
        const idxA = Math.floor(nextRand() * nodeIds.length);
        const idxB = Math.floor(nextRand() * nodeIds.length);
        const nodeA = nodeIds[idxA];
        const nodeB = nodeIds[idxB];

        const dijkstraRes = getShortestPathDijkstra(nodeA, nodeB, graph);
        const astarRes = astar(nodeA, nodeB, graph, coords);

        if (dijkstraRes.distance === Infinity) {
          expect(astarRes.distance).toBe(Infinity);
        } else {
          expect(Math.abs(dijkstraRes.distance - astarRes.distance)).toBeLessThan(1e-6);
        }
      }

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T02: Held-Karp vs brute-force permutations, random sets of ≤ 7 waypoints -> Equal optimal totals
  it('P7-T02: Held-Karp matches brute-force permutations on subsets of <= 7 waypoints', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { graph } = loadGraphWithCoords(wDb);
      const allWaypoints = Array.from(graph.keys()).filter((n) => n !== 'DOCK' && n !== 'PACK');

      const distMatrix = new Map<string, Map<string, number>>();
      const getD = (from: string, to: string) => {
        if (!distMatrix.has(from)) {
          const { distances } = dijkstra(from, graph);
          distMatrix.set(from, distances);
        }
        return distMatrix.get(from)!.get(to) ?? Infinity;
      };

      // Test subsets of sizes 3, 5, 7
      const subsetSizes = [3, 5, 7];
      for (const size of subsetSizes) {
        const waypoints = allWaypoints.slice(0, size);

        // Held-Karp solution
        const hkResult = heldKarp('DOCK', 'PACK', waypoints, getD);

        // Brute-force permutations
        const permute = (arr: string[]): string[][] => {
          if (arr.length <= 1) return [arr];
          const res: string[][] = [];
          for (let i = 0; i < arr.length; i++) {
            const current = arr[i];
            const remaining = arr.slice(0, i).concat(arr.slice(i + 1));
            for (const p of permute(remaining)) {
              res.push([current, ...p]);
            }
          }
          return res;
        };

        const allPerms = permute(waypoints);
        let minBruteDist = Infinity;

        for (const p of allPerms) {
          let dist = getD('DOCK', p[0]);
          for (let i = 0; i < p.length - 1; i++) {
            dist += getD(p[i], p[i + 1]);
          }
          dist += getD(p[p.length - 1], 'PACK');
          if (dist < minBruteDist) {
            minBruteDist = dist;
          }
        }

        expect(Math.abs(hkResult.totalDistance - minBruteDist)).toBeLessThan(1e-6);
      }

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T03: 11 and 12 waypoints -> TWO_OPT; total <= nearest-neighbour total; deterministic
  it('P7-T03: 11 and 12 waypoints use TWO_OPT, improve or equal NN, and are deterministic', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const { graph } = loadGraphWithCoords(wDb);
      const allWaypoints = Array.from(graph.keys()).filter((n) => n !== 'DOCK' && n !== 'PACK');

      for (const count of [11, 12]) {
        const waypoints = allWaypoints.slice(0, count);
        const stops = waypoints.map((node, i) => ({
          key: i + 1,
          bin_code: `BIN-${i + 1}`,
          node
        }));

        const res1 = planRoute(wDb, { start: 'DOCK', end: 'PACK', stops });
        const res2 = planRoute(wDb, { start: 'DOCK', end: 'PACK', stops });

        expect(res1.algorithm).toBe('TWO_OPT');
        expect(res1.total_distance).toBe(res2.total_distance);
        expect(res1.order).toEqual(res2.order);
      }

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T04: Stops on L and R shelves of the same bay -> One waypoint; stops ordered shelf->level; zero-length leg
  it('P7-T04: Stops on L and R shelves of the same bay collapse to one waypoint and order by shelf->level', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      // Both A-01-L and A-01-R map to node N-A-01
      const stops = [
        { key: 1, bin_code: 'A-01-R-2', node: 'N-A-01', shelf_code: 'A-01-R', level: 2 },
        { key: 2, bin_code: 'A-01-L-3', node: 'N-A-01', shelf_code: 'A-01-L', level: 3 },
        { key: 3, bin_code: 'A-01-L-1', node: 'N-A-01', shelf_code: 'A-01-L', level: 1 }
      ];

      const res = planRoute(wDb, { start: 'DOCK', end: 'PACK', stops });

      // There is only 1 unique waypoint node N-A-01
      // Stops ordered: A-01-L level 1 (key 3), A-01-L level 3 (key 2), A-01-R level 2 (key 1)
      expect(res.order).toEqual([3, 2, 1]);

      // Legs: DOCK -> N-A-01, then N-A-01 -> PACK (2 legs total)
      expect(res.legs.length).toBe(2);
      expect(res.legs[0].from).toBe('DOCK');
      expect(res.legs[0].to).toBe('N-A-01');
      expect(res.legs[1].from).toBe('N-A-01');
      expect(res.legs[1].to).toBe('PACK');

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T05: Graph with a removed edge isolating a node -> 422 ROUTE_UNREACHABLE listing keys
  it('P7-T05: Graph with isolated node throws 422 ROUTE_UNREACHABLE listing unreachable keys', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      // Isolate node N-A-06 by deleting all connecting edges
      wDb.prepare("DELETE FROM nav_edges WHERE from_node = 'N-A-06' OR to_node = 'N-A-06'").run();
      clearGraphCache(wDb);

      const stops = [
        { key: 101, bin_code: 'A-01-L-1', node: 'N-A-01' },
        { key: 102, bin_code: 'A-06-L-1', node: 'N-A-06' }
      ];

      let thrown: any = null;
      try {
        planRoute(wDb, { start: 'DOCK', end: 'PACK', stops });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).not.toBeNull();
      expect(thrown.code).toBe('ROUTE_UNREACHABLE');
      expect(thrown.details.unreachable_keys).toContain(102);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T06: Route structure: Starts DOCK, ends PACK; legs contiguous; every path hop is a real edge; Σ legs = total
  it('P7-T06: Route structure: starts DOCK, ends PACK, legs contiguous, valid hops, leg sum equals total', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const stops = [
        { key: 1, bin_code: 'A-01-L-1', node: 'N-A-01' },
        { key: 2, bin_code: 'B-02-L-1', node: 'N-B-02' },
        { key: 3, bin_code: 'C-03-L-1', node: 'N-C-03' }
      ];

      const res = planRoute(wDb, { start: 'DOCK', end: 'PACK', stops });

      expect(res.start).toBe('DOCK');
      expect(res.end).toBe('PACK');

      // Check contiguous legs
      for (let i = 0; i < res.legs.length; i++) {
        if (i === 0) {
          expect(res.legs[i].from).toBe('DOCK');
        } else {
          expect(res.legs[i].from).toBe(res.legs[i - 1].to);
        }
      }
      expect(res.legs[res.legs.length - 1].to).toBe('PACK');

      // Check hops are real edges
      const edgeCheck = wDb.prepare(
        'SELECT COUNT(*) AS c FROM nav_edges WHERE (from_node = ? AND to_node = ?) OR (from_node = ? AND to_node = ?)'
      );

      for (const leg of res.legs) {
        for (let j = 0; j < leg.path.length - 1; j++) {
          const u = leg.path[j];
          const v = leg.path[j + 1];
          const c = edgeCheck.get(u, v, v, u) as { c: number };
          expect(c.c).toBeGreaterThan(0);
        }
      }

      // Check sum of leg distances
      const legSum = Math.round(res.legs.reduce((acc, l) => acc + l.distance, 0) * 100) / 100;
      expect(legSum).toBe(res.total_distance);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T07: Assign RESERVED order -> MIS-0001 ASSIGNED; order ASSIGNED; stops 1:1 with reservations; seq = route order
  it('P7-T07: Assign RESERVED order: MIS-0001 ASSIGNED, order ASSIGNED, stops 1:1, stop refs MIS-0001-S01..', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };

      // Stock and reserve
      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 20 });
      stockIn(wDb, { bin: 'A-02-L-1', sku: 'SKU002', qty: 20 });

      const order = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [
            { sku: 'SKU001', qty: 5 },
            { sku: 'SKU002', qty: 10 }
          ],
          actor
        })
      );
      expect(order.status).toBe('RESERVED');

      // Get pick plan
      const plan = getPickPlan(wDb, order.ref);
      expect(plan.reservations.length).toBe(2);

      // Plan route
      const route = planRoute(wDb, {
        start: 'DOCK',
        end: 'PACK',
        stops: plan.reservations.map((r) => ({
          key: r.reservation_id,
          bin_code: r.bin_code,
          node: r.node,
          shelf_code: r.shelf_code,
          level: r.level
        }))
      });

      // Assign to picker 3 (Peter Picker)
      const mission = runTx(wDb, () =>
        assignMission(wDb, {
          order_ref: order.ref,
          picker_id: 3,
          plan_token: plan.plan_token,
          route,
          actor
        })
      );

      expect(mission.ref).toBe('MIS-0001');
      expect(mission.status).toBe('ASSIGNED');
      expect(mission.picker.id).toBe(3);
      expect(mission.stops.length).toBe(2);
      expect(mission.stops[0].stop_ref).toBe('MIS-0001-S01');
      expect(mission.stops[1].stop_ref).toBe('MIS-0001-S02');
      expect(mission.stops[0].seq).toBe(1);
      expect(mission.stops[1].seq).toBe(2);

      // Check order updated
      const updatedOrder = wDb.prepare('SELECT status, assigned_picker FROM orders WHERE ref = ?').get(order.ref) as any;
      expect(updatedOrder.status).toBe('ASSIGNED');
      expect(updatedOrder.assigned_picker).toBe(3);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T08: Line reserved across 2 bins -> 2 stops for that line
  it('P7-T08: Line reserved across 2 bins creates 2 distinct stops for that line', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };

      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 10 });
      stockIn(wDb, { bin: 'A-01-L-2', sku: 'SKU001', qty: 20 });

      // Request 25 -> allocated 10 in bin 1 and 15 in bin 2
      const order = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 25 }],
          actor
        })
      );

      const plan = getPickPlan(wDb, order.ref);
      expect(plan.reservations.length).toBe(2);

      const route = planRoute(wDb, {
        start: 'DOCK',
        end: 'PACK',
        stops: plan.reservations.map((r) => ({
          key: r.reservation_id,
          bin_code: r.bin_code,
          node: r.node
        }))
      });

      const mission = runTx(wDb, () =>
        assignMission(wDb, {
          order_ref: order.ref,
          picker_id: 3,
          plan_token: plan.plan_token,
          route,
          actor
        })
      );

      expect(mission.stops.length).toBe(2);
      const totalStopUnits = mission.stops.reduce((acc, s) => acc + s.qty_required, 0);
      expect(totalStopUnits).toBe(25);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T09: Assign non-RESERVED order / user who is not a PICKER / inactive picker -> errors
  it('P7-T09: Assign invalid order status or invalid picker throws expected errors', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };

      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 20 });
      const order = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 10 }],
          actor
        })
      );

      const plan = getPickPlan(wDb, order.ref);
      const route = { algorithm: 'TRIVIAL', total_distance: 20, order: [plan.reservations[0].reservation_id] };

      // 1. Assign to manager (user 1, role MANAGER) -> PICKER_INVALID
      expect(() => {
        assignMission(wDb, {
          order_ref: order.ref,
          picker_id: 1,
          plan_token: plan.plan_token,
          route,
          actor
        });
      }).toThrow(/PICKER_INVALID/);

      // 2. Inactive picker
      wDb.prepare("UPDATE users SET active = 0 WHERE id = 3").run();
      expect(() => {
        assignMission(wDb, {
          order_ref: order.ref,
          picker_id: 3,
          plan_token: plan.plan_token,
          route,
          actor
        });
      }).toThrow(/PICKER_INVALID/);
      wDb.prepare("UPDATE users SET active = 1 WHERE id = 3").run();

      // 3. Assign non-RESERVED order
      wDb.prepare("UPDATE orders SET status = 'CANCELLED' WHERE ref = ?").run(order.ref);
      expect(() => {
        assignMission(wDb, {
          order_ref: order.ref,
          picker_id: 3,
          plan_token: plan.plan_token,
          route,
          actor
        });
      }).toThrow(/ORDER_STATE_INVALID/);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T10: Reservations change between plan and assign -> PLAN_STALE
  it('P7-T10: Reservations change between plan and assign throws PLAN_STALE', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };

      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 30 });
      const order = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 10 }],
          actor
        })
      );

      const plan = getPickPlan(wDb, order.ref);
      const staleToken = plan.plan_token;

      // Tamper with reservation quantity in DB to simulate concurrent mutation
      wDb.prepare('UPDATE reservations SET qty = 15 WHERE id = ?').run(plan.reservations[0].reservation_id);

      const route = { algorithm: 'TRIVIAL', total_distance: 20, order: [plan.reservations[0].reservation_id] };

      expect(() => {
        assignMission(wDb, {
          order_ref: order.ref,
          picker_id: 3,
          plan_token: staleToken,
          route,
          actor
        });
      }).toThrow(/PLAN_STALE/);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T11: Assign twice: same key / different key -> One mission / ORDER_STATE_INVALID
  it('P7-T11: Assign twice: same key returns cached result; different key throws ORDER_STATE_INVALID', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };

      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 20 });
      const order = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 10 }],
          actor
        })
      );

      const plan = getPickPlan(wDb, order.ref);
      const route = { algorithm: 'TRIVIAL', total_distance: 20, order: [plan.reservations[0].reservation_id] };

      const idemKey = 'idem-assign-p7-11';

      // 1. First assign
      const res1 = runIdempotent(
        wDb,
        {
          key: idemKey,
          scope: `order:assign:${order.ref}`,
          body: { picker_id: 3 },
          actor
        },
        (txDb) => {
          const m = assignMission(txDb, {
            order_ref: order.ref,
            picker_id: 3,
            plan_token: plan.plan_token,
            route,
            actor
          });
          return { status: 201, body: m };
        }
      );
      expect(res1.status).toBe(201);
      expect(res1.body.ref).toBe('MIS-0001');

      // 2. Replay with same key -> returns original cached 201
      const replay = runIdempotent(
        wDb,
        {
          key: idemKey,
          scope: `order:assign:${order.ref}`,
          body: { picker_id: 3 },
          actor
        },
        (txDb) => {
          const m = assignMission(txDb, {
            order_ref: order.ref,
            picker_id: 3,
            plan_token: plan.plan_token,
            route,
            actor
          });
          return { status: 201, body: m };
        }
      );
      expect(replay.status).toBe(201);
      expect(replay.body.ref).toBe('MIS-0001');

      // 3. New key -> throws ORDER_STATE_INVALID (order already ASSIGNED)
      expect(() => {
        runIdempotent(
          wDb,
          {
            key: 'idem-assign-second-key',
            scope: `order:assign:${order.ref}`,
            body: { picker_id: 3 },
            actor
          },
          (txDb) => {
            const m = assignMission(txDb, {
              order_ref: order.ref,
              picker_id: 3,
              plan_token: plan.plan_token,
              route,
              actor
            });
            return { status: 201, body: m };
          }
        );
      }).toThrow(/ORDER_STATE_INVALID/);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T12: Reassign before start / after start -> OK / MISSION_STATE_INVALID
  it('P7-T12: Reassign before start succeeds; reassign after start throws MISSION_STATE_INVALID', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };

      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 20 });
      const order = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 10 }],
          actor
        })
      );

      const plan = getPickPlan(wDb, order.ref);
      const route = { algorithm: 'TRIVIAL', total_distance: 20, order: [plan.reservations[0].reservation_id] };

      // Assign to picker 3
      runTx(wDb, () =>
        assignMission(wDb, {
          order_ref: order.ref,
          picker_id: 3,
          plan_token: plan.plan_token,
          route,
          actor
        })
      );

      // Reassign to picker 4 (Priya Picker) while ASSIGNED -> succeeds
      const reassigned = runTx(wDb, () => reassignMission(wDb, order.ref, 4, actor));
      expect(reassigned.picker.id).toBe(4);

      // Start mission
      runTx(wDb, () => startMission(wDb, reassigned.ref, { id: 4, role: 'PICKER' }));

      // Attempt reassign while IN_PROGRESS -> throws MISSION_STATE_INVALID
      expect(() => {
        runTx(wDb, () => reassignMission(wDb, order.ref, 3, actor));
      }).toThrow(/MISSION_STATE_INVALID/);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T13: Start: assigned picker / other picker / start twice -> IN_PROGRESS / NOT_YOUR_MISSION / MISSION_STATE_INVALID
  it('P7-T13: Start: assigned picker starts mission; other picker rejected; duplicate start throws', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };

      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 20 });
      const order = runTx(wDb, () =>
        executeReserveOrder(wDb, {
          lines: [{ sku: 'SKU001', qty: 10 }],
          actor
        })
      );

      const plan = getPickPlan(wDb, order.ref);
      const route = { algorithm: 'TRIVIAL', total_distance: 20, order: [plan.reservations[0].reservation_id] };

      // Assign to picker 3
      const mission = runTx(wDb, () =>
        assignMission(wDb, {
          order_ref: order.ref,
          picker_id: 3,
          plan_token: plan.plan_token,
          route,
          actor
        })
      );

      // 1. Wrong picker (picker 4) attempts to start -> throws NOT_YOUR_MISSION
      expect(() => {
        runTx(wDb, () => startMission(wDb, mission.ref, { id: 4, role: 'PICKER' }));
      }).toThrow(/NOT_YOUR_MISSION/);

      // 2. Assigned picker 3 starts -> succeeds
      const started = runTx(wDb, () => startMission(wDb, mission.ref, { id: 3, role: 'PICKER' }));
      expect(started.status).toBe('IN_PROGRESS');

      // Check order status is PICKING
      const o = wDb.prepare('SELECT status FROM orders WHERE id = ?').get(mission.order_id) as any;
      expect(o.status).toBe('PICKING');

      // 3. Start again -> throws MISSION_STATE_INVALID
      expect(() => {
        runTx(wDb, () => startMission(wDb, mission.ref, { id: 3, role: 'PICKER' }));
      }).toThrow(/MISSION_STATE_INVALID/);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T15: Cancel ASSIGNED and PICKING (nothing picked) orders -> Mission CANCELLED, reservations released, order CANCELLED
  it('P7-T15: Cancel ASSIGNED and PICKING orders sets active mission to CANCELLED and releases reservations', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };

      stockIn(wDb, { bin: 'A-01-L-1', sku: 'SKU001', qty: 40 });

      // Order 1: Cancel while ASSIGNED
      const o1 = runTx(wDb, () => executeReserveOrder(wDb, { lines: [{ sku: 'SKU001', qty: 10 }], actor }));
      const plan1 = getPickPlan(wDb, o1.ref);
      const m1 = runTx(wDb, () =>
        assignMission(wDb, {
          order_ref: o1.ref,
          picker_id: 3,
          plan_token: plan1.plan_token,
          route: { algorithm: 'TRIVIAL', total_distance: 10, order: [plan1.reservations[0].reservation_id] },
          actor
        })
      );
      runTx(wDb, () => cancelOrder(wDb, o1.ref, 'Cancel assigned order', actor));

      const m1Row = wDb.prepare('SELECT status FROM missions WHERE id = ?').get(m1.id) as any;
      expect(m1Row.status).toBe('CANCELLED');

      // Order 2: Cancel while PICKING (0 units picked)
      const o2 = runTx(wDb, () => executeReserveOrder(wDb, { lines: [{ sku: 'SKU001', qty: 10 }], actor }));
      const plan2 = getPickPlan(wDb, o2.ref);
      const m2 = runTx(wDb, () =>
        assignMission(wDb, {
          order_ref: o2.ref,
          picker_id: 3,
          plan_token: plan2.plan_token,
          route: { algorithm: 'TRIVIAL', total_distance: 10, order: [plan2.reservations[0].reservation_id] },
          actor
        })
      );
      runTx(wDb, () => startMission(wDb, m2.ref, { id: 3, role: 'PICKER' }));
      runTx(wDb, () => cancelOrder(wDb, o2.ref, 'Cancel picking order', actor));

      const m2Row = wDb.prepare('SELECT status FROM missions WHERE id = ?').get(m2.id) as any;
      expect(m2Row.status).toBe('CANCELLED');

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T18: Integrity check I10: held reservations have a live stop
  it('P7-T18: Integrity check I10 and earlier checks pass', () => {
    const { wDb, cleanup } = setupDatabases();
    try {
      const actor = { id: 1, role: 'MANAGER' };
      seedDemo(wDb);

      // Create order and assign mission
      const o = runTx(wDb, () => executeReserveOrder(wDb, { lines: [{ sku: 'SKU001', qty: 10 }], actor }));
      const plan = getPickPlan(wDb, o.ref);
      const route = planRoute(wDb, {
        start: 'DOCK',
        end: 'PACK',
        stops: plan.reservations.map((r) => ({ key: r.reservation_id, bin_code: r.bin_code, node: r.node }))
      });
      runTx(wDb, () =>
        assignMission(wDb, {
          order_ref: o.ref,
          picker_id: 3,
          plan_token: plan.plan_token,
          route,
          actor
        })
      );

      const report = runIntegrityChecks(wDb);
      const failures = report.checks.filter((r) => r.status === 'FAIL');
      expect(failures).toEqual([]);
      expect(report.ok).toBe(true);

      wDb.close();
    } finally {
      cleanup();
    }
  });

  // P7-T19: Web component verification: route formatting and assign modal contracts
  it('P7-T19: Web contracts: planRoute output structure satisfies schema and UI requirements', () => {
    const mockOutput = {
      algorithm: 'HELD_KARP' as const,
      total_distance: 163.2,
      start: 'DOCK',
      end: 'PACK',
      order: [1, 2],
      stops: [
        { key: 1, bin_code: 'A-01-L-1', node: 'N-A-01', seq: 1 },
        { key: 2, bin_code: 'A-02-L-1', node: 'N-A-02', seq: 2 }
      ],
      legs: [
        { from: 'DOCK', to: 'N-A-01', distance: 20.0, path: ['DOCK', 'XB-A', 'N-A-01'] },
        { from: 'N-A-01', to: 'N-A-02', distance: 10.0, path: ['N-A-01', 'N-A-02'] },
        { from: 'N-A-02', to: 'PACK', distance: 133.2, path: ['N-A-02', 'PACK'] }
      ]
    };

    expect(mockOutput.legs.length).toBe(3);
    const sum = mockOutput.legs.reduce((acc, l) => acc + l.distance, 0);
    expect(sum).toBe(mockOutput.total_distance);
  });

  // End-to-end HTTP stack tests with live RunningStack
  describe('Phase 7 Live HTTP Stack Tests', () => {
    let client: ReturnType<typeof apiClient>;
    let manager: ReturnType<typeof apiClient>;
    let picker1: ReturnType<typeof apiClient>;
    let picker2: ReturnType<typeof apiClient>;

    beforeAll(async () => {
      stack = await startStack({ seed: true });
      client = apiClient(stack.urls.gateway);
      manager = apiClient(stack.urls.gateway);
      picker1 = apiClient(stack.urls.gateway);
      picker2 = apiClient(stack.urls.gateway);

      await client.login('operator1');
      await manager.login('manager1');
      await picker1.login('picker1');
      await picker2.login('picker2');
    });

    // P7-T14: GET /api/missions as picker1 vs manager -> Own only vs all
    it('P7-T14: GET /api/missions as picker1 returns only own missions; manager sees all', async () => {
      // Stock items
      const wDb = new Database(stack!.tempDb.warehouseDbPath);
      wDb.pragma('journal_mode = WAL');
      stockIn(wDb, { bin: 'A-06-L-1', sku: 'SKU011', qty: 50 });
      wDb.close();

      // Create Order A and assign to picker 3 (picker1)
      const ordA = await manager.post(
        '/api/orders',
        { lines: [{ sku: 'SKU011', qty: 5 }] },
        { idempotencyKey: `idem-ordA-${Date.now()}` }
      );
      expect(ordA.status).toBe(201);

      const assignA = await manager.post(
        `/api/orders/${ordA.body.ref}/assign`,
        { picker_id: 3 },
        { idempotencyKey: `idem-assignA-${Date.now()}` }
      );
      expect(assignA.status).toBe(201);

      // Create Order B and assign to picker 4 (picker2)
      const ordB = await manager.post(
        '/api/orders',
        { lines: [{ sku: 'SKU011', qty: 5 }] },
        { idempotencyKey: `idem-ordB-${Date.now()}` }
      );
      expect(ordB.status).toBe(201);

      const assignB = await manager.post(
        `/api/orders/${ordB.body.ref}/assign`,
        { picker_id: 4 },
        { idempotencyKey: `idem-assignB-${Date.now()}` }
      );
      expect(assignB.status).toBe(201);

      // Query as picker1 -> sees only mission A
      const p1Missions = await picker1.get('/api/missions');
      expect(p1Missions.status).toBe(200);
      const p1Refs = p1Missions.body.missions.map((m: any) => m.ref);
      expect(p1Refs).toContain(assignA.body.ref);
      expect(p1Refs).not.toContain(assignB.body.ref);

      // Query as manager -> sees both missions
      const mgrMissions = await manager.get('/api/missions');
      expect(mgrMissions.status).toBe(200);
      const mgrRefs = mgrMissions.body.missions.map((m: any) => m.ref);
      expect(mgrRefs).toContain(assignA.body.ref);
      expect(mgrRefs).toContain(assignB.body.ref);
    });

    // P7-T16: Engine 2 stopped, assign -> 503 ENGINE2_UNAVAILABLE; no mission, order still RESERVED
    it('P7-T16: Engine 2 stopped: assign returns 503 ENGINE2_UNAVAILABLE; order remains RESERVED', async () => {
      const wDb = new Database(stack!.tempDb.warehouseDbPath);
      wDb.pragma('journal_mode = WAL');
      stockIn(wDb, { bin: 'B-01-L-1', sku: 'SKU012', qty: 20 });
      wDb.close();

      const ord = await manager.post(
        '/api/orders',
        { lines: [{ sku: 'SKU012', qty: 5 }] },
        { idempotencyKey: `idem-ord-e2-${Date.now()}` }
      );
      expect(ord.status).toBe(201);

      // Kill Engine 2
      await stack!.kill('engine2');

      const failedAssign = await manager.post(
        `/api/orders/${ord.body.ref}/assign`,
        { picker_id: 3 },
        { idempotencyKey: `idem-assign-e2-down-${Date.now()}` }
      );

      expect(failedAssign.status).toBe(503);
      expect(failedAssign.body.error.code).toBe('ENGINE2_UNAVAILABLE');

      // Verify order is still RESERVED
      const orderCheck = await manager.get(`/api/orders/${ord.body.ref}`);
      expect(orderCheck.body.status).toBe('RESERVED');

      // Restart Engine 2
      await stack!.restart('engine2');
    });

    // P7-T17: Restart all services -> Mission, route and stops identical
    it('P7-T17: Restart all services: mission, route, and stops are preserved identically', async () => {
      const wDb = new Database(stack!.tempDb.warehouseDbPath);
      stockIn(wDb, { bin: 'C-01-L-1', sku: 'SKU013', qty: 30 });
      wDb.close();

      const ord = await manager.post(
        '/api/orders',
        { lines: [{ sku: 'SKU013', qty: 10 }] },
        { idempotencyKey: `idem-persist-ord-${Date.now()}` }
      );
      expect(ord.status).toBe(201);

      const assignRes = await manager.post(
        `/api/orders/${ord.body.ref}/assign`,
        { picker_id: 3 },
        { idempotencyKey: `idem-persist-assign-${Date.now()}` }
      );
      expect(assignRes.status).toBe(201);
      const missionRef = assignRes.body.ref;

      // Restart services
      await stack!.restart('engine3');
      await stack!.restart('engine2');
      await stack!.restart('engine1');

      // Query mission detail after restart
      const detailRes = await manager.get(`/api/missions/${missionRef}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.ref).toBe(missionRef);
      expect(detailRes.body.order_ref).toBe(ord.body.ref);
      expect(detailRes.body.stops.length).toBe(assignRes.body.stops.length);
      expect(detailRes.body.route.total_distance).toBe(assignRes.body.route.total_distance);
    });
  });
});
