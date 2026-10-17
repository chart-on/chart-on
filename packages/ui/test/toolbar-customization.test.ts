import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chart, type IndicatorDef, type SettingsAdapter } from '@charton/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { findIn } from '../src/dialog';
import { createToolbar, type ToolbarHandle, type ToolbarItem } from '../src/toolbar';
import { toolbarCustomization } from '../src/toolbar-customization';
import { createChartShell } from '../src/shell';
import { createChartGrid } from '../src/grid';

const charts: Chart[] = [];
const bars: ToolbarHandle[] = [];
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', paddingRight: '0' }));
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
  fakeContainer();
  Object.assign(document, { documentElement: { clientWidth: 1280, clientHeight: 800 } });
});
afterEach(() => {
  cleanups.splice(0).forEach((off) => off());
  bars.splice(0).forEach((bar) => bar.destroy());
  charts.splice(0).forEach((chart) => chart.destroy());
  vi.unstubAllGlobals();
});
const action = (id: string, group: 'analysis' | 'context' | 'view' = 'analysis'): ToolbarItem => ({ type: 'button', id, label: id, group, onClick() {} });
const defaults = () => [action('symbol', 'context'), action('a'), action('b')];
function memory(): SettingsAdapter {
  const values = new Map<string, string>();
  return { get: (key) => values.get(key) ?? null, set: (key, value) => { values.set(key, value); }, remove: (key) => { values.delete(key); } };
}
function setup(settings: SettingsAdapter | null = memory(), items = defaults()) {
  const host = fakeContainer();
  const chart = new Chart(fakeContainer());
  charts.push(chart);
  const toolbar = createToolbar(host, chart, { items, customize: toolbarCustomization({ locked: ['symbol'] }), settings });
  bars.push(toolbar);
  const panel = () => host.querySelector<HTMLElement>('.pc-toolbar-customization')!;
  const control = (id: string, kind: string) => findIn(panel(), (el) => el.getAttribute('data-action') === id && el.getAttribute('data-control') === kind)!;
  const toggle = (id: string, checked: boolean) => { const el = control(id, 'toggle') as HTMLInputElement; el.checked = checked; dispatch(el, 'change'); };
  const actionId = (label: string) => findIn(panel(), (el) => el.tagName.toLowerCase() === 'input' && el.getAttribute('aria-label') === label)!.getAttribute('data-action')!;
  return { host, chart, toolbar, panel, control, toggle, actionId };
}
const ids = (toolbar: ToolbarHandle) => toolbar.items.filter((item) => item.id !== undefined && !item.hidden).map((item) => item.id);

describe('end-user toolbar', () => {
  it("shows each item's own icon in its row, with an empty slot for items without one", () => {
    const glyph = '<svg viewBox="0 0 24 24"><path d="M4 12h16"/></svg>';
    const s = setup(memory(), [action('symbol', 'context'), { ...action('a'), icon: glyph } as ToolbarItem, action('b')]);
    s.toolbar.openCustomization();
    const slot = (id: string) => findIn(s.panel(), (el) => el.getAttribute('data-action') === id && el.className === 'pc-toolbar-action')!.querySelector('.pc-toolbar-action-icon')!;
    expect(slot('a').getAttribute('aria-hidden')).toBe('true');
    expect(slot('a').children.length).toBe(1);
    expect(slot('b').children.length).toBe(0);
  });

  it('persists keyboard-button moves and removals, restores locks, and resets to app defaults', () => {
    const settings = memory();
    const first = setup(settings);
    const changed = vi.fn();
    first.toolbar.on('change', changed);
    first.toolbar.openCustomization();
    expect((first.control('symbol', 'toggle') as HTMLInputElement).disabled).toBe(true);
    const up = first.control('b', 'up') as HTMLButtonElement;
    expect(up.tagName.toLowerCase()).toBe('button');
    expect(up.getAttribute('type')).toBe('button');
    expect(up.disabled).toBe(false);
    dispatch(up, 'click', { detail: 0 });
    expect(ids(first.toolbar)).toEqual(['symbol', 'b', 'a']);
    expect(document.activeElement).toBe(first.control('b', 'toggle'));
    first.toggle('a', false);
    expect(changed).toHaveBeenLastCalledWith({ ids: ['symbol', 'b'] });
    const second = setup(settings);
    expect(ids(second.toolbar)).toEqual(['symbol', 'b']);
    second.toolbar.openCustomization();
    const reset = second.panel().querySelector('.pc-dialog-footer')!.children[0]!;
    dispatch(reset, 'click');
    expect(settings.get('toolbar')).toBeNull();
    expect(ids(second.toolbar)).toEqual(['symbol', 'a', 'b']);
  });

  it('adds built-ins and host actions, handles empty and invalid saved layouts', () => {
    const settings = memory();
    settings.set('toolbar', '{"version":1,"ids":["missing","symbol"]}');
    const s = setup(settings);
    expect(ids(s.toolbar)).toEqual(['symbol']);
    const click = vi.fn();
    const unregister = s.toolbar.registerAction({ id: 'host', label: 'Host action', onClick: click });
    s.toolbar.openCustomization();
    s.toggle('host', true);
    s.toggle('screenshot', true);
    dispatch(s.toolbar.get('host')!.el, 'click');
    expect(click).toHaveBeenCalled();
    expect(ids(s.toolbar)).toEqual(['symbol', 'host', 'screenshot']);
    expect(() => s.toolbar.registerAction({ id: 'host', label: 'Duplicate', onClick() {} })).toThrow(/Duplicate/);
    unregister();
    expect(s.toolbar.get('host')).toBeUndefined();
    settings.set('toolbar', '{"version":1,"ids":[]}');
    expect(ids(setup(settings).toolbar)).toEqual(['symbol']);
    settings.set('toolbar', '{bad');
    expect(ids(setup(settings).toolbar)).toEqual(['symbol', 'a', 'b']);
  });

  it('reorders from handle keys and drag drops, with group and lock barriers', () => {
    const s = setup(null, [...defaults(), action('view', 'view')]);
    s.toolbar.openCustomization();
    dispatch(s.control('b', 'drag'), 'keydown', { key: 'ArrowUp' });
    expect(ids(s.toolbar)).toEqual(['symbol', 'b', 'a', 'view']);
    expect(document.activeElement).toBe(s.control('b', 'drag'));
  });

  it('drags rows live with the pointer, keeps group and lock barriers, and restores on Escape', () => {
    const s = setup(null, [...defaults(), action('c'), action('view', 'view')]);
    s.toolbar.openCustomization();
    const list = () => s.panel().querySelector('.pc-toolbar-action-list')!;
    const rowOf = (id: string) => findIn(s.panel(), (el) => el.className === 'pc-toolbar-action' && el.getAttribute('data-action') === id)!;
    const order = () => [...list().children].filter((el) => el.className === 'pc-toolbar-action').map((el) => el.getAttribute('data-action')).slice(0, 5);
    // Rows and section labels stack 40px apart in list order.
    const slide = vi.fn();
    const layout = () => {
      for (const el of [...list().children]) {
        Object.assign(el, { animate: slide, getBoundingClientRect: () => ({ top: [...list().children].indexOf(el) * 40, height: 40 }) });
      }
    };
    const press = (id: string, y: number) => { layout(); dispatch(s.control(id, 'drag'), 'pointerdown', { button: 0, pointerId: 1, clientY: y }); };
    const pointer = (type: string, y: number) => dispatch(document as unknown as HTMLElement, type, { pointerId: 1, clientY: y });
    // List: context label, symbol, analysis label, a, b, c, view label, view.
    expect(order()).toEqual(['symbol', 'a', 'b', 'c', 'view']);

    press('a', 140);
    pointer('pointermove', 142);
    expect(rowOf('a').getAttribute('data-dragging')).toBeNull();
    pointer('pointermove', 230);
    expect(rowOf('a').getAttribute('data-dragging')).toBe('true');
    expect(order()).toEqual(['symbol', 'b', 'c', 'a', 'view']);
    expect(rowOf('a').style.transform).toMatch(/^translateY\(/);
    // The test environment asks for reduced motion: rows jump without sliding.
    expect(slide).not.toHaveBeenCalled();
    expect(ids(s.toolbar)).toEqual(['symbol', 'a', 'b', 'c', 'view']);
    // Past the group and the locked item the row stays at its last valid place.
    pointer('pointermove', 300);
    expect(order()).toEqual(['symbol', 'b', 'c', 'a', 'view']);
    pointer('pointermove', 20);
    expect(order()).toEqual(['symbol', 'b', 'c', 'a', 'view']);
    pointer('pointermove', 100);
    expect(order()).toEqual(['symbol', 'a', 'b', 'c', 'view']);
    pointer('pointermove', 190);
    pointer('pointerup', 190);
    expect(ids(s.toolbar)).toEqual(['symbol', 'b', 'a', 'c', 'view']);
    expect(rowOf('a').getAttribute('data-dragging')).toBeNull();
    expect(document.activeElement).toBe(s.control('a', 'drag'));

    press('c', 220);
    pointer('pointermove', 100);
    expect(order()).toEqual(['symbol', 'c', 'b', 'a', 'view']);
    dispatch(document as unknown as HTMLElement, 'keydown', { key: 'Escape' });
    expect(order()).toEqual(['symbol', 'b', 'a', 'c', 'view']);
    pointer('pointerup', 100);
    expect(ids(s.toolbar)).toEqual(['symbol', 'b', 'a', 'c', 'view']);

    press('symbol', 60);
    pointer('pointermove', 200);
    expect(order()).toEqual(['symbol', 'b', 'a', 'c', 'view']);
    pointer('pointerup', 200);

    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    press('a', 180);
    pointer('pointermove', 140);
    expect(order()).toEqual(['symbol', 'a', 'b', 'c', 'view']);
    expect(slide).toHaveBeenCalledWith([{ transform: 'translateY(-40px)' }, { transform: 'none' }], expect.anything());
  });

  it('retains programmatic item edits after user customization', () => {
    const s = setup();
    s.toolbar.openCustomization();
    dispatch(s.control('b', 'up'), 'click');
    s.toolbar.update('b', { label: 'New name' });
    expect(s.toolbar.get('b')!.el.getAttribute('aria-label')).toBe('New name');
    s.toolbar.add(action('extra'), { before: 'a' });
    expect(ids(s.toolbar)).toEqual(['symbol', 'b', 'extra', 'a']);
    s.toolbar.update('extra', { hidden: true });
    expect(ids(s.toolbar)).toEqual(['symbol', 'b', 'a']);
    s.toolbar.remove('b');
    expect(ids(s.toolbar)).toEqual(['symbol', 'a']);
    s.toolbar.setItems([action('new')]);
    expect(ids(s.toolbar)).toEqual(['new']);
  });

  it('leaves series, indicators and panes out: their legend rows have their own buttons', async () => {
    const settings = memory();
    // A layout saved when the catalog listed them still loads.
    settings.set('toolbar', '{"version":1,"ids":["symbol","visibility:1","pane-visibility:1","a"]}');
    const s = setup(settings);
    s.chart.addLine({ title: 'Extra line' });
    const def: IndicatorDef = { id: 'test-toolbar', name: 'Oscillator', placement: 'pane', inputs: [], plots: [{ id: 'line', type: 'line' }], compute: (source) => ({ line: Float64Array.from(source.close) }) };
    s.chart.indicators.add(def);
    await Promise.resolve();
    expect(ids(s.toolbar)).toEqual(['symbol', 'a']);
    s.toolbar.openCustomization();
    const names: string[] = [];
    const walk = (el: HTMLElement) => {
      if (el.tagName.toLowerCase() === 'input') names.push(el.getAttribute('aria-label') ?? '');
      for (const child of el.children as unknown as HTMLElement[]) walk(child);
    };
    walk(s.panel());
    for (const name of ['Show or hide Oscillator', 'Show or hide Extra line', 'Show or hide Pane 1', 'Show or hide Pane 2']) {
      expect(names).not.toContain(name);
    }
    // The drawings toggle is a built-in action, not a live object.
    expect(names).toContain('Show or hide drawings');
  });

  it('uses right-click and More entry points, closes with Escape, and reports blocked storage', () => {
    const store = memory();
    store.set = () => { throw new Error('blocked'); };
    const s = setup(store);
    const notify = vi.spyOn(s.chart, 'notify');
    const more = findIn(s.toolbar.el, (el) => el.getAttribute('aria-label') === 'More')!;
    expect(more.parentElement!.hidden).toBe(false);
    dispatch(more, 'click');
    const entry = findIn(s.toolbar.el, (el) => el.getAttribute('role') === 'menuitem')!;
    dispatch(entry, 'click');
    expect(s.panel()).toBeTruthy();
    s.toggle('a', false);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
    expect(ids(s.toolbar)).toEqual(['symbol', 'b']);
    dispatch(s.panel(), 'keydown', { key: 'Escape' });
    expect(s.panel()).toBeNull();
    expect(dispatch(s.toolbar.el, 'contextmenu').defaultPrevented).toBe(true);
    expect(s.panel()).toBeTruthy();
  });

  it('accepts options in shell and grid and keeps array toolbars fixed', () => {
    const options = { items: defaults(), customize: toolbarCustomization(), settings: null };
    const shell = createChartShell(fakeContainer(), { toolbar: options });
    cleanups.push(() => shell.destroy());
    shell.toolbar!.openCustomization();
    expect(shell.el.querySelector('.pc-toolbar-customization')).toBeTruthy();
    const grid = createChartGrid(fakeContainer(), { toolbar: options, cell: { rail: false } });
    cleanups.push(() => grid.destroy());
    grid.toolbar!.openCustomization();
    expect(grid.el.querySelector('.pc-toolbar-customization')).toBeTruthy();
    const chart = new Chart(fakeContainer());
    charts.push(chart);
    const fixed = createToolbar(fakeContainer(), chart, defaults());
    bars.push(fixed);
    expect(dispatch(fixed.el, 'contextmenu').defaultPrevented).toBe(false);
    expect(findIn(fixed.el, (el) => el.getAttribute('aria-label') === 'More')!.parentElement!.hidden).toBe(true);
  });

  it('resolves a saved host action registered late and stops after teardown', async () => {
    const settings = memory();
    settings.set('toolbar', '{"version":1,"ids":["host"]}');
    const s = setup(settings);
    const unregister = s.toolbar.registerAction({ id: 'host', label: 'Host', onClick() {} });
    expect(ids(s.toolbar)).toEqual(['symbol', 'host']);
    s.chart.addLine();
    s.toolbar.destroy();
    unregister();
    await Promise.resolve();
    expect(s.host.children).toHaveLength(0);
  });

  it('relabels an open panel in the language of the grid\'s active chart', async () => {
    const grid = createChartGrid(fakeContainer(), {
      layout: '2x1', link: false, toolbar: { items: defaults(), customize: toolbarCustomization(), settings: null },
    });
    cleanups.push(() => grid.destroy());
    grid.toolbar!.openCustomization();
    grid.setActive(1);
    grid.charts[1]!.applyOptions({ localization: { messages: { toolbarCustomize: 'Toolbar choices', toolbarReset: 'Restore toolbar' } } });
    await Promise.resolve();
    const panel = grid.el.querySelector<HTMLElement>('.pc-toolbar-customization')!;
    expect(panel.querySelector('.pc-dialog-title')!.textContent).toBe('Toolbar choices');
  });
});
