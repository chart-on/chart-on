import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeDevicePixelRatio, fakeContainer, pendingFrames, recordingWebgl2, runFrame } from './fake-dom';
import { Chart, type ChartOptions } from '../src/chart';
import { RECT_STRIDE } from '../src/gl/rect-batch';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  changeDevicePixelRatio(1);
  vi.restoreAllMocks();
});

const bar = (i: number, close = 10): Bar => ({ time: i * 60, open: 10, high: 12, low: 8, close });
const bars = (n: number) => Array.from({ length: n }, (_, i) => bar(i));

function chart(options: Partial<ChartOptions> = {}, webgl?: unknown) {
  const c = new Chart(fakeContainer({ webgl }), options);
  charts.push(c);
  return c;
}

interface Internals {
  time: { step(dt: number): boolean; animateTo(target: { barSpacing?: number }, ms: number): void };
  bottom: { width: number; height: number };
  top: { width: number; height: number };
  glCanvas: { width: number; height: number };
  root: { getBoundingClientRect(): { width: number; height: number } };
  renderer: { beginFrame(dpr: number): void };
}
const inside = (c: Chart) => c as unknown as Internals;

/** Run frames until none is requested (at most `limit`), 16 ms apart from `start`; returns the time after the last. */
function settle(start = 1000, limit = 100): number {
  let now = start;
  for (let i = 0; i < limit && pendingFrames() > 0; i++) runFrame((now += 16));
  return now;
}

describe('frame loop', () => {
  it('steps animations by the time between frames, clamped to 64 ms', () => {
    const c = chart();
    settle();
    const steps: number[] = [];
    const step = vi.spyOn(inside(c).time, 'step').mockImplementation((dt) => (steps.push(dt), steps.length < 4));
    c.invalidate();
    runFrame(10_000);
    runFrame(10_010);
    // A stalled tab: the next frame comes a second later.
    runFrame(11_010);
    // An out-of-order timestamp counts as no time at all.
    runFrame(11_000);
    // First frame after idle: a nominal 16 ms; then 10 ms, the 64 ms cap and 0.
    expect(steps).toEqual([16, 10, 64, 0]);
    expect(pendingFrames()).toBe(0);
    step.mockRestore();
  });

  it('stops requesting frames once nothing moves, and restarts from a nominal frame', () => {
    const c = chart();
    c.addCandles().setData(bars(200));
    settle();
    expect(pendingFrames()).toBe(0);

    const steps: number[] = [];
    const real = inside(c).time.step.bind(inside(c).time);
    vi.spyOn(inside(c).time, 'step').mockImplementation((dt) => (steps.push(dt), real(dt)));
    inside(c).time.animateTo({ barSpacing: 20 }, 100);
    c.invalidate();
    let now = settle(50_000);
    expect(pendingFrames()).toBe(0);
    expect(c.barSpacing).toBeCloseTo(20);
    // 100 ms of easing at 16 ms per frame, then the loop ends.
    expect(steps[0]).toBe(16);
    expect(steps.length).toBeLessThan(12);

    // Long after: the gap is not counted as frame time.
    steps.length = 0;
    inside(c).time.animateTo({ barSpacing: 10 }, 100);
    c.invalidate();
    runFrame((now += 60_000));
    expect(steps).toEqual([16]);
  });

  it('draws nothing more after destroy', () => {
    const c = chart();
    c.invalidate();
    expect(pendingFrames()).toBe(1);
    c.destroy();
    expect(pendingFrames()).toBe(0);
  });
});

describe('resize', () => {
  it('sizes the 2D canvases by the pixel ratio and the GL canvas by maxGlDpr', () => {
    changeDevicePixelRatio(3);
    const c = chart({ maxGlDpr: 2 });
    // The fake container is 800 × 600 css px.
    expect(inside(c).bottom).toMatchObject({ width: 2400, height: 1800 });
    expect(inside(c).top).toMatchObject({ width: 2400, height: 1800 });
    expect(inside(c).glCanvas).toMatchObject({ width: 1600, height: 1200 });
  });

  it('draws at once instead of on the next frame, and skips sizes that did not change', () => {
    const c = chart();
    settle();
    const begin = vi.spyOn(inside(c).renderer, 'beginFrame');
    c.resize();
    expect(begin).not.toHaveBeenCalled();
    inside(c).root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }) as never;
    c.resize();
    expect(begin).toHaveBeenCalledOnce();
    expect(inside(c).bottom).toMatchObject({ width: 400, height: 300 });
    expect(inside(c).glCanvas).toMatchObject({ width: 400, height: 300 });
  });
});

describe('GPU uploads', () => {
  it('uploads only the changed bar after a tick, and everything after the buffer grows', () => {
    const gl = recordingWebgl2();
    const c = chart({ timezone: 'UTC' }, gl.context);
    const main = c.addCandles();
    main.setData(bars(100));
    settle();
    expect(gl.uploads.filter((u) => u.kind === 'data').length).toBeGreaterThan(0);

    // A live tick on the last bar.
    gl.uploads.length = 0;
    main.update(bar(99, 11));
    settle();
    // A candle is three rects (body and two wicks); the tick eases over a few frames, each re-uploading only it.
    const perBar = 3 * RECT_STRIDE;
    expect(gl.uploads.length).toBeGreaterThan(0);
    for (const upload of gl.uploads) expect(upload).toEqual({ kind: 'sub', offset: 99 * perBar, bytes: perBar });

    // Far more bars than the buffer holds: the grown buffer is uploaded whole.
    gl.uploads.length = 0;
    main.setData(bars(5000));
    settle();
    const whole = gl.uploads.filter((u) => u.kind === 'data');
    expect(whole.some((u) => u.bytes >= 5000 * 3 * RECT_STRIDE)).toBe(true);
  });

  it('sets the viewport to the GL canvas and a scissor per pane each frame', () => {
    const gl = recordingWebgl2();
    const c = chart({}, gl.context);
    c.addCandles().setData(bars(50));
    c.addPane();
    gl.viewports.length = 0;
    gl.scissors.length = 0;
    c.invalidate();
    runFrame(1000);
    expect(gl.viewports[0]).toEqual([0, 0, 800, 600]);
    // Each pane's plot area, inside the canvas.
    expect(gl.scissors.length).toBeGreaterThanOrEqual(2);
    for (const [x, y, w, h] of gl.scissors) {
      expect(x! + w!).toBeLessThanOrEqual(800);
      expect(y! + h!).toBeLessThanOrEqual(600);
    }
  });
});
