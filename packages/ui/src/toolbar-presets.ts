import {
  englishLocalizer,
  Indicator,
  isActivityInterval,
  parseInterval,
  toCSV,
  type CandleSeriesOptions,
  type CandleStyle,
  type Chart,
  type CompareMode,
  type ComparePair,
  type CompareStyle,
  type CsvExportOptions,
  type Interval,
  type Pane,
  type ScreenshotOptions,
  type Series,
  type SymbolInfo,
  type Time,
} from '@charton/core';
import { Camera, Eye, EyeOff, FileSpreadsheet, GitCompareArrows, LayoutGrid, Maximize, PanelLeft, Printer, Redo2, Search, Undo2 } from 'lucide';
import { captureMissing } from './clipboard';
import type { MenuOption } from './controls';
import type { IconSource } from './dom';
import { chartGridLayouts, gridOf, type ChartGridLayout } from './grid';
import { chartTypeIcons } from './icons';
import { defaultShellMessages, keyOf, labelOf, shellText, type ShellMessageKey } from './messages';
import { printChart, type PrintOptions } from './print';
import { shellPartsOf } from './shell';
import { ariaShortcut, shortcutText } from './shortcuts';
import type { ToolbarItem } from './toolbar';

/*
 * Ready-made toolbar items. Each preset returns a plain item; spread it to
 * override any field: `{ ...screenshot(), group: 'analysis' }`.
 */

/** A toolbar button item, the kind most presets return. */
export type ToolbarButtonItem = Extract<ToolbarItem, { type: 'button' }>;
/** A toolbar dropdown menu item, as `chartStyle`, `hideMenu` and `gridLayout` return. */
export type ToolbarMenuItem = Extract<ToolbarItem, { type: 'menu' }>;
/** A toolbar row of segmented buttons, as `intervals` returns by default. */
export type ToolbarSegmentedItem = Extract<ToolbarItem, { type: 'segmented' }>;
/** A toolbar item that renders its own content, as `favoriteIntervals` and `favoriteChartStyles` return. */
export type ToolbarCustomItem = Extract<ToolbarItem, { type: 'custom' }>;

/** Options for the `intervals` preset: its id and label, button row or menu, the starting value, interval text, and how a picked interval is applied. */
export interface IntervalsPresetOptions {
  /** Default `'interval'`. */
  id?: string;
  /** Accessible name. Default `'Interval'`. */
  label?: string;
  /** A row of buttons (default, collapses into a menu when narrow) or always a menu. */
  display?: 'segmented' | 'menu';
  /** Shown before the chart has loaded anything. Default the first entry. */
  value?: Interval;
  /**
   * Text for each interval. Default the interval itself, e.g. `15m`, and for
   * trade and volume intervals text in the chart's language, e.g. "100 trades"
   * and "5K volume".
   */
  format?: (interval: Interval) => string;
  /**
   * Switch to the picked interval. Default: reload the data source's current
   * symbol at it (`chart.setSymbol`); does nothing before the first `setSymbol`.
   */
  onChange?: (interval: Interval, chart: Chart) => void;
}

/**
 * Interval switcher in the `context` group. It follows the interval the data
 * source loaded (`interval:change`), including a fallback to the nearest
 * supported one. Charts fed with `setData` pass their own `onChange`.
 *
 * Trade and volume intervals (`100T`, `5000V`) sit under their own "Ticks"
 * and "Volume" headings in the menu form. On a chart with a data source they
 * show only while the current symbol lists them in its `intervals`.
 */
export function intervals(list: readonly Interval[], options: IntervalsPresetOptions = {}): ToolbarSegmentedItem | ToolbarMenuItem {
  const onChange = options.onChange ?? switchInterval;
  const common = {
    id: options.id ?? 'interval',
    group: 'context' as const,
    label: options.label ?? defaultShellMessages.toolbarInterval,
    labelKey: options.label === undefined ? 'toolbarInterval' : undefined,
    options: list.map((interval) => intervalOption(interval, options.format)),
    value: options.value ?? list[0] ?? '',
    currentValue: (chart: Chart) => chart.data?.requested?.interval,
    isOptionHidden: (value: string, chart: Chart) =>
      isActivityInterval(value) && !!chart.data && !chart.data.supportedIntervals?.includes(value as Interval),
    watch: (chart: Chart, refresh: () => void) => {
      // A newly loaded symbol may list other trade and volume intervals.
      const offs = [chart.on('interval:change', refresh), chart.on('data:loaded', refresh)];
      return () => offs.forEach((off) => off());
    },
  };
  const pick = (value: string, chart: Chart) => onChange(value as Interval, chart);
  if (options.display === 'menu') return { ...common, type: 'menu', onSelect: pick };
  return { ...common, type: 'segmented', onChange: pick };
}

/** Label and menu heading keys of trade (`T`) and volume (`V`) intervals. */
const ACTIVITY_KEYS = {
  T: ['intervalTrades', 'intervalTicks'],
  V: ['intervalVolumeOf', 'intervalVolume'],
} as const;

/** Internal: one option of the `intervals` preset; trade and volume intervals get their text and heading in the chart's language. */
export function intervalOption(interval: Interval, format: ((interval: Interval) => string) | undefined): MenuOption {
  if (!isActivityInterval(interval)) return { value: interval, label: format ? format(interval) : interval };
  const { count, unit } = parseInterval(interval);
  const [key, sectionKey] = ACTIVITY_KEYS[unit as keyof typeof ACTIVITY_KEYS];
  const labelKey = unit === 'T' && count === 1 ? 'intervalTrade' : key;
  const labelParams = { count: new Intl.NumberFormat(undefined, { notation: 'compact' }).format(count) };
  const label = format ? format(interval) : englishLocalizer.text(labelKey, labelParams, defaultShellMessages[labelKey]);
  return { value: interval, label, labelKey: format ? undefined : labelKey, labelParams, section: defaultShellMessages[sectionKey], sectionKey };
}

/** Internal: the `intervals` preset's default `onChange`. */
export function switchInterval(interval: Interval, chart: Chart): void {
  const requested = chart.data?.requested;
  if (!requested || requested.interval === interval) return;
  // A failed load is reported through `data:error` and the pane status; core
  // leaves the rejection unhandled only when nothing listens there.
  void chart.setSymbol(requested.symbol, interval);
}

/** Options of the `symbolHeader` toolbar preset. */
export interface SymbolHeaderPresetOptions {
  /** Default `'symbol'`. */
  id?: string;
  /** Text for the symbol. Default its `name`. */
  format?: (info: SymbolInfo) => string;
  /** Smaller text after it. Default the `exchange`; return undefined for none. */
  detail?: (info: SymbolInfo) => string | undefined;
}

/** The `chart.actions` id of the symbol search shortcut, registered by the shell. */
const SYMBOL_SEARCH_ACTION = 'symbol-search';

/** The symbol each chart's header shows: the one loading or loaded. Kept by the headers' `watch`. */
const headerSymbols = new WeakMap<Chart, SymbolInfo | null>();

/** A symbol still loading: only its key is known so far. */
const loadingSymbol = (symbol: string): SymbolInfo => ({ symbol, name: symbol });

const shownSymbol = (chart: Chart) => (headerSymbols.has(chart) ? headerSymbols.get(chart)! : (chart.data?.symbol ?? null));

/**
 * Symbol header in the `context` group: shows the chart's symbol and
 * exchange and opens the shell's symbol search. It follows `symbol:change`
 * at once, then the symbol the data source resolved (a cached snapshot's,
 * then the load's), so a source that falls back to another symbol shows that
 * one. Disabled in a shell without `symbolSearch`. Put it first in the list.
 */
export function symbolHeader(options: SymbolHeaderPresetOptions = {}): ToolbarButtonItem {
  const format = options.format ?? ((info: SymbolInfo) => info.name);
  const detail = options.detail ?? ((info: SymbolInfo) => info.exchange);
  return {
    type: 'button',
    id: options.id ?? 'symbol',
    group: 'context',
    ...labelOf('actionSymbolSearch'),
    icon: Search,
    popup: 'dialog',
    onClick: (chart) => shellPartsOf(chart)?.symbolSearch?.open(),
    isDisabled: (chart) => !shellPartsOf(chart)?.symbolSearch,
    content(chart) {
      const action = chart.actions.get(SYMBOL_SEARCH_ACTION);
      const search = action?.label ?? shellText(chart, 'actionSymbolSearch');
      const [first] = action?.keys ?? [];
      const keys = action?.keys.length ? action.keys.map(ariaShortcut).join(' ') : undefined;
      const tip = first ? `${search} (${shortcutText(first)})` : search;
      const info = shownSymbol(chart);
      const text = info ? format(info) : shellText(chart, 'symbolHeaderEmpty');
      const extra = info ? detail(info) : undefined;
      // The accessible name starts with the visible text, so voice control finds the button by what it shows.
      const visible = extra ? `${text} ${extra}` : text;
      return { text, detail: extra, label: shellText(chart, 'symbolHeaderLabel', { text: visible }), tip, keys };
    },
    watch(chart, refresh) {
      // Start from what the chart has now; a load in flight before the first one landed shows its key.
      const requested = chart.data?.requested;
      headerSymbols.set(chart, chart.data?.symbol ?? (requested ? loadingSymbol(requested.symbol) : null));
      const show = (info: SymbolInfo | null) => {
        headerSymbols.set(chart, info);
        refresh();
      };
      const offs = [
        chart.on('symbol:change', ({ symbol }) => show(loadingSymbol(symbol))),
        chart.on('data:snapshot', ({ symbol }) => show(symbol)),
        chart.on('data:loaded', ({ symbol, kind }) => kind === 'initial' && show(symbol)),
        // A failed switch keeps what is on screen: a snapshot it painted, else the symbol loaded before (or none).
        chart.on('data:error', ({ kind }) => {
          if (kind === 'initial' && !chart.data?.showingSnapshot) show(chart.data?.symbol ?? null);
        }),
        chart.on('localization:change', refresh),
        chart.actions.on('actions:change', refresh),
      ];
      return () => offs.forEach((off) => off());
    },
  };
}

/** One entry of the `chartStyle` menu. */
export interface ChartStyleOption {
  /** Menu value; also the `style` applied when `options` is left out. */
  value: string;
  label: string;
  /** Message key for `label`, so the menu follows the chart's language (see `ToolbarItem.labelKey`). */
  labelKey?: ShellMessageKey | (string & {});
  icon?: IconSource;
  /**
   * Main series options for this entry, for variants of one style (candles
   * with outlines only, say). Default `{ style: value }`.
   */
  options?: Partial<CandleSeriesOptions>;
  /** Heading of the menu section this entry is in, shown above it when it differs from the previous entry's. */
  section?: string;
  /** Message key for `section`, as `labelKey` is for `label`. */
  sectionKey?: ShellMessageKey | (string & {});
}

/**
 * The built-in candle styles for time bars, in menu order (#861), labelled by
 * their `defaultShellMessages` keys, `chartStyle<Style>`, under
 * `chartStyleSection<Section>` headings. Sections group the styles by the
 * prices they draw: all four, the high-low range, or the close alone. Within a
 * section, candles come first as the default, then the style that shows the
 * most values of a bar, and styles that show as many by English label. A
 * style's count is the bar's own open, high, low, close and volume it draws,
 * plus the price its colour compares the close with when it does not draw that
 * price itself (the previous close for `hollow` and `columns`, the open for
 * `hlcBars`, the base level for `baseline`); Heikin Ashi draws averages, none
 * of the bar's own values. `toolbar-presets.test.ts` checks the order against
 * this rule.
 */
export const chartStyles: readonly ChartStyleOption[] = (
  [
    ['ohlc', ['candles', 'hollow', 'volumeCandles', 'bars', 'heikinAshi']],
    ['range', ['hlcBars', 'rangeBand', 'highLow']],
    ['close', ['baseline', 'columns', 'area', 'line', 'lineMarkers', 'step']],
  ] satisfies [string, CandleStyle[]][]
).flatMap(([section, values]) => {
  const sectionKey = keyOf('chartStyleSection', section);
  return values.map((value) => ({ value, ...labelOf(keyOf('chartStyle', value)), icon: chartTypeIcons[value], section: defaultShellMessages[sectionKey], sectionKey }));
});

/**
 * Chart type menu in the `context` group: applies the entry's options to the
 * main series (`chart.main`) and follows style changes made elsewhere.
 */
export function chartStyle(styles: readonly ChartStyleOption[] = chartStyles): ToolbarMenuItem {
  const pick = stylePicker(styles);
  return {
    type: 'menu',
    id: 'style',
    group: 'context',
    ...labelOf('toolbarChartType'),
    options: [...styles],
    value: pick.initial,
    onSelect: pick.select,
    currentValue: pick.current,
    watch: (chart, refresh) => chart.on('series:options', ({ series }) => series === chart.main && refresh()),
  };
}

/** Internal: applying `styles` entries to the main series, and which entry it shows now. */
export function stylePicker(styles: readonly ChartStyleOption[]) {
  // The last entry picked here, so a variant stays selected while the series keeps its style.
  let picked: ChartStyleOption | undefined;
  const styleOf = (entry: ChartStyleOption) => entry.options?.style ?? entry.value;
  return {
    // The main series starts as candles; `current` corrects this once the chart has one.
    initial: styles.find((s) => styleOf(s) === 'candles')?.value ?? styles[0]?.value,
    select(value: string, chart: Chart): void {
      const entry = styles.find((s) => s.value === value);
      if (!entry || !chart.main) return;
      picked = entry;
      chart.main.applyOptions(entry.options ?? { style: entry.value as CandleStyle });
    },
    current(chart: Chart): string | undefined {
      const style = chart.main?.options.style;
      if (style === undefined) return undefined;
      if (picked && styleOf(picked) === style) return picked.value;
      return styles.find((s) => styleOf(s) === style)?.value;
    },
  };
}

/** Options for the `screenshot` preset: the image options of `chart.captureImage` plus the downloaded file's name. */
export interface ScreenshotPresetOptions extends ScreenshotOptions {
  /** File name; a function gets the chart. Default `chart.png` (or `.jpg`/`.webp` for those types). */
  filename?: string | ((chart: Chart) => string);
}

/**
 * Button in the `view` group that downloads an image of the chart (`chart.captureImage`).
 * Needs the `imageCapture()` plugin, which the UI shell adds; without it a click shows an
 * error notification.
 */
export function screenshot(options: ScreenshotPresetOptions = {}): ToolbarButtonItem {
  const { filename, ...shot } = options;
  return {
    type: 'button',
    id: 'screenshot',
    group: 'view',
    ...labelOf('toolbarDownloadImage'),
    icon: Camera,
    onClick(chart) {
      const name = typeof filename === 'function' ? filename(chart) : (filename ?? `chart.${extension(shot.type)}`);
      let image: Promise<Blob | null>;
      try {
        image = chart.captureImage(shot);
      } catch (error) {
        // A chart without the imageCapture() plugin.
        chart.notify({ message: shellText(chart, captureMissing(error) ? 'toolbarCaptureUnavailable' : 'toolbarCaptureFailed'), kind: 'error' });
        return;
      }
      void image.then((blob) => {
        if (blob) downloadBlob(blob, name);
        else chart.notify({ message: shellText(chart, 'toolbarCaptureFailed'), kind: 'error' });
      });
    },
  };
}

/** Options for the `print` preset: the same as `printChart` takes. */
export interface PrintPresetOptions extends PrintOptions {}

/**
 * Button in the `view` group that prints the chart (`printChart`): a light, captioned image by
 * default. Needs the `imageCapture()` plugin, which the UI shell adds; without it a click shows
 * an error notification.
 */
export function print(options: PrintPresetOptions = {}): ToolbarButtonItem {
  return {
    type: 'button',
    id: 'print',
    group: 'view',
    ...labelOf('toolbarPrint'),
    icon: Printer,
    onClick(chart) {
      printChart(chart, options).catch((error: unknown) =>
        chart.notify({ message: shellText(chart, captureMissing(error) ? 'toolbarCaptureUnavailable' : 'toolbarPrintFailed'), kind: 'error' }),
      );
    },
  };
}

/** Options for the `downloadData` preset: the file name, the time column format and the range of rows exported. */
export interface DownloadDataPresetOptions {
  /** File name; a function gets the chart. Default `chart.csv`. */
  filename?: string | ((chart: Chart) => string);
  /** Time column format (see `toCSV`). Default `'iso'`, in the chart timezone (`chart.zone`). */
  time?: CsvExportOptions['time'];
  /** Rows to export. Default the visible range (see `chart.getDataTable`). */
  range?: { from: Time; to: Time };
}

/**
 * Button in the `view` group that downloads the chart's data as CSV
 * (`chart.getDataTable` and `toCSV`), with ISO dates and times in the chart
 * timezone so spreadsheets read them as dates.
 */
export function downloadData(options: DownloadDataPresetOptions = {}): ToolbarButtonItem {
  return {
    type: 'button',
    id: 'download-data',
    group: 'view',
    ...labelOf('toolbarDownloadData'),
    icon: FileSpreadsheet,
    onClick(chart) {
      const data = chart.getDataTable(options.range);
      if (data.rows.length === 0) {
        chart.notify({ message: shellText(chart, 'toolbarNoData'), kind: 'error' });
        return;
      }
      const csv = toCSV(data, { time: options.time ?? 'iso', timezone: chart.zone.name });
      const name = typeof options.filename === 'function' ? options.filename(chart) : (options.filename ?? 'chart.csv');
      downloadBlob(new Blob([csv], { type: 'text/csv' }), name);
    },
  };
}

function extension(type: ScreenshotOptions['type']): string {
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/webp') return 'webp';
  return 'png';
}

/** Save `blob` through a temporary download link. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoke after the click has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Options for the `fullscreen` preset: which element goes full screen. */
export interface FullscreenPresetOptions {
  /** Element to show full screen. Default the shell around the chart, else the chart's root. */
  target?: (chart: Chart) => HTMLElement;
}

/** Button in the `view` group that shows the shell full screen, or leaves full screen. */
export function fullscreen(options: FullscreenPresetOptions = {}): ToolbarButtonItem {
  const target = options.target ?? ((chart: Chart) => shellPartsOf(chart)?.el ?? chart.root);
  return {
    type: 'button',
    id: 'fullscreen',
    group: 'view',
    ...labelOf('toolbarFullScreen'),
    icon: Maximize,
    onClick(chart) {
      if (document.fullscreenElement) void document.exitFullscreen();
      // Rejects when the browser refuses (no user gesture, or not allowed in this frame).
      else void target(chart).requestFullscreen();
    },
    isActive: (chart) => document.fullscreenElement === target(chart),
    isDisabled: () => !document.fullscreenEnabled,
    watch(_, refresh) {
      document.addEventListener('fullscreenchange', refresh);
      return () => document.removeEventListener('fullscreenchange', refresh);
    },
  };
}

/** Button in the `view` group that shows or hides the shell's rail. */
export function toggleRail(): ToolbarButtonItem {
  return {
    type: 'button',
    id: 'toggle-rail',
    group: 'view',
    ...labelOf('toolbarDrawingTools'),
    icon: PanelLeft,
    onClick: (chart) => shellPartsOf(chart)?.rail?.toggle(),
    // The shell refreshes the toolbar whenever the rail is shown or hidden.
    isActive: (chart) => shellPartsOf(chart)?.rail?.visible ?? false,
    isDisabled: (chart) => !shellPartsOf(chart)?.rail,
  };
}

/** Undo and redo buttons for the chart's undo history (drawings and indicators), in the `view` group; spread them into the list. */
export function undoRedo(): [ToolbarButtonItem, ToolbarButtonItem] {
  const watch = (chart: Chart, refresh: () => void) => chart.on('history:change', refresh);
  return [
    {
      type: 'button',
      id: 'undo',
      group: 'view',
      ...labelOf('historyUndo'),
      icon: Undo2,
      onClick: (chart) => chart.history.undo(),
      isDisabled: (chart) => !chart.history.canUndo,
      watch,
    },
    {
      type: 'button',
      id: 'redo',
      group: 'view',
      ...labelOf('historyRedo'),
      icon: Redo2,
      onClick: (chart) => chart.history.redo(),
      isDisabled: (chart) => !chart.history.canRedo,
      watch,
    },
  ];
}

/** What `toggleVisibility` shows and hides: a series, an indicator, a pane, one drawing by id, or `'drawings'` for all. */
export type VisibilityTarget = Series | Indicator | Pane | string;

/** Options for the `toggleVisibility` preset: the item's id, accessible name, icon and visible text. */
export interface ToggleVisibilityOptions {
  /** Default `'drawings-visibility'` for all drawings, else `visibility-` plus a counter. Pass one to find the item later. */
  id?: string;
  /**
   * Accessible name. Default "Show or hide" and the target's name, in the
   * chart's language (`toolbarToggleVisibility`, or `toolbarToggleDrawings`
   * for all drawings).
   */
  label?: string;
  icon?: IconSource;
  /** Visible text beside the icon. */
  text?: string;
}

let visibilityCount = 0;

/**
 * Button that shows or hides `target`; it is pressed while the target is
 * visible. The state follows changes made elsewhere (a legend's eye button,
 * a settings dialog, the rail's hide-all button, `chart.setPaneHidden`).
 * A pane target cannot be the main pane, which never hides.
 */
export function toggleVisibility(target: VisibilityTarget, options: ToggleVisibilityOptions = {}): ToolbarButtonItem {
  const access = visibilityAccess(target);
  const all = target === 'drawings';
  const params = all ? undefined : { name: access.name };
  const key = all ? 'toolbarToggleDrawings' : 'toolbarToggleVisibility';
  return {
    type: 'button',
    id: options.id ?? (all ? 'drawings-visibility' : `visibility-${++visibilityCount}`),
    label: options.label ?? shellText(null, key, params),
    ...(options.label === undefined && { labelKey: key, labelParams: params }),
    icon: options.icon ?? Eye,
    ...(options.text !== undefined && { text: options.text }),
    onClick: (chart) => access.set(chart, !access.get(chart)),
    isActive: (chart) => access.get(chart),
    watch: access.watch,
  };
}

interface VisibilityAccess {
  name: string;
  get(chart: Chart): boolean;
  set(chart: Chart, visible: boolean): void;
  watch(chart: Chart, refresh: () => void): () => void;
}

function visibilityAccess(target: VisibilityTarget): VisibilityAccess {
  if (target === 'drawings') {
    return {
      name: 'drawings',
      get: (chart) => !chart.drawings.hidden,
      set: (chart, visible) => chart.drawings.setHidden(!visible),
      watch: (chart, refresh) => chart.on('drawings:visibility', refresh),
    };
  }
  if (typeof target === 'string') {
    const find = (chart: Chart) => chart.drawings.getAll().find((d) => d.id === target);
    return {
      name: 'drawing',
      get: (chart) => {
        const drawing = find(chart);
        return drawing !== undefined && !drawing.hidden;
      },
      set: (chart, visible) => {
        if (find(chart)) chart.drawings.setVisible(target, visible);
      },
      watch: (chart, refresh) => chart.on('drawings:change', refresh),
    };
  }
  if (target instanceof Indicator) {
    return {
      name: target.def?.name ?? target.type,
      get: () => target.visible,
      set: (_, visible) => target.setVisible(visible),
      watch: (chart, refresh) => chart.on('indicator:change', ({ indicator }) => indicator === target && refresh()),
    };
  }
  // `Pane` is a type on the root entry, so tell it from a series by its shape.
  if ('stretch' in target) {
    const pane = target;
    return {
      name: 'pane',
      get: () => !pane.hidden,
      set: (chart, visible) => chart.setPaneHidden(pane, !visible),
      watch: (chart, refresh) => chart.on('panes:change', refresh),
    };
  }
  const series = target;
  return {
    name: (series.options as { title?: string }).title ?? 'series',
    get: () => series.visible,
    set: (_, visible) => series.setVisible(visible),
    watch: (chart, refresh) => chart.on('series:visibility', (e) => e.series === series && refresh()),
  };
}

/** Options for the `compare` preset: how the compared symbol is drawn (see `chart.compare`). */
export interface ComparePresetOptions {
  /** How the symbol is drawn; see `chart.compare`. Default `'percent'`. */
  mode?: CompareMode;
  style?: CompareStyle;
}

/** What `compare` asks for: a symbol or pair to compare, or null (or undefined) to do nothing. */
export type ComparePick = (chart: Chart) => string | ComparePair | null | undefined | Promise<string | ComparePair | null | undefined>;

/**
 * Button in the `analysis` group that compares another symbol: `pick` names
 * it (open a symbol search, say), then `chart.compare` plots it. Pressed
 * while any symbol is compared; a symbol that is already compared, or a
 * chart without a data source, shows a notification.
 */
export function compare(pick: ComparePick, options: ComparePresetOptions = {}): ToolbarButtonItem {
  return {
    type: 'button',
    id: 'compare',
    group: 'analysis',
    ...labelOf('toolbarCompare'),
    icon: GitCompareArrows,
    onClick(chart) {
      void Promise.resolve(pick(chart)).then((what) => {
        if (!what) return;
        try {
          chart.compare(what, options);
        } catch (error) {
          chart.notify({ message: error instanceof Error ? error.message : String(error), kind: 'error' });
        }
      });
    },
    isActive: (chart) => chart.compared.length > 0,
    watch(chart, refresh) {
      // A compared symbol joins `chart.compared` just after its series is announced.
      const later = () => queueMicrotask(refresh);
      const offAdd = chart.on('series:add', later);
      const offRemove = chart.on('series:remove', later);
      return () => {
        offAdd();
        offRemove();
      };
    },
  };
}

/** Indicators each chart's hide menu hid, so showing them again leaves ones hidden elsewhere alone. */
const hiddenByMenu = new WeakMap<Chart, Set<Indicator>>();

const drawingsHidden = (chart: Chart) => chart.actions.get('hide-drawings')?.checked ?? chart.drawings.hidden;

/** Whether every indicator is hidden; false with no indicators, so there is nothing to show. */
function indicatorsHidden(chart: Chart): boolean {
  const list = chart.indicators.getAll();
  return list.length > 0 && list.every((indicator) => !indicator.visible);
}

/** Drawings hidden and no indicator showing. */
const allHidden = (chart: Chart) => drawingsHidden(chart) && chart.indicators.getAll().every((indicator) => !indicator.visible);

function hideDrawings(chart: Chart, hidden: boolean): void {
  if (drawingsHidden(chart) === hidden) return;
  // Through the action, so the menu and the rail's hide-all button stay one command; an app may have removed it.
  if (!chart.actions.run('hide-drawings')) chart.drawings.setHidden(hidden);
}

function hideIndicators(chart: Chart, hidden: boolean): void {
  const list = chart.indicators.getAll();
  if (hidden) {
    const hid = hiddenByMenu.get(chart) ?? new Set();
    hiddenByMenu.set(chart, hid);
    for (const indicator of list) {
      if (!indicator.visible) continue;
      hid.add(indicator);
      indicator.setVisible(false);
    }
    return;
  }
  const hid = hiddenByMenu.get(chart);
  hiddenByMenu.delete(chart);
  // When the menu hid none of them, they were hidden elsewhere: show them all.
  const shown = hid && list.some((indicator) => hid.has(indicator)) ? list.filter((indicator) => hid.has(indicator)) : list;
  for (const indicator of shown) indicator.setVisible(true);
}

/**
 * Menu in the `view` group with checked entries that hide every drawing
 * (the `hide-drawings` action, shared with the rail), every indicator, or
 * both (`all`). Showing indicators again restores only the ones the menu hid.
 */
export function hideMenu(): ToolbarMenuItem {
  return {
    type: 'menu',
    id: 'hide',
    group: 'view',
    ...labelOf('toolbarHide'),
    icon: EyeOff,
    options: [
      { value: 'drawings', ...labelOf('toolbarHideDrawings') },
      { value: 'indicators', ...labelOf('toolbarHideIndicators') },
      { value: 'all', ...labelOf('toolbarHideAll') },
    ],
    onSelect(value, chart) {
      if (value === 'drawings') hideDrawings(chart, !drawingsHidden(chart));
      else if (value === 'indicators') hideIndicators(chart, !indicatorsHidden(chart));
      else if (value === 'all') {
        const hide = !allHidden(chart);
        hideDrawings(chart, hide);
        hideIndicators(chart, hide);
      }
    },
    isChecked(value, chart) {
      if (value === 'drawings') return drawingsHidden(chart);
      if (value === 'indicators') return indicatorsHidden(chart);
      return allHidden(chart);
    },
  };
}

/**
 * Layout menu for a chart grid's toolbar (`createChartGrid`'s `toolbar`), in
 * the `view` group: switches the grid's preset and follows `layout:change`.
 * Default every preset in `chartGridLayouts`. Outside a grid it does nothing.
 */
export function gridLayout(layouts: readonly ChartGridLayout[] = Object.keys(chartGridLayouts) as ChartGridLayout[]): ToolbarMenuItem {
  return {
    type: 'menu',
    id: 'layout',
    group: 'view',
    ...labelOf('toolbarLayout'),
    icon: LayoutGrid,
    options: layouts.map((value) => {
      const { columns, rows } = chartGridLayouts[value];
      return { value, label: `${columns} × ${rows}` };
    }),
    value: layouts[0],
    onSelect: (value, chart) => gridOf(chart)?.setLayout(value as ChartGridLayout),
    currentValue: (chart) => gridOf(chart)?.layout,
    watch: (chart, refresh) => gridOf(chart)?.on('layout:change', refresh),
  };
}
