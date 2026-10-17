import type { Bar, Time } from '../types';
import type { Pane } from '../pane';
import type { RenderBackend } from '../gl/backend';
import { RectBatch } from '../gl/rect-batch';
import { Series, yUniforms, type CandleSeries, type LegendEntry, type PaneEnv, type SeriesHost } from '../series';
import { parseColor, type Rgba } from '../util/color';
import { VolumeProfile, checkRowOptions, computeVolumeProfile, onScreenRows, screenRows } from './math';
import { bisect } from '../util/search';
import { clampNum, sharp } from '../util/math';

/** `'visible'`: one profile for the bars on screen. `'session'`: one profile per session. */
export type VolumeProfileRange = 'visible' | 'session';

/**
 * Options for a volume profile series (`chart.addVolumeProfile`): one profile
 * for the visible bars or one per session, its rows, width and placement, the
 * value area, its lines and colours.
 */
export interface VolumeProfileOptions {
  title: string;
  /** `false` leaves this series out of the legend. Default true. */
  legend?: boolean;
  range: VolumeProfileRange;
  /**
   * Rows across each profile's price range; ignored when `rowSize` is set.
   * Unset (the default), the visible-range profile has one row per 10 css px
   * of its height, the default bar spacing, so rows stay readable at any zoom.
   * Session profiles, computed once, follow their bar count instead (see
   * `ProfileRowOptions.rows`).
   */
  rows?: number;
  /** Fixed row height in price units. Rows then align to multiples of it. */
  rowSize?: number;
  /**
   * Length of the fullest row: a fraction of the plot width for the visible
   * range, or of the session width for sessions. Default 0.5: the fullest row
   * ends at the middle, so the bars stay readable on the other half.
   */
  width?: number;
  /**
   * Edge the rows grow from: the plot edge for the visible range (default
   * right), or the session edge for sessions (default left).
   */
  placement?: 'left' | 'right';
  /** Share of the volume inside the value area, in percent. */
  valueArea: number;
  /**
   * Session id of a bar time; consecutive bars with the same id share one
   * session profile. Defaults to the UTC calendar day (`utcDaySession`).
   */
  sessionOf: (time: Time) => number;
  /** Minimum time between recomputes while the view or the live bar changes (ms). */
  throttleMs: number;
  /** Row opacity inside the value area; rows outside it are fainter. */
  opacity: number;
  pocLine: boolean;
  valueAreaLines: boolean;
  /** Row colour when bars carry no buy/sell split. Defaults to theme.line. */
  color?: string;
  /** Buy-side rows. Defaults to theme.up. */
  upColor?: string;
  /** Sell-side rows. Defaults to theme.down. */
  downColor?: string;
  /** Point-of-control line. Defaults to theme.text. */
  pocColor?: string;
  /** Value-area high/low lines. Defaults to theme.textMuted. */
  valueAreaColor?: string;
}

/** Default `sessionOf`: the UTC calendar day of a bar time. */
export function utcDaySession(time: Time): number {
  return Math.floor(time / 86400);
}

const DEFAULTS: VolumeProfileOptions = {
  title: 'Volume profile',
  range: 'visible',
  valueArea: 70,
  sessionOf: utcDaySession,
  throttleMs: 50,
  opacity: 0.5,
  pocLine: true,
  valueAreaLines: true,
};

/** Rows outside the value area are drawn at this fraction of `opacity`. */
const OUTSIDE_VALUE_AREA = 0.45;
/** Spans written per row at most: buy, sell, and volume from bars without a split. */
const SPANS_PER_ROW = 3;
const NO_BARS: readonly Bar[] = [];

/** One computed profile: bars [from, to), its batch instances and key prices (NaN when empty). */
interface ProfileSpan {
  from: number;
  to: number;
  first: number;
  count: number;
  poc: number;
  vah: number;
  val: number;
}

interface Palette {
  row: Rgba;
  rowOut: Rgba;
  up: Rgba;
  upOut: Rgba;
  down: Rgba;
  downOut: Rgba;
}

/**
 * Volume-by-price histogram built from the main candle series. Rows are GPU
 * spans; POC and value-area lines are drawn on the overlay. The visible-range
 * profile is recomputed (throttled) when the bars on screen change; session
 * profiles are computed once and only the last session follows live bars.
 */
export class VolumeProfileSeries extends Series<VolumeProfileOptions> {
  readonly kind = 'volumeProfile';
  readonly batch = new RectBatch();
  readonly #profile = new VolumeProfile();
  #spans: ProfileSpan[] = [];
  #palette!: Palette;
  /** Options or theme changed: recompute everything without throttling. */
  #dirty = true;
  #seenData: readonly Bar[] | null = null;
  #seenLength = 0;
  #seenLast: Bar | undefined;
  #seenFrom = -1;
  #seenTo = -1;
  #computedAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Removed from the chart: no more redraw timers. */
  #disposed = false;

  constructor(
    host: SeriesHost,
    pane: Pane,
    options: Partial<VolumeProfileOptions>,
    private readonly source: () => CandleSeries | null,
  ) {
    super(host, pane, checkRowOptions({ ...DEFAULTS, ...options }));
  }

  override applyOptions(partial: Partial<VolumeProfileOptions>): void {
    checkRowOptions({ ...this.options, ...partial }); // throw before changing anything
    super.applyOptions(partial);
  }

  get #widthFraction(): number {
    return this.options.width ?? 0.5;
  }

  private get placement(): 'left' | 'right' {
    return this.options.placement ?? (this.options.range === 'visible' ? 'right' : 'left');
  }

  get #pocColor(): string {
    return this.options.pocColor ?? this.host.theme.text;
  }

  get #valueAreaColor(): string {
    return this.options.valueAreaColor ?? this.host.theme.textMuted;
  }

  rebuild(): void {
    const o = this.options;
    const t = this.host.theme;
    const tint = (color: string, inside: boolean): Rgba => {
      const [r, g, b, a] = parseColor(color);
      const alpha = clampNum(inside ? o.opacity : o.opacity * OUTSIDE_VALUE_AREA, 0, 1);
      return [r, g, b, Math.round(a * alpha)];
    };
    const row = o.color ?? t.line;
    const up = o.upColor ?? t.up;
    const down = o.downColor ?? t.down;
    this.#palette = {
      row: tint(row, true),
      rowOut: tint(row, false),
      up: tint(up, true),
      upOut: tint(up, false),
      down: tint(down, true),
      downOut: tint(down, false),
    };
    this.#dirty = true;
  }

  override realign(): void {
    // Main data changes are picked up in `sync`, which can update just the last session.
  }

  override drawGL(r: RenderBackend, env: PaneEnv): void {
    this.#sync(env);
    const visible = this.options.range === 'visible';
    const [a, b] = visible ? [0, this.#spans.length] : this.#spanRange(env.from, env.to);
    if (a >= b) return;
    const first = this.#spans[a]!.first;
    const last = this.#spans[b - 1]!;
    let x = env.time.xTransform();
    if (visible) {
      // Visible-range rows are written in 0..1 of the profile width from the anchored edge.
      const w = this.#widthFraction * env.width;
      x = this.placement === 'right' ? [-w, env.width] : [w, 0];
    }
    r.drawSpans(this.batch, first, last.first + last.count - first, {
      x,
      ...yUniforms(this.scale, this.batch.base),
      gap: Math.max(1, Math.floor(env.dpr)),
    });
  }

  override draw2D(ctx: CanvasRenderingContext2D, env: PaneEnv): void {
    const o = this.options;
    if (!o.pocLine && !o.valueAreaLines) return;
    const visible = o.range === 'visible';
    const [a, b] = visible ? [0, this.#spans.length] : this.#spanRange(env.from, env.to);
    if (a >= b) return;
    const w = this.#widthFraction * env.width;
    const boxLeft = this.placement === 'right' ? env.width - w : 0;
    const scale = this.scale;
    const segment = (x0: number, x1: number, price: number) => {
      if (Number.isNaN(price)) return;
      const y = sharp(scale.priceToY(price));
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    };
    // Lines span the profile box (visible range) or the whole session.
    const stroke = (color: string, dash: number[], poc: boolean) => {
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      ctx.beginPath();
      for (let i = a; i < b; i++) {
        const s = this.#spans[i]!;
        const x0 = visible ? boxLeft : env.time.indexToX(s.from - 0.5);
        const x1 = visible ? boxLeft + w : env.time.indexToX(s.to - 0.5);
        if (poc) segment(x0, x1, s.poc);
        else {
          segment(x0, x1, s.vah);
          segment(x0, x1, s.val);
        }
      }
      ctx.stroke();
    };
    ctx.save();
    ctx.lineWidth = 1;
    if (o.valueAreaLines) stroke(this.#valueAreaColor, [4, 3], false);
    if (o.pocLine) stroke(this.#pocColor, [], true);
    ctx.restore();
  }

  override legend(index: number): LegendEntry {
    const title = this.options.title;
    const span = this.options.range === 'visible' ? this.#spans[0] : this.#spanAt(index);
    if (!span || Number.isNaN(span.poc)) return { title, parts: [] };
    const fmt = this.source()?.format ?? ((v: number) => v.toFixed(2));
    return {
      title,
      parts: [
        { label: this.locale.text('legendPoc'), text: fmt(span.poc), color: this.#pocColor },
        { label: this.locale.text('legendVah'), text: fmt(span.vah) },
        { label: this.locale.text('legendVal'), text: fmt(span.val) },
      ],
    };
  }

  /**
   * Recompute when the data, the visible bars or the options changed. Option
   * changes and replaced data apply at once; view changes and live bars are
   * throttled, with a timer so the last change is never dropped.
   */
  #sync(env: PaneEnv): void {
    const data = this.source()?.data ?? NO_BARS;
    const n = data.length;
    const last = data[n - 1];
    const visible = this.options.range === 'visible';
    const from = visible ? Math.max(0, env.from) : 0;
    const to = visible ? Math.min(env.to, n - 1) : n - 1;
    const replaced = data !== this.#seenData || n < this.#seenLength;
    // Live updates only touch bars from the previous last one on.
    const touched = (n !== this.#seenLength || last !== this.#seenLast) && to >= this.#seenLength - 1;
    const moved = visible && (from !== this.#seenFrom || to !== this.#seenTo || (this.#auto && screenRows(this.#profile, (v) => this.scale.priceToY(v)) !== this.#profile.rows));
    if (!this.#dirty && !replaced && !touched && !moved) return;
    if (!this.#dirty && !replaced) {
      const wait = this.#computedAt + this.options.throttleMs - performance.now();
      if (wait > 0) {
        this.#later(wait);
        return;
      }
    }
    const incremental = !this.#dirty && !replaced;
    this.#dirty = false;
    this.#seenData = data;
    this.#seenLength = n;
    this.#seenLast = last;
    this.#seenFrom = from;
    this.#seenTo = to;
    this.#computedAt = performance.now();
    if (visible) this.#computeVisible(data, from, to + 1);
    else this.#computeSessions(data, incremental);
  }

  override dispose(): void {
    this.#disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.host.releaseGpu?.(this.batch);
  }

  /** Request a redraw once the throttle window has passed. */
  #later(wait: number): void {
    if (this.timer !== undefined || this.#disposed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.pane.series.includes(this)) this.host.requestRender();
    }, wait);
  }

  /** Neither `rows` nor `rowSize` is set: the visible-range profile sizes its rows by its height on screen. */
  get #auto(): boolean {
    return this.options.rows === undefined && this.options.rowSize === undefined;
  }

  #computeVisible(data: readonly Bar[], from: number, to: number): void {
    const o = this.options;
    const layout = (rows = o.rows) => computeVolumeProfile(data, from, to, { ...o, rows }, this.#profile);
    // Automatic rows start from the last count.
    const p = this.#auto ? onScreenRows(layout, this.#profile.rows || 1, (v) => this.scale.priceToY(v)) : layout();
    this.batch.base = p.start;
    this.batch.resize(p.rows * SPANS_PER_ROW);
    const count = this.#writeRows(p, 0, 0, 1);
    this.batch.resize(count);
    this.#spans.length = 0;
    if (from < to) this.#spans.push(this.#span(p, from, to, 0, count));
  }

  #computeSessions(data: readonly Bar[], incremental: boolean): void {
    const spans = this.#spans;
    let from = 0;
    let first = 0;
    if (incremental && spans.length > 0) {
      // Only the newest bars changed: redo the last session and anything after it.
      const tail = spans.pop()!;
      from = tail.from;
      first = tail.first;
    } else {
      spans.length = 0;
      this.batch.base = data[0]?.low ?? 0;
    }
    const n = data.length;
    const sessionOf = this.options.sessionOf;
    const right = this.placement === 'right';
    const extent = right ? -this.#widthFraction : this.#widthFraction;
    let id = from < n ? sessionOf(data[from]!.time) : 0;
    while (from < n) {
      let to = from + 1;
      let next = id;
      while (to < n && (next = sessionOf(data[to]!.time)) === id) to++;
      const p = computeVolumeProfile(data, from, to, this.options, this.#profile);
      this.batch.resize(first + p.rows * SPANS_PER_ROW);
      // Session rows are written in bar-index units, from the session's edge.
      // Each session stores its ends from its own edge bar, keeping them exact in float32.
      const count = this.#writeRows(p, first, right ? to - 0.5 : from - 0.5, extent * (to - from), right ? to : from);
      spans.push(this.#span(p, from, to, first, count));
      first += count;
      from = to;
      id = next;
    }
    this.batch.resize(first);
  }

  /**
   * Write a profile's rows as spans starting at x = `origin`, the fullest row
   * `extent` long (negative grows left). Buy volume sits nearest the origin,
   * then sell, then volume from bars without a split. Ends are stored relative
   * to the integer `base` (see `RectBatch.setSpan`). Returns the span count.
   */
  #writeRows(p: VolumeProfile, at: number, origin: number, extent: number, base = 0): number {
    if (!(p.maxVolume > 0)) return 0;
    const c = this.#palette;
    const batch = this.batch;
    const scale = extent / p.maxVolume;
    let k = at;
    for (let r = 0; r < p.rows; r++) {
      const v = p.volume[r]!;
      if (!(v > 0)) continue;
      const inside = r >= p.valueAreaLow && r <= p.valueAreaHigh;
      const lo = p.rowLow(r);
      const hi = p.rowHigh(r);
      const end = origin + v * scale;
      if (!p.hasBuySell) {
        batch.setSpan(k++, origin, end, lo, hi, inside ? c.row : c.rowOut, base);
        continue;
      }
      const buy = p.buy[r]!;
      const sell = p.sell[r]!;
      const buyEnd = origin + buy * scale;
      const sellEnd = buyEnd + sell * scale;
      if (buy > 0) batch.setSpan(k++, origin, buyEnd, lo, hi, inside ? c.up : c.upOut, base);
      if (sell > 0) batch.setSpan(k++, buyEnd, sellEnd, lo, hi, inside ? c.down : c.downOut, base);
      if (v - buy - sell > v * 1e-9) batch.setSpan(k++, sellEnd, end, lo, hi, inside ? c.row : c.rowOut, base);
    }
    return k - at;
  }

  #span(p: VolumeProfile, from: number, to: number, first: number, count: number): ProfileSpan {
    const empty = p.poc < 0;
    return {
      from,
      to,
      first,
      count,
      poc: empty ? NaN : p.rowPrice(p.poc),
      vah: empty ? NaN : p.rowHigh(p.valueAreaHigh),
      val: empty ? NaN : p.rowLow(p.valueAreaLow),
    };
  }

  /** Positions [a, b) of the session spans overlapping logical indices [from, to]. */
  #spanRange(from: number, to: number): [number, number] {
    const s = this.#spans;
    const lo = bisect(s.length, (i) => s[i]!.to <= from);
    let end = lo;
    while (end < s.length && s[end]!.from <= to) end++;
    return [lo, end];
  }

  #spanAt(index: number): ProfileSpan | undefined {
    const [a, b] = this.#spanRange(index, index);
    return a < b ? this.#spans[a] : undefined;
  }
}
