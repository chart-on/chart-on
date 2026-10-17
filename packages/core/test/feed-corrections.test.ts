import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { DataController, type DataControllerOptions, type DataTarget } from '../src/data/controller';
import { createMockDataSource, createWebSocketDataSource, type SocketLike } from '../src/data/adapters';
import type {
  BarsRequest,
  BarsReset,
  BarsResult,
  DataEvents,
  DataSource,
  FeedStatus,
  ResetRange,
  SymbolInfo,
} from '../src/data/types';
import type { Bar } from '../src/types';

const bar = (time: number, close = 10): Bar => ({ time, open: close, high: close + 1, low: close - 1, close });
/** Minute bars `from`..`to - 1` (times in minutes), closing at their minute. */
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => bar((from + i) * 60, from + i));

interface Call {
  symbol: string;
  interval: string;
  request: BarsRequest;
  resolve: (result: BarsResult) => void;
  reject: (error: unknown) => void;
}

interface Sub {
  symbol: string;
  onBar: (bar: Bar) => void;
  onReset?: (range?: ResetRange) => void;
}

/** Data source whose history calls are settled by the test, with resets and a connection status. */
function fakeSource() {
  const calls: Call[] = [];
  const subs: Sub[] = [];
  const statusListeners = new Set<(status: FeedStatus) => void>();
  const resetListeners = new Set<(reset: BarsReset) => void>();
  const source: DataSource = {
    symbol: async (symbol) => ({ symbol, name: symbol }),
    search: async () => [],
    history: (symbol, interval, request) =>
      new Promise((resolve, reject) => calls.push({ symbol: symbol.symbol, interval, request, resolve, reject })),
    stream(symbol, interval, onBar) {
      // The subscription's resets go out through the source-level `onReset`.
      const onReset = (range?: ResetRange) => {
        for (const l of [...resetListeners]) l({ symbol: symbol.symbol, interval, range });
      };
      subs.push({ symbol: symbol.symbol, onBar, onReset });
      return () => {};
    },
    onReset(listener) {
      resetListeners.add(listener);
      return () => resetListeners.delete(listener);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
  };
  const status = (state: FeedStatus['state'], since: number) => {
    for (const l of statusListeners) l({ state, since });
  };
  /** A reset through the source-level `onReset`, as a source without a stream reports one. */
  const reset = (value: BarsReset) => {
    for (const l of [...resetListeners]) l(value);
  };
  return { source, calls, subs, status, reset };
}

function setup(options: Partial<DataControllerOptions> = {}, source = fakeSource()) {
  const shown: Bar[][] = [];
  const kinds: string[] = [];
  const events: { name: keyof DataEvents; payload: unknown }[] = [];
  const target: DataTarget = {
    setData: (bars, kind) => {
      shown.push(bars.slice());
      kinds.push(kind);
    },
    update: () => {},
    setPriceFormat: () => {},
  };
  const controller = new DataController(source.source, target, (name, payload) => events.push({ name, payload }), {
    initialBars: 100,
    pageBars: 50,
    ...options,
  });
  const named = (name: keyof DataEvents) => events.filter((e) => e.name === name).map((e) => e.payload);
  return { ...source, controller, shown, kinds, events, named };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Load A at 1m with bars 10..19 (times 600..1140). */
async function loaded(options: Partial<DataControllerOptions> = {}) {
  const t = setup(options);
  const done = t.controller.setSymbol('A', '1m');
  await flush();
  t.calls[0]!.resolve({ bars: range(10, 20) });
  await done;
  return t;
}

describe('onReset', () => {
  it('refetches the whole series, dropping a history page in flight', async () => {
    const t = await loaded();
    const page = t.controller.loadMore();
    t.subs[0]!.onReset!();
    expect(t.calls).toHaveLength(3);
    const reset = t.calls[2]!;
    expect(reset.request).toMatchObject({ kind: 'reset', limit: 100 });
    expect(reset.request.from).toBeUndefined();
    expect(reset.request.to).toBeUndefined();
    // No new page while the series is being replaced.
    const again = t.controller.loadMore();
    expect(t.calls).toHaveLength(3);

    t.calls[1]!.resolve({ bars: range(0, 10) });
    expect(await page).toBe(false);
    expect(await again).toBe(false);
    expect(await t.controller.loadMore()).toBe(false);
    reset.resolve({ bars: range(12, 21) });
    await flush();
    expect(t.shown.at(-1)).toEqual(range(12, 21));
    expect(t.kinds.at(-1)).toBe('reset');
    expect(t.named('data:reset')).toEqual([{ symbol: t.controller.symbol, interval: '1m', range: undefined }]);
    expect(t.named('data:loaded').at(-1)).toMatchObject({ kind: 'reset' });

    // Paging resumes from the new first bar.
    void t.controller.loadMore();
    expect(t.calls.at(-1)!.request).toMatchObject({ to: 12 * 60 });
  });

  it('waits for an initial load in flight and ignores resets of an interval no longer shown', async () => {
    const t = setup();
    const done = t.controller.setSymbol('A', '1m');
    await flush();
    t.subs[0]!.onReset!({ from: 15 * 60 });
    expect(t.calls).toHaveLength(1);
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]!.request).toMatchObject({ from: 15 * 60, limit: 50 });
    t.calls[1]!.resolve({ bars: range(15, 20).map((b) => ({ ...b, close: 1, low: 0, open: 1 })) });
    await flush();

    const next = t.controller.setSymbol('A', '5m');
    await flush();
    t.subs[0]!.onReset!();
    expect(t.calls).toHaveLength(3);
    t.calls[2]!.resolve({ bars: range(100, 110) });
    await next;
    expect(t.named('data:reset')).toHaveLength(1);
  });

  it('refetches for a source without a stream, only for the symbol and interval shown', async () => {
    const source = fakeSource();
    delete source.source.stream;
    const t = setup({}, source);
    const done = t.controller.setSymbol('A', '1m');
    await flush();
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;

    t.reset({ symbol: 'B', range: { from: 15 * 60 } });
    t.reset({ symbol: 'A', interval: '5m', range: { from: 15 * 60 } });
    expect(t.calls).toHaveLength(1);
    // No interval: every interval of the symbol, the one shown included.
    t.reset({ symbol: 'A', range: { from: 15 * 60 } });
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]!.request).toMatchObject({ kind: 'reset', from: 15 * 60, limit: 50 });
    t.calls[1]!.resolve({ bars: range(15, 20).map((b) => ({ ...b, close: 1, low: 0, open: 1 })) });
    await flush();
    expect(t.shown.at(-1)!.slice(5).every((b) => b.close === 1)).toBe(true);
    expect(t.named('data:reset')).toEqual([{ symbol: t.controller.symbol, interval: '1m', range: { from: 15 * 60 } }]);
  });

  it('replaces only the bars inside a range', async () => {
    const t = await loaded();
    const live: Bar[] = [];
    t.subs[0]!.onReset!({ from: 13 * 60, to: 15 * 60 });
    expect(t.calls[1]!.request).toMatchObject({ from: 13 * 60, to: 15 * 60, limit: 50 });
    // Bars outside the range are not touched, even if the source sends them.
    t.calls[1]!.resolve({ bars: [bar(13 * 60, 99), bar(16 * 60, 99), bar(5 * 60, 99)] });
    await flush();
    live.push(...t.shown.at(-1)!);
    const expected = [...range(10, 13), bar(13 * 60, 99), ...range(15, 20)];
    expect(live).toEqual(expected);
    expect(t.named('data:reset')).toEqual([
      { symbol: t.controller.symbol, interval: '1m', range: { from: 13 * 60, to: 15 * 60 } },
    ]);
  });

  it('falls back to a full reset when a range holds a page or more', async () => {
    const t = await loaded({ pageBars: 3 });
    t.subs[0]!.onReset!({ from: 10 * 60 });
    t.calls[1]!.resolve({ bars: range(10, 13) });
    await flush();
    expect(t.calls).toHaveLength(3);
    expect(t.calls[2]!.request.from).toBeUndefined();
  });

  it('treats an inverted range as malformed and refetches everything', async () => {
    const t = await loaded();
    t.subs[0]!.onReset!({ from: 15 * 60, to: 12 * 60 });
    expect(t.calls[1]!.request.from).toBeUndefined();
    expect(t.calls[1]!.request.to).toBeUndefined();
    t.calls[1]!.resolve({ bars: range(10, 20) });
    await flush();
    expect(t.shown.at(-1)).toEqual(range(10, 20));
    expect(t.named('data:reset')).toEqual([{ symbol: t.controller.symbol, interval: '1m', range: undefined }]);
    // The cached series is intact: switching back patches its tail and shows it unchanged.
    const away = t.controller.setSymbol('A', '5m');
    await flush();
    t.calls[2]!.resolve({ bars: range(100, 110) });
    await away;
    const back = t.controller.setSymbol('A', '1m');
    await flush();
    t.calls[3]!.resolve({ bars: [] });
    await back;
    expect(t.shown.at(-1)).toEqual(range(10, 20));
  });

  it('keeps a newer overlapping reset when an older one resolves after it', async () => {
    const t = await loaded();
    t.subs[0]!.onReset!({ from: 12 * 60, to: 16 * 60 });
    t.subs[0]!.onReset!({ from: 14 * 60, to: 15 * 60 });
    t.calls[2]!.resolve({ bars: [bar(14 * 60, 2)] });
    await flush();
    t.calls[1]!.resolve({ bars: [bar(12 * 60, 1), bar(13 * 60, 1), bar(14 * 60, 1), bar(15 * 60, 1)] });
    await flush();
    expect(t.shown.at(-1)).toEqual([
      ...range(10, 12),
      bar(12 * 60, 1),
      bar(13 * 60, 1),
      bar(14 * 60, 2),
      bar(15 * 60, 1),
      ...range(16, 20),
    ]);

    // An older full reset landing after a newer range keeps that range's bars too.
    t.subs[0]!.onReset!();
    t.subs[0]!.onReset!({ from: 18 * 60, to: 19 * 60 });
    t.calls[4]!.resolve({ bars: [bar(18 * 60, 3)] });
    await flush();
    t.calls[3]!.resolve({ bars: range(10, 20) });
    await flush();
    expect(t.shown.at(-1)).toEqual([...range(10, 18), bar(18 * 60, 3), ...range(19, 20)]);
  });

  it('holds live bars back during a reset, so the forming bar keeps its live value', async () => {
    const t = await loaded();
    t.subs[0]!.onReset!();
    const forming = bar(19 * 60, 77);
    t.subs[0]!.onBar(forming);
    t.calls[1]!.resolve({ bars: range(10, 20) });
    await flush();
    expect(t.named('data:bar')).toEqual([{ bar: forming, appended: false }]);
  });
});

describe('reload and clearCache', () => {
  it('reload aborts requests in flight and emits one data:loaded', async () => {
    const t = await loaded();
    const page = t.controller.loadMore();
    const before = t.named('data:loaded').length;
    const done = t.controller.reload();
    expect(t.calls[1]!.request.signal.aborted).toBe(true);
    await flush();
    // The cache was dropped: a first load, not a tail refresh.
    expect(t.calls[2]!.request).toMatchObject({ limit: 100 });
    t.calls[1]!.resolve({ bars: range(0, 10) });
    t.calls[2]!.resolve({ bars: range(11, 21) });
    await done;
    expect(await page).toBe(false);
    expect(t.named('data:loaded').slice(before)).toEqual([
      { symbol: t.controller.symbol, interval: '1m', kind: 'initial', bars: range(11, 21) },
    ]);
  });

  it('reload replaces an initial load in flight', async () => {
    const t = setup();
    const first = t.controller.setSymbol('A', '1m');
    await flush();
    const second = t.controller.reload();
    expect(t.calls[0]!.request.signal.aborted).toBe(true);
    await flush();
    t.calls[0]!.resolve({ bars: range(0, 5) });
    t.calls[1]!.resolve({ bars: range(10, 20) });
    await Promise.all([first, second]);
    expect(t.named('data:loaded')).toHaveLength(1);
  });

  it('reload rejects before any symbol was requested', async () => {
    await expect(setup().controller.reload()).rejects.toThrow(/setSymbol/);
  });

  it('clearCache makes a cached series load afresh', async () => {
    const t = await loaded();
    let done = t.controller.setSymbol('B', '1m');
    await flush();
    t.calls[1]!.resolve({ bars: range(10, 20) });
    await done;
    t.controller.clearCache('A');
    done = t.controller.setSymbol('A', '1m');
    await flush();
    expect(t.calls[2]!.request).toMatchObject({ kind: 'initial' });
    t.calls[2]!.resolve({ bars: range(10, 20) });
    await done;
    // B is still cached: only its tail is fetched.
    done = t.controller.setSymbol('B', '1m');
    await flush();
    expect(t.calls[3]!.request).toMatchObject({ from: 19 * 60 });
  });
});

/* ------------------------------------------------------------------ */
/* Reconnects                                                          */
/* ------------------------------------------------------------------ */

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

const info: SymbolInfo = { symbol: 'X', name: 'X' };
/** Settle promise chains without real timers. */
const ticks = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function socketSetup(options: Partial<DataControllerOptions> = {}) {
  const history = fakeSource();
  const sockets: FakeSocket[] = [];
  const ws = createWebSocketDataSource({
    url: 'wss://example.test',
    history: history.source,
    subscribeMessage: () => ({ op: 'sub' }),
    parse: (m) => {
      const msg = m as { key?: string; bar?: Bar };
      return msg.key && msg.bar ? { key: msg.key, bar: msg.bar } : null;
    },
    reconnect: { minMs: 100, maxMs: 100 },
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
  });
  const t = setup(options, { ...history, source: ws });
  return { ...t, sockets };
}

describe('reconnect gap-fill', () => {
  afterEach(() => vi.useRealTimers());

  async function connected(options: Partial<DataControllerOptions> = {}) {
    vi.useFakeTimers();
    vi.setSystemTime(1170 * 1000);
    const t = socketSetup(options);
    const done = t.controller.setSymbol(info.symbol, '1m');
    await ticks();
    t.sockets[0]!.open();
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    return t;
  }

  it('refetches exactly the missed bars and merges them', async () => {
    const t = await connected();
    expect(t.named('data:reconnect')).toEqual([]);
    t.sockets[0]!.close();
    expect(t.controller.connection?.state).toBe('reconnecting');
    expect(t.named('data:reconnecting')).toEqual([{ since: 1170 }]);
    vi.advanceTimersByTime(150);
    vi.setSystemTime(1290 * 1000);
    t.sockets[1]!.open();
    expect(t.named('data:reconnect')).toEqual([{ gap: 120 }]);
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]!.request).toMatchObject({ kind: 'reset', from: 19 * 60, limit: 50 });
    expect(t.calls[1]!.request.to).toBeUndefined();

    // A live tick of the forming bar arrives while the gap is fetched.
    t.sockets[1]!.receive({ key: 'X:1m', bar: bar(21 * 60, 77) });
    t.calls[1]!.resolve({ bars: [bar(19 * 60, 50), bar(20 * 60, 20), bar(21 * 60, 21)] });
    await ticks();
    expect(t.shown.at(-1)).toEqual([...range(10, 19), bar(19 * 60, 50), bar(20 * 60, 20), bar(21 * 60, 21)]);
    expect(t.named('data:bar')).toEqual([{ bar: bar(21 * 60, 77), appended: false }]);
    // A gap fill is not a source reset.
    expect(t.named('data:reset')).toEqual([]);
    expect(t.controller.stale).toBe(false);
  });

  it('marks a gap above the limit as stale instead of refetching', async () => {
    const t = await connected({ maxGapFillSeconds: 60 });
    t.sockets[0]!.close();
    vi.setSystemTime(1290 * 1000);
    vi.advanceTimersByTime(150);
    t.sockets[1]!.open();
    expect(t.named('data:reconnect')).toHaveLength(1);
    expect(t.named('data:stale')).toHaveLength(1);
    expect((t.named('data:stale')[0] as { gap: number }).gap).toBeGreaterThan(60);
    expect(t.calls).toHaveLength(1);
    expect(t.controller.stale).toBe(true);

    // A reload brings the series back up to date.
    const done = t.controller.reload();
    await ticks();
    t.calls.at(-1)!.resolve({ bars: range(10, 22) });
    await done;
    expect(t.controller.stale).toBe(false);
  });

  it('fills a gap from a reconnect during the initial load once it lands', async () => {
    const t = setup();
    const done = t.controller.setSymbol('A', '1m');
    await flush();
    t.status('reconnecting', 1150);
    t.status('connected', 1200);
    expect(t.calls).toHaveLength(1);
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]!.request).toMatchObject({ kind: 'reset', from: 19 * 60, limit: 50 });
  });

  it('marks a long outage during the initial load as stale once it lands', async () => {
    const t = setup({ maxGapFillSeconds: 10 });
    const done = t.controller.setSymbol('A', '1m');
    await flush();
    t.status('reconnecting', 1000);
    t.status('connected', 1200);
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    expect(t.calls).toHaveLength(1);
    expect(t.controller.stale).toBe(true);
    expect(t.named('data:stale')).toEqual([{ gap: 200, reason: 'outage' }]);
  });

  it('does not fill a gap across an intentional disconnect', async () => {
    const t = setup();
    const done = t.controller.setSymbol('A', '1m');
    await flush();
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    t.status('reconnecting', 100);
    t.status('disconnected', 110);
    t.status('connected', 200);
    expect(t.named('data:reconnect')).toEqual([]);
    expect(t.calls).toHaveLength(1);
  });

  it('reports the WebSocket connection state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5000 * 1000);
    const sockets: FakeSocket[] = [];
    const ws = createWebSocketDataSource({
      url: 'wss://example.test',
      history: fakeSource().source,
      subscribeMessage: () => 'sub',
      parse: () => null,
      reconnect: { minMs: 100, maxMs: 100 },
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    const seen: FeedStatus[] = [];
    const off = ws.onStatus!((s) => seen.push(s));
    const unsubscribe = ws.stream!(info, '1m', () => {});
    sockets[0]!.open();
    sockets[0]!.close();
    vi.advanceTimersByTime(150);
    sockets[1]!.open();
    unsubscribe();
    expect(seen.map((s) => s.state)).toEqual(['connected', 'reconnecting', 'connected', 'disconnected']);
    expect(seen[0]!.since).toBe(5000);
    off();
  });

  it('lets the mock source simulate a dropped stream', () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    const mock = createMockDataSource({ tickMs: 100, now: () => now });
    const seen: FeedStatus[] = [];
    mock.onStatus!((s) => seen.push(s));
    const got: Bar[] = [];
    const off = mock.stream!({ symbol: 'DEMO', name: 'DEMO' }, '1m', (b) => got.push(b));
    mock.setConnected(false);
    vi.advanceTimersByTime(500);
    expect(got).toHaveLength(0);
    mock.setConnected(true);
    vi.advanceTimersByTime(100);
    expect(got).toHaveLength(1);
    expect(seen).toEqual([
      { state: 'reconnecting', since: now / 1000 },
      { state: 'connected', since: now / 1000 },
    ]);
    off();
  });
});

/* ------------------------------------------------------------------ */
/* Chart                                                               */
/* ------------------------------------------------------------------ */

describe('chart integration', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  function chart(source: DataSource) {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.setDataSource(source, { initialBars: 100, pageBars: 50 });
    return c;
  }

  it('shows reconnecting, then stale for a long outage, and clears it on reload', async () => {
    let now = 1_700_000_000_000;
    const mock = createMockDataSource({ historyBars: 300, tickMs: 60_000, now: () => now });
    const c = chart(mock);
    await c.setSymbol('DEMO', '1m');
    expect(c.getStatus()).toBeNull();

    mock.setConnected(false);
    expect(c.getStatus()).toEqual({ kind: 'reconnecting' });
    mock.setConnected(true);
    expect(c.getStatus()).toBeNull();

    mock.setConnected(false);
    now += 2 * 3600 * 1000;
    mock.setConnected(true);
    expect(c.getStatus()).toEqual({ kind: 'stale' });
    // Another short drop shows reconnecting, then stale again.
    mock.setConnected(false);
    expect(c.getStatus()).toEqual({ kind: 'reconnecting' });
    mock.setConnected(true);
    expect(c.getStatus()).toEqual({ kind: 'stale' });

    await c.reload();
    expect(c.getStatus()).toBeNull();
    expect(c.data!.stale).toBe(false);
  });

  it('fills a short gap with the bars the source has now', async () => {
    let now = 1_700_000_000_000;
    const mock = createMockDataSource({ historyBars: 300, tickMs: 60_000, now: () => now });
    const c = chart(mock);
    await c.setSymbol('DEMO', '1m');
    const last = c.timeline.times.at(-1)!;
    mock.setConnected(false);
    now += 5 * 60 * 1000;
    const filled = new Promise((r) => c.on('data:loaded', r));
    mock.setConnected(true);
    await filled;
    expect(c.timeline.times.at(-1)).toBe(last + 5 * 60);
  });

  it('keeps showing reconnecting when a reset lands during the outage', async () => {
    const t = fakeSource();
    const c = chart(t.source);
    const done = c.setSymbol('A', '1m');
    await flush();
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    t.status('reconnecting', 100);
    expect(c.getStatus()).toEqual({ kind: 'reconnecting' });
    t.subs[0]!.onReset!({ from: 15 * 60 });
    t.calls[1]!.resolve({ bars: range(15, 20) });
    await flush();
    expect(c.getStatus()).toEqual({ kind: 'reconnecting' });
  });

  it('shows reconnecting once the first load lands if the stream is still down', async () => {
    const t = fakeSource();
    const c = chart(t.source);
    const done = c.setSymbol('A', '1m');
    await flush();
    t.status('reconnecting', 100);
    // The load message is not covered while the bars are on their way.
    expect(c.getStatus()).toEqual({ kind: 'loading' });
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    expect(c.getStatus()).toEqual({ kind: 'reconnecting' });
    t.status('connected', 110);
    expect(c.getStatus()).toBeNull();
  });

  it('keeps no data over a reconnect that started during the load', async () => {
    const t = fakeSource();
    const c = chart(t.source);
    const done = c.setSymbol('A', '1m');
    await flush();
    t.status('reconnecting', 100);
    t.calls[0]!.resolve({ bars: [] });
    await done;
    expect(c.getStatus()).toEqual({ kind: 'no-data' });
  });

  it('clears loading normally when the stream recovered during the load', async () => {
    const t = fakeSource();
    const c = chart(t.source);
    const done = c.setSymbol('A', '1m');
    await flush();
    t.status('reconnecting', 100);
    t.status('connected', 110);
    t.calls[0]!.resolve({ bars: range(10, 20) });
    await done;
    expect(c.getStatus()).toBeNull();
  });

  it('keeps the right edge on a reset and reloads keeping the view when asked', async () => {
    const t = fakeSource();
    const c = chart(t.source);
    const done = c.setSymbol('A', '1m');
    await flush();
    t.calls[0]!.resolve({ bars: range(10, 90) });
    await done;
    c.setVisibleTimeRange(40 * 60, 60 * 60, false);
    const view = c.getVisibleRange()!;

    t.subs[0]!.onReset!({ from: 50 * 60 });
    t.calls[1]!.resolve({ bars: range(50, 90).map((b) => ({ ...b, close: b.close + 0.5 })) });
    await flush();
    expect(c.getVisibleRange()).toEqual(view);

    const reloaded = c.reload({ keepView: true });
    await flush();
    t.calls.at(-1)!.resolve({ bars: range(10, 90) });
    await reloaded;
    expect(c.getVisibleRange()).toEqual(view);
  });
});
