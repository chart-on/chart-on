import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { validateIndicatorDef } from '../src/indicators/indicator';
import { IndicatorRunner } from '../src/indicators/runner';
import type { IndicatorDef, PlotDef } from '../src/indicators/types';
import { RectBatch } from '../src/gl/rect-batch';
import { opaque } from '../src/series';
import { parseColor } from '../src/util/color';
import { darkTheme } from '../src/theme';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

const bar = (i: number): Bar => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 });
const bars = Array.from({ length: 20 }, (_, i) => bar(i));

const RED = '#ff0000';
const GREEN = '#00ff00';
const BLUE = '#0000ff';

/**
 * A line `l` at i and a histogram `h` alternating 2 and -2, both coloured by
 * output `c`: index 0 on bars 0-4, 1 on 5-9, NaN on 10-14, 7 (outside the
 * palette) from 15 on.
 */
const def = (line: Partial<PlotDef> = {}, histogram: Partial<PlotDef> = {}): IndicatorDef => ({
  id: 'test/point-colors',
  name: 'Point colours',
  placement: 'pane',
  inputs: [],
  plots: [
    { id: 'l', type: 'line', color: BLUE, palette: [RED, GREEN], colorOutput: 'c', ...line } as PlotDef,
    { id: 'h', type: 'histogram', palette: [RED, GREEN], colorOutput: 'c', ...histogram } as PlotDef,
  ],
  compute: (src) => ({
    l: Float64Array.from({ length: src.length }, (_, i) => i),
    h: Float64Array.from({ length: src.length }, (_, i) => (i % 2 ? -2 : 2)),
    c: Float64Array.from({ length: src.length }, (_, i) => (i < 5 ? 0 : i < 10 ? 1 : i < 15 ? NaN : 7)),
  }),
});

function setup(d: IndicatorDef = def(), options = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  c.addCandles().setData(bars);
  c.fitContent(false);
  const indicator = c.indicators.add(d);
  return { c, indicator, series: indicator.series! };
}

const internals = (c: Chart) => c as unknown as { render(dt: number): boolean; ctx(canvas: unknown): CanvasRenderingContext2D };

/** A 2D context recording the stroke style of each stroke. */
function recorder() {
  const strokes: unknown[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, key: string) => {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (key === 'stroke') return () => strokes.push(state.strokeStyle);
      if (key in state) return state[key];
      return () => {};
    },
    set: (_t, key: string, value) => {
      state[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
}

function frame(c: Chart, ctx?: CanvasRenderingContext2D): void {
  if (ctx) internals(c).ctx = () => ctx;
  c.invalidate();
  internals(c).render(0);
}

const legendColors = (series: { legend(i: number): { parts: { color?: string }[] } }, i: number) => series.legend(i).parts.map((p) => p.color);
const plotStrokes = (strokes: unknown[]) => strokes.filter((s) => [RED, GREEN, BLUE].includes(String(s)));

describe('indicator point colours', () => {
  it('rejects colorOutput without a palette and a palette without colorOutput', () => {
    expect(() => validateIndicatorDef(def({ palette: undefined }))).toThrow(/plot "l" needs a palette/);
    expect(() => validateIndicatorDef(def({ palette: [] }))).toThrow(/plot "l" needs a palette/);
    expect(() => validateIndicatorDef(def({}, { colorOutput: undefined }))).toThrow(/plot "h" needs a colorOutput/);
    expect(() => validateIndicatorDef(def({ colorOutput: '' }))).toThrow(/plot "l" needs a colorOutput/);
    expect(() => validateIndicatorDef(def({ palette: undefined, colorOutput: undefined }, { palette: undefined, colorOutput: undefined }))).not.toThrow();
  });

  it('reports a compute result without the colour output', () => {
    const d = { ...def(), compute: () => ({ l: new Float64Array(3), h: new Float64Array(3) }) };
    const errors: unknown[] = [];
    const runner = new IndicatorRunner(d, {}, { change() {}, error: (e) => errors.push(e) });
    runner.setBars(bars.slice(0, 3));
    expect((errors[0] as Error).message).toMatch(/for "c"/);
  });

  it('colours the legend, last-value labels and price lines at their bar', () => {
    const { series } = setup(def({ priceLine: true }, { priceLine: true }));
    expect(legendColors(series, 2)).toEqual([opaque(RED), opaque(RED)]);
    expect(legendColors(series, 7)).toEqual([opaque(GREEN), opaque(GREEN)]);
    // NaN, and an index outside the palette, keep the plot's colour (by sign for the histogram).
    expect(legendColors(series, 12)).toEqual([opaque(BLUE), opaque(darkTheme.up)]);
    expect(legendColors(series, 17)).toEqual([opaque(BLUE), opaque(darkTheme.down)]);
    expect(series.lastValues().map((l) => l.color)).toEqual([opaque(BLUE), opaque(darkTheme.down)]);
    expect(series.priceLines(19).map((l) => l.color)).toEqual([opaque(BLUE), opaque(darkTheme.down)]);
  });

  it('writes each histogram column in its colour', () => {
    const set = vi.spyOn(RectBatch.prototype, 'set');
    setup(def({ palette: undefined, colorOutput: undefined }));
    const colors = new Map(set.mock.calls.map((call) => [call[0], call[5]]));
    expect(colors.get(3)).toEqual(parseColor(RED));
    expect(colors.get(6)).toEqual(parseColor(GREEN));
    expect(colors.get(12)).toEqual(parseColor(darkTheme.up));
    expect(colors.get(17)).toEqual(parseColor(darkTheme.down));
  });

  it('strokes each run of one colour of a line in it', () => {
    const { c } = setup(def({}, { palette: undefined, colorOutput: undefined }));
    const r = recorder();
    frame(c, r.ctx);
    // Bars 0-4 red, 5-9 green, then the plot's colour.
    expect(plotStrokes(r.strokes)).toEqual([RED, GREEN, BLUE]);
  });

  // The GPU renderer is the default for indicator lines (#296).
  it.each([{ renderer: 'gpu' as const }, {}])('draws a coloured line on the canvas with the GPU renderer, other lines on the GPU (%o)', (options) => {
    const base = def({}, { palette: undefined, colorOutput: undefined });
    const d: IndicatorDef = {
      ...base,
      plots: [...base.plots, { id: 'plain', type: 'line', color: '#123456' }],
      compute: (src, ...rest) => ({ ...(base.compute(src, ...rest) as Record<string, Float64Array>), plain: new Float64Array(src.length).fill(3) }),
    };
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles().setData(bars);
    c.fitContent(false);
    c.indicators.add(d, {}, options);
    const r = recorder();
    frame(c, r.ctx);
    expect(plotStrokes(r.strokes)).toEqual([RED, GREEN, BLUE]);
    expect(r.strokes).not.toContain('#123456');
  });

  it('takes the colour of its bucket last bar while the view groups bars', () => {
    const n = 50_000;
    const c = new Chart(fakeContainer(), { animateViewChanges: false, grouping: { mode: 'pixel' } });
    charts.push(c);
    c.addCandles().setData(Array.from({ length: n }, (_, i) => bar(i)));
    c.fitContent(false);
    const series = c.indicators.add({
      ...def(),
      compute: (src) => ({
        l: Float64Array.from({ length: src.length }, (_, i) => i % 7),
        h: Float64Array.from({ length: src.length }, () => 2),
        // Only the last bar of each bucket is green.
        c: Float64Array.from({ length: src.length }, () => 0),
      }),
    }).series!;
    frame(c);
    expect(c.groupLevel).toBeGreaterThan(0);
    const g = c.buckets!;
    const out = (series as unknown as { runner: { out: Record<string, Float64Array> } }).runner.out.c!;
    for (let j = 0; j <= g.of(n - 1); j++) out[Math.min(g.end(j), n) - 1] = 1;
    series.refresh(0);
    expect(legendColors(series, 0)).toEqual([opaque(GREEN), opaque(GREEN)]);
    const r = recorder();
    frame(c, r.ctx);
    expect(new Set(plotStrokes(r.strokes))).toEqual(new Set([GREEN]));
  });
});
