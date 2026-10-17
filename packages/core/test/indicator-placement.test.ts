import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { IndicatorDef } from '../src/indicators/types';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
});

const bars = (n: number): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ time: i * 60, open: i, high: i + 1, low: i - 1, close: i }));

function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(bars(30));
  return c;
}

function def(placement: IndicatorDef['placement'], id = `test/${placement}`): IndicatorDef {
  return {
    id,
    name: 'Shifted close',
    description: 'The close moved up by one.',
    category: 'trend',
    aliases: ['Close plus one'],
    placement,
    inputs: [],
    plots: [{ id: 'value', type: 'line' }],
    compute: (src) => ({ value: src.close.map((v) => v + 1) }),
  };
}

interface El {
  className: string;
  title: string;
  textContent: string;
  children: El[];
}

const legendRows = (c: Chart) =>
  (c.root as unknown as El).children
    .filter((e) => e.className === 'pc-legend')
    .flatMap((block) => block.children.filter((e) => e.className === 'pc-legend-row'));

describe('indicator placement', () => {
  it("draws an 'either' definition on the price pane by default", () => {
    const c = chart();
    const indicator = c.indicators.add(def('either'));
    expect(indicator.placement).toBe('overlay');
    expect(c.panes.length).toBe(1);
    expect(indicator.pane).toBe(c.panes[0]);
  });

  it("puts an 'either' definition in a new pane when asked, and removes that pane with it", () => {
    const c = chart();
    const indicator = c.indicators.add(def('either'), {}, { placement: 'pane' });
    expect(indicator.placement).toBe('pane');
    expect(c.panes.length).toBe(2);
    expect(indicator.pane).toBe(c.panes[1]);
    indicator.remove();
    expect(c.panes.length).toBe(1);
  });

  it('ignores the placement option for fixed placements', () => {
    const c = chart();
    const overlay = c.indicators.add(def('overlay'), {}, { placement: 'pane' });
    const pane = c.indicators.add(def('pane'), {}, { placement: 'overlay' });
    expect(overlay.placement).toBe('overlay');
    expect(pane.placement).toBe('pane');
    expect(c.panes.length).toBe(2);
  });

  it('restores an either-placed indicator where it was saved', () => {
    const c = chart();
    const either = def('either');
    c.indicators.add(either, {}, { placement: 'pane' });
    c.indicators.add(either);
    const saved = c.indicators.serialize();
    expect(saved.map((s) => s.pane)).toEqual([1, 0]);

    const other = chart();
    other.indicators.register(either);
    other.indicators.load(saved);
    expect(other.indicators.getAll().map((i) => i.placement)).toEqual(['pane', 'overlay']);
    expect(other.panes.length).toBe(2);
  });

  it('adds two instances of one definition, each with its own legend row', () => {
    const c = chart();
    const either = def('either');
    const a = c.indicators.add(either);
    const b = c.indicators.add(either, {}, { placement: 'pane' });
    expect(a).not.toBe(b);
    expect(c.indicators.getAll()).toEqual([a, b]);
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
    // Main series, the overlay instance, and the instance in its own pane.
    expect(legendRows(c)).toHaveLength(3);
  });

  it('round-trips either-placed indicators through a saved layout', () => {
    const c = chart();
    const either = def('either');
    const oscillator = def('pane');
    c.indicators.add(oscillator);
    const inPane = c.indicators.add(either, {}, { placement: 'pane' });
    c.indicators.add(either);
    expect(c.panes.indexOf(inPane.pane!)).toBe(2);
    const saved = JSON.parse(JSON.stringify(c.serializeLayout()));

    const other = chart();
    other.indicators.register(either);
    other.indicators.register(oscillator);
    const result = other.loadLayout(saved);
    expect(result.errors).toEqual([]);
    const restored = other.indicators.getAll();
    expect(restored.map((i) => i.placement)).toEqual(['pane', 'pane', 'overlay']);
    expect(restored.map((i) => other.panes.indexOf(i.pane!))).toEqual([1, 2, 0]);
    expect(other.panes.length).toBe(3);
    // Loading again replaces them without leaving empty panes behind.
    other.loadLayout(saved);
    expect(other.panes.length).toBe(3);
    expect(other.indicators.getAll().map((i) => other.panes.indexOf(i.pane!))).toEqual([1, 2, 0]);
  });

  it('reports no placement while pending', () => {
    const c = chart();
    c.indicators.load([{ type: 'test/unknown', inputs: {}, pane: 1, visible: true }]);
    const [pending] = c.indicators.getAll();
    expect(pending!.pending).toBe(true);
    expect(pending!.placement).toBeNull();
    c.indicators.register(def('either', 'test/unknown'));
    expect(pending!.placement).toBe('pane');
  });
});
