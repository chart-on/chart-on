import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer, installFakeDom } from '../../core/test/fake-dom';
import { createChartShell, type ChartShellOptions } from '../src/shell';
import { showShortcut } from '../src/shortcuts';
import { symbolSearch, type SymbolSearchOptions, type SymbolSearchPart } from '../src/symbol-search';

installFakeDom();

type Node = { children: Node[]; className: string; attributes: Map<string, string>; isContentEditable?: boolean; setSelectionRange?: () => void };

function byClass(root: unknown, cls: string): Node | null {
  for (const child of (root as Node).children) {
    if (child.className.split(/\s+/).includes(cls)) return child;
    const found = byClass(child, cls);
    if (found) return found;
  }
  return null;
}

const search = (extra: Partial<SymbolSearchOptions> = {}): SymbolSearchPart =>
  symbolSearch({
    source: { search: async () => [] },
    onSelect: () => {},
    ...extra,
  });

// Without the command palette, which takes Mod+K first (see command-palette.test.ts).
function mount(options: ChartShellOptions = { symbolSearch: search() }) {
  const shell = createChartShell(fakeContainer(), { appearance: false, settings: false, bottomBar: true, ...options });
  const open = shell.symbolSearch ? vi.spyOn(shell.symbolSearch, 'open').mockImplementation(() => {}) : null;
  return { shell, open: open!, chart: shell.chart };
}

const ctrlK = { key: 'k', code: 'KeyK', ctrlKey: true };
const slash = { key: '/', code: 'Slash' };

/** An element inside the shell outside the chart, such as a toolbar button. */
const chrome = (shell: { bottomBar: { el: HTMLElement } | null }) => shell.bottomBar!.el;

beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal('MutationObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('navigator', { platform: 'Win32' });
});

afterEach(() => vi.unstubAllGlobals());

describe('symbol search shortcut', () => {
  it('registers the symbol-search action', () => {
    const { shell, chart } = mount();
    expect(chart.actions.get('symbol-search')).toMatchObject({ label: 'Symbol search', keys: ['Mod+K', '/'], enabled: true });
    shell.destroy();
    expect(chart.actions.has('symbol-search')).toBe(false);
    const without = createChartShell(fakeContainer(), { appearance: false, settings: false, bottomBar: true });
    expect(without.chart.actions.has('symbol-search')).toBe(false);
    without.destroy();
  });

  it('opens from anywhere in the shell with Mod+K or /', () => {
    const { shell, open } = mount();
    const e = dispatch(chrome(shell), 'keydown', ctrlK);
    expect(open).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    dispatch(chrome(shell), 'keydown', { key: 'k', code: 'KeyK', metaKey: true });
    dispatch(chrome(shell), 'keydown', slash);
    expect(open).toHaveBeenCalledTimes(3);
    // Other keys stay with the page.
    expect(dispatch(chrome(shell), 'keydown', { key: ';', code: 'Semicolon' }).defaultPrevented).toBe(false);
    expect(open).toHaveBeenCalledTimes(3);
    shell.destroy();
  });

  it('keeps its key outside the chart when a chart-only action shares it', () => {
    const { shell, open, chart } = mount();
    chart.actions.register({ id: 'chart-only', label: 'Chart only', keys: [], run: () => {} });
    // App-set keys come first in match order.
    chart.actions.setKeys('chart-only', ['/']);
    expect(chart.actions.match({ ...slash, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })[0]).toBe('chart-only');
    dispatch(chrome(shell), 'keydown', slash);
    expect(open).toHaveBeenCalledTimes(1);
    shell.destroy();
  });

  it('opens once from the focused chart', () => {
    const { shell, open, chart } = mount();
    expect(dispatch(chart.root, 'keydown', ctrlK).defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    shell.destroy();
  });

  it('leaves keys typed into fields alone', () => {
    const { shell, open } = mount();
    const input = document.createElement('input');
    const editor = Object.assign(document.createElement('div'), { isContentEditable: true });
    chrome(shell).append(input, editor);
    for (const target of [input, editor]) {
      expect(dispatch(target, 'keydown', slash).defaultPrevented).toBe(false);
      dispatch(target, 'keydown', ctrlK);
    }
    expect(open).not.toHaveBeenCalled();
    shell.destroy();
  });

  it('does nothing while a modal dialog is open', () => {
    const { shell, open } = mount();
    const modal = vi.spyOn(document, 'querySelectorAll').mockReturnValue([{ contains: () => false }] as unknown as NodeListOf<Element>);
    dispatch(chrome(shell), 'keydown', ctrlK);
    dispatch(shell.chart.root, 'keydown', ctrlK);
    expect(open).not.toHaveBeenCalled();
    modal.mockRestore();
    shell.destroy();
  });

  it('is disabled while the search is open, and marks the dialog modal only then', () => {
    vi.stubGlobal('HTMLElement', class {});
    const shell = createChartShell(fakeContainer(), { appearance: false, settings: false, bottomBar: true, symbolSearch: search() });
    const panel = byClass(shell.el, 'pc-symbol-search')!;
    byClass(panel, 'pc-symbol-search-input')!.setSelectionRange = () => {};
    expect(panel.attributes.has('aria-modal')).toBe(false);
    dispatch(chrome(shell), 'keydown', ctrlK);
    expect(shell.symbolSearch!.isOpen).toBe(true);
    expect(panel.attributes.get('aria-modal')).toBe('true');
    expect(shell.chart.actions.get('symbol-search')!.enabled).toBe(false);
    shell.symbolSearch!.close();
    expect(panel.attributes.has('aria-modal')).toBe(false);
    shell.destroy();
  });

  it('follows rebinding and can be turned off', () => {
    const { shell, open, chart } = mount();
    chart.actions.setKeys('symbol-search', ['Alt+S']);
    dispatch(chrome(shell), 'keydown', ctrlK);
    expect(open).not.toHaveBeenCalled();
    dispatch(chrome(shell), 'keydown', { key: 'ß', code: 'KeyS', altKey: true });
    expect(open).toHaveBeenCalledTimes(1);
    chart.actions.setKeys('symbol-search', []);
    dispatch(chrome(shell), 'keydown', { key: 's', code: 'KeyS', altKey: true });
    dispatch(chrome(shell), 'keydown', slash);
    expect(open).toHaveBeenCalledTimes(1);
    shell.destroy();
  });

  it('respects the chart keyboard feature', () => {
    const { shell, open } = mount({ symbolSearch: search(), chart: { features: { keyboard: false } } });
    dispatch(chrome(shell), 'keydown', ctrlK);
    expect(open).not.toHaveBeenCalled();
    shell.destroy();
  });

  it('listens on the document with shortcutScope: document', () => {
    const shellScope = mount();
    dispatch(document, 'keydown', ctrlK);
    expect(shellScope.open).not.toHaveBeenCalled();
    shellScope.shell.destroy();

    const pageScope = mount({ symbolSearch: search({ shortcutScope: 'document' }) });
    dispatch(document, 'keydown', slash);
    expect(pageScope.open).toHaveBeenCalledTimes(1);
    // Inside the shell it still runs once.
    dispatch(chrome(pageScope.shell), 'keydown', ctrlK);
    expect(pageScope.open).toHaveBeenCalledTimes(2);
    pageScope.shell.destroy();
    dispatch(document, 'keydown', slash);
    expect(pageScope.open).toHaveBeenCalledTimes(2);
  });
});

describe('type to search', () => {
  const b = { key: 'b', code: 'KeyB' };

  it('opens with a letter or digit typed on the chart or in the shell', () => {
    const { shell, open, chart } = mount();
    expect(dispatch(chart.root, 'keydown', b).defaultPrevented).toBe(true);
    expect(open).toHaveBeenLastCalledWith('b');
    dispatch(chrome(shell), 'keydown', { key: '7', code: 'Digit7' });
    expect(open).toHaveBeenLastCalledWith('7');
    expect(open).toHaveBeenCalledTimes(2);
    shell.destroy();
    dispatch(chart.root, 'keydown', b);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('gets every letter and digit typed on a focused chart: no default shortcut takes one', () => {
    const { shell, open, chart } = mount();
    expect(chart.actions.has('go-to-date')).toBe(true);
    chart.root.focus();
    for (const ch of 'G0'.split('')) {
      expect(dispatch(chart.root, 'keydown', { key: ch, code: /\d/.test(ch) ? `Digit${ch}` : `Key${ch}` }).defaultPrevented).toBe(true);
      expect(open).toHaveBeenLastCalledWith(ch);
    }
    const typed = [...'abcdefghijklmnopqrstuvwxyz0123456789'];
    const taken = typed.filter((ch) => chart.actions.match({ key: ch, code: '', altKey: false, ctrlKey: false, shiftKey: false, metaKey: false }).length > 0);
    expect(taken).toEqual([]);
    shell.destroy();
  });

  it('puts the character in the search box with the caret after it', () => {
    vi.stubGlobal('HTMLElement', class {});
    const shell = createChartShell(fakeContainer(), { appearance: false, settings: false, bottomBar: true, symbolSearch: search() });
    const input = byClass(byClass(shell.el, 'pc-symbol-search'), 'pc-symbol-search-input')! as Node & { value: string };
    const caret = vi.fn();
    input.setSelectionRange = caret;
    dispatch(shell.chart.root, 'keydown', b);
    expect(shell.symbolSearch!.isOpen).toBe(true);
    expect(input.value).toBe('b');
    expect(caret).toHaveBeenLastCalledWith(1, 1);
    // Further keys go to the open dialog, not to a second open.
    dispatch(shell.chart.root, 'keydown', { key: 'c', code: 'KeyC' });
    expect(input.value).toBe('b');
    shell.symbolSearch!.close();
    shell.destroy();
  });

  it('leaves bound keys, modifiers, IME composition, fields and modals alone', () => {
    const { shell, open, chart } = mount();
    const run = vi.fn();
    chart.actions.register({ id: 'bound', label: 'Bound', keys: ['B'], run });
    dispatch(chart.root, 'keydown', b);
    expect(run).toHaveBeenCalledTimes(1);
    // Outside the chart a chart-only action does not run, and the key still does not search.
    dispatch(chrome(shell), 'keydown', b);
    for (const key of [{ key: 'c', code: 'KeyC', ctrlKey: true }, { key: 'c', code: 'KeyC', altKey: true }, { key: 'c', code: 'KeyC', isComposing: true }, { key: '+', code: 'Equal' }]) {
      dispatch(chrome(shell), 'keydown', key);
    }
    const input = document.createElement('input');
    chrome(shell).append(input);
    expect(dispatch(input, 'keydown', { key: 'c', code: 'KeyC' }).defaultPrevented).toBe(false);
    const modal = vi.spyOn(document, 'querySelectorAll').mockReturnValue([{ contains: () => false }] as unknown as NodeListOf<Element>);
    dispatch(chrome(shell), 'keydown', { key: 'c', code: 'KeyC' });
    modal.mockRestore();
    expect(open).not.toHaveBeenCalled();
    shell.destroy();
  });

  it('is left to the dialog with openOnTyping: false or an element', () => {
    const off = mount({ symbolSearch: search({ openOnTyping: false }) });
    dispatch(off.chart.root, 'keydown', b);
    dispatch(chrome(off.shell), 'keydown', b);
    expect(off.open).not.toHaveBeenCalled();
    off.shell.destroy();

    // The dialog itself listens on the given element; the shell does not.
    const only = mount({ symbolSearch: search({ openOnTyping: document.createElement('div') }) });
    dispatch(only.chart.root, 'keydown', b);
    dispatch(chrome(only.shell), 'keydown', b);
    expect(only.open).not.toHaveBeenCalled();
    only.shell.destroy();
  });
});

describe('showShortcut', () => {
  it('keeps the tooltip and aria-keyshortcuts in step with the action', () => {
    const { shell, chart } = mount();
    const button = document.createElement('button') as unknown as Node & HTMLElement;
    const stop = showShortcut(button, chart, 'symbol-search');
    expect(button.attributes.get('data-tip')).toBe('Symbol search (Ctrl+K)');
    expect(button.attributes.get('aria-keyshortcuts')).toBe('Control+K /');
    chart.actions.setKeys('symbol-search', []);
    expect(button.attributes.get('data-tip')).toBe('Symbol search');
    expect(button.attributes.has('aria-keyshortcuts')).toBe(false);
    stop();
    chart.actions.setKeys('symbol-search', null);
    expect(button.attributes.get('data-tip')).toBe('Symbol search');
    shell.destroy();
  });

  it('names Cmd on Apple devices', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    const { shell, chart } = mount();
    const button = document.createElement('button') as unknown as Node & HTMLElement;
    showShortcut(button, chart, 'symbol-search');
    expect(button.attributes.get('data-tip')).toBe('Symbol search (Cmd+K)');
    expect(button.attributes.get('aria-keyshortcuts')).toBe('Meta+K /');
    shell.destroy();
  });

  it('leaves the control alone for an unknown action', () => {
    const { shell, chart } = mount();
    const button = document.createElement('button') as unknown as Node & HTMLElement;
    showShortcut(button, chart, 'nope');
    expect(button.attributes.size).toBe(0);
    shell.destroy();
  });
});
