import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { applyChartSettings, chartSettingsSchema, readChartSetting, timezoneChoices, type ChartSettingField } from '../src/chart-settings';
import { darkTheme } from '../src/theme';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart(withSeries = true) {
  const c = new Chart(fakeContainer());
  charts.push(c);
  if (withSeries) c.addCandles({ title: 'ABC' }).setData([{ time: 0, open: 1, high: 2, low: 0.5, close: 1.5 }]);
  return c;
}

const fields = chartSettingsSchema.flatMap((s) => s.groups.flatMap((g) => g.fields));

/** A valid value for `field` other than `current`. */
function another(field: ChartSettingField, current: unknown): unknown {
  switch (field.kind) {
    case 'boolean':
      return !current;
    case 'select':
      return field.choices!.find((c) => c.value !== current)!.value;
    case 'color':
      return current === '#123456' ? '#654321' : '#123456';
    default:
      return current === field.min ? field.max : field.min;
  }
}

describe('chart settings schema', () => {
  it('has unique section, group and field ids', () => {
    const unique = (ids: string[]) => expect(new Set(ids).size).toBe(ids.length);
    unique(chartSettingsSchema.map((s) => s.id));
    unique(chartSettingsSchema.flatMap((s) => s.groups.map((g) => g.id)));
    unique(fields.map((f) => f.path));
  });

  it('reads a value of the right kind for every field', () => {
    const c = chart();
    for (const field of fields) {
      const value = readChartSetting(c, field);
      const expected = field.kind === 'boolean' ? 'boolean' : field.kind === 'color' ? 'string' : field.kind === 'select' ? typeof field.choices![0]!.value : 'number';
      expect(typeof value, field.path).toBe(expected);
      if (field.kind === 'select') expect(field.choices!.map((ch) => ch.value), field.path).toContain(value);
    }
  });

  it('round-trips every field through applyOptions', () => {
    const c = chart();
    for (const field of fields) {
      const next = another(field, readChartSetting(c, field));
      applyChartSettings(c, { [field.path]: next });
      expect(readChartSetting(c, field), field.path).toEqual(next);
    }
  });

  it('applies many paths in one call, merging nested objects', () => {
    const c = chart();
    applyChartSettings(c, {
      'crosshair.vertical.visible': false,
      'crosshair.horizontal.visible': false,
      'grid.horizontal.lineStyle': 'dotted',
      'series.wicks': false,
    });
    expect(c.options.crosshair.vertical.visible).toBe(false);
    expect(c.options.crosshair.horizontal.visible).toBe(false);
    expect(c.options.crosshair.vertical.width).toBe(1);
    expect(c.options.grid.horizontal).toEqual({ visible: true, lineStyle: 'dotted' });
    expect(c.main!.options.wicks).toBe(false);
  });

  it('reads and writes the main pane price scale through priceScale paths', () => {
    const c = chart();
    expect(readChartSetting(c, 'priceScale.lockPriceToBarRatio')).toBe(false);
    applyChartSettings(c, { 'priceScale.lockPriceToBarRatio': true, 'series.wicks': false });
    expect(c.getPriceScaleOptions(0)!.lockPriceToBarRatio).toBe(true);
    expect(readChartSetting(c, 'priceScale.lockPriceToBarRatio')).toBe(true);
    expect(c.main!.options.wicks).toBe(false);
  });

  it('never writes through a prototype', () => {
    const c = chart();
    applyChartSettings(c, { '__proto__.polluted': true, 'crosshair.constructor.prototype.polluted': true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('stands in the unset value for options that are not set', () => {
    const c = chart();
    const wick = fields.find((f) => f.path === 'theme.upWick')!;
    expect(readChartSetting(c, 'theme.upWick')).toBeUndefined();
    expect(readChartSetting(c, wick)).toBe(darkTheme.up);
    // No gradient: the bottom color reads as the top one, a solid background.
    expect(readChartSetting(c, fields.find((f) => f.path === 'theme.backgroundBottom')!)).toBe(darkTheme.background);
    expect(readChartSetting(c, fields.find((f) => f.path === 'series.wicks')!)).toBe(true);
  });

  it('has no series values without a main series', () => {
    const c = chart(false);
    expect(readChartSetting(c, fields.find((f) => f.path === 'series.wicks')!)).toBeUndefined();
    expect(() => applyChartSettings(c, { 'series.wicks': false })).not.toThrow();
  });

  it('orders the sections by what the user adjusts, from the data to the chrome', () => {
    expect(chartSettingsSchema.map((s) => s.id)).toEqual(['series', 'readout', 'axes', 'time', 'background', 'markers']);
    const paths = (id: string) => chartSettingsSchema.find((s) => s.id === id)!.groups.flatMap((g) => g.fields.map((f) => f.path));
    // Both show values under the pointer.
    expect(paths('readout')).toEqual(expect.arrayContaining(['features.legend', 'crosshair.mode', 'crosshair.labels.price']));
    expect(paths('time')).toEqual(['timezone', 'timeAxis.showSeconds', 'sessionBreaks', 'sessionShading', 'timeMarks', 'theme.timeMark']);
    expect(paths('markers')).toEqual(['adjustmentMarkers', 'marks']);
    const c = chart();
    expect(readChartSetting(c, 'theme.timeMark')).toBeUndefined();
    expect(readChartSetting(c, fields.find((f) => f.path === 'theme.timeMark')!)).toBe(darkTheme.line);
  });

  it('sets the timezone from the time section', () => {
    const c = chart();
    const field = chartSettingsSchema.find((s) => s.id === 'time')!.groups[0]!.fields[0]!;
    expect(field.path).toBe('timezone');
    expect(readChartSetting(c, field)).toBe('local');
    const changes: string[] = [];
    c.on('timezone:change', ({ timezone }) => changes.push(timezone));
    applyChartSettings(c, { timezone: 'Asia/Tokyo' });
    expect(readChartSetting(c, field)).toBe('Asia/Tokyo');
    expect(c.zone.name).toBe('Asia/Tokyo');
    expect(changes).toEqual(['Asia/Tokyo']);
    expect(field.choices!.map((ch) => ch.value)).toContain('Asia/Tokyo');
  });
});

describe('timezoneChoices', () => {
  const JAN = Date.UTC(2026, 0, 15);
  const JUL = Date.UTC(2026, 6, 15);
  const label = (value: string, now = JAN) => timezoneChoices(now).find((c) => c.value === value)?.label;

  it('starts with local and UTC, then lists each zone once', () => {
    const choices = timezoneChoices(JAN);
    expect(choices[0]!.value).toBe('local');
    expect(choices[0]!.label).toMatch(/^Local \(.+, UTC([+-]\d+(:\d\d)?)?\)$/);
    expect(choices[1]).toEqual({ value: 'UTC', label: 'UTC' });
    const values = choices.slice(1).map((c) => c.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values.length).toBeGreaterThan(10);
  });

  it('labels each zone with its offset at the given time', () => {
    expect(label('Asia/Jakarta')).toBe('Asia/Jakarta (UTC+7)');
    expect(label('Australia/Adelaide', JUL)).toBe('Australia/Adelaide (UTC+9:30)');
    expect(label('America/New_York', JAN)).toBe('America/New York (UTC-5)');
    expect(label('America/New_York', JUL)).toBe('America/New York (UTC-4)');
    expect(label('America/St_Johns', JAN)).toBe('America/St Johns (UTC-3:30)');
  });
});
