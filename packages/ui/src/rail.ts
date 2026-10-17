import { builtinTools, type Chart, type DrawingToolDef } from '@charton/core';
import { ChevronRight, Ellipsis, Eye, EyeOff, Lock, LockOpen, Magnet, Redo2, Star, Trash2, Undo2 } from 'lucide';
import { iconButton, overflowMore, popoverItem, type OverflowMore } from './controls';
import { crosshairIcon, drawingIcon, drawingIcons, groupFaces, groupIcons, pointerCursorIcon } from './icons';
import { buttonsIn, h, markActive, icon, nameButton, placePopover, popoverToggle, visibilityOf, type IconSource, type Visibility, type VisibilityControl } from './dom';
import type { FavoritesController } from './favorites';
import { viewportHeight } from './listbox';
import { defaultShellMessages, keyedText, keyOf, labelOf, shellText, type ShellMessageKey } from './messages';
import { ariaShortcut, shortcutText } from './shortcuts';
import { retainTips } from './tooltip';

/** A drawing tool on the tool rail, by its registered type, with an optional label and icon over the tool's own. */
export interface RailTool {
  tool: string;
  label?: string;
  icon?: IconSource;
}

/**
 * Text that follows the chart's language: with `labelKey`, the rail shows that
 * message key's text (see the `localization` option) and `label` when the
 * language has none. The default items set one from `defaultShellMessages`.
 */
export interface RailItemText {
  labelKey?: ShellMessageKey | (string & {});
}

/** An entry of the tool rail: the cursor, a drawing tool, a flyout group of tools, an on/off toggle, an action button, the favourites bar toggle, a separator or a spacer. */
export type RailItem =
  | ({ type: 'cursor'; label?: string; icon?: IconSource } & RailItemText)
  | ({ type: 'tool' } & RailTool)
  | ({ type: 'group'; label: string; tools: RailTool[] } & RailItemText)
  | ({
      type: 'toggle';
      id: string;
      label: string;
      icon: IconSource;
      iconOn?: IconSource;
      get: (chart: Chart) => boolean;
      set: (chart: Chart, value: boolean) => void;
    } & RailItemText)
  | ({
      type: 'action';
      id: string;
      label: string;
      icon: IconSource;
      onClick: (chart: Chart) => void;
      /** Disables the button while false; re-checked on tool and history changes. */
      enabled?: (chart: Chart) => boolean;
      /** Shows a destructive action, e.g. remove all drawings, in the danger colour. */
      danger?: boolean;
    } & RailItemText)
  /**
   * Shows or hides the shell's favourites bar. Left out when the rail has no
   * favourites (a shell without the `favorites` part, or `createToolRail`).
   */
  | ({ type: 'favorites'; label?: string; icon?: IconSource } & RailItemText)
  | { type: 'separator' }
  | { type: 'spacer' };

/** Default icons for the built-in drawing tools. */
export const toolIcons: Record<string, IconSource> = { ...drawingIcons };

/** The built-in tool groups, in the catalogue's order (see `builtinTools`); message `railGroup<Id>` labels each on the rail. */
const GROUPS = Object.keys(groupFaces);

/** Rail labels for the built-in tool groups, in English; other groups use their id. The rail shows them in the chart's language. */
export const groupLabels: Record<string, string> = Object.fromEntries(GROUPS.map((group) => [group, defaultShellMessages[keyOf('railGroup', group)]]));

/**
 * Sections of the built-in groups' flyouts, each titled by message
 * `railSection<Id>`. A section holds the tools that draw the same kind of
 * thing: lines along an axis or along the move, text, shapes, arrows,
 * freehand marks, channels, pitchforks, a ratio family (Fibonacci, Gann), cycles,
 * patterns, waves, ranges, positions, projections and volume. Sections start
 * with the one holding the group's face, then go from simple to complex as the
 * groups do (see `builtinTools`). Tools keep their catalogue order within a
 * section; tools in none, such as a plugin's, follow in an untitled section.
 * Internal (the rail reads it); exported for tests.
 */
export const groupSections: Record<string, Record<string, readonly string[]>> = {
  lines: {
    trend: ['extended-line', 'ray', 'trend-angle', 'trendline', 'info-line'],
    level: ['cross-line', 'hline', 'horizontal-ray', 'vline'],
  },
  annotate: {
    text: ['anchored-note', 'anchored-text', 'balloon', 'comment', 'flag', 'note', 'price-label', 'signpost', 'text', 'callout', 'price-note'],
    shapes: ['circle', 'ellipse', 'rectangle', 'arc', 'curve', 'double-curve', 'rotated-rectangle', 'triangle'],
    arrows: ['arrow-down', 'arrow-left', 'arrow-right', 'arrow-up', 'arrow', 'arrow-marker'],
    freehand: ['brush', 'highlighter', 'path', 'polyline'],
  },
  parallels: {
    channels: ['regression-trend', 'disjoint-channel', 'fib-channel', 'flat-top-bottom', 'parallel-channel'],
    pitchforks: ['inside-pitchfork', 'modified-schiff-pitchfork', 'pitchfan', 'pitchfork', 'schiff-pitchfork'],
  },
  ratios: {
    fib: ['fib-arcs', 'fib-circles', 'fib-retracement', 'fib-speed-fan', 'fib-spiral', 'fib-wedge', 'fib-extension'],
    gann: ['gann-box', 'gann-fan', 'gann-square', 'gann-square-fixed'],
  },
  time: {
    cycles: ['cyclic-lines', 'sine-line', 'time-cycles'],
    fib: ['fib-time-zone', 'fib-time'],
  },
  patterns: {
    patterns: ['abcd', 'triangle-pattern', 'cypher', 'xabcd', 'head-shoulders', 'three-drives'],
    waves: ['elliott-correction', 'elliott-double-combo', 'elliott-triangle', 'elliott-triple-combo', 'elliott-impulse'],
  },
  measure: {
    ranges: ['date-price-range', 'date-range', 'measure', 'price-range'],
    positions: ['long-position', 'short-position'],
    projections: ['forecast', 'projection', 'bars-pattern'],
    volume: ['anchored-vwap', 'fixed-range-volume-profile'],
  },
};

/**
 * Flyout delay, in ms: a pause on a group long enough to tell resting from
 * passing over it opens its menu, and the same pause after leaving closes it
 * (time to cross the gap to the menu).
 */
const HOVER_MS = 300;

/** A flyout with more rows (tools and section titles) than this flows its sections into columns, up to `FLYOUT_COLUMNS`. */
const FLYOUT_ROWS = 12;
const FLYOUT_COLUMNS = 3;

/** `tools` of `group` split into its sections (`groupSections`), in order, skipping empty ones; tools in none come last, untitled. */
export function railSections(group: string | undefined, tools: readonly RailTool[]): { id?: string; tools: RailTool[] }[] {
  const table = Object.entries((group !== undefined && groupSections[group]) || {});
  const sections: { id?: string; tools: RailTool[] }[] = table.map(([id, members]) => ({ id, tools: tools.filter((t) => members.includes(t.tool)) }));
  sections.push({ tools: tools.filter((t) => !table.some(([, members]) => members.includes(t.tool))) });
  return sections.filter((s) => s.tools.length > 0);
}

/**
 * Rail entries for drawing tools: one flyout per `group` (in order of first
 * appearance), single tools as plain buttons.
 */
export function toolRailItems(tools: readonly DrawingToolDef[]): RailItem[] {
  const items: RailItem[] = [];
  const groups = new Map<string, RailTool[]>();
  for (const tool of tools) {
    if (!tool.group) {
      items.push({ type: 'tool', tool: tool.type });
      continue;
    }
    let members = groups.get(tool.group);
    if (!members) {
      members = [];
      groups.set(tool.group, members);
      items.push({ type: 'group', label: groupLabels[tool.group] ?? tool.group, tools: members });
    }
    members.push({ tool: tool.type });
  }
  // A group with one tool is just a button.
  return allowedItems(items, () => true);
}

/**
 * The default tool rail: the cursor, `tools` (the built-in drawing tools by default) grouped into flyouts, the favourites toggle,
 * magnet, lock and hide toggles, then undo, redo and remove all drawings at the bottom.
 */
export function defaultRailItems(tools: readonly DrawingToolDef[] = builtinTools): RailItem[] {
  return [
    { type: 'cursor' },
    ...toolRailItems(tools),
    { type: 'separator' },
    { type: 'favorites' },
    {
      type: 'toggle',
      id: 'magnet',
      ...labelOf('railMagnet'),
      icon: Magnet,
      get: (c) => c.drawings.magnet,
      set: (c, v) => c.drawings.setMagnet(v),
    },
    {
      type: 'toggle',
      id: 'lock',
      ...labelOf('railLock'),
      icon: LockOpen,
      iconOn: Lock,
      get: (c) => c.drawings.locked,
      set: (c, v) => c.drawings.setLocked(v),
    },
    {
      type: 'toggle',
      id: 'hide',
      ...labelOf('railHide'),
      icon: Eye,
      iconOn: EyeOff,
      get: (c) => c.drawings.hidden,
      set: (c, v) => c.drawings.setHidden(v),
    },
    { type: 'spacer' },
    {
      type: 'action',
      id: 'undo',
      ...labelOf('historyUndo'),
      icon: Undo2,
      onClick: (c) => c.history.undo(),
      enabled: (c) => c.history.canUndo,
    },
    {
      type: 'action',
      id: 'redo',
      ...labelOf('historyRedo'),
      icon: Redo2,
      onClick: (c) => c.history.redo(),
      enabled: (c) => c.history.canRedo,
    },
    {
      type: 'action',
      id: 'clear',
      ...labelOf('railClear'),
      icon: Trash2,
      onClick: (c) => c.drawings.clear(),
      danger: true,
    },
  ];
}

/** Returned by `createToolRail`: the rail's element, its visibility, `refresh` to update the buttons' states, `setItems` and `destroy`. */
export interface ToolRailHandle extends Visibility {
  el: HTMLElement;
  refresh(): void;
  /** Replace every item, e.g. when tool access or favourites change. */
  setItems(items: RailItem[]): void;
  destroy(): void;
}

/** A vertical rail of drawing tools and drawing actions for `chart`, in `host`; `items` defaults to `defaultRailItems()` of the chart's tools. */
export function createToolRail(host: HTMLElement, chart: Chart, items: RailItem[] = defaultRailItems(chart.drawings.getTools())): ToolRailHandle {
  return mountToolRail(host, chart, items).handle;
}

/** Label of drawing tool `type` in the chart's language (see `chart.drawings.toolLabel`). */
export function toolLabelOf(chart: Chart, type: string): string {
  return chart.drawings.toolLabel(type);
}

/** Icon of drawing tool `type`: from `toolIcons`, else its group's, else a generic one. */
export function toolIconOf(chart: Chart, type: string): IconSource {
  const group = chart.drawings.getTools().find((d) => d.type === type)?.group;
  return toolIcons[type] ?? (group ? groupIcons[group] : undefined) ?? drawingIcon;
}

/**
 * Internal: also returns the visibility control, so the shell can observe changes.
 * With `favorites`, flyout entries get a star and a `favorites` item toggles the bar.
 */
export function mountToolRail(
  host: HTMLElement,
  chart: Chart,
  items: RailItem[],
  favorites: FavoritesController | null = null,
): { handle: ToolRailHandle; visibility: VisibilityControl } {
  // A toolbar, not a nav: its buttons arm tools and take arrow keys. The compact layout turns it horizontal.
  const el = h('div', { class: 'pc-rail', role: 'toolbar', 'aria-orientation': 'vertical', 'aria-label': shellText(chart, 'railLabel') });
  const visibility = visibilityOf(el);
  const refreshers: (() => void)[] = [];
  const closers: (() => void)[] = [];
  // A group menu left open would reappear when the rail is shown again.
  visibility.onChange(() => closers.forEach((close) => close()));
  const labelOf = (t: RailTool) => t.label ?? toolLabelOf(chart, t.tool);
  const iconOf = (t: RailTool) => t.icon ?? toolIconOf(chart, t.tool);
  /** An item's label in the chart's language. */
  const textOf = (item: RailItemText & { label: string }) => keyedText(chart, item.labelKey, item.label);
  /** A group's label in the chart's language; a built-in group's English label (`groupLabels`) needs no `labelKey`. */
  const groupTextOf = (item: Extract<RailItem, { type: 'group' }>) => {
    if (item.labelKey !== undefined) return textOf(item);
    const group = chart.drawings.getTools().find((d) => d.type === item.tools[0]?.tool)?.group;
    return group !== undefined && GROUPS.includes(group) && groupLabels[group] === item.label ? shellText(chart, keyOf('railGroup', group)) : item.label;
  };
  const paired = doublePress();
  /** Tooltip updaters of the tool buttons, rerun when shortcuts change. */
  const tips: (() => void)[] = [];
  /** A rail button for the tool `get()` returns: a click arms it, a double-click, double-tap or Shift+Enter keeps it. */
  const toolButton = (get: () => RailTool) => {
    const b = flat(iconOf(get()), labelOf(get()));
    const tip = () => showToolTip(chart, b, labelOf(get()), get().tool);
    tip();
    tips.push(tip);
    onToolPress(b, (keep) => pressTool(chart, get().tool, keep), (e) => paired(get().tool, e));
    return b;
  };

  /**
   * The flyout of the group in `wrap`, named `name`, with the menu `fill` builds.
   * A mouse resting on the group for `HOVER_MS` opens it and leaving it as long
   * closes it; a tap on touch or a right-click opens it until a
   * press outside. The returned `more` button, shown only while
   * it has keyboard focus, is the keyboard's way in. `fill` returns how many rows
   * it added, entries and titles: a long menu flows into columns beside a vertical rail.
   */
  const flyout = (wrap: HTMLElement, name: string, fill: (menu: HTMLElement) => number, onClose?: () => void) => {
    const more = h('button', {
      class: 'pc-rail-more',
      'aria-label': shellText(chart, 'railMoreGroup', { group: name.toLowerCase(), name }),
      'aria-haspopup': 'menu',
    });
    more.append(icon(ChevronRight, 8));
    /** Opened by hovering, so leaving closes it. */
    let hovered = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { open, close } = popoverToggle(
      wrap,
      more,
      () => {
        // A horizontal rail (the shell's bottom sheet) opens its menus upwards, kept on screen.
        const horizontal = el.dataset.orientation === 'horizontal';
        const menu = h('div', { class: `pc-popover ${horizontal ? 'pc-popover--up' : 'pc-popover--right'}`, role: 'menu', 'aria-label': name });
        const rows = fill(menu);
        let columns = horizontal ? 1 : Math.min(FLYOUT_COLUMNS, Math.ceil(rows / FLYOUT_ROWS));
        wrap.append(menu);
        // Columns that would cross the window's end drop one at a time.
        const width = document.documentElement?.clientWidth ?? 0;
        for (; columns > 1; columns--) {
          menu.classList.add('pc-rail-flyout--columns');
          menu.style.setProperty('--pc-rail-columns', String(columns));
          if (!width || menu.getBoundingClientRect().right <= width - 8) break;
        }
        if (columns === 1) menu.classList.remove('pc-rail-flyout--columns');
        if (horizontal) placePopover(menu, wrap, { up: true });
        else fitBeside(menu);
        // The group's button hides its tooltip while the menu is open over it.
        wrap.firstElementChild?.setAttribute('aria-expanded', 'true');
        return menu;
      },
      () => {
        wrap.firstElementChild?.removeAttribute('aria-expanded');
        hovered = false;
        clearTimeout(timer);
        onClose?.();
      },
    );
    const isOpen = () => more.getAttribute('aria-expanded') === 'true';
    // The menu is inside `wrap`, so moving from the button to the menu stays "in".
    const hover = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(timer);
      if (e.type === 'pointerenter') timer = setTimeout(() => isOpen() || ((hovered = true), open()), HOVER_MS);
      else if (hovered) timer = setTimeout(close, HOVER_MS);
    };
    wrap.addEventListener('pointerenter', hover);
    wrap.addEventListener('pointerleave', hover);
    let touch = false;
    wrap.addEventListener('pointerdown', (e) => {
      touch = e.pointerType !== 'mouse';
      // Pressing the group's button with a mouse arms its tool: no menu for that hover.
      if (!touch) clearTimeout(timer);
    });
    // Without hover, a tap on the group's button opens its menu; an entry arms the tool.
    wrap.addEventListener(
      'click',
      (e) => {
        // `detail` 0 is Enter or Space, which arm the tool as usual.
        if (!touch || !e.detail || !wrap.firstElementChild?.contains(e.target as Node)) return;
        e.stopPropagation();
        (isOpen() ? close : open)();
      },
      true,
    );
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      open();
    });
    closers.push(close);
    return { more, close };
  };

  const setActive = (b: HTMLElement, on: boolean, kept = false) => {
    markActive(b, on);
    markKept(chart, b, on && kept);
  };

  let railItems: RailItem[] = items;
  /** The "more" button that holds the buttons a short rail has no room for. */
  let more: OverflowMore | undefined;
  /**
   * Rebuild every button from `list`, closing any open group menu first.
   * Tools `setAccess` denies are left out, or shown disabled with
   * `access.refused: 'disable'`.
   */
  const build = (all: RailItem[]) => {
    railItems = all;
    const disable = chart.options.access.refused === 'disable';
    const list = disable ? all : allowedItems(all, (tool) => chart.drawings.isToolAllowed(tool));
    closers.forEach((close) => close());
    closers.length = 0;
    refreshers.length = 0;
    tips.length = 0;
    more?.stop();
    // Drops the buttons of the previous build, including those in the "more" popover.
    more = overflowMore(el, flat(Ellipsis, shellText(chart, 'toolbarMore')), 'pc-rail-group', 'pc-popover--right pc-rail-overflow', true);
    el.replaceChildren();
    el.setAttribute('aria-label', shellText(chart, 'railLabel'));
    for (const item of list) {
      switch (item.type) {
        case 'separator':
          el.append(h('div', { class: 'pc-rail-sep', role: 'separator' }));
          break;
        case 'spacer':
          el.append(h('div', { class: 'pc-spacer' }));
          break;
        case 'cursor': {
          // With or without the crosshair lines, the one thing the choice changes; the button shows the chosen one.
          const cursors = [
            { id: 'cross', label: keyedText(chart, item.labelKey, item.label ?? shellText(chart, 'railCursor')), icon: item.icon ?? crosshairIcon },
            { id: 'pointer', label: shellText(chart, 'railCursorPointer'), icon: pointerCursorIcon },
          ] as const;
          const chosen = () => cursors.find((c) => c.id === chart.options.crosshair.cursor) ?? cursors[0];
          const wrap = h('div', { class: 'pc-rail-group' });
          const main = flat(chosen().icon, chosen().label, () => chart.drawings.setTool(null));
          const { more, close } = flyout(wrap, shellText(chart, 'railGroupCursors'), (menu) => {
            for (const c of cursors) {
              const entry = choiceEntry(c.label, c.icon, c === chosen());
              entry.addEventListener('click', () => {
                close();
                chart.applyOptions({ crosshair: { cursor: c.id } });
                chart.drawings.setTool(null);
                refresh();
              });
              menu.append(entry);
            }
            return cursors.length;
          });
          refreshers.push(() => {
            const c = chosen();
            main.replaceChildren(icon(c.icon, 20));
            nameButton(main, c.label);
            setActive(main, chart.drawings.tool === null);
          });
          wrap.append(main, more);
          el.append(wrap);
          break;
        }
        case 'tool': {
          const b = toolButton(() => item);
          markBlocked(b, !chart.drawings.isToolAllowed(item.tool));
          refreshers.push(() => setActive(b, chart.drawings.tool === item.tool, chart.drawings.toolKept));
          el.append(b);
          break;
        }
        case 'group': {
          const first = item.tools[0];
          if (!first) break;
          const group = chart.drawings.getTools().find((d) => d.type === first.tool)?.group;
          let current = item.tools.find((t) => group !== undefined && t.tool === groupFaces[group]) ?? first;
          const wrap = h('div', { class: 'pc-rail-group' });
          const main = toolButton(() => current);
          /** Show `t` on the group's button. */
          const showTool = (t: RailTool) => {
            current = t;
            main.replaceChildren(icon(iconOf(t), 18));
            main.setAttribute('aria-label', labelOf(t));
            showToolTip(chart, main, labelOf(t), t.tool);
          };
          let closeTimer: ReturnType<typeof setTimeout> | undefined;
          const { more, close } = flyout(
            wrap,
            groupTextOf(item),
            (menu) => {
              const sections = railSections(group, item.tools);
              for (const section of sections) {
                const box = h('div', { class: 'pc-rail-section', role: 'group' });
                if (section.id !== undefined) {
                  const title = shellText(chart, keyOf('railSection', section.id));
                  box.setAttribute('aria-label', title);
                  box.append(h('div', { class: 'pc-popover-label', 'aria-hidden': 'true' }, title));
                }
                menu.append(box);
                for (const t of section.tools) {
                  const entry = choiceEntry(labelOf(t), iconOf(t), t.tool === current.tool);
                  markKept(chart, entry, chart.drawings.tool === t.tool && chart.drawings.toolKept);
                  const blocked = !chart.drawings.isToolAllowed(t.tool);
                  markBlocked(entry, blocked);
                  onToolPress(
                    entry,
                    (keep, e) => {
                      if (blocked) {
                        close();
                        return requestBlockedTool(chart, t.tool);
                      }
                      showTool(t);
                      // After a click the menu stays a moment, so the second click of a
                      // double-click lands on this entry rather than on the chart.
                      if (keep || !(e as MouseEvent).detail) close();
                      else {
                        clearTimeout(closeTimer);
                        closeTimer = setTimeout(close, DOUBLE_PRESS_MS);
                      }
                      chart.drawings.setTool(t.tool, { keep });
                    },
                    (e) => paired(t.tool, e),
                  );
                  if (favorites) {
                    const row = h('div', { class: 'pc-popover-row', role: 'none' });
                    row.append(entry, starButton(chart, favorites, t.tool, labelOf(t)));
                    box.append(row);
                  } else {
                    box.append(entry);
                  }
                }
              }
              return item.tools.length + sections.filter((section) => section.id !== undefined).length;
            },
            () => clearTimeout(closeTimer),
          );
          refreshers.push(() => {
            const active = item.tools.find((t) => t.tool === chart.drawings.tool);
            if (active && active !== current) showTool(active);
            setActive(main, Boolean(active), chart.drawings.toolKept);
            markBlocked(main, !chart.drawings.isToolAllowed(current.tool));
          });
          wrap.append(main, more);
          el.append(wrap);
          break;
        }
        case 'toggle': {
          const b = flat(item.icon, textOf(item), () => {
            item.set(chart, !item.get(chart));
            refresh();
          });
          refreshers.push(() => {
            const on = item.get(chart);
            setActive(b, on);
            if (item.iconOn) b.replaceChildren(icon(on ? item.iconOn : item.icon, 18));
          });
          el.append(b);
          break;
        }
        case 'favorites': {
          if (!favorites) break;
          const label = keyedText(chart, item.labelKey, item.label ?? shellText(chart, 'railFavoritesBar'));
          const b = flat(item.icon ?? Star, label, () => favorites.bar.toggle());
          refreshers.push(() => setActive(b, favorites.bar.visible));
          el.append(b);
          break;
        }
        case 'action': {
          const b = flat(item.icon, textOf(item), () => item.onClick(chart));
          if (item.danger) b.classList.add('pc-danger');
          const { enabled } = item;
          if (enabled) refreshers.push(() => (b.disabled = !enabled(chart)));
          el.append(b);
          break;
        }
      }
    }
    more.fit();
    refresh();
  };

  const refresh = () => {
    refreshers.forEach((r) => r());
    more?.sync();
  };
  /** Rebuild the same items, e.g. in a new language, keeping focus on the button at the same place. */
  function rebuildInPlace(): void {
    const active = document.activeElement;
    const at = active && el.contains(active) ? buttonsIn(el).indexOf(active as HTMLElement) : -1;
    build(railItems);
    if (at >= 0) buttonsIn(el)[at]?.focus();
  }
  const unsubscribe = [
    chart.on('tool:change', refresh),
    chart.on('history:change', refresh),
    chart.on('access:change', () => build(railItems)),
    // Tooltips and descriptions come from the chart's language.
    chart.on('localization:change', rebuildInPlace),
    chart.actions.on('actions:change', () => tips.forEach((tip) => tip())),
    favorites?.onUpdate(refresh) ?? (() => {}),
  ];
  build(items);
  host.append(el);

  const releaseTips = retainTips();
  const handle: ToolRailHandle = {
    el,
    get visible() {
      return visibility.visible;
    },
    setVisible: visibility.setVisible,
    toggle: visibility.toggle,
    refresh,
    setItems: build,
    destroy() {
      releaseTips();
      closers.forEach((close) => close());
      more?.stop();
      unsubscribe.forEach((off) => off());
      el.remove();
    },
  };
  return { handle, visibility };
}

/**
 * Show a button as blocked (`access.refused: 'disable'`): dimmed and
 * `aria-disabled`, but still pressable, so a press reaches the app's
 * `tool:refuse` listener.
 */
export function markBlocked(b: HTMLElement, blocked: boolean): void {
  b.classList.toggle('is-blocked', blocked);
  if (blocked) b.setAttribute('aria-disabled', 'true');
  else b.removeAttribute('aria-disabled');
}

/** Longest gap, in ms, between the two presses of a double-click or double-tap on a tool. */
export const DOUBLE_PRESS_MS = 400;

/**
 * Tells the second press of a double-click or double-tap on a tool from a
 * single press. Mouse double-clicks are counted by the browser (`detail`);
 * taps, which some browsers count only as single clicks, pair when the same
 * tool is pressed again within `DOUBLE_PRESS_MS`. Keyboard presses
 * (`detail` 0) never pair.
 */
export function doublePress(): (tool: string, e: MouseEvent) => boolean {
  let last: { tool: string; time: number } | null = null;
  return (tool, e) => {
    if (!e.detail) {
      last = null;
      return false;
    }
    const double = e.detail >= 2 || (last?.tool === tool && e.timeStamp - last.time <= DOUBLE_PRESS_MS);
    last = double ? null : { tool, time: e.timeStamp };
    return double;
  };
}

/**
 * Wire a tool button: `press(keep)` on a click, with `keep` when `paired`
 * says it completes a double-click or double-tap, and on Shift+Enter, the
 * keyboard way to keep a tool.
 */
export function onToolPress(b: HTMLElement, press: (keep: boolean, e: Event) => void, paired: (e: MouseEvent) => boolean): void {
  b.addEventListener('click', (e) => press(paired(e), e));
  b.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    press(true, e);
  });
}

/**
 * Keep a flyout opened beside the vertical rail on screen: a long group
 * scrolls within the window's height, and
 * one opened low on the rail moves up until its end fits, 8 px from the edge.
 * Internal; exported for tests.
 */
export function fitBeside(menu: HTMLElement): void {
  const height = viewportHeight();
  if (!height) return;
  if (menu.offsetHeight > height - 16) {
    menu.style.maxHeight = `${height - 16}px`;
    menu.style.overflowY = 'auto';
  }
  const below = menu.getBoundingClientRect().bottom - (height - 8);
  if (below > 0) menu.style.top = `${-below}px`;
}

/** Arm `tool` from a button: kept with `keep`; a plain press on the active tool goes back to the cursor. */
export function pressTool(chart: Chart, tool: string, keep: boolean): void {
  if (!chart.drawings.isToolAllowed(tool)) return requestBlockedTool(chart, tool);
  if (keep) chart.drawings.setTool(tool, { keep: true });
  else chart.drawings.setTool(chart.drawings.tool === tool ? null : tool);
}

/** Show a tool button as kept (`drawings.toolKept`): a badge, and a description for assistive tech. */
export function markKept(chart: Chart, b: HTMLElement, kept: boolean): void {
  if (kept) {
    b.setAttribute('data-kept', '');
    b.setAttribute('aria-description', shellText(chart, 'toolKept'));
  } else {
    b.removeAttribute('data-kept');
    b.removeAttribute('aria-description');
  }
}

/**
 * Set a tool button's tooltip and `aria-keyshortcuts` from the tool's `draw-<tool>` action. The
 * tooltip is the label, the action's first shortcut when it has one, and the double-click hint.
 */
export function showToolTip(chart: Chart, b: HTMLElement, label: string, tool: string): void {
  const keys = chart.actions.keys(`draw-${tool}`);
  b.setAttribute('data-tip', shellText(chart, 'toolKeepHint', { tool: keys[0] ? `${label} (${shortcutText(keys[0])})` : label }));
  if (keys.length > 0) b.setAttribute('aria-keyshortcuts', keys.map(ariaShortcut).join(' '));
  else b.removeAttribute('aria-keyshortcuts');
}

/** Ask for a tool `setAccess` denies: the chart refuses it and fires `tool:refuse`, which the app handles. */
export function requestBlockedTool(chart: Chart, tool: string): void {
  try {
    chart.drawings.setTool(tool);
  } catch {
    // Refused as expected; `tool:refuse` already told the app.
  }
}

/** Items without denied tools; a group left with one tool becomes a button, with none it is dropped. */
export function allowedItems(items: RailItem[], allowed: (tool: string) => boolean): RailItem[] {
  return items.flatMap((item): RailItem[] => {
    if (item.type === 'tool') return allowed(item.tool) ? [item] : [];
    if (item.type !== 'group') return [item];
    const tools = item.tools.filter((t) => allowed(t.tool));
    if (tools.length === 1) return [{ type: 'tool', ...tools[0]! }];
    return tools.length > 0 ? [{ ...item, tools }] : [];
  });
}

/** Star beside a flyout entry: adds the tool to the favourites, or removes it. Leaves the flyout open. */
function starButton(chart: Chart, favorites: FavoritesController, tool: string, label: string): HTMLButtonElement {
  const b = h('button', { class: 'pc-favorite-star', role: 'menuitemcheckbox' });
  const sync = () => {
    const on = favorites.has(tool);
    const text = shellText(chart, on ? 'favoriteRemove' : 'favoriteAdd', { tool: label });
    b.setAttribute('aria-checked', String(on));
    nameButton(b, text);
    b.setAttribute('data-tip-side', 'right');
    const star = icon(Star, 14);
    if (on) star.setAttribute('fill', 'currentColor');
    b.replaceChildren(star);
  };
  b.addEventListener('click', () => {
    if (favorites.has(tool)) favorites.remove(tool);
    else favorites.add(tool);
    sync();
  });
  sync();
  return b;
}

function flat(source: IconSource, label: string, onClick?: () => void): HTMLButtonElement {
  return iconButton({ icon: source, label, variant: 'flat', size: 'lg', tip: 'right', onClick });
}

/**
 * A flyout entry, one choice of several (`menuitemradio`): `on` for the one the rail button
 * shows. The highlight marks it; tool icons leave no room for a radio dot.
 */
function choiceEntry(label: string, source: IconSource, on: boolean): HTMLButtonElement {
  const entry = popoverItem(label, source, on, 'menuitem');
  entry.setAttribute('role', 'menuitemradio');
  entry.setAttribute('aria-checked', String(on));
  return entry;
}
