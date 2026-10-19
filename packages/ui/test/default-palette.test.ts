import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  colorSafeUpDown,
  darkTheme,
  highContrastDarkTheme,
  highContrastLightTheme,
  lightTheme,
  type ChartTheme,
  type LocalizationOptions,
} from '@chart-on/core';
import css from '../src/style.css?raw';
import { fakeContainer } from '../../core/test/fake-dom';
import {
  colorsIn,
  designForms,
  hash,
  isRetired,
  labelEntries,
  retiredDesign,
  shortcutEntries,
  type DesignEntry,
  type DesignKind,
} from '../../core/test/retired-palette';
import { defaultShellMessages } from '../src/messages';
import { groupLabels } from '../src/rail';
import { commandPalette } from '../src/command-palette';
import { fontSizes } from '../src/drawing-style-controls';
import { createChartShell, type ChartShell } from '../src/shell';
import { symbolSearch } from '../src/symbol-search';
import { chartStyles } from '../src/toolbar-presets';
import { defaultSwatches } from '../src/color-control';

describe('style.css palette', () => {
  it('does not reuse the retired palette', () => {
    expect(colorsIn(css).length).toBeGreaterThan(50);
    expect(colorsIn(css).filter(isRetired)).toEqual([]);
  });

  it('keeps retired colours out of the default swatches', () => {
    expect(defaultSwatches.filter(isRetired)).toEqual([]);
  });

  it('uses the core dark and light heatmap ramps', () => {
    const ramps = [...css.matchAll(/--pc-heatmap:\s*([^;]+);/g)].map((m) => m[1]!.split(',').map((s) => s.trim()));
    // The dark default, the explicit light theme and the follow-the-OS light block, then the same for high contrast.
    expect(ramps).toEqual([
      darkTheme.heatmap,
      lightTheme.heatmap,
      lightTheme.heatmap,
      highContrastDarkTheme.heatmap,
      highContrastLightTheme.heatmap,
      highContrastLightTheme.heatmap,
    ]);
  });

  it('matches the core high-contrast and colour-safe presets', () => {
    /** Custom properties set by the first block that opens with `selector`. */
    const tokens = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThanOrEqual(0);
      const body = css.slice(start, css.indexOf('}', start));
      return Object.fromEntries([...body.matchAll(/(--pc-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
    };
    const literal = (theme: Partial<ChartTheme>) => ({
      ...(theme.up && { '--pc-up': theme.up }),
      ...(theme.down && { '--pc-down': theme.down }),
      ...(theme.ask && { '--pc-ask': theme.ask }),
      ...(theme.bid && { '--pc-bid': theme.bid }),
      ...(theme.depthBid && { '--pc-depth-bid': theme.depthBid }),
      ...(theme.depthAsk && { '--pc-depth-ask': theme.depthAsk }),
      ...(theme.extendedHours && { '--pc-extended-hours': theme.extendedHours }),
      ...(theme.alert && { '--pc-alert': theme.alert }),
      ...(theme.grid && { '--pc-chart-grid': theme.grid }),
      ...(theme.crosshair && { '--pc-chart-crosshair': theme.crosshair }),
      ...(theme.drawingFill && { '--pc-drawing-fill': theme.drawingFill }),
      ...(theme.watermark && { '--pc-chart-watermark': theme.watermark }),
    });
    expect(tokens('.pc-shell.pc-theme-high-contrast')).toMatchObject(literal(highContrastDarkTheme));
    expect(tokens('.pc-shell.pc-theme-high-contrast.pc-light')).toMatchObject(literal(highContrastLightTheme));
    expect(tokens('  .pc-shell.pc-theme-high-contrast:not([data-theme])')).toMatchObject(literal(highContrastLightTheme));
    expect(tokens(".pc-shell[data-pc-palette='color-safe']")).toEqual(literal(colorSafeUpDown.dark));
    expect(tokens(".pc-shell[data-pc-palette='color-safe'].pc-light")).toEqual(literal(colorSafeUpDown.light));
    expect(tokens("  .pc-shell[data-pc-palette='color-safe']:not([data-theme])")).toEqual(literal(colorSafeUpDown.light));
  });
});

/** Every locale pack in `@chart-on/locales`, each exporting its `LocalizationOptions`. */
const packs = import.meta.glob<Record<string, LocalizationOptions>>('../../locales/src/*-*.ts', { eager: true });

const shells: ChartShell[] = [];
afterEach(() => {
  shells.splice(0).forEach((s) => s.destroy());
  vi.unstubAllGlobals();
});

/** The shell's live design data: chart style and rail group orders, labels, locale packs and every default shortcut. */
function shellDesign(): DesignEntry[] {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal('MutationObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
  // The default shell has every built-in plugin, so its actions are the chart's and the chrome's. The opt-in
  // parts with shortcuts move some keys (`/` goes from the indicator picker to the symbol search), so read both.
  const search = symbolSearch({ source: { search: async () => [] }, onSelect: () => {} });
  shells.push(createChartShell(fakeContainer()), createChartShell(fakeContainer(), { symbolSearch: search, commandPalette: commandPalette() }));
  return [
    { kind: 'order', where: 'chartStyles', form: designForms.order(chartStyles.map((s) => s.value)) },
    { kind: 'order', where: 'defaultSwatches', form: designForms.order(defaultSwatches) },
    { kind: 'order', where: 'rail groups', form: designForms.order(Object.keys(groupLabels)) },
    { kind: 'levels', where: 'drawing font sizes', form: designForms.levels(fontSizes(darkTheme.fontSize)) },
    { kind: 'order', where: 'rail group labels', form: designForms.order(Object.values(groupLabels)) },
    ...labelEntries('chart style label', chartStyles.map((s) => s.label)),
    ...labelEntries('rail group label', Object.values(groupLabels)),
    ...labelEntries('defaultShellMessages', Object.values(defaultShellMessages)),
    ...Object.entries(packs).flatMap(([file, pack]) =>
      Object.values(pack).flatMap((p) => labelEntries(file.replace(/^.*\//, ''), Object.values(p.messages ?? {}))),
    ),
    ...shells.flatMap((shell) => shortcutEntries('shell actions', shell.chart.actions.list())),
  ];
}

describe('retired design fingerprints', () => {
  it('do not match the shell orders, labels, locale packs or shortcuts', () => {
    expect(Object.keys(packs).length).toBeGreaterThanOrEqual(7);
    const live = shellDesign();
    const count = (kind: DesignKind) => live.filter((e) => e.kind === kind).length;
    expect(count('order')).toBe(4);
    expect(count('label')).toBeGreaterThan(3000);
    expect(count('shortcut')).toBeGreaterThan(15);
    expect(retiredDesign(live)).toEqual([]);
  });

  it('fail when a retired order, label or shortcut comes back', () => {
    const live = shellDesign();
    const order = designForms.order(chartStyles.map((s) => s.value));
    const label = live.find((e) => e.kind === 'label' && e.where === 'de-DE.ts')!;
    const key = live.find((e) => e.kind === 'shortcut')!;
    const retired = { levels: new Set<number>(), order: new Set([hash(order)]), label: new Set([hash(label.form)]), shortcut: new Set([hash(key.form)]), name: new Set<number>() };
    expect(retiredDesign(live, retired)).toEqual(
      expect.arrayContaining([`chartStyles (order): ${order}`, `de-DE.ts (label): ${label.form}`, `shell actions (shortcut): ${key.form}`]),
    );
  });
});
