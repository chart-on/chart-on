import type { Chart } from '@charton/core';
import { inlineKey } from './dom';
import { stepTab } from './indicator-picker-model';
import { shellText } from './messages';
import { modalOpen } from './shortcuts';

/** The action ids that move focus between the shell's areas. */
export const NEXT_REGION = 'focus-next-region';
export const PREVIOUS_REGION = 'focus-previous-region';

const hasClass = (el: Element, cls: string) => typeof el.className === 'string' && el.className.split(/\s+/).includes(cls);

/** Laid out, as far as the browser can tell; elements hidden by a stylesheet have no boxes. */
const laidOut = (el: HTMLElement) => typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;

/** Buttons a group moves between with the arrow keys: shown, enabled and outside open menus. */
export function groupButtons(group: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (node: Element) => {
    for (const child of Array.from(node.children) as HTMLElement[]) {
      if (child.hidden || hasClass(child, 'pc-popover')) continue;
      if (child.tagName.toLowerCase() !== 'button') walk(child);
      else if (!(child as HTMLButtonElement).disabled && laidOut(child)) out.push(child);
    }
  };
  walk(group);
  return out;
}


const modified = (e: KeyboardEvent) => e.altKey || e.ctrlKey || e.metaKey || e.shiftKey;

export interface RovingGroup {
  /** Focus the group's current button; false when it has none. */
  focus(): boolean;
  destroy(): void;
}

/**
 * Make `group` (a toolbar, the rail, the bottom bar) one Tab stop: only its
 * current button is tabbable, and the arrow keys, Home and End move focus
 * between its buttons, in either direction, wrapping at the ends. Other
 * focusable controls (fields, sliders) keep their own Tab stops.
 */
export function rovingFocus(group: HTMLElement): RovingGroup {
  let current: HTMLElement | null = null;
  const sync = () => {
    const buttons = groupButtons(group);
    if (!current || !buttons.includes(current)) current = buttons[0] ?? null;
    for (const b of buttons) b.tabIndex = b === current ? 0 : -1;
    return buttons;
  };
  const onFocus = (e: FocusEvent) => {
    if (groupButtons(group).includes(e.target as HTMLElement)) current = e.target as HTMLElement;
    sync();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || modified(e)) return;
    const buttons = sync();
    const at = buttons.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    const to = stepTab(at, buttons.length, inlineKey(e));
    if (to === null) return;
    e.preventDefault();
    current = buttons[to]!;
    sync();
    current.focus();
  };
  group.addEventListener('focusin', onFocus);
  group.addEventListener('keydown', onKey);
  // Controls inside (segmented radios) leave Tab and the arrows to the group.
  group.setAttribute('data-roving', '');
  // Buttons come and go (overflow, rebuilt rails, hidden items); keep exactly one tabbable.
  const observer = new MutationObserver(sync);
  observer.observe(group, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
  sync();
  return {
    focus() {
      const target = sync().length > 0 ? current : null;
      target?.focus();
      return !!target;
    },
    destroy() {
      observer.disconnect();
      group.removeEventListener('focusin', onFocus);
      group.removeEventListener('keydown', onKey);
      group.removeAttribute('data-roving');
    },
  };
}

/** The open menu (`.pc-popover`) holding `target`, below `root`. */
function menuOf(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  for (let el = target as HTMLElement | null; el && el !== root; el = el.parentElement) {
    if (hasClass(el, 'pc-popover')) return el;
  }
  return null;
}

/** Opens a popover: a menu button (`aria-haspopup`) or a disclosure (`aria-expanded`). */
const opensPopover = (el: Element) => !!el.getAttribute?.('aria-haspopup') || el.getAttribute?.('aria-expanded') != null;

/**
 * The button that opened `menu`: the menu button beside it, else the disclosure button. A menu
 * button comes first because a rail group marks its tool button expanded while its flyout is open.
 */
function triggerOf(menu: HTMLElement): HTMLElement | null {
  const siblings = Array.from(menu.parentElement?.children ?? []).filter((c) => c !== menu);
  const found = siblings.find((c) => c.getAttribute('aria-haspopup')) ?? siblings.find(opensPopover);
  return (found as HTMLElement | undefined) ?? null;
}

const selected = (b: HTMLElement) =>
  b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-selected') === 'true' || hasClass(b, 'is-active');

/**
 * Keyboard support for the shell's dropdown menus: a menu opened from the
 * keyboard takes focus (on its selected entry, else the first), the up and
 * down arrows, Home and End move inside it, and Escape gives focus back to
 * the button that opened it.
 */
export function bindMenuKeys(root: HTMLElement): () => void {
  const onClick = (e: MouseEvent) => {
    // A click with no press count came from Enter or Space.
    const trigger = e.target as HTMLElement;
    if (e.detail || !opensPopover(trigger) || document.activeElement !== trigger) return;
    const owner = trigger.parentElement;
    const menu = Array.from(owner?.children ?? []).find((c) => hasClass(c, 'pc-popover')) as HTMLElement | undefined;
    if (!menu) return;
    const entries = groupButtons(menu);
    (entries.find(selected) ?? entries[0])?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const menu = menuOf(e.target, root);
    if (!menu) return;
    // The menu's own dismiss handler closes it.
    if (e.key === 'Escape') return void triggerOf(menu)?.focus();
    if (modified(e) || e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
    const entries = groupButtons(menu);
    const at = entries.indexOf(e.target as HTMLElement);
    const to = at < 0 ? null : stepTab(at, entries.length, e.key);
    if (to === null) return;
    e.preventDefault();
    entries[to]!.focus();
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
  };
}

/** One area F6 moves focus to. */
export interface ShellRegion {
  el: HTMLElement;
  /** Focus something in it; false when nothing there can take focus. */
  focus(): boolean;
}

/** `el` and its ancestors up to `root` are not hidden. */
function visibleIn(el: HTMLElement, root: HTMLElement): boolean {
  if (!root.contains(el)) return false;
  for (let n: HTMLElement | null = el; n && n !== root; n = n.parentElement) {
    if (n.hidden) return false;
  }
  return true;
}

/**
 * Register the `focus-next-region` (F6) and `focus-previous-region`
 * (Shift+F6) actions, which move focus between the shell's areas in order,
 * and run them from anywhere in the shell. Keys inside an open modal dialog
 * are left alone.
 */
export function bindRegionKeys(chart: Chart, shell: HTMLElement, regions: () => ShellRegion[]): () => void {
  const actions = chart.actions;
  const move = (by: 1 | -1): boolean => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !shell.contains(active)) return false;
    const list = regions().filter((r) => visibleIn(r.el, shell));
    const n = list.length;
    const at = list.findIndex((r) => r.el.contains(active));
    const from = at >= 0 ? at : by > 0 ? -1 : n;
    for (let i = 1; i <= n; i++) {
      const region = list[(((from + by * i) % n) + n) % n]!;
      if (region.el.contains(active) && at >= 0) continue;
      if (region.focus()) return true;
    }
    return false;
  };
  const offs = (
    [
      [NEXT_REGION, 'actionNextRegion', 'F6', 1],
      [PREVIOUS_REGION, 'actionPreviousRegion', 'Shift+F6', -1],
    ] as const
  ).map(([id, message, key, by]) =>
    actions.has(id) ? () => {} : actions.register({ id, label: () => shellText(chart, message), keys: [key], run: () => move(by) }),
  );
  const onKey = (e: KeyboardEvent) => {
    // A focused chart has already run it (and taken the key).
    if (e.defaultPrevented || !chart.features.keyboard) return;
    if (modalOpen()) return;
    const id = actions.match(e).find((m) => m === NEXT_REGION || m === PREVIOUS_REGION);
    if (id && actions.run(id)) e.preventDefault();
  };
  shell.addEventListener('keydown', onKey);
  return () => {
    shell.removeEventListener('keydown', onKey);
    offs.forEach((off) => off());
  };
}
