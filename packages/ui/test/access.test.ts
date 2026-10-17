import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessItem, IndicatorDef } from '@charton/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { createChartShell, type ChartShell, type ChartShellOptions } from '../src/shell';
import { favorites } from '../src/favorites';
import { legendMenuItems } from '../src/legend-menu';

interface FakeNode {
  children: FakeNode[];
  dataset: Record<string, string>;
  getAttribute(name: string): string | null;
}
const fake = (el: unknown) => el as FakeNode;

function find(root: unknown, match: (n: FakeNode) => boolean): FakeNode | null {
  for (const child of fake(root).children) {
    if (match(child)) return child;
    const found = find(child, match);
    if (found) return found;
  }
  return null;
}
const byLabel = (root: unknown, label: string) => find(root, (n) => n.getAttribute('aria-label') === label);

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
  vi.unstubAllGlobals();
});

function shell(options: ChartShellOptions = {}) {
  const s = createChartShell(fakeContainer(), { toolbar: [], favorites: favorites({ storage: null }), ...options });
  shells.push(s);
  return s;
}

// A deny list written as a predicate.
const blockChannel = { allow: ({ id }: AccessItem) => id !== 'parallel-channel' };

describe('refused drawing tools in the rail', () => {
  it('are left out in hide mode', () => {
    const s = shell({ chart: { access: blockChannel } });
    expect(byLabel(s.rail!.el, 'Parallel channel')).toBeNull();
    s.chart.applyOptions({ access: { allow: null } });
    expect(byLabel(s.rail!.el, 'Parallel channel')).not.toBeNull();
  });

  it('show disabled in disable mode, and a press fires tool:refuse without arming the tool', () => {
    const s = shell({ chart: { access: { ...blockChannel, refused: 'disable' } } });
    const refused = vi.fn();
    s.chart.on('tool:refuse', refused);
    const button = byLabel(s.rail!.el, 'Parallel channel')!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    dispatch(button, 'click');
    expect(refused).toHaveBeenCalledWith({ tool: 'parallel-channel' });
    expect(s.chart.drawings.tool).toBeNull();
    expect(byLabel(s.rail!.el, 'Text')?.getAttribute('aria-disabled')).toBeNull();
  });

  it('switch between hide and disable at runtime', () => {
    const s = shell({ chart: { access: blockChannel } });
    s.chart.applyOptions({ access: { refused: 'disable' } });
    expect(byLabel(s.rail!.el, 'Parallel channel')?.getAttribute('aria-disabled')).toBe('true');
    s.chart.applyOptions({ access: { refused: 'hide' } });
    expect(byLabel(s.rail!.el, 'Parallel channel')).toBeNull();
  });

  it('follow the same rule in the favourites bar', () => {
    const s = shell({ chart: { access: { ...blockChannel, refused: 'disable' } }, favorites: favorites({ storage: null, tools: ['parallel-channel', 'ray'] }) });
    const refused = vi.fn();
    s.chart.on('tool:refuse', refused);
    const button = byLabel(s.favorites!.bar.el, 'Parallel channel')!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    dispatch(button, 'click');
    expect(refused).toHaveBeenCalledTimes(1);
    s.chart.applyOptions({ access: { refused: 'hide' } });
    expect(byLabel(s.favorites!.bar.el, 'Parallel channel')).toBeNull();
  });
});

describe('legend menu duplicate under the indicator limit', () => {
  const def: IndicatorDef = {
    id: 'test/avg',
    name: 'Avg',
    placement: 'overlay',
    inputs: [],
    plots: [{ id: 'v', type: 'line' }],
    compute: (src) => ({ v: Float64Array.from(src.close) }),
  };
  const setup = (refused: 'hide' | 'disable') => {
    const s = shell({ chart: { access: { limits: { indicators: 1 }, refused } } });
    s.chart.addCandles().setData([{ time: 60, open: 1, high: 2, low: 0, close: 1 }]);
    const indicator = s.chart.indicators.add(def);
    return { s, indicator };
  };
  const duplicateItem = (s: ChartShell, series: Parameters<typeof legendMenuItems>[1]) =>
    legendMenuItems(s.chart, series).find((item) => item.type === 'action' && item.id === 'duplicate');

  it('is left out in hide mode', () => {
    const { s, indicator } = setup('hide');
    expect(duplicateItem(s, indicator.series!)).toBeUndefined();
  });

  it('stays in disable mode and fires indicator:refuse when chosen', () => {
    const { s, indicator } = setup('disable');
    const refused = vi.fn();
    s.chart.on('indicator:refuse', refused);
    const item = duplicateItem(s, indicator.series!);
    expect(item).toBeDefined();
    if (item?.type === 'action') item.onSelect();
    expect(refused).toHaveBeenCalledWith({ type: 'test/avg', reason: 'limit' });
    expect(s.chart.indicators.getAll()).toHaveLength(1);
  });
});
