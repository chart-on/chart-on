import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer, installFakeDom } from '../../core/test/fake-dom';
import { createChartShell, type ChartShellOptions } from '../src/shell';
import { symbolSearch } from '../src/symbol-search';

installFakeDom();

const slash = { key: '/', code: 'Slash' };

function mount(options: ChartShellOptions = {}) {
  const shell = createChartShell(fakeContainer(), { appearance: false, settings: false, ...options });
  const open = vi.spyOn(shell.indicatorPicker!, 'open').mockImplementation(() => {});
  return { shell, open, chart: shell.chart };
}

beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal('MutationObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('navigator', { platform: 'Win32' });
});

afterEach(() => vi.unstubAllGlobals());

describe('indicator picker shortcut', () => {
  it('registers the indicator-picker action and removes it on destroy', () => {
    const { shell, chart } = mount();
    expect(chart.actions.get('indicator-picker')).toMatchObject({ label: 'Indicators', keys: ['/'], enabled: true });
    shell.destroy();
    expect(chart.actions.has('indicator-picker')).toBe(false);
  });

  it('has no shortcut with openOnSlash: false', () => {
    const { shell, chart } = mount({ indicatorPicker: { openOnSlash: false } });
    expect(chart.actions.get('indicator-picker')!.keys).toEqual([]);
    shell.destroy();
  });

  it('opens from the focused chart and follows rebinding', () => {
    const { shell, open, chart } = mount();
    expect(dispatch(chart.root, 'keydown', slash).defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    chart.actions.setKeys('indicator-picker', ['Alt+I']);
    dispatch(chart.root, 'keydown', slash);
    expect(open).toHaveBeenCalledTimes(1);
    dispatch(chart.root, 'keydown', { key: 'i', code: 'KeyI', altKey: true });
    expect(open).toHaveBeenCalledTimes(2);
    shell.destroy();
  });

  it('leaves / to the symbol search, without a conflicting binding', () => {
    const { shell, open, chart } = mount({ symbolSearch: symbolSearch({ source: { search: async () => [] }, onSelect: () => {} }) });
    expect(chart.actions.get('indicator-picker')!.keys).toEqual([]);
    expect(chart.actions.conflicts()).toEqual([]);
    const search = vi.spyOn(shell.symbolSearch!, 'open').mockImplementation(() => {});
    dispatch(chart.root, 'keydown', slash);
    expect(search).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    shell.destroy();
  });
});
