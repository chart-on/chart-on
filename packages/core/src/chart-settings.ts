/**
 * The chart settings a settings dialog shows, as data: sections of groups of
 * fields, each naming the option it edits by path. `readChartSetting` and
 * `applyChartSettings` read and write those paths through the chart's own
 * options, so a UI built from the schema needs no code per option.
 */
import type { Chart, ChartOptionsPatch, PriceScaleSettings } from './chart';
import type { CandleSeriesOptions } from './series';
import { englishLocalizer, type MessageParams } from './util/locale';
import { LOCAL_TIMEZONE, localTimeZone, wallFormat } from './util/timezone';

/** The control a setting takes. */
export type ChartSettingKind = 'boolean' | 'select' | 'number' | 'slider' | 'color';

/** One choice of a `select` setting: the value written to the option and the label shown for it. */
export interface ChartSettingChoice {
  value: string | number;
  label: string;
  /** Message key of `label` with `labelParams` filled in; a settings dialog shows it in the chart's language while `label` is unchanged. */
  labelKey?: string;
  /** Values for the `{name}` placeholders of `labelKey`'s text. */
  labelParams?: MessageParams;
}

/**
 * One option. `path` is a dotted path into the chart options
 * (`legend.mode`, `crosshair.vertical.visible`, `theme.up`, `features.legend`),
 * into the main series' options with a `series.` prefix (`series.wicks`), or
 * into the main pane's price scale settings with a `priceScale.` prefix
 * (`priceScale.lockPriceToBarRatio`).
 */
export interface ChartSettingField {
  path: string;
  label: string;
  kind: ChartSettingKind;
  /** Help text under the control. */
  hint?: string;
  /** The values a `select` offers. */
  choices?: readonly ChartSettingChoice[];
  min?: number;
  max?: number;
  step?: number;
  /** Shown after a slider's value, e.g. `%`. */
  unit?: string;
  /** What the option means while it is not set: another setting's value, or a fixed value. */
  unset?: { path: string } | { value: unknown };
  /** Show the field only while the setting at `path` equals `equals`. */
  when?: { path: string; equals: unknown };
  /** Show the field only on a chart with this plugin installed (its `ChartPlugin.name`), whose option it sets. */
  plugin?: string;
}

/** Related fields shown together within a settings section, under an optional heading. */
export interface ChartSettingGroup {
  id: string;
  /** Heading above the fields; none when omitted. */
  label?: string;
  fields: readonly ChartSettingField[];
}

/** One section of the settings dialog, such as a tab: its title and groups of fields. `chartSettingsSchema` lists them all. */
export interface ChartSettingSection {
  id: string;
  title: string;
  groups: readonly ChartSettingGroup[];
}

const lineStyles: readonly ChartSettingChoice[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
];

const legendOn = { path: 'features.legend', equals: true };
const showWicks = { path: 'series.wicks', equals: true };
const showBorders = { path: 'series.borders', equals: true };
const showLastValues = { path: 'features.lastValueLabels', equals: true };
const timeAxisShown = { path: 'timeAxis.visible', equals: true };

function gridLines(dir: 'horizontal' | 'vertical', label: string): ChartSettingGroup {
  const shown = { path: `grid.${dir}.visible`, equals: true };
  return {
    id: `grid-${dir}`,
    label,
    fields: [
      { path: `grid.${dir}.visible`, label: 'Show', kind: 'boolean' },
      { path: `grid.${dir}.lineStyle`, label: 'Style', kind: 'select', choices: lineStyles, when: shown },
      { path: `grid.${dir}.color`, label: 'Color', kind: 'color', when: shown },
    ],
  };
}

/** Minutes east of UTC in `timeZone` at `ms`; null for a zone `Intl` does not know. */
function offsetMinutes(timeZone: string, ms: number): number | null {
  try {
    const format = wallFormat(timeZone);
    const parts: Record<string, number> = {};
    for (const part of format.formatToParts(ms)) parts[part.type] = Number(part.value);
    const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour! % 24, parts.minute!);
    return Math.round((wall - Math.floor(ms / 60000) * 60000) / 60000);
  } catch {
    return null;
  }
}

/** A UTC offset in minutes east of UTC as text: `UTC`, `UTC+7`, `UTC-3:30`. */
export function utcOffsetText(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const abs = Math.abs(minutes);
  const mm = abs % 60;
  return `UTC${minutes < 0 ? '-' : '+'}${Math.floor(abs / 60)}${mm ? `:${String(mm).padStart(2, '0')}` : ''}`;
}

/** `America/New_York` as `America/New York`. */
const zoneLabel = (name: string) => name.replace(/_/g, ' ');

/** The `'local'` choice, e.g. "Local (Asia/Jakarta, UTC+7)" (message `timezoneLocal`). */
function localChoice(zone: string, offset: string): ChartSettingChoice {
  const labelParams = { zone, offset };
  return { value: LOCAL_TIMEZONE, label: englishLocalizer.text('timezoneLocal', labelParams), labelKey: 'timezoneLocal', labelParams };
}

/**
 * The timezones a timezone setting offers: `'local'` (labelled with the
 * machine's zone), `'UTC'`, then every IANA zone `Intl` lists (every
 * supported browser lists them), each labelled with its UTC offset at `now`
 * (ms), e.g. "Asia/Jakarta (UTC+7)".
 */
export function timezoneChoices(now = Date.now()): ChartSettingChoice[] {
  const local = localTimeZone();
  const choices: ChartSettingChoice[] = [
    localChoice(zoneLabel(local), utcOffsetText(offsetMinutes(local, now) ?? 0)),
    { value: 'UTC', label: 'UTC' },
  ];
  for (const name of Intl.supportedValuesOf('timeZone')) {
    if (name === 'UTC') continue;
    const offset = offsetMinutes(name, now);
    if (offset !== null) choices.push({ value: name, label: `${zoneLabel(name)} (${utcOffsetText(offset)})` });
  }
  return choices;
}

const HOUR_MS = 3_600_000;
let cachedZones: { hour: number; choices: readonly ChartSettingChoice[] } | null = null;

/**
 * The timezone choices, worked out when first read (a few hundred `Intl`
 * lookups) and again in a later hour, so the offsets follow daylight saving.
 */
function currentTimezoneChoices(): readonly ChartSettingChoice[] {
  const hour = Math.floor(Date.now() / HOUR_MS);
  if (cachedZones?.hour !== hour) cachedZones = { hour, choices: timezoneChoices() };
  return cachedZones.choices;
}

/**
 * The built-in settings, one section per thing the user adjusts (#863),
 * ordered from the data to the chrome around it:
 *
 * - `series`: how the main series draws (bodies, wicks, borders) and the
 *   price adjustments it applies
 * - `readout`: what shows values under the pointer, the legend and the
 *   crosshair with its axis labels
 * - `axes`: the scales' own labels and lines, and the text colors they use
 * - `time`: how and where times show: timezone, seconds, trading day
 *   dividers, session shading and time-axis marks
 * - `background`: what sits behind the data: background, grid, watermark
 * - `markers`: marks the data source puts on bars, and split and dividend
 *   markers; last, since only some data sources supply them
 *
 * A group heading is left out where it would repeat its section's title.
 * Each field round-trips through `applyChartSettings` and `readChartSetting`.
 */
export const chartSettingsSchema: readonly ChartSettingSection[] = [
  {
    id: 'series',
    title: 'Series',
    groups: [
      {
        id: 'bodies',
        label: 'Bodies',
        fields: [
          { path: 'theme.up', label: 'Rising', kind: 'color' },
          { path: 'theme.down', label: 'Falling', kind: 'color' },
          { path: 'series.hollowDown', label: 'Hollow falling bodies', kind: 'boolean', unset: { value: false } },
          { path: 'series.bodyRatio', label: 'Body width', kind: 'slider', min: 0.1, max: 1, step: 0.05 },
          {
            path: 'series.colorByPreviousClose',
            label: 'Color by previous close',
            kind: 'boolean',
            hint: 'Compare each close with the previous close instead of the open.',
            unset: { value: false },
          },
        ],
      },
      {
        id: 'wicks',
        label: 'Wicks',
        fields: [
          { path: 'series.wicks', label: 'Show', kind: 'boolean', unset: { value: true } },
          { path: 'theme.upWick', label: 'Rising', kind: 'color', unset: { path: 'theme.up' }, when: showWicks },
          { path: 'theme.downWick', label: 'Falling', kind: 'color', unset: { path: 'theme.down' }, when: showWicks },
        ],
      },
      {
        id: 'borders',
        label: 'Borders',
        fields: [
          { path: 'series.borders', label: 'Show', kind: 'boolean', unset: { value: true } },
          { path: 'theme.upBorder', label: 'Rising', kind: 'color', unset: { path: 'theme.up' }, when: showBorders },
          { path: 'theme.downBorder', label: 'Falling', kind: 'color', unset: { path: 'theme.down' }, when: showBorders },
        ],
      },
      {
        id: 'corporate-actions',
        label: 'Splits and dividends',
        fields: [
          {
            path: 'adjustment',
            label: 'Adjust earlier prices for',
            kind: 'select',
            choices: [
              { value: 'none', label: 'Nothing' },
              { value: 'splits', label: 'Splits' },
              { value: 'all', label: 'Splits and dividends' },
            ],
            hint: 'Applies when the data source reports splits and dividends.',
          },
        ],
      },
    ],
  },
  {
    id: 'readout',
    title: 'Readout',
    groups: [
      {
        id: 'legend',
        label: 'Legend',
        fields: [
          { path: 'features.legend', label: 'Show legend', kind: 'boolean' },
          {
            path: 'legend.mode',
            label: 'Values',
            kind: 'select',
            choices: [
              { value: 'full', label: 'All values' },
              { value: 'compact', label: 'Close only' },
              { value: 'title', label: 'Titles only' },
            ],
            when: legendOn,
          },
          {
            path: 'legend.position',
            label: 'Position',
            kind: 'select',
            choices: [
              { value: 'top-start', label: 'Top start' },
              { value: 'top-end', label: 'Top end' },
              { value: 'bottom-start', label: 'Bottom start' },
              { value: 'bottom-end', label: 'Bottom end' },
              // Physical corners stay where they are in either direction; kept so saved choices still load.
              { value: 'top-left', label: 'Top left' },
              { value: 'top-right', label: 'Top right' },
              { value: 'bottom-left', label: 'Bottom left' },
              { value: 'bottom-right', label: 'Bottom right' },
            ],
            when: legendOn,
          },
          { path: 'legend.showChange', label: 'Change from previous close', kind: 'boolean', when: legendOn },
          { path: 'legend.changeArrows', label: 'Arrows on changes', kind: 'boolean', when: legendOn },
          {
            path: 'legend.whenIdle',
            label: 'Without a crosshair',
            kind: 'select',
            choices: [
              { value: 'last', label: 'Newest values' },
              { value: 'hidden', label: 'Titles only' },
            ],
            when: legendOn,
          },
          { path: 'features.legendButtons', label: 'Row buttons', kind: 'boolean', when: legendOn },
          { path: 'marketStatus', label: 'Market status', kind: 'boolean', when: legendOn, plugin: '@charton/core/market-status' },
        ],
      },
      {
        id: 'crosshair',
        label: 'Crosshair',
        fields: [
          {
            path: 'crosshair.mode',
            label: 'Mode',
            kind: 'select',
            choices: [
              { value: 'free', label: 'Free' },
              { value: 'close', label: 'Snap to close' },
              { value: 'ohlc', label: 'Snap to open, high, low or close' },
              { value: 'hidden', label: 'Hidden' },
            ],
          },
          { path: 'theme.crosshair', label: 'Color', kind: 'color' },
          { path: 'crosshair.vertical.visible', label: 'Vertical line', kind: 'boolean' },
          { path: 'crosshair.horizontal.visible', label: 'Horizontal line', kind: 'boolean' },
          { path: 'crosshair.horizontalInAllPanes', label: 'Horizontal line in every pane', kind: 'boolean' },
          { path: 'crosshair.labels.price', label: 'Crosshair price label', kind: 'boolean' },
          { path: 'crosshair.labels.time', label: 'Crosshair time label', kind: 'boolean' },
          {
            path: 'crosshair.timeLabelPosition',
            label: 'Time label position',
            kind: 'select',
            choices: [
              { value: 'bottom', label: 'On the time axis' },
              { value: 'top', label: 'At the top' },
            ],
            when: { path: 'crosshair.labels.time', equals: true },
          },
        ],
      },
    ],
  },
  {
    id: 'axes',
    title: 'Axes',
    groups: [
      {
        id: 'labels',
        label: 'Labels',
        fields: [
          { path: 'features.lastValueLabels', label: 'Last value labels', kind: 'boolean' },
          // Says what the label shows, the time left in the newest bar, rather than when the bar closes.
          { path: 'features.countdown', label: 'Time left in bar', kind: 'boolean', when: showLastValues, plugin: '@charton/core/countdown' },
        ],
      },
      {
        id: 'lines',
        label: 'Axis lines',
        fields: [
          { path: 'priceAxis.border', label: 'Price axis line', kind: 'boolean' },
          { path: 'priceAxis.ticks', label: 'Price tick marks', kind: 'boolean' },
          {
            path: 'priceAxis.labelMode',
            label: 'Label width',
            kind: 'select',
            choices: [
              { value: 'fill', label: 'Whole axis' },
              { value: 'content', label: 'Fit the text' },
            ],
          },
          { path: 'priceAxis.labelPointer', label: 'Pointed labels', kind: 'boolean' },
          // A scale setting, not a mode, so it lives here rather than beside the bottom bar's scale modes (#861).
          // The label says what the user sees: zooming keeps the angles of lines and drawings.
          { path: 'priceScale.lockPriceToBarRatio', label: 'Keep line angles when zooming', kind: 'boolean' },
          { path: 'timeAxis.visible', label: 'Show time axis', kind: 'boolean' },
          { path: 'timeAxis.border', label: 'Time axis line', kind: 'boolean', when: timeAxisShown },
          { path: 'timeAxis.ticks', label: 'Time tick marks', kind: 'boolean', when: timeAxisShown },
        ],
      },
      {
        id: 'text',
        label: 'Text',
        fields: [
          { path: 'theme.text', label: 'Text', kind: 'color' },
          { path: 'theme.textMuted', label: 'Muted text', kind: 'color' },
          { path: 'theme.labelBackground', label: 'Label background', kind: 'color' },
          { path: 'theme.labelText', label: 'Label text', kind: 'color' },
          { path: 'theme.separator', label: 'Separators', kind: 'color' },
        ],
      },
    ],
  },
  {
    id: 'time',
    title: 'Time',
    groups: [
      {
        id: 'timezone',
        fields: [
          {
            path: 'timezone',
            label: 'Timezone',
            kind: 'select',
            hint: 'Used by the time axis, the crosshair and the clock.',
            // A getter, so the few hundred zones are only listed once something reads them.
            get choices() {
              return currentTimezoneChoices();
            },
          },
          { path: 'timeAxis.showSeconds', label: 'Seconds in times', kind: 'boolean' },
        ],
      },
      {
        id: 'sessions',
        label: 'Sessions',
        fields: [
          {
            path: 'sessionBreaks',
            // Names what the user sees, a line between trading days, instead of the session term.
            label: 'Trading day dividers',
            kind: 'boolean',
            hint: 'A line where each trading day starts, on intraday charts with trading hours.',
          },
          { path: 'sessionShading', label: 'Shade bars outside the session', kind: 'boolean' },
        ],
      },
      {
        id: 'marks',
        label: 'Marks',
        fields: [
          { path: 'timeMarks', label: 'Time axis marks', kind: 'boolean' },
          {
            path: 'theme.timeMark',
            label: 'Time axis mark color',
            kind: 'color',
            hint: 'Used by marks that have no color of their own.',
            unset: { path: 'theme.line' },
            when: { path: 'timeMarks', equals: true },
          },
        ],
      },
    ],
  },
  {
    id: 'background',
    title: 'Background',
    groups: [
      {
        id: 'background',
        fields: [
          { path: 'theme.background', label: 'Color', kind: 'color' },
          {
            path: 'theme.backgroundBottom',
            label: 'Bottom color',
            kind: 'color',
            hint: 'Fades from the color above to this one. Keep both the same for a solid background.',
            unset: { path: 'theme.background' },
          },
        ],
      },
      gridLines('horizontal', 'Horizontal grid lines'),
      gridLines('vertical', 'Vertical grid lines'),
      {
        id: 'watermark',
        label: 'Watermark',
        fields: [
          { path: 'features.watermark', label: 'Show', kind: 'boolean' },
          { path: 'theme.watermark', label: 'Color', kind: 'color', when: { path: 'features.watermark', equals: true } },
        ],
      },
    ],
  },
  {
    id: 'markers',
    title: 'Markers',
    groups: [
      {
        id: 'markers',
        fields: [
          { path: 'adjustmentMarkers', label: 'Splits and dividends', kind: 'boolean' },
          { path: 'marks', label: 'Data source marks', kind: 'boolean' },
        ],
      },
    ],
  },
];

function at(source: unknown, keys: readonly string[]): unknown {
  let value = source;
  for (const key of keys) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * The current value of a setting, by field or by path (see
 * `ChartSettingField`): resolved theme colors and grid, the resolved legend
 * settings and feature flags, then the chart options. A field's `unset`
 * stands in for a value that is not set. `undefined` when there is none, as
 * for a `series.` path without a main series.
 */
export function readChartSetting(chart: Chart, setting: string | ChartSettingField): unknown {
  if (typeof setting === 'string') return readPath(chart, setting);
  const value = readPath(chart, setting.path);
  if (value !== undefined || !setting.unset || (setting.path.startsWith('series.') && !chart.main)) return value;
  return 'path' in setting.unset ? readPath(chart, setting.unset.path) : setting.unset.value;
}

function readPath(chart: Chart, path: string): unknown {
  const [root = '', ...rest] = path.split('.');
  switch (root) {
    case 'series':
      return at(chart.main?.options, rest);
    case 'priceScale':
      return at(chart.getPriceScaleOptions(0), rest);
    case 'theme':
    case 'grid':
      return at(chart.appearance()[root], rest);
    case 'legend':
      return at(chart.legendSettings, rest);
    case 'features':
      return at(chart.features, rest);
    default:
      return at(chart.options, [root, ...rest]);
  }
}

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** Put `value` at `keys` in `target`, creating the objects on the way. */
function put(target: Record<string, unknown>, keys: readonly string[], value: unknown): void {
  let node = target;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      node[key] = value;
      return;
    }
    const next = node[key];
    node = (typeof next === 'object' && next !== null ? next : (node[key] = {})) as Record<string, unknown>;
  });
}

/**
 * Apply settings by path: one `chart.applyOptions` for the chart options,
 * one `applyOptions` on the main series for the `series.` paths (skipped
 * without a main series) and one `setPriceScaleOptions` on the main pane for
 * the `priceScale.` paths.
 */
export function applyChartSettings(chart: Chart, values: Readonly<Record<string, unknown>>): void {
  // The patches by target: the chart options, the main series and the main pane's price scale.
  const options: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(values)) {
    const keys = path.split('.');
    // A path is data (it may come from storage): never write through an object's prototype.
    if (!keys.some((key) => UNSAFE_KEYS.has(key))) put(options, keys, value);
  }
  const { series, priceScale, ...rest } = options;
  if (Object.keys(rest).length > 0) chart.applyOptions(rest as ChartOptionsPatch);
  if (series) chart.main?.applyOptions(series as Partial<CandleSeriesOptions>);
  if (priceScale) chart.setPriceScaleOptions(priceScale as Partial<PriceScaleSettings>, 0);
}
