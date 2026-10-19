import {
  ChartError,
  createLinkGroup,
  sharedContext,
  type Chart,
  type ChartLayout,
  type LayoutLoadError,
  type LayoutLoadOptions,
  type LayoutLoadResult,
  type LayoutSerializeOptions,
  type LinkGroup,
  type LinkGroupOptions,
} from '@charton/core';
import { h, isRtl } from './dom';
import { createChartShell, type ChartShell, type ChartShellOptions, type ShellTheme } from './shell';
import { mountToolbar, type ToolbarHandle, type ToolbarItem, type ToolbarOptions } from './toolbar';
import { devCheck } from './options-schema';
import { shellText, type ShellMessageKey } from './messages';
import { presetShellTokens } from './color-presets';

/** Grid presets, named columns x rows. */
export type ChartGridLayout = '1x1' | '2x1' | '1x2' | '3x1' | '1x3' | '2x2' | '3x2' | '4x2';

/** Columns and rows of each preset. Every preset fills all its cells, at most eight. */
export const chartGridLayouts: Readonly<Record<ChartGridLayout, Readonly<{ columns: number; rows: number }>>> = Object.freeze({
  '1x1': { columns: 1, rows: 1 },
  '2x1': { columns: 2, rows: 1 },
  '1x2': { columns: 1, rows: 2 },
  '3x1': { columns: 3, rows: 1 },
  '1x3': { columns: 1, rows: 3 },
  '2x2': { columns: 2, rows: 2 },
  '3x2': { columns: 3, rows: 2 },
  '4x2': { columns: 4, rows: 2 },
});

/** Column widths and row heights as fractions of the grid; each list sums to 1. */
export interface ChartGridSizes {
  columns: number[];
  rows: number[];
}

/** Options for `createChartGrid`: the starting layout, each cell's shell options and setup, the grid toolbar, what the charts keep in step, and the theme. */
export interface ChartGridOptions {
  /** Preset to start with. Default `1x1`. */
  layout?: ChartGridLayout;
  /**
   * Shell options of each cell, or a function of the cell's index (0 to 7, by
   * row). Cells draw through the shared WebGL context (`chart: { gl: 'shared' }`)
   * unless set otherwise, so eight charts take one context of the page's budget.
   * The grid adds the `sharedContext()` plugin to a cell's own `chart.plugins` list.
   */
  cell?: ChartShellOptions | ((index: number) => ChartShellOptions);
  /**
   * Called for each cell once its shell exists, also for cells a later
   * `setLayout` adds: load data here. A returned function runs when the cell goes.
   */
  setup?: (shell: ChartShell, index: number) => void | (() => void);
  /** Toolbar above the grid; items or customization options acting on the active chart. Omit or pass [] for none. */
  toolbar?: ToolbarItem[] | ToolbarOptions;
  /**
   * What the charts keep in step (see `createLinkGroup`). Defaults to the link
   * group defaults; `false` links nothing. Change it later through `grid.links`.
   */
  link?: Partial<LinkGroupOptions> | false;
  /** Colour scheme of the grid and of cells that set none. Default `dark`. */
  theme?: ShellTheme;
  /** Extra class names for theming. */
  className?: string;
}

/** Events emitted by a chart grid, by name: the active cell, the layout preset or the cell sizes changed. */
export interface ChartGridEvents {
  /** Another cell became active: by a click or focus in it, or `setActive`. */
  'active:change': { index: number; shell: ChartShell };
  /** `setLayout` or `loadLayout` changed the preset. */
  'layout:change': { layout: ChartGridLayout };
  /** A resizer moved, or `setSizes` changed the sizes. */
  'sizes:change': ChartGridSizes;
}

/** A saved grid: preset, sizes, links and each chart's layout. */
export interface ChartGridState {
  version: 1;
  layout: ChartGridLayout;
  sizes: ChartGridSizes;
  active: number;
  link: LinkGroupOptions;
  /** One per cell, by index; see `chart.serializeLayout`. */
  charts: ChartLayout[];
}

/** What `ChartGrid.loadLayout` returns: the parts it skipped, each chart's own load result, and a promise for the saved symbols. */
export interface ChartGridLoadResult {
  /** Parts skipped, with the chart's index in `part` (`charts[1].panes[0]`); everything else loaded. */
  errors: LayoutLoadError[];
  /** What each chart's `loadLayout` returned, by index. */
  charts: LayoutLoadResult[];
  /** Settles once every chart has loaded its saved symbol; null when none loads one. */
  ready: Promise<void> | null;
}

/** A grid of chart shells made by `createChartGrid`: its cells and charts, the active cell, layout and sizes, the link group, theme, saved layouts and events. */
export interface ChartGrid {
  el: HTMLElement;
  readonly toolbar: ToolbarHandle | null;
  /** The shell in each cell, by row. */
  readonly cells: readonly ChartShell[];
  readonly charts: readonly Chart[];
  /** Keeps the charts in step; every cell is in it. */
  readonly links: LinkGroup;
  readonly layout: ChartGridLayout;
  /**
   * Switch preset. Cells past the new count are destroyed from the end, new
   * ones are created with the `cell` options, and the sizes are reset. Throws,
   * keeping the previous layout, when a new chart cannot be created.
   */
  setLayout(layout: ChartGridLayout): void;
  readonly sizes: ChartGridSizes;
  /** Set column widths and row heights; lists of the wrong length are ignored, the rest are scaled to sum to 1. */
  setSizes(sizes: Partial<ChartGridSizes>): void;
  /** The cell the toolbar acts on. */
  readonly active: ChartShell;
  readonly activeIndex: number;
  /** Make a cell active; with `focus`, also move keyboard focus to its chart. */
  setActive(index: number, options?: { focus?: boolean }): void;
  readonly theme: ShellTheme;
  /** Switch the grid and every cell to `theme`. */
  setTheme(theme: ShellTheme): void;
  /** The grid to store and restore with `loadLayout`. `options` go to each chart's `serializeLayout`. */
  serializeLayout(options?: LayoutSerializeOptions): ChartGridState;
  /**
   * Restore a grid from `serializeLayout`. Invalid parts are skipped and listed
   * in `errors`; a missing `sizes` list means equal sizes. Throws, changing
   * nothing, when `data` is not a saved grid or a new chart cannot be created.
   */
  loadLayout(data: unknown, options?: LayoutLoadOptions): ChartGridLoadResult;
  /** Subscribe to grid events; returns an unsubscribe function. */
  on<K extends keyof ChartGridEvents>(event: K, listener: (payload: ChartGridEvents[K]) => void): () => void;
  destroy(): void;
}

/** Smallest column or row, as a fraction of the grid. */
const MIN_SIZE = 0.1;
/** Keyboard step of a resizer, as a fraction of the grid; Shift moves five times as far. */
const KEY_STEP = 0.02;

type Axis = 'columns' | 'rows';

interface Cell {
  el: HTMLElement;
  shell: ChartShell;
  cleanup: (() => void) | void;
}

const equal = (n: number) => Array.from({ length: n }, () => 1 / n);
const sum = (list: readonly number[], end = list.length) => list.slice(0, end).reduce((a, b) => a + b, 0);
const percent = (fraction: number) => String(Math.round(fraction * 100));
const isLayout = (value: unknown): value is ChartGridLayout =>
  typeof value === 'string' && Object.hasOwn(chartGridLayouts, value);

/** Positive finite fractions of the right count, scaled to sum to 1 with none below `MIN_SIZE`; null otherwise. */
export function sanitizeSizes(value: unknown, count: number): number[] | null {
  if (!Array.isArray(value) || value.length !== count) return null;
  if (!value.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)) return null;
  const total = sum(value as number[]);
  const floored = (value as number[]).map((v) => Math.max(MIN_SIZE, v / total));
  const scale = sum(floored);
  return floored.map((v) => v / scale);
}

/**
 * Move the edge after `index` by `delta`, trading size between that column (or
 * row) and the next one only. Neither goes below `MIN_SIZE`.
 */
export function moveEdge(sizes: readonly number[], index: number, delta: number): number[] {
  const next = [...sizes];
  const a = next[index]!;
  const pair = a + next[index + 1]!;
  const moved = Math.min(Math.max(a + delta, MIN_SIZE), pair - MIN_SIZE);
  next[index] = moved;
  next[index + 1] = pair - moved;
  return next;
}

/** The grid each cell's chart belongs to; read through `gridOf`. */
const grids = new WeakMap<Chart, () => ChartGrid | undefined>();

/** Internal: the grid `chart` is a cell of, so toolbar presets can reach it. Not exported from the package. */
export function gridOf(chart: Chart): ChartGrid | undefined {
  return grids.get(chart)?.();
}

/**
 * One to eight chart shells in a grid of resizable cells, with an active cell
 * that the grid toolbar acts on and a link group that keeps the charts in step.
 * Requires `@charton/ui/style.css`.
 *
 * @example
 * ```ts
 * const grid = createChartGrid(el, {
 *   layout: '2x2',
 *   setup(shell, index) {
 *     shell.chart.setDataSource(source);
 *     void shell.chart.setSymbol(symbols[index]!, '1h');
 *   },
 * });
 * grid.links.applyOptions({ interval: true });
 * ```
 */
export function createChartGrid(container: HTMLElement, options: ChartGridOptions = {}): ChartGrid {
  devCheck('createChartGrid', options, 'grid');
  // `pc-shell` gives the grid chrome the shell's tokens and themes.
  const el = h('div', { class: `pc-shell pc-grid ${options.className ?? ''}`.trim() });
  const top = h('div', { class: 'pc-shell-top' });
  const body = h('div', { class: 'pc-grid-cells', role: 'group' });
  el.append(top, body);
  container.append(el);

  const listeners = new Map<keyof ChartGridEvents, Set<(payload: never) => void>>();
  const emit = <K extends keyof ChartGridEvents>(event: K, payload: ChartGridEvents[K]) =>
    listeners.get(event)?.forEach((l) => (l as (payload: ChartGridEvents[K]) => void)(payload));

  let theme: ShellTheme = options.theme ?? 'dark';
  const markTheme = () => {
    if (theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
  };
  markTheme();

  const links = createLinkGroup(
    [],
    options.link === false
      ? { crosshair: false, visibleRange: false, symbol: false, interval: false, timezone: false, drawings: false }
      : options.link,
  );
  const cells: Cell[] = [];
  let layout: ChartGridLayout = isLayout(options.layout) ? options.layout : '1x1';
  let sizes: ChartGridSizes = { columns: [1], rows: [1] };
  let resizers: { axis: Axis; index: number; el: HTMLElement }[] = [];
  let activeIndex = 0;
  let destroyed = false;

  const shape = () => chartGridLayouts[layout];
  /** The grid's own text, in the language of the active cell's chart. */
  const t = (key: ShellMessageKey, params?: Record<string, number>) =>
    shellText(cells[Math.min(activeIndex, cells.length - 1)]?.shell.chart, key, params);
  const cellOptions = (index: number): ChartShellOptions => {
    const base = typeof options.cell === 'function' ? options.cell(index) : (options.cell ?? {});
    const own = base.chart?.plugins;
    const shared = sharedContext();
    // The shell's default plugins include it; an app's own list gets it here.
    const plugins = own && { plugins: [shared, ...own.filter((p) => p.name !== shared.name)] };
    // Cells keep square, flush chrome: the grid's gutters already frame them. The grid's own toolbar acts on the active cell.
    return { panels: 'docked', toolbar: [], ...base, theme: base.theme ?? theme, chart: { gl: 'shared', ...base.chart, ...plugins } };
  };

  function createCell(index: number): Cell {
    const cellEl = h('div', { class: 'pc-grid-cell', role: 'group' });
    body.append(cellEl);
    let shell: ChartShell;
    try {
      shell = createChartShell(cellEl, cellOptions(index));
    } catch (error) {
      cellEl.remove();
      throw error;
    }
    // Capture: a chart may stop the pointer event, and the cell should still become active.
    cellEl.addEventListener('pointerdown', () => activate(cells.findIndex((c) => c.el === cellEl)), true);
    cellEl.addEventListener('focusin', () => activate(cells.findIndex((c) => c.el === cellEl)));
    shell.chart.on('localization:change', relabel);
    const restyle = () => cells[activeIndex]?.shell === shell && wearPreset();
    shell.on('preset:change', restyle);
    shell.on('theme:change', restyle);
    links.add(shell.chart);
    grids.set(shell.chart, () => api);
    const cell: Cell = { el: cellEl, shell, cleanup: undefined };
    cells.push(cell);
    cell.cleanup = options.setup?.(shell, index);
    return cell;
  }

  function destroyCell(cell: Cell): void {
    cell.cleanup?.();
    // The link group drops the chart through its `chart:destroy` event.
    cell.shell.destroy();
    cell.el.remove();
  }

  function activate(index: number, focus = false): void {
    if (index < 0 || index >= cells.length) return;
    const changed = index !== activeIndex;
    activeIndex = index;
    markActive();
    // Also on a layout change, which can replace the active cell's shell.
    wearPreset();
    if (focus) cells[index]!.shell.chart.root.focus();
    if (changed) {
      relabel();
      toolbar?.refresh();
      emit('active:change', { index, shell: cells[index]!.shell });
    }
  }

  // The grid's own chrome (toolbar, gutters, active outline) wears the active cell's colour preset,
  // which each shell sets inline on its own element only. The same tokens, so both match.
  let presetTokens: string[] = [];
  function wearPreset(): void {
    for (const name of presetTokens) el.style.setProperty(name, '');
    const shell = cells[activeIndex]?.shell;
    const preset = shell?.appearance?.preset;
    const tokens = preset && !shell.el.classList.contains('pc-theme-high-contrast') ? presetShellTokens(preset, shell.resolvedTheme) : {};
    presetTokens = Object.keys(tokens);
    for (const name of presetTokens) el.style.setProperty(name, tokens[name]!);
  }

  function markActive(): void {
    cells.forEach((c, i) => {
      if (i === activeIndex) c.el.setAttribute('aria-current', 'true');
      else c.el.removeAttribute('aria-current');
    });
  }

  // Tracks: cells on odd lines, a gutter for a resizer between each pair.
  const tracks = (list: readonly number[]) =>
    list.map((f) => `minmax(0, ${(f * 100).toFixed(4)}fr)`).join(' var(--pc-grid-gutter) ');

  function applySizes(): void {
    body.style.gridTemplateColumns = tracks(sizes.columns);
    body.style.gridTemplateRows = tracks(sizes.rows);
    for (const r of resizers) {
      const list = sizes[r.axis];
      r.el.setAttribute('aria-valuenow', percent(sum(list, r.index + 1)));
      r.el.setAttribute('aria-valuemin', percent(sum(list, r.index) + MIN_SIZE));
      r.el.setAttribute('aria-valuemax', percent(sum(list, r.index + 2) - MIN_SIZE));
    }
  }

  function setAxis(axis: Axis, list: number[]): void {
    sizes = { ...sizes, [axis]: list };
    applySizes();
    emit('sizes:change', { columns: [...sizes.columns], rows: [...sizes.rows] });
  }

  function createResizer(axis: Axis, index: number): HTMLElement {
    const vertical = axis === 'columns';
    const r = h('div', {
      class: 'pc-grid-resizer',
      role: 'separator',
      tabindex: '0',
      // A vertical bar resizes columns.
      'aria-orientation': vertical ? 'vertical' : 'horizontal',
      'data-axis': axis,
    });
    if (vertical) {
      r.style.gridColumn = String(index * 2 + 2);
      r.style.gridRow = '1 / -1';
    } else {
      r.style.gridRow = String(index * 2 + 2);
      r.style.gridColumn = '1 / -1';
    }
    // Columns run from the inline start: in right-to-left pages, moving the bar right shrinks the start column.
    const sign = () => (vertical && isRtl(r) ? -1 : 1);
    const [back, forward] = vertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    r.addEventListener('keydown', (e) => {
      const list = sizes[axis];
      const step = (e.shiftKey ? KEY_STEP * 5 : KEY_STEP) * sign();
      let delta: number;
      if (e.key === back) delta = -step;
      else if (e.key === forward) delta = step;
      else if (e.key === 'Home') delta = -Infinity;
      else if (e.key === 'End') delta = Infinity;
      else return;
      e.preventDefault();
      setAxis(axis, moveEdge(list, index, delta));
    });

    // Dragging maps pixels to fractions through the two cells beside the resizer.
    let drag: { pointerId: number; start: number; from: number[]; scale: number } | null = null;
    r.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const { columns } = shape();
      const before = cells[vertical ? index : index * columns]!.el.getBoundingClientRect();
      const after = cells[vertical ? index + 1 : (index + 1) * columns]!.el.getBoundingClientRect();
      const px = vertical ? before.width + after.width : before.height + after.height;
      const list = sizes[axis];
      if (!(px > 0)) return;
      e.preventDefault();
      r.setPointerCapture(e.pointerId);
      drag = {
        pointerId: e.pointerId,
        start: vertical ? e.clientX : e.clientY,
        from: [...list],
        scale: ((list[index]! + list[index + 1]!) / px) * sign(),
      };
      el.setAttribute('data-resizing', axis);
    });
    r.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const moved = ((vertical ? e.clientX : e.clientY) - drag.start) * drag.scale;
      setAxis(axis, moveEdge(drag.from, index, moved));
    });
    const end = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      drag = null;
      el.removeAttribute('data-resizing');
    };
    r.addEventListener('pointerup', end);
    r.addEventListener('pointercancel', end);
    return r;
  }

  function placeCells(): void {
    const { columns } = shape();
    cells.forEach((c, i) => {
      c.el.style.gridColumn = String((i % columns) * 2 + 1);
      c.el.style.gridRow = String(Math.floor(i / columns) * 2 + 1);
    });
    for (const r of resizers) r.el.remove();
    resizers = [];
    for (const axis of ['columns', 'rows'] as const) {
      for (let i = 0; i < sizes[axis].length - 1; i++) resizers.push({ axis, index: i, el: createResizer(axis, i) });
    }
    body.append(...resizers.map((r) => r.el));
    body.setAttribute('data-count', String(cells.length));
    relabel();
    applySizes();
  }

  /** Name the grid, its cells and resizers in the active chart's language. */
  function relabel(): void {
    body.setAttribute('aria-label', t('gridLabel'));
    cells.forEach((c, i) => c.el.setAttribute('aria-label', t('gridCellOf', { n: i + 1, count: cells.length })));
    for (const r of resizers) {
      r.el.setAttribute('aria-label', t(r.axis === 'columns' ? 'gridResizeColumns' : 'gridResizeRows', { n: r.index + 1, next: r.index + 2 }));
    }
  }

  function applyLayout(next: ChartGridLayout): void {
    const previous = layout;
    const kept = cells.length;
    layout = next;
    const { columns, rows } = shape();
    const count = columns * rows;
    while (cells.length > count) destroyCell(cells.pop()!);
    try {
      while (cells.length < count) createCell(cells.length);
    } catch (error) {
      // Undo the cells made so far, so the grid keeps its previous layout rather than a partial one.
      while (cells.length > kept) destroyCell(cells.pop()!);
      layout = previous;
      throw error;
    }
    sizes = { columns: equal(columns), rows: equal(rows) };
    placeCells();
    activate(Math.min(activeIndex, count - 1));
  }

  let toolbar: ToolbarHandle | null = null;
  // Set once the handle exists; presets on the toolbar find the grid through it.
  let api: ChartGrid | undefined;
  try {
    applyLayout(layout);
  } catch (error) {
    // No WebGL2 or a shader error: leave the container as it was and let the app show its fallback.
    cells.splice(0).forEach(destroyCell);
    links.destroy();
    el.remove();
    throw error;
  }
  const guard = (method: string) => {
    if (destroyed) throw new ChartError('destroyed', `${method}() called after the chart grid was destroyed`);
  };

  api = {
    el,
    get toolbar() {
      return toolbar;
    },
    get cells() {
      return cells.map((c) => c.shell);
    },
    get charts() {
      return cells.map((c) => c.shell.chart);
    },
    links,
    get layout() {
      return layout;
    },
    setLayout(next) {
      guard('setLayout');
      if (!isLayout(next) || next === layout) return;
      applyLayout(next);
      emit('layout:change', { layout });
    },
    get sizes() {
      return { columns: [...sizes.columns], rows: [...sizes.rows] };
    },
    setSizes(patch) {
      guard('setSizes');
      const columns = patch.columns === undefined ? null : sanitizeSizes(patch.columns, sizes.columns.length);
      const rows = patch.rows === undefined ? null : sanitizeSizes(patch.rows, sizes.rows.length);
      if (!columns && !rows) return;
      sizes = { columns: columns ?? sizes.columns, rows: rows ?? sizes.rows };
      applySizes();
      emit('sizes:change', { columns: [...sizes.columns], rows: [...sizes.rows] });
    },
    get active() {
      return cells[activeIndex]!.shell;
    },
    get activeIndex() {
      return activeIndex;
    },
    setActive(index, opts = {}) {
      guard('setActive');
      activate(index, opts.focus ?? false);
    },
    get theme() {
      return theme;
    },
    setTheme(next) {
      theme = next;
      markTheme();
      for (const c of cells) c.shell.setTheme(next);
    },
    serializeLayout(opts = {}) {
      return {
        version: 1,
        layout,
        sizes: { columns: [...sizes.columns], rows: [...sizes.rows] },
        active: activeIndex,
        link: { ...links.options },
        charts: cells.map((c) => c.shell.chart.serializeLayout(opts)),
      };
    },
    loadLayout(data, opts = {}) {
      guard('loadLayout');
      const saved = parseGridState(data);
      const errors: LayoutLoadError[] = [...saved.errors];
      // The layout first: it is the one step that can throw, and a failure should leave the links as they were.
      if (saved.layout !== layout) {
        applyLayout(saved.layout);
        emit('layout:change', { layout });
      }
      if (saved.link) links.applyOptions(saved.link);
      // A missing list means equal sizes; a malformed one is reported and the current sizes stay.
      const restore = (axis: Axis, value: unknown): number[] => {
        const count = sizes[axis].length;
        if (value === undefined) return equal(count);
        const list = sanitizeSizes(value, count);
        if (list) return list;
        errors.push({ part: `sizes.${axis}`, reason: `expected one positive fraction per ${axis === 'columns' ? 'column' : 'row'}` });
        return sizes[axis];
      };
      const restored = { columns: restore('columns', saved.sizes?.columns), rows: restore('rows', saved.sizes?.rows) };
      const same = (a: readonly number[], b: readonly number[]) => a.every((v, i) => v === b[i]);
      if (!same(restored.columns, sizes.columns) || !same(restored.rows, sizes.rows)) {
        sizes = restored;
        applySizes();
        emit('sizes:change', { columns: [...sizes.columns], rows: [...sizes.rows] });
      }
      const results: LayoutLoadResult[] = [];
      saved.charts.slice(0, cells.length).forEach((chart, i) => {
        try {
          const result = cells[i]!.shell.chart.loadLayout(chart, opts);
          results.push(result);
          errors.push(...result.errors.map((e) => ({ ...e, part: `charts[${i}].${e.part}` })));
        } catch (error) {
          errors.push({ part: `charts[${i}]`, reason: error instanceof Error ? error.message : String(error) });
        }
      });
      if (saved.charts.length > cells.length) errors.push({ part: 'charts', reason: `only ${cells.length} cells in ${layout}` });
      if (saved.active !== null) activate(Math.min(saved.active, cells.length - 1));
      const pending = results.map((r) => r.ready).filter((p): p is Promise<void> => p !== null);
      return { errors, charts: results, ready: pending.length ? Promise.all(pending).then(() => undefined) : null };
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(listener);
      return () => set.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      toolbar?.destroy();
      links.destroy();
      cells.splice(0).forEach(destroyCell);
      listeners.clear();
      el.remove();
    },
  };
  if (options.toolbar && (!Array.isArray(options.toolbar) || options.toolbar.length)) {
    const mounted = mountToolbar(top, () => cells[activeIndex]!.shell.chart, options.toolbar, el);
    toolbar = mounted.handle;
    // Hide the whole strip, not just the toolbar, so no empty panel is left behind.
    mounted.visibility.onChange((visible) => (top.hidden = !visible));
  } else {
    top.remove();
  }
  return api;
}

interface ParsedGridState {
  layout: ChartGridLayout;
  sizes: { columns: unknown; rows: unknown } | null;
  active: number | null;
  link: Partial<LinkGroupOptions> | null;
  charts: unknown[];
  errors: LayoutLoadError[];
}

const LINK_KEYS = ['crosshair', 'visibleRange', 'symbol', 'interval', 'timezone', 'drawings'] as const;

/** Read a saved grid; throws only when `data` is not one at all. */
function parseGridState(data: unknown): ParsedGridState {
  const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!record(data) || data.version !== 1 || !isLayout(data.layout)) {
    throw new ChartError('invalid-layout', 'Invalid chart grid: expected version 1 and a known layout');
  }
  const errors: LayoutLoadError[] = [];
  let link: Partial<LinkGroupOptions> | null = null;
  if (record(data.link)) {
    link = {};
    for (const key of LINK_KEYS) {
      const value = data.link[key];
      if (typeof value === 'boolean') link[key] = value;
      else if (value !== undefined) errors.push({ part: `link.${key}`, reason: 'expected a boolean' });
    }
  } else if (data.link !== undefined) errors.push({ part: 'link', reason: 'expected an object' });
  let active: number | null = null;
  if (Number.isInteger(data.active) && (data.active as number) >= 0) active = data.active as number;
  else if (data.active !== undefined) errors.push({ part: 'active', reason: 'expected a cell index' });
  let sizes: ParsedGridState['sizes'] = null;
  if (record(data.sizes)) sizes = { columns: data.sizes.columns, rows: data.sizes.rows };
  else if (data.sizes !== undefined) errors.push({ part: 'sizes', reason: 'expected an object' });
  let charts: unknown[] = [];
  if (Array.isArray(data.charts)) charts = data.charts;
  else if (data.charts !== undefined) errors.push({ part: 'charts', reason: 'expected an array' });
  return { layout: data.layout, sizes, active, link, charts, errors };
}
