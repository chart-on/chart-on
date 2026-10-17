import { clampLow } from './util/math';
/**
 * Frame pacing for the `lowPower` option: how fast frames really come, when
 * that counts as slow, and how long an idle low-power chart waits between
 * frames.
 */

/**
 * A smoothed gap above this (ms, under about 29 fps) counts as slow. A 30 Hz
 * screen paces frames 33.3 ms apart and stays under it.
 */
export const SLOW_FRAME_MS = 35;
/** Samples in a row with a slow smoothed gap before the chart reports it. */
export const SLOW_SAMPLES = 45;
/** A slow run ends once the smoothed gap falls below this, so a gap hovering at the limit reports once. */
const RECOVERED_MS = SLOW_FRAME_MS * 0.8;
/** Weight of the newest gap in the smoothed frame time. */
const SMOOTHING = 0.1;
/** Gaps longer than this (ms) are stalls (a hidden tab, a breakpoint), not frame pacing. */
const STALL_MS = 1000;
/** Without input for this long (ms), a low-power chart counts as idle. */
export const IDLE_AFTER_MS = 1000;
/** Shortest time between frames (ms) of an idle low-power chart: 20 fps. */
export const IDLE_FRAME_MS = 50;

export class FramePacer {
  /** Smoothed time between consecutive frames in ms; null until two frames ran back to back. */
  frameTime: number | null = null;
  /** Clock time of the latest input on the chart, while low power is on. */
  inputAt = -Infinity;
  /** Timestamp of the latest frame. */
  frameAt = -Infinity;
  #slowRun = 0;

  /**
   * Record the gap between two frames that ran back to back. True once per
   * slow run: when the smoothed gap has stayed slow for `SLOW_SAMPLES` frames.
   */
  sample(gap: number): boolean {
    if (!(gap > 0) || gap > STALL_MS) return false;
    const t = (this.frameTime = this.frameTime === null ? gap : this.frameTime + (gap - this.frameTime) * SMOOTHING);
    if (t > SLOW_FRAME_MS) this.#slowRun++;
    else if (t < RECOVERED_MS) this.#slowRun = 0;
    return this.#slowRun === SLOW_SAMPLES;
  }

  /** Start counting a new slow run (low power was turned off). */
  restart(): void {
    this.#slowRun = 0;
  }

  /**
   * How long to hold back the next frame at clock time `now`: 0 while the
   * user is giving input, else what is left of `IDLE_FRAME_MS` since the
   * latest frame.
   */
  idleDelay(now: number): number {
    if (now - this.inputAt < IDLE_AFTER_MS) return 0;
    return clampLow(this.frameAt + IDLE_FRAME_MS - now, 0, IDLE_FRAME_MS);
  }
}
