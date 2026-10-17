import { describe, expect, it } from 'vitest';
import { chartThemeTokens, darkTheme, lightTheme, themeFromCss, type ChartTheme } from '../src/theme';
import { resolveCssVars, splitCssList, type CssPropertyReader } from '../src/util/css';

/** Stand-in for `getComputedStyle`: unknown properties read as `''`, like in browsers. */
function reader(props: Record<string, string>): CssPropertyReader {
  return { getPropertyValue: (name) => props[name] ?? '' };
}

describe('resolveCssVars', () => {
  it('follows var() chains and fallbacks', () => {
    const r = reader({ '--a': 'var(--b)', '--b': ' #123456 ', '--empty': '' });
    expect(resolveCssVars('var(--a)', r)).toBe('#123456');
    expect(resolveCssVars('var(--missing, var(--b))', r)).toBe('#123456');
    expect(resolveCssVars('var(--empty, rgba(1, 2, 3, 0.5))', r)).toBe('rgba(1, 2, 3, 0.5)');
    expect(resolveCssVars('1px solid var(--b)', r)).toBe('1px solid #123456');
  });

  it('gives up on missing references and cycles', () => {
    const r = reader({ '--loop': 'var(--loop)', '--x': 'var(--y)', '--y': 'var(--x)' });
    expect(resolveCssVars('var(--missing)', r)).toBe('');
    expect(resolveCssVars('var(--loop)', r)).toBe('');
    expect(resolveCssVars('var(--x)', r)).toBe('');
    expect(resolveCssVars('var(--broken', r)).toBe('');
  });
});

describe('splitCssList', () => {
  it('splits on top-level commas only', () => {
    expect(splitCssList('#000, rgba(1, 2, 3, 0.5) ,#fff')).toEqual(['#000', 'rgba(1, 2, 3, 0.5)', '#fff']);
    expect(splitCssList(' #000 ')).toEqual(['#000']);
    expect(splitCssList('#000,,')).toEqual(['#000']);
  });
});

describe('themeFromCss', () => {
  it('maps every token to its theme key', () => {
    const theme = themeFromCss(
      reader({
        '--pc-canvas': '#101010',
        '--pc-chart-bg': 'var(--pc-canvas)',
        '--pc-chart-grid': 'rgba(255, 255, 255, 0.05)',
        '--pc-chart-separator': '#222',
        '--pc-chart-text': '#b4b4b4',
        '--pc-chart-text-muted': '#636363',
        '--pc-chart-font': 'ui-monospace, monospace',
        '--pc-chart-font-size': '11px',
        '--pc-chart-crosshair': 'rgb(255 255 255 / 32%)',
        '--pc-chart-label-bg': '#363636',
        '--pc-chart-label-text': '#ebebeb',
        '--pc-up': '#10b981',
        '--pc-down': '#f43f5e',
        '--pc-line-series': '#38bdf8',
        '--pc-drawing': '#38bdf8',
        '--pc-drawing-selected': '#ebebeb',
        '--pc-drawing-fill': 'rgba(56, 189, 248, 0.12)',
        '--pc-chart-reference-line': '#7a7a7a',
        '--pc-bid': '#60a5fa',
        '--pc-ask': '#f87171',
        '--pc-depth-bid': 'rgba(96, 165, 250, 0.3)',
        '--pc-depth-ask': 'rgba(248, 113, 113, 0.3)',
        '--pc-extended-hours': '#fbbf24',
        '--pc-alert': '#f59e0b',
        '--pc-annotation-fill': 'rgba(96, 165, 250, 0.12)',
        '--pc-heatmap': '#1e1b4b, rgba(109, 40, 217, 1), #facc15',
        '--pc-chart-watermark': 'rgba(255, 255, 255, 0.07)',
        '--pc-level-neutral': '#808080',
        '--pc-level-red': '#f00',
        '--pc-level-orange': '#f80',
        '--pc-level-green': 'var(--pc-up)',
        '--pc-level-blue': '#00f',
        '--pc-level-purple': '#80f',
      }),
    );
    expect(theme).toEqual<ChartTheme>({
      background: '#101010',
      grid: 'rgba(255, 255, 255, 0.05)',
      separator: '#222',
      text: '#b4b4b4',
      textMuted: '#636363',
      fontFamily: 'ui-monospace, monospace',
      fontSize: 11,
      crosshair: 'rgb(255 255 255 / 32%)',
      labelBackground: '#363636',
      labelText: '#ebebeb',
      up: '#10b981',
      down: '#f43f5e',
      line: '#38bdf8',
      drawing: '#38bdf8',
      drawingSelected: '#ebebeb',
      drawingFill: 'rgba(56, 189, 248, 0.12)',
      referenceLine: '#7a7a7a',
      bid: '#60a5fa',
      ask: '#f87171',
      depthBid: 'rgba(96, 165, 250, 0.3)',
      depthAsk: 'rgba(248, 113, 113, 0.3)',
      extendedHours: '#fbbf24',
      alert: '#f59e0b',
      annotationFill: 'rgba(96, 165, 250, 0.12)',
      heatmap: ['#1e1b4b', 'rgba(109, 40, 217, 1)', '#facc15'],
      watermark: 'rgba(255, 255, 255, 0.07)',
      levelNeutral: '#808080',
      levelRed: '#f00',
      levelOrange: '#f80',
      levelGreen: '#10b981',
      levelBlue: '#00f',
      levelPurple: '#80f',
    });
  });

  it('keeps the fallback for missing tokens', () => {
    expect(themeFromCss(reader({}))).toEqual(darkTheme);
    expect(themeFromCss(reader({}), lightTheme)).toEqual(lightTheme);
    expect(themeFromCss(reader({ '--pc-up': '#00ff00' }), lightTheme)).toEqual({ ...lightTheme, up: '#00ff00' });
  });

  it('keeps the fallback for values it cannot use', () => {
    const theme = themeFromCss(
      reader({
        '--pc-up': 'not-a-color',
        '--pc-down': 'var(--missing)',
        '--pc-chart-font-size': '0.75rem',
        '--pc-heatmap': '#000, nope',
        '--pc-chart-grid': 'currentColor',
        '--pc-chart-bg': 'light-dark(#fff, #111)',
      }),
    );
    expect(theme.up).toBe(darkTheme.up);
    expect(theme.down).toBe(darkTheme.down);
    expect(theme.grid).toBe(darkTheme.grid);
    expect(theme.background).toBe(darkTheme.background);
    expect(theme.fontSize).toBe(darkTheme.fontSize);
    expect(theme.heatmap).toEqual(darkTheme.heatmap);
    expect(themeFromCss(reader({ '--pc-chart-font-size': '13' })).fontSize).toBe(13);
  });

  it('has one distinct token per theme key', () => {
    // Per-direction grid colors, candle wick and border colors, the time mark color and the gradient bottom are optional and unset in the built-in themes.
    const optional = ['gridHorizontal', 'gridVertical', 'upWick', 'downWick', 'upBorder', 'downBorder', 'timeMark', 'backgroundBottom'];
    const keys = [...Object.keys(darkTheme), ...optional].sort();
    expect(Object.keys(chartThemeTokens).sort()).toEqual(keys);
    expect(new Set(Object.values(chartThemeTokens)).size).toBe(keys.length);
  });
});
