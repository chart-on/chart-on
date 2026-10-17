import { svgIcon, type IconShape } from './util/svg-icon';
import type { ChartTheme } from './theme';
import { fillNumerals, fontCss, measureNumerals, numeralsCss, resolveFont, type ResolvedFont } from './typography';
import { COLLAPSED_PANE_HEIGHT, type Pane } from './pane';
import { CandleSeries, type LegendEntry, type LegendMode, type Series } from './series';
import { englishLocalizer, type Localizer } from './util/locale';
import { withAlpha } from './util/color';

/**
 * The pane corner the legend sits in. `start` and `end` follow the chart's
 * `direction` (start is the left in left-to-right charts, the right in
 * right-to-left ones); `left` and `right` stay put.
 */
export type LegendPosition = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** The `legend` chart option in object form. */
export interface LegendOptions {
  /** Same as `features.legend`. */
  visible?: boolean;
  /** Corner of each pane. Default `'top-start'`. */
  position?: LegendPosition;
  /** `'full'` (default) every value, `'compact'` the close or value only, `'title'` titles only. */
  mode?: LegendMode;
  /**
   * Every candle series row: the change and percent change from the previous
   * close (with Heikin-Ashi, the previous Heikin-Ashi close). Default true.
   */
  showChange?: boolean;
  /**
   * An up or down arrow before each change value, so the direction does not
   * rest on the up and down colours alone. Default false.
   */
  changeArrows?: boolean;
  /**
   * Without a crosshair: `'last'` (default) shows the newest bar's values,
   * `'hidden'` titles only (also in `valuesAt()` legend rows).
   */
  whenIdle?: 'last' | 'hidden';
  /**
   * A translucent panel of the chart background behind each pane's rows, so
   * they stay legible over dense content. `'auto'` (default) on panes that
   * show a heatmap, `true` on every pane, `false` on none (the text keeps its
   * halo either way).
   */
  background?: boolean | 'auto';
  /**
   * Rows of hidden series: `'dimmed'` (default) keeps them, dimmed, with an
   * eye button to show them again; `'omit'` leaves them out of the legend,
   * its height, `valuesAt()` legend rows and screenshots, so the app shows
   * them again through `setVisible` or its own UI.
   */
  hiddenSeries?: 'dimmed' | 'omit';
  /**
   * Change a row before it is shown, e.g. to add units; also used by screenshots
   * and `valuesAt`. If it throws, the row is shown unformatted and the error logged once.
   */
  formatter?: (entry: LegendEntry, series: Series) => LegendEntry;
}

/** Resolved legend settings. */
export type LegendSettings = Required<Omit<LegendOptions, 'visible' | 'formatter'>> & Pick<LegendOptions, 'formatter'>;

/** Default values for `LegendSettings`: full rows in the top start corner with the change and no arrows, showing the newest bar while idle, hidden series dimmed. */
export const defaultLegendSettings: Readonly<LegendSettings> = {
  position: 'top-start',
  mode: 'full',
  showChange: true,
  changeArrows: false,
  whenIdle: 'last',
  background: 'auto',
  hiddenSeries: 'dimmed',
};

/** `patch` merged into `current`; `undefined` fields keep their value. */
export function resolveLegendSettings(current: LegendSettings, patch: LegendOptions): LegendSettings {
  const next: LegendSettings = { ...current };
  for (const key of ['position', 'mode', 'showChange', 'changeArrows', 'whenIdle', 'background', 'hiddenSeries'] as const) {
    if (patch[key] !== undefined) (next as Record<string, unknown>)[key] = patch[key];
  }
  if ('formatter' in patch) next.formatter = patch.formatter;
  return next;
}

/** Whether `series` gets a legend row at all, shown or not: not opted out with `legend: false`, nor hidden with `hiddenSeries: 'omit'`. */
const inLegend = (series: Series, settings: Pick<LegendSettings, 'hiddenSeries'>) =>
  (series.options as { legend?: boolean }).legend !== false && (series.visible || settings.hiddenSeries !== 'omit');

/**
 * A series' legend row as the legend shows it: null when the series opts out
 * with `legend: false`, or is hidden with `hiddenSeries: 'omit'`. `idle` means no crosshair, so `whenIdle: 'hidden'`
 * keeps only the title. The DOM legend, screenshots and `valuesAt` share it.
 */
export function legendEntryFor(series: Series, index: number, settings: LegendSettings, idle = false): LegendEntry | null {
  if (!inLegend(series, settings)) return null;
  const entry = series.legend(index, settings);
  if (!entry) return null;
  const titleOnly = settings.mode === 'title' || (idle && settings.whenIdle === 'hidden');
  const shown = titleOnly ? { title: entry.title, parts: [] } : entry;
  return settings.formatter ? formatEntry(settings.formatter, shown, series) : shown;
}

/** Formatters that threw and were logged; each is logged once, not every frame. */
const failedFormatters = new WeakSet<NonNullable<LegendOptions['formatter']>>();

/** `formatter` applied to `entry`; a throw shows the row unformatted, so one bad row never stops the frame. */
function formatEntry(formatter: NonNullable<LegendOptions['formatter']>, entry: LegendEntry, series: Series): LegendEntry {
  try {
    return formatter(entry, series);
  } catch (error) {
    if (!failedFormatters.has(formatter)) {
      failedFormatters.add(formatter);
      console.error(`Legend formatter threw for series ${series.id}`, error);
    }
    return entry;
  }
}

/** What one legend update shows and where. Coordinates are chart-root css px. */
export interface LegendFrame {
  panes: readonly Pane[];
  /** Bar the legend describes. */
  index: number;
  /** No crosshair: the newest bar is shown. */
  idle: boolean;
  theme: ChartTheme;
  /** Plot edges (price axes sit outside them) and the root size. */
  plotLeft: number;
  plotRight: number;
  width: number;
  height: number;
  settings: LegendSettings;
  /** Right-to-left chart: `start` positions are on the right, and the buttons on the left. */
  rtl?: boolean;
  /** Height the pane buttons take at the top end of each pane (0 or absent: none), css px. */
  paneButtons?: number;
  /** Height the scroll-to-newest button takes at the bottom end of the lowest pane (0 or absent: none). */
  scrollButton?: number;
  /** Shown above the main pane's rows, e.g. the market phase. */
  badge?: string;
  /** Button labels in the chart's language; default English. */
  text?: Pick<Localizer, 'text'>;
  controls?: LegendControls;
}

/** A legend row button: toggle visibility, open settings, open the row's menu or remove the series. */
export type LegendAction = 'visibility' | 'settings' | 'more' | 'remove';

/** Which row buttons the legend shows. */
export interface LegendControls {
  /** Show the buttons; off keeps the legend click-through and lists only visible series. */
  enabled: boolean;
  /** Whether a series gets a settings button (see `Chart.hasSeriesSettings`). */
  settings(series: Series): boolean;
  /** Show a "More" button that opens the row's menu (the app listens for `chart:contextmenu`). */
  menu?: boolean;
  /** Whether a series gets a remove button. */
  removable(series: Series): boolean;
  /** Whether the user shows the series, for the eye button; defaults to `series.visible`. */
  shown?(series: Series): boolean;
  /** Whether the row is folded to its title. */
  folded?(series: Series): boolean;
  /** Whether the series is the selected indicator, which outlines its row. */
  selected?(series: Series): boolean;
}

/** Opacity of the legend backdrop: the chart shows through a little, the rows read. */
const BACKDROP_ALPHA = 0.75;
/** How far the backdrop reaches past the rows (css px). */
const BACKDROP_PAD = 4;

/** The backdrop colour for `pane`'s rows, or '' for none. */
function backdropOf(settings: LegendSettings, pane: Pane, theme: ChartTheme): string {
  const on = settings.background === true || (settings.background === 'auto' && pane.series.some((s) => s.kind === 'heatmap' && s.visible));
  return on ? withAlpha(theme.background, BACKDROP_ALPHA) : '';
}

/** Gap between the legend and its pane's edge. */
const EDGE = 6;
/** Gap between an end-corner legend and the buttons sharing its corner. */
const BUTTON_GAP = 4;

/** Whether the legend sits on the right of each pane, reading `start` and `end` for the direction. */
function onRight(position: LegendPosition, rtl = false): boolean {
  return position.endsWith('right') || (position.endsWith('end') && !rtl) || (position.endsWith('start') && rtl);
}

/**
 * Distance from the legend's pane edge (top or bottom) to its first row. End
 * corners (where the buttons are) clear the pane buttons (top) and the scroll
 * button (bottom of the lowest pane); a collapsed pane is too short to move
 * its row below them.
 */
function edgeInset(frame: Omit<LegendFrame, 'controls' | 'badge'>, pane: Pane): number {
  const { position } = frame.settings;
  const rtl = frame.rtl ?? false;
  if (onRight(position, rtl) === rtl) return EDGE;
  let taken: number;
  if (position.startsWith('bottom')) {
    const lowest = frame.panes.filter((p) => p.height > 0).pop();
    taken = pane === lowest ? (frame.scrollButton ?? 0) : 0;
  } else {
    taken = pane.height > COLLAPSED_PANE_HEIGHT ? (frame.paneButtons ?? 0) : 0;
  }
  return taken > 0 ? taken + BUTTON_GAP : EDGE;
}

const NO_CONTROLS: LegendControls = { enabled: false, settings: () => false, removable: () => false };
/** A pane with at least this many rows can be collapsed to its first row. */
const COLLAPSIBLE_ROWS = 3;

const GLYPHS: Record<string, readonly IconShape[]> = {
  eye: [['path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z' }], ['circle', { cx: '12', cy: '12', r: '3' }]],
  'eye-off': [['path', { d: 'M10.7 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6' }], ['path', { d: 'm2 2 20 20' }]],
  settings: [['circle', { cx: '12', cy: '12', r: '3' }], ['path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z' }]],
  remove: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  more: [['circle', { cx: '5', cy: '12', r: '1.5' }], ['circle', { cx: '12', cy: '12', r: '1.5' }], ['circle', { cx: '19', cy: '12', r: '1.5' }]],
  'chevron-up': [['path', { d: 'm6 15 6-6 6 6' }]],
  'chevron-down': [['path', { d: 'm6 9 6 6 6-6' }]],
};

const ACTIONS: readonly LegendAction[] = ['visibility', 'settings', 'more', 'remove'];

/** One legend row, kept across updates so hover and keyboard focus survive value changes. */
interface Row {
  el: HTMLDivElement;
  text: HTMLSpanElement;
  actions: HTMLSpanElement;
  /** Made once and only shown, hidden or relabelled: re-inserting a button would drop its focus. */
  buttons: Record<LegendAction, HTMLButtonElement>;
  /** What the text was last built from; null before the first build. */
  drawnText: RowText | null;
  /** What the buttons were last set up from; null before the first setup. */
  drawnActions: RowActions | null;
  hover: boolean;
  focus: boolean;
}

/**
 * A row's text inputs. Compared field by field on every update, which runs
 * on every crosshair move, so an unchanged row costs no key building.
 */
interface RowText {
  color: string;
  muted: string;
  /** A copy, so a series that reuses its entry object cannot fool the comparison. */
  entry: LegendEntry;
  /** The title shown for an entry without one, while buttons are on. */
  fallback: string;
}

/** A row's button inputs. */
interface RowActions extends Record<LegendAction, boolean> {
  color: string;
  background: string;
  separator: string;
  /** The button labels, joined. */
  labels: string;
  userShown: boolean;
}

/** A pane block's inputs: its rows, badge and collapse toggle. */
interface BlockState {
  color: string;
  muted: string;
  badge: string;
  series: Series[];
  collapsible: boolean;
  collapsed: boolean;
  count: number;
  /** The localizer the collapse toggle was labelled with; a new one comes with a language change. */
  text: Pick<Localizer, 'text'>;
}

/** Per-pane DOM legends, one per pane in the chosen corner. Rows update only when their text or buttons change. */
export class Legend {
  /** Button labels in the chart's language, from the last frame. */
  private text: Pick<Localizer, 'text'> = englishLocalizer;
  #blocks: HTMLDivElement[] = [];
  /** What each block was last built from. */
  #drawn: (BlockState | undefined)[] = [];
  /** Series with a row in the current update; kept to save a set per update. */
  readonly #seen = new Set<Series>();
  #toggles: HTMLButtonElement[] = [];
  /** Pane each block shows, for the collapse toggle. */
  #blockPanes: Pane[] = [];
  #rows = new Map<Series, Row>();
  #collapsed = new WeakSet<Pane>();
  /** Backdrop colour each block was last given ('' for none). */
  #fills: string[] = [];
  /** The bar the rows last showed, and whether the crosshair was idle. */
  #shown = { index: -1, idle: true };
  /**
   * Held while the pointer is over a row: the rows keep the values they showed,
   * so their width, and the buttons beside them, stay put under the pointer.
   */
  #held: { index: number; idle: boolean } | null = null;

  constructor(
    private readonly root: HTMLElement,
    /** `button` is the pressed button, e.g. to open the row's menu beside it. */
    private readonly onAction: (series: Series, action: LegendAction, button: HTMLElement) => void = () => {},
    /** A collapse toggle changed what the legend shows; update it again. */
    private readonly onChange: () => void = () => {},
  ) {}

  update(frame: LegendFrame): void {
    const { panes, theme, settings } = frame;
    // A hovered row that went away cannot report the pointer leaving it.
    if (this.#held && ![...this.#rows.values()].some((row) => row.hover)) this.#held = null;
    const { index, idle } = (this.#shown = this.#held ?? { index: frame.index, idle: frame.idle });
    const controls = frame.controls ?? NO_CONTROLS;
    this.text = frame.text ?? englishLocalizer;
    const badge = frame.badge ?? '';
    const right = onRight(settings.position, frame.rtl);
    const bottom = settings.position.startsWith('bottom');
    while (this.#blocks.length > panes.length) {
      this.#blocks.pop()!.remove();
      this.#drawn.pop();
      this.#toggles.pop();
      this.#blockPanes.pop();
      this.#fills.pop();
    }
    const seen = this.#seen;
    seen.clear();
    panes.forEach((pane, i) => {
      const block = this.#block(i, theme);
      this.#blockPanes[i] = pane;
      const inset = edgeInset(frame, pane);
      Object.assign(block.style, {
        top: bottom ? '' : `${pane.top + inset}px`,
        bottom: bottom ? `${frame.height - pane.top - pane.height + inset}px` : '',
        left: right ? '' : `${frame.plotLeft + 10}px`,
        right: right ? `${frame.width - frame.plotRight + 10}px` : '',
        // Rows wider than the plot wrap their values instead of running under the price axis.
        maxWidth: `${Math.max(0, frame.plotRight - frame.plotLeft - 20)}px`,
        alignItems: right ? 'flex-end' : 'flex-start',
      });
      // Panes hidden by a maximized one have no height. The block is a flex column, so rows hug their content.
      block.style.display = pane.height > 0 ? 'flex' : 'none';
      const fill = backdropOf(settings, pane, theme);
      if (this.#fills[i] !== fill) {
        this.#fills[i] = fill;
        // A spread shadow reaches past the rows without moving them.
        Object.assign(block.style, { background: fill, boxShadow: fill ? `0 0 0 ${BACKDROP_PAD}px ${fill}` : '', borderRadius: fill ? `${BACKDROP_PAD}px` : '' });
      }
      const entries = legendEntries(pane, index, settings, idle, controls.enabled);
      const collapsible = controls.enabled && entries.length >= COLLAPSIBLE_ROWS;
      const collapsed = collapsible && this.#collapsed.has(pane);
      const count = collapsed ? Math.min(1, entries.length) : entries.length;
      for (let k = 0; k < count; k++) {
        const { series, entry } = entries[k]!;
        seen.add(series);
        this.#row(series, entry, theme, controls);
      }
      const text = i === 0 ? badge : '';
      const was = this.#drawn[i];
      if (
        was &&
        was.color === theme.text &&
        was.muted === theme.textMuted &&
        was.badge === text &&
        was.collapsible === collapsible &&
        was.collapsed === collapsed &&
        was.count === entries.length &&
        was.text === this.text &&
        sameSeries(was.series, entries, count)
      ) {
        return;
      }
      const shown = entries.slice(0, count).map((e) => e.series);
      this.#drawn[i] = { color: theme.text, muted: theme.textMuted, badge: text, series: shown, collapsible, collapsed, count: entries.length, text: this.text };
      const rows = shown.map((series) => this.#rows.get(series)!.el);
      const children: HTMLElement[] = text ? [this.badge(text, theme), ...rows] : rows;
      if (collapsible) children.push(this.toggle(i, collapsed, entries.length - 1, theme));
      block.replaceChildren(...children);
    });
    for (const series of this.#rows.keys()) if (!seen.has(series)) this.#rows.delete(series);
  }

  hide(): void {
    for (const b of this.#blocks) b.style.display = 'none';
  }

  /** The series whose row holds `target` (e.g. a pointer event's target), or null. */
  seriesAt(target: unknown): Series | null {
    if (!target) return null;
    for (const [series, row] of this.#rows) if (row.el.contains(target as Node)) return series;
    return null;
  }

  #block(i: number, theme: ChartTheme): HTMLDivElement {
    let block = this.#blocks[i];
    if (!block) {
      block = document.createElement('div');
      block.className = 'pc-legend';
      Object.assign(block.style, {
        position: 'absolute',
        left: '10px',
        zIndex: '2',
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '2px',
      });
      this.root.appendChild(block);
      this.#blocks[i] = block;
    }
    const font = resolveFont(theme, 'legend');
    block.style.font = fontCss(font);
    block.style.fontVariantNumeric = numeralsCss(font.numerals);
    block.style.textShadow = `0 0 4px ${theme.background}, 0 0 2px ${theme.background}`;
    block.style.color = theme.text;
    return block;
  }

  private badge(text: string, theme: ChartTheme): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'pc-legend-badge';
    el.textContent = text;
    Object.assign(el.style, {
      padding: '0 6px',
      border: `1px solid ${theme.textMuted}`,
      borderRadius: '4px',
      color: theme.textMuted,
      fontSize: `${resolveFont(theme, 'legend').fontSize - 2}px`,
    });
    return el;
  }

  #row(series: Series, entry: LegendEntry, theme: ChartTheme, controls: LegendControls): Row {
    let row = this.#rows.get(series);
    if (!row) {
      row = this.#createRow(series, theme);
      this.#rows.set(series, row);
    }
    const title = entry.title || kindLabel(series, this.text);
    const userShown = controls.shown?.(series) ?? series.visible;
    if (controls.folded?.(series)) entry = { title: entry.title, parts: [] };
    // Also dimmed while shown by the user but hidden for another reason (e.g. the interval).
    row.el.style.opacity = series.visible ? '' : '0.5';
    row.el.style.outline = controls.selected?.(series) ? `1px solid ${theme.drawingSelected}` : '';
    // Rows take the pointer only for their buttons' hover; presses still bubble to the chart and pan.
    row.el.style.pointerEvents = controls.enabled ? 'auto' : 'none';
    const fallback = controls.enabled && !entry.title ? title : '';
    const drawn = row.drawnText;
    if (!drawn || drawn.color !== theme.text || drawn.muted !== theme.textMuted || drawn.fallback !== fallback || !sameEntry(drawn.entry, entry)) {
      row.drawnText = { color: theme.text, muted: theme.textMuted, entry: copyEntry(entry), fallback };
      row.text.replaceChildren(...textParts(controls.enabled ? { ...entry, title } : entry, theme));
    }
    const t = this.text;
    const labels = {
      visibility: t.text(userShown ? 'legendHide' : 'legendShow', { title }),
      settings: t.text('legendSettings', { title }),
      more: t.text('legendMore', { title }),
      remove: t.text('legendRemove', { title }),
    };
    // The labels carry the title and the language, so a change to either redraws the buttons.
    const labelKey = `${labels.visibility}\n${labels.settings}\n${labels.more}\n${labels.remove}`;
    const visibility = controls.enabled;
    const settings = controls.enabled && controls.settings(series);
    const more = controls.enabled && !!controls.menu;
    const remove = controls.enabled && controls.removable(series);
    const was = row.drawnActions;
    if (
      !was ||
      was.color !== theme.text ||
      was.background !== theme.background ||
      was.separator !== theme.separator ||
      was.labels !== labelKey ||
      was.userShown !== userShown ||
      was.visibility !== visibility ||
      was.settings !== settings ||
      was.more !== more ||
      was.remove !== remove
    ) {
      const shown: RowActions = {
        color: theme.text,
        background: theme.background,
        separator: theme.separator,
        labels: labelKey,
        userShown,
        visibility,
        settings,
        more,
        remove,
      };
      row.drawnActions = shown;
      const b = row.buttons;
      setIcon(b.visibility, userShown ? 'eye' : 'eye-off', labels.visibility);
      setIcon(b.settings, 'settings', labels.settings);
      setIcon(b.more, 'more', labels.more);
      b.more.setAttribute('aria-haspopup', 'menu');
      setIcon(b.remove, 'remove', labels.remove);
      for (const action of ACTIONS) {
        row.buttons[action].style.display = shown[action] ? 'grid' : 'none';
        paint(row.buttons[action], theme);
      }
      row.actions.setAttribute('aria-label', title);
      row.actions.style.display = shown.visibility ? 'flex' : 'none';
    }
    return row;
  }

  #createRow(series: Series, theme: ChartTheme): Row {
    const el = document.createElement('div');
    el.className = 'pc-legend-row';
    // Digits follow the block's `font-variant-numeric`, tabular by default.
    Object.assign(el.style, { display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap', borderRadius: '3px', outlineOffset: '1px' });
    const text = document.createElement('span');
    // Values wrap as whole items (the row is nowrap) when the block is capped at the plot width.
    Object.assign(text.style, { display: 'flex', flexWrap: 'wrap', gap: '0 8px' });
    const actions = document.createElement('span');
    actions.className = 'pc-legend-actions';
    actions.setAttribute('role', 'group');
    Object.assign(actions.style, { display: 'none', gap: '2px', opacity: '0', flexShrink: '0' });
    const button = (action: LegendAction) => {
      const b = iconButton(action === 'visibility' ? 'eye' : action, '', theme);
      b.className = `pc-legend-btn pc-legend-btn--${action}`;
      b.addEventListener('click', () => this.onAction(series, action, b));
      return b;
    };
    const buttons = { visibility: button('visibility'), settings: button('settings'), more: button('more'), remove: button('remove') };
    actions.append(buttons.visibility, buttons.settings, buttons.more, buttons.remove);
    el.append(text, actions);
    const row: Row = { el, text, actions, buttons, drawnText: null, drawnActions: null, hover: false, focus: false };
    // Buttons stay focusable while transparent, so keyboard focus reveals them like hover does.
    const sync = () => (actions.style.opacity = row.hover || row.focus ? '1' : '0');
    el.addEventListener('mouseenter', () => {
      row.hover = true;
      sync();
      this.#held ??= { ...this.#shown };
    });
    el.addEventListener('mouseleave', () => {
      row.hover = false;
      sync();
      if ([...this.#rows.values()].some((r) => r.hover)) return;
      // Follow the crosshair again.
      this.#held = null;
      this.onChange();
    });
    el.addEventListener('focusin', () => ((row.focus = true), sync()));
    el.addEventListener('focusout', () => ((row.focus = false), sync()));
    return row;
  }

  /** Collapse/expand button of block `i`, made once and relabelled. */
  private toggle(i: number, collapsed: boolean, more: number, theme: ChartTheme): HTMLButtonElement {
    let b = this.#toggles[i];
    if (!b) {
      b = iconButton('chevron-up', '', theme);
      b.className = 'pc-legend-toggle';
      b.addEventListener('click', () => {
        const pane = this.#blockPanes[i];
        if (!pane) return;
        if (this.#collapsed.has(pane)) this.#collapsed.delete(pane);
        else this.#collapsed.add(pane);
        this.onChange();
      });
      this.#toggles[i] = b;
    }
    setIcon(b, collapsed ? 'chevron-down' : 'chevron-up', collapsed ? this.text.text('legendShowMore', { count: more }) : this.text.text('legendCollapse'));
    b.setAttribute('aria-expanded', String(!collapsed));
    paint(b, theme);
    return b;
  }
}

/** Whether `series` are the series of the first `count` entries, in order. */
function sameSeries(series: readonly Series[], entries: readonly { series: Series }[], count: number): boolean {
  if (series.length !== count) return false;
  for (let k = 0; k < count; k++) if (series[k] !== entries[k]!.series) return false;
  return true;
}

function sameEntry(a: LegendEntry, b: LegendEntry): boolean {
  if (a.title !== b.title || a.parts.length !== b.parts.length) return false;
  for (let k = 0; k < a.parts.length; k++) {
    const p = a.parts[k]!;
    const q = b.parts[k]!;
    if (p.text !== q.text || p.color !== q.color || p.label !== q.label) return false;
  }
  return true;
}

function copyEntry(e: LegendEntry): LegendEntry {
  return { title: e.title, parts: e.parts.map((p) => ({ ...p })) };
}

/** A small square icon button; presses and double clicks on it never reach the chart (pan, drawings). */
function iconButton(glyph: string, label: string, theme: ChartTheme): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  setIcon(b, glyph, label);
  Object.assign(b.style, {
    display: 'grid',
    placeItems: 'center',
    width: '18px',
    height: '18px',
    padding: '0',
    borderRadius: '4px',
    cursor: 'pointer',
    pointerEvents: 'auto',
    textShadow: 'none',
  });
  paint(b, theme);
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('dblclick', (e) => e.stopPropagation());
  return b;
}

/** Set a button's glyph and its accessible name and tooltip, touching only what changed. */
function setIcon(b: HTMLButtonElement, glyph: string, label: string): void {
  if (b.dataset.glyph !== glyph) {
    b.dataset.glyph = glyph;
    b.replaceChildren(svgIcon(GLYPHS[glyph] ?? [], 12));
  }
  b.title = label;
  b.setAttribute('aria-label', label);
}

function paint(b: HTMLButtonElement, theme: ChartTheme): void {
  Object.assign(b.style, { border: `1px solid ${theme.separator}`, background: theme.background, color: theme.text });
}

/** Title and value spans of a row. */
function textParts(entry: LegendEntry, theme: ChartTheme): HTMLSpanElement[] {
  const out: HTMLSpanElement[] = [];
  if (entry.title) {
    const title = document.createElement('span');
    title.className = 'pc-legend-title';
    title.textContent = entry.title;
    Object.assign(title.style, { color: theme.text, fontWeight: '600', marginRight: '4px' });
    out.push(title);
  }
  for (const part of entry.parts) {
    const span = document.createElement('span');
    if (part.label) {
      const label = document.createElement('span');
      label.textContent = part.label;
      Object.assign(label.style, { color: theme.textMuted, marginRight: '2px' });
      span.appendChild(label);
    }
    const value = document.createElement('span');
    value.textContent = part.text;
    if (part.color) value.style.color = part.color;
    span.appendChild(value);
    out.push(span);
  }
  return out;
}

/** Row title for a series without one, e.g. "Line": the message `legendTitle` plus its kind (`legendTitleLine`). */
function kindLabel(series: Series, t: Pick<Localizer, 'text'>): string {
  const kind = series.kind;
  return t.text(`legendTitle${kind[0]!.toUpperCase()}${kind.slice(1)}`);
}

function legendRank(s: Series): number {
  if (s.overlayScale) return 2;
  return s instanceof CandleSeries ? 0 : 1;
}

/**
 * Legend rows of one pane: price series first, overlay-scale series (e.g.
 * volume) last. Without controls, only visible series with something to show;
 * with them, every series, so hidden ones can be shown again.
 */
function legendEntries(
  pane: Pane,
  index: number,
  settings: LegendSettings,
  idle: boolean,
  all = false,
): { series: Series; entry: LegendEntry }[] {
  return [...pane.series]
    .sort((a, b) => legendRank(a) - legendRank(b))
    .filter((s) => (all || s.visible) && inLegend(s, settings))
    .map((series) => ({ series, entry: legendEntryFor(series, index, settings, idle) ?? { title: '', parts: [] } }))
    .filter(({ entry }) => all || entry.title !== '' || entry.parts.length > 0);
}

/**
 * Height (css px) the legend block of `pane` takes from its edge, laid out as
 * `drawLegend` does: the edge gap and one row per series with a legend row,
 * hidden ones included unless `hiddenSeries` is `'omit'`, since the legend
 * lists them (dimmed) to show them again.
 */
export function legendHeight(pane: Pane, theme: ChartTheme, settings: Pick<LegendSettings, 'hiddenSeries'>): number {
  const rows = pane.series.filter((s) => inLegend(s, settings)).length;
  return rows && EDGE + rows * rowStep(resolveFont(theme, 'legend').fontSize);
}

/** Distance (css px) from one legend row to the next in a `size` px font: its line height and the 2 px gap. */
const rowStep = (size: number) => Math.round(size * 1.25) + 2;

/**
 * Paint the legend onto a canvas (css px transform already applied), matching
 * the DOM legend's layout and settings, for screenshots.
 */
export function drawLegend(ctx: CanvasRenderingContext2D, frame: Omit<LegendFrame, 'controls' | 'badge'>): void {
  const { theme, settings } = frame;
  const font = resolveFont(theme, 'legend');
  const step = rowStep(font.fontSize);
  const right = onRight(settings.position, frame.rtl);
  const bottom = settings.position.startsWith('bottom');
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  // Same halo as the DOM legend's text-shadow, so text stays legible over series.
  ctx.shadowColor = theme.background;
  ctx.shadowBlur = 4;
  for (const pane of frame.panes) {
    if (pane.height <= 0) continue;
    const rows = legendEntries(pane, frame.index, settings, frame.idle).map(({ entry }) => rowRuns(ctx, entry, theme, font));
    const total = rows.length * step - 2;
    const inset = edgeInset(frame, pane);
    const top = bottom ? pane.top + pane.height - inset - total : pane.top + inset;
    // The last run's gap is trailing space, not part of the row.
    const widths = rows.map((runs) => runs.reduce((w, r) => w + r.width + r.gap, 0) - (runs[runs.length - 1]?.gap ?? 0));
    const fill = rows.length > 0 ? backdropOf(settings, pane, theme) : '';
    if (fill) {
      const width = Math.max(...widths);
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect((right ? frame.plotRight - 10 - width : frame.plotLeft + 10) - BACKDROP_PAD, top - BACKDROP_PAD, width + 2 * BACKDROP_PAD, total + 2 * BACKDROP_PAD, BACKDROP_PAD);
      ctx.fill();
      ctx.restore();
    }
    let y = top + (step - 2) / 2;
    for (const [k, runs] of rows.entries()) {
      const width = widths[k]!;
      let x = right ? frame.plotRight - 10 - width : frame.plotLeft + 10;
      for (const run of runs) {
        ctx.font = run.font;
        ctx.fillStyle = run.color;
        fillNumerals(ctx, run.text, x, y, font.numerals);
        x += run.width + run.gap;
      }
      y += step;
    }
  }
  ctx.restore();
}

interface Run {
  text: string;
  font: string;
  color: string;
  width: number;
  /** Space after the run. */
  gap: number;
}

/** A legend row as measured text runs, laid out like the DOM row. */
function rowRuns(ctx: CanvasRenderingContext2D, entry: LegendEntry, theme: ChartTheme, legendFont: ResolvedFont): Run[] {
  const runs: Run[] = [];
  const add = (text: string, color: string, gap: number, weight = legendFont.fontWeight) => {
    const font = `${weight} ${legendFont.fontSize}px ${legendFont.fontFamily}`;
    ctx.font = font;
    runs.push({ text, font, color, width: measureNumerals(ctx, text, legendFont.numerals), gap });
  };
  if (entry.title) add(entry.title, theme.text, 4 + 8, 600);
  for (const part of entry.parts) {
    if (part.label) add(part.label, theme.textMuted, 2);
    add(part.text, part.color ?? theme.text, 8);
  }
  return runs;
}
