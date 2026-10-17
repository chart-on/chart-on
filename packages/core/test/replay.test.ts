import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { volumeOf } from '../src/series';
import type { DataSource, SymbolInfo } from '../src/data/types';
import type { IndicatorDef } from '../src/indicators/types';
import type { Bar } from '../src/types';
import { intrabar, type ReplayState } from '../src/replay';
import { cancelPickBar, pickBar } from '../src/pick-bar';

const bar = (i: number, close = 100 + i): Bar => ({ time: i * 60, open: close, high: close + 1, low: close - 1, close, volume: 10 + i });
const bars = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => bar(from + k));
const flush = () => new Promise((r) => setTimeout(r, 0));

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function chart(data = bars(0, 20)) {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles({ animate: false }).setData(data);
  return c;
}

/** A source with `history` bars that pages back and streams live bars from `push`. */
function source(history: Bar[]) {
  let live: ((bar: Bar) => void) | null = null;
  const s: DataSource = {
    symbol: async (symbol) => ({ symbol, name: symbol }) as SymbolInfo,
    search: async () => [],
    history: async (_symbol, _interval, request) => {
      const older = history.filter((b) => request.to === undefined || b.time < request.to);
      const page = older.slice(-request.limit);
      return { bars: page, atStart: page.length < request.limit };
    },
    stream: (_symbol, _interval, onBar) => {
      live = onBar;
      return () => {};
    },
  };
  return { source: s, push: (b: Bar) => live?.(b) };
}

const closeIndicator: IndicatorDef = {
  id: 'test/close',
  name: 'Close',
  placement: 'pane',
  inputs: [],
  plots: [{ id: 'value', type: 'line' }],
  compute: (src) => ({ value: Float64Array.from(src.close) }),
};

describe('chart.replay', () => {
  it('hides bars after the start time from the series, followers, indicators and legend', () => {
    const c = chart();
    const volume = c.addHistogram({ follow: volumeOf });
    c.indicators.register(closeIndicator);
    const indicator = c.indicators.add('test/close');
    const states: ReplayState[] = [];
    c.on('replay:change', (s) => states.push(s));
    expect(c.replay.start(9 * 60 + 30)).toBe(true);
    expect(c.main!.data).toHaveLength(10);
    expect(volume.data).toHaveLength(10);
    expect(c.timeline.length).toBe(10);
    const newest = c.valuesAt()!;
    expect(newest.time).toBe(9 * 60);
    const ind = newest.series.find((s) => s.series === indicator.series)!;
    // The indicator's newest value is bar 9's close, not a later one.
    expect(ind.legend!.parts.map((p) => p.text)).toContain('109.00');
    expect(states.at(-1)).toEqual({ active: true, playing: false, time: 540, speed: 1, remaining: 10 });
  });

  it('steps forward, and stop shows every bar again', () => {
    const c = chart();
    c.replay.start(0);
    expect(c.main!.data).toHaveLength(1);
    expect(c.replay.step()).toBe(true);
    expect(c.replay.step(5)).toBe(true);
    expect(c.main!.data).toHaveLength(7);
    expect(c.replay.step(100)).toBe(true);
    expect(c.replay.step()).toBe(false);
    c.replay.start(3 * 60);
    expect(c.main!.data).toHaveLength(4);
    c.replay.stop();
    expect(c.main!.data).toHaveLength(20);
    expect(c.replay.state.active).toBe(false);
  });

  it('shows the bar at exactly the start time at real Unix-second magnitudes', () => {
    // Daily bars around 2026: one ULP of these times is far above a nano-epsilon.
    const day = 86_400;
    const first = 1_786_000_000 - (1_786_000_000 % day);
    const daily = Array.from({ length: 10 }, (_, k) => ({ ...bar(k), time: first + k * day }));
    const c = chart(daily);
    const picked = daily[6]!.time;
    expect(c.replay.start(picked)).toBe(true);
    expect(c.replay.state.time).toBe(picked);
    expect(c.main!.data.at(-1)!.time).toBe(picked);
    expect(c.replay.state.remaining).toBe(3);
    // Between two bars: the newest at or before the time.
    expect(c.replay.start(picked + day / 2)).toBe(true);
    expect(c.replay.state.time).toBe(picked);
    // New full bars keep the replay on the same bar.
    c.replay.replaceAll(daily.map((b) => ({ ...b, close: b.close + 1 })));
    expect(c.replay.state.time).toBe(picked);
    expect(c.main!.data.at(-1)!.time).toBe(picked);
  });

  it('refuses a time before the first bar', () => {
    const c = chart(bars(5, 10));
    expect(c.replay.start(0)).toBe(false);
    expect(c.replay.state.active).toBe(false);
    expect(() => c.replay.start(Number.NaN)).toThrow(RangeError);
  });

  it('plays at the chosen speed and pauses at the end', () => {
    vi.useFakeTimers();
    const c = chart(bars(0, 5));
    c.replay.start(0);
    c.replay.play(2);
    expect(c.replay.state.playing).toBe(true);
    vi.advanceTimersByTime(500);
    expect(c.main!.data).toHaveLength(2);
    expect(c.replay.state.playing).toBe(true);
    c.replay.pause();
    vi.advanceTimersByTime(5000);
    expect(c.main!.data).toHaveLength(2);
    c.replay.play();
    vi.advanceTimersByTime(5000);
    expect(c.main!.data).toHaveLength(5);
    expect(c.replay.state).toMatchObject({ playing: false, remaining: 0 });
    expect(() => (c.replay.speed = 0)).toThrow(RangeError);
  });

  it('keeps live bars and history pages hidden behind the replay time', async () => {
    const feed = source(bars(0, 300));
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.setDataSource(feed.source, { initialBars: 100, pageBars: 50 });
    await c.setSymbol('A', '1m');
    expect(c.main!.data[0]!.time).toBe(200 * 60);
    c.replay.start(250 * 60);
    feed.push(bar(300));
    feed.push(bar(300, 1));
    expect(c.main!.data.at(-1)!.time).toBe(250 * 60);
    await c.data!.loadMore();
    // Older bars arrive, the replay time holds.
    expect(c.main!.data[0]!.time).toBe(150 * 60);
    expect(c.main!.data.at(-1)!.time).toBe(250 * 60);
    expect(c.replay.state.remaining).toBe(50);
    c.replay.stop();
    expect(c.main!.data.at(-1)).toEqual(bar(300, 1));
  });

  it('ends when another symbol loads', async () => {
    const feed = source(bars(0, 50));
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.setDataSource(feed.source);
    await c.setSymbol('A', '1m');
    c.replay.start(10 * 60);
    await c.setSymbol('B', '1m');
    expect(c.replay.state.active).toBe(false);
    expect(c.main!.data).toHaveLength(50);
  });
});

describe('chart.replay.startRandom', () => {
  it('starts inside the margins, at both ends of the random range', () => {
    const c = chart(bars(0, 200));
    expect(c.replay.startRandom({ random: () => 0 })).toBe(true);
    // 100 bars before the start, 50 after it by default.
    expect(c.replay.state).toMatchObject({ active: true, time: 100 * 60, remaining: 99 });
    c.replay.stop();
    expect(c.replay.startRandom({ random: () => 0.999999 })).toBe(true);
    expect(c.replay.state).toMatchObject({ time: 149 * 60, remaining: 50 });
    c.replay.stop();
    expect(c.replay.startRandom({ minBefore: 5, minAfter: 5, random: () => 0.5 })).toBe(true);
    expect(c.replay.state.time).toBe(100 * 60);
  });

  it('returns false and changes nothing when the bars are too few', () => {
    const c = chart(bars(0, 20));
    const changes: ReplayState[] = [];
    c.on('replay:change', (s) => changes.push(s));
    expect(c.replay.startRandom()).toBe(false);
    expect(c.replay.startRandom({ minBefore: 10, minAfter: 10 })).toBe(false);
    expect(c.replay.state.active).toBe(false);
    expect(c.main!.data).toHaveLength(20);
    expect(changes).toEqual([]);
    // Exactly one bar fits.
    expect(c.replay.startRandom({ minBefore: 10, minAfter: 9, random: () => 0.7 })).toBe(true);
    expect(c.replay.state.time).toBe(10 * 60);
  });

  it('restarts at another bar from all the bars, not only those shown', () => {
    const c = chart(bars(0, 20));
    const random = () => 0;
    expect(c.replay.startRandom({ minBefore: 2, minAfter: 2, random })).toBe(true);
    expect(c.replay.state.time).toBe(2 * 60);
    // The same draw would land on the current bar: the next one is taken instead.
    expect(c.replay.startRandom({ minBefore: 2, minAfter: 2, random })).toBe(true);
    expect(c.replay.state.time).toBe(3 * 60);
    expect(c.replay.startRandom({ minBefore: 2, minAfter: 2, random: () => 0.999 })).toBe(true);
    expect(c.replay.state).toMatchObject({ time: 17 * 60, remaining: 2 });
    // A single slot that the replay already stands on: it stays.
    expect(c.replay.startRandom({ minBefore: 17, minAfter: 2, random })).toBe(true);
    expect(c.replay.state.time).toBe(17 * 60);
  });
});

describe('smooth replay', () => {
  /** Bars with a real range, so a growing bar differs from the finished one. */
  const wide = (from: number, to: number) => bars(from, to).map((b) => ({ ...b, high: b.close + 5, low: b.close - 5 }));
  /** A chart on a system that allows motion (the test DOM asks for reduced motion). */
  const moving = (data: Bar[]) => {
    const c = chart(data);
    vi.stubGlobal('matchMedia', (query: string) => ({ query, matches: false, addEventListener() {}, removeEventListener() {} }));
    return c;
  };
  const view = (c: Chart) =>
    (
      c as unknown as {
        time: { animating: boolean; barSpacing: number; indexToX(index: number): number; step(dt: number): boolean };
      }
    ).time;

  it('walks a made-up path inside the bar from its open to its close', () => {
    const up: Bar = { time: 0, open: 100, high: 110, low: 95, close: 105, volume: 50, buyVolume: 20 };
    // Open, down to the low (5), up to the high (15), back to the close (5).
    expect(intrabar(up, 0)).toEqual({ ...up, high: 100, low: 100, close: 100, volume: 0, buyVolume: 0 });
    expect(intrabar(up, 0.2)).toMatchObject({ high: 100, low: 95, close: 95, volume: 10 });
    expect(intrabar(up, 0.6)).toMatchObject({ high: 105, low: 95, close: 105 });
    expect(intrabar(up, 1)).toBe(up);
    const down: Bar = { time: 0, open: 100, high: 104, low: 90, close: 92 };
    // Open, up to the high (4), down to the low (14), back to the close (2).
    expect(intrabar(down, 0.1)).toMatchObject({ high: 102, low: 100, close: 102 });
    expect(intrabar(down, 0.9)).toMatchObject({ high: 104, low: 90, close: 90 });
    const flat: Bar = { time: 0, open: 1, high: 1, low: 1, close: 1 };
    expect(intrabar(flat, 0.5)).toEqual(flat);
  });

  it('grows each bar from its open while playing, then shows its real values', () => {
    vi.useFakeTimers();
    const data = wide(0, 4);
    const c = moving(data);
    c.replay.start(0);
    c.replay.play(1);
    vi.advanceTimersByTime(1000);
    expect(c.main!.data).toHaveLength(2);
    const open = data[1]!.open;
    expect(c.main!.data[1]).toMatchObject({ high: open, low: open, close: open, volume: 0 });
    // The view slides onto the new bar instead of jumping.
    expect(view(c).animating).toBe(true);
    vi.advanceTimersByTime(500);
    const half = c.main!.data[1]!;
    expect(half.high - half.low).toBeGreaterThan(0);
    expect(half).not.toEqual(data[1]);
    vi.advanceTimersByTime(500);
    expect(c.main!.data).toHaveLength(3);
    expect(c.main!.data[1]).toEqual(data[1]);
    vi.advanceTimersByTime(5000);
    expect(c.main!.data).toEqual(data);
    expect(c.replay.state).toMatchObject({ playing: false, remaining: 0 });
  });

  it('keeps the bars in place when one is revealed, then slides them left a bar at constant speed', () => {
    vi.useFakeTimers();
    const c = moving(wide(0, 10));
    c.replay.start(3 * 60);
    const t = view(c);
    // A first frame sizes the price axis to its labels.
    c.invalidate();
    (c as unknown as { render(dt: number): boolean }).render(0);
    // Let the start's scroll to the newest bar finish.
    while (t.step(100));
    const before = t.indexToX(2);
    c.replay.play(1);
    vi.advanceTimersByTime(1000);
    expect(c.main!.data).toHaveLength(5);
    expect(t.indexToX(2)).toBeCloseTo(before, 6);
    t.step(500);
    // Halfway through the bar: half a bar left, give or take the pixel snapping.
    expect(Math.abs(t.indexToX(2) - (before - t.barSpacing / 2))).toBeLessThanOrEqual(1);
    t.step(500);
    expect(t.indexToX(2)).toBeCloseTo(before - t.barSpacing, 6);
  });

  it('settles a growing bar on pause, step and stop', () => {
    vi.useFakeTimers();
    const data = wide(0, 6);
    const c = moving(data);
    c.replay.start(0);
    c.replay.play(1);
    vi.advanceTimersByTime(1300);
    c.replay.pause();
    expect(c.main!.data).toEqual(data.slice(0, 2));
    c.replay.play();
    vi.advanceTimersByTime(1300);
    expect(c.replay.step()).toBe(true);
    expect(c.main!.data).toEqual(data.slice(0, 4));
    vi.advanceTimersByTime(300);
    c.replay.stop();
    expect(c.main!.data).toEqual(data);
  });

  it('shows whole bars when smooth is off, playback is fast, the chart is in low power or motion is reduced', () => {
    vi.useFakeTimers();
    const data = wide(0, 10);
    const c = moving(data);
    c.replay.smooth = false;
    c.replay.start(0);
    c.replay.play(1);
    vi.advanceTimersByTime(1000);
    expect(c.main!.data).toEqual(data.slice(0, 2));
    expect(view(c).animating).toBe(false);
    c.replay.smooth = true;
    c.replay.speed = 10;
    vi.advanceTimersByTime(1000);
    expect(c.main!.data).toEqual(data.slice(0, 3));
    vi.advanceTimersByTime(100);
    expect(c.main!.data).toEqual(data.slice(0, 4));
    c.applyOptions({ lowPower: true });
    c.replay.speed = 1;
    vi.advanceTimersByTime(1000);
    expect(c.main!.data).toEqual(data.slice(0, 5));
    c.applyOptions({ lowPower: false });
    vi.unstubAllGlobals();
    vi.advanceTimersByTime(1000);
    expect(c.main!.data).toEqual(data.slice(0, 6));
  });
});

describe('pickBar', () => {
  const click = (c: Chart, index: number) =>
    (c as unknown as { emit(event: string, payload: unknown): void }).emit('plot:click', { time: index * 60, index, price: 1, pane: 0, x: 0, y: 0 });

  it('resolves with the clicked bar, ignoring clicks past the bars', async () => {
    const c = chart();
    const cursor = c.root.style.cursor;
    const picked = pickBar(c);
    expect(c.root.style.cursor).toBe('crosshair');
    click(c, 40);
    click(c, 4);
    expect(await picked).toEqual({ time: 240, index: 4, bar: bar(4) });
    expect(c.root.style.cursor).toBe(cursor);
    expect(c.listens('plot:click')).toBe(false);
  });

  it('resolves with null on Escape, another pick, cancel or destroy', async () => {
    const c = chart();
    const first = pickBar(c);
    const second = pickBar(c);
    expect(await first).toBeNull();
    dispatch(c.root, 'keydown', { key: 'Escape' });
    expect(await second).toBeNull();
    const third = pickBar(c);
    cancelPickBar(c);
    expect(await third).toBeNull();
    const fourth = pickBar(c);
    c.destroy();
    expect(await fourth).toBeNull();
    // Already destroyed: null at once, and the cursor stays.
    const cursor = c.root.style.cursor;
    expect(await pickBar(c)).toBeNull();
    expect(c.root.style.cursor).toBe(cursor);
  });
});

describe('chart.goToTime', () => {
  it('pages history in until the time is loaded, then scrolls there', async () => {
    const feed = source(bars(0, 1000));
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.setDataSource(feed.source, { initialBars: 100, pageBars: 100 });
    await c.setSymbol('A', '1m');
    const scroll = vi.spyOn(c, 'scrollToTime');
    await c.goToTime(450 * 60, false);
    expect(c.main!.data[0]!.time).toBeLessThanOrEqual(450 * 60);
    expect(scroll).toHaveBeenCalledWith(450 * 60, false);
    await flush();
  });

  it('loads one history page per task', async () => {
    const feed = source(bars(0, 1000));
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.setDataSource(feed.source, { initialBars: 100, pageBars: 100 });
    await c.setSymbol('A', '1m');
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let pages = 0;
    c.on('data:loaded', ({ kind }) => kind === 'history' && pages++);
    const going = c.goToTime(650 * 60, false);
    for (let i = 0; i < 100; i++) await Promise.resolve();
    expect(pages).toBe(0);
    await vi.runOnlyPendingTimersAsync();
    expect(pages).toBe(1);
    await vi.runAllTimersAsync();
    await going;
    // Bars 900 to 999 first, then 800, 700 and 600 onwards.
    expect(pages).toBe(3);
  });
});
