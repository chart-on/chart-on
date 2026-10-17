import type { Bar } from '../types';
import { inputCheckError, inputTypeError } from './inputs';
import type { BarArrays, IndicatorDef, IndicatorOutputs, InputDef, InputValue, IntervalBars, SourceKey } from './types';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };
const FIELDS = ['time', 'open', 'high', 'low', 'close', 'volume'] as const;
type Field = (typeof FIELDS)[number];

/**
 * Defaults merged with `values`, validated against the declared inputs: their
 * types, then each shown input's `validate`. Throws on the first problem.
 */
export function resolveInputs(defs: readonly InputDef[], values: Record<string, InputValue> = {}): Record<string, InputValue> {
  for (const key of Object.keys(values)) {
    if (!defs.some((d) => d.id === key)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown indicator input "${key}"` : '');
  }
  const out: Record<string, InputValue> = {};
  for (const d of defs) {
    const v = values[d.id] ?? d.default;
    if (inputTypeError(d, v) !== null) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid value for indicator input "${d.id}": ${String(v)}` : '');
    out[d.id] = v;
  }
  for (const d of defs) {
    const error = inputCheckError(d, out[d.id]!, out);
    if (error !== null) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid value for indicator input "${d.id}": ${error}` : '');
  }
  return out;
}

/**
 * Like `resolveInputs`, but for untrusted saved values: unknown inputs are
 * dropped, and values of the wrong type or failing `validate` take their
 * default. `problems` says what was replaced.
 */
export function salvageInputs(
  defs: readonly InputDef[],
  values: Record<string, unknown>,
): { inputs: Record<string, InputValue>; problems: string[] } {
  const problems: string[] = [];
  for (const key of Object.keys(values)) {
    if (!defs.some((d) => d.id === key)) problems.push(`unknown input "${key}" dropped`);
  }
  const inputs: Record<string, InputValue> = {};
  for (const d of defs) {
    // Only a missing value takes the default; a saved null is invalid and reported.
    const v = values[d.id] === undefined ? d.default : values[d.id];
    if (inputTypeError(d, v) === null) {
      inputs[d.id] = v as InputValue;
    } else {
      problems.push(`invalid value for input "${d.id}" (${String(v)}), default used`);
      inputs[d.id] = d.default;
    }
  }
  // Checked against the values as restored; a default that still fails is kept.
  const checked = { ...inputs };
  for (const d of defs) {
    const error = inputCheckError(d, checked[d.id]!, checked);
    if (error === null || inputs[d.id] === d.default) continue;
    problems.push(`invalid value for input "${d.id}" (${String(inputs[d.id])}): ${error}, default used`);
    inputs[d.id] = d.default;
  }
  return { inputs, problems };
}

/** The series an input of type `source` selects; derived averages are computed. */
export function sourceOf(src: BarArrays, key: SourceKey): Float64Array {
  if (key !== 'hl2' && key !== 'hlc3' && key !== 'ohlc4') return src[key];
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = sourceAt(src, key, i);
  return out;
}

/** One bar's value of `key`, allocation free (for `update`). */
export function sourceAt(src: BarArrays, key: SourceKey, i: number): number {
  switch (key) {
    case 'hl2':
      return (src.high[i]! + src.low[i]!) / 2;
    case 'hlc3':
      return (src.high[i]! + src.low[i]! + src.close[i]!) / 3;
    case 'ohlc4':
      return (src.open[i]! + src.high[i]! + src.low[i]! + src.close[i]!) / 4;
    default:
      return src[key][i]!;
  }
}

/**
 * Grow-in-place bar columns; `view` exposes exactly `length` values. The
 * chart keeps one for all its indicators, so memory grows with the bars, not
 * with the bars times the indicators.
 */
export class BarColumns {
  view: BarArrays = emptyView();
  #buf = {} as Record<Field, Float64Array>;
  #capacity = 0;
  /** The bars array last written by `sync`, to tell repeats and appends from replacements. */
  private source: readonly Bar[] | null = null;

  get length(): number {
    return this.view.length;
  }

  /**
   * Rewrite every bar, in place while they fit. An in-flight async compute
   * reading the old values is dropped anyway: every runner recomputes after a
   * rewrite, which outdates it.
   */
  set(bars: readonly Bar[]): void {
    // Growing again (history pages) doubles, so ten pages reallocate a few times, not ten.
    if (this.#capacity === 0 || bars.length > this.#capacity) {
      this.#alloc(Math.max(capacityFor(bars.length), this.#capacity * 2));
    }
    bars.forEach((bar, i) => this.#write(i, bar));
    this.refresh(bars.length);
    this.source = bars;
  }

  /** Drop the storage; the next `set` or `sync` allocates again. */
  clear(): void {
    this.#buf = {} as Record<Field, Float64Array>;
    this.#capacity = 0;
    this.source = null;
    this.view = emptyView();
  }

  /**
   * Bring the columns in line with `bars`, writing as little as possible, so
   * every runner of a chart can call it for the same change: the same array at
   * the same length rewrites the last bar (a live tick, or a repeat), one bar
   * longer appends it, anything else rewrites all.
   */
  sync(bars: readonly Bar[]): void {
    const n = bars.length;
    if (bars === this.source && n > 0 && n === this.length) this.#write(n - 1, bars[n - 1]!);
    else if (bars === this.source && n > 0 && n === this.length + 1) this.push(bars[n - 1]!);
    else this.set(bars);
  }

  /**
   * `bars` (the array last synced) gained `count` older bars in front. Every
   * runner of a chart calls it for the same page; the first moves the columns
   * once and writes the new bars, the others find them in line already.
   * Anything unexpected rewrites all.
   */
  syncPrepend(bars: readonly Bar[], count: number): void {
    const n = bars.length;
    if (bars === this.source && n === this.length) return;
    if (bars !== this.source || count <= 0 || n !== this.length + count) {
      this.set(bars);
      return;
    }
    const old = this.length;
    if (n > this.#capacity) {
      const prev = this.#buf;
      this.#alloc(Math.max(capacityFor(n), this.#capacity * 2));
      for (const f of FIELDS) this.#buf[f].set(prev[f].subarray(0, old), count);
    } else {
      for (const f of FIELDS) this.#buf[f].copyWithin(count, 0, old);
    }
    for (let i = 0; i < count; i++) this.#write(i, bars[i]!);
    this.refresh(n);
  }

  replaceLast(bar: Bar): void {
    if (this.length > 0) this.#write(this.length - 1, bar);
  }

  push(bar: Bar): void {
    const n = this.length;
    if (n >= this.#capacity) {
      const old = this.#buf;
      this.#alloc(capacityFor(n + 1));
      for (const f of FIELDS) this.#buf[f].set(old[f].subarray(0, n));
    }
    this.#write(n, bar);
    this.refresh(n + 1);
  }

  #alloc(capacity: number): void {
    this.#capacity = capacity;
    const buf = {} as Record<Field, Float64Array>;
    for (const f of FIELDS) buf[f] = new Float64Array(capacity);
    this.#buf = buf;
  }

  #write(i: number, bar: Bar): void {
    const b = this.#buf;
    b.time[i] = bar.time;
    b.open[i] = bar.open;
    b.high[i] = bar.high;
    b.low[i] = bar.low;
    b.close[i] = bar.close;
    b.volume[i] = bar.volume ?? NaN;
  }

  private refresh(length: number): void {
    const b = this.#buf;
    this.view = {
      length,
      time: b.time.subarray(0, length),
      open: b.open.subarray(0, length),
      high: b.high.subarray(0, length),
      low: b.low.subarray(0, length),
      close: b.close.subarray(0, length),
      volume: b.volume.subarray(0, length),
    };
  }
}

export interface RunnerListener {
  /** Outputs changed from bar `from` to the end. */
  change(from: number): void;
  error(error: unknown): void;
}

/** External rows an indicator reads (see `ExternalFeed`), aligned on demand to the bars. */
export interface ExternalSource {
  readonly fields: readonly string[];
  /** Write each field's value for bars [from, n) of `time` into `out`. */
  align(time: Float64Array, from: number, n: number, out: IndicatorOutputs): void;
  /** A bar was appended live: fetch what the new bar needs. */
  appended(): void;
  /** The runner was disposed: stop fetching and streaming. */
  dispose(): void;
}

/** Other intervals' bars an indicator reads (see `IntervalFeed`), built on demand from the chart's bars. */
export interface IntervalSource {
  /** Bars of every declared interval for the chart's bars `lower`. */
  bars(lower: BarArrays): IntervalBars;
  /** The runner was disposed: stop loading. */
  dispose(): void;
}

const NO_INTERVALS: IntervalBars = Object.freeze({});

/**
 * Keeps one indicator's outputs in sync with the main series: full compute on
 * new data or inputs, `update` on the last bar for live ticks. Async results
 * that were overtaken by newer data or inputs are dropped.
 */
export class IndicatorRunner {
  /** Output arrays, each `length` long (one value per bar). */
  out: IndicatorOutputs = {};
  #outBuf: IndicatorOutputs = {};
  #outCapacity = 0;
  /** Fetched fields aligned with the bars, passed to `compute` and `update`. */
  private data: IndicatorOutputs = {};
  #dataBuf: IndicatorOutputs = {};
  #dataCapacity = 0;
  /** Bars of the declared intervals, passed to `compute` and `update`. */
  #higher: IntervalBars = NO_INTERVALS;
  private version = 0;
  #pending = false;
  /** Bars changed while a compute was in flight. */
  private stale = false;
  /**
   * The last compute, update or result failed. Outputs stay empty and live
   * ticks skip `update` (whose state is gone) until a full recompute succeeds,
   * so one failure is reported once rather than on every tick.
   */
  #failed = false;
  #disposed = false;

  constructor(
    readonly def: IndicatorDef,
    public inputs: Record<string, InputValue>,
    private readonly listener: RunnerListener,
    private readonly external: ExternalSource | null = null,
    /** Bar storage; the chart passes one shared by all its runners. */
    private readonly bars = new BarColumns(),
    private readonly intervals: IntervalSource | null = null,
  ) {}

  get src(): BarArrays {
    return this.bars.view;
  }

  get length(): number {
    return this.bars.length;
  }

  /** New bars: bring the columns in line (once, when shared) and recompute. */
  setBars(bars: readonly Bar[]): void {
    if (this.#disposed) return;
    this.bars.sync(bars);
    this.#recompute();
  }

  /**
   * `bars` gained `count` older bars in front (a history page). The shared
   * columns move once; outputs are recomputed, since a value may depend on
   * every earlier bar.
   */
  prependBars(bars: readonly Bar[], count: number): void {
    if (this.#disposed) return;
    this.bars.syncPrepend(bars, count);
    this.#recompute();
  }

  setInputs(inputs: Record<string, InputValue>): void {
    this.inputs = inputs;
    this.#recompute();
  }

  /** The last bar changed (`appended` false) or a newer bar was appended. */
  updateLast(bar: Bar, appended: boolean): void {
    if (this.#disposed) return;
    if (appended) this.bars.push(bar);
    else this.bars.replaceLast(bar);
    this.#lastChanged(appended);
  }

  /** `bars` gained a bar (`appended`) or its last bar changed, with columns possibly shared with other runners. */
  syncLast(bars: readonly Bar[], appended: boolean): void {
    if (this.#disposed) return;
    this.bars.sync(bars);
    this.#lastChanged(appended);
  }

  #lastChanged(appended: boolean): void {
    if (this.#pending) this.stale = true;
    else if (this.#failed) this.#keepEmpty(appended);
    else this.#catchUp(this.bars.length - 1, appended);
    if (appended) this.external?.appended();
  }

  /** Bars of a declared interval loaded: compute again over everything. */
  intervalsChanged(): void {
    if (this.#disposed || this.bars.length === 0) return;
    this.#recompute();
  }

  /**
   * External rows changed: at or after `time` (e.g. a live row), or anywhere
   * when null. A change in the last bar takes the incremental path.
   */
  externalChanged(time: number | null): void {
    const n = this.bars.length;
    if (this.#disposed || n === 0) return;
    const times = this.src.time;
    if (time !== null && time >= times[n - 1]!) {
      if (this.#pending) this.stale = true;
      else if (!this.#failed) this.#catchUp(n - 1);
      return;
    }
    this.#recompute();
  }

  /** Stop: later data changes and pending async results are ignored. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.external?.dispose();
    this.intervals?.dispose();
  }

  #recompute(): void {
    const version = ++this.version;
    const n = this.bars.length;
    this.#pending = false;
    this.stale = false;
    if (n === 0) {
      this.#failed = false;
      this.#setOutputs({}, 0);
      this.listener.change(0);
      return;
    }
    this.#alignData(0, true);
    let result: unknown;
    try {
      this.#refreshIntervals();
      result = this.def.compute(this.src, this.inputs, this.data, this.#higher);
    } catch (err) {
      this.#fail(err);
      return;
    }
    if (!isPromise(result)) {
      this.#adopt(result, n);
      return;
    }
    this.#pending = true;
    const current = () => !this.#disposed && version === this.version;
    result.then(
      (out: unknown) => {
        if (!current()) return;
        this.#pending = false;
        if (!this.#adopt(out, n) || !this.stale) return;
        // Bars ticked or were appended meanwhile: bring the tail up to date.
        this.stale = false;
        this.#catchUp(n - 1);
      },
      (err) => {
        if (!current()) return;
        this.#pending = false;
        this.#fail(err);
      },
    );
  }

  /**
   * Recalculate bars [from, length) with `update`, or everything without it.
   * `appended` also re-aligns the bar before `from` and recalculates it too
   * when its external data changed.
   */
  #catchUp(from: number, appended = false): void {
    const update = this.def.update;
    if (!update) {
      this.#recompute();
      return;
    }
    const n = this.bars.length;
    this.#resizeOut(n);
    from = Math.max(0, from);
    if (appended && from > 0 && this.external) from = this.#realignPrevious(from);
    else this.#alignData(from, false);
    try {
      this.#refreshIntervals();
      for (let i = from; i < n; i++) update(this.src, this.inputs, i, this.out, this.data, this.#higher);
    } catch (err) {
      this.#fail(err);
      return;
    }
    this.listener.change(from);
  }

  /** Take `result` as the outputs for `n` bars; false when it is malformed. */
  #adopt(result: unknown, n: number): boolean {
    const problem = checkOutputs(this.def, result, n);
    if (problem !== null) {
      this.#fail(new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${this.def.id}" ${problem}` : ''));
      return false;
    }
    this.#failed = false;
    this.#setOutputs(result as IndicatorOutputs, n);
    this.listener.change(0);
    return true;
  }

  #setOutputs(result: IndicatorOutputs, n: number): void {
    this.#outCapacity = capacityFor(n);
    this.#outBuf = {};
    for (const key of new Set([...Object.keys(result), ...this.def.plots.map((p) => p.id)])) {
      const buf = new Float64Array(this.#outCapacity).fill(NaN);
      const arr = result[key];
      if (arr) buf.set(arr.subarray(0, n));
      this.#outBuf[key] = buf;
    }
    this.#refreshOut(n);
  }

  /** While failed, outputs only grow with the bars and stay NaN. */
  #keepEmpty(appended: boolean): void {
    if (!appended) return;
    const n = this.bars.length;
    this.#resizeOut(n);
    this.listener.change(n - 1);
  }

  /** Outputs become NaN (nothing drawn) and the error is reported. */
  #fail(err: unknown): void {
    this.#failed = true;
    this.#setOutputs({}, 0);
    this.#resizeOut(this.bars.length);
    this.listener.change(0);
    this.listener.error(err);
  }

  /**
   * A bar was appended at `from`. The bar before it took rows up to one
   * interval past its start and now ends where the new bar starts, so rows in
   * a gap between the two (a session gap, say) belong to it. Align from that
   * bar and return where to recalculate: there if its data changed, else `from`.
   */
  #realignPrevious(from: number): number {
    const prev = from - 1;
    const fields = this.external!.fields;
    const before = fields.map((field) => this.data[field]?.[prev]);
    this.#alignData(prev, false);
    return fields.some((field, c) => !Object.is(this.data[field]![prev], before[c])) ? prev : from;
  }

  /**
   * Align the external fields with bars [from, length). `fresh` allocates new
   * storage, so an in-flight async compute keeps its own snapshot.
   */
  #alignData(from: number, fresh: boolean): void {
    const external = this.external;
    if (!external) return;
    const n = this.bars.length;
    // Nothing aligned yet: start over.
    if (this.#dataCapacity === 0) fresh = true;
    if (fresh) from = 0;
    if (fresh || n > this.#dataCapacity) {
      const old = this.#dataBuf;
      this.#dataCapacity = capacityFor(n);
      this.#dataBuf = {};
      for (const field of external.fields) {
        const buf = new Float64Array(this.#dataCapacity).fill(NaN);
        if (!fresh) buf.set(old[field]!.subarray(0, from));
        this.#dataBuf[field] = buf;
      }
    }
    this.data = {};
    for (const field of external.fields) this.data[field] = this.#dataBuf[field]!.subarray(0, n);
    external.align(this.src.time, from, n, this.data);
  }

  /** Rebuild the declared intervals' bars for the current bars (the newest follow every tick). */
  #refreshIntervals(): void {
    if (this.intervals) this.#higher = this.intervals.bars(this.src);
  }

  /** Grow outputs to `n` bars; new slots are NaN. */
  #resizeOut(n: number): void {
    if (n > this.#outCapacity) {
      this.#outCapacity = capacityFor(n);
      for (const key of Object.keys(this.#outBuf)) {
        const buf = new Float64Array(this.#outCapacity).fill(NaN);
        buf.set(this.#outBuf[key]!);
        this.#outBuf[key] = buf;
      }
    }
    this.#refreshOut(n);
  }

  #refreshOut(n: number): void {
    this.out = {};
    for (const key of Object.keys(this.#outBuf)) this.out[key] = this.#outBuf[key]!.subarray(0, n);
  }
}

/**
 * Push a main-series change to every runner: `reset` recomputes from `bars`,
 * `append` and `tick` pass on the last bar, `prepend` the `count` bars that
 * now lead `bars`. Iterates a snapshot, since an error handler may add or
 * remove indicators; removed (disposed) runners ignore the change.
 */
export function syncRunners(
  runners: readonly IndicatorRunner[],
  bars: readonly Bar[],
  change: 'reset' | 'append' | 'tick' | 'prepend',
  count = 0,
): void {
  for (const runner of [...runners]) {
    if (change === 'reset' || bars.length === 0) runner.setBars(bars);
    else if (change === 'prepend') runner.prependBars(bars, count);
    else runner.syncLast(bars, change === 'append');
  }
}

/** Why `result` is not valid outputs for `n` bars, or null when it is. */
function checkOutputs(def: IndicatorDef, result: unknown, n: number): string | null {
  if (typeof result !== 'object' || result === null) return 'returned no outputs';
  for (const plot of def.plots) {
    const ohlc = plot.type === 'ohlc' ? [plot.open, plot.high, plot.low] : [];
    for (const id of [plot.id, (plot.type === 'line' || plot.type === 'histogram' || plot.type === 'ohlc') && plot.colorOutput, ...ohlc]) {
      if (id && !(id in result)) return `must return a Float64Array of length ${n} for "${id}"`;
    }
  }
  for (const [key, arr] of Object.entries(result)) {
    if (!(arr instanceof Float64Array && arr.length === n)) return `must return a Float64Array of length ${n} for "${key}"`;
  }
  return null;
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}

function capacityFor(n: number): number {
  return Math.ceil(n * 1.25) + 16;
}

function emptyView(): BarArrays {
  const e = new Float64Array(0);
  return { length: 0, time: e, open: e, high: e, low: e, close: e, volume: e };
}
