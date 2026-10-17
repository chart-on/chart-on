import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countingWebgl2, dispatch, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { contextBudget, setContextBudget } from '../src/gl/context-budget';

const charts: Chart[] = [];
// Restore requests go out in a later task (see GLRenderer.#restoreSoon).
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  setContextBudget(12);
  vi.useRealTimers();
});

interface Fake {
  tagName: string;
  style: Record<string, string>;
  children: Fake[];
  dispatch(type: string): void;
}

/** A chart (static unless `interactive`) on a fake context whose lose-context extension records calls. */
function staticChart(interactive = false) {
  const loseContext = vi.fn();
  const restoreContext = vi.fn();
  const base = countingWebgl2().context as Record<string, unknown>;
  const context = new Proxy(base, {
    get: (target, key) =>
      key === 'getExtension' ? () => ({ loseContext, restoreContext }) : target[key as string],
  });
  const c = new Chart(fakeContainer({ webgl: context }), { interactive });
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 30 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
  restoreContext.mockImplementation(() => asked.add(c));
  return { c, loseContext, restoreContext };
}

const inside = (c: Chart) =>
  c as unknown as {
    glCanvas: Fake;
    snapshot: Fake | null;
    raf: number;
    frame(now: number): void;
    renderer: { budget: 'held' | 'evicting' | 'evicted' | 'restoring'; lost: boolean };
  };
/** Run the frame the chart asked for. */
const frame = (c: Chart, now = 1000) => inside(c).frame(now);
/** The browser reports the loss, then the restore. */
const lost = (c: Chart) => inside(c).glCanvas.dispatch('webglcontextlost');
const restored = (c: Chart) => inside(c).glCanvas.dispatch('webglcontextrestored');

/**
 * Play the browser's part until the charts rest: deliver the lost and restored
 * events their lose-context calls asked for, and run the frames they request.
 * A restore is answered once its request went out, in a later task.
 */
function settle(list: Chart | Chart[], now = 1000): void {
  const all = Array.isArray(list) ? list : [list];
  for (let i = 0; i < 40; i++) {
    let busy = false;
    for (const c of all) {
      const r = inside(c).renderer;
      if (r.budget === 'evicting' || (r.budget === 'restoring' && !r.lost)) lost(c);
      else if (r.budget === 'restoring' && asked.has(c)) {
        asked.delete(c);
        restored(c);
      } else if (inside(c).raf) frame(c, now + 16 * i);
      else continue;
      busy = true;
    }
    vi.advanceTimersByTime(0);
    if (!busy && !all.some((c) => inside(c).renderer.budget === 'restoring')) return;
  }
  throw new Error('the charts did not settle');
}
/** Charts whose restore request went out and has not been answered yet. */
const asked = new Set<Chart>();

describe('static charts', () => {
  it('show the GPU layer from a 2D copy and take no input', () => {
    const { c } = staticChart();
    const canvases = (c.root as unknown as Fake).children.filter((el) => el.tagName === 'canvas');
    expect(canvases).toHaveLength(4);
    expect(inside(c).glCanvas.style.visibility).toBe('hidden');
    expect(inside(c).snapshot).not.toBeNull();
    expect(c.root.tabIndex).toBe(-1);
    dispatch(c.root, 'pointermove', { clientX: 200, clientY: 200 });
    dispatch(c.root, 'wheel', { deltaY: -100, clientX: 200, clientY: 200 });
    expect((c as unknown as { crosshair: unknown }).crosshair).toBeNull();
    expect(c.barSpacing).toBe(c.options.barSpacing);
    c.applyOptions({ interactive: true, smoothScale: true });
    expect(c.options).toMatchObject({ interactive: false, smoothScale: false, animateViewChanges: false });
  });

  it('give the context back once a drawing settles, and take it back to draw again', () => {
    const { c, loseContext, restoreContext } = staticChart();
    settle(c);
    expect(inside(c).renderer.budget).toBe('evicted');
    expect(contextBudget.held).toBe(0);

    // New data: a context comes back, the chart draws, then gives it up again.
    const losses = loseContext.mock.calls.length;
    const restores = restoreContext.mock.calls.length;
    c.main!.update({ time: 30 * 60, open: 1, high: 3, low: 0, close: 2 });
    vi.advanceTimersByTime(0);
    expect(restoreContext.mock.calls.length).toBe(restores + 1);
    settle(c, 5000);
    expect(loseContext.mock.calls.length).toBe(losses + 1);
    expect(inside(c).renderer.budget).toBe('evicted');
  });

  it('draw a live update of the last bar at once and give the context back', () => {
    const { c } = staticChart();
    settle(c);
    c.main!.update({ time: 29 * 60, open: 1, high: 3, low: 0, close: 2 });
    vi.advanceTimersByTime(0);
    expect(asked.has(c)).toBe(true);
    asked.delete(c);
    restored(c);
    // One frame draws the bar where it ends up (no tween), so the context goes straight back.
    frame(c, 2000);
    expect(inside(c).renderer.budget).toBe('evicting');
  });

  it('let many charts share a small budget', () => {
    setContextBudget(2);
    for (let i = 0; i < 6; i++) {
      const { c } = staticChart();
      settle(c);
      expect(contextBudget.held).toBeLessThanOrEqual(2);
    }
    expect(contextBudget.held).toBe(0);
  });

  it('wait for a context to draw rather than take one from a chart in view', () => {
    setContextBudget(3);
    const main = staticChart(true);
    const list = Array.from({ length: 8 }, () => staticChart().c);
    settle([main.c, ...list]);
    // Creating the static charts may have evicted it; input takes the context back.
    dispatch(main.c.root, 'focusin');
    settle([main.c, ...list]);
    expect(inside(main.c).renderer.lost).toBe(false);
    const losses = main.loseContext.mock.calls.length;
    // Every static chart redraws at once, more than the budget has room for.
    for (const c of list) c.main!.update({ time: 30 * 60, open: 1, high: 3, low: 0, close: 2 });
    let most = 0;
    for (let i = 0; i < 40 && list.some((c) => inside(c).renderer.budget !== 'evicted'); i++) {
      settle(list.filter((c) => inside(c).renderer.budget !== 'evicted'));
      most = Math.max(most, contextBudget.held);
    }
    expect(most).toBeLessThanOrEqual(3);
    // Each one got a context back and drew, then gave it up; the interactive chart kept its own.
    for (const c of list) expect(inside(c).renderer.budget).toBe('evicted');
    expect(main.loseContext.mock.calls.length).toBe(losses);
    expect(contextBudget.held).toBe(1);
  });
});
