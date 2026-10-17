import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeDevicePixelRatio, dispatch, fakeContainer, pendingFrames, runFrame } from './fake-dom';
import { Chart } from '../src/chart';
import type { RenderBackend } from '../src/gl/backend';
import { FramePacer, IDLE_AFTER_MS, IDLE_FRAME_MS, SLOW_SAMPLES } from '../src/frame-pacing';
import type { Bar, HeatmapData } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  changeDevicePixelRatio(1, 'never matches');
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const times = (n: number) => Array.from({ length: n }, (_, i) => i * 60);
const bar = (time: number, close = 1): Bar => ({ time, open: 1, high: 2, low: 0, close });

interface Inside {
  renderer: RenderBackend;
  raf: number;
  idleTimer: unknown;
  glCanvas: { width: number; height: number };
  bottom: { width: number; height: number };
  frame(now: number): void;
}
const inside = (c: Chart) => c as unknown as Inside;

function chart(options: ConstructorParameters<typeof Chart>[1] = {}) {
  const c = new Chart(fakeContainer(), { timezone: 'UTC', ...options });
  charts.push(c);
  const candles = c.addCandles();
  candles.setData(times(50).map((t) => bar(t)));
  inside(c).frame(1000);
  return { c, candles };
}

/** The system does not ask for reduced motion (the fake DOM does by default). */
function motionAllowed(): void {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
}

describe('FramePacer', () => {
  it('smooths the gaps between frames and ignores stalls', () => {
    const p = new FramePacer();
    expect(p.frameTime).toBeNull();
    p.sample(16);
    expect(p.frameTime).toBe(16);
    p.sample(26);
    expect(p.frameTime).toBeCloseTo(17);
    p.sample(5000);
    p.sample(0);
    expect(p.frameTime).toBeCloseTo(17);
  });

  it('reports a slow run once, and not a 30 Hz screen', () => {
    const p = new FramePacer();
    const reports = Array.from({ length: 200 }, () => p.sample(50)).filter(Boolean);
    expect(reports).toHaveLength(1);
    const thirty = new FramePacer();
    expect(Array.from({ length: 200 }, () => thirty.sample(1000 / 30)).some(Boolean)).toBe(false);
  });

  it('reports again after the frames recover and slow down again, or after a restart', () => {
    const p = new FramePacer();
    const run = (gap: number, n: number) => Array.from({ length: n }, () => p.sample(gap)).filter(Boolean).length;
    expect(run(50, 100)).toBe(1);
    p.restart();
    expect(run(50, SLOW_SAMPLES)).toBe(1);
    expect(run(16, 100)).toBe(0);
    expect(run(50, 100)).toBe(1);
  });

  it('holds frames back only while idle', () => {
    const p = new FramePacer();
    p.frameAt = 1000;
    expect(p.idleDelay(1010)).toBe(IDLE_FRAME_MS - 10);
    expect(p.idleDelay(1000 + IDLE_FRAME_MS)).toBe(0);
    p.inputAt = 1000;
    expect(p.idleDelay(1010)).toBe(0);
    // Input long ago, and a frame just now.
    p.frameAt = 1000 + IDLE_AFTER_MS + 10;
    expect(p.idleDelay(p.frameAt)).toBe(IDLE_FRAME_MS);
  });
});

describe('lowPower', () => {
  it('is off by default and changes nothing then', () => {
    changeDevicePixelRatio(2);
    const { c } = chart();
    expect(c.options.lowPower).toBe(false);
    expect(inside(c).glCanvas.width).toBe(1600);
  });

  it('caps the GPU layer at pixel ratio 1 and leaves the 2D layers sharp', () => {
    changeDevicePixelRatio(2);
    const { c } = chart({ lowPower: true });
    expect(inside(c).glCanvas.width).toBe(800);
    expect(inside(c).bottom.width).toBe(1600);
    c.applyOptions({ lowPower: false });
    expect(inside(c).glCanvas.width).toBe(1600);
    c.applyOptions({ lowPower: true, maxGlDpr: 0.5 });
    expect(inside(c).glCanvas.width).toBe(400);
  });

  it('turns off the forming-bar tween, and settles one already running', () => {
    const { c, candles } = chart();
    const shown = () => (candles as unknown as { shown: Bar | null }).shown;
    candles.update(bar(49 * 60, 1.8));
    expect(shown()).not.toBeNull();
    c.applyOptions({ lowPower: true });
    expect(candles.step(16)).toBe(false);
    expect(shown()).toBeNull();
    candles.update(bar(49 * 60, 1.2));
    expect(shown()).toBeNull();
    expect(candles.displayedBarAt(49)?.close).toBe(1.2);
  });

  it('turns off view easing, price-scale easing and the pulse ring', () => {
    motionAllowed();
    const { c } = chart();
    const animateTo = vi.spyOn(c.time, 'animateTo');
    c.scrollToRealtime();
    expect(animateTo.mock.calls.at(-1)![1]).toBeGreaterThan(0);
    c.time.cancelAnimation();
    c.applyOptions({ lowPower: true });
    c.scrollToRealtime();
    expect(animateTo.mock.calls.at(-1)![1]).toBe(0);
    inside(c).frame(2000);
    expect(c.panes[0]!.price.smooth).toBe(false);
    expect(c.animationsOff).toBe(true);
    // The option is left as the app set it.
    expect(c.options.smoothScale).toBe(true);
  });

  it('zooms a wheel notch in one step instead of easing', () => {
    const { c } = chart({ lowPower: true });
    const before = c.barSpacing;
    dispatch(c.root, 'wheel', { deltaY: -100, clientX: 400, clientY: 300 });
    expect(c.barSpacing).toBeGreaterThan(before);
    expect((c as unknown as { interaction: { zoomTarget: number | null } }).interaction.zoomTarget).toBeNull();
  });

  it('samples heatmaps at one cell per pixel', () => {
    const { c } = chart({ lowPower: true });
    const rows = 4;
    const data: HeatmapData = { times: times(50), priceStart: 0, priceStep: 0.5, rows, values: new Float32Array(rows * 50).fill(1) };
    const map = c.addHeatmap({ cellReduce: 'sum' });
    map.setData(data);
    const draw = vi.spyOn(inside(c).renderer, 'drawHeatmap');
    inside(c).frame(2000);
    expect(draw.mock.calls.at(-1)![1].reduce).toBe('nearest');
    c.applyOptions({ lowPower: false });
    inside(c).frame(2016);
    expect(draw.mock.calls.at(-1)![1].reduce).toBe('sum');
  });

  it('holds back frames while idle and lets input through at once', () => {
    vi.useFakeTimers();
    let now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { c } = chart({ lowPower: true });
    runFrame(now);
    inside(c).frame(now);
    expect(pendingFrames()).toBe(0);
    c.invalidate();
    // The previous frame ran just now: the next one waits for the idle frame gap.
    expect(inside(c).raf).toBe(0);
    expect(inside(c).idleTimer).not.toBeNull();
    vi.advanceTimersByTime(IDLE_FRAME_MS);
    expect(inside(c).raf).not.toBe(0);
    runFrame((now += IDLE_FRAME_MS + 16));
    c.invalidate();
    expect(inside(c).raf).toBe(0);
    dispatch(c.root, 'pointermove', { clientX: 100, clientY: 100 });
    expect(inside(c).idleTimer).toBeNull();
    expect(inside(c).raf).not.toBe(0);
  });

  it('requests frames at once when off, or when turned off while one waits', () => {
    vi.useFakeTimers();
    const now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { c } = chart({ lowPower: true });
    runFrame(now);
    inside(c).frame(now);
    c.invalidate();
    expect(inside(c).idleTimer).not.toBeNull();
    c.applyOptions({ lowPower: false });
    expect(inside(c).idleTimer).toBeNull();
    expect(inside(c).raf).not.toBe(0);
  });

  it('cancels a waiting frame on destroy', () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => 10_000);
    const { c } = chart({ lowPower: true });
    runFrame(10_000);
    inside(c).frame(10_000);
    c.invalidate();
    c.destroy();
    expect(inside(c).idleTimer).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('frame time', () => {
  /** Run `n` frames `gap` ms apart, with something animating so each follows the previous one. */
  function frames(c: Chart, n: number, gap: number, from = 5000): void {
    vi.spyOn(c as unknown as { stepPanes(dt: number): boolean }, 'stepPanes').mockReturnValue(true);
    for (let i = 0; i < n; i++) inside(c).frame(from + i * gap);
  }

  it('measures back-to-back frames and suggests low power once when they stay slow', () => {
    const { c } = chart();
    expect(c.frameTime).toBeNull();
    const slow = vi.fn();
    c.on('frame:slow', slow);
    frames(c, 120, 50);
    expect(c.frameTime).toBeCloseTo(50, 0);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(slow.mock.calls[0]![0].frameTime).toBeGreaterThan(35);
  });

  it('does not count a frame that follows a rest', () => {
    const { c } = chart();
    inside(c).frame(1500);
    inside(c).frame(1900);
    expect(c.frameTime).toBeNull();
  });

  it('does not suggest it while it is on, and does once it is turned off', () => {
    const { c } = chart({ lowPower: true });
    const slow = vi.fn();
    c.on('frame:slow', slow);
    frames(c, 120, 60);
    expect(c.frameTime).toBeCloseTo(60, 0);
    expect(slow).not.toHaveBeenCalled();
    c.applyOptions({ lowPower: false });
    frames(c, 120, 60, 20_000);
    expect(slow).toHaveBeenCalledTimes(1);
  });
});
