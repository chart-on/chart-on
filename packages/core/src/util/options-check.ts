import { isColor } from './color';
import { devWarn, isDev } from './dev';

/**
 * What an option value may be. Strings name a plain type; `'color'` is a
 * string the chart can parse as a colour, `'object'` any object whose
 * fields are not checked. Build the others with `num`, `oneOf`, `shape`,
 * `list` and `either`.
 */
export type OptionRule =
  | 'any'
  | 'boolean'
  | 'number'
  | 'string'
  | 'function'
  | 'color'
  | 'object'
  | 'array'
  | { readonly number: { readonly min?: number; readonly max?: number; readonly integer?: boolean } }
  | { readonly oneOf: readonly string[] }
  | { readonly keys: Readonly<Record<string, OptionRule>>; readonly open?: boolean }
  | { readonly listOf: OptionRule }
  | { readonly anyOf: readonly OptionRule[] };

/** A rule for every field of `T`, optional ones included, so a new field without a rule fails to compile. */
export type OptionShape<T> = { readonly [K in keyof T]-?: OptionRule };

/** A number, at least `min` and at most `max` when given. */
export const num = (min?: number, max?: number): OptionRule => ({ number: { min, max } });
/** A whole number, at least `min` and at most `max` when given. */
export const int = (min?: number, max?: number): OptionRule => ({ number: { min, max, integer: true } });
/** One of the keys of `values`; a record so a union member left out fails to compile. */
export const oneOf = <T extends string>(values: Readonly<Record<T, unknown>>): OptionRule => ({ oneOf: Object.keys(values) });
/**
 * An object with these fields. Unknown fields are reported, except with
 * `open` (objects that plugins extend), where only near misses of a known
 * field are.
 */
export const shape = <T>(keys: OptionShape<T>, open = false): OptionRule => ({ keys, open });
/** An array whose items follow `rule`. */
export const list = (rule: OptionRule): OptionRule => ({ listOf: rule });
/** Any one of `rules`, e.g. `boolean` or an object form. */
export const either = (...rules: OptionRule[]): OptionRule => ({ anyOf: rules });

/** Codes of the warnings `checkOptions` logs. */
export type OptionIssueCode = 'option-unknown' | 'option-type' | 'option-range' | 'option-color';

/** One problem with an option value: `path` is the dotted key, e.g. `crosshair.vertical.width`. */
export interface OptionIssue {
  code: OptionIssueCode;
  path: string;
  message: string;
}

/**
 * The problems with `value` against `rule`, outermost first; `path` prefixes
 * the reported keys. `undefined` and `null` are always accepted, as patches
 * use them to leave a value alone or reset it.
 */
export function optionIssues(value: unknown, rule: OptionRule, path = ''): OptionIssue[] {
  const issues: OptionIssue[] = [];
  check(value, rule, path, issues);
  return issues;
}

const warned = new Set<string>();

/**
 * Warn about unknown keys, wrong types, out-of-range numbers and unreadable
 * colours in `value`, in development builds only. Each problem is logged once
 * per `where` (the call that took the options, e.g. `'applyOptions'`) and key.
 */
export function checkOptions(where: string, value: unknown, rule: OptionRule): void {
  if (!isDev()) return;
  for (const issue of optionIssues(value, rule)) {
    const id = `${issue.code}|${where}|${issue.path}`;
    if (warned.has(id)) continue;
    warned.add(id);
    devWarn(`${where}: ${issue.message}`, issue.code);
  }
}

/** Forget which problems were logged, so tests can expect a warning again. */
export function resetOptionWarnings(): void {
  warned.clear();
}

function check(value: unknown, rule: OptionRule, path: string, out: OptionIssue[]): void {
  if (value === undefined || value === null || rule === 'any') return;
  const at = path ? `"${path}"` : 'the options';
  const wrong = () => out.push({ code: 'option-type', path, message: `${at} should be ${describe(rule)}, got ${typeName(value)}` });
  if (typeof rule === 'string') {
    if (!matchesKind(value, rule)) return void wrong();
    if (rule === 'color' && !readableColor(value as string)) {
      out.push({ code: 'option-color', path, message: `${at} is not a colour the chart can read: "${String(value)}"` });
    }
    return;
  }
  if ('number' in rule) {
    if (typeof value !== 'number') return void wrong();
    const { min, max, integer } = rule.number;
    const bad =
      Number.isNaN(value) ||
      (integer && !Number.isInteger(value)) ||
      (min !== undefined && value < min) ||
      (max !== undefined && value > max);
    if (bad) out.push({ code: 'option-range', path, message: `${at} should be ${describe(rule)}, got ${value}` });
    return;
  }
  if ('oneOf' in rule) {
    if (!rule.oneOf.includes(value as string)) {
      out.push({ code: typeof value === 'string' ? 'option-range' : 'option-type', path, message: `${at} should be ${describe(rule)}, got ${show(value)}` });
    }
    return;
  }
  if ('listOf' in rule) {
    if (!Array.isArray(value)) return void wrong();
    value.forEach((item, i) => check(item, rule.listOf, `${path}[${i}]`, out));
    return;
  }
  if ('anyOf' in rule) {
    // Check against the first form of the same kind, so an object reports its own fields.
    const match = rule.anyOf.find((r) => sameKind(value, r));
    if (match) check(value, match, path, out);
    else wrong();
    return;
  }
  if (typeof value !== 'object' || Array.isArray(value)) return void wrong();
  const keys = Object.keys(rule.keys);
  for (const [key, v] of Object.entries(value)) {
    const sub = path ? `${path}.${key}` : key;
    if (Object.hasOwn(rule.keys, key)) {
      check(v, rule.keys[key]!, sub, out);
      continue;
    }
    const near = closest(key, keys);
    if (rule.open && !near) continue;
    const hint = near ? `; did you mean "${near}"?` : '';
    out.push({ code: 'option-unknown', path: sub, message: `unknown option "${sub}" is ignored${hint}` });
  }
}

function matchesKind(value: unknown, kind: string): boolean {
  switch (kind) {
    case 'color':
      return typeof value === 'string';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    default:
      return typeof value === kind;
  }
}

/** Whether `value` is the kind of thing `rule` describes, ignoring its details. */
function sameKind(value: unknown, rule: OptionRule): boolean {
  if (rule === 'any') return true;
  if (typeof rule === 'string') return matchesKind(value, rule);
  if ('number' in rule) return typeof value === 'number';
  if ('oneOf' in rule) return typeof value === 'string';
  if ('listOf' in rule) return Array.isArray(value);
  if ('anyOf' in rule) return rule.anyOf.some((r) => sameKind(value, r));
  return typeof value === 'object' && !Array.isArray(value);
}

function describe(rule: OptionRule): string {
  if (typeof rule === 'string') {
    const names: Record<string, string> = { color: 'a colour string', array: 'an array', object: 'an object', any: 'anything' };
    return names[rule] ?? `a ${rule}`;
  }
  if ('number' in rule) {
    const { min, max, integer } = rule.number;
    const what = integer ? 'a whole number' : 'a number';
    if (min !== undefined && max !== undefined) return `${what} from ${min} to ${max}`;
    if (min !== undefined) return `${what} of at least ${min}`;
    if (max !== undefined) return `${what} of at most ${max}`;
    return what;
  }
  if ('oneOf' in rule) return `one of ${rule.oneOf.map((v) => `"${v}"`).join(', ')}`;
  if ('listOf' in rule) return 'an array';
  if ('anyOf' in rule) return rule.anyOf.map(describe).join(' or ');
  return 'an object';
}

function typeName(value: unknown): string {
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `${typeof value} ${show(value)}`;
}

function show(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'function') return 'a function';
  // `String` throws on objects without a prototype.
  return typeof value === 'object' && value !== null ? 'an object' : String(value);
}

/**
 * Whether the chart can read `color`. Without a DOM (tests, server
 * rendering) only hex and rgb() strings can be checked; others pass.
 */
function readableColor(color: string): boolean {
  if (typeof document === 'undefined' && !/^\s*(#|rgba?\()/i.test(color)) return true;
  return isColor(color);
}

/** The key in `keys` closest to `key` by edit distance, ignoring case, if it is close enough to be a typo. */
function closest(key: string, keys: readonly string[]): string | null {
  const k = key.toLowerCase();
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of keys) {
    const d = distance(k, candidate.toLowerCase());
    if (d < bestDistance) [best, bestDistance] = [candidate, d];
  }
  return bestDistance <= Math.max(1, Math.floor(key.length / 3)) ? best : null;
}

/** Edit distance where swapping two neighbouring letters counts as one edit, as in typing typos. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}
