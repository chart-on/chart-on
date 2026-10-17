import { afterEach, describe, expect, it } from 'vitest';
import { builtins } from '../src/builtins';
import { Chart } from '../src/chart';
import { chartSettingsSchema } from '../src/chart-settings';
import { patternTools } from '../src/drawing/pattern-tools';
import { builtinTools } from '../src/drawing/tools';
import { darkTheme, lightTheme, type ChartTheme } from '../src/theme';
import { parseColor } from '../src/util/color';
import { defaultMessages } from '../src/util/locale';
import { fakeContainer } from './fake-dom';
import { lightness } from './oklab';
import {
  colorsIn,
  designForms,
  hash,
  isRetired,
  labelEntries,
  nameEntries,
  retiredDesign,
  shortcutEntries,
  type DesignEntry,
  type DesignKind,
} from './retired-palette';

const COLOR_KEYS = [
  'background', 'grid', 'separator', 'text', 'textMuted', 'crosshair', 'labelBackground',
  'labelText', 'up', 'down', 'line', 'drawing', 'drawingSelected', 'drawingFill', 'alert',
] as const satisfies readonly (keyof ChartTheme)[];

const key = (color: string) => parseColor(color).join(',');

function luminance(color: string): number {
  const [r, g, b] = parseColor(color).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe.each([
  ['dark', darkTheme],
  ['light', lightTheme],
])('%s theme defaults', (_, theme) => {
  it('do not reuse the retired palette', () => {
    for (const k of COLOR_KEYS) expect(isRetired(theme[k]), `${k}: ${theme[k]}`).toBe(false);
  });

  it('meet WCAG AA for text on the canvas and on labels', () => {
    for (const k of ['text', 'textMuted', 'up', 'down', 'line', 'alert'] as const) {
      expect(contrast(theme[k], theme.background), k).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(theme.labelText, theme.labelBackground)).toBeGreaterThanOrEqual(4.5);
  });
});

/** The heatmap ramps before #227. */
const PREVIOUS_HEATMAP = [
  '#1e1b4b', '#6d28d9', '#0891b2', '#22d3ee', '#a3e635', '#facc15',
  '#e0e7ff', '#a78bfa', '#06b6d4', '#84cc16', '#eab308',
];

describe.each([
  ['dark', darkTheme, 1],
  ['light', lightTheme, -1],
])('%s theme heatmap', (_, theme, direction) => {
  // Lightness away from the canvas: brighter on the dark canvas, darker on the light one.
  const away = (color: string) => direction * (lightness(color) - lightness(theme.background));
  const stops = theme.heatmap;

  it('fades into the canvas at the low end', () => {
    expect(away(stops[0]!)).toBeGreaterThan(0);
    expect(away(stops[0]!)).toBeLessThan(0.1);
    expect(contrast(stops[0]!, theme.background)).toBeLessThan(1.25);
  });

  it('changes lightness monotonically from low to high, in clear steps', () => {
    for (let i = 1; i < stops.length; i++) {
      expect(away(stops[i]!) - away(stops[i - 1]!), `${stops[i - 1]} → ${stops[i]}`).toBeGreaterThan(0.07);
    }
  });

  it('ends in strong contrast with the canvas', () => {
    expect(contrast(stops[stops.length - 1]!, theme.background)).toBeGreaterThanOrEqual(7);
  });

  it('does not reuse the previous ramps', () => {
    const previous = new Set(PREVIOUS_HEATMAP.map(key));
    for (const stop of stops) expect(previous.has(key(stop)), stop).toBe(false);
  });
});

/** Every tracked text file that could carry a colour: sources, tests, demos, examples and docs. */
const files = import.meta.glob<string>(
  [
    '../../../{packages,apps,examples,docs,roadmap,scripts}/**/*.{ts,tsx,js,mjs,css,html,md,vue,svelte,json}',
    '../../../*.md',
    '!**/node_modules/**',
    '!**/dist/**',
    '!../../../docs/.vitepress/{cache,dist}/**',
  ],
  { query: '?raw', import: 'default', eager: true },
);

/** The public API reports, by path. */
const apiReports = import.meta.glob<string>('../../../etc/*.api.md', { query: '?raw', import: 'default', eager: true });

/** `isRetired`, false for template fragments such as `rgba(${r}, …)` that are not colours. */
function retired(color: string): boolean {
  try {
    return isRetired(color);
  } catch {
    return false;
  }
}

describe('repository files', () => {
  it('do not use the retired palette anywhere, docs and tests included', () => {
    expect(Object.keys(files).length).toBeGreaterThan(500);
    const found = Object.entries(files).flatMap(([path, text]) =>
      colorsIn(text).filter(retired).map((color) => `${path}: ${color}`),
    );
    expect(found).toEqual([]);
  });
});

/** Every label the settings schema shows: section titles, group headings, field labels and hints, and choice labels. */
const settingsLabels = chartSettingsSchema.flatMap((s) => [
  s.title,
  ...s.groups.flatMap((g) => [g.label, ...g.fields.flatMap((f) => [f.label, f.hint, ...(f.choices ?? []).map((c) => c.label)])]),
]);

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

/** The live design data: tool level sets, catalogue and settings orders, labels, default shortcuts and public API names. */
function coreDesign(): DesignEntry[] {
  const chart = new Chart(fakeContainer(), { plugins: builtins() });
  charts.push(chart);
  chart.addPane();
  // A frame sizes the automatic margins, so the guard reads what the panes show.
  chart.invalidate();
  (chart as unknown as { render(t: number): void }).render(0);
  const o = chart.options;
  const profile = builtinTools.find((t) => t.type === 'fixed-range-volume-profile')!.defaultStyle!;
  return [
    { kind: 'levels', where: 'time scale defaults', form: designForms.levels([o.barSpacing, o.minBarSpacing, o.maxBarSpacing, o.rightOffset, o.minBarCoverage]) },
    ...[0, 1].map((i): DesignEntry => {
      const s = chart.panes[i]!.price;
      return { kind: 'levels', where: `pane ${i} margins`, form: designForms.levels([s.marginTop ?? s.autoMargins[0], s.marginBottom ?? s.autoMargins[1]]) };
    }),
    { kind: 'levels', where: 'fixed-range profile defaults', form: designForms.levels([profile.rows ?? 0, profile.profileWidth ?? 0]) },
    ...builtinTools.flatMap((t): DesignEntry[] =>
      t.defaultStyle?.levels ? [{ kind: 'levels', where: `${t.type} levels`, form: designForms.levels(t.defaultStyle.levels.map((l) => l.value)) }] : [],
    ),
    { kind: 'order', where: 'builtinTools', form: designForms.order(builtinTools.map((t) => t.type)) },
    { kind: 'order', where: 'patternTools', form: designForms.order(patternTools.map((t) => t.type)) },
    { kind: 'order', where: 'settings sections', form: designForms.order(chartSettingsSchema.map((s) => s.id)) },
    ...labelEntries('tool label', builtinTools.map((t) => t.label)),
    ...labelEntries('settings label', settingsLabels),
    ...labelEntries('defaultMessages', Object.values(defaultMessages)),
    ...shortcutEntries('chart actions', chart.actions.list()),
    ...Object.entries(apiReports).flatMap(([path, report]) => nameEntries(path.replace(/^(\.\.\/)+/, ''), report)),
  ];
}

describe('retired design fingerprints', () => {
  it('keep their text forms and hash', () => {
    // Changing a form or the hash would silently disarm every fingerprint taken with the old one.
    expect(designForms.levels([1, 0.5, 0, 2])).toBe('0,0.5,1,2');
    expect(designForms.order(['b', 'a'])).toBe('b,a');
    expect(designForms.label('  Show Grid ')).toBe('show grid');
    expect(designForms.shortcuts({ b: ['X'], a: ['Shift+Y', 'Ctrl+Z'] })).toEqual(['a=Ctrl+Z', 'a=Shift+Y', 'b=X']);
    expect(designForms.name('setSymbol')).toBe('setSymbol');
    expect(nameEntries('r', `get x(): Mark;\n'data:loaded': {}; readonly ["load-failed"]`).map((e) => e.form)).toEqual(['get', 'x', 'Mark', 'data:loaded', 'readonly', 'load-failed']);
    // FNV-1a test vectors.
    expect([hash(''), hash('a'), hash('foobar')]).toEqual([0x811c9dc5, 0xe40c292c, 0xbf9cf968]);
  });

  it('do not match the core defaults, orders, labels, shortcuts or API names', () => {
    const live = coreDesign();
    const count = (kind: DesignKind) => live.filter((e) => e.kind === kind).length;
    // The live data is really read: several level tools, the orders, many labels and keys.
    expect(count('levels')).toBeGreaterThan(10);
    expect(count('order')).toBe(3);
    expect(count('label')).toBeGreaterThan(300);
    expect(count('shortcut')).toBeGreaterThan(10);
    expect(count('name')).toBeGreaterThan(1000);
    expect(retiredDesign(live)).toEqual([]);
  });

  it('fail when a retired value comes back', () => {
    const live = coreDesign();
    const levels = live.find((e) => e.where === 'fib-retracement levels')!;
    const label = designForms.label(defaultMessages.statusNoData);
    const key = live.find((e) => e.kind === 'shortcut' && e.form.startsWith('zoom-in='))!;
    const retired = {
      levels: new Set([hash(levels.form)]),
      order: new Set([hash(designForms.order(chartSettingsSchema.map((s) => s.id)))]),
      label: new Set([hash(label)]),
      shortcut: new Set([hash(key.form)]),
      name: new Set([hash('setSymbol'), hash('data:loaded')]),
    };
    expect(retiredDesign(live, retired)).toEqual(
      expect.arrayContaining([
        `fib-retracement levels (levels): ${levels.form}`,
        `settings sections (order): ${designForms.order(chartSettingsSchema.map((s) => s.id))}`,
        `defaultMessages (label): ${label}`,
        `chart actions (shortcut): ${key.form}`,
        'etc/core.api.md (name): setSymbol',
        'etc/core.api.md (name): data:loaded',
      ]),
    );
  });
});
