import React, { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { ProductLabel } from '../components/ProductLabel.js';

interface BinLayout {
  code: string;
  level: number;
  capacity: number;
  status: string;
  recount_required: boolean;
  sku: string | null;
  product_name: string | null;
  qty: number;
  reserved_qty: number;
}

interface ShelfLayout {
  code: string;
  bay: number;
  side: string;
  status: string;
  storage_class: string;
  x: number;
  y: number;
  bins: BinLayout[];
}

interface AisleLayout {
  aisle: string;
  shelves: ShelfLayout[];
}

interface WarehouseLayoutResponse {
  aisles: AisleLayout[];
}

export const WarehousePage: React.FC = () => {
  const [locateQuery, setLocateQuery] = useState('');
  const [hoveredBin, setHoveredBin] = useState<BinLayout | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<WarehouseLayoutResponse>({
    queryKey: ['warehouse', 'layout'],
    queryFn: () => apiFetch('/api/warehouse/layout'),
    refetchOnWindowFocus: true
  });

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
    <div className="warehouse-container" ref={containerRef}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2>Warehouse 2D Layout</h2>
        <div className="warehouse-controls">
          <input
            type="text"
            className="input"
            style={{ width: 280 }}
            placeholder="Locate bin, shelf, SKU, or name..."
            value={locateQuery}
            onChange={(e) => setLocateQuery(e.target.value)}
            onKeyDown={handleLocateKeyDown}
            data-testid="warehouse-locate-input"
          />
        </div>
      </div>

      {/* Legend */}
      <div className="warehouse-legend">
        <strong>Legend:</strong>
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
        <div>Loading warehouse layout...</div>
      ) : !data || data.aisles.length === 0 ? (
        <div>No layout data available.</div>
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
                        <span>{shelf.code}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
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

      {/* Floating Tooltip */}
      {hoveredBin && tooltipPos && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(window.innerWidth - 240, tooltipPos.x),
            top: tooltipPos.y,
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            padding: 10,
            fontSize: 12,
            boxShadow: '0 6px 16px rgba(0,0,0,0.4)',
            zIndex: 1001,
            pointerEvents: 'none',
            minWidth: 200
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{hoveredBin.code}</div>
          <div>Status: <span style={{ textTransform: 'uppercase' }}>{hoveredBin.status}</span></div>
          <div>Capacity: {hoveredBin.qty} / {hoveredBin.capacity}</div>
          <div>Reserved: {hoveredBin.reserved_qty}</div>
          {hoveredBin.sku ? (
            <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border-color)' }}>
              <ProductLabel sku={hoveredBin.sku} name={hoveredBin.product_name || hoveredBin.sku} />
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>Empty</div>
          )}
        </div>
      )}
    </div>
  );
};
