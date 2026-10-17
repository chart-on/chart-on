import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { validateIndicatorDef } from '../src/indicators/indicator';
import { IndicatorRunner } from '../src/indicators/runner';
import type { IndicatorDef, PlotDef } from '../src/indicators/types';
import { RectBatch, RectKind } from '../src/gl/rect-batch';
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

/**
 * An OHLC plot `c` of bars opening at 10 + i, closing 1 higher on even bars
 * and 1 lower on odd ones, with high and low 2 beyond. Its open is NaN on
 * bars 0-2, so they draw nothing.
 */
const def = (plot: Partial<PlotDef> = {}, extra: Partial<IndicatorDef> = {}): IndicatorDef => ({
  id: 'test/ohlc',
  name: 'OHLC',
  placement: 'pane',
  inputs: [],
  plots: [{ id: 'c', type: 'ohlc', open: 'o', high: 'h', low: 'l', ...plot } as PlotDef],
  compute: (src) => {
    const of = (f: (i: number) => number) => Float64Array.from({ length: src.length }, (_, i) => f(i));
    const close = (i: number) => 10 + i + (i % 2 ? -1 : 1);
    return {
      o: of((i) => (i < 3 ? NaN : 10 + i)),
      h: of((i) => Math.max(10 + i, close(i)) + 2),
      l: of((i) => Math.min(10 + i, close(i)) - 2),
      c: of(close),
      p: of((i) => (i === 4 ? 0 : i === 5 ? 1 : NaN)),
    };
  },
  ...extra,
});

function setup(d: IndicatorDef = def(), options = {}) {
  const c = new Chart(fakeContainer(), { animateViewChanges: false, ...options });
  charts.push(c);
  c.addCandles().setData(bars);
  c.fitContent(false);
  const indicator = c.indicators.add(d);
  return { c, indicator, series: indicator.series! };
}

function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

/** The instances written into the plot's own rect batch, as [instance, index, p0, p1, kind, colour]. */
function written(set: ReturnType<typeof spyOnSet>, series: unknown, id = 'c') {
  const batch = (series as { batches: Map<string, RectBatch> }).batches.get(id);
  return set.mock.calls.filter((_, i) => set.mock.contexts[i] === batch);
}
const spyOnSet = () => vi.spyOn(RectBatch.prototype, 'set');

/** The `drawRects` calls of one frame for the plot's batch, as [first, count, body ratio]. */
function draws(c: Chart, series: unknown): [number, number, number][] {
  const r = (c as unknown as { renderer: { drawRects: (...args: unknown[]) => void } }).renderer;
  const batch = (series as { batches: Map<string, RectBatch> }).batches.get('c');
  const out: [number, number, number][] = [];
  const draw = r.drawRects.bind(r);
  r.drawRects = (b, first, count, u) => {
    if (b === batch) out.push([first as number, count as number, (u as { bodyRatio: number }).bodyRatio]);
    draw(b, first, count, u);
  };
  frame(c);
  r.drawRects = draw;
  return out;
}

const legend = (series: { legend(i: number): { parts: { label?: string; text: string; color?: string }[] } }, i: number) => series.legend(i).parts;

describe('indicator OHLC plots', () => {
  it('needs open, high and low outputs other than its own and each other', () => {
    expect(() => validateIndicatorDef(def())).not.toThrow();
    expect(() => validateIndicatorDef(def({ low: undefined } as Partial<PlotDef>))).toThrow(/ohlc plot "c" needs open, high and low/);
    expect(() => validateIndicatorDef(def({ high: '' } as Partial<PlotDef>))).toThrow(/ohlc plot "c" needs open, high and low/);
    expect(() => validateIndicatorDef(def({ open: 'c' } as Partial<PlotDef>))).toThrow(/ohlc plot "c" needs open, high and low/);
    expect(() => validateIndicatorDef(def({ low: 'h' } as Partial<PlotDef>))).toThrow(/ohlc plot "c" needs open, high and low/);
    expect(() => validateIndicatorDef(def({ upColorInput: 'missing' } as Partial<PlotDef>))).toThrow(/unknown color input "missing"/);
    expect(() => validateIndicatorDef(def({ palette: [RED] } as Partial<PlotDef>))).toThrow(/needs a colorOutput/);
  });

  it('reports a compute result without one of the four outputs', () => {
    const d = def({}, { compute: () => ({ o: new Float64Array(3), h: new Float64Array(3), c: new Float64Array(3) }) });
    const errors: unknown[] = [];
    const runner = new IndicatorRunner(d, {}, { change() {}, error: (e) => errors.push(e) });
    runner.setBars(bars.slice(0, 3));
    expect((errors[0] as Error).message).toMatch(/for "l"/);
  });

  it('draws candles where all four values are finite, up or down by close against open', () => {
    const set = spyOnSet();
    const { series } = setup();
    const calls = written(set, series);
    // Two instances per bar: wick and body.
    const at = (k: number) => calls.filter((call) => call[0] === 2 * k || call[0] === 2 * k + 1).slice(-2);
    expect(at(1).map((call) => call[5])).toEqual([[0, 0, 0, 0], [0, 0, 0, 0]]);
    const [wick, body] = at(6);
    expect(wick!.slice(1, 5)).toEqual([6, 14, 19, RectKind.Wick]);
    expect(body!.slice(1, 5)).toEqual([6, 16, 17, RectKind.Body]);
    // Bar 6 closes higher, bar 7 lower.
    expect(body![5]).toEqual(parseColor(darkTheme.up));
    expect(at(7)[1]![5]).toEqual(parseColor(darkTheme.down));
  });

  it('draws the instances of the bars on screen, and nothing while hidden', () => {
    const { c, indicator, series } = setup();
    const [[first, count, body]] = draws(c, series) as [[number, number, number]];
    expect(first % 2).toBe(0);
    expect(first + count).toBe(2 * bars.length);
    expect(body).toBe(0.7);
    indicator.setPlotStyle('c', { visible: false });
    expect(draws(c, series)).toEqual([]);
    expect(legend(series, 6)).toEqual([]);
    expect(series.priceRange(0, 19)).toBeNull();
  });

  it('draws bars as a range with open and close ticks', () => {
    const set = spyOnSet();
    const { series } = setup(def({ style: 'bars' } as Partial<PlotDef>));
    const calls = written(set, series).filter((call) => call[1] === 6).slice(-3);
    expect(calls.map((call) => call[4])).toEqual([RectKind.Wick, RectKind.TickLeft, RectKind.TickRight]);
    expect(calls.map((call) => call[0])).toEqual([18, 19, 20]);
  });

  it('takes its colours from the plot, its colour inputs and its point colours', () => {
    const d = def(
      { upColor: '#111111', downColor: '#222222', downColorInput: 'down', palette: [RED, GREEN], colorOutput: 'p' } as Partial<PlotDef>,
      { inputs: [{ id: 'down', type: 'color', default: '#333333', role: 'down' }] },
    );
    const { series } = setup(d);
    const colors = (i: number) => [...new Set(legend(series, i).map((p) => p.color))];
    expect(colors(6)).toEqual([opaque('#111111')]);
    expect(colors(7)).toEqual([opaque('#333333')]);
    // The point colour recolours the whole bar, up or down.
    expect(colors(4)).toEqual([opaque(RED)]);
    expect(colors(5)).toEqual([opaque(GREEN)]);
  });

  it('shows O H L C in the legend, the close on the axis, and scales to high and low', () => {
    const { series } = setup(def({ title: 'HA', priceLine: true } as Partial<PlotDef>));
    expect(legend(series, 6).map((p) => [p.label, p.text])).toEqual([
      ['HA O', '16.00'],
      ['H', '19.00'],
      ['L', '14.00'],
      ['C', '17.00'],
    ]);
    expect(legend(series, 1).map((p) => p.text)).toEqual(['—', '—', '—', '—']);
    // Bar 19 opens at 29 and closes at 28.
    expect(series.lastValues().map((l) => [l.value, l.color])).toEqual([[28, opaque(darkTheme.down)]]);
    expect(series.priceLines(19).map((l) => l.value)).toEqual([28]);
    // Bars 3-5: lows 10, 12, 12 and highs 15, 17, 17; bars 0-2 draw nothing.
    expect(series.priceRange(0, 5)).toEqual([10, 17]);
    const y = (v: number) => series.scale.priceToY(v);
    expect(series.hits(6, y(18.5))).toBe(true);
    expect(series.hits(6, y(25))).toBe(false);
    expect(series.hits(1, y(12))).toBe(false);
  });

  it('merges each bucket into one bar while the view groups bars', () => {
    const n = 50_000;
    const c = new Chart(fakeContainer(), { animateViewChanges: false, grouping: { mode: 'pixel' } });
    charts.push(c);
    c.addCandles().setData(Array.from({ length: n }, (_, i) => bar(i)));
    c.fitContent(false);
    const series = c.indicators.add(def()).series!;
    const set = spyOnSet();
    frame(c);
    const g = c.buckets!;
    expect(g).toBeTruthy();
    const j = g.of(n / 2);
    const [first, last] = [g.start(j), Math.min(g.end(j), n) - 1];
    const close = (i: number) => 10 + i + (i % 2 ? -1 : 1);
    // First open, highest high, lowest low, last close.
    expect(legend(series, n / 2).map((p) => p.text)).toEqual(
      [10 + first, Math.max(10 + last, close(last)) + 2, Math.min(10 + first, close(first)) - 2, close(last)].map((v) => series.options.format(v)),
    );
    // The bucket's body, at its centre, from its open to its close.
    const center = (g.start(j) + g.end(j) - 1) / 2;
    expect(set.mock.calls.some((call) => call[1] === center && call[4] === RectKind.Body && call[2] === 10 + first && call[3] === close(last))).toBe(true);
    const [lo, hi] = series.priceRange(g.start(1), g.end(1) - 1)!;
    expect(lo).toBe(Math.min(10 + g.start(1), close(g.start(1))) - 2);
    const end = g.end(1) - 1;
    expect(hi).toBe(Math.max(10 + end, close(end)) + 2);
  });
});
