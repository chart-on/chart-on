/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { chartThemeTokens, chartTypographyTokens, darkTheme, lightTheme, themeFromCss, type ChartTheme } from '@chart-on/core';
import css from '../src/style.css?raw';
import docsTheming from '../../../docs/guide/theming.md?raw';
import { declarations, parseRules, ruleVars } from '../../../docs/.vitepress/theme-builder/css';
import {
  baseThemes,
  chartTheme,
  contrastChecks,
  createBuilder,
  exportCss,
  exportTheme,
  importCss,
  importThemeObject,
  layeredReader,
  parseThemeObject,
  resolvedValue,
  safeValue,
  sanitizeState,
  SCHEMES,
  themeObjectCode,
  type BuilderState,
  type Scheme,
} from '../../../docs/.vitepress/theme-builder/model';

const b = createBuilder(css);

/** What `themeFromCss` reads from an exported CSS block alone, for one scheme. */
function themeFromBlock(text: string, scheme: Scheme): ChartTheme {
  const rules = parseRules(text);
  const dark = ruleVars(rules, '.my-theme.pc-shell');
  const light = ruleVars(rules, ".my-theme.pc-shell[data-theme='light']");
  return themeFromCss(scheme === 'dark' ? layeredReader(dark) : layeredReader(dark, light), baseThemes[scheme]);
}

/** What a UI shell reads with the stylesheet and the exported block loaded after it. */
function themeInShell(text: string, scheme: Scheme): ChartTheme {
  const rules = parseRules(text);
  const dark = ruleVars(rules, '.my-theme.pc-shell');
  const light = scheme === 'light' ? ruleVars(rules, ".my-theme.pc-shell[data-theme='light']") : new Map<string, string>();
  return themeFromCss(layeredReader(b.defaults[scheme], dark, light), baseThemes[scheme]);
}

const edited: BuilderState = {
  dark: {
    '--pc-accent': '#0ea5e9',
    '--pc-panel': '#0b1020',
    '--pc-radius-md': '10px',
    '--pc-up': '#22c55e',
    '--pc-chart-label-bg': 'rgba(14, 165, 233, 0.9)',
    '--pc-chart-font': '"Brand Sans", system-ui, sans-serif',
    '--pc-chart-font-size': '13px',
    '--pc-chart-font-weight': '500',
    '--pc-heatmap': '#000000, #ff0000, #ffffff',
    '--pc-level-green': '#00ff00',
    '--pc-chart-grid-h': 'rgba(255, 255, 255, 0.1)',
  },
  light: {
    '--pc-ink': '#000000',
    '--pc-down': '#b91c1c',
    '--pc-chart-numerals': 'proportional',
  },
};

const fixtures: [string, BuilderState][] = [
  ['default', { dark: {}, light: {} }],
  ['edited', edited],
  ...b.presets.map((p): [string, BuilderState] => [`preset ${p.id}`, p.state]),
];

describe('theme builder token list', () => {
  it('has every chart and typography token', () => {
    const names = b.tokens.filter((t) => t.group === 'chart').map((t) => t.name);
    expect(names).toEqual([...Object.values(chartThemeTokens), ...Object.values(chartTypographyTokens)]);
  });

  it('reads the shell variables from the stylesheet, including those the guide documents', () => {
    const shell = new Set(b.tokens.filter((t) => t.group === 'shell').map((t) => t.name));
    const table = docsTheming.slice(docsTheming.indexOf('| `--pc-shell`'), docsTheming.indexOf('Defaults for both schemes'));
    const documented = [...table.matchAll(/`(--pc-[\w-]+)`/g)].map((m) => m[1]!);
    expect(documented.length).toBeGreaterThan(20);
    for (const name of documented) expect(shell, name).toContain(name);
    for (const name of Object.values(chartThemeTokens)) expect(shell.has(name)).toBe(false);
  });

  it('tells colours from other values', () => {
    const kind = (name: string) => b.tokens.find((t) => t.name === name)?.kind;
    expect(kind('--pc-accent')).toBe('color');
    expect(kind('--pc-focus')).toBe('color');
    expect(kind('--pc-radius-md')).toBe('text');
    expect(kind('--pc-shadow')).toBe('text');
    expect(kind('--pc-chart-font-size')).toBe('size');
    expect(kind('--pc-heatmap')).toBe('heatmap');
  });

  it('gives the built-in themes with no overrides', () => {
    for (const scheme of SCHEMES) {
      const theme = chartTheme(b, scheme, {});
      const { typography, ...rest } = theme;
      expect(typography).toEqual({ fontWeight: 400, numerals: 'tabular' });
      expect(rest).toEqual(baseThemes[scheme]);
    }
    expect(exportTheme(b, { dark: {}, light: {} })).toEqual({ dark: {}, light: {} });
  });
});

describe('theme builder export', () => {
  it.each(fixtures)('round-trips the CSS block through themeFromCss (%s)', (_, state) => {
    const exported = exportTheme(b, state);
    const text = exportCss(b, state);
    for (const scheme of SCHEMES) {
      const expected = { ...baseThemes[scheme], ...exported[scheme] };
      expect(themeFromBlock(text, scheme)).toEqual(expected);
      // With the stylesheet underneath, as in an app: the same theme as the preview.
      const shell = themeInShell(text, scheme);
      const preview = chartTheme(b, scheme, state[scheme]);
      expect({ ...shell, typography: undefined }).toEqual({ ...preview, typography: undefined });
      expect(shell.typography?.fontWeight ?? 400).toBe(preview.typography?.fontWeight ?? 400);
      expect(shell.typography?.numerals ?? 'tabular').toBe(preview.typography?.numerals ?? 'tabular');
    }
  });

  it.each(fixtures)('restores every control from the pasted CSS (%s)', (_, state) => {
    const text = exportCss(b, state);
    const restored = importCss(b, text);
    for (const scheme of SCHEMES) {
      for (const token of b.tokens) {
        expect(resolvedValue(b, scheme, restored[scheme], token.name), `${scheme} ${token.name}`).toBe(resolvedValue(b, scheme, state[scheme], token.name));
      }
    }
    expect(exportCss(b, restored)).toBe(text);
  });

  it.each(fixtures)('restores the chart from the pasted theme object (%s)', (_, state) => {
    const code = themeObjectCode(exportTheme(b, state));
    const shellOnly: BuilderState = {
      dark: Object.fromEntries(Object.entries(state.dark).filter(([n]) => b.tokens.find((t) => t.name === n)?.group === 'shell')),
      light: Object.fromEntries(Object.entries(state.light).filter(([n]) => b.tokens.find((t) => t.name === n)?.group === 'shell')),
    };
    const restored = importThemeObject(b, code, shellOnly);
    for (const scheme of SCHEMES) expect(chartTheme(b, scheme, restored[scheme])).toEqual(chartTheme(b, scheme, state[scheme]));
    expect(themeObjectCode(exportTheme(b, restored))).toBe(code);
  });

  it('writes a theme object usable as code and JSON', () => {
    const exported = exportTheme(b, edited);
    expect(exported.dark).toMatchObject({ up: '#22c55e', line: '#0ea5e9', fontSize: 13, typography: { fontWeight: 500, numerals: 'tabular' } });
    expect(exported.dark.heatmap).toEqual(['#000000', '#ff0000', '#ffffff']);
    expect(exported.light).toMatchObject({ down: '#b91c1c', text: '#000000', typography: { fontWeight: 400, numerals: 'proportional' } });
    expect(parseThemeObject(themeObjectCode(exported))).toEqual(exported);
    expect(parseThemeObject(JSON.stringify(exported))).toEqual(exported);
  });

  it('keeps dark values out of the light scheme', () => {
    const text = exportCss(b, { dark: { '--pc-accent': '#ff0000', '--pc-chart-grid-h': '#ff0000' }, light: {} });
    const light = ruleVars(parseRules(text), ".my-theme.pc-shell[data-theme='light']");
    expect(light.get('--pc-accent')).toBe('#5f43e6');
    expect(light.get('--pc-chart-grid-h')).toBe('initial');
    expect(light.get('--pc-line-series')).toBe(lightTheme.line);
    expect(text).toContain(".my-theme.pc-shell:not([data-theme])");
  });

  it('takes a flat theme object for both schemes and drops invalid values', () => {
    const restored = importThemeObject(b, '{ "up": "#123456", "down": "not a colour", "fontSize": -1, "bogus": 1 }', { dark: {}, light: {} });
    expect(restored).toEqual({ dark: { '--pc-up': '#123456' }, light: { '--pc-up': '#123456' } });
    expect(() => importThemeObject(b, 'nothing here', { dark: {}, light: {} })).toThrow();
    expect(() => importCss(b, '.x { color: red }')).toThrow();
  });
});

describe('theme builder input checks', () => {
  it('accepts only safe values of the right kind', () => {
    expect(safeValue(b, '--pc-up', '#22c55e')).toBe(true);
    expect(safeValue(b, '--pc-up', 'var(--pc-accent)')).toBe(true);
    expect(safeValue(b, '--pc-up', 'nope')).toBe(false);
    expect(safeValue(b, '--pc-up', 'red; background: url(x)')).toBe(false);
    expect(safeValue(b, '--pc-shadow', '0 0 1px url(https://example.com/x.png)')).toBe(false);
    expect(safeValue(b, '--pc-font', '"Brand Sans", system-ui')).toBe(true);
    // An open quote or comment would swallow the declarations after it in the exported CSS.
    expect(safeValue(b, '--pc-font', '"Brand Sans, system-ui')).toBe(false);
    expect(safeValue(b, '--pc-font', 'system-ui /* x')).toBe(false);
    expect(safeValue(b, '--pc-unknown', '#fff')).toBe(false);
    expect(safeValue(b, '--pc-chart-font-size', '13px')).toBe(true);
    expect(safeValue(b, '--pc-chart-numerals', 'oldstyle')).toBe(false);
  });

  it('sanitizes state from a link', () => {
    expect(sanitizeState(b, { dark: { '--pc-up': '#22c55e', '--evil': 'x', '--pc-down': '}' }, light: 3 })).toEqual({
      dark: { '--pc-up': '#22c55e' },
      light: {},
    });
    expect(sanitizeState(b, null)).toEqual({ dark: {}, light: {} });
  });

  it('reads custom properties without nested blocks or comments', () => {
    expect(declarations(' --a: 1; color: red; --b: rgb(1, 2, 3) ; &:hover { --c: 2 } --d: x')).toEqual(
      new Map([
        ['--a', '1'],
        ['--b', 'rgb(1, 2, 3)'],
        ['--d', 'x'],
      ]),
    );
    const rules = parseRules('/* .a { --x: 1 } */ .a, .b { --y: "{;}"; } @media (x) { .a { --z: 1 } }');
    expect(ruleVars(rules, '.a')).toEqual(new Map([['--y', '"{;}"']]));
  });
});

describe('theme builder presets and contrast', () => {
  it('ships three to five presets', () => {
    expect(b.presets.length).toBeGreaterThanOrEqual(3);
    expect(b.presets.length).toBeLessThanOrEqual(5);
  });

  it.each(b.presets.map((p) => [p.id, p] as const))('preset %s passes every contrast check in both schemes', (_, preset) => {
    for (const scheme of SCHEMES) {
      const checks = contrastChecks(b, scheme, preset.state[scheme]);
      expect(checks.map((c) => c.label)).toEqual(expect.arrayContaining(['Axis and legend text', 'Muted axis and legend text']));
      for (const check of checks) expect(check.ratio, `${scheme} ${check.label}`).toBeGreaterThanOrEqual(check.min);
    }
  });

  it('builds the high-contrast preset from the stylesheet tokens', () => {
    const hc = b.presets.find((p) => p.id === 'high-contrast')!;
    expect(chartTheme(b, 'dark', hc.state.dark).text).toBe('#ffffff');
    expect(chartTheme(b, 'light', hc.state.light).background).toBe('#ffffff');
    expect(chartTheme(b, 'light', hc.state.light).text).toBe('#000000');
    const safe = b.presets.find((p) => p.id === 'color-safe')!;
    expect(exportTheme(b, safe.state).dark.up).toBe('#4ba3ff');
  });

  it('flags low-contrast text', () => {
    const checks = contrastChecks(b, 'dark', { '--pc-chart-text': '#202028' });
    expect(checks.find((c) => c.label === 'Axis and legend text')).toMatchObject({ ok: false, tokens: ['--pc-chart-text', '--pc-chart-bg'] });
    expect(darkTheme.text).not.toBe('#202028');
  });
});
