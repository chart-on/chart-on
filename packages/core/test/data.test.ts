import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataController, type DataTarget } from '../src/data/controller';
import type { PriceFormat } from '../src/util/price-format';
import { HistoryGate } from '../src/data/history-gate';
import {
  createMockDataSource,
  createRestDataSource,
  createStaticDataSource,
  createWebSocketDataSource,
  parseCsv,
  type SocketLike,
} from '../src/data/adapters';
import { intervalSeconds, normalizeBars, sliceBars } from '../src/data/util';
import type { BarsRequest, BarsResult, DataEvents, DataSource, SymbolInfo } from '../src/data/types';
import type { Bar } from '../src/types';

const bar = (time: number, close = 10): Bar => ({ time, open: close, high: close + 1, low: close - 1, close });
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => bar((from + i) * 60, from + i));

interface Call {
  symbol: string;
  interval: string;
  request: BarsRequest;
  resolve: (result: BarsResult) => void;
  reject: (error: unknown) => void;
}

/** Data source whose history calls are settled by the test. */
function fakeSource() {
  const calls: Call[] = [];
  const live: { symbol: string; interval: string; onBar: (bar: Bar) => void; closed: boolean }[] = [];
  const source: DataSource = {
    symbol: async (symbol) => ({ symbol, name: symbol, precision: symbol === 'P3' ? 3 : undefined }),
    search: async () => [],
    history: (symbol, interval, request) =>
      new Promise((resolve, reject) => calls.push({ symbol: symbol.symbol, interval, request, resolve, reject })),
    stream(symbol, interval, onBar) {
      const sub = { symbol: symbol.symbol, interval, onBar, closed: false };
      live.push(sub);
      return () => (sub.closed = true);
    },
  };
  return { source, calls, live };
}

function setup(options = {}) {
  const fake = fakeSource();
  const shown: Bar[][] = [];
  const updates: Bar[] = [];
  const formats: (PriceFormat | undefined)[] = [];
  const events: { name: keyof DataEvents; payload: unknown }[] = [];
  const target: DataTarget = {
    setData: (bars) => shown.push(bars.slice()),
    update: (b) => updates.push(b),
    setPriceFormat: (f) => formats.push(f),
  };
  const controller = new DataController(
    fake.source,
    target,
    (name, payload) => events.push({ name, payload }),
    { initialBars: 100, pageBars: 50, ...options },
  );
  return { ...fake, controller, shown, updates, formats, events };
}

/** Let symbol and other microtasks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('DataController', () => {
  it('loads the initial range and subscribes', async () => {
    const t = setup();
    const done = t.controller.setSymbol('P3', '1m');
    expect(t.controller.loading).toBe(true);
    await flush();
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.request).toMatchObject({ kind: 'initial', limit: 100 });
    expect(t.live).toHaveLength(1);
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    expect(t.shown).toEqual([range(10, 20)]);
    expect(t.formats).toEqual([{ type: 'decimal', precision: 3 }]);
    expect(t.controller.symbol?.symbol).toBe('P3');
    expect(t.controller.loading).toBe(false);
    expect(t.events.map((e) => e.name)).toEqual(['data:loading', 'data:loaded', 'interval:change']);
  });

  it('pages older history once at a time and stops after atStart', async () => {
    const t = setup();
    const done = t.controller.setSymbol('A', '1m');
    await flush();
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;

    const page = t.controller.loadMore();
    expect(t.controller.loadMore()).toBe(page);
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]!.request).toMatchObject({ kind: 'history', to: 600, limit: 50 });
    // Overlapping bars from the source are not duplicated.
    t.calls[1]!.resolve({ bars: range(5, 11) });
    await page;
    expect(t.shown.at(-1)).toEqual(range(5, 20));

    const last = t.controller.loadMore();
    t.calls[2]!.resolve({ bars: range(0, 5), atStart: true });
    await last;
    expect(t.shown.at(-1)).toEqual(range(0, 20));
    expect(t.controller.hasMoreHistory).toBe(false);
    await t.controller.loadMore();
    expect(t.calls).toHaveLength(3);
  });

  it('treats an empty page as the end of history', async () => {
    const t = setup();
    const done = t.controller.setSymbol('A', '1m');
    await flush();
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    const page = t.controller.loadMore();
    t.calls[1]!.resolve({ bars: [] });
    await page;
    expect(t.controller.hasMoreHistory).toBe(false);
  });

  it('switches interval, aborting the request in flight and ignoring its answer', async () => {
    const t = setup();
    const first = t.controller.setSymbol('A', '1m');
    await flush();
    const stale = t.calls[0]!;
    const second = t.controller.setSymbol('A', '5m');
    expect(stale.request.signal.aborted).toBe(true);
    expect(t.live[0]!.closed).toBe(true);
    await flush();
    stale.resolve({ bars: range(0, 5) });
    t.calls[1]!.resolve({ bars: range(100, 110) });
    await Promise.all([first, second]);
    expect(t.shown).toEqual([range(100, 110)]);
    expect(t.controller.interval).toBe('5m');
  });

  it('reuses cached bars and only fetches the newer tail', async () => {
    const t = setup();
    let done = t.controller.setSymbol('A', '1m');
    await flush();
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    done = t.controller.setSymbol('B', '1m');
    await flush();
    t.calls[1]!.resolve({ bars: range(50, 60) });
    await done;

    done = t.controller.setSymbol('A', '1m');
    await flush();
    expect(t.calls[2]!.request).toMatchObject({ kind: 'refresh', from: 19 * 60 });
    t.calls[2]!.resolve({ bars: range(19, 22) });
    await done;
    expect(t.calls).toHaveLength(3);
    expect(t.shown.at(-1)).toEqual(range(10, 22));
  });

  it('reloads fully when the cached tail gap is larger than a page', async () => {
    const t = setup({ pageBars: 2 });
    let done = t.controller.setSymbol('A', '1m');
    await flush();
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    done = t.controller.setSymbol('B', '1m');
    await flush();
    t.calls[1]!.resolve({ bars: range(0, 1) });
    await done;
    done = t.controller.setSymbol('A', '1m');
    await flush();
    t.calls[2]!.resolve({ bars: range(19, 30) });
    await flush();
    expect(t.calls[3]!.request.kind).toBe('initial');
    t.calls[3]!.resolve({ bars: range(25, 30) });
    await done;
    expect(t.shown.at(-1)).toEqual(range(25, 30));
  });

  it('merges live bars and buffers those that arrive while loading', async () => {
    const t = setup();
    const done = t.controller.setSymbol('A', '1m');
    await flush();
    const push = t.live[0]!.onBar;
    push(bar(19 * 60, 50)); // during load: buffered
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    expect(t.updates).toEqual([bar(19 * 60, 50)]);

    push(bar(20 * 60, 51)); // newer: append
    push(bar(20 * 60, 52)); // same time: replace
    push(bar(5 * 60, 1)); // older: dropped
    push({ ...bar(21 * 60), high: 0 }); // invalid: dropped
    expect(t.updates.slice(1)).toEqual([bar(20 * 60, 51), bar(20 * 60, 52)]);
    expect(t.controller.dropped).toBe(2);
    const merged = t.events.filter((e) => e.name === 'data:bar').map((e) => e.payload);
    expect(merged).toEqual([
      { bar: bar(19 * 60, 50), appended: false },
      { bar: bar(20 * 60, 51), appended: true },
      { bar: bar(20 * 60, 52), appended: false },
    ]);
  });

  it('reports load errors and rejects', async () => {
    const t = setup();
    const done = t.controller.setSymbol('A', '1m');
    await flush();
    t.calls[0]!.reject(new Error('offline'));
    await expect(done).rejects.toThrow('offline');
    expect(t.events.at(-1)).toMatchObject({ name: 'data:error', payload: { kind: 'initial', symbol: 'A' } });
    expect(t.live[0]!.closed).toBe(true);
  });

  it('dedupes repeated setSymbol calls for the same symbol and interval', async () => {
    const t = setup();
    const a = t.controller.setSymbol('A', '1m');
    expect(t.controller.setSymbol('A', '1m')).toBe(a);
    await flush();
    expect(t.calls).toHaveLength(1);
  });
});

/** A controller wired to a history gate the way the chart wires them. */
function pagingSetup() {
  const gate = new HistoryGate();
  let first: number | undefined;
  const fake = fakeSource();
  const target: DataTarget = {
    setData: (bars, kind) => {
      first = bars[0]?.time;
      if (kind === 'initial') gate.reset();
    },
    update: () => {},
    setPriceFormat: () => {},
  };
  const controller = new DataController(fake.source, target, () => {}, { initialBars: 100, pageBars: 50 });
  /** The view sits near the first bar; `view` stands for the visible range. */
  const scroll = (view = 'left') => {
    if (first !== undefined) gate.request(first, view, () => controller.loadMore());
  };
  const historyCalls = () => fake.calls.filter((c) => c.request.to !== undefined);
  return { ...fake, controller, scroll, historyCalls };
}

describe('history paging', () => {
  it('pages again after a history request is aborted by a switch and the view returns', async () => {
    const t = pagingSetup();
    let done = t.controller.setSymbol('A', '1m');
    await flush();
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    t.scroll();
    const aborted = t.historyCalls()[0]!;

    done = t.controller.setSymbol('A', '5m');
    expect(aborted.request.signal.aborted).toBe(true);
    await flush();
    t.calls.at(-1)!.resolve({ bars: range(100, 110) });
    await done;
    aborted.reject(new DOMException('aborted', 'AbortError'));

    // Back to the cached series: same first bar as the aborted page.
    done = t.controller.setSymbol('A', '1m');
    await flush();
    t.calls.at(-1)!.resolve({ bars: range(19, 20) });
    await done;
    t.scroll();
    expect(t.historyCalls()).toHaveLength(2);
    expect(t.historyCalls()[1]!.request).toMatchObject({ to: 600 });
  });

  it('retries a failed history page on the next scroll, not while the view is idle', async () => {
    const t = pagingSetup();
    const done = t.controller.setSymbol('A', '1m');
    await flush();
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    t.scroll('a');
    const page = t.controller.loadMore();
    t.historyCalls()[0]!.reject(new Error('offline'));
    expect(await page).toBe(false);
    await flush();

    t.scroll('a');
    expect(t.historyCalls()).toHaveLength(1);
    t.scroll('b');
    expect(t.historyCalls()).toHaveLength(2);
    expect(t.historyCalls()[1]!.request).toMatchObject({ to: 600 });
  });

  it('pages a new symbol that starts at the same time as the previous one', async () => {
    const t = pagingSetup();
    let done = t.controller.setSymbol('A', '1m');
    await flush();
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    t.scroll();
    const page = t.controller.loadMore();
    t.historyCalls()[0]!.resolve({ bars: [], atStart: true });
    expect(await page).toBe(true);

    done = t.controller.setSymbol('B', '1m');
    await flush();
    t.calls.at(-1)!.resolve({ bars: range(10, 20) });
    await done;
    t.scroll();
    expect(t.historyCalls()).toHaveLength(2);
    expect(t.historyCalls()[1]).toMatchObject({ symbol: 'B', request: { to: 600 } });
  });
});

describe('data utilities', () => {
  it('parses intervals', () => {
    expect(intervalSeconds('15m')).toBe(900);
    expect(intervalSeconds('4h')).toBe(14400);
    expect(intervalSeconds('d')).toBe(86400);
    expect(() => intervalSeconds('1x')).toThrow();
    expect(() => intervalSeconds('0m')).toThrow();
  });

  it('sorts, dedupes and validates bars', () => {
    expect(normalizeBars([bar(120, 2), bar(60), bar(120, 3), { ...bar(180), low: 99 }])).toEqual([bar(60), bar(120, 3)]);
  });

  it('slices a request out of a series', () => {
    const all = range(0, 10);
    expect(sliceBars(all, { limit: 3 })).toEqual({ bars: range(7, 10), atStart: false });
    expect(sliceBars(all, { to: 3 * 60, limit: 5 })).toEqual({ bars: range(0, 3), atStart: true });
    expect(sliceBars(all, { from: 8 * 60, limit: 5 }).bars).toEqual(range(8, 10));
  });

  it('parses CSV with or without a header', () => {
    const csv = 'Date,Open,High,Low,Close,Volume\n2024-01-02,10,12,9,11,100\n\n2024-01-01,9,10,8,10,\nbad,row';
    expect(parseCsv(csv)).toEqual([
      { time: 1704067200, open: 9, high: 10, low: 8, close: 10 },
      { time: 1704153600, open: 10, high: 12, low: 9, close: 11, volume: 100 },
    ]);
    expect(parseCsv('time;open;high;low;close\n1704067200000;1;2;0.5;1.5', { delimiter: ';' })).toEqual([
      { time: 1704067200, open: 1, high: 2, low: 0.5, close: 1.5 },
    ]);
    expect(parseCsv('60,1,2,0,1\n120,1,3,1,2')).toHaveLength(2);
  });
});

const info: SymbolInfo = { symbol: 'X', name: 'X' };
const req = (r: Partial<BarsRequest> = {}): BarsRequest => ({
  kind: 'initial',
  limit: 100,
  signal: new AbortController().signal,
  ...r,
});

describe('static data source', () => {
  it('pages through in-memory bars', async () => {
    const source = createStaticDataSource({
      symbols: [info, { symbol: 'Y', name: 'Other', description: 'second' }],
      bars: (symbol) => (symbol === 'X' ? range(0, 10) : undefined),
    });
    expect((await source.search('sec')).map((s) => s.symbol)).toEqual(['Y']);
    await expect(source.symbol('Z')).rejects.toThrow(/Unknown/);
    expect(await source.history(info, '1m', req({ limit: 4 }))).toEqual({ bars: range(6, 10), atStart: false });
    expect(await source.history(info, '1m', req({ to: 6 * 60, limit: 10 }))).toEqual({ bars: range(0, 6), atStart: true });
  });
});

describe('REST data source', () => {
  it('builds the URL, passes the abort signal and maps the response', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ t: [60], o: [1], h: [2], l: [0], c: [1] })));
    const source = createRestDataSource({
      url: (s, interval, r) => `https://example.test/bars?s=${s.symbol}&i=${interval}&n=${r.limit}`,
      map: (json) => {
        const j = json as Record<string, number[]>;
        return j.t!.map((time, i) => ({ time, open: j.o![i]!, high: j.h![i]!, low: j.l![i]!, close: j.c![i]! }));
      },
      fetch: fetchMock as unknown as typeof fetch,
    });
    const request = req({ limit: 5 });
    expect(await source.symbol('X')).toEqual(info);
    expect(await source.history(info, '1h', request)).toEqual({ bars: [{ time: 60, open: 1, high: 2, low: 0, close: 1 }] });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://example.test/bars?s=X&i=1h&n=5');
    expect(fetchMock.mock.calls[0]![1]!.signal).toBe(request.signal);
  });

  it('fails on HTTP errors', async () => {
    const source = createRestDataSource({
      url: () => 'https://example.test',
      map: () => [],
      fetch: (async () => new Response('', { status: 503 })) as unknown as typeof fetch,
    });
    await expect(source.history(info, '1m', req())).rejects.toThrow(/503/);
  });
});

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
}

describe('WebSocket data source', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function socketSource() {
    const sockets: FakeSocket[] = [];
    const source = createWebSocketDataSource({
      url: 'wss://example.test',
      history: createStaticDataSource({ symbols: [info], bars: () => [] }),
      subscribeMessage: (s, interval) => ({ op: 'sub', key: `${s.symbol}:${interval}` }),
      unsubscribeMessage: (s, interval) => ({ op: 'unsub', key: `${s.symbol}:${interval}` }),
      parse: (m) => {
        const msg = m as { key?: string; bar?: Bar };
        return msg.key && msg.bar ? { key: msg.key, bar: msg.bar } : null;
      },
      reconnect: { minMs: 100, maxMs: 1000 },
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    return { source, sockets };
  }

  it('subscribes on open and routes parsed bars to listeners', () => {
    const { source, sockets } = socketSource();
    const got: Bar[] = [];
    const off = source.stream!(info, '1m', (b) => got.push(b));
    const ws = sockets[0]!;
    ws.open();
    expect(ws.sent).toEqual([{ op: 'sub', key: 'X:1m' }]);
    ws.receive({ key: 'X:1m', bar: bar(60) });
    ws.receive({ key: 'X:5m', bar: bar(60) });
    // Invalid bars reach the chart, which drops and reports them.
    ws.receive({ key: 'X:1m', bar: { ...bar(120), high: 0 } });
    ws.receive('not json');
    expect(got).toEqual([bar(60), { ...bar(120), high: 0 }]);
    off();
    expect(ws.sent.at(-1)).toEqual({ op: 'unsub', key: 'X:1m' });
    expect(ws.readyState).toBe(3);
  });

  it('reconnects with backoff and resubscribes', () => {
    vi.useFakeTimers();
    const { source, sockets } = socketSource();
    source.stream!(info, '1m', () => {});
    sockets[0]!.open();
    sockets[0]!.close();
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(150);
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(sockets[1]!.sent).toEqual([{ op: 'sub', key: 'X:1m' }]);
  });

  /** Close the newest socket and return the ms until the next one is created. */
  function nextDelay(sockets: FakeSocket[], openFor: number | null): number {
    const ws = sockets.at(-1)!;
    if (openFor !== null) {
      ws.open();
      vi.advanceTimersByTime(openFor);
    }
    ws.close();
    const count = sockets.length;
    let waited = 0;
    while (sockets.length === count) {
      vi.advanceTimersByTime(10);
      waited += 10;
    }
    return waited;
  }

  it('keeps backing off when the server closes right after opening', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { source, sockets } = socketSource();
    source.stream!(info, '1m', () => {});
    const delays = Array.from({ length: 6 }, () => nextDelay(sockets, 0));
    expect(delays).toEqual([100, 200, 400, 800, 1000, 1000]);
  });

  it('resets the backoff after a connection that held', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { source, sockets } = socketSource();
    source.stream!(info, '1m', () => {});
    expect([nextDelay(sockets, null), nextDelay(sockets, 0), nextDelay(sockets, 0)]).toEqual([100, 200, 400]);
    expect(nextDelay(sockets, 100)).toBe(100);
  });
});

describe('mock data source', () => {
  afterEach(() => vi.useRealTimers());

  it('is deterministic, pages to atStart and streams live bars', async () => {
    vi.useFakeTimers();
    let now = 1_700_000_000_000;
    const make = () => createMockDataSource({ historyBars: 50, tickMs: 100, now: () => now });
    const a = make();
    const sym = await a.symbol('DEMO');
    const first = await a.history(sym, '1m', req({ limit: 30 }));
    expect(first.bars).toHaveLength(30);
    expect(first.atStart).toBe(false);
    expect(await make().history(sym, '1m', req({ limit: 30 }))).toEqual(first);
    const older = await a.history(sym, '1m', req({ to: first.bars[0]!.time, limit: 30 }));
    expect(older).toMatchObject({ atStart: true });
    expect(older.bars).toHaveLength(20);

    const got: Bar[] = [];
    const off = a.stream!(sym, '1m', (b) => got.push(b));
    vi.advanceTimersByTime(100);
    expect(got.at(-1)!.time).toBe(first.bars.at(-1)!.time);
    now += 60_000;
    vi.advanceTimersByTime(100);
    expect(got.at(-1)!.time).toBe(first.bars.at(-1)!.time + 60);
    a.setPaused(true);
    vi.advanceTimersByTime(500);
    const count = got.length;
    // The forming bar, then the finished bar and the new one.
    expect(count).toBe(3);
    off();
  });
});
