/**
 * Input schema checks shared by the chart (adding, changing and restoring
 * inputs) and by settings forms built from `IndicatorDef.inputs`.
 */
import type { InputDef, InputValue, SelectOption, SourceKey } from './types';
import { errorText } from '../errors';
import { isNumber, isText } from '../util/records';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

const SOURCES: readonly SourceKey[] = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4'];

/** One input of a settings form, evaluated against the current values. */
export interface InputField {
  input: InputDef;
  /** The current value, or the default when none is given. */
  value: InputValue;
  /** From the input's `visible`; a throwing callback counts as shown. */
  visible: boolean;
  /** From the input's `disabled`; a throwing callback counts as enabled. */
  disabled: boolean;
  /** Why the value is rejected (wrong type or range, or the input's `validate` message); null when it is fine. */
  error: string | null;
}

/** Inputs of one `group`, in declaration order; `name` is null for inputs without a group. */
export interface InputGroup {
  name: string | null;
  fields: InputField[];
}

/**
 * Evaluate a definition's inputs for a settings form: grouped (inputs without
 * a group first, then each group in the order of its first input), with
 * visibility, disabled state and validation errors for `values`. Missing
 * values take their defaults; unknown ones are ignored.
 */
export function inputFields(defs: readonly InputDef[], values: Readonly<Record<string, InputValue>> = {}): InputGroup[] {
  const current: Record<string, InputValue> = {};
  for (const d of defs) current[d.id] = values[d.id] ?? d.default;
  const groups: InputGroup[] = [];
  const ungrouped: InputGroup = { name: null, fields: [] };
  for (const input of defs) {
    const value = current[input.id]!;
    const field: InputField = {
      input,
      value,
      visible: inputVisible(input, current),
      disabled: inputDisabled(input, current),
      error: inputTypeError(input, value) ?? inputCheckError(input, value, current),
    };
    const name = isText(input.group) ? input.group : null;
    let group = name === null ? ungrouped : groups.find((g) => g.name === name);
    if (!group) groups.push((group = { name, fields: [] }));
    group.fields.push(field);
  }
  return ungrouped.fields.length > 0 ? [ungrouped, ...groups] : groups;
}

/** Why `value` does not fit the input's type, or null when it does. */
export function inputTypeError(d: InputDef, value: unknown): string | null {
  switch (d.type) {
    case 'number':
      if (!isNumber(value)) return 'Must be a number';
      if (d.min !== undefined && value < d.min) return `Must be at least ${d.min}`;
      if (d.max !== undefined && value > d.max) return `Must be at most ${d.max}`;
      return null;
    case 'source':
      return SOURCES.includes(value as SourceKey) ? null : 'Must be a price source';
    case 'color':
      return typeof value === 'string' ? null : 'Must be a colour';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Must be on or off';
    case 'select':
      return d.options.some((o) => o.value === value) ? null : 'Must be one of the options';
    case 'text':
      if (typeof value !== 'string') return 'Must be text';
      return d.maxLength !== undefined && value.length > d.maxLength ? `Must be at most ${d.maxLength} characters` : null;
    default:
      return 'Unknown input type';
  }
}

/** The input's `validate` message for `value`, or null when it passes or the input is hidden. A throw counts as its message. */
export function inputCheckError(d: InputDef, value: InputValue, inputs: Record<string, InputValue>): string | null {
  if (!d.validate || !inputVisible(d, inputs)) return null;
  try {
    const message = d.validate(value, inputs);
    return isText(message) ? message : null;
  } catch (error) {
    return errorText(error);
  }
}

function inputVisible(d: InputDef, inputs: Record<string, InputValue>): boolean {
  try {
    return d.visible?.(inputs) !== false;
  } catch {
    return true;
  }
}

function inputDisabled(d: InputDef, inputs: Record<string, InputValue>): boolean {
  try {
    return d.disabled?.(inputs) === true;
  } catch {
    return false;
  }
}

/** Throw early on inputs a form or the chart cannot use: duplicate ids, bad options, defaults that don't fit. */
export function validateInputDefs(indicatorId: string, defs: readonly InputDef[]): void {
  if (!Array.isArray(defs)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${indicatorId}" inputs must be an array` : '');
  const ids = new Set<string>();
  for (const d of defs) {
    const where = `Indicator "${indicatorId}" input "${String(d?.id)}"`;
    if (typeof d?.id !== 'string' || d.id === '') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${indicatorId}" inputs need non-empty string ids` : '');
    // Message keys join ids with dots (`input.<id>.<input>.<value>`), so a dot would make two of them collide.
    if (d.id.includes('.')) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${where}: input ids cannot contain "."` : '');
    if (ids.has(d.id)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${indicatorId}" declares input "${d.id}" twice` : '');
    ids.add(d.id);
    if (d.type === 'select') {
      const options: unknown[] = Array.isArray(d.options) ? d.options : [];
      const values = options.map((o) => (o as SelectOption | null)?.value);
      if (values.length === 0) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${where} needs at least one option` : '');
      if (values.some((v) => typeof v !== 'string' && !isNumber(v))) {
        throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${where} option values must be strings or finite numbers` : '');
      }
      if (new Set(values).size !== values.length) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${where} declares an option value twice` : '');
    }
    if (d.type === 'text' && d.maxLength !== undefined && !(Number.isInteger(d.maxLength) && d.maxLength >= 0)) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${where} maxLength must be a whole number` : '');
    }
    const error = inputTypeError(d, d.default);
    if (error) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${where} default ${String(d.default)} is invalid: ${error}` : '');
  }
}
