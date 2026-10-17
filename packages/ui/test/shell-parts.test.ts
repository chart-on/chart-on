import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { annotations, Chart, replay, trading } from '@charton/core';
import { fakeContainer, installFakeDom } from '../../core/test/fake-dom';
import { clusterList } from '../src/cluster-list';
import { commandPalette, commandPaletteToolbarItem } from '../src/command-palette';
import { draftEditor } from '../src/draft-editor';
import { replayControls } from '../src/replay';
import { favorites } from '../src/favorites';
import { createChartShell, type ChartShell } from '../src/shell';
import { symbolSearch } from '../src/symbol-search';
import { toasts } from '../src/toasts';
import { toolbarCustomization } from '../src/toolbar-customization';
import { symbolHeader } from '../src/toolbar-presets';

installFakeDom();

const shells: ChartShell[] = [];
beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', paddingRight: '0' }));
  vi.stubGlobal('MutationObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
});
afterEach(() => {
  shells.splice(0).forEach((s) => s.destroy());
  vi.unstubAllGlobals();
});

const toolbar = () => [symbolHeader(), commandPaletteToolbarItem()];
const disabled = (shell: ChartShell, id: string) => (shell.toolbar!.get(id)!.el as HTMLButtonElement).disabled;

describe('shell parts', () => {
  it('leaves the symbol search, palette, favourites, toasts and toolbar customization out by default', () => {
    const shell = createChartShell(fakeContainer(), { appearance: false, settings: false, toolbar: { items: toolbar(), settings: null } });
    shells.push(shell);
    expect([shell.symbolSearch, shell.commandPalette, shell.favorites, shell.toasts]).toEqual([null, null, null, null]);
    expect(shell.chart.actions.has('symbol-search')).toBe(false);
    expect(shell.chart.actions.has('command-palette')).toBe(false);
    expect(disabled(shell, 'symbol')).toBe(true);
    expect(disabled(shell, 'command-palette')).toBe(true);
    expect(() => shell.toolbar!.openCustomization()).not.toThrow();
    expect(shell.el.querySelector('.pc-toolbar-customization')).toBeNull();
    expect(() => shell.toolbar!.registerAction({ id: 'x', label: 'X', onClick() {} })).toThrow(/toolbarCustomization\(\)/);
  });

  it('creates each part passed, and the palette takes Mod+K from the symbol search', () => {
    const shell = createChartShell(fakeContainer(), {
      appearance: false,
      settings: false,
      toolbar: { items: toolbar(), customize: toolbarCustomization(), settings: null },
      symbolSearch: symbolSearch({ source: { search: async () => [] }, onSelect: () => {} }),
      commandPalette: commandPalette(),
      favorites: favorites({ storage: null }),
      toasts: toasts(),
    });
    shells.push(shell);
    expect([shell.symbolSearch, shell.commandPalette, shell.favorites, shell.toasts].every((part) => part !== null)).toBe(true);
    expect(shell.chart.actions.get('symbol-search')!.keys).toEqual(['/']);
    expect(shell.chart.actions.get('command-palette')!.keys).toEqual(['Mod+K']);
    expect(disabled(shell, 'symbol')).toBe(false);
    expect(disabled(shell, 'command-palette')).toBe(false);
    shell.toolbar!.openCustomization();
    expect(shell.el.querySelector('.pc-toolbar-customization')).not.toBeNull();
    shell.destroy();
    expect(shell.chart.actions.has('symbol-search')).toBe(false);
  });

  it('leaves the order cluster list and draft editor out by default, and the replay strip with an own toolbar', () => {
    const shell = createChartShell(fakeContainer(), { appearance: false, settings: false, toolbar: [] });
    shells.push(shell);
    expect([shell.replayControls, shell.clusterList, shell.draftEditor]).toEqual([null, null, null]);
    expect(shell.chart.root.querySelector('.pc-replay-bar')).toBeNull();
    // The default toolbar has the replay button, so it brings the strip.
    const plain = createChartShell(fakeContainer(), { appearance: false, settings: false });
    shells.push(plain);
    expect(plain.replayControls).not.toBeNull();
  });

  it('creates the replay strip, order cluster list and draft editor when passed', () => {
    const shell = createChartShell(fakeContainer(), {
      appearance: false,
      settings: false,
      replayControls: replayControls(),
      clusterList: clusterList(),
      draftEditor: draftEditor({ quantityPresets: [1, 10] }),
    });
    shells.push(shell);
    expect([shell.replayControls, shell.clusterList, shell.draftEditor].every((part) => part !== null)).toBe(true);
    expect(shell.chart.root.querySelector('.pc-replay-bar')).not.toBeNull();
    shell.destroy();
    expect(shell.chart.root.querySelector('.pc-replay-bar')).toBeNull();
  });

  it('names the core plugin a part is missing', () => {
    const chart = new Chart(fakeContainer(), { plugins: [] });
    try {
      expect(() => replayControls()(chart)).toThrow(/replayControls\(\) needs the replay\(\) plugin/);
      expect(() => clusterList()(chart)).toThrow(/clusterList\(\) needs the trading\(\) plugin/);
      expect(() => draftEditor()(chart)).toThrow(/draftEditor\(\) needs the trading\(\) plugin/);
      chart.install(replay());
      chart.install(annotations());
      chart.install(trading());
      for (const part of [replayControls()(chart), clusterList()(chart), draftEditor()(chart)]) part.destroy();
    } finally {
      chart.destroy();
    }
  });
});
