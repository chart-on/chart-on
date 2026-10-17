import type { Chart, ChartOptions } from './chart';
import type { DrawingManager } from './drawing/manager';
import type { RenderBackend } from './gl/backend';
import { GpuTimer } from './gl/gpu-timer';
import { GLRenderer } from './gl/renderer';
import type { Pane } from './pane';
import type { FrameObserver } from './plugins';
import { FrameClock, reasonBit, reasonsOf, zeroCounters, type FrameCounters, type FramePhase, type RedrawReason, type RenderStats } from './render-stats';
import type { ChartTheme } from './theme';
import { fillLine, fontCss, resolveFont, type ResolvedFont } from './typography';
import { withAlpha } from './util/color';
import { sharp } from './util/math';

/** Frames the sparkline shows. */
const HISTORY = 60;
/** One frame at 60 Hz, drawn as a reference line on the sparkline. */
const BUDGET_MS = 1000 / 60;
const PAD = 6;
const SPARK_HEIGHT = 28;
/** Gap from the pane edges. */
const INSET = 8;
/** Grid, in css px, that drawing hit regions are sampled on for the bounds outlines. */
const HIT_REGION_STEP = 4;

/** The chart's boxes the bounds outlines trace, in plot coordinates. */
export interface OverlayBox {
  panes: readonly { top: number; height: number }[];
  /** Width of the chart left of the plot, axes and lanes included. */
  plotLeft: number;
  plotWidth: number;
  plotHeight: number;
  /** Size of the whole chart. */
  width: number;
  height: number;
  /** Widths of the primitive lanes beside the plot. */
  laneSpace: { left: number; right: number };
}

/** `bytes` in B, KB or MB (1024-based). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ms = (value: number) => `${value.toFixed(2)} ms`;

/** The text lines the heads-up display shows for `stats`. */
export function statsLines(stats: RenderStats): string[] {
  const gpu = stats.gpuTime === null ? 'n/a' : ms(stats.gpuTime);
  return [
    `${stats.kind} ${ms(stats.times.total)} · gpu ${gpu}`,
    `draws ${stats.drawCalls} · instances ${stats.instances}`,
    `buffers ${stats.bufferUploads} (${formatBytes(stats.bufferBytes)}) · textures ${stats.textureUploads} (${formatBytes(stats.textureBytes)})`,
    `gpu memory ${formatBytes(stats.memory.total)}`,
    `why ${stats.reasons.length > 0 ? stats.reasons.join(', ') : '-'}`,
  ];
}

/**
 * The render statistics heads-up display: a sparkline of recent frame times
 * and the last frame's numbers. It keeps its own history, so it costs nothing
 * until the chart creates it.
 */
export class StatsOverlay {
  readonly #totals = new Float32Array(HISTORY);
  /** Frames recorded, up to `HISTORY`, and the slot the next one goes in. */
  #filled = 0;
  private next = 0;
  private last: RenderStats | null = null;
  /** Drawing hit regions the bounds outlines last sampled, as `[x, y, width]` runs; kept across crosshair-only frames. */
  hitRuns: number[] | null = null;

  record(stats: RenderStats): void {
    this.#totals[this.next] = stats.times.total;
    this.next = (this.next + 1) % HISTORY;
    this.#filled = Math.min(this.#filled + 1, HISTORY);
    this.last = stats;
  }

  /**
   * Draw in the bottom-left corner of `pane` (plot coordinates), inset from
   * its edges, if it fits in a plot `plotWidth` wide.
   */
  draw(ctx: CanvasRenderingContext2D, pane: { top: number; height: number }, plotWidth: number, theme: ChartTheme, font: ResolvedFont): void {
    const stats = this.last;
    if (!stats) return;
    const left = INSET;
    const bottom = pane.top + pane.height - INSET;
    const maxWidth = plotWidth - INSET * 2;
    const maxHeight = pane.height - INSET * 2;
    const lines = statsLines(stats);
    ctx.font = fontCss(font);
    let textWidth = 0;
    for (const line of lines) textWidth = Math.max(textWidth, ctx.measureText(line).width);
    const lineHeight = font.fontSize + 4;
    const width = Math.ceil(textWidth) + PAD * 2;
    const height = PAD * 3 + SPARK_HEIGHT + lines.length * lineHeight;
    if (width > maxWidth || height > maxHeight) return;
    const top = bottom - height;

    ctx.fillStyle = withAlpha(theme.labelBackground, 0.9);
    ctx.fillRect(left, top, width, height);
    ctx.strokeStyle = theme.separator;
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);

    this.#drawSparkline(ctx, left + PAD, top + PAD, width - PAD * 2, theme);

    ctx.fillStyle = theme.labelText;
    ctx.textBaseline = 'middle';
    let y = top + PAD * 2 + SPARK_HEIGHT + lineHeight / 2;
    for (const line of lines) {
      fillLine(ctx, line, left + PAD, left + width - PAD, y);
      y += lineHeight;
    }
  }

  /**
   * Outlines of the panes (solid) and of the axis columns, lanes and time axis
   * (dashed), and drawing hit regions shaded in the drawing colour, in plot
   * coordinates. `sample` gives the hit regions as `[x, y, width]` runs on a
   * grid of the step it gets; `resample` false reuses the last ones.
   */
  drawBounds(ctx: CanvasRenderingContext2D, box: OverlayBox, theme: ChartTheme, sample: (step: number) => number[], resample: boolean): void {
    const hitRuns = (this.hitRuns = resample || !this.hitRuns ? sample(HIT_REGION_STEP) : this.hitRuns);
    const { plotWidth, plotHeight, plotLeft, laneSpace: lanes } = box;
    const right = box.width - plotLeft;
    const outline = (x: number, y: number, w: number, h: number) => {
      if (w > 0 && h > 0) ctx.strokeRect(sharp(x), sharp(y), Math.round(w) - 1, Math.round(h) - 1);
    };
    ctx.save();
    ctx.fillStyle = withAlpha(theme.drawing, 0.25);
    for (let i = 0; i < hitRuns.length; i += 3) ctx.fillRect(hitRuns[i]!, hitRuns[i + 1]!, hitRuns[i + 2]!, HIT_REGION_STEP);
    ctx.strokeStyle = theme.crosshair;
    ctx.lineWidth = 1;
    for (const pane of box.panes) outline(0, pane.top, plotWidth, pane.height);
    ctx.setLineDash([4, 3]);
    outline(plotWidth, 0, lanes.right, plotHeight);
    outline(plotWidth + lanes.right, 0, right - plotWidth - lanes.right, plotHeight);
    outline(-lanes.left, 0, lanes.left, plotHeight);
    outline(-plotLeft, 0, plotLeft - lanes.left, plotHeight);
    outline(0, plotHeight, plotWidth, box.height - plotHeight);
    ctx.restore();
  }

  /** One bar per recorded frame, oldest on the left; frames over the 60 Hz budget use the theme's down colour. */
  #drawSparkline(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, theme: ChartTheme): void {
    let peak = BUDGET_MS * 1.5;
    for (let i = 0; i < this.#filled; i++) peak = Math.max(peak, this.#totals[i]!);
    const step = width / HISTORY;
    const barWidth = Math.max(1, step - 1);
    const first = (this.next - this.#filled + HISTORY) % HISTORY;
    for (let k = 0; k < this.#filled; k++) {
      const value = this.#totals[(first + k) % HISTORY]!;
      const h = Math.max(1, (value / peak) * SPARK_HEIGHT);
      ctx.fillStyle = value > BUDGET_MS ? theme.down : withAlpha(theme.labelText, 0.6);
      ctx.fillRect(x + (HISTORY - this.#filled + k) * step, y + SPARK_HEIGHT - h, barWidth, h);
    }
    const budgetY = sharp(y + SPARK_HEIGHT - (BUDGET_MS / peak) * SPARK_HEIGHT);
    ctx.strokeStyle = theme.separator;
    ctx.beginPath();
    ctx.moveTo(x, budgetY);
    ctx.lineTo(x + width, budgetY);
    ctx.stroke();
  }
}

/** The chart members the statistics read: TypeScript-private, so reached through this view. */
interface StatsChart extends OverlayBox {
  readonly options: ChartOptions;
  readonly renderer: RenderBackend;
  readonly capture: object | null;
  readonly cursorLayer: HTMLCanvasElement | null;
  readonly top: HTMLCanvasElement;
  readonly panes: readonly Pane[];
  readonly theme: ChartTheme;
  readonly drawingLayer: DrawingManager | null;
  ctx(canvas: HTMLCanvasElement): CanvasRenderingContext2D;
  emit(event: 'frame:render', stats: RenderStats): void;
}

/**
 * The render statistics of one chart (the `statsOverlay()` plugin): measures
 * each frame while the `renderStats` or `renderStatsOverlay` option is on,
 * reports it as `chart.frameStats` and `frame:render`, and draws the
 * `renderStatsOverlay` display. While both are off, frames cost a check.
 */
export class FrameStats implements FrameObserver {
  readonly #chart: StatsChart;
  #clock: FrameClock | null = null;
  #counters: FrameCounters | null = null;
  /** What asked for the next frame, as `RedrawReason` bits. */
  #reasons = 0;
  #last: RenderStats | null = null;
  /** The `renderStatsOverlay` display and its frame history; null while the option is off. */
  #hud: StatsOverlay | null = null;

  constructor(chart: Chart) {
    this.#chart = chart as unknown as StatsChart;
  }

  get #on(): boolean {
    const { renderStats, renderStatsOverlay } = this.#chart.options;
    return renderStats || Boolean(renderStatsOverlay);
  }

  /** The last frame's statistics; null while they are off. */
  last(): RenderStats | null {
    return this.#on ? this.#last : null;
  }

  request(reason: RedrawReason): void {
    if (this.#on) this.#reasons |= reasonBit(reason);
    else this.stop();
  }

  start(): void {
    // Nothing allocates or reads the clock unless statistics are on.
    if (!this.#on) return this.stop();
    const renderer = this.#chart.renderer;
    // The renderer makes its GPU timer on first use.
    if (renderer instanceof GLRenderer) renderer.makeTimer = GpuTimer.create;
    renderer.counters = this.#counters = zeroCounters();
    this.#clock = new FrameClock();
  }

  lap(phase: FramePhase | null): void {
    const clock = this.#clock;
    if (!clock) return;
    if (!phase) return clock.skip();
    clock.lap(phase);
    if (phase !== 'drawCursor') return;
    clock.finish();
    this.#chart.renderer.counters = null;
  }

  end(kind: RenderStats['kind']): void {
    const clock = this.#clock;
    if (!clock || !this.#counters) return;
    this.#clock = null;
    const c = this.#chart;
    const stats = (this.#last = { kind, ...this.#counters, times: clock.times, reasons: reasonsOf(this.#reasons), gpuTime: c.renderer.gpuTime(), memory: c.renderer.gpuMemory() });
    this.#reasons = 0;
    // Not timed, and never in a screenshot.
    if (!c.options.renderStatsOverlay) this.#hud = null;
    else if (!c.capture) this.#draw(stats);
    c.emit('frame:render', stats);
  }

  /** Statistics are off or the plugin goes: forget them and stop GPU timing. */
  stop(): void {
    this.#reasons = 0;
    if (!this.#last) return;
    this.#last = this.#hud = null;
    this.#chart.renderer.stopTiming();
  }

  /**
   * The display, in the bottom-left corner of the lowest pane, over the layer
   * the frame drew last: the crosshair layer, which every frame redraws, or on
   * static charts the overlay. Drawn after the frame's statistics are taken,
   * so it never counts itself.
   */
  #draw(stats: RenderStats): void {
    const c = this.#chart;
    const hud = (this.#hud ??= new StatsOverlay());
    hud.record(stats);
    const ctx = c.ctx(c.cursorLayer ?? c.top);
    ctx.translate(c.plotLeft, 0);
    // Sampling every drawing is slow, so crosshair-only frames, which change no drawing, reuse the last runs.
    if (c.options.renderStatsOverlay === 'bounds') hud.drawBounds(ctx, c, c.theme, (step) => c.drawingLayer?.hitRuns(step) ?? [], stats.kind !== 'cursor');
    let pane: Pane | undefined;
    for (const p of c.panes) if (!p.collapsed && p.height > 0) pane = p;
    if (pane) hud.draw(ctx, pane, c.plotWidth, c.theme, resolveFont(c.theme, 'axis'));
  }
}
