import { afterEach, describe, expect, it } from 'vitest';
import { createChart, englishLocalizer, localization, type Chart } from '@charton/core';
import { fakeContainer } from '../../core/test/fake-dom';
import { deDE } from '../src/de-DE';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

describe('a locale pack', () => {
  it('applies through the localization() plugin, and not without it', () => {
    const plain = createChart(fakeContainer(), { plugins: [], localization: deDE });
    charts.push(plain);
    expect(plain.localization).toBe(englishLocalizer);

    const chart = createChart(fakeContainer(), { plugins: [localization()], localization: deDE });
    charts.push(chart);
    expect(chart.installedPlugins).toEqual(['@charton/core/localization']);
    expect(chart.localization.locale).toBe('de-DE');
    expect(chart.localization.price(1234.5, 2)).toBe('1234,50');
    expect(chart.localization.text('scrollToLatest')).toBe(deDE.messages!.scrollToLatest);
  });
});
