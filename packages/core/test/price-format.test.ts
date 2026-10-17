import { describe, expect, it } from 'vitest';
import { createPriceFormat, symbolPriceFormat } from '../src/util/price-format';

describe('decimal format', () => {
  it('uses fixed decimals', () => {
    const f = createPriceFormat({ type: 'decimal', precision: 3 });
    expect(f.format(1.23456)).toBe('1.235');
    expect(f.format(-2)).toBe('-2.000');
    expect(f.parse('1.235')).toBe(1.235);
    expect(f.tickSize(5)).toBe(0);
    expect(f.round(1.23456)).toBe(1.23456);
  });

  it('defaults to two decimals', () => {
    expect(createPriceFormat({ type: 'decimal' }).format(3)).toBe('3.00');
  });

  it('rounds to the tick size and derives the decimals from it', () => {
    const f = createPriceFormat({ type: 'decimal', tickSize: 0.25 });
    expect(f.format(100.1)).toBe('100.00');
    expect(f.format(100.13)).toBe('100.25');
    expect(f.round(100.4)).toBe(100.5);
    expect(f.tickSize(1)).toBe(0.25);
    expect(createPriceFormat({ type: 'decimal', tickSize: 0.0001 }).format(1.23456)).toBe('1.2346');
    expect(createPriceFormat({ type: 'decimal', tickSize: 5 }).format(1234)).toBe('1235');
  });

  it('rounds without float noise', () => {
    const f = createPriceFormat({ type: 'decimal', tickSize: 0.1 });
    expect(f.round(0.3)).toBe(0.3);
    expect(f.round(0.29999)).toBe(0.3);
  });

  it('lets precision override the tick decimals', () => {
    expect(createPriceFormat({ type: 'decimal', tickSize: 0.5, precision: 2 }).format(3.4)).toBe('3.50');
  });

  it('changes tick size by price band', () => {
    const f = createPriceFormat({
      type: 'decimal',
      tickSize: [
        { from: 0, tickSize: 0.0001 },
        { from: 1, tickSize: 0.01 },
        { from: 1000, tickSize: 1 },
      ],
    });
    expect(f.format(0.123456)).toBe('0.1235');
    expect(f.format(12.3456)).toBe('12.35');
    expect(f.format(1234.56)).toBe('1235');
    expect(f.format(-12.3456)).toBe('-12.35');
    expect(f.tickSize(0.5)).toBe(0.0001);
    expect(f.tickSize(999)).toBe(0.01);
    expect(f.round(1234.56)).toBe(1235);
    expect(f.parse('1235')).toBe(1235);
  });

  it('applies the first band below its `from`', () => {
    const f = createPriceFormat({ type: 'decimal', tickSize: [{ from: 1, tickSize: 0.01 }] });
    expect(f.format(0.5)).toBe('0.50');
    expect(f.tickSize(0.5)).toBe(0.01);
  });

  it('rounds negative ties like positive ones', () => {
    const f = createPriceFormat({ type: 'decimal', tickSize: 0.5 });
    expect(f.format(0.25)).toBe('0.5');
    expect(f.format(-0.25)).toBe('-0.5');
    expect(f.round(-0.25)).toBe(-0.5);
  });

  it('never shows a negative zero', () => {
    expect(createPriceFormat({ type: 'decimal', precision: 2 }).format(-0.001)).toBe('0.00');
    expect(createPriceFormat({ type: 'decimal', tickSize: 0.5 }).format(-0.1)).toBe('0.0');
    expect(createPriceFormat({ type: 'percent' }).format(-0.001)).toBe('0.00%');
  });

  it('allows up to 100 decimals', () => {
    expect(createPriceFormat({ type: 'decimal', precision: 20 }).format(1)).toBe('1.' + '0'.repeat(20));
    expect(() => createPriceFormat({ type: 'decimal', precision: 101 })).toThrow(RangeError);
  });

  it('rejects invalid tick sizes and bands', () => {
    expect(() => createPriceFormat({ type: 'decimal', tickSize: 0 })).toThrow(RangeError);
    expect(() => createPriceFormat({ type: 'decimal', precision: 1.5 })).toThrow(RangeError);
    expect(() =>
      createPriceFormat({
        type: 'decimal',
        tickSize: [
          { from: 1, tickSize: 0.01 },
          { from: 0, tickSize: 0.1 },
        ],
      }),
    ).toThrow(RangeError);
  });

  it('parses plain numbers only', () => {
    const f = createPriceFormat({ type: 'decimal' });
    expect(f.parse(' 1,234.5 ')).toBe(1234.5);
    expect(f.parse('-0.5')).toBe(-0.5);
    expect(f.parse('')).toBeNaN();
    expect(f.parse('abc')).toBeNaN();
    expect(f.parse('1.2.3')).toBeNaN();
  });
});

describe('zero folding', () => {
  it('folds four or more leading zeros into a subscript count', () => {
    const f = createPriceFormat({ type: 'decimal', precision: 8, zeroFold: {} });
    expect(f.format(0.00000412)).toBe('0.0₅412');
    expect(f.format(-0.00000412)).toBe('-0.0₅412');
    // Just above the threshold: three zeros stay as they are.
    expect(f.format(0.00041234)).toBe('0.00041234');
    // At the threshold.
    expect(f.format(0.00004123)).toBe('0.0₄4123');
    expect(f.format(1.5)).toBe('1.50000000');
    expect(f.format(0)).toBe('0.00000000');
    expect(f.format(-0.000000001)).toBe('0.00000000');
  });

  it('keeps trailing zeros the precision asks for, and writes counts of ten and more', () => {
    const f = createPriceFormat({ type: 'decimal', precision: 14, zeroFold: {} });
    expect(f.format(0.00000412)).toBe('0.0₅412000000');
    expect(f.format(0.0000000000123)).toBe('0.0₁₀1230');
    expect(f.parse('0.0₁₀1230')).toBe(0.0000000000123);
  });

  it('rounds to the tick before folding', () => {
    const f = createPriceFormat({ type: 'decimal', tickSize: 0.00000001, zeroFold: { minZeros: 5 } });
    expect(f.format(0.000004126)).toBe('0.0₅413');
    expect(f.format(0.00001234)).toBe('0.00001234');
  });

  it('writes the count in braces for fonts without subscript digits', () => {
    const f = createPriceFormat({ type: 'decimal', precision: 8, zeroFold: { style: 'brace' } });
    expect(f.format(0.00000412)).toBe('0.0{5}412');
    expect(f.format(-0.00000412)).toBe('-0.0{5}412');
  });

  it('parses both folded forms back', () => {
    const f = createPriceFormat({ type: 'decimal', precision: 8, zeroFold: {} });
    for (const price of [0.00000412, -0.00000412, 0.00004123]) {
      expect(f.parse(f.format(price))).toBe(price);
    }
    expect(f.parse('0.0{5}412')).toBe(0.00000412);
    expect(f.parse(' +0.0₅412 ')).toBe(0.00000412);
    // Formats without folding read folded input too.
    expect(createPriceFormat({ type: 'decimal' }).parse('0.0₅412')).toBe(0.00000412);
    expect(f.parse('0.0{0}412')).toBeNaN();
    expect(f.parse('0.0{999}1')).toBeNaN();
    expect(f.parse('1.0₅412')).toBeNaN();
  });

  it('rejects invalid options', () => {
    expect(() => createPriceFormat({ type: 'decimal', zeroFold: { minZeros: 0 } })).toThrow(RangeError);
    expect(() => createPriceFormat({ type: 'decimal', zeroFold: { minZeros: 2.5 } })).toThrow(RangeError);
    expect(() => createPriceFormat({ type: 'decimal', zeroFold: { style: 'tiny' as 'brace' } })).toThrow(RangeError);
  });
});

describe('fraction format', () => {
  it('formats and parses 32nds', () => {
    const f = createPriceFormat({ type: 'fraction', denominator: 32 });
    expect(f.format(101.5)).toBe("101'16");
    expect(f.format(101 + 5 / 32)).toBe("101'05");
    expect(f.format(99)).toBe("99'00");
    expect(f.format(-0.25)).toBe("-0'08");
    expect(f.parse("101'16")).toBe(101.5);
    expect(f.parse("-0'08")).toBe(-0.25);
    expect(f.parse('101')).toBe(101);
    expect(f.tickSize(100)).toBe(1 / 32);
  });

  it('rounds to the nearest 32nd', () => {
    const f = createPriceFormat({ type: 'fraction', denominator: 32 });
    expect(f.format(101.51)).toBe("101'16");
    expect(f.format(101.99)).toBe("102'00");
    expect(f.round(101.51)).toBe(101.5);
  });

  it('formats and parses quarters of a 32nd', () => {
    const f = createPriceFormat({ type: 'fraction', denominator: 32, subDenominator: 4 });
    expect(f.format(101 + 16 / 32)).toBe("101'160");
    expect(f.format(101 + 16.25 / 32)).toBe("101'162");
    expect(f.format(101 + 16.5 / 32)).toBe("101'165");
    expect(f.format(101 + 16.75 / 32)).toBe("101'167");
    for (const text of ["101'160", "101'162", "101'165", "101'167"]) expect(f.format(f.parse(text))).toBe(text);
    expect(f.parse("101'163")).toBeNaN();
    expect(f.tickSize(0)).toBe(1 / 128);
  });

  it('pads the numerator to the denominator width', () => {
    const f = createPriceFormat({ type: 'fraction', denominator: 8, separator: '-' });
    expect(f.format(10.375)).toBe('10-3');
    expect(f.parse('10-3')).toBe(10.375);
  });

  it('rejects malformed fractions', () => {
    const f = createPriceFormat({ type: 'fraction', denominator: 32 });
    expect(f.parse("101'32")).toBeNaN();
    expect(f.parse("101'5")).toBeNaN();
    expect(f.parse("101'161")).toBeNaN();
    expect(f.parse('x')).toBeNaN();
    expect(() => createPriceFormat({ type: 'fraction', denominator: 1 })).toThrow(RangeError);
  });
});

describe('volume, percent and custom formats', () => {
  it('volume is compact', () => {
    const f = createPriceFormat({ type: 'volume' });
    expect(f.format(1_250_000)).toBe('1.25M');
    expect(f.parse('1.25M')).toBe(1_250_000);
    expect(f.parse('300')).toBe(300);
    expect(f.tickSize(1)).toBe(0);
  });

  it('percent', () => {
    const f = createPriceFormat({ type: 'percent', precision: 1 });
    expect(f.format(12.345)).toBe('12.3%');
    expect(f.parse('12.3%')).toBe(12.3);
  });

  it('custom', () => {
    const f = createPriceFormat({ type: 'custom', format: (p) => `$${p.toFixed(1)}`, parse: (t) => Number(t.slice(1)), tickSize: 0.5, unit: 'USD' });
    expect(f.format(2.25)).toBe('$2.3');
    expect(f.parse('$2.5')).toBe(2.5);
    expect(f.round(2.3)).toBe(2.5);
    expect(f.unit).toBe('USD');
  });
});

describe('axis steps', () => {
  it('keep steps that are whole ticks and align the rest', () => {
    const dec = createPriceFormat({ type: 'decimal', tickSize: 0.25 });
    expect(dec.axisStep(0.5, 100)).toBe(0.5);
    expect(dec.axisStep(0.1, 100)).toBe(0.25);
    expect(dec.axisStep(0.625, 100)).toBe(1.25);
    const frac = createPriceFormat({ type: 'fraction', denominator: 32 });
    expect(frac.axisStep(0.1, 100)).toBe(4 / 32);
    expect(frac.axisStep(1, 100)).toBe(1);
    expect(createPriceFormat({ type: 'decimal' }).axisStep(0.2, 1)).toBe(0.2);
  });
});

describe('symbolPriceFormat', () => {
  it('prefers priceFormat, then tickSize and precision', () => {
    const fraction = { type: 'fraction', denominator: 32 } as const;
    expect(symbolPriceFormat({ priceFormat: fraction, precision: 2 })).toBe(fraction);
    expect(symbolPriceFormat({ tickSize: 0.5 })).toEqual({ type: 'decimal', tickSize: 0.5 });
    expect(symbolPriceFormat({ precision: 4 })).toEqual({ type: 'decimal', precision: 4 });
    expect(symbolPriceFormat({})).toBeUndefined();
  });
});
