import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectionContext } from '../../apps/web/src/features/twin/projection.js';
import { TwinScene } from '../../apps/web/src/features/twin/scene.js';
import { TwinCamera } from '../../apps/web/src/features/twin/camera.js';
import { TwinPerfMonitor } from '../../apps/web/src/features/twin/perf.js';
import { SHADED_PALETTES } from '../../apps/web/src/features/twin/renderer.js';

describe('Phase 3: Mode 3a Isometric Engine Core (Canvas 2D)', () => {
  const canvasSource = fs.readFileSync(
    path.resolve('apps/web/src/features/twin/TwinCanvas.tsx'),
    'utf8'
  );
  const viewSource = fs.readFileSync(
    path.resolve('apps/web/src/features/twin/TwinView.tsx'),
    'utf8'
  );

  it('contains all required data-testid attributes and clean unmount lifecycle', () => {
    expect(canvasSource).toContain('data-testid="twin-canvas"');
    expect(canvasSource).toContain('data-testid="twin-fallback"');
    expect(viewSource).toContain('data-testid="twin-reset-view"');
    expect(viewSource).toContain('data-testid="twin-quality"');
    expect(viewSource).toContain('data-testid="twin-perf-hud"');

    // Performance contract: 0 rAF when idle
    expect(canvasSource).toContain('rafIdRef.current = null');
    // Clean unmount cancels rAF and cleans listeners
    expect(canvasSource).toContain('cancelAnimationFrame(rafIdRef.current)');
    expect(canvasSource).toContain('resizeObserver.disconnect()');
  });

  describe('1. Projection Mathematics (Section 2.1)', () => {
    it('accurately projects world coordinates to screen space using Section 2.1 formulas', () => {
      const proj = new ProjectionContext();
      const yaw = Math.PI / 4; // 45°
      const pitch = (35 * Math.PI) / 180; // 35°
      const zoom = 10;
      const cx = 400;
      const cy = 300;

      proj.update(yaw, pitch, zoom, cx, cy);

      const wx = 10;
      const wy = 20;
      const wz = 3;

      const expectedU = wx * Math.cos(yaw) - wy * Math.sin(yaw);
      const expectedV = wx * Math.sin(yaw) + wy * Math.cos(yaw);
      const expectedX = cx + expectedU * zoom;
      const expectedY = cy + expectedV * zoom * Math.sin(pitch) - wz * zoom * Math.cos(pitch);

      const result = proj.project(wx, wy, wz);

      expect(result.x).toBeCloseTo(expectedX, 4);
      expect(result.y).toBeCloseTo(expectedY, 4);
      expect(result.depth).toBeCloseTo(expectedV, 4);
    });

    it('projects all 8 corners of a bounding box in-place with zero object allocations', () => {
      const proj = new ProjectionContext();
      proj.update(Math.PI / 4, (35 * Math.PI) / 180, 10, 500, 400);

      proj.projectBoxCorners(5, 10, 0, 7, 14, 1);

      expect(proj.vX.length).toBe(8);
      expect(proj.vY.length).toBe(8);

      // Corner 0: (x0, y0, z0) = (5, 10, 0)
      const c0 = proj.project(5, 10, 0);
      expect(proj.vX[0]).toBeCloseTo(c0.x, 4);
      expect(proj.vY[0]).toBeCloseTo(c0.y, 4);

      // Corner 6: (x1, y1, z1) = (7, 14, 1)
      const c6 = proj.project(7, 14, 1);
      expect(proj.vX[6]).toBeCloseTo(c6.x, 4);
      expect(proj.vY[6]).toBeCloseTo(c6.y, 4);
    });

    it('correctly sets face normal visibility signs across 4 rotation quadrants', () => {
      const proj = new ProjectionContext();

      // Quadrant 1: 45° (cos > 0, sin > 0)
      proj.update(Math.PI / 4, (35 * Math.PI) / 180, 10, 0, 0);
      expect(proj.signCos).toBe(1);
      expect(proj.signSin).toBe(1);

      // Quadrant 2: 135° (cos < 0, sin > 0)
      proj.update((3 * Math.PI) / 4, (35 * Math.PI) / 180, 10, 0, 0);
      expect(proj.signCos).toBe(-1);
      expect(proj.signSin).toBe(1);

      // Quadrant 3: 225° (cos < 0, sin < 0)
      proj.update((5 * Math.PI) / 4, (35 * Math.PI) / 180, 10, 0, 0);
      expect(proj.signCos).toBe(-1);
      expect(proj.signSin).toBe(-1);

      // Quadrant 4: 315° (cos > 0, sin < 0)
      proj.update((7 * Math.PI) / 4, (35 * Math.PI) / 180, 10, 0, 0);
      expect(proj.signCos).toBe(1);
      expect(proj.signSin).toBe(-1);
    });
  });

  describe('2. Scene Geometry & Depth Sorting', () => {
    const scene = new TwinScene();

    it('precomputes exactly 192 bin boxes (48 shelves x 4 vertical levels)', () => {
      expect(scene.count).toBe(192);
      expect(scene.metadata.length).toBe(192);
      expect(scene.sortedIndices.length).toBe(192);
      expect(scene.binIndexMap.size).toBe(192);

      // Check first and last bins
      expect(scene.metadata[0].binCode).toBe('A-01-L-1');
      expect(scene.metadata[191].binCode).toBe('D-06-R-4');
    });

    it('ensures all boxes have positive non-zero volume and fit within warehouse bounds', () => {
      for (let i = 0; i < 192; i++) {
        const off = i * 9;
        const x0 = scene.boxBounds[off + 0];
        const y0 = scene.boxBounds[off + 1];
        const z0 = scene.boxBounds[off + 2];
        const x1 = scene.boxBounds[off + 3];
        const y1 = scene.boxBounds[off + 4];
        const z1 = scene.boxBounds[off + 5];

        expect(x1).toBeGreaterThan(x0);
        expect(y1).toBeGreaterThan(y0);
        expect(z1).toBeGreaterThan(z0);

        // Within 80m x 50m x 5m
        expect(x0).toBeGreaterThanOrEqual(0);
        expect(x1).toBeLessThanOrEqual(80);
        expect(y0).toBeGreaterThanOrEqual(0);
        expect(y1).toBeLessThanOrEqual(50);
        expect(z0).toBeGreaterThanOrEqual(0);
        expect(z1).toBeLessThanOrEqual(5.0);
      }
    });

    it('correctly sorts 192 boxes by depth using Painter\'s algorithm (far to near)', () => {
      const yaw = Math.PI / 4;
      scene.sortBoxesByDepth(yaw, true);

      // Verify sorted order: each depth must be <= next depth
      for (let i = 0; i < 191; i++) {
        const dCurrent = scene.depths[scene.sortedIndices[i]];
        const dNext = scene.depths[scene.sortedIndices[i + 1]];
        expect(dCurrent).toBeLessThanOrEqual(dNext);
      }
    });
  });

  describe('3. Camera Controller & Presets', () => {
    it('initializes with default isometric angles', () => {
      const camera = new TwinCamera();
      expect(camera.state.yaw).toBeCloseTo(Math.PI / 4, 4);
      expect(camera.state.pitch).toBeCloseTo((35 * Math.PI) / 180, 4);
      expect(camera.state.zoom).toBeGreaterThanOrEqual(6);
    });

    it('applies camera presets accurately', () => {
      const camera = new TwinCamera();

      // Top-Down
      camera.applyPreset('top');
      expect(camera.state.yaw).toBe(0);
      expect(camera.state.pitch).toBeCloseTo((60 * Math.PI) / 180, 4);

      // Front
      camera.applyPreset('front');
      expect(camera.state.yaw).toBe(0);
      expect(camera.state.pitch).toBeCloseTo((20 * Math.PI) / 180, 4);

      // Isometric
      camera.applyPreset('iso');
      expect(camera.state.yaw).toBeCloseTo(Math.PI / 4, 4);
      expect(camera.state.pitch).toBeCloseTo((35 * Math.PI) / 180, 4);
    });

    it('clamps pitch strictly between 20° and 60°', () => {
      const camera = new TwinCamera();

      // Simulate extreme up key presses
      for (let i = 0; i < 50; i++) {
        camera.handleKeyDown({ key: 'ArrowUp', preventDefault: () => {} } as any);
      }
      expect(camera.state.pitch).toBeLessThanOrEqual((60 * Math.PI) / 180 + 0.0001);

      // Simulate extreme down key presses
      for (let i = 0; i < 50; i++) {
        camera.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} } as any);
      }
      expect(camera.state.pitch).toBeGreaterThanOrEqual((20 * Math.PI) / 180 - 0.0001);
    });

    it('decays inertia with friction until velocity falls below threshold', () => {
      const camera = new TwinCamera();
      // Inject synthetic drag velocity
      (camera as any).vYaw = 0.05;

      let ticks = 0;
      while (camera.tickInertia() && ticks < 200) {
        ticks++;
      }

      expect(ticks).toBeGreaterThan(5);
      expect(ticks).toBeLessThan(100);
      expect(camera.hasInertia()).toBe(false);
    });
  });

  describe('4. Performance Monitor & Quality Controller', () => {
    it('switches to low quality when rolling frame average exceeds 12ms', () => {
      const perf = new TwinPerfMonitor();
      perf.setQuality('auto');
      expect(perf.effectiveQuality).toBe('high');

      // Simulate 20 heavy frames of 15ms
      for (let i = 0; i < 20; i++) {
        perf.recordFrame(15.0);
      }

      expect(perf.effectiveQuality).toBe('low');
    });

    it('recovers to high quality when rolling frame average drops below 8ms', () => {
      const perf = new TwinPerfMonitor();
      perf.setQuality('auto');
      perf.effectiveQuality = 'low';

      // Simulate 25 fast frames of 4ms
      for (let i = 0; i < 25; i++) {
        perf.recordFrame(4.0);
      }

      expect(perf.effectiveQuality).toBe('high');
    });

    it('throttles rendering to ~30 fps when effective quality is low', () => {
      const perf = new TwinPerfMonitor();
      perf.setQuality('low');

      expect(perf.shouldRenderFrame(1000)).toBe(true);
      // Immediately after (10ms later) should be throttled
      expect(perf.shouldRenderFrame(1010)).toBe(false);
      // After 35ms should be allowed
      expect(perf.shouldRenderFrame(1035)).toBe(true);
    });
  });

  describe('5. Flat Face Shading Palettes', () => {
    it('has precomputed flat shading for all visual states', () => {
      const states = ['default', 'hazmat', 'maintenance', 'empty', 'low', 'med', 'high', 'full', 'blocked', 'damaged', 'recount'];
      for (const st of states) {
        const palette = SHADED_PALETTES[st];
        expect(palette).toBeDefined();
        expect(palette.top).toMatch(/^(#|rgba?\()/);
        expect(palette.front).toMatch(/^rgba?\(/);
        expect(palette.side).toMatch(/^rgba?\(/);
        expect(palette.stroke).toBeDefined();
      }
    });
  });
});
