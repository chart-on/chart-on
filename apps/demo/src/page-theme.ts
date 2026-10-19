import { builtInColorPresets, presetTheme, type ChartTheme } from '@charton/core';
import './page.css';

// The extra demo pages wear Paper & Ink, the shell's default colour preset, so
// they look like the main page: its chart colours here, its page tokens in page.css.
const paperInk = builtInColorPresets.find((p) => p.id === 'paper-ink')!;

export const light = matchMedia('(prefers-color-scheme: light)');
export const theme = (): ChartTheme => presetTheme(paperInk, light.matches ? 'light' : 'dark');
