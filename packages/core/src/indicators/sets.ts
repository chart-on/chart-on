import { inIntervalRanges, intervalRangeOf, parseInterval, safeIntervalSeconds } from '../data/interval';
import type { Indicator } from './indicator';
import { isRecord, parseIndicatorStates } from './state';
import type { IndicatorState, IntervalRange } from './types';
import { isNumber } from '../util/records';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Format version of the indicator sets `serializeSet` writes. */
export const INDICATOR_SET_VERSION = 1;

/** Most entries an indicator set may hold; `applySet` refuses larger sets. */
export const MAX_INDICATOR_SET_ENTRIES = 100;

/**
 * A group of indicators with their panes, to save as a template and apply to
 * any chart: what `chart.indicators.serializeSet()` returns and `applySet()`
 * takes. Plain JSON.
 */
export interface IndicatorSet {
  /** Format version, `INDICATOR_SET_VERSION` when written. */
  version: number;
  /**
   * The indicators in the order they were added. `pane` counts the set's own
   * panes: 0 is the price pane, 1 the set's first pane below it, and so on.
   */
  indicators: IndicatorState[];
  /**
   * Height of each of the set's panes below the price pane, relative to the
   * price pane (1 is as tall). `paneHeights[0]` is pane 1.
   */
  paneHeights?: number[];
  /**
   * Intervals the set is meant for (see `indicatorSetFits`); missing means
   * every interval. Unlike an indicator's `visibleOn`, it hides nothing.
   */
  appliesOn?: IntervalRange[];
}

/** Options for `applySet`. */
export interface IndicatorSetApplyOptions {
  /** `false` adds the set's indicators to the ones on the chart. Default true: they replace the saved ones. */
  replace?: boolean;
}

/**
 * Why `applySet` left an indicator out: its id is not registered, its entry is
 * malformed, the access rule or the indicator limit refused it, or (with
 * `replace: false`) the chart already shows it with the same inputs.
 */
export type IndicatorSetSkip = 'unknown' | 'invalid' | 'blocked' | 'limit' | 'exists';

/** What `applySet` did: the indicators it added, and the entries it left out. */
export interface IndicatorSetResult {
  added: Indicator[];
  /** `index` is the entry's position in `set.indicators`; `type` is empty for an entry without an id. */
  skipped: { index: number; type: string; reason: IndicatorSetSkip }[];
}

/** @internal One entry of a validated set: its state (null when malformed), with `pane` renumbered densely. */
export interface ParsedSetEntry {
  state: IndicatorState | null;
  type: string;
  /** The saved height ratio of the entry's pane, when valid. */
  height?: number;
}

/**
 * @internal Validate an untrusted set. Throws when it is not an indicator set
 * of a known version, holds more than `MAX_INDICATOR_SET_ENTRIES` entries or
 * has an invalid interval scope. Pane numbers are renumbered 1, 2... in
 * order, so a huge saved number creates one pane, not many.
 */
export function parseIndicatorSet(data: unknown): ParsedSetEntry[] {
  if (!isRecord(data) || !Array.isArray(data.indicators)) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Invalid indicator set: expected an object with an indicators array' : '');
  }
  if (data.version !== INDICATOR_SET_VERSION) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unsupported indicator set version ${String(data.version)}` : '');
  const entries: unknown[] = data.indicators;
  if (entries.length > MAX_INDICATOR_SET_ENTRIES) {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid indicator set: more than ${MAX_INDICATOR_SET_ENTRIES} indicators` : '');
  }
  setScope(data.appliesOn);
  const heights = Array.isArray(data.paneHeights) ? data.paneHeights : [];
  const states = entries.map((entry) => {
    try {
      return parseIndicatorStates([entry])[0]!;
    } catch {
      return null;
    }
  });
  const panes = [...new Set(states.map((s) => s?.pane ?? 0).filter((p) => p > 0))].sort((a, b) => a - b);
  return states.map((state, i) => {
    const type = (entries[i] as { type?: unknown } | null)?.type;
    const pane = state?.pane ?? 0;
    // Heights stay with the pane number they were saved under.
    const height: unknown = pane > 0 ? heights[pane - 1] : undefined;
    return {
      state: state && { ...state, pane: panes.indexOf(pane) + 1 },
      type: typeof type === 'string' ? type : '',
      ...(isNumber(height) && height > 0 ? { height } : {}),
    };
  });
}

/**
 * @internal An interval scope: null when missing (every interval). Throws
 * unless it is a non-empty list of valid ranges, so a bad scope never widens
 * to every interval.
 */
export function setScope(value: unknown): IntervalRange[] | null {
  if (value === undefined) return null;
  const ranges = Array.isArray(value) ? value.map(intervalRangeOf) : [];
  if (ranges.length === 0 || ranges.includes(null)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Invalid indicator set scope: expected interval ranges' : '');
  return ranges as IntervalRange[];
}

/**
 * Whether `set` is meant for `interval` (e.g. `'15m'`): true when it has no
 * `appliesOn` scope or one of its ranges holds the interval, false for an
 * invalid scope. Apps use it to apply a set when the user switches to a
 * matching interval. An activity interval ('100T') fits only a set without
 * a scope. Throws a `ChartError` on an unknown interval, like `parseInterval`.
 */
export function indicatorSetFits(set: Pick<IndicatorSet, 'appliesOn'>, interval: string): boolean {
  parseInterval(interval);
  const seconds = safeIntervalSeconds(interval);
  try {
    const scope = setScope(set.appliesOn);
    return seconds === null ? !scope : inIntervalRanges(scope ?? undefined, seconds);
  } catch {
    return false;
  }
}
