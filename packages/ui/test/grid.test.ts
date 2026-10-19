import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builtInColorPresets, ChartError, points, sharedContext, type Chart } from '@charton/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { contextBudget } from '../../core/src/gl/context-budget';
import { createChartGrid, moveEdge, sanitizeSizes, type ChartGrid, type ChartGridOptions } from '../src/grid';
import { devCheck } from '../src/options-schema';
import { gridLayout } from '../src/toolbar-presets';

const grids: ChartGrid[] = [];
beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});
afterEach(() => {
  grids.splice(0).forEach((g) => g.destroy());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Bare cells keep the tests fast; the shell parts have their own tests.
const bare = { rail: false, bottomBar: false, appearance: false } as const;

function grid(options: ChartGridOptions = {}): ChartGrid {
  const g = createChartGrid(fakeContainer(), { cell: bare, ...options });
  grids.push(g);
  return g;
}

interface FakeNode {
  className: string;
  children: FakeNode[];
  style: Record<string, string>;
  getAttribute(name: string): string | null;
  dispatch(type: string, event?: Record<string, unknown>): void;
}

const node = (el: unknown) => el as FakeNode;
const cellsOf = (g: ChartGrid) => node(g.el).children.find((c) => c.className === 'pc-grid-cells')!;
const cellEls = (g: ChartGrid) => cellsOf(g).children.filter((c) => c.className === 'pc-grid-cell');
const resizers = (g: ChartGrid) => cellsOf(g).children.filter((c) => c.className === 'pc-grid-resizer');
const key = (el: FakeNode, k: string, shiftKey = false) => el.dispatch('keydown', { key: k, shiftKey });

describe('createChartGrid', () => {
  it('lays out one shell per cell, on the shared context, with a resizer between each pair', () => {
    const g = grid({ layout: '3x2' });
    expect(g.cells).toHaveLength(6);
    expect(g.charts.every((c) => c.options.gl === 'shared')).toBe(true);
    expect(contextBudget.held).toBe(1);
    const cells = cellEls(g);
    expect(cells.map((c) => [c.style.gridColumn, c.style.gridRow])).toEqual([
      ['1', '1'],
      ['3', '1'],
      ['5', '1'],
      ['1', '3'],
      ['3', '3'],
      ['5', '3'],
    ]);
    expect(cells[4]!.getAttribute('aria-label')).toBe('Chart 5 of 6');
    expect(cellsOf(g).style.gridTemplateColumns).toBe(
      'minmax(0, 33.3333fr) var(--pc-grid-gutter) minmax(0, 33.3333fr) var(--pc-grid-gutter) minmax(0, 33.3333fr)',
    );
    const rs = resizers(g);
    expect(rs.map((r) => [r.getAttribute('aria-orientation'), r.getAttribute('aria-valuenow')])).toEqual([
      ['vertical', '33'],
      ['vertical', '67'],
      ['horizontal', '50'],
    ]);
    expect(rs[0]!.getAttribute('role')).toBe('separator');
    expect(rs[0]!.getAttribute('tabindex')).toBe('0');
    expect(rs[2]!.style.gridRow).toBe('2');
    expect(g.links.charts).toEqual(g.charts);
  });

  it('keeps a cell its own gl mode when it asks for one', () => {
    const g = grid({ layout: '2x1', cell: (i) => ({ ...bare, chart: i === 1 ? { gl: 'own' } : {} }) });
    expect(g.charts.map((c) => c.options.gl)).toEqual(['shared', 'own']);
  });

  it('adds the shared context plugin to a cell\'s own plugin list, once', () => {
    const g = grid({ layout: '2x1', cell: (i) => ({ ...bare, chart: { plugins: i === 0 ? [points()] : [sharedContext(), points()] } }) });
    expect(g.charts.every((c) => c.options.gl === 'shared')).toBe(true);
    expect(g.charts.map((c) => c.installedPlugins.filter((name) => name === '@charton/core/shared-context'))).toEqual([['@charton/core/shared-context'], ['@charton/core/shared-context']]);
    expect(contextBudget.held).toBe(1);
  });

  it('adds and destroys cells when the layout changes', () => {
    const cleanups: number[] = [];
    const setups: number[] = [];
    const g = grid({
      layout: '2x2',
      setup: (_shell, i) => {
        setups.push(i);
        return () => cleanups.push(i);
      },
    });
    const layouts: string[] = [];
    const actives: number[] = [];
    g.on('layout:change', (e) => layouts.push(e.layout));
    g.on('active:change', (e) => actives.push(e.index));
    g.setActive(3);
    const [first, , , last] = g.charts;
    const destroyed = vi.fn();
    last!.on('chart:destroy', destroyed);

    g.setLayout('2x1');
    expect(g.cells).toHaveLength(2);
    expect(g.charts[0]).toBe(first);
    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(cleanups).toEqual([3, 2]);
    expect(g.links.charts).toHaveLength(2);
    expect(g.activeIndex).toBe(1);
    expect(resizers(g)).toHaveLength(1);

    g.setLayout('2x1');
    g.setLayout('3x1');
    expect(g.cells).toHaveLength(3);
    expect(setups).toEqual([0, 1, 2, 3, 2]);
    expect(g.links.charts).toEqual(g.charts);
    expect(layouts).toEqual(['2x1', '3x1']);
    expect(actives).toEqual([3, 1]);
    expect(g.sizes.columns).toHaveLength(3);
  });

  it('makes a cell active on a pointer or focus in it, and marks it', () => {
    const g = grid({ layout: '2x1' });
    const events: number[] = [];
    g.on('active:change', (e) => events.push(e.index));
    expect(g.active).toBe(g.cells[0]);
    expect(cellEls(g)[0]!.getAttribute('aria-current')).toBe('true');

    dispatch(g.charts[1]!.root, 'pointerdown');
    expect(g.activeIndex).toBe(1);
    expect(cellEls(g)[0]!.getAttribute('aria-current')).toBeNull();
    expect(cellEls(g)[1]!.getAttribute('aria-current')).toBe('true');

    dispatch(g.charts[0]!.root, 'focusin');
    dispatch(g.charts[0]!.root, 'focusin');
    expect(events).toEqual([1, 0]);

    g.setActive(1, { focus: true });
    expect(document.activeElement).toBe(g.charts[1]!.root);
    g.setActive(5);
    expect(g.activeIndex).toBe(1);
  });

  it('points the toolbar at the active chart', () => {
    const clicked: Chart[] = [];
    let second: Chart | null = null;
    const g = grid({
      layout: '2x1',
      toolbar: [{ type: 'button', id: 'b', label: 'B', onClick: (chart) => clicked.push(chart), isActive: (chart) => chart === second }],
    });
    second = g.charts[1]!;
    g.toolbar!.refresh();
    const button = g.toolbar!.get('b')!.el as unknown as FakeNode;
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.dispatch('click');
    g.setActive(1);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    button.dispatch('click');
    expect(clicked).toEqual([g.charts[0], g.charts[1]]);
    g.toolbar!.setVisible(false);
    expect(node(g.el).children.find((c) => c.className === 'pc-shell-top')).toMatchObject({ hidden: true });
  });

  it('dresses its own chrome in the active cell’s colour preset', () => {
    const g = grid({ layout: '2x1', theme: 'dark', cell: { ...bare, appearance: { storage: null } } });
    const token = (name: string) => node(g.el).style[name];
    const [ink, lime] = ['paper-ink', 'terminal-lime'].map((id) => builtInColorPresets.find((p) => p.id === id)!);
    expect(token('--pc-accent')).toBe(ink!.dark.primary);
    // Another cell's preset waits until that cell is active.
    g.cells[1]!.setColorPreset('terminal-lime');
    expect(token('--pc-accent')).toBe(ink!.dark.primary);
    g.setActive(1);
    expect(token('--pc-accent')).toBe(lime!.dark.primary);
    g.setTheme('light');
    expect([token('--pc-accent'), token('--pc-canvas')]).toEqual([lime!.light.primary, lime!.light.background]);
    g.cells[1]!.setColorPreset(null);
    expect(token('--pc-accent')).toBe('');
  });

  it('switches and follows the preset with the gridLayout toolbar preset', () => {
    const g = grid({ layout: '2x1', toolbar: [gridLayout(['1x1', '2x1', '2x2'])] });
    const item = g.toolbar!.get('layout')!.item;
    if (item.type !== 'menu') throw new Error('expected a menu');
    expect(item.options.map((o) => o.label)).toEqual(['1 × 1', '2 × 1', '2 × 2']);
    expect(item.value).toBe('2x1');
    item.onSelect('2x2', g.active.chart);
    expect(g.layout).toBe('2x2');
    g.setLayout('1x1');
    expect(item.value).toBe('1x1');
  });

  it('resizes from the keyboard, within the minimum size', () => {
    const g = grid({ layout: '2x2' });
    const sizes: number[][] = [];
    g.on('sizes:change', (e) => sizes.push(e.columns));
    const [col, row] = resizers(g);
    key(col!, 'ArrowRight');
    expect(g.sizes.columns[0]).toBeCloseTo(0.52);
    expect(col!.getAttribute('aria-valuenow')).toBe('52');
    key(col!, 'ArrowLeft', true);
    expect(g.sizes.columns[0]).toBeCloseTo(0.42);
    key(col!, 'Home');
    expect(g.sizes.columns).toEqual([0.1, 0.9]);
    expect(col!.getAttribute('aria-valuemin')).toBe('10');
    expect(col!.getAttribute('aria-valuemax')).toBe('90');
    key(col!, 'End');
    expect(g.sizes.columns[0]).toBeCloseTo(0.9);
    // Arrows across the bar do nothing.
    key(col!, 'ArrowDown');
    key(row!, 'ArrowRight');
    expect(sizes).toHaveLength(4);
    key(row!, 'ArrowDown');
    expect(g.sizes.rows[0]).toBeCloseTo(0.52);
  });

  it('resizes by dragging, mapping pixels through the two cells beside the resizer', () => {
    const g = grid({ layout: '2x1' });
    for (const c of cellEls(g)) Object.assign(c, { getBoundingClientRect: () => ({ width: 400, height: 600 }) });
    const [col] = resizers(g);
    col!.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 400, clientY: 0 });
    expect(g.el.getAttribute('data-resizing')).toBe('columns');
    col!.dispatch('pointermove', { pointerId: 1, clientX: 480, clientY: 0 });
    expect(g.sizes.columns[0]).toBeCloseTo(0.6);
    col!.dispatch('pointermove', { pointerId: 2, clientX: 0, clientY: 0 });
    col!.dispatch('pointermove', { pointerId: 1, clientX: 0, clientY: 0 });
    expect(g.sizes.columns[0]).toBeCloseTo(0.1);
    col!.dispatch('pointerup', { pointerId: 1 });
    expect(g.el.getAttribute('data-resizing')).toBeNull();
    col!.dispatch('pointermove', { pointerId: 1, clientX: 400, clientY: 0 });
    expect(g.sizes.columns[0]).toBeCloseTo(0.1);
  });

  it('moves column resizers the way the pointer and arrows go in right-to-left pages', () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', direction: 'rtl' }));
    const g = grid({ layout: '2x2' });
    for (const c of cellEls(g)) Object.assign(c, { getBoundingClientRect: () => ({ width: 400, height: 300 }) });
    const [col, row] = resizers(g);
    // The start column is on the right: moving the bar right shrinks it.
    key(col!, 'ArrowRight');
    expect(g.sizes.columns[0]).toBeCloseTo(0.48);
    // The value stays the start column's share, like Home and End.
    expect(col!.getAttribute('aria-valuenow')).toBe('48');
    key(col!, 'ArrowLeft');
    expect(g.sizes.columns[0]).toBeCloseTo(0.5);
    col!.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 400, clientY: 0 });
    col!.dispatch('pointermove', { pointerId: 1, clientX: 480, clientY: 0 });
    expect(g.sizes.columns[0]).toBeCloseTo(0.4);
    col!.dispatch('pointerup', { pointerId: 1 });
    key(col!, 'Home');
    expect(g.sizes.columns[0]).toBeCloseTo(0.1);
    // Rows are not mirrored.
    key(row!, 'ArrowDown');
    expect(g.sizes.rows[0]).toBeCloseTo(0.52);
    row!.dispatch('pointerdown', { button: 0, pointerId: 2, clientX: 0, clientY: 300 });
    row!.dispatch('pointermove', { pointerId: 2, clientX: 0, clientY: 360 });
    expect(g.sizes.rows[0]).toBeCloseTo(0.62);
  });

  it('sets sizes, ignoring lists of the wrong length', () => {
    const g = grid({ layout: '2x2' });
    g.setSizes({ columns: [3, 1] });
    expect(g.sizes.columns).toEqual([0.75, 0.25]);
    g.setSizes({ rows: [1, 2, 3] });
    expect(g.sizes.rows).toEqual([0.5, 0.5]);
  });

  it('links the charts with the given options, or not at all', () => {
    expect(grid({ link: { symbol: true } }).links.options).toMatchObject({ symbol: true, crosshair: true });
    expect(Object.values(grid({ link: false }).links.options)).toEqual([false, false, false, false, false, false]);
  });

  it('switches every cell to a theme', () => {
    const g = grid({ layout: '2x1', theme: 'light' });
    expect(g.el.getAttribute('data-theme')).toBe('light');
    expect(g.cells.map((s) => s.theme)).toEqual(['light', 'light']);
    g.setTheme('system');
    expect(g.el.getAttribute('data-theme')).toBeNull();
    expect(g.cells.map((s) => s.theme)).toEqual(['system', 'system']);
  });

  it('saves and restores the grid, its links and every chart', () => {
    const a = grid({ layout: '2x2', link: { timezone: false, drawings: true } });
    a.setSizes({ columns: [0.7, 0.3] });
    a.setActive(2);
    const saved = JSON.parse(JSON.stringify(a.serializeLayout()));
    expect(saved).toMatchObject({ version: 1, layout: '2x2', active: 2, link: { timezone: false, drawings: true } });
    expect(saved.charts).toHaveLength(4);

    const b = grid();
    const result = b.loadLayout(saved);
    expect(result.errors).toEqual([]);
    expect(result.charts).toHaveLength(4);
    expect(b.layout).toBe('2x2');
    expect(b.sizes.columns[0]).toBeCloseTo(0.7);
    expect(b.activeIndex).toBe(2);
    expect(b.links.options.timezone).toBe(false);
    expect(b.links.options.drawings).toBe(true);
  });

  it('reports invalid parts of a saved grid and throws, changing nothing, for one that is not', () => {
    const g = grid({ layout: '2x1' });
    expect(() => g.loadLayout({ version: 2, layout: '2x1' })).toThrow(ChartError);
    expect(() => g.loadLayout({ version: 1, layout: '5x5' })).toThrow(/known layout/);
    expect(() => g.loadLayout(null)).toThrow(ChartError);
    expect(g.layout).toBe('2x1');

    const result = g.loadLayout({
      version: 1,
      layout: '1x2',
      sizes: { columns: [1], rows: [0, 1] },
      active: -1,
      link: { crosshair: 'yes', symbol: true },
      charts: [{ version: 1 }, 'nope', {}],
    });
    expect(g.layout).toBe('1x2');
    expect(g.links.options.symbol).toBe(true);
    expect(result.errors.map((e) => e.part)).toEqual([
      'link.crosshair',
      'active',
      'sizes.rows',
      'charts[1]',
      'charts',
    ]);
    expect(result.ready).toBeNull();
  });

  it('treats a missing sizes list as equal sizes when loading', () => {
    const g = grid({ layout: '2x2' });
    g.setSizes({ columns: [3, 1], rows: [3, 1] });
    const sizes: number[][] = [];
    g.on('sizes:change', (e) => sizes.push(e.rows));
    const result = g.loadLayout({ version: 1, layout: '2x2', sizes: { rows: [1, 3] } });
    expect(result.errors).toEqual([]);
    expect(g.sizes).toEqual({ columns: [0.5, 0.5], rows: [0.25, 0.75] });

    expect(g.loadLayout({ version: 1, layout: '2x2' }).errors).toEqual([]);
    expect(g.sizes).toEqual({ columns: [0.5, 0.5], rows: [0.5, 0.5] });
    // Already equal: nothing to announce.
    g.loadLayout({ version: 1, layout: '2x2', sizes: {} });
    expect(sizes).toEqual([[0.25, 0.75], [0.5, 0.5]]);
  });

  it('keeps the previous layout when a new chart cannot be created', () => {
    const cleanups: number[] = [];
    let failAt = -1;
    const g = grid({
      layout: '2x1',
      cell: (i) => {
        if (i === failAt) throw new Error('no webgl');
        return bare;
      },
      setup: (_shell, i) => () => cleanups.push(i),
    });
    const before = g.charts;
    const layouts: string[] = [];
    g.on('layout:change', (e) => layouts.push(e.layout));

    failAt = 3;
    expect(() => g.setLayout('2x2')).toThrow('no webgl');
    expect(g.layout).toBe('2x1');
    expect(g.charts).toEqual(before);
    expect(cellEls(g)).toHaveLength(2);
    expect(resizers(g)).toHaveLength(1);
    expect(g.links.charts).toEqual(before);
    expect(cleanups).toEqual([2]);
    expect(layouts).toEqual([]);

    // Loading a saved grid whose preset fails changes nothing either, links included.
    expect(() => g.loadLayout({ version: 1, layout: '2x2', link: { symbol: true } })).toThrow('no webgl');
    expect(g.layout).toBe('2x1');
    expect(g.links.options.symbol).toBe(false);

    failAt = -1;
    g.setLayout('2x2');
    expect(g.cells).toHaveLength(4);
    expect(g.links.charts).toEqual(g.charts);
  });

  it('keeps the previous layout when setup throws for a new cell', () => {
    const g = grid({
      layout: '1x1',
      setup: (_shell, i) => {
        if (i === 2) throw new Error('setup failed');
      },
    });
    expect(() => g.setLayout('3x1')).toThrow('setup failed');
    expect(g.layout).toBe('1x1');
    expect(g.cells).toHaveLength(1);
    expect(g.links.charts).toHaveLength(1);
    expect(contextBudget.held).toBe(1);
  });

  it('cleans up on destroy and refuses calls afterwards', () => {
    const container = fakeContainer();
    const g = createChartGrid(container, { layout: '2x1', cell: bare });
    const charts = g.charts;
    const destroyed = vi.fn();
    charts.forEach((c) => c.on('chart:destroy', destroyed));
    g.destroy();
    g.destroy();
    expect(destroyed).toHaveBeenCalledTimes(2);
    expect(node(container).children).toHaveLength(0);
    expect(g.links.charts).toHaveLength(0);
    expect(() => g.setLayout('1x1')).toThrow(ChartError);
  });

  it('leaves the container as it was when a chart cannot be created', () => {
    const container = fakeContainer();
    let made = 0;
    expect(() =>
      createChartGrid(container, {
        layout: '2x1',
        cell: () => {
          if (made++ === 1) throw new Error('no webgl');
          return bare;
        },
      }),
    ).toThrow('no webgl');
    expect(node(container).children).toHaveLength(0);
  });
});

describe('grid sizes', () => {
  it('moves one edge, trading size with the next track only', () => {
    expect(moveEdge([0.25, 0.25, 0.5], 1, 0.1)).toEqual([0.25, 0.35, 0.4]);
    expect(moveEdge([0.5, 0.5], 0, -1)).toEqual([0.1, 0.9]);
  });

  it('scales sizes to sum to 1, raising tiny ones to the minimum', () => {
    expect(sanitizeSizes([1, 1, 2], 3)).toEqual([0.25, 0.25, 0.5]);
    const raised = sanitizeSizes([0.01, 0.99], 2)!;
    expect(raised[0]).toBeGreaterThan(0.09);
    expect(raised[0]! + raised[1]!).toBeCloseTo(1);
    expect(sanitizeSizes([1, Number.NaN], 2)).toBeNull();
    expect(sanitizeSizes([1], 2)).toBeNull();
    expect(sanitizeSizes('1', 1)).toBeNull();
  });
});

describe('grid options in development builds', () => {
  it('warn about an unknown layout and option', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    devCheck('createChartGrid', { layout: '9x9', links: true, link: { crosshairs: true } }, 'grid');
    const text = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(text).toContain('"layout" should be one of');
    expect(text).toContain('unknown option "links" is ignored; did you mean "link"?');
    expect(text).toContain('unknown option "link.crosshairs" is ignored');
  });
});
