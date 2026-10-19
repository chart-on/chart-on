import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chart } from '@chart-on/core';
import { fakeContainer, runFrame } from '../../core/test/fake-dom';
import { createNavigator } from '../src/navigator';
import { createChartShell } from '../src/shell';
import {
  centerWindow,
  decimate,
  indexAtTime,
  panWindow,
  rangeFromWindow,
  refreshLastColumn,
  resizeWindow,
  windowFromRange,
  type NavigatorPoint,
} from '../src/navigator-model';

const line = (values: number[]): NavigatorPoint[] => values.map((value, i) => ({ time: i * 60, value }));

describe('decimate', () => {
  it('keeps one column per point while they fit', () => {
    const o = decimate(line([3, 1, 2]), 10);
    expect(o.count).toBe(3);
    expect([...o.cols]).toEqual([3, 3, 3, 3, 1, 1, 1, 1, 2, 2, 2, 2]);
    expect([o.min, o.max]).toEqual([1, 3]);
  });

  it('keeps first, low, high and last of each column', () => {
    const o = decimate(line([5, 1, 9, 4, 2, 8, 7, 3]), 2);
    expect(o.count).toBe(2);
    expect([...o.cols]).toEqual([5, 1, 9, 4, 2, 2, 8, 3]);
  });

  it('reads bar closes and skips values that are not finite', () => {
    const bars = [
      { time: 0, close: 4 },
      { time: 60, close: NaN },
      { time: 120, close: 6 },
    ];
    const o = decimate(bars, 1);
    expect([...o.cols]).toEqual([4, 4, 6, 6]);
  });

  it('is empty without points or width', () => {
    expect(decimate([], 100).count).toBe(0);
    expect(decimate(line([1, 2]), 0).count).toBe(0);
    expect(decimate([], 100).min).toBeNaN();
  });

  it('reduces a million points to the pixel width quickly', () => {
    const points = Array.from({ length: 1_000_000 }, (_, i) => ({ time: i, value: Math.sin(i / 1000) }));
    const started = performance.now();
    const o = decimate(points, 800);
    const ms = performance.now() - started;
    expect(o.count).toBe(800);
    expect(o.min).toBeCloseTo(-1, 3);
    expect(o.max).toBeCloseTo(1, 3);
    // Generous for slow CI machines; a full pass is a few milliseconds locally.
    expect(ms).toBeLessThan(500);
  });

  it('reuses the buffer it is given', () => {
    const a = decimate(line([1, 2, 3, 4]), 4);
    const b = decimate(line([1, 2]), 4, a);
    expect(b.cols).toBe(a.cols);
  });
});

describe('refreshLastColumn', () => {
  it('updates the newest column after a tick', () => {
    const points = line([5, 1, 9, 4, 2, 8, 7, 3]);
    const o = decimate(points, 2);
    points[7] = { time: 420, value: 20 };
    expect(refreshLastColumn(points, o, 2)).toBe(true);
    expect([...o.cols.subarray(4)]).toEqual([2, 2, 20, 20]);
    expect(o.max).toBe(20);
  });

  it('asks for a full pass when the point count changed', () => {
    const points = line([1, 2]);
    const o = decimate(points, 10);
    points.push({ time: 120, value: 3 });
    expect(refreshLastColumn(points, o, 10)).toBe(false);
  });
});

describe('window math', () => {
  const points = line(Array.from({ length: 101 }, (_, i) => i));

  it('finds the first point at or after a time', () => {
    expect(indexAtTime(points, 0)).toBe(0);
    expect(indexAtTime(points, 61)).toBe(2);
    expect(indexAtTime(points, 99999)).toBe(101);
  });

  it('turns a time range into a window and back', () => {
    const win = windowFromRange(points, { from: 600, to: 3000 });
    expect(win).toEqual({ start: 0.1, end: 0.5 });
    expect(rangeFromWindow(points, win!)).toEqual({ from: 600, to: 3000 });
  });

  it('clamps a range past the newest bar to the end of the strip', () => {
    expect(windowFromRange(points, { from: 3000, to: 99999 })).toEqual({ start: 0.5, end: 1 });
  });

  it('has no window with fewer than two points', () => {
    expect(windowFromRange(line([1]), { from: 0, to: 0 })).toBeNull();
    expect(rangeFromWindow([], { start: 0, end: 1 })).toBeNull();
  });

  it('pans inside the history, keeping the width', () => {
    expect(panWindow({ start: 0.2, end: 0.4 }, 0.1).start).toBeCloseTo(0.3);
    expect(panWindow({ start: 0.2, end: 0.4 }, 5)).toEqual({ start: 0.8, end: 1 });
    expect(panWindow({ start: 0.2, end: 0.4 }, -5)).toEqual({ start: 0, end: 0.2 });
  });

  it('resizes one edge, keeping a minimum width', () => {
    expect(resizeWindow({ start: 0.2, end: 0.4 }, 'start', 0.1, 0.05)).toEqual({ start: 0.1, end: 0.4 });
    expect(resizeWindow({ start: 0.2, end: 0.4 }, 'start', 0.5, 0.05).start).toBeCloseTo(0.35);
    expect(resizeWindow({ start: 0.2, end: 0.4 }, 'end', 2, 0.05)).toEqual({ start: 0.2, end: 1 });
    expect(resizeWindow({ start: 0.2, end: 0.4 }, 'end', 0, 0.05).end).toBeCloseTo(0.25);
  });

  it('centres the window on a point', () => {
    const win = centerWindow({ start: 0, end: 0.2 }, 0.5);
    expect(win.start).toBeCloseTo(0.4);
    expect(win.end).toBeCloseTo(0.6);
  });
});

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

function setup(count = 500) {
  const container = fakeContainer();
  const c = new Chart(container, { timezone: 'UTC' });
  charts.push(c);
  const series = c.addCandles({ animate: false });
  series.setData(Array.from({ length: count }, (_, i) => ({ time: i * 60, open: 10, high: 20, low: 0, close: 10 + (i % 7) })));
  c.resize();
  runFrame(0);
  const nav = createNavigator(container, c);
  const parts = nav.el.children as unknown as HTMLElement[];
  const [, , , win, startHandle, endHandle] = parts;
  return { c, series, nav, win: win!, startHandle: startHandle!, endHandle: endHandle! };
}

/** Run the element's own listeners for `type`, like a browser event at the navigator. */
function fire(target: HTMLElement, owner: HTMLElement, type: string, init: Record<string, unknown>) {
  (owner as unknown as { dispatch(type: string, e: Record<string, unknown>): void }).dispatch(type, { target, ...init });
}

describe('createNavigator', () => {
  it('places the window over the visible range', () => {
    const { c, win } = setup();
    const range = c.getVisibleRange()!;
    const last = 499;
    expect(parseFloat(win.style.left!)).toBeCloseTo(((range.from / 60) / last) * 100, 1);
    expect(win.hidden).toBe(false);
    expect(win.getAttribute('role')).toBe('slider');
    expect(win.getAttribute('aria-valuetext')).toContain(' to ');
  });

  it('follows the chart without calling back into it', () => {
    const { c, nav, win } = setup();
    const set = vi.spyOn(c, 'setVisibleTimeRange');
    c.setVisibleTimeRange(6000, 12000, false);
    runFrame(16);
    runFrame(32);
    expect(set).toHaveBeenCalledTimes(1);
    nav.refresh();
    expect(parseFloat(win.style.left!)).toBeCloseTo((100 / 499) * 100, 0);
  });

  it('pans the chart with the arrow keys, without animation', () => {
    const { c, nav, win } = setup();
    c.setVisibleTimeRange(6000, 12000, false);
    nav.refresh();
    const set = vi.spyOn(c, 'setVisibleTimeRange');
    const before = c.getVisibleRange()!;
    const e = { key: 'ArrowRight', preventDefault: vi.fn() };
    fire(win, nav.el, 'keydown', e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]![2]).toBe(false);
    expect(c.getVisibleRange()!.from).toBeGreaterThan(before.from);
  });

  it('zooms with the handles from the keyboard', () => {
    const { c, nav, startHandle } = setup();
    c.setVisibleTimeRange(6000, 12000, false);
    nav.refresh();
    const before = c.getVisibleRange()!;
    fire(startHandle, nav.el, 'keydown', { key: 'PageDown', preventDefault() {} });
    const after = c.getVisibleRange()!;
    expect(after.from).toBeLessThan(before.from);
  });

  it('drags the window to pan', () => {
    const { c, nav, win } = setup();
    c.setVisibleTimeRange(6000, 12000, false);
    nav.refresh();
    const before = c.getVisibleRange()!;
    const set = vi.spyOn(c, 'setVisibleTimeRange');
    const left = parseFloat(win.style.left!) * 8; // the fake element is 800 px wide
    fire(win, nav.el, 'pointerdown', { button: 0, pointerId: 1, clientX: left + 5, preventDefault() {} });
    fire(win, nav.el, 'pointermove', { pointerId: 1, clientX: left + 85 });
    fire(win, nav.el, 'pointerup', { pointerId: 1 });
    expect(set).toHaveBeenCalled();
    expect(set.mock.calls.every((call) => call[2] === false)).toBe(true);
    expect(c.getVisibleRange()!.from).toBeGreaterThan(before.from);
  });

  it('ignores pans and zooms the chart features turn off', () => {
    const { c, nav, win, startHandle } = setup();
    c.applyOptions({ features: { scroll: false, zoom: false } });
    nav.refresh();
    const set = vi.spyOn(c, 'setVisibleTimeRange');
    fire(win, nav.el, 'keydown', { key: 'ArrowRight', preventDefault() {} });
    fire(win, nav.el, 'pointerdown', { button: 0, pointerId: 1, clientX: 10, preventDefault() {} });
    expect(set).not.toHaveBeenCalled();
    expect(startHandle.hidden).toBe(true);
    expect(win.getAttribute('aria-disabled')).toBe('true');
  });

  it('hides the window without data, and removes itself on destroy', () => {
    const { series, nav, win } = setup();
    series.setData([]);
    nav.refresh();
    expect(win.hidden).toBe(true);
    expect(nav.el.dataset.empty).toBe('true');
    const parent = (nav.el as unknown as { parent: unknown }).parent;
    expect(parent).not.toBeNull();
    nav.destroy();
    expect((nav.el as unknown as { parent: unknown }).parent).toBeNull();
  });
});

describe('shell navigator option', () => {
  afterEach(() => vi.unstubAllGlobals());

  function shellWith(navigator?: boolean | { height: number }) {
    const container = fakeContainer();
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    return createChartShell(container, { appearance: false, navigator });
  }

  it('is off by default', () => {
    const shell = shellWith();
    expect(shell.navigator).toBeNull();
    shell.destroy();
  });

  it('mounts the strip with its options and removes it on destroy', () => {
    const shell = shellWith({ height: 56 });
    expect(shell.navigator).not.toBeNull();
    expect(shell.navigator!.el.style.height).toBe('56px');
    const el = shell.navigator!.el as unknown as { parent: unknown };
    shell.destroy();
    expect(el.parent).toBeNull();
  });
});

describe('navigator language', () => {
  it('is named in the chart language and follows a change', () => {
    const { c, nav } = setup(20);
    expect(nav.el.getAttribute('aria-label')).toBe('Chart navigator');
    c.applyOptions({ localization: { messages: { navigatorLabel: 'Diagrammübersicht' } } });
    expect(nav.el.getAttribute('aria-label')).toBe('Diagrammübersicht');
    nav.destroy();
  });
});
