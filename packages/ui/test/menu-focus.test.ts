import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Chart } from '@chart-on/core';
import { fakeContainer } from '../../core/test/fake-dom';
import { menuButton } from '../src/controls';
import { mountToolbar, type ToolbarHandle } from '../src/toolbar';

interface El {
  focus(): void;
  dispatch(type: string): void;
  querySelector(selector: string): El | null;
}

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', paddingRight: '0' }));
  fakeContainer();
  Object.assign(document, { documentElement: { clientWidth: 1280, clientHeight: 800 } });
});
afterEach(() => {
  cleanups.splice(0).forEach((off) => off());
  vi.unstubAllGlobals();
});

/** Choose the menu's first entry from the keyboard: focus it, then press it. */
function choose(el: El) {
  el.querySelector('.pc-menu-trigger')!.dispatch('click');
  const entry = el.querySelector('.pc-popover-item')!;
  entry.focus();
  entry.dispatch('click');
}

it('returns focus to the menu button after a selection', () => {
  const host = fakeContainer();
  const menu = menuButton({ label: 'Type', options: [{ value: 'a', label: 'A' }], onSelect: () => {} });
  host.append(menu.el);
  cleanups.push(menu.destroy);
  choose(menu.el as unknown as El);
  expect(document.activeElement).toBe(menu.el.querySelector('.pc-menu-trigger'));
});

it('focuses the new button when the selection remounts the toolbar menu', () => {
  const chart = new Chart(fakeContainer());
  let handle!: ToolbarHandle;
  const options = [{ value: 'a', label: 'A' }];
  handle = mountToolbar(fakeContainer(), chart, [
    { type: 'menu', id: 'view', label: 'View', options, onSelect: () => handle.update('view', { options: [...options] }), isChecked: () => false },
  ]).handle;
  cleanups.push(() => handle.destroy(), () => chart.destroy());
  const before = handle.get('view')!.el;
  choose(before as unknown as El);
  const after = handle.get('view')!.el;
  expect(after).not.toBe(before);
  expect(document.activeElement).toBe(after.querySelector('.pc-menu-trigger'));
});
