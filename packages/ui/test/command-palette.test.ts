import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rsiIndicator as rsiDef } from '@chart-on/indicators';
import { dispatch, fakeContainer, installFakeDom } from '../../core/test/fake-dom';
import { commandPalette, commandPaletteToolbarItem } from '../src/command-palette';
import type { CommandEntry } from '../src/command-palette-model';
import { devCheck } from '../src/options-schema';
import { createChartShell, type ChartShell, type ChartShellOptions } from '../src/shell';
import { symbolSearch } from '../src/symbol-search';

installFakeDom();

type El = HTMLElement & { children: El[]; className: string; textContent: string; value: string };

const all = (root: El): El[] => root.children.flatMap((c) => [c, ...all(c)]);
const byClass = (root: El, cls: string) => all(root).find((el) => el.className.split(/\s+/).includes(cls)) ?? null;
const text = (el: El): string => el.textContent + el.children.map(text).join('');

const shells: ChartShell[] = [];
function mount(options: ChartShellOptions = {}) {
  const shell = createChartShell(fakeContainer(), { appearance: false, settings: false, bottomBar: true, commandPalette: commandPalette(), ...options });
  shells.push(shell);
  return shell;
}

const ctrlK = { key: 'k', code: 'KeyK', ctrlKey: true };
/** An element inside the shell outside the chart. */
const chrome = (shell: ChartShell) => shell.bottomBar!.el;
const panelOf = (shell: ChartShell) => byClass(shell.el as El, 'pc-command-palette');
const input = (panel: El) => all(panel).find((el) => el.getAttribute('role') === 'combobox')!;
const options = (panel: El) => all(panel).filter((el) => el.getAttribute('role') === 'option');
const ids = (panel: El) => options(panel).map((o) => o.getAttribute('data-id'));
const option = (panel: El, id: string) => options(panel).find((o) => o.getAttribute('data-id') === id)!;

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function type(panel: El, value: string): Promise<void> {
  const field = input(panel);
  field.value = value;
  dispatch(field, 'input');
  await flush();
}

async function openPalette(shell: ChartShell): Promise<El> {
  dispatch(chrome(shell), 'keydown', ctrlK);
  await flush();
  return panelOf(shell)!;
}

const search = () => symbolSearch({ source: { search: async () => [] }, onSelect: () => {} });

beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal('MutationObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('navigator', { platform: 'Win32' });
});

afterEach(() => {
  shells.splice(0).forEach((s) => s.destroy());
  vi.unstubAllGlobals();
});

describe('command palette', () => {
  it('registers the command-palette action, and none without the commandPalette part', () => {
    const shell = mount();
    expect(shell.chart.actions.get('command-palette')).toMatchObject({ label: 'Command palette', keys: ['Mod+K'], enabled: true });
    shell.destroy();
    expect(shell.chart.actions.has('command-palette')).toBe(false);
    const without = mount({ commandPalette: undefined });
    expect(without.commandPalette).toBeNull();
    expect(without.chart.actions.has('command-palette')).toBe(false);
  });

  it('opens with Mod+K anywhere in the shell and lists the actions with shortcuts and state', async () => {
    const shell = mount();
    const opener = document.createElement('button');
    chrome(shell).append(opener);
    opener.focus();
    const panel = await openPalette(shell);
    expect(shell.commandPalette!.isOpen).toBe(true);
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(input(panel));
    // Only the search box until something is typed: nothing listed, nothing to pick.
    expect(panel.getAttribute('data-idle')).toBe('');
    expect(input(panel).getAttribute('aria-expanded')).toBe('false');
    expect(ids(panel)).toEqual([]);
    dispatch(input(panel), 'keydown', { key: 'Enter' });
    expect(shell.commandPalette!.isOpen).toBe(true);
    await type(panel, 'a');
    expect(panel.getAttribute('data-idle')).toBeNull();
    expect(input(panel).getAttribute('aria-expanded')).toBe('true');
    expect(ids(panel)).toContain('actions:auto-scale');
    // Its own action is not listed.
    expect(ids(panel)).not.toContain('actions:command-palette');
    await type(panel, 'redo');
    expect(text(option(panel, 'actions:redo'))).toContain('Ctrl+Shift+Z');
    await type(panel, 'auto');
    const autoScale = text(option(panel, 'actions:auto-scale'));
    expect(autoScale).toContain(shell.chart.actions.get('auto-scale')!.checked ? 'On' : 'Off');
    // Disabled while open, so the shortcut does not stack a second palette.
    expect(shell.chart.actions.get('command-palette')!.enabled).toBe(false);
    dispatch(input(panel), 'keydown', { key: 'Escape' });
    expect(shell.commandPalette!.isOpen).toBe(false);
    expect(panelOf(shell)).toBeNull();
    // Focus goes back to where it was.
    expect(document.activeElement).toBe(opener);
  });

  it('opens once from the focused chart', async () => {
    const shell = mount();
    const open = vi.spyOn(shell.commandPalette!, 'open');
    expect(dispatch(shell.chart.root, 'keydown', ctrlK).defaultPrevented).toBe(true);
    await flush();
    expect(shell.commandPalette!.isOpen).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('runs the picked action after closing, with the keyboard', async () => {
    const shell = mount();
    const before = shell.chart.actions.get('auto-scale')!.checked;
    const panel = await openPalette(shell);
    await type(panel, 'auto scale');
    expect(ids(panel)[0]).toBe('actions:auto-scale');
    dispatch(input(panel), 'keydown', { key: 'Enter' });
    expect(shell.commandPalette!.isOpen).toBe(false);
    expect(shell.chart.actions.get('auto-scale')!.checked).toBe(!before);
  });

  it('lists disabled actions after the enabled ones and does not run them', async () => {
    const shell = mount();
    const run = vi.spyOn(shell.chart.actions, 'run');
    expect(shell.chart.actions.get('undo')!.enabled).toBe(false);
    const panel = await openPalette(shell);
    await type(panel, 'do');
    expect(ids(panel)).toContain('actions:undo');
    const undo = option(panel, 'actions:undo');
    expect(undo.getAttribute('aria-disabled')).toBe('true');
    // Enabled matches come first; every disabled one is at the end.
    const disabled = options(panel).map((o) => o.getAttribute('aria-disabled') === 'true');
    expect(disabled.indexOf(true)).toBeGreaterThan(-1);
    expect(disabled.slice(disabled.indexOf(true)).every(Boolean)).toBe(true);
    dispatch(undo, 'click');
    expect(run).not.toHaveBeenCalledWith('undo');
    expect(shell.commandPalette!.isOpen).toBe(true);
  });

  it('takes Mod+K from the symbol search, which keeps / and is listed in the palette', async () => {
    const shell = mount({ symbolSearch: search() });
    const openSymbols = vi.spyOn(shell.symbolSearch!, 'open').mockImplementation(() => {});
    expect(shell.chart.actions.get('symbol-search')!.keys).toEqual(['/']);
    expect(shell.chart.actions.conflicts()).toEqual([]);
    const panel = await openPalette(shell);
    expect(openSymbols).not.toHaveBeenCalled();
    await type(panel, 'symbol');
    expect(ids(panel)).toContain('actions:symbol-search');
    shell.commandPalette!.close();
    dispatch(chrome(shell), 'keydown', { key: '/', code: 'Slash' });
    expect(openSymbols).toHaveBeenCalledTimes(1);
    // Without a palette, the symbol search keeps Mod+K.
    const plain = mount({ symbolSearch: search(), commandPalette: undefined });
    expect(plain.chart.actions.get('symbol-search')!.keys).toEqual(['Mod+K', '/']);
  });

  it('is turned off and on with the commandPalette feature flag', async () => {
    const shell = mount();
    shell.applyFeatures({ commandPalette: false });
    expect(shell.features.commandPalette).toBe(false);
    expect(shell.commandPalette!.enabled).toBe(false);
    expect(shell.chart.actions.get('command-palette')!.enabled).toBe(false);
    expect(dispatch(chrome(shell), 'keydown', ctrlK).defaultPrevented).toBe(false);
    shell.commandPalette!.open();
    expect(shell.commandPalette!.isOpen).toBe(false);
    shell.applyFeatures({ commandPalette: true });
    await openPalette(shell);
    expect(shell.commandPalette!.isOpen).toBe(true);
    const off = mount({ features: { commandPalette: false } });
    expect(off.commandPalette!.enabled).toBe(false);
  });

  it('closes when turned off while open', async () => {
    const shell = mount();
    await openPalette(shell);
    shell.applyFeatures({ commandPalette: false });
    expect(shell.commandPalette!.isOpen).toBe(false);
  });

  it('follows rebinding through the action registry', async () => {
    const shell = mount();
    shell.chart.actions.setKeys('command-palette', ['Alt+P']);
    dispatch(chrome(shell), 'keydown', ctrlK);
    expect(shell.commandPalette!.isOpen).toBe(false);
    dispatch(chrome(shell), 'keydown', { key: 'π', code: 'KeyP', altKey: true });
    expect(shell.commandPalette!.isOpen).toBe(true);
  });

  it('opens without a title bar, named by its title, with the categories as chips under the search box', async () => {
    const shell = mount();
    const panel = await openPalette(shell);
    expect(panel.getAttribute('aria-label')).toBe('Command palette');
    expect(panel.getAttribute('aria-labelledby')).toBeNull();
    expect(byClass(panel, 'pc-dialog-header')).toBeNull();
    expect(panel.children.map((c) => c.className)).toEqual(expect.arrayContaining(['pc-picker-field', 'pc-picker-nav', 'pc-picker-main']));
    const nav = byClass(panel, 'pc-picker-nav')!;
    expect(panel.children.indexOf(nav)).toBe(panel.children.indexOf(byClass(panel, 'pc-picker-field')!) + 1);
    expect(byClass(nav, 'pc-picker-tabs')!.getAttribute('aria-orientation')).toBe('horizontal');
    expect(byClass(byClass(panel, 'pc-picker-main')!, 'pc-picker-nav')).toBeNull();
  });

  it('lists entries from app sources under their own category, ranked across sources', async () => {
    const picked: string[] = [];
    const symbol = (id: string): CommandEntry => ({ id, label: id, description: 'Exchange', run: () => picked.push(id) });
    const shell = mount({
      commandPalette: commandPalette({
        sources: [{ id: 'symbols', label: 'Symbols', entries: () => [symbol('ABC'), symbol('XYZ')] }],
      }),
    });
    const remove = shell.commandPalette!.addSource({
      id: 'broken',
      label: 'Broken',
      entries: () => Promise.reject(new Error('offline')),
    });
    expect(() => shell.commandPalette!.addSource({ id: 'symbols', label: 'Again', entries: () => [] })).toThrow(RangeError);
    const panel = await openPalette(shell);
    const tabs = all(panel).filter((el) => el.getAttribute('role') === 'tab').map(text);
    // The shell's indicator picker adds its Indicators source after the app's own.
    expect(tabs).toEqual(['All', 'Actions', 'Symbols', 'Indicators', 'Broken']);
    await type(panel, 'xyz');
    // The failing source leaves the others listed.
    expect(ids(panel)[0]).toBe('symbols:XYZ');
    dispatch(input(panel), 'keydown', { key: 'Enter' });
    expect(picked).toEqual(['XYZ']);
    remove();
    const again = await openPalette(shell);
    expect(all(again).filter((el) => el.getAttribute('role') === 'tab').map(text)).toEqual(['All', 'Actions', 'Symbols', 'Indicators']);
  });

  it("lists the indicator picker's catalogue and adds the picked indicator", async () => {
    const shell = mount();
    shell.chart.indicators.register(rsiDef);
    const panel = await openPalette(shell);
    await type(panel, 'relative strength');
    expect(ids(panel)[0]).toBe('indicators:rsi');
    dispatch(input(panel), 'keydown', { key: 'Enter' });
    expect(shell.chart.indicators.getAll().map((i) => i.type)).toEqual(['rsi']);
    expect(shell.indicatorPicker!.recents[0]).toBe('rsi');
  });

  it('lists the theme, the settings dialog and the appearance panel as commands (#1014)', async () => {
    const shell = mount({ theme: 'light' });
    expect(shell.chart.actions.get('light-mode')!.checked).toBe(true);
    const panel = await openPalette(shell);
    await type(panel, 'dark');
    expect(ids(panel)[0]).toBe('actions:dark-mode');
    expect(text(option(panel, 'actions:dark-mode'))).toContain('Off');
    dispatch(input(panel), 'keydown', { key: 'Enter' });
    expect(shell.theme).toBe('dark');
    expect(shell.chart.actions.get('dark-mode')!.checked).toBe(true);
    expect(shell.chart.actions.get('light-mode')!.checked).toBe(false);
    // Without the settings dialog and the appearance panel, there is nothing of theirs to list.
    expect(shell.chart.actions.has('chart-settings')).toBe(false);
    expect(shell.chart.actions.has('appearance')).toBe(false);
    const full = mount({ appearance: undefined, settings: undefined });
    expect(full.chart.actions.get('chart-settings')!.label).toBe('Chart settings');
    expect(full.chart.actions.get('appearance')).toMatchObject({ label: 'Appearance', checked: false });
    full.chart.actions.run('appearance');
    expect(full.appearance!.isOpen).toBe(true);
    // The settings sections are listed under their own category and open the dialog there.
    const settingsPanel = await openPalette(full);
    await type(settingsPanel, 'axes');
    const axes = option(settingsPanel, 'settings:axes');
    expect(text(axes)).toContain('Chart settings');
    dispatch(input(settingsPanel), 'keydown', { key: 'Enter' });
    expect(full.settings!.isOpen).toBe(true);
    full.settings!.close();
    full.destroy();
    expect(full.chart.actions.has('dark-mode')).toBe(false);
  });

  it('shows the categories as chips until something is typed, and a picked one lists its entries (#1014)', async () => {
    const shell = mount();
    const panel = await openPalette(shell);
    const tabs = all(panel).filter((el) => el.getAttribute('role') === 'tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['All', 'Actions', 'Indicators']);
    expect(byClass(panel, 'pc-picker-tabs')!.getAttribute('aria-orientation')).toBe('horizontal');
    dispatch(tabs[1]!, 'click');
    await flush();
    expect(panel.getAttribute('data-idle')).toBeNull();
    expect(panel.getAttribute('data-all')).toBeNull();
    expect(ids(panel)).toContain('actions:auto-scale');
  });

  it('tags each row with its source under All', async () => {
    const shell = mount({ commandPalette: commandPalette({ sources: [{ id: 'mine', label: 'Mine', entries: () => [{ id: 'x', label: 'Auto thing', run: () => {} }] }] }) });
    const panel = await openPalette(shell);
    await type(panel, 'auto');
    expect(panel.getAttribute('data-all')).toBe('');
    expect(byClass(option(panel, 'mine:x'), 'pc-command-source')!.textContent).toBe('Mine');
  });

  it("keeps an app's own indicators source", async () => {
    const shell = mount({
      commandPalette: commandPalette({ actions: false, sources: [{ id: 'indicators', label: 'Mine', entries: () => [{ id: 'x', label: 'Mine', run: () => {} }] }] }),
    });
    shell.chart.indicators.register(rsiDef);
    const panel = await openPalette(shell);
    await type(panel, 'mine');
    expect(ids(panel)).toEqual(['indicators:x']);
  });

  // The footer itself is covered in indicator-picker.test.ts, which has a full DOM to open the picker.
  it("opens the palette from the indicator picker's search-all button", async () => {
    const shell = mount();
    const footer = byClass(shell.el as El, 'pc-symbol-search-footer')!;
    expect(panelOf(shell)).toBeNull();
    dispatch(footer.children[0]!, 'click');
    await flush();
    expect(panelOf(shell)).not.toBeNull();
  });

  it('keeps a ranked source in its own order', async () => {
    const entry = (id: string): CommandEntry => ({ id, label: id, run: () => {} });
    const shell = mount({
      commandPalette: commandPalette({
        actions: false,
        // A server-side search ranks the weaker text match first.
        sources: [{ id: 'remote', label: 'Remote', ranked: true, entries: () => [entry('xa-xb'), entry('xab'), entry('xa')] }],
      }),
    });
    const panel = await openPalette(shell);
    await type(panel, 'xa');
    expect(ids(panel)).toEqual(['remote:xa-xb', 'remote:xab', 'remote:xa']);
  });

  it('opens from its toolbar preset, which shows the open state', async () => {
    const shell = mount({ toolbar: [commandPaletteToolbarItem()] });
    const item = commandPaletteToolbarItem();
    if (item.type !== 'button') throw new Error('expected a button');
    item.onClick(shell.chart, document.createElement('button'));
    await flush();
    expect(item.isActive!(shell.chart)).toBe(true);
    shell.applyFeatures({ commandPalette: false });
    expect(item.isDisabled!(shell.chart)).toBe(true);
  });

  it('warns about invalid options in development builds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    devCheck('createChartShell', { commandPalette: commandPalette({ keys: ['Mod+P'], shortcutScope: 'document' }), features: { commandPalette: false } }, 'shell');
    expect(warn).not.toHaveBeenCalled();
    commandPalette({ shortcutScope: 'page', sorces: [] } as never);
    devCheck('createChartShell', { commandPalette: { keys: ['Mod+K'] } }, 'shell');
    const said = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(said).toContain('commandPalette: "shortcutScope" should be one of "shell", "document"');
    expect(said).toContain('unknown option "sorces" is ignored; did you mean "sources"?');
    // The options of the part go to its factory now.
    expect(said).toContain('createChartShell: "commandPalette" should be a function, got an object');
    warn.mockRestore();
  });
});
