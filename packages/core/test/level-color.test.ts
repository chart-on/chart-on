import { describe, expect, it } from 'vitest';
import { FIB_LEVELS } from '../src/drawing/fibonacci';
import { levelColor, resolveLevelColor } from '../src/drawing/level-color';
import { builtinTools } from '../src/drawing/tools';
import type { DrawingLevel, DrawingToolDef } from '../src/drawing/types';
import { darkTheme, highContrastDarkTheme, highContrastLightTheme, lightTheme, neutralTheme, type ChartTheme } from '../src/theme';
import { lightness } from './oklab';

/** Built-in tools with default levels; the time zones are counts, not ratios, and keep the drawing color. */
const levelTools = builtinTools.filter((t) => t.defaultStyle?.levels && t.type !== 'fib-time-zone');
const tool = (type: string) => builtinTools.find((t) => t.type === type)!;
const defaults = (t: DrawingToolDef) => t.defaultStyle!.levels!;
const values = (levels: readonly DrawingLevel[], visible = true) => levels.filter((l) => (l.visible !== false) === visible).map((l) => l.value);
/** Smallest lightness difference between levels next to each other once drawn (pitchforks sort by distance from the median). */
const PITCHFORK = /pitch/;

describe('default levels', () => {
  it('come from each method', () => {
    expect(levelTools.length).toBeGreaterThan(10);
    expect(values(defaults(tool('fib-speed-fan')))).toEqual([...FIB_LEVELS]);
    expect(values(defaults(tool('fib-time')))).toEqual([0, 0.382, 0.618, 1, 1.618, 2.618]);
    expect(values(defaults(tool('gann-box')))).toEqual(values(defaults(tool('gann-square'))));
    expect(values(defaults(tool('gann-box')))).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(values(defaults(tool('gann-box')), false)).toEqual([1 / 8, 1 / 3, 3 / 8, 5 / 8, 2 / 3, 7 / 8]);
    for (const t of levelTools.filter((t) => PITCHFORK.test(t.type))) {
      expect(values(defaults(t))).toEqual([1]);
      expect(values(defaults(t), false)).toEqual([0.5, 2, 3]);
    }
  });

  it('take their colors from the shared rule', () => {
    for (const t of levelTools) for (const l of defaults(t)) expect(l.color, `${t.type} ${l.value}`).toBe('auto');
  });
});

describe.each([
  ['dark', darkTheme],
  ['light', lightTheme],
])('level colors in the %s theme', (_, theme) => {
  it('differ in lightness between adjacent levels of every tool', () => {
    for (const t of levelTools) {
      const order = PITCHFORK.test(t.type) ? (v: number) => Math.abs(v) : (v: number) => v;
      const shown = values(defaults(t)).sort((a, b) => order(a) - order(b));
      for (let i = 1; i < shown.length; i++) {
        const [a, b] = [shown[i - 1]!, shown[i]!];
        const step = Math.abs(lightness(levelColor(a, theme)!) - lightness(levelColor(b, theme)!));
        expect(step, `${t.type}: ${a} → ${b}`).toBeGreaterThanOrEqual(0.05);
      }
    }
  });

  it('give the same ratio the same color in every tool', () => {
    const seen = new Map<number, string>();
    for (const t of levelTools) {
      for (const l of defaults(t)) {
        const color = resolveLevelColor(l, theme)!;
        expect(color, `${t.type} ${l.value}`).toBe(seen.get(l.value) ?? color);
        seen.set(l.value, color);
      }
    }
    expect(seen.size).toBeGreaterThan(15);
  });
});

describe.each([
  ['dark', darkTheme],
  ['light', lightTheme],
  ['neutral', neutralTheme],
  ['high-contrast dark', highContrastDarkTheme],
  ['high-contrast light', highContrastLightTheme],
])('the level color rule in the %s theme', (_, theme) => {
  const away = (color: string) => Math.abs(lightness(color) - lightness(theme.background));

  it("draws the move's ends neutral and fades its repeats towards the canvas", () => {
    expect(levelColor(0, theme)).toBe(theme.text);
    expect(levelColor(1, theme)).toBe(theme.text);
    expect(levelColor(-1, theme)).toBe(theme.text);
    const repeats = [1, 2, 3, 4].map((v) => away(levelColor(v, theme)!));
    repeats.slice(1).forEach((r, i) => expect(r).toBeLessThan(repeats[i]!));
  });

  it('draws the golden section, the key ratio, in the pure accent', () => {
    expect(levelColor(0.618, theme)).toBe(theme.drawing);
    expect(levelColor(-0.618, theme)).toBe(theme.drawing);
  });

  it('fades smaller fractions of the move towards the canvas', () => {
    const fractions = [0.5, 0.382, 0.236, 0.125].map((v) => away(levelColor(v, theme)!));
    fractions.slice(1).forEach((f, i) => expect(f).toBeLessThan(fractions[i]!));
    expect(levelColor(0.125, theme)).not.toBe(theme.background);
  });
});

describe('level colors of saved levels', () => {
  const theme: ChartTheme = darkTheme;

  it('keep their own color, theme color name or the drawing color', () => {
    expect(resolveLevelColor({ value: 0.618, color: 'levelGreen' }, theme)).toBe(theme.levelGreen);
    expect(resolveLevelColor({ value: 0.618, color: '#123456' }, theme)).toBe('#123456');
    expect(resolveLevelColor({ value: 0.618 }, theme)).toBeUndefined();
    expect(resolveLevelColor({ value: 0.618, color: 'auto' }, theme)).toBe(theme.drawing);
  });

  it('fall back to the drawing color in a theme without level colors, as in forced-colours mode', () => {
    const { levelNeutral: _, ...forced } = theme;
    expect(levelColor(0.5, forced)).toBeUndefined();
    expect(resolveLevelColor({ value: 0.5, color: 'auto' }, forced)).toBeUndefined();
  });
});
