import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { resolvePlotStyle } from '../src/indicators/plot-style';
import type { Indicator } from '../src/indicators/indicator';
import type { IndicatorDef } from '../src/indicators/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = Array.from({ length: 60 }, (_, i) => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 }));

/** Bands at 120 and 80 around the close, a mid line, a fill between the bands and a histogram. */
const def: IndicatorDef = {
  id: 'test/bands',
  name: 'Bands',
  placement: 'overlay',
  inputs: [{ id: 'width', type: 'number', default: 20 }],
  plots: [
    { id: 'upper', title: 'Upper', type: 'line', color: '#ff0000' },
    { id: 'mid', type: 'line', color: '#00ff00', lineWidth: 2, lineStyle: 'dotted' },
    { id: 'lower', title: 'Lower', type: 'line', color: '#0000ff' },
    { id: 'hist', type: 'histogram', color: '#ffff00' },
  ],
  fills: [{ between: ['upper', 'lower'], color: 'rgba(1, 2, 3, 0.2)' }],
  compute: (src, inputs) => ({
    upper: src.close.map((c) => c + Number(inputs.width)),
    mid: Float64Array.from(src.close),
    lower: src.close.map((c) => c - Number(inputs.width)),
    hist: src.close.map(() => 5),
  }),
};

function setup() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(bars);
  const indicator = c.indicators.add(def, {}, { renderer: 'canvas' });
  return { c, indicator };
}

const internals = (c: Chart) => c as unknown as { render(dt: number): boolean; ctx(canvas: unknown): CanvasRenderingContext2D };

/** A 2D context recording each stroke and fill with the colour, width and dash at the time. */
function recorder() {
  const calls: { name: string; color: unknown; lineWidth: unknown; dash: number[] }[] = [];
  const state: Record<string, unknown> = {};
  let dash: number[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, key: string) => {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (key === 'setLineDash') return (d: number[]) => (dash = [...d]);
      if (key === 'stroke') return () => calls.push({ name: 'stroke', color: state.strokeStyle, lineWidth: state.lineWidth, dash });
      if (key === 'fill') return () => calls.push({ name: 'fill', color: state.fillStyle, lineWidth: state.lineWidth, dash });
      if (key in state) return state[key];
      return () => {};
    },
    set: (_t, key: string, value) => {
      state[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function frame(c: Chart, ctx?: CanvasRenderingContext2D): void {
  if (ctx) internals(c).ctx = () => ctx;
  c.invalidate();
  internals(c).render(0);
}

const plotColors = ['#ff0000', '#00ff00', '#0000ff'];
const strokes = (calls: ReturnType<typeof recorder>['calls']) => calls.filter((call) => call.name === 'stroke' && plotColors.includes(String(call.color)));

describe('indicator plot styles', () => {
  it('reports each plot as declared, then with the styles set over it', () => {
    const { indicator } = setup();
    expect(indicator.plotStyles).toEqual({});
    expect(indicator.getPlotStyle('upper')).toEqual({ lineWidth: 1.5, lineStyle: 'solid', visible: true });
    expect(indicator.getPlotStyle('mid')).toEqual({ lineWidth: 2, lineStyle: 'dotted', visible: true });
    expect(indicator.getPlotStyle('hist')).toEqual({ visible: true });
    expect(indicator.getPlotStyle('nope')).toBeNull();
    expect(resolvePlotStyle(def.plots[1]!, { lineStyle: 'dashed' })).toEqual({ lineWidth: 2, lineStyle: 'dashed', visible: true });

    indicator.setPlotStyle('upper', { lineWidth: 3 });
    indicator.setPlotStyle('upper', { lineStyle: 'dashed' });
    indicator.setPlotStyle('hist', { visible: false });
    expect(indicator.getPlotStyle('upper')).toEqual({ lineWidth: 3, lineStyle: 'dashed', visible: true });
    expect(indicator.plotStyles).toEqual({ upper: { lineWidth: 3, lineStyle: 'dashed' }, hist: { visible: false } });
  });

  it('keeps only what differs from the definition, and null puts a plot back', () => {
    const { indicator } = setup();
    indicator.setPlotStyle('mid', { lineWidth: 2, lineStyle: 'dotted', visible: true });
    expect(indicator.plotStyles).toEqual({});
    indicator.setPlotStyle('mid', { lineWidth: 4, visible: false });
    indicator.setPlotStyle('mid', { lineWidth: 2 });
    expect(indicator.plotStyles).toEqual({ mid: { visible: false } });
    indicator.setPlotStyle('mid', null);
    expect(indicator.plotStyles).toEqual({});
  });

  it('throws on an unknown plot, an invalid value and a line style for a histogram', () => {
    const { indicator } = setup();
    expect(() => indicator.setPlotStyle('nope', { visible: false })).toThrow(/no plot "nope"/);
    expect(() => indicator.setPlotStyle('upper', { lineWidth: 0 })).toThrow(/lineWidth/);
    expect(() => indicator.setPlotStyle('upper', { lineWidth: NaN })).toThrow(/lineWidth/);
    expect(() => indicator.setPlotStyle('upper', { lineStyle: 'wavy' as never })).toThrow(/lineStyle/);
    expect(() => indicator.setPlotStyle('upper', { visible: 'no' as never })).toThrow(/visible/);
    expect(() => indicator.setPlotStyle('hist', { lineWidth: 2 })).toThrow(/line plots only/);
    expect(indicator.plotStyles).toEqual({});
  });

  it('fires indicator:change only when a style changes', () => {
    const { c, indicator } = setup();
    const changes: Indicator[] = [];
    c.on('indicator:change', (e) => changes.push(e.indicator));
    indicator.setPlotStyle('upper', { lineWidth: 1.5 });
    expect(changes).toEqual([]);
    indicator.setPlotStyle('upper', { lineWidth: 3 });
    indicator.setPlotStyle('upper', { lineWidth: 3 });
    expect(changes).toEqual([indicator]);
  });

  it('saves the styles, keeps them through input changes, copies and restores', () => {
    const { c, indicator } = setup();
    indicator.setPlotStyle('lower', { lineStyle: 'dashed', visible: false });
    indicator.applyInputs({ width: 10 });
    expect(indicator.plotStyles).toEqual({ lower: { lineStyle: 'dashed', visible: false } });
    const state = indicator.serialize();
    expect(state.plotStyles).toEqual({ lower: { lineStyle: 'dashed', visible: false } });
    // The saved copy is not the live one.
    state.plotStyles!.lower!.visible = true;
    expect(indicator.plotStyles.lower!.visible).toBe(false);

    const copy = c.indicators.duplicate(indicator);
    expect(copy.plotStyles).toEqual({ lower: { lineStyle: 'dashed', visible: false } });

    c.indicators.load([indicator.serialize()]);
    expect(c.indicators.getAll()[0]!.plotStyles).toEqual({ lower: { lineStyle: 'dashed', visible: false } });
    expect(c.indicators.getAll()[0]!.series!.legend(5).parts.map((p) => p.label ?? '')).toEqual(['Upper', '', '']);
  });

  it('drops saved styles that do not fit: invalid values, unknown plots, line styles of histograms, the defaults', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles().setData(bars);
    c.indicators.register(def);
    c.indicators.load([
      {
        type: 'test/bands',
        inputs: {},
        pane: 0,
        visible: true,
        plotStyles: {
          upper: { lineWidth: -1, lineStyle: 'dashed', visible: 'yes' },
          mid: { lineWidth: 2, lineStyle: 'dotted' },
          hist: { lineWidth: 3, visible: false },
          gone: { visible: false },
          bad: 'x',
        },
      },
    ]);
    expect(c.indicators.getAll()[0]!.plotStyles).toEqual({ upper: { lineStyle: 'dashed' }, hist: { visible: false } });
    c.indicators.load([{ type: 'test/bands', inputs: {}, pane: 0, visible: true, plotStyles: [1] }]);
    expect(c.indicators.getAll()[0]!.serialize().plotStyles).toBeUndefined();
  });

  it('keeps styles set while pending, and checks them once the definition registers', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles().setData(bars);
    c.indicators.load([{ type: 'test/bands', inputs: {}, pane: 0, visible: true }]);
    const pending = c.indicators.getAll()[0]!;
    expect(pending.getPlotStyle('upper')).toBeNull();
    pending.setPlotStyle('upper', { lineWidth: 4 });
    pending.setPlotStyle('gone', { visible: false });
    expect(() => pending.setPlotStyle('upper', { lineWidth: -2 })).toThrow(/lineWidth/);
    expect(pending.serialize().plotStyles).toEqual({ upper: { lineWidth: 4 }, gone: { visible: false } });
    c.indicators.register(def);
    expect(pending.plotStyles).toEqual({ upper: { lineWidth: 4 } });
    c.indicators.unregister(def.id);
    expect(pending.serialize().plotStyles).toEqual({ upper: { lineWidth: 4 } });
  });

  it('strokes line plots with their styles on the canvas, and leaves hidden plots and their fills out', () => {
    const { c, indicator } = setup();
    const { ctx, calls } = recorder();
    frame(c, ctx);
    expect(strokes(calls).map((s) => [s.color, s.lineWidth])).toEqual([
      ['#ff0000', 1.5],
      ['#00ff00', 2],
      ['#0000ff', 1.5],
    ]);
    expect(calls.filter((call) => call.name === 'fill' && String(call.color).startsWith('rgba(1, 2, 3')).length).toBe(1);

    indicator.setPlotStyle('upper', { lineWidth: 3, lineStyle: 'dashed' });
    indicator.setPlotStyle('lower', { visible: false });
    calls.length = 0;
    frame(c, ctx);
    const drawn = strokes(calls);
    expect(drawn.map((s) => [s.color, s.lineWidth])).toEqual([
      ['#ff0000', 3],
      ['#00ff00', 2],
    ]);
    expect(drawn[0]!.dash.length).toBe(2);
    expect(calls.filter((call) => call.name === 'fill' && String(call.color).startsWith('rgba(1, 2, 3')).length).toBe(0);
  });

  it('leaves hidden plots out of autoscale, the legend and the price-axis labels', () => {
    const { indicator } = setup();
    const series = indicator.series!;
    expect(series.priceRange(0, 59)).toEqual([0, 120]);
    expect(series.lastValues().length).toBe(4);
    indicator.setPlotStyle('upper', { visible: false });
    indicator.setPlotStyle('hist', { visible: false });
    expect(series.priceRange(0, 59)).toEqual([80, 100]);
    expect(series.legend(5).parts.map((p) => p.label ?? '')).toEqual(['', 'Lower']);
    expect(series.lastValues().map((l) => l.value)).toEqual([100, 80]);
  });

  it('hit-tests shown plots: lines near their value, histograms from base to value', () => {
    const { c, indicator } = setup();
    frame(c);
    const pane = c.panes[0]!;
    const x = c.plotLeft + c.time.indexToX(30);
    const yOf = (price: number) => pane.top + indicator.series!.scale.priceToY(price);
    expect(c.seriesAt(x, yOf(120))).toBe(indicator.series);
    expect(c.seriesAt(x, yOf(120) + 20)).not.toBe(indicator.series);
    expect(c.seriesAt(x, yOf(2))).toBe(indicator.series);
    indicator.setPlotStyle('upper', { visible: false });
    expect(c.seriesAt(x, yOf(120))).toBeNull();
  });
});
