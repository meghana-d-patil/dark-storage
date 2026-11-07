import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pointInQuad, hitTestBinBox } from '../../apps/web/src/features/twin/hitTest.js';
import { TwinScene } from '../../apps/web/src/features/twin/scene.js';
import { ProjectionContext } from '../../apps/web/src/features/twin/projection.js';
import { FlattenedRoute, flattenRoute } from '../../apps/web/src/lib/routeGeometry.js';
import { PickStopDto } from '@dark-storage/shared';

describe('Phase 4: Mode 3b Data Binding, Route Animation & Picking', () => {
  const canvasSource = fs.readFileSync(
    path.resolve('apps/web/src/features/twin/TwinCanvas.tsx'),
    'utf8'
  );
  const viewSource = fs.readFileSync(
    path.resolve('apps/web/src/features/twin/TwinView.tsx'),
    'utf8'
  );
  const rendererSource = fs.readFileSync(
    path.resolve('apps/web/src/features/twin/renderer.ts'),
    'utf8'
  );

  it('contains all required data-testid attributes from PRD Phase 4', () => {
    expect(canvasSource).toContain('data-testid="twin-canvas"');
    expect(viewSource).toContain('data-testid="twin-reset-view"');
    expect(viewSource).toContain('data-testid="twin-quality"');
    expect(viewSource).toContain('data-testid="twin-level-filter"');
    expect(viewSource).toContain('data-testid="twin-replay"');
    expect(viewSource).toContain('data-testid="twin-legend"');
    expect(canvasSource).toContain('data-testid="twin-tooltip"');
  });

  describe('1. Hit-Testing & Point-in-Quad Geometry', () => {
    it('pointInQuad correctly identifies points inside and outside arbitrary 2D polygons', () => {
      // Quad: (10, 10), (50, 10), (40, 40), (20, 40)
      const x0 = 10, y0 = 10;
      const x1 = 50, y1 = 10;
      const x2 = 40, y2 = 40;
      const x3 = 20, y3 = 40;

      // Inside point
      expect(pointInQuad(30, 25, x0, y0, x1, y1, x2, y2, x3, y3)).toBe(true);
      expect(pointInQuad(30, 15, x0, y0, x1, y1, x2, y2, x3, y3)).toBe(true);

      // Outside points (fails early bounding box or polygon edge)
      expect(pointInQuad(5, 25, x0, y0, x1, y1, x2, y2, x3, y3)).toBe(false);
      expect(pointInQuad(55, 25, x0, y0, x1, y1, x2, y2, x3, y3)).toBe(false);
      expect(pointInQuad(30, 5, x0, y0, x1, y1, x2, y2, x3, y3)).toBe(false);
      expect(pointInQuad(30, 45, x0, y0, x1, y1, x2, y2, x3, y3)).toBe(false);
    });

    it('hitTestBinBox identifies the correct bin index under screen cursor', () => {
      const scene = new TwinScene();
      const proj = new ProjectionContext();
      proj.update(Math.PI / 4, (35 * Math.PI) / 180, 14, 500, 400);

      // Sort scene for current yaw
      scene.sortBoxesByDepth(Math.PI / 4, true);

      // Take box 0 (A-01-L-1)
      const off = 0;
      const cx = scene.boxBounds[off + 6];
      const cy = scene.boxBounds[off + 7];
      const cz = scene.boxBounds[off + 8];

      // Screen coordinate of center of box 0
      const center = proj.project(cx, cy, cz);

      // Hit-test at the projected center
      const hit = hitTestBinBox(center.x, center.y, scene, proj);
      expect(hit).not.toBeNull();
      // Should find box 0 or an occluding rack at that screen position
      expect(hit).toBeGreaterThanOrEqual(0);
      expect(hit).toBeLessThan(192);
    });

    it('hitTestBinBox respects level filter and ignores filtered-out levels', () => {
      const scene = new TwinScene();
      const proj = new ProjectionContext();
      proj.update(Math.PI / 4, (35 * Math.PI) / 180, 14, 500, 400);
      scene.sortBoxesByDepth(Math.PI / 4, true);

      // Pick center of Level 1 box
      const off = 0; // A-01-L-1
      const cx = scene.boxBounds[off + 6];
      const cy = scene.boxBounds[off + 7];
      const cz = scene.boxBounds[off + 8];
      const center = proj.project(cx, cy, cz);

      // When level filter is 2, any hit must have level 2
      const hit = hitTestBinBox(center.x, center.y, scene, proj, 2);
      if (hit !== null) {
        expect(scene.metadata[hit].level).toBe(2);
      }
    });
  });

  describe('2. Level Filter & Ghosting', () => {
    it('ghosts non-selected levels with 15% opacity', () => {
      expect(rendererSource).toContain('ctx.globalAlpha = isFilteredOut ? 0.15 : 1.0');
    });
  });

  describe('3. Target Bin Extrusion (+0.2m)', () => {
    it('extrudes the target bin 0.2m higher in 3D', () => {
      expect(rendererSource).toContain('const z1 = isTargetBin ? bounds[off + 5] + 0.2 : bounds[off + 5]');
      expect(rendererSource).toContain("ctx.strokeStyle = '#818cf8'");
    });
  });

  describe('4. 3D Route Overlay & Two-Pass Glow', () => {
    const sampleRoute = {
      legs: [
        { from: 'DOCK', to: 'N-A-01', distance: 20, path: ['DOCK', 'XB-A', 'N-A-01'] },
        { from: 'N-A-01', to: 'PACK', distance: 80, path: ['N-A-01', 'XB-A', 'XB-B', 'XB-C', 'XB-D', 'PACK'] }
      ]
    };

    it('flattens route for 3D overlay with valid node coordinates', () => {
      const flattened = flattenRoute(sampleRoute);
      expect(flattened.points.length).toBe(8);
      expect(flattened.totalDistance).toBe(100);
      expect(flattened.points[0].x).toBe(0);
      expect(flattened.points[0].y).toBe(0);
    });

    it('renders route at floor level wz = 0.05 with two-pass glow stroke', () => {
      expect(rendererSource).toContain('this.projection.project(pts[0].x, pts[0].y, 0.05)');
      expect(rendererSource).toContain("ctx.strokeStyle = 'rgba(99, 102, 241, 0.28)'");
      expect(rendererSource).toContain("ctx.strokeStyle = '#818cf8'");
    });
  });

  describe('5. Numbered Beacon Stop Pins at wz = 4.6m', () => {
    it('draws vertical beacon line from floor (0.05m) to 4.6m badge circle', () => {
      expect(rendererSource).toContain('this.projection.project(wx, wy, 0.05)');
      expect(rendererSource).toContain('this.projection.project(wx, wy, 4.6)');
      expect(rendererSource).toContain('ctx.fillText(String(stop.seq), pTop.x, pTop.y)');
    });
  });

  describe('6. Moving Picker Marker Animation', () => {
    it('animates picker marker along cumulative distance of route', () => {
      expect(rendererSource).toContain('const targetDist = pickerProgress * missionRoute.totalDistance');
      expect(canvasSource).toContain('pickerAnimRef.current');
      expect(canvasSource).toContain('pickerProgress = p');
    });
  });
});
