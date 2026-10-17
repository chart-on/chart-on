import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { darkTheme, forcedColorsTheme, lightTheme } from '../src/theme';

/** A high-contrast palette, as a browser in forced-colours mode resolves the system colours. */
const SYSTEM: Record<string, string> = {
  Canvas: 'rgb(0, 0, 0)',
  CanvasText: 'rgb(255, 255, 255)',
  LinkText: 'rgb(255, 255, 0)',
  GrayText: 'rgb(63, 242, 63)',
  Highlight: 'rgb(26, 235, 255)',
  HighlightText: 'rgb(0, 0, 0)',
};

function stubSystemColors(colors: Record<string, string>): void {
  vi.stubGlobal('getComputedStyle', (el: HTMLElement) => ({ getPropertyValue: () => '', color: colors[el.style.color] ?? '' }));
}

afterEach(() => vi.unstubAllGlobals());

describe('forcedColorsTheme', () => {
  it('maps the theme to the system colours', () => {
    const host = fakeContainer();
    stubSystemColors(SYSTEM);
    const theme = forcedColorsTheme({ ...lightTheme, upWick: '#123456', downBorder: '#654321' }, host)!;
    expect(theme.background).toBe(SYSTEM.Canvas);
    expect(theme.text).toBe(SYSTEM.CanvasText);
    expect(theme.textMuted).toBe(SYSTEM.CanvasText);
    expect(theme.up).toBe(SYSTEM.LinkText);
    expect(theme.down).toBe(SYSTEM.CanvasText);
    expect(theme.labelBackground).toBe(SYSTEM.Highlight);
    expect(theme.labelText).toBe(SYSTEM.HighlightText);
    expect(theme.referenceLine).toBe(SYSTEM.GrayText);
    expect(theme.grid).toBe('rgba(255, 255, 255, 0.250)');
    expect(theme.heatmap).toHaveLength(4);
    expect(theme.heatmap[3]).toBe('rgba(255, 255, 255, 1.000)');
    // Separate wick and outline colours would bring back author colours.
    expect(theme.upWick).toBeUndefined();
    expect(theme.downBorder).toBeUndefined();
    // So would the drawing level colours; levels fall back to the drawing colour.
    expect(theme.levelGreen).toBeUndefined();
    expect(theme.levelNeutral).toBeUndefined();
    // Fonts are not colours.
    expect(theme.fontFamily).toBe(lightTheme.fontFamily);
    // The probe is gone again.
    expect((host as unknown as { children: unknown[] }).children).toHaveLength(0);
  });

  it('keeps the base colour where a system colour cannot be read', () => {
    const host = fakeContainer();
    stubSystemColors({ CanvasText: SYSTEM.CanvasText! });
    const theme = forcedColorsTheme(darkTheme, host)!;
    expect(theme.text).toBe(SYSTEM.CanvasText);
    expect(theme.background).toBe(darkTheme.background);
    expect(theme.up).toBe(darkTheme.up);
  });

  it('returns null when no colour can be read', () => {
    const host = fakeContainer();
    stubSystemColors({});
    expect(forcedColorsTheme(darkTheme, host)).toBeNull();
  });
});
