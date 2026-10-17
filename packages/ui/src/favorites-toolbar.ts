/**
 * Toolbar presets for favourites: buttons for the starred entries of a kind
 * (intervals, chart styles) beside a menu of all of them with a star each.
 * They read the favourites of the shell holding the chart (`favoritesOf`).
 */
import { ERRORS_DOCS_URL, isActivityInterval, type Chart, type Interval } from '@charton/core';
import { ChevronDown, Star } from 'lucide';
import { iconButton, popoverItem, type MenuOption } from './controls';
import { h, icon, markActive, placePopover, popoverToggle } from './dom';
import { favoritesOf, type FavoritesList } from './favorites';
import { keyedText, shellText, type ShellMessageKey } from './messages';
import { bindTip } from './tooltip';
import {
  chartStyles,
  intervalOption,
  stylePicker,
  switchInterval,
  type ChartStyleOption,
  type IntervalsPresetOptions,
  type ToolbarCustomItem,
} from './toolbar-presets';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** What a favourites strip shows and does: the kind, its entries, the current one and how to pick one. */
interface StripSpec {
  id: string;
  kind: string;
  /** Message key of the strip's accessible name and the menu's label. */
  labelKey: ShellMessageKey;
  label?: string;
  options: readonly MenuOption[];
  /** Buttons show the entry's icon instead of its text. */
  icons?: boolean;
  current(chart: Chart): string | undefined;
  select(value: string, chart: Chart): void;
  hidden?(value: string, chart: Chart): boolean;
  /** Entry shown for a starred reference that is not among `options`, such as a renamed one. */
  fallback?: string;
  /** Subscribe to chart changes that move the current entry; returns an unsubscribe function. */
  watch(chart: Chart, refresh: () => void): () => void;
}

/**
 * Interval switcher showing the starred intervals as buttons, plus a menu of
 * all of `list` with a star each (kind `interval` of the shell's favourites).
 * Without the shell's `favorites` part every interval is a button, as in
 * `intervals`. Takes the options of `intervals` except `display`.
 */
export function favoriteIntervals(list: readonly Interval[], options: Omit<IntervalsPresetOptions, 'display'> = {}): ToolbarCustomItem {
  const onChange = options.onChange ?? switchInterval;
  return strip({
    id: options.id ?? 'interval',
    kind: 'interval',
    labelKey: 'toolbarInterval',
    label: options.label,
    options: list.map((interval) => intervalOption(interval, options.format)),
    current: (chart) => chart.data?.requested?.interval ?? options.value ?? list[0],
    select: (value, chart) => onChange(value as Interval, chart),
    hidden: (value, chart) => isActivityInterval(value) && !!chart.data && !chart.data.supportedIntervals?.includes(value as Interval),
    watch: (chart, refresh) => {
      const offs = [chart.on('interval:change', refresh), chart.on('data:loaded', refresh)];
      return () => offs.forEach((off) => off());
    },
  });
}

/**
 * Chart type switcher showing the starred styles as icon buttons, plus a menu
 * of all of `styles` with a star each (kind `chart-style` of the shell's
 * favourites). Without the shell's `favorites` part every style is a button.
 */
export function favoriteChartStyles(styles: readonly ChartStyleOption[] = chartStyles): ToolbarCustomItem {
  const pick = stylePicker(styles);
  return strip({
    id: 'style',
    kind: 'chart-style',
    labelKey: 'toolbarChartType',
    options: styles,
    icons: true,
    // A style starred under an id this version does not have, such as `hlcArea` before its rename to
    // `rangeBand` (#861), shows as the default candles.
    fallback: 'candles',
    current: (chart) => pick.current(chart) ?? pick.initial,
    select: pick.select,
    watch: (chart, refresh) => chart.on('series:options', ({ series }) => series === chart.main && refresh()),
  });
}

function strip(spec: StripSpec): ToolbarCustomItem {
  return {
    type: 'custom',
    id: spec.id,
    group: 'context',
    render(host, chart) {
      const list = favoritesOf(chart)?.of(spec.kind) ?? null;
      const label = () => spec.label ?? shellText(chart, spec.labelKey);
      /** Options in the chart's language, without those hidden for now. */
      const options = () =>
        spec.options
          .filter((o) => !spec.hidden?.(o.value, chart))
          .map((o) => ({
            ...o,
            label: keyedText(chart, o.labelKey, o.label, o.labelParams),
            section: o.sectionKey === undefined ? o.section : keyedText(chart, o.sectionKey, o.section ?? ''),
          }));
      const buttons = h('div', { class: 'pc-favorite-strip', role: 'group' });
      const menu = list ? starMenu(chart, list, label, options, () => spec.current(chart), (value) => spec.select(value, chart)) : null;
      host.append(buttons, ...(menu ? [menu.el] : []));

      const refresh = () => {
        buttons.setAttribute('aria-label', label());
        const current = spec.current(chart);
        const all = options();
        // Starred entries in the order they were starred; every entry without favourites.
        const refs = list?.get().map((ref) => {
          if (!spec.fallback || spec.options.some((o) => o.value === ref)) return ref;
          try {
            if (process.env.NODE_ENV !== 'production') {
              console.warn(`charton [option-range]: the starred ${spec.kind} ${JSON.stringify(ref)} is unknown, so ${spec.fallback} is shown (${ERRORS_DOCS_URL}#option-range)`);
            }
          } catch {
            // No `process` (loaded without a bundler): stay quiet.
          }
          return spec.fallback;
        });
        const shown = refs ? [...new Set(refs)].flatMap((ref) => all.filter((o) => o.value === ref)) : all;
        buttons.hidden = shown.length === 0;
        buttons.replaceChildren(
          ...shown.map((o) => {
            const b = spec.icons && o.icon
              ? iconButton({ icon: o.icon, label: o.label, variant: 'ghost' })
              : h('button', { class: 'pc-btn pc-btn--ghost pc-favorite-strip-item' }, o.label);
            b.dataset.value = o.value;
            markActive(b, o.value === current);
            b.addEventListener('click', () => spec.select(o.value, chart));
            return b;
          }),
        );
        menu?.refresh();
      };
      refresh();
      const offs = [spec.watch(chart, refresh), chart.on('localization:change', refresh), list?.on('change', refresh) ?? (() => {})];
      return () => {
        offs.forEach((off) => off());
        menu?.destroy();
      };
    },
  };
}

/**
 * Dropdown of every option with a star beside each. The trigger shows the
 * current option; a click on an option picks it, a click on a star stars or
 * unstars it and leaves the menu open.
 */
function starMenu(
  chart: Chart,
  list: FavoritesList,
  label: () => string,
  options: () => MenuOption[],
  current: () => string | undefined,
  select: (value: string) => void,
): { el: HTMLElement; refresh(): void; destroy(): void } {
  const wrap = h('div', { class: 'pc-menu' });
  const face = h('span', { class: 'pc-menu-face' });
  const trigger = h('button', { class: 'pc-btn pc-btn--ghost pc-menu-trigger', 'aria-haspopup': 'menu' }, face, icon(ChevronDown, 13));
  bindTip(trigger);
  wrap.append(trigger);
  /** Star updates of the open list, so a change made elsewhere shows in it. */
  let syncs: (() => void)[] = [];

  const { close } = popoverToggle(
    wrap,
    trigger,
    () => {
      const panel = h('div', { class: 'pc-popover', role: 'menu', 'aria-label': label() });
      syncs = [];
      const now = current();
      let section: string | undefined;
      for (const o of options()) {
        if (o.section !== undefined && o.section !== section) panel.append(h('div', { class: 'pc-popover-label' }, o.section));
        section = o.section;
        const item = popoverItem(o.label, o.icon, o.value === now, 'menuitemradio');
        item.addEventListener('click', () => {
          close();
          select(o.value);
        });
        panel.append(h('div', { class: 'pc-popover-row', role: 'none' }, item, star(o)));
      }
      wrap.append(panel);
      placePopover(panel, trigger, {});
      return panel;
    },
    undefined,
    true,
  );

  /** Star of option `o`: adds it to the favourites, or removes it. Leaves the menu open. */
  const star = (o: MenuOption): HTMLButtonElement => {
    const b = h('button', { class: 'pc-favorite-star', role: 'menuitemcheckbox' });
    const sync = () => {
      const on = list.has(o.value);
      const text = shellText(chart, on ? 'indicatorsFavoriteRemove' : 'indicatorsFavoriteAdd', { name: o.label });
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('aria-label', text);
      const glyph = icon(Star, 14);
      if (on) glyph.setAttribute('fill', 'currentColor');
      b.replaceChildren(glyph);
    };
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (list.has(o.value)) list.remove(o.value);
      else if (!list.add(o.value)) chart.notify({ message: shellText(chart, 'favoritesFull', { name: o.label, limit: list.limit }) });
      sync();
    });
    sync();
    syncs.push(sync);
    return b;
  };

  return {
    el: wrap,
    refresh() {
      const text = label();
      trigger.setAttribute('aria-label', text);
      trigger.setAttribute('data-tip', text);
      const now = options().find((o) => o.value === current());
      face.replaceChildren(...(now?.icon ? [icon(now.icon, 16)] : now ? [h('span', {}, now.label)] : []));
      syncs.forEach((sync) => sync());
    },
    destroy: close,
  };
}
