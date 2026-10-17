import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeDevicePixelRatio, fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch, type ScreenshotOptions } from '../src/chart';
import { darkTheme, lightTheme } from '../src/theme';

/**
 * Screenshot options against a real chart in the fake DOM: the image canvas
 * and the chart's own layers record what is drawn into them.
 */
const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
  changeDevicePixelRatio(1, 'never matches');
});

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  return c;
}

interface Sized {
  width: number;
  height: number;
}

interface Internals {
  bottom: Sized & { getContext(): unknown };
  top: Sized & { getContext(): unknown };
  glCanvas: Sized;
  cursorLayer: Sized | null;
  capture: unknown;
  sceneDirty: boolean;
  render(dt: number): boolean;
  composite(options: ScreenshotOptions): (Sized & { log: string[] }) | null;
}

const internals = (c: Chart) => c as unknown as Internals;
/** Backing-store sizes of the bottom, overlay, GPU and crosshair layers. */
const sizes = (c: Chart) =>
  [internals(c).bottom, internals(c).top, internals(c).glCanvas, internals(c).cursorLayer!].map((x) => [x.width, x.height]);

/** A 2D context that logs fills, clears, image draws and transforms; everything else is a no-op. */
function recordingContext(log: string[], name: string) {
  const state: Record<string, unknown> = {};
  return new Proxy(state, {
    get: (_t, key) => {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (key === 'fillRect') return () => log.push(`${name} fillRect ${String(state.fillStyle)}`);
      if (key === 'clearRect') return () => log.push(`${name} clearRect`);
      if (key === 'drawImage') return (...args: unknown[]) => log.push(`${name} drawImage ${args.slice(1).join(' ')}`);
      if (key === 'setTransform') return (...args: unknown[]) => log.push(`${name} setTransform ${args.join(' ')}`);
      if (typeof key === 'string' && key in state) return state[key];
      return () => ({ addColorStop() {} });
    },
    set: (_t, key, value) => {
      state[key as string] = value;
      return true;
    },
  });
}

/** Take a composite with the image canvas and both 2D layers recording into one log. */
function capture(c: Chart, options: ScreenshotOptions = {}) {
  const log: string[] = [];
  const bottom = recordingContext(log, 'bottom');
  const top = recordingContext(log, 'top');
  internals(c).bottom.getContext = () => bottom;
  internals(c).top.getContext = () => top;
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementationOnce((tag: string) => {
    const el = create(tag) as unknown as { getContext(): unknown };
    el.getContext = () => recordingContext(log, 'image');
    return el as unknown as HTMLElement;
  });
  const out = internals(c).composite(options)!;
  return { out, log };
}

describe('screenshot scale', () => {
  it('doubles the image at scale 2, redraws the layers at that ratio, then restores the screen', () => {
    const c = chart({ maxGlDpr: 1.5 });
    expect(sizes(c)).toEqual([
      [800, 600],
      [800, 600],
      [800, 600],
      [800, 600],
    ]);
    const seen: { dpr: number; sizes: number[][] }[] = [];
    const render = internals(c).render.bind(c);
    vi.spyOn(internals(c), 'render').mockImplementation((dt) => {
      seen.push({ dpr: c.dpr, sizes: sizes(c) });
      return render(dt);
    });
    const { out } = capture(c, { scale: 2 });
    expect([out.width, out.height]).toEqual([1600, 1200]);
    // The capture draws every layer, the GPU one too, at the requested ratio.
    expect(seen[0]).toEqual({
      dpr: 2,
      sizes: [
        [1600, 1200],
        [1600, 1200],
        [1600, 1200],
        [1600, 1200],
      ],
    });
    // The screen is redrawn at its own ratio and GPU cap in the same task.
    expect(seen.at(-1)).toEqual({
      dpr: 1,
      sizes: [
        [800, 600],
        [800, 600],
        [800, 600],
        [800, 600],
      ],
    });
    expect(c.dpr).toBe(1);
    expect(internals(c).capture).toBeNull();
  });

  it('keeps the pixel grouping of the screen while redrawing larger', () => {
    const c = chart({ animateViewChanges: false, grouping: { mode: 'pixel' } });
    c.addCandles().setData(Array.from({ length: 100_000 }, (_, i) => ({ time: i * 60, open: 10, high: 11, low: 9, close: 10 })));
    c.fitContent(false);
    internals(c).sceneDirty = true;
    internals(c).render(0);
    const level = c.groupLevel;
    expect(level).toBeGreaterThan(0);
    const levels: number[] = [];
    const render = internals(c).render.bind(c);
    vi.spyOn(internals(c), 'render').mockImplementation((dt) => {
      levels.push(c.groupLevel);
      return render(dt);
    });
    const changes: unknown[] = [];
    c.on('grouping:change', (g) => changes.push(g));
    capture(c, { scale: 2 });
    expect(levels.length).toBeGreaterThan(0);
    expect(levels.every((l) => l === level)).toBe(true);
    expect(changes).toEqual([]);
  });

  it('restores a high-density screen with its GPU pixel ratio cap', () => {
    changeDevicePixelRatio(2);
    const c = chart({ maxGlDpr: 1.5 });
    const { out } = capture(c, { scale: 3 });
    expect([out.width, out.height]).toEqual([2400, 1800]);
    expect(c.dpr).toBe(2);
    expect(sizes(c)).toEqual([
      [1600, 1200],
      [1600, 1200],
      [1200, 900],
      [1600, 1200],
    ]);
  });

  it('draws the GPU layer at the image ratio in low-power mode, then caps it again', () => {
    changeDevicePixelRatio(2);
    const c = chart({ lowPower: true });
    expect(sizes(c)[2]).toEqual([800, 600]);
    const seen: number[][][] = [];
    const render = internals(c).render.bind(c);
    vi.spyOn(internals(c), 'render').mockImplementation((dt) => {
      seen.push(sizes(c));
      return render(dt);
    });
    const { out } = capture(c);
    expect([out.width, out.height]).toEqual([1600, 1200]);
    // Same image as without low power: every layer at the screen's ratio of 2.
    expect(seen[0]).toEqual(Array(4).fill([1600, 1200]));
    expect(c.dpr).toBe(2);
    expect(sizes(c)).toEqual([
      [1600, 1200],
      [1600, 1200],
      [800, 600],
      [1600, 1200],
    ]);
    // A lower maxGlDpr still applies to the image, as it does without low power.
    c.applyOptions({ maxGlDpr: 1.5 });
    seen.length = 0;
    capture(c);
    expect(seen[0]![2]).toEqual([1200, 900]);
  });

  it('defaults to the device pixel ratio and scales down without resizing the layers', () => {
    changeDevicePixelRatio(2);
    const c = chart();
    expect([capture(c).out.width, capture(c).out.height]).toEqual([1600, 1200]);
    const seen: number[] = [];
    const render = internals(c).render.bind(c);
    vi.spyOn(internals(c), 'render').mockImplementation((dt) => {
      seen.push(c.dpr);
      return render(dt);
    });
    const { out, log } = capture(c, { scale: 1 });
    expect([out.width, out.height]).toEqual([800, 600]);
    expect(seen.every((dpr) => dpr === 2)).toBe(true);
    expect(log.filter((l) => l.startsWith('image drawImage'))).toEqual(Array(4).fill('image drawImage 0 0 800 600'));
  });

  it('keeps the longest side within 8192 pixels and ignores a scale that is not a positive number', () => {
    const c = chart();
    const big = capture(c, { scale: 100 }).out;
    expect(Math.max(big.width, big.height)).toBe(8192);
    expect([big.width, big.height]).toEqual([8192, 6144]);
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { out } = capture(c, { scale });
      expect([out.width, out.height]).toEqual([800, 600]);
    }
  });
});

describe('screenshot background and padding', () => {
  it('matches the screen in dark and light themes: the layers carry the theme background', () => {
    for (const theme of [darkTheme, lightTheme]) {
      const c = chart({ theme });
      const { log } = capture(c);
      expect(log.filter((l) => l.startsWith('image fillRect'))).toEqual([]);
      expect(log.find((l) => l.startsWith('bottom fillRect'))).toBe(`bottom fillRect ${theme.background}`);
    }
  });

  it('paints another background once on the image, under transparent layers, then restores the screen', () => {
    const c = chart({ theme: darkTheme });
    const { log } = capture(c, { background: '#ffffff' });
    const imageFill = log.indexOf('image fillRect #ffffff');
    const firstLayer = log.findIndex((l) => l.startsWith('image drawImage'));
    expect(imageFill).toBeGreaterThanOrEqual(0);
    expect(imageFill).toBeLessThan(firstLayer);
    // Nothing paints the theme background into the image's layers; the screen gets it back afterwards.
    const beforeCopy = log.slice(0, firstLayer);
    expect(beforeCopy.filter((l) => l.endsWith(darkTheme.background))).toEqual([]);
    expect(log.slice(firstLayer)).toContain(`bottom fillRect ${darkTheme.background}`);
  });

  it('leaves the background out for transparent and falls back to the theme for an unreadable color', () => {
    const c = chart({ theme: lightTheme });
    const clear = capture(c, { background: 'transparent' }).log;
    const firstLayer = clear.findIndex((l) => l.startsWith('image drawImage'));
    expect(clear.slice(0, firstLayer).filter((l) => l.includes('fillRect') && l.endsWith(lightTheme.background))).toEqual([]);
    expect(clear.filter((l) => l.startsWith('image fillRect'))).toEqual([]);
    expect(capture(c, { background: 'not a color' }).log).toContain(`image fillRect ${lightTheme.background}`);
  });

  it('adds padding around the chart, filled with the background, at the image scale', () => {
    const c = chart({ theme: darkTheme });
    const { out, log } = capture(c, { padding: 10, scale: 2, legend: true });
    expect([out.width, out.height]).toEqual([1640, 1240]);
    expect(log).toContain(`image fillRect ${darkTheme.background}`);
    expect(log.filter((l) => l.startsWith('image drawImage'))).toEqual(Array(4).fill('image drawImage 20 20 1600 1200'));
    expect(log).toContain('image setTransform 2 0 0 2 20 20');
  });

  it('ignores negative or non-finite padding', () => {
    const c = chart();
    for (const padding of [-5, Number.NaN]) {
      const { out } = capture(c, { padding });
      expect([out.width, out.height]).toEqual([800, 600]);
    }
  });
});

describe('screenshot composition', () => {
  it('leaves the watermark out on request and puts it back on screen', () => {
    const c = chart({ features: { watermark: true } });
    c.watermark.applyOptions({ lines: ['DEMO'] });
    const drawn: boolean[] = [];
    vi.spyOn(c.watermark, 'drawPlot').mockImplementation(() => drawn.push(internals(c).capture !== null));
    capture(c, { watermark: false });
    expect(drawn).toEqual([false]);
    drawn.length = 0;
    capture(c);
    expect(drawn).toContain(true);
  });

  it('leaves drawings and annotations out on request', () => {
    const c = chart();
    const state = c as unknown as {
      drawings: { render(...args: unknown[]): void };
      annotations: { render(...args: unknown[]): void; renderLabels(...args: unknown[]): void };
    };
    const drawn: string[] = [];
    const during = () => (internals(c).capture !== null ? 'image' : 'screen');
    vi.spyOn(state.drawings, 'render').mockImplementation(() => drawn.push(`drawings ${during()}`));
    vi.spyOn(state.annotations, 'render').mockImplementation(() => drawn.push(`annotations ${during()}`));
    vi.spyOn(state.annotations, 'renderLabels').mockImplementation(() => drawn.push(`labels ${during()}`));
    capture(c, { drawings: false, annotations: false });
    expect(drawn.filter((d) => d.endsWith('image'))).toEqual([]);
    expect(drawn).toContain('drawings screen');
    expect(drawn).toContain('annotations screen');
    expect(drawn).toContain('labels screen');
    drawn.length = 0;
    capture(c, { crosshair: true });
    expect(drawn).toEqual(['drawings image', 'annotations image', 'labels image']);
  });
});
