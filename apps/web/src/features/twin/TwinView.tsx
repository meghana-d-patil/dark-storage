/**
 * Isometric Digital Twin View (Mode 3b).
 * Complete 3D warehouse twin with:
 * - Level filter chips (All, L1..L4) (data-testid="twin-level-filter")
 * - Route Replay button (data-testid="twin-replay")
 * - Visual status legend (data-testid="twin-legend")
 * - Camera controls & presets (data-testid="twin-reset-view")
 * - Quality selector (data-testid="twin-quality")
 * - Diagnostics HUD toggle (data-testid="twin-perf-hud")
 */

import React, { useState } from 'react';
import { WarehouseLayoutResponse } from '../../hooks/useWarehouseData.js';
import { MissionDto } from '@dark-storage/shared';
import { TwinCanvas } from './TwinCanvas.js';
import { CameraPreset } from './camera.js';
import { QualitySetting, PerfMetrics } from './perf.js';
import { VISUAL_STATE_COLORS } from '../../lib/binVisual.js';

export interface TwinViewProps {
  layout?: WarehouseLayoutResponse;
  mission?: MissionDto | null;
  locateQuery?: string;
}

export const TwinView: React.FC<TwinViewProps> = ({ layout, mission, locateQuery }) => {
  const [quality, setQuality] = useState<QualitySetting>('auto');
  const [activePreset, setActivePreset] = useState<CameraPreset | null>(null);
  const [resetNonce, setResetNonce] = useState<number>(1);
  const [replayNonce, setReplayNonce] = useState<number>(1);
  const [levelFilter, setLevelFilter] = useState<'ALL' | number>('ALL');
  const [showPerfHud, setShowPerfHud] = useState<boolean>(false);
  const [showLegend, setShowLegend] = useState<boolean>(false);
  const [metrics, setMetrics] = useState<PerfMetrics | null>(null);

  const handlePreset = (preset: CameraPreset) => {
    setActivePreset(preset);
  };

  const handleReset = () => {
    setResetNonce((n) => n + 1);
    setActivePreset(null);
  };

  const handleReplay = () => {
    setReplayNonce((n) => n + 1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
      {/* View Toolbar */}
      <div
        className="card"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 16px',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        {/* Left: Camera presets, Reset & Level Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Camera presets */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Camera
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              data-testid="twin-reset-view"
              onClick={handleReset}
              title="Reset camera to default view"
            >
              Reset View
            </button>
            <div style={{ display: 'inline-flex', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  backgroundColor: activePreset === 'iso' || activePreset === null ? 'var(--accent-primary)' : 'var(--bg-surface)',
                  color: activePreset === 'iso' || activePreset === null ? '#fff' : 'var(--text-secondary)',
                  borderRadius: 0,
                  border: 'none',
                  padding: '4px 9px',
                  fontSize: '11px',
                  fontWeight: 600
                }}
                onClick={() => handlePreset('iso')}
              >
                Iso
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  backgroundColor: activePreset === 'top' ? 'var(--accent-primary)' : 'var(--bg-surface)',
                  color: activePreset === 'top' ? '#fff' : 'var(--text-secondary)',
                  borderRadius: 0,
                  border: 'none',
                  padding: '4px 9px',
                  fontSize: '11px',
                  fontWeight: 600
                }}
                onClick={() => handlePreset('top')}
              >
                Top
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  backgroundColor: activePreset === 'front' ? 'var(--accent-primary)' : 'var(--bg-surface)',
                  color: activePreset === 'front' ? '#fff' : 'var(--text-secondary)',
                  borderRadius: 0,
                  border: 'none',
                  padding: '4px 9px',
                  fontSize: '11px',
                  fontWeight: 600
                }}
                onClick={() => handlePreset('front')}
              >
                Front
              </button>
            </div>
          </div>

          {/* Level Filter Chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} data-testid="twin-level-filter">
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Level:
            </span>
            <div style={{ display: 'inline-flex', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
              {(['ALL', 1, 2, 3, 4] as const).map((lvl) => {
                const isSelected = levelFilter === lvl;
                return (
                  <button
                    key={String(lvl)}
                    type="button"
                    className="btn btn-sm"
                    style={{
                      backgroundColor: isSelected ? 'var(--accent-primary)' : 'var(--bg-surface)',
                      color: isSelected ? '#fff' : 'var(--text-secondary)',
                      borderRadius: 0,
                      border: 'none',
                      padding: '4px 8px',
                      fontSize: '11px',
                      fontWeight: 700
                    }}
                    onClick={() => setLevelFilter(lvl)}
                  >
                    {lvl === 'ALL' ? 'All' : `L${lvl}`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Route Replay Button (When mission is active) */}
          {mission?.route && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              data-testid="twin-replay"
              onClick={handleReplay}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
              title="Replay picker travel along the route"
            >
              ▶ Replay Route
            </button>
          )}
        </div>

        {/* Right: Legend, Quality, Diagnostics */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Legend toggle */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-testid="twin-legend"
            onClick={() => setShowLegend((v) => !v)}
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              backgroundColor: showLegend ? 'var(--accent-primary-container)' : undefined,
              borderColor: showLegend ? 'var(--accent-primary)' : undefined
            }}
          >
            Legend
          </button>

          {/* Quality selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <label htmlFor="twin-quality" style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
              Quality:
            </label>
            <select
              id="twin-quality"
              data-testid="twin-quality"
              className="select"
              style={{ padding: '3px 6px', fontSize: '11px', height: '28px' }}
              value={quality}
              onChange={(e) => setQuality(e.target.value as QualitySetting)}
            >
              <option value="auto">Auto (Adaptive)</option>
              <option value="high">High (Full DPR)</option>
              <option value="low">Low (Power Saver)</option>
            </select>
          </div>

          {/* Perf HUD toggle */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-testid="twin-perf-hud"
            onClick={() => setShowPerfHud((v) => !v)}
            title="Toggle Performance Diagnostics HUD"
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              backgroundColor: showPerfHud ? 'var(--accent-primary-container)' : undefined,
              borderColor: showPerfHud ? 'var(--accent-primary)' : undefined
            }}
          >
            ⚙ Perf HUD
          </button>
        </div>
      </div>

      {/* Main Isometric Canvas Container */}
      <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 280px)', minHeight: '520px' }}>
        <TwinCanvas
          layout={layout}
          mission={mission}
          locateQuery={locateQuery}
          levelFilter={levelFilter}
          quality={quality}
          presetRequest={activePreset}
          resetRequest={resetNonce}
          replayRequest={replayNonce}
          onMetricsUpdate={setMetrics}
        />

        {/* Legend Overlay */}
        {showLegend && (
          <div
            className="card"
            style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
              backgroundColor: 'rgba(15, 23, 42, 0.92)',
              backdropFilter: 'blur(8px)',
              border: '1px solid var(--border-color)',
              padding: '12px',
              borderRadius: 'var(--radius-md)',
              fontSize: '11px',
              color: '#f8fafc',
              zIndex: 15,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              minWidth: '150px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
            }}
          >
            <div style={{ fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px' }}>
              BIN OCCUPANCY
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: VISUAL_STATE_COLORS.empty }} />
              <span>Empty</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: VISUAL_STATE_COLORS.low }} />
              <span>Low (&lt;25%)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: VISUAL_STATE_COLORS.med }} />
              <span>Medium (&lt;75%)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: VISUAL_STATE_COLORS.high }} />
              <span>High (&lt;100%)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: VISUAL_STATE_COLORS.full }} />
              <span>Full (100%)</span>
            </div>
            <div style={{ fontWeight: 700, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '6px', marginTop: '2px' }}>
              SPECIAL STATES
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: '#d97706' }} />
              <span>HAZMAT (Aisle D)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: '#64748b' }} />
              <span>Maintenance</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: VISUAL_STATE_COLORS.recount }} />
              <span>Recount Needed</span>
            </div>
          </div>
        )}

        {/* Performance Metrics Floating HUD */}
        {showPerfHud && metrics && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              backgroundColor: 'rgba(15, 23, 42, 0.90)',
              backdropFilter: 'blur(8px)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: '#f8fafc',
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              minWidth: '160px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px', fontWeight: 700 }}>
              <span>DIAGNOSTICS</span>
              <span style={{ color: metrics.fps >= 50 ? '#4ade80' : metrics.fps >= 30 ? '#fbbf24' : '#f87171' }}>
                {metrics.fps} FPS
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Frame:</span>
              <span>{metrics.frameTimeMs} ms</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Avg (30):</span>
              <span>{metrics.avgFrameTimeMs} ms</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Draws:</span>
              <span>{metrics.drawCalls}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>DPR:</span>
              <span>{metrics.dpr}x</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Tier:</span>
              <span style={{ textTransform: 'uppercase', color: metrics.effectiveQuality === 'high' ? '#38bdf8' : '#fbbf24' }}>
                {metrics.effectiveQuality}
              </span>
            </div>
          </div>
        )}

        {/* Controls Hint Overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            left: '12px',
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(4px)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 12px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            pointerEvents: 'none',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}
        >
          Left-drag: Rotate · Right/Shift-drag: Pan · Wheel: Zoom · Arrows: Rotate · Click: Pin
        </div>
      </div>
    </div>
  );
};

export default TwinView;
