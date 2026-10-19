import {
  darkTheme,
  inputFields,
  resolvePlotStyle,
  type Chart,
  type ChartTheme,
  type Indicator,
  type IndicatorDef,
  type InputDef,
  type InputValue,
  type IntervalRange,
  type LineStyle,
  type PlotDef,
  type PlotStyle,
} from '@chart-on/core';
import { h } from './dom';
import { createListbox } from './listbox';
import { createFormDialog, type FormDialog } from './form-dialog';
import { same } from './chart-settings';
import { acceptedValues, defaultFormActions, defaultSources, formInputs, type FormAction, type FormGroup, type FormInputDef, type FormSection, type FormSchema, type FormValues } from './form-model';
import { lineStyleOptions } from './drawing-style-controls';
import { INTERVAL_GROUPS, intervalGroupText } from './legend-menu';
import { builtinText, shellText, type Localized, type ShellMessageKey } from './messages';

/** Form ids: inputs are prefixed so they never collide with the other fields. */
const INPUT = 'input.';
const VISIBLE = 'visible';
const SHOW = 'show.';
/** Plot style fields: `plot.<id>.visible`, `.lineWidth` and `.lineStyle`. */
const PLOT = 'plot.';
const plotField = (plot: PlotDef, key: keyof PlotStyle) => `${PLOT}${plot.id}.${key}`;

/** Line widths offered, besides the plot's current and declared ones. */
const LINE_WIDTHS = [1, 2, 3, 4];

const ACTIONS: FormAction[] = [
  { id: 'reset', label: 'Reset to defaults', labelKey: 'dialogResetDefaults', role: 'reset', align: 'start' },
  ...defaultFormActions,
];

/** What the settings show of an indicator; `Indicator.serialize()` has it. */
export interface IndicatorSettingsState {
  inputs: Readonly<Record<string, InputValue>>;
  visible: boolean;
  /** Intervals it shows on; missing or null means every interval. */
  visibleOn?: readonly IntervalRange[] | null;
  /** Plot styles set over the definition's, by plot id; missing means none. */
  plotStyles?: Readonly<Record<string, PlotStyle>> | null;
}

/** What `indicatorSettingsForm` builds: the form schema of an indicator's settings and the values it opens with. */
export interface IndicatorSettingsForm {
  schema: FormSchema;
  /** The values the panel opens with, by form input id. */
  values: FormValues;
}

/** The indicator inputs held in form `values`. */
function inputsOf(values: Readonly<FormValues>): Record<string, InputValue> {
  const out: Record<string, InputValue> = {};
  for (const [key, value] of Object.entries(values)) if (key.startsWith(INPUT)) out[key.slice(INPUT.length)] = value as InputValue;
  return out;
}

/**
 * The colour drawn while colour input `id` of `def` is empty: its plot's own
 * colour, else the theme's (up and down for an OHLC plot, or a histogram with no colour at all).
 */
function drawnColor(def: IndicatorDef, id: string, theme: ChartTheme): string {
  const lineOf = (color: string | undefined) => color ?? theme.line;
  for (const plot of def.plots) {
    if (plot.colorInput === id) return lineOf(plot.color);
    if (plot.type === 'ohlc') {
      if (plot.upColorInput === id) return plot.upColor ?? theme.up;
      if (plot.downColorInput === id) return plot.downColor ?? theme.down;
    }
    if (plot.type !== 'histogram') continue;
    const plain = !plot.color && !plot.colorInput;
    if (plot.positiveColorInput === id) return plot.positiveColor ?? (plain ? theme.up : lineOf(plot.color));
    if (plot.negativeColorInput === id) return plot.negativeColor ?? (plain ? theme.down : lineOf(plot.color));
  }
  return theme.line;
}

/** The form input for indicator input `def`, with its rules evaluated by core so the form rejects what `applyInputs` would. */
function formInput(def: InputDef, indicator: IndicatorDef, theme: ChartTheme, chart: Localized): FormInputDef {
  const all = indicator.inputs;
  const field = (values: Readonly<FormValues>) =>
    inputFields(all, inputsOf(values))
      .flatMap((g) => g.fields)
      .find((f) => f.input.id === def.id)!;
  const base = {
    id: INPUT + def.id,
    label: builtinText(chart, `input.${indicator.id}.${def.id}`, def.label ?? def.id),
    ...(def.visible ? { visible: (values: Readonly<FormValues>) => field(values).visible } : {}),
    ...(def.disabled ? { disabled: (values: Readonly<FormValues>) => field(values).disabled } : {}),
    validate: (_value: unknown, values: Readonly<FormValues>) => field(values).error,
  };
  switch (def.type) {
    case 'number':
      return { ...base, kind: 'number', default: def.default, min: def.min, max: def.max, step: def.step };
    case 'source':
      // The form names the bar values (`source.<value>`); volume is this dialog's own addition.
      return {
        ...base,
        kind: 'source',
        default: def.default,
        // The form's default price sources plus volume.
        options: defaultSources.flatMap((o) => (o.value === 'close' ? [o, { value: 'volume', label: builtinText(chart, 'source.volume', 'Volume') }] : [o])),
      };
    case 'color':
      // Empty means "use the plot or theme colour" to core, so the form accepts it and shows that colour.
      return { ...base, kind: 'color', default: def.default, placeholder: drawnColor(indicator, def.id, theme) };
    case 'boolean':
      return { ...base, kind: 'boolean', default: def.default };
    case 'select':
      return { ...base, kind: 'select', default: def.default, options: def.options.map((o) => ({ value: o.value, label: builtinText(chart, `input.${indicator.id}.${def.id}.${o.value}`, o.label ?? String(o.value)) })) };
    case 'text':
      return { ...base, kind: 'text', default: def.default, maxLength: def.maxLength };
  }
}

/** The style of `plot` held in form `values`; line width and style only for line plots. */
function plotStyleOf(plot: PlotDef, values: Readonly<FormValues>): PlotStyle {
  const visible = values[plotField(plot, 'visible')] !== false;
  if (plot.type !== 'line') return { visible };
  // In the order `getPlotStyle` gives, so the two compare as JSON.
  return { lineWidth: values[plotField(plot, 'lineWidth')] as number, lineStyle: values[plotField(plot, 'lineStyle')] as LineStyle, visible };
}

/** The Style tab's group for `plot`: visible, plus line width and style for lines (disabled while hidden). */
function plotGroup(def: IndicatorDef, plot: PlotDef, current: PlotStyle, chart: Pick<Chart, 'localization'> | null | undefined): FormGroup {
  const declared = resolvePlotStyle(plot, undefined);
  const visibleId = plotField(plot, 'visible');
  const inputs: FormInputDef[] = [{ id: visibleId, label: shellText(chart, 'indicatorPlotVisible'), kind: 'boolean', default: true }];
  if (plot.type === 'line') {
    const hidden = (values: Readonly<FormValues>) => values[visibleId] === false;
    const widths = [...new Set([...LINE_WIDTHS, declared.lineWidth!, current.lineWidth!])].sort((a, b) => a - b);
    inputs.push(
      {
        id: plotField(plot, 'lineWidth'),
        label: shellText(chart, 'indicatorPlotLineWidth'),
        kind: 'select',
        options: widths.map((w) => ({ value: w, label: `${w}px` })),
        default: declared.lineWidth!,
        disabled: hidden,
      },
      {
        id: plotField(plot, 'lineStyle'),
        label: shellText(chart, 'indicatorPlotLineStyle'),
        kind: 'select',
        options: lineStyleOptions(chart),
        default: declared.lineStyle!,
        disabled: hidden,
      },
    );
  }
  const label = plot.title !== undefined ? builtinText(chart, `plot.${def.id}.${plot.id}`, plot.title) : def.plots.length === 1 ? shellText(chart, 'indicatorPlot') : plot.id;
  return { id: `plot-${plot.id}`, label, inputs };
}

const sameRange = (a: IntervalRange, b: IntervalRange) => a.from === b.from && a.to === b.to;

/** Interval groups switched on in `values`: null (every interval) when all are. */
function rangesOf(values: Readonly<FormValues>): IntervalRange[] | null {
  const on = INTERVAL_GROUPS.filter((g) => values[SHOW + g.id] === true);
  return on.length === INTERVAL_GROUPS.length ? null : on.map((g) => ({ ...g.range }));
}

const sameShow = (a: Readonly<FormValues>, b: Readonly<FormValues>) => INTERVAL_GROUPS.every((g) => a[SHOW + g.id] === b[SHOW + g.id]);

/**
 * The settings form of an indicator with definition `def`: an **Inputs** tab
 * (every input but colours, in its `group`), a **Style** tab (colour inputs,
 * each plot's visibility, line width and line style, and the indicator's
 * visibility) and a **Visibility** tab (the interval groups it shows on).
 * Reset to defaults restores the definition's defaults, shown, on every
 * interval. `chart` gives the language of the plot style labels and the theme
 * (default the dark theme) whose colours a colour input left empty shows; such
 * an input follows the theme and stays empty until one is picked. Reset to
 * defaults empties it again.
 */
export function indicatorSettingsForm(
  def: IndicatorDef,
  state: IndicatorSettingsState,
  chart?: (Pick<Chart, 'localization'> & { readonly theme?: ChartTheme }) | null,
): IndicatorSettingsForm {
  const theme = chart?.theme ?? darkTheme;
  const t = (key: ShellMessageKey) => shellText(chart, key);
  const groups = inputFields(def.inputs, state.inputs);
  const values: FormValues = { [VISIBLE]: state.visible };
  for (const field of groups.flatMap((g) => g.fields)) values[INPUT + field.input.id] = field.value;
  const plotGroups = def.plots.map((plot) => {
    const current = resolvePlotStyle(plot, state.plotStyles?.[plot.id]);
    values[plotField(plot, 'visible')] = current.visible;
    if (plot.type === 'line') {
      values[plotField(plot, 'lineWidth')] = current.lineWidth;
      values[plotField(plot, 'lineStyle')] = current.lineStyle;
    }
    return plotGroup(def, plot, current, chart);
  });
  const ranges = state.visibleOn && state.visibleOn.length > 0 ? state.visibleOn : null;
  for (const g of INTERVAL_GROUPS) values[SHOW + g.id] = ranges === null || ranges.some((r) => sameRange(r, g.range));

  const pick = (colors: boolean): FormGroup[] =>
    groups
      .map((g, i): FormGroup => {
        const label = g.name !== null ? builtinText(chart, `inputGroup.${def.id}.${g.name}`, g.name) : colors ? t('indicatorColors') : undefined;
        return {
          id: `${colors ? 'colors' : 'inputs'}-${i}`,
          ...(label ? { label } : {}),
          inputs: g.fields.filter((f) => (f.input.type === 'color') === colors).map((f) => formInput(f.input, def, theme, chart)),
        };
      })
      .filter((g) => g.inputs.length > 0);

  const sections: FormSection[] = [];
  const inputs = pick(false);
  if (inputs.length > 0) sections.push({ id: 'inputs', title: t('indicatorInputs'), groups: inputs });
  sections.push({
    id: 'style',
    title: t('dialogStyle'),
    groups: [
      ...pick(true),
      ...plotGroups,
      { id: 'display', label: t('indicatorDisplay'), inputs: [{ id: VISIBLE, label: t('indicatorPlotVisible'), kind: 'boolean', default: true }] },
    ],
  });
  const atLeastOne = (_value: unknown, all: Readonly<FormValues>) =>
    INTERVAL_GROUPS.some((g) => all[SHOW + g.id] === true) ? null : t('drawingVisibleNone');
  sections.push({
    id: 'visibility',
    title: t('drawingVisibility'),
    groups: [
      {
        id: 'intervals',
        label: t('seriesShowOn'),
        inputs: INTERVAL_GROUPS.map(
          (g): FormInputDef => ({ id: SHOW + g.id, label: intervalGroupText(chart, g), kind: 'boolean', default: true, validate: atLeastOne }),
        ),
      },
    ],
  });
  return { schema: { id: 'indicator-settings', title: builtinText(chart, `indicator.${def.id}`, def.name), sections, actions: ACTIONS }, values };
}

/** What `IndicatorSettingsOptions.headerControl` gets for an indicator's settings panel. */
export interface IndicatorSettingsContext {
  readonly chart: Chart;
  /** The element the panel opens in, for dialogs of the control's own. */
  readonly host: HTMLElement;
  readonly indicator: Indicator;
  /** The indicator's definition id. */
  readonly type: string;
  /** The inputs and plot styles, by form input id, with the values the panel shows now. */
  style(): FormValues;
  /**
   * Fill inputs and plot styles in, applied live like an edit: Ok keeps them,
   * Cancel puts the indicator back. Fields the panel does not show, or would
   * refuse (such as a number out of range or an unknown choice), are left
   * out. Returns whether any field was filled in; false once the panel has closed.
   */
  setStyle(values: FormValues): boolean;
}

/** Options for `openIndicatorSettings`: what happens when the user switches to another indicator from the panel's header, and a control for the header. */
export interface IndicatorSettingsOptions {
  /**
   * Called when the user picks another indicator in the header's switcher,
   * after the open panel kept its edits and closed. Default: open that
   * indicator's settings in the same host.
   */
  onSwitch?(indicator: Indicator): void;
  /**
   * A control for the panel's header, made when the panel opens and destroyed
   * when it closes; null for none. The template menu of
   * `@chart-on/ui/templates` (`indicatorTemplates()`) is one.
   */
  headerControl?: (context: IndicatorSettingsContext) => { readonly el: HTMLElement; destroy(): void } | null;
}

const onChart = (chart: Chart, indicator: Indicator) => chart.indicators.getAll().includes(indicator);
const titleOf = (indicator: Indicator) => indicator.series?.options.title || indicator.def?.name || indicator.type;

/**
 * Open the settings panel of `indicator` in `host`, docked to its right edge
 * (a bottom sheet when the host is narrow) so the chart stays in view. Edits
 * apply live; Ok keeps them, Cancel, Escape, the close button and `close()`
 * put the indicator back as it was. The header switches to the other
 * indicators on the chart. The panel closes if the indicator is removed.
 * Null while the indicator's definition is not registered.
 */
export function openIndicatorSettings(
  chart: Chart,
  host: HTMLElement,
  indicator: Indicator,
  options: IndicatorSettingsOptions = {},
): FormDialog | null {
  const def = indicator.def;
  if (!def || !onChart(chart, indicator)) return null;
  const form = indicatorSettingsForm(def, indicator.serialize(), chart);
  const initialRanges = indicator.visibleOn;

  const apply = (values: FormValues) => {
    if (!onChart(chart, indicator)) return;
    const inputs = inputsOf(values);
    if (!same(inputs, { ...indicator.inputs })) indicator.applyInputs(inputs);
    const visible = values[VISIBLE] === true;
    if (visible !== indicator.visible) indicator.setVisible(visible);
    // Ranges the interval groups cannot show (set through the API) stay until the user changes the groups.
    const ranges = sameShow(values, form.values) ? initialRanges : rangesOf(values);
    if (!same(ranges, indicator.visibleOn)) indicator.setVisibleOn(ranges);
    for (const plot of def.plots) {
      const style = plotStyleOf(plot, values);
      if (!same(style, indicator.getPlotStyle(plot.id))) indicator.setPlotStyle(plot.id, style);
    }
  };

  const others = chart.indicators.getAll().filter((i) => i.def);
  const headerControls: HTMLElement[] = [];
  let switcher: HTMLElement | null = null;
  if (others.length > 1) {
    const self = others.indexOf(indicator);
    const select = createListbox({
      options: others.map((other, i) => ({ value: i, label: titleOf(other) })),
      value: self,
      label: shellText(chart, 'seriesKindIndicator'),
      className: 'pc-indicator-switch',
      localization: chart.localization,
      set: (value) => {
        const target = others[value as number];
        if (!target || target === indicator) return;
        // Keep the edits; an invalid field stays open for a fix.
        if (!handle.submit()) return select.setValue(self);
        if (options.onSwitch) options.onSwitch(target);
        else openIndicatorSettings(chart, host, target, options);
      },
    });
    switcher = select.el;
    headerControls.push(switcher);
  }

  // Inputs and plot styles, what a template holds; not the visibility fields.
  const styleInputs = formInputs(form.schema).filter((input) => input.id.startsWith(INPUT) || input.id.startsWith(PLOT));
  let control = options.headerControl?.({
    chart,
    host,
    indicator,
    type: def.id,
    style: () => Object.fromEntries(styleInputs.map(({ id }) => [id, dialog.values[id]])),
    setStyle: (values) => {
      const accepted = dialog.isOpen ? acceptedValues(styleInputs, values, dialog.values) : {};
      if (Object.keys(accepted).length === 0) return false;
      dialog.setValues(accepted);
      if (Object.keys(dialog.errors).length === 0) apply(dialog.values);
      return true;
    },
  });
  if (control) headerControls.push(control.el);

  let off: (() => void) | null = null;
  const stop = () => {
    off?.();
    off = null;
    control?.destroy();
    control = null;
    chart.indicators.mergeEdits(null);
  };
  const dialog = createFormDialog(host, form.schema, {
    localization: chart.localization,
    values: form.values,
    presentation: 'panel',
    headerControls,
    onChange: apply,
    onAction: (action) => {
      // `setStyle` changes values without `onChange`, so the form may not put them back itself.
      if (action === 'cancel') apply(form.values);
      if (action === 'ok' || action === 'cancel') stop();
    },
  });
  // The switcher names the indicator, so it takes the title's place; the title stays the dialog's accessible name.
  const title = Array.from(switcher?.parentElement?.children ?? []).find((el) => el.className.split(/\s+/).includes('pc-dialog-title'));
  if (title) title.className += ' pc-sr-only';
  // The panel's edits are one undo step; Cancel puts them back and leaves none.
  chart.indicators.mergeEdits(indicator);
  off = chart.on('indicator:remove', ({ indicator: removed }) => {
    if (removed !== indicator) return;
    stop();
    dialog.close();
  });
  // The form's own handle, with `close` also putting the indicator back.
  const handle: FormDialog = Object.create(dialog, {
    close: {
      value: () => {
        if (!dialog.isOpen) return;
        apply(form.values);
        stop();
        dialog.close();
      },
    },
  });
  return handle;
}

/** Returned by `createIndicatorSettings`: opens an indicator's settings panel and reads the open one. */
export interface IndicatorSettingsHandle {
  /** Open the settings panel of `indicator`, cancelling one already open. Null while its definition is not registered. */
  open(indicator: Indicator): FormDialog | null;
  /** The open panel, if any. */
  readonly dialog: FormDialog | null;
  destroy(): void;
}

/**
 * Indicator settings for a chart: `open(indicator)` shows its settings panel
 * (see `openIndicatorSettings`), and so do a legend row's settings button,
 * its menu's Settings… item (`series:settings`) for indicators, and
 * double-clicking one of an indicator's plots. The legend shows those
 * buttons on the rows of indicators whose definition is registered.
 */
export function createIndicatorSettings(
  chart: Chart,
  host: HTMLElement,
  options: Pick<IndicatorSettingsOptions, 'headerControl'> = {},
): IndicatorSettingsHandle {
  let current: FormDialog | null = null;
  const open = (indicator: Indicator): FormDialog | null => {
    if (current?.isOpen) current.cancel();
    current = openIndicatorSettings(chart, host, indicator, { ...options, onSwitch: open });
    return current;
  };
  const offProvider = chart.provideSeriesSettings((_series, indicator) => indicator?.def != null);
  const offSettings = chart.on('series:settings', ({ indicator }) => {
    if (indicator) open(indicator);
  });
  const offDoubleClick = chart.on('plot:dblclick', ({ x, y }) => {
    const series = chart.seriesAt(x, y);
    const indicator = series && chart.indicators.getAll().find((i) => i.series === series);
    if (indicator) open(indicator);
  });
  return {
    open,
    get dialog() {
      return current?.isOpen ? current : null;
    },
    destroy() {
      offProvider();
      offSettings();
      offDoubleClick();
      if (current?.isOpen) current.cancel();
      current = null;
    },
  };
}
