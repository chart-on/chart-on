import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer, runFrame } from '../../core/test/fake-dom';
import { NOTHING_HELD, trackLeaks, type LeakTracker } from '../../core/test/leaks';
import { createChartShell, type ChartShell } from '../src/shell';

/** The shell side of the wrapper contract (docs/guide/frameworks.md). */

let tracker: LeakTracker;
beforeEach(() => {
  tracker = trackLeaks();
  // No stylesheet here: the shell falls back to the built-in themes.
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
});
afterEach(() => tracker.restore());

function mount(): ChartShell {
  const shell = createChartShell(fakeContainer(), { theme: 'system' });
  shell.chart.addCandles().setData(Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
  runFrame(16);
  return shell;
}

describe('shell lifecycle', () => {
  it('leaves no WebGL context, observer, listener or timer after 100 mounts and destroys', () => {
    for (let i = 0; i < 100; i++) mount().destroy();
    runFrame(32);
    expect(tracker.contextsCreated).toBe(100);
    expect(tracker.held()).toEqual(NOTHING_HELD);
  });

  it('is safe to destroy twice', () => {
    const container = fakeContainer();
    const shell = createChartShell(container);
    const destroyChart = vi.spyOn(shell.chart, 'destroy');
    shell.destroy();
    expect(() => shell.destroy()).not.toThrow();
    expect(destroyChart).toHaveBeenCalledTimes(1);
    expect((container as unknown as { children: unknown[] }).children).toHaveLength(0);
  });

  it('changes theme, palette and features in place', () => {
    const shell = mount();
    const chart = shell.chart;
    shell.setTheme('light');
    shell.setPalette('color-safe');
    shell.applyFeatures({ toolbar: false });
    shell.chart.applyOptions({ barSpacing: 12 });
    expect(shell.chart).toBe(chart);
    expect(shell.resolvedTheme).toBe('light');
    expect(tracker.contextsCreated).toBe(1);
    shell.destroy();
    expect(tracker.held()).toEqual(NOTHING_HELD);
  });
});
