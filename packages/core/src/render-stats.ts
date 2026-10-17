/** GPU memory the chart's series hold, in bytes. Shared programs and the unit quad are not counted. */
export interface GpuMemory {
  /** Instance buffers of candle, column, histogram and profile batches, at their allocated capacity. */
  buffers: number;
  /** Heatmap value textures at their allocated capacity, plus their colour ramps. */
  textures: number;
  /** `buffers + textures`. */
  total: number;
}

/** GPU work the renderer did during one frame. */
export interface FrameCounters {
  /** Draw calls issued. */
  drawCalls: number;
  /** Instances drawn, summed over draw calls (a non-instanced draw counts as one). */
  instances: number;
  /** `bufferData` and `bufferSubData` calls. */
  bufferUploads: number;
  /** Bytes sent by those calls. */
  bufferBytes: number;
  /** `texImage2D` and `texSubImage2D` calls. */
  textureUploads: number;
  /** Bytes sent by those calls. */
  textureBytes: number;
}

/** CPU milliseconds spent in each phase of a frame; phases a frame skipped are 0. */
export interface FrameTimes {
  /** Fitting price scales to the visible data. */
  autoscale: number;
  /** Grid, axes and the series drawn with Canvas2D under the GPU layer. */
  drawBottom: number;
  /** Recording the GPU-rendered series (the GPU may finish them later). */
  drawGL: number;
  /** Drawings, labels and the other overlay content. */
  drawTop: number;
  /** The crosshair layer: crosshair, its axis labels, series crosshair markers and the legend. */
  drawCursor: number;
  /** The whole frame, including the phases above. */
  total: number;
}

/**
 * What asked for a frame. `'host'` is the app calling `invalidate()` or
 * `invalidateOverlay()`; the others are the chart's own requests:
 * - `'series'`: series data or options, indicators, adding or removing a series.
 * - `'view'`: panning, zooming, scrolling and price-scale changes, by the user or the API.
 * - `'layout'`: a resize, panes added, removed, moved or resized, or a restored GPU context.
 * - `'options'`: chart options, the legend, the status line and event listeners that change what is drawn.
 * - `'animation'`: easing, inertia and series animations still running.
 * - `'crosshair'`: the crosshair or the "+" button moved.
 * - `'drawings'`, `'annotations'` and `'primitives'`: those layers asked for a redraw;
 *   reference lines count as annotations.
 */
export type RedrawReason =
  | 'host'
  | 'series'
  | 'view'
  | 'layout'
  | 'options'
  | 'animation'
  | 'crosshair'
  | 'drawings'
  | 'annotations'
  | 'primitives';

/** Every reason, in the order a snapshot lists them; a reason's bit is `1 << index`. */
export const REDRAW_REASONS: readonly RedrawReason[] = [
  'host',
  'series',
  'view',
  'layout',
  'options',
  'animation',
  'crosshair',
  'drawings',
  'annotations',
  'primitives',
];

/** The bit of `reason` in a mask of reasons. */
export function reasonBit(reason: RedrawReason): number {
  return 1 << REDRAW_REASONS.indexOf(reason);
}

/** The reasons set in `mask`, in `REDRAW_REASONS` order. */
export function reasonsOf(mask: number): RedrawReason[] {
  return REDRAW_REASONS.filter((_, i) => mask & (1 << i));
}

/** What one rendered frame cost, as `chart.frameStats` and the `frame:render` event report it. */
export interface RenderStats extends FrameCounters {
  /**
   * `'scene'` redrew every layer; `'overlay'` redrew only the drawings,
   * labels and crosshair; `'cursor'` only the crosshair layer (a crosshair move).
   */
  kind: 'scene' | 'overlay' | 'cursor';
  times: FrameTimes;
  /**
   * What asked for this frame since the previous one, in `RedrawReason` order.
   * Empty for frames nothing asked for, such as the first one or a screenshot.
   */
  reasons: RedrawReason[];
  /**
   * GPU milliseconds spent on the GPU-rendered series, from the newest frame
   * whose measurement has come back (usually two or three frames old, since
   * the chart never waits for the GPU). Null when the browser lacks the timer
   * query extension or no measurement has come back yet.
   */
  gpuTime: number | null;
  /** GPU memory held after the frame. */
  memory: GpuMemory;
}

export function zeroCounters(): FrameCounters {
  return { drawCalls: 0, instances: 0, bufferUploads: 0, bufferBytes: 0, textureUploads: 0, textureBytes: 0 };
}

/** A phase of a drawn frame, as `FrameTimes` times it and `FrameObserver.lap` reports it. */
export type FramePhase = Exclude<keyof FrameTimes, 'total'>;

/** Times the phases of one frame. Only created while render statistics are on. */
export class FrameClock {
  readonly times: FrameTimes = { autoscale: 0, drawBottom: 0, drawGL: 0, drawTop: 0, drawCursor: 0, total: 0 };
  readonly #start = performance.now();
  private last = this.#start;

  /** Charge the time since the previous lap (or the start) to `phase`. */
  lap(phase: FramePhase): void {
    const now = performance.now();
    this.times[phase] += now - this.last;
    this.last = now;
  }

  /** Charge the time since the previous lap to nothing, e.g. work between phases. */
  skip(): void {
    this.last = performance.now();
  }

  finish(): FrameTimes {
    this.times.total = performance.now() - this.#start;
    return this.times;
  }
}
