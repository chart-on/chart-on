import { afterEach, describe, expect, it } from 'vitest';
import { Chart, type IndicatorDef } from '@charton/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { createObjectTree, type ObjectTreeHandle } from '../src/object-tree';
import { buildObjectTree, canDropNode, flattenTree, moveNode, ObjectKeys, removeNodes } from '../src/object-tree-model';

interface FakeNode {
  children: FakeNode[];
  value?: string;
  getAttribute(name: string): string | null;
}
const fake = (el: unknown) => el as FakeNode;

const closeDef: IndicatorDef = {
  id: 'close-copy',
  name: 'Close copy',
  placement: 'pane',
  inputs: [],
  plots: [{ id: 'v', type: 'line' }],
  compute: (src) => ({ v: Float64Array.from(src.close) }),
};

const charts: Chart[] = [];
const trees: ObjectTreeHandle[] = [];
afterEach(() => {
  trees.splice(0).forEach((t) => t.destroy());
  charts.splice(0).forEach((c) => c.destroy());
});

function setup() {
  const chart = new Chart(fakeContainer());
  charts.push(chart);
  const main = chart.addCandles({ title: 'Main' });
  main.setData([0, 60, 120].map((time) => ({ time, open: 1, high: 2, low: 0, close: 1 })));
  const point = (price: number) => [{ time: 0, price }];
  const low = chart.drawings.add({ type: 'hline', pane: 0, points: point(1), style: {} });
  const high = chart.drawings.add({ type: 'hline', pane: 0, points: point(2), style: {} });
  const tree = createObjectTree(fakeContainer(), chart);
  trees.push(tree);
  const rows = () => fake(tree.el).children[1]!.children;
  const row = (key: string) => rows().find((r) => r.getAttribute('data-key') === key)!;
  const keysShown = () => rows().map((r) => r.getAttribute('data-key'));
  const button = (key: string, label: RegExp) => {
    const actions = row(key).children[2]!;
    return actions.children.find((b) => label.test(b.getAttribute('aria-label') ?? ''))!;
  };
  const press = (key: string, init: Record<string, unknown> = {}) => {
    const focused = rows().find((r) => r.getAttribute('tabindex') === '0')!;
    return dispatch(focused, 'keydown', { key, ...init });
  };
  return { chart, main, low, high, tree, rows, row, keysShown, button, press };
}

describe('object tree model', () => {
  it('lists panes with their series, indicators and drawings, topmost drawing first', () => {
    const { chart, low, high } = setup();
    const indicator = chart.indicators.add(closeDef);
    const panes = buildObjectTree(chart);
    expect(panes.map((p) => p.label)).toEqual(['Main pane', 'Pane 2']);
    expect(panes[0]!.children.map((n) => [n.kind, n.label])).toEqual([
      ['series', 'Main'],
      ['drawing', 'Horizontal line'],
      ['drawing', 'Horizontal line'],
    ]);
    expect(panes[0]!.children.slice(1).map((n) => n.key)).toEqual([`drawing:${high.id}`, `drawing:${low.id}`]);
    expect(panes[1]!.children).toHaveLength(1);
    expect(panes[1]!.children[0]).toMatchObject({ kind: 'indicator', target: indicator });
    // The main series and pane stay; the indicator's series is not listed twice.
    expect(panes[0]!.children[0]!.can).toMatchObject({ remove: false, move: false, rename: true });
    expect(panes[0]!.can.remove).toBe(false);
    expect(flattenTree(panes)).toHaveLength(6);
  });

  it('labels a named drawing by its name, with the tool as detail', () => {
    const { chart, low } = setup();
    chart.drawings.update(low.id, { name: 'Support' });
    const node = buildObjectTree(chart)[0]!.children.find((n) => n.key === `drawing:${low.id}`)!;
    expect([node.label, node.detail]).toEqual(['Support', 'Horizontal line']);
  });

  it('keeps series and indicator keys stable across rebuilds with the same key source', () => {
    const { chart } = setup();
    const keys = new ObjectKeys();
    const first = buildObjectTree(chart, keys)[0]!.children[0]!.key;
    expect(buildObjectTree(chart, keys)[0]!.children[0]!.key).toBe(first);
  });

  it('moves drawings, panes and series, and refuses drops that do not fit', () => {
    const { chart, low, high } = setup();
    chart.indicators.add(closeDef);
    const extra = chart.addLine({ title: 'Extra' });
    const [main, second] = buildObjectTree(chart);
    const lowNode = main!.children.find((n) => n.key === `drawing:${low.id}`)!;
    expect(moveNode(chart, lowNode, -1)).toBe(true);
    expect(chart.drawings.getAll().map((d) => d.id)).toEqual([high.id, low.id]);
    const extraNode = main!.children.find((n) => n.label === 'Extra')!;
    expect(canDropNode(extraNode, second!)).toBe(true);
    expect(canDropNode(lowNode, second!)).toBe(false);
    expect(moveNode(chart, extraNode, 1)).toBe(true);
    expect(extra.pane).toBe(chart.panes[1]);
    expect(moveNode(chart, second!, -1)).toBe(false);
  });

  it('removes drawings as one undo step and leaves the main series and pane', () => {
    const { chart } = setup();
    const all = flattenTree(buildObjectTree(chart));
    removeNodes(chart, all);
    expect(chart.drawings.getAll()).toEqual([]);
    expect(chart.panes).toHaveLength(1);
    expect(chart.main).not.toBeNull();
    chart.drawings.undo();
    expect(chart.drawings.getAll()).toHaveLength(2);
  });
});

describe('object tree panel', () => {
  it('renders an accessible tree with one tab stop', () => {
    const { tree, rows, chart } = setup();
    const treeEl = fake(tree.el).children[1]!;
    expect(treeEl.getAttribute('role')).toBe('tree');
    expect(treeEl.getAttribute('aria-multiselectable')).toBe('true');
    expect(rows().map((r) => r.getAttribute('role'))).toEqual(Array(4).fill('treeitem'));
    expect(rows().filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(rows()[0]!.getAttribute('aria-expanded')).toBe('true');
    expect(rows().map((r) => r.getAttribute('aria-level'))).toEqual(['1', '2', '2', '2']);
    chart.addPane();
    expect(rows()).toHaveLength(5);
  });

  it('hides, locks and removes a drawing from its row, undoably', () => {
    const { chart, low, row, button } = setup();
    const key = `drawing:${low.id}`;
    dispatch(button(key, /^Hide/), 'click');
    expect(chart.drawings.getById(low.id)!.hidden).toBe(true);
    expect(row(key).getAttribute('data-visible')).toBe('false');
    dispatch(button(key, /^Lock/), 'click');
    expect(chart.drawings.getById(low.id)!.locked).toBe(true);
    expect(row(key).getAttribute('aria-label')).toBe('Horizontal line, hidden, locked');
    dispatch(button(key, /^Remove/), 'click');
    expect(chart.drawings.getById(low.id)).toBeUndefined();
    chart.drawings.undo();
    chart.drawings.undo();
    expect(chart.drawings.getById(low.id)).toMatchObject({ hidden: true });
    expect(chart.drawings.getById(low.id)!.locked).toBeUndefined();
    expect(row(key)).toBeDefined();
  });

  it('applies bulk actions to a multi-selection as one undo step', () => {
    const { chart, low, high, row, press, tree } = setup();
    dispatch(row(`drawing:${high.id}`), 'click');
    dispatch(row(`drawing:${low.id}`), 'click', { ctrlKey: true });
    expect(tree.selection.map((n) => n.key)).toEqual([`drawing:${high.id}`, `drawing:${low.id}`]);
    press('h');
    expect(chart.drawings.getAll().every((d) => d.hidden)).toBe(true);
    chart.drawings.undo();
    expect(chart.drawings.getAll().some((d) => d.hidden)).toBe(false);
    press('Delete');
    expect(chart.drawings.getAll()).toEqual([]);
    chart.drawings.undo();
    expect(chart.drawings.getAll()).toHaveLength(2);
  });

  it('extends the selection with Shift and selects all with Ctrl+A', () => {
    const { rows, row, press, tree } = setup();
    dispatch(row(fake(rows()[1]).getAttribute('data-key')!), 'click');
    press('ArrowDown', { shiftKey: true });
    press('ArrowDown', { shiftKey: true });
    expect(tree.selection).toHaveLength(3);
    press('a', { ctrlKey: true });
    expect(tree.selection).toHaveLength(4);
    expect(rows().every((r) => r.getAttribute('aria-selected') === 'true')).toBe(true);
  });

  it('moves focus with the arrow keys and folds panes', () => {
    const { rows, press, keysShown } = setup();
    const focused = () => rows().find((r) => r.getAttribute('tabindex') === '0')!.getAttribute('data-key');
    const pane = keysShown()[0];
    press('ArrowDown');
    expect(focused()).toBe(keysShown()[1]);
    expect(rows()[1]!.getAttribute('aria-selected')).toBe('true');
    press('End');
    expect(focused()).toBe(keysShown()[3]);
    press('ArrowLeft');
    expect(focused()).toBe(pane);
    press('ArrowLeft');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.getAttribute('aria-expanded')).toBe('false');
    press('ArrowRight');
    expect(rows()).toHaveLength(4);
    press('ArrowRight');
    expect(focused()).toBe(keysShown()[1]);
  });

  it('renames a drawing with Enter, and the name persists with the layout', () => {
    const { chart, low, row, press } = setup();
    const key = `drawing:${low.id}`;
    dispatch(row(key), 'click');
    press('Enter');
    const input = row(key).children[1]!;
    expect(input.getAttribute('aria-label')).toBe('Rename drawing Horizontal line');
    input.value = '  Support ';
    dispatch(input, 'keydown', { key: 'Enter' });
    expect(chart.drawings.getById(low.id)!.name).toBe('Support');
    expect(row(key).getAttribute('aria-label')).toBe('Support, Horizontal line');
    const saved = chart.serializeLayout().drawings!.drawings.find((d) => d.id === low.id)!;
    expect(saved.name).toBe('Support');
    chart.drawings.undo();
    expect(chart.drawings.getById(low.id)!.name).toBeUndefined();
  });

  it('cancels a rename with Escape', () => {
    const { chart, low, row, press } = setup();
    const key = `drawing:${low.id}`;
    dispatch(row(key), 'click');
    press('F2');
    const input = row(key).children[1]!;
    input.value = 'Nope';
    dispatch(input, 'keydown', { key: 'Escape' });
    expect(chart.drawings.getById(low.id)!.name).toBeUndefined();
    expect(chart.drawings.canUndo).toBe(true);
  });

  it('renames a series through its title', () => {
    const { main, rows, press } = setup();
    dispatch(rows()[1]!, 'click');
    press('Enter');
    const input = rows()[1]!.children[1]!;
    input.value = 'Price';
    dispatch(input, 'keydown', { key: 'Enter' });
    expect(main.options.title).toBe('Price');
  });

  it('reorders drawings with Alt+arrows and by dragging, undoably', () => {
    const { chart, low, high, row, press } = setup();
    dispatch(row(`drawing:${low.id}`), 'click');
    press('ArrowUp', { altKey: true });
    expect(chart.drawings.getAll().map((d) => d.id)).toEqual([high.id, low.id]);
    chart.drawings.undo();
    expect(chart.drawings.getAll().map((d) => d.id)).toEqual([low.id, high.id]);
    dispatch(row(`drawing:${low.id}`), 'dragstart');
    const over = dispatch(row(`drawing:${high.id}`), 'dragover');
    expect(over.defaultPrevented).toBe(true);
    dispatch(row(`drawing:${high.id}`), 'drop');
    expect(chart.drawings.getAll().map((d) => d.id)).toEqual([high.id, low.id]);
  });

  it('does not accept a drop that cannot move', () => {
    const { low, row, keysShown } = setup();
    dispatch(row(`drawing:${low.id}`), 'dragstart');
    expect(dispatch(row(keysShown()[0]!), 'dragover').defaultPrevented).toBe(false);
  });

  it('selects drawings on the chart and follows the chart selection', () => {
    const { chart, low, high, row, tree } = setup();
    dispatch(row(`drawing:${low.id}`), 'click');
    expect(chart.drawings.selected?.id).toBe(low.id);
    chart.drawings.select(high.id);
    expect(tree.selection.map((n) => n.key)).toEqual([`drawing:${high.id}`]);
    expect(row(`drawing:${high.id}`).getAttribute('aria-selected')).toBe('true');
    chart.drawings.select(null);
    expect(tree.selection).toEqual([]);
    tree.select([`drawing:${low.id}`, 'nope']);
    expect(chart.drawings.selected?.id).toBe(low.id);
  });

  it('keeps a multi-selection in sync with the chart both ways', () => {
    const { chart, low, high, row, tree } = setup();
    dispatch(row(`drawing:${high.id}`), 'click');
    dispatch(row(`drawing:${low.id}`), 'click', { ctrlKey: true });
    // The focused row's drawing is the chart's `selected` one.
    expect(chart.drawings.selection).toEqual([high.id, low.id]);
    chart.drawings.setSelection([low.id, high.id]);
    expect(tree.selection.map((n) => n.key)).toEqual([`drawing:${high.id}`, `drawing:${low.id}`]);
    // Taking one out on the chart takes its row out.
    chart.drawings.setSelection([high.id]);
    expect(tree.selection.map((n) => n.key)).toEqual([`drawing:${high.id}`]);
    // Hiding a selected drawing drops it from the chart's selection but keeps its row.
    tree.select([`drawing:${high.id}`, `drawing:${low.id}`]);
    chart.drawings.setVisible(low.id, false);
    expect(chart.drawings.selection).toEqual([high.id]);
    expect(tree.selection).toHaveLength(2);
  });

  it('selects an indicator on the chart from its row, in place of drawings', () => {
    const { chart, low, row, keysShown, press } = setup();
    const indicator = chart.indicators.add(closeDef);
    dispatch(row(`drawing:${low.id}`), 'click');
    const indicatorKey = keysShown()[5]!;
    dispatch(row(indicatorKey), 'click');
    expect(chart.getSelection()).toEqual({ kind: 'indicator', indicator });
    // Back to the drawing with the keyboard, past the pane row.
    press('ArrowUp');
    expect(chart.getSelection()).toBeNull();
    press('ArrowUp');
    expect(chart.getSelection()).toEqual({ kind: 'drawings', ids: [low.id] });
  });

  it('hides indicators and series, and removes indicators and panes', () => {
    const { chart, main, rows, keysShown, button, row } = setup();
    const indicator = chart.indicators.add(closeDef);
    const seriesKey = keysShown()[1]!;
    dispatch(button(seriesKey, /^Hide/), 'click');
    expect(main.visible).toBe(false);
    expect(row(seriesKey).getAttribute('data-visible')).toBe('false');
    const indicatorKey = keysShown()[5]!;
    dispatch(button(indicatorKey, /^Hide/), 'click');
    expect(indicator.visible).toBe(false);
    dispatch(button(indicatorKey, /^Remove/), 'click');
    expect(chart.indicators.getAll()).toEqual([]);
    chart.addPane();
    const paneKey = keysShown()[rows().length - 1]!;
    dispatch(button(paneKey, /^Remove/), 'click');
    expect(chart.panes).toHaveLength(1);
  });

  it('skips rebuilding while hidden and catches up on refresh', () => {
    const { chart, tree, rows } = setup();
    tree.el.hidden = true;
    chart.drawings.clear();
    expect(rows()).toHaveLength(4);
    tree.el.hidden = false;
    tree.refresh();
    expect(rows()).toHaveLength(2);
  });

  it('stops listening once destroyed', () => {
    const { chart, tree, rows } = setup();
    tree.destroy();
    chart.drawings.clear();
    expect(rows()).toHaveLength(4);
  });
});

describe('object tree text', () => {
  it('takes its labels from the chart localization', () => {
    const chart = new Chart(fakeContainer(), {
      localization: { messages: { objectTreeTitle: 'Objekte', objectTreeMainPane: 'Hauptbereich', objectTreeHide: '{name} ausblenden' } },
    });
    charts.push(chart);
    chart.addCandles({ title: 'Main' }).setData([{ time: 0, open: 1, high: 2, low: 0, close: 1 }]);
    const tree = createObjectTree(fakeContainer(), chart);
    trees.push(tree);
    expect(tree.el.getAttribute('aria-label')).toBe('Objekte');
    expect(buildObjectTree(chart)[0]!.label).toBe('Hauptbereich');
    const seriesRow = fake(tree.el).children[1]!.children.find((r) => r.getAttribute('data-key')?.startsWith('series:'))!;
    const labels = seriesRow.children[2]!.children.map((b) => b.getAttribute('aria-label'));
    expect(labels).toContain('Main ausblenden');
  });
});
