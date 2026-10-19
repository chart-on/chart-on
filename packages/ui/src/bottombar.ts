import { ALWAYS_OPEN, utcOffsetText, zoneOf, type Chart, type PriceScaleMode, type SessionBands, type SessionSchedule, type Time } from '@chart-on/core';
import { settingsOf } from './chart-settings';
import { menuButton, type MenuOption } from './controls';
import { h, placePopover, type VisibilityControl } from './dom';
import { defaultShellMessages, keyedText, shellText, type ShellMessageKey } from './messages';
import { createSessionChip } from './session-chip';
import { showShortcut } from './shortcuts';
import { mountToolbar, type ToolbarHandle, type ToolbarItem, type ToolbarOptions } from './toolbar';
import type { ToolbarButtonItem, ToolbarCustomItem, ToolbarMenuItem, ToolbarSegmentedItem } from './toolbar-presets';

/** A range preset of the bottom bar: its button label and the span of time it shows. */
export interface RangeOption {
  label: string;
  /** Span in seconds ending at the newest bar, `'ytd'` (year to date) or `'all'` (fit everything). */
  span: number | 'ytd' | 'all';
  /** Accessible description, e.g. "1 month". */
  title?: string;
  /** Message key for `label`: the bar shows its text in the chart's language, else `label` (see the `localization` option). */
  labelKey?: ShellMessageKey | (string & {});
  /** Message key for `title`, like `labelKey`. */
  titleKey?: ShellMessageKey | (string & {});
}

/**
 * Shorthand for the bottom bar's default items (`defaultBottomBarItems`):
 * range presets, the clock, go-to-date, price-scale controls, and the
 * timezone, session and session-band controls. For any other layout, give
 * the bar a list of items instead.
 */
export interface BottomBarOptions {
  /**
   * Range presets. None by default: the toolbar's interval control already
   * sets how much history shows. Pass `defaultRanges` for 1D 5D 1M 3M 6M YTD
   * 1Y 5Y All, or a list of your own.
   */
  ranges?: RangeOption[];
  /**
   * Called before a range is applied, e.g. to switch to a fitting interval and
   * reload data. The view change runs afterwards against the new data.
   */
  onRange?: (range: RangeOption, chart: Chart) => void;
  /**
   * Show a clock in the chart's timezone. Default true. It is a button that
   * opens the chart settings (`settingsOf`) on their Time section, or the
   * `timezones` menu when the chart has no settings, and plain text when
   * neither exists. Settings created after the bar take effect on `refresh()`.
   */
  clock?: boolean;
  /**
   * Show a go-to-date control after the range presets: a date and an
   * optional time in the chart's timezone. Its `go-to-date` action has no
   * default key; bind one with `chart.actions.setKeys`. Default true.
   */
  goToDate?: boolean;
  /**
   * The main pane's price scale controls: the scale mode (linear, log or
   * percent) and auto-fit. `'menu'` (the default; `true` too) puts them in one
   * menu whose button shows the current mode, as they change rarely;
   * `'inline'` shows the modes as one radio group with the auto-fit toggle
   * beside it; `false` leaves them out.
   */
  scaleToggles?: boolean | 'menu' | 'inline';
  /**
   * Timezone menu next to the clock. Each option's value is an IANA zone or
   * `'local'`; picking one sets the chart's `timezone`. `value` is the
   * initially selected option; the menu follows later changes made
   * elsewhere (`timezone:change`), such as in the chart settings.
   */
  timezones?: { options: MenuOption[]; value?: string };
  /**
   * Trading-session menu. Picking an option sets the chart's `session` and
   * shades time outside it; an option without a session means always open.
   */
  sessions?: { options: SessionOption[]; value?: string };
  /**
   * Session bands to list in a chip (see `createSessionBands` in core): a dot
   * per lane, solid while it is open, and a list with countdowns to the next
   * open or close. Attach the bands to the chart yourself to draw them.
   */
  sessionBands?: SessionBands;
}

/** An option of the bottom bar's trading-session menu, with the session it applies. */
export interface SessionOption extends MenuOption {
  /** Trading hours; omit for always open (no shading). */
  session?: SessionSchedule;
}

/** Returned by `createBottomBar`: the same handle as the toolbar's, to read, add, change or remove items by id. */
export type BottomBarHandle = ToolbarHandle;

const DAY = 86400;

/** A range preset labelled by message key `key`, with its title under the key plus `Title`. */
const preset = (key: ShellMessageKey, span: RangeOption['span']): RangeOption => {
  const titleKey = `${key}Title` as ShellMessageKey;
  return { label: defaultShellMessages[key], span, title: defaultShellMessages[titleKey], labelKey: key, titleKey };
};

/** The default range presets of the bottom bar: 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y and All. */
export const defaultRanges: RangeOption[] = [
  preset('range1D', DAY),
  preset('range5D', 5 * DAY),
  preset('range1M', 30 * DAY),
  preset('range3M', 91 * DAY),
  preset('range6M', 182 * DAY),
  preset('rangeYtd', 'ytd'),
  preset('range1Y', 365 * DAY),
  preset('range5Y', 5 * 365 * DAY),
  preset('rangeAll', 'all'),
];

/** Apply a range preset to the chart's view. */
export function applyRange(chart: Chart, range: RangeOption): void {
  const times = chart.timeline.times;
  const last = times[times.length - 1];
  if (last === undefined) return;
  if (range.span === 'all') {
    chart.fitContent();
    return;
  }
  // The year starts at midnight on Jan 1 in the chart's timezone.
  const zone = chart.zone;
  const from =
    range.span === 'ytd' ? zone.fromWall(Date.UTC(zone.date(last).getUTCFullYear(), 0, 1) / 1000) : last - range.span;
  chart.setVisibleTimeRange(from, last);
}

/** The chart's UTC offset at `now` (seconds), e.g. "UTC", "UTC-4" or "UTC+5:30". */
const utcText = (chart: Chart, now: number) => utcOffsetText(Math.trunc(chart.zone.offset(now) / 60));

/** Clock text in the chart's timezone, e.g. "14:03:22 UTC-4". */
export function clockText(chart: Chart, nowMs = Date.now()): string {
  const now = Math.floor(nowMs / 1000);
  return `${chart.zone.date(now).toISOString().slice(11, 19)} ${utcText(chart, now)}`;
}

/** The chart options a session menu option applies. */
export function sessionPatch(option: SessionOption): { session: SessionSchedule; sessionShading: boolean } {
  return { session: option.session ?? ALWAYS_OPEN, sessionShading: option.session !== undefined };
}

/** The main price scale's mode as the controls show it: an indexed scale measures from a base as a percent one does, so `percent` stands for both. */
const scaleModeOf = (chart: Chart) => {
  const mode = chart.getPriceScaleMode(0);
  return mode === 'indexed' ? 'percent' : mode;
};

/** Keep `write` in step with the chart's language; returns the unsubscribe function. */
const inLanguage = (chart: Chart, write: () => void) => {
  write();
  return chart.on('localization:change', write);
};

/**
 * Range presets as chips that set the visible span, or one menu in the
 * shell's compact layout. Picking one calls `onRange` (e.g. to switch to a
 * fitting interval and reload data), then shows the span. A custom item, so it
 * is hidden rather than listed when the bar runs out of room.
 */
export function rangePresets(list: readonly RangeOption[] = defaultRanges, options: { onRange?: BottomBarOptions['onRange'] } = {}): ToolbarCustomItem {
  return {
    type: 'custom',
    id: 'ranges',
    render(host, chart) {
      // The chips scroll when room runs out instead of pushing items out of the bar.
      host.classList.add('pc-toolbar-shrink');
      const pick = (range: RangeOption) => {
        options.onRange?.(range, chart);
        applyRange(chart, range);
      };
      const rangeLabel = (range: RangeOption) => keyedText(chart, range.labelKey, range.label);
      const rangeTitle = (range: RangeOption) => (range.title === undefined ? rangeLabel(range) : keyedText(chart, range.titleKey, range.title));
      const group = h('div', { class: 'pc-bottombar-ranges', role: 'group' });
      const chips = list.map((range) => {
        const chip = h('button', { class: 'pc-chip' });
        chip.addEventListener('click', () => pick(range));
        return chip;
      });
      group.append(...chips);
      // The shell's compact layout (`railSheet` flag) shows this menu in place of the chips.
      const rangeOptions = () => list.map((range, i) => ({ value: String(i), label: rangeTitle(range) }));
      const menu = menuButton({
        label: shellText(chart, 'rangeLabel'),
        text: shellText(chart, 'rangeText'),
        options: rangeOptions(),
        onSelect: (value) => {
          const range = list[Number(value)];
          if (range) pick(range);
        },
      });
      menu.el.classList.add('pc-bottombar-range-menu');
      host.append(group, menu.el);
      const off = inLanguage(chart, () => {
        group.setAttribute('aria-label', shellText(chart, 'rangeLabel'));
        chips.forEach((chip, i) => {
          chip.textContent = rangeLabel(list[i]!);
          chip.setAttribute('data-tip', rangeTitle(list[i]!));
        });
        menu.update({ label: shellText(chart, 'rangeLabel'), text: shellText(chart, 'rangeText'), options: rangeOptions() });
      });
      return () => {
        off();
        menu.destroy();
      };
    },
  };
}

/**
 * A go-to-date chip and its form: a date and an optional time in the chart's
 * timezone. It registers the `go-to-date` action wherever it is mounted, which
 * has no default key; bind one with `chart.actions.setKeys`.
 */
export function goToDate(): ToolbarCustomItem {
  return {
    type: 'custom',
    id: 'go-to-date',
    render(host, chart) {
      const goTo = createGoTo(chart);
      host.append(goTo.el);
      const off = chart.on('localization:change', goTo.relabel);
      return () => {
        off();
        goTo.destroy();
      };
    },
  };
}

/**
 * A clock in the chart's timezone. It is a button that opens the chart
 * settings (`settingsOf`) on their Time section, or else the shell's timezone
 * menu (`timezoneMenu`), and plain text when neither exists.
 */
export function clock(): ToolbarCustomItem {
  return {
    type: 'custom',
    id: 'clock',
    align: 'end',
    render(host, chart) {
      // A timezone menu in either bar of the shell, or else in this bar.
      const zoneTrigger = () =>
        (host.closest?.('.pc-shell') ?? host.parentElement)?.querySelector?.<HTMLElement>('[data-id="timezone"] .pc-menu-trigger') ?? null;
      const changeTimezone = () => {
        if (!settingsOf(chart)?.open('time')) zoneTrigger()?.click();
      };
      let el: HTMLElement = h('span', { class: 'pc-clock', 'aria-live': 'off' });
      let isButton = false;
      host.append(el);
      /** Make the clock a button or plain text, whichever fits now: the settings and the timezone menu may come after it. */
      const sync = () => {
        const settings = settingsOf(chart) !== undefined;
        const button = settings || zoneTrigger() !== null;
        if (button !== isButton) {
          const next = button ? h('button', { class: 'pc-clock pc-clock--button' }) : h('span', { class: 'pc-clock', 'aria-live': 'off' });
          if (button) next.addEventListener('click', changeTimezone);
          host.replaceChildren(next);
          el = next;
          isButton = button;
        }
        if (button) el.setAttribute('aria-haspopup', settings ? 'dialog' : 'listbox');
      };
      const tick = () => {
        sync();
        const now = Date.now();
        el.textContent = clockText(chart, now);
        if (!isButton) return;
        const name = shellText(chart, 'timezoneClock', { offset: utcText(chart, Math.floor(now / 1000)) });
        if (el.getAttribute('aria-label') !== name) el.setAttribute('aria-label', name);
        el.setAttribute('data-tip', shellText(chart, 'timezoneChange'));
      };
      tick();
      // The shell makes its settings after the bars: look again once it is done.
      queueMicrotask(tick);
      const timer = setInterval(tick, 1000);
      // Whatever changed the timezone or language (a menu, the settings dialog, the app), show it at once.
      const offs = [chart.on('timezone:change', tick), chart.on('localization:change', tick)];
      return () => {
        clearInterval(timer);
        offs.forEach((off) => off());
      };
    },
  };
}

/**
 * A timezone menu. Each option's value is an IANA zone or `'local'`; picking
 * one sets the chart's `timezone`. The menu follows changes made elsewhere,
 * such as in the chart settings.
 */
export function timezoneMenu({ options, value }: { options: MenuOption[]; value?: string }): ToolbarMenuItem {
  return {
    type: 'menu',
    id: 'timezone',
    align: 'end',
    label: defaultShellMessages.timezoneLabel,
    labelKey: 'timezoneLabel',
    options,
    value,
    onSelect: (timezone, chart) => chart.applyOptions({ timezone }),
    currentValue: (chart) => chart.options.timezone,
    watch: (chart, refresh) => chart.on('timezone:change', refresh),
  };
}

/** A trading-session menu. Picking an option sets the chart's `session` and shades time outside it; an option without a session means always open. */
export function sessionMenu({ options, value }: { options: SessionOption[]; value?: string }): ToolbarMenuItem {
  return {
    type: 'menu',
    id: 'session',
    align: 'end',
    label: defaultShellMessages.sessionLabel,
    labelKey: 'sessionLabel',
    options,
    value,
    onSelect: (picked, chart) => {
      const option = options.find((o) => o.value === picked);
      if (option) chart.applyOptions(sessionPatch(option));
    },
  };
}

/**
 * A chip for session bands (see `createSessionBands` in core): a dot per lane,
 * solid while it is open, and a list with countdowns to the next open or
 * close. Attach the bands to the chart yourself to draw them.
 */
export function sessionBandsChip(bands: SessionBands): ToolbarCustomItem {
  return {
    type: 'custom',
    id: 'session-bands',
    align: 'end',
    render(host, chart) {
      // A getter, so the chip's once-a-second refresh reads the current language.
      const chip = createSessionChip(bands, undefined, {
        get localization() {
          return chart.localization;
        },
      });
      host.append(chip.el);
      const off = chart.on('localization:change', chip.refresh);
      return () => {
        off();
        chip.destroy();
      };
    },
  };
}

/** The scale mode texts, by mode, that the price scale controls show. */
const scaleKeys = { normal: 'scaleLinear', log: 'scaleLog', percent: 'scalePercent' } as const;

/**
 * The main pane's price scale controls in one menu: linear, log or percent,
 * and auto-fit. Its button shows the current mode, and `auto` while auto-fit
 * is on. For the modes as a radio group, use `scaleModeInline`.
 */
export function scaleMode(): ToolbarMenuItem {
  const titles = { normal: 'scaleLinearTitle', log: 'scaleLogTitle', percent: 'scalePercentTitle', auto: 'scaleAutoTitle' } as const;
  return {
    type: 'menu',
    id: 'scale-mode',
    align: 'end',
    // Normal, log and percent are exclusive modes of one setting, named "Price scale" (the `seriesPlacement` text).
    label: defaultShellMessages.seriesPlacement,
    labelKey: 'seriesPlacement',
    options: Object.entries(titles).map(([value, key]) => ({ value, label: defaultShellMessages[key], labelKey: key })),
    isChecked: (value, chart) => (value === 'auto' ? chart.isAutoScale(0) : value === scaleModeOf(chart)),
    onSelect: (value, chart) =>
      value === 'auto' ? chart.setAutoScale(!chart.isAutoScale(0), 0) : chart.setPriceScaleMode(value as PriceScaleMode, 0),
    currentText: (chart) => shellText(chart, scaleKeys[scaleModeOf(chart)]) + (chart.isAutoScale(0) ? ` · ${shellText(chart, 'scaleAuto')}` : ''),
    watch: (chart, refresh) => chart.on('scale:change', refresh),
  };
}

/** The main pane's price scale controls side by side: the modes as one radio group, and an auto-fit toggle. */
export function scaleModeInline(): [ToolbarSegmentedItem, ToolbarButtonItem] {
  const watch = (chart: Chart, refresh: () => void) => chart.on('scale:change', refresh);
  const titles: Partial<Record<keyof typeof scaleKeys, ShellMessageKey>> = { log: 'scaleLogTitle', percent: 'scalePercentTitle' };
  return [
    {
      type: 'segmented',
      id: 'scale-mode',
      align: 'end',
      label: defaultShellMessages.seriesPlacement,
      labelKey: 'seriesPlacement',
      // The short texts `log` and `%` get their full names as accessible names and tooltips.
      options: Object.entries(scaleKeys).map(([value, key]) => {
        const title = titles[value as keyof typeof scaleKeys];
        return { value, label: defaultShellMessages[key], labelKey: key, ...(title && { title: defaultShellMessages[title], titleKey: title }) };
      }),
      value: 'normal',
      collapseBelow: 0,
      currentValue: scaleModeOf,
      onChange: (value, chart) => chart.setPriceScaleMode(value as PriceScaleMode, 0),
      watch,
    },
    {
      type: 'button',
      id: 'scale-auto',
      align: 'end',
      // Auto-fit is a setting of its own, so it stays a toggle beside the modes.
      label: defaultShellMessages.scaleAutoTitle,
      labelKey: 'scaleAutoTitle',
      content: (chart) => ({ text: shellText(chart, 'scaleAuto'), label: shellText(chart, 'scaleAutoTitle') }),
      isActive: (chart) => chart.isAutoScale(0),
      onClick: (chart) => chart.setAutoScale(!chart.isAutoScale(0), 0),
      watch,
    },
  ];
}

/**
 * The bottom bar's items for `options`: range presets and go to date on the
 * left; timezone, clock, session menu, session bands and the price scale
 * controls on the right. This is the bar a shell shows by default.
 */
export function defaultBottomBarItems(options: BottomBarOptions = {}): ToolbarItem[] {
  const items: ToolbarItem[] = [];
  const end = (id: string): ToolbarItem => ({ type: 'separator', id, align: 'end' });
  if (options.ranges?.length) items.push(rangePresets(options.ranges, options));
  if (options.goToDate !== false) items.push(goToDate());
  if (options.timezones) items.push(timezoneMenu(options.timezones));
  if (options.clock !== false) items.push(clock(), end('clock-separator'));
  if (options.sessions) items.push(sessionMenu(options.sessions), end('session-separator'));
  if (options.sessionBands) items.push(sessionBandsChip(options.sessionBands), end('session-bands-separator'));
  const scale = options.scaleToggles ?? 'menu';
  if (scale === 'inline') items.push(...scaleModeInline());
  else if (scale !== false) items.push(scaleMode());
  return items;
}

/** What the bottom bar takes: items (as for the toolbar), or `BottomBarOptions` for the default items. */
export type BottomBarInput = BottomBarOptions | ToolbarItem[] | ToolbarOptions;

/** Toolbar options for `input`: items as given, or the default items for `BottomBarOptions`. Customization saves under `bottomBar`. */
export function bottomBarToolbarOptions(input: BottomBarInput): ToolbarOptions {
  const options = Array.isArray(input) ? { items: input } : 'items' in input ? input : { items: defaultBottomBarItems(input) };
  return { storageKey: 'bottomBar', ...options };
}

/**
 * Internal: the bottom bar's strip (`.pc-bottombar`) with a toolbar of `input`
 * inside. The strip marks the bottom edge, so popups and tooltips in it open
 * upwards, and hides with the toolbar.
 */
export function mountBottomBar(
  host: HTMLElement,
  chart: Chart,
  input: BottomBarInput,
  customizationHost: HTMLElement = host,
): ReturnType<typeof mountToolbar> & { wrap: HTMLElement } {
  const wrap = h('div', { class: 'pc-bottombar', 'data-pc-edge': 'bottom' });
  host.append(wrap);
  const mounted = mountToolbar(wrap, chart, bottomBarToolbarOptions(input), customizationHost);
  const { handle, visibility } = mounted;
  visibility.onChange((visible) => (wrap.hidden = !visible));
  const off = inLanguage(chart, () => handle.el.setAttribute('aria-label', shellText(chart, 'bottomBarLabel')));
  const destroy = handle.destroy;
  handle.destroy = () => {
    off();
    destroy();
    wrap.remove();
  };
  return { ...mounted, wrap };
}

/**
 * A bar along the bottom of the chart, appended to `host`. It takes items
 * as the toolbar does (`goToDate`, `clock`, `timezoneMenu`, `scaleMode` and the
 * other presets, or any toolbar item), or `BottomBarOptions` for
 * `defaultBottomBarItems`. Popups and tooltips in it open upwards.
 *
 * @example
 * ```ts
 * createBottomBar(el, chart, [goToDate(), clock(), scaleMode()]);
 * ```
 */
export function createBottomBar(host: HTMLElement, chart: Chart, input: BottomBarInput = {}): ToolbarHandle {
  return mountBottomBar(host, chart, input).handle;
}

/**
 * The time of `date` (`YYYY-MM-DD`) and optional `time` (`HH:MM`) as the wall
 * clock in `timezone`, as `<input type="date">` and `type="time"` give them;
 * null when the date cannot be read.
 */
export function wallTime(date: string, time: string, timezone: string): Time | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!d) return null;
  const t = /^(\d{2}):(\d{2})/.exec(time);
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), t ? Number(t[1]) : 0, t ? Number(t[2]) : 0) / 1000;
  return Number.isFinite(wall) ? zoneOf(timezone).fromWall(wall) : null;
}

/** The go-to-date chip and its form, which opens away from the bar's edge. */
function createGoTo(chart: Chart): { el: HTMLElement; relabel(): void; destroy(): void } {
  const el = h('div', { class: 'pc-goto' });
  const trigger = h('button', {
    class: 'pc-chip',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
  });
  const date = h('input', { type: 'date', class: 'pc-goto-input', required: '' });
  const time = h('input', { type: 'time', class: 'pc-goto-input' });
  const go = h('button', { type: 'submit', class: 'pc-btn pc-btn--neutral' });
  const form = h('form', { class: 'pc-popover pc-goto-form', role: 'dialog' }, date, time, go);
  form.hidden = true;
  /** Write the text in the chart's language; `showShortcut` writes the tooltip, the action's label with its shortcut. */
  const write = () => {
    trigger.textContent = shellText(chart, 'goToText');
    date.setAttribute('aria-label', shellText(chart, 'goToDateField'));
    time.setAttribute('aria-label', shellText(chart, 'goToTimeField'));
    go.textContent = shellText(chart, 'goToSubmit');
    form.setAttribute('aria-label', shellText(chart, 'goToDate'));
  };
  write();
  el.append(trigger, form);

  /** Open the form (focusing the date) or close it, focusing the trigger again with `refocus`. */
  const show = (on: boolean, refocus?: boolean) => {
    form.hidden = !on;
    trigger.setAttribute('aria-expanded', String(on));
    if (on) {
      placePopover(form, trigger);
      date.focus();
    } else if (refocus) trigger.focus();
  };
  trigger.addEventListener('click', () => show(form.hidden));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const at = wallTime(date.value, time.value, chart.options.timezone);
    if (at === null) return;
    show(false);
    void chart.goToTime(at);
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') show(false, true);
  });
  // An action, so apps can give it a key or run it from the command palette. No default key (#863):
  // letters and digits belong to type-to-search, and the named keys left are the view's.
  const unregister = chart.actions.has(GO_TO_DATE)
    ? () => {}
    : chart.actions.register({ id: GO_TO_DATE, label: () => shellText(chart, 'goToDate'), local: true, run: () => show(true) });
  let offActions = showShortcut(trigger, chart, GO_TO_DATE);
  return {
    el,
    relabel() {
      write();
      // Read the action's label again, in the new language.
      offActions();
      offActions = showShortcut(trigger, chart, GO_TO_DATE);
    },
    destroy() {
      offActions();
      unregister();
    },
  };
}

/** The action id of the go-to-date shortcut. */
const GO_TO_DATE = 'go-to-date';
