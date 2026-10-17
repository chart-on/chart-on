import type { Chart, ChartContextMenuEvent, PriceScaleMode } from '@charton/core';
import { ChevronRight, ChevronsRight, ClipboardCopy, Copy, Group, Lock, LockOpen, Minus, Palette, RotateCcw, Trash2, Ungroup } from 'lucide';
import { appearanceOf } from './appearance';
import { clipboardApi } from './clipboard';
import { menuMark } from './controls';
import { fadeOutAndRemove, h, icon, inlineKey, isolateFromChart, isRtl, onDismiss, placeAtOrigin, type IconSource } from './dom';
import { drawingIcons } from './icons';
import { legendMenuItems } from './legend-menu';
import { shellText } from './messages';

/**
 * Runs when the item is picked. A thrown error, or a returned promise that
 * rejects, goes to `ContextMenuOptions.onError`; other return values are ignored.
 */
export type ContextMenuSelectHandler = () => unknown;

/** An entry of the chart's context menu: an action, a check toggle, a submenu, a heading or a separator. */
export type ContextMenuItem =
  /** `danger` styles a destructive action, e.g. Remove. */
  | { type: 'action'; id: string; label: string; icon?: IconSource; disabled?: boolean; danger?: boolean; onSelect: ContextMenuSelectHandler }
  /** A toggle shown with a check mark (`menuitemcheckbox`). */
  | { type: 'check'; id: string; label: string; checked: boolean; onSelect: ContextMenuSelectHandler }
  /** Opens a nested menu: on click, hover, Arrow Right, Enter or Space; Arrow Left or Escape closes it. */
  | { type: 'submenu'; id: string; label: string; icon?: IconSource; items: ContextMenuItem[] }
  /** A heading that is not an item, e.g. the name of what the menu is for. The first one also names the menu. */
  | { type: 'label'; label: string }
  | { type: 'separator' };

/** Options for `createContextMenu`: how to build each menu's items from the defaults, and where errors from an item's `onSelect` go. */
export interface ContextMenuOptions {
  /**
   * The items for one menu. Receives the default items for the event's target,
   * so it can add to, remove from or reorder them. Return `[]` for no menu.
   */
  items?(event: ChartContextMenuEvent, defaults: ContextMenuItem[], chart: Chart): ContextMenuItem[];
  /**
   * An item's `onSelect` threw or its promise rejected, e.g. the clipboard
   * refused "Copy price". Defaults to `console.error`.
   */
  onError?(error: unknown, itemId: string): void;
}

/** Returned by `createContextMenu`: the open menu, if any, with `close` and `destroy`. */
export interface ContextMenuHandle {
  /** The open menu, or null. */
  readonly el: HTMLElement | null;
  close(): void;
  destroy(): void;
}

const EDGE = 4;

/** Copy to the clipboard; rejects when there is none (insecure context, old browser). */
function copyText(text: string): Promise<void> {
  const clipboard = clipboardApi();
  return clipboard ? clipboard.writeText(text) : Promise.reject(new Error('Clipboard is not available'));
}

/** Default menu items for what was right-clicked. */
export function defaultContextMenuItems(chart: Chart, e: ChartContextMenuEvent): ContextMenuItem[] {
  const items = targetItems(chart, e);
  // The plot menu opens the appearance panel when the chart has one (the shell adds it).
  const appearance = appearanceOf(chart);
  if (appearance && e.target === 'plot') {
    items.push(
      { type: 'separator' },
      { type: 'action', id: 'appearance', label: shellText(chart, 'menuAppearance'), icon: Palette, onSelect: () => appearance.open() },
    );
  }
  return items;
}

function targetItems(chart: Chart, e: ChartContextMenuEvent): ContextMenuItem[] {
  if (e.target === 'legend') return e.series ? legendMenuItems(chart, e.series) : [];
  if (e.target === 'drawing' && e.drawing) return drawingItems(chart, e.drawing);
  if (e.target === 'timeAxis') {
    return [
      { type: 'action', id: 'reset-view', label: shellText(chart, 'menuResetView'), icon: RotateCcw, onSelect: () => chart.resetView() },
      {
        type: 'action',
        id: 'scroll-to-newest',
        label: shellText(chart, 'menuScrollToNewest'),
        icon: ChevronsRight,
        onSelect: () => chart.scrollToRealtime(),
      },
    ];
  }
  const scale = e.scale ?? 'right';
  const price = e.price;
  const items: ContextMenuItem[] = [];
  if (e.target === 'plot') {
    items.push({ type: 'action', id: 'reset-view', label: shellText(chart, 'menuResetView'), icon: RotateCcw, onSelect: () => chart.resetView() });
  }
  if (price !== null && e.scale !== null) {
    const text = chart.formatAxis(e.pane, price, scale);
    items.push({
      type: 'action',
      id: 'copy-price',
      label: shellText(chart, 'menuCopyPrice', { price: text }),
      icon: ClipboardCopy,
      onSelect: () => copyText(text),
    });
    // A line needs a bar under the pointer to anchor its time.
    const time = e.time;
    if (e.target === 'plot' && time !== null) {
      items.push({
        type: 'action',
        id: 'add-horizontal-line',
        label: shellText(chart, 'menuAddHorizontalLine', { price: text }),
        icon: Minus,
        onSelect: () => chart.drawings.add({ type: 'hline', pane: e.pane, points: [{ time, price }], style: {} }),
      });
    }
  }
  if (e.target === 'plot' && e.time !== null) {
    const time = e.time;
    // A vertical line only uses the time; the price just fills the anchor point.
    items.push({
      type: 'action',
      id: 'add-vertical-line',
      label: shellText(chart, 'menuAddVerticalLine', { time: chart.formatTime(time) }),
      icon: drawingIcons.vline,
      onSelect: () => chart.drawings.add({ type: 'vline', pane: e.pane, points: [{ time, price: price ?? 0 }], style: {} }),
    });
  }
  if (e.scale === null) return items;
  const mode = chart.getPriceScaleMode(e.pane, scale);
  const setMode = (m: PriceScaleMode) => () => chart.setPriceScaleMode(mode === m ? 'normal' : m, e.pane, scale);
  const auto = chart.isAutoScale(e.pane, scale);
  items.push(
    { type: 'separator' },
    {
      type: 'check',
      id: 'auto-scale',
      label: shellText(chart, 'menuAutoScale'),
      checked: auto,
      onSelect: () => chart.setAutoScale(!auto, e.pane, scale),
    },
    { type: 'check', id: 'log-scale', label: shellText(chart, 'menuLogScale'), checked: mode === 'log', onSelect: setMode('log') },
    { type: 'check', id: 'percent-scale', label: shellText(chart, 'menuPercentScale'), checked: mode === 'percent', onSelect: setMode('percent') },
  );
  if (e.target === 'priceAxis') {
    const invert = chart.getPriceScaleOptions(e.pane, scale)?.invert ?? false;
    items.push({
      type: 'check',
      id: 'invert-scale',
      label: shellText(chart, 'menuInvertScale'),
      checked: invert,
      onSelect: () => chart.setPriceScaleOptions({ invert: !invert }, e.pane, scale),
    });
  }
  return items;
}

function drawingItems(chart: Chart, id: string): ContextMenuItem[] {
  const drawing = chart.drawings.getAll().find((d) => d.id === id);
  if (!drawing) return [];
  const locked = Boolean(drawing.locked);
  const items: ContextMenuItem[] = [
    {
      type: 'action',
      id: 'lock-drawing',
      label: shellText(chart, locked ? 'drawingUnlock' : 'drawingLock'),
      icon: locked ? LockOpen : Lock,
      onSelect: () => chart.drawings.update(id, { locked: !locked }),
    },
    { type: 'action', id: 'clone-drawing', label: shellText(chart, 'drawingClone'), icon: Copy, onSelect: () => chart.drawings.clone(id) },
    { type: 'action', id: 'remove-drawing', label: shellText(chart, 'drawingDelete'), icon: Trash2, danger: true, onSelect: () => chart.drawings.remove(id) },
  ];
  // Group the selection when the drawing is part of it; ungroup the drawing's own group.
  if (chart.drawings.selection.includes(id) && chart.actions.get('group-drawings')?.enabled) {
    items.push({ type: 'action', id: 'group-drawings', label: shellText(chart, 'drawingGroup'), icon: Group, onSelect: () => chart.drawings.group() });
  }
  if (drawing.group && !chart.drawings.locked) {
    items.push({
      type: 'action',
      id: 'ungroup-drawings',
      label: shellText(chart, 'drawingUngroup'),
      icon: Ungroup,
      onSelect: () => chart.drawings.ungroup([id]),
    });
  }
  return items;
}

/**
 * Drop separators at either end (or right after a heading) and repeated ones,
 * and submenus left empty, so filtered lists stay tidy.
 */
export function tidySeparators(items: ContextMenuItem[]): ContextMenuItem[] {
  const out: ContextMenuItem[] = [];
  for (const raw of items) {
    const item = raw.type === 'submenu' ? { ...raw, items: tidySeparators(raw.items) } : raw;
    if (item.type === 'submenu' && item.items.length === 0) continue;
    const prev = out[out.length - 1];
    if (item.type === 'separator' && (!prev || prev.type === 'separator' || prev.type === 'label')) continue;
    out.push(item);
  }
  if (out[out.length - 1]?.type === 'separator') out.pop();
  return out;
}

/** Menu position at `at`, flipped to the other side of the pointer when it would leave `area`. */
export function placeMenu(
  at: { x: number; y: number },
  size: { width: number; height: number },
  area: { width: number; height: number },
): { x: number; y: number } {
  const x = at.x + size.width + EDGE > area.width ? Math.max(EDGE, at.x - size.width) : at.x;
  const y = at.y + size.height + EDGE > area.height ? Math.max(EDGE, at.y - size.height) : at.y;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Index of the next enabled item from `from` in `step` direction, wrapping around. */
export function nextItem(enabled: readonly boolean[], from: number, step: 1 | -1): number {
  const n = enabled.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + step * k) % n) + n) % n;
    if (enabled[i]) return i;
  }
  return from;
}

/** One open menu panel: the top menu or a submenu. */
interface Panel {
  el: HTMLElement;
  buttons: HTMLButtonElement[];
  /** The open submenu and the button that opened it. */
  child: { panel: Panel; button: HTMLButtonElement } | null;
}

/**
 * Right-click menu for the chart: opens on the chart's `contextmenu` event,
 * with default items per target (a legend row's menu for target `'legend'`).
 * Arrow keys, Home and End move between items, Enter or Space picks one,
 * Arrow Right opens a submenu and Arrow Left closes it, Escape, Tab or a
 * press outside closes the menu.
 */
export function createContextMenu(chart: Chart, options: ContextMenuOptions = {}): ContextMenuHandle {
  let menu: HTMLElement | null = null;
  let dispose: (() => void) | null = null;

  const close = (refocus = false) => {
    if (!menu) return;
    const hadFocus = menu.contains(document.activeElement);
    fadeOutAndRemove(menu);
    menu = null;
    dispose?.();
    dispose = null;
    if (refocus && hadFocus) chart.root.focus({ preventScroll: true });
  };

  const select = (item: { id: string; onSelect: ContextMenuSelectHandler }) => {
    const report = (error: unknown) => {
      if (options.onError) options.onError(error, item.id);
      else console.error(`Context menu item "${item.id}" failed:`, error);
    };
    try {
      const result = item.onSelect();
      if (result instanceof Promise) result.catch(report);
    } catch (error) {
      report(error);
    }
  };

  const closeChild = (panel: Panel, refocus: boolean) => {
    const child = panel.child;
    if (!child) return;
    closeChild(child.panel, false);
    fadeOutAndRemove(child.panel.el);
    child.button.setAttribute('aria-expanded', 'false');
    panel.child = null;
    if (refocus) child.button.focus();
  };

  const openChild = (panel: Panel, button: HTMLButtonElement, items: ContextMenuItem[], label: string, focus: boolean) => {
    if (panel.child?.button === button) {
      if (focus) panel.child.panel.buttons[nextItem(enabledOf(panel.child.panel), -1, 1)]?.focus();
      return;
    }
    closeChild(panel, false);
    const sub = render(items, label, () => closeChild(panel, true));
    sub.el.className += ' pc-context-submenu';
    // Inside its parent, so presses on it are not outside presses, beside the opening item.
    placeAtOrigin(sub.el);
    panel.el.append(sub.el);
    // On the menu's inline end side, or the other side where the chart ends; moved up to fit below.
    const area = chart.root.getBoundingClientRect();
    const box = panel.el.getBoundingClientRect();
    const right = isRtl(panel.el)
      ? box.left + 4 - sub.el.offsetWidth < area.left
      : box.right - 4 + sub.el.offsetWidth <= area.right;
    const top = Math.min(button.offsetTop - 4, area.bottom - box.top - sub.el.offsetHeight - EDGE);
    Object.assign(sub.el.style, {
      left: `${right ? panel.el.offsetWidth - 4 : 4 - sub.el.offsetWidth}px`,
      top: `${Math.max(top, area.top - box.top + EDGE)}px`,
    });
    button.setAttribute('aria-expanded', 'true');
    panel.child = { panel: sub, button };
    if (focus) sub.buttons[nextItem(enabledOf(sub), -1, 1)]?.focus();
  };

  /** A menu panel for `items`; `back` closes it when it is a submenu (Arrow Left, Escape). */
  const render = (items: ContextMenuItem[], label: string, back: (() => void) | null): Panel => {
    const el = h('div', { class: 'pc-popover pc-context-menu', role: 'menu', 'aria-label': label });
    const panel: Panel = { el, buttons: [], child: null };
    const opens = new Map<HTMLButtonElement, Extract<ContextMenuItem, { type: 'submenu' }>>();
    for (const item of items) {
      if (item.type === 'separator') {
        el.append(h('div', { class: 'pc-menu-sep', role: 'separator' }));
        continue;
      }
      if (item.type === 'label') {
        el.append(h('div', { class: 'pc-menu-label', role: 'presentation' }, item.label));
        continue;
      }
      const b = h('button', {
        class: item.type === 'action' && item.danger ? 'pc-popover-item pc-menu-danger' : 'pc-popover-item',
        role: item.type === 'check' ? 'menuitemcheckbox' : 'menuitem',
        tabindex: '-1',
      });
      if (item.type === 'check') b.setAttribute('aria-checked', String(item.checked));
      if (item.type === 'action' && item.disabled) b.disabled = true;
      // Check items show a mark only when on; the empty slot keeps labels aligned.
      const lead = item.type === 'check' ? menuMark(item.checked) : h('span', { class: 'pc-menu-icon' });
      if (item.type !== 'check' && item.icon) lead.append(icon(item.icon, 16));
      b.append(lead, h('span', {}, item.label));
      if (item.type === 'submenu') {
        b.setAttribute('aria-haspopup', 'menu');
        b.setAttribute('aria-expanded', 'false');
        const arrow = h('span', { class: 'pc-menu-icon pc-menu-arrow' });
        arrow.append(icon(ChevronRight, 16));
        b.append(arrow);
        opens.set(b, item);
        b.addEventListener('click', () => openChild(panel, b, item.items, item.label, true));
        b.addEventListener('pointerenter', () => openChild(panel, b, item.items, item.label, false));
      } else {
        b.addEventListener('click', () => {
          close(true);
          select(item);
        });
        // Pointing at another item closes an open submenu.
        b.addEventListener('pointerenter', () => closeChild(panel, false));
      }
      panel.buttons.push(b);
      el.append(b);
    }
    el.addEventListener('keydown', (ev: KeyboardEvent) => {
      const buttons = panel.buttons;
      const enabled = enabledOf(panel);
      const current = document.activeElement as HTMLButtonElement;
      const at = buttons.indexOf(current);
      // Keys inside an open submenu are its own.
      if (at < 0 && panel.child) return;
      let to = -1;
      const sub = opens.get(current);
      if (ev.key === 'ArrowDown') to = nextItem(enabled, at, 1);
      else if (ev.key === 'ArrowUp') to = nextItem(enabled, at < 0 ? 0 : at, -1);
      else if (ev.key === 'Home') to = nextItem(enabled, -1, 1);
      else if (ev.key === 'End') to = nextItem(enabled, buttons.length, -1);
      else if (sub && (inlineKey(ev) === 'ArrowRight' || ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        openChild(panel, current, sub.items, sub.label, true);
      } else if (back && (inlineKey(ev) === 'ArrowLeft' || ev.key === 'Escape')) {
        ev.preventDefault();
        back();
      } else if (ev.key === 'Escape' || ev.key === 'Tab') {
        ev.preventDefault();
        close(true);
      }
      if (to >= 0) {
        ev.preventDefault();
        closeChild(panel, false);
        buttons[to]?.focus();
      }
      // Keep keys away from the chart's own shortcuts (arrows pan, Delete removes drawings),
      // and a submenu's keys away from the menu that holds it.
      ev.stopPropagation();
    });
    return panel;
  };

  const open = (e: ChartContextMenuEvent) => {
    close();
    const defaults = defaultContextMenuItems(chart, e);
    const items = tidySeparators(options.items ? options.items(e, defaults, chart) : defaults);
    if (items.length === 0) return;
    const heading = items.find((i) => i.type === 'label');
    const panel = render(items, heading?.type === 'label' ? heading.label : shellText(chart, 'menuLabel'), null);
    const el = panel.el;
    // Presses inside the menu must not start a pan or a drawing.
    isolateFromChart(el);
    // A right click on the menu must not reach the chart, which would reopen it there.
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    placeAtOrigin(el);
    chart.root.append(el);
    // Open at the pointer, flipped or clamped to stay inside the chart.
    const at = placeMenu(e, { width: el.offsetWidth, height: el.offsetHeight }, chart);
    Object.assign(el.style, { left: `${at.x}px`, top: `${at.y}px` });
    menu = el;
    dispose = onDismiss(el, () => close(true));
    panel.buttons[nextItem(enabledOf(panel), -1, 1)]?.focus();
  };

  const off = chart.on('chart:contextmenu', open);
  return {
    get el() {
      return menu;
    },
    close: () => close(),
    destroy() {
      close();
      off();
    },
  };
}

function enabledOf(panel: Panel): boolean[] {
  return panel.buttons.map((b) => !b.disabled);
}
