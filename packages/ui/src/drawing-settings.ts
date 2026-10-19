import {
  intervalSeconds,
  resolveFont,
  type Chart,
  type ChartTheme,
  type Drawing,
  type DrawingLevel,
  type DrawingPatch,
  type DrawingSettingDef,
  type DrawingStyle,
  type DrawingToolDef,
  type Interval,
  type IntervalRange,
} from '@chart-on/core';
import { DEFAULT_LINE_WIDTH, defaultFill, drawnColor, drawnTextColor, fieldLabel, fontSizes, levelsControl, LINE_WIDTHS, lineStyleOptions, positionColor, TOGGLES } from './drawing-style-controls';
import { createFormDialog, type FormDialog } from './form-dialog';
import type { InputRenderer } from './form-inputs';
import { acceptedValues, defaultFormActions, formInputs, type FormAction, type FormGroup, type FormInputDef, type FormSchema, type FormSection, type FormValues } from './form-model';
import { shellText, type Localized, type ShellMessageKey } from './messages';

/** Form kind of the levels editor; local to the drawing settings dialog. */
const LEVELS_KIND = 'drawing-levels';
const LINE_KEYS = new Set(['color', 'lineWidth', 'lineStyle', 'fill', 'showFill', 'profitColor', 'lossColor', 'extendLeft', 'extendRight', 'middleLine']);
const TEXT_KEYS = new Set(['textColor', 'fontSize', 'bold', 'italic', 'showLabel', 'labelSide', 'labelContent', 'showStats']);

/**
 * Style fields that take one of a few values, each with the message naming
 * it. The first is what the field shows when the style and tool leave it
 * out: left labels (reading order) and the level alone, as the tools draw.
 */
const CHOICES: Readonly<Record<string, readonly (readonly [string, ShellMessageKey])[]>> = {
  labelSide: [
    ['left', 'seriesScaleLeft'],
    ['right', 'seriesScaleRight'],
  ],
  labelContent: [
    ['level', 'drawingLabelLevel'],
    ['price', 'seriesPrice'],
    ['both', 'drawingLabelBoth'],
    ['percent', 'drawingLabelPercent'],
  ],
};

const ACTIONS: FormAction[] = [{ id: 'reset', label: 'Reset', labelKey: 'dialogReset', role: 'reset', align: 'start' }, ...defaultFormActions];

type StyleRecord = Record<string, unknown>;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';
const levelsOf = (v: unknown): DrawingLevel[] => (Array.isArray(v) ? v.map((l: DrawingLevel) => ({ ...l })) : []);

/** A plugin setting's value, or the value it shows when the style leaves it out. */
function settingValue(def: DrawingSettingDef, value: unknown, theme: ChartTheme): unknown {
  switch (def.type) {
    case 'color':
      return nonEmpty(value) ? value : theme.drawing;
    case 'boolean':
      return typeof value === 'boolean' ? value : false;
    case 'text':
      return typeof value === 'string' ? value : '';
    case 'number':
      return finite(value) ? value : Math.min(def.max ?? 0, Math.max(def.min ?? 0, 0));
    case 'select':
      return def.options.some((o) => o.value === value) ? value : def.options[0]?.value;
    case 'levels':
      return levelsOf(value);
  }
}

/**
 * The value field `key` shows for a drawing of `tool` with `style`: the
 * style's own, else the tool's `defaultStyle`, else what the tool draws
 * without one (the theme's colors, solid 1.5 px lines, the theme font size).
 * Labels draw black or white over the line color, whichever contrasts more.
 */
export function settingsFieldValue(key: string, style: DrawingStyle, tool: DrawingToolDef | undefined, theme: ChartTheme, drawing?: Drawing): unknown {
  // A field set to undefined falls back to the tool's default, as when drawn.
  const s: StyleRecord = { ...tool?.defaultStyle };
  for (const [k, v] of Object.entries(style)) if (v !== undefined) s[k] = v;
  const def = tool?.settings?.find((d) => d.key === key);
  if (def) return settingValue(def, s[key], theme);
  const color = drawnColor(s as DrawingStyle, tool, theme, drawing);
  switch (key) {
    case 'color':
      return color;
    case 'textColor':
      return drawnTextColor(s as DrawingStyle, tool, theme, drawing);
    case 'fill':
      // The tint of the line color the tool fills with when the style has no fill.
      return nonEmpty(s.fill) ? s.fill : defaultFill(color, tool);
    case 'profitColor':
    case 'lossColor':
      return nonEmpty(s[key]) ? s[key] : positionColor(key, theme);
    case 'lineWidth':
      return finite(s.lineWidth) && s.lineWidth > 0 ? s.lineWidth : DEFAULT_LINE_WIDTH;
    case 'lineStyle':
      return s.lineStyle === 'dashed' || s.lineStyle === 'dotted' ? s.lineStyle : 'solid';
    case 'fontSize':
      return finite(s.fontSize) && s.fontSize > 0 ? s.fontSize : theme.fontSize;
    case 'levels':
      return levelsOf(s.levels);
  }
  const choices = Object.hasOwn(CHOICES, key) ? CHOICES[key] : undefined;
  if (choices) return choices.find(([v]) => v === s[key])?.[0] ?? choices[0]![0];
  const toggle = TOGGLES[key];
  if (toggle) return typeof s[key] === 'boolean' ? s[key] : toggle.fallback;
  return undefined;
}

/** Sizes for a select: `sizes` plus the values shown and reset to, sorted. */
const sizeOptions = (sizes: readonly number[], ...extra: unknown[]) =>
  [...new Set([...sizes, ...extra.filter(finite)])].sort((a, b) => a - b).map((v) => ({ value: v, label: `${v}px` }));

/** The form input for a plugin setting, or null for one the form cannot show. */
function settingInput(def: DrawingSettingDef, base: { id: string; label: string; default: unknown }): FormInputDef | null {
  switch (def.type) {
    case 'color':
      return { ...base, kind: 'color', default: base.default as string };
    case 'boolean':
      return { ...base, kind: 'boolean', default: base.default as boolean };
    case 'text':
      return { ...base, kind: 'text', default: base.default as string };
    case 'number':
      return { ...base, kind: 'number', min: def.min, max: def.max, step: def.step, default: base.default as number };
    case 'select':
      if (def.options.length === 0) return null;
      return { ...base, kind: 'select', options: def.options, default: base.default as string };
    case 'levels':
      return { ...base, kind: LEVELS_KIND } as unknown as FormInputDef;
  }
}

/** The form input for style field `key`, or null for a field the dialog has no control for. */
function fieldInput(key: string, tool: DrawingToolDef | undefined, value: unknown, reset: unknown, chart: Localized, theme: ChartTheme): FormInputDef | null {
  const def = tool?.settings?.find((d) => d.key === key);
  const base = { id: key, label: def?.label ?? fieldLabel(chart, key) ?? key, default: reset };
  if (def) return settingInput(def, base);
  switch (key) {
    case 'color':
    case 'textColor':
    case 'profitColor':
    case 'lossColor':
      return { ...base, kind: 'color', default: reset as string };
    case 'fill':
      // Greyed out while the Background switch is off: a fill would not show.
      return { ...base, kind: 'color', default: reset as string, disabled: (all) => all.showFill === false };
    case 'lineWidth':
      return { ...base, kind: 'select', options: sizeOptions(LINE_WIDTHS, value, reset), default: reset as number };
    case 'fontSize':
      return { ...base, kind: 'select', options: sizeOptions(fontSizes(resolveFont(theme, 'drawings').fontSize), value, reset), default: reset as number };
    case 'lineStyle':
      return {
        ...base,
        kind: 'select',
        options: lineStyleOptions(chart),
        default: reset as string,
      };
    case 'levels':
      return { ...base, kind: LEVELS_KIND } as unknown as FormInputDef;
  }
  const choices = Object.hasOwn(CHOICES, key) ? CHOICES[key] : undefined;
  if (choices) return { ...base, kind: 'select', options: choices.map(([value, label]) => ({ value, label: shellText(chart, label) })), default: reset as string };
  return TOGGLES[key] ? { ...base, kind: 'boolean', default: reset as boolean } : null;
}

export interface DrawingSettingsForm {
  schema: FormSchema;
  /** The values the dialog opens with, by style field. */
  values: FormValues;
}

/**
 * The settings form for a drawing of `tool` with `style`: one input per
 * style field in `fields` (the tool's `styleFields`) and per `settings`
 * entry, grouped into line, text and the tool's own options, with levels on
 * a tab of their own. Reset goes back to the tool's own `defaultStyle`.
 * Null when there is nothing to edit. `options.localization` gives the language of the labels;
 * `options.drawing`, for a tool whose color depends on its points, the drawing.
 */
export function drawingSettingsForm(
  style: DrawingStyle,
  tool: DrawingToolDef | undefined,
  fields: readonly string[],
  theme: ChartTheme,
  options?: Localized & { drawing?: Drawing },
): DrawingSettingsForm | null {
  const keys = [...new Set([...fields, ...(tool?.settings ?? []).map((s) => s.key)])];
  const values: FormValues = {};
  const groups: Record<'line' | 'text' | 'options' | 'levels', FormInputDef[]> = { line: [], text: [], options: [], levels: [] };
  for (const key of keys) {
    const value = settingsFieldValue(key, style, tool, theme, options?.drawing);
    const input = fieldInput(key, tool, value, settingsFieldValue(key, {}, tool, theme, options?.drawing), options, theme);
    if (!input || value === undefined) continue;
    values[key] = value;
    if ((input.kind as string) === LEVELS_KIND) groups.levels.push(input);
    else groups[LINE_KEYS.has(key) ? 'line' : TEXT_KEYS.has(key) ? 'text' : 'options'].push(input);
  }
  const group = (id: keyof typeof groups, label?: string): FormGroup[] =>
    groups[id].length > 0 ? [{ id, ...(label ? { label } : {}), inputs: groups[id] }] : [];
  const t = (key: ShellMessageKey) => shellText(options, key);
  const styleGroups = [...group('line', t('seriesKindLine')), ...group('text', t('drawingText')), ...group('options', t('drawingOptions'))];
  const sections: FormSection[] = [];
  if (styleGroups.length > 0) sections.push({ id: 'style', title: t('dialogStyle'), groups: styleGroups });
  if (groups.levels.length > 0) sections.push({ id: 'levels', title: t('drawingLevels'), groups: group('levels') });
  if (sections.length === 0) return null;
  return { schema: { id: 'drawing-settings', title: tool?.label ?? t('drawingFallback'), sections, actions: ACTIONS }, values };
}

/** The fields of `initial` whose value in `values` differs, as a style patch; other fields of `values` are ignored. */
export function changedStyle(values: FormValues, initial: FormValues): DrawingStyle {
  const out: StyleRecord = {};
  for (const [key, before] of Object.entries(initial)) {
    if (JSON.stringify(values[key]) !== JSON.stringify(before)) out[key] = values[key];
  }
  return out as DrawingStyle;
}

/** Form ids of the Visibility tab: `show.<unit>` toggles a unit, `span.<unit>` holds its `[from, to]` counts. */
const SHOW = 'show.';
const SPAN = 'span.';

/**
 * The Visibility tab's rows, shortest first, with the spans of the legend's
 * interval groups so the rows never overlap by length (24 hours would be a
 * day). The top of the months row, 12, also covers years and longer.
 */
const UNITS: readonly { unit: 's' | 'm' | 'h' | 'd' | 'w' | 'M'; max: number; label: ShellMessageKey }[] = [
  { unit: 's', max: 59, label: 'intervalSeconds' },
  { unit: 'm', max: 59, label: 'intervalMinutes' },
  { unit: 'h', max: 23, label: 'intervalHours' },
  { unit: 'd', max: 6, label: 'intervalDays' },
  { unit: 'w', max: 4, label: 'intervalWeeks' },
  { unit: 'M', max: 12, label: 'drawingVisibleMonths' },
];
const LONGEST: Interval = '100y';

/** The rows' values for `ranges`: each unit on with the counts the ranges cover in it; every unit in full for none. */
function visibilityValues(ranges: readonly IntervalRange[] | null | undefined): FormValues {
  const values: FormValues = {};
  for (const { unit, max } of UNITS) {
    const length = intervalSeconds(`1${unit}`);
    const top = unit === 'M' ? Infinity : max * length;
    let from = Infinity;
    let to = -Infinity;
    for (const r of ranges ?? []) {
      // The top of the months row also stands for everything longer.
      const a = Math.min(Math.ceil(Math.max(intervalSeconds(r.from), length) / length), top === Infinity ? max : Infinity);
      const b = Math.min(max, Math.floor(Math.min(intervalSeconds(r.to), top) / length));
      if (a > b) continue;
      from = Math.min(from, a);
      to = Math.max(to, b);
    }
    const none = !ranges || ranges.length === 0;
    values[SHOW + unit] = none || from <= to;
    values[SPAN + unit] = from <= to ? [from, to] : [1, max];
  }
  return values;
}

/** The `visibleOn` ranges the rows in `values` hold: null (every interval) when every unit is on in full. */
function visibleOnOf(values: Readonly<FormValues>): IntervalRange[] | null {
  const ranges: IntervalRange[] = [];
  let full = true;
  for (const { unit, max } of UNITS) {
    const [from, to] = values[SPAN + unit] as [number, number];
    if (values[SHOW + unit] !== true) {
      full = false;
      continue;
    }
    if (from !== 1 || to !== max) full = false;
    ranges.push({ from: `${from}${unit}`, to: unit === 'M' && to === max ? LONGEST : `${to}${unit}` });
  }
  return full ? null : ranges;
}

const sameVisibility = (a: Readonly<FormValues>, b: Readonly<FormValues>) =>
  UNITS.every(({ unit }) => a[SHOW + unit] === b[SHOW + unit] && JSON.stringify(a[SPAN + unit]) === JSON.stringify(b[SPAN + unit]));

export interface DrawingVisibilityForm {
  section: FormSection;
  /** The values the tab opens with, by form input id. */
  values: FormValues;
  /**
   * The `visibleOn` the tab's fields in `values` stand for, or undefined
   * while they are as opened, so ranges the rows cannot show exactly (set
   * from code) stay until the tab is edited.
   */
  rangesOf(values: Readonly<FormValues>): IntervalRange[] | null | undefined;
}

/**
 * The drawing settings' **Visibility** tab for a drawing shown on `ranges`
 * (its `visibleOn`): per unit (seconds to months) an on/off toggle and the
 * counts from and to. Reset turns every unit on in full, which means every
 * interval. `chart` gives the language of the labels.
 */
export function drawingVisibilityForm(
  ranges: readonly IntervalRange[] | null | undefined,
  chart?: Pick<Chart, 'localization'> | null,
): DrawingVisibilityForm {
  const values = visibilityValues(ranges);
  const t = (key: ShellMessageKey, params?: Record<string, string>) => shellText(chart, key, params);
  // An unedited tab is valid even when the saved ranges cover none of the rows.
  const atLeastOne = (_value: unknown, all: Readonly<FormValues>) =>
    UNITS.some(({ unit }) => all[SHOW + unit] === true) || sameVisibility(all, values) ? null : t('drawingVisibleNone');
  const whole = (value: [number, number]) => (value.every(Number.isInteger) ? null : t('drawingVisibleWhole'));
  const inputs = UNITS.flatMap(({ unit, max, label }): FormInputDef[] => {
    const name = t(label);
    return [
      { id: SHOW + unit, label: name, kind: 'boolean', default: true, validate: atLeastOne },
      {
        id: SPAN + unit,
        label: t('drawingVisibleRange', { unit: name }),
        kind: 'range',
        min: 1,
        max,
        step: 1,
        default: [1, max],
        disabled: (all) => all[SHOW + unit] !== true,
        validate: whole,
      },
    ];
  });
  return {
    section: { id: 'visibility', title: t('drawingVisibility'), groups: [{ id: 'intervals', label: t('seriesShowOn'), inputs }] },
    values,
    rangesOf: (all) => (sameVisibility(all, values) ? undefined : visibleOnOf(all)),
  };
}

/** Form renderer for a levels list, with the level color falling back to the form's `color`. */
function levelsInput(theme: ChartTheme, chart: Localized): InputRenderer<FormInputDef, DrawingLevel[]> {
  return (_input, ctx) => {
    const color = () => (nonEmpty(ctx.values.color) ? ctx.values.color : theme.drawing);
    const control = levelsControl(
      (levels) => {
        control.show(levels, color());
        ctx.set(levels);
      },
      () => theme,
      chart,
    );
    control.el.setAttribute('id', ctx.controlId);
    control.show(levelsOf(ctx.value), color());
    return {
      el: control.el,
      setValue: (value) => control.show(levelsOf(value), color()),
      setDisabled: () => {},
    };
  };
}

/** What `DrawingSettingsOptions.headerControl` gets for the dialog of a drawing with style fields. */
export interface DrawingSettingsContext {
  readonly chart: Chart;
  /** The element the dialog opens in, for dialogs of the control's own. */
  readonly host: HTMLElement;
  /** The drawing's tool type. */
  readonly type: string;
  /** The style fields (the Style and Levels tabs) with the values the form shows now. */
  style(): FormValues;
  /**
   * Fill style fields in, previewed like an edit: Ok commits them, Cancel
   * drops them. Fields the form does not show, or would refuse (such as a
   * number out of range or an unknown choice), are left out. Returns whether
   * any field was filled in; false once the dialog has closed.
   */
  setStyle(values: FormValues): boolean;
}

/** Options for `openDrawingSettings` and `createDrawingSettings`, and the shell's `drawingSettings` option. */
export interface DrawingSettingsOptions {
  /**
   * A control for the dialog's header, made when the dialog of a drawing with
   * style fields opens and destroyed when it closes; null for none. The
   * template menu of `@chart-on/ui/templates` (`drawingTemplates()`) is one.
   */
  headerControl?: (context: DrawingSettingsContext) => { readonly el: HTMLElement; destroy(): void } | null;
}

/**
 * Open the settings dialog of drawing `id` in `host` (the shell element, so
 * it picks up the theme): its tool's style fields and `settings`, and a
 * Visibility tab for the intervals it shows on (`visibleOn`). Style edits
 * preview live; Ok commits the changed style fields and intervals with one
 * `chart.drawings.update`, so one undo step, and with `rememberStyle` on the
 * style fields become the tool's defaults. Cancel, Escape or closing put the
 * drawing back. The dialog closes if the drawing is removed. Null for an
 * unknown id.
 */
export function openDrawingSettings(chart: Chart, host: HTMLElement, id: string, options: DrawingSettingsOptions = {}): FormDialog | null {
  const drawing = chart.drawings.getById(id);
  if (!drawing) return null;
  const tool = chart.drawings.getTools().find((t) => t.type === drawing.type);
  const form = drawingSettingsForm(drawing.style, tool, chart.drawings.styleFields(id), chart.theme, { localization: chart.localization, drawing });
  const visibility = drawingVisibilityForm(drawing.visibleOn, chart);
  const initial = form?.values ?? {};
  const schema: FormSchema = {
    id: 'drawing-settings',
    title: tool ? chart.drawings.toolLabel(tool.type) : shellText(chart, 'drawingFallback'),
    actions: ACTIONS,
    sections: [...(form?.schema.sections ?? []), visibility.section],
  };
  let previewing = false;
  let off: (() => void) | null = null;

  const preview = (values: FormValues) => {
    // Each preview starts from the committed drawing, so a field changed back drops out.
    if (previewing) chart.drawings.cancelPreview();
    const style = changedStyle(values, initial);
    previewing = Object.keys(style).length > 0;
    if (previewing) chart.drawings.preview(id, { style });
  };
  /** Drop the preview and stop listening; with `values`, commit what changed. */
  const finish = (values: FormValues | null) => {
    if (previewing) chart.drawings.cancelPreview();
    previewing = false;
    off?.();
    off = null;
    control?.destroy();
    const current = values && chart.drawings.getById(id);
    if (!current) return;
    const patch: DrawingPatch = {};
    const style = changedStyle(values, initial);
    if (Object.keys(style).length > 0) patch.style = style;
    const ranges = visibility.rangesOf(values);
    if (ranges !== undefined && JSON.stringify(ranges ?? []) !== JSON.stringify(current.visibleOn ?? [])) patch.visibleOn = ranges;
    if (Object.keys(patch).length > 0) chart.drawings.update(id, patch);
  };

  const control =
    form &&
    options.headerControl?.({
      chart,
      host,
      type: drawing.type,
      style: () => Object.fromEntries(Object.keys(initial).map((key) => [key, dialog.values[key]])),
      setStyle: (values) => {
        const accepted = dialog.isOpen ? acceptedValues(formInputs(form.schema), values, dialog.values) : {};
        if (Object.keys(accepted).length === 0) return false;
        dialog.setValues(accepted);
        preview(dialog.values);
        return true;
      },
    });

  const dialog = createFormDialog(host, schema, {
    localization: chart.localization,
    values: { ...initial, ...visibility.values },
    inputs: { [LEVELS_KIND]: levelsInput(chart.theme, chart) as InputRenderer<never, never> },
    headerControls: control ? [control.el] : [],
    onChange: preview,
    onAction: (action, values) => {
      if (action === 'ok') finish(values);
      else if (action === 'cancel') finish(null);
    },
  });
  off = chart.on('drawing:remove', ({ id: removed }) => {
    if (removed === id) handle.close();
  });
  // The form's own handle, with `close` also dropping the preview.
  const handle: FormDialog = Object.create(dialog, {
    close: {
      value: () => {
        dialog.close();
        finish(null);
      },
    },
  });
  return handle;
}

/** Returned by `createDrawingSettings`: opens a drawing's settings dialog by id and reads the open one. */
export interface DrawingSettingsHandle {
  /** Open the settings dialog of drawing `id`, closing (cancelling) one already open. Null for an unknown id. */
  open(id: string): FormDialog | null;
  /** The open dialog, if any. */
  readonly dialog: FormDialog | null;
  destroy(): void;
}

/**
 * Drawing settings for a chart: `open(id)` shows a drawing's settings
 * dialog (see `openDrawingSettings`), and so does double-clicking a drawing,
 * except for text tools, which edit their text instead, and while all
 * drawings are locked.
 */
export function createDrawingSettings(chart: Chart, host: HTMLElement, options: DrawingSettingsOptions = {}): DrawingSettingsHandle {
  let current: FormDialog | null = null;
  const open = (id: string) => {
    if (current?.isOpen) current.cancel();
    current = openDrawingSettings(chart, host, id, options);
    return current;
  };
  const off = chart.on('drawing:dblclick', ({ id }) => {
    const d = chart.drawings.getById(id);
    if (!d || chart.drawings.locked) return;
    if (chart.drawings.getTools().find((t) => t.type === d.type)?.editableText) return;
    open(id);
  });
  return {
    open,
    get dialog() {
      return current?.isOpen ? current : null;
    },
    destroy() {
      off();
      if (current?.isOpen) current.cancel();
      current = null;
    },
  };
}
