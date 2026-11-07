import { describe, it, expect } from 'vitest';
import {
  NODES,
  EDGES,
  nodeXY,
  shelfRect,
  LEVEL_HEIGHT,
  AISLE_X
} from '../../apps/web/src/lib/warehouseGeometry.js';
import { binVisualState } from '../../apps/web/src/lib/binVisual.js';
import { flattenRoute } from '../../apps/web/src/lib/routeGeometry.js';

describe('Phase 0: Shared Geometry & Visual State Baseline', () => {
  describe('Warehouse Geometry & Navigation Graph (warehouseGeometry.ts)', () => {
    it('creates exactly 34 navigation nodes matching seed-base formulas', () => {
      expect(NODES.length).toBe(34);
    });

    it('creates exactly 36 navigation graph edges matching seed-base formulas', () => {
      expect(EDGES.length).toBe(36);
    });

    it('resolves nodeXY("N-B-03") to exactly (30, 22)', () => {
      const coord = nodeXY('N-B-03');
      expect(coord).toBeDefined();
      expect(coord).toEqual({ x: 30, y: 22 });
    });

    it('resolves nodeXY("XT-D") to exactly (70, 50)', () => {
      const coord = nodeXY('XT-D');
      expect(coord).toBeDefined();
      expect(coord).toEqual({ x: 70, y: 50 });
    });

    it('contains every node ID appearing in the sample route JSON from §1 in NODES', () => {
      // Sample route legs nodes from PRD §1
      const sampleRouteNodeIds = [
        'DOCK',
        'XB-A',
        'N-A-01',
        'XB-B',
        'XB-C',
        'XB-D',
        'PACK',
        'XT-A',
        'XT-B',
        'XT-C',
        'XT-D',
        'N-B-03'
      ];

      for (const id of sampleRouteNodeIds) {
        expect(nodeXY(id)).toBeDefined();
      }
    });

    it('computes correct shelfRect footprints for L and R shelves', () => {
      // Shelf A-01-L: Aisle A (x=10), Bay 1 (y=10), Left side (-x)
      // Gap: 1.4m, Depth: 1.6m -> Left shelf x is from 10 - 1.4 - 1.6 = 7.0 to 10 - 1.4 = 8.6
      // Length: 4.0m centered at y=10 -> y from 8.0 to 12.0
      const shelfL = shelfRect({
        code: 'A-01-L',
        aisle: 'A',
        bay: 1,
        side: 'L',
        x: 10,
        y: 10
      });

      expect(shelfL.x).toBeCloseTo(7.0);
      expect(shelfL.width).toBeCloseTo(1.6);
      expect(shelfL.y).toBeCloseTo(8.0);
      expect(shelfL.height).toBeCloseTo(4.0);
      expect(shelfL.centerX).toBeCloseTo(7.8);
      expect(shelfL.centerY).toBeCloseTo(10.0);

      // Shelf A-01-R: Aisle A (x=10), Bay 1 (y=10), Right side (+x)
      // Gap: 1.4m, Depth: 1.6m -> Right shelf x is from 10 + 1.4 = 11.4 to 10 + 1.4 + 1.6 = 13.0
      const shelfR = shelfRect({
        code: 'A-01-R',
        aisle: 'A',
        bay: 1,
        side: 'R',
        x: 10,
        y: 10
      });

      expect(shelfR.x).toBeCloseTo(11.4);
      expect(shelfR.width).toBeCloseTo(1.6);
      expect(shelfR.y).toBeCloseTo(8.0);
      expect(shelfR.height).toBeCloseTo(4.0);
      expect(shelfR.centerX).toBeCloseTo(12.2);
      expect(shelfR.centerY).toBeCloseTo(10.0);
    });

    it('exports LEVEL_HEIGHT = 1.0 m', () => {
      expect(LEVEL_HEIGHT).toBe(1.0);
    });
  });

  describe('Bin Visual State & Precedence (binVisual.ts)', () => {
    it('enforces precedence 1: BLOCKED bin status', () => {
      expect(
        binVisualState(
          { qty: 100, capacity: 100, status: 'BLOCKED', recount_required: true },
          'MAINTENANCE'
        )
      ).toBe('blocked');
    });

    it('enforces precedence 2: DAMAGED bin status', () => {
      expect(
        binVisualState(
          { qty: 50, capacity: 100, status: 'DAMAGED', recount_required: true },
          'MAINTENANCE'
        )
      ).toBe('damaged');
    });

    it('enforces precedence 3: MAINTENANCE shelf status', () => {
      expect(
        binVisualState(
          { qty: 50, capacity: 100, status: 'ACTIVE', recount_required: true },
          'MAINTENANCE'
        )
      ).toBe('maintenance');
    });

    it('enforces precedence 4: recount_required flag', () => {
      expect(
        binVisualState(
          { qty: 50, capacity: 100, status: 'ACTIVE', recount_required: true },
          'ACTIVE'
        )
      ).toBe('recount');
    });

    it('enforces fill level thresholds (<25%, <75%, <100%, >=100%) when active', () => {
      // Empty
      expect(
        binVisualState({ qty: 0, capacity: 100, status: 'ACTIVE', recount_required: false }, 'ACTIVE')
      ).toBe('empty');

      // Low (<25%)
      expect(
        binVisualState({ qty: 24, capacity: 100, status: 'ACTIVE', recount_required: false }, 'ACTIVE')
      ).toBe('low');

      // Med (<75%)
      expect(
        binVisualState({ qty: 25, capacity: 100, status: 'ACTIVE', recount_required: false }, 'ACTIVE')
      ).toBe('med');
      expect(
        binVisualState({ qty: 74, capacity: 100, status: 'ACTIVE', recount_required: false }, 'ACTIVE')
      ).toBe('med');

      // High (<100%)
      expect(
        binVisualState({ qty: 75, capacity: 100, status: 'ACTIVE', recount_required: false }, 'ACTIVE')
      ).toBe('high');
      expect(
        binVisualState({ qty: 99, capacity: 100, status: 'ACTIVE', recount_required: false }, 'ACTIVE')
      ).toBe('high');

      // Full (>=100%)
      expect(
        binVisualState({ qty: 100, capacity: 100, status: 'ACTIVE', recount_required: false }, 'ACTIVE')
      ).toBe('full');
      expect(
        binVisualState({ qty: 120, capacity: 100, status: 'ACTIVE', recount_required: false }, 'ACTIVE')
      ).toBe('full');
    });
  });

  describe('Route Geometry & Flattening (routeGeometry.ts)', () => {
    it('flattens sample route DOCK -> N-A-01 -> N-B-03 -> PACK with no consecutive duplicates and ends at PACK', () => {
      const sampleRoute = {
        algorithm: 'HELD_KARP',
        total_distance: 114,
        start: 'DOCK',
        end: 'PACK',
        legs: [
          {
            from: 'DOCK',
            to: 'N-A-01',
            distance: 20,
            path: ['DOCK', 'XB-A', 'N-A-01']
          },
          {
            from: 'N-A-01',
            to: 'N-B-03',
            distance: 42,
            path: [
              'N-A-01',
              'N-A-02',
              'N-A-03',
              'N-A-04',
              'N-A-05',
              'N-A-06',
              'XT-A',
              'XT-B',
              'N-B-06',
              'N-B-05',
              'N-B-04',
              'N-B-03'
            ]
          },
          {
            from: 'N-B-03',
            to: 'PACK',
            distance: 52,
            path: ['N-B-03', 'N-B-02', 'N-B-01', 'XB-B', 'XB-C', 'XB-D', 'PACK']
          }
        ]
      };

      const flattened = flattenRoute(sampleRoute);

      // Verify no consecutive duplicates
      for (let i = 0; i < flattened.nodeIds.length - 1; i++) {
        expect(flattened.nodeIds[i]).not.toBe(flattened.nodeIds[i + 1]);
      }

      // Starts at DOCK and ends at PACK
      expect(flattened.nodeIds[0]).toBe('DOCK');
      expect(flattened.nodeIds[flattened.nodeIds.length - 1]).toBe('PACK');

      // Points are mapped to coordinates
      expect(flattened.points.length).toBe(flattened.nodeIds.length);
      expect(flattened.points[0]).toEqual({ id: 'DOCK', x: 0, y: 0 });
      expect(flattened.points[flattened.points.length - 1]).toEqual({ id: 'PACK', x: 80, y: 0 });

      // Total distance reaches expected value (114)
      expect(flattened.totalDistance).toBeCloseTo(114);
    });

    it('handles empty or null route gracefully', () => {
      expect(flattenRoute(null)).toEqual({
        nodeIds: [],
        points: [],
        cumulativeDistance: [],
        totalDistance: 0
      });
      expect(flattenRoute({ legs: [] })).toEqual({
        nodeIds: [],
        points: [],
        cumulativeDistance: [],
        totalDistance: 0
      });
    });
  });
});
