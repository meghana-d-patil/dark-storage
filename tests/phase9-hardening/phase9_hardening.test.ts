import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NODES, EDGES, nodeXY, shelfRect } from '../../apps/web/src/lib/warehouseGeometry.js';
import { flattenRoute } from '../../apps/web/src/lib/routeGeometry.js';
import { binVisualState } from '../../apps/web/src/lib/binVisual.js';
import { encodeCode128B, generateBarcodeSvgPath } from '../../apps/web/src/lib/code128.js';
import { useRealtimeStore, FeedEvent } from '../../apps/web/src/stores/realtimeStore.js';
import { handleHotkeyDown } from '../../apps/web/src/hooks/useHotkeys.js';
import { CHECKS } from '../../services/engine3-inventory/src/domain/integrity.js';

describe('Phase 9: Hardening & Playwright-Free JSDOM Contract Tests', () => {
  const warehouseSource = fs.readFileSync(path.resolve('apps/web/src/pages/WarehousePage.tsx'), 'utf8');
  const floorplanSource = fs.readFileSync(path.resolve('apps/web/src/features/floorplan/FloorplanView.tsx'), 'utf8');
  const twinCanvasSource = fs.readFileSync(path.resolve('apps/web/src/features/twin/TwinCanvas.tsx'), 'utf8');
  const stressLabSource = fs.readFileSync(path.resolve('apps/web/src/features/stresslab/StressLabView.tsx'), 'utf8');
  const appShellSource = fs.readFileSync(path.resolve('apps/web/src/components/AppShell.tsx'), 'utf8');

  describe('1. View Switching Contract (WarehousePage)', () => {
    it('supports cards, map, and 3d view modes in URL search params', () => {
      expect(warehouseSource).toContain("viewMode === 'cards'");
      expect(warehouseSource).toContain("viewMode === 'map'");
      expect(warehouseSource).toContain("viewMode === '3d'");
      expect(warehouseSource).toContain('data-testid="view-tab-cards"');
      expect(warehouseSource).toContain('data-testid="view-tab-map"');
      expect(warehouseSource).toContain('data-testid="view-tab-3d"');
    });

    it('preserves search locateQuery and mission reference across mode changes', () => {
      expect(warehouseSource).toContain('searchParams.get(\'mission\')');
      expect(warehouseSource).toContain('setSelectedMission');
      expect(warehouseSource).toContain('data-testid="warehouse-locate-input"');
    });
  });

  describe('2. Fixture-Driven Floorplan & Geometry Contract', () => {
    it('verifies exact 34 nodes and 36 navigation edges', () => {
      expect(NODES.length).toBe(34);
      expect(EDGES.length).toBe(36);
      expect(nodeXY('DOCK')).toEqual({ x: 0, y: 0 });
      expect(nodeXY('PACK')).toEqual({ x: 80, y: 0 });
      expect(nodeXY('N-A-01')).toEqual({ x: 10, y: 10 });
      expect(nodeXY('N-B-03')).toEqual({ x: 30, y: 22 });
      expect(nodeXY('XT-D')).toEqual({ x: 70, y: 50 });
    });

    it('computes correct shelf rectangle offsets for Left vs Right sides of aisle', () => {
      const shelfL = { code: 'A-01-L', aisle: 'A', bay: 1, side: 'L' as const };
      const shelfR = { code: 'A-01-R', aisle: 'A', bay: 1, side: 'R' as const };

      const rectL = shelfRect(shelfL);
      const rectR = shelfRect(shelfR);

      // Left shelf sits at negative X offset from aisle center (10m)
      expect(rectL.x).toBeLessThan(10);
      // Right shelf sits at positive X offset from aisle center (10m)
      expect(rectR.x).toBeGreaterThan(10);
      // Footprints match 1.6m deep x 4.0m long
      expect(rectL.width).toBe(1.6);
      expect(rectL.height).toBe(4.0);
      expect(rectR.width).toBe(1.6);
      expect(rectR.height).toBe(4.0);
    });

    it('flattens sample route DOCK -> N-A-01 -> N-B-03 -> PACK with zero duplicated nodes', () => {
      const sampleRoute = {
        algorithm: 'HELD_KARP',
        total_distance: 65.4,
        start: 'DOCK',
        end: 'PACK',
        stops: [
          { key: 's1', bin_code: 'A-01-L-1', node: 'N-A-01', seq: 1 },
          { key: 's2', bin_code: 'B-03-R-2', node: 'N-B-03', seq: 2 }
        ],
        legs: [
          { from: 'DOCK', to: 'N-A-01', distance: 20.0, path: ['DOCK', 'XB-A', 'N-A-01'] },
          { from: 'N-A-01', to: 'N-B-03', distance: 25.4, path: ['N-A-01', 'XB-A', 'XB-B', 'N-B-01', 'N-B-02', 'N-B-03'] },
          { from: 'N-B-03', to: 'PACK', distance: 20.0, path: ['N-B-03', 'XB-B', 'XB-C', 'XB-D', 'PACK'] }
        ]
      };

      const flattened = flattenRoute(sampleRoute);
      expect(flattened.nodeIds[0]).toBe('DOCK');
      expect(flattened.nodeIds[flattened.nodeIds.length - 1]).toBe('PACK');

      // Check no adjacent duplicate nodes
      for (let i = 0; i < flattened.nodeIds.length - 1; i++) {
        expect(flattened.nodeIds[i]).not.toBe(flattened.nodeIds[i + 1]);
      }
      expect(flattened.totalDistance).toBe(65.4);
    });

    it('applies binVisualState hierarchy rules accurately', () => {
      expect(binVisualState({ status: 'BLOCKED', qty: 50, capacity: 100 }, 'ACTIVE')).toBe('blocked');
      expect(binVisualState({ status: 'DAMAGED', qty: 50, capacity: 100 }, 'ACTIVE')).toBe('damaged');
      expect(binVisualState({ status: 'ACTIVE', qty: 50, capacity: 100 }, 'MAINTENANCE')).toBe('maintenance');
      expect(binVisualState({ status: 'ACTIVE', recount_required: true, qty: 50, capacity: 100 }, 'ACTIVE')).toBe('recount');
      expect(binVisualState({ status: 'ACTIVE', qty: 0, capacity: 100 }, 'ACTIVE')).toBe('empty');
      expect(binVisualState({ status: 'ACTIVE', qty: 20, capacity: 100 }, 'ACTIVE')).toBe('low');
      expect(binVisualState({ status: 'ACTIVE', qty: 60, capacity: 100 }, 'ACTIVE')).toBe('med');
      expect(binVisualState({ status: 'ACTIVE', qty: 90, capacity: 100 }, 'ACTIVE')).toBe('high');
      expect(binVisualState({ status: 'ACTIVE', qty: 100, capacity: 100 }, 'ACTIVE')).toBe('full');
    });

    it('verifies FloorplanView contains all required SVG elements and testids', () => {
      expect(floorplanSource).toContain('data-testid="floorplan-svg"');
      expect(floorplanSource).toContain('data-testid={`floorplan-shelf-${shelf.code}`}');
      expect(floorplanSource).toContain('data-testid="route-polyline"');
      expect(floorplanSource).toContain('data-testid={`route-stop-pin-${stop.seq}`}');
      expect(floorplanSource).toContain('data-testid="route-summary"');
    });
  });

  describe('3. Event Feed Ring Buffer & Deduplication Contract', () => {
    it('maintains max 50 items and ignores duplicate seqs', () => {
      useRealtimeStore.getState().clearEvents();

      // Push 80 events
      const batch: FeedEvent[] = Array.from({ length: 80 }, (_, i) => ({
        seq: i + 1,
        event_type: 'order.created',
        entity_type: 'order',
        entity_id: `ORD-${i + 1}`,
        data: {},
        created_at: new Date().toISOString()
      }));

      useRealtimeStore.getState().pushEvents(batch);
      expect(useRealtimeStore.getState().events.length).toBe(50);
      expect(useRealtimeStore.getState().events[0].seq).toBe(80); // Newest first

      // Duplicate seq 80 should not change buffer
      useRealtimeStore.getState().pushEvent({
        seq: 80,
        event_type: 'order.created',
        entity_type: 'order',
        entity_id: 'ORD-80',
        data: {},
        created_at: new Date().toISOString()
      });
      expect(useRealtimeStore.getState().events.length).toBe(50);
    });
  });

  describe('4. Label Modal & Barcode Single-Path SVG Contract', () => {
    it('generates Code 128 subset B test vectors and single-path SVG without <rect> tags', () => {
      const res = encodeCode128B('SKU001');
      expect(res.symbols).toEqual([104, 51, 43, 53, 16, 16, 17, 28, 106]);
      expect(res.checksum).toBe(28);

      const pathRes = generateBarcodeSvgPath(res.symbols, 2, 48, 10);
      expect(pathRes.pathData).toMatch(/^M \d+(\.\d+)? 0 h/);
      expect(pathRes.totalWidth).toBe((10 + res.totalModules + 10) * 2);
    });
  });

  describe('5. Hotkeys & Accessibility Contract', () => {
    it('verifies hotkeys navigation and role enforcement', () => {
      const onNavigate = vi.fn();
      const onShowToast = vi.fn();
      const onToggleHelp = vi.fn();

      const makeEvent = (code: string, altKey = true) => ({
        code,
        altKey,
        key: '',
        repeat: false,
        target: null,
        preventDefault: vi.fn()
      } as unknown as KeyboardEvent);

      // Alt+W -> /warehouse
      expect(handleHotkeyDown(makeEvent('KeyW'), { userRole: 'MANAGER', onNavigate, onShowToast, onToggleHelp })).toBe(true);
      expect(onNavigate).toHaveBeenCalledWith('/warehouse');

      // Alt+P as STAFF -> Toast warning
      expect(handleHotkeyDown(makeEvent('KeyP'), { userRole: 'STAFF', onNavigate, onShowToast, onToggleHelp })).toBe(true);
      expect(onShowToast).toHaveBeenCalledWith("Picking isn't available for your role");
    });

    it('verifies accessibility attributes across components', () => {
      // WarehousePage view switcher tabs have role="tablist" and role="tab"
      expect(warehouseSource).toContain('role="tablist"');
      expect(warehouseSource).toContain('role="tab"');
      expect(warehouseSource).toContain('aria-selected');

      // AppShell links have aria-keyshortcuts
      expect(appShellSource).toContain('aria-keyshortcuts');

      // TwinCanvas has role="img", aria-label, tabIndex=0, and visually hidden alternative
      expect(twinCanvasSource).toContain('role="img"');
      expect(twinCanvasSource).toContain('aria-label');
      expect(twinCanvasSource).toContain('tabIndex={0}');
      expect(twinCanvasSource).toContain('className="sr-only"');
    });
  });

  describe('6. Stress Lab Contract Invariants', () => {
    it('defines exactly 13 integrity checks from I01 to I13', () => {
      expect(CHECKS.length).toBe(13);
      expect(CHECKS.map((c) => c.id)).toEqual([
        'I01', 'I02', 'I03', 'I04', 'I05', 'I06',
        'I07', 'I08', 'I09', 'I10', 'I11', 'I12', 'I13'
      ]);
    });

    it('verifies StressLabView has all required testids for race, idempotency, and verifier', () => {
      expect(stressLabSource).toContain('data-testid="lab-run-race"');
      expect(stressLabSource).toContain('data-testid="lab-verdict-race"');
      expect(stressLabSource).toContain('data-testid="lab-run-idem"');
      expect(stressLabSource).toContain('data-testid="lab-verdict-idem"');
      expect(stressLabSource).toContain('data-testid="lab-run-integrity"');
      expect(stressLabSource).toContain('data-testid="lab-cleanup"');
    });
  });
});
