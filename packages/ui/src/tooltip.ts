import { atBottomEdge, h, isRtl } from './dom';

/** Side of the trigger a tooltip opens on (`data-tip-side`). */
export type TipSide = 'top' | 'right' | 'bottom' | 'left';

/** A box in css px: the trigger, or the area the tooltip must stay inside. */
export interface TipBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Space between the trigger and a tooltip above or below it (css px, `--pc-space-3`). */
const GAP_VERTICAL = 6;
/** Space between the trigger and a tooltip beside it (css px, `--pc-space-4`). */
const GAP_SIDE = 8;
/** Space kept between the tooltip and the area's edges (css px). */
const INSET = 4;

const OPPOSITE: Record<TipSide, TipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/**
 * Where to put a tooltip of `size` next to `trigger` inside `area`. It opens
 * on `side` when there is room, on the opposite side when only that one has
 * room, and on the roomier of the two otherwise. Across that axis it is
 * centred on the trigger, then shifted to stay inside the area, so a trigger
 * at an edge gets a tooltip that lines up with that edge instead of hanging
 * past it.
 */
export function placeTip(
  trigger: TipBox,
  size: { width: number; height: number },
  area: TipBox,
  side: TipSide,
): { x: number; y: number; side: TipSide } {
  const vertical = side === 'top' || side === 'bottom';
  const gap = vertical ? GAP_VERTICAL : GAP_SIDE;
  // Position and size keys along the main axis and across it.
  const [pos, len, crossPos, crossLen] = vertical
    ? (['top', 'height', 'left', 'width'] as const)
    : (['left', 'width', 'top', 'height'] as const);
  // Main axis: the trigger's start and end, the tooltip's length and the area's bounds along it.
  const start = trigger[pos];
  const end = start + trigger[len];
  const length = size[len];
  const min = area[pos] + INSET;
  const max = area[pos] + area[len] - INSET;

  const at = (s: TipSide) => (s === 'top' || s === 'left' ? start - gap - length : end + gap);
  const fits = (s: TipSide) => at(s) >= min && at(s) + length <= max;
  const room = (s: TipSide) => (s === 'top' || s === 'left' ? start - gap - min : max - end - gap);
  const flip = OPPOSITE[side];
  const chosen = fits(side) || (!fits(flip) && room(side) >= room(flip)) ? side : flip;
  const main = clamp(at(chosen), min, max - length);

  // Cross axis: centred on the trigger, kept inside the area.
  const centre = trigger[crossPos] + trigger[crossLen] / 2;
  const breadth = size[crossLen];
  const crossMin = area[crossPos] + INSET;
  const crossMax = area[crossPos] + area[crossLen] - INSET;
  const cross = clamp(centre - breadth / 2, crossMin, crossMax - breadth);

  return vertical
    ? { x: Math.round(cross), y: Math.round(main), side: chosen }
    : { x: Math.round(main), y: Math.round(cross), side: chosen };
}

// The start wins when the tooltip is longer than the room, so its beginning stays readable.
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function sideOf(trigger: Element): TipSide {
  const side = trigger.getAttribute('data-tip-side');
  // A horizontal rail is a row of buttons: a tooltip beside one would cover the next.
  if (side === 'right' && trigger.closest('.pc-rail[data-orientation="horizontal"]')) return 'top';
  // Beside sides follow the mirrored layout of right-to-left chrome.
  if (side === 'right' || side === 'left') return isRtl(trigger) ? OPPOSITE[side] : side;
  // Below a trigger in a bar at the bottom edge there is no room: open above it.
  return side === 'top' || (side === null && atBottomEdge(trigger)) ? 'top' : 'bottom';
}

function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

/*
 * One tooltip at a time, for every `[data-tip]` element inside a `.pc-shell`
 * root. Each root gets its own tooltip element, created on first use and
 * appended to the root, so it is never inside a scroll container and is
 * placed with `placeTip` inside the root and the viewport.
 */

/** The tooltip element of each `.pc-shell` root that has shown one. */
const tips = new Map<Element, HTMLElement>();
/** Holders of `retainTips`; the document listeners stay while there is one. */
let users = 0;
let nextId = 0;
let hovered: Element | null = null;
let focused: Element | null = null;
/** The trigger whose tooltip shows, its tooltip, and whether it carries our `aria-describedby`. */
let shown: Element | null = null;
let shownTip: HTMLElement | null = null;
let described = false;
let watch: MutationObserver | null = null;

const triggerOf = (target: EventTarget | null): Element | null => {
  if (!target || typeof (target as Element).closest !== 'function') return null;
  const trigger = (target as Element).closest('[data-tip]');
  return trigger && trigger.closest('.pc-shell') ? trigger : null;
};

function tipOf(root: Element): HTMLElement {
  // Roots that left the document take their tooltip with them.
  for (const [r, tip] of tips)
    if (r.isConnected === false) {
      tip.remove();
      tips.delete(r);
    }
  let tip = tips.get(root);
  if (!tip) {
    tip = h('div', { class: 'pc-tip', role: 'tooltip', id: `pc-tip-${++nextId}` });
    tip.hidden = true;
    tips.set(root, tip);
  }
  if (tip.parentNode !== root) root.append(tip);
  return tip;
}

function setDescribed(trigger: Element, id: string, on: boolean): void {
  const ids = (trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((t) => t && t !== id);
  if (on) ids.push(id);
  if (ids.length) trigger.setAttribute('aria-describedby', ids.join(' '));
  else trigger.removeAttribute('aria-describedby');
}

function hide(): void {
  if (shown && shownTip) {
    if (described) setDescribed(shown, shownTip.getAttribute('id')!, false);
    shownTip.hidden = true;
  }
  if (shown) {
    document.removeEventListener('scroll', onMove, true);
    window.removeEventListener('resize', onMove);
  }
  watch?.disconnect();
  shown = null;
  shownTip = null;
  described = false;
}

function update(): void {
  // A trigger removed from the page (a rebuilt menu or toolbar) loses its tooltip.
  if (hovered?.isConnected === false) hovered = null;
  if (focused?.isConnected === false) focused = null;
  const trigger = hovered ?? focused;
  const text = trigger?.getAttribute('data-tip');
  const root = trigger?.closest('.pc-shell');
  if (!trigger || !text || !root || trigger.getAttribute('aria-expanded') === 'true') return hide();
  if (trigger !== shown) {
    hide();
    const tip = tipOf(root);
    // Hidden for a style pass first, so the delayed fade-in starts over for each trigger.
    tip.hidden = true;
    void tip.offsetWidth;
    shown = trigger;
    shownTip = tip;
    document.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    if (typeof MutationObserver === 'function') {
      watch ??= new MutationObserver(onMutate);
      watch.observe(trigger, { attributes: true, attributeFilter: ['data-tip', 'data-tip-side', 'aria-expanded', 'aria-label'] });
      watch.observe(root, { childList: true, subtree: true });
    }
  }
  const tip = shownTip!;
  if (tip.textContent !== text) tip.textContent = text;
  // Announce the tooltip only when it says more than the trigger's own name.
  const name = (trigger.getAttribute('aria-label') ?? trigger.textContent ?? '').trim();
  const describe = text.trim() !== name;
  if (describe !== described) setDescribed(trigger, tip.getAttribute('id')!, describe);
  described = describe;
  tip.hidden = false;
  place(trigger, root, tip);
}

function place(trigger: Element, root: Element, tip: HTMLElement): void {
  const box = root.getBoundingClientRect();
  const t = trigger.getBoundingClientRect();
  // The tooltip is positioned from the root's padding box, which moves with the root's scroll position:
  // `.pc-shell` clips (overflow: hidden) but can still be scrolled, e.g. when focus moves to a clipped control.
  // The area is the part of the root inside the viewport.
  const ox = box.left + (root.clientLeft || 0) - (root.scrollLeft || 0);
  const oy = box.top + (root.clientTop || 0) - (root.scrollTop || 0);
  const left = Math.max(box.left, 0);
  const top = Math.max(box.top, 0);
  const right = Math.min(box.right, window.innerWidth || box.right);
  const bottom = Math.min(box.bottom, window.innerHeight || box.bottom);
  const at = placeTip(
    { left: t.left - ox, top: t.top - oy, width: t.width, height: t.height },
    { width: tip.offsetWidth, height: tip.offsetHeight },
    { left: left - ox, top: top - oy, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
    sideOf(trigger),
  );
  tip.dataset.side = at.side;
  tip.style.transform = `translate(${at.x}px, ${at.y}px)`;
}

function onMutate(records: MutationRecord[]): void {
  // Our own text changes and unrelated DOM churn in the shell only matter once the trigger is gone.
  if (shown && (records.some((r) => r.type === 'attributes') || shown.isConnected === false)) update();
}

// Scrolled content and a resized window move the trigger.
function onMove(): void {
  if (shown) update();
}

function onOver(e: Event): void {
  // A tap is not a hover: on touch the tooltip would stay up after the tap.
  if ((e as PointerEvent).pointerType === 'touch') return;
  const trigger = triggerOf(e.target);
  if (trigger === hovered) return;
  hovered = trigger;
  update();
}

function onOut(e: Event): void {
  const next = triggerOf((e as PointerEvent).relatedTarget);
  if (!hovered || next === hovered) return;
  hovered = next;
  update();
}

function onFocusIn(e: Event): void {
  const trigger = triggerOf(e.target);
  const next = trigger && focusVisible(trigger) ? trigger : null;
  if (next === focused && next === shown) return;
  focused = next;
  update();
}

function onFocusOut(): void {
  if (!focused) return;
  focused = null;
  update();
}

const EVENTS: [string, (e: Event) => void][] = [
  ['pointerover', onOver],
  ['pointerout', onOut],
  ['focusin', onFocusIn],
  ['focusout', onFocusOut],
];

/**
 * Turn on the tooltips of `[data-tip]` elements inside any `.pc-shell`
 * element: on mouse hover and keyboard focus, with the text and side of the
 * trigger's `data-tip` and `data-tip-side`, and not while its
 * `aria-expanded` is true. When the text says more than the trigger's
 * accessible name, the trigger is described by it while it shows.
 *
 * The shell and the standalone components each retain it; the returned
 * function releases that hold, and the last release removes the document
 * listeners and the tooltip elements.
 */
export function retainTips(): () => void {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {};
  if (users++ === 0) for (const [type, fn] of EVENTS) document.addEventListener(type, fn);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (--users > 0) return;
    for (const [type, fn] of EVENTS) document.removeEventListener(type, fn);
    hovered = null;
    focused = null;
    hide();
    watch = null;
    tips.forEach((tip) => tip.remove());
    tips.clear();
  };
}

/**
 * Give one trigger its tooltip without a retained document listener, for
 * controls built on their own (`iconButton`, `button`, `menuButton`). Its
 * listeners go with the element.
 */
export function bindTip(trigger: HTMLElement): void {
  if (typeof trigger.addEventListener !== 'function') return;
  for (const [type, fn] of EVENTS) trigger.addEventListener(type, fn);
}
