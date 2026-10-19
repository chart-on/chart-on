import { afterEach, expect, it, vi } from 'vitest';
import { createChart } from '@chart-on/core';
import { installTestEnvironment, sampleBars } from '@chart-on/core/testing';
import { appearanceOf, createAppearance, createChartSettings, type ShellDirection, type ShellPalette, type ShellTheme } from '@chart-on/ui';
import { demoSettings } from '../src/app-settings';

const env = installTestEnvironment({ width: 960, height: 540 });
afterEach(() => env.uninstall());

function setup() {
  const state = { theme: 'dark' as ShellTheme, contrast: false, palette: 'default' as ShellPalette, direction: 'auto' as ShellDirection };
  const ctx = {
    theme: () => state.theme,
    setTheme: vi.fn((theme: ShellTheme) => (state.theme = theme)),
    highContrast: () => state.contrast,
    setHighContrast: (on: boolean) => (state.contrast = on),
    palette: () => state.palette,
    setPalette: (palette: ShellPalette) => (state.palette = palette),
    direction: () => state.direction,
    setDirection: (direction: ShellDirection) => (state.direction = direction),
  };
  const chart = createChart(env.container());
  chart.addCandles({ title: 'Demo', animate: false }).setData(sampleBars({ count: 50, seed: 1 }));
  createAppearance(chart, { storage: null });
  const app = demoSettings(ctx);
  // Ok saves to storage and Cancel does not, so `save` tells them apart.
  const storage = { load: () => null, save: vi.fn() };
  const settings = createChartSettings(chart, env.container(), { storage, ...app });
  return { chart, ctx, state, app, settings, storage };
}

it('shows theme, accessibility, language and direction as an Appearance section after the option sections', () => {
  const { chart, settings } = setup();
  const dialog = settings.open('demo-appearance')!;
  expect(dialog.section).toBe('demo-appearance');
  expect(dialog.values).toMatchObject({
    'demo.theme': 'dark',
    'demo.highContrast': false,
    'demo.colorSafe': false,
    'demo.locale': 'builtin',
    // `auto` on a left-to-right page.
    'demo.direction': 'ltr',
  });
  settings.close();
  chart.destroy();
});

it('applies each field through the shell and the chart', () => {
  const { chart, ctx, state, app } = setup();
  const field = (id: string) => app.fields![0]!.groups.flatMap((g) => g.fields).find((f) => f.id === id)!;
  field('demo.theme').set(chart, 'light');
  expect(ctx.setTheme).toHaveBeenCalledWith('light');
  field('demo.colorSafe').set(chart, true);
  expect(state.palette).toBe('color-safe');
  field('demo.direction').set(chart, 'rtl');
  expect(field('demo.direction').get(chart)).toBe('rtl');
  field('demo.locale').set(chart, 'de-DE');
  expect(chart.options.localization.locale).toBe('de-DE');
  expect(field('demo.locale').get(chart)).toBe('de-DE');
  chart.destroy();
});

it('closes the dialog as Ok does before the Colors button opens the colors panel', () => {
  const { chart, app, settings, storage } = setup();
  settings.open();
  app.actions![0]!.onClick(chart);
  expect(settings.isOpen).toBe(false);
  expect(storage.save).toHaveBeenCalled();
  expect(appearanceOf(chart)?.isOpen).toBe(true);
  appearanceOf(chart)?.close();
  chart.destroy();
});
