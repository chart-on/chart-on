import type { ChartTheme } from './theme';
import type { Pane } from './pane';
import type { PriceScale, TimeScale } from './scales';
import type { CandleSeries, LastValue } from './series';
import type { Timeline } from './timeline';
import type { Bar } from './types';
import type { LineStyle } from './annotations/types';
import { contrastText } from './util/color';
import { inSession, sessionIntervals, tradingDay, type CompiledSession } from './util/session';
import type { Zone } from './util/timezone';
import type { MarketPhase } from './util/market';
import type { PriceFormatModel } from './util/price-format';
import { isNumber } from './util/records';
import { sharp } from './util/math';
import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** The built-in reference lines of the main series. */
export type ReferenceLineKind = 'previousClose' | 'high' | 'low' | 'average' | 'bid' | 'ask' | 'extendedHours';

/** Look of one reference line: visibility, colour, stroke, axis label and tag. */
export interface ReferenceLineOptions {
  /** Draw the line (and its label). Every reference line is off by default. */
  visible: boolean;
  /** Line and label colour; defaults to the line's theme token (pass undefined to return to it). */
  color?: string;
  lineStyle: LineStyle;
  lineWidth: number;
  /** Price label on the price axis. */
  axisLabel: boolean;
  /** Short tag beside the axis label; empty for none. */
  title: string;
}

/** The newest price outside the regular session; `title` tags pre-session prices, `postTitle` post-session ones. */
export interface ExtendedHoursLineOptions extends ReferenceLineOptions {
  postTitle: string;
}

/** Options of every reference line of the main series, by kind: previous close, visible high, low and average, bid, ask and extended hours. */
export interface ReferenceLinesOptions {
  /** Close of the previous trading day (the previous bar on daily and longer bars). */
  previousClose: ReferenceLineOptions;
  /** Highest high of the visible bars. */
  high: ReferenceLineOptions;
  /** Lowest low of the visible bars. */
  low: ReferenceLineOptions;
  /** Average close of the visible bars. */
  average: ReferenceLineOptions;
  /** Best bid of the latest quote (`setQuote` or the data source). */
  bid: ReferenceLineOptions;
  /** Best ask of the latest quote. */
  ask: ReferenceLineOptions;
  /**
   * Newest price while the newest bar is outside the chart's `session`. The
   * main last-price label then shows the regular-session close instead.
   */
  extendedHours: ExtendedHoursLineOptions;
}

/** Deep-partial update for `applyOptions`. */
export type ReferenceLinesUpdate = { [K in ReferenceLineKind]?: Partial<ReferenceLinesOptions[K]> };

/** Bid and ask prices; a missing side hides its line. */
export interface Quote {
  bid?: number;
  ask?: number;
}

/** Market phase of the newest bar: inside the session (`open`), or extended hours before (`pre`) or after (`post`) it. */
export type SessionPhase = Exclude<MarketPhase, 'closed'>;

const line = (title: string, lineStyle: LineStyle = 'dashed'): ReferenceLineOptions => ({
  visible: false,
  lineStyle,
  lineWidth: 1,
  axisLabel: true,
  title,
});

/** Default values for `ReferenceLinesOptions`: every line hidden, with short tags, dashed or dotted, and a price axis label. */
export const defaultReferenceLinesOptions: Readonly<ReferenceLinesOptions> = {
  previousClose: line('Prev'),
  high: line('High', 'dotted'),
  low: line('Low', 'dotted'),
  average: line('Avg', 'dotted'),
  bid: line('Bid'),
  ask: line('Ask'),
  extendedHours: { ...line('Pre'), postTitle: 'Post' },
};

const KINDS: readonly ReferenceLineKind[] = ['previousClose', 'high', 'low', 'average', 'bid', 'ask', 'extendedHours'];
const STYLES: readonly LineStyle[] = ['solid', 'dashed', 'dotted'];
/** Dash patterns, allocated once. */
const DASHES: Readonly<Record<LineStyle, number[]>> = { solid: [], dashed: [6, 4], dotted: [1.5, 3] };

/** What the reference lines need from their chart. */
export interface ReferenceHost {
  readonly theme: ChartTheme;
  readonly timeline: Timeline;
  readonly time: TimeScale;
  readonly panes: readonly Pane[];
  /** The main candle series the lines describe. */
  readonly main: CandleSeries | null;
  /** Axis text for a price on a pane scale (percent change in percent mode). */
  formatAxis(pane: number, price: number, scaleId?: string): string;
  requestOverlay(): void;
}

/** One line's axis label; the same object is reused every frame. */
export interface ReferenceLabel {
  y: number;
  text: string;
  bg: string;
  fg: string;
  title?: string;
}

/** Per-line state reused across frames, so drawing allocates nothing once text and colours are cached. */
class Slot implements ReferenceLabel {
  price = NaN;
  y = 0;
  text = '';
  bg = '';
  fg = '';
  title = '';
  #textPrice = NaN;
  #textMode = '';
  #textBase = NaN;
  #textFormat: PriceFormatModel | null = null;

  constructor(readonly kind: ReferenceLineKind) {}

  /** Format only when the price, the scale's labelling or the main series' price format changed. */
  label(host: ReferenceHost, paneIndex: number, scale: PriceScale, format: PriceFormatModel): string {
    if (
      this.price !== this.#textPrice ||
      scale.mode !== this.#textMode ||
      scale.percentBase !== this.#textBase ||
      format !== this.#textFormat
    ) {
      this.#textPrice = this.price;
      this.#textMode = scale.mode;
      this.#textBase = scale.percentBase;
      this.#textFormat = format;
      this.text = host.formatAxis(paneIndex, this.price, scale.id);
    }
    return this.text;
  }

  paint(color: string): void {
    if (color === this.bg) return;
    this.bg = color;
    this.fg = contrastText(color);
  }
}

/**
 * Optional price lines of the main series: previous close, the visible high,
 * low and average close, bid and ask, and the newest extended-hours price.
 * Values are cached and recomputed only when the bars, the visible range or the
 * session change, so panning and live bars cost no per-frame allocations.
 */
export class ReferenceLines {
  readonly #opts: ReferenceLinesOptions = clone(defaultReferenceLinesOptions);
  readonly #slots = KINDS.map((kind) => new Slot(kind));
  #bid = NaN;
  #ask = NaN;
  // Cache keys.
  private data: readonly Bar[] | null = null;
  private count = -1;
  private last: Bar | undefined = undefined;
  #zone: Zone | null = null;
  #session: CompiledSession | null | undefined = undefined;
  private interval = 0;
  private from = -1;
  private to = -1;
  // Cached values.
  #prevClose = NaN;
  private high = NaN;
  private low = NaN;
  #avg = NaN;
  #phase: SessionPhase = 'open';
  #regularIndex = -1;
  readonly #regular: LastValue = { value: NaN, text: '', color: '' };
  #regularTextPrice = NaN;

  readonly #host: ReferenceHost;

  constructor(host: ReferenceHost) {
    this.#host = host;
  }

  /** The resolved options of every line; the same object, updated in place by `applyOptions`. */
  get options(): Readonly<ReferenceLinesOptions> {
    return this.#opts;
  }

  /** Merge option changes per line; throws on an unknown line or line style. */
  applyOptions(update: ReferenceLinesUpdate): void {
    checkReferenceLines(update);
    // Validated above, so nothing below throws: merge in place.
    for (const kind of KINDS) {
      const patch = update[kind];
      if (!patch) continue;
      Object.assign(this.#opts[kind], definedOnly(patch));
      // An explicit `color: undefined` goes back to the theme colour.
      if ('color' in patch && patch.color === undefined) delete this.#opts[kind].color;
    }
    this.#host.requestOverlay();
  }

  /** The latest bid and ask; null clears both. Non-finite prices are ignored. */
  setQuote(quote: Quote | null): void {
    const bid = finiteOr(quote?.bid);
    const ask = finiteOr(quote?.ask);
    if (Object.is(bid, this.#bid) && Object.is(ask, this.#ask)) return;
    this.#bid = bid;
    this.#ask = ask;
    this.#host.requestOverlay();
  }

  get quote(): Quote | null {
    if (Number.isNaN(this.#bid) && Number.isNaN(this.#ask)) return null;
    const q: Quote = {};
    if (!Number.isNaN(this.#bid)) q.bid = this.#bid;
    if (!Number.isNaN(this.#ask)) q.ask = this.#ask;
    return q;
  }

  /** Current price of a line whether or not it is visible; null when it has none. */
  value(kind: ReferenceLineKind): number | null {
    this.#sync();
    const v = this.#priceOf(kind);
    return Number.isNaN(v) ? null : v;
  }

  /** Phase of the newest main bar: always `open` without a session or on daily bars. */
  get sessionPhase(): SessionPhase {
    this.#sync();
    return this.#phase;
  }

  /**
   * The main series' last-value label: the regular-session close while the
   * newest bar is outside the session and the extended-hours line is on, else `last`.
   */
  mainLast(last: LastValue): LastValue {
    if (!this.#opts.extendedHours.visible) return last;
    this.#sync();
    const main = this.#host.main;
    // Displayed bars (Heikin Ashi applied), like the main label itself; the main series' indices are its data indices.
    const bar = main?.displayedBarAt(this.#regularIndex);
    if (!main || !bar || this.#phase === 'open') return last;
    const r = this.#regular;
    if (bar.close !== this.#regularTextPrice) {
      this.#regularTextPrice = bar.close;
      r.text = main.formatModel.format(bar.close);
    }
    r.value = bar.close;
    const prev = main.displayedBarAt(this.#regularIndex - 1)?.close ?? bar.open;
    r.color = bar.close >= prev ? main.upColor : main.downColor;
    return r;
  }

  /** Lines in `pane`, in pane-local coordinates (the caller clips and translates). */
  drawLines(ctx: CanvasRenderingContext2D, pane: Pane, width: number): void {
    const main = this.#host.main;
    if (!main || main.pane !== pane || !main.visible || !this.#anyVisible()) return;
    this.#sync();
    const scale = main.scale;
    let drew = false;
    for (const slot of this.#slots) {
      const o = this.#opts[slot.kind];
      if (!o.visible || !this.update(slot)) continue;
      const y = scale.priceToY(slot.price);
      if (!(y >= 0 && y <= pane.height)) continue;
      if (!drew) {
        ctx.save();
        drew = true;
      }
      const py = sharp(y);
      ctx.strokeStyle = slot.bg;
      ctx.lineWidth = o.lineWidth;
      ctx.setLineDash(DASHES[o.lineStyle]);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
      ctx.stroke();
    }
    if (drew) ctx.restore();
  }

  /** Hand each visible axis label of `pane` to `push`, with `y` in chart space. */
  labels(pane: Pane, push: (scale: PriceScale, label: ReferenceLabel) => void): void {
    const main = this.#host.main;
    if (!main || main.pane !== pane || !main.visible || !this.#anyVisible()) return;
    this.#sync();
    const scale = main.scale;
    const paneIndex = this.#host.panes.indexOf(pane);
    for (const slot of this.#slots) {
      const o = this.#opts[slot.kind];
      if (!o.visible || !o.axisLabel || !this.update(slot)) continue;
      slot.y = pane.top + scale.priceToY(slot.price);
      // Format models are cached per spec, so their identity changes only with the format.
      slot.label(this.#host, paneIndex, scale, main.formatModel);
      push(scale, slot);
    }
  }

  /* ----------------------------- internals ----------------------------- */

  #anyVisible(): boolean {
    for (const kind of KINDS) if (this.#opts[kind].visible) return true;
    return false;
  }

  #priceOf(kind: ReferenceLineKind): number {
    switch (kind) {
      case 'previousClose':
        return this.#prevClose;
      case 'high':
        return this.high;
      case 'low':
        return this.low;
      case 'average':
        return this.#avg;
      case 'bid':
        return this.#bid;
      case 'ask':
        return this.#ask;
      case 'extendedHours': {
        const data = this.#host.main?.data;
        const bar = data?.[data.length - 1];
        return this.#phase !== 'open' && bar ? bar.close : NaN;
      }
    }
  }

  /** Refresh a slot's price, colour and title; false when the line has no price now. */
  private update(slot: Slot): boolean {
    const price = this.#priceOf(slot.kind);
    if (Number.isNaN(price)) return false;
    const o = this.#opts[slot.kind];
    slot.price = price;
    slot.paint(o.color ?? this.#themeColor(slot.kind));
    slot.title = slot.kind === 'extendedHours' && this.#phase === 'post' ? this.#opts.extendedHours.postTitle : o.title;
    return true;
  }

  #themeColor(kind: ReferenceLineKind): string {
    const t = this.#host.theme;
    if (kind === 'bid') return t.bid;
    if (kind === 'ask') return t.ask;
    if (kind === 'extendedHours') return t.extendedHours;
    return t.referenceLine;
  }

  /** Recompute what changed since the last call: day-level values on new bars, range values on pan. */
  #sync(): void {
    const main = this.#host.main;
    const tl = this.#host.timeline;
    const data = main?.data ?? EMPTY;
    const n = data.length;
    const last = data[n - 1];
    const barsChanged =
      data !== this.data ||
      n !== this.count ||
      last !== this.last ||
      tl.zone !== this.#zone ||
      tl.session !== this.#session ||
      tl.interval !== this.interval;
    if (barsChanged) {
      const newBar = data !== this.data || n !== this.count || last?.time !== this.last?.time;
      const zoneChanged = tl.zone !== this.#zone || tl.session !== this.#session || tl.interval !== this.interval;
      this.data = data;
      this.count = n;
      this.last = last;
      this.#zone = tl.zone;
      this.#session = tl.session;
      this.interval = tl.interval;
      // A tick on the forming bar changes neither the previous day nor the session phase.
      if (newBar || zoneChanged) this.#sessionValues(data);
    }
    const t = this.#host.time;
    const from = Math.max(0, Math.floor(t.xToIndex(0)));
    const to = Math.min(n - 1, Math.ceil(t.xToIndex(t.width)));
    if (barsChanged || from !== this.from || to !== this.to) {
      this.from = from;
      this.to = to;
      this.rangeValues(data, from, to);
    }
  }

  private rangeValues(data: readonly Bar[], from: number, to: number): void {
    let high = -Infinity;
    let low = Infinity;
    let sum = 0;
    for (let i = from; i <= to; i++) {
      const b = data[i]!;
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      sum += b.close;
    }
    const count = to - from + 1;
    this.high = count > 0 ? high : NaN;
    this.low = count > 0 ? low : NaN;
    this.#avg = count > 0 ? sum / count : NaN;
  }

  /** Previous close and the session phase of the newest bar. */
  #sessionValues(data: readonly Bar[]): void {
    const tl = this.#host.timeline;
    const n = data.length;
    this.#prevClose = NaN;
    this.#phase = 'open';
    this.#regularIndex = -1;
    if (n === 0) return;
    if (tl.interval >= DAY) {
      this.#prevClose = data[n - 2]?.close ?? NaN;
      return;
    }
    const session = tl.session;
    const zone = tl.zone;
    const wall = (i: number) => zone.wall(data[i]!.time);
    const now = wall(n - 1);
    const day = tradingDay(session, now);
    // The last regular-session bar of an earlier trading day.
    for (let i = n - 2; i >= 0; i--) {
      const w = wall(i);
      if (tradingDay(session, w) !== day && inSession(session, w)) {
        this.#prevClose = data[i]!.close;
        break;
      }
    }
    if (!session || inSession(session, now)) return;
    for (let i = n - 2; i >= 0; i--) {
      if (inSession(session, wall(i))) {
        this.#regularIndex = i;
        break;
      }
    }
    // Post once regular hours of the bar's trading day have closed, else pre (before the open or on a closed day).
    const closed = sessionIntervals(session, day, day).some(([, end]) => end <= now);
    this.#phase = closed ? 'post' : 'pre';
    // After hours show that day's close; one from an earlier day would be stale.
    if (closed && this.#regularIndex >= 0 && tradingDay(session, wall(this.#regularIndex)) !== day) this.#regularIndex = -1;
  }
}

/** @internal Throw on an unknown line or line style in `update`. A chart without the `referenceLines()` plugin checks what it keeps with it too. */
export function checkReferenceLines(update: ReferenceLinesUpdate): void {
  for (const [kind, patch] of Object.entries(update)) {
    if (!KINDS.includes(kind as ReferenceLineKind)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown reference line "${kind}"` : '');
    const style = (patch as Partial<ReferenceLineOptions> | undefined)?.lineStyle;
    if (style !== undefined && !STYLES.includes(style)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown line style "${style}"` : '');
  }
}

const DAY = 86400;
const EMPTY: readonly Bar[] = [];

function finiteOr(v: number | undefined): number {
  return isNumber(v) ? v : NaN;
}

function definedOnly<T extends object>(patch: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

function clone(o: Readonly<ReferenceLinesOptions>): ReferenceLinesOptions {
  return {
    previousClose: { ...o.previousClose },
    high: { ...o.high },
    low: { ...o.low },
    average: { ...o.average },
    bid: { ...o.bid },
    ask: { ...o.ask },
    extendedHours: { ...o.extendedHours },
  };
}
