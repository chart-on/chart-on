import { ERRORS_DOCS_URL } from '@chart-on/core';
import type { Chart, ChartEvents, ChartOptionsPatch, DataSource, Interval } from '@chart-on/core';

/** One callback per chart event the app listens to, keyed by the chart's own `noun:verb` names. */
export type ChartEventHandlers = { [K in keyof ChartEvents]?: (payload: ChartEvents[K]) => void };

/** The props both components, and the action, hand to the engine. */
export interface ChartInputs {
  /**
   * Chart options. Given to the chart when it is created, then applied with
   * `applyOptions` whenever they change, including changes made inside a
   * `$state` object. Plain data in them is compared by value, so an object
   * literal written in the markup does not apply again when it is rebuilt.
   * Functions, dates and class instances are compared by identity: a formatter
   * written inline in the markup is new each time and applies the options
   * again, so define callbacks once in the script.
   */
  options?: ChartOptionsPatch;
  /**
   * Where bars come from. Changing it attaches the new source and loads
   * `symbol` again; `null` detaches it. Like every prop, leaving it out or
   * setting it to `undefined` leaves the chart as it is. The chart needs the
   * `dataSource()` plugin in `options.plugins` (or `builtins()`); without it
   * the source is not attached and development builds warn once
   * (`data-source-missing`).
   */
  dataSource?: DataSource | null;
  /** Symbol to load from `dataSource`; loads once both it and `interval` are set. */
  symbol?: string;
  interval?: Interval;
  /**
   * Chart events to listen to, keyed by event name, e.g.
   * `{ 'crosshair:move': (e) => … }`. Only the events listed here are
   * subscribed. A new callback for the same event is used without subscribing
   * again.
   */
  on?: ChartEventHandlers;
}

function isPlain(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * A plain copy of `value`: arrays and plain objects are copied, anything else
 * (functions, class instances) is kept as it is. An object met again inside
 * itself becomes the copy being built, so the copy has the same cycles and
 * never points back into the original. Reading every nested property also
 * makes an effect track all of them, so changes inside a `$state` options
 * object are seen too, and the engine never holds the state proxy.
 */
export function plainCopy<T>(value: T, building = new Map<object, object>()): T {
  if (typeof value !== 'object' || value === null || !(Array.isArray(value) || isPlain(value))) return value;
  const cycle = building.get(value);
  if (cycle) return cycle as T;
  const source = value as Record<string, unknown>;
  const copy = (Array.isArray(value) ? [] : {}) as Record<string, unknown>;
  building.set(value, copy);
  for (const key of Object.keys(source)) copy[key] = plainCopy(source[key], building);
  building.delete(value);
  return copy as T;
}

/**
 * Structural equality for plain data: primitives, arrays and plain objects are
 * compared by content, anything else (functions, class instances) by identity.
 * Cycles are equal when they lead back to the same place on both sides.
 */
export function sameValue(a: unknown, b: unknown, comparing = new Map<object, object>()): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (comparing.has(a)) return comparing.get(a) === b;
  if (Array.isArray(a) !== Array.isArray(b) || !(Array.isArray(a) || (isPlain(a) && isPlain(b)))) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  comparing.set(a, b);
  const same = keys.every((key) => Object.hasOwn(b, key) && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], comparing));
  comparing.delete(a);
  return same;
}

/** The engine inputs of `props` as plain values, the options copied out of any state proxy. */
export function readInputs(props: ChartInputs): Omit<ChartInputs, 'on'> {
  return { options: plainCopy(props.options), dataSource: props.dataSource, symbol: props.symbol, interval: props.interval };
}

/** A mounted chart and what the wrapper last brought it in line with. */
export interface Engine {
  chart: Chart;
  inputs: Omit<ChartInputs, 'on'>;
  events: Map<keyof ChartEvents, () => void>;
}

/**
 * Create the engine state for a chart just made with `inputs.options`: listen
 * first, because loading the symbol emits events straight away, then load.
 */
export function startEngine(chart: Chart, inputs: Omit<ChartInputs, 'on'>, on: () => ChartEventHandlers | undefined): Engine {
  const engine: Engine = { chart, inputs, events: new Map() };
  syncEvents(chart, engine.events, on);
  syncChart(chart, null, inputs);
  return engine;
}

/**
 * Apply `patch` on top of what the engine last saw, calling only the methods
 * whose input changed. An input that is `undefined` in the patch keeps its last
 * value: an unset prop leaves the chart as it is, and a later change of another
 * prop still sees it, for example a new symbol still loads from the last source.
 */
export function updateEngine(engine: Engine, patch: Omit<ChartInputs, 'on'>): void {
  const next = { ...engine.inputs };
  for (const [key, value] of Object.entries(patch) as [keyof typeof patch, never][]) if (value !== undefined) next[key] = value;
  syncChart(engine.chart, engine.inputs, next);
  engine.inputs = next;
}

/** Unsubscribe the engine's events and destroy its chart. */
export function stopEngine(engine: Engine): void {
  clearEvents(engine.events);
  engine.chart.destroy();
}

// Bundlers replace `process.env.NODE_ENV` in production builds. Declared here,
// module-local, so it never clashes with Node's own typings.
declare const process: { env: { NODE_ENV?: string } };

let warnedNoPlugin = false;

/**
 * Attach `source`. A chart created without the `dataSource()` plugin cannot
 * load from one; that is not worth tearing the component down for, so it is
 * reported once in development builds instead of thrown.
 */
function attachSource(chart: Chart, source: DataSource | null): void {
  try {
    chart.setDataSource(source);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== 'not-registered') throw error;
    try {
      if (process.env.NODE_ENV !== 'production' && !warnedNoPlugin) {
        warnedNoPlugin = true;
        console.warn(
          `charton [data-source-missing]: the dataSource prop needs the dataSource() plugin; pass plugins: [dataSource()] (or builtins()) in options (${ERRORS_DOCS_URL}#data-source-missing)`,
        );
      }
    } catch {
      // No `process` (loaded without a bundler): stay quiet.
    }
  }
}

/**
 * Bring a chart in line with `next`, calling only the methods whose input
 * changed since `last`. Pass `last: null` right after creating the chart with
 * `next.options`, so the options are not applied twice.
 */
export function syncChart(chart: Chart, last: ChartInputs | null, next: ChartInputs): void {
  if (last && next.options && !sameValue(last.options, next.options)) chart.applyOptions(next.options);
  const sourceChanged = next.dataSource !== undefined && (last === null || next.dataSource !== last.dataSource);
  if (sourceChanged) attachSource(chart, next.dataSource ?? null);
  const symbolChanged = next.symbol !== last?.symbol || next.interval !== last?.interval;
  if (next.dataSource && next.symbol && next.interval && (sourceChanged || symbolChanged)) {
    // A failed load also emits `data:error`, which is how the app hears about it; a load
    // overtaken by the next symbol or by unmounting rejects too, and needs no handling.
    chart.setSymbol(next.symbol, next.interval).catch(() => {});
  }
}

/** Something with the chart's `on(name, listener)` subscription shape. */
export interface Subscribable<Events> {
  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void;
}

type Handlers<Events> = { [K in keyof Events]?: (payload: Events[K]) => void };

/** The event names in `handlers` that have a callback, as a key an effect can compare. */
export function handledNames(handlers: object | undefined): string {
  if (!handlers) return '';
  return Object.keys(handlers)
    .filter((name) => (handlers as Record<string, unknown>)[name])
    .sort()
    .join('\n');
}

/**
 * Keep one subscription per event name that has a callback in `latest()`:
 * subscribe names that appeared, unsubscribe names that went away. Each
 * listener calls whatever callback `latest()` holds when the event fires, so a
 * new callback for the same event takes effect without subscribing again.
 */
export function syncEvents<Events>(
  target: Subscribable<Events>,
  subscriptions: Map<keyof Events, () => void>,
  latest: () => Handlers<Events> | undefined,
): void {
  const handlers = latest();
  for (const [name, off] of subscriptions) {
    if (handlers?.[name]) continue;
    off();
    subscriptions.delete(name);
  }
  for (const name of Object.keys(handlers ?? {}) as (keyof Events)[]) {
    if (subscriptions.has(name) || !handlers?.[name]) continue;
    subscriptions.set(
      name,
      target.on(name, (payload) => latest()?.[name]?.(payload)),
    );
  }
}

/** Call and forget every subscription in `subscriptions`. */
export function clearEvents(subscriptions: Map<unknown, () => void>): void {
  for (const off of subscriptions.values()) off();
  subscriptions.clear();
}
