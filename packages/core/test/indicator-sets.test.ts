import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { INDICATOR_SET_VERSION, MAX_INDICATOR_SET_ENTRIES, indicatorSetFits, type IndicatorSet } from '../src/indicators/sets';
import type { IndicatorDef } from '../src/indicators/types';
import { createLocalStorageAdapter, type KeyValueStorage } from '../src/storage/local';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
});

const bars = (n: number): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ time: i * 60, open: 10 + i, high: 11 + i, low: 9 + i, close: 10 + i }));

function def(id: string, placement: IndicatorDef['placement']): IndicatorDef {
  return {
    id,
    name: id,
    placement,
    inputs: [{ id: 'length', type: 'number', default: 14, min: 1 }],
    plots: [{ id: 'value', type: 'line' }],
    compute: (src) => ({ value: src.close.map((v) => v) }),
  };
}

const ma = def('test/ma', 'overlay');
const osc = def('test/osc', 'pane');
const signal = def('test/signal', 'either');

function chart(register = true): Chart {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(bars(40));
  if (register) for (const d of [ma, osc, signal]) c.indicators.register(d);
  return c;
}

/** Each indicator's id, length and pane index, in order. */
const shape = (c: Chart) =>
  c.indicators.getAll().map((ind) => [ind.type, ind.inputs.length, ind.pane ? c.panes.indexOf(ind.pane) : -1]);

/** An overlay, an oscillator sharing its pane with a signal line, and a second oscillator below. */
function twoPaneChart(): Chart {
  const c = chart();
  c.indicators.add('test/ma', { length: 20 });
  const first = c.indicators.add('test/osc', { length: 14 });
  c.indicators.add('test/osc', { length: 5 });
  const line = c.indicators.add('test/signal', { length: 9 });
  c.moveSeries(line.series!, first.pane!);
  c.setPaneHeights([2, 1, 0.5]);
  return c;
}

describe('indicator sets', () => {
  it('round-trips indicators in two panes, skipping an unknown id', () => {
    const set = twoPaneChart().indicators.serializeSet();
    expect(set.version).toBe(INDICATOR_SET_VERSION);
    expect(set.indicators.map((s) => [s.type, s.pane])).toEqual([
      ['test/ma', 0],
      ['test/osc', 1],
      ['test/osc', 2],
      ['test/signal', 1],
    ]);
    expect(set.paneHeights).toEqual([0.5, 0.25]);

    // Saved elsewhere, with an indicator this chart does not have.
    const missing = { type: 'test/missing', inputs: {}, pane: 1, visible: true };
    const saved = JSON.parse(JSON.stringify({ ...set, indicators: [...set.indicators, missing] })) as IndicatorSet;
    const c = chart();
    const result = c.indicators.applySet(saved);
    expect(result.added).toHaveLength(4);
    expect(result.skipped).toEqual([{ index: 4, type: 'test/missing', reason: 'unknown' }]);
    expect(c.panes).toHaveLength(3);
    expect(shape(c)).toEqual([
      ['test/ma', 20, 0],
      ['test/osc', 14, 1],
      ['test/osc', 5, 2],
      ['test/signal', 9, 1],
    ]);
    const heights = c.getPaneHeights();
    expect(heights[1]! / heights[0]!).toBeCloseTo(0.5);
    expect(heights[2]! / heights[0]!).toBeCloseTo(0.25);
    expect(c.indicators.serializeSet()).toEqual(set);
  });

  it('keeps the set pane order when entries come in another order', () => {
    const c = chart();
    c.indicators.applySet({
      version: 1,
      indicators: [
        { type: 'test/osc', inputs: { length: 2 }, pane: 2, visible: true },
        { type: 'test/osc', inputs: { length: 1 }, pane: 1, visible: true },
      ],
    });
    expect(shape(c)).toEqual([
      ['test/osc', 2, 2],
      ['test/osc', 1, 1],
    ]);
  });

  it('puts an overlay saved in a lower pane into that pane', () => {
    const c = chart();
    c.indicators.applySet({ version: 1, indicators: [{ type: 'test/ma', inputs: {}, pane: 1, visible: true }] });
    expect(c.panes).toHaveLength(2);
    expect(shape(c)).toEqual([['test/ma', 14, 1]]);
  });

  it('replaces the saved indicators by default, with the panes they used', () => {
    const c = twoPaneChart();
    const kept = c.indicators.add('test/osc', { length: 3 }, { persist: false });
    const result = c.indicators.applySet({ version: 1, indicators: [{ type: 'test/ma', inputs: { length: 50 }, pane: 0, visible: true }] });
    expect(result.added).toHaveLength(1);
    expect(c.indicators.getAll()).toEqual([kept, result.added[0]]);
    expect(c.panes).toHaveLength(2);
  });

  it('adds without duplicating panes or indicators when replace is false', () => {
    const c = chart();
    c.indicators.add('test/ma', { length: 20 });
    c.indicators.add('test/osc', { length: 14 });
    const set: IndicatorSet = {
      version: 1,
      indicators: [
        { type: 'test/ma', inputs: { length: 20 }, pane: 0, visible: true },
        { type: 'test/osc', inputs: { length: 14 }, pane: 1, visible: true },
        { type: 'test/osc', inputs: { length: 7 }, pane: 1, visible: true },
        { type: 'test/signal', inputs: { length: 3 }, pane: 1, visible: true },
      ],
    };
    const result = c.indicators.applySet(set, { replace: false });
    expect(result.skipped.map((s) => [s.index, s.reason])).toEqual([
      [0, 'exists'],
      [1, 'exists'],
    ]);
    // The two new indicators share one new pane.
    expect(c.panes).toHaveLength(3);
    expect(shape(c).slice(2)).toEqual([
      ['test/osc', 7, 2],
      ['test/signal', 3, 2],
    ]);
    // Applying it again changes nothing.
    expect(c.indicators.applySet(set, { replace: false }).added).toEqual([]);
    expect(c.panes).toHaveLength(3);
  });

  it('skips malformed and refused entries, and throws only for a payload that is no set', () => {
    const c = chart();
    c.indicators.setAccess(({ id }) => id !== 'test/osc');
    const refused: string[] = [];
    c.on('indicator:refuse', ({ type, reason }) => refused.push(`${type}:${reason}`));
    const result = c.indicators.applySet({
      version: 1,
      indicators: [{ type: 'test/osc', inputs: {}, pane: 1, visible: true }, { inputs: {} }, 'nope'],
    });
    expect(result.skipped.map((s) => [s.type, s.reason])).toEqual([
      ['test/osc', 'blocked'],
      ['', 'invalid'],
      ['', 'invalid'],
    ]);
    expect(refused).toEqual(['test/osc:blocked']);
    expect(() => c.indicators.applySet(null)).toThrow(/indicator set/);
    expect(() => c.indicators.applySet({ version: 2, indicators: [] })).toThrow(/version 2/);
  });

  it('migrates entries saved at an older definition version', () => {
    const c = chart(false);
    c.indicators.register({
      ...osc,
      version: 2,
      migrate: (inputs: Record<string, unknown>) => ({ length: Number(inputs.period) }),
    });
    const { added } = c.indicators.applySet({
      version: 1,
      indicators: [{ type: 'test/osc', version: 1, inputs: { period: 30 }, pane: 1, visible: true }],
    });
    expect(added[0]!.inputs.length).toBe(30);
  });

  it('scopes a set to intervals, never widening a bad scope to every interval', () => {
    const c = twoPaneChart();
    const set = c.indicators.serializeSet({ appliesOn: [{ from: '1m', to: '1h' }] });
    expect(set.appliesOn).toEqual([{ from: '1m', to: '1h' }]);
    expect(indicatorSetFits(set, '15m')).toBe(true);
    expect(indicatorSetFits(set, '1d')).toBe(false);
    expect(indicatorSetFits(c.indicators.serializeSet(), '1d')).toBe(true);
    const bad = [{ from: 'bad', to: '1h' }] as never;
    expect(() => c.indicators.serializeSet({ appliesOn: [{ from: '1m', to: '1h' }, ...bad] })).toThrow(/scope/);
    expect(() => c.indicators.serializeSet({ appliesOn: [] })).toThrow(/scope/);
    expect(indicatorSetFits({ appliesOn: bad }, '15m')).toBe(false);
    expect(indicatorSetFits({ appliesOn: [] }, '15m')).toBe(false);
    expect(() => c.indicators.applySet({ ...set, appliesOn: bad })).toThrow(/scope/);
    expect(c.indicators.getAll()).toHaveLength(4);
  });

  it('keeps a pane the old indicators shared while it holds drawings', () => {
    const c = twoPaneChart();
    c.drawings.add({ type: 'hline', pane: 1, points: [{ time: 600, price: 20 }], style: {} });
    c.indicators.applySet({ version: 1, indicators: [{ type: 'test/ma', inputs: {}, pane: 0, visible: true }] });
    expect(c.panes).toHaveLength(2);
    expect(c.panes[1]!.series).toHaveLength(0);
    expect(c.drawings.getAll().map((d) => d.pane)).toEqual([1]);
  });

  it('leaves the indicators as they were when applying fails part way', () => {
    const c = twoPaneChart();
    const before = c.indicators.getAll();
    const panes = c.panes.length;
    // Undo steps from before the set stay, and the failed set leaves none of its own.
    c.indicators.add('test/ma');
    c.history.undo();
    const history = [c.history.canUndo, c.history.canRedo];
    vi.spyOn(c, 'addPane').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() =>
      c.indicators.applySet({
        version: 1,
        indicators: [
          { type: 'test/osc', inputs: { length: 3 }, pane: 1, visible: true },
          { type: 'test/ma', inputs: { length: 3 }, pane: 1, visible: true },
        ],
      }),
    ).toThrow('boom');
    expect(c.indicators.getAll()).toEqual(before);
    expect(c.panes).toHaveLength(panes);
    expect([c.history.canUndo, c.history.canRedo]).toEqual(history);
  });

  it('reports one state change for the whole set', () => {
    const c = twoPaneChart();
    const reasons: string[] = [];
    c.on('state:change', ({ reason }) => reasons.push(reason));
    c.indicators.applySet(c.indicators.serializeSet());
    expect(reasons).toEqual(['indicators']);
    reasons.length = 0;
    c.indicators.applySet({ version: 1, indicators: [] }, { replace: false });
    expect(reasons).toEqual([]);
  });

  it('bounds untrusted sets: pane numbers, ratios and entry count', () => {
    const c = chart();
    const { added } = c.indicators.applySet({
      version: 1,
      indicators: [
        { type: 'test/osc', inputs: {}, pane: 1e9, visible: true },
        { type: 'test/osc', inputs: {}, pane: 5, visible: true },
      ],
      paneHeights: [1, 1, 1, 1, Infinity],
    });
    // Two panes, renumbered in order; the infinite ratio is ignored.
    expect(c.panes).toHaveLength(3);
    expect(added.map((ind) => c.panes.indexOf(ind.pane!))).toEqual([2, 1]);
    expect(c.getPaneHeights().every((h) => Number.isFinite(h) && h > 0)).toBe(true);
    const many = Array.from({ length: MAX_INDICATOR_SET_ENTRIES + 1 }, () => ({ type: 'test/ma', inputs: {}, pane: 0, visible: true }));
    expect(() => c.indicators.applySet({ version: 1, indicators: many })).toThrow(/more than 100/);
    expect(c.indicators.getAll()).toEqual(added);
  });

  it('saves sets as templates in localStorage across reloads', async () => {
    const map = new Map<string, string>();
    const storage: KeyValueStorage = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
    };
    const set = twoPaneChart().indicators.serializeSet();
    await createLocalStorageAdapter({ storage }).saveTemplate('indicator-set', 'Oscillators', set);
    const reloaded = createLocalStorageAdapter({ storage });
    expect(await reloaded.listTemplates('indicator-set')).toEqual(['Oscillators']);
    const c = chart();
    c.indicators.applySet(await reloaded.loadTemplate('indicator-set', 'Oscillators'));
    expect(c.indicators.serializeSet()).toEqual(set);
  });
});
