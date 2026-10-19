import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import { drawingTools, indicators } from '../src/builtins';
import { UndoSteps as History } from '../src/history';
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

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), { plugins: [indicators(), drawingTools()], ...options });
  charts.push(c);
  c.addCandles().setData(bars);
  c.indicators.register(osc);
  c.indicators.register(avg);
  return c;
}

const hline = (c: Chart, price: number) => c.drawings.add({ type: 'hline', pane: 0, points: [{ time: 600, price }], style: {} });
const types = (c: Chart) => c.indicators.getAll().map((i) => i.type);
/** Which pane each indicator is in, by type. */
const panesOf = (c: Chart) => c.indicators.getAll().map((i) => `${i.type}@${c.panes.indexOf(i.pane!)}`);

describe('History', () => {
  const steps = (log: string[], name: string) => ({ undo: () => log.push(`-${name}`), redo: () => log.push(`+${name}`) });

  it('undoes and redoes steps in order, forgetting undone steps on a new one', () => {
    const changed = vi.fn();
    const h = new History(changed);
    const log: string[] = [];
    h.record(steps(log, 'a'));
    h.record(steps(log, 'b'));
    expect(h.undo()).toBe(true);
    expect(h.canRedo).toBe(true);
    h.record(steps(log, 'c'));
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(false);
    h.undo();
    h.undo();
    expect(h.undo()).toBe(false);
    expect(log).toEqual(['-b', '-c', '-a']);
    expect(changed).toHaveBeenCalledTimes(6);
  });

  it('keeps the last 100 steps', () => {
    const h = new History(() => {});
    for (let i = 0; i < 120; i++) h.record({ undo() {}, redo() {} });
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(100);
  });

  it('records nothing while a step runs, and makes one step of a begin/commit', () => {
    const h = new History(() => {});
    const log: string[] = [];
    h.record({ undo: () => h.record(steps(log, 'inner')), redo() {} });
    h.undo();
    expect(h.canUndo).toBe(false);
    h.begin();
    h.record(steps(log, 'a'));
    h.begin();
    h.record(steps(log, 'b'));
    h.commit();
    expect(h.canUndo).toBe(false);
    h.commit();
    h.undo();
    expect(log).toEqual(['-b', '-a']);
    h.redo();
    expect(log).toEqual(['-b', '-a', '+a', '+b']);
    expect(h.canUndo).toBe(true);
    h.undo();
    expect(h.canUndo).toBe(false);
  });

  it('cancel takes back what was recorded and leaves no step', () => {
    const h = new History(() => {});
    const log: string[] = [];
    h.begin();
    h.record(steps(log, 'a'));
    h.record(steps(log, 'b'));
    h.cancel();
    expect(log).toEqual(['-b', '-a']);
    expect(h.canUndo).toBe(false);
  });

  it('drops a step, or every step of an owner', () => {
    const h = new History(() => {});
    const owner = {};
    const mine = { owner, undo() {}, redo() {} };
    h.record(mine);
    h.record({ undo() {}, redo() {} });
    expect(h.drop(owner)).toBe(true);
    expect(h.drop(owner)).toBe(false);
    h.undo();
    expect(h.canUndo).toBe(false);
  });

  it('drops a joined step of several owners with either owner', () => {
    const h = new History(() => {});
    const a = {};
    const b = {};
    h.begin();
    h.record({ owner: a, undo() {}, redo() {} });
    h.record({ owner: b, undo() {}, redo() {} });
    h.commit();
    expect(h.drop(b)).toBe(true);
    expect(h.canUndo).toBe(false);
  });
});

describe('chart.history', () => {
  it('undoes indicator and drawing edits in the order they were made', () => {
    const c = chart();
    const ind = c.indicators.add('test/osc');
    const d = hline(c, 10);
    ind.applyInputs({ length: 20 });
    c.drawings.update(d.id, { points: [{ time: 600, price: 11 }] });
    expect(c.history.undo()).toBe(true);
    expect(c.drawings.getById(d.id)!.points[0]!.price).toBe(10);
    expect(ind.inputs.length).toBe(20);
    c.history.undo();
    expect(ind.inputs.length).toBe(14);
    c.history.undo();
    expect(c.drawings.getAll()).toEqual([]);
    c.history.undo();
    expect(c.indicators.getAll()).toEqual([]);
    expect(c.history.canUndo).toBe(false);
    for (let i = 0; i < 4; i++) c.history.redo();
    expect(c.indicators.getAll()).toEqual([ind]);
    expect(ind.inputs.length).toBe(20);
    expect(c.drawings.getById(d.id)!.points[0]!.price).toBe(11);
    expect(c.history.canRedo).toBe(false);
  });

  it('the drawing manager undo is the same history', () => {
    const c = chart();
    c.indicators.add('test/avg');
    expect(c.drawings.canUndo).toBe(true);
    expect(c.drawings.undo()).toBe(true);
    expect(c.indicators.getAll()).toEqual([]);
    expect(c.drawings.canRedo).toBe(true);
  });

  it('brings a removed indicator back as the same handle, with its state and pane', () => {
    const c = chart();
    const a = c.indicators.add('test/osc', { length: 5 });
    const b = c.indicators.add('test/osc', { length: 7 });
    const ma = c.indicators.add('test/avg');
    ma.setPlotStyle('v', { lineWidth: 3 });
    c.moveSeries(ma.series!, a.pane!);
    b.setPriceScale('left');
    b.setVisibleOn([{ from: '1m', to: '59m' }]);
    const before = panesOf(c);
    const state = b.serialize();
    b.remove();
    a.remove();
    ma.remove();
    // The overlay's pane goes with it; undo makes the oscillator's pane again.
    expect(c.panes).toHaveLength(1);
    c.history.undo();
    c.history.undo();
    c.history.undo();
    expect(c.indicators.getAll()).toEqual([a, b, ma]);
    expect(panesOf(c)).toEqual(before);
    expect(b.serialize()).toEqual(state);
    expect(ma.plotStyles).toEqual({ v: { lineWidth: 3 } });
    expect(b.removed).toBe(false);
    c.history.redo();
    expect(c.indicators.getAll()).toEqual([a, ma]);
  });

  it('undoes a price scale, label and interval edit', () => {
    const c = chart();
    const ind = c.indicators.add('test/avg');
    ind.setPriceScale('left');
    ind.applyLabelOptions({ axisTitle: true });
    ind.setVisibleOn([{ from: '1m', to: '59m' }]);
    c.history.undo();
    expect(ind.visibleOn).toBeNull();
    c.history.undo();
    expect(ind.labelOptions.axisTitle).toBe(false);
    c.history.undo();
    expect(ind.priceScale).toBe('right');
    expect(ind.serialize().priceScale).toBeUndefined();
    expect(ind.series!.options.priceScale).toBe('right');
  });

  it('does not record the visibility toggle or the legend fold', () => {
    const c = chart();
    const ind = c.indicators.add('test/avg');
    c.history.clear();
    ind.setVisible(false);
    c.setLegendFolded(ind.series!, true);
    expect(c.history.canUndo).toBe(false);
    ind.applyInputs({ length: 3 });
    c.history.undo();
    // Undoing the input edit leaves the visibility alone.
    expect(ind.visible).toBe(false);
  });

  it('undoes moving an indicator to another pane, making the pane again', () => {
    const c = chart();
    const ind = c.indicators.add('test/osc');
    c.indicators.add('test/osc');
    c.moveSeries(ind.series!, 'above');
    expect(panesOf(c)).toEqual(['test/osc@0', 'test/osc@1']);
    c.history.undo();
    expect(panesOf(c)).toEqual(['test/osc@1', 'test/osc@2']);
    c.history.redo();
    expect(panesOf(c)).toEqual(['test/osc@0', 'test/osc@1']);
    // Moving other series is not recorded.
    const line = c.addLine({}, c.panes[1]);
    const steps = c.history.canRedo;
    c.moveSeries(line, 'new');
    expect(c.history.canRedo).toBe(steps);
  });

  it('makes a pane again at the height it had', () => {
    const c = chart();
    const a = c.indicators.add('test/osc');
    c.indicators.add('test/osc');
    c.setPaneHeights([4, 3, 1]);
    const heights = c.getPaneHeights();
    c.moveSeries(a.series!, 'below');
    c.history.undo();
    expect(c.getPaneHeights()).toEqual(heights);
    a.remove();
    c.history.undo();
    expect(c.getPaneHeights()).toEqual(heights);
  });

  it('makes a template one step, restoring the indicators and panes it replaced', () => {
    const c = chart();
    const a = c.indicators.add('test/osc');
    const ma = c.indicators.add('test/avg');
    c.history.clear();
    c.indicators.applySet({
      version: 1,
      indicators: [
        { type: 'test/osc', inputs: { length: 3 }, pane: 1, visible: true },
        { type: 'test/osc', inputs: { length: 4 }, pane: 2, visible: true },
      ],
      paneHeights: [0.5, 0.25],
    });
    const applied = panesOf(c);
    const heights = c.getPaneHeights();
    expect(applied).toEqual(['test/osc@1', 'test/osc@2']);
    c.history.undo();
    expect(c.history.canUndo).toBe(false);
    expect(c.indicators.getAll()).toEqual([a, ma]);
    expect(panesOf(c)).toEqual(['test/osc@1', 'test/avg@0']);
    c.history.redo();
    expect(panesOf(c)).toEqual(applied);
    expect(c.getPaneHeights()).toEqual(heights);
  });

  it('applying a set that changes nothing records no step', () => {
    const c = chart();
    c.indicators.applySet({ version: 1, indicators: [] }, { replace: false });
    expect(c.history.canUndo).toBe(false);
  });

  it('merges the edits of one indicator, and leaves no step when they end where they began', () => {
    const c = chart();
    const ind = c.indicators.add('test/osc');
    const other = c.indicators.add('test/avg');
    c.history.clear();
    c.indicators.mergeEdits(ind);
    ind.applyInputs({ length: 2 });
    ind.applyInputs({ length: 3 });
    ind.setPlotStyle('v', { lineWidth: 4 });
    other.applyInputs({ length: 9 });
    c.indicators.mergeEdits(null);
    c.history.undo();
    expect(other.inputs.length).toBe(14);
    c.history.undo();
    expect(ind.inputs.length).toBe(14);
    expect(ind.plotStyles).toEqual({});
    expect(c.history.canUndo).toBe(false);
    c.history.clear();
    c.indicators.mergeEdits(ind);
    ind.applyInputs({ length: 2 });
    ind.applyInputs({ length: 14 });
    c.indicators.mergeEdits(null);
    expect(c.history.canUndo).toBe(false);
  });

  it('runs on Mod+Z and Mod+Shift+Z without the drawings plugin', () => {
    const c = chart({ plugins: [indicators()] });
    c.indicators.add('test/avg');
    expect(c.actions.get('undo')!.enabled).toBe(true);
    dispatch(c.root, 'keydown', { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(c.indicators.getAll()).toEqual([]);
    dispatch(c.root, 'keydown', { key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true });
    expect(types(c)).toEqual(['test/avg']);
  });

  it('undoes cutting and pasting an indicator', () => {
    const c = chart();
    const ind = c.indicators.add('test/osc');
    c.setSelection({ kind: 'indicator', indicator: ind });
    expect(c.actions.run('cut')).toBe(true);
    expect(c.indicators.getAll()).toEqual([]);
    expect(c.actions.run('paste')).toBe(true);
    expect(c.indicators.getAll()).toHaveLength(1);
    c.history.undo();
    expect(c.indicators.getAll()).toEqual([]);
    c.history.undo();
    expect(c.indicators.getAll()).toEqual([ind]);
  });

  it('loading indicators or drawings drops their steps only', () => {
    const c = chart();
    c.indicators.add('test/avg');
    hline(c, 10);
    c.indicators.load([]);
    expect(c.history.undo()).toBe(true);
    expect(c.drawings.getAll()).toEqual([]);
    expect(c.history.canUndo).toBe(false);
    c.indicators.add('test/avg');
    hline(c, 10);
    c.drawings.load({ version: 1, drawings: [] });
    c.history.undo();
    expect(c.indicators.getAll()).toEqual([]);
    expect(c.history.canUndo).toBe(false);
  });

  it('takes the drawing steps away with the drawings plugin', () => {
    const c = chart();
    hline(c, 10);
    c.uninstall('@chart-on/core/drawings');
    expect(c.history.canUndo).toBe(false);
  });

  it('emits history:change', () => {
    const c = chart();
    const seen: boolean[] = [];
    c.on('history:change', ({ canUndo }) => seen.push(canUndo));
    c.indicators.add('test/avg');
    c.history.undo();
    expect(seen).toEqual([true, false]);
  });
});
