import { describe, expect, it } from 'vitest';
import { createLocalizer, englishLocalizer } from '../src/util/locale';
import { createPriceFormat, type PriceFormat } from '../src/util/price-format';

// `englishLocalizer` is built on its own so a chart without the `localization()` plugin leaves the
// `Intl` code of `createLocalizer` out. It must write exactly what `createLocalizer()` writes.

const full = createLocalizer();
const lean = englishLocalizer;
const same = (a: number, b: number) => Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b));

const numbers = [0, -0, 1, -1, 0.5, 1.005, 12.345, -1234.5678, 999.995, 1e3, 12345, 1e6, -2.5e9, 1.23e12, 7e15, Number.NaN, Infinity, -Infinity, 0.0001];
const typed = ['1.25M', '12,345', '12,345.6', ' 1.5K ', '1,2,345', '-3B', '7T', 'abc', '', '1e3', '‎1.2M', '12,3456', '1,234', '5k', '1.234,5'];
const walls = [0, 1e12, 1.7e12, 1792160000000, -86400000].map((ms) => new Date(ms));

describe('englishLocalizer', () => {
  it('has the settings of createLocalizer() without options', () => {
    for (const key of ['locale', 'decimalSeparator', 'minusSign', 'hourCycle', 'intlDates'] as const) expect(lean[key], key).toEqual(full[key]);
  });

  it('writes numbers, prices, percentages and compact amounts the same', () => {
    for (const value of numbers) {
      for (const decimals of [0, 1, 2, 4]) {
        expect(lean.number(value, decimals)).toBe(full.number(value, decimals));
        expect(lean.price(value, decimals)).toBe(full.price(value, decimals));
        expect(lean.percent(value, decimals)).toBe(full.percent(value, decimals));
        expect(lean.percent(value, decimals, true)).toBe(full.percent(value, decimals, true));
      }
      expect(lean.compact(value), String(value)).toBe(full.compact(value));
    }
  });

  it('parses typed and compact amounts the same', () => {
    for (const text of [...typed, ...numbers.map((value) => full.compact(value))]) expect(same(lean.parseCompact(text), full.parseCompact(text)), text).toBe(true);
    for (const text of ['-1.5', '1.5', 'x']) {
      expect(lean.localize(text)).toBe(full.localize(text));
      expect(lean.delocalize(text)).toBe(full.delocalize(text));
    }
  });

  it('keeps price formats and texts the same', () => {
    const model = createPriceFormat({ type: 'decimal', tickSize: 0.01, precision: 2 } as PriceFormat);
    expect(lean.priceFormat(model)).toBe(full.priceFormat(model));
    expect(lean.priceFormat(model, true)).toBe(full.priceFormat(model, true));
    for (const key of ['chartLabel', 'chartLabelSymbol', 'nope', 'statusLoading']) {
      expect(lean.text(key)).toBe(full.text(key));
      expect(lean.text(key, { symbol: 'X' })).toBe(full.text(key, { symbol: 'X' }));
      expect(lean.text(key, {}, 'Fallback {a}')).toBe(full.text(key, {}, 'Fallback {a}'));
    }
  });

  it('writes dates and times the same', () => {
    for (const wall of walls) {
      expect(lean.monthShort(wall)).toBe(full.monthShort(wall));
      expect(lean.time(wall)).toBe(full.time(wall));
      expect(lean.time(wall, true)).toBe(full.time(wall, true));
      expect(lean.dateTime(wall, true)).toBe(full.dateTime(wall, true));
      expect(lean.dateTime(wall, false)).toBe(full.dateTime(wall, false));
      expect(lean.dateTime(wall, false, true)).toBe(full.dateTime(wall, false, true));
      expect(lean.date(wall, { year: 'numeric', month: 'long' })).toBe(full.date(wall, { year: 'numeric', month: 'long' }));
    }
  });
});
