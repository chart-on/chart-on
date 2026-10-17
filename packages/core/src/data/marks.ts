import { toChartError } from '../errors';
import { isColor } from '../util/color';
import type { BarMarker, MarkerPosition, MarkerShape } from '../annotations/types';
import type { Time } from '../types';
import { intervalSeconds } from './interval';
import type { DataEvents, DataSource, Interval, SourceMarker, SourceMarkerPosition, SymbolInfo } from './types';
import { isNumber, isText } from '../util/records';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

type Emit = <K extends keyof DataEvents>(event: K, payload: DataEvents[K]) => void;

/** A data source that serves markers. */
export type MarkersSource = DataSource & Required<Pick<DataSource, 'markers'>>;

const SHAPES: readonly MarkerShape[] = [
  'arrow-up',
  'arrow-down',
  'arrow-left',
  'arrow-right',
  'triangle-up',
  'triangle-down',
  'circle',
  'square',
  'diamond',
  'cross',
  'x-cross',
  'flag',
  'label',
];
const POSITIONS: readonly SourceMarkerPosition[] = ['above', 'below', 'top', 'bottom', 'timeAxis'];

/** Waits before asking again after a failed `markers`, in ms; after the last one the loader stops asking. */
export const MARKERS_RETRY_DELAYS: readonly number[] = [1000, 2000, 4000, 8000, 16000];

/** Markers and fetched spans are kept for the view plus this many view widths on each side. */
export const MARKERS_KEEP_WIDTHS = 3;

const optionalString = (v: unknown) => v === undefined || typeof v === 'string';
const EMPTY: readonly never[] = Object.freeze([]);

/**
 * A frozen copy of `value` when it is a valid marker, else null. Sources are
 * untrusted: fields of the wrong type drop the whole marker rather than draw
 * something the source did not mean.
 */
export function readMarker(value: unknown): SourceMarker | null {
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<keyof SourceMarker, unknown>;
  if (!isText(m.id) || !isNumber(m.time)) return null;
  if (!optionalString(m.text) || !optionalString(m.color) || !optionalString(m.kind) || !optionalString(m.tooltip)) return null;
  if (m.shape !== undefined && !SHAPES.includes(m.shape as MarkerShape)) return null;
  if (m.position !== undefined && !POSITIONS.includes(m.position as SourceMarkerPosition)) return null;
  if (m.size !== undefined && !(typeof m.size === 'number' && m.size > 0 && Number.isFinite(m.size))) return null;
  if (m.severity !== undefined && m.severity !== 1 && m.severity !== 2 && m.severity !== 3) return null;
  const marker: SourceMarker = { id: m.id, time: m.time };
  for (const key of ['position', 'text', 'color', 'tooltip', 'shape', 'size', 'kind', 'severity'] as const) {
    if (m[key] !== undefined) (marker as unknown as Record<string, unknown>)[key] = m[key];
  }
  // A colour the canvas cannot read is left out, so the theme's colour draws the marker.
  if (marker.color !== undefined && !isColor(marker.color)) delete marker.color;
  return Object.freeze(marker);
}

/** The bar marker that draws a source marker on its bar: a circle in the bottom lane unless it says otherwise. */
export function toBarMarker(m: SourceMarker): BarMarker {
  const { position, tooltip, ...rest } = m;
  const marker: BarMarker = { ...rest, shape: m.shape ?? 'circle', position: (position ?? 'bottom') as MarkerPosition };
  // Markers take one tooltip row per string.
  if (tooltip !== undefined) marker.tooltip = tooltip.split('\n');
  return marker;
}

/** The bar markers of the source markers placed on bars; `timeAxis` ones draw as badges instead. */
export const toBarMarkers = (markers: readonly SourceMarker[]): BarMarker[] => markers.filter((m) => m.position !== 'timeAxis').map(toBarMarker);

/**
 * Fetches a data source's markers for the shown symbol and interval as the
 * view moves. It keeps one contiguous fetched span and asks only for what
 * the view adds to it, padded by a view's width each side so small pans ask
 * for nothing. Markers and the span are trimmed to the view plus
 * `MARKERS_KEEP_WIDTHS` widths each side, so memory stays bounded and a far
 * jump asks only around the new view. One request runs at a time, started
 * in a microtask rather than inside the frame that moved the view; when it
 * lands the view is checked again. A failed request is retried after the
 * `MARKERS_RETRY_DELAYS`, then the loader stops asking. A new load, a
 * symbol or interval change, `refresh` and turning it off abort what is in flight.
 */
export class MarkersLoader {
  readonly #byId = new Map<string, SourceMarker>();
  #sorted: readonly SourceMarker[] | null = EMPTY;
  private symbol: SymbolInfo | null = null;
  private interval: Interval | null = null;
  /** Bar length in seconds; 1 when the interval cannot be measured. */
  private step = 1;
  /** Times fetched so far: `from` inclusive, `to` exclusive. */
  #covered: [Time, Time] | null = null;
  private view: [Time, Time] | null = null;
  #generation = 0;
  #abort = new AbortController();
  #busy = false;
  #scheduled = false;
  /** While off, or once the retries ran out: nothing is asked for until `refresh` or the next context. */
  #paused = false;
  /** Turned off by `setWanted(false)`: the chart draws none of the markers, so none are fetched. */
  #off = false;
  /**
   * A `timeAxis` marker came from the source: the chart keeps a band for the
   * badges under the time axis while this loader lasts (one source), so the
   * layout does not jump as the view moves past them or the symbol changes.
   */
  band = false;
  /** Failed requests in a row. */
  #failures = 0;
  #retry: ReturnType<typeof setTimeout> | null = null;
  /** The next answer replaces every marker known, for `refresh`. */
  #replace = false;

  constructor(
    private readonly source: MarkersSource,
    /** Called with every known marker, by time, whenever they change; `band` is true when the batch made `band` true. */
    private readonly show: (markers: readonly SourceMarker[], band: boolean) => void,
    private readonly emit: Emit,
  ) {}

  /** Every marker known for the current symbol and interval, by time. The array and the markers are frozen. */
  get markers(): readonly SourceMarker[] {
    this.#sorted ??= Object.freeze([...this.#byId.values()].sort((a, b) => a.time - b.time));
    return this.#sorted;
  }

  /** A new symbol or interval is shown: forget the markers and fetch afresh for the view. */
  setContext(symbol: SymbolInfo, interval: Interval): void {
    this.#stop();
    this.symbol = symbol;
    this.interval = interval;
    try {
      this.step = intervalSeconds(interval);
    } catch {
      this.step = 1;
    }
    this.#paused = this.#off;
    this.#failures = 0;
    this.#replace = false;
    this.view = null;
    this.#drop();
  }

  /** A new load started: the markers shown belong to what it replaces. Nothing is asked for until `setContext`. */
  reset(): void {
    this.#stop();
    this.symbol = null;
    this.interval = null;
    this.view = null;
    this.#replace = false;
    this.#drop();
  }

  /** The visible bars now span `from` to `to` (bar times, both included). */
  setView(from: Time, to: Time): void {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    this.view = [Math.min(from, to), Math.max(from, to)];
    this.#schedule();
  }

  /** Fetch the markers of the view again (a reset); they replace the known ones when they land. Resumes after failures; nothing while off. */
  refresh(): void {
    if (!this.symbol || this.#off) return;
    this.#stop();
    this.#paused = false;
    this.#failures = 0;
    this.#replace = true;
    this.#schedule();
  }

  /** Off: remove every marker and ask for none until turned on again, which fetches the view. */
  setWanted(on: boolean): void {
    if (on !== this.#off) return;
    this.#off = !on;
    if (on) return this.refresh();
    this.#stop();
    this.#paused = true;
    this.#replace = false;
    this.#drop();
  }

  dispose(): void {
    this.#stop();
    this.symbol = null;
    this.view = null;
  }

  #stop(): void {
    this.#generation++;
    this.#abort.abort();
    this.#abort = new AbortController();
    this.#busy = false;
    this.#covered = null;
    if (this.#retry !== null) clearTimeout(this.#retry);
    this.#retry = null;
  }

  #drop(): void {
    if (this.#byId.size === 0) return;
    this.#byId.clear();
    this.#changed();
  }

  #changed(band = false): void {
    this.#sorted = null;
    const markers = this.markers;
    this.show(markers, band);
    this.emit('sourcemarkers:change', { markers });
  }

  /** Check the view after the current task, so `markers` never runs inside a frame. */
  #schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#fill();
    });
  }

  /** Ask for the part of the padded view not covered yet, if nothing is in flight or waiting to retry. */
  #fill(): void {
    const { symbol, interval, view } = this;
    if (!symbol || !interval || !view || this.#busy || this.#paused || this.#retry !== null) return;
    const [from, last] = view;
    // The last visible bar spans one interval past its time.
    const to = last + this.step;
    const width = Math.max(to - from, this.step);
    this.#trim(from - MARKERS_KEEP_WIDTHS * width, to + MARKERS_KEEP_WIDTHS * width);
    const covered = this.#covered;
    // Each request spans at most the view and a few widths: the trim keeps `covered` near the view.
    let range: [Time, Time];
    if (!covered) range = [from - width, to + width];
    else if (from < covered[0]) range = [from - width, covered[0]];
    else if (to > covered[1]) range = [covered[1], to + width];
    else return;
    void this.#load(symbol, interval, range[0], range[1]);
  }

  /** Forget markers and fetched times outside `lo` to `hi`. */
  #trim(lo: Time, hi: Time): void {
    const c = this.#covered;
    if (c) {
      const a = Math.max(c[0], lo);
      const b = Math.min(c[1], hi);
      this.#covered = a < b ? [a, b] : null;
    }
    let removed = false;
    for (const [id, marker] of this.#byId) {
      if (marker.time >= lo && marker.time < hi) continue;
      this.#byId.delete(id);
      removed = true;
    }
    if (removed) this.#changed();
  }

  async #load(symbol: SymbolInfo, interval: Interval, from: Time, to: Time): Promise<void> {
    const generation = this.#generation;
    const signal = this.#abort.signal;
    this.#busy = true;
    try {
      const answer: unknown = await this.source.markers(symbol, interval, { from, to, signal });
      if (generation !== this.#generation) return;
      const list = Array.isArray(answer) ? answer : [];
      const band = this.band;
      const markers: SourceMarker[] = [];
      let dropped = 0;
      for (const value of list) {
        const marker = readMarker(value);
        if (!marker) dropped++;
        // Markers outside the range asked for are left out, so the trim bounds what is kept.
        else if (marker.time >= from && marker.time < to) {
          markers.push(marker);
          if (marker.position === 'timeAxis') this.band = true;
        }
      }
      this.#failures = 0;
      if (this.#replace) this.#byId.clear();
      this.#replace = false;
      for (const marker of markers) this.#byId.set(marker.id, marker);
      this.#covered = this.#covered ? [Math.min(this.#covered[0], from), Math.max(this.#covered[1], to)] : [from, to];
      this.#changed(band !== this.band);
      this.emit('sourcemarkers:loaded', { symbol, interval, from, to, markers: Object.freeze(markers), dropped });
    } catch (error) {
      if (generation !== this.#generation || signal.aborted) return;
      const delay = MARKERS_RETRY_DELAYS[this.#failures] ?? null;
      this.#failures++;
      // Retry later rather than on every pan, which would hammer a failing source.
      if (delay === null) this.#paused = true;
      else
        this.#retry = setTimeout(() => {
          this.#retry = null;
          this.#fill();
        }, delay);
      const context = { symbol: symbol.symbol, interval };
      const failure = toChartError(error, 'markers-failed', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Could not load the markers of "${symbol.symbol}"` : '', context);
      this.emit('sourcemarkers:error', { ...context, error: failure, retryIn: delay });
    } finally {
      if (generation === this.#generation) {
        this.#busy = false;
        this.#fill();
      }
    }
  }
}
