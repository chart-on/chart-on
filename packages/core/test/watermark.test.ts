import { describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { dataSource, watermark } from '../src/builtins';
import type { DataSource, SymbolInfo } from '../src/data/types';
import type { PrimitiveEnv, PrimitiveHost } from '../src/primitives';
import { darkTheme, lightTheme, type ChartTheme } from '../src/theme';
import type { Bar } from '../src/types';
import { ATTRIBUTION_SIZE } from '../src/attribution';
import { createWatermark, defaultWatermarkOptions, layoutWatermark, symbolWatermarkLines, type WatermarkOptions } from '../src/watermark';

/** Records fill and image calls; text is 0.5 × font size wide per character. */
function recordingContext() {
  const calls: { op: string; args: unknown[]; fillStyle: unknown; globalAlpha: number; font: string; textAlign: string }[] = [];
  const ctx = {
    font: '10px sans-serif',
    fillStyle: '#000' as unknown,
    globalAlpha: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
    measureText(text: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
      return { width: text.length * size * 0.5 };
    },
    fillText(...args: unknown[]) {
      calls.push({ op: 'fillText', args, fillStyle: ctx.fillStyle, globalAlpha: ctx.globalAlpha, font: ctx.font, textAlign: ctx.textAlign });
    },
    drawImage(...args: unknown[]) {
      calls.push({ op: 'drawImage', args, fillStyle: ctx.fillStyle, globalAlpha: ctx.globalAlpha, font: ctx.font, textAlign: ctx.textAlign });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function env(over: Partial<PrimitiveEnv> = {}): PrimitiveEnv {
  return {
    width: 800,
    height: 400,
    pixelRatio: 1,
    theme: darkTheme,
    from: 0,
    to: 10,
    barSpacing: 8,
    times: [],
    indexToX: (i) => i,
    xToIndex: (x) => x,
    timeToX: (t) => t,
    priceToY: (p) => p,
    yToPrice: (y) => y,
    formatPrice: String,
    ...over,
  };
}

const opts = (over: Partial<WatermarkOptions> = {}): WatermarkOptions => ({ ...defaultWatermarkOptions, ...over });

describe('layoutWatermark', () => {
  it('centres the lines as a block in the plot', () => {
    const { ctx } = recordingContext();
    const layout = layoutWatermark(ctx, env(), opts({ lines: [{ text: 'ABCD', size: 40 }, { text: '1h', size: 20 }] }))!;
    expect(layout.scale).toBe(1);
    expect(layout.align).toBe('center');
    // 4 chars × 20 px wide; height 1.2 × (40 + 20).
    expect(layout.width).toBe(80);
    expect(layout.height).toBeCloseTo(72);
    expect(layout.x).toBe(360);
    expect(layout.y).toBeCloseTo(164);
    expect(layout.lines.map((l) => l.x)).toEqual([400, 400]);
    expect(layout.lines[0]!.baseline).toBeLessThan(layout.lines[1]!.baseline);
    expect(layout.lines[0]!.font).toContain('40px');
  });

  it('anchors to a corner with the margin and aligns the text to that side', () => {
    const { ctx } = recordingContext();
    const tl = layoutWatermark(ctx, env(), opts({ lines: ['AB'], fontSize: 20, anchor: 'top-left', margin: 10 }))!;
    expect([tl.x, tl.y, tl.align]).toEqual([10, 10, 'left']);
    expect(tl.lines[0]!.x).toBe(10);
    const br = layoutWatermark(ctx, env(), opts({ lines: ['AB'], fontSize: 20, anchor: 'bottom-right', margin: 10 }))!;
    expect(br.align).toBe('right');
    expect(br.x + br.width).toBe(790);
    expect(br.y + br.height).toBeCloseTo(390);
    expect(br.lines[0]!.x).toBe(790);
  });

  it('shrinks the block to fit a small plot and skips text too small to read', () => {
    const { ctx } = recordingContext();
    const layout = layoutWatermark(ctx, env({ width: 200 }), opts({ lines: [{ text: 'A'.repeat(40), size: 40 }] }))!;
    // 800 px of text into 200 - 2 × 16 px.
    expect(layout.scale).toBeCloseTo(168 / 800);
    expect(layout.width).toBeCloseTo(168);
    expect(layout.lines[0]!.size).toBeCloseTo(40 * (168 / 800));
    expect(layoutWatermark(ctx, env({ width: 40, height: 30 }), opts({ lines: ['A'.repeat(40)] }))).toBeNull();
    expect(layoutWatermark(ctx, env(), opts({ lines: [] }))).toBeNull();
    expect(layoutWatermark(ctx, env(), opts({ lines: [''] }))).toBeNull();
  });

  it('snaps text and image to whole device pixels at any pixel ratio', () => {
    const { ctx } = recordingContext();
    const image = { width: 33, height: 17 } as unknown as CanvasImageSource;
    for (const pixelRatio of [1, 1.25, 1.5, 2, 3]) {
      const layout = layoutWatermark(
        ctx,
        env({ width: 641, height: 333, pixelRatio }),
        opts({ image, lines: [{ text: 'XYZ', size: 37 }] }),
      )!;
      const whole = (v: number) => expect(Math.abs(v * pixelRatio - Math.round(v * pixelRatio))).toBeLessThan(1e-9);
      for (const l of layout.lines) {
        whole(l.x);
        whole(l.baseline);
      }
      const img = layout.image!;
      for (const v of [img.x, img.y, img.width, img.height]) whole(v);
      // The image sits above the text.
      expect(img.y + img.height).toBeLessThan(layout.lines[0]!.baseline);
    }
  });

  it('drops only the lines too small to read and refits the rest', () => {
    const { ctx } = recordingContext();
    const lines = symbolWatermarkLines({ symbol: 'BTCUSD', name: 'Bitcoin' }, '1h');
    // Fitting both lines into 42.3 px of height puts the second one under 4 px.
    const layout = layoutWatermark(ctx, env({ height: 42.3 }), opts({ lines }))!;
    expect(layout.lines.map((l) => l.text)).toEqual(['BTCUSD']);
    expect(layout.lines[0]!.size).toBeGreaterThanOrEqual(4);
    // Refitted without the dropped line: the kept line fills the height.
    expect(layout.height).toBeCloseTo(42.3 - 2 * 16);
    // Nothing left to draw at all.
    expect(layoutWatermark(ctx, env({ height: 34 }), opts({ lines }))).toBeNull();
  });

  it('snaps to whole device pixels of the canvas, not of the area', () => {
    const { ctx } = recordingContext();
    const image = { width: 33, height: 17 } as unknown as CanvasImageSource;
    const pixelRatio = 1.25;
    // The plot area starts 101 css px down and 37 css px in from the canvas edge.
    const origin = { x: 37, y: 101 };
    const layout = layoutWatermark(ctx, env({ width: 641, height: 333, pixelRatio }), opts({ image, lines: [{ text: 'XYZ', size: 37 }] }), origin)!;
    const whole = (v: number) => expect(Math.abs(v * pixelRatio - Math.round(v * pixelRatio))).toBeLessThan(1e-9);
    whole(origin.x + layout.lines[0]!.x);
    whole(origin.y + layout.lines[0]!.baseline);
    const img = layout.image!;
    whole(origin.x + img.x);
    whole(origin.y + img.y);
    whole(origin.x + img.x + img.width);
    whole(origin.y + img.y + img.height);
  });

  it('lays out an image alone at its natural or given size', () => {
    const { ctx } = recordingContext();
    const image = { width: 120, height: 60 } as unknown as CanvasImageSource;
    const natural = layoutWatermark(ctx, env(), opts({ image }))!;
    expect(natural.image).toEqual({ x: 340, y: 170, width: 120, height: 60 });
    expect(natural.lines).toEqual([]);
    const sized = layoutWatermark(ctx, env(), opts({ image, imageSize: { width: 40, height: 20 }, anchor: 'right' }))!;
    expect(sized.image).toEqual({ x: 744, y: 190, width: 40, height: 20 });
  });

  it('stacks the project mark above the lines, and lays it out alone', () => {
    const { ctx } = recordingContext();
    const layout = layoutWatermark(ctx, env(), opts({ logo: true, lines: [{ text: 'ABCD', size: 40 }] }))!;
    const logo = layout.logo!;
    expect(logo.size).toBe(ATTRIBUTION_SIZE);
    expect(logo.x + logo.size / 2).toBe(400);
    // Mark, a gap of 0.3 × the first line, then the line.
    expect(layout.height).toBeCloseTo(ATTRIBUTION_SIZE + 12 + 48);
    expect(layout.lines[0]!.baseline).toBeGreaterThan(logo.y + logo.size);
    const alone = layoutWatermark(ctx, env(), opts({ logo: true }))!;
    expect(alone.lines).toEqual([]);
    expect(alone.logo).toEqual({ x: 376, y: 176, size: ATTRIBUTION_SIZE });
    expect(layoutWatermark(ctx, env(), opts())).toBeNull();
  });

  it('warns once that the logo option is deprecated, when an app sets it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mark = createWatermark();
    mark.applyOptions({ logo: false });
    expect(warn).not.toHaveBeenCalled();
    mark.applyOptions({ logo: true });
    createWatermark({ logo: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/^charton \[deprecated\]: .*docs\/upgrading\/index\.md#logo-on-watermarkoptions\)$/);
    warn.mockRestore();
  });

  it('sizes the author line and each line by position, over the lines given', () => {
    const { ctx } = recordingContext();
    const layout = layoutWatermark(
      ctx,
      env(),
      opts({ author: 'Me', authorSize: 30, lineSizes: [null, 12], lines: [{ text: 'AB', size: 64 }, { text: '1h', size: 22 }] }),
    )!;
    expect(layout.lines.map((l) => l.size)).toEqual([30, 64, 12]);
    // Unusable sizes keep the defaults.
    const fallback = layoutWatermark(ctx, env(), opts({ author: 'Me', authorSize: -1, lineSizes: [Number.NaN], lines: ['AB'] }))!;
    expect(fallback.lines.map((l) => l.size)).toEqual([24, 48]);
  });
});

describe('createWatermark', () => {
  it('draws behind the series in the theme color, in both themes', () => {
    const w = createWatermark({ lines: ['BTCUSD', '1h'] });
    expect(w.layer).toBe('below');
    for (const theme of [darkTheme, lightTheme]) {
      const { ctx, calls } = recordingContext();
      w.drawPlot!(ctx, env({ theme }));
      expect(calls.map((c) => c.args[0])).toEqual(['BTCUSD', '1h']);
      expect(calls.every((c) => c.fillStyle === theme.watermark && c.globalAlpha === 1)).toBe(true);
    }
    // The tokens differ, and stay faint.
    expect(darkTheme.watermark).not.toBe(lightTheme.watermark);
  });

  it('snaps against the canvas transform the chart sets for the plot area', () => {
    const w = createWatermark({ lines: [{ text: 'XYZ', size: 37 }] });
    const { ctx, calls } = recordingContext();
    const pr = 1.25;
    // Device-pixel scale plus a translate to a plot area at (37, 101) css px.
    (ctx as unknown as { getTransform(): DOMMatrix }).getTransform = () =>
      ({ a: pr, b: 0, c: 0, d: pr, e: 37 * pr, f: 101 * pr }) as DOMMatrix;
    w.drawPlot!(ctx, env({ width: 641, height: 333, pixelRatio: pr }));
    const [, x, y] = calls[0]!.args as [string, number, number];
    const whole = (v: number) => expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-9);
    whole((37 + x) * pr);
    whole((101 + y) * pr);
  });

  it('applies a custom color, opacity and font, and hides when not visible', () => {
    const w = createWatermark({ lines: ['A'], color: '#ff0000', opacity: 0.5, fontFamily: 'serif' });
    const { ctx, calls } = recordingContext();
    w.drawPlot!(ctx, env());
    expect(calls[0]).toMatchObject({ fillStyle: '#ff0000', globalAlpha: 0.5 });
    expect(calls[0]!.font).toMatch(/serif$/);
    w.applyOptions({ visible: false });
    calls.length = 0;
    w.drawPlot!(ctx, env());
    expect(calls).toEqual([]);
  });

  it('draws images with the opacity times the color alpha', () => {
    const image = { width: 10, height: 10 } as unknown as CanvasImageSource;
    const theme: ChartTheme = { ...darkTheme, watermark: 'rgba(0, 0, 0, 0.2)' };
    const w = createWatermark({ image, opacity: 0.5 });
    const { ctx, calls } = recordingContext();
    w.drawPlot!(ctx, env({ theme }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.op).toBe('drawImage');
    expect(calls[0]!.args[0]).toBe(image);
    expect(calls[0]!.globalAlpha).toBeCloseTo(0.1, 2);
  });

  it('requests a redraw when its options change, only while attached', () => {
    const w = createWatermark();
    const host = { requestRedraw: vi.fn() } as unknown as PrimitiveHost;
    w.applyOptions({ lines: ['x'] });
    w.attached!(host);
    w.applyOptions({ anchor: 'top' });
    expect(host.requestRedraw).toHaveBeenCalledTimes(1);
    expect(w.options).toMatchObject({ lines: ['x'], anchor: 'top' });
    w.detached!();
    w.applyOptions({ anchor: 'bottom' });
    expect(host.requestRedraw).toHaveBeenCalledTimes(1);
  });

  it('formats the symbol and interval by default', () => {
    const info: SymbolInfo = { symbol: 'XAUUSD', name: 'Gold spot' };
    expect(symbolWatermarkLines(info, '4h').map((l) => (typeof l === 'string' ? l : l.text))).toEqual(['XAUUSD', '4h · Gold spot']);
    expect(symbolWatermarkLines({ symbol: 'A', name: 'A' }, '1d').map((l) => (typeof l === 'string' ? l : l.text))).toEqual(['A', '1d']);
  });

  it('puts the author line above the other lines, trimmed', () => {
    const { ctx } = recordingContext();
    const lines = [{ text: 'ABCD', size: 40 }, { text: '1h', size: 20 }];
    const layout = layoutWatermark(ctx, env(), opts({ lines, author: '  Jo Doe  ' }))!;
    expect(layout.lines.map((l) => l.text)).toEqual(['Jo Doe', 'ABCD', '1h']);
    expect(layout.lines[0]!.size).toBe(defaultWatermarkOptions.fontSize / 2);
    expect(layout.lines[0]!.baseline).toBeLessThan(layout.lines[1]!.baseline);
  });

  it('adds no line for an empty or whitespace-only author', () => {
    const { ctx } = recordingContext();
    const lines = [{ text: 'ABCD', size: 40 }];
    const plain = layoutWatermark(ctx, env(), opts({ lines }));
    expect(layoutWatermark(ctx, env(), opts({ lines, author: '' }))).toEqual(plain);
    expect(layoutWatermark(ctx, env(), opts({ lines, author: ' \t\n ' }))).toEqual(plain);
    expect(layoutWatermark(ctx, env(), opts({ author: '   ' }))).toBeNull();
  });

  it('cuts a long author line to 40 characters', () => {
    const { ctx } = recordingContext();
    const layout = layoutWatermark(ctx, env(), opts({ author: `${'x'.repeat(39)}yz` }))!;
    expect(layout.lines[0]!.text).toBe(`${'x'.repeat(39)}…`);
    expect([...layoutWatermark(ctx, env(), opts({ author: '😀'.repeat(40) }))!.lines[0]!.text]).toHaveLength(40);
  });

  it('keeps the author line while it follows the symbol', async () => {
    const chart = new Chart(fakeContainer());
    try {
      const w = createWatermark({ author: 'Jo' });
      w.follow(chart);
      chart.setDataSource({
        symbol: async (symbol) => ({ symbol, name: symbol }),
        search: async () => [],
        history: async () => ({ bars: [], atStart: true }),
      });
      await chart.setSymbol('AAA', '1m');
      await chart.setSymbol('BBB', '1h');
      const { ctx } = recordingContext();
      expect(layoutWatermark(ctx, env(), w.options)!.lines.map((l) => l.text)).toEqual(['Jo', 'BBB', '1h']);
    } finally {
      chart.destroy();
    }
  });
});

describe('watermark on a chart', () => {
  const bars: Bar[] = Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0.5, close: 1.5 }));
  const source: DataSource = {
    symbol: async (symbol) => ({ symbol, name: `${symbol} name` }),
    search: async () => [],
    history: async () => ({ bars, atStart: true }),
  };

  it('follows symbol and interval switches and stops when unsubscribed', async () => {
    const chart = new Chart(fakeContainer());
    try {
      const w = createWatermark();
      chart.attachPrimitive(w);
      const stop = w.follow(chart, (s, i) => [s.symbol, i]);
      chart.setDataSource(source);
      await chart.setSymbol('AAA', '1m');
      expect(w.options.lines).toEqual(['AAA', '1m']);
      await chart.setSymbol('AAA', '15m');
      expect(w.options.lines).toEqual(['AAA', '15m']);
      await chart.setSymbol('BBB', '15m');
      expect(w.options.lines).toEqual(['BBB', '15m']);
      stop();
      await chart.setSymbol('CCC', '1h');
      expect(w.options.lines).toEqual(['BBB', '15m']);
    } finally {
      chart.destroy();
    }
  });

  it('shows the built-in watermark with features.watermark', async () => {
    const chart = new Chart(fakeContainer(), { features: { watermark: true } });
    try {
      const detached = vi.spyOn(chart.watermark, 'detached');
      chart.setDataSource(source);
      await chart.setSymbol('AAA', '1h');
      expect(chart.watermark.options.lines.map((l) => (typeof l === 'string' ? l : l.text))).toEqual(['AAA', '1h · AAA name']);
      expect(chart.watermark.layer).toBe('below');
      chart.applyOptions({ features: { watermark: false } });
      expect(detached).toHaveBeenCalledTimes(1);
      // Still follows while hidden, so it is current when shown again.
      await chart.setSymbol('BBB', '1h');
      chart.applyOptions({ features: { watermark: true } });
      expect(chart.features.watermark).toBe(true);
      expect((chart.watermark.options.lines[0] as { text: string }).text).toBe('BBB');
      // Re-applying the same flag does not attach it twice.
      expect(() => chart.applyOptions({ features: { watermark: true } })).not.toThrow();
    } finally {
      chart.destroy();
    }
  });

  it('takes over a built-in watermark attached by hand when the flag turns on', async () => {
    const chart = new Chart(fakeContainer());
    try {
      chart.attachPrimitive(chart.watermark);
      expect(() => chart.applyOptions({ features: { watermark: true } })).not.toThrow();
      const detached = vi.spyOn(chart.watermark, 'detached');
      chart.applyOptions({ features: { watermark: false } });
      expect(detached).toHaveBeenCalledTimes(1);
    } finally {
      chart.destroy();
    }
  });

  it('re-attaches a built-in watermark detached by hand when the flag is applied', async () => {
    const chart = new Chart(fakeContainer(), { features: { watermark: true } });
    try {
      chart.detachPrimitive(chart.watermark);
      const attached = vi.spyOn(chart.watermark, 'attached');
      chart.applyOptions({ features: { watermark: true } });
      expect(attached).toHaveBeenCalledTimes(1);
      // Toggling off and on again works from the real state too.
      chart.detachPrimitive(chart.watermark);
      chart.applyOptions({ features: { watermark: false } });
      chart.applyOptions({ features: { watermark: true } });
      expect(attached).toHaveBeenCalledTimes(2);
      // Unrelated options leave a hand-made attachment alone.
      chart.applyOptions({ features: { watermark: false } });
      chart.attachPrimitive(chart.watermark);
      chart.applyOptions({ rightOffset: 5 });
      expect(() => chart.attachPrimitive(chart.watermark)).toThrow('already attached');
    } finally {
      chart.destroy();
    }
  });

  it('has no watermark without the watermark() plugin, warns once, and shows the loaded symbol once it is installed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const chart = new Chart(fakeContainer(), { plugins: [dataSource()], features: { watermark: true } });
    try {
      expect(() => chart.watermark).toThrow('watermark()');
      chart.applyOptions({ features: { watermark: true } });
      expect(warn.mock.calls.filter(([m]) => String(m).includes('[watermark-missing]'))).toHaveLength(1);
      chart.setDataSource(source);
      await chart.setSymbol('AAA', '1h');
      // Installed after the load: it shows what is loaded now, then follows.
      const uninstall = chart.install(watermark());
      expect((chart.watermark.options.lines[0] as { text: string }).text).toBe('AAA');
      expect(() => chart.attachPrimitive(chart.watermark)).toThrow('already attached');
      await chart.setSymbol('BBB', '1h');
      const mark = chart.watermark;
      expect((mark.options.lines[0] as { text: string }).text).toBe('BBB');
      // Uninstalling detaches it and stops following.
      const detached = vi.spyOn(mark, 'detached');
      uninstall();
      expect(detached).toHaveBeenCalledTimes(1);
      expect(() => chart.watermark).toThrow('watermark()');
      await chart.setSymbol('CCC', '1h');
      expect((mark.options.lines[0] as { text: string }).text).toBe('BBB');
    } finally {
      chart.destroy();
      warn.mockRestore();
    }
  });
});
