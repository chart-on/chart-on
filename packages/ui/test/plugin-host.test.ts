import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chart } from '@charton/core';
import { fakeContainer } from '../../core/test/fake-dom';
import { createChartShell, type ChartShell } from '../src/shell';
import { shellOf } from '../src/plugin-host';

const shells: ChartShell[] = [];
afterEach(() => {
  shells.splice(0).forEach((s) => s.destroy());
  vi.unstubAllGlobals();
});

describe('shellOf', () => {
  it('lets a plugin add toolbar items that go with it', () => {
    // The shell reads its theme from CSS custom properties; none are set here.
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    vi.stubGlobal('MutationObserver', class {
      observe(): void {}
      disconnect(): void {}
    });
    const shell = createChartShell(fakeContainer(), { appearance: false, toolbar: [{ type: 'button', id: 'app', label: 'App', onClick: () => {} }] });
    shells.push(shell);
    const chart: Chart = shell.chart;
    chart.install({
      name: 'kit',
      version: '1.0.0',
      install(ctx) {
        shellOf(ctx)?.addToolbarItem({ type: 'button', id: 'kit-ruler', group: 'analysis', label: 'Ruler', onClick: () => {} });
      },
    });
    expect(shell.toolbar!.get('kit-ruler')).toBeDefined();
    chart.uninstall('kit');
    expect(shell.toolbar!.get('kit-ruler')).toBeUndefined();
    expect(shell.toolbar!.get('app')).toBeDefined();
  });
});
