import type { Chart } from './chart';
import type { Interval } from './data/types';
import type { Drawing } from './drawing/types';
import type { DrawingManager, DrawingPatch } from './drawing/manager';
import { ChartError } from './errors';
import type { Timeline } from './timeline';
import type { IndexRange, Time } from './types';
import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** What a link group keeps in step across its charts. */
export interface LinkGroupOptions {
  /** Show the crosshair's time on every other chart, as a vertical line. Default true. */
  crosshair: boolean;
  /** Pan and zoom together: every chart shows the same time span. Default true. */
  visibleRange: boolean;
  /** Load the same symbol on every chart that has a data source. Default false. */
  symbol: boolean;
  /** Load the same interval on every chart that has a data source. Default false. */
  interval: boolean;
  /** Use the same time axis timezone on every chart. Default true. */
  timezone: boolean;
  /**
   * Draw on all linked charts: a drawing added, edited or removed on one
   * chart's main pane is mirrored on every other chart showing the same
   * symbol. Default false.
   */
  drawings: boolean;
}

/** Default values for `LinkGroupOptions`: crosshair, visible range and timezone linked; symbol, interval and drawings not. */
export const defaultLinkGroupOptions: Readonly<LinkGroupOptions> = Object.freeze({
  crosshair: true,
  visibleRange: true,
  symbol: false,
  interval: false,
  timezone: true,
  drawings: false,
});

/** Charts kept in step with each other. Create one with `createLinkGroup`. */
export interface LinkGroup {
  /** The charts in the group, in the order they joined. */
  readonly charts: readonly Chart[];
  readonly options: Readonly<LinkGroupOptions>;
  /**
   * Add a chart. It takes the linked state of the group's first chart: its
   * visible range, symbol, interval and timezone, as far as they are linked.
   * A destroyed chart leaves the group by itself.
   */
  add(chart: Chart): void;
  /** Take a chart out of the group; it keeps what it shows. */
  remove(chart: Chart): void;
  /** Change what is linked. Switching a link on brings every chart to the first chart's state. */
  applyOptions(options: Partial<LinkGroupOptions>): void;
  /** Take every chart out of the group. The group cannot be used afterwards. */
  destroy(): void;
}

/** Times this close (seconds) count as the same edge, absorbing float rounding. */
const SAME_TIME = 1e-3;

interface Member {
  chart: Chart;
  off: (() => void)[];
  /** Fractional times at the plot edges, as last seen or set; null until known. */
  range: { from: Time; to: Time } | null;
  /** Symbol and interval of the chart's last load request. */
  symbol: string | null;
  interval: Interval | null;
}

/**
 * Keep the crosshair, visible range, symbol, interval, timezone and
 * (opt-in) drawings of several charts in step.
 *
 * A chart that follows another is never echoed back: each link compares the
 * new state with what the chart already shows, and only a real change on one
 * chart is passed to the others. A followed range moves the chart like a pan,
 * without animation and without touching its autoscale.
 *
 * @example
 * ```ts
 * const group = createLinkGroup([daily, hourly], { symbol: true });
 * group.add(weekly);
 * group.applyOptions({ drawings: true });
 * group.destroy(); // unlink, the charts stay
 * ```
 */
export function createLinkGroup(charts: readonly Chart[] = [], options: Partial<LinkGroupOptions> = {}): LinkGroup {
  return new ChartLinkGroup(charts, options);
}

class ChartLinkGroup implements LinkGroup {
  readonly #members: Member[] = [];
  #opts: LinkGroupOptions;
  /** Set while the group itself changes charts: what they report then is recorded, not passed on. */
  #busy = false;
  #destroyed = false;

  constructor(charts: readonly Chart[], options: Partial<LinkGroupOptions>) {
    this.#opts = { ...defaultLinkGroupOptions, ...options };
    for (const chart of charts) this.add(chart);
  }

  get charts(): readonly Chart[] {
    return this.#members.map((m) => m.chart);
  }

  get options(): Readonly<LinkGroupOptions> {
    return { ...this.#opts };
  }

  add(chart: Chart): void {
    if (this.#destroyed) throw new ChartError('destroyed', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'add() called after the link group was destroyed' : '');
    if (this.#member(chart)) return;
    const request = chart.data?.requested;
    const m: Member = { chart, off: [], range: null, symbol: request?.symbol ?? null, interval: request?.interval ?? null };
    m.off.push(
      chart.on('crosshair:move', (e) => this.#crosshairMoved(m, e?.time ?? null)),
      chart.on('view:change', (e) => this.#viewChanged(m, e.fromIndex, e.toIndex)),
      chart.on('data:loading', (e) => {
        if (e.kind === 'initial') this.#loading(m, e.symbol, e.interval);
      }),
      chart.on('timezone:change', (e) => this.#timezoneChanged(m, e.timezone)),
      chart.on('drawing:create', (e) => this.#drawingChanged(m, e.drawing)),
      chart.on('drawing:update', (e) => this.#drawingChanged(m, e.drawing)),
      chart.on('drawing:remove', (e) => this.#drawingRemoved(m, e.id)),
      chart.on('chart:destroy', () => this.remove(chart)),
    );
    const leader = this.#members[0];
    this.#members.push(m);
    if (leader) this.align(m, leader, this.#opts);
  }

  remove(chart: Chart): void {
    const i = this.#members.findIndex((m) => m.chart === chart);
    if (i < 0) return;
    const [m] = this.#members.splice(i, 1);
    m!.off.forEach((off) => off());
    // A mirrored crosshair could have come from the chart that left.
    if (this.#opts.crosshair) this.#clearCrosshairs([m!, ...this.#members]);
  }

  applyOptions(options: Partial<LinkGroupOptions>): void {
    const before = this.#opts;
    this.#opts = { ...before, ...options };
    if (before.crosshair && !this.#opts.crosshair) this.#clearCrosshairs(this.#members);
    const switchedOn: LinkGroupOptions = {
      crosshair: false,
      visibleRange: !before.visibleRange && this.#opts.visibleRange,
      symbol: !before.symbol && this.#opts.symbol,
      interval: !before.interval && this.#opts.interval,
      timezone: !before.timezone && this.#opts.timezone,
      drawings: false,
    };
    const [leader, ...rest] = this.#members;
    if (leader) for (const m of rest) this.align(m, leader, switchedOn);
  }

  destroy(): void {
    for (const m of [...this.#members]) this.remove(m.chart);
    this.#destroyed = true;
  }

  #member(chart: Chart): Member | undefined {
    return this.#members.find((m) => m.chart === chart);
  }

  /** Bring `m` to `leader`'s state for the links in `links`. */
  private align(m: Member, leader: Member, links: LinkGroupOptions): void {
    this.#quietly(() => {
      if (links.timezone) this.#followTimezone(m, leader.chart.options.timezone);
      if (links.symbol || links.interval) this.#followSymbol(m, leader, links);
      if (links.visibleRange) {
        const range = leader.range ?? edgeTimes(leader.chart);
        if (range) this.#followRange(m, range);
      }
    });
  }

  #crosshairMoved(source: Member, time: Time | null): void {
    if (!this.#opts.crosshair) return;
    // setCrosshairAt does not emit crosshair:move, so this cannot loop.
    for (const m of this.#members) if (m !== source) m.chart.setCrosshairAt(time);
  }

  #clearCrosshairs(members: readonly Member[]): void {
    for (const m of members) m.chart.setCrosshairAt(null);
  }

  #viewChanged(source: Member, fromIndex: number, toIndex: number): void {
    const range = timesOf(source.chart.timeline, { from: fromIndex, to: toIndex });
    if (!range) return;
    const known = source.range;
    if (known && sameRange(known, range)) return;
    source.range = range;
    if (this.#busy || !this.#opts.visibleRange) return;
    // A chart that just got its first bars takes the group's range rather than imposing its own.
    const peer = known ? null : this.#members.find((m) => m !== source && m.range);
    if (peer) {
      this.#followRange(source, peer.range!);
      return;
    }
    this.#quietly(() => {
      for (const m of this.#members) if (m !== source) this.#followRange(m, range);
    });
  }

  #followRange(m: Member, range: { from: Time; to: Time }): void {
    const tl = m.chart.timeline;
    if (tl.length === 0) return;
    const shown = m.chart.followIndexRange(tl.indexFromTime(range.from), tl.indexFromTime(range.to));
    // What the chart will report for this view, after its own clamping.
    if (shown) m.range = timesOf(tl, shown);
  }

  #loading(source: Member, symbol: string, interval: Interval): void {
    source.symbol = symbol;
    source.interval = interval;
    if (this.#busy || (!this.#opts.symbol && !this.#opts.interval)) return;
    this.#quietly(() => {
      for (const m of this.#members) if (m !== source) this.#followSymbol(m, source, this.#opts);
    });
  }

  #followSymbol(m: Member, source: Member, links: Pick<LinkGroupOptions, 'symbol' | 'interval'>): void {
    if (!m.chart.data) return;
    const symbol = links.symbol ? source.symbol : m.symbol;
    const interval = (links.interval ? source.interval : m.interval) ?? source.interval;
    if (symbol === null || interval === null) return;
    if (symbol === m.symbol && interval === m.interval) return;
    // Load failures reach the app through the chart's own data:error event.
    m.chart.setSymbol(symbol, interval).catch(() => {});
  }

  #timezoneChanged(source: Member, timezone: string): void {
    if (this.#busy || !this.#opts.timezone) return;
    this.#quietly(() => {
      for (const m of this.#members) if (m !== source) this.#followTimezone(m, timezone);
    });
  }

  #followTimezone(m: Member, timezone: string): void {
    if (m.chart.options.timezone !== timezone) m.chart.applyOptions({ timezone });
  }

  #drawingChanged(source: Member, drawing: Drawing): void {
    // App drawings (`persist: false`) and those on other panes stay on their chart.
    if (this.#busy || !this.#opts.drawings || drawing.pane !== 0 || drawing.persist === false) return;
    this.#quietly(() => {
      // Prices as each chart shows them, so a copy lands on the same bars under another adjustment.
      for (const m of this.#drawingPeers(source)) mirrorDrawing(m.chart.drawings, m.chart.drawings.pricedFrom(drawing, source.chart.drawings));
    });
  }

  #drawingRemoved(source: Member, id: string): void {
    if (this.#busy || !this.#opts.drawings) return;
    this.#quietly(() => {
      for (const m of this.#drawingPeers(source)) {
        const own = m.chart.drawings.getById(id);
        if (own && own.persist !== false) m.chart.drawings.remove(id);
      }
    });
  }

  /** The other charts showing `source`'s symbol; charts without a data source count as one symbol. */
  #drawingPeers(source: Member): Member[] {
    // Charts without the drawings plugin take no drawings.
    return this.#members.filter((m) => m !== source && m.symbol === source.symbol && m.chart.drawingLayer);
  }

  /** Run `fn` with `busy` set, so the charts it changes do not pass the change on. */
  #quietly(fn: () => void): void {
    const was = this.#busy;
    this.#busy = true;
    try {
      fn();
    } finally {
      this.#busy = was;
    }
  }
}

/**
 * Add `drawing` to `target` under the same id, or bring the copy there up to
 * date. Unchanged fields are left out of the patch, so an identical copy
 * records nothing.
 */
function mirrorDrawing(target: DrawingManager, drawing: Drawing): void {
  const own = target.getById(drawing.id);
  if (own?.persist === false) return;
  try {
    if (!own) {
      target.add(drawing);
      return;
    }
    const patch: DrawingPatch = {
      points: drawing.points,
      visibleOn: drawing.visibleOn ?? null,
      locked: drawing.locked ?? false,
      selectable: drawing.selectable ?? true,
      history: drawing.history ?? true,
      zIndex: drawing.zIndex ?? 0,
      hidden: drawing.hidden ?? false,
      group: drawing.group ?? '',
      name: drawing.name ?? '',
    };
    // No text and empty text are the same, or the two would trade them back and forth.
    if ((own.text ?? '') !== (drawing.text ?? '')) patch.text = drawing.text ?? '';
    // Only a real style edit, so a moved drawing does not touch remembered tool styles.
    if (JSON.stringify(own.style) !== JSON.stringify(drawing.style)) patch.style = drawing.style;
    target.update(drawing.id, patch);
  } catch {
    // A tool the other chart does not have: the drawing stays on the charts that know it.
  }
}

/** Fractional times at a chart's plot edges, or null before it has bars and a size. */
function edgeTimes(chart: Chart): { from: Time; to: Time } | null {
  const r = chart.getVisibleIndexRange();
  return r && timesOf(chart.timeline, r);
}

/** Times at fractional logical indices, interpolated between bars like `indexFromTime` does. */
function timesOf(tl: Timeline, r: IndexRange): { from: Time; to: Time } | null {
  if (tl.length === 0 || !Number.isFinite(r.from) || !Number.isFinite(r.to)) return null;
  return { from: timeAt(tl, r.from), to: timeAt(tl, r.to) };
}

function timeAt(tl: Timeline, index: number): Time {
  const i = Math.floor(index);
  const a = tl.timeFromIndex(i);
  return a + (index - i) * (tl.timeFromIndex(i + 1) - a);
}

function sameRange(a: { from: Time; to: Time }, b: { from: Time; to: Time }): boolean {
  return Math.abs(a.from - b.from) <= SAME_TIME && Math.abs(a.to - b.to) <= SAME_TIME;
}
