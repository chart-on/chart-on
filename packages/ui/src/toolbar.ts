import type { Chart, MessageParams, SettingsAdapter } from '@charton/core';
import { Ellipsis } from 'lucide';
import { button, iconButton, menuButton, popoverItem, segmentedTabs, type MenuOption, type SegmentOption } from './controls';
import { h, markActive, icon, nameButton, placePopover, popoverToggle, visibilityOf, type IconSource, type Visibility, type VisibilityControl } from './dom';
import {
  alignOf,
  displayOrder,
  groupDividers,
  insertItem,
  overflowOrder,
  removeItem,
  separatorVisibility,
  updateItem,
  type ToolbarGroup,
  type ToolbarPlacement,
  type ToolbarSlotKind,
} from './toolbar-model';
import { keyedText, shellText, type ShellMessageKey } from './messages';
import { retainTips } from './tooltip';
import type { ToolbarCustomization, ToolbarCustomizationPart } from './toolbar-customization';

export type { ToolbarGroup, ToolbarPlacement } from './toolbar-model';

/** Placement fields every item accepts. */
export interface ToolbarItemLayout {
  /** Keep the item in the list but do not show it. */
  hidden?: boolean;
  /** `end` pushes the item to the right edge. Default `end` for the view group, else `start`. */
  align?: 'start' | 'end';
  /**
   * Placement group from `roadmap/toolbar-layout.md`. Context items render
   * first and overflow last; view items sit at the right edge and overflow
   * first. Ungrouped items rank with the analysis group.
   */
  group?: ToolbarGroup;
  /**
   * When the toolbar is too narrow, lower values move into the "more" menu
   * first, within the item's group. Items without a priority go last. Custom
   * items go after every other item and are hidden rather than listed.
   */
  priority?: number;
}

/** Text that follows the chart's language. */
export interface ToolbarItemText {
  /**
   * Message key for `label` (see the `localization` option): the toolbar shows
   * the key's text in the chart's language, and `label` when the language has
   * none. The presets set one from `defaultShellMessages`. A built-in key only
   * replaces its own English default, so a `label` you change stays as it is.
   */
  labelKey?: ShellMessageKey | (string & {});
  /** Values for the `{name}` placeholders of `labelKey`'s text, e.g. `{ name: 'Volume' }`. */
  labelParams?: MessageParams;
}

/** Keeps an item in step with changes made outside the toolbar. */
export interface ToolbarItemWatch {
  /**
   * Subscribe to whatever changes the item's state and call `refresh` to
   * re-read it (`isActive`, `isDisabled`, `currentValue`). Called when the
   * item mounts and again when the chart the toolbar acts on changes (the
   * active cell of a chart grid); return the unsubscribe function.
   */
  watch?: (chart: Chart, refresh: () => void) => (() => void) | void;
}

/** What a button shows while it follows the chart; see the button's `content`. */
export interface ToolbarButtonContent {
  /** Visible text beside the icon. */
  text: string;
  /** Smaller, muted text after it, e.g. an exchange. Drops when the toolbar is narrow. */
  detail?: string;
  /** Accessible name. Default the item's `label`. */
  label?: string;
  /** Tooltip. Default the item's `label`. */
  tip?: string;
  /** Keyboard shortcuts in `aria-keyshortcuts` form, e.g. `Control+K /`. */
  keys?: string;
}

/** An entry of the top toolbar: segmented buttons, a button, a dropdown menu, a separator, a spacer or custom content, with the placement fields every item takes. */
export type ToolbarItem = ToolbarItemLayout &
  (
    | (ToolbarItemWatch &
        ToolbarItemText & {
        type: 'segmented';
        id: string;
        label: string;
        options: SegmentOption[];
        value: string;
        onChange: (value: string, chart: Chart) => void;
        /** Toolbar width in px below which the control collapses into a menu. Default 640. */
        collapseBelow?: number;
        /** The value the chart is at now; read on mount and on every refresh. Undefined keeps the current one. */
        currentValue?: (chart: Chart) => string | undefined;
        /** Leave an option out for now; read on mount, on every refresh and when the menu opens. */
        isOptionHidden?: (value: string, chart: Chart) => boolean;
      })
    | (ToolbarItemWatch &
        ToolbarItemText & {
        type: 'button';
        id: string;
        label: string;
        icon?: IconSource;
        /** Show visible text next to the icon. */
        text?: string;
        /**
         * Text, accessible name and tooltip that follow the chart, e.g. the
         * current symbol; replaces `text`. Read on mount and on every refresh.
         * Unlike `text`, it stays visible when the toolbar is narrow; only its
         * `detail` drops.
         */
        content?: (chart: Chart) => ToolbarButtonContent;
        /** Kind of popup the button opens (`aria-haspopup`), e.g. `'dialog'`. */
        popup?: 'dialog' | 'menu';
        onClick: (chart: Chart, el: HTMLButtonElement) => void;
        isActive?: (chart: Chart) => boolean;
        /** Grey the button out, e.g. undo with nothing to undo. Re-read on every refresh. */
        isDisabled?: (chart: Chart) => boolean;
      })
    | (ToolbarItemWatch &
        ToolbarItemText & {
        type: 'menu';
        id: string;
        label: string;
        icon?: IconSource;
        text?: string;
        options: MenuOption[];
        value?: string;
        onSelect: (value: string, chart: Chart) => void;
        /** Make the options independent toggles; returns whether one is on. */
        isChecked?: (value: string, chart: Chart) => boolean;
        /** Leave an option out for now; read each time the menu opens. */
        isOptionHidden?: (value: string, chart: Chart) => boolean;
        /** The value the chart is at now; read on mount and on every refresh. Undefined keeps the current one. */
        currentValue?: (chart: Chart) => string | undefined;
        /** Text on the trigger that follows the chart, e.g. the current mode; replaces `text`. Read on mount and on every refresh. */
        currentText?: (chart: Chart) => string;
      })
    | { type: 'separator'; id?: string }
    | { type: 'spacer'; id?: string }
    | {
        type: 'custom';
        id: string;
        /** Mount into `host`; return a cleanup function if needed. */
        render: (host: HTMLElement, chart: Chart) => void | (() => void);
      }
  );

/** Fields `update` may change. `type` and `id` are fixed; replace the item to change them. */
export type ToolbarItemPatch = Partial<ToolbarItem extends infer T ? (T extends unknown ? Omit<T, 'type' | 'id'> : never) : never>;

/** An app action users can add to their toolbar; its button type is supplied automatically. */
export type ToolbarAction = Omit<Extract<ToolbarItem, { type: 'button' }>, 'type'>;

/** App defaults and optional end-user customization; an item array remains the fixed-toolbar shorthand. */
export interface ToolbarOptions {
  items: ToolbarItem[];
  /**
   * End-user customization, made by `toolbarCustomization({ locked })`: a
   * Customize entry in the "more" menu and on right-click. Off when left out.
   */
  customize?: ToolbarCustomizationPart;
  /** Preference store, under key `toolbar`. Default local storage; null disables persistence. */
  settings?: SettingsAdapter | null;
  /**
   * A divider between neighbouring groups of start-aligned items (`context`,
   * then `analysis`), where no separator item already parts them. Default true.
   */
  dividers?: boolean;
  /** Key in `settings` under which customization saves the layout. Default `'toolbar'`; the shell's bottom bar uses `'bottomBar'`. */
  storageKey?: string;
}

/** A mounted toolbar item and its root element, as `ToolbarHandle.get` returns them. */
export interface ToolbarEntry {
  item: ToolbarItem;
  /** The item's root element; an escape hatch for custom DOM. */
  el: HTMLElement;
}

/** Returned by `createToolbar`: its element and visibility, and reads, adds, changes or removes items by id. */
export interface ToolbarHandle extends Visibility {
  el: HTMLElement;
  readonly items: readonly ToolbarItem[];
  /** Re-evaluate `isActive`, `isDisabled` and `currentValue`. */
  refresh(): void;
  /** Programmatically change a segmented/menu item's value (no callback). */
  setValue(id: string, value: string): void;
  /** Replace every item. */
  setItems(items: ToolbarItem[]): void;
  /** Merge `patch` into an item and re-render only that item. Unknown ids are ignored. */
  update(id: string, patch: ToolbarItemPatch): void;
  /**
   * Insert an item; without a placement it goes after the last item of its group.
   * Placement is a position in the list; the item still renders in its own `align` group.
   */
  add(item: ToolbarItem, placement?: ToolbarPlacement): void;
  remove(id: string): void;
  get(id: string): ToolbarEntry | undefined;
  /** Open the end-user panel; does nothing without the `customize` option. */
  openCustomization(): void;
  /** Register an extra catalog button; returns its remover. Throws without the `customize` option. */
  registerAction(action: ToolbarAction): () => void;
  /** Subscribe to user layout edits (including reset); payload ids are in display order. */
  on(event: 'change', listener: (payload: { ids: string[] }) => void): () => void;
  destroy(): void;
}

const DEFAULT_COLLAPSE_BELOW = 640;

interface Mounted {
  el: HTMLElement;
  refresh?: () => void;
  set?: (value: string) => void;
  /** Click a button, or pick a value of a menu/segmented item, including callbacks. */
  activate?: (value: string) => void;
  /** Adapt to the toolbar width (segmented controls collapse into a menu), or collapse when `compact`. */
  fit?: (width: number, compact: boolean) => void;
  /** Write the item's text again in the chart's language, in place. */
  relabel?: () => void;
  cleanup?: () => void;
}

/**
 * A toolbar of `initial` items in `host`, acting on `chart`; items that do not
 * fit move into a "more" menu by group and priority.
 *
 * @example
 * ```ts
 * import { builtins, createChart } from '@charton/core';
 * import { createToolbar, fullscreen, intervals, screenshot } from '@charton/ui';
 *
 * const chart = createChart(chartEl, { plugins: builtins() });
 * const toolbar = createToolbar(topEl, chart, [intervals(['1m', '1h', '1d']), screenshot(), fullscreen()]);
 * ```
 */
export function createToolbar(host: HTMLElement, chart: Chart, initial: ToolbarItem[] | ToolbarOptions): ToolbarHandle {
  return mountToolbar(host, chart, initial).handle;
}

/**
 * Internal: also returns the visibility control, so the shell can observe changes.
 * `target` may be a function that returns the chart to act on at the time of each
 * action, which lets the chart grid point one toolbar at its active chart.
 */
export function mountToolbar(
  host: HTMLElement,
  target: Chart | (() => Chart),
  initial: ToolbarItem[] | ToolbarOptions,
  customizationHost: HTMLElement = host,
): { handle: ToolbarHandle; visibility: VisibilityControl; customization: ToolbarCustomization | null } {
  const options: ToolbarOptions = Array.isArray(initial) ? { items: initial } : initial;
  let customization: ToolbarCustomization | null = null;
  const chart = typeof target === 'function' ? target : () => target;
  const el = h('div', { class: 'pc-toolbar', role: 'toolbar' });
  const visibility = visibilityOf(el);
  const mounted = new Map<ToolbarItem, Mounted>();
  let items: readonly ToolbarItem[] = [];
  let overflowed = new Set<string>();
  // Refit when the toolbar or an item changes size: new text, a custom item, a later font or layout.
  const observer = new ResizeObserver(() => fit());

  const moreButton = iconButton({ icon: Ellipsis, label: shellText(chart(), 'toolbarMore'), variant: 'ghost', size: 'md' });
  moreButton.setAttribute('aria-haspopup', 'menu');
  const more = h('div', { class: 'pc-menu pc-toolbar-more' }, moreButton);
  more.hidden = true;

  const refresh = () => {
    customization?.sync();
    language.sync();
    // The chart acted on changed (a grid's active cell): its language may differ.
    if (chart() !== labelledFor) relabel();
    mounted.forEach((m) => m.refresh?.());
  };

  /** An item's label in the chart's language. */
  const labelOf = (item: ToolbarItemText & { label: string }) => keyedText(chart(), item.labelKey, item.label, item.labelParams);
  /** Options with their labels in the chart's language. */
  const optionsOf = <T extends MenuOption>(options: readonly T[]): T[] =>
    options.map((o) => ({
      ...o,
      label: keyedText(chart(), o.labelKey, o.label, o.labelParams),
      ...titleOf(o as SegmentOption),
      section: o.sectionKey === undefined ? o.section : keyedText(chart(), o.sectionKey, o.section ?? ''),
    }));
  /** A segment's `title` in the chart's language, when it has one. */
  const titleOf = ({ title, titleKey }: SegmentOption) => (title === undefined ? {} : { title: keyedText(chart(), titleKey, title) });
  /** `isOptionHidden` bound to the chart the toolbar acts on. */
  const hiddenOf = (item: { isOptionHidden?: (value: string, chart: Chart) => boolean }) => {
    const { isOptionHidden } = item;
    return isOptionHidden && ((value: string) => isOptionHidden(value, chart()));
  };

  /**
   * Run an item's `watch` against the chart the toolbar acts on, and again
   * whenever that chart changes, so its subscription never points at an old chart.
   */
  const watcher = (watch: ToolbarItemWatch['watch'], refreshItem: () => void) => {
    let watched: Chart | null = null;
    let off: (() => void) | void;
    const stop = () => {
      off?.();
      off = undefined;
      watched = null;
    };
    const sync = () => {
      const current = chart();
      if (!watch || current === watched) return;
      stop();
      watched = current;
      off = watch(current, refreshItem);
    };
    return { sync, stop };
  };

  // Labels follow the language of the chart the toolbar acts on.
  const language = watcher((current, update) => current.on('localization:change', update), () => relabel());
  /** The chart whose language the labels are in. */
  let labelledFor = chart();

  /** Mounted parts shared by watched items: refresh re-subscribes if needed, then re-reads state. */
  const watched = (item: ToolbarItemWatch, refreshItem: () => void, cleanup?: () => void) => {
    const w = watcher(item.watch, refreshItem);
    const refreshAll = () => {
      w.sync();
      refreshItem();
    };
    refreshAll();
    return {
      refresh: refreshAll,
      cleanup: () => {
        w.stop();
        cleanup?.();
      },
    };
  };

  function mount(item: ToolbarItem): Mounted {
    switch (item.type) {
      case 'separator':
        return { el: h('div', { class: 'pc-sep', role: 'separator' }) };
      case 'spacer':
        return { el: h('div', { class: 'pc-spacer' }) };
      case 'segmented': {
        // Both forms stay mounted; `fit` shows the one that suits the width.
        const select = (value: string) => {
          item.value = value;
          seg.set(value);
          menu.set(value);
        };
        const label = labelOf(item);
        const options = optionsOf(item.options);
        const isHidden = hiddenOf(item);
        const seg = segmentedTabs(options, item.value, (v) => activate(v), label);
        const menu = menuButton({ label, options, value: item.value, onSelect: (v) => activate(v), isHidden });
        const activate = (value: string) => {
          select(value);
          item.onChange(value, chart());
        };
        const wrap = h('div', { class: 'pc-toolbar-slot pc-toolbar-seg' }, seg.el, menu.el);
        const { currentValue } = item;
        const sync = () => {
          if (isHidden) {
            for (const b of seg.el.children as HTMLCollectionOf<HTMLElement>) {
              const value = b.getAttribute('data-value');
              if (value !== null) b.hidden = isHidden(value);
            }
          }
          const value = currentValue?.(chart());
          if (value !== undefined && value !== item.value) select(value);
        };
        return {
          el: wrap,
          set: select,
          activate,
          relabel() {
            const renamed = optionsOf(item.options);
            seg.relabel(labelOf(item), renamed);
            menu.update({ label: labelOf(item), options: renamed });
          },
          ...watched(item, sync, () => {
            seg.destroy();
            menu.destroy();
          }),
          fit(width, compact) {
            const collapsed = compact || width < (item.collapseBelow ?? DEFAULT_COLLAPSE_BELOW);
            seg.el.hidden = collapsed;
            menu.el.hidden = !collapsed;
          },
        };
      }
      case 'menu': {
        const select = (value: string) => {
          item.value = value;
          menu.set(value);
        };
        const activate = (value: string) => {
          select(value);
          const focused = menu.el.contains(document.activeElement);
          item.onSelect(value, chart());
          // `onSelect` remounted this item (`update`): the focused trigger went with it, so focus the new one.
          const next = focused && !mounted.has(item) && item.id !== undefined ? find(item.id) : undefined;
          (next && mounted.get(next)!.el.querySelector<HTMLElement>('.pc-menu-trigger'))?.focus();
        };
        const { isChecked, currentValue, currentText } = item;
        let text = currentText?.(chart()) ?? item.text;
        const menu = menuButton({
          ...item,
          text,
          label: labelOf(item),
          options: optionsOf(item.options),
          onSelect: (v) => activate(v),
          isChecked: isChecked && ((v) => isChecked(v, chart())),
          isHidden: hiddenOf(item),
        });
        const sync = () => {
          const value = currentValue?.(chart());
          if (value !== undefined && value !== item.value) select(value);
          const next = currentText?.(chart());
          // `update` closes an open list, so only when the text changed.
          if (next !== undefined && next !== text) menu.update({ text: (text = next) });
        };
        return {
          el: menu.el,
          set: select,
          activate,
          relabel: () => menu.update({ label: labelOf(item), options: optionsOf(item.options), text: (text = currentText?.(chart()) ?? item.text) }),
          ...watched(item, sync, menu.destroy),
        };
      }
      case 'button': {
        const { content } = item;
        const label = labelOf(item);
        const view = content && contentButton(label, item.icon);
        const b =
          view?.el ??
          (item.text !== undefined
            ? button({ label: item.text, icon: item.icon, title: label, variant: 'ghost' })
            : iconButton({ icon: item.icon ?? [], label, variant: 'ghost', size: 'md' }));
        if (item.popup) b.setAttribute('aria-haspopup', item.popup);
        // Text beside an icon drops before any item overflows.
        if (item.icon && item.text !== undefined && !view) b.lastElementChild?.classList.add('pc-toolbar-text');
        const activate = () => {
          item.onClick(chart(), b);
          refresh();
        };
        b.addEventListener('click', activate);
        const { isActive, isDisabled } = item;
        const sync = () => {
          if (isActive) {
            const on = isActive(chart());
            markActive(b, on);
          }
          if (isDisabled) b.disabled = isDisabled(chart());
          // New text changes the button's width: refit, except on mount, where the layout fits anyway.
          if (view && view.show(content(chart())) && ready) fit();
        };
        const relabelButton = () => {
          const name = labelOf(item);
          if (view) {
            view.rename(name);
            view.show(content(chart()));
            return;
          }
          nameButton(b, name);
        };
        let ready = false;
        const parts = { el: b, activate, relabel: relabelButton, ...watched(item, sync) };
        ready = true;
        return parts;
      }
      case 'custom': {
        const slot = h('div', { class: 'pc-toolbar-slot', 'data-id': item.id });
        const cleanup = item.render(slot, chart());
        return { el: slot, cleanup: () => cleanup?.() };
      }
    }
  }

  const unmount = (m: Mounted) => {
    m.cleanup?.();
    observer.unobserve(m.el);
    m.el.remove();
  };

  /** Show items that are neither hidden nor overflowed, and only separators that sit between items. */
  const applyHidden = () => {
    const order = displayOrder(items);
    const kinds = order.map((item): ToolbarSlotKind => {
      if (item.hidden || (item.id !== undefined && overflowed.has(item.id))) return 'hidden';
      return item.type === 'separator' || item.type === 'spacer' ? item.type : 'item';
    });
    const shown = separatorVisibility(kinds);
    const divided = options.dividers === false ? [] : groupDividers(order, shown);
    // The first *visible* end item carries the auto margin; a hidden one has no box to push with.
    let seenEnd = false;
    order.forEach((item, i) => {
      const itemEl = mounted.get(item)!.el;
      itemEl.hidden = !shown[i];
      itemEl.classList.toggle('pc-toolbar-divided', divided[i] ?? false);
      const pushes = alignOf(item) === 'end' && shown[i]! && !seenEnd;
      itemEl.classList.toggle('pc-toolbar-end', pushes);
      seenEnd ||= pushes;
    });
    // With no end item shown, the "more" button takes the auto margin, so it still sits at the right edge.
    more.classList.toggle('pc-toolbar-end', !seenEnd);
  };

  /** True when the last visible element pokes past the toolbar's content box. */
  const overflowing = () => {
    const visible = [...el.children].filter((c) => !(c as HTMLElement).hidden);
    const last = visible[visible.length - 1];
    if (!last) return false;
    const limit = el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight);
    return last.getBoundingClientRect().right > limit + 0.5;
  };

  const { close: closeMore } = popoverToggle(more, moreButton, () => {
    const panel = h('div', { class: 'pc-popover pc-popover--end', role: 'menu', 'aria-label': moreButton.getAttribute('aria-label') ?? '' });
    for (const item of displayOrder(items)) {
      if (item.id === undefined || !overflowed.has(item.id)) continue;
      const m = mounted.get(item)!;
      const run = (value: string) => {
        closeMore();
        m.activate?.(value);
      };
      if (item.type === 'button') {
        // A content button shows its text and detail; its own accessible name stays the entry's name.
        const content = item.content?.(chart());
        const label = labelOf(item);
        const text = content ? [content.text, content.detail].filter(Boolean).join(' ') : label;
        const entry = popoverItem(text, item.icon, item.isActive?.(chart()) ?? false, 'menuitem');
        if (content) entry.setAttribute('aria-label', content.label ?? label);
        if (item.popup) entry.setAttribute('aria-haspopup', item.popup);
        entry.disabled = item.isDisabled?.(chart()) ?? false;
        entry.addEventListener('click', () => run(''));
        panel.append(entry);
      } else if (item.type === 'menu' || item.type === 'segmented') {
        panel.append(h('div', { class: 'pc-popover-label' }, labelOf(item)));
        const isChecked = item.type === 'menu' ? item.isChecked : undefined;
        let section: string | undefined;
        for (const o of optionsOf<MenuOption>(item.options)) {
          if (item.isOptionHidden?.(o.value, chart())) continue;
          const heading = 'section' in o ? o.section : undefined;
          if (heading !== undefined && heading !== section) panel.append(h('div', { class: 'pc-popover-label' }, heading));
          section = heading;
          const ic = 'icon' in o ? o.icon : undefined;
          const entry = isChecked
            ? popoverItem(o.label, ic, isChecked(o.value, chart()), 'menuitemcheckbox')
            : popoverItem(o.label, ic, o.value === item.value, 'menuitemradio');
          entry.addEventListener('click', () => run(o.value));
          panel.append(entry);
        }
      }
    }
    if (options.customize) {
      const entry = popoverItem(shellText(chart(), 'toolbarCustomize'), undefined, false, 'menuitem');
      entry.addEventListener('click', () => { closeMore(); customization?.open(); });
      panel.append(entry);
    }
    more.append(panel);
    placePopover(panel, moreButton, { alignEnd: true });
    return panel;
  }, undefined, true);

  /** Show every item at full size, or drop text beside icons and collapse segmented controls into menus. */
  const setCompact = (width: number, compact: boolean) => {
    el.classList.toggle('pc-toolbar--icons', compact);
    mounted.forEach((m) => m.fit?.(width, compact));
  };

  /**
   * Make the items fit: first drop labels to icons, then move items into the
   * "more" menu in `overflowOrder` until the rest fit.
   */
  const fit = () => {
    closeMore();
    const width = el.clientWidth;
    // Hidden or detached: nothing to measure. The ResizeObserver refits on show.
    if (width === 0) return;
    setCompact(width, false);
    overflowed = new Set();
    more.hidden = !options.customize;
    applyHidden();
    if (!overflowing()) return;
    setCompact(width, true);
    const candidates = overflowOrder(items);
    if (candidates.length === 0 || !overflowing()) return;
    more.hidden = false;
    for (const id of candidates) {
      overflowed.add(id);
      applyHidden();
      if (!overflowing()) break;
    }
  };

  /** Put elements in display order, moving only misplaced nodes so focus inside the toolbar survives. */
  const layout = () => {
    const order = [...displayOrder(items).map((item) => mounted.get(item)!.el), more];
    order.forEach((itemEl, i) => {
      const at = el.children[i] ?? null;
      if (at !== itemEl) el.insertBefore(itemEl, at);
    });
    fit();
  };

  /** Swap in a new item list, mounting new items and unmounting dropped ones. */
  const apply = (next: readonly ToolbarItem[]) => {
    if (next === items) return;
    const seen = new Set<string>();
    for (const { id } of next) {
      if (id === undefined) continue;
      if (seen.has(id)) throw new Error(`Duplicate toolbar item id "${id}"`);
      seen.add(id);
    }
    // Mount everything new before touching state, so a throwing `render` leaves the toolbar intact.
    const added = new Map<ToolbarItem, Mounted>();
    try {
      for (const item of next) if (!mounted.has(item)) added.set(item, mount(item));
    } catch (error) {
      added.forEach(unmount);
      throw error;
    }
    const keep = new Set(next);
    // Ids on the elements, so app CSS and neighbouring items can find an item.
    added.forEach((m, item) => item.id !== undefined && m.el.setAttribute('data-id', item.id));
    for (const [item, m] of mounted) {
      if (keep.has(item)) continue;
      unmount(m);
      mounted.delete(item);
    }
    added.forEach((m, item) => {
      mounted.set(item, m);
      observer.observe(m.el);
    });
    items = next;
    layout();
  };

  // Own copies, so a shared item object (a reused separator) still gets its own element.
  const copy = (item: ToolbarItem): ToolbarItem => ({ ...item });

  /** Mount every item again in the chart's new language; values and placement stay. */
  /**
   * Write every item's text again in the language of the chart acted on. Items
   * keep their elements, so focus and state stay; custom items are left alone.
   */
  const relabel = () => {
    labelledFor = chart();
    closeMore();
    nameButton(moreButton, shellText(labelledFor, 'toolbarMore'));
    mounted.forEach((m) => m.relabel?.());
    // New text changes widths.
    fit();
  };

  apply(options.items.map(copy));
  language.sync();
  host.append(el);
  observer.observe(el);

  const find = (id: string) => items.find((item) => item.id === id);

  const releaseTips = retainTips();
  const handle: ToolbarHandle = {
    el,
    get items() {
      return items;
    },
    get visible() {
      return visibility.visible;
    },
    setVisible: visibility.setVisible,
    toggle: visibility.toggle,
    refresh,
    setValue(id, value) {
      const item = find(id);
      if (item) mounted.get(item)!.set?.(value);
    },
    setItems: (next) => customization ? customization.setDefaults(next.map(copy)) : apply(next.map(copy)),
    update: (id, patch) => customization ? customization.update(id, patch) : apply(updateItem<ToolbarItem>(items, id, patch)),
    add: (item, placement) => customization ? customization.add(copy(item), placement) : apply(insertItem(items, copy(item), placement)),
    remove: (id) => customization ? customization.remove(id) : apply(removeItem(items, id)),
    get(id) {
      const item = find(id);
      return item && { item, el: mounted.get(item)!.el };
    },
    openCustomization: () => customization?.open(),
    registerAction(action) {
      if (!customization) throw new Error('Toolbar customization is off: pass `customize: toolbarCustomization()` in the toolbar options');
      return customization.registerAction(action);
    },
    on: (_, listener) => customization?.onChange(listener) ?? (() => {}),
    destroy() {
      customization?.destroy();
      releaseTips();
      closeMore();
      language.stop();
      observer.disconnect();
      mounted.forEach(unmount);
      mounted.clear();
      el.remove();
    },
  };
  if (options.customize) {
    customization = options.customize(customizationHost, chart, { ...options, items: items.slice() }, apply);
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); customization?.open(); });
  }
  return { handle, visibility, customization };
}

/**
 * A button whose text follows the chart: icon, text and a muted detail.
 * `show` writes only what changed and returns whether the visible text did;
 * `fallback` is the item's `label`, which `rename` changes.
 */
function contentButton(
  fallback: string,
  source: IconSource | undefined,
): { el: HTMLButtonElement; show(content: ToolbarButtonContent): boolean; rename(label: string): void } {
  const b = h('button', { class: 'pc-btn pc-btn--ghost pc-toolbar-content' });
  const text = h('span', {});
  const detail = h('small', { class: 'pc-toolbar-detail' });
  detail.hidden = true;
  if (source) b.append(icon(source, 15));
  b.append(text, detail);
  const set = (name: string, value: string | undefined) => {
    if (value === undefined) b.removeAttribute(name);
    else if (b.getAttribute(name) !== value) b.setAttribute(name, value);
  };
  const show = (content: ToolbarButtonContent) => {
    const extra = content.detail ?? '';
    const changed = text.textContent !== content.text || detail.textContent !== extra;
    if (changed) {
      text.textContent = content.text;
      detail.textContent = extra;
      detail.hidden = extra === '';
    }
    set('aria-label', content.label ?? fallback);
    set('data-tip', content.tip ?? fallback);
    set('aria-keyshortcuts', content.keys);
    return changed;
  };
  return {
    el: b,
    show,
    rename(label) {
      fallback = label;
    },
  };
}
