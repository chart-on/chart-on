import type { RenderBackend } from './gl/backend';
import { LineBatch } from './gl/line-batch';
import { RectBatch } from './gl/rect-batch';
import { BoxGlyph, type GpuOwner } from './gl/renderer';
import { SIMPLE_LINE, barRgba, strokeGpu, yUniforms, type Alignment, type CandleSeries, type CandleStyle, type PaneEnv, type PriceStyleDrawer } from './series';
import type { Bar } from './types';
import { parseColor } from './util/color';

// The candle styles for price-based bars (see `priceBars`), each drawn on the GPU by its own
// renderer: `kagi` as a line, `pointFigure` as columns of X and O boxes. The `priceStyles()`
// plugin gives a chart these drawers, so a chart without it leaves this code out.

/** Kagi line widths as a multiple of `lineWidth`: thick (yang) and thin (yin). */
const KAGI_YANG_WIDTH = 1.5;
const KAGI_YIN_WIDTH = 0.5;

/**
 * Point & figure boxes or columns narrower or shorter than this (css px) are
 * filled instead of drawn as X and O glyphs, which would not read anyway.
 */
const MIN_GLYPH_PX = 3;

/** Points of one kagi line thickness: (timeline index, price), with NaN prices where the line breaks. */
export interface KagiRun {
  index: number[];
  value: number[];
}

/**
 * The kagi line through `n` bars (see `priceBars` with `type: 'kagi'`): each
 * bar a vertical stretch from its open to its close at `indexAt(k)`, joined
 * to the next bar by a horizontal step at its close. The line is thick (yang)
 * from where it rises above the last shoulder and thin (yin) from where it
 * falls below the last waist; it starts thick when the first stretch rises.
 * Every turn of the line makes a shoulder (the top of a rising stretch) or a
 * waist (the bottom of a falling one), thick or thin, and the most recent one
 * is the level to break: a thin rally that fails below the old shoulder sets
 * a lower shoulder, and the next rally above it turns the line thick.
 * Returns the thick and thin parts.
 * @internal
 */
export function kagiLines(n: number, indexAt: (k: number) => number, barAt: (k: number) => Bar): { yang: KagiRun; yin: KagiRun } {
  const yang: KagiRun = { index: [], value: [] };
  const yin: KagiRun = { index: [], value: [] };
  let thick = false;
  let drawn: boolean | null = null;
  let shoulder = NaN;
  let waist = NaN;
  const segment = (state: boolean, x0: number, y0: number, x1: number, y1: number) => {
    if (x0 === x1 && y0 === y1) return;
    const run = state ? yang : yin;
    if (drawn !== state) {
      // A new run of this thickness: break it off from its previous run.
      if (run.index.length > 0) {
        run.index.push(x0);
        run.value.push(NaN);
      }
      run.index.push(x0);
      run.value.push(y0);
    }
    run.index.push(x1);
    run.value.push(y1);
    drawn = state;
  };
  let px = NaN;
  let py = NaN;
  for (let k = 0; k < n; k++) {
    const { open, close } = barAt(k);
    const x = indexAt(k);
    const rising = close > open;
    if (k === 0) thick = rising;
    else {
      segment(thick, px, py, x, py);
      segment(thick, x, py, x, open);
    }
    let y = open;
    if (rising && !thick && close > shoulder) {
      y = Math.max(open, shoulder);
      segment(false, x, open, x, y);
      thick = true;
    } else if (close < open && thick && close < waist) {
      y = Math.min(open, waist);
      segment(true, x, open, x, y);
      thick = false;
    }
    segment(thick, x, y, x, close);
    if (rising) shoulder = close;
    else if (close < open) waist = close;
    px = x;
    py = close;
  }
  return { yang, yin };
}

/** @internal The `kagi` and `pointFigure` styles of one candle series, with the GPU objects they draw. */
export class PriceStyles implements PriceStyleDrawer {
  /** The thick (yang) and thin (yin) parts of the `kagi` style's line. */
  readonly kagi = { yang: new LineBatch(), yin: new LineBatch() };
  /** The boxes of the `pointFigure` style in view, written each frame. */
  readonly boxes = new RectBatch();
  /** Direction of each aligned point & figure column: 1 X boxes, -1 O boxes. */
  #boxDir = new Int8Array(64);
  /** The box size read from bars that carry none, and the bars it was read from. */
  #derivedBox = NaN;
  #boxBars: readonly Bar[] | null = null;
  #boxCount = -1;
  #boxLast: Bar | undefined = undefined;
  /** Nothing is built yet: the first draw builds from the first bar, whatever changed before. */
  #fresh = true;

  constructor(
    readonly series: CandleSeries,
    readonly release: (owner: GpuOwner) => void,
  ) {}

  draw(r: RenderBackend, env: PaneEnv, style: CandleStyle, from: number, align: Alignment, display: readonly Bar[]): void {
    this.keep(style);
    if (this.#fresh) {
      from = 0;
      this.#fresh = false;
    }
    if (style === 'kagi') this.#drawKagi(r, env, from, align, display);
    else this.#drawBoxes(r, env, from, align, display);
  }

  keep(style: CandleStyle | null): void {
    const { yang, yin } = this.kagi;
    if (style !== 'kagi') for (const batch of [yang, yin]) if (batch.gpu) this.release(batch);
    if (style !== 'pointFigure' && this.boxes.gpu) this.release(this.boxes);
  }

  /**
   * The `kagi` style: the thin parts of the line, then the thick ones, each
   * with mitred corners. Every bar is drawn, grouped or not: the line has
   * one vertical stretch per bar. `from` is the first aligned bar that
   * changed since the last frame (Infinity: none).
   */
  #drawKagi(r: RenderBackend, env: PaneEnv, from: number, align: Alignment, display: readonly Bar[]): void {
    const { yang, yin } = this.kagi;
    if (from < Infinity || yang.shape === null) {
      const lines = kagiLines(align.count, (k) => align.index[k]!, (k) => display[align.source[k]!]!);
      for (const [batch, run] of [
        [yang, lines.yang],
        [yin, lines.yin],
      ] as const) {
        batch.build(run.index.length, (k) => run.index[k]!, (k) => run.value[k]!, SIMPLE_LINE);
      }
    }
    const series = this.series;
    const w = series.options.lineWidth;
    const scale = series.scale;
    strokeGpu(r, env, scale, yin, 1, yin.count - 1, 1, { color: series.downColor, lineWidth: Math.max(1, w * KAGI_YIN_WIDTH), step: true });
    strokeGpu(r, env, scale, yang, 1, yang.count - 1, 1, { color: series.upColor, lineWidth: Math.max(1, w * KAGI_YANG_WIDTH), step: true });
  }

  pad(): number {
    return this.#pointFigureBox() / 2;
  }

  /**
   * The box size of the `pointFigure` style: the `boxSize` option, else the
   * size the bars were built with (`PriceBar.boxSize`). Bars made elsewhere
   * carry none; then the smallest step from one column's close to the next
   * column's open, else the first column's height, else a hundredth of the
   * last close.
   */
  #pointFigureBox(): number {
    const usable = (v: unknown): v is number => typeof v === 'number' && v > 0 && Number.isFinite(v);
    const set = this.series.options.boxSize;
    if (usable(set)) return set;
    const data = this.series.data;
    const own = (data[data.length - 1] as { boxSize?: unknown } | undefined)?.boxSize;
    if (usable(own)) return own;
    if (data === this.#boxBars && data.length === this.#boxCount && data[data.length - 1] === this.#boxLast) return this.#derivedBox;
    this.#boxBars = data;
    this.#boxCount = data.length;
    this.#boxLast = data[data.length - 1];
    let box = Infinity;
    for (let i = 1; i < data.length; i++) {
      const step = Math.abs(data[i]!.open - data[i - 1]!.close);
      if (step > 0 && step < box) box = step;
    }
    if (box === Infinity) {
      const first = data[0];
      box = first && first.high > first.low ? first.high - first.low : Math.abs(data[data.length - 1]?.close ?? 0) / 100;
    }
    return (this.#derivedBox = usable(box) ? box : 1);
  }

  /**
   * The `pointFigure` style: an X for every box of a rising column and an O
   * for every box of a falling one, from the open to the close. A one-box
   * column turns from the column before it (the first one rises). Only the
   * boxes in view are written, each frame, so the work follows the screen,
   * not the data: a column whose boxes (or width) are too small for a glyph
   * is one filled span. `from` is the first aligned bar that changed since
   * the last frame (Infinity: none), for the column directions.
   */
  #drawBoxes(r: RenderBackend, env: PaneEnv, from: number, align: Alignment, display: readonly Bar[]): void {
    if (from < Infinity) this.#writeDirections(from, align, display);
    const series = this.series;
    const box = this.#pointFigureBox();
    const scale = series.scale;
    const [a, b] = align.range(env.from - 1, env.to + 1);
    // The prices in view, a box beyond either edge.
    const edgeA = scale.yToPrice(0);
    const edgeB = scale.yToPrice(env.height);
    const top = Math.max(edgeA, edgeB) + box;
    const bottom = Math.min(edgeA, edgeB) - box;
    const narrow = env.time.barSpacing * series.options.bodyRatio < MIN_GLYPH_PX;
    const colors = [parseColor(series.upColor), parseColor(series.downColor)] as const;
    const batch = this.boxes;
    batch.indexBase = 0;
    batch.base = a < b ? display[align.source[a]!]!.close : 0;
    batch.markAllDirty();
    let c = 0;
    for (let k = a; k < b; k++) {
      const src = align.source[k]!;
      const bar = display[src]!;
      const low = Math.min(bar.open, bar.close);
      const count = Math.round(Math.abs(bar.close - bar.open) / box) + 1;
      // Boxes ja to jb of the column are in view.
      const ja = Math.max(0, Math.floor((bottom - low) / box));
      const jb = Math.min(count - 1, Math.ceil((top - low) / box));
      if (jb < ja) continue;
      const dir = this.#boxDir[k]!;
      const color = barRgba(series.data[src]!.color) ?? colors[dir === 1 ? 0 : 1];
      const index = align.index[k]!;
      const high = low + jb * box;
      // The top box is the shortest on a log scale.
      if (narrow || Math.abs(scale.priceToY(high + box / 2) - scale.priceToY(high - box / 2)) < MIN_GLYPH_PX) {
        batch.resize(c + 1);
        batch.set(c++, index, low + ja * box - box / 2, high + box / 2, BoxGlyph.fill, color);
        continue;
      }
      batch.resize(c + jb - ja + 1);
      const glyph = dir === 1 ? BoxGlyph.x : BoxGlyph.o;
      for (let j = ja; j <= jb; j++) {
        // Each middle from the column's low, not from the box before, so no error builds up.
        const mid = low + j * box;
        batch.set(c++, index, mid - box / 2, mid + box / 2, glyph, color);
      }
    }
    batch.resize(c);
    r.drawBoxes(batch, 0, c, {
      x: env.time.xTransform(),
      ...yUniforms(scale, batch.base),
      ratio: series.options.bodyRatio,
    });
  }

  /** The direction of each point & figure column from aligned bar `from` on. */
  #writeDirections(from: number, align: Alignment, display: readonly Bar[]): void {
    const n = align.count;
    from = Math.min(from, n);
    if (this.#boxDir.length < n) {
      const dir = new Int8Array(Math.max(n, this.#boxDir.length * 2));
      dir.set(this.#boxDir.subarray(0, from));
      this.#boxDir = dir;
    }
    for (let k = from; k < n; k++) {
      const bar = display[align.source[k]!]!;
      this.#boxDir[k] = bar.close > bar.open ? 1 : bar.close < bar.open ? -1 : k > 0 ? -this.#boxDir[k - 1]! || 1 : 1;
    }
  }
}
