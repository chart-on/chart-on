import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { countingWebgl2, dispatch, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { ContextBudget, contextBudget, getContextBudget, setContextBudget } from '../src/gl/context-budget';
import type { ContextLossReason } from '../src/gl/renderer';

interface Fake {
  dispatch(type: string, event?: Record<string, unknown>): void;
}

interface Handle {
  chart: Chart;
  loseContext: ReturnType<typeof vi.fn>;
  restoreContext: ReturnType<typeof vi.fn>;
  events: string[];
}

const handles: Handle[] = [];
/** IntersectionObserver callbacks by observed element. */
const observers = new Map<unknown, (entries: Array<{ isIntersecting: boolean }>) => void>();

beforeAll(() => {
  (globalThis as Record<string, unknown>).IntersectionObserver = class {
    constructor(private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) {}
    observe(el: unknown): void {
      observers.set(el, this.callback);
    }
    disconnect(): void {}
  };
});
afterAll(() => {
  delete (globalThis as Record<string, unknown>).IntersectionObserver;
});
// Restore requests go out in a later task (see GLRenderer.#restoreSoon).
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => {
  handles.splice(0).forEach((h) => h.chart.destroy());
  observers.clear();
  setContextBudget(12);
  vi.useRealTimers();
});

/** A chart whose fake context has a lose-context extension that records calls, like a browser before its events arrive. */
function chart(): Handle {
  const loseContext = vi.fn();
  const restoreContext = vi.fn();
  const base = countingWebgl2().context as Record<string, unknown>;
  const context = new Proxy(base, {
    get: (target, key) =>
      key === 'getExtension'
        ? (name: string) => (name === 'WEBGL_lose_context' ? { loseContext, restoreContext } : null)
        : target[key as string],
  });
  const c = new Chart(fakeContainer({ webgl: context }));
  const events: string[] = [];
  c.on('context:lost', ({ reason }) => events.push(`lost:${reason}`));
  c.on('context:restored', ({ reason }) => events.push(`restored:${reason}`));
  const handle = { chart: c, loseContext, restoreContext, events };
  handles.push(handle);
  return handle;
}

const glCanvas = (h: Handle) => (h.chart as unknown as { glCanvas: Fake }).glCanvas;
const root = (h: Handle) => (h.chart as unknown as { root: unknown }).root;
/** The browser delivers the lost event a `loseContext` call queued. */
const lostLands = (h: Handle) => glCanvas(h).dispatch('webglcontextlost');
const restoredLands = (h: Handle) => glCanvas(h).dispatch('webglcontextrestored');
const inView = (h: Handle, visible: boolean) => observers.get(root(h))!([{ isIntersecting: visible }]);
/** The task after the current one runs: restore requests waiting for it go out. */
const nextTask = () => vi.advanceTimersByTime(0);
/** Indexes into `list` of the charts asked to give their context up. */
const evicted = (list: Handle[]) => list.flatMap((h, i) => (h.loseContext.mock.calls.length > 0 ? [i] : []));

describe('context budget', () => {
  it('never holds more contexts than the budget, evicting the least recently used first', () => {
    setContextBudget(3);
    const list: Handle[] = [];
    for (let i = 0; i < 7; i++) {
      list.push(chart());
      expect(contextBudget.held).toBeLessThanOrEqual(3);
    }
    expect(contextBudget.held).toBe(3);
    expect(evicted(list)).toEqual([0, 1, 2, 3]);
    for (const h of list.slice(0, 4)) {
      expect(h.loseContext).toHaveBeenCalledOnce();
      lostLands(h);
      expect(h.events).toEqual(['lost:budget']);
    }
    expect(evicted(list.slice(4))).toEqual([]);
  });

  it('evicts the chart out of view the longest before any chart in view', () => {
    setContextBudget(3);
    const [a, b, c] = [chart(), chart(), chart()];
    inView(b!, false);
    inView(a!, false);
    // c was used last, but b has been out of view the longest.
    const d = chart();
    expect(evicted([a!, b!, c!, d])).toEqual([1]);
    const e = chart();
    expect(evicted([a!, b!, c!, d, e])).toEqual([0, 1]);
  });

  it('takes a context back when the chart scrolls into view, evicting another', () => {
    setContextBudget(2);
    const [a, b] = [chart(), chart()];
    inView(a!, false);
    const c = chart();
    expect(evicted([a!, b!, c])).toEqual([0]);
    lostLands(a!);

    inView(a!, true);
    nextTask();
    expect(a!.restoreContext).toHaveBeenCalledOnce();
    // b is now the least recently used chart in view.
    expect(evicted([b!, c])).toEqual([0]);
    expect(contextBudget.held).toBe(2);
    restoredLands(a!);
    expect(a!.events).toEqual(['lost:budget', 'restored:budget']);
  });

  it('takes a context back on input', () => {
    setContextBudget(1);
    const [a, b] = [chart(), chart()];
    lostLands(a!);
    dispatch(root(a!), 'focusin');
    nextTask();
    expect(a!.restoreContext).toHaveBeenCalledOnce();
    expect(b!.loseContext).toHaveBeenCalledOnce();
    expect(contextBudget.held).toBe(1);
    // Input on a chart that holds its context changes nothing.
    restoredLands(a!);
    dispatch(root(a!), 'focusin');
    nextTask();
    expect(a!.restoreContext).toHaveBeenCalledOnce();
  });

  it('restores only once the lost event has landed, in a task after its handler', () => {
    setContextBudget(1);
    const [a] = [chart(), chart()];
    dispatch(root(a!), 'focusin');
    // Asked back before the browser reported the loss: it counts as held already.
    nextTask();
    expect(a!.restoreContext).not.toHaveBeenCalled();
    expect(contextBudget.held).toBe(1);
    // The browser refuses a restore from the lost handler (or a microtask after it).
    lostLands(a!);
    expect(a!.restoreContext).not.toHaveBeenCalled();
    nextTask();
    expect(a!.restoreContext).toHaveBeenCalledOnce();
    restoredLands(a!);
    expect(a!.events).toEqual(['lost:budget', 'restored:budget']);
  });

  it('asks again while a restore goes unanswered, then stops counting the context', () => {
    setContextBudget(1);
    const [a, b] = [chart(), chart()];
    lostLands(a!);
    dispatch(root(a!), 'focusin');
    lostLands(b!);
    nextTask();
    expect(a!.restoreContext).toHaveBeenCalledTimes(1);
    // A refused request: no restored event comes.
    vi.advanceTimersByTime(500);
    expect(a!.restoreContext).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000 + 2000);
    expect(a!.restoreContext).toHaveBeenCalledTimes(4);
    expect(contextBudget.held).toBe(1);
    // Given up: the slot goes back to the budget, and the next use asks again.
    vi.advanceTimersByTime(4000);
    expect(contextBudget.held).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(a!.restoreContext).toHaveBeenCalledTimes(4);
    dispatch(root(a!), 'focusin');
    nextTask();
    expect(a!.restoreContext).toHaveBeenCalledTimes(5);
  });

  it('stops asking once the context is back, or the chart is gone', () => {
    setContextBudget(1);
    const [a, b] = [chart(), chart()];
    lostLands(a!);
    dispatch(root(a!), 'focusin');
    nextTask();
    restoredLands(a!);
    vi.advanceTimersByTime(60_000);
    expect(a!.restoreContext).toHaveBeenCalledOnce();

    lostLands(b!);
    dispatch(root(b!), 'focusin');
    b!.chart.destroy();
    vi.advanceTimersByTime(60_000);
    expect(b!.restoreContext).not.toHaveBeenCalled();
  });

  it('waits for room while every other context is still being restored', () => {
    setContextBudget(1);
    const [a, b] = [chart(), chart()];
    lostLands(a!);
    dispatch(root(a!), 'focusin');
    lostLands(b!);
    nextTask();
    // a's restore is under way and cannot be undone: b waits instead of going over the budget.
    dispatch(root(b!), 'focusin');
    nextTask();
    expect(b!.restoreContext).not.toHaveBeenCalled();
    expect(contextBudget.held).toBe(1);
    // Once a is back it can be evicted, and b takes the room.
    restoredLands(a!);
    expect(a!.loseContext).toHaveBeenCalledTimes(2);
    lostLands(a!);
    nextTask();
    expect(b!.restoreContext).toHaveBeenCalledOnce();
    expect(contextBudget.held).toBe(1);
  });

  it('wakes a waiting chart when another chart gives up on its restore', () => {
    setContextBudget(1);
    const [a, b] = [chart(), chart()];
    lostLands(a!);
    dispatch(root(a!), 'focusin');
    lostLands(b!);
    nextTask();
    dispatch(root(b!), 'focusin');
    nextTask();
    expect(b!.restoreContext).not.toHaveBeenCalled();
    // Every request for a is refused; once it gives up, its slot goes to b.
    vi.advanceTimersByTime(500 + 1000 + 2000 + 4000);
    expect(a!.restoreContext).toHaveBeenCalledTimes(4);
    // Asked in a timer set while a's last timer ran, which the fake timers schedule 1 ms later.
    vi.advanceTimersByTime(1);
    expect(b!.restoreContext).toHaveBeenCalledOnce();
    expect(contextBudget.held).toBe(1);
  });

  it('never asks for more contexts than the budget while many charts scroll in and out', () => {
    setContextBudget(3);
    // The browser's part: deliver the losses and restores the charts asked for, counting live contexts.
    let live = 0;
    let peak = 0;
    const losing = new Set<Handle>();
    const answered = new Map<Handle, number>();
    const list: Handle[] = [];
    for (let i = 0; i < 10; i++) {
      const h = chart();
      peak = Math.max(peak, ++live);
      h.loseContext.mockImplementation(() => {
        live--;
        losing.add(h);
      });
      answered.set(h, 0);
      list.push(h);
    }
    const browser = () => {
      for (let round = 0; round < 5; round++) {
        for (const h of losing) lostLands(h);
        losing.clear();
        nextTask();
        for (const h of list) {
          const asked = h.restoreContext.mock.calls.length;
          if (asked === answered.get(h)) continue;
          answered.set(h, asked);
          peak = Math.max(peak, ++live);
          restoredLands(h);
        }
      }
    };
    browser();
    for (let step = 0; step < 20; step++) {
      // Several charts change at once, so wakes arrive while restores are still under way.
      for (let k = 0; k < 3; k++) inView(list[(step * 3 + k) % list.length]!, (step + k) % 2 === 0);
      expect(contextBudget.held).toBeLessThanOrEqual(3);
      browser();
      expect(peak).toBeLessThanOrEqual(3);
    }
    // Three charts left in view all draw again.
    list.forEach((h, i) => inView(h, i >= 7));
    browser();
    expect(list.slice(7).map((h) => (h.chart as unknown as { renderer: { isLost: boolean } }).renderer.isLost)).toEqual([false, false, false]);
    expect(live).toBe(3);
  });

  it('frees a slot when a chart is destroyed', () => {
    setContextBudget(2);
    const [a, b] = [chart(), chart()];
    a!.chart.destroy();
    expect(a!.loseContext).toHaveBeenCalledOnce();
    const c = chart();
    expect(evicted([b!, c])).toEqual([]);
    expect(contextBudget.held).toBe(2);
  });

  it('evicts at once when the budget is lowered, and rejects invalid budgets', () => {
    const list = [chart(), chart(), chart(), chart()];
    setContextBudget(2);
    expect(getContextBudget()).toBe(2);
    expect(evicted(list)).toEqual([0, 1]);
    expect(() => setContextBudget(0)).toThrow(RangeError);
    expect(() => setContextBudget(1.5)).toThrow(RangeError);
    expect(getContextBudget()).toBe(2);
  });

  it('reports browser losses, and makes room when the browser restores a context', () => {
    setContextBudget(2);
    const [a, b] = [chart(), chart()];
    lostLands(a!);
    expect(a!.events).toEqual(['lost:browser']);
    const c = chart();
    expect(evicted([a!, b!, c])).toEqual([]);
    restoredLands(a!);
    expect(a!.events).toEqual(['lost:browser', 'restored:browser']);
    expect(evicted([b!, c])).toEqual([0]);
    const reasons: ContextLossReason[] = [];
    b!.chart.on('context:lost', ({ reason }) => reasons.push(reason));
    lostLands(b!);
    expect(reasons).toEqual(['budget']);
  });
});

describe('context budget queue', () => {
  /** A holder that gives its context up and gets one back at once, like a browser with no delay. */
  function holder(transient = false) {
    const h = {
      transient,
      holding: true,
      evict: vi.fn(() => {
        h.holding = false;
      }),
      reacquire: vi.fn(() => {
        h.holding = true;
      }),
    };
    return h;
  }

  it('keeps a static chart waiting while it is out of view, and wakes it when it is back', () => {
    const budget = new ContextBudget();
    budget.setLimit(1);
    const busy = holder();
    budget.add(busy);
    const statik = holder(true);
    budget.add(statik);
    budget.release(statik);
    // It wants to draw, but the only context belongs to a chart in view.
    budget.use(statik);
    expect(statik.reacquire).not.toHaveBeenCalled();
    expect(busy.evict).not.toHaveBeenCalled();
    // Out of view, a released context goes unused rather than to it.
    budget.setVisible(statik, false);
    budget.release(busy);
    expect(statik.reacquire).not.toHaveBeenCalled();
    // Back in view, it still wants its drawing.
    budget.setVisible(statik, true);
    expect(statik.reacquire).toHaveBeenCalledOnce();
    expect(budget.held).toBe(1);
  });

  it('makes room for a new static chart without taking an interactive chart in view', () => {
    const budget = new ContextBudget();
    budget.setLimit(2);
    const interactive = holder();
    budget.add(interactive);
    const first = holder(true);
    budget.add(first);
    // A second static chart is created while the first still draws: the first gives its context up, not the interactive chart.
    budget.reserve(true);
    expect(interactive.evict).not.toHaveBeenCalled();
    expect(first.evict).toHaveBeenCalledOnce();
    // An interactive chart being created may still take the least recently used one.
    budget.add(holder(true));
    budget.reserve();
    expect(interactive.evict).toHaveBeenCalledOnce();
  });

  it('does not wake a static chart that scrolls into view with nothing to draw', () => {
    const budget = new ContextBudget();
    budget.setLimit(2);
    const statik = holder(true);
    budget.add(statik);
    budget.release(statik);
    budget.setVisible(statik, false);
    budget.setVisible(statik, true);
    expect(statik.reacquire).not.toHaveBeenCalled();
  });
});
