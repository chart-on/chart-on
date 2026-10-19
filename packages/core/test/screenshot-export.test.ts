import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import { fakeWebgl2 } from '../src/testing/environment';
import { darkTheme, lightTheme, type ChartTheme } from '../src/theme';
import { zoneOf } from '../src/util/timezone';
import type { Bar } from '../src/types';

/**
 * Screenshot theme and caption options against a real chart in the fake DOM.
 * The layers' 2D contexts and the GL context record what they are asked to
 * draw, so two captures can be compared call by call.
 */

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const bars: Bar[] = Array.from({ length: 40 }, (_, i) => ({
  time: 1_700_000_000 + i * 3600,
  open: 100 + (i % 5),
  high: 110 + (i % 7),
  low: 90 - (i % 3),
  close: 100 + ((i * 3) % 11),
  volume: 1000 + i,
}));

/** A 2D context that logs style assignments and drawing calls as text. */
function recordingContext(log: string[], name: string): unknown {
  const state: Record<string, unknown> = {};
  return new Proxy(state, {
    get: (_t, key) => {
      if (key === 'measureText') return (state.measureText as unknown) ?? ((text: string) => ({ width: text.length * 6 }));
      if (typeof key === 'string' && key in state) return state[key];
      return (...args: unknown[]) => {
        log.push(`${name} ${String(key)}(${args.map((a) => (typeof a === 'object' ? typeof a : String(a))).join(',')})`);
        return { addColorStop() {} };
      };
    },
    set: (_t, key, value) => {
      state[key as string] = value;
      if (typeof value !== 'object') log.push(`${name} ${String(key)}=${String(value)}`);
      return true;
    },
  });
}

/** A fake WebGL2 context that logs buffer contents and uniform values. */
function recordingGl(log: string[]): unknown {
  const base = fakeWebgl2() as Record<string, unknown>;
  return new Proxy(base, {
    get: (target, key) => {
      if (key === 'bufferData' || key === 'bufferSubData') {
        return (_t: number, a: unknown, b: unknown) => {
          const data = ArrayBuffer.isView(a) ? a : ArrayBuffer.isView(b) ? b : null;
          if (data) log.push(`gl ${key} ${Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).join(',')}`);
        };
      }
      if (typeof key === 'string' && key.startsWith('uniform')) {
        return (_loc: unknown, ...values: unknown[]) => log.push(`gl ${key} ${values.map((v) => (ArrayBuffer.isView(v) ? Array.from(v as Float32Array).join(' ') : String(v))).join(',')}`);
      }
      return target[key as string];
    },
  });
}

interface Layers {
  bottom: { getContext(): unknown };
  top: { getContext(): unknown };
  cursorLayer: { getContext(): unknown } | null;
  dpr: number;
}

/** A chart with recording contexts on its layers and the GPU; `log` collects what they draw. */
function recorded(options: ChartOptionsPatch = {}) {
  const log: string[] = [];
  const c = new Chart(fakeContainer({ webgl: recordingGl(log) }), { timezone: 'UTC', ...options });
  charts.push(c);
  c.addCandles({ animate: false, title: 'DEMO' }).setData(bars);
  const layers = c as unknown as Layers;
  for (const [name, layer] of [['bottom', layers.bottom], ['top', layers.top], ['cursor', layers.cursorLayer]] as const) {
    if (!layer) continue;
    const ctx = recordingContext(log, name);
    layer.getContext = () => ctx;
  }
  return { c, log, layers };
}

/** Image canvases the chart creates for a capture, each with a recording context; `toBlob` encodes at once. */
function imageCanvases(log: string[]) {
  const made: { width: number; height: number }[] = [];
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = create(tag) as unknown as { width: number; height: number; getContext(): unknown; toBlob(done: (b: Blob | null) => void): void };
    if (tag === 'canvas') {
      const ctx = recordingContext(log, 'image');
      el.getContext = () => ctx;
      el.toBlob = (done) => done(new Blob(['png']));
      made.push(el);
    }
    return el as unknown as HTMLElement;
  });
  return made;
}

describe('screenshot theme', () => {
  it('captures a dark chart in light exactly as a light chart captures', async () => {
    const dark = recorded();
    const light = recorded({ theme: lightTheme });
    imageCanvases([]);
    dark.log.length = 0;
    light.log.length = 0;
    await dark.c.captureImage({ theme: 'light', legend: false });
    await light.c.captureImage({ legend: false });
    const lightCalls = light.log.slice();
    // Layer drawing and GPU uploads match call for call; the dark chart then redraws its screen.
    expect(dark.log.slice(0, lightCalls.length)).toEqual(lightCalls);
    // The light theme reached the background, the axes and the candle colors.
    expect(lightCalls).toContain(`bottom fillStyle=${lightTheme.background}`);
    expect(lightCalls.join('\n')).not.toContain(`fillStyle=${darkTheme.background}`);
  });

  it('accepts a whole theme object', async () => {
    const custom: ChartTheme = { ...lightTheme, background: '#fafaf0', up: '#118811' };
    const dark = recorded();
    imageCanvases([]);
    dark.log.length = 0;
    await dark.c.captureImage({ theme: custom, legend: false });
    expect(dark.log).toContain('bottom fillStyle=#fafaf0');
  });

  it('keeps the live theme, pixel ratio and screen after the export, without a theme event', async () => {
    const { c, log, layers } = recorded();
    imageCanvases([]);
    const before = c.appearance();
    const dpr = layers.dpr;
    const events: unknown[] = [];
    c.on('theme:change', (e) => events.push(e));
    c.on('appearance:change', (e) => events.push(e));
    log.length = 0;
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
    const drawn = (lines: string[]) => lines.filter((l) => !l.startsWith('gl buffer'));
    const screen = drawn(log.splice(0));
    await c.captureImage({ theme: 'light', scale: 3, caption: true });
    expect(c.appearance()).toEqual(before);
    expect(layers.dpr).toBe(dpr);
    expect(events).toEqual([]);
    // The last redraw before the browser paints is the screen again, in the dark theme.
    const after = drawn(log);
    expect(after.slice(after.length - screen.length)).toEqual(screen);
  });

  it('uploads the live colors to the GPU again after the export', async () => {
    const exported = recorded();
    // A chart switched to light and back through applyOptions rebuilds the same way.
    const switched = recorded();
    imageCanvases([]);
    exported.log.length = 0;
    await exported.c.captureImage({ theme: 'light' });
    switched.c.applyOptions({ theme: lightTheme });
    switched.log.length = 0;
    switched.c.applyOptions({ theme: darkTheme });
    (switched.c as unknown as { render(t: number): void }).render(0);
    // Whether the bytes go up as new or in place does not matter, only what they hold.
    const gpu = (lines: string[]) => lines.filter((l) => l.startsWith('gl buffer')).map((l) => l.slice(l.indexOf(' ', 3) + 1));
    const expected = gpu(switched.log);
    expect(expected.length).toBeGreaterThan(0);
    expect(gpu(exported.log).slice(-expected.length)).toEqual(expected);
  });

  it('puts the live theme back when drawing the image fails', () => {
    const { c } = recorded();
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = create(tag) as unknown as { getContext(): unknown };
      if (tag === 'canvas') {
        el.getContext = () => ({
          drawImage: () => {
            throw new Error('draw failed');
          },
          fillRect() {},
          setTransform() {},
        });
      }
      return el as unknown as HTMLElement;
    });
    const before = c.appearance().theme;
    expect(() => c.captureImage({ theme: 'light' })).toThrow('draw failed');
    expect(c.appearance().theme).toEqual(before);
    expect(c.appearance().theme.background).toBe(darkTheme.background);
  });

  it('keeps the chart fonts with a named theme', async () => {
    const { c, log } = recorded({ theme: { fontFamily: 'serif-test' } });
    imageCanvases([]);
    log.length = 0;
    await c.captureImage({ theme: 'light', legend: false });
    expect(log.some((l) => l.includes('font=') && l.includes('serif-test'))).toBe(true);
  });

  it('gives the screen its axis widths back after a theme with larger fonts', async () => {
    const { c, layers } = recorded({ priceAxisWidth: 'auto' });
    // Text measures wider in a larger font, as on a real canvas.
    const top = layers.top.getContext() as { font?: string; measureText(text: string): { width: number } };
    top.measureText = (text: string) => ({ width: text.length * Number(/(\d+)px/.exec(top.font ?? '')?.[1] ?? 10) * 0.6 });
    const state = c as unknown as { axisWidths: { left: number; right: number }; render(t: number): void };
    c.invalidate();
    state.render(0);
    const before = { ...state.axisWidths };
    const range = c.getVisibleRange();
    imageCanvases([]);
    // A little larger: a wider axis would not shrink back by itself (it shrinks only by more than a font size).
    await c.captureImage({ theme: { ...lightTheme, fontSize: 14 }, legend: false });
    expect(state.axisWidths).toEqual(before);
    expect(c.getVisibleRange()).toEqual(range);
  });
});

describe('screenshot caption', () => {
  const now = Date.UTC(2024, 0, 15, 12, 0, 0);

  function captionOf(log: string[]): string {
    const call = log.find((l) => l.startsWith('image fillText('));
    if (!call) throw new Error('no caption drawn');
    return call.slice('image fillText('.length, call.lastIndexOf(',', call.lastIndexOf(',', call.lastIndexOf(',') - 1) - 1));
  }

  it('adds a header with the symbol, the newest values and the export time in the chart timezone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const { c } = recorded({ timezone: 'Asia/Tokyo' });
    const image: string[] = [];
    const canvases = imageCanvases(image);
    await c.captureImage({ caption: true, legend: false });
    const text = captionOf(image);
    const tokyo = c.localization.dateTime(zoneOf('Asia/Tokyo').date(now / 1000), false);
    const utc = c.localization.dateTime(zoneOf('UTC').date(now / 1000), false);
    expect(tokyo).not.toBe(utc);
    expect(text.startsWith('DEMO · O ')).toBe(true);
    expect(text).toContain(`C ${c.main!.format(bars[bars.length - 1]!.close)}`);
    expect(text.endsWith(`${tokyo} Asia/Tokyo`)).toBe(true);
    // The header sits above the chart, so the image is taller than the chart.
    expect(canvases[0]!.height).toBeGreaterThan(600 * window.devicePixelRatio);
    expect(canvases[0]!.width).toBe(800 * window.devicePixelRatio);
  });

  it('names a UTC chart UTC, takes custom text and leaves the header out when false', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    // No attribution: the site's name beside the mark is text too.
    const { c } = recorded({ features: { attributionLogo: false } });
    const image: string[] = [];
    const canvases = imageCanvases(image);
    await c.captureImage({ caption: true, legend: false });
    expect(captionOf(image).endsWith(' UTC')).toBe(true);
    image.length = 0;
    await c.captureImage({ caption: 'Quarterly report', legend: false });
    expect(captionOf(image)).toBe('Quarterly report');
    image.length = 0;
    await c.captureImage({ caption: false, legend: false });
    expect(image.some((l) => l.startsWith('image fillText('))).toBe(false);
    expect(canvases[2]!.height).toBe(600 * window.devicePixelRatio);
  });

  it('names the project site beside the mark where the badge sits, unless the flag or the watermark option leaves it out', async () => {
    const { c } = recorded();
    const image: string[] = [];
    imageCanvases(image);
    await c.captureImage({ legend: false });
    const text = image.filter((l) => l.startsWith('image fillText('));
    // Mark (14 px) and a 5 px gap after the badge's 8 px margin and 4 px padding; centred 19 px above the time axis.
    expect(text).toEqual([`image fillText(charton.dev,${c.plotLeft + 31},${c.plotHeight - 19})`]);
    expect(image).toContain('image globalAlpha=0.6');
    expect(image).toContain(`image fillStyle=${c.theme.textMuted}`);
    image.length = 0;
    await c.captureImage({ legend: false, watermark: false });
    expect(image.some((l) => l.includes('charton.dev'))).toBe(false);
    c.applyOptions({ features: { attributionLogo: false } });
    await c.captureImage({ legend: false });
    expect(image.some((l) => l.includes('charton.dev'))).toBe(false);
  });

  it('draws the caption in the capture theme over the image background', async () => {
    const { c } = recorded();
    const image: string[] = [];
    imageCanvases(image);
    await c.captureImage({ caption: 'x', theme: 'light', legend: false });
    expect(image).toContain(`image fillStyle=${lightTheme.background}`);
    expect(image).toContain(`image fillStyle=${lightTheme.text}`);
  });
});
