import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentListeners, fakeContainer, fakeIntersection, pendingFrames, recordingWebgl2, setPageHidden, type FakeIntersection } from './fake-dom';
import { Chart, type ChartOptions } from '../src/chart';
import { RECT_STRIDE } from '../src/gl/rect-batch';
import { driveFrames, flushFrames } from '../src/testing/kit';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
let io: FakeIntersection;

beforeEach(() => {
  io = fakeIntersection();
});
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  io.uninstall();
  setPageHidden(false);
  vi.restoreAllMocks();
});

const bar = (i: number, close = 10): Bar => ({ time: i * 60, open: 10, high: Math.max(12, close), low: 8, close });
const bars = (n: number) => Array.from({ length: n }, (_, i) => bar(i));

interface Internals {
  root: unknown;
  renderer: { beginFrame(dpr: number): void };
  time: { animateTo(target: { barSpacing?: number }, ms: number): void };
}
const inside = (c: Chart) => c as unknown as Internals;

/** A chart with 200 candles, drawn and settled, on a context that counts draw calls and uploads. */
function setup(options: Partial<ChartOptions> = {}) {
  const gl = recordingWebgl2();
  let draws = 0;
  const context = new Proxy(gl.context as Record<string, unknown>, {
    get: (target, key) => (typeof key === 'string' && key.startsWith('draw') ? () => void draws++ : target[key as string]),
  });
  const c = new Chart(fakeContainer({ webgl: context }), { timezone: 'UTC', ...options });
  charts.push(c);
  const main = c.addCandles();
  main.setData(bars(200));
  flushFrames();
  return { c, main, gl, draws: () => draws };
}

const inView = (c: Chart, visible: boolean) => io.setInView(inside(c).root, visible);
/** Let the microtask a paused chart settles in run. */
const tick = () => Promise.resolve();

describe('skipping hidden charts', () => {
  it('requests no frames and draws nothing for 1,000 updates while out of view', async () => {
    const { c, main, draws } = setup();
    expect(draws()).toBeGreaterThan(0);
    inView(c, false);
    const before = draws();
    for (let i = 0; i < 1000; i++) main.update(bar(200 + Math.floor(i / 10), 10 + (i % 10)));
    expect(pendingFrames()).toBe(0);
    await tick();
    expect(pendingFrames()).toBe(0);
    expect(draws()).toBe(before);
    // The data kept up.
    expect(main.data.length).toBe(300);
  });

  it('draws exactly one frame with the latest bar when it comes back into view', async () => {
    const { c, main, gl } = setup({ renderStats: true });
    inView(c, false);
    for (let i = 0; i < 50; i++) main.update(bar(200 + i, 20 + i));
    await tick();
    const frames: string[] = [];
    c.on('frame:render', (stats) => frames.push(stats.kind));
    const begin = vi.spyOn(inside(c).renderer, 'beginFrame');
    gl.uploads.length = 0;

    inView(c, true);
    // Drawn now, before the browser paints, with nothing left to animate.
    expect(begin).toHaveBeenCalledOnce();
    expect(frames).toEqual(['scene']);
    expect(pendingFrames()).toBe(0);
    // The newest bar went to the GPU, and the price scale fits it.
    const perBar = 3 * RECT_STRIDE;
    expect(gl.uploads.some((u) => u.offset + u.bytes >= 250 * perBar)).toBe(true);
    expect(c.getPriceRange(0)!.to).toBeGreaterThanOrEqual(69);
    expect(c.valuesAt()?.series[0]?.values).toMatchObject({ close: 69 });
  });

  it('draws nothing when it comes back into view unchanged', () => {
    const { c, draws } = setup();
    inView(c, false);
    const before = draws();
    inView(c, true);
    expect(draws()).toBe(before);
    expect(pendingFrames()).toBe(0);
  });

  it('pauses while the page is hidden, and draws once when it is shown', async () => {
    const { c, main, draws } = setup();
    setPageHidden(true);
    const before = draws();
    main.update(bar(200, 30));
    await tick();
    expect(pendingFrames()).toBe(0);
    expect(draws()).toBe(before);
    // Back into view on the hidden page: still paused.
    inView(c, true);
    expect(draws()).toBe(before);
    setPageHidden(false);
    expect(draws()).toBeGreaterThan(before);
    expect(pendingFrames()).toBe(0);
  });

  it('keeps view events firing while hidden', async () => {
    const { c, main } = setup();
    flushFrames();
    inView(c, false);
    const ranges: number[] = [];
    c.on('view:change', ({ to }) => ranges.push(to as number));
    // The newest bar is on screen, so the view follows appended bars.
    for (let i = 0; i < 5; i++) main.update(bar(200 + i));
    await tick();
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges[ranges.length - 1]).toBeGreaterThanOrEqual(204 * 60);
    expect(pendingFrames()).toBe(0);
  });

  it('finishes animations instead of replaying them when shown', () => {
    const { c } = setup({ smoothScale: true });
    inside(c).time.animateTo({ barSpacing: 20 }, 500);
    c.invalidate();
    // One frame into the animation, then the chart scrolls away.
    driveFrames();
    expect(c.barSpacing).toBeLessThan(19);
    inView(c, false);
    expect(pendingFrames()).toBe(0);
    // Shown again: the animation's end, at once, with no frames left to run.
    inView(c, true);
    expect(c.barSpacing).toBeCloseTo(20);
    expect(pendingFrames()).toBe(0);
  });

  it('screenshots a hidden chart with its latest data', async () => {
    const { c, main, draws } = setup();
    inView(c, false);
    main.update(bar(200, 55));
    const doc = document as unknown as { createElement(tag: string): Record<string, unknown> };
    const create = doc.createElement;
    vi.spyOn(doc, 'createElement').mockImplementation((tag: string) => {
      const el = create(tag);
      if (tag === 'canvas') el.toBlob = (done: (b: unknown) => void) => done({ size: 1 });
      return el;
    });
    const before = draws();
    const blob = await c.captureImage();
    expect(blob).not.toBeNull();
    expect(draws()).toBeGreaterThan(before);
    expect(c.valuesAt()?.series[0]?.values).toMatchObject({ close: 55 });
    expect(c.getPriceRange(0)!.to).toBeGreaterThanOrEqual(55);
    // Still paused afterwards.
    main.update(bar(200, 56));
    expect(pendingFrames()).toBe(0);
  });

  it('still draws a synchronous resize while hidden', () => {
    const { c } = setup();
    inView(c, false);
    const begin = vi.spyOn(inside(c).renderer, 'beginFrame');
    const root = inside(c).root as { getBoundingClientRect(): unknown };
    root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 });
    c.resize();
    expect(begin).toHaveBeenCalledOnce();
  });

  it('keeps drawing while hidden with renderWhenHidden', () => {
    const { c, main } = setup({ renderWhenHidden: true });
    inView(c, false);
    main.update(bar(200, 30));
    expect(pendingFrames()).toBe(1);
    // Switching it off pauses at once; switching it back on draws the missed frame.
    flushFrames();
    c.applyOptions({ renderWhenHidden: false });
    flushFrames();
    main.update(bar(200, 31));
    expect(pendingFrames()).toBe(0);
    const begin = vi.spyOn(inside(c).renderer, 'beginFrame');
    c.applyOptions({ renderWhenHidden: true });
    expect(begin).toHaveBeenCalled();
  });

  it('cancels a frame already requested when the chart is hidden', () => {
    const { c, main } = setup();
    main.update(bar(200, 30));
    expect(pendingFrames()).toBe(1);
    inView(c, false);
    expect(pendingFrames()).toBe(0);
  });

  it('draws as before where IntersectionObserver is missing', () => {
    io.uninstall();
    const { main } = setup();
    main.update(bar(200, 30));
    expect(pendingFrames()).toBe(1);
  });

  it('disconnects the observer and removes the visibilitychange listener on destroy', () => {
    const { c } = setup();
    expect(io.observed()).toBe(1);
    expect(documentListeners('visibilitychange')).toBe(1);
    c.destroy();
    expect(io.observed()).toBe(0);
    expect(documentListeners('visibilitychange')).toBe(0);
  });
});
