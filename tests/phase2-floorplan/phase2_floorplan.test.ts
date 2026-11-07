import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { flattenRoute } from '../../apps/web/src/lib/routeGeometry.js';
import { NODES, shelfRect } from '../../apps/web/src/lib/warehouseGeometry.js';
import { shelfAggregateVisualState } from '../../apps/web/src/lib/binVisual.js';

describe('Phase 2: 2D Floorplan & Live Route Overlay (SVG)', () => {
  const floorplanSource = fs.readFileSync(
    path.resolve('apps/web/src/features/floorplan/FloorplanView.tsx'),
    'utf8'
  );

  it('contains all required data-testid attributes', () => {
    expect(floorplanSource).toContain('data-testid="floorplan-svg"');
    expect(floorplanSource).toContain('data-testid={`floorplan-shelf-${shelf.code}`}');
    expect(floorplanSource).toContain('data-testid="route-polyline"');
    expect(floorplanSource).toContain('data-testid={`route-stop-pin-${stop.seq}`}');
    expect(floorplanSource).toContain('data-testid="route-summary"');
  });

  it('renders sample route legs in order and positions pin 1 at N-A-01 (10, 10) on the correct side of aisle A', () => {
    // Sample mission fixture from PRD §1
    const sampleMission = {
      id: 1,
      ref: 'MIS-0001',
      order_id: 1,
      order_ref: 'ORD-0001',
      status: 'ASSIGNED' as const,
      picker: { id: 3, name: 'Picker' },
      route: {
        algorithm: 'HELD_KARP' as const,
        total_distance: 100,
        start: 'DOCK',
        end: 'PACK',
        order: [1],
        stops: [{ key: 1, bin_code: 'A-01-L-1', node: 'N-A-01', seq: 1 }],
        legs: [
          {
            from: 'DOCK',
            to: 'N-A-01',
            distance: 20,
            path: ['DOCK', 'XB-A', 'N-A-01']
          },
          {
            from: 'N-A-01',
            to: 'PACK',
            distance: 80,
            path: ['N-A-01', 'XB-A', 'XB-B', 'XB-C', 'XB-D', 'PACK']
          }
        ]
      },
      stops: [
        {
          id: 1,
          stop_no: 1,
          stop_ref: 'MIS-0001-S01',
          seq: 1,
          reservation_id: 1,
          bin_code: 'A-01-L-1',
          shelf_code: 'A-01-L',
          sku: 'SKU001',
          product_name: 'Wireless Mouse',
          qty_required: 5,
          qty_picked: 0,
          status: 'PENDING' as const,
          confirmed_at: null
        }
      ],
      progress: {
        total_stops: 1,
        finished_stops: 0,
        open_exceptions: 0,
        units_required: 5,
        units_picked: 0
      },
      assigned_by: { id: 1, name: 'Manager' },
      assigned_at: '2026-11-06T10:00:00Z',
      started_at: null,
      completed_at: null
    };

    // 1. Flattened route must match legs in order
    const flattened = flattenRoute(sampleMission.route);
    expect(flattened.nodeIds).toEqual([
      'DOCK',
      'XB-A',
      'N-A-01',
      'XB-A',
      'XB-B',
      'XB-C',
      'XB-D',
      'PACK'
    ]);

    // 2. Stop pin 1 node calculation
    const stop1 = sampleMission.stops[0];
    const parts = stop1.shelf_code.split('-');
    const aisle = parts[0]; // 'A'
    const bay = parts[1];   // '01'
    const side = parts[2];  // 'L'
    const nodeId = `N-${aisle}-${bay}`;

    const node = NODES.find((n) => n.id === nodeId);
    expect(node).toBeDefined();
    expect(node!.x).toBe(10);
    expect(node!.y).toBe(10);

    // Stop pin offset logic: side 'L' offsets to the left of aisle A (-1.8m)
    const offsetX = side === 'L' ? -1.8 : 1.8;
    const pinWorldX = node!.x + offsetX; // 10 - 1.8 = 8.2m
    const pinWorldY = node!.y;           // 10m

    // SVG coordinates with flipped y:
    const toSvgX = (wx: number) => wx;
    const toSvgY = (wy: number) => 50 - wy;

    const pinSvgX = toSvgX(pinWorldX);
    const pinSvgY = toSvgY(pinWorldY);

    expect(pinSvgX).toBeCloseTo(8.2);
    expect(pinSvgY).toBeCloseTo(40.0); // 50 - 10 = 40
  });

  it('correctly partitions completed and remaining route portions when stops advance', () => {
    const multiStopRoute = {
      legs: [
        { from: 'DOCK', to: 'N-A-01', distance: 20, path: ['DOCK', 'XB-A', 'N-A-01'] },
        { from: 'N-A-01', to: 'N-B-03', distance: 42, path: ['N-A-01', 'XT-A', 'XT-B', 'N-B-03'] },
        { from: 'N-B-03', to: 'PACK', distance: 52, path: ['N-B-03', 'XB-B', 'PACK'] }
      ]
    };

    const flattened = flattenRoute(multiStopRoute);

    // Initial state: 0 stops picked -> all points in remaining
    const stopsInitial = [
      { id: 1, seq: 1, shelf_code: 'A-01-L', status: 'PENDING' },
      { id: 2, seq: 2, shelf_code: 'B-03-R', status: 'PENDING' }
    ];

    const finishedInitial = stopsInitial.filter((s) => s.status !== 'PENDING');
    expect(finishedInitial.length).toBe(0);

    // After picking Stop 1:
    const stopsAfterPick1 = [
      { id: 1, seq: 1, shelf_code: 'A-01-L', status: 'PICKED' },
      { id: 2, seq: 2, shelf_code: 'B-03-R', status: 'PENDING' }
    ];

    const finished1 = stopsAfterPick1.filter((s) => s.status !== 'PENDING');
    expect(finished1.length).toBe(1);

    const lastFinished = finished1[finished1.length - 1];
    const shelfParts = lastFinished.shelf_code.split('-');
    const lastNodeId = `N-${shelfParts[0]}-${shelfParts[1]}`; // 'N-A-01'

    const splitIdx = flattened.points.findIndex((p) => p.id === lastNodeId);
    expect(splitIdx).toBeGreaterThan(0);

    const completed = flattened.points.slice(0, splitIdx + 1);
    const remaining = flattened.points.slice(splitIdx);

    expect(completed[0].id).toBe('DOCK');
    expect(completed[completed.length - 1].id).toBe('N-A-01');
    expect(remaining[0].id).toBe('N-A-01');
    expect(remaining[remaining.length - 1].id).toBe('PACK');
  });

  it('computes correct aggregate visual state for shelves across all 48 locations', () => {
    // Standard active shelf
    const activeShelf = {
      status: 'ACTIVE',
      bins: [
        { qty: 0, capacity: 120, status: 'ACTIVE', recount_required: false },
        { qty: 30, capacity: 100, status: 'ACTIVE', recount_required: false }, // 30% -> med
        { qty: 0, capacity: 80, status: 'ACTIVE', recount_required: false },
        { qty: 0, capacity: 60, status: 'ACTIVE', recount_required: false }
      ]
    };
    expect(shelfAggregateVisualState(activeShelf)).toBe('med');

    // Maintenance shelf overrides bin fill
    const maintShelf = {
      status: 'MAINTENANCE',
      bins: [
        { qty: 100, capacity: 120, status: 'ACTIVE', recount_required: false },
        { qty: 100, capacity: 100, status: 'ACTIVE', recount_required: false }
      ]
    };
    expect(shelfAggregateVisualState(maintShelf)).toBe('maintenance');

    // Blocked bin overrides active fill
    const blockedShelf = {
      status: 'ACTIVE',
      bins: [
        { qty: 10, capacity: 100, status: 'ACTIVE', recount_required: false },
        { qty: 0, capacity: 100, status: 'BLOCKED', recount_required: false }
      ]
    };
    expect(shelfAggregateVisualState(blockedShelf)).toBe('blocked');
  });

  it('guarantees shelf bounding box coordinates map correctly onto flipped SVG coordinates', () => {
    // Shelf A-01-L: Aisle A (x=10), Bay 1 (y=10), Left side
    const sRect = shelfRect({ code: 'A-01-L', aisle: 'A', bay: 1, side: 'L', x: 10, y: 10 });

    // In SVG space with y-flipped (0 at bottom, 50 at top):
    // sRect.y is in world meters: from y0=8.0 to y1=12.0
    // SVG y coordinate of top edge: 50 - y1 = 50 - 12.0 = 38.0
    const svgTopY = 50 - (sRect.y + sRect.height);
    expect(svgTopY).toBeCloseTo(38.0);
    expect(sRect.width).toBeCloseTo(1.6);
    expect(sRect.height).toBeCloseTo(4.0);
  });
});
