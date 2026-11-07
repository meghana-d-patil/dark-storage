/**
 * High-performance Canvas 2D Component for the Isometric Digital Twin.
 * Complete Mode 3b Feature Set:
 * - 0 rAF callbacks when idle (render-on-demand).
 * - Capped DPR: min(devicePixelRatio, 1.5).
 * - Point-in-polygon picking with early bbox rejection and click-to-pin.
 * - Interactive floating tooltip matching Mode 1 data.
 * - Level filter with ghosting.
 * - Target bin extrusion and glow halo.
 * - Single-shot animated route picker marker.
 * - Live update diffing and bin flashing.
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { WarehouseLayoutResponse } from '../../hooks/useWarehouseData.js';
import { MissionDto } from '@dark-storage/shared';
import { TwinCamera, CameraPreset } from './camera.js';
import { TwinScene, BinBoxMetadata } from './scene.js';
import { TwinRenderer } from './renderer.js';
import { TwinPerfMonitor, QualitySetting, PerfMetrics } from './perf.js';
import { hitTestBinBox } from './hitTest.js';
import { flattenRoute, FlattenedRoute } from '../../lib/routeGeometry.js';
import { StatusBadge } from '../../components/StatusBadge.js';

export interface TwinCanvasProps {
  layout?: WarehouseLayoutResponse;
  mission?: MissionDto | null;
  locateQuery?: string;
  levelFilter?: 'ALL' | number;
  quality?: QualitySetting;
  presetRequest?: CameraPreset | null;
  resetRequest?: number;
  replayRequest?: number;
  onMetricsUpdate?: (metrics: PerfMetrics) => void;
}

export const TwinCanvas: React.FC<TwinCanvasProps> = ({
  layout,
  mission,
  locateQuery,
  levelFilter = 'ALL',
  quality = 'auto',
  presetRequest,
  resetRequest,
  replayRequest,
  onMetricsUpdate
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [contextAvailable, setContextAvailable] = useState<boolean>(true);

  // Active interaction states
  const [hoveredBoxIdx, setHoveredBoxIdx] = useState<number | null>(null);
  const [pinnedBoxIdx, setPinnedBoxIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Core persistent engines
  const cameraRef = useRef<TwinCamera | null>(null);
  const sceneRef = useRef<TwinScene | null>(null);
  const rendererRef = useRef<TwinRenderer | null>(null);
  const perfRef = useRef<TwinPerfMonitor>(new TwinPerfMonitor());

  // Animation frame & dirty flag
  const rafIdRef = useRef<number | null>(null);
  const isDirtyRef = useRef<boolean>(true);
  const isVisibleRef = useRef<boolean>(true);

  // Live updates diffing & flashing bins
  const previousLayoutRef = useRef<WarehouseLayoutResponse | undefined>(undefined);
  const flashingBinsRef = useRef<Map<string, number>>(new Map());

  // Picker route animation state
  const pickerAnimRef = useRef<{ active: boolean; startTime: number; duration: number }>({
    active: false,
    startTime: 0,
    duration: 3500
  });

  // Target bin code for the next pending stop
  const targetBinCode = useMemo(() => {
    if (!mission?.stops || mission.stops.length === 0) return null;
    const nextPending = mission.stops.find((s) => s.status === 'PENDING');
    return nextPending ? nextPending.bin_code : null;
  }, [mission]);

  // Flattened route
  const flattenedRoute = useMemo<FlattenedRoute | null>(() => {
    if (!mission?.route) return null;
    return flattenRoute(mission.route);
  }, [mission?.route]);

  // Initialize core classes once
  if (!cameraRef.current) {
    cameraRef.current = new TwinCamera();
  }
  if (!sceneRef.current) {
    sceneRef.current = new TwinScene(layout);
  }
  if (!rendererRef.current) {
    rendererRef.current = new TwinRenderer();
  }

  // Update scene when layout changes & detect changed bins for 600ms flash
  useEffect(() => {
    if (sceneRef.current && layout) {
      if (previousLayoutRef.current) {
        const prev = previousLayoutRef.current;
        const now = Date.now();
        // Check for bin qty or status changes
        for (const aisle of layout.aisles) {
          const prevAisle = prev.aisles?.find((a) => a.aisle === aisle.aisle);
          for (const shelf of aisle.shelves) {
            const prevShelf = prevAisle?.shelves?.find((s) => s.code === shelf.code);
            for (const bin of shelf.bins) {
              const prevBin = prevShelf?.bins?.find((b) => b.level === bin.level);
              if (prevBin && (prevBin.qty !== bin.qty || prevBin.status !== bin.status)) {
                flashingBinsRef.current.set(bin.code, now + 600);
              }
            }
          }
        }
      }

      previousLayoutRef.current = layout;
      sceneRef.current.buildFromLayout(layout);
      isDirtyRef.current = true;
      scheduleRender();
    }
  }, [layout]);

  // Handle route change / replay: start single-shot picker travel animation
  useEffect(() => {
    if (flattenedRoute && flattenedRoute.points.length >= 2) {
      pickerAnimRef.current = {
        active: true,
        startTime: performance.now(),
        duration: Math.max(2500, Math.min(5000, flattenedRoute.totalDistance * 40))
      };
      isDirtyRef.current = true;
      scheduleRender();
    }
  }, [flattenedRoute, replayRequest]);

  // Handle locate query centering: smoothly center on first match if search entered
  useEffect(() => {
    if (locateQuery && locateQuery.trim().length >= 2 && sceneRef.current && cameraRef.current) {
      const q = locateQuery.trim().toLowerCase();
      const meta = sceneRef.current.metadata;
      const bounds = sceneRef.current.boxBounds;

      for (let i = 0; i < 192; i++) {
        const m = meta[i];
        if (
          m.binCode.toLowerCase().includes(q) ||
          m.shelfCode.toLowerCase().includes(q) ||
          (m.bin?.sku && m.bin.sku.toLowerCase().includes(q)) ||
          (m.bin?.product_name && m.bin.product_name.toLowerCase().includes(q))
        ) {
          // Found match: smoothly adjust pan
          const off = i * 9;
          const cx = bounds[off + 6];
          const cy = bounds[off + 7];
          const proj = rendererRef.current!.projection;
          // Pan camera slightly towards target
          const p = proj.project(cx, cy, 2);
          const canvas = canvasRef.current;
          if (canvas) {
            const dX = canvas.width / 2 - p.x;
            const dY = canvas.height / 2 - p.y;
            cameraRef.current.state.panX += dX * 0.4;
            cameraRef.current.state.panY += dY * 0.4;
          }
          break;
        }
      }
      isDirtyRef.current = true;
      scheduleRender();
    }
  }, [locateQuery]);

  // Update quality controller
  useEffect(() => {
    perfRef.current.setQuality(quality);
    isDirtyRef.current = true;
    scheduleRender();
  }, [quality]);

  // Level filter changed
  useEffect(() => {
    isDirtyRef.current = true;
    scheduleRender();
  }, [levelFilter]);

  // Handle camera presets
  useEffect(() => {
    if (presetRequest && cameraRef.current) {
      cameraRef.current.applyPreset(presetRequest);
      isDirtyRef.current = true;
      scheduleRender();
    }
  }, [presetRequest]);

  // Handle reset view request
  useEffect(() => {
    if (resetRequest && cameraRef.current && canvasRef.current) {
      cameraRef.current.resetView(canvasRef.current.clientWidth, canvasRef.current.clientHeight);
      setPinnedBoxIdx(null);
      setHoveredBoxIdx(null);
      isDirtyRef.current = true;
      scheduleRender();
    }
  }, [resetRequest]);

  // Render scheduler: starts single rAF loop only when dirty, inertia active, or animating
  const scheduleRender = useCallback(() => {
    if (!isVisibleRef.current) return;
    if (rafIdRef.current !== null) return; // Loop already running

    const loop = (timestamp: number) => {
      const canvas = canvasRef.current;
      const camera = cameraRef.current;
      const scene = sceneRef.current;
      const renderer = rendererRef.current;
      const perf = perfRef.current;

      if (!canvas || !camera || !scene || !renderer) {
        rafIdRef.current = null;
        return;
      }

      // Check quality frame throttling (for Low 30fps cap)
      if (!perf.shouldRenderFrame(timestamp)) {
        rafIdRef.current = requestAnimationFrame(loop);
        return;
      }

      // Step inertia physics
      const moving = camera.tickInertia();

      // Check picker animation progress
      let pickerProgress: number | undefined = undefined;
      let animActive = false;
      if (pickerAnimRef.current.active) {
        const elapsed = timestamp - pickerAnimRef.current.startTime;
        const p = Math.min(1.0, elapsed / pickerAnimRef.current.duration);
        pickerProgress = p;
        if (p >= 1.0) {
          pickerAnimRef.current.active = false;
        } else {
          animActive = true;
        }
      }

      // Check flashing bins
      let hasFlashing = false;
      if (flashingBinsRef.current.size > 0) {
        const now = Date.now();
        for (const [binCode, expires] of flashingBinsRef.current.entries()) {
          if (now >= expires) {
            flashingBinsRef.current.delete(binCode);
          } else {
            hasFlashing = true;
          }
        }
      }

      if (isDirtyRef.current || moving || animActive || hasFlashing) {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setContextAvailable(false);
          rafIdRef.current = null;
          return;
        }

        const t0 = performance.now();
        const dpr = perf.effectiveQuality === 'low' ? 1.0 : Math.min(window.devicePixelRatio || 1, 1.5);
        perf.currentDpr = dpr;

        const width = canvas.width;
        const height = canvas.height;

        const drawCalls = renderer.renderWithOptions({
          ctx,
          scene,
          yaw: camera.state.yaw,
          pitch: camera.state.pitch,
          zoom: camera.state.zoom * dpr,
          panX: camera.state.panX * dpr,
          panY: camera.state.panY * dpr,
          width,
          height,
          dpr,
          quality: perf.effectiveQuality,
          levelFilter,
          targetBinCode,
          hoveredBinIndex: hoveredBoxIdx,
          pinnedBinIndex: pinnedBoxIdx,
          flashingBins: flashingBinsRef.current,
          locateQuery,
          missionRoute: flattenedRoute,
          missionStops: mission?.stops,
          pickerProgress
        });

        const elapsed = performance.now() - t0;
        perf.recordFrame(elapsed);
        perf.currentDrawCalls = drawCalls;

        onMetricsUpdate?.(perf.getMetrics());
        isDirtyRef.current = false;
      }

      // Keep loop alive if inertia, picker animation, or flashing is active; otherwise STOP immediately
      if (moving || camera.hasInertia() || animActive || hasFlashing) {
        rafIdRef.current = requestAnimationFrame(loop);
      } else {
        rafIdRef.current = null;
      }
    };

    rafIdRef.current = requestAnimationFrame(loop);
  }, [
    hoveredBoxIdx,
    pinnedBoxIdx,
    levelFilter,
    targetBinCode,
    flattenedRoute,
    mission?.stops,
    locateQuery,
    onMetricsUpdate
  ]);

  // Wire camera dirty callback
  useEffect(() => {
    if (cameraRef.current) {
      cameraRef.current.setOnChange(() => {
        isDirtyRef.current = true;
        scheduleRender();
      });
    }
  }, [scheduleRender]);

  // Canvas setup, resize observer, and event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Test context availability
    const testCtx = canvas.getContext('2d');
    if (!testCtx) {
      setContextAvailable(false);
      return;
    }

    const camera = cameraRef.current!;

    // Resize handler with capped DPR
    const updateCanvasSize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = perfRef.current.effectiveQuality === 'low' ? 1.0 : Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(100, Math.floor(rect.width));
      const height = Math.max(100, Math.floor(rect.height));

      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        isDirtyRef.current = true;
        scheduleRender();
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
    });
    resizeObserver.observe(container);
    updateCanvasSize();

    // Visibility change handler (pauses rAF when tab is hidden)
    const handleVisibilityChange = () => {
      if (document.hidden) {
        isVisibleRef.current = false;
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      } else {
        isVisibleRef.current = true;
        isDirtyRef.current = true;
        scheduleRender();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Pointer events with hit-testing and click-to-pin
    const onPointerDown = (e: PointerEvent) => {
      canvas.focus();
      camera.handlePointerDown(e, canvas);

      // Perform hit-test on click
      if (sceneRef.current && rendererRef.current) {
        const rect = canvas.getBoundingClientRect();
        const dpr = perfRef.current.currentDpr;
        const screenX = (e.clientX - rect.left) * dpr;
        const screenY = (e.clientY - rect.top) * dpr;

        const hitIdx = hitTestBinBox(screenX, screenY, sceneRef.current, rendererRef.current.projection, levelFilter);
        if (hitIdx !== null) {
          setPinnedBoxIdx((prev) => (prev === hitIdx ? null : hitIdx));
          setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        } else if (e.button === 0 && !e.shiftKey) {
          setPinnedBoxIdx(null);
        }
        isDirtyRef.current = true;
        scheduleRender();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      camera.handlePointerMove(e);

      // Perform hover hit-test (only when not dragging)
      if (sceneRef.current && rendererRef.current) {
        const rect = canvas.getBoundingClientRect();
        const dpr = perfRef.current.currentDpr;
        const screenX = (e.clientX - rect.left) * dpr;
        const screenY = (e.clientY - rect.top) * dpr;

        const hitIdx = hitTestBinBox(screenX, screenY, sceneRef.current, rendererRef.current.projection, levelFilter);
        setHoveredBoxIdx((prev) => {
          if (prev !== hitIdx) {
            isDirtyRef.current = true;
            scheduleRender();
          }
          return hitIdx;
        });

        if (pinnedBoxIdx === null && hitIdx !== null) {
          setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      camera.handlePointerUp(e, canvas);
    };
    const onPointerCancel = (e: PointerEvent) => {
      camera.handlePointerUp(e, canvas);
    };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    const onWheel = (e: WheelEvent) => {
      camera.handleWheel(e);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (camera.handleKeyDown(e)) {
        e.preventDefault();
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKeyDown);

    // Initial render
    isDirtyRef.current = true;
    scheduleRender();

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKeyDown);
    };
  }, [scheduleRender, levelFilter, pinnedBoxIdx]);

  // Selected bin metadata for the floating tooltip
  const activeBoxIdx = pinnedBoxIdx !== null ? pinnedBoxIdx : hoveredBoxIdx;
  const activeBoxMeta: BinBoxMetadata | null = useMemo(() => {
    if (activeBoxIdx === null || !sceneRef.current) return null;
    return sceneRef.current.metadata[activeBoxIdx] || null;
  }, [activeBoxIdx]);

  if (!contextAvailable) {
    return (
      <div
        data-testid="twin-fallback"
        style={{
          padding: '3rem',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          border: '1px dashed var(--border-color)',
          borderRadius: 'var(--radius-md)'
        }}
      >
        <p style={{ fontWeight: 600, marginBottom: '8px' }}>Isometric 3D Digital Twin</p>
        <p style={{ fontSize: '13px' }}>Canvas 2D context is not available in this environment.</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '520px',
        backgroundColor: '#030712',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        outline: 'none'
      }}
    >
      <canvas
        ref={canvasRef}
        data-testid="twin-canvas"
        tabIndex={0}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          cursor: hoveredBoxIdx !== null ? 'pointer' : 'grab',
          touchAction: 'none',
          outline: 'none'
        }}
      />

      {/* Floating 3D Tooltip Card (Matching Mode 1 Content) */}
      {activeBoxMeta && (
        <div
          data-testid="twin-tooltip"
          className="card"
          style={{
            position: 'absolute',
            left: `${Math.min(tooltipPos.x + 16, (containerRef.current?.clientWidth || 800) - 270)}px`,
            top: `${Math.min(tooltipPos.y + 16, (containerRef.current?.clientHeight || 600) - 230)}px`,
            width: '250px',
            padding: '12px',
            backgroundColor: 'rgba(15, 23, 42, 0.94)',
            backdropFilter: 'blur(10px)',
            border: pinnedBoxIdx !== null ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
            zIndex: 20,
            pointerEvents: pinnedBoxIdx !== null ? 'auto' : 'none',
            fontSize: '12px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontWeight: 800, fontFamily: 'var(--font-mono)', fontSize: '14px', color: '#f8fafc' }}>
              {activeBoxMeta.binCode}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className={`badge ${activeBoxMeta.storageClass === 'HAZMAT' ? 'badge-warning' : 'badge-info'}`}>
                {activeBoxMeta.storageClass}
              </span>
              {pinnedBoxIdx !== null && (
                <button
                  type="button"
                  onClick={() => setPinnedBoxIdx(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '14px',
                    padding: '0 2px'
                  }}
                  title="Unpin"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: 'var(--text-secondary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Shelf:</span>
              <strong style={{ color: 'var(--text-primary)' }}>{activeBoxMeta.shelfCode}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Level:</span>
              <strong style={{ color: 'var(--text-primary)' }}>Level {activeBoxMeta.level}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Status:</span>
              <StatusBadge status={activeBoxMeta.bin?.status || activeBoxMeta.shelfStatus} />
            </div>

            {activeBoxMeta.bin?.sku ? (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '6px', marginTop: '4px' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{activeBoxMeta.bin.product_name || 'Item'}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                  SKU: {activeBoxMeta.bin.sku}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                  <span>Occupancy:</span>
                  <strong>
                    {activeBoxMeta.bin.qty} / {activeBoxMeta.bin.capacity}
                  </strong>
                </div>
                {/* Visual Progress Bar */}
                <div className="fill-bar" style={{ height: '6px', marginTop: '4px' }}>
                  <div
                    className={`fill-bar-inner ${
                      activeBoxMeta.bin.qty >= activeBoxMeta.bin.capacity
                        ? 'full'
                        : activeBoxMeta.bin.qty > activeBoxMeta.bin.capacity * 0.75
                        ? 'high'
                        : activeBoxMeta.bin.qty > activeBoxMeta.bin.capacity * 0.25
                        ? 'med'
                        : 'low'
                    }`}
                    style={{ width: `${Math.min(100, (activeBoxMeta.bin.qty / activeBoxMeta.bin.capacity) * 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '4px' }}>
                Empty bin (0 / {activeBoxMeta.bin?.capacity || 50})
              </div>
            )}

            {activeBoxMeta.bin?.recount_required && (
              <div style={{ color: 'var(--accent-warning)', fontWeight: 700, marginTop: '4px', fontSize: '11px' }}>
                ⚠ Recount Required
              </div>
            )}

            <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text-muted)', textAlign: 'right' }}>
              {pinnedBoxIdx !== null ? '📌 Pinned (click to release)' : 'Click to pin details'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
