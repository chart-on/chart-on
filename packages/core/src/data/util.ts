import type { Bar, Time } from '../types';
import type { BarsRequest, BarsResult, SymbolInfo } from './types';
import { boundByTime } from '../util/search';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

export { intervalSeconds } from './interval';

/** What makes a bar invalid: the field that is not a finite number, or `'range'` for high below low. */
export type BarProblem = 'time' | 'open' | 'high' | 'low' | 'close' | 'volume' | 'range';

/**
 * The first problem that makes `bar` invalid, or null when it is valid. The
 * one definition of an invalid candle, shared by `setData`, `update`, data
 * sources and `normalizeBars`: a time, open, high, low or close that is not a
 * finite number, a `volume` that is present but not finite, or high below low.
 * Open or close outside low..high is drawn as given, and volume candles draw
 * a negative volume at the normal width, like a bar without volume.
 */
export function barProblem(bar: Bar): BarProblem | null {
  const { time, open, high, low, close, volume } = bar;
  if (!Number.isFinite(time)) return 'time';
  if (!Number.isFinite(open)) return 'open';
  if (!Number.isFinite(high)) return 'high';
  if (!Number.isFinite(low)) return 'low';
  if (!Number.isFinite(close)) return 'close';
  if (volume !== undefined && !Number.isFinite(volume)) return 'volume';
  if (high < low) return 'range';
  return null;
}

/** Whether a bar is valid (see `barProblem`). */
export function isValidBar(bar: Bar): boolean {
  return barProblem(bar) === null;
}

/** Why a bar or point was left out. */
export type DropReason = 'older' | 'invalid' | 'duplicate';

/** Whether `a` and `b` hold the same value in each of `fields`. */
export function sameFields<T>(a: T, b: T, fields: readonly (keyof T)[]): boolean {
  return fields.every((k) => a[k] === b[k]);
}

const BAR_FIELDS = ['time', 'open', 'high', 'low', 'close', 'volume', 'buyVolume'] as const;

/** Whether two bars have the same time, prices and volumes. */
export function sameBar(a: Bar, b: Bar): boolean {
  return sameFields(a, b, BAR_FIELDS);
}

/**
 * Valid bars sorted by time; a later duplicate time wins. `onDrop` hears about
 * each bar left out: invalid ones, and duplicates replaced by a later bar.
 */
export function normalizeBars(bars: readonly Bar[], onDrop?: (bar: Bar, reason: DropReason) => void): Bar[] {
  const valid: Bar[] = [];
  for (const bar of bars) {
    if (isValidBar(bar)) valid.push(bar);
    else onDrop?.(bar, 'invalid');
  }
  return dedupeByTime(valid, (bar) => onDrop?.(bar, 'duplicate'));
}

/** Items sorted by time (stable), keeping the last of each run of equal times. */
export function dedupeByTime<T extends { time: number }>(items: readonly T[], onDuplicate?: (item: T) => void): T[] {
  const sorted = [...items].sort((a, b) => a.time - b.time);
  const out: T[] = [];
  for (const item of sorted) {
    if (out.length > 0 && out[out.length - 1]!.time === item.time) {
      onDuplicate?.(out[out.length - 1]!);
      out[out.length - 1] = item;
    } else {
      out.push(item);
    }
  }
  return out;
}

/**
 * Answer a bars request from an in-memory ascending series. Bars sharing a
 * time stay together, so a later page never holds the rest of a duplicate run.
 */
export function sliceBars(bars: readonly Bar[], request: Pick<BarsRequest, 'from' | 'to' | 'limit'>): BarsResult {
  let end = bars.length;
  if (request.to !== undefined) end = lowerBound(bars, request.to);
  let start = request.from === undefined ? 0 : lowerBound(bars, request.from);
  start = Math.max(start, end - request.limit);
  while (start > 0 && start < end && bars[start - 1]!.time === bars[start]!.time) start--;
  return { bars: bars.slice(start, Math.max(start, end)), atStart: start === 0 };
}

/**
 * Live bars from successive reads of the newest bars (a poll, or a stream
 * that resends its latest rows), by the chart's streaming contract, where a
 * bar with the last time replaces it and a newer one appends. Each read
 * sends, oldest first, every bar that is new or differs from the version
 * sent last: a late trade in the previous bar arrives before the next bar
 * opens, and an unchanged bar is not sent again. When a read no longer holds
 * the bar sent last, the bars in between were missed: `onMissed` gets its
 * time first, for a reset from it, and the read's bars still go out. With
 * `startAtNewest` the first read sends only its newest bar, for reads that
 * return a long tail the chart already has. Each call returns the time of
 * the newest bar seen, where the next read can start.
 */
export function liveReads(onBar: (bar: Bar) => void, onMissed: (from: Time) => void, startAtNewest = false) {
  let last: Bar | null = null;
  return (bars: readonly Bar[]): Time | undefined => {
    const sent = last;
    // Bars older than the one sent last are history the chart already has.
    const fresh = sent ? bars.filter((b) => b.time >= sent.time) : bars.slice(startAtNewest ? -1 : 0);
    if (sent && fresh.length > 0 && fresh[0]!.time > sent.time) onMissed(sent.time);
    for (const b of fresh) if (!(sent && b.time === sent.time && sameBar(b, sent))) onBar(b);
    last = fresh.at(-1) ?? last;
    return last?.time;
  };
}

/**
 * Listeners for a source's `onStatus` or `onReset`: `add` returns the
 * unsubscribe function, `emit` calls a copy of the set, so a listener may
 * unsubscribe while it runs.
 */
export function listenerSet<T>() {
  const set = new Set<(value: T) => void>();
  return {
    add(listener: (value: T) => void): () => void {
      set.add(listener);
      return () => set.delete(listener);
    },
    emit: (value: T) => {
      for (const listener of [...set]) listener(value);
    },
  };
}

/** Index of the first bar at or after `time`. */
export function lowerBound(bars: readonly Bar[], time: number): number {
  return boundByTime(bars, time, true);
}

/** `symbol` / `search` over a fixed list. */
export function symbolLookup(list: readonly SymbolInfo[]) {
  return {
    async symbol(symbol: string): Promise<SymbolInfo> {
      const info = list.find((s) => s.symbol === symbol);
      if (!info) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown symbol "${symbol}"` : '');
      return info;
    },
    async search(query: string): Promise<SymbolInfo[]> {
      const q = query.trim().toLowerCase();
      return list.filter((s) =>
        [s.symbol, s.name, s.description ?? ''].some((text) => text.toLowerCase().includes(q)),
      );
    },
  };
}
