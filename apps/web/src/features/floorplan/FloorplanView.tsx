import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { WarehouseLayoutResponse, ShelfLayout, BinLayout } from '../../hooks/useWarehouseData.js';
import { MissionDto } from '@dark-storage/shared';
import { NODES, EDGES, shelfRect } from '../../lib/warehouseGeometry.js';
import { shelfAggregateVisualState, VISUAL_STATE_COLORS } from '../../lib/binVisual.js';
import { flattenRoute, RoutePoint } from '../../lib/routeGeometry.js';
import { ProductLabel } from '../../components/ProductLabel.js';

export interface FloorplanViewProps {
  layout?: WarehouseLayoutResponse;
  mission?: MissionDto | null;
  locateQuery?: string;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT_VIEWBOX: ViewBox = {
  x: -6,
  y: -6,
  w: 92,
  h: 62
};

export const FloorplanView: React.FC<FloorplanViewProps> = ({
  layout,
  mission,
  locateQuery = ''
}) => {
  // Navigation & Viewport State
  const [viewBox, setViewBox] = useState<ViewBox>(DEFAULT_VIEWBOX);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; vb: ViewBox } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Layer Toggles
  const [showGraphEdges, setShowGraphEdges] = useState(true);
  const [showNodeIds, setShowNodeIds] = useState(false);

  // Tooltip & Selection
  const [hoveredShelf, setHoveredShelf] = useState<ShelfLayout | null>(null);
  const [pinnedShelf, setPinnedShelf] = useState<ShelfLayout | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Picker Marker Animation (runs once when route changes, 30fps capped)
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null);
  const [animKey, setAnimKey] = useState(0);

  // 1. Flatten all 48 shelves across 4 aisles into a lookup list
  const allShelves = useMemo(() => {
    if (!layout || !layout.aisles) return [];
    const list: Array<ShelfLayout & { aisle: string }> = [];
    for (const a of layout.aisles) {
      for (const s of a.shelves) {
        list.push({ ...s, aisle: a.aisle });
      }
    }
    return list;
  }, [layout]);

  // 2. Compute Flattened Route and Completed/Remaining Subsets
  const flattened = useMemo(() => {
    return flattenRoute(mission?.route);
  }, [mission?.route]);

  const { completedPoints, remainingPoints, lastFinishedNode, nextPendingStop } = useMemo(() => {
    if (!mission || !mission.stops || flattened.points.length === 0) {
      return {
        completedPoints: [] as RoutePoint[],
        remainingPoints: flattened.points,
        lastFinishedNode: null,
        nextPendingStop: null
      };
    }

    const stops = mission.stops;
    const pending = stops.filter((s) => s.status === 'PENDING').sort((a, b) => a.seq - b.seq);
    const finished = stops.filter((s) => s.status !== 'PENDING').sort((a, b) => a.seq - b.seq);

    const nextPending = pending[0] || null;

    if (finished.length === 0) {
      return {
        completedPoints: [] as RoutePoint[],
        remainingPoints: flattened.points,
        lastFinishedNode: null,
        nextPendingStop: nextPending
      };
    }

    // Last finished stop node
    const lastStop = finished[finished.length - 1];
    const shelfParts = lastStop.shelf_code.split('-');
    const lastNodeId = `N-${shelfParts[0]}-${shelfParts[1]}`;

    // Find split index in flattened points
    let splitIdx = flattened.points.findIndex((p) => p.id === lastNodeId);
    if (splitIdx === -1) {
      splitIdx = 0;
    }

    const completed = flattened.points.slice(0, splitIdx + 1);
    const remaining = flattened.points.slice(splitIdx);

    return {
      completedPoints: completed,
      remainingPoints: remaining,
      lastFinishedNode: lastNodeId,
      nextPendingStop: nextPending
    };
  }, [mission, flattened]);

  // 3. Coordinate conversion: world (wx, wy) -> SVG (sx, sy) where y is flipped
  const toSvgX = useCallback((wx: number) => wx, []);
  const toSvgY = useCallback((wy: number) => 50 - wy, []);

  // 4. Convert point arrays into SVG points string
  const toPointsString = useCallback(
    (pts: RoutePoint[]) => {
      return pts.map((p) => `${toSvgX(p.x)},${toSvgY(p.y)}`).join(' ');
    },
    [toSvgX, toSvgY]
  );

  // 5. Picker Marker single-shot traversal along remaining path (capped at 30fps)
  useEffect(() => {
    if (flattened.points.length < 2) {
      setPickerPos(null);
      return;
    }

    let active = true;
    let animId: number;
    let lastTime = 0;
    const fpsInterval = 1000 / 30; // 30 fps cap
    let currentSegment = 0;
    let segT = 0; // 0..1 along current segment

    const points = remainingPoints.length >= 2 ? remainingPoints : flattened.points;
    setPickerPos({ x: points[0].x, y: points[0].y });

    function tick(now: number) {
      if (!active) return;
      animId = requestAnimationFrame(tick);

      const elapsed = now - lastTime;
      if (elapsed < fpsInterval) return;
      lastTime = now - (elapsed % fpsInterval);

      if (currentSegment >= points.length - 1) {
        // Traversal finished
        const endPt = points[points.length - 1];
        setPickerPos({ x: endPt.x, y: endPt.y });
        cancelAnimationFrame(animId);
        return;
      }

      const p0 = points[currentSegment];
      const p1 = points[currentSegment + 1];

      // Segment step
      segT += 0.08;
      if (segT >= 1) {
        segT = 0;
        currentSegment++;
      }

      const curX = p0.x + (p1.x - p0.x) * segT;
      const curY = p0.y + (p1.y - p0.y) * segT;
      setPickerPos({ x: curX, y: curY });
    }

    animId = requestAnimationFrame(tick);

    return () => {
      active = false;
      cancelAnimationFrame(animId);
    };
  }, [remainingPoints, flattened, animKey]);

  // 6. Viewport Pan & Zoom Handling
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return; // Primary button only
    setIsDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      vb: { ...viewBox }
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDragging || !dragStartRef.current || !svgRef.current) return;
    const svgRect = svgRef.current.getBoundingClientRect();
    if (svgRect.width === 0 || svgRect.height === 0) return;

    const dx = ((e.clientX - dragStartRef.current.clientX) * dragStartRef.current.vb.w) / svgRect.width;
    const dy = ((e.clientY - dragStartRef.current.clientY) * dragStartRef.current.vb.h) / svgRect.height;

    setViewBox({
      x: dragStartRef.current.vb.x - dx,
      y: dragStartRef.current.vb.y - dy,
      w: dragStartRef.current.vb.w,
      h: dragStartRef.current.vb.h
    });
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    setIsDragging(false);
    dragStartRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (!svgRef.current) return;
    const svgRect = svgRef.current.getBoundingClientRect();
    if (svgRect.width === 0 || svgRect.height === 0) return;

    const zoomFactor = e.deltaY > 0 ? 1.12 : 0.88;

    // Center zoom around cursor
    const cursorSvgX = viewBox.x + ((e.clientX - svgRect.left) / svgRect.width) * viewBox.w;
    const cursorSvgY = viewBox.y + ((e.clientY - svgRect.top) / svgRect.height) * viewBox.h;

    const newW = Math.max(18, Math.min(180, viewBox.w * zoomFactor));
    const newH = Math.max(12, Math.min(120, viewBox.h * zoomFactor));

    const newX = cursorSvgX - ((e.clientX - svgRect.left) / svgRect.width) * newW;
    const newY = cursorSvgY - ((e.clientY - svgRect.top) / svgRect.height) * newH;

    setViewBox({ x: newX, y: newY, w: newW, h: newH });
  };

  const handleDoubleClick = () => {
    setViewBox(DEFAULT_VIEWBOX);
  };

  // 7. Check if shelf matches locate query
  const isShelfMatched = useCallback(
    (shelf: ShelfLayout) => {
      if (!locateQuery.trim()) return false;
      const q = locateQuery.trim().toUpperCase();
      if (shelf.code.toUpperCase().includes(q)) return true;
      return shelf.bins.some(
        (b) =>
          b.code.toUpperCase().includes(q) ||
          (b.sku && b.sku.toUpperCase().includes(q)) ||
          (b.product_name && b.product_name.toUpperCase().includes(q))
      );
    },
    [locateQuery]
  );

  const activeTooltipShelf = pinnedShelf || hoveredShelf;

  return (
    <div style={{ position: 'relative', width: '100%', userSelect: 'none' }}>
      <style>{`
        @keyframes marchingDash {
          to { stroke-dashoffset: -14; }
        }
        @keyframes pulseNextPin {
          0% { transform: scale(1); opacity: 0.9; }
          50% { transform: scale(1.22); opacity: 1; }
          100% { transform: scale(1); opacity: 0.9; }
        }
        @keyframes pulseHighlight {
          0% { stroke-opacity: 0.6; }
          50% { stroke-opacity: 1; stroke-width: 0.8; }
          100% { stroke-opacity: 0.6; }
        }
        @media (prefers-reduced-motion: reduce) {
          .route-dash-animated { animation: none !important; }
          .pin-pulse { animation: none !important; }
        }
      `}</style>

      {/* Top Controls Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          marginBottom: '10px',
          padding: '8px 12px',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-color)',
          fontSize: '13px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showGraphEdges}
              onChange={(e) => setShowGraphEdges(e.target.checked)}
            />
            <span>Nav Graph</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showNodeIds}
              onChange={(e) => setShowNodeIds(e.target.checked)}
            />
            <span>Node IDs</span>
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleDoubleClick}
            style={{ padding: '4px 10px', fontSize: '12px' }}
          >
            Reset Zoom
          </button>
          {flattened.points.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setAnimKey((k) => k + 1)}
              style={{ padding: '4px 10px', fontSize: '12px' }}
            >
              Replay Route ↻
            </button>
          )}
        </div>

        {/* Route Summary Chip */}
        {mission && mission.route && (
          <div
            className="badge badge-info"
            style={{ padding: '6px 12px', fontSize: '12.5px', display: 'flex', gap: '10px' }}
            data-testid="route-summary"
          >
            <span><strong>Mission:</strong> {mission.ref}</span>
            <span><strong>Alg:</strong> {mission.route.algorithm}</span>
            <span><strong>Distance:</strong> {mission.route.total_distance}m</span>
            <span>
              <strong>Stops:</strong> {mission.progress.finished_stops} / {mission.progress.total_stops}
            </span>
          </div>
        )}
      </div>

      {/* Main SVG Floorplan Canvas */}
      <div
        style={{
          width: '100%',
          height: '620px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          position: 'relative',
          cursor: isDragging ? 'grabbing' : 'grab'
        }}
      >
        <svg
          ref={svgRef}
          data-testid="floorplan-svg"
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: '100%', height: '100%', display: 'block' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
        >
          {/* LAYER 1: Floor Boundary & Metric Grid */}
          <g id="layer-floor-grid">
            {/* Warehouse Floor Slab */}
            <rect
              x="-2"
              y="-2"
              width="84"
              height="54"
              fill="var(--bg-primary)"
              stroke="var(--border-strong)"
              strokeWidth="0.3"
              rx="1.2"
            />

            {/* Aisle Drive Strips */}
            {[10, 30, 50, 70].map((ax) => (
              <rect
                key={`drive-${ax}`}
                x={ax - 1.2}
                y="0"
                width="2.4"
                height="50"
                fill="rgba(255, 255, 255, 0.015)"
              />
            ))}

            {/* Cross-Aisle Strips */}
            <rect x="0" y={toSvgY(0) - 1.2} width="80" height="2.4" fill="rgba(255, 255, 255, 0.015)" />
            <rect x="10" y={toSvgY(50) - 1.2} width="60" height="2.4" fill="rgba(255, 255, 255, 0.015)" />

            {/* Metric Distance Grid Lines */}
            {[0, 10, 20, 30, 40, 50, 60, 70, 80].map((gx) => (
              <line
                key={`grid-x-${gx}`}
                x1={gx}
                y1="-2"
                x2={gx}
                y2="52"
                stroke="var(--border-color)"
                strokeWidth="0.08"
                strokeDasharray="1 2"
              />
            ))}
            {[0, 10, 20, 30, 40, 50].map((gy) => (
              <line
                key={`grid-y-${gy}`}
                x1="-2"
                y1={toSvgY(gy)}
                x2="82"
                y2={toSvgY(gy)}
                stroke="var(--border-color)"
                strokeWidth="0.08"
                strokeDasharray="1 2"
              />
            ))}
          </g>

          {/* LAYER 2: Nav-Graph Edges (Thin, Toggleable) */}
          {showGraphEdges && (
            <g id="layer-nav-edges">
              {EDGES.map((edge) => {
                const u = NODES.find((n) => n.id === edge.from);
                const v = NODES.find((n) => n.id === edge.to);
                if (!u || !v) return null;
                return (
                  <line
                    key={`edge-${edge.from}-${edge.to}`}
                    x1={toSvgX(u.x)}
                    y1={toSvgY(u.y)}
                    x2={toSvgX(v.x)}
                    y2={toSvgY(v.y)}
                    stroke="rgba(148, 163, 184, 0.28)"
                    strokeWidth="0.22"
                  />
                );
              })}
            </g>
          )}

          {/* LAYER 3: DOCK and PACK Workstation Pads */}
          <g id="layer-workstations">
            {/* DOCK Pad (0, 0) -> SVG (0, 50) */}
            <rect
              x="-4"
              y={toSvgY(0) - 2.5}
              width="6.5"
              height="5"
              fill="#06b6d4"
              fillOpacity="0.18"
              stroke="#06b6d4"
              strokeWidth="0.35"
              rx="0.8"
            />
            <text
              x="-0.75"
              y={toSvgY(0) + 0.5}
              fill="#06b6d4"
              fontSize="1.3"
              fontWeight="800"
              textAnchor="middle"
              fontFamily="var(--font-mono)"
            >
              DOCK
            </text>

            {/* PACK Pad (80, 0) -> SVG (80, 50) */}
            <rect
              x="77.5"
              y={toSvgY(0) - 2.5}
              width="6.5"
              height="5"
              fill="#10b981"
              fillOpacity="0.18"
              stroke="#10b981"
              strokeWidth="0.35"
              rx="0.8"
            />
            <text
              x="80.75"
              y={toSvgY(0) + 0.5}
              fill="#10b981"
              fontSize="1.3"
              fontWeight="800"
              textAnchor="middle"
              fontFamily="var(--font-mono)"
            >
              PACK
            </text>
          </g>

          {/* LAYER 4: 48 Shelf Racks Colored by Aggregate Bin Visual State */}
          <g id="layer-shelves">
            {allShelves.map((shelf) => {
              const rect = shelfRect({
                code: shelf.code,
                aisle: shelf.aisle,
                bay: shelf.bay,
                side: shelf.side,
                x: shelf.x,
                y: shelf.y
              });

              // Convert world bounding box to SVG coordinates:
              const sx = toSvgX(rect.x);
              const sy = toSvgY(rect.y + rect.height); // top of SVG box is 50 - y1

              const visualState = shelfAggregateVisualState(shelf);
              const fillColor = VISUAL_STATE_COLORS[visualState];
              const isMatched = isShelfMatched(shelf);
              const isHazmat = shelf.storage_class === 'HAZMAT';
              const isSelected = activeTooltipShelf?.code === shelf.code;

              return (
                <g
                  key={shelf.code}
                  data-testid={`floorplan-shelf-${shelf.code}`}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    const b = e.currentTarget.getBoundingClientRect();
                    setHoveredShelf(shelf);
                    setTooltipPos({ x: b.left + b.width / 2, y: b.top - 8 });
                  }}
                  onMouseLeave={() => setHoveredShelf(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPinnedShelf((p) => (p?.code === shelf.code ? null : shelf));
                  }}
                >
                  <rect
                    x={sx}
                    y={sy}
                    width={rect.width}
                    height={rect.height}
                    fill={fillColor}
                    stroke={
                      isSelected
                        ? 'var(--accent-primary)'
                        : isMatched
                        ? '#f59e0b'
                        : isHazmat
                        ? '#ef4444'
                        : 'rgba(255, 255, 255, 0.15)'
                    }
                    strokeWidth={isSelected ? 0.45 : isMatched ? 0.45 : isHazmat ? 0.35 : 0.15}
                    rx="0.3"
                    className={isMatched ? 'shelf-matched-pulse' : ''}
                  />

                  {/* Shelf Label Text */}
                  <text
                    x={sx + rect.width / 2}
                    y={sy + rect.height / 2 + 0.4}
                    fill="var(--text-primary)"
                    fontSize="0.9"
                    fontWeight="700"
                    textAnchor="middle"
                    fontFamily="var(--font-mono)"
                    pointerEvents="none"
                  >
                    {shelf.bay}{shelf.side}
                  </text>
                </g>
              );
            })}
          </g>

          {/* LAYER 5: Aisle Markers & Node Dots */}
          <g id="layer-aisle-labels">
            {['A', 'B', 'C', 'D'].map((a) => {
              const ax = [10, 30, 50, 70][['A', 'B', 'C', 'D'].indexOf(a)];
              return (
                <g key={`label-aisle-${a}`}>
                  <text
                    x={ax}
                    y={toSvgY(50) - 2.2}
                    fill="var(--text-secondary)"
                    fontSize="1.6"
                    fontWeight="800"
                    textAnchor="middle"
                    fontFamily="var(--font-mono)"
                  >
                    AISLE {a}
                  </text>
                </g>
              );
            })}

            {/* Nav Nodes Dots & Labels */}
            {NODES.map((n) => {
              const nx = toSvgX(n.x);
              const ny = toSvgY(n.y);
              return (
                <g key={`node-${n.id}`}>
                  <circle cx={nx} cy={ny} r="0.4" fill="rgba(148, 163, 184, 0.45)" />
                  {showNodeIds && (
                    <text
                      x={nx}
                      y={ny - 0.7}
                      fill="var(--text-muted)"
                      fontSize="0.8"
                      textAnchor="middle"
                      fontFamily="var(--font-mono)"
                    >
                      {n.id}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* LAYER 6: Route Polyline (Live Animated Mission Overlay) */}
          {flattened.points.length >= 2 && (
            <g id="layer-route" data-testid="route-polyline">
              {/* Completed Route Portion (Muted Gray) */}
              {completedPoints.length >= 2 && (
                <polyline
                  points={toPointsString(completedPoints)}
                  fill="none"
                  stroke="rgba(148, 163, 184, 0.4)"
                  strokeWidth="0.45"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Remaining Active Route Portion (Two-Pass Glow + Marching Dash) */}
              {remainingPoints.length >= 2 && (
                <>
                  {/* Outer Glow Stroke (Wide Translucent) */}
                  <polyline
                    points={toPointsString(remainingPoints)}
                    fill="none"
                    stroke="rgba(99, 102, 241, 0.32)"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Inner Crisp Stroke with CSS Dashoffset Marching Animation */}
                  <polyline
                    points={toPointsString(remainingPoints)}
                    fill="none"
                    stroke="var(--accent-primary, #6366f1)"
                    strokeWidth="0.48"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="1.2 0.8"
                    className="route-dash-animated"
                    style={{ animation: 'marchingDash 1.2s linear infinite' }}
                  />
                </>
              )}
            </g>
          )}

          {/* LAYER 7: Numbered Stop Pins (Offset toward Shelf Side) */}
          {mission && mission.stops && (
            <g id="layer-stop-pins">
              {mission.stops.map((stop) => {
                // Find node coordinates
                const parts = stop.shelf_code.split('-');
                const aisle = parts[0];
                const bay = parts[1];
                const side = parts[2] || (stop.shelf_code.endsWith('-L') ? 'L' : 'R');
                const nodeId = `N-${aisle}-${bay}`;
                const node = NODES.find((n) => n.id === nodeId);
                if (!node) return null;

                // Offset toward shelf side (-x for L, +x for R)
                const offsetX = side === 'L' ? -1.8 : 1.8;
                const px = toSvgX(node.x + offsetX);
                const py = toSvgY(node.y);

                const isNext = nextPendingStop?.id === stop.id;
                const isFinished = stop.status === 'PICKED' || stop.status === 'RESOLVED';
                const isException = stop.status === 'EXCEPTION_OPEN';

                const pinColor = isFinished
                  ? '#10b981'
                  : isException
                  ? '#ef4444'
                  : '#f59e0b';

                return (
                  <g
                    key={`stop-pin-${stop.seq}`}
                    data-testid={`route-stop-pin-${stop.seq}`}
                    className={isNext ? 'pin-pulse' : ''}
                    style={
                      isNext
                        ? {
                            transformOrigin: `${px}px ${py}px`,
                            animation: 'pulseNextPin 1.4s ease-in-out infinite'
                          }
                        : {}
                    }
                  >
                    {/* Pin Outer Ring */}
                    <circle cx={px} cy={py} r="1.15" fill={pinColor} fillOpacity="0.25" />
                    {/* Pin Solid Center */}
                    <circle
                      cx={px}
                      cy={py}
                      r="0.8"
                      fill={pinColor}
                      stroke="#ffffff"
                      strokeWidth="0.18"
                    />
                    {/* Stop Sequence Number */}
                    <text
                      x={px}
                      y={py + 0.3}
                      fill="#ffffff"
                      fontSize="0.75"
                      fontWeight="900"
                      textAnchor="middle"
                      fontFamily="var(--font-mono)"
                    >
                      {stop.seq}
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {/* LAYER 8: Moving Picker Vehicle / Marker */}
          {pickerPos && (
            <g id="layer-picker-marker">
              <circle
                cx={toSvgX(pickerPos.x)}
                cy={toSvgY(pickerPos.y)}
                r="1.0"
                fill="var(--accent-primary, #6366f1)"
                stroke="#ffffff"
                strokeWidth="0.22"
              />
              <circle
                cx={toSvgX(pickerPos.x)}
                cy={toSvgY(pickerPos.y)}
                r="1.6"
                fill="none"
                stroke="var(--accent-primary, #6366f1)"
                strokeWidth="0.18"
                strokeOpacity="0.45"
              />
            </g>
          )}
        </svg>
      </div>

      {/* Floating Detailed Shelf & Bins Tooltip Card */}
      {activeTooltipShelf && (
        <div
          className="card"
          style={{
            position: 'absolute',
            left: '20px',
            bottom: '20px',
            maxWidth: '340px',
            padding: '14px 18px',
            zIndex: 100,
            boxShadow: 'var(--shadow-lg)',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-strong)',
            pointerEvents: pinnedShelf ? 'auto' : 'none'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '15px' }}>
              Shelf {activeTooltipShelf.code}
            </h4>
            <div style={{ display: 'flex', gap: '6px' }}>
              <span className={`badge ${activeTooltipShelf.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>
                {activeTooltipShelf.status}
              </span>
              <span className="badge badge-info">{activeTooltipShelf.storage_class}</span>
            </div>
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            Aisle {activeTooltipShelf.code.split('-')[0]} | Bay {activeTooltipShelf.bay} | Side {activeTooltipShelf.side}
          </div>

          {/* Bins List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
            {activeTooltipShelf.bins
              .slice()
              .sort((a, b) => a.level - b.level)
              .map((b) => (
                <div
                  key={b.code}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-secondary)',
                    fontSize: '11.5px'
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>L{b.level}: {b.code}</span>
                  <span>
                    {b.sku ? (
                      <ProductLabel sku={b.sku} name={b.product_name || b.sku} />
                    ) : (
                      <em style={{ color: 'var(--text-muted)' }}>Empty</em>
                    )}
                  </span>
                  <span style={{ fontWeight: 700 }}>
                    {b.qty}/{b.capacity}
                  </span>
                </div>
              ))}
          </div>

          {pinnedShelf && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setPinnedShelf(null)}
              style={{ marginTop: '12px', width: '100%', fontSize: '11px', padding: '4px 8px' }}
            >
              Close Pin
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default FloorplanView;
