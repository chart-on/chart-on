import type { Chart, PriceScaleSettings } from './chart';
import type { Interval } from './data/types';
import { isInterval } from './data/interval';
import type { DrawingStyle, SerializedDrawings } from './drawing/types';
import type { Indicator } from './indicators/indicator';
import { parseIndicatorStates } from './indicators/state';
import type { IndicatorState } from './indicators/types';
import type { Pane } from './pane';
import { autoscaleRuleError, isPercentBase, type PriceScale, type PriceScaleMode, type PriceScaleSide } from './scales';
import type { BaseLevel, CandleSeriesOptions, CandleStyle } from './series';
import type { Time } from './types';
import { isNumber, isRecord, isText, migrateVersions } from './util/records';
import { errorText } from './errors';
import { notInstalled } from './registry';
import { devWarn, isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Version `serializeLayout()` writes. */
export const LAYOUT_VERSION = 1;

/** App metadata saved with a layout. Times are unix seconds; other fields are kept as they are. */
export interface LayoutMeta {
  name?: string;
  createdAt?: Time;
  /** Set by `serializeLayout` to the time of saving, unless given. */
  updatedAt?: Time;
  [key: string]: unknown;
}

/** One price scale of a saved pane. */
export interface LayoutPriceScale extends PriceScaleSettings {
  /** The price range shown, saved only while `autoScale` is off. */
  range?: { min: number; max: number };
}

/** One saved pane, in display order. */
export interface LayoutPane {
  /** Height weight, as `getPaneHeights` reports it. */
  height: number;
  collapsed?: boolean;
  /** Hidden with `chart.setPaneHidden`. */
  hidden?: boolean;
  /** Price scales by id (`'right'`, `'left'` or an app's own). */
  scales: Record<string, LayoutPriceScale>;
}

/** Main series options a layout keeps: the chart type and how it is drawn. */
export type LayoutMainSeries = Partial<
  Pick<
    CandleSeriesOptions,
    | 'style'
    | 'upColor'
    | 'downColor'
    | 'upWickColor'
    | 'downWickColor'
    | 'upBorderColor'
    | 'downBorderColor'
    | 'wicks'
    | 'borders'
    | 'colorByPreviousClose'
    | 'thinBars'
    | 'bodyRatio'
    | 'lineWidth'
    | 'lineStyle'
    | 'baseLevel'
  >
>;

/**
 * A saved chart layout: what the user arranged, never the bars. Every part
 * but `version` is optional when loading; a missing part leaves that part of
 * the chart as it is.
 */
export interface ChartLayout {
  version: typeof LAYOUT_VERSION;
  meta?: LayoutMeta;
  /** Symbol id (not its display name) loaded through the data source. */
  symbol?: string;
  interval?: Interval;
  mainSeries?: LayoutMainSeries;
  panes?: LayoutPane[];
  /** Index of the maximized pane, when one is. */
  maximizedPane?: number;
  /** Indicator states; each one's `pane` is its index in `panes`. */
  indicators?: IndicatorState[];
  drawings?: SerializedDrawings;
  /**
   * The style new drawings of each tool start with, by tool type, as
   * `chart.drawings.serializeToolDefaults()` reports it. Saved with or
   * without `drawings`.
   */
  toolDefaults?: Record<string, DrawingStyle>;
  /** Saved only with `serializeLayout({ visibleRange: true })`. */
  visibleRange?: { from: Time; to: Time };
}

/** Options for `serializeLayout`: whether to include drawings and the visible range, and metadata to save. */
export interface LayoutSerializeOptions {
  /** Include the drawings. Default true; turn off when the app stores drawings elsewhere (e.g. per symbol). */
  drawings?: boolean;
  /** Include the visible time range. Default false. */
  visibleRange?: boolean;
  /** Metadata to save, e.g. `{ name, createdAt }`. `updatedAt` defaults to now. */
  meta?: LayoutMeta;
}

/**
 * Turns a saved payload of `fromVersion` into one `loadLayout` understands:
 * the current version, or an older one the built-in steps continue from.
 */
export type LayoutMigration = (data: Record<string, unknown>, fromVersion: unknown) => unknown;

/** Options for `loadLayout`: an upgrade for older payload versions, and whether to load the saved symbol. */
export interface LayoutLoadOptions {
  /** Upgrades payloads of a version the built-in steps don't cover, e.g. an app's own older format. */
  migrate?: LayoutMigration;
  /** Load the saved symbol and interval through the data source (when one is set). Default true. */
  symbol?: boolean;
}

/** A part of a layout that could not be restored, e.g. `panes[1].scales.left` or `mainSeries.upColor`. */
export interface LayoutLoadError {
  part: string;
  reason: string;
}

/** What `loadLayout` restored: parts it could not restore, saved metadata, unknown fields, and a promise for when the symbol is ready. */
export interface LayoutLoadResult {
  /** Parts skipped or replaced by defaults; everything else loaded. */
  errors: LayoutLoadError[];
  meta: LayoutMeta | null;
  /** Top-level fields this version does not know. They are kept and written back by `serializeLayout`. */
  unknown: string[];
  /**
   * Settles once the saved symbol has loaded and the saved view is applied;
   * rejects when loading fails. Null when no symbol was loaded.
   */
  ready: Promise<void> | null;
}

/** Built-in upgrades: `MIGRATIONS[v]` turns a version `v` payload into version `v + 1`. */
const MIGRATIONS: Record<number, LayoutMigration> = {};

const KNOWN_KEYS = new Set([
  'version',
  'meta',
  'symbol',
  'interval',
  'mainSeries',
  'panes',
  'maximizedPane',
  'indicators',
  'drawings',
  'toolDefaults',
  'visibleRange',
]);

const CANDLE_STYLES: Record<CandleStyle, true> = {
  candles: true,
  hollow: true,
  volumeCandles: true,
  bars: true,
  hlcBars: true,
  heikinAshi: true,
  highLow: true,
  columns: true,
  line: true,
  lineMarkers: true,
  step: true,
  area: true,
  rangeBand: true,
  baseline: true,
  kagi: true,
  pointFigure: true,
};

/** Main series keys a layout resets when it leaves them out; the others keep their value. */
const OPTIONAL_STYLE_KEYS = [
  'upColor',
  'downColor',
  'upWickColor',
  'downWickColor',
  'upBorderColor',
  'downBorderColor',
  'wicks',
  'borders',
  'colorByPreviousClose',
  'thinBars',
  'lineStyle',
  'baseLevel',
] as const;

/** Why `value` cannot be main series option `key`, or null when it can. */
function styleProblem(key: keyof LayoutMainSeries, value: unknown): string | null {
  switch (key) {
    case 'style':
      return typeof value === 'string' && Object.hasOwn(CANDLE_STYLES, value) ? null : 'unknown chart type';
    case 'upColor':
    case 'downColor':
    case 'upWickColor':
    case 'downWickColor':
    case 'upBorderColor':
    case 'downBorderColor':
      return typeof value === 'string' ? null : 'must be a colour string';
    case 'wicks':
    case 'borders':
    case 'colorByPreviousClose':
    case 'thinBars':
      return typeof value === 'boolean' ? null : 'must be a boolean';
    case 'bodyRatio':
      return isNumber(value) && value > 0 && value <= 1 ? null : 'must be a number in (0, 1]';
    case 'lineWidth':
      return isNumber(value) && value > 0 ? null : 'must be a positive number';
    case 'lineStyle':
      return value === 'solid' || value === 'dashed' || value === 'dotted' ? null : 'must be solid, dashed or dotted';
    case 'baseLevel':
      return isBaseLevel(value) ? null : 'must be a base level';
  }
}

const STYLE_KEYS = ['style', 'bodyRatio', 'lineWidth', ...OPTIONAL_STYLE_KEYS] as const;

/** @internal Main series option keys a layout saves; changing one is a `state:change` with reason `'series'`. */
export const LAYOUT_STYLE_KEYS: ReadonlySet<string> = new Set(STYLE_KEYS);

function isBaseLevel(value: unknown): value is BaseLevel {
  if (!isRecord(value)) return false;
  if (value.kind === 'price') return isNumber(value.price);
  if (value.kind === 'height') return isNumber(value.percent);
  return value.kind === 'firstVisible';
}

/* ------------------------------- saving -------------------------------- */

/** @internal Implements `chart.serializeLayout`. */
export function serializeLayout(
  chart: Chart,
  extra: Readonly<Record<string, unknown>>,
  options: LayoutSerializeOptions = {},
): ChartLayout {
  const now = Math.floor(Date.now() / 1000);
  const meta: LayoutMeta = { ...options.meta, updatedAt: options.meta?.updatedAt ?? now };
  meta.createdAt ??= meta.updatedAt;
  const heights = chart.getPaneHeights();
  const maximized = chart.maximizedPane ? chart.panes.indexOf(chart.maximizedPane) : -1;
  const data = chart.data;
  const range = options.visibleRange ? chart.getVisibleRange() : null;
  const main = chart.main;
  const drawings = chart.drawingLayer;
  const indicators = chart.indicatorLayer;
  const layout: ChartLayout = {
    // Unknown fields from the last loaded layout first, so the known ones win.
    ...extra,
    version: LAYOUT_VERSION,
    meta,
    ...(data?.symbol ? { symbol: data.symbol.symbol } : {}),
    ...(data?.interval ? { interval: data.interval } : {}),
    ...(main ? { mainSeries: mainSeriesStyle(main.options) } : {}),
    panes: chart.panes.map((pane, i) => savePane(chart, i, heights[i]!)),
    ...(maximized >= 0 ? { maximizedPane: maximized } : {}),
    // A chart without the indicators or drawings plugin writes back what it loaded, untouched (kept in `extra`).
    ...(indicators ? { indicators: indicators.serialize() } : {}),
    ...(drawings && options.drawings !== false ? { drawings: drawings.serialize() } : {}),
    ...(drawings ? { toolDefaults: drawings.serializeToolDefaults() } : {}),
    ...(range ? { visibleRange: range } : {}),
  };
  if (options.drawings === false) delete layout.drawings;
  return layout;
}

function mainSeriesStyle(options: CandleSeriesOptions): LayoutMainSeries {
  const style: Record<string, unknown> = {};
  for (const key of STYLE_KEYS) {
    const value = options[key];
    if (value !== undefined) style[key] = isRecord(value) ? { ...value } : value;
  }
  return style as LayoutMainSeries;
}

function savePane(chart: Chart, index: number, height: number): LayoutPane {
  const pane = chart.panes[index]!;
  const scales: Record<string, LayoutPriceScale> = {};
  for (const { id } of pane.scales) {
    // A compared symbol's scale belongs to the comparison, not to the layout.
    if (id.startsWith('compare:')) continue;
    const settings: LayoutPriceScale = chart.getPriceScaleOptions(index, id)!;
    const range = settings.autoScale ? null : chart.getPriceRange(index, id);
    if (range) settings.range = { min: range.from, max: range.to };
    scales[id] = settings;
  }
  return { height, ...(pane.collapsed ? { collapsed: true } : {}), ...(pane.hidden ? { hidden: true } : {}), scales };
}

/* ------------------------------- loading ------------------------------- */

/**
 * Upgrade a saved layout to `current`, step by step through `steps`. A
 * version the steps don't cover goes through `hook` once, which may return
 * the current version or an older one the steps continue from. Throws when
 * the payload is not a layout object or no step or hook upgrades it.
 */
export function migrateLayout(
  data: unknown,
  current: number = LAYOUT_VERSION,
  steps: Readonly<Record<number, LayoutMigration>> = MIGRATIONS,
  hook: LayoutMigration | null = null,
): Record<string, unknown> {
  return migrateVersions(data, current, steps, hook, isRecord, 'invalid-layout', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Invalid layout: expected an object with a version' : '', 'Layout');
}

/** @internal What `loadLayout` returns plus the unknown fields for the chart to keep. */
export interface AppliedLayout {
  result: LayoutLoadResult;
  extra: Record<string, unknown>;
}

/** @internal What the `layouts()` plugin gives a chart: saving and restoring its layout. */
export interface LayoutsFeature {
  serialize: typeof serializeLayout;
  load: typeof loadLayout;
}

/** @internal Implements `chart.loadLayout`. */
export function loadLayout(chart: Chart, data: unknown, options: LayoutLoadOptions = {}): AppliedLayout {
  const layout = migrateLayout(data, LAYOUT_VERSION, MIGRATIONS, options.migrate ?? null);
  const errors: LayoutLoadError[] = [];
  const report = (part: string, reason: unknown) =>
    errors.push({ part, reason: errorText(reason) });

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(layout)) if (!KNOWN_KEYS.has(key)) extra[key] = value;
  // Known parts kept for a missing plugin join `extra` below, but are not unknown.
  const unknown = Object.keys(extra);

  let meta: LayoutMeta | null = null;
  if (isRecord(layout.meta)) meta = { ...layout.meta };
  else if (layout.meta !== undefined) report('meta', 'must be an object');

  if (layout.mainSeries !== undefined) loadMainSeries(chart, layout.mainSeries, report);

  // Indicators first: the panes are arranged around them.
  const states = layout.indicators !== undefined ? readIndicators(layout.indicators, report) : null;
  // A chart without indicators keeps the valid ones, and an empty pane where each sat, so its next
  // save does not lose them or their panes; an indicators plugin installed later loads them there.
  const kept = chart.indicatorLayer ? null : states;
  if (kept && kept.length > 0) {
    try {
      notInstalled('indicators', 'indicators()');
    } catch (err) {
      report('indicators', err);
    }
  }
  const restored = states && !kept ? loadIndicators(chart, states, report) : null;
  const keptPanes = new Set(kept?.map((state) => state.pane));
  const paneMap =
    layout.panes !== undefined ? loadPanes(chart, layout, restored, drawingPaneIndices(layout.drawings), keptPanes, report) : null;
  if (kept) extra.indicators = kept.map((state) => ({ ...state, pane: paneMap?.[state.pane] ?? state.pane }));

  // A chart without drawings keeps them as saved, so its next save does not lose them, and
  // reports them; a drawings plugin installed later loads them.
  if (!chart.drawingLayer) {
    if (layout.drawings !== undefined) extra.drawings = layout.drawings;
    if (layout.toolDefaults !== undefined) extra.toolDefaults = layout.toolDefaults;
  }
  if (layout.drawings !== undefined) {
    try {
      const loaded = chart.drawings.load(layout.drawings);
      for (const e of loaded.errors) report(`drawings[${e.index}]${e.field ? `.${e.field}` : ''}`, e.reason);
      if (paneMap) {
        const before = chart.drawings.getAll().length;
        const highest = chart.drawings.getAll().reduce((most, d) => Math.max(most, d.pane), -1);
        chart.drawings.remapPanes(Array.from({ length: highest + 1 }, (_, i) => paneMap[i] ?? -1));
        const dropped = before - chart.drawings.getAll().length;
        if (dropped > 0) report('drawings', `${dropped} drawing${dropped === 1 ? '' : 's'} on panes the layout does not have`);
      }
    } catch (err) {
      report('drawings', err);
    }
  }

  // Saved with every layout, so a chart without drawings skips them quietly; saved drawings report the missing plugin.
  if (layout.toolDefaults !== undefined && chart.drawingLayer) {
    try {
      for (const e of chart.drawings.loadToolDefaults(layout.toolDefaults)) {
        report(`toolDefaults.${e.tool}${e.field ? `.${e.field}` : ''}`, e.reason);
      }
    } catch (err) {
      report('toolDefaults', err);
    }
  }

  const manual = paneMap ? manualRanges(chart, layout.panes, paneMap) : [];
  const applyRanges = (report: Report | null) => {
    for (const { pane, scale, part, min, max } of manual) {
      const i = chart.panes.indexOf(pane);
      // The user may have rescaled meanwhile.
      if (i < 0 || scale.autoScale) continue;
      try {
        chart.setPriceRange({ from: min, to: max }, i, scale.id);
      } catch (err) {
        report?.(part, err);
      }
    }
  };

  let ready: Promise<void> | null = null;
  if (options.symbol !== false) ready = loadSymbol(chart, layout, report);
  const range = readRange(layout.visibleRange, report);
  if (range) chart.setVisibleTimeRange(range.from, range.to, false);
  // A visible range autoscales its pane, so manual ranges go on after it.
  applyRanges(report);
  if (ready) {
    // Another symbol or interval picked while this one loads keeps its own price ranges.
    let superseded = false;
    const off = chart.on('data:loading', ({ kind }) => {
      if (kind === 'initial') superseded = true;
    });
    ready = ready.finally(off).then(() => {
      if (!superseded) applyRanges(null);
    });
    // Failures are reported as `data:error` too; an app that ignores `ready` gets no unhandled rejection.
    ready.catch(() => {});
  }
  return { result: { errors, meta, unknown, ready }, extra };
}

type Report = (part: string, reason: unknown) => void;

function loadMainSeries(chart: Chart, raw: unknown, report: Report): void {
  const main = chart.main;
  if (!main) return report('mainSeries', 'the chart has no main series');
  if (!isRecord(raw)) return report('mainSeries', 'must be an object');
  const patch: Record<string, unknown> = {};
  // Left out means the default, so a saved plain style clears colours set before.
  for (const key of OPTIONAL_STYLE_KEYS) patch[key] = undefined;
  for (const key of STYLE_KEYS) {
    if (raw[key] === undefined) continue;
    const problem = styleProblem(key, raw[key]);
    if (!problem) patch[key] = raw[key];
    else {
      report(`mainSeries.${key}`, problem);
      // A style this version does not draw, such as `hlcArea` from before its rename to `rangeBand` (#861),
      // falls back to the default candles rather than keeping whatever the chart showed before.
      if (key === 'style') {
        patch.style = 'candles';
        if (/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') {
          devWarn(`the layout's chart style ${JSON.stringify(raw.style)} is unknown, so candles are drawn`, 'option-range');
        }
      }
    }
  }
  try {
    main.applyOptions(patch as Partial<CandleSeriesOptions>);
  } catch {
    // Find the value the series refused, and keep the rest.
    for (const [key, value] of Object.entries(patch)) {
      try {
        main.applyOptions({ [key]: value } as Partial<CandleSeriesOptions>);
      } catch (err) {
        report(`mainSeries.${key}`, err);
      }
    }
  }
}

/** The valid saved indicator states; the others are reported. Null when it is not a list. */
function readIndicators(raw: unknown, report: Report): IndicatorState[] | null {
  if (!Array.isArray(raw)) {
    report('indicators', 'must be an array');
    return null;
  }
  const states: IndicatorState[] = [];
  raw.forEach((item: unknown, i) => {
    try {
      states.push(parseIndicatorStates([item])[0]!);
    } catch {
      report(`indicators[${i}]`, 'not an indicator state');
    }
  });
  return states;
}

/** Replace the indicators with the valid saved states; returns them with their new handles. */
function loadIndicators(chart: Chart, states: IndicatorState[], report: Report): Map<Indicator, number> {
  const off = chart.on('indicator:error', ({ indicator, error }) => {
    const i = chart.indicators.getAll().indexOf(indicator);
    report(`indicators[${i}]`, error);
  });
  // Panes the old indicators shared (e.g. an overlay moved into an oscillator's pane) outlive them.
  const oldPanes = new Set(chart.indicators.getAll().flatMap((ind) => (ind.pane ? [ind.pane] : [])));
  try {
    chart.indicators.load(states);
  } finally {
    off();
  }
  for (const pane of oldPanes) {
    const i = chart.panes.indexOf(pane);
    if (i > 0 && pane.series.length === 0) chart.removePane(pane);
  }
  const indicators = chart.indicators.getAll();
  return new Map(indicators.map((indicator, i) => [indicator, states[i]!.pane]));
}

/** Pane indices the saved drawings use, read loosely: `drawings.load` validates them. */
function drawingPaneIndices(raw: unknown): Set<number> {
  const panes = new Set<number>();
  if (isRecord(raw) && Array.isArray(raw.drawings)) {
    for (const d of raw.drawings) if (isRecord(d) && Number.isInteger(d.pane)) panes.add(d.pane as number);
  }
  return panes;
}

/**
 * Arrange the panes as saved. Indicators go to their saved pane; saved panes
 * without indicators take the chart's own panes (e.g. an app's volume pane)
 * in order, or a new pane when drawings need one. Returns
 * `map[savedIndex] = paneIndex`, -1 for a saved pane that was not restored.
 */
function loadPanes(
  chart: Chart,
  layout: Record<string, unknown>,
  restored: Map<Indicator, number> | null,
  drawingPanes: Set<number>,
  keptPanes: Set<number>,
  report: Report,
): number[] | null {
  const raw = layout.panes;
  if (!Array.isArray(raw) || raw.length === 0) {
    report('panes', 'must be a non-empty array');
    return null;
  }
  const saved = raw.map((p: unknown, i) => {
    if (isRecord(p)) return p;
    report(`panes[${i}]`, 'must be an object');
    return {};
  });
  const mainPane = chart.panes[0]!;
  // Where each indicator should go: its saved pane, or where it is when the layout has no indicators.
  const wanted = new Map<Indicator, number>(
    restored ?? (chart.indicatorLayer?.getAll() ?? []).map((ind) => [ind, ind.pane ? chart.panes.indexOf(ind.pane) : -1] as const),
  );
  const indicatorPanes = new Set<Pane>();
  for (const ind of wanted.keys()) if (ind.pane) indicatorPanes.add(ind.pane);
  const ownPanes = chart.panes.slice(1).filter((p) => !indicatorPanes.has(p));
  const used = new Set<Pane>([mainPane]);

  const targets: (Pane | null)[] = saved.map((_, p) => {
    if (p === 0) return mainPane;
    const here = [...wanted].filter(([, pane]) => pane === p).map(([ind]) => ind);
    let target: Pane | null = null;
    if (here.length > 0) {
      const own = here.map((ind) => ind.pane).find((pane) => pane && pane !== mainPane && !used.has(pane));
      // Only pending indicators here: nothing to draw, so no pane unless drawings need it.
      target = own ?? (here.some((ind) => ind.pane) ? chart.addPane() : null);
    } else {
      // A pane of indicators kept for a missing plugin stays theirs, empty.
      target = keptPanes.has(p) ? chart.addPane() : (ownPanes.shift() ?? null);
    }
    if (!target && drawingPanes.has(p)) target = chart.addPane();
    if (target) used.add(target);
    return target;
  });

  for (const [ind, p] of wanted) {
    const target = targets[p];
    const series = ind.series;
    if (!target || !series || series.pane === target) continue;
    chart.moveSeries(series, target);
  }
  // An indicator pane left empty (its indicator moved elsewhere) goes.
  for (const pane of indicatorPanes) {
    if (!used.has(pane) && pane.series.length === 0 && chart.panes.includes(pane)) chart.removePane(pane);
  }

  // Saved panes in order after the main one, then the chart's other panes.
  const order = [mainPane, ...targets.filter((t): t is Pane => !!t && t !== mainPane)];
  for (const pane of chart.panes) if (!order.includes(pane)) order.push(pane);
  order.forEach((pane, i) => {
    if (i > 0 && chart.panes.indexOf(pane) !== i) chart.movePane(pane, i);
  });
  const map = targets.map((t) => (t ? chart.panes.indexOf(t) : -1));

  const heights: (number | undefined)[] = chart.panes.map(() => undefined);
  saved.forEach((p, i) => {
    const target = map[i]!;
    if (target < 0) return;
    if (p.height !== undefined) {
      if (isNumber(p.height) && p.height > 0) heights[target] = p.height;
      else report(`panes[${i}].height`, 'must be a positive number');
    }
    if (p.collapsed !== undefined && typeof p.collapsed !== 'boolean') report(`panes[${i}].collapsed`, 'must be a boolean');
    chart.setPaneCollapsed(chart.panes[target]!, p.collapsed === true);
    if (p.hidden !== undefined && typeof p.hidden !== 'boolean') report(`panes[${i}].hidden`, 'must be a boolean');
    chart.setPaneHidden(chart.panes[target]!, p.hidden === true);
    if (p.scales !== undefined) loadScales(chart, target, p.scales, `panes[${i}].scales`, report);
  });
  chart.setPaneHeights(heights as number[]);

  const maximized = layout.maximizedPane;
  if (maximized === undefined) chart.maximizePane(null);
  else if (Number.isInteger(maximized) && (map[maximized as number] ?? -1) >= 0) {
    chart.maximizePane(chart.panes[map[maximized as number]!]!);
  } else {
    report('maximizedPane', 'not a restored pane index');
    chart.maximizePane(null);
  }
  return map;
}

const SIDES: readonly PriceScaleSide[] = ['left', 'right', 'none'];
const MODES: readonly PriceScaleMode[] = ['normal', 'log', 'percent', 'indexed'];

function loadScales(chart: Chart, pane: number, raw: unknown, part: string, report: Report): void {
  if (!isRecord(raw)) return report(part, 'must be an object');
  for (const [id, value] of Object.entries(raw)) {
    const at = `${part}.${id}`;
    if (!isRecord(value)) {
      report(at, 'must be an object');
      continue;
    }
    const settings: Partial<PriceScaleSettings> = {};
    const field = <K extends keyof PriceScaleSettings>(key: K, ok: (v: unknown) => boolean, reason: string) => {
      if (value[key] === undefined) return;
      if (ok(value[key])) settings[key] = value[key] as PriceScaleSettings[K];
      else report(`${at}.${key}`, reason);
    };
    field('side', (v) => SIDES.includes(v as PriceScaleSide), 'must be left, right or none');
    field('mode', (v) => MODES.includes(v as PriceScaleMode), 'must be normal, log, percent or indexed');
    field('invert', (v) => typeof v === 'boolean', 'must be a boolean');
    field('autoScale', (v) => typeof v === 'boolean', 'must be a boolean');
    field('marginTop', (v) => isNumber(v) && v >= 0 && v < 1, 'must be in [0, 1)');
    field('marginBottom', (v) => isNumber(v) && v >= 0 && v < 1, 'must be in [0, 1)');
    // A margin the layout leaves out was sized by the chart, so it goes back to automatic.
    settings.marginTop ??= null;
    settings.marginBottom ??= null;
    field('fixedRange', (v) => v === null || isRange(v), 'must be null or { min, max } with min < max');
    field('percentBase', isPercentBase, "must be 'firstVisible', 'sessionOpen', 'previousClose' or { time }");
    field('autoscaleRule', (v) => v === null || autoscaleRuleError(v) === null, 'must be null or { centerOn?, include?, minSpan? }');
    field('lockPriceToBarRatio', (v) => typeof v === 'boolean', 'must be a boolean');
    field('priceToBarRatio', (v) => v === null || (isNumber(v) && v > 0), 'must be null or a positive number');
    // A manual scale needs the range it showed; without one it fits the data instead.
    if (settings.autoScale === false && !isRange(value.range)) {
      report(`${at}.range`, 'missing or invalid; the scale autoscales instead');
      settings.autoScale = true;
    }
    try {
      chart.setPriceScaleOptions(settings, pane, id);
    } catch {
      // Settings that only fail together (margins adding up to 1, a range a log scale cannot show): apply one by one.
      for (const [key, v] of Object.entries(settings)) {
        try {
          chart.setPriceScaleOptions({ [key]: v }, pane, id);
        } catch (one) {
          report(`${at}.${key}`, one);
        }
      }
    }
  }
}

/** Saved manual price ranges of the scales `loadScales` left in manual mode. */
interface ManualRange {
  pane: Pane;
  scale: PriceScale;
  part: string;
  min: number;
  max: number;
}

function manualRanges(chart: Chart, panes: unknown, map: number[]): ManualRange[] {
  if (!Array.isArray(panes)) return [];
  const ranges: ManualRange[] = [];
  panes.forEach((p: unknown, i) => {
    const pane = chart.panes[map[i] ?? -1];
    if (!pane || !isRecord(p) || !isRecord(p.scales)) return;
    for (const [id, s] of Object.entries(p.scales)) {
      if (!isRecord(s) || s.autoScale !== false || !isRange(s.range)) continue;
      const scale = pane.scales.find((x) => x.id === id);
      if (scale && !scale.autoScale) ranges.push({ pane, scale, part: `panes[${i}].scales.${id}.range`, min: s.range.min, max: s.range.max });
    }
  });
  return ranges;
}

function loadSymbol(chart: Chart, layout: Record<string, unknown>, report: Report): Promise<void> | null {
  const { symbol, interval } = layout;
  if (interval !== undefined && !isInterval(interval)) report('interval', 'not an interval such as 15m or 1d');
  if (symbol === undefined) return null;
  if (!isText(symbol)) {
    report('symbol', 'must be a non-empty string');
    return null;
  }
  const data = chart.data;
  // Without a data source the app loads the symbol itself; `meta` and the layout tell it which.
  if (!data) return null;
  const use = isInterval(interval) ? interval : data.interval;
  if (!use) {
    report('symbol', 'no interval to load it at');
    return null;
  }
  return chart.setSymbol(symbol, use);
}

function readRange(raw: unknown, report: Report): { from: Time; to: Time } | null {
  if (raw === undefined) return null;
  if (isRecord(raw) && isNumber(raw.from) && isNumber(raw.to) && raw.from <= raw.to) return { from: raw.from, to: raw.to };
  report('visibleRange', 'must be { from, to } in unix seconds with from <= to');
  return null;
}

function isRange(value: unknown): value is { min: number; max: number } {
  return isRecord(value) && isNumber(value.min) && isNumber(value.max) && value.min < value.max;
}

