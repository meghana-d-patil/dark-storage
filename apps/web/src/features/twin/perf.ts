/**
 * Performance Monitor & Quality Controller for Isometric Digital Twin.
 * Tracks rolling frame times, FPS, draw calls, and dynamically adjusts quality.
 */

export type QualitySetting = 'auto' | 'high' | 'low';
export type EffectiveQuality = 'high' | 'low';

export interface PerfMetrics {
  fps: number;
  frameTimeMs: number;
  avgFrameTimeMs: number;
  drawCalls: number;
  dpr: number;
  effectiveQuality: EffectiveQuality;
}

export class TwinPerfMonitor {
  private frameTimes: Float32Array = new Float32Array(30);
  private frameIndex: number = 0;
  private sampleCount: number = 0;
  private lastTimestamp: number = 0;

  public qualitySetting: QualitySetting = 'auto';
  public effectiveQuality: EffectiveQuality = 'high';
  public currentDrawCalls: number = 0;
  public currentDpr: number = 1.0;

  // Frame throttling for Low quality (30 fps cap ~ 33.3ms)
  private lastRenderTime: number = 0;

  public setQuality(quality: QualitySetting): void {
    this.qualitySetting = quality;
    if (quality === 'high') {
      this.effectiveQuality = 'high';
    } else if (quality === 'low') {
      this.effectiveQuality = 'low';
    }
  }

  /**
   * Called at the start of a frame.
   * Returns false if the frame should be skipped due to quality FPS capping.
   */
  public shouldRenderFrame(now: number): boolean {
    if (this.effectiveQuality === 'low') {
      // 30 fps cap -> minimum 33ms interval
      if (now - this.lastRenderTime < 32) {
        return false;
      }
    }
    this.lastRenderTime = now;
    return true;
  }

  /**
   * Records elapsed time for a rendered frame and updates rolling metrics.
   */
  public recordFrame(elapsedMs: number): void {
    this.frameTimes[this.frameIndex] = elapsedMs;
    this.frameIndex = (this.frameIndex + 1) % 30;
    if (this.sampleCount < 30) {
      this.sampleCount++;
    }

    // Dynamic quality adjustment if in 'auto' mode
    if (this.qualitySetting === 'auto' && this.sampleCount >= 15) {
      const avg = this.getAverageFrameTime();
      if (avg > 12.0 && this.effectiveQuality !== 'low') {
        this.effectiveQuality = 'low';
      } else if (avg < 8.0 && this.effectiveQuality !== 'high') {
        this.effectiveQuality = 'high';
      }
    }
  }

  public getAverageFrameTime(): number {
    if (this.sampleCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.sampleCount; i++) {
      sum += this.frameTimes[i];
    }
    return sum / this.sampleCount;
  }

  public getMetrics(): PerfMetrics {
    const avg = this.getAverageFrameTime();
    const last = this.frameTimes[(this.frameIndex - 1 + 30) % 30] || 0;
    const fps = avg > 0 ? Math.min(60, Math.round(1000 / Math.max(avg, 16.67))) : 60;

    return {
      fps,
      frameTimeMs: parseFloat(last.toFixed(2)),
      avgFrameTimeMs: parseFloat(avg.toFixed(2)),
      drawCalls: this.currentDrawCalls,
      dpr: parseFloat(this.currentDpr.toFixed(2)),
      effectiveQuality: this.effectiveQuality
    };
  }

  public reset(): void {
    this.frameTimes.fill(0);
    this.frameIndex = 0;
    this.sampleCount = 0;
    this.lastTimestamp = 0;
    this.currentDrawCalls = 0;
  }
}
