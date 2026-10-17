import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import { drawLegend } from '../src/legend';
import { darkTheme, neutralTheme, themeFromCss, type ChartTheme } from '../src/theme';
import { drawingFont } from '../src/drawing/draw';
import {
  fillNumerals,
  fontCss,
  measureNumerals,
  mergeTypography,
  resolveFont,
  typographyFromCss,
  TYPOGRAPHY_SURFACES,
} from '../src/typography';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  return c;
}

const frame = (c: Chart) => {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
};

interface El {
  className: string;
  children: El[];
  style: Record<string, string>;
}
const legendBlock = (c: Chart) => (c.root as unknown as El).children.find((e) => e.className === 'pc-legend')!;

/** A canvas context whose font has proportional digits: `1` is narrow, `0` and `8` wide. */
function proportionalCtx(align: CanvasTextAlign = 'left') {
  const widths: Record<string, number> = { '1': 3, '0': 7, '8': 7 };
  const width = (text: string) => [...text].reduce((w, ch) => w + (widths[ch] ?? 6), 0);
  const calls: { text: string; x: number }[] = [];
  const ctx = {
    font: '12px test-proportional',
    textAlign: align,
    fillStyle: '',
    save() {},
    restore() {},
    measureText: (text: string) => ({ width: width(text) }),
    fillText: (text: string, x: number) => calls.push({ text, x }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls, width };
}

describe('resolveFont', () => {
  it('uses the theme font, regular weight and tabular numerals by default', () => {
    for (const surface of [undefined, ...TYPOGRAPHY_SURFACES]) {
      const font = resolveFont(darkTheme, surface);
      expect(font.fontFamily).toBe(darkTheme.fontFamily);
      expect(font.numerals).toBe('tabular');
    }
    expect(resolveFont(darkTheme)).toEqual({ fontFamily: darkTheme.fontFamily, fontSize: 12, fontWeight: 400, numerals: 'tabular' });
    // The legend has always been one px larger than the axes; the watermark bold.
    expect(resolveFont(darkTheme, 'legend').fontSize).toBe(13);
    expect(resolveFont(darkTheme, 'axis').fontSize).toBe(12);
    expect(resolveFont(darkTheme, 'watermark').fontWeight).toBe(600);
  });

  it('lets the baseline override the theme font and fall through to every surface', () => {
    const theme: ChartTheme = { ...darkTheme, typography: { fontFamily: 'Brand Sans', fontSize: 14, fontWeight: 500, numerals: 'proportional' } };
    expect(resolveFont(theme, 'axis')).toEqual({ fontFamily: 'Brand Sans', fontSize: 14, fontWeight: 500, numerals: 'proportional' });
    expect(resolveFont(theme, 'legend').fontSize).toBe(15);
    expect(resolveFont(theme, 'drawings').fontFamily).toBe('Brand Sans');
  });

  it('lets a surface block override the baseline field by field', () => {
    const theme: ChartTheme = {
      ...darkTheme,
      typography: { fontFamily: 'Brand Sans', axis: { fontFamily: 'Brand Mono', numerals: 'proportional' }, legend: { fontSize: 11 }, watermark: { fontWeight: 300 } },
    };
    expect(resolveFont(theme, 'axis')).toEqual({ fontFamily: 'Brand Mono', fontSize: 12, fontWeight: 400, numerals: 'proportional' });
    // A surface's own size is exact, without the legend's step.
    expect(resolveFont(theme, 'legend')).toMatchObject({ fontFamily: 'Brand Sans', fontSize: 11 });
    expect(resolveFont(theme, 'labels')).toMatchObject({ fontFamily: 'Brand Sans', fontSize: 12, numerals: 'tabular' });
    expect(resolveFont(theme, 'watermark').fontWeight).toBe(300);
  });

  it('skips sizes and families it cannot use', () => {
    const theme: ChartTheme = { ...darkTheme, typography: { fontSize: 0, fontFamily: '', axis: { fontSize: Number.NaN } } };
    expect(resolveFont(theme, 'axis')).toMatchObject({ fontFamily: darkTheme.fontFamily, fontSize: 12 });
  });
});

describe('fontCss', () => {
  it('matches the font strings drawn before typography for the default weight', () => {
    expect(fontCss(resolveFont(neutralTheme, 'axis'))).toBe(`${neutralTheme.fontSize}px ${neutralTheme.fontFamily}`);
    expect(fontCss(resolveFont(darkTheme, 'legend'))).toBe(`${darkTheme.fontSize + 1}px ${darkTheme.fontFamily}`);
    expect(drawingFont(14, 'X')).toBe('14px X');
  });

  it('adds a weight that is not regular', () => {
    const theme: ChartTheme = { ...darkTheme, typography: { fontWeight: 500 } };
    expect(fontCss(resolveFont(theme, 'axis'))).toBe(`500 12px ${darkTheme.fontFamily}`);
    expect(fontCss(resolveFont(theme, 'axis'), 20, 'bold')).toBe(`bold 20px ${darkTheme.fontFamily}`);
    expect(drawingFont(14, 'X', {}, 300)).toBe('300 14px X');
    expect(drawingFont(14, 'X', { bold: true, italic: true }, 300)).toBe('italic bold 14px X');
  });
});

describe('mergeTypography', () => {
  it('merges surface blocks field by field', () => {
    const merged = mergeTypography({ fontFamily: 'A', axis: { fontSize: 13, numerals: 'proportional' } }, { axis: { fontSize: 14 }, legend: { fontWeight: 600 } });
    expect(merged).toEqual({ fontFamily: 'A', axis: { fontSize: 14, numerals: 'proportional' }, legend: { fontWeight: 600 } });
    expect(mergeTypography(undefined, { fontSize: 1 })).toEqual({ fontSize: 1 });
    expect(mergeTypography({ fontSize: 1 }, undefined)).toEqual({ fontSize: 1 });
  });

  it('applies through applyOptions without dropping other surfaces', () => {
    const c = chart({ theme: { typography: { fontFamily: 'Brand Sans', axis: { fontSize: 13 } } } });
    c.applyOptions({ theme: { typography: { axis: { fontWeight: 600 }, legend: { fontSize: 15 } } } });
    expect(c.theme.typography).toEqual({ fontFamily: 'Brand Sans', axis: { fontSize: 13, fontWeight: 600 }, legend: { fontSize: 15 } });
    c.applyOptions({ theme: { up: '#00ff00' } });
    expect(c.theme.typography?.axis).toEqual({ fontSize: 13, fontWeight: 600 });
  });
});

describe('typography tokens', () => {
  const reader = (props: Record<string, string>) => ({ getPropertyValue: (name: string) => props[name] ?? '' });

  it('reads the weight and numerals tokens into the baseline', () => {
    expect(typographyFromCss(reader({ '--pc-chart-font-weight': '500', '--pc-chart-numerals': 'proportional' }))).toEqual({
      fontWeight: 500,
      numerals: 'proportional',
    });
    expect(typographyFromCss(reader({ '--pc-chart-font-weight': 'bold' }), { axis: { fontSize: 13 } })).toEqual({ axis: { fontSize: 13 }, fontWeight: 'bold' });
    expect(themeFromCss(reader({ '--pc-weight': '300', '--pc-chart-font-weight': 'var(--pc-weight)' })).typography).toEqual({ fontWeight: 300 });
  });

  it('keeps the fallback for missing or unusable values', () => {
    expect(typographyFromCss(reader({}))).toBeUndefined();
    expect(typographyFromCss(reader({ '--pc-chart-font-weight': 'heavy', '--pc-chart-numerals': 'oldstyle' }))).toBeUndefined();
    expect(themeFromCss(reader({}))).toEqual(darkTheme);
  });
});

describe('canvas numerals', () => {
  it('gives every digit the widest digit cell when tabular', () => {
    const { ctx, width } = proportionalCtx();
    expect(measureNumerals(ctx, '111.11', 'tabular')).toBe(measureNumerals(ctx, '888.88', 'tabular'));
    expect(measureNumerals(ctx, '111.11', 'tabular')).toBe(5 * 7 + 6);
    expect(measureNumerals(ctx, '111.11', 'proportional')).toBe(width('111.11'));
  });

  it('draws digits in fixed columns, honouring the text alignment', () => {
    const { ctx, calls } = proportionalCtx('right');
    fillNumerals(ctx, '18', 100, 0, 'tabular');
    // Two 7 px cells ending at x = 100; the narrow 1 is centred in its cell.
    expect(calls).toEqual([
      { text: '1', x: 86 + 2 },
      { text: '8', x: 93 },
    ]);
    expect(ctx.textAlign).toBe('right');
    calls.length = 0;
    fillNumerals(ctx, '18', 100, 0, 'proportional');
    expect(calls).toEqual([{ text: '18', x: 100 }]);
  });

  it('draws text in one call when the font already has tabular digits', () => {
    const calls: string[] = [];
    const ctx = {
      font: '12px test-tabular',
      textAlign: 'left',
      measureText: (text: string) => ({ width: text.length * 6 }),
      fillText: (text: string) => calls.push(text),
    } as unknown as CanvasRenderingContext2D;
    fillNumerals(ctx, '123.45', 0, 0, 'tabular');
    expect(calls).toEqual(['123.45']);
  });
});

describe('legend numerals', () => {
  const bars: Bar[] = [
    { time: 0, open: 100, high: 105, low: 95, close: 100 },
    { time: 60, open: 100, high: 112, low: 99, close: 111.11 },
  ];

  it('sets the DOM legend font and numerals from the legend surface', () => {
    const c = chart();
    c.addCandles({ title: 'ABC', precision: 2 }).setData(bars);
    frame(c);
    expect(legendBlock(c).style.font).toBe(`13px ${darkTheme.fontFamily}`);
    expect(legendBlock(c).style.fontVariantNumeric).toBe('tabular-nums');
    c.applyOptions({ theme: { typography: { legend: { fontFamily: 'Brand Sans', fontSize: 14, fontWeight: 500, numerals: 'proportional' } } } });
    frame(c);
    expect(legendBlock(c).style.font).toBe('500 14px Brand Sans');
    expect(legendBlock(c).style.fontVariantNumeric).toBe('proportional-nums');
  });

  it('keeps legend digits column-aligned as a live value changes', () => {
    const c = chart({ legend: { mode: 'compact', showChange: false } });
    const series = c.addCandles({ title: 'ABC', precision: 2 });
    series.setData(bars);
    const draw = () => {
      const { ctx, calls } = proportionalCtx();
      drawLegend(ctx, {
        panes: c.panes,
        index: 1,
        idle: true,
        theme: c.theme,
        plotLeft: c.plotLeft,
        plotRight: c.plotLeft + c.plotWidth,
        width: c.width,
        height: c.height,
        settings: c.legendSettings,
      });
      // Start of each digit's 7 px cell: digits are drawn one per call, centred in their cell.
      return calls.filter((call) => /^\d$/.test(call.text)).map((call) => call.x - (7 - width(call.text)) / 2);
    };
    const { width } = proportionalCtx();
    const before = draw();
    series.update({ time: 60, open: 100, high: 190, low: 99, close: 188.88 });
    const after = draw();
    expect(before).toHaveLength(5);
    // Cell starts: the same columns whichever digits the value has.
    expect(after).toEqual(before);
  });
});
