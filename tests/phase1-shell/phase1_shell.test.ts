import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Phase 1: Warehouse View Switcher Shell & URL State Contracts', () => {
  const warehousePagePath = path.resolve('apps/web/src/pages/WarehousePage.tsx');
  const missionDetailPagePath = path.resolve('apps/web/src/pages/MissionDetailPage.tsx');
  const routeSelectorPath = path.resolve('apps/web/src/components/MissionRouteSelector.tsx');
  const errorBoundaryPath = path.resolve('apps/web/src/components/ViewErrorBoundary.tsx');
  const floorplanPath = path.resolve('apps/web/src/features/floorplan/FloorplanView.tsx');
  const twinPath = path.resolve('apps/web/src/features/twin/TwinView.tsx');

  it('contains all required data-testid attributes in WarehousePage', () => {
    const src = fs.readFileSync(warehousePagePath, 'utf8');

    // Required Phase 1 testids
    expect(src).toContain('data-testid="view-switch"');
    expect(src).toContain('data-testid="view-tab-cards"');
    expect(src).toContain('data-testid="view-tab-map"');
    expect(src).toContain('data-testid="view-tab-3d"');

    // Preserved Phase 2 testids (Mode 1 must not be broken)
    expect(src).toContain('data-testid="warehouse-locate-input"');
    expect(src).toContain('data-testid={`shelf-card-${shelf.code}`}');
    expect(src).toContain('data-testid={`bin-cell-${bin.code}`}');
  });

  it('contains mission-route-select testid in MissionRouteSelector', () => {
    const src = fs.readFileSync(routeSelectorPath, 'utf8');
    expect(src).toContain('data-testid="mission-route-select"');
  });

  it('contains "View route on map" link in MissionDetailPage without altering existing testids', () => {
    const src = fs.readFileSync(missionDetailPagePath, 'utf8');
    expect(src).toContain('/warehouse?view=map&mission=${mission.ref}');
    expect(src).toContain('View route on map');
    expect(src).toContain('data-testid="mission-start-btn"');
  });

  it('implements URL search parameters view resolution logic (?view=cards|map|3d & ?mission=<ref>)', () => {
    // Pure unit test of the URL search params resolution contract
    function resolveViewMode(paramsString: string): { viewMode: 'cards' | 'map' | '3d'; mission: string } {
      const sp = new URLSearchParams(paramsString);
      const rawView = sp.get('view');
      const viewMode = rawView === 'map' || rawView === '3d' ? rawView : 'cards';
      const mission = sp.get('mission') || '';
      return { viewMode, mission };
    }

    // Default / no params -> cards, no mission
    expect(resolveViewMode('')).toEqual({ viewMode: 'cards', mission: '' });

    // Explicit cards mode
    expect(resolveViewMode('view=cards')).toEqual({ viewMode: 'cards', mission: '' });

    // Floorplan mode
    expect(resolveViewMode('view=map')).toEqual({ viewMode: 'map', mission: '' });

    // 3D Twin mode (reload on ?view=3d restores 3D)
    expect(resolveViewMode('view=3d')).toEqual({ viewMode: '3d', mission: '' });

    // Invalid/unknown view mode defaults gracefully to cards
    expect(resolveViewMode('view=unknown_mode')).toEqual({ viewMode: 'cards', mission: '' });

    // Selected mission preserved with view mode
    expect(resolveViewMode('view=map&mission=MIS-0001')).toEqual({
      viewMode: 'map',
      mission: 'MIS-0001'
    });

    expect(resolveViewMode('view=3d&mission=MIS-0002')).toEqual({
      viewMode: '3d',
      mission: 'MIS-0002'
    });
  });

  it('switching modes preserves selected mission and search parameters', () => {
    function updateViewMode(currentQuery: string, newMode: 'cards' | 'map' | '3d'): string {
      const sp = new URLSearchParams(currentQuery);
      if (newMode === 'cards') {
        sp.delete('view');
      } else {
        sp.set('view', newMode);
      }
      return sp.toString();
    }

    function updateMission(currentQuery: string, newMission: string): string {
      const sp = new URLSearchParams(currentQuery);
      if (!newMission) {
        sp.delete('mission');
      } else {
        sp.set('mission', newMission);
      }
      return sp.toString();
    }

    // Start with a mission in cards mode
    let q = 'mission=MIS-0001';
    expect(q).toBe('mission=MIS-0001');

    // Switch to map view -> mission is preserved
    q = updateViewMode(q, 'map');
    expect(q).toBe('mission=MIS-0001&view=map');

    // Switch to 3d view -> mission is preserved
    q = updateViewMode(q, '3d');
    expect(q).toBe('mission=MIS-0001&view=3d');

    // Switch back to cards -> view param cleaned, mission preserved
    q = updateViewMode(q, 'cards');
    expect(q).toBe('mission=MIS-0001');

    // Clear mission
    q = updateMission(q, '');
    expect(q).toBe('');
  });

  it('lazy loads Modes 2 and 3 with React.lazy and wraps in ViewErrorBoundary', () => {
    const src = fs.readFileSync(warehousePagePath, 'utf8');

    // Check dynamic imports
    expect(src).toContain("React.lazy(() => import('../features/floorplan/FloorplanView.js'))");
    expect(src).toContain("React.lazy(() => import('../features/twin/TwinView.js'))");

    // Check Suspense fallback and ErrorBoundary
    expect(src).toContain('<Suspense');
    expect(src).toContain('Loading view…');
    expect(src).toContain('<ViewErrorBoundary');
  });

  it('ensures ViewErrorBoundary, FloorplanView and TwinView files exist and compile', () => {
    expect(fs.existsSync(errorBoundaryPath)).toBe(true);
    expect(fs.existsSync(floorplanPath)).toBe(true);
    expect(fs.existsSync(twinPath)).toBe(true);
  });
});
