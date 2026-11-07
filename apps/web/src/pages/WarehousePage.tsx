import React, { useState, useRef, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWarehouseLayout, useMissionRoute, BinLayout } from '../hooks/useWarehouseData.js';
import { ProductLabel } from '../components/ProductLabel.js';
import { MissionRouteSelector } from '../components/MissionRouteSelector.js';
import { ViewErrorBoundary } from '../components/ViewErrorBoundary.js';

const FloorplanView = React.lazy(() => import('../features/floorplan/FloorplanView.js'));
const TwinView = React.lazy(() => import('../features/twin/TwinView.js'));

export const WarehousePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawView = searchParams.get('view');
  const viewMode: 'cards' | 'map' | '3d' = rawView === 'map' || rawView === '3d' ? rawView : 'cards';
  const selectedMission = searchParams.get('mission') || '';

  const [locateQuery, setLocateQuery] = useState('');
  const [hoveredBin, setHoveredBin] = useState<BinLayout | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useWarehouseLayout();
  const { data: missionRoute } = useMissionRoute(selectedMission);

  const setViewMode = (mode: 'cards' | 'map' | '3d') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (mode === 'cards') {
        next.delete('view');
      } else {
        next.set('view', mode);
      }
      return next;
    });
  };

  const setSelectedMission = (ref: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!ref) {
        next.delete('mission');
      } else {
        next.set('mission', ref);
      }
      return next;
    });
  };

  const getFillClass = (qty: number, cap: number) => {
    if (qty === 0) return 'fill-empty';
    const pct = (qty / cap) * 100;
    if (pct < 25) return 'fill-low';
    if (pct < 75) return 'fill-med';
    if (pct < 100) return 'fill-high';
    return 'fill-full';
  };

  const getBinStatusClass = (bin: BinLayout, shelfStatus: string) => {
    if (bin.status === 'BLOCKED') return 'status-blocked';
    if (bin.status === 'DAMAGED') return 'status-damaged';
    if (shelfStatus === 'MAINTENANCE') return 'status-maintenance';
    if (bin.recount_required) return 'status-recount';
    return getFillClass(bin.qty, bin.capacity);
  };

  const isMatching = (bin: BinLayout, shelfCode: string) => {
    if (!locateQuery.trim()) return false;
    const q = locateQuery.trim().toUpperCase();
    return (
      bin.code.toUpperCase().includes(q) ||
      shelfCode.toUpperCase().includes(q) ||
      (bin.sku && bin.sku.toUpperCase().includes(q)) ||
      (bin.product_name && bin.product_name.toUpperCase().includes(q))
    );
  };

  const handleLocateKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const firstMatch = document.querySelector('.bin-cell.highlight');
      if (firstMatch) {
        firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    }
  };

  const handleMouseEnter = (bin: BinLayout, e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredBin(bin);
    setTooltipPos({ x: rect.left + window.scrollX, y: rect.bottom + window.scrollY + 6 });
  };

  const handleMouseLeave = () => {
    setHoveredBin(null);
    setTooltipPos(null);
  };

  return (
    <div className="warehouse-container m3-page" ref={containerRef}>
      <div className="m3-page-header" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ marginBottom: '4px' }}>Warehouse Topology & Digital Twin</h1>
          <p className="m3-subtitle" style={{ margin: 0 }}>Interactive visual topology, occupancy levels, and real-time routes</p>
        </div>

        {/* View Switcher Tabs */}
        <div className="tabs" data-testid="view-switch" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'cards'}
            className={`tab-btn ${viewMode === 'cards' ? 'active' : ''}`}
            onClick={() => setViewMode('cards')}
            data-testid="view-tab-cards"
          >
            Cards
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'map'}
            className={`tab-btn ${viewMode === 'map' ? 'active' : ''}`}
            onClick={() => setViewMode('map')}
            data-testid="view-tab-map"
          >
            Floorplan
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === '3d'}
            className={`tab-btn ${viewMode === '3d' ? 'active' : ''}`}
            onClick={() => setViewMode('3d')}
            data-testid="view-tab-3d"
          >
            3D Twin
          </button>
        </div>
      </div>

      {/* Control Bar: Search + Mission Route Selector */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          flexWrap: 'wrap',
          marginBottom: '1.25rem',
          backgroundColor: 'var(--bg-secondary)',
          padding: '12px 16px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)'
        }}
      >
        <div style={{ flex: '1 1 300px', maxWidth: '400px' }}>
          <input
            type="text"
            className="input-field"
            style={{ width: '100%' }}
            placeholder="Locate bin, shelf, SKU, or name..."
            value={locateQuery}
            onChange={(e) => setLocateQuery(e.target.value)}
            onKeyDown={handleLocateKeyDown}
            data-testid="warehouse-locate-input"
          />
        </div>

        <MissionRouteSelector
          selectedMission={selectedMission}
          onSelectMission={setSelectedMission}
        />
      </div>

      {/* Mode 1: Cards View */}
      {viewMode === 'cards' && (
        <>
          {/* Legend */}
          <div className="warehouse-legend">
            <strong style={{ color: 'var(--text-primary)' }}>Legend:</strong>
            <div className="legend-item"><div className="legend-box fill-empty" /> Empty (0%)</div>
            <div className="legend-item"><div className="legend-box fill-low" /> Low (&lt;25%)</div>
            <div className="legend-item"><div className="legend-box fill-med" /> Medium (&lt;75%)</div>
            <div className="legend-item"><div className="legend-box fill-high" /> High (&lt;100%)</div>
            <div className="legend-item"><div className="legend-box fill-full" /> Full (100%)</div>
            <div className="legend-item"><div className="legend-box status-blocked" /> Blocked</div>
            <div className="legend-item"><div className="legend-box status-damaged" /> Damaged</div>
            <div className="legend-item"><div className="legend-box status-maintenance" /> Shelf Maint.</div>
            <div className="legend-item"><div className="legend-box status-recount" /> Recount Req.</div>
          </div>

          {isLoading ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading warehouse layout...
            </div>
          ) : !data || data.aisles.length === 0 ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No layout data available.
            </div>
          ) : (
            <div className="warehouse-grid">
              {data.aisles.map((aisle) => (
                <div key={aisle.aisle} className="aisle-col">
                  <div className="aisle-title">Aisle {aisle.aisle}</div>
                  <div className="shelves-list">
                    {aisle.shelves.map((shelf) => {
                      const isMaintenance = shelf.status === 'MAINTENANCE';
                      return (
                        <div
                          key={shelf.code}
                          className={`shelf-card ${isMaintenance ? 'shelf-maintenance' : ''}`}
                          data-testid={`shelf-card-${shelf.code}`}
                        >
                          <div className="shelf-header">
                            <span style={{ fontFamily: 'var(--font-mono)' }}>{shelf.code}</span>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>
                              {shelf.storage_class === 'HAZMAT' ? 'HAZ' : 'STD'}
                            </span>
                          </div>
                          <div className="bin-cells">
                            {shelf.bins
                              .slice()
                              .sort((a, b) => a.level - b.level)
                              .map((bin) => {
                                const statusCls = getBinStatusClass(bin, shelf.status);
                                const matched = isMatching(bin, shelf.code);
                                return (
                                  <div
                                    key={bin.code}
                                    className={`bin-cell ${statusCls} ${matched ? 'highlight' : ''}`}
                                    onMouseEnter={(e) => handleMouseEnter(bin, e)}
                                    onMouseLeave={handleMouseLeave}
                                    onClick={(e) => handleMouseEnter(bin, e)}
                                    data-testid={`bin-cell-${bin.code}`}
                                  >
                                    <span>L{bin.level}</span>
                                    <span>{bin.qty > 0 ? bin.qty : ''}</span>
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Mode 2: 2D Floorplan View */}
      {viewMode === 'map' && (
        <Suspense
          fallback={
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading view…
            </div>
          }
        >
          <ViewErrorBoundary onReset={() => setViewMode('cards')}>
            <FloorplanView layout={data} mission={missionRoute} locateQuery={locateQuery} />
          </ViewErrorBoundary>
        </Suspense>
      )}

      {/* Mode 3: 3D Twin View */}
      {viewMode === '3d' && (
        <Suspense
          fallback={
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading view…
            </div>
          }
        >
          <ViewErrorBoundary onReset={() => setViewMode('cards')}>
            <TwinView layout={data} mission={missionRoute} locateQuery={locateQuery} />
          </ViewErrorBoundary>
        </Suspense>
      )}

      {/* Floating Tooltip */}
      {hoveredBin && tooltipPos && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(window.innerWidth - 260, tooltipPos.x),
            top: tooltipPos.y,
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            fontSize: '12px',
            boxShadow: 'var(--shadow-md)',
            zIndex: 1001,
            pointerEvents: 'none',
            minWidth: '220px'
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: '6px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{hoveredBin.code}</div>
          <div style={{ color: 'var(--text-secondary)' }}>Status: <span style={{ textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-primary)' }}>{hoveredBin.status}</span></div>
          <div style={{ color: 'var(--text-secondary)' }}>Capacity: <strong style={{ color: 'var(--text-primary)' }}>{hoveredBin.qty}</strong> / {hoveredBin.capacity}</div>
          <div style={{ color: 'var(--text-secondary)' }}>Reserved: <strong style={{ color: 'var(--text-primary)' }}>{hoveredBin.reserved_qty}</strong></div>
          {hoveredBin.sku ? (
            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
              <ProductLabel sku={hoveredBin.sku} name={hoveredBin.product_name || hoveredBin.sku} />
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', marginTop: '6px' }}>Empty</div>
          )}
        </div>
      )}
    </div>
  );
};
