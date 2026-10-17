/**
 * What the chart needs from a browser beyond the DOM test environment: WebGL2
 * and Canvas2D contexts (counted, so tests can check none is left behind),
 * observers, media queries and animation frames. Frames run only through
 * `runFrames`.
 */
import { vi } from 'vitest';
import { fakeWebgl2 } from '../../core/src/testing/environment';

export interface Browser {
  /** WebGL2 contexts created so far. */
  readonly created: number;
  /** WebGL2 contexts created and not yet released. */
  readonly live: number;
  /** Animation frames requested and not yet run. */
  readonly frames: number;
  /** Run the pending frames once. */
  runFrames(): void;
  restore(): void;
}

/** A Canvas2D context whose every call does nothing and returns something callable. */
function context2d(): unknown {
  const sink: unknown = new Proxy(() => sink, {
    get: (_t, key) => (key === 'measureText' ? (text: string) => ({ width: text.length * 6 }) : key === Symbol.toPrimitive ? () => 0 : sink),
    set: () => true,
    apply: () => sink,
  });
  return sink;
}

export function installBrowser(): Browser {
  const live = new Set<object>();
  let created = 0;
  const webgl = (): object => {
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
                    live.delete(context);
                  },
                  restoreContext: () => {},
                }
              : null;
        }
        return target[key as string];
      },
    });
    live.add(context);
    created++;
    return context;
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    type === 'webgl2' ? webgl() : context2d()) as never);

  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  let clock = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(nextFrame, callback);
    return nextFrame++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));

  return {
    get created() {
      return created;
    },
    get live() {
      return live.size;
    },
    get frames() {
      return frames.size;
    },
    runFrames() {
      const due = [...frames.values()];
      frames.clear();
      clock += 16;
      for (const callback of due) callback(clock);
    },
    restore() {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}
