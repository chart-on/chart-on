import { describe, expect, it } from 'vitest';
import { darkTheme, lightTheme } from '../src/theme';
import { buildLut, contrastRatio, contrastText, mixColors, parseColor, withAlpha } from '../src/util/color';

describe('color', () => {
  it('parses hex and rgb(a)', () => {
    expect(parseColor('#10b981')).toEqual([16, 185, 129, 255]);
    expect(parseColor('#fff')).toEqual([255, 255, 255, 255]);
    expect(parseColor('#00000080')).toEqual([0, 0, 0, 128]);
    expect(parseColor('rgba(255, 255, 255, 0.05)')).toEqual([255, 255, 255, 13]);
    expect(parseColor('rgb(1 2 3 / 50%)')).toEqual([1, 2, 3, 128]);
  });

  it('rejects unknown colors outside the browser', () => {
    expect(() => parseColor('not-a-color')).toThrow();
  });

  it('applies alpha', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.500)');
  });

  it('mixes two colours per channel, clamping the amount', () => {
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixColors('#ff0000', 'rgb(0, 0, 255)', 0.25)).toBe('#bf0040');
    expect(mixColors('#123456', '#abcdef', -1)).toBe('#123456');
    expect(mixColors('#123456', '#abcdef', 2)).toBe('#abcdef');
  });

  it('picks the more readable text color for a background', () => {
    expect(contrastText('#ffffff')).toBe('#000000');
    expect(contrastText('#000000')).toBe('#ffffff');
    // Theme up/down colors are light enough for dark text, the drawing blue is not.
    expect(contrastText(darkTheme.up)).toBe('#000000');
    expect(contrastText(darkTheme.down)).toBe('#000000');
    expect(contrastText(darkTheme.drawing)).toBe('#000000');
    expect(contrastText(lightTheme.labelBackground)).toBe('#ffffff');
  });

  it('measures the WCAG contrast ratio, blending a translucent foreground first', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // Symmetric for opaque colours.
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#777777'), 10);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThan(4.5);
    // Fully transparent text is the background.
    expect(contrastRatio('rgba(0, 0, 0, 0)', '#ffffff')).toBeCloseTo(1, 5);
    // Half-transparent black on white is a mid grey.
    const half = contrastRatio('rgba(0, 0, 0, 0.5)', '#ffffff');
    expect(half).toBeGreaterThan(3);
    expect(half).toBeLessThan(5);
    expect(contrastRatio(darkTheme.text, darkTheme.background)).toBeGreaterThan(4.5);
    // Channels above 255 count as 255, so the ratio stays within 1..21.
    expect(contrastRatio('rgb(999, 999, 999)', '#000000')).toBeCloseTo(21, 5);
    expect(() => contrastRatio('not a colour', '#ffffff')).toThrow();
  });

  it('builds an interpolated LUT', () => {
    const lut = buildLut(['#000000', '#ffffff'], 3);
    expect([...lut.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...lut.slice(4, 8)]).toEqual([128, 128, 128, 255]);
    expect([...lut.slice(8, 12)]).toEqual([255, 255, 255, 255]);
    expect(buildLut(['#ff0000'], 2).length).toBe(8);
  });
});
