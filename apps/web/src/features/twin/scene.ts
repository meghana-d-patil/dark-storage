/**
 * Spatial Scene Model & Geometry Buffers for the Isometric Digital Twin.
 * Precomputes 192 bin boxes with zero per-frame garbage collector overhead.
 */

import { WarehouseLayoutResponse, ShelfLayout, BinLayout } from '../../hooks/useWarehouseData.js';
import { shelfRect } from '../../lib/warehouseGeometry.js';

export interface BinBoxMetadata {
  binCode: string;
  shelfCode: string;
  aisle: string;
  bay: number;
  side: string;
  level: number;
  storageClass: string;
  shelfStatus: string;
  bin: BinLayout | null;
}

export class TwinScene {
  public readonly count = 192;

  // Stride of 9: [x0, y0, z0, x1, y1, z1, cx, cy, cz]
  public readonly boxBounds = new Float32Array(192 * 9);
  public readonly depths = new Float32Array(192);
  public readonly sortedIndices = new Uint16Array(192);
  public readonly metadata: BinBoxMetadata[] = new Array(192);

  // Quick lookup map: binCode -> index (0..191)
  public readonly binIndexMap = new Map<string, number>();

  // Cached yaw used for current sorted order
  private lastSortedYaw: number | null = null;

  constructor(layout?: WarehouseLayoutResponse) {
    for (let i = 0; i < 192; i++) {
      this.sortedIndices[i] = i;
    }
    this.buildFromLayout(layout);
  }

  public buildFromLayout(layout?: WarehouseLayoutResponse): void {
    let index = 0;
    const aisles = ['A', 'B', 'C', 'D'];

    for (const aisleLetter of aisles) {
      const aisleData = layout?.aisles?.find((a) => a.aisle === aisleLetter);

      for (let bay = 1; bay <= 6; bay++) {
        const bayStr = bay.toString().padStart(2, '0');

        for (const side of ['L', 'R']) {
          const shelfCode = `${aisleLetter}-${bayStr}-${side}`;
          const shelfData = aisleData?.shelves?.find((s) => s.code === shelfCode);

          const sRect = shelfRect({
            code: shelfCode,
            aisle: aisleLetter,
            bay,
            side,
            x: shelfData?.x,
            y: shelfData?.y
          });

          const storageClass =
            shelfData?.storage_class ||
            (aisleLetter === 'D' && (bay === 1 || bay === 2) ? 'HAZMAT' : 'STANDARD');
          const shelfStatus =
            shelfData?.status || (shelfCode === 'B-06-L' ? 'MAINTENANCE' : 'ACTIVE');

          // 4 vertical levels per shelf
          for (let level = 1; level <= 4; level++) {
            const binCode = `${shelfCode}-${level}`;
            const binData = shelfData?.bins?.find((b) => b.level === level) || null;

            // Level heights (meters):
            // Level 1: 0.05 to 1.05
            // Level 2: 1.15 to 2.15
            // Level 3: 2.25 to 3.25
            // Level 4: 3.35 to 4.35
            const z0 = 0.05 + (level - 1) * 1.1;
            const z1 = z0 + 1.0;

            const x0 = sRect.x;
            const y0 = sRect.y;
            const x1 = sRect.x + sRect.width;
            const y1 = sRect.y + sRect.height;

            const cx = (x0 + x1) / 2;
            const cy = (y0 + y1) / 2;
            const cz = (z0 + z1) / 2;

            const offset = index * 9;
            this.boxBounds[offset + 0] = x0;
            this.boxBounds[offset + 1] = y0;
            this.boxBounds[offset + 2] = z0;
            this.boxBounds[offset + 3] = x1;
            this.boxBounds[offset + 4] = y1;
            this.boxBounds[offset + 5] = z1;
            this.boxBounds[offset + 6] = cx;
            this.boxBounds[offset + 7] = cy;
            this.boxBounds[offset + 8] = cz;

            this.metadata[index] = {
              binCode,
              shelfCode,
              aisle: aisleLetter,
              bay,
              side,
              level,
              storageClass,
              shelfStatus,
              bin: binData
            };

            this.binIndexMap.set(binCode, index);
            index++;
          }
        }
      }
    }
  }

  /**
   * Sorts 192 boxes by depth using Painter's Algorithm:
   * Depth v = cx * sin(yaw) + cy * cos(yaw).
   * Only performs sort when yaw changes; reuses existing sorted buffer otherwise.
   */
  public sortBoxesByDepth(yaw: number, force = false): void {
    if (!force && this.lastSortedYaw !== null && Math.abs(yaw - this.lastSortedYaw) < 0.0001) {
      return;
    }

    this.lastSortedYaw = yaw;
    const sinT = Math.sin(yaw);
    const cosT = Math.cos(yaw);

    // Compute depth for all 192 boxes
    for (let i = 0; i < 192; i++) {
      const off = i * 9;
      const cx = this.boxBounds[off + 6];
      const cy = this.boxBounds[off + 7];
      this.depths[i] = cx * sinT + cy * cosT;
    }

    // Sort indices far to near (smallest depth to largest depth)
    const indices = this.sortedIndices;
    const depths = this.depths;

    indices.sort((a, b) => depths[a] - depths[b]);
  }
}
