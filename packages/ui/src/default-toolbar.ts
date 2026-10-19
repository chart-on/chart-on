import type { Interval } from '@chart-on/core';
import { settingsToolbarItem } from './chart-settings';
import { indicatorPickerToolbarItem } from './indicator-picker';
import { indicatorTemplatesToolbarItem } from './indicator-templates';
import { replayToolbarItem } from './replay';
import type { ToolbarItem } from './toolbar';
import { fullscreen, intervals, symbolHeader } from './toolbar-presets';

/**
 * The intervals of the default toolbar. Rule: from one minute to one week,
 * each about 3 to 7 times the one before, so neighbours show visibly
 * different spans of time.
 */
export const defaultIntervals: readonly Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

/**
 * The toolbar a shell shows when the app gives none: the symbol, the interval
 * menu and indicators on the left, and indicator templates, bar replay,
 * fullscreen and chart settings on the right. Rule: on the left, what the
 * chart shows (which symbol, over which time, with which studies); on the
 * right, ways to keep, replay and frame that view, then the settings entry
 * point last. Everything else is opt-in. Spread it to add your own.
 */
export function defaultToolbarItems(): ToolbarItem[] {
  return [
    symbolHeader(),
    intervals(defaultIntervals, { display: 'menu' }),
    indicatorPickerToolbarItem(),
    { ...indicatorTemplatesToolbarItem(), group: 'view' },
    replayToolbarItem(),
    fullscreen(),
    settingsToolbarItem(),
  ];
}
