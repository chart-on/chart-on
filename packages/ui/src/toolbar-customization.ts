import { createLocalStorageAdapter, type Chart } from '@charton/core';
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, GripVertical, X } from 'lucide';
import { button, iconButton } from './controls';
import { findIn, openDialogFrame, type DialogFrame } from './dialog';
import { h, icon, nameButton, prefersReducedMotion } from './dom';
import { DRAG_THRESHOLD, dropIndex } from './favorites-model';
import { keyedText, keyOf, shellText } from './messages';
import type { ToolbarAction, ToolbarItem, ToolbarItemPatch, ToolbarOptions } from './toolbar';
import { displayOrder, insertItem, removeItem, updateItem, type ToolbarPlacement } from './toolbar-model';
import { isToolbarAction, moveToolbarAction, readToolbarIds, toolbarBucket, toolbarLayout, toolbarSelection } from './toolbar-customization-model';
import { toolbarBuiltins } from './toolbar-catalog';
import { devCheck } from './options-schema';
import { linkEnds, type ToolbarPeer } from './toolbar-link';

/** Options for `toolbarCustomization`. */
export interface ToolbarCustomizationOptions {
  /** Default item ids users cannot move or remove. */
  locked?: readonly string[];
}

/** Internal: what the toolbar delegates its items and user preferences to while customization is on. */
export interface ToolbarCustomization {
  open(): void;
  sync(): void;
  setDefaults(next: ToolbarItem[]): void;
  update(id: string, patch: ToolbarItemPatch): void;
  add(item: ToolbarItem, placement?: ToolbarPlacement): void;
  remove(id: string): void;
  registerAction(action: ToolbarAction): () => void;
  onChange(listener: (event: { ids: string[] }) => void): () => void;
  destroy(): void;
}

/**
 * The toolbar's `customize` part, made by `toolbarCustomization(options)`. The
 * toolbar calls it with the element its panel opens in, the chart it acts on,
 * its items and preference store, and a function that shows a list of items.
 */
export type ToolbarCustomizationPart = (
  host: HTMLElement,
  chart: () => Chart,
  toolbar: Pick<ToolbarOptions, 'items' | 'settings' | 'storageKey'>,
  apply: (items: readonly ToolbarItem[]) => void,
) => ToolbarCustomization;

/**
 * End-user toolbar customization for the toolbar's `customize` option (on
 * `createToolbar`, the shell or the grid): a Customize toolbar entry in the
 * "more" menu and on right-click, with a catalog of actions users add, remove
 * and reorder, saved to the toolbar's `settings`. Without it
 * `openCustomization()` does nothing and `registerAction()` throws.
 */
export function toolbarCustomization(options: ToolbarCustomizationOptions = {}): ToolbarCustomizationPart {
  devCheck('toolbarCustomization', options, 'toolbarCustomization');
  return (host, chart, toolbar, apply) => createToolbarCustomization(host, chart, { ...toolbar, ...options }, apply);
}

/** Internal controller; the toolbar owns mounting and delegates user preferences here. */
export function createToolbarCustomization(
  host: HTMLElement, chart: () => Chart, options: Pick<ToolbarOptions, 'items' | 'settings' | 'storageKey'> & ToolbarCustomizationOptions,
  apply: (items: readonly ToolbarItem[]) => void,
): ToolbarCustomization {
  let defaults = options.items;
  const builtin = toolbarBuiltins();
  const registered = new Map<string, ToolbarItem>();
  const patches = new Map<string, ToolbarItemPatch>();
  const locked = new Set(options.locked ?? []);
  let ids: string[] | null = null;
  let frame: DialogFrame | null = null;
  let list: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  let resetButton: HTMLButtonElement | null = null;
  /** Rows of the shown actions in the open dialog, by id. */
  const rows = new Map<string, HTMLElement>();
  /** A grip drag in progress: `grab` is the pointer's offset in the row, `to` the item it would swap places with. */
  let drag: { id: string; row: HTMLElement; y: number; grab: number; moved: boolean; to: string | null; stop: () => void } | null = null;
  let destroyed = false;
  let observed: Chart | null = null;
  let off: (() => void)[] = [];
  const text = (key: Parameters<typeof shellText>[1], params?: Parameters<typeof shellText>[2]) => shellText(chart(), key, params);
  const label = (item: ToolbarItem) => 'label' in item ? keyedText(chart(), item.labelKey, item.label, item.labelParams) : item.id ?? '';
  const error = () => chart().notify({ kind: 'error', message: text('toolbarSaveError') });
  const settings = options.settings === undefined ? createLocalStorageAdapter({ onError: error }).settings : options.settings;
  const key = options.storageKey ?? 'toolbar';
  try { ids = readToolbarIds(settings?.get(key) ?? null); } catch { error(); }

  /** The other bar's customization once the shell links them; `toBottom` says which way items move. */
  let peer: ToolbarPeer | null = null;
  let toBottom = false;
  /** Whether the other bar's saved layout shows the item: this bar's defaults then leave it out. */
  const held = (item: ToolbarItem) => item.id !== undefined && (peer?.holds(item.id) ?? false);
  const patched = (item: ToolbarItem) => patches.has(item.id!) ? { ...item, ...patches.get(item.id!), id: item.id } as ToolbarItem : item;
  const own = () => [...registered.values(), ...defaults].filter(isToolbarAction).map(patched);
  const catalog = () => {
    const entries = new Map<string, ToolbarItem>();
    // A linked bar can show the other bar's actions too.
    for (const item of [...(peer?.entries() ?? []), ...builtin, ...registered.values(), ...defaults]) {
      if (isToolbarAction(item)) entries.set(item.id!, item);
    }
    return [...entries.values()].map(patched);
  };
  const defaultIds = () => defaults.filter((item) => isToolbarAction(item) && !item.hidden && !held(item)).map((item) => item.id!);
  const selected = () => toolbarSelection(defaults, catalog(), ids ?? defaultIds(), locked).map((item) => item.hidden ? { ...item, hidden: false } : item);
  const close = () => { drag?.stop(); frame?.close(); frame = null; list = status = resetButton = null; };
  const update = () => {
    if (destroyed) return;
    // Preserve existing rendering and app-owned structure until a preference is set.
    apply(ids === null ? defaults.filter((item) => !held(item)) : toolbarLayout(defaults, selected()));
    render();
  };
  const save = () => {
    try {
      if (ids === null) settings?.remove(key);
      else settings?.set(key, JSON.stringify({ version: 1, ids }));
    } catch { error(); }
  };
  const listeners = new Set<(event: { ids: string[] }) => void>();
  /** Save a new list of shown actions, tell listeners, and let a linked bar show what it still has. */
  const commit = (next: string[] | null) => {
    ids = next;
    update();
    save();
    for (const listener of listeners) listener({ ids: selected().map((item) => item.id!) });
    peer?.refresh();
  };
  const changed = (next: readonly ToolbarItem[], focusId?: string, control?: string) => {
    ids = next.map((item) => item.id!);
    commit(selected().map((item) => item.id!));
    if (focusId && list) {
      const target = findIn(list, (el) => el.getAttribute('data-action') === focusId && el.getAttribute('data-control') === control);
      const fallback = findIn(list, (el) => el.getAttribute('data-action') === focusId && el.getAttribute('data-control') === 'toggle');
      ((target as HTMLButtonElement | null)?.disabled ? fallback : target)?.focus();
    }
  };
  const move = (id: string, to: string, control?: string) => {
    const next = moveToolbarAction(selected(), id, to, locked);
    if (!next) return;
    changed(next, id, control);
    if (status) status.textContent = text('toolbarMoved', { name: label(next.find((item) => item.id === id)!) });
  };
  const toggle = (item: ToolbarItem, show: boolean) => {
    if (locked.has(item.id!)) return;
    const next = selected().filter((entry) => entry.id !== item.id);
    if (show) next.push({ ...item, hidden: false });
    // An item shows in one bar at a time.
    if (show) peer?.release(item.id!);
    changed(next, item.id, 'toggle');
  };
  /** Move a shown action to the linked bar. */
  const moveAcross = (item: ToolbarItem) => {
    if (!peer || locked.has(item.id!)) return;
    changed(selected().filter((entry) => entry.id !== item.id), item.id, 'toggle');
    peer.receive(item);
    if (status) status.textContent = text('toolbarMoved', { name: label(item) });
  };

  // Grip drags use pointer events (mouse, pen and touch). The row follows the
  // pointer and the list reorders live, but the order only changes on release.
  function startDrag(e: PointerEvent, grip: HTMLElement, row: HTMLElement, id: string) {
    if (e.button !== 0 || drag) return;
    e.preventDefault();
    grip.focus();
    grip.setPointerCapture?.(e.pointerId);
    // Listen on the document: moving the row through the list can drop the capture.
    const doc = grip.ownerDocument;
    const mine = (ev: Event) => (ev as PointerEvent).pointerId === e.pointerId;
    const end = (ev: Event) => { if (mine(ev)) endDrag(ev.type === 'pointerup'); };
    const listeners: [string, (ev: Event) => void][] = [
      ['pointermove', (ev) => { if (mine(ev)) dragTo((ev as PointerEvent).clientY); }],
      ['pointerup', end],
      ['pointercancel', end],
      ['keydown', (ev) => {
        if ((ev as KeyboardEvent).key !== 'Escape') return;
        ev.preventDefault();
        ev.stopPropagation();
        endDrag(false);
      }],
    ];
    for (const [type, fn] of listeners) doc.addEventListener(type, fn, true);
    drag = { id, row, y: e.clientY, grab: e.clientY - row.getBoundingClientRect().top, moved: false, to: null, stop() {
      drag = null;
      for (const [type, fn] of listeners) doc.removeEventListener(type, fn, true);
    } };
  }

  function dragTo(y: number) {
    if (!drag || !list) return;
    if (!drag.moved) {
      if (Math.abs(y - drag.y) < DRAG_THRESHOLD) return;
      drag.moved = true;
      drag.row.setAttribute('data-dragging', 'true');
    }
    const { id, row } = drag;
    const items = selected();
    const from = items.findIndex((item) => item.id === id);
    const centers = items.filter((item) => item.id !== id).map((item) => {
      const r = rows.get(item.id!)!.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    const at = dropIndex(centers, y);
    const to = at === from ? null : items[at]!.id!;
    const next = to === null ? items : moveToolbarAction(items, id, to, locked);
    if (next && to !== drag.to) {
      drag.to = to;
      place(next, row, id);
    }
    // Follow the pointer from wherever the row now sits in the list.
    row.style.transform = '';
    row.style.transform = `translateY(${y - drag.grab - row.getBoundingClientRect().top}px)`;
  }

  /** Moves the dragged row to its place in `next` and slides the rows it passed. */
  function place(next: readonly ToolbarItem[], row: HTMLElement, id: string) {
    const index = next.findIndex((item) => item.id === id);
    const prev = next[index - 1];
    // Sections split the list, so attach the row to a neighbour in its own group.
    const children = [...list!.children];
    const ref = prev && toolbarBucket(prev) === toolbarBucket(next[index]!)
      ? children[children.indexOf(rows.get(prev.id!)!) + 1] ?? null
      : rows.get(next[index + 1]!.id!)!;
    if (ref === row) return;
    const others = [...rows.values()].filter((r) => r !== row);
    const before = others.map((r) => r.getBoundingClientRect().top);
    list!.insertBefore(row, ref);
    if (prefersReducedMotion()) return;
    others.forEach((r, i) => {
      const dy = before[i]! - r.getBoundingClientRect().top;
      if (dy) r.animate?.([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 150, easing: 'ease-out' });
    });
  }

  function endDrag(commit: boolean) {
    if (!drag) return;
    const { id, moved, to, stop } = drag;
    stop();
    if (!moved) return;
    if (commit && to !== null) move(id, to, 'drag');
    else render();
  }

  function render() {
    if (!list) return;
    if (frame) {
      frame.header.firstElementChild!.textContent = text('toolbarCustomize');
      nameButton(frame.header.children[frame.header.children.length - 1]!, text('dialogClose'));
    }
    if (resetButton) resetButton.firstElementChild!.textContent = text('toolbarReset');
    const active = document.activeElement;
    const focusId = list.contains(active) ? active?.getAttribute('data-action') : null;
    const focusControl = active?.getAttribute('data-control');
    drag?.stop();
    rows.clear();
    const current = selected();
    const shown = new Set(current.map((item) => item.id!));
    list.replaceChildren();
    let group: string | undefined;
    for (const item of [...current, ...displayOrder(catalog()).filter((entry) => !shown.has(entry.id!))]) {
      const section = shown.has(item.id!) ? item.group ?? 'analysis' : 'available';
      if (section !== group) list.append(h('div', { class: 'pc-popover-label' }, text(keyOf('toolbar', section))));
      group = section;
      const id = item.id!;
      const name = label(item);
      const fixed = locked.has(id);
      const checkbox = h('input', { type: 'checkbox', 'aria-label': name, 'data-action': id, 'data-control': 'toggle' });
      checkbox.checked = shown.has(id);
      checkbox.disabled = fixed;
      checkbox.addEventListener('change', () => toggle(item, checkbox.checked));
      // The icon the item shows in the bar, so a row is easy to match with its button; a fixed slot keeps labels aligned.
      const glyph = h('span', { class: 'pc-toolbar-action-icon', 'aria-hidden': 'true' }, ...('icon' in item && item.icon ? [icon(item.icon)] : []));
      const row = h('div', { class: 'pc-toolbar-action', 'data-action': id }, h('label', {}, checkbox, glyph, h('span', {}, name)));
      const index = current.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        const controls = h('div', { class: 'pc-toolbar-action-controls' });
        for (const [step, source, key, control] of [[-1, ArrowUp, 'toolbarMoveUp', 'up'], [1, ArrowDown, 'toolbarMoveDown', 'down']] as const) {
          const neighbor = current[index + step];
          const b = iconButton({ icon: source, variant: 'ghost', label: text(key, { name }), onClick: () => neighbor && move(id, neighbor.id!, control) });
          b.setAttribute('data-action', id);
          b.setAttribute('data-control', control);
          b.disabled = !neighbor || moveToolbarAction(current, id, neighbor.id!, locked) === null;
          controls.append(b);
        }
        const remove = iconButton({ icon: X, variant: 'ghost', label: text('toolbarRemove', { name }), onClick: () => toggle(item, false) });
        remove.disabled = fixed;
        remove.setAttribute('data-action', id);
        remove.setAttribute('data-control', 'remove');
        controls.append(remove);
        if (peer) {
          const across = iconButton({
            icon: toBottom ? ArrowDownToLine : ArrowUpToLine,
            variant: 'ghost',
            label: text(toBottom ? 'toolbarMoveToBottomBar' : 'toolbarMoveToToolbar', { name }),
            onClick: () => moveAcross(item),
          });
          across.disabled = fixed;
          across.setAttribute('data-action', id);
          across.setAttribute('data-control', 'bar');
          controls.append(across);
        }
        const grip = iconButton({ icon: GripVertical, variant: 'ghost', label: text('toolbarDrag', { name }) });
        grip.setAttribute('data-action', id);
        grip.setAttribute('data-control', 'drag');
        grip.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          e.stopPropagation();
          const neighbor = current[index + (e.key === 'ArrowUp' ? -1 : 1)];
          if (neighbor) move(id, neighbor.id!, 'drag');
        });
        grip.disabled = fixed;
        grip.addEventListener('pointerdown', (e) => { if (!fixed) startDrag(e, grip, row, id); });
        rows.set(id, row);
        row.insertBefore(grip, row.firstElementChild);
        row.append(controls);
      }
      list.append(row);
    }
    if (focusId) findIn(list, (el) => el.getAttribute('data-action') === focusId && el.getAttribute('data-control') === focusControl)?.focus();
  }

  const sync = () => {
    if (destroyed) return;
    const current = chart();
    if (observed === current) return;
    off.forEach((stop) => stop());
    observed = current;
    // The labels follow the language of the chart acted on.
    off = [current.on('localization:change', update)];
    update();
  };

  const open = () => {
    if (frame || destroyed) return;
    sync();
    frame = openDialogFrame(host, { title: text('toolbarCustomize'), className: 'pc-toolbar-customization', modal: false, onDismiss: close, closeLabel: text('dialogClose') });
    list = h('div', { class: 'pc-toolbar-action-list' });
    status = h('div', { class: 'pc-sr-only', role: 'status', 'aria-live': 'polite' });
    const reset = button({ label: text('toolbarReset'), onClick: () => {
      commit(null);
      reset.focus();
    } });
    resetButton = reset;
    frame.panel.append(list, status, h('div', { class: 'pc-dialog-footer' }, reset));
    render();
    findIn(list, (el) => el.tagName.toLowerCase() === 'input' && !(el as HTMLInputElement).disabled)?.focus();
  };
  sync();
  const showing = (id: string) => selected().some((item) => item.id === id);
  const self: ToolbarPeer = {
    holds: (id) => !destroyed && ids !== null && ids.includes(id),
    entries: own,
    receive(item) {
      if (destroyed || showing(item.id!)) return;
      commit([...selected().map((entry) => entry.id!), item.id!]);
    },
    release(id) {
      if (!destroyed && showing(id)) commit(selected().map((item) => item.id!).filter((entry) => entry !== id));
    },
    refresh: update,
  };
  const controller: ToolbarCustomization = {
    open, sync,
    setDefaults(next: ToolbarItem[]) { apply(next); defaults = next; ids = null; patches.clear(); update(); save(); },
    update(id: string, patch: ToolbarItemPatch) {
      if (!catalog().some((item) => item.id === id) && !defaults.some((item) => item.id === id)) return;
      defaults = updateItem<ToolbarItem>(defaults, id, patch).slice();
      patches.set(id, { ...patches.get(id), ...patch });
      if (ids !== null && patch.hidden !== undefined) {
        ids = ids.filter((entry) => entry !== id);
        if (!patch.hidden) ids.push(id);
      }
      update();
    },
    add(item: ToolbarItem, placement?: ToolbarPlacement) {
      const before = selected();
      if (isToolbarAction(item) && before.some((entry) => entry.id === item.id)) throw new Error(`Duplicate toolbar item id "${item.id}"`);
      defaults = insertItem(defaults, item, placement);
      if (ids !== null && isToolbarAction(item) && !item.hidden) {
        const anchor = placement && ('before' in placement ? placement.before : placement.after);
        ids = insertItem(before, item, before.some((entry) => entry.id === anchor) ? placement : undefined).map((entry) => entry.id!);
      }
      update();
    },
    remove(id: string) {
      defaults = removeItem(defaults, id).slice();
      ids = (ids ?? defaultIds()).filter((entry) => entry !== id);
      update();
    },
    registerAction(action: ToolbarAction) {
      if (catalog().some((item) => item.id === action.id)) throw new Error(`Duplicate toolbar action id "${action.id}"`);
      const item: ToolbarItem = { ...action, type: 'button', group: action.group ?? 'analysis' };
      registered.set(action.id, item);
      update();
      return () => { registered.delete(action.id); update(); };
    },
    onChange(listener: (event: { ids: string[] }) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    destroy() { destroyed = true; close(); off.forEach((stop) => stop()); listeners.clear(); peer = null; },
  };
  linkEnds.set(controller, { self, link(other, down) { peer = other; toBottom = down; update(); } });
  return controller;
}
