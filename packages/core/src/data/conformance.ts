import type { Bar, Time } from '../types';
import type { BarsRequest, BarsRequestKind, BarsResult, DataSource, Interval, SymbolInfo } from './types';

/** Options of {@link testDataSource}: what to request and how far to look. */
export interface DataSourceCheckOptions {
  symbol: string;
  interval: Interval;
  /** Bars per request. The source needs at least three times this many bars of history. Default 50. */
  limit?: number;
  /** Older pages to walk looking for the start of history; checking stops there if it is deeper. Default 20. */
  maxPages?: number;
  /** Longest a single request may take, in ms. Default 5000. */
  timeout?: number;
}

type Range = Pick<BarsRequest, 'from' | 'to' | 'limit'>;

/**
 * Check that a data source answers the requests the chart sends the way the
 * chart expects (see "Writing an adapter" in the data sources guide), and
 * return what it found wrong; an empty list means it conforms. Run it from
 * your own tests against your adapter, with a symbol that has at least
 * `3 × limit` bars of history:
 *
 * ```ts
 * expect(await testDataSource(source, { symbol: 'ABC', interval: '1h' })).toEqual([]);
 * ```
 *
 * It checks every response for ascending, unique, valid bars and at most
 * `limit` of them; that an initial load returns the newest bars; that
 * `to` is exclusive and `from` inclusive and both select the newest bars in
 * range; that paging back returns older bars page by page, and that no
 * older bars exist once a page says `atStart`; and that a request whose
 * signal is already aborted settles.
 */
export async function testDataSource(source: DataSource, options: DataSourceCheckOptions): Promise<string[]> {
  const { interval, limit: n = 50, maxPages = 20, timeout = 5000 } = options;
  const problems: string[] = [];
  const resolve: DataSource['symbol'] = (symbol) => source.symbol(symbol);
  const history: DataSource['history'] = (...args) => source.history(...args);
  let info: SymbolInfo;
  try {
    info = await settle(resolve(options.symbol), timeout);
  } catch (error) {
    return [`symbol("${options.symbol}") failed: ${describe(error)}`];
  }

  /** One request, checked on its own; null when it failed (reported). */
  const request = async (kind: BarsRequestKind, range: Range, signal = new AbortController().signal): Promise<BarsResult | null> => {
    const label = `${kind} request ${JSON.stringify(range)}`;
    let result: BarsResult;
    try {
      result = await settle(history(info, interval, { kind, signal, ...range }), timeout);
    } catch (error) {
      problems.push(`${label} failed: ${describe(error)}`);
      return null;
    }
    if (!result || !Array.isArray(result.bars)) {
      problems.push(`${label} did not return { bars: [...] }`);
      return null;
    }
    const problem = checkBars(result.bars, range);
    if (problem) problems.push(`${label}: ${problem}`);
    return result;
  };
  /** The `got` response should hold the bars `want` of the reference load. */
  const expectTimes = (kind: BarsRequestKind, range: Range, got: BarsResult | null, want: readonly Bar[], rule: string) => {
    if (!got) return;
    const a = got.bars.map((b) => b.time);
    const b = want.map((x) => x.time);
    const at = a.findIndex((t, i) => t !== b[i]);
    if (at < 0 && a.length === b.length) return;
    const detail = at < 0 ? `${a.length} bars instead of ${b.length}` : `bar ${at} is at ${a[at]} instead of ${b[at]}`;
    problems.push(`${kind} request ${JSON.stringify(range)} (${rule}): ${detail}`);
  };

  // The newest 3n bars stand in for the truth the other requests are compared with.
  const reference = await request('initial', { limit: 3 * n });
  if (!reference) return problems;
  const ref = reference.bars;
  if (ref.length < 3 * n) {
    problems.push(`initial request for ${3 * n} bars returned ${ref.length}: the check needs that much history; lower limit`);
    return problems;
  }
  const m = ref.length;
  const newest = { limit: n };
  expectTimes('initial', newest, await request('initial', newest), ref.slice(m - n), 'the newest bars');
  const older = { to: ref[m - n]!.time, limit: n };
  expectTimes('history', older, await request('history', older), ref.slice(m - 2 * n, m - n), '`to` exclusive, the newest bars before it');
  // Room for more bars than the range holds, so a source that ignores `from` shows.
  const since = { from: ref[m - n]!.time, limit: 2 * n };
  expectTimes('refresh', since, await request('refresh', since), ref.slice(m - n), '`from` inclusive');
  const between = { from: ref[m - 2 * n]!.time, to: ref[m - n]!.time, limit: 2 * n };
  expectTimes('reset', between, await request('reset', between), ref.slice(m - 2 * n, m - n), '`from` inclusive, `to` exclusive');

  // Page back towards the start of history, as the chart does.
  let to: Time = ref[0]!.time;
  let ended = !!reference.atStart;
  for (let page = 0; page < maxPages && !ended; page++) {
    const result = await request('history', { to, limit: n });
    if (!result || result.bars.length === 0) break;
    ended = !!result.atStart;
    to = result.bars[0]!.time;
  }
  if (ended) {
    const after = { to, limit: n };
    const result = await request('history', after);
    if (result && result.bars.length > 0) {
      problems.push(`history request ${JSON.stringify(after)} returned ${result.bars.length} bars after a response said \`atStart\``);
    }
  }

  // An aborted request may resolve or reject, but must settle so the chart can move on.
  const controller = new AbortController();
  controller.abort();
  try {
    await settle(
      history(info, interval, { kind: 'history', limit: n, to: ref[0]!.time, signal: controller.signal }),
      timeout,
    );
  } catch (error) {
    if (error instanceof TimeoutError) problems.push(`a request with an aborted signal did not settle within ${timeout} ms`);
  }
  return problems;
}

/** What is wrong with a response's bars for `range`, or null. */
function checkBars(bars: readonly Bar[], range: Range): string | null {
  if (bars.length > range.limit) return `${bars.length} bars, more than limit`;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const values = [b.time, b.open, b.high, b.low, b.close];
    if (!values.every(Number.isFinite) || b.high < b.low) return `bar ${i} is invalid (non-finite value, or high below low)`;
    if (i > 0 && b.time <= bars[i - 1]!.time) return `bar ${i} is not newer than the one before (bars must ascend, without repeats)`;
    if (range.to !== undefined && b.time >= range.to) return `bar ${i} at ${b.time} is not older than \`to\``;
    if (range.from !== undefined && b.time < range.from) return `bar ${i} at ${b.time} is older than \`from\``;
  }
  return null;
}

class TimeoutError extends Error {}

/** `promise`, or a rejection with `TimeoutError` after `ms`. */
function settle<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
