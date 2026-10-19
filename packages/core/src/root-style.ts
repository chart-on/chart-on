/**
 * The chart root's look as a stylesheet rule instead of inline styles, so a
 * host page can override it from CSS without `!important`. The selector is
 * `:where(.pc-chart)`, with no specificity: any host rule that targets the
 * root wins, while a universal reset (`* { ... }`) loses because the rule's
 * sheet comes last.
 *
 * The sheet is a constructed stylesheet adopted by the document (or the shadow
 * root the chart lives in), which a strict `style-src` allows. Where the browser
 * cannot do that, the root is styled inline as before.
 *
 * The same sheet styles the logo badge (`.pc-attribution`): faint at rest,
 * and on hover or focus full, on the chart background, with the
 * project name shown beside the mark. Without the sheet the badge is an
 * unstyled link showing the mark and the name.
 */

import { BADGE_ALPHA, BADGE_GAP, BADGE_HEIGHT } from './attribution';
import { parseColor } from './util/color';

/** Runtime values (background, touch-action) reach the rule through these inline variables. */
const VARS = { background: '--pc-root-background', touchAction: '--pc-root-touch-action' } as const;

/** The badge while hovered or focused from the keyboard. */
const BADGE_OPEN = ':where(.pc-attribution:hover,.pc-attribution:focus-visible)';

export const ROOT_RULE =
  ':where(.pc-chart) { width: 100%; height: 100%; outline: none; -webkit-user-select: none; user-select: none; ' +
  `touch-action: var(${VARS.touchAction}, none); background: var(${VARS.background}, transparent); }` +
  `:where(.pc-attribution){z-index:3;align-items:center;gap:${BADGE_GAP}px;height:${BADGE_HEIGHT}px;padding:0 4px;border-radius:6px;text-decoration:none;opacity:${BADGE_ALPHA}}` +
  `${BADGE_OPEN}{opacity:1;background:var(${VARS.background})}:where(.pc-attribution) span{display:none}${BADGE_OPEN} span{display:inline}`;

/** Inline fallback where the rule cannot be adopted. */
const INLINE = { width: '100%', height: '100%', outline: 'none', userSelect: 'none', touchAction: 'none' };

type StyleScope = (Document | ShadowRoot) & { adoptedStyleSheets: CSSStyleSheet[] };

let shared: CSSStyleSheet | null | undefined;
/** Roots styled by the sheet; the rest are styled inline. */
const bySheet = new WeakSet<HTMLElement>();

function sheet(): CSSStyleSheet | null {
  if (shared !== undefined) return shared;
  shared = null;
  if (typeof CSSStyleSheet !== 'function') return null;
  try {
    const s = new CSSStyleSheet();
    s.replaceSync(ROOT_RULE);
    shared = s;
  } catch {
    // Constructable stylesheets unsupported: inline styles below.
  }
  return shared;
}

function scopeOf(container: HTMLElement): StyleScope | null {
  const node = typeof container.getRootNode === 'function' ? container.getRootNode() : null;
  // A detached container has no document or shadow root yet: use the page's.
  const scope = node && 'adoptedStyleSheets' in node ? node : typeof document === 'undefined' ? null : document;
  return scope && 'adoptedStyleSheets' in scope ? (scope as StyleScope) : null;
}

/** Give `root` its base look: the shared rule where `container` lives, else inline styles. */
export function styleChartRoot(root: HTMLElement, container: HTMLElement): void {
  const s = sheet();
  const scope = s ? scopeOf(container) : null;
  if (!s || !scope) {
    Object.assign(root.style, INLINE);
    return;
  }
  try {
    if (!scope.adoptedStyleSheets.includes(s)) scope.adoptedStyleSheets = [...scope.adoptedStyleSheets, s];
  } catch {
    // A constructed sheet cannot be shared with another document (an iframe or a popup window).
    Object.assign(root.style, INLINE);
    return;
  }
  bySheet.add(root);
}

/** Set a runtime value the rule reads, so host CSS on the property itself still wins. */
export function setRootStyle(root: HTMLElement, name: keyof typeof VARS, value: string): void {
  if (bySheet.has(root)) root.style.setProperty(VARS[name], value);
  else root.style[name] = value;
}

/** A chart root with class `className` and its base look where `container` lives. */
export function createRoot(container: HTMLElement, className: string): HTMLDivElement {
  const root = document.createElement('div');
  root.className = className;
  // Layout-critical only; the rest comes from the overridable rule.
  Object.assign(root.style, { position: 'relative', overflow: 'hidden' });
  styleChartRoot(root, container);
  return root;
}

/** A canvas covering `root`, above the ones added before it. */
export function addLayer(root: HTMLElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.assign(c.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%' });
  root.appendChild(c);
  return c;
}

/**
 * The root shows `color` before the first frame. A translucent background is
 * left to the canvas alone, so it is not painted twice and the page shows
 * through as much as the color says.
 */
export function setRootBackground(root: HTMLElement, color: string): void {
  setRootStyle(root, 'background', parseColor(color)[3] === 255 ? color : 'transparent');
}

/** Call `onChange` with whether `el` is in the viewport each time that changes; null where the browser cannot tell. */
export function watchInView(el: Element, onChange: (inView: boolean) => void): IntersectionObserver | null {
  if (typeof IntersectionObserver !== 'function') return null;
  const observer = new IntersectionObserver((entries) => {
    const last = entries[entries.length - 1];
    if (last) onChange(last.isIntersecting);
  });
  observer.observe(el);
  return observer;
}

/**
 * Moving to a screen with another scale or changing the browser zoom changes
 * the device pixel ratio without resizing the container, so a ResizeObserver
 * misses it. `watch(dpr)` listens to a media query for the current ratio, which
 * fires when it changes (call `watch` with each new ratio to re-arm it). A
 * fractional ratio may never match its query exactly, so a window `resize`
 * listener (zoom fires one) listens too, and covers browsers without
 * `matchMedia`. Either calls `resize` when the ratio differs from `current()`.
 */
export function pixelRatioWatch(current: () => number, resize: () => void): { watch(dpr: number): void; stop(): void } {
  let watched = NaN;
  let unwatch: (() => void) | null = null;
  const onChange = () => {
    if ((window.devicePixelRatio || 1) !== current()) resize();
  };
  const stop = () => {
    unwatch?.();
    unwatch = null;
  };
  return {
    watch(dpr) {
      if (dpr === watched || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
      stop();
      watched = dpr;
      window.addEventListener('resize', onChange);
      const query = typeof matchMedia === 'function' ? matchMedia(`(resolution: ${dpr}dppx)`) : null;
      query?.addEventListener('change', onChange);
      unwatch = () => {
        window.removeEventListener('resize', onChange);
        query?.removeEventListener('change', onChange);
      };
    },
    stop,
  };
}

/**
 * Read the size of `chart.root` in whole css px and the device pixel ratio
 * into `chart`, and re-arm `watch` for the ratio. Returns null when nothing
 * changed and not `force` (reassigning a canvas size clears it, so callers
 * skip no-op resizes), else whether the css size changed.
 */
export function measureRoot(
  chart: { readonly root: HTMLElement; width: number; height: number; dpr: number },
  watch: { watch(dpr: number): void },
  force = false,
): boolean | null {
  const rect = chart.root.getBoundingClientRect();
  const width = Math.max(0, Math.floor(rect.width));
  const height = Math.max(0, Math.floor(rect.height));
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  watch.watch(dpr);
  if (!force && width === chart.width && height === chart.height && dpr === chart.dpr) return null;
  const sized = width !== chart.width || height !== chart.height;
  chart.width = width;
  chart.height = height;
  chart.dpr = dpr;
  return sized;
}

/** Give `canvas` a backing store of `width` × `height` css px at `ratio` device px each. This clears it. */
export function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number, ratio: number): void {
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
}
