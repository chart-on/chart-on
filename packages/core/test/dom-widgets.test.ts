import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { HeatmapInspector } from '../src/inspector';
import { Pane } from '../src/pane';
import { PaneControls, type PaneAction } from '../src/pane-controls';
import { darkTheme } from '../src/theme';

/** The fake DOM's elements, as far as these tests read them. */
interface El {
  children: El[];
  style: Record<string, string>;
  textContent: string;
  className: string;
  dispatch(type: string): void;
  getAttribute(name: string): string | null;
}

function panes(n: number): Pane[] {
  return Array.from({ length: n }, (_, i) => {
    const pane = new Pane(i, { stretch: 1, marginTop: 0, marginBottom: 0 });
    pane.top = i * 100;
    pane.height = 100;
    return pane;
  });
}

const state = { hover: -1, maximized: -1, axisWidth: 60, theme: darkTheme, enabled: true };
const labels = (block: El) => block.children.map((b) => b.getAttribute('aria-label'));

describe('PaneControls', () => {
  it('offers the actions each pane allows and shows them on the hovered pane', () => {
    const root = fakeContainer() as unknown as El;
    const actions: [number, PaneAction][] = [];
    const controls = new PaneControls(root as never, (pane, action) => actions.push([pane, action]));
    controls.update(panes(3), { ...state, hover: 1 });
    const blocks = root.children;
    expect(blocks).toHaveLength(3);
    expect(labels(blocks[0]!)).toEqual(['Maximize pane', 'Collapse pane']);
    expect(labels(blocks[1]!)).toEqual(['Move pane down', 'Maximize pane', 'Collapse pane', 'Remove pane']);
    expect(labels(blocks[2]!)).toEqual(['Move pane up', 'Maximize pane', 'Collapse pane', 'Remove pane']);
    expect(blocks.map((b) => b.style.opacity)).toEqual(['0', '1', '0']);
    expect(blocks[1]!.style).toMatchObject({ top: '104px', right: '66px' });

    blocks[1]!.children[3]!.dispatch('click');
    expect(actions).toEqual([[1, 'remove']]);
  });

  it('switches to restore while maximized, and drops blocks for removed panes', () => {
    const root = fakeContainer() as unknown as El;
    const controls = new PaneControls(root as never, () => {});
    controls.update(panes(3), { ...state, maximized: 2 });
    expect(labels(root.children[2]!)).toEqual(['Move pane up', 'Restore panes', 'Remove pane']);
    controls.update(panes(1), state);
    expect(root.children).toHaveLength(1);
    // A single pane has nothing to offer.
    expect(labels(root.children[0]!)).toEqual([]);
  });

  it('hides everything while disabled', () => {
    const root = fakeContainer() as unknown as El;
    const controls = new PaneControls(root as never, () => {});
    controls.update(panes(2), { ...state, hover: 1, enabled: false });
    expect(root.children.map((b) => [b.style.opacity, b.style.visibility])).toEqual([
      ['0', 'hidden'],
      ['0', 'hidden'],
    ]);
  });
});

describe('HeatmapInspector', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  it('fills the grid around the hovered cell and hides again', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    const rows = 10;
    const values = new Float32Array(3 * rows).map((_, i) => i);
    const heatmap = c.addHeatmap({ format: (v) => `v${v}` });
    heatmap.setData({ times: [0, 60, 120], priceStart: 100, priceStep: 1, rows, values });

    const root = fakeContainer() as unknown as El;
    const inspector = new HeatmapInspector(root as never);
    const el = root.children[0]!;
    expect(el.style.display).toBe('none');
    inspector.show(heatmap, { col: 1, row: 5, value: 15, price: 105 }, { x: 10, y: 50 }, 800, 600, darkTheme, (p) => `p${p}`);
    expect(el.style.display).toBe('grid');
    // Rows 8 down to 2, each: columns 0..2 then the row's price.
    const texts = el.children.map((cell) => cell.textContent);
    expect(texts.slice(0, 4)).toEqual(['v8', 'v18', 'v28', 'p108']);
    // The centre row holds the hovered cell, bold.
    expect(texts.slice(12, 16)).toEqual(['v5', 'v15', 'v25', 'p105']);
    expect(el.children[13]!.style.fontWeight).toBe('700');
    expect(texts.slice(24, 28)).toEqual(['v2', 'v12', 'v22', 'p102']);
    // Near the edge: rows outside the grid and zero values are left blank.
    inspector.show(heatmap, { col: 0, row: 1, value: 1, price: 101 }, { x: 10, y: 50 }, 800, 600, darkTheme, (p) => `p${p}`);
    expect(el.children.map((cell) => cell.textContent).slice(16, 24)).toEqual(['', '', 'v10', 'p100', '', '', '', 'p99']);
    inspector.hide();
    expect(el.style.display).toBe('none');
  });
});
