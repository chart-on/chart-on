import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { drawingTools, indicators } from '../src/builtins';
import type { IndicatorDef } from '../src/indicators/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 12, low: 8, close: 10 + (i % 5) }));
const line = (value: number) => (src: { close: ArrayLike<number> }) => ({ v: new Float64Array(src.close.length).fill(value) });

const osc: IndicatorDef = {
  id: 'test/osc',
  name: 'Osc',
  placement: 'pane',
  inputs: [{ id: 'length', type: 'number', default: 14, min: 1 }],
  plots: [{ id: 'v', type: 'line' }],
  compute: line(5),
};
const avg: IndicatorDef = { ...osc, id: 'test/avg', name: 'Avg', placement: 'overlay', compute: line(10) };

function chart(options: { smoothScale?: boolean } = {}) {
  const c = new Chart(fakeContainer(), { plugins: [indicators(), drawingTools()], ...options });
  charts.push(c);
  c.addCandles().setData(bars);
  c.indicators.register(osc);
  c.indicators.register(avg);
  return c;
}

/** A horizontal line on pane `pane`, tied to `indicator` when given. */
const hline = (c: Chart, pane: number, indicator?: string) =>
  c.drawings.add({ type: 'hline', pane, points: [{ time: 600, price: 5 }], style: {}, ...(indicator ? { indicator } : {}) });

/** Whether drawing `id` shows: only shown drawings can be selected. */
function shown(c: Chart, id: string): boolean {
  c.drawings.select(id);
  const selected = c.drawings.selection.includes(id);
  c.drawings.select(null);
  return selected;
}

describe('indicator ids', () => {
  it('are unique per chart, saved, and new for copies and sets', () => {
    const c = chart();
    const a = c.indicators.add('test/osc');
    const b = c.indicators.add('test/avg');
    expect([a.id, b.id]).toEqual(['ind-1', 'ind-2']);
    expect(c.indicators.duplicate(a).id).toBe('ind-3');
    expect(c.indicators.getById('ind-2')).toBe(b);
    expect(c.indicators.serialize().map((s) => s.id)).toEqual(['ind-1', 'ind-2', 'ind-3']);
    const set = c.indicators.serializeSet();
    expect(set.indicators.some((s) => 'id' in s)).toBe(false);
    const added = c.indicators.applySet(set, { replace: false }).added;
    expect(added).toEqual([]);
    c.indicators.applySet(set);
    expect(c.indicators.getAll().map((i) => i.id)).toEqual(['ind-4', 'ind-5', 'ind-6']);
  });

  it('are kept by load; missing or repeated ones are replaced, and new ids come after the loaded ones', () => {
    const c = chart();
    const state = { type: 'test/avg', inputs: {}, pane: 0, visible: true };
    c.indicators.load([
      { ...state, id: 'ind-7' },
      { ...state, id: 'ind-7' },
      { ...state, id: 'mine' },
      state,
      { ...state, id: 42 },
    ]);
    expect(c.indicators.getAll().map((i) => i.id)).toEqual(['ind-7', 'ind-8', 'mine', 'ind-9', 'ind-10']);
    expect(c.indicators.add('test/avg').id).toBe('ind-11');
  });
});

describe('drawings tied to an indicator', () => {
  it('save the tie and report it as a flags change', () => {
    const c = chart();
    const ind = c.indicators.add('test/osc');
    const d = hline(c, 1);
    const changes: string[][] = [];
    c.on('drawing:update', (e) => changes.push(e.changes));
    c.drawings.update(d.id, { indicator: ind.id });
    expect(c.drawings.getById(d.id)!.indicator).toBe(ind.id);
    expect(c.drawings.serialize().drawings[0]!.indicator).toBe(ind.id);
    c.drawings.update(d.id, { indicator: '' });
    expect(c.drawings.getById(d.id)!.indicator).toBeUndefined();
    expect(changes).toEqual([['flags'], ['flags']]);
    expect(() => c.drawings.update(d.id, { indicator: 3 as unknown as string })).toThrow(/indicator/);
  });

  it('show only while the indicator shows', () => {
    const c = chart();
    const ind = c.indicators.add('test/osc');
    const d = hline(c, 1, ind.id);
    expect(shown(c, d.id)).toBe(true);
    ind.setVisible(false);
    expect(shown(c, d.id)).toBe(false);
    ind.setVisible(true);
    // The bars are a minute apart.
    ind.setVisibleOn([{ from: '1h', to: '4h' }]);
    expect(ind.hiddenByInterval).toBe(true);
    expect(shown(c, d.id)).toBe(false);
    expect(c.drawings.hiddenByInterval(d.id)).toBe(false);
    ind.setVisibleOn(null);
    expect(shown(c, d.id)).toBe(true);
    // Missing (not on the chart, or pending): hidden but kept.
    expect(shown(c, hline(c, 1, 'ind-99').id)).toBe(false);
    c.indicators.unregister('test/osc');
    expect(shown(c, d.id)).toBe(false);
    c.indicators.register(osc);
    expect(shown(c, d.id)).toBe(true);
  });

  it('drop the selection when the indicator hides', () => {
    const c = chart();
    const ind = c.indicators.add('test/osc');
    const d = hline(c, 1, ind.id);
    c.drawings.select(d.id);
    ind.setVisible(false);
    expect(c.drawings.selection).toEqual([]);
  });

  it('follow the indicator to another pane, also through undo', () => {
    const c = chart();
    const ind = c.indicators.add('test/osc');
    const other = c.indicators.add('test/osc');
    const tied = hline(c, 1, ind.id);
    const plain = hline(c, 1);
    c.moveSeries(ind.series!, other.pane!);
    // The plain drawing keeps the old pane alive.
    expect(c.drawings.getById(tied.id)!.pane).toBe(2);
    expect(c.drawings.getById(plain.id)!.pane).toBe(1);
    c.history.undo();
    expect(c.panes.indexOf(ind.pane!)).toBe(1);
    expect(c.drawings.getById(tied.id)!.pane).toBe(1);
    c.drawings.remove(plain.id);
    c.moveSeries(ind.series!, 'above');
    // Its pane left empty went; the tied drawing went along to the price pane.
    expect(c.panes).toHaveLength(2);
    expect(c.drawings.getById(tied.id)!.pane).toBe(0);
  });

  it('go with the indicator in the same undo step, and come back with it', () => {
    const c = chart();
    const ind = c.indicators.add('test/osc');
    const tied = hline(c, 1, ind.id);
    const plain = hline(c, 0);
    ind.remove();
    expect(c.panes).toHaveLength(1);
    expect(c.drawings.getAll().map((d) => d.id)).toEqual([plain.id]);
    expect(c.history.undo()).toBe(true);
    expect(c.indicators.getAll()).toEqual([ind]);
    expect(c.drawings.getById(tied.id)).toMatchObject({ pane: 1, indicator: ind.id });
    expect(shown(c, tied.id)).toBe(true);
    c.history.redo();
    expect(c.drawings.getById(tied.id)).toBeUndefined();
    c.history.undo();
    // The pane removed with the indicator: the drawing comes back with both.
    c.removePane(ind.pane!);
    expect(c.drawings.getById(tied.id)).toBeUndefined();
    c.history.undo();
    expect(c.drawings.getById(tied.id)).toMatchObject({ pane: 1 });
  });

  it('stay when the indicators are loaded again', () => {
    const c = chart();
    const ind = c.indicators.add('test/osc');
    const tied = hline(c, 1, ind.id);
    c.indicators.load(c.indicators.serialize());
    expect(c.drawings.getById(tied.id)).toBeDefined();
    expect(shown(c, tied.id)).toBe(true);
  });

  it('are started by drawing tools on an indicator pane', () => {
    const c = chart();
    const overlay = c.indicators.add('test/avg');
    const ind = c.indicators.add('test/osc');
    const draw = (pane: number) => {
      const p = c.panes[pane]!;
      c.drawings.setTool('hline');
      c.drawings.pointerDown(pane, { x: 100, y: p.top + p.height / 2 });
      c.drawings.pointerUp({ x: 100, y: p.top + p.height / 2 });
      return c.drawings.getAll().at(-1)!;
    };
    expect(draw(1).indicator).toBe(ind.id);
    // The price pane ties to no overlay.
    expect(draw(0).indicator).toBeUndefined();
    expect(overlay.id).toBe('ind-1');
    ind.setVisible(false);
    expect(draw(1).indicator).toBeUndefined();
  });

  it('copied are plain drawings once the indicator is gone', () => {
    const c = chart();
    const ind = c.indicators.add('test/osc');
    const other = c.indicators.add('test/osc');
    const tied = hline(c, 1, ind.id);
    expect(c.drawings.duplicate([tied.id])[0]!.indicator).toBe(ind.id);
    c.drawings.copy([tied.id]);
    c.indicators.duplicate(other);
    ind.remove();
    expect(c.drawings.paste()[0]!.indicator).toBeUndefined();
  });
});

describe('drawings tied to an indicator on another scale of its pane', () => {
  const big: IndicatorDef = { ...osc, id: 'test/big', name: 'Big', compute: line(50) };

  /** An oscillator at 5 on pane 1's right scale and one at 50 on its scale `scale`. */
  function twoScales(scale: string) {
    const c = chart({ smoothScale: false });
    c.indicators.register(big);
    const right = c.indicators.add('test/osc');
    const other = c.indicators.add('test/big', {}, { priceScale: scale });
    c.moveSeries(other.series!, right.pane!);
    const frame = () => {
      c.invalidate();
      (c as unknown as { render(t: number): void }).render(0);
    };
    frame();
    const pane = c.panes[1]!;
    return { c, right, other, pane, scale: pane.scale(scale), frame };
  }

  it('draw, hit and move on the indicator scale', () => {
    const { c, other, pane, scale } = twoScales('left');
    expect(c.panes).toHaveLength(2);
    expect(pane.primary).toBe(pane.price);
    const d = c.drawings.add({ type: 'hline', pane: 1, points: [{ time: 600, price: 50 }], style: {}, indicator: other.id });
    expect(c.drawingLayer!.priceScaleOf(d.id)).toBe(scale);
    const y = pane.top + scale.priceToY(50);
    expect(c.drawings.drawingAt({ x: 100, y })).toBe(d.id);
    c.drawings.pointerMove({ x: 100, y });
    c.drawings.pointerDown(1, { x: 100, y });
    c.drawings.pointerMove({ x: 100, y: y - 20 });
    c.drawings.pointerUp({ x: 100, y: y - 20 });
    expect(c.drawings.getById(d.id)!.points[0]!.price).toBeCloseTo(scale.yToPrice(y - 20 - pane.top), 6);
    // Untied, the same drawing reads the pane's primary scale.
    c.drawings.update(d.id, { indicator: '' });
    expect(c.drawingLayer!.priceScaleOf(d.id)).toBe(pane.primary);
  });

  it('autoscale the indicator scale, not the primary one', () => {
    const { c, other, pane, scale, frame } = twoScales('left');
    c.drawings.add({ type: 'hline', pane: 1, points: [{ time: 600, price: 500 }], style: {}, indicator: other.id, autoscale: true });
    frame();
    expect(scale.maxPrice).toBeGreaterThanOrEqual(500);
    expect(pane.primary.maxPrice).toBeLessThan(500);
  });

  it('are started on an indicator off the primary scale when none is on it', () => {
    const { c, right, other, pane } = twoScales('own');
    const draw = () => {
      c.drawings.setTool('hline');
      c.drawings.pointerDown(1, { x: 100, y: pane.top + pane.height / 2 });
      c.drawings.pointerUp({ x: 100, y: pane.top + pane.height / 2 });
      return c.drawings.getAll().at(-1)!;
    };
    expect(draw().indicator).toBe(right.id);
    right.setVisible(false);
    expect(draw().indicator).toBe(other.id);
  });
});
