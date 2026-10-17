/**
 * Schema types and the DOM-free rules of the form dialog: defaults,
 * conditional visibility, validation messages and schema checks.
 */

import { shellText, type Localized, type ShellMessageKey } from './messages';

/** Current values of a form, keyed by input id. */
export type FormValues = Record<string, unknown>;

/** A fixed flag, or one computed from the current values (re-evaluated after every change). */
export type FormCondition = boolean | ((values: Readonly<FormValues>) => boolean);

/** One choice of a select, multi-select or source input: the value it stands for and its label. */
export interface FormOption<V extends string | number = string | number> {
  value: V;
  label: string;
}

/** Fields every input has; custom input types extend it. */
export interface FormInputBase<V = unknown> {
  /** Key of this input's value in `FormValues`; unique within the schema. */
  id: string;
  label: string;
  /** Help text under the control. */
  hint?: string;
  /** Value when the form opens without one, and after a reset. */
  default?: V;
  /** Default `true`. Hidden inputs keep their value and are not validated. */
  visible?: FormCondition;
  /** Default `false`. Disabled inputs keep their value and are not validated. */
  disabled?: FormCondition;
  /** A message when `value` is not acceptable, else nothing. Runs after the built-in checks pass. */
  validate?(value: V, values: Readonly<FormValues>): string | null | undefined;
}

/** A number field (`kind: 'number'`), optionally bounded by `min` and `max` and limited to whole numbers. */
export interface NumberInputDef extends FormInputBase<number> {
  kind: 'number';
  min?: number;
  max?: number;
  step?: number;
  /** Only whole numbers are valid. */
  integer?: boolean;
}

/** A single-line text field (`kind: 'text'`), optionally required or capped in length. */
export interface TextInputDef extends FormInputBase<string> {
  kind: 'text';
  placeholder?: string;
  maxLength?: number;
  /** An empty or blank value is invalid. */
  required?: boolean;
}

/** An on/off checkbox (`kind: 'boolean'`). */
export interface BooleanInputDef extends FormInputBase<boolean> {
  kind: 'boolean';
}

/** A single choice from `options` (`kind: 'select'`): a closed control that opens a list of them. */
export interface SelectInputDef extends FormInputBase<string | number> {
  kind: 'select';
  options: FormOption[];
  /**
   * Put a search box over the list, for long lists. The search matches
   * option labels and values. Default false.
   */
  searchable?: boolean;
}

/** Any number of choices from `options` (`kind: 'multi-select'`); the value is the chosen values. */
export interface MultiSelectInputDef extends FormInputBase<(string | number)[]> {
  kind: 'multi-select';
  options: FormOption[];
}

/** A color picker (`kind: 'color'`) with swatches, a custom color and opacity; the value is a CSS color string. */
export interface ColorInputDef extends FormInputBase<string> {
  kind: 'color';
  /** Swatches offered in the picker; default the shell's palette. */
  swatches?: readonly string[];
  /**
   * The color shown while the value is empty. With one, an empty value is
   * valid and means no color was chosen, e.g. "follow the theme".
   */
  placeholder?: string;
}

/** A slider between `min` and `max` (`kind: 'slider'`), with an optional unit shown after the value. */
export interface SliderInputDef extends FormInputBase<number> {
  kind: 'slider';
  min: number;
  max: number;
  step?: number;
  /** Shown after the value, e.g. `%`. */
  unit?: string;
}

/** A pair of numbers `[from, to]` with `from <= to`. */
export interface RangeInputDef extends FormInputBase<[number, number]> {
  kind: 'range';
  min?: number;
  max?: number;
  step?: number;
}

/** Which bar value (or other series) a calculation reads. */
export interface SourceInputDef extends FormInputBase<string> {
  kind: 'source';
  /** Default `defaultSources`: open, high, low, close and the usual averages. */
  options?: FormOption<string>[];
}

/**
 * Input types by kind. Add a custom kind's type by augmenting this interface,
 * so schemas using it type-check (and `validate` gets its value type):
 *
 * ```ts
 * interface StepperInputDef extends FormInputBase<number> { kind: 'stepper'; max?: number }
 * declare module '@charton/ui' {
 *   interface FormInputKinds { stepper: StepperInputDef }
 * }
 * ```
 */
export interface FormInputKinds {
  number: NumberInputDef;
  text: TextInputDef;
  boolean: BooleanInputDef;
  select: SelectInputDef;
  'multi-select': MultiSelectInputDef;
  color: ColorInputDef;
  slider: SliderInputDef;
  range: RangeInputDef;
  source: SourceInputDef;
}

/** Any of the input types the form dialog renders without a registered renderer. */
export type BuiltinInputDef =
  | NumberInputDef
  | TextInputDef
  | BooleanInputDef
  | SelectInputDef
  | MultiSelectInputDef
  | ColorInputDef
  | SliderInputDef
  | RangeInputDef
  | SourceInputDef;

/** Any input a schema can hold: the built-in kinds plus those added to `FormInputKinds`. */
export type FormInputDef = FormInputKinds[keyof FormInputKinds];

/** A group of inputs within a form section, with an optional heading that can collapse it. */
export interface FormGroup {
  id: string;
  /** Heading above the inputs; none when omitted. */
  label?: string;
  /** The heading toggles the inputs; needs `label`. */
  collapsible?: boolean;
  /** Start collapsed (with `collapsible`). */
  collapsed?: boolean;
  visible?: FormCondition;
  inputs: FormInputDef[];
}

/** A section of a form: one tab or sidebar entry holding groups of inputs. */
export interface FormSection {
  id: string;
  /** Tab or sidebar label. */
  title: string;
  visible?: FormCondition;
  groups: FormGroup[];
}

/**
 * A footer button. `submit` validates and closes, `cancel` restores the values
 * the dialog opened with and closes, `reset` restores the inputs' defaults, and
 * `button` only calls `onAction`.
 */
export interface FormAction {
  id: string;
  label: string;
  role?: 'submit' | 'cancel' | 'reset' | 'button';
  /**
   * Message key of the label, e.g. `dialogOk`: the dialog shows the key in its
   * `localization`'s language while `label` is still the key's English text.
   */
  labelKey?: string;
  /**
   * Default `end`; `start` puts it on the other side of the footer, `header` in
   * the header beside the close button, and `nav` below the section list of a
   * `sidebar` layout, for buttons that lead elsewhere (at the footer start when
   * there is no sidebar: another layout, or compact mode).
   */
  align?: 'start' | 'end' | 'header' | 'nav';
}

/** What a form dialog shows: its title, sections of inputs, section layout and footer actions. */
export interface FormSchema {
  id: string;
  title: string;
  /** `single`: sections as tabs above the inputs; `sidebar`: sections in a list beside them. Default `single`. */
  layout?: 'single' | 'sidebar';
  sections: FormSection[];
  /** Default: Cancel and Ok. */
  actions?: FormAction[];
}

/** The footer buttons a form gets when its schema sets no `actions`: Cancel and Ok. */
export const defaultFormActions: readonly FormAction[] = [
  { id: 'cancel', label: 'Cancel', labelKey: 'dialogCancel', role: 'cancel' },
  { id: 'ok', label: 'Ok', labelKey: 'dialogOk', role: 'submit' },
];

/** Bar values a `source` input offers by default. */
export const defaultSources: readonly FormOption<string>[] = [
  { value: 'open', label: 'Open' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'close', label: 'Close' },
  { value: 'hl2', label: '(H + L) / 2' },
  { value: 'hlc3', label: '(H + L + C) / 3' },
  { value: 'ohlc4', label: '(O + H + L + C) / 4' },
];

const BUILTIN_KINDS = new Set(['number', 'text', 'boolean', 'select', 'multi-select', 'color', 'slider', 'range', 'source']);

export function isBuiltinKind(kind: string): boolean {
  return BUILTIN_KINDS.has(kind);
}

/** Every input of the schema, in display order. */
export function formInputs(schema: FormSchema): FormInputDef[] {
  return schema.sections.flatMap((section) => section.groups.flatMap((group) => group.inputs));
}

/** Internal: `value`, with an array copied. */
export const copy = (value: unknown): unknown => (Array.isArray(value) ? [...value] : value);

/** The inputs' defaults, for those that have one. */
export function defaultValues(schema: FormSchema): FormValues {
  const values: FormValues = {};
  for (const input of formInputs(schema)) if (input.default !== undefined) values[input.id] = copy(input.default);
  return values;
}

/** `condition` for these values; `fallback` when it is not set. */
export function conditionHolds(condition: FormCondition | undefined, values: Readonly<FormValues>, fallback: boolean): boolean {
  if (condition === undefined) return fallback;
  return typeof condition === 'function' ? condition(values) : condition;
}

/** Where an input sits: its section and group. */
export interface InputPlace {
  section: FormSection;
  group: FormGroup;
  input: FormInputDef;
}

export function inputPlaces(schema: FormSchema): InputPlace[] {
  return schema.sections.flatMap((section) =>
    section.groups.flatMap((group) => group.inputs.map((input) => ({ section, group, input }))),
  );
}

/** The input is shown: it, its group and its section are all visible. */
export function placeVisible(place: InputPlace, values: Readonly<FormValues>): boolean {
  return (
    conditionHolds(place.section.visible, values, true) &&
    conditionHolds(place.group.visible, values, true) &&
    conditionHolds(place.input.visible, values, true)
  );
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function boundsError(t: ErrorText, value: number, min: number | undefined, max: number | undefined): string | null {
  if (min !== undefined && value < min) return t('formMin', { value: min });
  if (max !== undefined && value > max) return t('formMax', { value: max });
  return null;
}

type ErrorText = (key: ShellMessageKey, params?: Record<string, string | number>) => string;

const inOptions = (options: readonly FormOption[], value: unknown) => options.some((o) => o.value === value);

/** The built-in check for an input's kind; custom kinds have none. */
function builtinError(input: FormInputDef, value: unknown, t: ErrorText = (key, params) => shellText(null, key, params)): string | null {
  const def = input as BuiltinInputDef;
  switch (def.kind) {
    case 'number':
    case 'slider':
      if (!finite(value)) return t('formNumber');
      if (def.kind === 'number' && def.integer && !Number.isInteger(value)) return t('formWholeNumber');
      return boundsError(t, value, def.min, def.max);
    case 'text':
      if (typeof value !== 'string') return t('formText');
      if (def.required && value.trim() === '') return t('formRequired');
      if (def.maxLength !== undefined && value.length > def.maxLength) return t('formMaxLength', { count: def.maxLength });
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : t('formInvalid');
    case 'select':
      return inOptions(def.options, value) ? null : t('formChoose');
    case 'source':
      return inOptions(def.options ?? defaultSources, value) ? null : t('formChoose');
    case 'multi-select':
      return Array.isArray(value) && value.every((v) => inOptions(def.options, v)) ? null : t('formChooseSome');
    case 'color':
      if (value === '' && def.placeholder) return null;
      return typeof value === 'string' && value.trim() !== '' ? null : t('formColor');
    case 'range': {
      if (!Array.isArray(value) || value.length !== 2 || !finite(value[0]) || !finite(value[1])) return t('formTwoNumbers');
      if (value[0] > value[1]) return t('formRangeOrder');
      return boundsError(t, value[0], def.min, def.max) ?? boundsError(t, value[1], def.min, def.max);
    }
    default:
      return null;
  }
}

/**
 * The message for an input's value: the built-in check first, then its `validate`.
 * Built-in messages are in the language of `options.localization`, else English.
 */
export function inputError(input: FormInputDef, value: unknown, values: Readonly<FormValues>, options?: Localized): string | null {
  const builtin = builtinError(input, value, (key, params) => shellText(options, key, params));
  if (builtin) return builtin;
  const validate = input.validate as ((value: unknown, values: Readonly<FormValues>) => string | null | undefined) | undefined;
  return validate?.(value, values) || null;
}

/** Messages for the visible, enabled inputs whose values are not acceptable. */
export function formErrors(schema: FormSchema, values: Readonly<FormValues>, options?: Localized): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const place of inputPlaces(schema)) {
    const { input } = place;
    if (!placeVisible(place, values) || conditionHolds(input.disabled, values, false)) continue;
    const message = inputError(input, values[input.id], values, options);
    if (message) errors[input.id] = message;
  }
  return errors;
}

/** The fields of `patch` that `inputs` have and accept, checked with `patch` filled in over `values`. */
export function acceptedValues(inputs: readonly FormInputDef[], patch: Readonly<FormValues>, values: Readonly<FormValues>): FormValues {
  const all = { ...values, ...patch };
  const out: FormValues = {};
  for (const input of inputs) if (Object.hasOwn(patch, input.id) && !inputError(input, patch[input.id], all)) out[input.id] = patch[input.id];
  return out;
}

/**
 * Mistakes in a schema, as readable messages; empty when it is fine.
 * `hasKind` tells whether a renderer exists for a kind.
 */
export function validateFormSchema(schema: FormSchema, hasKind: (kind: string) => boolean = isBuiltinKind): string[] {
  const problems: string[] = [];
  if (!schema || typeof schema !== 'object') return ['The schema must be an object.'];
  if (!schema.title) problems.push('The schema needs a title.');
  if (!Array.isArray(schema.sections) || schema.sections.length === 0) {
    problems.push('The schema needs at least one section.');
    return problems;
  }
  const seen = (kind: string) => {
    const ids = new Set<string>();
    return (id: unknown, where: string) => {
      if (typeof id !== 'string' || id === '') problems.push(`${where} needs an id.`);
      else if (ids.has(id)) problems.push(`Duplicate ${kind} id "${id}".`);
      else ids.add(id);
    };
  };
  const section = seen('section');
  const group = seen('group');
  const input = seen('input');
  for (const s of schema.sections) {
    section(s.id, 'A section');
    if (!Array.isArray(s.groups)) {
      problems.push(`Section "${s.id}" needs a groups array.`);
      continue;
    }
    for (const g of s.groups) {
      group(g.id, `A group in section "${s.id}"`);
      if (g.collapsible && !g.label) problems.push(`Group "${g.id}" is collapsible but has no label.`);
      if (!Array.isArray(g.inputs)) {
        problems.push(`Group "${g.id}" needs an inputs array.`);
        continue;
      }
      for (const i of g.inputs) problems.push(...inputProblems(i, hasKind, input));
    }
  }
  const actions = schema.actions ?? [];
  const action = seen('action');
  for (const a of actions) action(a.id, 'An action');
  return problems;
}

function inputProblems(
  input: FormInputDef,
  hasKind: (kind: string) => boolean,
  seen: (id: unknown, where: string) => void,
): string[] {
  const problems: string[] = [];
  seen(input.id, `An input in a "${input.kind}" field`);
  const name = `Input "${input.id}"`;
  if (!input.label) problems.push(`${name} needs a label.`);
  if (!hasKind(input.kind)) problems.push(`${name} has unknown kind "${input.kind}"; register it with registerInput.`);
  const def = input as BuiltinInputDef;
  if ((def.kind === 'select' || def.kind === 'multi-select') && (!Array.isArray(def.options) || def.options.length === 0))
    problems.push(`${name} needs options.`);
  if (def.kind === 'slider' && (!finite(def.min) || !finite(def.max))) problems.push(`${name} needs a finite min and max.`);
  if ('min' in def && 'max' in def && finite(def.min) && finite(def.max) && def.min > def.max)
    problems.push(`${name} has min above max.`);
  if (def.default !== undefined && isBuiltinKind(def.kind)) {
    const message = builtinError(def, def.default);
    if (message) problems.push(`${name} default is invalid: ${message}`);
  }
  return problems;
}
