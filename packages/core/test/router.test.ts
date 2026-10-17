import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDataSourceRouter } from '../src/data/router';
import { createStaticDataSource } from '../src/data/adapters';
import { testDataSource } from '../src/data/conformance';
import { ChartError } from '../src/errors';
import type { BarsRequest, BarsReset, DataSource, FeedStatus, SymbolInfo } from '../src/data/types';
import type { Bar } from '../src/types';

const HOUR = 3600;
const history = (base: number): Bar[] =>
  Array.from({ length: 200 }, (_, i) => {
    const close = base + (i % 13);
    return { time: (1_000 + i) * HOUR, open: close, high: close + 1, low: close - 1, close };
  });

interface Fake extends DataSource {
  seen: SymbolInfo[];
  push(bar: Bar): void;
  status(state: FeedStatus['state']): void;
}

/** A feed over static bars that records the symbol infos it is handed and can push live bars and statuses. */
function fake(symbols: SymbolInfo[], base: number, live = true): Fake {
  const inner = createStaticDataSource({ symbols, bars: () => history(base) });
  const seen: SymbolInfo[] = [];
  const bars = new Set<(bar: Bar) => void>();
  const listeners = new Set<(status: FeedStatus) => void>();
  const source: Fake = {
    seen,
    symbol: (symbol) => inner.symbol(symbol),
    search: (query) => inner.search(query),
    history(info, interval, request) {
      seen.push(info);
      return inner.history(info, interval, request);
    },
    push: (bar) => bars.forEach((onBar) => onBar(bar)),
    status: (state) => listeners.forEach((listener) => listener({ state, since: 1 })),
  };
  if (live) {
    source.stream = (info, _interval, onBar) => {
      seen.push(info);
      bars.add(onBar);
      source.status('connected');
      return () => {
        bars.delete(onBar);
        if (bars.size === 0) source.status('disconnected');
      };
    };
    source.onStatus = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
  }
  return source;
}

const request = (fields: Partial<BarsRequest> = {}): BarsRequest => ({
  kind: 'initial',
  limit: 10,
  signal: new AbortController().signal,
  ...fields,
});

function setup(options: Parameters<typeof createDataSourceRouter>[1] = {}) {
  const a = fake(
    [
      { symbol: 'BTC/USD', name: 'BTC/USD', exchange: 'Venue A', type: 'crypto' },
      { symbol: 'BTC/USD:USD', name: 'BTC/USD:USD', type: 'perpetual' },
    ],
    100,
  );
  const b = fake([{ symbol: 'BTC/USD', name: 'BTC/USD' }, { symbol: 'ETH/USD', name: 'ETH/USD' }], 500, false);
  const router = createDataSourceRouter({ 'FEED-A': { source: a, name: 'Feed A' }, 'FEED-B': { source: b } }, options);
  return { a, b, router };
}

afterEach(() => vi.restoreAllMocks());

describe('createDataSourceRouter', () => {
  it('resolves a prefixed symbol through its route', async () => {
    const { router } = setup();
    expect(await router.symbol('FEED-A:BTC/USD')).toEqual({
      symbol: 'FEED-A:BTC/USD',
      name: 'BTC/USD',
      exchange: 'Feed A',
      type: 'crypto',
    });
    // A route without a name is named after its prefix.
    expect((await router.symbol('FEED-B:ETH/USD')).exchange).toBe('FEED-B');
  });

  it('splits at the first separator only', async () => {
    const { a, router } = setup();
    const info = await router.symbol('FEED-A:BTC/USD:USD');
    expect(info.symbol).toBe('FEED-A:BTC/USD:USD');
    await router.history(info, '1h', request());
    expect(a.seen.at(-1)!.symbol).toBe('BTC/USD:USD');
  });

  it('honours another separator', async () => {
    const a = fake([{ symbol: 'X:Y', name: 'X:Y' }], 100);
    const router = createDataSourceRouter({ A: { source: a } }, { separator: '|' });
    expect((await router.symbol('A|X:Y')).symbol).toBe('A|X:Y');
    await expect(router.symbol('A:X:Y')).rejects.toBeInstanceOf(ChartError);
  });

  it('rejects an unknown prefix with unknown-symbol', async () => {
    const { router } = setup();
    const error = await router.symbol('FEED-C:BTC/USD').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChartError);
    expect((error as ChartError).code).toBe('unknown-symbol');
    expect((error as ChartError).context).toMatchObject({ symbol: 'FEED-C:BTC/USD', prefixes: ['FEED-A', 'FEED-B'] });
    await expect(router.symbol('BTC/USD')).rejects.toMatchObject({ code: 'unknown-symbol' });
  });

  it('sends unprefixed symbols to the default route', async () => {
    const { b, router } = setup({ defaultRoute: 'FEED-B' });
    const info = await router.symbol('ETH/USD');
    expect(info).toMatchObject({ symbol: 'FEED-B:ETH/USD', exchange: 'FEED-B' });
    // An unknown prefix is part of the default route's symbol.
    await expect(router.symbol('FEED-C:ETH/USD')).rejects.toThrow('Unknown symbol "FEED-C:ETH/USD"');
    const result = await router.history(info, '1h', request());
    expect(result.bars.at(-1)!.close).toBe(500 + (199 % 13));
    expect(b.seen.at(-1)!.symbol).toBe('ETH/USD');
  });

  it('checks its configuration', () => {
    const source = fake([], 0);
    expect(() => createDataSourceRouter({ 'A:B': { source } })).toThrow(TypeError);
    expect(() => createDataSourceRouter({ '': { source } })).toThrow(TypeError);
    expect(() => createDataSourceRouter({ A: { source } }, { separator: '' })).toThrow(TypeError);
    expect(() => createDataSourceRouter({ A: { source } }, { defaultRoute: 'B' })).toThrow(TypeError);
  });

  it('loads history from the routed feed with its own symbol info', async () => {
    const { a, b, router } = setup();
    const fromA = await router.history(await router.symbol('FEED-A:BTC/USD'), '1h', request());
    const fromB = await router.history(await router.symbol('FEED-B:BTC/USD'), '1h', request());
    expect(fromA.bars.at(-1)!.close).toBe(100 + (199 % 13));
    expect(fromB.bars.at(-1)!.close).toBe(500 + (199 % 13));
    expect(a.seen.at(-1)).toEqual({ symbol: 'BTC/USD', name: 'BTC/USD', exchange: 'Venue A', type: 'crypto' });
    expect(b.seen.at(-1)).toEqual({ symbol: 'BTC/USD', name: 'BTC/USD' });
    // A symbol info not resolved through the router, e.g. restored from storage.
    await router.history({ symbol: 'FEED-B:ETH/USD', name: 'ETH/USD' }, '1h', request());
    expect(b.seen.at(-1)!.symbol).toBe('ETH/USD');
    await expect(router.history({ symbol: 'NOPE', name: 'NOPE' }, '1h', request())).rejects.toMatchObject({ code: 'unknown-symbol' });
  });

  it('passes the data source conformance check', async () => {
    const { router } = setup();
    const options = { interval: '1h' as const, limit: 50, timeout: 200 };
    expect(await testDataSource(router, { ...options, symbol: 'FEED-A:BTC/USD' })).toEqual([]);
    expect(await testDataSource(router, { ...options, symbol: 'FEED-B:ETH/USD' })).toEqual([]);
  });

  it('streams live bars from the routed feed', async () => {
    const { a, router } = setup();
    const info = await router.symbol('FEED-A:BTC/USD');
    const onBar = vi.fn();
    const stop = router.stream!(info, '1h', onBar);
    expect(a.seen.at(-1)!.symbol).toBe('BTC/USD');
    const bar = { time: 2_000 * HOUR, open: 1, high: 2, low: 0, close: 1 };
    a.push(bar);
    expect(onBar).toHaveBeenCalledWith(bar);
    stop();
    stop();
    a.push(bar);
    expect(onBar).toHaveBeenCalledTimes(1);
    // A route without live bars subscribes to nothing.
    expect(router.stream!(await router.symbol('FEED-B:ETH/USD'), '1h', onBar)).toBeTypeOf('function');
  });

  it('passes on the status of routes with live bars open', async () => {
    const a = fake([{ symbol: 'X', name: 'X' }], 100);
    const b = fake([{ symbol: 'Y', name: 'Y' }], 100);
    const router = createDataSourceRouter({ A: { source: a }, B: { source: b } });
    const states: string[] = [];
    const off = router.onStatus!((status) => states.push(status.state));
    // Nothing subscribed: every route's status passes.
    b.status('reconnecting');
    expect(states).toEqual(['reconnecting']);
    const stopA = router.stream!(await router.symbol('A:X'), '1h', () => {});
    expect(states.at(-1)).toBe('connected');
    // B has nothing open while A does: its status is not the chart's.
    b.status('reconnecting');
    expect(states).toEqual(['reconnecting', 'connected']);
    // Switching to B: subscribed before A closes, so A's disconnect is held back.
    const stopB = router.stream!(await router.symbol('B:Y'), '1h', () => {});
    stopA();
    expect(states).toEqual(['reconnecting', 'connected', 'connected']);
    // The last subscription closing passes its disconnect on.
    stopB();
    expect(states.at(-1)).toBe('disconnected');
    off();
    a.status('reconnecting');
    expect(states.at(-1)).toBe('disconnected');
  });

  it('holds back an old route once the chart switched to a new one', async () => {
    // The chart's order: close the old subscription, resolve the new symbol, then subscribe.
    const a = fake([{ symbol: 'X', name: 'X' }], 100);
    const b = fake([{ symbol: 'Y', name: 'Y' }], 100);
    const router = createDataSourceRouter({ A: { source: a }, B: { source: b } });
    const states: string[] = [];
    router.onStatus!((status) => states.push(status.state));
    const stopA = router.stream!(await router.symbol('A:X'), '1h', () => {});
    stopA();
    expect(states).toEqual(['connected', 'disconnected']);
    router.stream!(await router.symbol('B:Y'), '1h', () => {});
    expect(states.at(-1)).toBe('connected');
    // A late outage report from the closed feed is not the chart's.
    a.status('reconnecting');
    a.status('disconnected');
    expect(states).toEqual(['connected', 'disconnected', 'connected']);
  });

  it('has only the optional members some route has', async () => {
    const plain: DataSource = createStaticDataSource({ symbols: [{ symbol: 'X', name: 'X' }], bars: () => [] });
    const bare = createDataSourceRouter({ A: { source: plain } });
    expect(bare.stream).toBeUndefined();
    expect(bare.onStatus).toBeUndefined();
    expect(bare.onReset).toBeUndefined();
    expect(bare.quotes).toBeUndefined();
    expect(bare.adjustments).toBeUndefined();
    expect(bare.markers).toBeUndefined();
    expect(bare.now).toBeUndefined();

    const onQuote = vi.fn();
    const rich: DataSource = {
      ...plain,
      quotes: (info, listener) => {
        listener({ bid: 1, ask: 2 });
        expect(info.symbol).toBe('X');
        return () => {};
      },
      adjustments: async (info) => [{ time: 5, kind: 'split', factor: info.symbol === 'X' ? 2 : 0 }],
      now: async () => 42,
    };
    const router = createDataSourceRouter({ A: { source: plain }, B: { source: rich } });
    const signal = new AbortController().signal;
    router.quotes!(await router.symbol('B:X'), onQuote);
    expect(onQuote).toHaveBeenCalledWith({ bid: 1, ask: 2 });
    expect(router.quotes!(await router.symbol('A:X'), onQuote)).toBeTypeOf('function');
    expect(await router.adjustments!(await router.symbol('B:X'), { from: 0, to: 10, signal })).toEqual([{ time: 5, kind: 'split', factor: 2 }]);
    expect(await router.adjustments!(await router.symbol('A:X'), { from: 0, to: 10, signal })).toEqual([]);
    expect(await router.now!()).toBe(42);
  });

  it('asks the routed feed for its markers with its own symbol info', async () => {
    const plain: DataSource = createStaticDataSource({ symbols: [{ symbol: 'X', name: 'X' }], bars: () => [] });
    const markers = vi.fn(async (info: SymbolInfo, interval: string) => [{ id: `${info.symbol}-${interval}`, time: 5 }]);
    const router = createDataSourceRouter({ A: { source: plain }, B: { source: { ...plain, markers } } });
    const signal = new AbortController().signal;
    expect(await router.markers!(await router.symbol('B:X'), '1h', { from: 0, to: 10, signal })).toEqual([{ id: 'X-1h', time: 5 }]);
    expect(markers).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'X' }), '1h', { from: 0, to: 10, signal });
    // A route without markers answers none.
    expect(await router.markers!(await router.symbol('A:X'), '1h', { from: 0, to: 10, signal })).toEqual([]);
  });

  it("passes on a feed's resets under the routed symbol", () => {
    const listeners = new Set<(reset: BarsReset) => void>();
    const plain = createStaticDataSource({ symbols: [{ symbol: 'X', name: 'X' }], bars: () => [] });
    const resetting: DataSource = {
      ...plain,
      onReset(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const router = createDataSourceRouter({ A: { source: plain }, B: { source: resetting } });
    const heard: BarsReset[] = [];
    const off = router.onReset!((reset) => heard.push(reset));
    listeners.forEach((l) => l({ symbol: 'X', interval: '1h', range: { from: 5 } }));
    expect(heard).toEqual([{ symbol: 'B:X', interval: '1h', range: { from: 5 } }]);
    off();
    expect(listeners.size).toBe(0);
  });

  it('merges search results from every route in route order', async () => {
    const { router } = setup();
    const found = await router.search('btc');
    expect(found.map((s) => [s.symbol, s.exchange])).toEqual([
      ['FEED-A:BTC/USD', 'Feed A'],
      ['FEED-A:BTC/USD:USD', 'Feed A'],
      ['FEED-B:BTC/USD', 'FEED-B'],
    ]);
  });

  it('narrows the search to a typed prefix or a selected exchange', async () => {
    const { a, b, router } = setup();
    const searchA = vi.spyOn(a, 'search');
    const searchB = vi.spyOn(b, 'search');
    expect((await router.search('feed-b:btc')).map((s) => s.symbol)).toEqual(['FEED-B:BTC/USD']);
    expect(searchA).not.toHaveBeenCalled();
    expect(searchB).toHaveBeenCalledWith('btc');
    expect((await router.search('btc', { exchange: 'Feed A' })).map((s) => s.symbol)).toEqual([
      'FEED-A:BTC/USD',
      'FEED-A:BTC/USD:USD',
    ]);
    expect(searchB).toHaveBeenCalledTimes(1);
    expect(router.searchFilters).toEqual({
      exchanges: [
        { value: 'Feed A', label: 'Feed A' },
        { value: 'FEED-B', label: 'FEED-B' },
      ],
    });
  });

  it('reports a failed route and keeps the others', async () => {
    const { a } = setup();
    const broken: DataSource = { ...a, search: async () => Promise.reject(new Error('feed down')) };
    const onError = vi.fn();
    const router = createDataSourceRouter({ A: { source: a }, B: { source: broken, name: 'Broken' } }, { onError });
    expect((await router.search('btc')).map((s) => s.symbol)).toEqual(['A:BTC/USD', 'A:BTC/USD:USD']);
    expect(onError).toHaveBeenCalledWith(new Error('feed down'), { prefix: 'B', name: 'Broken' });

    // Without `onError`, a development warning, once per route.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const quiet = createDataSourceRouter({ A: { source: a }, B: { source: broken } });
    await quiet.search('btc');
    await quiet.search('eth');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('[search-route-failed]');
  });

  it('rejects a search only when every route failed', async () => {
    const down = (message: string): DataSource => ({
      ...fake([], 0),
      search: () => {
        throw new Error(message);
      },
    });
    const onError = vi.fn();
    const router = createDataSourceRouter({ A: { source: down('a down') }, B: { source: down('b down') } }, { onError });
    await expect(router.search('x')).rejects.toThrow('a down');
    expect(onError).toHaveBeenCalledTimes(2);
    const odd: DataSource = { ...fake([], 0), search: async () => 'nope' as unknown as SymbolInfo[] };
    await expect(createDataSourceRouter({ A: { source: odd } }, { onError }).search('x')).rejects.toThrow(TypeError);
  });
});
