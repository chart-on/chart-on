/**
 * The theme builder's state and its exports, kept free of the DOM so tests can
 * check them. The token list comes from `chartThemeTokens`,
 * `chartTypographyTokens` and the shell stylesheet itself, so it follows the
 * library when tokens are added.
 *
 * State is a set of CSS custom property overrides per scheme, the same thing
 * the exported CSS holds. The chart theme is what `themeFromCss` reads from the
 * stylesheet defaults plus those overrides, exactly as the UI shell does.
 */
import {
  chartThemeTokens,
  chartTypographyTokens,
  colorSafeUpDown,
  contrastRatio,
  darkTheme,
  isColor,
  lightTheme,
  themeFromCss,
  type ChartTheme,
  type CssPropertyReader,
} from '@charton/core';
import { resolveCssVars } from '../../../packages/core/src/util/css';
import { parseRules, ruleVars } from './css';

export type Scheme = 'dark' | 'light';
export const SCHEMES: readonly Scheme[] = ['dark', 'light'];

/** CSS custom property name to value, e.g. `{ '--pc-up': '#22c55e' }`. */
export type Overrides = Record<string, string>;
export type BuilderState = Record<Scheme, Overrides>;

/** The built-in chart theme each scheme falls back to, as in the UI shell. */
export const baseThemes: Readonly<Record<Scheme, ChartTheme>> = { dark: darkTheme, light: lightTheme };

export type TokenKind = 'color' | 'heatmap' | 'size' | 'weight' | 'numerals' | 'text';

/** A theme key that a CSS token sets: a `ChartTheme` key or a typography baseline field. */
export type ChartKey = keyof typeof chartThemeTokens | `typography.${keyof typeof chartTypographyTokens}`;

export interface Token {
  /** The CSS custom property, e.g. `--pc-up`. */
  name: string;
  group: 'chart' | 'shell';
  kind: TokenKind;
  /** The theme key it sets, for chart tokens. */
  key?: ChartKey;
}

export interface Preset {
  id: string;
  label: string;
  state: BuilderState;
}

export interface Builder {
  tokens: readonly Token[];
  /** Every custom property the stylesheet declares for each scheme, unresolved. */
  defaults: Readonly<Record<Scheme, ReadonlyMap<string, string>>>;
  presets: readonly Preset[];
}

const CHART_KEYS = Object.keys(chartThemeTokens) as (keyof typeof chartThemeTokens)[];
const TYPOGRAPHY_FIELDS = Object.keys(chartTypographyTokens) as (keyof typeof chartTypographyTokens)[];
const DEFAULT_WEIGHT = 400;
const DEFAULT_NUMERALS = 'tabular';

function chartKind(key: keyof typeof chartThemeTokens): TokenKind {
  if (key === 'fontFamily') return 'text';
  if (key === 'fontSize') return 'size';
  if (key === 'heatmap') return 'heatmap';
  return 'color';
}

/** A layered `getPropertyValue`: later layers win. */
export function layeredReader(...layers: (ReadonlyMap<string, string> | Overrides)[]): CssPropertyReader {
  return {
    getPropertyValue(name) {
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i]!;
        const value = layer instanceof Map ? layer.get(name) : (layer as Overrides)[name];
        if (value !== undefined) return value;
      }
      return '';
    },
  };
}

/** A literal colour, as opposed to a size, shadow or `color-mix()` expression. */
const literalColor = (value: string) => /^(#|rgba?\()/i.test(value) && isColor(value);

export function createBuilder(stylesheet: string): Builder {
  const rules = parseRules(stylesheet);
  const dark = ruleVars(rules, '.pc-shell');
  if (dark.size === 0) throw new Error('The stylesheet declares no .pc-shell tokens');
  const light = new Map([...dark, ...ruleVars(rules, ".pc-shell[data-theme='light']")]);
  const defaults = { dark, light };

  const tokens: Token[] = [];
  const chartNames = new Set<string>();
  for (const key of CHART_KEYS) {
    tokens.push({ name: chartThemeTokens[key], group: 'chart', kind: chartKind(key), key });
    chartNames.add(chartThemeTokens[key]);
  }
  for (const field of TYPOGRAPHY_FIELDS) {
    tokens.push({ name: chartTypographyTokens[field], group: 'chart', kind: field === 'fontWeight' ? 'weight' : 'numerals', key: `typography.${field}` });
    chartNames.add(chartTypographyTokens[field]);
  }
  const reader = layeredReader(dark);
  for (const name of dark.keys()) {
    if (chartNames.has(name)) continue;
    tokens.push({ name, group: 'shell', kind: literalColor(resolveCssVars(dark.get(name)!, reader)) ? 'color' : 'text' });
  }

  const builder: Builder = { tokens, defaults, presets: [] };
  builder.presets = createPresets(builder, rules);
  return builder;
}

/** The value `name` has in `scheme` with `overrides`, with `var()` references resolved; `''` when unset. */
export function resolvedValue(b: Builder, scheme: Scheme, overrides: Overrides, name: string): string {
  const reader = layeredReader(b.defaults[scheme], overrides);
  return resolveCssVars(reader.getPropertyValue(name), reader);
}

/** The chart theme the UI shell reads in `scheme` with `overrides` on top of the stylesheet. */
export function chartTheme(b: Builder, scheme: Scheme, overrides: Overrides): ChartTheme {
  return themeFromCss(layeredReader(b.defaults[scheme], overrides), baseThemes[scheme]);
}

const weightOf = (theme: ChartTheme) => theme.typography?.fontWeight ?? DEFAULT_WEIGHT;
const numeralsOf = (theme: ChartTheme) => theme.typography?.numerals ?? DEFAULT_NUMERALS;

/** The CSS value of one chart key in `theme`, or undefined when the theme leaves it unset. */
export function chartValue(theme: ChartTheme, key: ChartKey): string | undefined {
  if (key === 'typography.fontWeight') return String(weightOf(theme));
  if (key === 'typography.numerals') return numeralsOf(theme);
  if (key === 'fontSize') return `${theme.fontSize}px`;
  if (key === 'heatmap') return theme.heatmap.join(', ');
  return theme[key];
}

/** The keys of `theme` that differ from `base`. The typography baseline counts as one key. */
export function themeDiff(theme: ChartTheme, base: ChartTheme): Partial<ChartTheme> {
  const diff: Partial<ChartTheme> = {};
  for (const key of CHART_KEYS) {
    if (theme[key] === undefined) continue;
    if (chartValue(theme, key) !== chartValue(base, key)) (diff as Record<string, unknown>)[key] = theme[key];
  }
  if (weightOf(theme) !== weightOf(base) || numeralsOf(theme) !== numeralsOf(base)) {
    diff.typography = { fontWeight: weightOf(theme), numerals: numeralsOf(theme) };
  }
  return diff;
}

/** The theme object the builder exports: per scheme, the chart keys that differ from the built-in theme. */
export function exportTheme(b: Builder, state: BuilderState): Record<Scheme, Partial<ChartTheme>> {
  return {
    dark: themeDiff(chartTheme(b, 'dark', state.dark), baseThemes.dark),
    light: themeDiff(chartTheme(b, 'light', state.light), baseThemes.light),
  };
}

/** The default class name of the exported CSS block. */
export const DEFAULT_CLASS = 'my-theme';

const tokenNamed = (b: Builder, name: string) => b.tokens.find((t) => t.name === name);

function shellOverrides(b: Builder, overrides: Overrides): Overrides {
  const out: Overrides = {};
  for (const token of b.tokens) if (token.group === 'shell' && overrides[token.name] !== undefined) out[token.name] = overrides[token.name]!;
  return out;
}

/**
 * The declarations one scheme needs: its shell overrides as written, plus each
 * chart token whose value differs from the built-in theme (so the theme object
 * matches) or from what the stylesheet gives with those shell overrides (so a
 * shell renders it). Chart tokens are written resolved, without `var()`, so
 * `themeFromCss` reads the same theme from the block alone.
 */
function schemeDeclarations(b: Builder, state: BuilderState, scheme: Scheme): Map<string, string> {
  const overrides = state[scheme];
  const out = new Map(Object.entries(shellOverrides(b, overrides)));
  const theme = chartTheme(b, scheme, overrides);
  const shellOnly = chartTheme(b, scheme, shellOverrides(b, overrides));
  const base = baseThemes[scheme];
  const typography: Token[] = [];
  for (const token of b.tokens) {
    if (token.group !== 'chart' || !token.key) continue;
    const value = chartValue(theme, token.key);
    const differs = value !== undefined && (value !== chartValue(base, token.key) || value !== chartValue(shellOnly, token.key));
    if (token.key.startsWith('typography.')) {
      typography.push(token);
      if (differs) out.set('typography', '');
    } else if (differs) {
      out.set(token.name, value);
    }
  }
  // The typography tokens go together, so the block yields the same baseline as the theme object.
  if (out.delete('typography')) for (const token of typography) out.set(token.name, chartValue(theme, token.key!)!);
  return out;
}

function sortedBlock(b: Builder, vars: Map<string, string>, indent: string): string {
  const order = [...b.tokens.filter((t) => t.group === 'shell'), ...b.tokens.filter((t) => t.group === 'chart')];
  return order
    .filter((t) => vars.has(t.name))
    .map((t) => `${indent}${t.name}: ${vars.get(t.name)};`)
    .join('\n');
}

/**
 * The CSS block for the whole theme: the dark scheme on the class, the light
 * scheme for `data-theme="light"` and for the OS setting in `system` mode.
 * Every token the dark block sets is set again for light, so dark values never
 * show through in light.
 */
export function exportCss(b: Builder, state: BuilderState, className = DEFAULT_CLASS): string {
  const dark = schemeDeclarations(b, state, 'dark');
  const light = schemeDeclarations(b, state, 'light');
  const lightChart = chartTheme(b, 'light', state.light);
  for (const name of dark.keys()) {
    if (light.has(name)) continue;
    const token = tokenNamed(b, name);
    const value = token?.key ? chartValue(lightChart, token.key) : b.defaults.light.get(name);
    light.set(name, value ?? 'initial');
  }
  const selector = `.${className}.pc-shell`;
  const parts = [
    `/* Load after @charton/ui/style.css, then add the class: createChartShell(el, { className: '${className}' }). */`,
  ];
  if (dark.size > 0) parts.push(`${selector} {\n${sortedBlock(b, dark, '  ')}\n}`);
  if (light.size > 0) {
    parts.push(`${selector}[data-theme='light'] {\n${sortedBlock(b, light, '  ')}\n}`);
    parts.push(`@media (prefers-color-scheme: light) {\n  ${selector}:not([data-theme]) {\n${sortedBlock(b, light, '    ')}\n  }\n}`);
  }
  if (dark.size === 0 && light.size === 0) parts.push(`${selector} {
  /* Nothing changed: the default theme. */
}`);
  return `${parts.join('\n\n')}\n`;
}

/** Copyable code for the theme object, valid TypeScript whose object is also JSON. */
export function themeObjectCode(theme: Record<Scheme, Partial<ChartTheme>>): string {
  return [
    '// Chart colours over the built-in theme of each scheme, for example',
    '// createChart(el, { theme: { ...darkTheme, ...theme.dark } }) or',
    '// chart.applyOptions({ theme: { ...lightTheme, ...theme.light } }).',
    `const theme = ${JSON.stringify(theme, null, 2)};`,
    '',
  ].join('\n');
}

const UNSAFE_TEXT = /[;{}<>\\\r\n]|\/\*|\*\/|url\(|expression\(|@import|javascript:/i;
const MAX_VALUE = 300;

/**
 * A value that could escape its declaration in the exported CSS: a statement
 * or block break, a comment or an unclosed quote that would swallow the
 * declarations after it, or anything that loads a resource.
 */
function unsafeText(value: string): boolean {
  if (UNSAFE_TEXT.test(value)) return true;
  const count = (quote: string) => value.split(quote).length - 1;
  return count('"') % 2 !== 0 || count("'") % 2 !== 0;
}

/** Whether `value` is something the builder accepts for token `name`: no way out of the declaration, and the right kind. */
export function safeValue(b: Builder, name: string, value: unknown): value is string {
  const token = tokenNamed(b, name);
  if (!token || typeof value !== 'string') return false;
  const v = value.trim();
  if (!v || v.length > MAX_VALUE || unsafeText(v)) return false;
  if (v.includes('var(')) return /^var\(--pc-[\w-]+\)$/.test(v);
  switch (token.kind) {
    case 'color':
      return isColor(v);
    case 'heatmap':
      return v.split(/,(?![^(]*\))/).every((stop) => isColor(stop.trim()));
    case 'size':
      return /^\d*\.?\d+(px)?$/.test(v) && Number.parseFloat(v) > 0;
    case 'weight':
      return /^(\d{1,4}|normal|bold)$/.test(v);
    case 'numerals':
      return v === 'tabular' || v === 'proportional';
    default:
      return true;
  }
}

/** `overrides` without values that change nothing: each kept override changes its token's resolved value. */
export function tidy(b: Builder, scheme: Scheme, overrides: Overrides): Overrides {
  const out: Overrides = {};
  for (const [name, value] of Object.entries(overrides)) if (value !== 'initial' && safeValue(b, name, value)) out[name] = value.trim();
  for (const name of Object.keys(out)) {
    const without = { ...out };
    delete without[name];
    if (resolvedValue(b, scheme, out, name) === resolvedValue(b, scheme, without, name)) delete out[name];
  }
  return out;
}

/** Builder state from untrusted data (a link, a paste): unknown tokens and unsafe values are dropped. */
export function sanitizeState(b: Builder, raw: unknown): BuilderState {
  const state: BuilderState = { dark: {}, light: {} };
  if (!raw || typeof raw !== 'object') return state;
  for (const scheme of SCHEMES) {
    const part = (raw as Record<string, unknown>)[scheme];
    if (!part || typeof part !== 'object') continue;
    for (const [name, value] of Object.entries(part)) if (safeValue(b, name, value)) state[scheme][name] = value.trim();
  }
  return state;
}

const isLightRule = (selectors: readonly string[], nested: boolean) =>
  selectors.some((s) => /\[data-theme='light'\]|\.pc-light\b/.test(s) || (nested && s.includes(':not([data-theme])')));

/** Builder state from a pasted CSS block such as `exportCss` writes. Throws when it sets no known token. */
export function importCss(b: Builder, text: string): BuilderState {
  const dark: Overrides = {};
  const light: Overrides = {};
  let found = false;
  for (const rule of parseRules(text)) {
    const target = isLightRule(rule.selectors, rule.nested) ? light : rule.nested ? null : dark;
    if (!target) continue;
    if (rule.selectors.some((s) => s.includes('.pc-shell'))) found = true;
    for (const [name, value] of rule.vars) {
      if (!tokenNamed(b, name)) continue;
      target[name] = value;
      found = true;
    }
  }
  if (!found) throw new Error('No .pc-shell rule or theme tokens (--pc-…) found in the CSS.');
  return { dark: tidy(b, 'dark', dark), light: tidy(b, 'light', { ...dark, ...light }) };
}

/** The object literal in pasted text: JSON, or the code `themeObjectCode` writes. */
export function parseThemeObject(text: string): unknown {
  const assign = text.search(/=\s*\{/);
  const start = text.indexOf('{', assign >= 0 ? assign : 0);
  if (start < 0) throw new Error('No theme object found.');
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
    } else if (c === '{') {
      depth++;
    } else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        throw new Error('The theme object is not valid JSON; paste it as the builder exports it.');
      }
    }
  }
  throw new Error('The theme object is not closed.');
}

/** The keys of `raw` that are valid `ChartTheme` values; the rest is dropped. */
export function validThemePatch(raw: unknown): Partial<ChartTheme> {
  const patch: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') return patch;
  const source = raw as Record<string, unknown>;
  for (const key of CHART_KEYS) {
    const value = source[key];
    if (value === undefined) continue;
    if (key === 'fontSize') {
      if (typeof value === 'number' && value > 0 && value <= 200) patch[key] = value;
    } else if (key === 'heatmap') {
      if (Array.isArray(value) && value.length > 0 && value.every((stop) => typeof stop === 'string' && isColor(stop))) patch[key] = [...value];
    } else if (key === 'fontFamily') {
      if (typeof value === 'string' && value.trim() && value.length <= MAX_VALUE && !unsafeText(value)) patch[key] = value.trim();
    } else if (typeof value === 'string' && isColor(value)) {
      patch[key] = value;
    }
  }
  const typography = source.typography as Record<string, unknown> | undefined;
  if (typography && typeof typography === 'object') {
    const { fontWeight: weight, numerals } = typography;
    const out: Record<string, unknown> = {};
    if ((typeof weight === 'number' && weight >= 1 && weight <= 1000 && Number.isInteger(weight)) || weight === 'normal' || weight === 'bold') out.fontWeight = weight;
    if (numerals === 'tabular' || numerals === 'proportional') out.numerals = numerals;
    if (Object.keys(out).length > 0) patch.typography = out;
  }
  return patch as Partial<ChartTheme>;
}

/** Overrides that give the chart `patch` over the built-in theme, keeping the shell overrides of `current`. */
function overridesForTheme(b: Builder, scheme: Scheme, patch: Partial<ChartTheme>, current: Overrides): Overrides {
  const theme: ChartTheme = { ...baseThemes[scheme], ...patch };
  const out = shellOverrides(b, current);
  for (const token of b.tokens) {
    if (token.group !== 'chart' || !token.key) continue;
    const value = chartValue(theme, token.key);
    if (value !== undefined) out[token.name] = value;
  }
  return tidy(b, scheme, out);
}

/**
 * Builder state from a pasted theme object: `{ dark, light }` as exported, or
 * one flat theme for both schemes. Chart tokens come from the object; the
 * shell variables, which the object does not hold, stay as in `current`.
 */
export function importThemeObject(b: Builder, text: string, current: BuilderState): BuilderState {
  const raw = parseThemeObject(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('No theme object found.');
  const source = raw as Record<string, unknown>;
  const split = 'dark' in source || 'light' in source;
  const next: BuilderState = { dark: { ...current.dark }, light: { ...current.light } };
  for (const scheme of SCHEMES) {
    const part = split ? source[scheme] : source;
    if (part !== undefined) next[scheme] = overridesForTheme(b, scheme, validThemePatch(part), current[scheme]);
  }
  return next;
}

/** One text-on-background pair the builder checks against WCAG AA. */
export interface ContrastCheck {
  label: string;
  /** The foreground and background tokens. */
  tokens: [string, string];
  ratio: number;
  /** The ratio the pair needs: 4.5 for normal-size text. */
  min: number;
  ok: boolean;
}

/** WCAG AA for normal text. */
export const MIN_TEXT_CONTRAST = 4.5;

/** Chart pairs, by theme key: the axis and legend text and the price labels. */
const CHART_PAIRS: readonly [string, keyof ChartTheme, keyof ChartTheme][] = [
  ['Axis and legend text', 'text', 'background'],
  ['Muted axis and legend text', 'textMuted', 'background'],
  ['Price label text', 'labelText', 'labelBackground'],
];

/** Shell pairs, by token: text on the panels, on the accent and in tooltips. */
const SHELL_PAIRS: readonly [string, string, string][] = [
  ['Shell text', '--pc-ink', '--pc-panel'],
  ['Shell secondary text', '--pc-muted', '--pc-panel'],
  ['Text on the accent', '--pc-accent-ink', '--pc-accent'],
  ['Tooltip text', '--pc-tip-ink', '--pc-tip-bg'],
];

/** The contrast of each text pair in `scheme`; pairs whose colours cannot be read are left out. */
export function contrastChecks(b: Builder, scheme: Scheme, overrides: Overrides): ContrastCheck[] {
  const checks: ContrastCheck[] = [];
  const add = (label: string, tokens: [string, string], fg: unknown, bg: unknown) => {
    if (typeof fg !== 'string' || typeof bg !== 'string' || !isColor(fg) || !isColor(bg)) return;
    const ratio = contrastRatio(fg, bg);
    checks.push({ label, tokens, ratio, min: MIN_TEXT_CONTRAST, ok: ratio >= MIN_TEXT_CONTRAST });
  };
  const theme = chartTheme(b, scheme, overrides);
  for (const [label, fg, bg] of CHART_PAIRS) {
    add(label, [chartThemeTokens[fg as keyof typeof chartThemeTokens], chartThemeTokens[bg as keyof typeof chartThemeTokens]], theme[fg], theme[bg]);
  }
  for (const [label, fg, bg] of SHELL_PAIRS) {
    if (!tokenNamed(b, fg) || !tokenNamed(b, bg)) continue;
    add(label, [fg, bg], resolvedValue(b, scheme, overrides, fg), resolvedValue(b, scheme, overrides, bg));
  }
  return checks;
}

function patchOverrides(patch: Partial<ChartTheme>): Overrides {
  const out: Overrides = {};
  for (const key of CHART_KEYS) {
    const value = patch[key];
    if (typeof value === 'string') out[chartThemeTokens[key]] = value;
  }
  return out;
}

/** A softer palette: calmer up, down and accent colours, the same text colours. */
const MUTED: Record<Scheme, Overrides> = {
  dark: {
    '--pc-accent': '#9a8fd6',
    '--pc-accent-soft': 'rgba(154, 143, 214, 0.16)',
    '--pc-up': '#5fa894',
    '--pc-down': '#c7786d',
    '--pc-ask': '#c7786d',
    '--pc-chart-grid': 'rgba(36, 36, 45, 0.4)',
  },
  light: {
    '--pc-accent': '#6a5bb8',
    '--pc-accent-soft': 'rgba(106, 91, 184, 0.1)',
    '--pc-up': '#2f7565',
    '--pc-down': '#a8584c',
    '--pc-ask': '#a8584c',
    '--pc-chart-grid': 'rgba(241, 241, 245, 0.7)',
  },
};

/**
 * Presets built from what the library ships: the high-contrast token sets of
 * the stylesheet and the colour-safe up and down pair, plus a muted palette.
 */
function createPresets(b: Builder, rules: ReturnType<typeof parseRules>): Preset[] {
  const hcDark = ruleVars(rules, '.pc-shell.pc-theme-high-contrast');
  const hcLight = new Map([...hcDark, ...ruleVars(rules, ".pc-shell.pc-theme-high-contrast[data-theme='light']")]);
  const highContrast: BuilderState = { dark: Object.fromEntries(hcDark), light: Object.fromEntries(hcLight) };
  const colorSafe: BuilderState = { dark: patchOverrides(colorSafeUpDown.dark), light: patchOverrides(colorSafeUpDown.light) };
  const merge = (...states: BuilderState[]): BuilderState => ({
    dark: tidy(b, 'dark', Object.assign({}, ...states.map((s) => s.dark))),
    light: tidy(b, 'light', Object.assign({}, ...states.map((s) => s.light))),
  });
  return [
    { id: 'default', label: 'Default', state: { dark: {}, light: {} } },
    { id: 'high-contrast', label: 'High contrast', state: merge(highContrast) },
    { id: 'color-safe', label: 'Colour-safe up and down', state: merge(colorSafe) },
    { id: 'high-contrast-color-safe', label: 'High contrast, colour-safe', state: merge(highContrast, colorSafe) },
    { id: 'muted', label: 'Muted', state: merge(MUTED) },
  ];
}

/** The fragment key of a shared theme: `#theme=<encoded>`. */
export const HASH_KEY = 'theme=';
