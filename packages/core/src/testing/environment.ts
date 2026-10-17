/**
 * Just enough DOM, Canvas2D and WebGL2 to construct a `Chart` under Node for
 * logic tests. Drawing calls are no-ops. Frames run only when a test asks
 * (`runFrame`), so most tests drive state through the public API or call
 * `render` directly. Events dispatched with `dispatch` run capture and bubble
 * listeners, ending at `document`.
 */

/** Callable no-op that returns itself for any property or call (gradients, paths…). */
function sink(): unknown {
  const fn = () => proxy;
  const proxy: unknown = new Proxy(fn, {
    get: (_t, key) => (key === Symbol.toPrimitive ? () => 0 : proxy),
    set: () => true,
    apply: () => proxy,
  });
  return proxy;
}

function context2d(): unknown {
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
        return sink();
      },
      set: () => true,
    },
  );
}

/** A no-op WebGL2 context: every call succeeds and returns a stub. */
export function fakeWebgl2(): unknown {
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== 'string') return undefined;
        if (/^[A-Z0-9_]+$/.test(key)) return 1; // enum constants
        if (key === 'getParameter') return () => 4096;
        if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
        if (key === 'isContextLost') return () => false;
        if (key === 'getExtension') return () => null;
        return () => ({});
      },
    },
  );
}
/** Size every element reports, in css px. */
export const size = { width: 800, height: 600 };

/** Frame callbacks requested and not yet run, by id. */
export const frames = new Map<number, (now: number) => void>();
let nextFrame = 1;

/**
 * Run the frame callbacks requested so far with timestamp `now` (ms), like one
 * browser frame. Callbacks they request wait for the next call. Returns how
 * many ran.
 */
export function runFrame(now: number): number {
  const due = [...frames.values()];
  frames.clear();
  for (const callback of due) callback(now);
  return due.length;
}

/** Frame callbacks waiting to run. */
export function pendingFrames(): number {
  return frames.size;
}

/** Context handed to WebGL canvases created after the latest `fakeContainer` call. */
let makeWebgl: () => unknown = fakeWebgl2;

type Listener = { fn: (e: FakeEvent) => void; capture: boolean };

/** Event listeners and dispatch shared by elements and the document. */
class FakeTarget {
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, fn: (e: FakeEvent) => void, options?: boolean | { capture?: boolean }): void {
    const capture = options === true || (typeof options === 'object' && Boolean(options.capture));
    const list = this.listeners.get(type) ?? [];
    if (!list.some((l) => l.fn === fn && l.capture === capture)) list.push({ fn, capture });
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: (e: FakeEvent) => void, options?: boolean | { capture?: boolean }): void {
    const capture = options === true || (typeof options === 'object' && Boolean(options.capture));
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((l) => l.fn !== fn || l.capture !== capture),
    );
  }
  /** Listeners attached for `type`, in either phase. */
  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
  /** Run this target's listeners for one phase. */
  invoke(e: FakeEvent, capture: boolean): void {
    for (const l of [...(this.listeners.get(e.type) ?? [])]) if (l.capture === capture) l.fn(e);
  }
}

export interface FakeEvent {
  type: string;
  target: unknown;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  [key: string]: unknown;
}

class FakeDocument extends FakeTarget {
  activeElement: FakeElement | null = null;
  createElement = (tag: string) => new FakeElement(tag);
  createElementNS = (_ns: string, tag: string) => new FakeElement(tag);
  /** No selector matches; tests stub it to stand in for open dialogs. */
  querySelectorAll = (_selector: string): unknown[] => [];
}

export const fakeDocument = new FakeDocument();
export const fakeWindow = Object.assign(new FakeTarget(), { devicePixelRatio: 1 });

/**
 * Dispatch a bubbling event at `target`: capture listeners from `document`
 * down, then bubble listeners back up. Returns the event, to check
 * `defaultPrevented` or the fields listeners read.
 */
export function dispatch(target: unknown, type: string, init: Record<string, unknown> = {}): FakeEvent {
  let stopped = false;
  const e: FakeEvent = {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: 0,
    clientY: 0,
    timeStamp: 0,
    ...init,
    type,
    target,
    defaultPrevented: false,
    preventDefault() {
      e.defaultPrevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
  };
  const path: FakeTarget[] = [];
  for (let n = target as FakeElement | null; n; n = n.parent) path.push(n);
  path.push(fakeDocument);
  for (let i = path.length - 1; i >= 0 && !stopped; i--) path[i]!.invoke(e, true);
  for (let i = 0; i < path.length && !stopped; i++) path[i]!.invoke(e, false);
  return e;
}

/** Inline style: a plain record, plus `setProperty` for custom properties. */
function fakeStyle(): Record<string, string> {
  const style: Record<string, string> = {};
  Object.defineProperty(style, 'setProperty', {
    value: (name: string, value: string) => {
      style[name] = value;
    },
  });
  return style;
}

class FakeElement extends FakeTarget {
  style: Record<string, string> = fakeStyle();
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  attributes = new Map<string, string>();
  className = '';
  textContent = '';
  innerHTML = '';
  tabIndex = 0;
  hidden = false;
  width = 0;
  height = 0;
  offsetWidth = 0;
  offsetHeight = 0;
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };

  constructor(readonly tagName: string) {
    super();
  }

  append(...nodes: unknown[]): void {
    for (const n of nodes) {
      if (n instanceof FakeElement) this.appendChild(n);
      else if (typeof n === 'string') this.textContent += n;
    }
  }
  appendChild(n: FakeElement): FakeElement {
    // Like a browser, appending moves a node that already has a parent.
    if (n.parent) n.parent.children = n.parent.children.filter((c) => c !== n);
    n.parent = this;
    this.children.push(n);
    return n;
  }
  insertBefore(n: FakeElement, ref: FakeElement | null): FakeElement {
    if (n.parent) n.parent.children = n.parent.children.filter((c) => c !== n);
    n.parent = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(n);
    else this.children.splice(at, 0, n);
    return n;
  }
  replaceChildren(...nodes: unknown[]): void {
    this.children = [];
    // Text nodes go too, as in a browser.
    this.textContent = '';
    this.append(...nodes);
  }
  remove(): void {
    // Like a browser, removing the focused element (or its ancestor) drops focus.
    if (this.contains(fakeDocument.activeElement)) fakeDocument.activeElement = null;
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  contains(n: unknown): boolean {
    for (let p = n as FakeElement | null; p; p = p.parent) if (p === this) return true;
    return false;
  }
  setAttribute(k: string, v: string): void {
    this.attributes.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attributes.get(k) ?? null;
  }
  removeAttribute(k: string): void {
    this.attributes.delete(k);
  }
  focus(): void {
    fakeDocument.activeElement = this;
  }
  get parentElement(): FakeElement | null {
    return this.parent;
  }
  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  /** First descendant matching a single `.class` selector, depth first. */
  querySelector(selector: string): FakeElement | null {
    const cls = selector.startsWith('.') ? selector.slice(1) : null;
    for (const child of this.children) {
      if (cls !== null && child.className.split(/\s+/).includes(cls)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  /** Test helper: run this element's own `type` listeners (no capture or bubble). */
  dispatch(type: string, event: Record<string, unknown> = {}): void {
    const e: FakeEvent = {
      type,
      target: this,
      defaultPrevented: false,
      stopPropagation() {},
      preventDefault() {
        e.defaultPrevented = true;
      },
      ...event,
    };
    this.invoke(e, true);
    this.invoke(e, false);
  }
  get ownerDocument(): FakeDocument {
    return fakeDocument;
  }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  hasPointerCapture(): boolean {
    return false;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: size.width, height: size.height, right: size.width, bottom: size.height };
  }
  getContext(type: string): unknown {
    return type === 'webgl2' ? makeWebgl() : context2d();
  }
}

interface FakeMediaQuery {
  query: string;
  matches: boolean;
  listeners: Set<() => void>;
}

const mediaQueries: FakeMediaQuery[] = [];

/** Listeners currently attached to media queries whose text contains `text`. */
export function mediaListeners(text: string): number {
  return mediaQueries.filter((mq) => mq.query.includes(text)).reduce((n, mq) => n + mq.listeners.size, 0);
}

/** Listeners currently attached to `window` for `type`. */
export function windowListeners(type: string): number {
  return fakeWindow.listenerCount(type);
}

/** Fire a `resize` event on `window`, like a browser does on zoom or window resize. */
export function fireWindowResize(): void {
  const e: FakeEvent = {
    type: 'resize',
    target: fakeWindow,
    defaultPrevented: false,
    preventDefault() {},
    stopPropagation() {},
  };
  fakeWindow.invoke(e, false);
}

/** Set `window.devicePixelRatio` and fire the change of every media query mentioning `text`, like a browser would. */
export function changeDevicePixelRatio(dpr: number, text = 'resolution'): void {
  fakeWindow.devicePixelRatio = dpr;
  for (const mq of mediaQueries.filter((m) => m.query.includes(text))) for (const fn of [...mq.listeners]) fn();
}

/** Install the fakes on `globalThis` (idempotent). */
export function installFakeDom(): void {
  const g = globalThis as Record<string, unknown>;
  if (g.__fakeDom) return;
  g.__fakeDom = true;
  g.document = fakeDocument;
  g.window = fakeWindow;
  g.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  g.requestAnimationFrame = (callback: (now: number) => void) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  g.cancelAnimationFrame = (id: number) => frames.delete(id);
  // Reduced motion: view and layout changes apply immediately.
  g.matchMedia = (query: string) => {
    const mq: FakeMediaQuery = { query, matches: true, listeners: new Set() };
    Object.assign(mq, {
      addEventListener: (_type: string, fn: () => void) => mq.listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) => mq.listeners.delete(fn),
    });
    // Only the ratio queries are inspected; keep others from piling up across tests.
    if (query.includes('resolution')) mediaQueries.push(mq);
    return mq;
  };
}

/** A chart container; `webgl` is the context the chart's GL canvas gets (default: no-op fake). */
export function fakeContainer(options: { webgl?: unknown } = {}): HTMLElement {
  installFakeDom();
  makeWebgl = options.webgl === undefined ? fakeWebgl2 : () => options.webgl;
  return new FakeElement('div') as unknown as HTMLElement;
}
