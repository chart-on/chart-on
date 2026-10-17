import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeContainer, runFrame } from './fake-dom';
import { NOTHING_HELD, trackLeaks, type LeakTracker } from './leaks';
import { createChart, sharedContext, type Chart } from '../src/index';
import type { Bar } from '../src/types';

/**
 * The lifecycle every framework wrapper relies on (see docs/guide/frameworks.md):
 * create on mount, update in place, destroy on unmount, and leave nothing behind.
 */

let tracker: LeakTracker;
beforeEach(() => {
  tracker = trackLeaks();
});
afterEach(() => tracker.restore());

const bars = (n: number, from = 0): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ time: (from + i) * 60, open: 1, high: 2, low: 0, close: 1.5 }));

/** Mount a chart the way a wrapper does: container, options, a series with data, one frame. */
function mount(options: Parameters<typeof createChart>[1] = {}): Chart {
  const chart = createChart(fakeContainer(), options);
  chart.addCandles().setData(bars(50));
  chart.addLine().setData(bars(50).map(({ time }) => ({ time, value: 1 })));
  runFrame(16);
  return chart;
}

describe('chart lifecycle', () => {
  it('leaves no WebGL context, observer, listener or timer after 100 mounts and destroys', () => {
    for (let i = 0; i < 100; i++) mount().destroy();
    expect(tracker.contextsCreated).toBe(100);
    expect(tracker.held()).toEqual(NOTHING_HELD);
  });

  it('releases the shared context when the last of 100 shared charts is destroyed', () => {
    const charts = Array.from({ length: 100 }, () => mount({ gl: 'shared', plugins: [sharedContext()] }));
    expect(tracker.held().contexts).toBe(1);
    for (const chart of charts) chart.destroy();
    expect(tracker.contextsCreated).toBe(1);
    expect(tracker.held()).toEqual(NOTHING_HELD);
  });

  it('keeps holding resources while mounted', () => {
    const chart = mount();
    const held = tracker.held();
    expect(held.contexts).toBe(1);
    expect(held.observers).toBeGreaterThan(0);
    chart.destroy();
    expect(tracker.held()).toEqual(NOTHING_HELD);
  });

  it('applies option changes in place, without a new context', () => {
    const chart = mount();
    const root = chart.root;
    chart.applyOptions({ crosshair: { mode: 'free' }, barSpacing: 12 });
    chart.applyOptions({ theme: { up: '#00ff00' } });
    expect(chart.options.crosshair.mode).toBe('free');
    expect(chart.options.barSpacing).toBe(12);
    expect(chart.theme.up).toBe('#00ff00');
    expect(chart.root).toBe(root);
    expect(tracker.contextsCreated).toBe(1);
    chart.destroy();
  });

  it('takes data updates through the series, without a new context', () => {
    const chart = mount();
    const candles = chart.main!;
    candles.setData(bars(80));
    candles.update({ time: 80 * 60, open: 1, high: 3, low: 1, close: 2 });
    runFrame(32);
    expect(candles.data).toHaveLength(81);
    expect(tracker.contextsCreated).toBe(1);
    chart.destroy();
  });

  it('removes its element and tolerates a second destroy', () => {
    const container = fakeContainer();
    const chart = createChart(container);
    const children = () => (container as unknown as { children: unknown[] }).children;
    expect(children()).toHaveLength(1);
    chart.destroy();
    expect(children()).toHaveLength(0);
    expect(() => chart.destroy()).not.toThrow();
    expect(tracker.held()).toEqual(NOTHING_HELD);
  });

  it('stops forwarding events once destroyed', () => {
    const chart = mount();
    const seen: string[] = [];
    chart.on('theme:change', ({ theme }) => seen.push(theme.up));
    chart.applyOptions({ theme: { up: '#00ff00' } });
    chart.destroy();
    chart.applyOptions({ theme: { up: '#ff0000' } });
    expect(seen).toEqual(['#00ff00']);
  });
});
