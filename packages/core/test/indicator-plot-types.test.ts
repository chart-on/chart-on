import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { IndicatorDef, PlotDef } from '../src/indicators/types';
import type { MarkerPointerEvent } from '../src/annotations/types';
import type { CandleSeries } from '../src/series';
import { RECT_STRIDE } from '../src/gl/rect-batch';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = Array.from({ length: 40 }, (_, i) => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 + (i % 2) }));

const PALETTE = ['rgba(0, 200, 0, 0.2)', 'rgba(200, 0, 0, 0.2)'];

/** Bars 0-9 shaded with entry 0, 10-19 with entry 1, then nothing (NaN), then an index outside the palette. */
const backgroundDef = (plots: PlotDef[] = []): IndicatorDef => ({
  id: 'test/background',
  name: 'Background',
  placement: 'overlay',
  inputs: [],
  plots: [{ id: 'bg', type: 'background', palette: PALETTE }, ...plots],
  compute: (src) => ({
    bg: Float64Array.from({ length: src.length }, (_, i) => (i < 10 ? 0 : i < 20 ? 1 : i < 30 ? NaN : 5)),
    line: Float64Array.from(src.close),
  }),
});

const internals = (c: Chart) => c as unknown as { render(dt: number): boolean; ctx(canvas: unknown): CanvasRenderingContext2D };

/** A 2D context recording `fillRect` calls with the fill colour, and counting `lineTo` calls. */
function recorder() {
  const rects: { color: unknown; x: number; w: number }[] = [];
  const counter = { lineTo: 0 };
  const state: Record<string, unknown> = {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, key: string) => {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (key === 'fillRect') return (x: number, _y: number, w: number) => rects.push({ color: state.fillStyle, x, w });
      if (key === 'lineTo') return () => counter.lineTo++;
      if (key in state) return state[key];
      return () => {};
    },
    set: (_t, key: string, value) => {
      state[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, counter };
}

function setup(def: IndicatorDef) {
  const c = new Chart(fakeContainer());
  charts.push(c);
  const candles = c.addCandles();
  candles.setData(bars);
  c.fitContent(false);
  const indicator = c.indicators.add(def, {}, { renderer: 'canvas' });
  const rec = recorder();
  internals(c).ctx = () => rec.ctx;
  return { c, indicator, rec, candles };
}

function frame(c: Chart): void {
  c.invalidate();
  internals(c).render(0);
}

describe('background plots', () => {
  it('shades each run of one palette colour as one full-height rect, skipping NaN and unknown indices', () => {
    const { c, rec } = setup(backgroundDef());
    frame(c);
    const shades = rec.rects.filter((r) => PALETTE.includes(String(r.color)));
    expect(shades.map((r) => r.color)).toEqual(PALETTE);
    const [first, second] = shades;
    // The second run starts where the first ends, and is as wide (ten bars each).
    expect(second!.x).toBeCloseTo(first!.x + first!.w, 6);
    expect(second!.w).toBeCloseTo(first!.w, 6);
  });

  it('stays out of the legend, the price axis and autoscale', () => {
    const { indicator } = setup(backgroundDef([{ id: 'line', type: 'line', color: '#123456' }]));
    const series = indicator.series!;
    expect(series.legend(5).parts).toHaveLength(1);
    expect(series.lastValues().map((l) => l.value)).toEqual([101]);
    // Palette indices (0, 1, 5) never widen the range around the close.
    expect(series.priceRange(0, 39)).toEqual([100, 101]);
  });

  it('draws nothing while hidden through its style', () => {
    const { c, indicator, rec } = setup(backgroundDef());
    indicator.setPlotStyle('bg', { visible: false });
    frame(c);
    expect(rec.rects.filter((r) => PALETTE.includes(String(r.color)))).toEqual([]);
  });

  it('needs a palette', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    const def = { ...backgroundDef(), plots: [{ id: 'bg', type: 'background' } as PlotDef] };
    expect(() => c.indicators.add(def)).toThrow(/palette/);
  });

  it('takes no line width or style', () => {
    const { indicator } = setup(backgroundDef());
    expect(() => indicator.setPlotStyle('bg', { lineWidth: 2 })).toThrow(/line plots only/);
  });
});

describe('step line plots', () => {
  const lineDef = (lineType?: 'simple' | 'step'): IndicatorDef => ({
    id: 'test/step',
    name: 'Step',
    placement: 'pane',
    inputs: [],
    plots: [{ id: 'line', type: 'line', color: '#123456', ...(lineType ? { lineType } : {}) }],
    compute: (src) => ({ line: Float64Array.from(src.close) }),
  });

  it('holds each value to the next bar, then jumps', () => {
    const simple = setup(lineDef());
    frame(simple.c);
    const step = setup(lineDef('step'));
    frame(step.c);
    // A step adds a corner vertex per bar, so the path has about twice the vertices.
    expect(step.rec.counter.lineTo).toBeGreaterThan(simple.rec.counter.lineTo * 1.5);
  });
});

describe('shape plots', () => {
  /** An arrow on every bar whose index ends in 5 (or closes above 105), as a bar marker. */
  const shapeDef = (plot: Partial<PlotDef> = {}, placement: 'overlay' | 'pane' = 'overlay', plots: PlotDef[] = []): IndicatorDef => ({
    id: 'test/shape',
    name: 'Shape',
    placement,
    inputs: [],
    plots: [{ id: 'sig', type: 'shape', shape: 'arrow-up', ...plot } as PlotDef, ...plots],
    compute: (src) => ({
      sig: Float64Array.from({ length: src.length }, (_, i) => (i % 10 === 5 || src.close[i]! > 105 ? src.close[i]! : NaN)),
      line: Float64Array.from(src.close),
    }),
  });

  function hovering(c: Chart, index: number, y: number): MarkerPointerEvent | null {
    const hovers: MarkerPointerEvent[] = [];
    const off = c.on('marker:hover', (e) => hovers.push(e));
    c.annotations.pointerMove({ x: c.time.indexToX(index), y });
    c.annotations.pointerMove({ x: c.time.width + 50, y: 0 });
    off();
    return hovers[0] ?? null;
  }

  /** Plot-space y just below the main bar's low (90), where a `below` marker sits. */
  const belowBar = (c: Chart) => c.panes[0]!.top + c.panes[0]!.primary.priceToY(90) + 10;

  it('draws a marker under the main bar wherever the output is finite, reported with the indicator series', () => {
    const { c, indicator } = setup(shapeDef({ color: '#00aa00', text: 'B' }));
    frame(c);
    const hit = hovering(c, 15, belowBar(c));
    expect(hit?.series).toBe(indicator.series);
    expect(hit?.marker).toEqual({ time: 15 * 60, shape: 'arrow-up', color: '#00aa00', text: 'B' });
    expect(hovering(c, 16, belowBar(c))).toBeNull();
    // Not one of the app's markers.
    expect(c.annotations.getMarkers()).toEqual([]);
    expect(c.annotations.getMarkers(indicator.series!)).toEqual([]);
  });

  it('places atPrice shapes at the output, next to the indicator in its own pane', () => {
    const { c, indicator } = setup(shapeDef({ shape: 'circle', position: 'atPrice' }, 'pane', [{ id: 'line', type: 'line' }]));
    frame(c);
    const series = indicator.series!;
    const y = series.pane.top + series.scale.priceToY(101);
    expect(hovering(c, 15, y)?.marker).toMatchObject({ position: 'atPrice', price: 101 });
  });

  it('stays out of the legend, the price axis and autoscale', () => {
    const { indicator } = setup(shapeDef({}, 'pane', [{ id: 'line', type: 'line', color: '#123456' }]));
    const series = indicator.series!;
    expect(series.legend(15).parts).toHaveLength(1);
    expect(series.lastValues()).toHaveLength(1);
    expect(series.priceRange(0, 39)).toEqual([100, 101]);
  });

  it('follows new bars, the plot style and removal', () => {
    const { c, indicator, candles } = setup(shapeDef());
    frame(c);
    candles.update({ time: 40 * 60, open: 100, high: 110, low: 90, close: 108 });
    frame(c);
    expect(hovering(c, 40, belowBar(c))?.marker.time).toBe(40 * 60);
    // Older markers stay.
    expect(hovering(c, 15, belowBar(c))?.marker.time).toBe(15 * 60);
    indicator.setPlotStyle('sig', { visible: false });
    frame(c);
    expect(hovering(c, 15, belowBar(c))).toBeNull();
    indicator.setPlotStyle('sig', { visible: true });
    frame(c);
    expect(hovering(c, 15, belowBar(c))).not.toBeNull();
    c.indicators.remove(indicator);
    frame(c);
    expect(hovering(c, 15, belowBar(c))).toBeNull();
  });

  it('needs a shape and a valid icon', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    expect(() => c.indicators.add(shapeDef({ shape: undefined }))).toThrow(/needs a shape/);
    expect(() => c.indicators.add(shapeDef({ icon: {} as never }))).toThrow(/shape plot "sig".*icon/);
  });
});

describe('bar colour plots', () => {
  const RED = [255, 0, 0, 255];
  const BLUE = [0, 0, 255, 255];

  /** Bars 0-9 red, 10-19 blue, then nothing (NaN), then an index outside the palette. */
  const barColorDef = (plots: PlotDef[] = []): IndicatorDef => ({
    id: 'test/bar-color',
    name: 'Bar colour',
    placement: 'pane',
    inputs: [],
    plots: [{ id: 'bc', type: 'barColor', palette: ['#ff0000', '#0000ff'] }, ...plots],
    compute: (src) => ({
      bc: Float64Array.from({ length: src.length }, (_, i) => (i < 10 ? 0 : i < 20 ? 1 : i < 30 ? NaN : 5)),
      line: Float64Array.from(src.close),
    }),
  });

  /** RGBA of each of the main series' bars: its wick, body and outline. */
  const barColors = (candles: CandleSeries) =>
    Array.from({ length: candles.batch.count / 3 }, (_, k) =>
      [0, 1, 2].map((m) => [...candles.batch.bytes.subarray((k * 3 + m) * RECT_STRIDE + 20, (k * 3 + m) * RECT_STRIDE + 24)]),
    );

  function recoloured(plots: PlotDef[] = []) {
    const c = new Chart(fakeContainer());
    charts.push(c);
    const candles = c.addCandles({ animate: false });
    candles.setData(bars);
    const plain = barColors(candles);
    const indicator = c.indicators.add(barColorDef(plots));
    return { c, candles, plain, indicator };
  }

  it('recolours whole bars from the palette and keeps the rest', () => {
    const { candles, plain } = recoloured();
    const now = barColors(candles);
    expect(now.slice(0, 10)).toEqual(Array(10).fill([RED, RED, RED]));
    expect(now.slice(10, 20)).toEqual(Array(10).fill([BLUE, BLUE, BLUE]));
    expect(now.slice(20)).toEqual(plain.slice(20));
  });

  it('colours the last-value label like its bar', () => {
    const { c, candles } = recoloured();
    const own = candles.lastValue()?.color;
    expect(own).not.toBe('#0000ff');
    c.indicators.add({ ...barColorDef(), id: 'test/all-blue', compute: (src) => ({ bc: new Float64Array(src.length).fill(1) }) });
    expect(candles.lastValue()?.color).toBe('#0000ff');
  });

  it('lets the last plot with a colour win', () => {
    const second: PlotDef = { id: 'line', type: 'barColor', palette: ['#0000ff'] };
    const { candles } = recoloured([second]);
    // Output `line` is the close (100 or 101): index 100 is outside the palette, so the first plot shows.
    expect(barColors(candles)[0]).toEqual([RED, RED, RED]);
  });

  it('follows new bars, the plot style, the series visibility and removal', () => {
    const { c, candles, plain, indicator } = recoloured();
    candles.update({ time: 40 * 60, open: 100, high: 110, low: 90, close: 108 });
    frame(c);
    expect(barColors(candles)).toHaveLength(41);
    indicator.setPlotStyle('bc', { visible: false });
    expect(barColors(candles).slice(0, 40)).toEqual(plain);
    indicator.setPlotStyle('bc', { visible: true });
    expect(barColors(candles)[0]).toEqual([RED, RED, RED]);
    indicator.series!.setVisible(false);
    expect(barColors(candles).slice(0, 40)).toEqual(plain);
    indicator.series!.setVisible(true);
    expect(barColors(candles)[15]).toEqual([BLUE, BLUE, BLUE]);
    c.indicators.remove(indicator);
    expect(barColors(candles).slice(0, 40)).toEqual(plain);
  });

  it('stays out of the legend, the price axis and autoscale', () => {
    const { indicator } = recoloured([{ id: 'line', type: 'line', color: '#123456' }]);
    const series = indicator.series!;
    expect(series.legend(5).parts).toHaveLength(1);
    expect(series.lastValues().map((l) => l.value)).toEqual([101]);
    expect(series.priceRange(0, 39)).toEqual([100, 101]);
  });

  it('needs a palette', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    expect(() => c.indicators.add({ ...barColorDef(), plots: [{ id: 'bc', type: 'barColor' } as PlotDef] })).toThrow(/barColor plot "bc" needs a palette/);
  });
});
