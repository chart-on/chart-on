import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import { PriceScale } from '../src/scales';
import type { IndicatorDef } from '../src/indicators/types';
import type { SeriesErrorEvent } from '../src/series';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

const N = 50;
const times = Array.from({ length: N }, (_, i) => i * 60);
const bars: Bar[] = times.map((time, i) => ({ time, open: 15, high: 20 - (i % 2), low: 10 + (i % 2), close: 15 }));
const points = (value: (i: number) => number) => times.map((time, i) => ({ time, value: value(i) }));

/** A chart with candles from 10 to 20 on the right scale, no margins and no easing, so ranges are exact. */
function chart(options: ChartOptionsPatch = {}): Chart {
  const c = new Chart(fakeContainer(), { timezone: 'UTC', smoothScale: false, ...options });
  charts.push(c);
  c.addCandles().setData(bars);
  c.setPriceScaleOptions({ marginTop: 0, marginBottom: 0 });
  return c;
}

/** Run one frame's scene work; frames never run on their own under the fake DOM. */
function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

function range(c: Chart, pane = 0): [number, number] {
  frame(c);
  const r = c.getPriceRange(pane)!;
  return [r.from, r.to];
}

function expectRange(actual: [number, number], from: number, to: number): void {
  expect(actual[0]).toBeCloseTo(from, 9);
  expect(actual[1]).toBeCloseTo(to, 9);
}

describe('series autoscale option', () => {
  it('false leaves the series out of the fit, and it can be switched by applyOptions', () => {
    const c = chart();
    const far = c.addLine({ autoscale: false });
    far.setData(points(() => 1000));
    expectRange(range(c), 10, 20);
    far.applyOptions({ autoscale: true });
    expectRange(range(c), 10, 1000);
    far.applyOptions({ autoscale: false });
    expectRange(range(c), 10, 20);
  });

  it('false on every series of a scale keeps its last range', () => {
    const c = chart();
    c.main!.applyOptions({ autoscale: false });
    const before = c.getPriceScaleOptions()!;
    frame(c);
    const r = c.getPriceRange()!;
    c.main!.setData(bars.map((b) => ({ ...b, high: 500 })));
    expect(c.getPriceRange()).toEqual(r);
    expect(c.getPriceScaleOptions()).toEqual(before);
  });

  it('a function adjusts the range: here widened by a margin', () => {
    const c = chart();
    const provider = vi.fn((r: { low: number; high: number } | null) => r && { low: r.low - 5, high: r.high + 5 });
    c.addLine({ autoscale: provider }).setData(points((i) => 30 + (i % 3)));
    expectRange(range(c), 10, 37);
    const [given, context] = provider.mock.calls.at(-1)! as unknown as [unknown, { mode: string; from: number; to: number }];
    expect(given).toEqual({ low: 30, high: 32 });
    expect(context.mode).toBe('normal');
    expect(context.to).toBeGreaterThan(context.from);
  });

  it('a function returning null or a non-finite range adds nothing', () => {
    const c = chart();
    const line = c.addLine({ autoscale: () => null });
    line.setData(points(() => 1000));
    expectRange(range(c), 10, 20);
    line.applyOptions({ autoscale: () => ({ low: NaN, high: 2000 }) });
    expectRange(range(c), 10, 20);
  });

  it('a throwing function is reported once as an autoscale hook error and the series fits its values meanwhile', () => {
    const c = chart();
    const errors: SeriesErrorEvent[] = [];
    c.on('series:error', (e) => errors.push(e));
    const line = c.addLine({
      autoscale: () => {
        throw new Error('boom');
      },
    });
    line.setData(points(() => 40));
    expectRange(range(c), 10, 40);
    frame(c);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.hook).toBe('autoscale');
    expect(errors[0]!.series).toBe(line);
  });

  it('works on histogram and custom series', () => {
    const c = chart();
    c.addHistogram({ autoscale: false }).setData(points(() => 900));
    c.addCustomSeries(
      { type: 'dot', defaultOptions: {}, priceRange: (d: { time: number; v: number }) => [d.v, d.v], draw: () => {} },
      { autoscale: (r) => r && { low: r.low, high: r.high * 2 } },
    ).setData(times.map((time) => ({ time, v: 25 })));
    expectRange(range(c), 10, 50);
  });
});

describe('price scale autoscaleRule', () => {
  it('centerOn keeps a value in the middle with asymmetric data', () => {
    const c = chart();
    const pane = c.addPane();
    c.addHistogram({}, pane).setData(points((i) => (i % 2 ? 10 : -2)));
    c.setPriceScaleOptions({ marginTop: 0, marginBottom: 0, autoscaleRule: { centerOn: 0 } }, 1);
    expectRange(range(c, 1), -10, 10);
  });

  it('minSpan widens flat data around its middle', () => {
    const c = chart();
    c.main!.applyOptions({ autoscale: false });
    c.addLine().setData(points(() => 100));
    c.setPriceScaleOptions({ autoscaleRule: { minSpan: 10 } });
    expectRange(range(c), 95, 105);
  });

  it('include reaches the listed prices', () => {
    const c = chart();
    c.setPriceScaleOptions({ autoscaleRule: { include: [0, 25] } });
    expectRange(range(c), 0, 25);
  });

  it('on a log scale, include skips values at or below zero and centerOn centres on a ratio', () => {
    const c = chart();
    c.setPriceScaleOptions({ mode: 'log', autoscaleRule: { include: [0, -3, 100] } });
    expectRange(range(c), 10, 100);
    c.setPriceScaleOptions({ autoscaleRule: { centerOn: 40 } });
    // 10 is 4× below 40, so the top is 4× above.
    expectRange(range(c), 10, 160);
  });

  it('minSpan on a log scale widens upwards rather than reaching zero', () => {
    const c = chart();
    c.setPriceScaleOptions({ mode: 'log', autoscaleRule: { minSpan: 100 } });
    expectRange(range(c), 10, 110);
  });

  it('applies include, then minSpan, then centerOn', () => {
    const c = chart();
    c.setPriceScaleOptions({ autoscaleRule: { include: [22], minSpan: 20, centerOn: 0 } });
    // Data 10..20, include 22 gives 10..22, minSpan widens to 6..26, centred on 0 gives -26..26.
    expectRange(range(c), -26, 26);
  });

  it('a fixed range wins over the rule', () => {
    const c = chart();
    c.setPriceScaleOptions({ fixedRange: { min: 0, max: 5 }, autoscaleRule: { include: [100] } });
    expectRange(range(c), 0, 5);
  });

  it('changes the collected range in place, without a new array', () => {
    const scale = new PriceScale({ marginTop: 0, marginBottom: 0 });
    scale.autoscaleRule = { include: [0], minSpan: 50, centerOn: 1 };
    const r: [number, number] = [10, 20];
    scale.applyRule(r);
    // include: 0..20, minSpan: -15..35, centerOn: 1 ± 34.
    expect(r).toEqual([-33, 35]);
  });

  it('is validated, copied and reported by getPriceScaleOptions', () => {
    const c = chart();
    expect(() => c.setPriceScaleOptions({ autoscaleRule: { minSpan: 0 } })).toThrow(RangeError);
    expect(() => c.setPriceScaleOptions({ autoscaleRule: { include: [1, NaN] } })).toThrow(/include/);
    expect(() => c.setPriceScaleOptions({ autoscaleRule: { centerOn: Infinity } })).toThrow(/centerOn/);
    expect(() => c.setPriceScaleOptions({ autoscaleRule: { center: 0 } as never })).toThrow(/unknown field/);
    const include = [1, 2];
    c.setPriceScaleOptions({ autoscaleRule: { include } });
    include.push(1000);
    const read = c.getPriceScaleOptions()!.autoscaleRule!;
    expect(read).toEqual({ include: [1, 2] });
    read.include!.push(2000);
    expect(c.getPriceScaleOptions()!.autoscaleRule).toEqual({ include: [1, 2] });
    c.setPriceScaleOptions({ autoscaleRule: null });
    expect(c.getPriceScaleOptions()!.autoscaleRule).toBeNull();
  });

  it('round-trips through a saved layout', () => {
    const c = chart();
    c.setPriceScaleOptions({ autoscaleRule: { centerOn: 15, minSpan: 4 } });
    const saved = JSON.parse(JSON.stringify(c.serializeLayout()));
    const d = chart();
    const result = d.loadLayout(saved);
    expect(result.errors).toEqual([]);
    expect(d.getPriceScaleOptions()!.autoscaleRule).toEqual({ centerOn: 15, minSpan: 4 });
  });
});

describe('indicator autoscaleRule', () => {
  const momentum: IndicatorDef = {
    id: 'momentum',
    name: 'Momentum',
    placement: 'pane',
    inputs: [],
    plots: [{ id: 'v', type: 'histogram' }],
    autoscaleRule: { centerOn: 0 },
    compute: (src) => ({ v: Float64Array.from(src.close, (_, i) => (i % 2 ? 8 : -1)) }),
  };

  it('sets the rule on the indicator pane scale', () => {
    const c = chart();
    c.indicators.add(momentum);
    expect(c.getPriceScaleOptions(1)!.autoscaleRule).toEqual({ centerOn: 0 });
    frame(c);
    const r = c.getPriceRange(1)!;
    expect(r.from).toBeCloseTo(-r.to, 9);
    expect(r.to).toBeGreaterThanOrEqual(8);
  });

  it('rejects an invalid rule or an overlay placement', () => {
    const c = chart();
    expect(() => c.indicators.add({ ...momentum, id: 'bad', autoscaleRule: { minSpan: -1 } })).toThrow(/autoscaleRule/);
    expect(() => c.indicators.add({ ...momentum, id: 'over', placement: 'overlay' })).toThrow(/placement 'pane'/);
  });
});
