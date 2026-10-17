import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch, type ChartSelection } from '../src/chart';
import { drawingTools, indicators } from '../src/builtins';
import type { IndicatorDef } from '../src/indicators/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 12, low: 8, close: 10 + (i % 5) }));

/** A pane indicator drawing a flat line at 5. */
const flat: IndicatorDef = {
  id: 'test/flat',
  name: 'Flat',
  placement: 'pane',
  inputs: [],
  plots: [{ id: 'v', type: 'line' }],
  compute: (src) => ({ v: new Float64Array(src.close.length).fill(5) }),
};

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), { plugins: [indicators(), drawingTools()], ...options });
  charts.push(c);
  c.addCandles({ title: 'ABC' }).setData(bars);
  frame(c);
  return c;
}

function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
}

/** A mouse click at root-relative css px, its target defaulting to the root. */
function click(c: Chart, x: number, y: number, target: unknown = c.root): void {
  const init = { clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse', timeStamp: 0 };
  dispatch(target, 'pointerdown', init);
  dispatch(c.root, 'pointerup', init);
}

/** Root-relative css px of the indicator's line at bar 40. */
function onLine(c: Chart, ind: ReturnType<Chart['indicators']['add']>) {
  const series = ind.series!;
  return { x: c.plotLeft + c.time.indexToX(40), y: series.pane.top + series.scale.priceToY(5) };
}

const key = (c: Chart, k: string) => dispatch(c.root, 'keydown', { key: k });
const hline = { type: 'hline', pane: 0, points: [{ time: 600, price: 10 }], style: {} };
type El = { className: string; children: El[]; style: Record<string, string> };
/** The first legend row of pane 1, where the indicator is. */
const indicatorRow = (c: Chart) => {
  const legends = (c.root as unknown as El).children.filter((e) => e.className === 'pc-legend');
  return legends[1]!.children.find((e) => e.className === 'pc-legend-row')!;
};

describe('indicator selection', () => {
  it('keeps one selection across drawings and indicators', () => {
    const c = chart();
    const ind = c.indicators.add(flat);
    const seen: ChartSelection[] = [];
    c.on('selection:change', ({ selection }) => seen.push(selection));
    const d = c.drawings.add(hline);
    c.drawings.select(d.id);
    expect(c.getSelection()).toEqual({ kind: 'drawings', ids: [d.id] });

    c.setSelection({ kind: 'indicator', indicator: ind });
    expect(c.getSelection()).toEqual({ kind: 'indicator', indicator: ind });
    expect(c.drawings.selection).toEqual([]);

    c.drawings.select(d.id);
    expect(c.getSelection()).toEqual({ kind: 'drawings', ids: [d.id] });
    c.setSelection(null);
    expect(c.getSelection()).toBeNull();
    // One event per change, with no empty selection in between.
    expect(seen).toEqual([
      { kind: 'drawings', ids: [d.id] },
      { kind: 'indicator', indicator: ind },
      { kind: 'drawings', ids: [d.id] },
      null,
    ]);
    c.setSelection(null);
    expect(seen).toHaveLength(4);
  });

  it('selects nothing for an indicator that is not on the chart, and drops a removed one', () => {
    const c = chart();
    const ind = c.indicators.add(flat);
    c.setSelection({ kind: 'indicator', indicator: ind });
    const seen = vi.fn();
    c.on('selection:change', seen);
    ind.remove();
    expect(c.getSelection()).toBeNull();
    expect(seen).toHaveBeenCalledWith({ selection: null });
    c.setSelection({ kind: 'indicator', indicator: ind });
    expect(c.getSelection()).toBeNull();
  });

  it('selects an indicator by clicking its line or its legend row, and clears on empty space or Escape', () => {
    const c = chart();
    const ind = c.indicators.add(flat);
    frame(c);
    const p = onLine(c, ind);
    click(c, p.x, p.y);
    expect(c.getSelection()).toEqual({ kind: 'indicator', indicator: ind });
    // Away from the line, in the same pane.
    click(c, p.x, p.y - 30);
    expect(c.getSelection()).toBeNull();

    frame(c);
    const row = indicatorRow(c);
    click(c, p.x, 5, row.children[0]);
    expect(c.getSelection()).toEqual({ kind: 'indicator', indicator: ind });
    key(c, 'Escape');
    expect(c.getSelection()).toBeNull();
  });

  it('outlines the selected indicator legend row and announces it', () => {
    const c = chart();
    const ind = c.indicators.add(flat);
    const announce = vi.spyOn(c, 'announce');
    frame(c);
    const row = indicatorRow(c);
    expect(row.style.outline).toBe('');
    c.setSelection({ kind: 'indicator', indicator: ind });
    frame(c);
    expect(row.style.outline).toContain(c.theme.drawingSelected);
    expect(announce).toHaveBeenCalledWith('Flat selected');
    c.setSelection(null);
    frame(c);
    expect(row.style.outline).toBe('');
  });

  it('removes the selected indicator with Delete or Backspace, and does nothing without a selection', () => {
    const c = chart();
    const a = c.indicators.add(flat);
    const b = c.indicators.add(flat);
    expect(c.actions.get('remove-selected')).toMatchObject({ label: 'Remove selected', keys: ['Delete', 'Backspace'], enabled: false });
    expect(c.actions.run('remove-selected')).toBe(false);
    c.setSelection({ kind: 'indicator', indicator: a });
    expect(c.actions.get('remove-selected')!.enabled).toBe(true);
    key(c, 'Delete');
    expect(c.indicators.getAll()).toEqual([b]);
    c.setSelection({ kind: 'indicator', indicator: b });
    key(c, 'Backspace');
    expect(c.indicators.getAll()).toEqual([]);
    expect(c.getSelection()).toBeNull();
  });

  it('removes selected drawings with the same keys, without conflicting shortcuts', () => {
    const c = chart();
    const d = c.drawings.add(hline);
    c.drawings.select(d.id);
    key(c, 'Delete');
    expect(c.drawings.getAll()).toEqual([]);
    expect(c.actions.get('delete-drawings')!.keys).toEqual([]);
    expect(c.actions.conflicts()).toEqual([]);
  });

  it('leaves keys typed into an input alone', () => {
    const c = chart();
    const ind = c.indicators.add(flat);
    c.setSelection({ kind: 'indicator', indicator: ind });
    const input = document.createElement('input');
    c.root.append(input);
    dispatch(input, 'keydown', { key: 'Backspace' });
    expect(c.indicators.getAll()).toEqual([ind]);
  });
});
