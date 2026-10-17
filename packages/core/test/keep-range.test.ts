import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptions } from '../src/chart';
import type { DataSource } from '../src/data/types';
import { intervalSeconds } from '../src/data/util';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const HOUR = 3600;
const M5 = 300;
const M15 = 900;
const END = 1_000 * HOUR;
/** History reaches back this far for every interval. */
const SPAN = 900 * HOUR;

/** Bars on each interval's grid up to the one open at `now`, paged by `to` and `limit`. */
const gridSource = (now = END): DataSource => ({
  symbol: async (symbol) => ({ symbol, name: symbol }),
  search: async () => [],
  history: async (_info, interval, req) => {
    const step = intervalSeconds(interval);
    const bars: Bar[] = [];
    const newest = req.to === undefined ? Math.floor(now / step) * step : req.to - step;
    for (let t = newest; t > END - SPAN && bars.length < req.limit; t -= step) {
      bars.unshift({ time: t, open: 1, high: 2, low: 0, close: 1 });
    }
    return { bars, atStart: bars.length < req.limit };
  },
});
const source = gridSource();

function chart(keep = true, from: DataSource = source, options: Partial<ChartOptions> = {}, page = 300) {
  const c = new Chart(fakeContainer(), { keepRangeOnIntervalChange: keep, ...options });
  charts.push(c);
  c.setDataSource(from, { initialBars: page, pageBars: page });
  return c;
}

/** The chart's pending kept range (private). */
const pendingRange = (c: Chart) => (c as unknown as { pendingRange: unknown }).pendingRange;

function expectNear(actual: { from: number; to: number }, expected: { from: number; to: number }, bar: number) {
  expect(Math.abs(actual.from - expected.from)).toBeLessThanOrEqual(bar);
  expect(Math.abs(actual.to - expected.to)).toBeLessThanOrEqual(bar);
}

/** Node's `setImmediate` (the core package does not include Node types). */
const nextTask = (globalThis as unknown as { setImmediate(fn: () => void): void }).setImmediate;

/**
 * Let pending loads finish. Each turn flushes the microtasks; `setImmediate`
 * instead of `setTimeout(0)`, whose timer granularity made a settle cost tens
 * of milliseconds on a loaded machine.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => nextTask(r));
}

describe('keepRangeOnIntervalChange', () => {
  it('keeps the range going down in interval, loading the history it needs', async () => {
    const c = chart();
    await c.setSymbol('A', '1h');
    c.setVisibleTimeRange(END - 60 * HOUR, END - 20 * HOUR, false);
    const before = c.getVisibleRange()!;
    await c.setSymbol('A', '5m');
    await settle();
    const after = c.getVisibleRange()!;
    // 40 hours at 5m is 480 bars, more than the first load of 300.
    expect(c.timeline.times[0]!).toBeLessThanOrEqual(before.from);
    expectNear(after, before, M5);
  });

  it('keeps the range going up in interval', async () => {
    const c = chart();
    await c.setSymbol('A', '5m');
    c.setVisibleTimeRange(END - 20 * HOUR, END - 5 * HOUR, false);
    const before = c.getVisibleRange()!;
    await c.setSymbol('A', '1h');
    await settle();
    expectNear(c.getVisibleRange()!, before, HOUR);
  });

  it('does not drift over repeated switches', async () => {
    const c = chart();
    await c.setSymbol('A', '1h');
    c.setVisibleTimeRange(END - 60 * HOUR, END - 20 * HOUR, false);
    const start = c.getVisibleRange()!;
    for (let i = 0; i < 3; i++) {
      await c.setSymbol('A', '5m');
      await settle();
      expectNear(c.getVisibleRange()!, start, M5);
      await c.setSymbol('A', '1h');
      await settle();
      expectNear(c.getVisibleRange()!, start, HOUR);
    }
  });

  it('shows exactly the range it was given, so reapplying it is idempotent', async () => {
    const c = chart();
    await c.setSymbol('A', '1h');
    c.setVisibleTimeRange(END - 60 * HOUR, END - 20 * HOUR, false);
    const r = c.getVisibleRange()!;
    expect(r).toEqual({ from: END - 60 * HOUR, to: END - 20 * HOUR });
    c.setVisibleTimeRange(r.from, r.to, false);
    expect(c.getVisibleRange()).toEqual(r);
  });

  it('keeps the right edge when the range is too long for the minimum bar spacing', async () => {
    const c = chart();
    await c.setSymbol('A', '1h');
    for (let i = 0; i < 3; i++) await c.data!.loadMore();
    c.setVisibleTimeRange(END - 800 * HOUR, END - 10 * HOUR, false);
    const before = c.getVisibleRange()!;
    await c.setSymbol('A', '5m');
    await settle();
    const after = c.getVisibleRange()!;
    // 790 hours at 5m is 9480 bars: only the newest part fits.
    expect(Math.abs(after.to - before.to)).toBeLessThanOrEqual(M5);
    expect(after.from).toBeGreaterThan(before.from);
    expect(c.time.barSpacing).toBe(c.time.minBarSpacing);
    // Only the history that fits is paged in: the bars after the range's end, the plot's worth before it, one page over.
    expect(c.timeline.times[0]!).toBeLessThanOrEqual(after.from);
    expect(c.timeline.length).toBeLessThanOrEqual(120 + c.plotWidth / c.time.minBarSpacing + 300);
  });

  it('pages history in one page per task', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const c = chart();
      await c.setSymbol('A', '1h');
      c.setVisibleTimeRange(END - 100 * HOUR, END - 20 * HOUR, false);
      const before = c.getVisibleRange()!;
      let pages = 0;
      c.on('data:loaded', ({ kind }) => kind === 'history' && pages++);
      // A source answering at once: without a task between pages, all would load here.
      const switching = c.setSymbol('A', '5m');
      for (let i = 0; i < 100; i++) await Promise.resolve();
      expect(c.data!.initialLoad).toBeNull();
      expect(pages).toBe(0);
      // 100 hours back at 5m is 1201 bars: the first load and four pages.
      for (let page = 1; page <= 4; page++) {
        await vi.runOnlyPendingTimersAsync();
        expect(pages).toBe(page);
      }
      await vi.runAllTimersAsync();
      await switching;
      expect(pages).toBe(4);
      expectNear(c.getVisibleRange()!, before, M5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the newest bar at the right edge when the view reached it', async () => {
    // The 5m bars run 55 minutes past the open time of the newest 1h bar.
    const c = chart(true, gridSource(END + 55 * 60));
    await c.setSymbol('A', '1h');
    c.setVisibleTimeRange(END - 20 * HOUR, END, false);
    let pages = 0;
    c.on('data:loaded', ({ kind }) => kind === 'history' && pages++);
    await c.setSymbol('A', '5m');
    await settle();
    expect(c.getVisibleRange()).toEqual({ from: END - 20 * HOUR, to: END + 55 * 60 });
    // 20 hours and 55 minutes at 5m is 251 bars, within the first load.
    expect(pages).toBe(0);
  });

  it('keeps the range with fixed edges and a right offset limit', async () => {
    const c = chart(true, source, { fixLeftEdge: true, fixRightEdge: true, maxRightOffset: 0 });
    await c.setSymbol('A', '1h');
    c.setVisibleTimeRange(END - 40 * HOUR, END, false);
    const before = c.getVisibleRange()!;
    expect(before).toEqual({ from: END - 40 * HOUR, to: END });
    await c.setSymbol('A', '5m');
    await settle();
    expectNear(c.getVisibleRange()!, before, M5);
    expect(c.time.rightOffset).toBe(0);
    await c.setSymbol('A', '1h');
    await settle();
    expectNear(c.getVisibleRange()!, before, HOUR);
  });

  for (const edge of [{ fixRightEdge: true }, { maxRightOffset: 0 }]) {
    it(`keeps a range zoomed out to the fixed edges while history pages in (${Object.keys(edge)[0]})`, async () => {
      // Pages of 20 bars do not fill the plot even at maxBarSpacing, so the smallest
      // spacing the edges allow, and with it the clamped view, changes on every page.
      const c = chart(true, source, { fixLeftEdge: true, maxBarSpacing: 20, ...edge }, 20);
      await c.setSymbol('A', '1h');
      c.setBarSpacing(c.time.minSpacing());
      const before = c.getVisibleRange()!;
      expect(before).toEqual({ from: END - 19 * HOUR, to: END });
      await c.setSymbol('A', '15m');
      await settle();
      // 19 hours at 15m is 77 bars: three history pages.
      expect(c.timeline.times[0]!).toBeLessThanOrEqual(before.from);
      expectNear(c.getVisibleRange()!, before, M15);
      expect(pendingRange(c)).toBeNull();
    });
  }

  it('keeps restoring when a live bar arrives while history pages in', async () => {
    let onBar: ((bar: Bar) => void) | null = null;
    const live: DataSource = {
      ...source,
      stream: (_info, _interval, cb) => {
        onBar = cb;
        return () => (onBar = null);
      },
    };
    const c = chart(true, live);
    await c.setSymbol('A', '1h');
    c.setVisibleTimeRange(END - 60 * HOUR, END - 20 * HOUR, false);
    const before = c.getVisibleRange()!;
    // The view is off the newest bar, so the new bar shifts the right offset to stay put.
    c.on('data:loading', ({ kind }) => {
      if (kind === 'history') onBar?.({ time: END + M5, open: 1, high: 2, low: 0, close: 1 });
    });
    await c.setSymbol('A', '5m');
    await settle();
    expect(c.timeline.times.at(-1)).toBe(END + M5);
    expectNear(c.getVisibleRange()!, before, M5);
  });

  it('gives way to a view change made after the switch', async () => {
    const c = chart();
    await c.setSymbol('A', '1h');
    c.setVisibleTimeRange(END - 60 * HOUR, END - 20 * HOUR, false);
    const switching = c.setSymbol('A', '5m');
    // e.g. a range preset applied right after switching the interval
    c.scrollToRealtime(false);
    await switching;
    await settle();
    expect(c.getVisibleRange()!.to).toBeGreaterThan(END - HOUR);
  });

  for (const keep of [true, false]) {
    it(`shows a range requested right after the switch on the new bars (keep ${keep})`, async () => {
      const c = chart(keep);
      await c.setSymbol('A', '1h');
      c.setVisibleTimeRange(END - 200 * HOUR, END - 150 * HOUR, false);
      const switching = c.setSymbol('A', '5m');
      // A range preset: it switches the interval, then sets its span on the old bars.
      c.setVisibleTimeRange(END - 30 * HOUR, END);
      await switching;
      await settle();
      // 30 hours at 5m is 360 bars, more than the first load of 300.
      expectNear(c.getVisibleRange()!, { from: END - 30 * HOUR, to: END }, M5);
      expect(pendingRange(c)).toBeNull();
    });
  }

  it('replays fitContent made right after the switch', async () => {
    const c = chart();
    await c.setSymbol('A', '1h');
    await c.data!.loadMore();
    c.setVisibleTimeRange(END - 60 * HOUR, END - 20 * HOUR, false);
    const switching = c.setSymbol('A', '5m');
    c.fitContent();
    await switching;
    await settle();
    // Fitted to the 300 new bars, not the 600 old ones.
    expect(c.time.barCount).toBe(300);
    expect(c.time.barSpacing).toBeCloseTo(c.time.width / (300 + c.options.rightOffset));
    expect(c.getVisibleRange()).toEqual({ from: c.timeline.times[0], to: END });
  });

  it('stops paging history when the user moves the view', async () => {
    const c = chart();
    await c.setSymbol('A', '1h');
    c.setVisibleTimeRange(END - 60 * HOUR, END - 20 * HOUR, false);
    // 60 hours back at 5m needs two history pages; drag the chart while the first loads.
    c.on('data:loading', ({ kind }) => {
      if (kind === 'history') c.time.pan(40);
    });
    await c.setSymbol('A', '5m');
    await settle();
    expect(c.timeline.length).toBe(600);
    expect(pendingRange(c)).toBeNull();
  });

  it('forgets the kept range when the load fails or brings no bars', async () => {
    for (const fail of [true, false]) {
      const c = chart(true, {
        ...source,
        history: async (info, interval, req) => {
          if (interval !== '5m') return source.history(info, interval, req);
          if (fail) throw new Error('down');
          return { bars: [], atStart: true };
        },
      });
      await c.setSymbol('A', '1h');
      c.setVisibleTimeRange(END - 60 * HOUR, END - 20 * HOUR, false);
      const switching = c.setSymbol('A', '5m');
      if (fail) await expect(switching).rejects.toThrow('down');
      else await switching;
      await settle();
      expect(pendingRange(c)).toBeNull();
    }
  });

  it('drops the kept range when the controller loads something else directly', async () => {
    const c = chart();
    await c.setSymbol('A', '1h');
    c.setVisibleTimeRange(END - 60 * HOUR, END - 20 * HOUR, false);
    void c.setSymbol('A', '5m');
    await c.data!.setSymbol('A', '15m');
    await settle();
    expect(pendingRange(c)).toBeNull();
    expect(c.getVisibleRange()!.to).toBe(END);
  });

  it('shows the newest bars when off, or when the symbol changes', async () => {
    for (const [keep, symbol] of [
      [false, 'A'],
      [true, 'B'],
    ] as const) {
      const c = chart(keep);
      await c.setSymbol('A', '1h');
      c.setVisibleTimeRange(END - 200 * HOUR, END - 150 * HOUR, false);
      await c.setSymbol(symbol, '5m');
      await settle();
      expect(c.getVisibleRange()!.to).toBeGreaterThan(END - HOUR);
    }
  });
});
