/**
 * Isometric 3D Projection Mathematics for Canvas 2D.
 * Implements Section 2.1 formulas with zero object allocations in the render loop.
 */

export class ProjectionContext {
  // Camera state
  public yaw: number = Math.PI / 4; // theta (default 45 degrees)
  public pitch: number = (35 * Math.PI) / 180; // phi (default 35 degrees)
  public zoom: number = 13.5; // scale s (pixels per meter)
  public cx: number = 0; // screen center X + pan
  public cy: number = 0; // screen center Y + pan

  // Precomputed trigonometric coefficients
  public cosTheta: number = 0;
  public sinTheta: number = 0;
  public s_sinPhi: number = 0;
  public s_cosPhi: number = 0;

  // Sign of face normals for visible face culling
  public signCos: number = 1;
  public signSin: number = 1;

  // Reusable vertex projection buffer (up to 8 vertices per box)
  public readonly vX = new Float32Array(8);
  public readonly vY = new Float32Array(8);

  public update(yaw: number, pitch: number, zoom: number, cx: number, cy: number) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.zoom = zoom;
    this.cx = cx;
    this.cy = cy;

    this.cosTheta = Math.cos(yaw);
    this.sinTheta = Math.sin(yaw);
    const sinPhi = Math.sin(pitch);
    const cosPhi = Math.cos(pitch);

    this.s_sinPhi = zoom * sinPhi;
    this.s_cosPhi = zoom * cosPhi;

    this.signCos = this.cosTheta >= 0 ? 1 : -1;
    this.signSin = this.sinTheta >= 0 ? 1 : -1;
  }

  /**
   * Projects a single world coordinate (wx, wy, wz) into screen (sx, sy).
   */
  public project(wx: number, wy: number, wz: number): { x: number; y: number; depth: number } {
    const u = wx * this.cosTheta - wy * this.sinTheta;
    const v = wx * this.sinTheta + wy * this.cosTheta;
    return {
      x: this.cx + u * this.zoom,
      y: this.cy + v * this.s_sinPhi - wz * this.s_cosPhi,
      depth: v
    };
  }

  /**
   * Fast in-place projection for an axis-aligned bounding box.
   * Fills this.vX and this.vY with screen coordinates for the 8 box corners:
   * 0: (x0, y0, z0), 1: (x1, y0, z0), 2: (x1, y1, z0), 3: (x0, y1, z0)
   * 4: (x0, y0, z1), 5: (x1, y0, z1), 6: (x1, y1, z1), 7: (x0, y1, z1)
   */
  public projectBoxCorners(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number
  ): void {
    const { cosTheta, sinTheta, s_sinPhi, s_cosPhi, zoom, cx, cy, vX, vY } = this;

    // Corner 0: (x0, y0, z0)
    let u = x0 * cosTheta - y0 * sinTheta;
    let v = x0 * sinTheta + y0 * cosTheta;
    vX[0] = cx + u * zoom;
    vY[0] = cy + v * s_sinPhi - z0 * s_cosPhi;

    // Corner 1: (x1, y0, z0)
    u = x1 * cosTheta - y0 * sinTheta;
    v = x1 * sinTheta + y0 * cosTheta;
    vX[1] = cx + u * zoom;
    vY[1] = cy + v * s_sinPhi - z0 * s_cosPhi;

    // Corner 2: (x1, y1, z0)
    u = x1 * cosTheta - y1 * sinTheta;
    v = x1 * sinTheta + y1 * cosTheta;
    vX[2] = cx + u * zoom;
    vY[2] = cy + v * s_sinPhi - z0 * s_cosPhi;

    // Corner 3: (x0, y1, z0)
    u = x0 * cosTheta - y1 * sinTheta;
    v = x0 * sinTheta + y1 * cosTheta;
    vX[3] = cx + u * zoom;
    vY[3] = cy + v * s_sinPhi - z0 * s_cosPhi;

    // Corner 4: (x0, y0, z1)
    u = x0 * cosTheta - y0 * sinTheta;
    v = x0 * sinTheta + y0 * cosTheta;
    vX[4] = cx + u * zoom;
    vY[4] = cy + v * s_sinPhi - z1 * s_cosPhi;

    // Corner 5: (x1, y0, z1)
    u = x1 * cosTheta - y0 * sinTheta;
    v = x1 * sinTheta + y0 * cosTheta;
    vX[5] = cx + u * zoom;
    vY[5] = cy + v * s_sinPhi - z1 * s_cosPhi;

    // Corner 6: (x1, y1, z1)
    u = x1 * cosTheta - y1 * sinTheta;
    v = x1 * sinTheta + y1 * cosTheta;
    vX[6] = cx + u * zoom;
    vY[6] = cy + v * s_sinPhi - z1 * s_cosPhi;

    // Corner 7: (x0, y1, z1)
    u = x0 * cosTheta - y1 * sinTheta;
    v = x0 * sinTheta + y1 * cosTheta;
    vX[7] = cx + u * zoom;
    vY[7] = cy + v * s_sinPhi - z1 * s_cosPhi;
  }
}
