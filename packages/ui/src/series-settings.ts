import {
  CandleSeries,
  darkTheme,
  HistogramSeries,
  LineSeries,
  type Chart,
  type ChartTheme,
  type CompareMode,
  type ComparedSymbol,
  type LineStyle,
  type Series,
} from '@charton/core';
import { createFormDialog, type FormDialog } from './form-dialog';
import { defaultFormActions, type FormInputDef, type FormSchema, type FormValues } from './form-model';
import { lineStyleOptions } from './drawing-style-controls';
import { keyOf, shellText } from './messages';

/** Form ids, one per series option the panel edits (`placement` is a compared symbol's mode). */
const COLOR = 'color';
const ABOVE = 'aboveColor';
const BELOW = 'belowColor';
const POSITIVE = 'positiveColor';
const NEGATIVE = 'negativeColor';
const UP = 'upColor';
const DOWN = 'downColor';
const WIDTH = 'lineWidth';
const LINE_STYLE = 'lineStyle';
const VISIBLE = 'visible';
const PLACEMENT = 'placement';

/** Series options the panel edits, all optional colours or line settings. */
type StyleKey = typeof COLOR | typeof ABOVE | typeof BELOW | typeof POSITIVE | typeof NEGATIVE | typeof UP | typeof DOWN | typeof WIDTH | typeof LINE_STYLE;

/** Line widths offered, besides the series' current one. */
const LINE_WIDTHS = [1, 2, 3, 4];


/** The chart `seriesSettingsForm` reads the language and theme from. */
export type SeriesSettingsChart = Pick<Chart, 'localization'> & { readonly theme?: ChartTheme };

/** What `seriesSettingsForm` builds: the form schema of a series' style settings and the values it opens with. */
export interface SeriesSettingsForm {
  schema: FormSchema;
  /** The values the panel opens with, by form input id. */
  values: FormValues;
}

/** Whether the series' newest point carries its own colour, which wins over the series' colour options. */
function pointColored(series: Series): boolean {
  const data = (series as { data?: readonly { color?: string }[] }).data;
  return !!data && data.length > 0 && data[data.length - 1]!.color !== undefined;
}

/** The colour options of `series` the panel offers, with the colour drawn while each is unset. */
function colorFields(series: Series, theme: ChartTheme): [StyleKey, string][] {
  if (series instanceof LineSeries) {
    if (series.options.baseline !== undefined) return [[ABOVE, theme.up], [BELOW, theme.down]];
    return pointColored(series) ? [] : [[COLOR, theme.line]];
  }
  if (series instanceof HistogramSeries) {
    if (pointColored(series)) return [];
    const o = series.options;
    return o.positiveColor || o.negativeColor ? [[POSITIVE, theme.line], [NEGATIVE, theme.line]] : [[COLOR, theme.line]];
  }
  if (series instanceof CandleSeries) return [[UP, theme.up], [DOWN, theme.down]];
  return [];
}

/** Whether the series is drawn as a line whose width and dash the panel can set. */
const hasLine = (series: Series) => series instanceof LineSeries;

/** The compared symbol drawn by `series`, if any. */
function comparedOf(chart: Pick<Chart, 'compared'>, series: Series): ComparedSymbol | null {
  return chart.compared.find((c) => c.series === series) ?? null;
}

/**
 * Whether `seriesSettingsForm` has something to edit for `series`: a compared
 * symbol, or a line, histogram or candle series that is neither the main
 * series nor an indicator's, with a colour or line option to set. A
 * histogram whose points carry their own colours (such as volume) has none.
 */
export function hasSeriesStyleSettings(chart: Pick<Chart, 'compared' | 'main' | 'indicators'> & { readonly theme?: ChartTheme }, series: Series): boolean {
  if (series === chart.main) return false;
  if (chart.indicators.getAll().some((i) => i.series === series)) return false;
  if (comparedOf(chart, series)) return true;
  return hasLine(series) || colorFields(series, chart.theme ?? darkTheme).length > 0;
}

/**
 * The style form of a plain series or a compared symbol: its colours, line
 * width and line style where it has a line, and whether it is visible. A
 * compared symbol also gets its placement: on the price scale in percent
 * (lines only), on its own scale, or in its own pane. Colour fields left
 * empty follow the theme and show the colour drawn. `chart` gives the
 * language of the labels and the theme (default the dark theme).
 */
export function seriesSettingsForm(series: Series, chart?: (SeriesSettingsChart & Partial<Pick<Chart, 'compared'>>) | null): SeriesSettingsForm {
  const theme = chart?.theme ?? darkTheme;
  const t = (key: Parameters<typeof shellText>[1]) => shellText(chart, key);
  const options = series.options as Partial<Record<StyleKey, unknown>>;
  const values: FormValues = { [VISIBLE]: series.visible };
  const inputs: FormInputDef[] = [];
  const compared = chart?.compared ? comparedOf(chart as Pick<Chart, 'compared'>, series) : null;

  if (compared) {
    values[PLACEMENT] = compared.mode;
    const modes: CompareMode[] = compared.style === 'line' ? ['percent', 'scale', 'pane'] : ['scale', 'pane'];
    inputs.push({ id: PLACEMENT, label: t('seriesPlacement'), kind: 'select', default: compared.mode, options: modes.map((m) => ({ value: m, label: t(keyOf('seriesPlacement', m)) })) });
  }
  // A compared candle series takes its colours from the compare colour, so it offers none of its own.
  const colors = compared && compared.style !== 'line' ? [] : colorFields(series, theme);
  for (const [key, drawn] of colors) {
    values[key] = typeof options[key] === 'string' ? options[key] : '';
    // `aboveColor` is labelled by `seriesColorAbove`, and so on.
    const label = t(key === COLOR ? 'seriesColor' : keyOf('seriesColor', key.slice(0, -5)));
    inputs.push({ id: key, label, kind: 'color', default: '', placeholder: drawn });
  }
  if (hasLine(series)) {
    const width = typeof options[WIDTH] === 'number' ? options[WIDTH] : 1;
    values[WIDTH] = width;
    values[LINE_STYLE] = (options[LINE_STYLE] as LineStyle | undefined) ?? 'solid';
    const widths = [...new Set([...LINE_WIDTHS, width])].sort((a, b) => a - b);
    inputs.push(
      { id: WIDTH, label: t('indicatorPlotLineWidth'), kind: 'select', default: width, options: widths.map((w) => ({ value: w, label: `${w}px` })) },
      {
        id: LINE_STYLE,
        label: t('indicatorPlotLineStyle'),
        kind: 'select',
        default: 'solid',
        options: lineStyleOptions(chart),
      },
    );
  }
  inputs.push({ id: VISIBLE, label: t('indicatorPlotVisible'), kind: 'boolean', default: true });
  const title = (series.options as { title?: string }).title || compared?.symbol || t('seriesFallback');
  return {
    schema: { id: 'series-settings', title, sections: [{ id: 'style', title: t('dialogStyle'), groups: [{ id: 'style', inputs }] }], actions: [...defaultFormActions] },
    values,
  };
}

/** The series options held in form `values`; an empty colour unsets the option, so the theme's colour is drawn. */
function styleOf(values: Readonly<FormValues>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of [COLOR, ABOVE, BELOW, POSITIVE, NEGATIVE, UP, DOWN] as const) {
    if (key in values) out[key] = values[key] === '' ? undefined : values[key];
  }
  if (WIDTH in values) out[WIDTH] = values[WIDTH];
  if (LINE_STYLE in values) out[LINE_STYLE] = values[LINE_STYLE];
  return out;
}

const onChart = (series: Series) => series.pane.series.includes(series);

/**
 * Open the style panel of `series` (see `seriesSettingsForm`) in `host`,
 * docked to its right edge so the chart stays in view. Edits apply live; Ok
 * keeps them, and Cancel, Escape, the close button and `close()` put the
 * series back as it was. A compared symbol's placement changes through
 * `ComparedSymbol.setMode`, so it keeps its series, bars and handle. The
 * panel closes if the series is removed or the chart destroyed. Null when the
 * series has nothing to edit.
 */
export function openSeriesStyleSettings(chart: Chart, host: HTMLElement, series: Series): FormDialog | null {
  if (!onChart(series) || !hasSeriesStyleSettings(chart, series)) return null;
  const form = seriesSettingsForm(series, chart);
  const compared = comparedOf(chart, series);
  let live = true;

  const apply = (values: FormValues) => {
    if (!live || !onChart(series)) return;
    if (compared && PLACEMENT in values) compared.setMode(values[PLACEMENT] as CompareMode);
    const style = styleOf(values);
    const options = series.options as Record<string, unknown>;
    if (Object.keys(style).some((k) => options[k] !== style[k])) (series as Series<Record<string, unknown>>).applyOptions(style);
    const visible = values[VISIBLE] !== false;
    if (visible !== series.visible) series.setVisible(visible);
  };

  const offs: (() => void)[] = [];
  const stop = () => offs.splice(0).forEach((off) => off());
  const dialog = createFormDialog(host, form.schema, {
    localization: chart.localization,
    values: form.values,
    presentation: 'panel',
    onChange: apply,
    onAction: (action) => {
      if (action === 'ok' || action === 'cancel') stop();
    },
  });
  offs.push(
    chart.on('series:remove', ({ series: removed }) => {
      if (removed !== series) return;
      stop();
      dialog.close();
    }),
    // A destroyed chart has nothing to put back.
    chart.on('chart:destroy', () => {
      live = false;
      stop();
      dialog.close();
    }),
  );
  // The form's own handle, with `close` also putting the series back.
  return Object.create(dialog, {
    close: {
      value: () => {
        if (!dialog.isOpen) return;
        stop();
        dialog.close();
        apply(form.values);
      },
    },
  }) as FormDialog;
}

/** Returned by `createSeriesSettings`: opens a series' style panel and reads the open one. */
export interface SeriesSettingsHandle {
  /** Open the style panel of `series`, cancelling one already open. Null when it has nothing to edit. */
  open(series: Series): FormDialog | null;
  /** The open panel, if any. */
  readonly dialog: FormDialog | null;
  destroy(): void;
}

/**
 * Style panels for a chart's compared symbols and plain series: a legend
 * row's settings button and its menu's Settings… item (`series:settings`)
 * open `openSeriesStyleSettings` for every series `hasSeriesStyleSettings`
 * accepts, and only those rows show the button.
 */
export function createSeriesSettings(chart: Chart, host: HTMLElement): SeriesSettingsHandle {
  let current: FormDialog | null = null;
  const open = (series: Series): FormDialog | null => {
    if (current?.isOpen) current.cancel();
    current = openSeriesStyleSettings(chart, host, series);
    return current;
  };
  const accepts = (series: Series) => hasSeriesStyleSettings(chart, series);
  const offProvider = chart.provideSeriesSettings((series, indicator) => indicator === null && accepts(series));
  const offSettings = chart.on('series:settings', ({ series, indicator }) => {
    if (!indicator && accepts(series)) open(series);
  });
  return {
    open,
    get dialog() {
      return current?.isOpen ? current : null;
    },
    destroy() {
      offProvider();
      offSettings();
      if (current?.isOpen) current.cancel();
      current = null;
    },
  };
}
