import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chart, chartSettingsSchema, darkTheme, type ChartSettingField } from '@chart-on/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { chooseOption } from './listbox';
import { createAppearance } from '../src/appearance';
import { createChartSettings, settingInput, settingsOf, settingsToolbarItem, type ChartSettingsStorage } from '../src/chart-settings';

type El = HTMLElement & { children: El[]; tagName: string; textContent: string; value: string; checked: boolean; selectedIndex: number };

const all = (root: El): El[] => root.children.flatMap((c) => [c, ...all(c)]);
const find = (root: El, test: (el: El) => boolean) => all(root).find(test);
const row = (root: El, id: string) => find(root, (el) => el.getAttribute('data-field') === id);
const control = (root: El, id: string) => find(row(root, id)!, (el) => ['input', 'select', 'button'].includes(el.tagName))!;
const action = (root: El, id: string) => find(root, (el) => el.getAttribute('data-action') === id)!;
const idOf = (el: El) => el.getAttribute('id');
const focused = () => document.activeElement as unknown as El;
const key = (target: El, k: string) => dispatch(target, 'keydown', { key: k });
const type = (input: El, text: string) => {
  input.value = text;
  dispatch(input, 'input');
};
const tabs = (root: El) => all(root).filter((el) => el.getAttribute('role') === 'tab').map((el) => el.textContent);
const check = (root: El, id: string, on: boolean) => {
  const box = control(root, id);
  box.checked = on;
  dispatch(box, 'change');
};
const choose = (root: El, id: string, index: number) => chooseOption(control(root, id), index);
const pickColor = (root: El, id: string, hex: string) => {
  dispatch(control(root, id), 'click');
  const custom = find(root, (el) => el.getAttribute('aria-label') === 'Custom color')!;
  custom.value = hex;
  dispatch(custom, 'input');
};

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

function setup(options: Parameters<typeof createChartSettings>[2] = {}, withSeries = true) {
  const host = fakeContainer() as unknown as El;
  const chart = new Chart(fakeContainer());
  charts.push(chart);
  if (withSeries) chart.addCandles({ title: 'ABC' }).setData([{ time: 0, open: 1, high: 2, low: 0.5, close: 1.5 }]);
  const settings = createChartSettings(chart, host, { storage: null, ...options });
  return { host, chart, settings, panel: () => settings.dialog!.el.children[0] as El };
}

const memory = (initial: Record<string, unknown> | null = null) => {
  let data = initial;
  const storage: ChartSettingsStorage & { data: () => typeof data } = {
    load: () => data,
    save: vi.fn((values) => (data = values)),
    data: () => data,
  };
  return storage;
};

describe('setting inputs', () => {
  it('maps each field kind onto a form input keyed by its path', () => {
    const field: ChartSettingField = { path: 'theme.watermark', label: 'Color', kind: 'color', when: { path: 'features.watermark', equals: true } };
    const input = settingInput(field);
    expect(input).toMatchObject({ id: 'theme.watermark', kind: 'color', label: 'Color' });
    const visible = input.visible as (v: Record<string, unknown>) => boolean;
    expect(visible({ 'features.watermark': true })).toBe(true);
    expect(visible({ 'features.watermark': false })).toBe(false);
    expect(settingInput({ path: 'legend.mode', label: 'Mode', kind: 'select', choices: [{ value: 'full', label: 'Full' }] })).toMatchObject({
      kind: 'select',
      options: [{ value: 'full', label: 'Full' }],
    });
    expect(settingInput({ path: 'series.bodyRatio', label: 'Width', kind: 'slider', min: 0.1, max: 1 })).toMatchObject({ kind: 'slider', min: 0.1, max: 1 });
  });

  it('makes long selects searchable', () => {
    const choices = (n: number) => Array.from({ length: n }, (_, i) => ({ value: i, label: `Choice ${i}` }));
    expect(settingInput({ path: 'a', label: 'A', kind: 'select', choices: choices(20) })).not.toHaveProperty('searchable');
    expect(settingInput({ path: 'a', label: 'A', kind: 'select', choices: choices(21) })).toMatchObject({ searchable: true });
    const timezone = chartSettingsSchema.find((s) => s.id === 'time')!.groups[0]!.fields[0]!;
    expect(settingInput(timezone)).toMatchObject({ id: 'timezone', kind: 'select', searchable: true });
  });
});

describe('chart settings dialog', () => {
  it('shows the built-in sections and the current values', () => {
    const { settings, panel, chart } = setup();
    const dialog = settings.open()!;
    expect(tabs(panel())).toEqual(chartSettingsSchema.map((s) => s.title));
    expect(dialog.values['legend.mode']).toBe('full');
    expect(dialog.values['theme.up']).toBe(chart.appearance().theme.up);
    expect(settings.isOpen).toBe(true);
    expect(settings.open()).toBe(dialog);
  });

  it('leaves out fields the chart has no value for', () => {
    const { settings } = setup({}, false);
    const values = settings.open()!.values;
    expect(Object.keys(values).some((path) => path.startsWith('series.'))).toBe(false);
    expect(values['features.legend']).toBe(true);
  });

  it('leaves out the market status and countdown switches on a chart without their plugins', () => {
    const { settings, chart } = setup();
    const opened = settings.open()!.values;
    expect(opened.marketStatus).toBe(true);
    expect(opened['features.countdown']).toBe(true);
    settings.close();
    expect(chart.uninstall('@chart-on/core/market-status')).toBe(true);
    expect(chart.uninstall('@chart-on/core/countdown')).toBe(true);
    const values = settings.open()!.values;
    expect('marketStatus' in values).toBe(false);
    expect('features.countdown' in values).toBe(false);
    // Fields without a plugin stay.
    expect(values['features.lastValueLabels']).toBe(true);
  });

  it('previews edits live and restores them on cancel', () => {
    const { settings, panel, chart } = setup();
    settings.open('legend');
    choose(panel(), 'legend.mode', 2);
    expect(chart.legendSettings.mode).toBe('title');
    settings.open('symbol');
    check(panel(), 'series.wicks', false);
    expect(chart.main!.options.wicks).toBe(false);
    settings.close();
    expect(settings.isOpen).toBe(false);
    expect(chart.legendSettings.mode).toBe('full');
    expect(chart.main!.options.wicks).toBe(true);
  });

  it('saves changed settings on Ok, and applies saved ones to a new chart', () => {
    const storage = memory();
    const { settings, panel, chart } = setup({ storage });
    settings.open('canvas');
    choose(panel(), 'crosshair.mode', 3);
    check(panel(), 'features.watermark', true);
    dispatch(action(panel(), 'ok'), 'click');
    expect(settings.isOpen).toBe(false);
    expect(storage.data()).toEqual({ 'crosshair.mode': 'hidden', 'features.watermark': true });
    expect(chart.options.crosshair.mode).toBe('hidden');

    const next = setup({ storage });
    expect(next.chart.options.crosshair.mode).toBe('hidden');
    expect(next.chart.features.watermark).toBe(true);
  });

  it('drops a setting from storage once it is back at the default', () => {
    const storage = memory({ 'crosshair.mode': 'hidden' });
    const { settings, panel } = setup({ storage });
    settings.open('canvas');
    choose(panel(), 'crosshair.mode', 0);
    dispatch(action(panel(), 'ok'), 'click');
    expect(storage.data()).toEqual({});
  });

  it('ignores unknown paths and invalid values from storage', () => {
    const storage = memory({ 'crosshair.mode': 'sideways', 'features.legend': false, 'not.an.option': 1, 'legend.position': 'top-right' });
    const { chart, settings } = setup({ storage });
    expect(settings.values).toEqual({ 'features.legend': false, 'legend.position': 'top-right' });
    expect(chart.features.legend).toBe(false);
    expect(chart.options.crosshair.mode).toBe('free');
  });

  it('works with a storage that throws', () => {
    const storage = {
      load: () => {
        throw new Error('blocked');
      },
      save: () => {
        throw new Error('full');
      },
    };
    const { panel, settings } = setup({ storage });
    expect(settings.values).toEqual({});
    settings.open();
    choose(panel(), 'crosshair.mode', 1);
    expect(() => dispatch(action(panel(), 'ok'), 'click')).not.toThrow();
    expect(settings.values).toEqual({ 'crosshair.mode': 'close' });
  });

  it('applies saved main-series settings when the main series is added later', () => {
    const { chart } = setup({ storage: memory({ 'series.wicks': false }) }, false);
    const series = chart.addCandles({ title: 'ABC' });
    expect(series.options.wicks).toBe(false);
  });

  it('resets to the app options; Cancel brings back what was there', () => {
    const storage = memory({ 'legend.mode': 'compact' });
    const { settings, panel, chart } = setup({ storage });
    const dialog = settings.open()!;
    dispatch(action(panel(), 'reset'), 'click');
    expect(chart.legendSettings.mode).toBe('full');
    expect(dialog.values['legend.mode']).toBe('full');
    dispatch(action(panel(), 'cancel'), 'click');
    expect(chart.legendSettings.mode).toBe('compact');
    expect(storage.data()).toEqual({ 'legend.mode': 'compact' });
  });

  it('keeps theme colors and grid lines as appearance overrides', () => {
    const host = fakeContainer() as unknown as El;
    const chart = new Chart(fakeContainer());
    charts.push(chart);
    chart.addCandles({ title: 'ABC' });
    const appearance = createAppearance(chart, { storage: null, defaultPreset: null });
    const storage = memory();
    const settings = createChartSettings(chart, host, { storage });
    const panel = () => settings.dialog!.el.children[0] as El;

    settings.open('canvas');
    pickColor(panel(), 'theme.background', '#102030');
    check(panel(), 'grid.vertical.visible', false);
    expect(chart.appearance().theme.background).toBe('#102030');
    dispatch(action(panel(), 'ok'), 'click');
    expect(appearance.overrides).toEqual({ theme: { background: '#102030' }, grid: { vertical: { visible: false } } });
    expect(storage.data()).toEqual({});

    // Cancel restores the overrides exactly: an unset wick color does not become one.
    settings.open('symbol');
    pickColor(panel(), 'theme.upWick', '#ffffff');
    expect(appearance.overrides.theme?.upWick).toBe('#ffffff');
    settings.close();
    expect(appearance.overrides).toEqual({ theme: { background: '#102030' }, grid: { vertical: { visible: false } } });

    // Reset drops the overrides rather than freezing the current colors.
    settings.open();
    dispatch(action(panel(), 'reset'), 'click');
    dispatch(action(panel(), 'ok'), 'click');
    expect(appearance.overrides).toEqual({});
    expect(chart.appearance().theme.background).toBe(darkTheme.background);
    appearance.destroy();
  });

  it('takes sections from the app', () => {
    const { settings, panel, chart } = setup({
      sections: (defaults) => [
        ...defaults.filter((s) => s.id === 'readout'),
        { id: 'motion', title: 'Motion', groups: [{ id: 'zoom', fields: [{ path: 'smoothZoom', label: 'Smooth zoom', kind: 'boolean' }] }] },
      ],
    });
    settings.open('motion');
    expect(tabs(panel())).toEqual(['Readout', 'Motion']);
    check(panel(), 'smoothZoom', false);
    expect(chart.options.smoothZoom).toBe(false);
  });

  it('shows app fields after the option sections; edits apply live, Cancel restores, nothing is saved', () => {
    const storage = memory();
    const shell = { theme: 'dark', contrast: false };
    const { settings, panel } = setup({
      storage,
      fields: [
        {
          id: 'look',
          title: 'Look',
          groups: [
            {
              id: 'theme',
              label: 'Theme',
              fields: [
                {
                  id: 'shellTheme',
                  label: 'Theme',
                  kind: 'select',
                  choices: [
                    { value: 'dark', label: 'Dark' },
                    { value: 'light', label: 'Light' },
                  ],
                  get: () => shell.theme,
                  set: (_chart, value) => (shell.theme = value as string),
                },
                { id: 'contrast', label: 'High contrast', kind: 'boolean', get: () => shell.contrast, set: (_chart, value) => (shell.contrast = value as boolean) },
                { id: 'missing', label: 'Missing', kind: 'boolean', get: () => undefined, set: () => {} },
              ],
            },
          ],
        },
      ],
    });
    settings.open('look');
    expect(tabs(panel()).at(-1)).toBe('Look');
    expect(row(panel(), 'missing')).toBeUndefined();
    choose(panel(), 'shellTheme', 1);
    check(panel(), 'contrast', true);
    expect(shell).toEqual({ theme: 'light', contrast: true });
    settings.close();
    expect(shell).toEqual({ theme: 'dark', contrast: false });

    settings.open('look');
    check(panel(), 'contrast', true);
    dispatch(action(panel(), 'reset'), 'click');
    expect(shell.contrast).toBe(true);
    expect(settings.dialog!.values['contrast']).toBe(true);
    dispatch(action(panel(), 'ok'), 'click');
    expect(shell.contrast).toBe(true);
    expect(storage.data()).toEqual({});
  });

  it('adds app buttons under the sections, or to the footer start when asked', () => {
    const onClick = vi.fn();
    const { settings, panel, chart } = setup({
      actions: [
        { id: 'ok', label: 'Colors…', onClick },
        { id: 'apply', label: 'Apply to all', onClick: () => {}, placement: 'footer' },
      ],
    });
    settings.open();
    const inside = (cls: string, id: string) => all(find(panel(), (el) => el.className === cls)!).includes(action(panel(), id));
    expect(inside('pc-form-nav', 'app:ok')).toBe(true);
    expect(inside('pc-dialog-footer', 'app:apply')).toBe(true);
    dispatch(action(panel(), 'app:ok'), 'click');
    expect(onClick).toHaveBeenCalledWith(chart);
    expect(settings.isOpen).toBe(true);
  });

  it('keeps Reset to defaults in the header and only Cancel and Ok in the footer', () => {
    const { settings, panel } = setup();
    settings.open();
    expect(all(find(panel(), (el) => el.className === 'pc-dialog-header')!).includes(action(panel(), 'reset'))).toBe(true);
    const footer = all(find(panel(), (el) => el.className === 'pc-dialog-footer')!).filter((el) => el.tagName === 'button');
    expect(footer.map((el) => el.getAttribute('data-action'))).toEqual(['cancel', 'ok']);
  });

  const zoneSearch = (root: El) => find(row(root, 'timezone')!, (el) => el.getAttribute('role') === 'combobox');
  const zoneOptions = (root: El) => all(row(root, 'timezone')!).filter((el) => el.getAttribute('role') === 'option');
  const zoneValue = (root: El) => find(row(root, 'timezone')!, (el) => el.className === 'pc-form-combo-value')!.textContent;

  it('picks the timezone from a closed select that opens a searchable list on the Time section', () => {
    const storage = memory();
    const { settings, panel, chart } = setup({ storage });
    const dialog = settings.open('time')!;
    expect(dialog.section).toBe('time');
    expect(dialog.values.timezone).toBe('local');
    const trigger = control(panel(), 'timezone');
    expect(trigger.tagName).toBe('button');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(zoneValue(panel())).toMatch(/^Local \(/);
    expect(zoneSearch(panel())).toBeUndefined();

    dispatch(trigger, 'click');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const search = zoneSearch(panel())!;
    expect(focused()).toBe(search);
    const options = zoneOptions(panel());
    expect(options[0]!.textContent).toMatch(/^Local \(/);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    expect(options[1]!.textContent).toBe('UTC');
    expect(search.getAttribute('aria-activedescendant')).toBe(idOf(options[0]!));

    type(search, 'tokyo');
    expect(zoneOptions(panel()).map((o) => o.textContent)).toEqual(['Asia/Tokyo (UTC+9)']);
    dispatch(zoneOptions(panel())[0]!, 'click');
    // Picking closes the list, shows the new zone and previews it.
    expect(zoneSearch(panel())).toBeUndefined();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(focused()).toBe(trigger);
    expect(zoneValue(panel())).toBe('Asia/Tokyo (UTC+9)');
    expect(chart.options.timezone).toBe('Asia/Tokyo');
    expect(chart.zone.name).toBe('Asia/Tokyo');

    // Cancel goes back to the opening zone.
    settings.close();
    expect(chart.options.timezone).toBe('local');

    // Keyboard only: open with Arrow Down, search, arrow to a match, Enter picks without submitting.
    settings.open('time');
    const again = control(panel(), 'timezone');
    key(again, 'ArrowDown');
    const box = zoneSearch(panel())!;
    type(box, 'america/');
    const matches = zoneOptions(panel());
    expect(matches.length).toBeGreaterThan(2);
    key(box, 'ArrowDown');
    expect(box.getAttribute('aria-activedescendant')).toBe(idOf(matches[1]!));
    const enter = key(box, 'Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(settings.isOpen).toBe(true);
    expect(zoneSearch(panel())).toBeUndefined();
    const picked = matches[1]!.textContent;
    expect(zoneValue(panel())).toBe(picked);
    expect(chart.options.timezone).toBe(picked.replace(/ \(.*\)$/, ''));
    dispatch(action(panel(), 'ok'), 'click');
    expect(storage.data()).toEqual({ timezone: chart.options.timezone });
    expect(setup({ storage }).chart.options.timezone).toBe(chart.options.timezone);
  });

  it('closes the timezone list on Escape without a change, before the dialog closes', () => {
    const { settings, panel, chart } = setup();
    settings.open('time');
    const trigger = control(panel(), 'timezone');
    // Typing on the closed trigger opens the list with that text in the search box.
    const typed = key(trigger, 't');
    expect(typed.defaultPrevented).toBe(true);
    const search = zoneSearch(panel())!;
    expect(search.value).toBe('t');
    type(search, 'zzz-no-zone');
    expect(zoneOptions(panel())).toHaveLength(0);
    // Enter with nothing to pick neither picks nor submits.
    expect(key(search, 'Enter').defaultPrevented).toBe(true);
    expect(settings.isOpen).toBe(true);
    key(search, 'ArrowDown');
    expect(key(search, 'Escape').defaultPrevented).toBe(true);
    expect(settings.isOpen).toBe(true);
    expect(zoneSearch(panel())).toBeUndefined();
    expect(focused()).toBe(trigger);
    expect(chart.options.timezone).toBe('local');
    key(trigger, 'Escape');
    expect(settings.isOpen).toBe(false);
  });

  it('closes the timezone list on a press outside it', () => {
    vi.useFakeTimers();
    try {
      const { settings, panel, chart } = setup();
      settings.open('time');
      const trigger = control(panel(), 'timezone');
      dispatch(trigger, 'click');
      vi.advanceTimersByTime(1);
      dispatch(zoneSearch(panel())!, 'pointerdown');
      expect(zoneSearch(panel())).toBeDefined();
      dispatch(action(panel(), 'cancel'), 'pointerdown');
      expect(zoneSearch(panel())).toBeUndefined();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(settings.isOpen).toBe(true);
      expect(chart.options.timezone).toBe('local');
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers a timezone the list does not have when the chart uses it', () => {
    const { settings, panel, chart } = setup();
    chart.applyOptions({ timezone: 'US/Eastern' });
    settings.open('time');
    expect(zoneValue(panel())).toBe('US/Eastern');
    dispatch(control(panel(), 'timezone'), 'click');
    expect(zoneOptions(panel()).find((o) => o.getAttribute('aria-selected') === 'true')!.textContent).toBe('US/Eastern');
    dispatch(action(panel(), 'ok'), 'click');
    expect(settings.isOpen).toBe(false);
    expect(chart.options.timezone).toBe('US/Eastern');
  });

  it('has a view-group toolbar button that opens the dialog', () => {
    const { chart, settings } = setup();
    const item = settingsToolbarItem();
    expect(item).toMatchObject({ type: 'button', group: 'view' });
    expect(settingsOf(chart)).toBe(settings);
    if (item.type !== 'button') throw new Error('expected a button');
    expect(item.labelKey).toBe('toolbarSettings');
    expect(item.isDisabled?.(chart)).toBe(false);
    expect(item.isActive?.(chart)).toBe(false);
    item.onClick(chart, {} as HTMLButtonElement);
    expect(settings.isOpen).toBe(true);
    expect(item.isActive?.(chart)).toBe(true);
    // Pressing again closes it; so does closing the dialog.
    item.onClick(chart, {} as HTMLButtonElement);
    expect(settings.isOpen).toBe(false);
    expect(item.isActive?.(chart)).toBe(false);
    item.onClick(chart, {} as HTMLButtonElement);
    settings.close();
    expect(item.isActive?.(chart)).toBe(false);
    settings.destroy();
    expect(settings.isOpen).toBe(false);
    expect(settingsOf(chart)).toBeUndefined();
    // Without settings (outside a shell), the cog is disabled and clicking does nothing.
    expect(item.isDisabled?.(chart)).toBe(true);
    item.onClick(chart, {} as HTMLButtonElement);
    expect(item.isActive?.(chart)).toBe(false);
  });
});
