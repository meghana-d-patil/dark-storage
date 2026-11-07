/**
 * Interactive Camera Controller for Isometric Digital Twin Canvas.
 * Handles Pointer Events, Drag-Rotate, Pan, Wheel-Zoom, Friction Inertia, and Keyboard Controls.
 */

export interface CameraState {
  yaw: number; // theta in radians
  pitch: number; // phi in radians (clamped 20°..60°)
  zoom: number; // pixels per world meter (s)
  panX: number; // screen offset X
  panY: number; // screen offset Y
}

export type CameraPreset = 'iso' | 'top' | 'front';

const MIN_PITCH = (20 * Math.PI) / 180;
const MAX_PITCH = (60 * Math.PI) / 180;
const MIN_ZOOM = 6;
const MAX_ZOOM = 36;
const FRICTION = 0.91;
const VELOCITY_EPSILON = 0.0005;

export class TwinCamera {
  public state: CameraState = {
    yaw: Math.PI / 4, // 45°
    pitch: (35 * Math.PI) / 180, // 35°
    zoom: 13.5,
    panX: 0,
    panY: 0
  };

  // Inertia velocities
  private vYaw = 0;
  private vPitch = 0;
  private vPanX = 0;
  private vPanY = 0;

  // Pointer drag tracking
  private isDragging = false;
  private isPanning = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private activePointerId: number | null = null;

  // Change callback to notify renderer that view is dirty
  private onChange?: () => void;

  constructor(onChange?: () => void) {
    this.onChange = onChange;
  }

  public setOnChange(fn: () => void): void {
    this.onChange = fn;
  }

  public resetView(viewportWidth = 800, viewportHeight = 600): void {
    const defaultZoom = Math.max(MIN_ZOOM, Math.min(viewportWidth / 70, viewportHeight / 48, 14));
    this.state = {
      yaw: Math.PI / 4,
      pitch: (35 * Math.PI) / 180,
      zoom: defaultZoom,
      panX: 0,
      panY: 0
    };
    this.stopInertia();
    this.onChange?.();
  }

  public applyPreset(preset: CameraPreset): void {
    this.stopInertia();
    if (preset === 'iso') {
      this.state.yaw = Math.PI / 4;
      this.state.pitch = (35 * Math.PI) / 180;
    } else if (preset === 'top') {
      this.state.yaw = 0;
      this.state.pitch = MAX_PITCH;
    } else if (preset === 'front') {
      this.state.yaw = 0;
      this.state.pitch = MIN_PITCH;
    }
    this.onChange?.();
  }

  public stopInertia(): void {
    this.vYaw = 0;
    this.vPitch = 0;
    this.vPanX = 0;
    this.vPanY = 0;
  }

  public hasInertia(): boolean {
    return (
      Math.abs(this.vYaw) > VELOCITY_EPSILON ||
      Math.abs(this.vPitch) > VELOCITY_EPSILON ||
      Math.abs(this.vPanX) > VELOCITY_EPSILON ||
      Math.abs(this.vPanY) > VELOCITY_EPSILON
    );
  }

  /**
   * Advances inertia physics by one tick.
   * Returns true if camera moved, false if completely at rest.
   */
  public tickInertia(): boolean {
    if (this.isDragging) return false;

    // Check if motion reduction is requested
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    ) {
      this.stopInertia();
      return false;
    }

    let moved = false;

    if (Math.abs(this.vYaw) > VELOCITY_EPSILON) {
      this.state.yaw += this.vYaw;
      this.vYaw *= FRICTION;
      moved = true;
    } else {
      this.vYaw = 0;
    }

    if (Math.abs(this.vPitch) > VELOCITY_EPSILON) {
      this.state.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.state.pitch + this.vPitch));
      this.vPitch *= FRICTION;
      moved = true;
    } else {
      this.vPitch = 0;
    }

    if (Math.abs(this.vPanX) > VELOCITY_EPSILON) {
      this.state.panX += this.vPanX;
      this.vPanX *= FRICTION;
      moved = true;
    } else {
      this.vPanX = 0;
    }

    if (Math.abs(this.vPanY) > VELOCITY_EPSILON) {
      this.state.panY += this.vPanY;
      this.vPanY *= FRICTION;
      moved = true;
    } else {
      this.vPanY = 0;
    }

    if (moved) {
      // Normalize yaw to [0, 2pi)
      this.state.yaw = ((this.state.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      this.onChange?.();
    }

    return moved;
  }

  public handlePointerDown(e: PointerEvent, canvas: HTMLCanvasElement): void {
    if (this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    canvas.setPointerCapture?.(e.pointerId);

    this.isDragging = true;
    this.isPanning = e.button === 2 || e.shiftKey || e.button === 1;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    this.stopInertia();
  }

  public handlePointerMove(e: PointerEvent): void {
    if (!this.isDragging || e.pointerId !== this.activePointerId) return;

    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    if (this.isPanning) {
      this.state.panX += dx;
      this.state.panY += dy;
      this.vPanX = dx * 0.4;
      this.vPanY = dy * 0.4;
    } else {
      // Drag left/right rotates yaw
      const dYaw = dx * 0.008;
      // Drag up/down tilts pitch
      const dPitch = dy * 0.005;

      this.state.yaw = ((this.state.yaw + dYaw) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      this.state.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.state.pitch - dPitch));

      this.vYaw = dYaw;
      this.vPitch = -dPitch;
    }

    this.onChange?.();
  }

  public handlePointerUp(e: PointerEvent, canvas: HTMLCanvasElement): void {
    if (e.pointerId !== this.activePointerId) return;
    this.isDragging = false;
    this.isPanning = false;
    this.activePointerId = null;
    canvas.releasePointerCapture?.(e.pointerId);
  }

  public handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.state.zoom * zoomFactor));

    if (nextZoom !== this.state.zoom) {
      this.state.zoom = nextZoom;
      this.onChange?.();
    }
  }

  public handleKeyDown(e: KeyboardEvent): boolean {
    let handled = false;
    const ROTATE_STEP = 0.05;
    const TILT_STEP = 0.04;
    const ZOOM_STEP = 1.1;

    switch (e.key) {
      case 'ArrowLeft':
        this.state.yaw = (this.state.yaw - ROTATE_STEP + 2 * Math.PI) % (2 * Math.PI);
        handled = true;
        break;
      case 'ArrowRight':
        this.state.yaw = (this.state.yaw + ROTATE_STEP) % (2 * Math.PI);
        handled = true;
        break;
      case 'ArrowUp':
        this.state.pitch = Math.min(MAX_PITCH, this.state.pitch + TILT_STEP);
        handled = true;
        break;
      case 'ArrowDown':
        this.state.pitch = Math.max(MIN_PITCH, this.state.pitch - TILT_STEP);
        handled = true;
        break;
      case '+':
      case '=':
        this.state.zoom = Math.min(MAX_ZOOM, this.state.zoom * ZOOM_STEP);
        handled = true;
        break;
      case '-':
      case '_':
        this.state.zoom = Math.max(MIN_ZOOM, this.state.zoom / ZOOM_STEP);
        handled = true;
        break;
    }

    if (handled) {
      this.stopInertia();
      this.onChange?.();
    }

    return handled;
  }
}
