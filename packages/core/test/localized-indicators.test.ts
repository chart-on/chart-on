import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import { timezoneChoices } from '../src/chart-settings';
import { indicatorTitle } from '../src/indicators/indicator';
import type { IndicatorDef } from '../src/indicators/types';
import { createLocalizer, englishLocalizer } from '../src/util/locale';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  return c;
}

const volume: IndicatorDef = {
  id: 'test/volume',
  name: 'Volume',
  placement: 'pane',
  inputs: [{ id: 'length', type: 'number', default: 20 }],
  plots: [{ id: 'v', type: 'line' }],
  compute: (src) => ({ v: Float64Array.from(src.close) }),
};

const bars = Array.from({ length: 5 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0.5, close: 1.5 }));

describe('indicator legend titles', () => {
  it('keeps the definition name in English and without a message', () => {
    expect(indicatorTitle(volume, { length: 20 })).toBe('Volume 20');
    expect(indicatorTitle(volume, { length: 20 }, englishLocalizer)).toBe('Volume 20');
    expect(indicatorTitle(volume, { length: 20 }, createLocalizer({ messages: { 'indicator.other': 'Andere' } }))).toBe('Volume 20');
  });

  it('names the indicator through indicator.<id>, and leaves a title function alone', () => {
    const german = createLocalizer({ locale: 'de-DE', messages: { 'indicator.test/volume': 'Volumen' } });
    expect(indicatorTitle(volume, { length: 20 }, german)).toBe('Volumen 20');
    expect(indicatorTitle({ ...volume, title: () => 'Own' }, { length: 20 }, german)).toBe('Own');
  });

  it('follows a language change on the chart', () => {
    const c = chart();
    c.addCandles().setData(bars);
    const indicator = c.indicators.add(volume);
    expect(indicator.series?.options.title).toBe('Volume 20');
    c.applyOptions({ localization: { messages: { 'indicator.test/volume': 'Volumen' } } });
    expect(indicator.series?.options.title).toBe('Volumen 20');
    indicator.applyInputs({ length: 9 });
    expect(indicator.series?.options.title).toBe('Volumen 9');
  });

  it('keeps a title the app set when the language changes', () => {
    const c = chart();
    c.addCandles().setData(bars);
    const indicator = c.indicators.add(volume);
    indicator.series!.applyOptions({ title: 'My volume' });
    c.applyOptions({ localization: { messages: { 'indicator.test/volume': 'Volumen' } } });
    expect(indicator.series?.options.title).toBe('My volume');
  });

  it('rejects dots in indicator and input ids, which message keys join', () => {
    const c = chart();
    expect(() => c.indicators.register({ ...volume, id: 'a.b' })).toThrow(/cannot contain/);
    expect(() => c.indicators.register({ ...volume, id: 'test/dots', inputs: [{ id: 'len.gth', type: 'number', default: 1 }] })).toThrow(
      /cannot contain/,
    );
  });
});

describe('local timezone choice', () => {
  it('carries its message key and values, with the English label as before', () => {
    const local = timezoneChoices(Date.UTC(2026, 0, 15))[0]!;
    expect(local.labelKey).toBe('timezoneLocal');
    expect(local.label).toBe(`Local (${local.labelParams!.zone}, ${local.labelParams!.offset})`);
    const german = createLocalizer({ messages: { timezoneLocal: 'Lokal ({zone}, {offset})' } });
    expect(german.text(local.labelKey!, local.labelParams)).toBe(`Lokal (${local.labelParams!.zone}, ${local.labelParams!.offset})`);
  });
});
