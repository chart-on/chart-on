import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { changeText } from '../src/series';
import { TickWeight, formatCrosshairTime, formatTickLabel } from '../src/util/format';
import { createLocalizer, defaultMessages, englishLocalizer } from '../src/util/locale';
import { createPriceFormat } from '../src/util/price-format';
import { UTC } from '../src/util/timezone';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart(options: ConstructorParameters<typeof Chart>[1] = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  return c;
}

const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;
/** 2026-01-05 (a Monday) 14:30 UTC. */
const MONDAY = utc(2026, 1, 5, 14, 30);

describe('createLocalizer numbers', () => {
  it('keeps the built-in English output without options', () => {
    const en = createLocalizer();
    expect(en.locale).toBeUndefined();
    expect(en.number(-1234.5, 2)).toBe('-1234.50');
    // Same as `toFixed`, which the chart used before the option existed.
    expect(en.number(-0.001, 2)).toBe('-0.00');
    expect(changeText(99.999, 100, (v) => v.toFixed(2))).toBe('-0.00 (-0.00%)');
    expect(en.percent(1.5, 2, true)).toBe('+1.50%');
    expect(en.compact(1_250_000)).toBe('1.25M');
    expect(en.hourCycle).toBe('h23');
    expect(en.intlDates).toBe(false);
  });

  it('uses the decimal mark of German and French', () => {
    const de = createLocalizer({ locale: 'de-DE' });
    expect(de.decimalSeparator).toBe(',');
    expect(de.number(1234.5, 2)).toBe('1234,50');
    expect(de.percent(-2.25, 2)).toBe(`${de.minusSign}2,25%`);
    expect(de.compact(1_250_000)).toBe('1,25\u00a0Mio.');
    const fr = createLocalizer({ locale: 'fr-FR' });
    expect(fr.number(0.5, 3)).toBe('0,500');
  });

  it('keeps a dot for English locales', () => {
    expect(createLocalizer({ locale: 'en-US' }).number(-12.5, 1)).toBe('-12.5');
  });

  it('lets decimalSeparator win over the locale', () => {
    expect(createLocalizer({ locale: 'de-DE', decimalSeparator: '.' }).number(1.5, 2)).toBe('1.50');
    expect(createLocalizer({ decimalSeparator: ',' }).number(1.5, 2)).toBe('1,50');
  });

  it('localizes price formats and parses localized text back', () => {
    const de = createLocalizer({ locale: 'de-DE' });
    const model = de.priceFormat(createPriceFormat({ type: 'decimal', tickSize: 0.01 }));
    expect(model.format(101.256)).toBe('101,26');
    expect(model.parse('101,26')).toBeCloseTo(101.26);
    expect(model.parse('1.234,5')).toBeCloseTo(1234.5);
    // A custom format is the app's own text.
    const custom = createPriceFormat({ type: 'custom', format: (v) => `${v.toFixed(1)} pts` });
    expect(de.priceFormat(custom, true).format(1.25)).toBe('1.3 pts');
  });

  it('adds the locale decimal mark to the change text', () => {
    const de = createLocalizer({ locale: 'de-DE' });
    expect(changeText(110, 100, (v) => de.number(v, 2), false, de)).toBe('+10,00 (+10,00%)');
    expect(changeText(110, 100, (v) => v.toFixed(2))).toBe('+10.00 (+10.00%)');
  });

  it('writes prices, volumes and percentages in Arabic-Indic digits', () => {
    const ar = createLocalizer({ locale: 'ar-EG' });
    expect(ar.number(1234.5, 2)).toBe('١٢٣٤٫٥٠');
    expect(ar.number(-7, 0)).toBe(`${ar.minusSign}٧`);
    expect(ar.percent(2.5, 1, true)).toBe('+٢٫٥٪');
    expect(ar.compact(1_250_000)).toBe('١٫٢٥\u00a0مليون');
    expect(changeText(110, 100, (v) => ar.number(v, 2), false, ar)).toBe('+١٠٫٠٠ (+١٠٫٠٠٪)');
    const model = ar.priceFormat(createPriceFormat({ type: 'decimal', tickSize: 0.01 }));
    expect(model.format(101.256)).toBe('١٠١٫٢٦');
    // Typed native or ASCII digits both parse.
    expect(model.parse('١٠١٫٢٦')).toBeCloseTo(101.26);
    expect(model.parse('101.26')).toBeCloseTo(101.26);
  });

  it('follows a numbering system from the locale tag', () => {
    expect(createLocalizer({ locale: 'fa-IR' }).number(1.5, 1)).toBe('۱٫۵');
    expect(createLocalizer({ locale: 'en-US-u-nu-deva' }).number(42.5, 1)).toBe('४२.५');
    // Arabic with Latin digits keeps them.
    expect(createLocalizer({ locale: 'ar-u-nu-latn' }).number(42.5, 1)).toBe('42.5');
  });

  it('writes compact amounts in the words and grouping of the locale', () => {
    const inEn = createLocalizer({ locale: 'en-IN' });
    expect(inEn.compact(123_456)).toBe('1.23L');
    expect(inEn.compact(12_345_678)).toBe('1.23Cr');
    expect(createLocalizer({ locale: 'hi-IN' }).compact(1_500_000)).toBe('15\u00a0लाख');
    expect(createLocalizer({ locale: 'ja-JP' }).compact(123_456)).toBe('12.35万');
    const de = createLocalizer({ locale: 'de-DE' });
    // German has no word for thousands: grouped whole numbers, like the built-in format without a suffix.
    expect(de.compact(123_456.7)).toBe('123.457');
    expect(de.compact(-1_500_000)).toBe(`${de.minusSign}1,5\u00a0Mio.`);
    expect(de.compact(12.345)).toBe('12,35');
    expect(createLocalizer({ locale: 'fa-IR' }).compact(1_230_000)).toBe('۱٫۲۳\u00a0میلیون');
    // English keeps the built-in suffixes, with or without a locale.
    expect(createLocalizer({ locale: 'en-US' }).compact(1_250_000)).toBe('1.25M');
    expect(createLocalizer().compact(999_999)).toBe('1000K');
    expect(createLocalizer({ locale: 'en-US' }).compact(-0)).toBe('0');
  });

  it('lets decimalSeparator win in compact amounts', () => {
    const de = createLocalizer({ locale: 'de-DE', decimalSeparator: '.' });
    expect(de.compact(1_500_000)).toBe('1.5\u00a0Mio.');
    // The group mark would read as a decimal point, so it is left out.
    expect(de.compact(123_456)).toBe('123456');
    expect(createLocalizer({ decimalSeparator: ',' }).compact(1_250_000)).toBe('1,25M');
  });

  it('parses compact amounts back', () => {
    for (const locale of [undefined, 'en-US', 'en-IN', 'hi-IN', 'de-DE', 'ja-JP', 'ar-EG', 'fa-IR', 'fr-FR']) {
      const l = createLocalizer(locale ? { locale } : {});
      for (const value of [12.35, 123, 1234, 12_345, 123_456, 1_230_000, -1_500_000, 1_500_000_000]) {
        const text = l.compact(value);
        expect(l.compact(l.parseCompact(text)), `${locale} ${value}`).toBe(text);
      }
    }
    const de = createLocalizer({ locale: 'de-DE' });
    // The built-in suffixes and typed ASCII still parse; a dot without a group of three reads as a decimal point.
    expect(de.parseCompact('1.5M')).toBe(1_500_000);
    expect(de.parseCompact('2 Mrd.')).toBe(2e9);
    expect(createLocalizer({ locale: 'ar-EG' }).parseCompact('٢ مليون')).toBe(2e6);
    expect(createLocalizer().parseCompact('2.5k')).toBe(2500);
    expect(createLocalizer({ locale: 'de-DE' }).parseCompact('viel')).toBeNaN();
  });

  it('groups prices only with the grouping option', () => {
    const decimal = createPriceFormat({ type: 'decimal', tickSize: 0.01 });
    // Off by default: the same objects and text as before.
    expect(createLocalizer().priceFormat(decimal)).toBe(decimal);
    expect(createLocalizer({ locale: 'de-DE' }).price(1234567.5, 2)).toBe('1234567,50');
    const cases: [string | undefined, number, string][] = [
      [undefined, -1234567.5, '-1,234,567.50'],
      ['de-DE', 1234.5, '1.234,50'],
      ['en-IN', 1234567.5, '12,34,567.50'],
      ['fr-FR', 1234.5, '1\u202f234,50'],
      ['ar-EG', 1234.5, '١٬٢٣٤٫٥٠'],
      // Spanish groups from five digits.
      ['es-ES', 1234.5, '1234,50'],
      ['es-ES', 12345.5, '12.345,50'],
      ['de-DE', 999.5, '999,50'],
    ];
    for (const [locale, value, text] of cases) {
      const l = createLocalizer({ ...(locale ? { locale } : {}), grouping: true });
      expect(l.price(value, 2), locale).toBe(text);
      const model = l.priceFormat(decimal);
      expect(model.format(value), locale).toBe(text);
      expect(model.parse(text), locale).toBeCloseTo(value);
    }
    expect(createLocalizer({ locale: 'de-DE', grouping: true }).number(1234.5, 2)).toBe('1234,50');
  });

  it('parses typed grouped prices back', () => {
    const model = (locale: string) => createLocalizer({ locale, grouping: true }).priceFormat(createPriceFormat({ type: 'decimal' }));
    const de = model('de-DE');
    expect(de.parse('1.234')).toBe(1234);
    expect(de.parse('1.234.567,5')).toBeCloseTo(1234567.5);
    // A dot without a group of three still reads as a decimal point.
    expect(de.parse('1.5')).toBe(1.5);
    expect(de.parse('1234,5')).toBeCloseTo(1234.5);
    expect(model('en-IN').parse('12,34,567')).toBe(1234567);
    // A typed space stands for the French narrow no-break space.
    expect(model('fr-FR').parse('1 234,5')).toBeCloseTo(1234.5);
    expect(model('ar-EG').parse('١٬٢٣٤')).toBe(1234);
  });

  it('leaves unit, custom and colliding formats ungrouped', () => {
    const de = createLocalizer({ locale: 'de-DE', grouping: true });
    expect(de.priceFormat(createPriceFormat({ type: 'decimal', precision: 2, unit: 'EUR' })).format(1234.5)).toBe('1234,50');
    const custom = createPriceFormat({ type: 'custom', format: (v) => v.toFixed(1) });
    expect(de.priceFormat(custom, true).format(1234.5)).toBe('1234.5');
    // A group mark that reads as the decimal separator is left out.
    expect(createLocalizer({ decimalSeparator: ',', grouping: true }).price(1234.5, 2)).toBe('1234,50');
    // Fractions group their whole units; the fraction and folded zeros stay as they are.
    expect(de.priceFormat(createPriceFormat({ type: 'fraction', denominator: 32 })).format(1234.5)).toBe("1.234'16");
    expect(de.priceFormat(createPriceFormat({ type: 'decimal', precision: 8, zeroFold: {} })).format(0.00000412)).toBe('0,0₅412');
  });

  it('rejects an invalid locale tag or separator', () => {
    expect(() => createLocalizer({ locale: 'not a locale!' })).toThrow(RangeError);
    expect(() => createLocalizer({ decimalSeparator: '' })).toThrow(RangeError);
    expect(() => createLocalizer({ dateFormat: { month: 'bogus' as 'long' } })).toThrow(RangeError);
  });
});

describe('createLocalizer dates', () => {
  it('leaves the built-in axis and crosshair labels unchanged', () => {
    expect(formatTickLabel(utc(2026, 1, 1), TickWeight.Month, UTC, null, englishLocalizer)).toBe('Jan');
    expect(formatTickLabel(MONDAY, TickWeight.Hour, UTC, null, englishLocalizer)).toBe('14:30');
    expect(formatCrosshairTime(MONDAY, 3600, UTC, englishLocalizer)).toBe('2026-01-05 14:30');
  });

  it('writes the built-in crosshair date as ISO 8601, with seconds when asked', () => {
    expect(formatCrosshairTime(MONDAY, 86400, UTC)).toBe('2026-01-05');
    expect(formatCrosshairTime(MONDAY + 5, 60, UTC, undefined, { seconds: true })).toBe('2026-01-05 14:30:05');
    expect(formatCrosshairTime(MONDAY, 60, UTC, createLocalizer(), { time: false })).toBe('2026-01-05');
    expect(englishLocalizer.dateTime(new Date(Date.UTC(2026, 9, 16, 14, 30)), false)).toBe('2026-10-16 14:30');
  });

  it('names the month and writes the whole year through Intl', () => {
    expect(formatCrosshairTime(MONDAY, 3600, UTC, createLocalizer({ locale: 'en-US', hourCycle: 'h23' }))).toBe('Jan 5, 2026 14:30');
    const fr = createLocalizer({ locale: 'fr-FR' });
    expect(formatTickLabel(utc(2026, 1, 1), TickWeight.Month, UTC, null, fr)).toBe('janv.');
    expect(formatCrosshairTime(MONDAY, 86400, UTC, fr)).toBe('5 janv. 2026');
    const de = createLocalizer({ locale: 'de-DE' });
    expect(formatTickLabel(utc(2026, 3, 1), TickWeight.Month, UTC, null, de)).toMatch(/^Mär/);
    expect(formatCrosshairTime(MONDAY, 86400, UTC, de)).toBe('5. Jan. 2026');
    expect(formatCrosshairTime(MONDAY, 86400, UTC, createLocalizer({ locale: 'ja-JP' }))).toBe('2026年1月5日');
  });

  it('writes axis and crosshair dates in native digits', () => {
    const ar = createLocalizer({ locale: 'ar-EG' });
    expect(formatTickLabel(utc(2026, 1, 1), TickWeight.Year, UTC, null, ar)).toBe('٢٠٢٦');
    expect(formatTickLabel(utc(2026, 1, 15), TickWeight.Day, UTC, null, ar)).toBe('١٥');
    expect(formatTickLabel(MONDAY, TickWeight.Hour, UTC, null, ar)).toMatch(/[٠-٩]/);
    expect(formatTickLabel(MONDAY, TickWeight.Hour, UTC, null, ar)).not.toMatch(/[0-9]/);
    expect(formatCrosshairTime(MONDAY, 86400, UTC, ar)).not.toMatch(/[0-9]/);
  });

  it('follows the hour cycle of the locale, or the option', () => {
    const us = createLocalizer({ locale: 'en-US' });
    expect(us.hourCycle).toBe('h12');
    expect(formatTickLabel(MONDAY, TickWeight.Hour, UTC, null, us)).toMatch(/^2:30\sPM$/);
    const de = createLocalizer({ locale: 'de-DE' });
    expect(formatTickLabel(MONDAY, TickWeight.Hour, UTC, null, de)).toBe('14:30');
    const us24 = createLocalizer({ locale: 'en-US', hourCycle: 'h23' });
    expect(formatTickLabel(MONDAY, TickWeight.Hour, UTC, null, us24)).toBe('14:30');
    // A 12-hour clock without a locale stays English.
    expect(formatTickLabel(MONDAY, TickWeight.Hour, UTC, null, createLocalizer({ hourCycle: 'h12' }))).toMatch(/^2:30\sPM$/);
  });

  it('formats the crosshair date with dateFormat fields', () => {
    const de = createLocalizer({ locale: 'de-DE', dateFormat: { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric' } });
    expect(formatCrosshairTime(MONDAY, 86400, UTC, de)).toBe('5. Januar 2026');
    expect(formatCrosshairTime(MONDAY, 3600, UTC, de)).toBe('5. Januar 2026 14:30');
  });
});

describe('messages', () => {
  it('falls back from translate to messages to the defaults', () => {
    const loc = createLocalizer({
      messages: { statusLoading: 'Laden…', legendShowMore: '{count} weitere' },
      translate: (key) => (key === 'statusNoData' ? 'Keine Daten' : undefined),
    });
    expect(loc.text('statusNoData')).toBe('Keine Daten');
    expect(loc.text('statusLoading')).toBe('Laden…');
    expect(loc.text('legendShowMore', { count: 3 })).toBe('3 weitere');
    expect(loc.text('statusError')).toBe(defaultMessages.statusError);
    expect(loc.text('appKey', undefined, 'App text')).toBe('App text');
    expect(loc.text('unknownKey')).toBe('unknownKey');
  });

  it('passes the parameters to translate and keeps unknown placeholders', () => {
    const seen: unknown[] = [];
    const loc = createLocalizer({ translate: (key, params) => (seen.push([key, params]), undefined) });
    expect(loc.text('marketDelayed', { minutes: 15 })).toBe('15 min delayed');
    expect(seen).toEqual([['marketDelayed', { minutes: 15 }]]);
    expect(loc.text('x', { a: 1 }, '{a} and {b}')).toBe('1 and {b}');
  });
});

describe('chart localization option', () => {
  it('defaults to the built-in English formats', () => {
    const c = chart();
    expect(c.options.localization).toEqual({});
    expect(c.localization.locale).toBeUndefined();
    expect(c.formatPrice(5, 1234.5)).toBe('1234.50');
  });

  it('formats numbers and dates in the locale and reports the change', () => {
    const c = chart();
    const changes: unknown[] = [];
    c.on('localization:change', (e) => changes.push(e));
    c.applyOptions({ localization: { locale: 'de-DE' } });
    expect(changes).toEqual([{ locale: 'de-DE' }]);
    expect(c.localization.locale).toBe('de-DE');
    expect(c.formatPrice(5, 1234.5)).toBe('1234,50');
    expect(c.formatAxis(0, 12345)).toBe('12.345');
    // Fields merge; a new messages object replaces the old one.
    c.applyOptions({ localization: { messages: { statusLoading: 'Laden…' } } });
    expect(c.options.localization.locale).toBe('de-DE');
    expect(c.localization.text('statusLoading')).toBe('Laden…');
    c.applyOptions({ localization: { messages: { statusNoData: 'Keine Daten' } } });
    expect(c.localization.text('statusNoData')).toBe('Keine Daten');
    expect(c.localization.text('statusLoading')).toBe('Loading…');
    c.applyOptions({ localization: { locale: undefined } });
    expect(c.formatPrice(5, 1.5)).toBe('1.50');
  });

  it('formats series prices in the locale', () => {
    const c = chart({ localization: { locale: 'de-DE' } });
    const line = c.addLine({ priceFormat: { type: 'decimal', tickSize: 0.01 } });
    expect(line.formatValue(12.345)).toBe('12,35');
    c.applyOptions({ localization: { locale: 'en-GB' } });
    expect(line.formatValue(12.345)).toBe('12.35');
  });

  it('formats volume prices in the compact words of the locale', () => {
    const c = chart({ localization: { locale: 'de-DE' } });
    const volume = c.addHistogram({ priceFormat: { type: 'volume' } });
    expect(volume.formatValue(2_500_000)).toBe('2,5\u00a0Mio.');
    expect(volume.priceFormat!.parse('2,5 Mio.')).toBe(2_500_000);
    c.applyOptions({ localization: { locale: 'en-IN' } });
    expect(volume.formatValue(2_500_000)).toBe('25L');
  });

  it('formats chart numbers in an RTL locale with native digits', () => {
    const c = chart({ localization: { locale: 'ar-EG' } });
    expect(c.formatPrice(5, 1234.5)).toBe('١٢٣٤٫٥٠');
    expect(c.formatAxis(0, 12345)).toBe('١٢٫٣٥\u00a0ألف');
    const line = c.addLine({ priceFormat: { type: 'decimal', tickSize: 0.01 } });
    expect(line.formatValue(12.345)).toBe('١٢٫٣٥');
  });

  it('groups prices on the axis, the crosshair and the legend with the grouping option', () => {
    const c = chart({ localization: { locale: 'de-DE' } });
    const candles = c.addCandles();
    candles.setData([{ time: 60, open: 1200, high: 1300, low: 1100, close: 1234.5 }]);
    expect(c.formatPrice(0, 1234.5)).toBe('1234,50');
    c.applyOptions({ localization: { grouping: true } });
    expect(c.formatPrice(0, 1234.5)).toBe('1.234,50');
    expect(c.formatAxis(0, 1234.5)).toBe('1.234,50');
    expect(candles.formatValue(1234.5)).toBe('1.234,50');
    expect(c.formatPrice(5, 1234.5)).toBe('1.234,50');
    expect(c.paneFormat(0)!.parse('1.234,5')).toBeCloseTo(1234.5);
  });

  it('throws on an invalid locale without changing anything', () => {
    const c = chart({ localization: { locale: 'fr-FR' } });
    expect(() => c.applyOptions({ localization: { locale: 'not a locale!' } })).toThrow(RangeError);
    expect(c.localization.locale).toBe('fr-FR');
    expect(c.options.localization.locale).toBe('fr-FR');
    expect(() => c.applyOptions({ localization: { dateFormat: { month: 'bogus' as 'long' } } })).toThrow(RangeError);
    expect(c.options.localization.dateFormat).toBeUndefined();
  });

  it('describes the chart with localized text', () => {
    const c = chart({ localization: { messages: { describeEmpty: 'Keine Daten sichtbar.', chartLabel: 'Diagramm' } } });
    expect(c.describe()).toBe('Diagramm. Keine Daten sichtbar.');
  });

  it('names the legend values in the chart language', () => {
    const c = chart();
    const candles = c.addCandles();
    candles.setData([{ time: 60, open: 1, high: 3, low: 0.5, close: 2 }]);
    const labels = () => candles.legend(0)!.parts.slice(0, 4).map((part) => part.label);
    expect(labels()).toEqual(['O', 'H', 'L', 'C']);
    c.applyOptions({ localization: { messages: { legendOpen: 'Ö', legendHigh: 'Hoch', legendLow: 'Tief', legendClose: 'S' } } });
    expect(labels()).toEqual(['Ö', 'Hoch', 'Tief', 'S']);
  });
});
