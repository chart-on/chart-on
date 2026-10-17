import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { IndicatorDef } from '../src/indicators/types';
import type { Primitive } from '../src/primitives';
import type { CustomSeriesDef, Series } from '../src/series';
import type { PriceScale } from '../src/scales';

/**
 * Every `RangeBuilder` is counted. With `fresh` on, `reset` hands back a new
 * builder instead of clearing the owner's: the behaviour before builders were
 * reused, used as the reference the reusing code must match.
 */
const builders = vi.hoisted(() => ({ made: 0, resets: 0, fresh: false }));

vi.mock('../src/scales', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/scales')>();
  class CountingRangeBuilder extends actual.RangeBuilder {
    constructor(positiveOnly?: boolean) {
      super(positiveOnly);
      builders.made++;
    }

    override reset(positiveOnly: boolean): this {
      builders.resets++;
      if (builders.fresh) return new CountingRangeBuilder(positiveOnly) as this;
      return super.reset(positiveOnly);
    }
  }
  return { ...actual, RangeBuilder: CountingRangeBuilder };
});

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  builders.fresh = false;
  vi.restoreAllMocks();
});

const N = 300;
const MIN = 60;
const bars = Array.from({ length: N }, (_, i) => {
  const close = 100 + 40 * Math.sin(i / 17) + (i % 9);
  return { time: i * MIN, open: close - 2, high: close + 3 + (i % 5), low: close - 4, close, volume: 1000 + ((i * 37) % 500) };
});
const points = (f: (i: number) => number) => Array.from({ length: N }, (_, i) => ({ time: i * MIN, value: f(i) }));

const avgDef: IndicatorDef = {
  id: 'avg',
  name: 'Avg',
  placement: 'pane',
  inputs: [],
  plots: [{ id: 'v', type: 'line' }],
  compute: (src) => ({ v: Float64Array.from(src.close, (c) => c - 100) }),
};

interface Band {
  time: number;
  lower: number;
  upper: number;
}

const bandDef: CustomSeriesDef<Band, object> = {
  type: 'band',
  defaultOptions: {},
  priceRange: (p) => [p.lower, p.upper],
  draw: () => {},
  legend: () => [],
  lastValue: (p) => ({ value: p.upper }),
};

function chart(): Chart {
  const c = new Chart(fakeContainer(), { timezone: 'UTC', smoothScale: false });
  charts.push(c);
  return c;
}

/** Run one frame's scene work; frames never run on their own under the fake DOM. */
function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

/** A chart with every kind of series, two panes, an indicator pane and primitives on a series and a pane. */
function busyChart(): Chart {
  const c = chart();
  const main = c.addCandles();
  main.setData(bars);
  c.addLine({ priceScale: 'left' }).setData(points((i) => 50 + (i % 13)));
  c.addCustomSeries(bandDef).setData(bars.map((b) => ({ time: b.time, lower: b.low - 5, upper: b.high + 5 })));
  const lower = c.addPane();
  c.addHistogram({}, lower).setData(bars.map((b) => ({ time: b.time, value: b.volume })));
  c.indicators.add(avgDef);
  c.attachPrimitive({ priceRange: () => [80, 160] }, { series: main });
  c.attachPrimitive({ priceRange: () => [0, 2000] }, { pane: lower });
  return c;
}

/** Every price scale's fitted range and autoscale outputs, pane by pane. */
function scaleState(c: Chart) {
  return c.panes.map((pane) => {
    const scales = new Set<PriceScale>(pane.scales);
    for (const s of pane.series) scales.add(s.scale);
    return [...scales].map((s) => ({ id: s.id, min: s.min, max: s.max, mode: s.mode, base: s.percentBase, noPositiveData: s.noPositiveData }));
  });
}

/** Fit `setup`'s chart over several visible ranges; the scale state after each fit. */
function fits(setup: () => Chart) {
  const c = setup();
  const states = [];
  for (const [from, to] of [[0, N - 1], [10, 60], [120, 260], [200, 299], [0, N - 1]] as const) {
    c.setVisibleIndexRange(from, to, false);
    frame(c);
    states.push(scaleState(c));
  }
  return states;
}

/** `fits` with reused builders matches `fits` with a fresh builder per range. */
function expectParity(setup: () => Chart): void {
  builders.fresh = true;
  const reference = fits(setup);
  builders.fresh = false;
  const reused = fits(setup);
  expect(reused).toEqual(reference);
  // The reference really did build fresh ranges and the scales really moved.
  expect(new Set(reference.map((s) => JSON.stringify(s))).size).toBeGreaterThan(1);
}

describe('autoscale range builders', () => {
  it('makes no RangeBuilder once warmed up, and resets each series builder once per frame', () => {
    const c = busyChart();
    frame(c);
    frame(c);
    const series = c.panes.flatMap((p) => p.series as Series[]);
    const owned = series.map((s) => (s as unknown as { rangeBuilder: object }).rangeBuilder);
    const resets = owned.map((b) => vi.spyOn(b as { reset(p: boolean): unknown }, 'reset'));
    const made = builders.made;

    const frames = 6;
    for (let k = 0; k < frames; k++) {
      c.setVisibleIndexRange(k * 10, 150 + k * 20, false);
      frame(c);
    }

    expect(builders.made).toBe(made);
    expect(series.map((s) => (s as unknown as { rangeBuilder: object }).rangeBuilder)).toEqual(owned);
    for (const spy of resets) expect(spy).toHaveBeenCalledTimes(frames);
  });

  it('groups primitives by pane and lets go of a removed pane', () => {
    const c = busyChart();
    frame(c);
    const byPane = (c as unknown as { panePrimitives: Map<unknown, unknown[]> }).panePrimitives;
    const lower = c.panes[1]!;
    expect([...byPane.keys()]).toEqual([c.panes[0], lower]);
    c.removePane(lower);
    frame(c);
    expect([...byPane.keys()]).toEqual([c.panes[0]]);
  });

  it('matches fresh builders across panes', () => {
    expectParity(busyChart);
  });

  it.each(['percent', 'indexed'] as const)('matches fresh builders in %s mode, base included', (mode) => {
    expectParity(() => {
      const c = chart();
      c.addLine().setData(points((i) => 80 + (i % 11)));
      c.addCandles().setData(bars);
      c.addLine().setData(points((i) => 120 - (i % 7)));
      c.setPriceScaleMode(mode);
      return c;
    });
  });

  it('matches fresh builders on linked compare scales', () => {
    expectParity(() => {
      const c = chart();
      const pane = c.panes[0]!;
      c.addCandles().setData(bars);
      for (const id of ['cmp:a', 'cmp:b']) {
        c.addLine({ priceScale: id }).setData(points((i) => (id === 'cmp:a' ? 20 + (i % 17) : 500 - 3 * (i % 23))));
        const scale = pane.scale(id);
        scale.side = 'none';
        scale.link = pane.price;
      }
      c.setPriceScaleMode('percent');
      return c;
    });
  });

  it('matches fresh builders on a log scale with non-positive values and primitives', () => {
    expectParity(() => {
      const c = chart();
      // The main bars, on their own scale, set the time axis.
      c.addCandles({ priceScale: 'left' }).setData(bars);
      const line = c.addLine();
      line.setData(points((i) => (i % 10 === 0 ? -5 : i % 25 === 0 ? 0 : 1 + i / 2)));
      const onSeries: Primitive = { priceRange: (from) => (from > 100 ? [-20, 75] : [0.5, 60]) };
      c.attachPrimitive(onSeries, { series: line });
      c.attachPrimitive({ priceRange: () => [-1, 0.25] }, {});
      c.setPriceScaleMode('log');
      return c;
    });
  });
});
