import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { visibleAxes } from '../src/pane';
import { parseIndicatorStates } from '../src/indicators/state';
import { validateIndicatorDef } from '../src/indicators/indicator';
import type { IndicatorDef } from '../src/indicators/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
});

/** Closes 1000..1099 with volumes of 1e6 and more: a line in other units than price. */
function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(
    Array.from({ length: 100 }, (_, i) => ({ time: i * 60, open: 1000 + i, high: 1001 + i, low: 999 + i, close: 1000 + i, volume: 1e6 + i })),
  );
  return c;
}

function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
}

/** An overlay plotting the volume, far outside the price range. */
function volumeLine(overrides: Partial<IndicatorDef> = {}): IndicatorDef {
  return {
    id: 'test/volume-line',
    name: 'Volume line',
    placement: 'overlay',
    inputs: [],
    plots: [{ id: 'value', type: 'line' }],
    compute: (src) => ({ value: Float64Array.from(src.volume) }),
    ...overrides,
  };
}

const axisIds = (c: Chart) => visibleAxes(c.panes[0]!).map((s) => s.id ?? 'right');

describe('indicator price scale', () => {
  it('draws on the main series scale by default, as before', () => {
    const c = chart();
    const before = (frame(c), c.getPriceRange(0));
    const indicator = c.indicators.add(volumeLine({ compute: (src) => ({ value: Float64Array.from(src.close) }) }));
    frame(c);
    expect(indicator.priceScale).toBe('right');
    expect(indicator.series!.scale).toBe(c.panes[0]!.price);
    expect(c.getPriceRange(0)).toEqual(before);
    expect(axisIds(c)).toEqual(['right']);
    expect(indicator.serialize()).not.toHaveProperty('priceScale');
  });

  it("draws on the left scale the definition names, showing the left axis while it is there", () => {
    const c = chart();
    frame(c);
    const price = c.getPriceRange(0);
    expect(c.priceAxisSpace('left')).toBe(0);
    const indicator = c.indicators.add(volumeLine({ priceScale: 'left' }));
    frame(c);
    expect(indicator.priceScale).toBe('left');
    expect(indicator.series!.scale).toBe(c.panes[0]!.scale('left'));
    expect(axisIds(c)).toEqual(['left', 'right']);
    expect(c.priceAxisSpace('left')).toBeGreaterThan(0);
    // The candles keep their range; the volume fits the left scale.
    expect(c.getPriceRange(0)).toEqual(price);
    expect(c.getPriceRange(0, 'left')!.to).toBeGreaterThan(1e6);
    // Its labels use its own format, not the candles' prices.
    expect(indicator.series!.formatValue(1_500_000)).toBe('1.5M');

    indicator.setVisible(false);
    frame(c);
    expect(axisIds(c)).toEqual(['right']);
    indicator.setVisible(true);
    frame(c);
    expect(axisIds(c)).toEqual(['left', 'right']);

    indicator.remove();
    frame(c);
    expect(axisIds(c)).toEqual(['right']);
    expect(c.priceAxisSpace('left')).toBe(0);
  });

  it('keeps the left axis while another indicator still uses it', () => {
    const c = chart();
    const a = c.indicators.add(volumeLine({ priceScale: 'left' }));
    const b = c.indicators.add(volumeLine({ id: 'test/other', priceScale: 'left' }));
    a.remove();
    frame(c);
    expect(axisIds(c)).toEqual(['left', 'right']);
    b.remove();
    frame(c);
    expect(axisIds(c)).toEqual(['right']);
  });

  it('draws on a scale of its own with no axis', () => {
    const c = chart();
    frame(c);
    const price = c.getPriceRange(0);
    const indicator = c.indicators.add(volumeLine({ priceScale: 'test/own' }));
    frame(c);
    expect(indicator.series!.scale).toBe(c.panes[0]!.scale('test/own'));
    expect(axisIds(c)).toEqual(['right']);
    expect(c.getPriceRange(0)).toEqual(price);
    expect(c.getPriceRange(0, 'test/own')!.to).toBeGreaterThan(1e6);
  });

  it('lets add override the definition per indicator', () => {
    const c = chart();
    const left = c.indicators.add(volumeLine(), {}, { priceScale: 'left' });
    const right = c.indicators.add(volumeLine({ id: 'test/to-right', priceScale: 'left' }), {}, { priceScale: 'right' });
    frame(c);
    expect(left.priceScale).toBe('left');
    expect(left.series!.scale).toBe(c.panes[0]!.scale('left'));
    expect(right.priceScale).toBe('right');
    expect(right.series!.scale).toBe(c.panes[0]!.price);
    expect(() => c.indicators.add('test/volume-line', {}, { priceScale: '' })).toThrow(/priceScale/);
    expect(() => c.indicators.add('test/volume-line', {}, { priceScale: 5 as never })).toThrow(/priceScale/);
    // A rejected add registers nothing.
    expect(() => c.indicators.add(volumeLine({ id: 'test/rejected' }), {}, { priceScale: '' })).toThrow(/priceScale/);
    expect(c.indicators.getDefinitions().some((d) => d.id === 'test/rejected')).toBe(false);
  });

  it('keeps the override when the state is saved and restored', () => {
    const c = chart();
    c.indicators.add(volumeLine(), {}, { priceScale: 'left' });
    const saved = JSON.parse(JSON.stringify(c.indicators.serialize()));
    expect(saved[0].priceScale).toBe('left');

    const other = chart();
    other.indicators.register(volumeLine());
    other.indicators.load(saved);
    frame(other);
    const restored = other.indicators.getAll()[0]!;
    expect(restored.priceScale).toBe('left');
    expect(restored.series!.scale).toBe(other.panes[0]!.scale('left'));
    expect(axisIds(other)).toEqual(['left', 'right']);
    expect(restored.serialize().priceScale).toBe('left');
  });

  it('keeps the override through a saved layout and while pending', () => {
    const c = chart();
    c.indicators.add(volumeLine(), {}, { priceScale: 'left' });
    const layout = JSON.parse(JSON.stringify(c.serializeLayout()));

    const other = chart();
    other.loadLayout(layout);
    const pending = other.indicators.getAll()[0]!;
    expect(pending.pending).toBe(true);
    expect(pending.serialize().priceScale).toBe('left');
    other.indicators.register(volumeLine());
    frame(other);
    expect(pending.series!.scale).toBe(other.panes[0]!.scale('left'));
  });

  it('validates the scale id in definitions and saved state', () => {
    expect(() => validateIndicatorDef(volumeLine({ priceScale: 'left' }))).not.toThrow();
    expect(() => validateIndicatorDef(volumeLine({ priceScale: '' }))).toThrow(/priceScale/);
    expect(() => validateIndicatorDef(volumeLine({ priceScale: 1 as never }))).toThrow(/priceScale/);
    const [kept, dropped] = parseIndicatorStates([
      { type: 'a', inputs: {}, priceScale: 'left' },
      { type: 'b', inputs: {}, priceScale: 7 },
    ]);
    expect(kept!.priceScale).toBe('left');
    expect(dropped).not.toHaveProperty('priceScale');
  });
});

describe('Indicator.setPriceScale', () => {
  it('moves the plots between the right, left and an own scale at runtime', () => {
    const c = chart();
    frame(c);
    const price = c.getPriceRange(0);
    const indicator = c.indicators.add(volumeLine());
    const changes: unknown[] = [];
    c.on('indicator:change', (e) => changes.push(e.indicator));
    frame(c);
    const onPrice = indicator.series!.formatValue(1_500_000);
    expect(onPrice).not.toBe('1.5M');

    indicator.setPriceScale('left');
    frame(c);
    expect(indicator.priceScale).toBe('left');
    expect(indicator.series!.scale).toBe(c.panes[0]!.scale('left'));
    expect(axisIds(c)).toEqual(['left', 'right']);
    expect(c.priceAxisSpace('left')).toBeGreaterThan(0);
    expect(c.getPriceRange(0, 'left')!.to).toBeGreaterThan(1e6);
    // Off the price scale, its labels use its own format.
    expect(indicator.series!.formatValue(1_500_000)).toBe('1.5M');
    expect(changes).toEqual([indicator]);
    expect(indicator.serialize().priceScale).toBe('left');

    indicator.setPriceScale('test/own');
    frame(c);
    expect(indicator.series!.scale).toBe(c.panes[0]!.scale('test/own'));
    expect(axisIds(c)).toEqual(['right']);
    expect(c.priceAxisSpace('left')).toBe(0);
    expect(c.getPriceRange(0)).toEqual(price);

    indicator.setPriceScale('right');
    frame(c);
    expect(indicator.series!.scale).toBe(c.panes[0]!.price);
    expect(indicator.series!.formatValue(1_500_000)).toBe(onPrice);
    expect(indicator.serialize().priceScale).toBe('right');
    expect(changes).toHaveLength(3);
  });

  it('ignores the scale it is on and rejects empty ids', () => {
    const c = chart();
    const indicator = c.indicators.add(volumeLine({ priceScale: 'left' }));
    let changes = 0;
    c.on('indicator:change', () => changes++);
    indicator.setPriceScale('left');
    expect(changes).toBe(0);
    expect(() => indicator.setPriceScale('')).toThrow(/priceScale/);
    expect(() => indicator.setPriceScale(3 as never)).toThrow(/priceScale/);
    expect(indicator.priceScale).toBe('left');
  });

  it('keeps the scale through a saved layout', () => {
    const c = chart();
    c.indicators.add(volumeLine()).setPriceScale('left');
    const layout = JSON.parse(JSON.stringify(c.serializeLayout()));

    const other = chart();
    other.indicators.register(volumeLine());
    other.loadLayout(layout);
    frame(other);
    const restored = other.indicators.getAll()[0]!;
    expect(restored.priceScale).toBe('left');
    expect(axisIds(other)).toEqual(['left', 'right']);
  });

  it('keeps a scale set while pending and uses it once registered', () => {
    const c = chart();
    c.indicators.add(volumeLine({ priceScale: 'left' }));
    const saved = JSON.parse(JSON.stringify(c.indicators.serialize()));

    const other = chart();
    other.indicators.load(saved);
    const pending = other.indicators.getAll()[0]!;
    let changes = 0;
    other.on('indicator:change', () => changes++);
    // The definition's 'left' is unknown while pending, so 'right' is an override, not a no-op.
    pending.setPriceScale('right');
    expect(changes).toBe(1);
    expect(pending.serialize().priceScale).toBe('right');
    other.indicators.register(volumeLine({ priceScale: 'left' }));
    frame(other);
    expect(pending.priceScale).toBe('right');
    expect(pending.series!.scale).toBe(other.panes[0]!.price);
  });

  it("takes a pane indicator's fixed range along while it has the pane to itself", () => {
    const c = chart();
    const oscillator = c.indicators.add({
      ...volumeLine({ id: 'test/oscillator', placement: 'pane' }),
      fixedRange: { min: 0, max: 100 },
    });
    oscillator.setPriceScale('left');
    frame(c);
    const pane = c.panes.indexOf(oscillator.pane!);
    expect(c.getPriceScaleOptions(pane, 'left')?.fixedRange).toEqual({ min: 0, max: 100 });

    // In the price pane the candles own the scales: no range is forced on them.
    c.moveSeries(oscillator.series!, c.panes[0]!);
    oscillator.setPriceScale('right');
    frame(c);
    expect(c.getPriceScaleOptions(0, 'right')?.fixedRange ?? null).toBeNull();
  });
});

describe('scales made for an indicator', () => {
  const ids = (c: Chart, pane = 0) => c.panes[pane]!.scales.map((s) => s.id ?? 'right');

  it('drops a scale of its own once the indicator moves off it', () => {
    const c = chart();
    const indicator = c.indicators.add(volumeLine());
    indicator.setPriceScale('own-1');
    expect(ids(c)).toContain('own-1');
    indicator.setPriceScale('right');
    expect(ids(c)).not.toContain('own-1');
    // Going back makes a fresh one; the left scale is a fixed one and stays.
    indicator.setPriceScale('own-1');
    indicator.setPriceScale('left');
    indicator.setPriceScale('right');
    expect(ids(c)).toEqual(['right', 'left']);
    expect(Object.keys(c.serializeLayout().panes?.[0]?.scales ?? {})).toEqual(['right', 'left']);
  });

  it('keeps a scale another series still uses', () => {
    const c = chart();
    const a = c.indicators.add(volumeLine({ priceScale: 'own-1' }));
    const b = c.indicators.duplicate(a);
    expect(b.series!.scale).toBe(a.series!.scale);
    a.setPriceScale('right');
    expect(ids(c)).toContain('own-1');
    b.remove();
    expect(ids(c)).not.toContain('own-1');
  });

  it('drops it when the indicator is removed, and moves it along to another pane', () => {
    const c = chart();
    const a = c.indicators.add(volumeLine({ priceScale: 'own-1' }));
    c.addPane();
    c.moveSeries(a.series!, c.panes[1]!);
    expect(ids(c)).not.toContain('own-1');
    expect(ids(c, 1)).toContain('own-1');
    const pane = c.panes[1]!;
    c.addLine({}, pane);
    a.remove();
    expect(pane.scales.map((s) => s.id)).not.toContain('own-1');
  });

  it('leaves alone a scale the app set up before the indicator used it', () => {
    const c = chart();
    c.setPriceScaleOptions({ invert: true }, 0, 'mine');
    const indicator = c.indicators.add(volumeLine({ priceScale: 'mine' }));
    indicator.setPriceScale('right');
    expect(ids(c)).toContain('mine');
    expect(c.getPriceScaleOptions(0, 'mine')?.invert).toBe(true);
    // App series on a scale they asked for keep it too, as before.
    const line = c.addLine({ priceScale: 'app' });
    frame(c);
    c.removeSeries(line);
    expect(ids(c)).toContain('app');
  });
});
