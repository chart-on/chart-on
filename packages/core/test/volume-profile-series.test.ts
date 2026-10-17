import { afterEach, describe, expect, it, vi } from 'vitest';
import { VolumeProfileSeries, utcDaySession, type VolumeProfileOptions } from '../src/profile/series';
import type { CandleSeries, PaneEnv, SeriesHost } from '../src/series';
import type { GLRenderer, SpanUniforms } from '../src/gl/renderer';
import type { RectBatch } from '../src/gl/rect-batch';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import type { Bar } from '../src/types';

const HOUR = 3600;
const DAY = 86400;

/** Hourly bars; each day trades around its own level, with a heavy narrow bar at noon. */
function hourly(days: number, start = 20 * DAY): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < days * 24; i++) {
    const level = 100 + Math.floor(i / 24) * 10;
    const heavy = i % 24 === 12;
    const spread = heavy ? 0.1 : 2;
    out.push({
      time: start + i * HOUR,
      open: level,
      high: level + spread,
      low: level - spread,
      close: level,
      volume: heavy ? 1000 : 10,
    });
  }
  return out;
}

interface Harness {
  series: VolumeProfileSeries;
  draws: { first: number; count: number; u: SpanUniforms }[];
  renders: number;
  draw(from: number, to: number): void;
  setBars(next: Bar[]): void;
}

function harness(bars: Bar[], options: Partial<VolumeProfileOptions>): Harness {
  let data = bars;
  const h = { draws: [], renders: 0 } as unknown as Harness;
  const host: SeriesHost = {
    timeline: new Timeline(),
    theme: darkTheme,
    maxTextureSize: 4096,
    mainDataChanged: () => {},
    mainLastBarChanged: () => {},
    requestRender: () => h.renders++,
  };
  const pane = new Pane(0, { stretch: 1, marginTop: 0.1, marginBottom: 0.1 });
  pane.price.height = 400;
  const source = { get data() { return data; }, format: (v: number) => v.toFixed(1) } as unknown as CandleSeries;
  const series = new VolumeProfileSeries(host, pane, options, () => source);
  pane.series.push(series);
  series.rebuild();
  const time = new TimeScale({ barSpacing: 4, minBarSpacing: 0.5, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 800;
  const renderer = {
    drawSpans: (_b: RectBatch, first: number, count: number, u: SpanUniforms) => h.draws.push({ first, count, u }),
  } as unknown as GLRenderer;
  h.series = series;
  h.draw = (from, to) => {
    time.barCount = data.length;
    const env: PaneEnv = { time, pane, width: 800, height: 400, from, to, dpr: 1, theme: darkTheme };
    series.drawGL(renderer, env);
  };
  h.setBars = (next) => (data = next);
  return h;
}

const pocText = (s: VolumeProfileSeries, index: number) => s.legend(index).parts[0]?.text;

describe('VolumeProfileSeries', () => {
  afterEach(() => vi.useRealTimers());

  it('builds one profile per UTC day', () => {
    const h = harness(hourly(3), { range: 'session', rows: 20 });
    h.draw(0, 71);
    expect(h.draws).toHaveLength(1);
    expect(h.draws[0]!.count).toBe(h.series.batch.count);
    // Each day's POC sits at its own level.
    expect(Number(pocText(h.series, 5))).toBeCloseTo(100, 0);
    expect(Number(pocText(h.series, 30))).toBeCloseTo(110, 0);
    expect(Number(pocText(h.series, 70))).toBeCloseTo(120, 0);
    expect(h.series.legend(30).parts.map((p) => p.label)).toEqual(['POC', 'VAH', 'VAL']);
  });

  it('draws only the sessions in view', () => {
    const h = harness(hourly(3), { range: 'session', rows: 20 });
    h.draw(0, 71);
    const all = h.draws[0]!;
    h.draw(30, 40);
    const day2 = h.draws[1]!;
    expect(day2.first).toBeGreaterThan(all.first);
    expect(day2.count).toBeLessThan(all.count);
    expect(day2.u.x).toEqual([4, 800 - (71 * 4)]);
  });

  it('accepts a custom session function', () => {
    const halfDays = (t: number) => Math.floor(t / (DAY / 2));
    const h = harness(hourly(2), { range: 'session', rows: 20, sessionOf: halfDays });
    h.draw(0, 47);
    const legends = new Set([0, 13, 25, 37].map((i) => JSON.stringify(h.series.legend(i))));
    expect(legends.size).toBe(4);
    expect(utcDaySession(DAY * 3 + 5)).toBe(3);
  });

  it('updates only the last session for live bars', () => {
    let calls = 0;
    const bars = hourly(10);
    const h = harness(bars, { range: 'session', throttleMs: 0, sessionOf: (t) => (calls++, utcDaySession(t)) });
    h.draw(0, bars.length - 1);
    expect(calls).toBeGreaterThanOrEqual(bars.length);
    calls = 0;
    const last = bars[bars.length - 1]!;
    bars[bars.length - 1] = { ...last, low: last.high + 49, high: last.high + 50, volume: 5000 };
    h.draw(0, bars.length - 1);
    expect(calls).toBeLessThanOrEqual(25);
    expect(Number(pocText(h.series, bars.length - 1))).toBeGreaterThan(last.high);
    // Appending to the same array also stays incremental.
    calls = 0;
    bars.push({ ...last, time: last.time + HOUR });
    h.draw(0, bars.length - 1);
    expect(calls).toBeLessThanOrEqual(26);
  });

  it('recomputes everything when the data is replaced', () => {
    let calls = 0;
    const h = harness(hourly(4), { range: 'session', sessionOf: (t) => (calls++, utcDaySession(t)) });
    h.draw(0, 95);
    calls = 0;
    h.setBars(hourly(4, 10 * DAY));
    h.draw(0, 95);
    expect(calls).toBeGreaterThanOrEqual(96);
  });

  it('profiles the visible bars and throttles view changes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const bars = hourly(3);
    const h = harness(bars, { range: 'visible', rows: 20, throttleMs: 100 });
    h.draw(0, 23);
    expect(Number(pocText(h.series, 0))).toBeCloseTo(100, 0);
    expect(h.draws[0]!.u.x).toEqual([-400, 800]);
    // Within the throttle window the old profile stays and a redraw is scheduled.
    vi.advanceTimersByTime(10);
    h.draw(48, 71);
    expect(Number(pocText(h.series, 0))).toBeCloseTo(100, 0);
    expect(h.renders).toBe(0);
    vi.advanceTimersByTime(100);
    expect(h.renders).toBe(1);
    h.draw(48, 71);
    expect(Number(pocText(h.series, 0))).toBeCloseTo(120, 0);
  });

  it.each([
    [400, 32],
    [200, 16],
  ])('without rows, gives a %i px pane one row per 10 px of the profile', (height, rows) => {
    const h = harness(hourly(1), { range: 'visible' });
    const scale = h.series.pane.price;
    scale.height = height;
    // Prices 98..102 fill the pane between the 10 % margins: 80 % of its height.
    scale.fit(98, 102);
    h.draw(0, 23);
    expect(h.series.batch.count).toBe(rows);
  });

  it('applies option changes at once and follows placement', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const h = harness(hourly(1), { range: 'visible', throttleMs: 1000 });
    h.draw(0, 23);
    const rows = h.series.batch.count;
    h.series.applyOptions({ rows: 5, placement: 'left', width: 0.5 });
    h.draw(0, 23);
    expect(h.series.batch.count).toBeLessThan(rows);
    expect(h.draws[1]!.u.x).toEqual([400, 0]);
  });

  it('stacks buy and sell volume when bars carry it', () => {
    const bars = hourly(1).map((b) => ({ ...b, buyVolume: b.volume! * 0.25 }));
    const split = harness(bars, { range: 'visible', rows: 10 });
    split.draw(0, 23);
    const plain = harness(hourly(1), { range: 'visible', rows: 10 });
    plain.draw(0, 23);
    expect(split.series.batch.count).toBe(plain.series.batch.count * 2);
  });

  it('rejects invalid row options up front and leaves the options unchanged', () => {
    expect(() => harness(hourly(1), { rowSize: Infinity })).toThrow(/rowSize/);
    expect(() => harness(hourly(1), { rows: NaN })).toThrow(/rows/);
    const h = harness(hourly(1), { range: 'visible', rows: 10 });
    expect(() => h.series.applyOptions({ rows: 0 })).toThrow(/rows/);
    expect(() => h.series.applyOptions({ rowSize: -2 })).toThrow(/rowSize/);
    expect(h.series.options.rows).toBe(10);
    expect(h.series.options.rowSize).toBeUndefined();
  });

  it('draws nothing without bars or volume', () => {
    const none = harness([], { range: 'visible' });
    none.draw(0, -1);
    expect(none.draws).toHaveLength(0);
    expect(none.series.legend(0).parts).toEqual([]);
    const silent = harness(hourly(1).map((b) => ({ ...b, volume: 0 })), { range: 'session' });
    silent.draw(0, 23);
    expect(silent.series.batch.count).toBe(0);
    expect(silent.series.legend(3).parts).toEqual([]);
  });
});
