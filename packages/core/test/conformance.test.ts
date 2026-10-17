import { describe, expect, it } from 'vitest';
import { testDataSource } from '../src/testing';
import { createMockDataSource, createRestDataSource, createStaticDataSource } from '../src/data/adapters';
import { sliceBars } from '../src/data/util';
import type { BarsRequest, DataSource } from '../src/data/types';
import type { Bar } from '../src/types';

const HOUR = 3600;
const history: Bar[] = Array.from({ length: 400 }, (_, i) => {
  const close = 100 + (i % 17);
  return { time: (1_000 + i) * HOUR, open: close, high: close + 1, low: close - 1, close };
});
const options = { symbol: 'ABC', interval: '1h' as const, limit: 50, timeout: 200 };
const correct = () => createStaticDataSource({ symbols: [{ symbol: 'ABC', name: 'ABC' }], bars: () => history });

/** `correct()` with `history` replaced by `wrong(request, answer)`. */
function broken(wrong: (request: BarsRequest, answer: () => Promise<{ bars: Bar[]; atStart?: boolean }>) => Promise<{ bars: Bar[]; atStart?: boolean }>): DataSource {
  const source = correct();
  return { ...source, history: (info, interval, request) => wrong(request, () => source.history(info, interval, request)) };
}

describe('testDataSource', () => {
  it('passes the built-in adapters', async () => {
    expect(await testDataSource(correct(), options)).toEqual([]);
    const mock = createMockDataSource({ symbols: [{ symbol: 'ABC', name: 'ABC' }], historyBars: 400, now: () => 2_000 * HOUR * 1000 });
    expect(await testDataSource(mock, options)).toEqual([]);
    const rest = createRestDataSource({
      url: (s, interval, r) =>
        `https://example.test/bars?${new URLSearchParams({ s: s.symbol, i: interval, n: String(r.limit), from: String(r.from ?? ''), to: String(r.to ?? '') })}`,
      map: (json) => json as { bars: Bar[]; atStart: boolean },
      fetch: (async (url: string) => {
        const q = new URL(url).searchParams;
        const num = (key: string) => (q.get(key) ? Number(q.get(key)) : undefined);
        const body = sliceBars(history, { from: num('from'), to: num('to'), limit: Number(q.get('n')) });
        return { ok: true, json: async () => body };
      }) as unknown as typeof fetch,
    });
    expect(await testDataSource(rest, options)).toEqual([]);
  });

  it('reports a source that ignores `to`', async () => {
    const source = broken((r, answer) => (r.to === undefined ? answer() : correct().history({ symbol: 'ABC', name: 'ABC' }, '1h', { ...r, to: undefined })));
    const problems = await testDataSource(source, options);
    expect(problems.some((p) => p.startsWith('history request') && p.includes('`to` exclusive'))).toBe(true);
  });

  it('reports a source that treats `to` as inclusive', async () => {
    const source = broken((r, answer) =>
      r.to === undefined ? answer() : correct().history({ symbol: 'ABC', name: 'ABC' }, '1h', { ...r, to: r.to + 1 }),
    );
    expect((await testDataSource(source, options)).join('\n')).toMatch(/is not older than `to`/);
  });

  it('reports a source that ignores `from`', async () => {
    const source = broken((r) => correct().history({ symbol: 'ABC', name: 'ABC' }, '1h', { ...r, from: undefined }));
    const problems = await testDataSource(source, options);
    expect(problems.some((p) => p.startsWith('refresh request') && p.includes('`from` inclusive'))).toBe(true);
  });

  it('reports descending, repeated and invalid bars', async () => {
    const reversed = broken(async (_r, answer) => {
      const result = await answer();
      return { ...result, bars: [...result.bars].reverse() };
    });
    expect((await testDataSource(reversed, options))[0]).toMatch(/bars must ascend/);
    const invalid = broken(async (_r, answer) => {
      const result = await answer();
      return { ...result, bars: result.bars.map((b) => ({ ...b, high: b.low - 1 })) };
    });
    expect((await testDataSource(invalid, options))[0]).toMatch(/high below low/);
  });

  it('reports more bars than limit', async () => {
    const source = broken(async (r) => correct().history({ symbol: 'ABC', name: 'ABC' }, '1h', { ...r, limit: r.limit + 1 }));
    expect((await testDataSource(source, options))[0]).toMatch(/more than limit/);
  });

  it('reports atStart while older bars exist', async () => {
    const source = broken(async (_r, answer) => ({ ...(await answer()), atStart: true }));
    expect((await testDataSource(source, options)).join('\n')).toMatch(/after a response said `atStart`/);
  });

  it('reports a request with an aborted signal that never settles', async () => {
    const source = broken((r, answer) => (r.signal.aborted ? new Promise(() => {}) : answer()));
    expect(await testDataSource(source, options)).toEqual(['a request with an aborted signal did not settle within 200 ms']);
  });

  it('reports too little history and a failing symbol lookup', async () => {
    const short = createStaticDataSource({ symbols: [{ symbol: 'ABC', name: 'ABC' }], bars: () => history.slice(0, 100) });
    expect(await testDataSource(short, options)).toEqual([
      'initial request for 150 bars returned 100: the check needs that much history; lower limit',
    ]);
    expect(await testDataSource(correct(), { ...options, symbol: 'NOPE' })).toEqual([expect.stringMatching(/^symbol\("NOPE"\) failed/)]);
  });
});
