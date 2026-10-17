import { svgFromMarkup } from './svg-markup';

/**
 * An icon as data: the child elements of a 24-unit `<svg>`, each a tag name and its attributes,
 * stroked with `currentColor`. The built-in icons use this shape, as does the open-source icon set
 * the shell's other icons come from, so that set's icon objects work here as they are.
 */
export type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][];

const SVG = 'http://www.w3.org/2000/svg';

/** An SVG element `tag` with `attrs`, skipping undefined ones. */
function svgElement(tag: string, attrs: Record<string, string | number | undefined>): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined) el.setAttribute(key, String(value));
  return el;
}

/** The `<svg>` for `node`, `size` px square. */
function iconElement(node: IconNode, size: number): SVGElement {
  const svg = svgElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.75,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  svg.append(...node.map(([tag, attrs]) => svgElement(tag, attrs)));
  return svg;
}

/**
 * An icon for a toolbar, rail, menu or button:
 * - SVG markup (`'<svg viewBox="0 0 24 24">…</svg>'`), built with DOM calls; scripts, links and
 *   inline styles are dropped,
 * - an `SVGElement`, copied for each control that shows it,
 * - an `IconNode`, like the built-in icons,
 * - or a function returning a fresh element on each call (an image, a canvas…), used as is.
 *
 * Markup and elements are sized to the control and hidden from assistive technology, since the
 * control carries the label.
 */
export type IconSource = string | SVGElement | IconNode | (() => Element);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  // Buttons never submit a form unless `attrs` says so.
  if (tag === 'button') el.setAttribute('type', 'button');
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') el.className = value;
    else el.setAttribute(key, value);
  }
  el.append(...children);
  return el;
}

/** Show `el` as on or off: the `is-active` class plus `aria-pressed`, or `aria-checked` when `checked`. */
export function markActive(el: Element, on: boolean, checked = false): void {
  el.classList.toggle('is-active', on);
  el.setAttribute(checked ? 'aria-checked' : 'aria-pressed', String(on));
}

/** The element to show for an icon `source` (see `IconSource`), `size` px square; a function's element is used as it comes. */
export function icon(source: IconSource, size = 16): Element {
  if (typeof source === 'function') return source();
  if (Array.isArray(source)) return iconElement(source, size);
  const svg = typeof source === 'string' ? svgFromMarkup(source) : (source.cloneNode(true) as SVGElement);
  fitIcon(svg, size);
  return svg;
}

/** Size an app's SVG to the control; a fixed width and height without a viewBox becomes one, so it scales. */
function fitIcon(svg: SVGElement, size: number): void {
  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  if (svg.getAttribute('viewBox') === null && width > 0 && height > 0) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
}

/** Internal: the buttons under `el`, in document order (not those inside a button). */
export const buttonsIn = (el: Element): HTMLElement[] =>
  (Array.from(el.children) as HTMLElement[]).flatMap((child) => (child.tagName.toLowerCase() === 'button' ? [child] : buttonsIn(child)));

/** Internal: set a button's accessible name and its tooltip to `label`. */
export function nameButton(target: Element, label: string): void {
  target.setAttribute('aria-label', label);
  target.setAttribute('data-tip', label);
}

/** Internal: position `el` absolutely at its container's top left, to measure it before placing it. */
export const placeAtOrigin = (el: HTMLElement) => Object.assign(el.style, { position: 'absolute', left: '0px', top: '0px' });

/** Whether `el` lays out right to left. */
export function isRtl(el: Element): boolean {
  return typeof getComputedStyle === 'function' && getComputedStyle(el).direction === 'rtl';
}

/** `e.key`, with the left and right arrows swapped in right-to-left chrome so they move the way they point. */
export function inlineKey(e: KeyboardEvent): string {
  const swap = e.key === 'ArrowLeft' ? 'ArrowRight' : e.key === 'ArrowRight' ? 'ArrowLeft' : '';
  return swap && isRtl(e.target as Element) ? swap : e.key;
}

/**
 * Internal: make a grid of `columns` buttons one Tab stop. The arrow keys
 * move by one button and by one row, Home and End jump to the ends, and the
 * button moved to becomes the tabbable one.
 */
export function gridKeys(grid: HTMLElement, buttons: () => readonly HTMLElement[], columns: number): void {
  grid.addEventListener('keydown', (e) => {
    const list = buttons();
    const at = list.indexOf(e.target as HTMLElement);
    if (at < 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const last = list.length - 1;
    const moves: Record<string, number> = {
      ArrowLeft: at - 1,
      ArrowRight: at + 1,
      ArrowUp: at - columns,
      ArrowDown: at + columns,
      Home: 0,
      End: last,
    };
    const to = moves[inlineKey(e)];
    if (to === undefined) return;
    e.preventDefault();
    const target = list[Math.min(last, Math.max(0, to))]!;
    for (const b of list) b.tabIndex = b === target ? 0 : -1;
    target.focus();
  });
}

/**
 * Keys the chart turns into pan or zoom. Overlays keep these to themselves;
 * everything else (Escape, Delete, Ctrl/Cmd shortcuts such as undo) bubbles
 * on to the chart and to document-level popover dismissal.
 */
export function isChartNavKey(key: string): boolean {
  return key.startsWith('Arrow') || key === '+' || key === '-' || key === '=';
}

/**
 * Keep chart input off an element mounted in `chart.root`: presses there do
 * not start a pan, a drawing or a pointer capture (which would retarget the
 * release and the click away from the element), wheel does not zoom, double
 * clicks do not reset the view, and chart navigation keys stay inside. Every
 * overlay placed over the plot should call this once.
 */
export function isolateFromChart(el: HTMLElement): void {
  for (const type of ['pointerdown', 'wheel', 'dblclick'] as const) {
    el.addEventListener(type, (e) => e.stopPropagation());
  }
  el.addEventListener('keydown', (e) => {
    if (isChartNavKey(e.key)) e.stopPropagation();
  });
}

/**
 * Internal: keep presses, wheel and keys inside the panel `el` away from chart panning and
 * shortcuts; Escape runs `onEscape`. Wheel is stopped, not prevented, so the panel still
 * scrolls natively instead of zooming the chart.
 */
export function holdPanelInput(el: HTMLElement, onEscape: (e: KeyboardEvent) => void): void {
  for (const type of ['pointerdown', 'wheel', 'dblclick', 'contextmenu']) el.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') onEscape(e);
  });
}

/** Close on outside pointer press or Escape; returns a disposer. */
export function onDismiss(owner: HTMLElement, close: () => void): () => void {
  const onPointer = (e: PointerEvent) => {
    if (!owner.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  // The owner's own document, which differs from the global one in a popup window.
  const doc = owner.ownerDocument;
  // Defer so the opening click does not immediately close the popover. Escape works at once:
  // the key that opened it is never Escape.
  const timer = setTimeout(() => doc.addEventListener('pointerdown', onPointer, true));
  doc.addEventListener('keydown', onKey);
  return () => {
    clearTimeout(timer);
    doc.removeEventListener('pointerdown', onPointer, true);
    doc.removeEventListener('keydown', onKey);
  };
}

/**
 * Internal: `trigger` opens the popover that `build` adds to `wrap` and returns, and closes it
 * again. Escape and a press outside `wrap` close it too, and `aria-expanded` follows. `onClose`
 * runs after each close. With `refocus`, closing gives focus back to the trigger when the
 * popover had it.
 */
export function popoverToggle(
  wrap: HTMLElement,
  trigger: HTMLElement,
  build: () => HTMLElement,
  onClose?: () => void,
  refocus?: boolean,
): { open(): void; close(): void } {
  let panel: HTMLElement | null = null;
  let dispose = () => {};
  const expand = (open: boolean) => trigger.setAttribute('aria-expanded', String(open));
  const close = () => {
    if (!panel) return;
    const hadFocus = panel.contains(document.activeElement);
    fadeOutAndRemove(panel);
    panel = null;
    dispose();
    expand(false);
    if (refocus && hadFocus) trigger.focus();
    onClose?.();
  };
  const open = () => {
    if (panel) return;
    panel = build();
    expand(true);
    dispose = onDismiss(wrap, close);
  };
  expand(false);
  trigger.addEventListener('click', () => (panel ? close() : open()));
  return { open, close };
}

/** Where a dropdown list goes, as computed by `popoverPlacement`: which trigger edge it aligns to and its height cap. */
export interface PopoverPlacement {
  /** Anchor the list to the trigger's right edge instead of its left edge. */
  alignEnd: boolean;
  /** Height cap in px when the list does not fit the space available, else null. */
  maxHeight: number | null;
}

/**
 * Where a dropdown list fits: flips it to the trigger's right edge when the
 * left-aligned list would cross the viewport's right edge and the flipped one
 * overflows less, and caps its height to the room below (or above, `up`) the
 * trigger. `gap` is the space between trigger and list.
 */
export function popoverPlacement(
  trigger: { left: number; right: number; top: number; bottom: number },
  list: { width: number; height: number },
  viewport: { width: number; height: number },
  options: { up?: boolean; alignEnd?: boolean } = {},
  margin = 8,
  gap = 4,
): PopoverPlacement {
  const startOverflow = Math.max(0, trigger.left + list.width - (viewport.width - margin));
  const endOverflow = Math.max(0, margin - (trigger.right - list.width));
  const alignEnd = options.alignEnd ?? startOverflow > endOverflow;
  const room = options.up ? trigger.top - gap - margin : viewport.height - margin - trigger.bottom - gap;
  // Never shrink below a few rows, even on a very short window.
  const maxHeight = list.height > room ? Math.max(120, Math.floor(room)) : null;
  return { alignEnd, maxHeight };
}

/** Whether `el` sits in a bar at the bottom edge (`data-pc-edge="bottom"`), whose popups and tooltips open upwards. */
export function atBottomEdge(el: Element): boolean {
  return el.closest?.('[data-pc-edge="bottom"]') != null;
}

/**
 * Apply `popoverPlacement` to an open list anchored under (or above) `trigger`.
 * Without `up`, the list opens upwards in a bar at the bottom edge (`atBottomEdge`).
 * In right-to-left chrome left and right swap: the list starts at the trigger's right edge.
 */
export function placePopover(list: HTMLElement, trigger: HTMLElement, options: { up?: boolean; alignEnd?: boolean } = {}): void {
  // Nothing is laid out without a root element (a test DOM), so there is nothing to place.
  const root = document.documentElement;
  if (!root) return;
  const { clientWidth: width, clientHeight: height } = root;
  const box = trigger.getBoundingClientRect();
  const up = options.up ?? atBottomEdge(trigger);
  // Right to left, a list starts at the trigger's right edge: place it in mirrored coordinates.
  const { alignEnd, maxHeight } = popoverPlacement(
    isRtl(list) ? { left: width - box.right, right: width - box.left, top: box.top, bottom: box.bottom } : box,
    { width: list.offsetWidth, height: list.scrollHeight },
    { width, height },
    { ...options, up },
  );
  list.classList.toggle('pc-popover--up', up);
  list.classList.toggle('pc-popover--end', alignEnd);
  // Scroll only when capped, so flyouts inside uncapped lists are not clipped.
  list.style.maxHeight = maxHeight === null ? '' : `${maxHeight}px`;
  list.style.overflowY = maxHeight === null ? '' : 'auto';
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Internal: removes a closing overlay after a short fade, inert meanwhile, so it does not vanish
 * between frames. At once when the user prefers reduced motion, the platform cannot animate, or
 * nothing is on screen to fade (no layout box).
 */
export function fadeOutAndRemove(el: HTMLElement): void {
  if (typeof el.animate !== 'function' || prefersReducedMotion() || !el.getBoundingClientRect().width) return el.remove();
  el.inert = true;
  const remove = () => el.remove();
  el.animate({ opacity: 0 }, { duration: 140, easing: 'ease-in', fill: 'forwards' }).finished.then(remove, remove);
}

/** Shows, hides or toggles a part of the UI, such as the tool rail, the toolbar or the favorites bar. */
export interface Visibility {
  readonly visible: boolean;
  setVisible(visible: boolean): void;
  toggle(): void;
}

/**
 * Internal: `Visibility` plus change notification. Not exported from the
 * package; the shell re-emits changes as `rail:change` / `toolbar:change`.
 */
export interface VisibilityControl extends Visibility {
  /** Called after each change; returns an unsubscribe function. */
  onChange(listener: (visible: boolean) => void): () => void;
}

/** Show/hide `el` with the `hidden` attribute, so its state and listeners survive. */
export function visibilityOf(el: HTMLElement): VisibilityControl {
  const listeners = new Set<(visible: boolean) => void>();
  const setVisible = (visible: boolean) => {
    if (visible === !el.hidden) return;
    el.hidden = !visible;
    listeners.forEach((l) => l(visible));
  };
  return {
    get visible() {
      return !el.hidden;
    },
    setVisible,
    toggle: () => setVisible(el.hidden),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
