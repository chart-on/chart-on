import type { Bar, Time } from '../types';
import type { Interval, SymbolInfo } from './types';
import { isAdjustment, type Adjustment } from './adjust';
import { safeIntervalSeconds } from './interval';
import { normalizeBars, sameBar } from './util';

/**
 * Persistent storage for bar snapshots, e.g. in the browser, so a reload or
 * a symbol switch paints at once (see the `cache` data source option). A
 * plain async key-value store: the chart decides what to keep and for how
 * long. Each method may reject; the chart then loads as if nothing was cached.
 */
export interface CacheAdapter {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /** Remove every entry this adapter holds (its namespace only, where it has one). */
  clear(): Promise<void>;
}

/** An in-memory adapter: survives symbol switches and `setDataSource`, not a page reload. */
export function createMemoryCache(): CacheAdapter {
  const entries = new Map<string, unknown>();
  return {
    get: async (key) => entries.get(key),
    set: async (key, value) => void entries.set(key, value),
    delete: async (key) => void entries.delete(key),
    clear: async () => entries.clear(),
  };
}

/** Options for `createIndexedDbCache`: the database name and a namespace that keeps entries apart. */
export interface IndexedDbCacheOptions {
  /** Database name; default `'charton-cache'`. */
  dbName?: string;
  /**
   * Keeps entries apart within the database, e.g. per signed-in user for
   * entitled data; `clear` removes only this namespace. Default `'default'`.
   */
  namespace?: string;
}

const STORE = 'entries';

/** An adapter over the browser's IndexedDB, which persists across reloads. */
export function createIndexedDbCache(options: IndexedDbCacheOptions = {}): CacheAdapter {
  const dbName = options.dbName ?? 'charton-cache';
  const prefix = `${options.namespace ?? 'default'}\u0000`;
  let opening: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error: unknown) => {
      // Try again on the next call, e.g. after the user allowed storage.
      opening = null;
      throw error;
    }));
  const run = async <T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const request = op(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };
  return {
    get: (key) => run('readonly', (s) => s.get(prefix + key)),
    set: async (key, value) => void (await run('readwrite', (s) => s.put(value, prefix + key))),
    delete: async (key) => void (await run('readwrite', (s) => s.delete(prefix + key))),
    // Every key of the namespace sorts between the prefix and the prefix with its separator bumped by one.
    clear: async () => void (await run('readwrite', (s) => s.delete(IDBKeyRange.bound(prefix, `${prefix.slice(0, -1)}\u0001`, false, true)))),
  };
}

/** Bump when the stored shape changes; entries of another version are discarded. */
const SNAPSHOT_VERSION = 1;

/** What the chart stores per symbol and interval. */
export interface Snapshot {
  v: number;
  /** Unix seconds when it was stored. */
  savedAt: Time;
  info: SymbolInfo;
  bars: Bar[];
  /** Splits and dividends of the bars, so the snapshot paints adjusted like the load will. */
  adjustments: Adjustment[];
}

/**
 * How long a snapshot of `interval` bars may be shown: about 200 bars, from
 * 10 minutes to 30 days. Activity intervals ('100T') have no length and keep
 * a snapshot for 10 minutes.
 */
export function snapshotTtl(interval: Interval): number {
  const seconds = safeIntervalSeconds(interval);
  return seconds === null ? 600 : Math.min(Math.max(seconds * 200, 600), 30 * 86400);
}

export function makeSnapshot(info: SymbolInfo, bars: readonly Bar[], adjustments: readonly Adjustment[], now: Time): Snapshot {
  return { v: SNAPSHOT_VERSION, savedAt: now, info: { ...info }, bars: bars.slice(), adjustments: adjustments.map((a) => ({ ...a })) };
}

/** `value` as a snapshot still fresh at `now`, or null when it is missing, malformed, from another version or too old. */
export function readSnapshot(value: unknown, interval: Interval, now: Time): Snapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const s = value as Partial<Snapshot>;
  if (s.v !== SNAPSHOT_VERSION || typeof s.savedAt !== 'number' || !Array.isArray(s.bars)) return null;
  if (typeof s.info !== 'object' || s.info === null || typeof s.info.symbol !== 'string') return null;
  if (!(now - s.savedAt <= snapshotTtl(interval))) return null;
  const bars = normalizeBars(s.bars);
  const adjustments = Array.isArray(s.adjustments) ? s.adjustments.filter(isAdjustment) : [];
  return bars.length > 0 ? { v: s.v, savedAt: s.savedAt, info: s.info, bars, adjustments } : null;
}

/** Whether two adjustment lists are the same. */
export function sameAdjustments(a: readonly Adjustment[], b: readonly Adjustment[]): boolean {
  return a.length === b.length && a.every((x, i) => x.time === b[i]!.time && x.kind === b[i]!.kind && x.factor === b[i]!.factor);
}

/** Whether two bar lists hold the same bars. */
export function sameBars(a: readonly Bar[], b: readonly Bar[]): boolean {
  return a.length === b.length && a.every((x, i) => sameBar(x, b[i]!));
}
