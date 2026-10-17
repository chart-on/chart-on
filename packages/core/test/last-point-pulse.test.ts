import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer, installFakeDom, pendingFrames, runFrame } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import { lastPointPulse } from '../src/builtins';
import { PulseClock, resolvePulse } from '../src/pulse';
import type { Bar, ValuePoint } from '../src/types';

const charts: Chart[] = [];
let motion = false;
installFakeDom();
const original = globalThis.matchMedia;
afterEach(() => {
  vi.restoreAllMocks();
  charts.splice(0).forEach((c) => c.destroy());
  globalThis.matchMedia = original;
  motion = false;
});

/** Turn reduced motion off (the fake environment reports it on). */
function allowMotion(): void {
  motion = true;
  const base = globalThis.matchMedia;
  globalThis.matchMedia = (query: string) => {
    const mq = base(query);
    return query.includes('reduced-motion') ? Object.assign(Object.create(mq) as MediaQueryList, { matches: !motion }) : mq;
  };
}

/** A chart whose view and scales never ease, so every frame counted below is the pulse's. */
function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), { smoothScale: false, animateViewChanges: false, ...options });
  charts.push(c);
  return c;
}

/** A chart with `n` main bars and a line over them. */
function lineChart(line: Parameters<Chart['addLine']>[0], n = 50, options: ChartOptionsPatch = {}) {
  const c = chart(options);
  const main = c.addCandles({ animate: false });
  main.setData(bars(n));
  const series = c.addLine(line);
  series.setData(points(n));
  return { c, main, line: series };
}

const points = (n: number): ValuePoint[] => Array.from({ length: n }, (_, i) => ({ time: i * 60, value: 10 + (i % 7) }));
const bars = (n: number): Bar[] => Array.from({ length: n }, (_, i) => ({ time: i * 60, open: 10, high: 12, low: 8, close: 10 + (i % 5) }));

let now = 1000;
/** Run frames 16 ms apart until none is requested or `limit` ran; returns how many ran. */
function drive(limit = 500): number {
  let n = 0;
  while (n < limit && pendingFrames() > 0) {
    runFrame((now += 16));
    n++;
  }
  return n;
}

describe('last-point pulse', () => {
  it('resolves the option forms with defaults', () => {
    expect(resolvePulse(undefined)).toBeNull();
    expect(resolvePulse('off')).toBeNull();
    expect(resolvePulse({ mode: 'off' })).toBeNull();
    expect(resolvePulse('on-update')).toEqual({ mode: 'on-update', color: undefined, radius: 10, durationMs: 900 });
    expect(resolvePulse({ color: '#ff0000', radius: 16, durationMs: 400 })).toEqual({
      mode: 'on-update',
      color: '#ff0000',
      radius: 16,
      durationMs: 400,
    });
    // Invalid sizes fall back to the defaults.
    expect(resolvePulse({ mode: 'continuous', radius: -1, durationMs: Number.NaN })).toMatchObject({ radius: 10, durationMs: 900 });
  });

  it('one update on a line runs a finite animation, then stops requesting frames', () => {
    allowMotion();
    const { main, line } = lineChart({ lastPointPulse: { mode: 'on-update', durationMs: 320 } });
    drive();
    expect(pendingFrames()).toBe(0);

    line.update({ time: 49 * 60, value: 12 });
    const frames = drive();
    // 320 ms at 16 ms per frame is 20 frames, plus the first draw and the clearing frame.
    expect(frames).toBeGreaterThanOrEqual(20);
    expect(frames).toBeLessThan(30);
    expect(pendingFrames()).toBe(0);

    // A new point starts another ring.
    main.update({ time: 50 * 60, open: 10, high: 12, low: 8, close: 11 });
    drive();
    line.update({ time: 50 * 60, value: 12 });
    expect(drive()).toBeGreaterThanOrEqual(20);
    expect(pendingFrames()).toBe(0);
  });

  it('draws no pulse without the lastPointPulse() plugin, warns once, and pulses once it is installed', () => {
    allowMotion();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { c, main, line } = lineChart({ lastPointPulse: { mode: 'on-update', durationMs: 320 } }, 50, { plugins: [] });
    drive();
    line.update({ time: 49 * 60, value: 12 });
    // Only the redraw the update asked for: no ring runs.
    expect(drive()).toBe(1);
    expect(warn.mock.calls.filter(([message]) => String(message).includes('pulse-missing'))).toHaveLength(1);
    // The option is kept as given.
    expect(line.options.lastPointPulse).toEqual({ mode: 'on-update', durationMs: 320 });

    const uninstall = c.install(lastPointPulse());
    drive();
    main.update({ time: 50 * 60, open: 10, high: 12, low: 8, close: 11 });
    drive();
    line.update({ time: 50 * 60, value: 12 });
    expect(drive()).toBeGreaterThanOrEqual(20);
    uninstall();
    line.update({ time: 50 * 60, value: 13 });
    expect(drive()).toBe(1);
  });

  it('stops a ring in progress when the lastPointPulse() plugin is uninstalled', () => {
    allowMotion();
    const { c, line } = lineChart({ lastPointPulse: { mode: 'on-update', durationMs: 320 } }, 50, { plugins: [lastPointPulse()] });
    drive();
    line.update({ time: 49 * 60, value: 12 });
    // A few frames into the 320 ms ring.
    for (let i = 0; i < 5; i++) runFrame((now += 16));
    expect(pendingFrames()).toBeGreaterThan(0);
    const draws = vi.spyOn(PulseClock.prototype, 'draw');
    c.uninstall('@charton/core/last-point-pulse');
    // The redraw the uninstall asked for draws no ring, and nothing more is asked for.
    expect(drive()).toBeLessThanOrEqual(1);
    expect(draws).not.toHaveBeenCalled();
    expect(pendingFrames()).toBe(0);
  });

  it('schedules no animation frames under reduced motion', () => {
    const { line } = lineChart({ lastPointPulse: 'on-update' });
    drive();
    line.update({ time: 49 * 60, value: 12 });
    // Only the redraw the update asked for.
    expect(drive()).toBe(1);
    expect(pendingFrames()).toBe(0);
  });

  it('schedules nothing extra while off or on a static chart', () => {
    allowMotion();
    const off = lineChart({}).line;
    drive();
    off.update({ time: 49 * 60, value: 12 });
    expect(drive()).toBe(1);

    const still = lineChart({ lastPointPulse: 'continuous' }, 50, { interactive: false }).line;
    drive();
    still.update({ time: 49 * 60, value: 12 });
    expect(drive()).toBe(1);
    expect(pendingFrames()).toBe(0);
  });

  it('continuous mode runs while the last point is on screen and stops when it is not', () => {
    allowMotion();
    const { c, line } = lineChart({ lastPointPulse: 'continuous' }, 200);
    // Still running after many frames.
    expect(drive(100)).toBe(100);
    expect(pendingFrames()).toBe(1);

    // Hidden series: nothing to animate.
    line.setVisible(false);
    expect(drive()).toBeLessThan(5);
    expect(pendingFrames()).toBe(0);

    line.setVisible(true);
    expect(drive(50)).toBe(50);

    // Scrolled so the newest point is off screen: the loop ends.
    c.setVisibleIndexRange(0, 50, false);
    expect(drive()).toBeLessThan(5);
    expect(pendingFrames()).toBe(0);
  });

  it('pulses the line-based candle styles only', () => {
    allowMotion();
    const c = chart();
    const main = c.addCandles({ style: 'candles', animate: false, lastPointPulse: { mode: 'on-update', durationMs: 320 } });
    main.setData(bars(50));
    drive();
    main.update({ time: 49 * 60, open: 10, high: 12, low: 8, close: 12 });
    expect(drive()).toBe(1);

    for (const style of ['line', 'area', 'step', 'baseline'] as const) {
      main.applyOptions({ style });
      drive();
      main.update({ time: 49 * 60, open: 10, high: 12, low: 8, close: 11 });
      expect(drive(), style).toBeGreaterThanOrEqual(20);
      expect(pendingFrames()).toBe(0);
    }
  });

  it('pulses the line-based candle styles when the GPU draws their lines', () => {
    allowMotion();
    const c = chart();
    const main = c.addCandles({ renderer: 'gpu', animate: false, lastPointPulse: { mode: 'on-update', durationMs: 320 } });
    main.setData(bars(50));
    for (const style of ['line', 'area', 'step', 'baseline'] as const) {
      main.applyOptions({ style });
      drive();
      main.update({ time: 49 * 60, open: 10, high: 12, low: 8, close: 11 });
      expect(drive(), style).toBeGreaterThanOrEqual(20);
      expect(pendingFrames()).toBe(0);
    }
  });
});

describe('PulseClock', () => {
  /** Records the radius and fill of each circle drawn. */
  function recorder() {
    const circles: { r: number; fill: string }[] = [];
    let r = 0;
    const ctx = {
      fillStyle: '',
      beginPath() {},
      arc(_x: number, _y: number, radius: number) {
        r = radius;
      },
      fill() {
        circles.push({ r, fill: String(ctx.fillStyle) });
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, circles };
  }

  it('grows and fades the ring, then draws nothing once it ends', () => {
    allowMotion();
    const clock = new PulseClock();
    const option = { mode: 'on-update', radius: 12, durationMs: 100 } as const;
    const { ctx, circles } = recorder();
    // Idle: nothing drawn.
    clock.draw(ctx, option, 10, 10, '#ff0000', 1);
    expect(circles).toHaveLength(0);
    expect(clock.step(option, 16, true)).toBe(false);

    clock.trigger(option);
    clock.draw(ctx, option, 10, 10, '#ff0000', 1);
    const first = circles[0]!.r;
    expect(clock.step(option, 50, true)).toBe(true);
    circles.length = 0;
    clock.draw(ctx, option, 10, 10, '#ff0000', 1);
    expect(circles[0]!.r).toBeGreaterThan(first);
    expect(circles[1]).toEqual({ r: 2.5, fill: '#ff0000' });

    // Past its duration: one more redraw to clear, then idle.
    expect(clock.step(option, 60, true)).toBe(true);
    expect(clock.running).toBe(false);
    clock.draw(ctx, option, 10, 10, '#ff0000', 1);
    expect(clock.step(option, 16, true)).toBe(false);
  });

  it('draws a still dot under reduced motion and never asks for frames', () => {
    const clock = new PulseClock();
    const { ctx, circles } = recorder();
    clock.trigger('continuous');
    clock.draw(ctx, 'continuous', 0, 0, '#00ff00', 2);
    expect(circles).toEqual([{ r: 3, fill: '#00ff00' }]);
    expect(clock.step('continuous', 16, true)).toBe(false);
  });

  it('stops when the last point was not drawn on screen', () => {
    allowMotion();
    const clock = new PulseClock();
    clock.trigger('on-update');
    // No draw since the last step: off screen or not drawn.
    expect(clock.step('on-update', 16, true)).toBe(false);
    expect(clock.running).toBe(false);
  });
});
