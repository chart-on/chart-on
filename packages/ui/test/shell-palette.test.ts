import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { colorSafeUpDown, darkTheme, lightTheme } from '@chart-on/core';
import { fakeContainer } from '../../core/test/fake-dom';
import { createChartShell, type ChartShell } from '../src/shell';

const shells: ChartShell[] = [];
beforeEach(() => {
  // No stylesheet here: the shell falls back to the built-in themes.
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});
afterEach(() => {
  shells.splice(0).forEach((s) => s.destroy());
  vi.unstubAllGlobals();
});

function shell(options: Parameters<typeof createChartShell>[1] = {}) {
  const s = createChartShell(fakeContainer(), { toolbar: [], ...options });
  shells.push(s);
  return s;
}

const attr = (s: ChartShell) => s.el.getAttribute('data-pc-palette');

describe('shell palette', () => {
  it('starts with the theme colours and switches to the colour-safe pair', () => {
    const s = shell({ theme: 'dark' });
    expect(s.palette).toBe('default');
    expect(attr(s)).toBeNull();
    expect(s.chart.theme.up).toBe(darkTheme.up);

    const events: string[] = [];
    s.on('palette:change', ({ palette }) => events.push(palette));
    s.setPalette('color-safe');
    expect(s.palette).toBe('color-safe');
    expect(attr(s)).toBe('color-safe');
    expect(s.chart.theme).toMatchObject(colorSafeUpDown.dark);
    s.setPalette('color-safe');
    s.setPalette('default');
    expect(events).toEqual(['color-safe', 'default']);
    expect(attr(s)).toBeNull();
    expect(s.chart.theme.up).toBe(darkTheme.up);
  });

  it('follows the theme: the light pair on a light shell', () => {
    const s = shell({ theme: 'light', palette: 'color-safe' });
    expect(attr(s)).toBe('color-safe');
    expect(s.chart.theme).toMatchObject(colorSafeUpDown.light);
    s.setTheme('dark');
    expect(s.chart.theme).toMatchObject(colorSafeUpDown.dark);
    s.setPalette('default');
    s.setTheme('light');
    expect(s.chart.theme.down).toBe(lightTheme.down);
  });
});
