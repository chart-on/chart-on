/**
 * The docs site palette for charts: the Paper & Ink colour preset, whose dark
 * variant swaps the two colours, matching custom.css. Used by the landing
 * page, the examples, the playground and the preview page.
 */
import { builtInColorPresets, presetTheme, type ChartTheme } from '@chart-on/core';
import { presetShellTokens } from '@chart-on/ui';

const paperInk = builtInColorPresets.find((p) => p.id === 'paper-ink')!;

const themes = { light: presetTheme(paperInk, 'light'), dark: presetTheme(paperInk, 'dark') };

export const siteChartTheme = (dark: boolean): ChartTheme => (dark ? themes.dark : themes.light);

const block = (selector: string, mode: 'light' | 'dark') =>
  `${selector}{${Object.entries(presetShellTokens(paperInk, mode))
    .map(([name, value]) => `${name}:${value}`)
    .join(';')}}`;

/**
 * Gives the UI shells in examples, the playground and the preview page the
 * site palette. The shell reads its chart colours from these tokens when it is
 * created, and its own scheme already follows the page. High-contrast shells
 * keep their colours. Runs once, before the first shell is created.
 */
export function installShellPalette(): void {
  if (document.querySelector('style[data-site-palette]')) return;
  const shell = ':is(.example-chart, .playground, .preview) .pc-shell:not(.pc-theme-high-contrast)';
  const style = document.createElement('style');
  style.dataset.sitePalette = '';
  style.textContent = block(`html:not(.dark) ${shell}`, 'light') + block(`html.dark ${shell}`, 'dark');
  document.head.append(style);
}
