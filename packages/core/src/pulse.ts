import { withAlpha } from './util/color';

/**
 * When the last point of a line pulses: never (`'off'`), once per live
 * update (`'on-update'`), or for as long as it is on screen (`'continuous'`).
 */
export type LastPointPulseMode = 'off' | 'on-update' | 'continuous';

/** The object form of `lastPointPulse`. */
export interface LastPointPulseOptions {
  /** Default `'on-update'`. */
  mode?: LastPointPulseMode;
  /** Ring and dot colour; defaults to the line colour at the last point. */
  color?: string;
  /** Radius the ring grows to, in css px (default 10). */
  radius?: number;
  /** Time one ring takes to grow and fade, in ms (default 900). */
  durationMs?: number;
}

/** The `lastPointPulse` series option: a mode, or the object form. */
export type LastPointPulse = LastPointPulseMode | LastPointPulseOptions;

const DEFAULT_RADIUS = 10;
const DEFAULT_DURATION_MS = 900;
/** Opacity of the ring as it starts; it fades to nothing as it grows. */
const RING_ALPHA = 0.45;

interface ResolvedPulse {
  mode: 'on-update' | 'continuous';
  color?: string;
  radius: number;
  durationMs: number;
}

/** Whether `option` asks for a pulse at all: not unset, `'off'` or `{ mode: 'off' }`. */
export function pulseOn(option: LastPointPulse | undefined): boolean {
  return typeof option === 'object' ? option.mode !== 'off' : option !== undefined && option !== 'off';
}

/** The option with defaults filled in; null while the pulse is off. */
export function resolvePulse(option: LastPointPulse | undefined): ResolvedPulse | null {
  if (!pulseOn(option)) return null;
  const o: LastPointPulseOptions = typeof option === 'string' ? { mode: option } : option!;
  const mode = (o.mode ?? 'on-update') as ResolvedPulse['mode'];
  const radius = Number.isFinite(o.radius) && o.radius! > 0 ? o.radius! : DEFAULT_RADIUS;
  const durationMs = Number.isFinite(o.durationMs) && o.durationMs! > 0 ? o.durationMs! : DEFAULT_DURATION_MS;
  return { mode, color: o.color, radius, durationMs };
}

/** Whether the user asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The animation state of one series' last-point pulse. The series draws it
 * from `draw2D` and the chart advances it after each frame with `step`, which
 * says whether the overlay needs another frame.
 */
export class PulseClock {
  readonly #still: () => boolean;

  /** `still` says whether the chart shows no animations (a static chart). */
  constructor(still: () => boolean = () => false) {
    this.#still = still;
  }

  /** Time into the current ring in ms; null while no ring runs. */
  #elapsed: number | null = null;
  /** The last point was drawn on screen since the previous step. */
  private shown = false;

  /** A live update arrived: start a ring in `'on-update'` mode. */
  trigger(option: LastPointPulse | undefined): void {
    if (resolvePulse(option)?.mode === 'on-update' && !this.#motionOff()) this.#elapsed = 0;
  }

  /** Whether a ring is running. */
  get running(): boolean {
    return this.#elapsed !== null;
  }

  /**
   * Advance by `dt` ms; true when the overlay must redraw. Nothing runs while
   * the series is hidden, its last point was not drawn on screen, the chart is
   * static or the system asks for reduced motion, so no frames are requested
   * then.
   */
  step(option: LastPointPulse | undefined, dt: number, visible: boolean): boolean {
    const shown = this.shown && visible;
    this.shown = false;
    const p = resolvePulse(option);
    if (!p && this.#elapsed === null) return false;
    if (!p || !shown || this.#motionOff()) {
      // A ring left on screen needs one more frame to clear it.
      const clear = shown && this.#elapsed !== null;
      this.#elapsed = null;
      return clear;
    }
    if (this.#elapsed === null) {
      if (p.mode !== 'continuous') return false;
      this.#elapsed = 0;
    }
    this.#elapsed += dt;
    if (this.#elapsed >= p.durationMs) this.#elapsed = p.mode === 'continuous' ? this.#elapsed % p.durationMs : null;
    // Ended rings redraw once more to clear.
    return true;
  }

  /**
   * Draw the pulse at the last point (`x`, `y`, css px in the pane) in the
   * line's `color`. Call only when that point is on screen. Reduced motion and
   * static charts draw a still dot instead of the ring.
   */
  draw(ctx: CanvasRenderingContext2D, option: LastPointPulse | undefined, x: number, y: number, color: string, lineWidth: number): void {
    this.shown = true;
    const p = resolvePulse(option);
    if (!p) return;
    const fill = p.color ?? color;
    const dot = Math.max(2.5, lineWidth + 1);
    if (!this.#motionOff()) {
      if (this.#elapsed === null && p.mode === 'on-update') return;
      const t = Math.min(1, (this.#elapsed ?? 0) / p.durationMs);
      // Fast at first, settling as it reaches full size.
      const grow = 1 - (1 - t) ** 3;
      const r = dot + Math.max(0, p.radius - dot) * grow;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(fill, RING_ALPHA * (1 - t));
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, dot, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  #motionOff(): boolean {
    return this.#still() || prefersReducedMotion();
  }
}

/** Whether a point at (`x`, `y`) lies inside a pane `width` × `height` css px. */
export function onScreen(x: number, y: number, width: number, height: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= width && y >= 0 && y <= height;
}
