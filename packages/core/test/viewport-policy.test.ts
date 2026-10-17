import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, defaultChartOptions, type ChartOptions } from '../src/chart';
import type { DataSource } from '../src/data/types';
import { intervalSeconds } from '../src/data/util';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const HOUR = 3600;
const DAY = 24 * HOUR;
const END = 2_000 * DAY;
/** History reaches back this far for every interval. */
const SPAN = 1_000 * DAY;

/**
 * Bars up to END on each interval's grid, paged by `to` and `limit`.
 * `open(t)` says whether the market trades at `t`: every time for a 24/7
 * source, weekday hours 9 to 17 for a session-gapped one.
 */
function source(open: (t: number) => boolean): DataSource {
  return {
    symbol: async (symbol) => ({ symbol, name: symbol }),
    search: async () => [],
    history: async (_info, interval, req) => {
      const step = intervalSeconds(interval);
      const bars: Bar[] = [];
      const newest = req.to === undefined ? END : req.to - step;
      for (let t = newest; t > END - SPAN && bars.length < req.limit; t -= step) {
        if (open(t)) bars.unshift({ time: t, open: 1, high: 2, low: 0, close: 1 });
      }
      return { bars, atStart: bars.length < req.limit };
    },
  };
}

const allDay = source(() => true);
const sessions = source((t) => {
  const day = Math.floor(t / DAY);
  const hour = (t % DAY) / HOUR;
  // Day 0 (1970-01-01) was a Thursday: days 2 and 3 of each week are the weekend.
  return day % 7 !== 2 && day % 7 !== 3 && hour >= 9 && hour < 17;
});

function chart(from: DataSource, options: Partial<ChartOptions> = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  c.setDataSource(from, { initialBars: 300, pageBars: 300 });
  return c;
}

/** Time scale internals: bar spacing, right offset and the visible index range. */
const time = (c: Chart) =>
  (c as unknown as { time: { barSpacing: number; rightOffset: number; visibleRange(): { from: number; to: number } } }).time;
const visibleBars = (c: Chart) => {
  const r = time(c).visibleRange();
  return r.to - r.from;
};
const frame = (c: Chart) => {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
};

/** Node's `setImmediate` (the core package does not include Node types). */
const nextTask = (globalThis as unknown as { setImmediate(fn: () => void): void }).setImmediate;

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => nextTask(r));
}

describe('keepZoomOnSymbolChange', () => {
  for (const [name, from] of [
    ['a 24/7 source', allDay],
    ['a session-gapped source', sessions],
  ] as const) {
    it(`keeps the bars in view and resets the right offset on ${name}`, async () => {
      const c = chart(from);
      await c.setSymbol('A', '1h');
      const times = c.timeline.times;
      c.setVisibleTimeRange(times[times.length - 80]!, times[times.length - 20]!, false);
      const spacing = time(c).barSpacing;
      const bars = visibleBars(c);
      expect(spacing).not.toBe(defaultChartOptions.barSpacing);

      await c.setSymbol('B', '1h');
      expect(time(c).barSpacing).toBe(spacing);
      expect(time(c).rightOffset).toBe(defaultChartOptions.rightOffset);
      // The same slots, now ending in the default margin past the newest bar.
      expect(visibleBars(c)).toBe(bars - defaultChartOptions.rightOffset);
      expect(c.getVisibleRange()!.to).toBe(c.timeline.times[c.timeline.length - 1]);
    });
  }

  it('opens a new symbol at the default zoom when off, but keeps it across an interval change', async () => {
    const c = chart(allDay, { keepZoomOnSymbolChange: false });
    await c.setSymbol('A', '1h');
    c.setVisibleTimeRange(END - 80 * HOUR, END - 20 * HOUR, false);
    const spacing = time(c).barSpacing;

    await c.setSymbol('A', '4h');
    expect(time(c).barSpacing).toBe(spacing);

    await c.setSymbol('B', '4h');
    expect(time(c).barSpacing).toBe(defaultChartOptions.barSpacing);
    expect(time(c).rightOffset).toBe(defaultChartOptions.rightOffset);
  });

  it('pages in history until a wide view is filled on the new symbol', async () => {
    const c = chart(allDay);
    await c.setSymbol('A', '1h');
    // Wider than the 300 bars of a first load.
    c.setVisibleTimeRange(END - 290 * HOUR, END, false);
    for (let i = 0; i < 3 && c.timeline.length < 600; i++) {
      frame(c);
      await settle();
    }
    expect(c.timeline.length).toBeGreaterThanOrEqual(600);
    c.setVisibleTimeRange(c.timeline.times[0]!, END, false);
    const bars = visibleBars(c);

    await c.setSymbol('B', '1h');
    expect(c.timeline.length).toBe(300);
    for (let i = 0; i < 5 && c.timeline.length <= bars; i++) {
      frame(c);
      await settle();
    }
    expect(c.timeline.length).toBeGreaterThan(bars);
    expect(visibleBars(c)).toBe(bars);
  });
});

describe('setData keepVisibleRange', () => {
  const bars = (from: number, count: number): Bar[] =>
    Array.from({ length: count }, (_, i) => ({ time: (from + i) * 60, open: 1, high: 2, low: 0, close: 1 }));

  function pushChart() {
    const c = new Chart(fakeContainer());
    charts.push(c);
    const s = c.addCandles();
    s.setData(bars(0, 1000));
    c.setVisibleTimeRange(400 * 60, 600 * 60, false);
    return { c, s };
  }

  it('keeps the visible times when the new bars cover them', () => {
    const { c, s } = pushChart();
    const before = c.getVisibleRange();
    s.setData(bars(-200, 1500), { keepVisibleRange: true });
    expect(c.getVisibleRange()).toEqual(before);
  });

  it('keeps the distance from the newest bar without it', () => {
    const { c, s } = pushChart();
    s.setData(bars(0, 1200));
    expect(c.getVisibleRange()).toEqual({ from: 600 * 60, to: 800 * 60 });
  });

  it('keeps the distance from the newest bar when the new bars do not cover the range', () => {
    const { c, s } = pushChart();
    s.setData(bars(500, 1000), { keepVisibleRange: true });
    // 399 bars back from the newest one, as before.
    expect(c.getVisibleRange()).toEqual({ from: 900 * 60, to: 1100 * 60 });
  });
});
