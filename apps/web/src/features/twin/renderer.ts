/**
 * Canvas 2D Isometric Renderer for Warehouse Digital Twin.
 * Complete Mode 3b Feature Set:
 * - Offscreen static background cache (floor, grid, DOCK/PACK pads, aisle labels).
 * - Depth-sorted box rendering (Painter's Algorithm, sorted on yaw change).
 * - Level filtering with ghosting (15% alpha, flat fill).
 * - Target bin extrusion (+0.2m z1) and glow highlight for next pending stop.
 * - Flashing highlight for live updated bins.
 * - Search query (Locate) highlight.
 * - Hover / Pinned selection highlight.
 * - 3D Route polyline with two-pass glow and completed vs remaining segments.
 * - Numbered beacon stop pins at wz = 4.6m that stay screen-upright with pulsing target.
 * - Moving picker marker along the 3D route.
 */

import { ProjectionContext } from './projection.js';
import { TwinScene } from './scene.js';
import { EDGES, nodeXY } from '../../lib/warehouseGeometry.js';
import { binVisualState, VISUAL_STATE_COLORS } from '../../lib/binVisual.js';
import { FlattenedRoute } from '../../lib/routeGeometry.js';
import { PickStopDto } from '@dark-storage/shared';

export interface ShadedFaceColors {
  top: string;
  front: string;
  side: string;
  stroke: string;
}

// Convert hex or rgba color to shaded faces
function createShadedFaceColors(colorStr: string): ShadedFaceColors {
  let r = 71;
  let g = 85;
  let b = 105;
  let a = 1.0;

  if (colorStr.startsWith('#')) {
    r = parseInt(colorStr.slice(1, 3), 16) || 0;
    g = parseInt(colorStr.slice(3, 5), 16) || 0;
    b = parseInt(colorStr.slice(5, 7), 16) || 0;
  } else if (colorStr.startsWith('rgb')) {
    const nums = colorStr.match(/[\d.]+/g);
    if (nums && nums.length >= 3) {
      r = Math.round(parseFloat(nums[0]));
      g = Math.round(parseFloat(nums[1]));
      b = Math.round(parseFloat(nums[2]));
      if (nums.length >= 4) {
        a = parseFloat(nums[3]);
      }
    }
  }

  // Front face: 85% brightness
  const rf = Math.round(r * 0.85);
  const gf = Math.round(g * 0.85);
  const bf = Math.round(b * 0.85);

  // Side face: 70% brightness
  const rs = Math.round(r * 0.70);
  const gs = Math.round(g * 0.70);
  const bs = Math.round(b * 0.70);

  const front = a < 1.0 ? `rgba(${rf}, ${gf}, ${bf}, ${a})` : `rgb(${rf}, ${gf}, ${bf})`;
  const side = a < 1.0 ? `rgba(${rs}, ${gs}, ${bs}, ${a})` : `rgb(${rs}, ${gs}, ${bs})`;

  return {
    top: colorStr,
    front,
    side,
    stroke: 'rgba(15, 23, 42, 0.45)'
  };
}

// Precomputed palettes for all visual states
export const SHADED_PALETTES: Record<string, ShadedFaceColors> = {
  default: createShadedFaceColors('#475569'),
  hazmat: createShadedFaceColors('#d97706'),
  maintenance: createShadedFaceColors('#64748b'),
  empty: createShadedFaceColors(VISUAL_STATE_COLORS.empty),
  low: createShadedFaceColors(VISUAL_STATE_COLORS.low),
  med: createShadedFaceColors(VISUAL_STATE_COLORS.med),
  high: createShadedFaceColors(VISUAL_STATE_COLORS.high),
  full: createShadedFaceColors(VISUAL_STATE_COLORS.full),
  blocked: createShadedFaceColors(VISUAL_STATE_COLORS.blocked),
  damaged: createShadedFaceColors(VISUAL_STATE_COLORS.damaged),
  recount: createShadedFaceColors(VISUAL_STATE_COLORS.recount)
};

export interface RenderOptions {
  ctx: CanvasRenderingContext2D;
  scene: TwinScene;
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
  width: number;
  height: number;
  dpr: number;
  quality: 'high' | 'low';
  levelFilter?: 'ALL' | number;
  targetBinCode?: string | null;
  hoveredBinIndex?: number | null;
  pinnedBinIndex?: number | null;
  flashingBins?: Map<string, number>;
  locateQuery?: string;
  missionRoute?: FlattenedRoute | null;
  missionStops?: PickStopDto[] | null;
  pickerProgress?: number; // 0..1
}

export class TwinRenderer {
  public projection = new ProjectionContext();
  private bgCanvas: HTMLCanvasElement | null = null;
  private bgCtx: CanvasRenderingContext2D | null = null;
  private lastBgKey = '';

  constructor() {
    if (typeof document !== 'undefined') {
      this.bgCanvas = document.createElement('canvas');
      this.bgCtx = this.bgCanvas.getContext('2d');
    }
  }

  /**
   * Renders static background (floor, grid, pads, aisle labels) onto offscreen cache.
   */
  public renderBackgroundCache(width: number, height: number, dpr: number): void {
    if (!this.bgCanvas || !this.bgCtx) return;

    if (this.bgCanvas.width !== width || this.bgCanvas.height !== height) {
      this.bgCanvas.width = width;
      this.bgCanvas.height = height;
    }

    const ctx = this.bgCtx;
    ctx.clearRect(0, 0, width, height);

    // 1. Warehouse Floor Slab (80m x 50m)
    const p0 = this.projection.project(0, 0, 0);
    const p1 = this.projection.project(80, 0, 0);
    const p2 = this.projection.project(80, 50, 0);
    const p3 = this.projection.project(0, 50, 0);

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();

    // 2. Floor Grid Lines (every 10m)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
    ctx.lineWidth = 1 * dpr;

    for (let x = 10; x < 80; x += 10) {
      const a = this.projection.project(x, 0, 0);
      const b = this.projection.project(x, 50, 0);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    for (let y = 10; y < 50; y += 10) {
      const a = this.projection.project(0, y, 0);
      const b = this.projection.project(80, y, 0);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    // 3. Navigation Graph Edges
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.18)';
    ctx.lineWidth = 1 * dpr;
    for (const edge of EDGES) {
      const from = nodeXY(edge.from);
      const to = nodeXY(edge.to);
      if (from && to) {
        const pf = this.projection.project(from.x, from.y, 0.05);
        const pt = this.projection.project(to.x, to.y, 0.05);
        ctx.moveTo(pf.x, pf.y);
        ctx.lineTo(pt.x, pt.y);
      }
    }
    ctx.stroke();

    // 4. DOCK Workstation Pad (0..6 x 0..6)
    const d0 = this.projection.project(0, 0, 0.02);
    const d1 = this.projection.project(6, 0, 0.02);
    const d2 = this.projection.project(6, 6, 0.02);
    const d3 = this.projection.project(0, 6, 0.02);

    ctx.beginPath();
    ctx.moveTo(d0.x, d0.y);
    ctx.lineTo(d1.x, d1.y);
    ctx.lineTo(d2.x, d2.y);
    ctx.lineTo(d3.x, d3.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(99, 102, 241, 0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.6)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();

    const dCenter = this.projection.project(3, 3, 0.05);
    ctx.fillStyle = '#818cf8';
    ctx.font = `bold ${Math.round(10 * dpr)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DOCK', dCenter.x, dCenter.y);

    // 5. PACK Workstation Pad (74..80 x 0..6)
    const k0 = this.projection.project(74, 0, 0.02);
    const k1 = this.projection.project(80, 0, 0.02);
    const k2 = this.projection.project(80, 6, 0.02);
    const k3 = this.projection.project(74, 6, 0.02);

    ctx.beginPath();
    ctx.moveTo(k0.x, k0.y);
    ctx.lineTo(k1.x, k1.y);
    ctx.lineTo(k2.x, k2.y);
    ctx.lineTo(k3.x, k3.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(16, 185, 129, 0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();

    const kCenter = this.projection.project(77, 3, 0.05);
    ctx.fillStyle = '#34d399';
    ctx.fillText('PACK', kCenter.x, kCenter.y);

    // 6. Aisle Labels
    ctx.fillStyle = '#64748b';
    ctx.font = `bold ${Math.round(11 * dpr)}px monospace`;
    for (const [letter, xCoord] of [['A', 10], ['B', 30], ['C', 50], ['D', 70]] as const) {
      const p = this.projection.project(xCoord, 2, 0.05);
      ctx.fillText(`AISLE ${letter}`, p.x, p.y);
    }
  }

  /**
   * Main render method. Draws cached background, 3D route, 192 depth-sorted bin boxes,
   * target extrusions, and beacon stop pins.
   */
  public renderWithOptions(opts: RenderOptions): number {
    const {
      ctx,
      scene,
      yaw,
      pitch,
      zoom,
      panX,
      panY,
      width,
      height,
      dpr,
      quality,
      levelFilter,
      targetBinCode,
      hoveredBinIndex,
      pinnedBinIndex,
      flashingBins,
      locateQuery,
      missionRoute,
      missionStops,
      pickerProgress
    } = opts;

    const cx = width / 2 + panX;
    const cy = height / 2 + panY;

    // 1. Update projection math
    this.projection.update(yaw, pitch, zoom, cx, cy);

    // 2. Update depth sort (only executes when yaw changes)
    scene.sortBoxesByDepth(yaw);

    // 3. Render or blit static background
    const bgKey = `${yaw.toFixed(4)}_${pitch.toFixed(4)}_${zoom.toFixed(2)}_${cx.toFixed(1)}_${cy.toFixed(1)}_${width}_${height}`;
    if (bgKey !== this.lastBgKey) {
      this.renderBackgroundCache(width, height, dpr);
      this.lastBgKey = bgKey;
    }

    ctx.clearRect(0, 0, width, height);
    if (this.bgCanvas) {
      ctx.drawImage(this.bgCanvas, 0, 0);
    }

    let drawCalls = 0;
    const isLow = quality === 'low';

    // 4. Render 3D Route Polyline (Floor Level wz = 0.05)
    if (missionRoute && missionRoute.points.length >= 2) {
      const pts = missionRoute.points;
      const totalPts = pts.length;

      // Determine split point for completed vs remaining stops
      let firstPendingNodeIdx = totalPts - 1;
      if (missionStops && missionStops.length > 0) {
        const firstPendingStop = missionStops.find((s) => s.status === 'PENDING');
        if (firstPendingStop) {
          const nodeIdx = missionRoute.nodeIds.findIndex((id) => id.includes(firstPendingStop.shelf_code.split('-')[0]));
          if (nodeIdx > 0) {
            firstPendingNodeIdx = nodeIdx;
          }
        }
      }

      // Draw completed portion (muted)
      if (firstPendingNodeIdx > 0) {
        ctx.beginPath();
        const p0 = this.projection.project(pts[0].x, pts[0].y, 0.05);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i <= firstPendingNodeIdx; i++) {
          const p = this.projection.project(pts[i].x, pts[i].y, 0.05);
          ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.55)';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
      }

      // Draw remaining portion with two-pass glow
      if (firstPendingNodeIdx < totalPts - 1) {
        const startIdx = Math.max(0, firstPendingNodeIdx);

        // Pass 1: Translucent outer glow
        if (!isLow) {
          ctx.beginPath();
          const pStart = this.projection.project(pts[startIdx].x, pts[startIdx].y, 0.05);
          ctx.moveTo(pStart.x, pStart.y);
          for (let i = startIdx + 1; i < totalPts; i++) {
            const p = this.projection.project(pts[i].x, pts[i].y, 0.05);
            ctx.lineTo(p.x, p.y);
          }
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.28)';
          ctx.lineWidth = 7 * dpr;
          ctx.stroke();
        }

        // Pass 2: Sharp core stroke
        ctx.beginPath();
        const pStart = this.projection.project(pts[startIdx].x, pts[startIdx].y, 0.05);
        ctx.moveTo(pStart.x, pStart.y);
        for (let i = startIdx + 1; i < totalPts; i++) {
          const p = this.projection.project(pts[i].x, pts[i].y, 0.05);
          ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = '#818cf8';
        ctx.lineWidth = 2.5 * dpr;
        ctx.stroke();
      }

      // Moving picker marker
      if (pickerProgress !== undefined && pickerProgress >= 0 && pickerProgress <= 1) {
        const targetDist = pickerProgress * missionRoute.totalDistance;
        let pickerX = pts[0].x;
        let pickerY = pts[0].y;

        for (let i = 0; i < pts.length - 1; i++) {
          const d0 = missionRoute.cumulativeDistance[i];
          const d1 = missionRoute.cumulativeDistance[i + 1];
          if (targetDist >= d0 && targetDist <= d1) {
            const segLen = d1 - d0;
            const t = segLen > 0 ? (targetDist - d0) / segLen : 0;
            pickerX = pts[i].x + (pts[i + 1].x - pts[i].x) * t;
            pickerY = pts[i].y + (pts[i + 1].y - pts[i].y) * t;
            break;
          }
        }

        const pickScreen = this.projection.project(pickerX, pickerY, 0.1);
        ctx.beginPath();
        ctx.arc(pickScreen.x, pickScreen.y, 9 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(pickScreen.x, pickScreen.y, 4.5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#10b981';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }
    }

    // 5. Render 192 boxes in sorted depth order
    const { vX, vY, signCos, signSin } = this.projection;
    const sorted = scene.sortedIndices;
    const bounds = scene.boxBounds;
    const meta = scene.metadata;

    const lowerQuery = locateQuery?.trim().toLowerCase();

    for (let i = 0; i < 192; i++) {
      const boxIdx = sorted[i];
      const m = meta[boxIdx];

      // Level filtering ghosting (15% alpha)
      const isFilteredOut = levelFilter && levelFilter !== 'ALL' && m.level !== levelFilter;
      ctx.globalAlpha = isFilteredOut ? 0.15 : 1.0;

      // Pick palette based on bin status / storage class
      let palette = SHADED_PALETTES.default;
      if (m.storageClass === 'HAZMAT') {
        palette = SHADED_PALETTES.hazmat;
      } else if (m.shelfStatus === 'MAINTENANCE') {
        palette = SHADED_PALETTES.maintenance;
      } else if (m.bin) {
        const state = binVisualState(m.bin, m.shelfStatus);
        palette = SHADED_PALETTES[state] || SHADED_PALETTES.default;
      }

      const isTargetBin = targetBinCode && m.binCode === targetBinCode;
      const isSelected = boxIdx === hoveredBinIndex || boxIdx === pinnedBinIndex;
      const isFlashing = flashingBins && flashingBins.has(m.binCode);

      // Locate highlight
      const isLocated =
        lowerQuery &&
        (m.binCode.toLowerCase().includes(lowerQuery) ||
          m.shelfCode.toLowerCase().includes(lowerQuery) ||
          (m.bin?.sku && m.bin.sku.toLowerCase().includes(lowerQuery)) ||
          (m.bin?.product_name && m.bin.product_name.toLowerCase().includes(lowerQuery)));

      const off = boxIdx * 9;
      const x0 = bounds[off + 0];
      const y0 = bounds[off + 1];
      const z0 = bounds[off + 2];
      const x1 = bounds[off + 3];
      const y1 = bounds[off + 4];
      // Target bin is extruded 0.2m higher in 3D
      const z1 = isTargetBin ? bounds[off + 5] + 0.2 : bounds[off + 5];

      // Project 8 box corners into reusable vX and vY buffers
      this.projection.projectBoxCorners(x0, y0, z0, x1, y1, z1);

      // --- Face 1: X Face ---
      ctx.beginPath();
      if (signSin >= 0) {
        ctx.moveTo(vX[1], vY[1]);
        ctx.lineTo(vX[2], vY[2]);
        ctx.lineTo(vX[6], vY[6]);
        ctx.lineTo(vX[5], vY[5]);
      } else {
        ctx.moveTo(vX[0], vY[0]);
        ctx.lineTo(vX[3], vY[3]);
        ctx.lineTo(vX[7], vY[7]);
        ctx.lineTo(vX[4], vY[4]);
      }
      ctx.closePath();
      ctx.fillStyle = palette.front;
      ctx.fill();
      if (!isLow) {
        ctx.strokeStyle = palette.stroke;
        ctx.lineWidth = 0.8 * dpr;
        ctx.stroke();
      }

      // --- Face 2: Y Face ---
      ctx.beginPath();
      if (signCos >= 0) {
        ctx.moveTo(vX[3], vY[3]);
        ctx.lineTo(vX[2], vY[2]);
        ctx.lineTo(vX[6], vY[6]);
        ctx.lineTo(vX[7], vY[7]);
      } else {
        ctx.moveTo(vX[0], vY[0]);
        ctx.lineTo(vX[1], vY[1]);
        ctx.lineTo(vX[5], vY[5]);
        ctx.lineTo(vX[4], vY[4]);
      }
      ctx.closePath();
      ctx.fillStyle = palette.side;
      ctx.fill();
      if (!isLow) {
        ctx.stroke();
      }

      // --- Face 3: Top Face [4, 5, 6, 7] ---
      ctx.beginPath();
      ctx.moveTo(vX[4], vY[4]);
      ctx.lineTo(vX[5], vY[5]);
      ctx.lineTo(vX[6], vY[6]);
      ctx.lineTo(vX[7], vY[7]);
      ctx.closePath();
      ctx.fillStyle = palette.top;
      ctx.fill();
      if (!isLow) {
        ctx.stroke();
      }

      // Distinctive outline overlays (Target, Selection, Search, Flash)
      if (isTargetBin) {
        ctx.strokeStyle = '#818cf8';
        ctx.lineWidth = 2.4 * dpr;
        ctx.stroke();
      } else if (isSelected) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.0 * dpr;
        ctx.stroke();
      } else if (isLocated) {
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2.2 * dpr;
        ctx.stroke();
      } else if (isFlashing) {
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 2.6 * dpr;
        ctx.stroke();
      }

      drawCalls += 3;
    }

    ctx.globalAlpha = 1.0;

    // 6. Numbered Beacon Stop Pins (At wz = 4.6m)
    if (missionStops && missionStops.length > 0) {
      const now = Date.now();

      for (const stop of missionStops) {
        const parts = stop.shelf_code.split('-');
        const aisle = parts[0];
        const bay = parseInt(parts[1], 10);
        const side = parts[2];

        // Locate corresponding navigation node coordinate
        const nodeStr = `N-${aisle}-${bay.toString().padStart(2, '0')}`;
        const baseCoord = nodeXY(nodeStr) || { x: 10, y: 10 };

        // Offset slightly toward shelf side
        const xOffset = side === 'L' ? -1.2 : 1.2;
        const wx = baseCoord.x + xOffset;
        const wy = baseCoord.y;

        // Ground anchor point and top beacon point
        const pBottom = this.projection.project(wx, wy, 0.05);
        const pTop = this.projection.project(wx, wy, 4.6);

        // Vertical beacon line
        ctx.beginPath();
        ctx.moveTo(pBottom.x, pBottom.y);
        ctx.lineTo(pTop.x, pTop.y);
        ctx.strokeStyle = stop.status === 'PICKED' ? 'rgba(16, 185, 129, 0.6)' : 'rgba(99, 102, 241, 0.6)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([3 * dpr, 3 * dpr]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Next pending stop pulsing halo
        const isNextPending = targetBinCode && stop.bin_code === targetBinCode;
        if (isNextPending && !isLow) {
          const pulseRadius = (14 + 3 * Math.sin((now / 160) * Math.PI)) * dpr;
          ctx.beginPath();
          ctx.arc(pTop.x, pTop.y, pulseRadius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(99, 102, 241, 0.25)';
          ctx.fill();
        }

        // Screen-upright badge circle
        const radius = 10 * dpr;
        ctx.beginPath();
        ctx.arc(pTop.x, pTop.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = stop.status === 'PICKED' ? '#10b981' : isNextPending ? '#6366f1' : '#475569';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4 * dpr;
        ctx.stroke();

        // Stop sequence number
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(10 * dpr)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(stop.seq), pTop.x, pTop.y);
      }
    }

    return drawCalls;
  }

  // Backwards compatibility shim for Phase 3 tests
  public render(
    ctx: CanvasRenderingContext2D,
    scene: TwinScene,
    yaw: number,
    pitch: number,
    zoom: number,
    panX: number,
    panY: number,
    width: number,
    height: number,
    dpr: number,
    quality: 'high' | 'low'
  ): number {
    return this.renderWithOptions({
      ctx,
      scene,
      yaw,
      pitch,
      zoom,
      panX,
      panY,
      width,
      height,
      dpr,
      quality
    });
  }
}
