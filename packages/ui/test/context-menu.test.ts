import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chart, type ChartContextMenuEvent, type IndicatorDef, type Series } from '@chart-on/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { createAppearance } from '../src/appearance';
import {
  createContextMenu,
  defaultContextMenuItems,
  nextItem,
  placeMenu,
  tidySeparators,
  type ContextMenuHandle,
  type ContextMenuItem,
  type ContextMenuOptions,
} from '../src/context-menu';
import { INTERVAL_GROUPS, toggleIntervalGroup } from '../src/legend-menu';

const charts: Chart[] = [];
const menus: ContextMenuHandle[] = [];
afterEach(() => {
  menus.splice(0).forEach((m) => m.destroy());
  charts.splice(0).forEach((c) => c.destroy());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 10, high: 20, low: 0, close: 10 })));
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
  return c;
}

const event = (patch: Partial<ChartContextMenuEvent>): ChartContextMenuEvent => ({
  target: 'plot',
  x: 100,
  y: 100,
  clientX: 100,
  clientY: 100,
  pane: 0,
  time: 120,
  index: 2,
  price: 12.5,
  scale: 'right',
  drawing: null,
  ...patch,
});

const ids = (items: ContextMenuItem[]) => items.map((i) => (i.type === 'separator' ? '-' : i.type === 'label' ? `# ${i.label}` : i.id));
const pick = (items: ContextMenuItem[], id: string) => {
  const item = items.find((i) => (i.type === 'action' || i.type === 'check') && i.id === id);
  if (!item || (item.type !== 'action' && item.type !== 'check')) throw new Error(`no item ${id}`);
  return item;
};

describe('default context menu items', () => {
  it('offers view, price and scale items on the plot', () => {
    const c = chart();
    const items = defaultContextMenuItems(c, event({}));
    expect(ids(items)).toEqual([
      'reset-view',
      'copy-price',
      'add-horizontal-line',
      'add-vertical-line',
      '-',
      'auto-scale',
      'log-scale',
      'percent-scale',
    ]);
    pick(items, 'add-horizontal-line').onSelect();
    expect(c.drawings.getAll()).toMatchObject([{ type: 'hline', pane: 0, points: [{ time: 120, price: 12.5 }] }]);
  });

  it('adds an undoable vertical line at the bar time, labelled with the chart time format', () => {
    const c = chart();
    const item = pick(defaultContextMenuItems(c, event({ pane: 0 })), 'add-vertical-line');
    expect(item.label).toBe(`Add vertical line at ${c.formatTime(120)}`);
    item.onSelect();
    expect(c.drawings.getAll()).toMatchObject([{ type: 'vline', pane: 0, points: [{ time: 120 }] }]);
    expect(c.drawings.undo()).toBe(true);
    expect(c.drawings.getAll()).toEqual([]);
  });

  it('leaves out the vertical line off the plot or with no bar under the pointer', () => {
    const c = chart();
    expect(ids(defaultContextMenuItems(c, event({ time: null, index: null })))).not.toContain('add-vertical-line');
    expect(ids(defaultContextMenuItems(c, event({ target: 'priceAxis' })))).not.toContain('add-vertical-line');
    expect(ids(defaultContextMenuItems(c, event({ target: 'timeAxis', pane: -1, price: null, scale: null })))).not.toContain(
      'add-vertical-line',
    );
  });

  it('toggles scale modes and reflects them as checked', () => {
    const c = chart();
    pick(defaultContextMenuItems(c, event({})), 'log-scale').onSelect();
    expect(c.getPriceScaleMode(0)).toBe('log');
    const items = defaultContextMenuItems(c, event({}));
    expect(pick(items, 'log-scale')).toMatchObject({ checked: true });
    pick(items, 'log-scale').onSelect();
    expect(c.getPriceScaleMode(0)).toBe('normal');
    pick(items, 'auto-scale').onSelect();
    expect(c.isAutoScale(0)).toBe(false);
  });

  it('leaves out the horizontal line when no bar is under the pointer', () => {
    const c = chart();
    const items = defaultContextMenuItems(c, event({ time: null, index: null }));
    expect(ids(items)).not.toContain('add-horizontal-line');
    expect(ids(items)).toContain('copy-price');
  });

  it('returns the clipboard write, rejecting when there is no clipboard', async () => {
    const c = chart();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await pick(defaultContextMenuItems(c, event({})), 'copy-price').onSelect();
    expect(writeText).toHaveBeenCalledWith(c.formatAxis(0, 12.5, 'right'));
    vi.stubGlobal('navigator', {});
    await expect(pick(defaultContextMenuItems(c, event({})), 'copy-price').onSelect()).rejects.toThrow();
  });

  it('adds invert on the price axis and leaves out plot-only items', () => {
    const c = chart();
    const items = defaultContextMenuItems(c, event({ target: 'priceAxis', time: null, index: null }));
    expect(ids(items)).toEqual(['copy-price', '-', 'auto-scale', 'log-scale', 'percent-scale', 'invert-scale']);
    pick(items, 'invert-scale').onSelect();
    expect(c.getPriceScaleOptions(0)?.invert).toBe(true);
  });

  it('offers view items on the time axis', () => {
    const c = chart();
    const items = defaultContextMenuItems(c, event({ target: 'timeAxis', pane: -1, price: null, scale: null }));
    expect(ids(items)).toEqual(['reset-view', 'scroll-to-newest']);
  });

  it('offers lock, clone and delete on a drawing', () => {
    const c = chart();
    const d = c.drawings.add({ type: 'hline', pane: 0, points: [{ time: 0, price: 12 }], style: {} });
    const items = defaultContextMenuItems(c, event({ target: 'drawing', drawing: d.id }));
    expect(ids(items)).toEqual(['lock-drawing', 'clone-drawing', 'remove-drawing']);
    pick(items, 'lock-drawing').onSelect();
    expect(c.drawings.getAll()[0]!.locked).toBe(true);
    expect(pick(defaultContextMenuItems(c, event({ target: 'drawing', drawing: d.id })), 'lock-drawing').label).toBe('Unlock');
    pick(items, 'clone-drawing').onSelect();
    expect(c.drawings.getAll()).toHaveLength(2);
    pick(items, 'remove-drawing').onSelect();
    expect(c.drawings.getAll().map((x) => x.id)).not.toContain(d.id);
  });

  it('groups the selection and ungroups a drawing\'s group', () => {
    const c = chart();
    const line = (price: number) => c.drawings.add({ type: 'hline', pane: 0, points: [{ time: 0, price }], style: {} });
    const a = line(12);
    const b = line(13);
    const menu = (id: string) => ids(defaultContextMenuItems(c, event({ target: 'drawing', drawing: id })));
    expect(menu(a.id)).not.toContain('group-drawings');
    c.drawings.setSelection([a.id, b.id]);
    pick(defaultContextMenuItems(c, event({ target: 'drawing', drawing: a.id })), 'group-drawings').onSelect();
    expect(c.drawings.groups).toEqual([{ name: 'Group 1', ids: [a.id, b.id] }]);
    expect(menu(a.id)).toEqual(['lock-drawing', 'clone-drawing', 'remove-drawing', 'ungroup-drawings']);
    c.drawings.select(null);
    pick(defaultContextMenuItems(c, event({ target: 'drawing', drawing: b.id })), 'ungroup-drawings').onSelect();
    expect(c.drawings.groups).toEqual([]);
  });
});

describe('appearance item', () => {
  it('opens the appearance panel from the plot menu when the chart has one', () => {
    const c = chart();
    expect(ids(defaultContextMenuItems(c, event({}))).includes('appearance')).toBe(false);
    const appearance = createAppearance(c, { storage: null });
    const open = vi.spyOn(appearance, 'open').mockImplementation(() => {});
    const items = defaultContextMenuItems(c, event({}));
    expect(ids(items).slice(-2)).toEqual(['-', 'appearance']);
    pick(items, 'appearance').onSelect();
    expect(open).toHaveBeenCalled();
    expect(ids(defaultContextMenuItems(c, event({ target: 'priceAxis', time: null, index: null }))).includes('appearance')).toBe(false);
    appearance.destroy();
  });
});

describe('menu helpers', () => {
  it('drops leading, trailing and repeated separators', () => {
    const a: ContextMenuItem = { type: 'action', id: 'a', label: 'A', onSelect() {} };
    const sep: ContextMenuItem = { type: 'separator' };
    expect(ids(tidySeparators([sep, a, sep, sep, a, sep]))).toEqual(['a', '-', 'a']);
    expect(tidySeparators([sep])).toEqual([]);
  });

  it('moves between enabled items and wraps', () => {
    const enabled = [true, false, true, true];
    expect(nextItem(enabled, -1, 1)).toBe(0);
    expect(nextItem(enabled, 0, 1)).toBe(2);
    expect(nextItem(enabled, 3, 1)).toBe(0);
    expect(nextItem(enabled, 0, -1)).toBe(3);
    expect(nextItem(enabled, 4, -1)).toBe(3);
    expect(nextItem([false], 0, 1)).toBe(0);
  });

  it('opens at the pointer and flips near the edges', () => {
    const area = { width: 800, height: 600 };
    const size = { width: 200, height: 150 };
    expect(placeMenu({ x: 100, y: 100 }, size, area)).toEqual({ x: 100, y: 100 });
    expect(placeMenu({ x: 700, y: 500 }, size, area)).toEqual({ x: 500, y: 350 });
    expect(placeMenu({ x: 100, y: 590 }, { width: 200, height: 700 }, area)).toEqual({ x: 100, y: 4 });
  });
});

type El = HTMLElement & { children: El[]; tagName: string };

describe('context menu in the page', () => {
  function mount(options: ContextMenuOptions = {}) {
    const c = chart();
    const menu = createContextMenu(c, options);
    menus.push(menu);
    return { c, menu };
  }
  const rightClick = (target: unknown, x = 200, y = 100) => dispatch(target, 'contextmenu', { button: 2, clientX: x, clientY: y });
  const buttons = (menu: ContextMenuHandle) => (menu.el as El).children.filter((b) => b.tagName === 'button');
  const key = (k: string) => dispatch(document.activeElement, 'keydown', { key: k });
  const focused = (menu: ContextMenuHandle) => buttons(menu).indexOf(document.activeElement as El);
  /** Outside-press and Escape listeners attach after the opening event. */
  const settle = () => new Promise((r) => setTimeout(r));
  const action = (id: string, extra: Partial<ContextMenuItem> = {}): ContextMenuItem =>
    ({ type: 'action', id, label: id, onSelect: vi.fn(), ...extra }) as ContextMenuItem;

  it('opens on right click, replacing the browser menu, with the first item focused', () => {
    const { c, menu } = mount();
    expect(rightClick(c.root).defaultPrevented).toBe(true);
    expect(menu.el?.getAttribute('role')).toBe('menu');
    expect(c.root.contains(menu.el)).toBe(true);
    expect(focused(menu)).toBe(0);
  });

  it('does not reopen or select a drawing when the menu itself is right-clicked', () => {
    const { c, menu } = mount();
    const opened = vi.fn();
    c.on('chart:contextmenu', opened);
    rightClick(c.root);
    const el = menu.el;
    c.drawings.add({ type: 'hline', pane: 0, points: [{ time: 0, price: c.panes[0]!.primary.yToPrice(100) }], style: {} });
    expect(rightClick(buttons(menu)[0]).defaultPrevented).toBe(true);
    expect(opened).toHaveBeenCalledOnce();
    expect(menu.el).toBe(el);
    expect(c.drawings.selected).toBeNull();
  });

  it('moves focus with arrows, Home and End, skipping disabled items', () => {
    const { c, menu } = mount({ items: () => [action('a'), action('b', { disabled: true }), action('c'), action('d')] });
    rightClick(c.root);
    key('ArrowDown');
    expect(focused(menu)).toBe(2);
    key('End');
    expect(focused(menu)).toBe(3);
    key('ArrowDown');
    expect(focused(menu)).toBe(0);
    key('ArrowUp');
    expect(focused(menu)).toBe(3);
    key('Home');
    expect(focused(menu)).toBe(0);
  });

  it('keeps its keys away from the chart', () => {
    const { c } = mount();
    rightClick(c.root);
    const before = c.time.rightOffset;
    key('ArrowLeft');
    expect(c.time.rightOffset).toBe(before);
  });

  it('closes on Escape and returns focus to the chart', () => {
    const { c, menu } = mount();
    rightClick(c.root);
    key('Escape');
    expect(menu.el).toBeNull();
    expect(document.activeElement).toBe(c.root);
  });

  it('runs the picked item, then closes and returns focus', () => {
    const pickMe = action('pick');
    const { c, menu } = mount({ items: () => [pickMe] });
    rightClick(c.root);
    dispatch(buttons(menu)[0], 'click');
    expect(pickMe.type === 'action' && pickMe.onSelect).toHaveBeenCalledOnce();
    expect(menu.el).toBeNull();
    expect(document.activeElement).toBe(c.root);
  });

  it('closes on a press outside, but not on one inside', async () => {
    const { c, menu } = mount();
    rightClick(c.root);
    await settle();
    dispatch(buttons(menu)[0], 'pointerdown');
    expect(menu.el).not.toBeNull();
    dispatch(c.root, 'pointerdown', { clientX: 400, clientY: 300 });
    expect(menu.el).toBeNull();
  });

  it('shows an icon for checked items and none for unchecked ones', () => {
    const { c, menu } = mount({
      items: () => [
        { type: 'check', id: 'on', label: 'On', checked: true, onSelect() {} },
        { type: 'check', id: 'off', label: 'Off', checked: false, onSelect() {} },
      ],
    });
    rightClick(c.root);
    const [on, off] = buttons(menu).map((b) => b.children[0]!);
    expect(on!.children.map((n) => n.tagName)).toEqual(['svg']);
    expect(on!.textContent).toBe('');
    expect(off!.children).toEqual([]);
  });

  it('reports items that fail instead of dropping the error', async () => {
    const onError = vi.fn();
    const boom = new Error('denied');
    const { c, menu } = mount({
      onError,
      items: () => [action('async', { onSelect: () => Promise.reject(boom) }), action('sync', { onSelect: () => { throw boom; } })],
    });
    rightClick(c.root);
    dispatch(buttons(menu)[0], 'click');
    await settle();
    expect(onError).toHaveBeenLastCalledWith(boom, 'async');
    rightClick(c.root);
    dispatch(buttons(menu)[1], 'click');
    expect(onError).toHaveBeenLastCalledWith(boom, 'sync');
  });

  it('logs failures without an onError, e.g. a denied clipboard', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const denied = new Error('denied');
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(denied) } });
    const { c, menu } = mount();
    rightClick(c.root);
    const copy = buttons(menu).find((b) => b.children[1]!.textContent.startsWith('Copy price'))!;
    dispatch(copy, 'click');
    await settle();
    expect(error).toHaveBeenCalledWith(expect.any(String), denied);
  });

  it('suppresses the browser menu even when there are no items', () => {
    const { c, menu } = mount({ items: () => [] });
    expect(rightClick(c.root).defaultPrevented).toBe(true);
    expect(menu.el).toBeNull();
  });

  it('closes and stops listening on destroy', async () => {
    const { c, menu } = mount();
    rightClick(c.root);
    await settle();
    const el = menu.el;
    menu.destroy();
    expect(menu.el).toBeNull();
    expect(c.root.contains(el)).toBe(false);
    expect(rightClick(c.root).defaultPrevented).toBe(false);
    expect(menu.el).toBeNull();
  });
});

describe('legend row menu items', () => {
  const osc: IndicatorDef = {
    id: 'test/osc',
    name: 'Osc',
    placement: 'pane',
    inputs: [{ id: 'length', type: 'number', default: 14 }],
    plots: [{ id: 'v', type: 'line' }],
    compute: (src) => ({ v: Float64Array.from(src.close) }),
  };
  const avg: IndicatorDef = { ...osc, id: 'test/avg', name: 'Avg', placement: 'overlay' };
  const legend = (c: Chart, series: Series) => defaultContextMenuItems(c, event({ target: 'legend', series, time: null, index: null, price: null, scale: null }));
  const sub = (items: ContextMenuItem[], id: string) => {
    const item = items.find((i) => i.type === 'submenu' && i.id === id);
    if (item?.type !== 'submenu') throw new Error(`no submenu ${id}`);
    return item.items;
  };

  it('heads the menu with the indicator and its parameters, and offers what applies', () => {
    const c = chart();
    const ind = c.indicators.add(osc);
    c.indicators.add({ ...osc, id: 'test/osc2' });
    expect(ids(legend(c, ind.series!))).toEqual([
      '# Osc 14',
      'duplicate',
      '-',
      'move-down',
      'move-to-price-pane',
      'merge-into-pane',
      '-',
      'scale',
      'show-on',
      'fold-legend',
      '-',
      'remove',
    ]);
    c.on('series:settings', () => {});
    expect(ids(legend(c, ind.series!)).slice(0, 2)).toEqual(['# Osc 14', 'series-settings']);
    expect(pick(legend(c, ind.series!), 'remove')).toMatchObject({ danger: true });
  });

  it('keeps the main series to settings and folding', () => {
    const c = chart();
    const main = c.panes[0]!.series[0]!;
    expect(ids(tidySeparators(legend(c, main)))).toEqual(['# Price', 'fold-legend']);
  });

  it('moves, merges and removes through the menu', () => {
    const c = chart();
    const a = c.indicators.add(osc);
    const b = c.indicators.add(avg);
    pick(legend(c, b.series!), 'move-to-new-pane').onSelect();
    expect(c.panes).toHaveLength(3);
    expect(c.panes.indexOf(b.pane!)).toBe(1);
    // Merge into a's pane, now the third.
    const merge = sub(legend(c, b.series!), 'merge-into-pane');
    expect(merge.map((i) => (i.type === 'action' ? i.label : ''))).toEqual(['Pane 3: Osc 14']);
    const into = merge[0]!;
    if (into.type === 'action') into.onSelect();
    expect(b.pane).toBe(a.pane);
    expect(c.panes).toHaveLength(2);
    pick(legend(c, b.series!), 'move-to-price-pane').onSelect();
    expect(b.pane).toBe(c.panes[0]);
    pick(legend(c, b.series!), 'move-down').onSelect();
    expect(b.pane).toBe(a.pane);
    pick(legend(c, b.series!), 'remove').onSelect();
    expect(c.indicators.getAll()).toEqual([a]);
  });

  it("removes a plain series' pane once empty, unless it holds drawings", () => {
    const c = chart();
    const lone = c.addLine({}, c.addPane());
    const drawn = c.addPane();
    const line = c.addLine({}, drawn);
    c.drawings.add({ type: 'hline', pane: 2, points: [{ time: 60, price: 1 }], style: {} });
    pick(legend(c, lone), 'remove').onSelect();
    expect(c.panes).toEqual([c.panes[0], drawn]);
    pick(legend(c, line), 'remove').onSelect();
    expect(c.panes).toEqual([c.panes[0], drawn]);
  });

  it('duplicates, folds and opens settings', () => {
    const c = chart();
    const ind = c.indicators.add(osc, { length: 9 });
    pick(legend(c, ind.series!), 'duplicate').onSelect();
    expect(c.indicators.getAll().map((i) => i.inputs.length)).toEqual([9, 9]);
    pick(legend(c, ind.series!), 'fold-legend').onSelect();
    expect(c.isLegendFolded(ind.series!)).toBe(true);
    expect(pick(legend(c, ind.series!), 'fold-legend')).toMatchObject({ checked: true });
    const seen: unknown[] = [];
    c.on('series:settings', (e) => seen.push(e.indicator));
    pick(legend(c, ind.series!), 'series-settings').onSelect();
    expect(seen).toEqual([ind]);
  });

  it('limits an indicator to interval groups', () => {
    const c = chart();
    const ind = c.indicators.add(avg);
    const showOn = () => sub(legend(c, ind.series!), 'show-on');
    expect(showOn().filter((i) => i.type === 'check' && i.checked)).toHaveLength(INTERVAL_GROUPS.length + 1);
    const hours = () => pick(showOn(), 'show-on-hours');
    hours().onSelect();
    expect(ind.visibleOn).toHaveLength(INTERVAL_GROUPS.length - 1);
    expect(hours()).toMatchObject({ checked: false });
    expect(pick(showOn(), 'show-on-all')).toMatchObject({ checked: false });
    hours().onSelect();
    expect(ind.visibleOn).toBeNull();
  });

  it('moves an indicator between the right, left and an own scale', () => {
    const c = chart();
    const ind = c.indicators.add(avg);
    const scale = () => sub(legend(c, ind.series!), 'scale');
    const checked = () => scale().flatMap((i) => (i.type === 'check' && i.checked ? [i.id] : []));
    expect(ids(scale())).toEqual(['scale-right', 'scale-left', 'scale-own']);
    expect(checked()).toEqual(['scale-right']);
    pick(scale(), 'scale-left').onSelect();
    expect(ind.priceScale).toBe('left');
    expect(checked()).toEqual(['scale-left']);
    pick(scale(), 'scale-own').onSelect();
    const own = ind.priceScale;
    expect(['right', 'left']).not.toContain(own);
    expect(checked()).toEqual(['scale-own']);
    // Picked again it keeps the scale it has.
    pick(scale(), 'scale-own').onSelect();
    expect(ind.priceScale).toBe(own);
    // Another indicator gets a scale of its own, not this one's.
    const other = c.indicators.add({ ...avg, id: 'test/avg2' });
    pick(sub(legend(c, other.series!), 'scale'), 'scale-own').onSelect();
    expect(other.priceScale).not.toBe(own);
    pick(scale(), 'scale-right').onSelect();
    expect(ind.priceScale).toBe('right');
  });

  it('toggles interval groups, never down to none', () => {
    const [minutes, hours] = [INTERVAL_GROUPS[1]!.range, INTERVAL_GROUPS[2]!.range];
    expect(toggleIntervalGroup([minutes], hours)).toEqual([minutes, hours]);
    expect(toggleIntervalGroup([minutes, hours], hours)).toEqual([minutes]);
    expect(toggleIntervalGroup([minutes], minutes)).toEqual([minutes]);
    const allButHours = INTERVAL_GROUPS.filter((g) => g.range !== hours).map((g) => g.range);
    expect(toggleIntervalGroup(allButHours, hours)).toBeNull();
    expect(toggleIntervalGroup(null, hours)).toEqual(allButHours);
  });

  describe('undo', () => {
    /**
     * Panes (heights, scales) and indicators as a layout saves them. A left
     * scale no series uses has no axis and stays, as when Right is picked again.
     */
    const state = (c: Chart) => {
      const { meta: _, panes, ...rest } = c.serializeLayout();
      const unused = (i: number) => !c.panes[i]!.series.some((s) => s.scale.id === 'left');
      for (const [i, pane] of (panes ?? []).entries()) if (unused(i)) delete pane.scales?.left;
      return JSON.stringify({ panes, ...rest });
    };
    /** Main, an overlay in the price pane, and two pane indicators in panes 2 and 3 with uneven heights. */
    function setup() {
      const c = chart();
      const over = c.indicators.add(avg);
      const a = c.indicators.add(osc);
      const b = c.indicators.add({ ...osc, id: 'test/osc2' }, { length: 9 });
      c.setPaneHeights([5, 2, 1]);
      c.history.clear();
      return { c, over, a, b };
    }
    /** `run` makes one undo step: undo brings everything back, redo makes the change again. */
    function oneStep(c: Chart, run: () => void) {
      c.history.clear();
      const before = state(c);
      run();
      const after = state(c);
      expect(after).not.toBe(before);
      expect(c.history.undo()).toBe(true);
      expect(state(c)).toBe(before);
      expect(c.history.canUndo).toBe(false);
      expect(c.history.redo()).toBe(true);
      expect(state(c)).toBe(after);
      expect(c.history.canRedo).toBe(false);
    }
    const select = (item: ContextMenuItem | undefined) => {
      if (item?.type !== 'action' && item?.type !== 'check') throw new Error('not an item');
      item.onSelect();
    };

    it('makes duplicate and remove one step each, in any pane', () => {
      const { c, over, a, b } = setup();
      for (const ind of [over, a, b]) oneStep(c, () => pick(legend(c, ind.series!), 'duplicate').onSelect());
      for (const ind of [over, a, b]) oneStep(c, () => pick(legend(c, ind.series!), 'remove').onSelect());
    });

    it('makes each move and merge one step, keeping pane heights', () => {
      type Setup = ReturnType<typeof setup>;
      const cases: ((s: Setup) => void)[] = [
        ({ c, b }) => pick(legend(c, b.series!), 'move-up').onSelect(),
        ({ c, a }) => pick(legend(c, a.series!), 'move-down').onSelect(),
        ({ c, a }) => pick(legend(c, a.series!), 'move-to-price-pane').onSelect(),
        ({ c, over }) => pick(legend(c, over.series!), 'move-to-new-pane').onSelect(),
        ({ c, over }) => select(sub(legend(c, over.series!), 'merge-into-pane')[1]),
        ({ c, a }) => select(sub(legend(c, a.series!), 'merge-into-pane')[0]),
      ];
      for (const run of cases) {
        const s = setup();
        oneStep(s.c, () => run(s));
      }
      // Out of the price pane into a new one, which undo removes again.
      const { c, a } = setup();
      c.moveSeries(a.series!, c.panes[0]!);
      oneStep(c, () => pick(legend(c, a.series!), 'move-to-new-pane').onSelect());
    });

    it('makes each scale and interval choice one step', () => {
      const { c, over, b } = setup();
      for (const ind of [over, b]) {
        oneStep(c, () => pick(sub(legend(c, ind.series!), 'scale'), 'scale-left').onSelect());
        oneStep(c, () => pick(sub(legend(c, ind.series!), 'scale'), 'scale-own').onSelect());
        oneStep(c, () => pick(sub(legend(c, ind.series!), 'scale'), 'scale-right').onSelect());
        oneStep(c, () => pick(sub(legend(c, ind.series!), 'show-on'), 'show-on-hours').onSelect());
        oneStep(c, () => pick(sub(legend(c, ind.series!), 'show-on'), 'show-on-all').onSelect());
      }
    });

    it('records nothing for folding or opening settings', () => {
      const { c, a } = setup();
      c.on('series:settings', () => {});
      pick(legend(c, a.series!), 'fold-legend').onSelect();
      pick(legend(c, a.series!), 'series-settings').onSelect();
      expect(c.history.canUndo).toBe(false);
    });
  });
});

describe('menu submenus and headings in the page', () => {
  type El = HTMLElement & { children: El[]; tagName: string; className: string; textContent: string };
  function mount(items: ContextMenuItem[]) {
    const c = chart();
    const menu = createContextMenu(c, { items: () => items });
    menus.push(menu);
    dispatch(c.root, 'contextmenu', { button: 2, clientX: 200, clientY: 100 });
    return { c, menu, el: menu.el as El };
  }
  const key = (k: string) => dispatch(document.activeElement, 'keydown', { key: k });
  const buttonsOf = (el: El) => el.children.filter((b) => b.tagName === 'button');
  const subOf = (el: El) => el.children.find((b) => b.className.includes('pc-context-submenu'));

  it('shows a heading that names the menu and is no item', () => {
    const { el } = mount([{ type: 'label', label: 'RSI 14' }, { type: 'action', id: 'a', label: 'A', onSelect() {} }]);
    expect(el.getAttribute('aria-label')).toBe('RSI 14');
    expect(el.children[0]!.className).toBe('pc-menu-label');
    expect(el.children[0]!.textContent).toBe('RSI 14');
    expect(document.activeElement).toBe(buttonsOf(el)[0]);
  });

  it('opens a submenu with Arrow Right and closes it with Arrow Left, keeping focus in step', () => {
    const picked = vi.fn();
    const { menu, el } = mount([
      { type: 'action', id: 'a', label: 'A', onSelect() {} },
      { type: 'submenu', id: 's', label: 'More', items: [{ type: 'action', id: 'x', label: 'X', onSelect: picked }] },
    ]);
    key('ArrowDown');
    const opener = buttonsOf(el)[1]!;
    expect(document.activeElement).toBe(opener);
    expect(opener.getAttribute('aria-haspopup')).toBe('menu');
    key('ArrowRight');
    const sub = subOf(el)!;
    expect(sub).toBeDefined();
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(buttonsOf(sub)[0]);
    key('ArrowLeft');
    expect(subOf(el)).toBeUndefined();
    expect(document.activeElement).toBe(opener);
    // Escape in a submenu closes only the submenu.
    key('Enter');
    key('Escape');
    expect(menu.el).not.toBeNull();
    expect(document.activeElement).toBe(opener);
    key('ArrowRight');
    dispatch(document.activeElement, 'click');
    expect(picked).toHaveBeenCalledOnce();
    expect(menu.el).toBeNull();
  });

  it('marks destructive actions', () => {
    const { el } = mount([{ type: 'action', id: 'rm', label: 'Remove', danger: true, onSelect() {} }]);
    expect(buttonsOf(el)[0]!.className).toContain('pc-menu-danger');
  });

  it('drops empty submenus and separators after a heading', () => {
    expect(
      ids(
        tidySeparators([
          { type: 'label', label: 'H' },
          { type: 'separator' },
          { type: 'submenu', id: 'empty', label: 'E', items: [{ type: 'separator' }] },
          { type: 'action', id: 'a', label: 'A', onSelect() {} },
        ]),
      ),
    ).toEqual(['# H', 'a']);
  });

  it("opens a legend row's menu from the chart", () => {
    const c = chart();
    const menu = createContextMenu(c);
    menus.push(menu);
    const ind = c.indicators.add({
      id: 'test/osc',
      name: 'Osc',
      placement: 'pane',
      inputs: [],
      plots: [{ id: 'v', type: 'line' }],
      compute: (src) => ({ v: Float64Array.from(src.close) }),
    });
    expect(c.openLegendMenu(ind.series!, 50, 60)).toBe(true);
    expect(menu.el?.getAttribute('aria-label')).toBe('Osc');
  });
});
