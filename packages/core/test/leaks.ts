/**
 * Counts what a chart holds on to outside itself, so lifecycle tests can check
 * that `destroy()` gives everything back: WebGL contexts, observers, global
 * listeners, media query listeners, timers and frame callbacks.
 */
import { vi } from 'vitest';
import { installFakeDom, pendingFrames } from './fake-dom';
import { fakeWebgl2 } from '../src/testing/environment';

export interface Held {
  /** WebGL2 contexts created and not yet released through `WEBGL_lose_context`. */
  contexts: number;
  /** `ResizeObserver`, `IntersectionObserver` and `MutationObserver` instances not disconnected. */
  observers: number;
  /** Listeners on `window` and `document`. */
  globalListeners: number;
  /** Listeners on `matchMedia` query lists. */
  mediaListeners: number;
  /** Pending `setTimeout` and `setInterval` timers. */
  timers: number;
  /** Requested animation frames not yet run or cancelled. */
  frames: number;
}

export interface LeakTracker {
  /** What is held right now. */
  held(): Held;
  /** WebGL2 contexts created so far, released or not. */
  readonly contextsCreated: number;
  /** Undo the stubs. */
  restore(): void;
}

/**
 * Install counting stubs. Call before creating charts; uses fake timers, so
 * pass time with `vi.advanceTimersByTime` if a test needs it.
 */
export function trackLeaks(): LeakTracker {
  installFakeDom();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

  const liveContexts = new Set<object>();
  let contextsCreated = 0;
  const makeContext = (): unknown => {
    const base = fakeWebgl2() as Record<string, unknown>;
    let lost = false;
    const context: object = new Proxy(base, {
      get: (target, key) => {
        if (key === 'isContextLost') return () => lost;
        if (key === 'getExtension') {
          return (name: string) =>
            name === 'WEBGL_lose_context'
              ? {
                  loseContext: () => {
                    lost = true;
                    liveContexts.delete(context);
                  },
                  restoreContext: () => {},
                }
              : null;
        }
        return target[key as string];
      },
    });
    liveContexts.add(context);
    contextsCreated++;
    return context;
  };

  // Every canvas gets its own counted context, so each chart's (or the shared one) shows up.
  const doc = document as unknown as { createElement(tag: string): Record<string, unknown> };
  const createElement = doc.createElement;
  vi.spyOn(doc, 'createElement').mockImplementation((tag: string) => {
    const el = createElement(tag);
    if (tag === 'canvas') {
      const getContext = el.getContext as (type: string) => unknown;
      el.getContext = (type: string) => (type === 'webgl2' ? makeContext() : getContext.call(el, type));
    }
    return el;
  });

  const liveObservers = new Set<object>();
  const observer = class {
    constructor() {
      liveObservers.add(this);
    }
    observe(): void {}
    unobserve(): void {}
    takeRecords(): unknown[] {
      return [];
    }
    disconnect(): void {
      liveObservers.delete(this);
    }
  };
  vi.stubGlobal('ResizeObserver', observer);
  vi.stubGlobal('IntersectionObserver', observer);
  vi.stubGlobal('MutationObserver', observer);

  // Listeners on window and document, counted by (target, type, listener, capture) like the DOM does.
  const globalKeys = new Set<string>();
  const ids = new WeakMap<object, number>();
  let nextId = 1;
  const idOf = (fn: object) => ids.get(fn) ?? (ids.set(fn, nextId++), nextId - 1);
  const capture = (options: unknown) =>
    options === true || (typeof options === 'object' && options !== null && Boolean((options as { capture?: boolean }).capture));
  for (const [name, target] of [
    ['window', window],
    ['document', document],
  ] as const) {
    const t = target as unknown as EventTarget;
    const add = t.addEventListener.bind(t);
    const remove = t.removeEventListener.bind(t);
    vi.spyOn(t, 'addEventListener').mockImplementation((type, fn, options) => {
      if (fn) globalKeys.add(`${name}|${type}|${idOf(fn)}|${capture(options)}`);
      add(type, fn, options);
    });
    vi.spyOn(t, 'removeEventListener').mockImplementation((type, fn, options) => {
      if (fn) globalKeys.delete(`${name}|${type}|${idOf(fn)}|${capture(options)}`);
      remove(type, fn, options);
    });
  }

  const liveMedia = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: query.includes('reduce'),
    addEventListener: (_type: string, fn: () => void) => liveMedia.add(fn),
    removeEventListener: (_type: string, fn: () => void) => liveMedia.delete(fn),
  }));

  return {
    held: () => ({
      contexts: liveContexts.size,
      observers: liveObservers.size,
      globalListeners: globalKeys.size,
      mediaListeners: liveMedia.size,
      timers: vi.getTimerCount(),
      frames: pendingFrames(),
    }),
    get contextsCreated() {
      return contextsCreated;
    },
    restore() {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    },
  };
}

/** Nothing held. */
export const NOTHING_HELD: Held = {
  contexts: 0,
  observers: 0,
  globalListeners: 0,
  mediaListeners: 0,
  timers: 0,
  frames: 0,
};
