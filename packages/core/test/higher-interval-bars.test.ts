import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { higherBarEnd, higherBarSteps, higherIntervalBars, nextIntervalUp } from '../src/higher-interval-bars';
import type { DataSource, Interval, SymbolInfo } from '../src/data/types';
import type { BarArrays } from '../src/indicators/types';
import type { Primitive, PrimitiveEnv, PrimitiveTarget } from '../src/primitives';
import type { Bar } from '../src/types';
import { darkTheme } from '../src/theme';
import { UTC, zoneOf } from '../src/util/timezone';

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
/** 2023-11-15 00:00 UTC, a whole hour. */
const T0 = 1700006400;

const charts: Chart[] = [];
afterEach(() => {
  for (const c of charts.splice(0)) c.destroy();
});

function arrays(bars: readonly Bar[]): BarArrays {
  const col = (f: (b: Bar) => number) => Float64Array.from(bars, f);
  return {
    length: bars.length,
    time: col((b) => b.time),
    open: col((b) => b.open),
    high: col((b) => b.high),
    low: col((b) => b.low),
    close: col((b) => b.close),
    volume: col((b) => b.volume ?? NaN),
  };
}

function bar(time: number, close: number): Bar {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 1 };
}

function aggregate(bars: readonly Bar[], start: (time: number) => number): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const time = start(b.time);
    const last = out[out.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
    } else out.push({ ...b, time });
  }
  return out;
}

describe('nextIntervalUp', () => {
  it('picks the next step longer than the chart interval', () => {
    expect(nextIntervalUp('1m')).toBe('5m');
    expect(nextIntervalUp('5m')).toBe('15m');
    expect(nextIntervalUp('30m')).toBe('1h');
    expect(nextIntervalUp('1d')).toBe('1w');
    expect(nextIntervalUp('1M')).toBeNull();
    expect(nextIntervalUp(null)).toBeNull();
  });
});

describe('higherBarEnd', () => {
  it('ends a daily bar on the next wall-clock day across a DST change', () => {
    const ny = zoneOf('America/New_York');
    // 2023-11-05 00:00 New York: clocks go back that night, so the day has 25 hours.
    const day = ny.fromWall(Date.UTC(2023, 10, 5) / 1000);
    expect(higherBarEnd(day, '1d', ny) - day).toBe(25 * HOUR);
    expect(higherBarEnd(day, '1h', ny) - day).toBe(HOUR);
    expect(higherBarEnd(Date.UTC(2023, 0, 1) / 1000, '1M', UTC)).toBe(Date.UTC(2023, 1, 1) / 1000);
  });
});

describe('higherBarSteps', () => {
  const higher = arrays([
    { time: 0, open: 1, high: 5, low: 0, close: 4 },
    { time: HOUR, open: 4, high: 6, low: 3, close: 3 },
    // No bar for the third hour.
    { time: 3 * HOUR, open: 3, high: 9, low: 2, close: 8 },
  ]);
  const end = (t: number) => t + HOUR;
  const half = HOUR / 2;

  it('gives each chart bar its higher bar and slot, and leaves a missing higher bar empty', () => {
    const out = higherBarSteps([-half, 0, half, HOUR, 3 * half, 2 * HOUR, 5 * half, 3 * HOUR, 7 * half], higher, 0, end);
    expect([...out.slot!]).toEqual([NaN, 0, 0, 1, 1, NaN, NaN, 2, 2]);
    expect([...out.high!]).toEqual([NaN, 5, 5, 6, 6, NaN, NaN, 9, 9]);
    expect([...out.close!]).toEqual([NaN, 4, 4, 3, 3, NaN, NaN, 8, 8]);
  });

  it('keeps only the newest `count` higher bars', () => {
    const out = higherBarSteps([0, HOUR, 3 * HOUR], higher, 2, end);
    expect([...out.slot!]).toEqual([NaN, 1, 2]);
    expect([...out.open!]).toEqual([NaN, 4, 3]);
  });
});

/** 600 minute bars with closes 0..599, and hourly bars aggregated from them. */
const MINUTES = Array.from({ length: 600 }, (_, i) => bar(T0 + i * MINUTE, i));
const HOURS = aggregate(MINUTES, (t) => Math.floor(t / HOUR) * HOUR);

interface Setup {
  series?: Record<string, Bar[]>;
  timezone?: string;
}

async function setup(interval: Interval = '1m', { series = { '1m': MINUTES, '1h': HOURS }, timezone }: Setup = {}) {
  const calls: Interval[] = [];
  const live: ((bar: Bar) => void)[] = [];
  const source: DataSource = {
    symbol: async (symbol) => ({ symbol, name: symbol, ...(timezone ? { timezone } : {}) }) as SymbolInfo,
    search: async () => [],
    history: async (_info, iv, req) => {
      calls.push(iv);
      const page = (series[iv] ?? []).filter((b) => req.to === undefined || b.time < req.to).slice(-req.limit);
      return { bars: page.map((b) => ({ ...b })), atStart: page.length < req.limit };
    },
    stream: (_info, _iv, onBar) => {
      live.push(onBar);
      return () => {};
    },
  };
  const chart = new Chart(fakeContainer());
  charts.push(chart);
  const attachedTo: { primitive: Primitive; target: PrimitiveTarget }[] = [];
  const attach = chart.attachPrimitive.bind(chart);
  chart.attachPrimitive = (primitive, target = {}) => {
    attachedTo.push({ primitive, target });
    return attach(primitive, target);
  };
  chart.setDataSource(source, { initialBars: 150, pageBars: 100 });
  await chart.setSymbol('A', interval);
  const uninstall = chart.install(higherIntervalBars());
  /** The primitive drawing the newest indicator's boxes. */
  const primitive = () => attachedTo[attachedTo.length - 1]!.primitive;
  return { chart, calls, live, attachedTo, primitive, uninstall };
}

/** A canvas context that records the boxes drawn. */
function recordingContext() {
  const boxes: { kind: 'fill' | 'stroke'; color: string; x: number; y: number; w: number; h: number }[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    setLineDash() {},
    fillRect(x: number, y: number, w: number, h: number) {
      boxes.push({ kind: 'fill', color: ctx.fillStyle, x, y, w, h });
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      boxes.push({ kind: 'stroke', color: ctx.strokeStyle, x, y, w, h });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, boxes };
}

function env(from: number, to: number): PrimitiveEnv {
  return {
    width: 800,
    height: 400,
    pixelRatio: 1,
    theme: darkTheme,
    from,
    to,
    barSpacing: 4,
    times: [],
    indexToX: (i) => i * 4,
    xToIndex: (x) => x / 4,
    timeToX: () => 0,
    priceToY: (p) => 1000 - p,
    yToPrice: (y) => 1000 - y,
    formatPrice: String,
  };
}

const nextTask = (globalThis as unknown as { setImmediate(fn: () => void): void }).setImmediate;
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => nextTask(r));
}

describe('higherIntervalBars plugin', () => {
  it('adds the indicator, which loads the higher bars and draws a range and body box per higher bar', async () => {
    const { chart, primitive, attachedTo } = await setup();
    const ind = chart.indicators.add('higher-interval-bars', { interval: '1h' });
    await settle();
    expect(ind.status).toBe('loaded');
    // Attached to the indicator's own series, so it follows its pane and price scale.
    expect(attachedTo[attachedTo.length - 1]!.target.series).toBe(ind.series);
    const n = chart.main!.data.length;
    const { ctx, boxes } = recordingContext();
    primitive().drawPlot!(ctx, env(0, n - 1));
    const hours = new Set(chart.main!.data.map((b) => Math.floor(b.time / HOUR))).size;
    expect(boxes).toHaveLength(hours * 2);
    // Closes rise, so every higher bar is an up bar in the theme's colour.
    expect(boxes.every((b) => b.color === darkTheme.up && b.kind === 'fill')).toBe(true);
    // The first box starts at the left edge of the first chart bar.
    expect(boxes[0]!.x).toBe(-2);
    // The boxes of the bars in view stay in view: the chart starts inside an hour, whose low is lower.
    const [lo, hi] = primitive().priceRange!(0, n - 1)!;
    expect(lo).toBe((Math.floor(chart.main!.data[0]!.time / HOUR) * HOUR - T0) / MINUTE - 1);
    expect(hi).toBe(chart.main!.data[n - 1]!.high);
  });

  it('builds the forming higher bar from the chart bars on first load', async () => {
    // The source has no bar yet for the hour the chart ends in.
    const { chart } = await setup('1m', { series: { '1m': MINUTES, '1h': HOURS.slice(0, -1) } });
    const ind = chart.indicators.add('higher-interval-bars', { interval: '1h' });
    await settle();
    const data = chart.main!.data;
    const k = data.length - 1;
    const hourStart = Math.floor(data[k]!.time / HOUR) * HOUR;
    const inHour = data.filter((b) => b.time >= hourStart);
    expect(ind.values.open![k]).toBe(inHour[0]!.open);
    expect(ind.values.high![k]).toBe(Math.max(...inHour.map((b) => b.high)));
    expect(ind.values.close![k]).toBe(data[k]!.close);
    expect(ind.values.slot![k]).toBe(ind.values.slot![k - inHour.length + 1]);
  });

  it('keeps a daily box whole across a 25-hour DST day in the symbol timezone', async () => {
    const ny = zoneOf('America/New_York');
    const start = ny.fromWall(Date.UTC(2023, 10, 3) / 1000);
    const hourly = Array.from({ length: 24 * 4 + 1 }, (_, i) => bar(start + i * HOUR, i));
    const daily = aggregate(hourly, (t) => ny.fromWall(Math.floor(ny.wall(t) / DAY) * DAY));
    const { chart } = await setup('1h', { series: { '1h': hourly, '1d': daily }, timezone: 'America/New_York' });
    const ind = chart.indicators.add('higher-interval-bars', { interval: '1d' });
    await settle();
    const fallBack = ny.fromWall(Date.UTC(2023, 10, 5) / 1000);
    const times = chart.main!.data.map((b) => b.time);
    const slots = times.flatMap((t, k) => (t >= fallBack && t < fallBack + 25 * HOUR ? [ind.values.slot![k]] : []));
    expect(slots).toHaveLength(25);
    expect(new Set(slots).size).toBe(1);
    expect(Number.isNaN(slots[0])).toBe(false);
  });

  it('draws outlines and only the newest bars when asked', async () => {
    const { chart, primitive } = await setup();
    chart.indicators.add('higher-interval-bars', { interval: '1h', style: 'outline', count: 1, upColor: '#123456' });
    await settle();
    const { ctx, boxes } = recordingContext();
    primitive().drawPlot!(ctx, env(0, chart.main!.data.length - 1));
    expect(boxes.map((b) => [b.kind, b.color])).toEqual([
      ['stroke', '#123456'],
      ['stroke', '#123456'],
    ]);
  });

  it('moves the forming box with live bars without loading again', async () => {
    const { chart, primitive, calls, live } = await setup();
    const ind = chart.indicators.add('higher-interval-bars', { interval: '1h' });
    await settle();
    const loads = calls.length;
    const last = chart.main!.data[chart.main!.data.length - 1]!;
    live[0]!({ ...last, high: 5000, close: 4000 });
    const k = chart.main!.data.length - 1;
    expect(ind.values.high![k]).toBe(5000);
    expect(ind.values.close![k]).toBe(4000);
    // The box reads its last bar, so it shows the new high.
    expect(primitive().priceRange!(k - 5, k)![1]).toBe(5000);
    // A minute in the next hour starts a new box.
    live[0]!(bar(Math.floor(last.time / HOUR) * HOUR + HOUR, 4100));
    const slot = ind.values.slot!;
    expect(slot[slot.length - 1]).toBe(slot[slot.length - 2]! + 1);
    const { ctx, boxes } = recordingContext();
    primitive().drawPlot!(ctx, env(slot.length - 1, slot.length - 1));
    expect(boxes).toHaveLength(2);
    await settle();
    expect(calls.length).toBe(loads);
  });

  it('follows the chart interval in auto mode, and says why on the longest one', async () => {
    const months = [0, 1, 2].map((m) => bar(Date.UTC(2023, m, 1) / 1000, m));
    const { chart, calls } = await setup('1m', {
      series: { '1m': MINUTES, '5m': aggregate(MINUTES, (t) => Math.floor(t / 300) * 300), '1h': HOURS, '1M': months },
    });
    const ind = chart.indicators.add('higher-interval-bars');
    await settle();
    expect(calls).toContain('5m');
    await chart.setSymbol('A', '5m');
    await settle();
    expect(calls).toContain('15m');
    await chart.setSymbol('A', '1M');
    await settle();
    expect(ind.message).toBe('No longer interval above 1M');
  });

  it('draws nothing and says why on a chart interval that is not shorter', async () => {
    const { chart, primitive } = await setup('1h', { series: { '1h': HOURS } });
    const ind = chart.indicators.add('higher-interval-bars', { interval: '1h' });
    await settle();
    expect(ind.message).toBe('Needs a chart interval below 1h');
    const { ctx, boxes } = recordingContext();
    primitive().drawPlot!(ctx, env(0, 100));
    expect(boxes).toHaveLength(0);
  });

  it('never asks for a trade or volume interval', async () => {
    const { chart, calls } = await setup('1m', { series: { '1m': MINUTES } });
    expect(() => chart.indicators.add('higher-interval-bars', { interval: '100T' })).toThrow();
    await settle();
    expect(calls).not.toContain('100T');
  });

  it('removes its indicators and definition on uninstall', async () => {
    const { chart, uninstall } = await setup();
    chart.indicators.add('higher-interval-bars', { interval: '1h' });
    await settle();
    uninstall();
    expect(chart.indicators.getAll().some((i) => i.type === 'higher-interval-bars')).toBe(false);
    expect(chart.indicators.getDefinitions().some((d) => d.id === 'higher-interval-bars')).toBe(false);
  });
});
