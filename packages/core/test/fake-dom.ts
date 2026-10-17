/**
 * The chart's own test harness: the fake environment from
 * `src/testing/environment.ts`, plus WebGL contexts that count and record GPU
 * work.
 */
import { fakeWebgl2, installFakeDom, type FakeEvent } from '../src/testing/environment';

export {
  changeDevicePixelRatio,
  dispatch,
  fakeContainer,
  fireWindowResize,
  installFakeDom,
  mediaListeners,
  pendingFrames,
  runFrame,
  windowListeners,
  type FakeEvent,
} from '../src/testing/environment';

export interface FakeIntersection {
  /** Report whether `target` intersects the viewport to the observers watching it, like a browser on scroll. */
  setInView(target: unknown, inView: boolean): void;
  /** Elements observed by observers not yet disconnected. */
  observed(): number;
  /** Remove the fake `IntersectionObserver`. */
  uninstall(): void;
}

/**
 * Install a fake `IntersectionObserver` that reports only when a test calls
 * `setInView`. Charts made before it is installed have no observer.
 */
export function fakeIntersection(): FakeIntersection {
  type Callback = (entries: Array<{ target: unknown; isIntersecting: boolean }>) => void;
  const live = new Set<{ callback: Callback; targets: Set<unknown> }>();
  const g = globalThis as Record<string, unknown>;
  g.IntersectionObserver = class {
    private readonly entry: { callback: Callback; targets: Set<unknown> };
    constructor(callback: Callback) {
      this.entry = { callback, targets: new Set() };
      live.add(this.entry);
    }
    observe(target: unknown): void {
      this.entry.targets.add(target);
    }
    unobserve(target: unknown): void {
      this.entry.targets.delete(target);
    }
    takeRecords(): unknown[] {
      return [];
    }
    disconnect(): void {
      live.delete(this.entry);
    }
  };
  return {
    setInView(target, inView) {
      for (const { callback, targets } of [...live]) if (targets.has(target)) callback([{ target, isIntersecting: inView }]);
    },
    observed: () => [...live].reduce((n, o) => n + o.targets.size, 0),
    uninstall() {
      delete g.IntersectionObserver;
      live.clear();
    },
  };
}

/** Set `document.visibilityState` and fire `visibilitychange` on the document, like a browser switching tabs. */
export function setPageHidden(hidden: boolean): void {
  installFakeDom();
  const doc = document as unknown as { visibilityState?: string; invoke(e: FakeEvent, capture: boolean): void };
  doc.visibilityState = hidden ? 'hidden' : 'visible';
  const e: FakeEvent = { type: 'visibilitychange', target: doc, defaultPrevented: false, preventDefault() {}, stopPropagation() {} };
  doc.invoke(e, true);
  doc.invoke(e, false);
}

/** Listeners on the document for `type`. */
export function documentListeners(type: string): number {
  installFakeDom();
  return (document as unknown as { listenerCount(type: string): number }).listenerCount(type);
}

/** GPU object kinds the counting context tracks. */
export type GpuKind = 'buffer' | 'vertexArray' | 'texture';

export interface CountingGl {
  /** The fake WebGL2 context, for `fakeContainer({ webgl })`. */
  readonly context: unknown;
  /** Objects created and not yet deleted, per kind. */
  live(): Record<GpuKind, number>;
  created: Record<GpuKind, number>;
  deleted: Record<GpuKind, number>;
}

/** A fake WebGL2 context that counts buffer, vertex array and texture create/delete calls. */
export function countingWebgl2(): CountingGl {
  const base = fakeWebgl2() as Record<string, unknown>;
  const kinds: Record<string, GpuKind> = { Buffer: 'buffer', VertexArray: 'vertexArray', Texture: 'texture' };
  const alive = new Set<object>();
  const owner = new Map<object, GpuKind>();
  const zero = (): Record<GpuKind, number> => ({ buffer: 0, vertexArray: 0, texture: 0 });
  const counts = { created: zero(), deleted: zero() };
  const context = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key === 'string') {
          const match = /^(create|delete)(Buffer|VertexArray|Texture)$/.exec(key);
          if (match) {
            const kind = kinds[match[2]!]!;
            if (match[1] === 'create') {
              return () => {
                const handle = { kind };
                alive.add(handle);
                owner.set(handle, kind);
                counts.created[kind]++;
                return handle;
              };
            }
            return (handle: object | null) => {
              // Like WebGL, deleting null or an already deleted object does nothing.
              if (!handle || !alive.delete(handle)) return;
              if (owner.get(handle) !== kind) throw new Error(`${key} given a ${owner.get(handle)}`);
              counts.deleted[kind]++;
            };
          }
        }
        return base[key as string];
      },
    },
  );
  return {
    context,
    ...counts,
    live() {
      const out = zero();
      for (const handle of alive) out[owner.get(handle)!]++;
      return out;
    },
  };
}

/** A buffer upload: whole (`bufferData`) or partial (`bufferSubData`, byte offset and length). */
export interface BufferUpload {
  kind: 'data' | 'sub';
  offset: number;
  bytes: number;
}

/** A texture upload: whole (`texImage2D`) or partial (`texSubImage2D`), as a rect in texels. */
export interface TextureUpload {
  kind: 'image' | 'sub';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordingGl extends CountingGl {
  uploads: BufferUpload[];
  textures: TextureUpload[];
  /** `viewport` and `scissor` calls, as `[x, y, width, height]`. */
  viewports: number[][];
  scissors: number[][];
}

/** A counting fake WebGL2 context that also records uploads, viewports and scissor rects. */
export function recordingWebgl2(): RecordingGl {
  const counting = countingWebgl2();
  const uploads: BufferUpload[] = [];
  const textures: TextureUpload[] = [];
  const viewports: number[][] = [];
  const scissors: number[][] = [];
  const calls: Record<string, (...args: never[]) => unknown> = {
    bufferData: (_t: number, data: ArrayBufferView | number) =>
      uploads.push({ kind: 'data', offset: 0, bytes: typeof data === 'number' ? data : data.byteLength }),
    // The renderer uploads byte arrays, so its source offset and length are bytes.
    bufferSubData: (_t: number, offset: number, _src: ArrayBufferView, _srcOffset: number, length: number) =>
      uploads.push({ kind: 'sub', offset, bytes: length }),
    texImage2D: (_t: number, _level: number, _format: number, width: number, height: number) =>
      textures.push({ kind: 'image', x: 0, y: 0, width, height }),
    texSubImage2D: (_t: number, _level: number, x: number, y: number, width: number, height: number) =>
      textures.push({ kind: 'sub', x, y, width, height }),
    viewport: (...rect: number[]) => viewports.push(rect),
    scissor: (...rect: number[]) => scissors.push(rect),
  };
  const context = new Proxy(counting.context as Record<string, unknown>, {
    get: (target, key) => (typeof key === 'string' && key in calls ? calls[key] : target[key as string]),
  });
  return { ...counting, context, uploads, textures, viewports, scissors };
}
