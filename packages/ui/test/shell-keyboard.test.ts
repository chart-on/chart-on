import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer, installFakeDom } from '../../core/test/fake-dom';
import { h } from '../src/dom';
import { bindMenuKeys, groupButtons, rovingFocus } from '../src/keyboard';
import { createChartShell, type ChartShellOptions } from '../src/shell';

installFakeDom();

beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal('navigator', { platform: 'Win32' });
  vi.stubGlobal('MutationObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
});
afterEach(() => vi.unstubAllGlobals());

const active = () => document.activeElement;
const key = (target: unknown, k: string, extra: Record<string, unknown> = {}) => dispatch(target, 'keydown', { key: k, code: k, ...extra });
const tabbable = (buttons: HTMLElement[]) => buttons.filter((b) => b.tabIndex === 0);

/** A toolbar-like group: three buttons, a disabled one and a hidden one. */
function group() {
  const [a, b, c, off, gone] = ['a', 'b', 'c', 'off', 'gone'].map((label) => h('button', { type: 'button' }, label));
  off!.disabled = true;
  gone!.hidden = true;
  const el = h('div', { role: 'toolbar' }, a!, h('div', {}, b!, off!), gone!, c!);
  return { el, a: a!, b: b!, c: c!, off: off!, gone: gone! };
}

describe('roving focus', () => {
  it('leaves one Tab stop and moves with the arrow keys, Home and End', () => {
    const g = group();
    const roving = rovingFocus(g.el);
    expect(groupButtons(g.el)).toEqual([g.a, g.b, g.c]);
    expect(tabbable([g.a, g.b, g.c])).toEqual([g.a]);
    expect(roving.focus()).toBe(true);
    expect(active()).toBe(g.a);
    expect(key(g.a, 'ArrowRight').defaultPrevented).toBe(true);
    expect(active()).toBe(g.b);
    expect(tabbable([g.a, g.b, g.c])).toEqual([g.b]);
    key(g.b, 'ArrowDown');
    expect(active()).toBe(g.c);
    // Wraps at the ends.
    key(g.c, 'ArrowRight');
    expect(active()).toBe(g.a);
    key(g.a, 'ArrowUp');
    expect(active()).toBe(g.c);
    key(g.c, 'Home');
    expect(active()).toBe(g.a);
    key(g.a, 'End');
    expect(active()).toBe(g.c);
    roving.destroy();
  });

  it('follows focus from a click and leaves modified keys alone', () => {
    const g = group();
    const roving = rovingFocus(g.el);
    g.b.focus();
    dispatch(g.b, 'focusin');
    expect(tabbable([g.a, g.b, g.c])).toEqual([g.b]);
    // Alt + arrows reorder favourites, Ctrl + arrows belong to the page.
    expect(key(g.b, 'ArrowRight', { altKey: true }).defaultPrevented).toBe(false);
    expect(key(g.b, 'ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(active()).toBe(g.b);
    roving.destroy();
    expect(key(g.b, 'ArrowRight').defaultPrevented).toBe(false);
  });

  it('skips keys from controls that are not its buttons', () => {
    const g = group();
    const field = h('input', { type: 'text' });
    g.el.append(field);
    const roving = rovingFocus(g.el);
    expect(key(field, 'ArrowRight').defaultPrevented).toBe(false);
    roving.destroy();
  });
});

describe('menu keys', () => {
  function menu(attrs: Record<string, string> = { 'aria-haspopup': 'menu' }, before: HTMLElement[] = []) {
    const root = h('div');
    const trigger = h('button', { type: 'button', ...attrs }, 'Open');
    const wrap = h('div', {}, ...before, trigger);
    root.append(wrap);
    const entries = ['x', 'y', 'z'].map((label) => h('button', { type: 'button', role: 'menuitemradio' }, label));
    trigger.addEventListener('click', () => {
      entries[1]!.setAttribute('aria-checked', 'true');
      wrap.append(h('div', { class: 'pc-popover', role: 'menu' }, ...entries));
    });
    return { root, trigger, entries, off: bindMenuKeys(root) };
  }

  it('moves focus into a menu opened from the keyboard, onto its selected entry', () => {
    const m = menu();
    m.trigger.focus();
    dispatch(m.trigger, 'click', { detail: 0 });
    expect(active()).toBe(m.entries[1]);
    key(m.entries[1], 'ArrowDown');
    expect(active()).toBe(m.entries[2]);
    key(m.entries[2], 'ArrowDown');
    expect(active()).toBe(m.entries[0]);
    key(m.entries[0], 'End');
    expect(active()).toBe(m.entries[2]);
    // Escape gives focus back to the button; the menu's dismiss handler closes it.
    key(m.entries[2], 'Escape');
    expect(active()).toBe(m.trigger);
    m.off();
  });

  it('does the same for a disclosure button opening a group of buttons', () => {
    const m = menu({ 'aria-expanded': 'false' });
    m.trigger.focus();
    dispatch(m.trigger, 'click', { detail: 0 });
    expect(active()).toBe(m.entries[1]);
    key(m.entries[1], 'Escape');
    expect(active()).toBe(m.trigger);
    m.off();
  });

  it('gives focus back to the menu button, not a button before it marked expanded', () => {
    // A rail group: its tool button shows expanded while the flyout of the menu button after it is open.
    const m = menu(undefined, [h('button', { type: 'button', 'aria-expanded': 'true' }, 'Tool')]);
    m.trigger.focus();
    dispatch(m.trigger, 'click', { detail: 0 });
    key(m.entries[1], 'Escape');
    expect(active()).toBe(m.trigger);
    m.off();
  });

  it('leaves focus on the button after a mouse click', () => {
    const m = menu();
    m.trigger.focus();
    dispatch(m.trigger, 'click', { detail: 1 });
    expect(active()).toBe(m.trigger);
    m.off();
  });
});

describe('shell regions', () => {
  function mount(options: ChartShellOptions = {}) {
    const shell = createChartShell(fakeContainer(), {
      appearance: false,
      settings: false,
      bottomBar: true,
      toolbar: [
        { type: 'button', id: 'one', label: 'One', onClick() {} },
        { type: 'button', id: 'two', label: 'Two', onClick() {} },
      ],
      ...options,
    });
    return { shell, chart: shell.chart };
  }

  it('registers the region actions and labels the toolbar', () => {
    const { shell, chart } = mount();
    expect(chart.actions.get('focus-next-region')).toMatchObject({ label: 'Focus next area', keys: ['F6'] });
    expect(chart.actions.get('focus-previous-region')).toMatchObject({ label: 'Focus previous area', keys: ['Shift+F6'] });
    expect(shell.toolbar!.el.getAttribute('aria-label')).toBe('Chart toolbar');
    shell.destroy();
    expect(chart.actions.has('focus-next-region')).toBe(false);
  });

  it('cycles focus through toolbar, rail, plot and bottom bar with F6 and Shift+F6', () => {
    const { shell, chart } = mount();
    const first = (el: HTMLElement) => groupButtons(el)[0];
    const toolbarButton = first(shell.toolbar!.el)!;
    toolbarButton.focus();
    expect(key(toolbarButton, 'F6').defaultPrevented).toBe(true);
    expect(active()).toBe(first(shell.rail!.el));
    key(active(), 'F6');
    expect(active()).toBe(chart.root);
    // The focused chart runs the action itself.
    expect(key(chart.root, 'F6').defaultPrevented).toBe(true);
    expect(active()).toBe(first(shell.bottomBar!.el));
    key(active(), 'F6');
    expect(active()).toBe(toolbarButton);
    key(active(), 'F6', { shiftKey: true });
    expect(active()).toBe(first(shell.bottomBar!.el));
    shell.destroy();
  });

  it('skips hidden areas and returns to the last focused button of a bar', () => {
    const { shell, chart } = mount();
    shell.rail!.setVisible(false);
    const [one, two] = groupButtons(shell.toolbar!.el);
    two!.focus();
    dispatch(two, 'focusin');
    key(two, 'F6');
    expect(active()).toBe(chart.root);
    key(chart.root, 'F6', { shiftKey: true });
    expect(active()).toBe(two);
    expect(one!.tabIndex).toBe(-1);
    shell.destroy();
  });

  it('leaves F6 to the page while focus is outside the shell', () => {
    const { shell } = mount();
    const outside = h('button', { type: 'button' });
    outside.focus();
    // The page sees the key; only the shell listens to it here.
    expect(key(shell.el, 'F6').defaultPrevented).toBe(false);
    expect(active()).toBe(outside);
    shell.destroy();
  });
});
