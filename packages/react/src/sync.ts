import { ERRORS_DOCS_URL } from '@chart-on/core';
import type { Chart, ChartEvents, ChartOptionsPatch, DataSource, Interval } from '@chart-on/core';

/** One callback per chart event the app listens to, keyed by the chart's own `noun:verb` names. */
export type ChartEventHandlers = { [K in keyof ChartEvents]?: (payload: ChartEvents[K]) => void };

/** The props both components hand to the engine. */
export interface ChartInputs {
  /**
   * Chart options. Given to the chart when it is created, then applied with
   * `applyOptions` whenever they change. They are compared by value, so an
   * object literal written inline does not apply again on every render.
   */
  options?: ChartOptionsPatch;
  /**
   * Where bars come from. Changing it attaches the new source and loads `symbol` again.
   * The chart needs the `dataSource()` plugin in `options.plugins` (or `builtins()`);
   * without it the source is not attached and development builds warn once (`data-source-missing`).
   */
  dataSource?: DataSource | null;
  /** Symbol to load from `dataSource`; loads once both it and `interval` are set. */
  symbol?: string;
  interval?: Interval;
}

/**
 * Structural equality for plain data: primitives, arrays and plain objects are
 * compared by content, anything else (functions, class instances) by identity.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  if (!isPlain(a) || !isPlain(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

function isPlain(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const ENGINE_INPUTS = ['options', 'dataSource', 'symbol', 'interval'] as const;

/**
 * `next` with every engine input it leaves `undefined` taken from `last`: an
 * unset prop leaves the chart as it is, and a later change of another prop
 * still sees its last value, for example a new symbol still loads from the
 * last source after the source prop is left out.
 */
export function keepUnset<T extends ChartInputs>(last: ChartInputs, next: T): T {
  const merged: T = { ...next };
  for (const key of ENGINE_INPUTS) if (merged[key] === undefined) (merged as ChartInputs)[key] = last[key] as never;
  return merged;
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

/**
 * Keep one subscription per event name in `handlers`: subscribe names that
 * appeared, unsubscribe names that went away. Each listener calls whatever
 * handler `latest()` returns when the event fires, so a new callback for the
 * same event takes effect without subscribing again.
 */
export function syncEvents<Events>(
  target: Subscribable<Events>,
  subscriptions: Map<keyof Events, () => void>,
  handlers: { [K in keyof Events]?: (payload: Events[K]) => void } | undefined,
  latest: () => { [K in keyof Events]?: (payload: Events[K]) => void } | undefined,
): void {
  const names = new Set(Object.keys(handlers ?? {}) as (keyof Events)[]);
  for (const [name, off] of subscriptions) {
    if (names.has(name) && handlers?.[name]) continue;
    off();
    subscriptions.delete(name);
  }
  for (const name of names) {
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
