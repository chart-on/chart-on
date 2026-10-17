import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { drawingTools, localization } from '../src/builtins';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import { infoLineLabel } from '../src/drawing/line-tools';
import { barsText, dateRangeLabel, formatDuration, positionLabels, priceRangeLabel } from '../src/drawing/measure-tools';
import { measure, trendLine } from '../src/drawing/tools';
import { createLocalizer, englishLocalizer, pluralText } from '../src/util/locale';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  return c;
}

const format = (price: number) => price.toFixed(2);

/** Part of a German catalogue for the drawing readouts. */
const german = createLocalizer({
  locale: 'de-DE',
  messages: {
    measureBar: '{count} Balken',
    measureBars: '{count} Balken',
    measureDays: '{n} T.',
    measureHours: '{n} Std.',
    positionTarget: 'Ziel {price}',
    positionStop: 'Stopp {price}',
    positionLongEntry: 'Long-Einstieg {price}',
    positionRiskReward: 'CRV {ratio}',
  },
});

describe('drawing readouts', () => {
  it('keep the built-in English text without a localizer', () => {
    expect(formatDuration(93600)).toBe('1d 2h');
    expect(formatDuration(0)).toBe('0s');
    expect(dateRangeLabel(24, 86400)).toBe('24 bars · 1d');
    expect(dateRangeLabel(-1, -60)).toBe('-1 bar · -1m');
    expect(priceRangeLabel(100, 110, format)).toBe('+10.00 (+10.00%)');
    expect(positionLabels('long', 100, 110, 95, format)).toEqual({
      target: 'Target 110.00 · +10.00 (+10.00%)',
      stop: 'Stop 95.00 · -5.00 (-5.00%)',
      entry: 'Long entry 100.00 · R:R 2.00',
    });
    expect(infoLineLabel({ change: 1.25, percent: 2.5, bars: 12, angle: 34.5 }, format)).toBe('+1.25 (+2.50%) · 12 bars · 34.5°');
  });

  it('follow the messages and number format of a localizer', () => {
    expect(formatDuration(93600, german)).toBe('1 T. 2 Std.');
    expect(dateRangeLabel(24, 86400, german)).toBe('24 Balken · 1 T.');
    expect(priceRangeLabel(100, 110, format, german)).toBe('+10.00 (+10,00%)');
    expect(positionLabels('long', 100, 110, 95, format, german)).toEqual({
      target: 'Ziel 110.00 · +10.00 (+10,00%)',
      stop: 'Stopp 95.00 · -5.00 (-5,00%)',
      entry: 'Long-Einstieg 100.00 · CRV 2,00',
    });
    // Keys left out keep the English text.
    expect(positionLabels('short', 100, 90, 105, format, german).entry).toBe('Short entry 100.00 · CRV 2,00');
    expect(infoLineLabel({ change: -1.25, percent: -2.5, bars: 1, angle: -34.5 }, format, german)).toBe('-1.25 (-2,50%) · 1 Balken · -34,5°');
  });
});

describe('readout signs and plurals', () => {
  it('sign figures written in native digits by their value', () => {
    const arabic = createLocalizer({ locale: 'ar-EG' });
    const format = (price: number) => arabic.localize(price.toFixed(2));
    const up = priceRangeLabel(100, 110, format, arabic);
    expect(up.startsWith('+')).toBe(true);
    expect(up).toContain(arabic.percent(10, 2));
    expect(up).not.toMatch(/[0-9]/);
    const down = priceRangeLabel(110, 100, format, arabic);
    expect(down.startsWith(arabic.minusSign)).toBe(true);
    // A change that shows as zero has no sign.
    expect(priceRangeLabel(100, 100.0001, format, arabic).startsWith('+')).toBe(false);
    expect(positionLabels('long', 100, 110, 95, format, arabic).stop).toContain(`${arabic.minusSign}${format(5)}`);
  });

  it('pick the plural form of the locale', () => {
    const plural = (locale: string) =>
      createLocalizer({
        locale,
        messages: {
          'measureBars.one': 'one {count}',
          'measureBars.few': 'few {count}',
          'measureBars.many': 'many {count}',
          'measureBars.other': 'other {count}',
        },
      });
    expect(barsText(0, plural('fr-FR'))).toBe('one 0');
    expect(barsText(2, plural('fr-FR'))).toBe('other 2');
    expect(barsText(2, plural('ru-RU'))).toBe('few 2');
    expect(barsText(5, plural('ru-RU'))).toBe('many 5');
    expect(barsText(-21, plural('ru-RU'))).toBe('one -21');
    expect(barsText(1, plural('en-US'))).toBe('one 1');
    // Without plural forms: the singular and plural keys.
    expect(barsText(1)).toBe('1 bar');
    expect(barsText(2)).toBe('2 bars');
    // `.other` when the selected form is missing.
    const onlyOther = createLocalizer({ locale: 'ru-RU', messages: { 'measureBars.other': '{count} бара' } });
    expect(barsText(5, onlyOther)).toBe('5 бара');
    expect(pluralText(englishLocalizer, 'app.files', 3, { n: 3 }, '{n} files')).toBe('3 files');
  });
});

describe('drawing tool names', () => {
  it('use the tool label, or the tool.<type> message in the chart language', () => {
    const c = chart({ plugins: [drawingTools([trendLine, measure]), localization()] });
    const action = () => c.actions.get('draw-trendline')?.label;
    expect(c.drawings.toolLabel('trendline')).toBe('Trend line');
    expect(action()).toBe('Draw: Trend line');
    expect(c.drawings.toolLabel('unknown-tool')).toBe('unknown-tool');

    c.applyOptions({ localization: { messages: { 'tool.trendline': 'Trendlinie', actionDrawTool: 'Zeichnen: {tool}' } } });
    expect(c.drawings.toolLabel('trendline')).toBe('Trendlinie');
    expect(action()).toBe('Zeichnen: Trendlinie');
    // Tools without a translation keep their own label.
    expect(c.drawings.toolLabel('measure')).toBe('Measure');

    c.applyOptions({ localization: { messages: {} } });
    expect(c.drawings.toolLabel('trendline')).toBe('Trend line');
  });

  it('keep a label the app gives a built-in tool', () => {
    const c = chart({ plugins: [drawingTools([{ ...trendLine, label: 'Trend' }])] });
    c.applyOptions({ localization: { messages: { 'tool.trendline': 'Trendlinie' } } });
    expect(c.drawings.toolLabel('trendline')).toBe('Trend');
  });

  it('take a translate function too', () => {
    const c = chart();
    c.drawings.register({ ...trendLine, type: 'my-line', label: 'My line' });
    c.applyOptions({ localization: { translate: (key) => (key === 'tool.my-line' ? 'Meine Linie' : undefined) } });
    expect(c.drawings.toolLabel('my-line')).toBe('Meine Linie');
  });
});
