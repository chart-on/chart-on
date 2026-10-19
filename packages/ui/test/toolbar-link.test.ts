import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsAdapter } from '@chart-on/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { findIn } from '../src/dialog';
import { createChartShell, type ChartShell } from '../src/shell';
import type { ToolbarHandle, ToolbarItem } from '../src/toolbar';
import { toolbarCustomization } from '../src/toolbar-customization';

const shells: ChartShell[] = [];
beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', paddingRight: '0' }));
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
  fakeContainer();
  Object.assign(document, { documentElement: { clientWidth: 1280, clientHeight: 800 } });
});
afterEach(() => {
  shells.splice(0).forEach((s) => s.destroy());
  vi.unstubAllGlobals();
});

const action = (id: string, group: 'analysis' | 'context' = 'analysis'): ToolbarItem => ({ type: 'button', id, label: id, group, onClick() {} });
function memory(): SettingsAdapter {
  const values = new Map<string, string>();
  return { get: (key) => values.get(key) ?? null, set: (key, value) => { values.set(key, value); }, remove: (key) => { values.delete(key); } };
}
const ids = (bar: ToolbarHandle | null) => bar!.items.filter((item) => item.id !== undefined && !item.hidden).map((item) => item.id);

function setup(settings = memory(), bottomCustomize = true) {
  const customize = toolbarCustomization({ locked: ['symbol'] });
  const s = createChartShell(fakeContainer(), {
    toolbar: { items: [action('symbol', 'context'), action('a'), action('b')], customize, settings },
    bottomBar: { items: [action('x')], settings, ...(bottomCustomize && { customize }) },
  });
  shells.push(s);
  const panel = () => s.el.querySelector<HTMLElement>('.pc-toolbar-customization')!;
  const control = (id: string, kind: string) =>
    findIn(panel(), (el) => el.getAttribute('data-action') === id && el.getAttribute('data-control') === kind) as HTMLButtonElement | null;
  const toggle = (id: string, checked: boolean) => {
    const el = control(id, 'toggle') as unknown as HTMLInputElement;
    el.checked = checked;
    dispatch(el, 'change');
  };
  return { s, panel, control, toggle, settings };
}

describe('moving items between the toolbar and the bottom bar', () => {
  it('moves an item down and back up, saving both bars', () => {
    const { s, control, panel, settings } = setup();
    s.toolbar!.openCustomization();
    const down = control('b', 'bar')!;
    expect(down.getAttribute('aria-label')).toBe('Move b to the bottom bar');
    dispatch(down, 'click');
    expect(ids(s.toolbar)).toEqual(['symbol', 'a']);
    expect(ids(s.bottomBar)).toEqual(['x', 'b']);
    expect(JSON.parse(settings.get('toolbar')!).ids).toEqual(['symbol', 'a']);
    expect(JSON.parse(settings.get('bottomBar')!).ids).toEqual(['x', 'b']);

    // One dialog at a time: close the toolbar's.
    dispatch(findIn(panel(), (el) => el.getAttribute('aria-label') === 'Close')!, 'click');
    s.bottomBar!.openCustomization();
    const up = control('b', 'bar')!;
    expect(up.getAttribute('aria-label')).toBe('Move b to the toolbar');
    dispatch(up, 'click');
    expect(ids(s.bottomBar)).toEqual(['x']);
    expect(ids(s.toolbar)).toEqual(['symbol', 'a', 'b']);
  });

  it('keeps the item in its new bar after a reload', () => {
    const first = setup();
    first.s.toolbar!.openCustomization();
    dispatch(first.control('a', 'bar')!, 'click');
    const second = setup(first.settings);
    expect(ids(second.s.toolbar)).toEqual(['symbol', 'b']);
    expect(ids(second.s.bottomBar)).toEqual(['x', 'a']);
  });

  it('does not move locked items', () => {
    const { s, control } = setup();
    s.toolbar!.openCustomization();
    expect(control('symbol', 'bar')!.disabled).toBe(true);
  });

  it('shows an item in one bar at a time', () => {
    const { s, toggle } = setup();
    s.bottomBar!.openCustomization();
    // The bottom bar lists the toolbar's actions too; showing one there takes it from the toolbar.
    toggle('a', true);
    expect(ids(s.bottomBar)).toEqual(['x', 'a']);
    expect(ids(s.toolbar)).toEqual(['symbol', 'b']);
  });

  it('resets a bar to its defaults, apart from items the other bar holds', () => {
    const { s, control, panel } = setup();
    s.toolbar!.openCustomization();
    dispatch(control('b', 'bar')!, 'click');
    dispatch(panel().querySelector('.pc-dialog-footer')!.children[0]!, 'click');
    expect(ids(s.toolbar)).toEqual(['symbol', 'a']);
    expect(ids(s.bottomBar)).toEqual(['x', 'b']);
  });

  it('offers no move without customization on both bars', () => {
    const { s, control } = setup(memory(), false);
    s.toolbar!.openCustomization();
    expect(control('a', 'toggle')).not.toBeNull();
    expect(control('a', 'bar')).toBeNull();
  });
});
