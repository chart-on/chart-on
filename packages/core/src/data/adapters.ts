import { ChartError } from '../errors';
import type { Bar, Time } from '../types';
import { MockPath } from './mock-path';
import { intervalSeconds, listenerSet, liveReads, normalizeBars, sliceBars, symbolLookup, type DropReason } from './util';
import { intervalStart, isCalendarInterval, isTimeInterval, nextIntervalStart, symbolZone } from './interval';
import type { Zone } from '../util/timezone';
import type { BarsRequest, BarsReset, BarsResult, DataSource, FeedStatus, Interval, SymbolInfo } from './types';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/* ------------------------------------------------------------------ */
/* Static / CSV                                                        */
/* ------------------------------------------------------------------ */

/** Options for the static data source: the symbols it knows and a lookup of in-memory bars per symbol and interval. */
export interface StaticDataSourceOptions {
  symbols: SymbolInfo[];
  /** Bars for a symbol and interval, or undefined when there are none. */
  bars(symbol: string, interval: Interval): readonly Bar[] | undefined;
}

interface StaticSeries {
  /** Bars with a finite time, sorted for slicing. */
  timed: Bar[];
  /** Bars without one; served with the oldest page. */
  untimed: Bar[];
}

/**
 * In-memory history (e.g. parsed CSV files); no live updates. Bars are only
 * sorted, not filtered, so the chart drops invalid and duplicate ones itself
 * and reports them through `data:dropped`.
 */
export function createStaticDataSource(options: StaticDataSourceOptions): DataSource {
  const cache = new Map<string, StaticSeries>();
  const series = (symbol: string, interval: Interval): StaticSeries => {
    const key = `${symbol}\u0000${interval}`;
    let entry = cache.get(key);
    if (!entry) {
      const bars = options.bars(symbol, interval) ?? [];
      entry = {
        timed: bars.filter((b) => Number.isFinite(b.time)).sort((a, b) => a.time - b.time),
        untimed: bars.filter((b) => !Number.isFinite(b.time)),
      };
      cache.set(key, entry);
    }
    return entry;
  };
  return {
    ...symbolLookup(options.symbols),
    async history(symbol, interval, request) {
      const { timed, untimed } = series(symbol.symbol, interval);
      const result = sliceBars(timed, request);
      if (result.atStart && untimed.length > 0) result.bars = untimed.concat(result.bars);
      return result;
    },
  };
}

/** Options for `parseCsv`: the column delimiter and a hook that hears about dropped rows. */
export interface CsvOptions {
  /** Column delimiter (default ','). */
  delimiter?: string;
  /** Hears about each row left out: `'invalid'` (see `isValidBar`), or `'duplicate'` when a later row has the same time. */
  onDrop?(bar: Bar, reason: DropReason): void;
}

/**
 * Parse `time,open,high,low,close[,volume]` rows. A header row naming those
 * columns (any order; `date` or `timestamp` also name the time) is honoured; otherwise columns are positional. Time may
 * be unix seconds, unix milliseconds or an ISO date. Rows come back sorted by
 * time; invalid rows are skipped and of rows with equal times the last one is
 * kept. `onDrop` reports both.
 */
export function parseCsv(text: string, options: CsvOptions = {}): Bar[] {
  const delimiter = options.delimiter ?? ',';
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.split(delimiter).map((cell) => cell.trim()));
  const names = ['time', 'open', 'high', 'low', 'close', 'volume'];
  let columns = names.map((_, i) => i);
  const header = rows[0]?.map((cell) => cell.toLowerCase());
  if (header && header.some((cell) => names.includes(cell) || TIME_COLUMNS.includes(cell))) {
    columns = names.map((name) =>
      name === 'time' ? header.findIndex((cell) => TIME_COLUMNS.includes(cell)) : header.indexOf(name),
    );
    rows.shift();
  }
  const bars: Bar[] = [];
  for (const row of rows) {
    const cell = (i: number) => (columns[i]! >= 0 ? row[columns[i]!] : undefined);
    const time = parseTime(cell(0) ?? '');
    const [open, high, low, close] = [1, 2, 3, 4].map((i) => Number(cell(i)));
    const volumeCell = cell(5);
    const bar: Bar = { time, open: open!, high: high!, low: low!, close: close! };
    if (volumeCell !== undefined && volumeCell !== '') bar.volume = Number(volumeCell);
    bars.push(bar);
  }
  return normalizeBars(bars, options.onDrop);
}

const TIME_COLUMNS = ['time', 'date', 'datetime', 'timestamp'];

function parseTime(text: string): number {
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    // Values past year 33658 in seconds are taken as milliseconds.
    return n > 1e12 ? Math.floor(n / 1000) : n;
  }
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? NaN : Math.floor(ms / 1000);
}

/* ------------------------------------------------------------------ */
/* REST                                                                */
/* ------------------------------------------------------------------ */

/**
 * Options for the REST data source: how to build a history URL, how to map the
 * JSON response to bars, the known symbols, and the request init and `fetch` to use.
 */
export interface RestDataSourceOptions {
  /** URL for a history request. */
  url(symbol: SymbolInfo, interval: Interval, request: BarsRequest): string;
  /** Turn the parsed JSON response into bars. A bare array leaves `atStart` unknown. */
  map(json: unknown, request: BarsRequest): BarsResult | Bar[];
  /** Known symbols (enables search), or a resolver; defaults to `{ symbol, name: symbol }`. */
  symbols?: SymbolInfo[] | ((symbol: string) => Promise<SymbolInfo>);
  init?: RequestInit;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** History over HTTP with a configurable URL builder and response mapper; no live updates. */
export function createRestDataSource(options: RestDataSourceOptions): DataSource {
  const symbols = options.symbols;
  const lookup = Array.isArray(symbols) ? symbolLookup(symbols) : null;
  return {
    symbol: async (symbol) => {
      if (lookup) return lookup.symbol(symbol);
      return typeof symbols === 'function' ? symbols(symbol) : { symbol, name: symbol };
    },
    search: async (query) => (lookup ? lookup.search(query) : []),
    async history(symbol, interval, request) {
      const doFetch = options.fetch ?? fetch;
      const res = await doFetch(options.url(symbol, interval, request), { ...options.init, signal: request.signal });
      if (!res.ok) throw new Error(`${/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'History request failed: ' : ''}HTTP ${res.status}`);
      const mapped = options.map(await res.json(), request);
      return Array.isArray(mapped) ? { bars: mapped } : mapped;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Polling                                                             */
/* ------------------------------------------------------------------ */

/** Options for the polling data source: the history source it polls, the pause between polls, and bars asked for per poll. */
export interface PollingDataSourceOptions {
  /** Symbol lookup and history, e.g. a REST data source; polls go through its `history`. */
  history: Pick<DataSource, 'symbol' | 'search' | 'history'>;
  /** Milliseconds between the end of one poll and the start of the next. */
  pollMs: number;
  /**
   * Bars asked for per poll, the `limit` of each request (default and
   * minimum 2: the bar sent last, to see whether it changed, and a new one).
   */
  limit?: number;
}

/**
 * Live bars for HTTP-only sources: polls the `history` source's `history`
 * method for the newest bars and streams them as if they came from a socket.
 * Each poll is a `'refresh'` request from the newest bar seen (the first poll
 * has no `from`). The rule follows the chart's streaming contract, where a
 * bar with the last time replaces it and a newer one appends:
 * - each poll sends, oldest first, every bar that is new or differs from the
 *   version sent last, so a late trade in the previous bar arrives before the
 *   next bar opens, and nothing unchanged is sent again;
 * - if the bar sent last is missing from the response (e.g. after the tab
 *   slept and more than `limit` bars opened), the bars in between were
 *   missed, so the source reports a reset from it through `onReset`, and the
 *   chart refetches the gap; the response's bars are still sent.
 * A failed poll reports `reconnecting` through `onStatus`, and the next good
 * one `connected`, after which the chart refetches what it missed.
 */
export function createPollingDataSource(options: PollingDataSourceOptions): DataSource {
  const feed = options.history;
  const limit = Math.max(2, Math.floor(options.limit ?? 2));
  const pollMs = Math.max(0, options.pollMs);
  const status = listenerSet<FeedStatus>();
  const resets = listenerSet<BarsReset>();
  let state: FeedStatus['state'] = 'disconnected';
  let active = 0;

  const report = (next: FeedStatus['state']) => {
    if (next === state) return;
    state = next;
    status.emit({ state, since: Date.now() / 1000 });
  };

  return {
    symbol: (symbol) => feed.symbol(symbol),
    search: (query) => feed.search(query),
    history: (symbol, interval, request) => feed.history(symbol, interval, request),
    stream(symbol, interval, onBar) {
      /** Where the next poll starts: the newest bar seen. */
      let polled: Time | undefined;
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let abort: AbortController | null = null;
      active++;
      const receive = liveReads(onBar, (from) => resets.emit({ symbol: symbol.symbol, interval, range: { from } }));

      const poll = async () => {
        timer = null;
        const ac = (abort = new AbortController());
        // No `from` key on the first poll, so a url() serializing the request sends none.
        const request: BarsRequest = { kind: 'refresh', limit, signal: ac.signal };
        if (polled !== undefined) request.from = polled;
        let bars: Bar[] | null = null;
        try {
          bars = normalizeBars((await feed.history(symbol, interval, request)).bars);
        } catch {
          // Reported below, unless the subscription closed meanwhile.
        }
        if (closed) return;
        abort = null;
        timer = setTimeout(poll, pollMs);
        report(bars ? 'connected' : 'reconnecting');
        if (bars) polled = receive(bars);
      };

      timer = setTimeout(poll, 0);
      return () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        abort?.abort();
        if (--active === 0) report('disconnected');
      };
    },
    onStatus: status.add,
    onReset: resets.add,
  };
}

/* ------------------------------------------------------------------ */
/* WebSocket                                                           */
/* ------------------------------------------------------------------ */

/** The parts of the browser WebSocket the adapter uses. */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

/**
 * Options for the WebSocket data source: the socket URL, the history source
 * behind it, the subscribe and unsubscribe messages, how to parse incoming
 * bars, and reconnect backoff.
 */
export interface WebSocketDataSourceOptions {
  url: string;
  /** Symbol lookup and history, e.g. a REST data source. */
  history: Pick<DataSource, 'symbol' | 'search' | 'history'>;
  /** Message that starts a stream; strings are sent as is, anything else as JSON. */
  subscribeMessage(symbol: SymbolInfo, interval: Interval): unknown;
  unsubscribeMessage?(symbol: SymbolInfo, interval: Interval): unknown;
  /**
   * Read a message (JSON-parsed when possible). Return the stream key and bar
   * it carries, or null to ignore it.
   */
  parse(message: unknown): { key: string; bar: Bar } | null;
  /** Stream key for a subscription; must match `parse`. Default `symbol:interval`. */
  key?(symbol: SymbolInfo, interval: Interval): string;
  /** Reconnect backoff bounds in ms (default 1000 to 30000). */
  reconnect?: { minMs: number; maxMs: number };
  /** Socket factory; defaults to the global WebSocket. */
  createSocket?(url: string): SocketLike;
}

const OPEN = 1;

/**
 * Live bars over one shared WebSocket. Reconnects with exponential backoff and
 * resubscribes every active stream when the connection comes back. Reports
 * the connection through `onStatus`, so the chart refetches missed bars.
 */
export function createWebSocketDataSource(options: WebSocketDataSourceOptions): DataSource {
  const feed = options.history;
  const keyOf = options.key ?? ((s: SymbolInfo, interval: Interval) => `${s.symbol}:${interval}`);
  const { minMs, maxMs } = options.reconnect ?? { minMs: 1000, maxMs: 30000 };
  const create = options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  const streams = new Map<string, { symbol: SymbolInfo; interval: Interval; listeners: Set<(bar: Bar) => void> }>();
  let socket: SocketLike | null = null;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const status = listenerSet<FeedStatus>();
  let state: FeedStatus['state'] = 'disconnected';

  const report = (next: FeedStatus['state']) => {
    if (next === state) return;
    state = next;
    status.emit({ state, since: Date.now() / 1000 });
  };

  const send = (message: unknown) => {
    if (socket?.readyState === OPEN) socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  };

  const connect = () => {
    timer = null;
    const ws = create(options.url);
    socket = ws;
    let openedAt = Infinity;
    ws.onopen = () => {
      openedAt = Date.now();
      for (const s of streams.values()) send(options.subscribeMessage(s.symbol, s.interval));
      report('connected');
    };
    ws.onmessage = (ev) => {
      let message = ev.data;
      if (typeof message === 'string') {
        try {
          message = JSON.parse(message);
        } catch {
          // Not JSON: hand the raw text to `parse`.
        }
      }
      let parsed: { key: string; bar: Bar } | null;
      try {
        parsed = options.parse(message);
      } catch {
        return;
      }
      // Invalid bars go through: the chart drops them and reports `data:dropped`.
      if (!parsed) return;
      for (const listener of streams.get(parsed.key)?.listeners ?? []) listener(parsed.bar);
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      // Only a connection that held for `minMs` resets the backoff, so a server
      // that accepts and drops at once is not retried every `minMs` forever.
      if (Date.now() - openedAt >= minMs) attempts = 0;
      if (streams.size === 0) return report('disconnected');
      report('reconnecting');
      const delay = Math.min(maxMs, minMs * 2 ** attempts++);
      timer = setTimeout(connect, delay * (0.8 + Math.random() * 0.4));
    };
    ws.onerror = () => ws.close();
  };

  const disconnect = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const ws = socket;
    socket = null;
    ws?.close();
    report('disconnected');
  };

  return {
    symbol: (symbol) => feed.symbol(symbol),
    search: (query) => feed.search(query),
    history: (symbol, interval, request) => feed.history(symbol, interval, request),
    stream(symbol, interval, onBar) {
      const key = keyOf(symbol, interval);
      let stream = streams.get(key);
      if (!stream) {
        stream = { symbol, interval, listeners: new Set() };
        streams.set(key, stream);
        send(options.subscribeMessage(symbol, interval));
      }
      stream.listeners.add(onBar);
      if (!socket && !timer) connect();
      return () => {
        const s = streams.get(key);
        if (!s?.listeners.delete(onBar) || s.listeners.size > 0) return;
        streams.delete(key);
        if (options.unsubscribeMessage) send(options.unsubscribeMessage(symbol, interval));
        if (streams.size === 0) disconnect();
      };
    },
    onStatus: status.add,
  };
}

/* ------------------------------------------------------------------ */
/* Mock                                                                */
/* ------------------------------------------------------------------ */

/** Options for the mock data source: symbols, history length, start price, tick period, random seed and clock. */
export interface MockDataSourceOptions {
  symbols?: SymbolInfo[];
  /** Bars of history available, the oldest page marked `atStart` (default 10000). */
  historyBars?: number;
  /** Price around now: the week holding the clock when a symbol is first asked for opens at it (default 100). */
  startPrice?: number;
  /** Live tick period in ms (default 250). */
  tickMs?: number;
  seed?: number;
  /** Clock in ms (default `Date.now`). */
  now?: () => number;
}

/** The mock data source, with controls to pause live ticks and to simulate the stream dropping. */
export interface MockDataSource extends DataSource {
  /** Pause or resume live ticks. */
  setPaused(paused: boolean): void;
  /**
   * Simulate the live stream dropping (`false`: no ticks, status
   * `reconnecting`) and coming back (`true`: status `connected`).
   */
  setConnected(connected: boolean): void;
}

/**
 * Deterministic simulated market for demos and tests. Each symbol has one
 * price path shared by every interval, calendar ones included, so a coarse bar
 * is the aggregate of the finer bars inside it. Prices revert slowly towards
 * `startPrice`, so long histories stay in range. History ends at the current
 * bar; live ticks move the forming bar along the same path and roll a new one
 * when the clock crosses the bar boundary.
 */
export function createMockDataSource(options: MockDataSourceOptions = {}): MockDataSource {
  const symbols = options.symbols ?? [{ symbol: 'DEMO', name: 'DEMO', type: 'crypto' }];
  const historyBars = options.historyBars ?? 10000;
  const clock = options.now ?? Date.now;
  const tickMs = options.tickMs ?? 250;
  const markets = new Map<string, MockMarket>();
  const paths = new Map<string, MockPath>();
  let paused = false;
  let connected = true;
  const status = listenerSet<FeedStatus>();

  const market = (symbol: string, interval: Interval): MockMarket => {
    if (!isTimeInterval(interval)) {
      throw new ChartError('invalid-interval', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `The mock data source makes time bars only, not "${interval}"` : '', { context: { interval } });
    }
    const key = `${symbol}\u0000${interval}`;
    let m = markets.get(key);
    if (!m) {
      let path = paths.get(symbol);
      if (!path) {
        path = new MockPath(hash(symbol) ^ (options.seed ?? 7), options.startPrice ?? 100, clock() / 1000);
        paths.set(symbol, path);
      }
      // Calendar bars (months, quarters, years) start in the symbol's timezone.
      const zone = symbolZone(symbols.find((s) => s.symbol === symbol)?.timezone);
      m = new MockMarket(path, interval, zone, historyBars, clock());
      markets.set(key, m);
    }
    m.catchUp(clock());
    return m;
  };

  return {
    ...symbolLookup(symbols),
    async history(symbol, interval, request) {
      return sliceBars(market(symbol.symbol, interval).bars, request);
    },
    stream(symbol, interval, onBar) {
      const m = market(symbol.symbol, interval);
      const timer = setInterval(() => {
        if (paused || !connected) return;
        for (const bar of m.catchUp(clock())) onBar({ ...bar });
      }, tickMs);
      return () => clearInterval(timer);
    },
    async now() {
      return Math.floor(clock() / 1000);
    },
    setPaused(value) {
      paused = value;
    },
    setConnected(value) {
      if (value === connected) return;
      connected = value;
      status.emit({ state: value ? 'connected' : 'reconnecting', since: clock() / 1000 });
    },
    onStatus: status.add,
  };
}

/** Calendar history stops here (1900-01-01), so long histories stay in years every timezone knows. */
const MOCK_OLDEST = -2208988800;

/** The bars of one symbol and interval, read from the symbol's shared price path. */
class MockMarket {
  readonly bars: Bar[] = [];
  /** Nominal bar length in seconds. */
  readonly #length: number;
  readonly #calendar: boolean;
  readonly #path: MockPath;
  readonly #interval: Interval;
  readonly #zone: Zone;

  constructor(path: MockPath, interval: Interval, zone: Zone, count: number, nowMs: number) {
    this.#path = path;
    this.#interval = interval;
    this.#zone = zone;
    this.#length = intervalSeconds(interval);
    this.#calendar = isCalendarInterval(interval);
    const times = [this.#bucket(nowMs)];
    while (times.length < count) {
      const previous = this.#previous(times[times.length - 1]!);
      if (this.#calendar && previous < MOCK_OLDEST) break;
      times.push(previous);
    }
    for (let i = times.length - 1; i >= 0; i--) this.bars.push(this.#bar(times[i]!, nowMs));
  }

  /**
   * Bring the bars up to `nowMs`: finish the bar that was forming, add any
   * bars that opened since and move the forming bar to the current second.
   * Returns the bars that changed, oldest first; the forming bar is always
   * among them, so every live tick reports it.
   */
  catchUp(nowMs: number): Bar[] {
    const end = this.#bucket(nowMs);
    const last = this.bars.length - 1;
    const changed = [this.#bar(this.bars[last]!.time, nowMs)];
    this.bars[last] = changed[0]!;
    for (let t = this.#next(changed[0]!.time); t <= end; t = this.#next(t)) {
      const bar = this.#bar(t, nowMs);
      changed.push(bar);
      this.bars.push(bar);
    }
    return changed;
  }

  /** Start of the bar holding `nowMs`. */
  #bucket(nowMs: number): number {
    if (this.#calendar) return intervalStart(nowMs / 1000, this.#interval, this.#zone);
    return Math.floor(nowMs / 1000 / this.#length) * this.#length;
  }

  #next(time: number): number {
    return this.#calendar ? nextIntervalStart(time, this.#interval, this.#zone) : time + this.#length;
  }

  #previous(time: number): number {
    return this.#calendar ? intervalStart(time - 1, this.#interval, this.#zone) : time - this.#length;
  }

  /** The bar at `time`; while it is forming, the path up to and including the current second. */
  #bar(time: number, nowMs: number): Bar {
    const to = Math.min(this.#next(time), Math.floor(nowMs / 1000) + 1);
    return this.#path.range(time, Math.max(to, time + 1))!;
  }
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
