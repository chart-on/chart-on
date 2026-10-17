import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { DataController, type DataControllerOptions, type DataTarget } from '../src/data/controller';
import { createMemoryCache, readSnapshot, sameBars, snapshotTtl, type CacheAdapter } from '../src/data/cache';
import type { BarsRequest, BarsResult, DataEvents, DataSource } from '../src/data/types';
import type { Bar } from '../src/types';

const bar = (time: number, close = 10): Bar => ({ time, open: close, high: close + 1, low: close - 1, close });
/** Minute bars `from`..`to - 1` (times in minutes). */
const range = (from: number, to: number, close = 10) => Array.from({ length: to - from }, (_, i) => bar((from + i) * 60, close));
const flush = () => new Promise((r) => setTimeout(r, 0));

interface Call {
  request: BarsRequest;
  resolve: (result: BarsResult) => void;
  reject: (error: unknown) => void;
}

/** A source whose history calls the test settles; resolves symbols to an upper-case name. */
function fakeSource() {
  const calls: Call[] = [];
  const live: ((bar: Bar) => void)[] = [];
  const source: DataSource = {
    symbol: async (symbol) => ({ symbol: symbol.toUpperCase(), name: symbol, precision: 3 }),
    search: async () => [],
    history: (_symbol, _interval, request) => new Promise((resolve, reject) => calls.push({ request, resolve, reject })),
    stream: (_symbol, _interval, onBar) => {
      live.push(onBar);
      return () => {};
    },
  };
  return { source, calls, live };
}

function setup(cache: CacheAdapter, options: Partial<DataControllerOptions> = {}) {
  const src = fakeSource();
  const shown: Bar[][] = [];
  const events: { name: keyof DataEvents; payload: unknown }[] = [];
  const target: DataTarget = {
    setData: (bars) => void shown.push(bars.slice()),
    update: () => {},
    setPriceFormat: () => {},
  };
  const controller = new DataController(src.source, target, (name, payload) => events.push({ name, payload }), {
    initialBars: 100,
    cache,
    ...options,
  });
  const named = (name: keyof DataEvents) => events.filter((e) => e.name === name).map((e) => e.payload);
  return { ...src, controller, shown, named };
}

/** A cache holding a snapshot of 'a' at 1m with `bars`, written by a first session. */
async function warmed(bars = range(10, 20)) {
  const cache = createMemoryCache();
  const first = setup(cache);
  const done = first.controller.setSymbol('a', '1m');
  await flush();
  first.calls[0]!.resolve({ bars });
  await done;
  await flush();
  first.controller.dispose();
  return cache;
}

afterEach(() => vi.useRealTimers());

describe('paint-ahead cache', () => {
  it('paints the snapshot before the fetch lands, then replaces it', async () => {
    const t = setup(await warmed());
    const done = t.controller.setSymbol('a', '1m');
    await flush();
    expect(t.calls).toHaveLength(1); // the source is still asked
    expect(t.shown).toEqual([range(10, 20)]);
    expect(t.controller.showingSnapshot).toBe(true);
    expect(t.named('data:snapshot')).toEqual([expect.objectContaining({ interval: '1m', bars: range(10, 20) })]);
    t.calls[0]!.resolve({ bars: range(11, 21) });
    await done;
    expect(t.shown).toEqual([range(10, 20), range(11, 21)]);
    expect(t.controller.showingSnapshot).toBe(false);
    expect(t.named('data:loaded')).toHaveLength(1);
  });

  it('skips the repaint when the fetch brings the same bars', async () => {
    const t = setup(await warmed());
    const done = t.controller.setSymbol('a', '1m');
    await flush();
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    expect(t.shown).toHaveLength(1);
    expect(t.named('data:loaded')).toHaveLength(1);
  });

  it('keeps the snapshot when the load fails and reports it as stale', async () => {
    const t = setup(await warmed());
    const done = t.controller.setSymbol('a', '1m');
    await flush();
    t.calls[0]!.reject(new Error('offline'));
    await expect(done).rejects.toThrow();
    expect(t.shown).toEqual([range(10, 20)]);
    expect(t.controller.showingSnapshot).toBe(true);
    expect(t.named('data:error')).toHaveLength(1);
    expect(t.named('data:stale')).toEqual([{ gap: expect.any(Number), reason: 'reconcile' }]);
  });

  it('misses expired entries and entries from another format version', async () => {
    const cache = await warmed();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + (snapshotTtl('1m') + 60) * 1000);
    const t = setup(cache);
    void t.controller.setSymbol('a', '1m');
    await flush();
    expect(t.shown).toEqual([]);
    vi.useRealTimers();

    const old = createMemoryCache();
    await old.set('a\u00001m', { v: 0, savedAt: Date.now() / 1000, info: { symbol: 'A', name: 'a' }, bars: range(1, 5) });
    const u = setup(old);
    void u.controller.setSymbol('a', '1m');
    await flush();
    expect(u.shown).toEqual([]);
  });

  it('loads normally when the storage fails', async () => {
    const broken: CacheAdapter = {
      get: () => Promise.reject(new Error('quota')),
      set: () => {
        throw new Error('quota');
      },
      delete: () => Promise.reject(new Error('quota')),
      clear: () => Promise.reject(new Error('quota')),
    };
    const t = setup(broken);
    const done = t.controller.setSymbol('a', '1m');
    await flush();
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    expect(t.shown).toEqual([range(10, 20)]);
    expect(() => t.controller.clearCache()).not.toThrow();
    t.controller.dispose();
  });

  it('stores the newest window, live bars included, under the requested key when switching away', async () => {
    const cache = createMemoryCache();
    const t = setup(cache, { initialBars: 5 });
    const done = t.controller.setSymbol('a', '1m');
    await flush();
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    t.live[0]!(bar(20 * 60, 99));
    void t.controller.setSymbol('b', '1m');
    const stored = readSnapshot(await cache.get('a\u00001m'), '1m', Date.now() / 1000);
    expect(stored?.info.symbol).toBe('A');
    expect(stored?.bars.map((b) => b.time / 60)).toEqual([16, 17, 18, 19, 20]);
    expect(stored?.bars.at(-1)!.close).toBe(99);
  });

  it('clears one entry or the whole store', async () => {
    const cache = await warmed();
    await cache.set('b\u00001m', { other: true });
    const t = setup(cache);
    t.controller.clearCache('a', '1m');
    await flush();
    expect(await cache.get('a\u00001m')).toBeUndefined();
    expect(await cache.get('b\u00001m')).toBeDefined();
    t.controller.clearCache();
    await flush();
    expect(await cache.get('b\u00001m')).toBeUndefined();
  });
});

describe('snapshot helpers', () => {
  it('scales the lifetime with the interval, within limits', () => {
    expect(snapshotTtl('1m')).toBe(12000);
    expect(snapshotTtl('1s')).toBe(600);
    expect(snapshotTtl('1M')).toBe(30 * 86400);
  });

  it('compares bars field by field', () => {
    expect(sameBars(range(1, 4), range(1, 4))).toBe(true);
    expect(sameBars(range(1, 4), range(1, 4, 11))).toBe(false);
    expect(sameBars(range(1, 4), range(1, 3))).toBe(false);
  });
});

describe('chart status with a snapshot', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  it('drops the loading message while a snapshot shows, and says stale when the load fails', async () => {
    const cache = await warmed();
    const src = fakeSource();
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.setDataSource(src.source, { cache });
    const done = c.setSymbol('a', '1m');
    await flush();
    expect(c.getStatus()).toBeNull();
    expect(c.main?.data).toHaveLength(10);
    src.calls[0]!.reject(new Error('offline'));
    await expect(done).rejects.toThrow();
    expect(c.getStatus()?.kind).toBe('stale');
    expect(c.main?.data).toHaveLength(10);
  });
});
