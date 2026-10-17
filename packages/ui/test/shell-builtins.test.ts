import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builtinTools, drawingTools, heatmap, marketStatus } from '@charton/core';
import { fakeContainer } from '../../core/test/fake-dom';
import * as rail from '../src/rail';
import { createChartShell, type ChartShell } from '../src/shell';

// Core makes annotations, heatmaps, volume profiles and drawings opt-in plugins. The shell creates
// its chart with all of them unless the app passes its own `chart.plugins`; its parts need drawings
// and annotations, so it adds those two when the app's list leaves them out.

const shells: ChartShell[] = [];

beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  shells.splice(0).forEach((s) => s.destroy());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Tool types on the rail items the shell mounted. */
function railTools(mount: ReturnType<typeof vi.spyOn>): string[] {
  const items = mount.mock.calls.at(-1)![2] as rail.RailItem[];
  return items.flatMap((item) => (item.type === 'tool' ? [item.tool] : item.type === 'group' ? item.tools.map((t) => t.tool) : []));
}

describe('shell plugins', () => {
  it('creates its chart with every built-in drawing tool, heatmaps and volume profiles', () => {
    const mount = vi.spyOn(rail, 'mountToolRail');
    const shell = createChartShell(fakeContainer());
    shells.push(shell);
    expect(shell.chart.drawings.getTools().map((t) => t.type)).toEqual(builtinTools.map((t) => t.type));
    expect(shell.chart.addHeatmap().kind).toBe('heatmap');
    expect(shell.chart.addVolumeProfile().kind).toBe('volumeProfile');
    // builtins(), which the shell gives its chart by default, brings the reference lines.
    expect(shell.chart.installedPlugins).toContain('@charton/core/reference-lines');
    expect(shell.chart.installedPlugins).toContain('@charton/core/price-styles');
    expect(shell.chart.installedPlugins).toContain('@charton/core/grouping');
    expect(shell.chart.installedPlugins).toContain('@charton/core/last-point-pulse');
    expect(shell.chart.installedPlugins).toContain('@charton/core/localization');
    expect(shell.chart.installedPlugins).toContain('@charton/core/countdown');
    expect(shell.chart.installedPlugins).toContain('@charton/core/image-capture');
    expect(shell.chart.installedPlugins).toContain('@charton/core/market-status');
    expect(railTools(mount).sort()).toEqual(builtinTools.map((t) => t.type).sort());
  });

  it('keeps the plugins the app chose, and its rail offers only those tools', () => {
    const mount = vi.spyOn(rail, 'mountToolRail');
    const subset = builtinTools.filter((t) => t.type === 'trendline' || t.type === 'hline');
    const shell = createChartShell(fakeContainer(), { chart: { plugins: [heatmap(), drawingTools(subset)] } });
    shells.push(shell);
    expect(shell.chart.drawings.getTools().map((t) => t.type)).toEqual(['hline', 'trendline']);
    expect(railTools(mount)).toEqual(['hline', 'trendline']);
    expect(shell.chart.addHeatmap().kind).toBe('heatmap');
    expect(() => shell.chart.addVolumeProfile()).toThrow('volumeProfile()');
    // A second shell in the same page still gets everything.
    const other = createChartShell(fakeContainer());
    shells.push(other);
    expect(other.chart.drawings.getTools()).toHaveLength(builtinTools.length);
  });

  it('adds data sources, indicators, comparisons, drawings without tools, annotations, replay, source marks, adjustments, the watermark, saved layouts, image capture and trading when the app leaves them out', () => {
    const mount = vi.spyOn(rail, 'mountToolRail');
    const shell = createChartShell(fakeContainer(), { chart: { plugins: [heatmap()] } });
    shells.push(shell);
    // Before the app's plugins, so those can register indicators and drawing tools.
    expect(shell.chart.installedPlugins).toEqual([
      '@charton/core/data-source',
      '@charton/core/indicators',
      '@charton/core/comparisons',
      '@charton/core/drawings',
      '@charton/core/annotations',
      '@charton/core/replay',
      '@charton/core/source-markers',
      '@charton/core/adjustments',
      '@charton/core/watermark',
      '@charton/core/layouts',
      '@charton/core/image-capture',
      '@charton/core/heatmap',
      '@charton/core/trading',
    ]);
    expect(shell.chart.indicators.getAll()).toEqual([]);
    expect(shell.chart.drawings.getTools()).toEqual([]);
    expect(railTools(mount)).toEqual([]);
    expect(shell.chart.annotations.addPriceLine({ price: 1 }).options.price).toBe(1);
    expect(shell.chart.replay.state.active).toBe(false);
  });

  it('does not add the market status or the countdown to a list of the app’s own', () => {
    const shell = createChartShell(fakeContainer(), { chart: { plugins: [heatmap()] } });
    shells.push(shell);
    expect(shell.chart.installedPlugins).not.toContain('@charton/core/market-status');
    expect(shell.chart.installedPlugins).not.toContain('@charton/core/countdown');
    expect(() => shell.chart.marketStatus()).toThrow(expect.objectContaining({ code: 'not-registered' }));
    // Added by the app, it works in the shell.
    shell.chart.install(marketStatus());
    expect(['pre', 'open', 'post', 'closed']).toContain(shell.chart.marketStatus().phase);
  });
});
