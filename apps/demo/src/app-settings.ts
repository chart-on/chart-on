import {
  appearanceOf,
  settingsOf,
  type ChartSettingsOptions,
  type ShellDirection,
  type ShellPalette,
  type ShellTheme,
} from '@chart-on/ui';
import { DEMO_LOCALES } from './locales';

/** What the demo's Appearance settings read and write: the shell's theme, accessibility and direction. */
export interface DemoSettingsContext {
  theme(): ShellTheme;
  setTheme(theme: ShellTheme): void;
  /** High-contrast colours. */
  highContrast(): boolean;
  setHighContrast(on: boolean): void;
  /** `color-safe` swaps the up/down pair for one that colour-blind users tell apart. */
  palette(): ShellPalette;
  setPalette(palette: ShellPalette): void;
  direction(): ShellDirection;
  setDirection(direction: ShellDirection): void;
}

/**
 * The demo's own entries of the chart settings dialog (#693): theme,
 * accessibility, language and direction as an Appearance section, and a
 * "Colors…" button under the sections. They are shell and app state, not chart options,
 * so each field reads and writes it itself.
 */
export function demoSettings(ctx: DemoSettingsContext): Pick<ChartSettingsOptions, 'fields' | 'actions'> {
  let locale = 'builtin';
  return {
    fields: [
      {
        id: 'demo-appearance',
        title: 'Appearance',
        groups: [
          {
            id: 'theme',
            label: 'Theme',
            fields: [
              {
                id: 'demo.theme',
                label: 'Theme',
                kind: 'select',
                choices: THEMES,
                get: () => ctx.theme(),
                set: (_chart, value) => ctx.setTheme(value as ShellTheme),
              },
            ],
          },
          {
            id: 'accessibility',
            label: 'Accessibility',
            fields: [
              {
                id: 'demo.highContrast',
                label: 'High contrast',
                kind: 'boolean',
                get: () => ctx.highContrast(),
                set: (_chart, value) => ctx.setHighContrast(value === true),
              },
              {
                id: 'demo.colorSafe',
                label: 'Colour-safe up and down',
                kind: 'boolean',
                get: () => ctx.palette() === 'color-safe',
                set: (_chart, value) => ctx.setPalette(value === true ? 'color-safe' : 'default'),
              },
            ],
          },
          {
            id: 'language',
            label: 'Language and direction',
            fields: [
              {
                id: 'demo.locale',
                label: 'Language',
                kind: 'select',
                choices: DEMO_LOCALES.map(({ value, label }) => ({ value, label })),
                get: () => locale,
                set: (chart, value) => {
                  const entry = DEMO_LOCALES.find((l) => l.value === value);
                  if (!entry) return;
                  locale = entry.value;
                  chart.applyOptions({ localization: entry.options });
                },
              },
              {
                id: 'demo.direction',
                label: 'Direction',
                kind: 'select',
                choices: DIRECTIONS,
                // The demo page is left to right, so `auto` reads as left to right.
                get: () => (ctx.direction() === 'rtl' ? 'rtl' : 'ltr'),
                set: (_chart, value) => ctx.setDirection(value === 'rtl' ? 'rtl' : 'ltr'),
              },
            ],
          },
        ],
      },
    ],
    actions: [
      {
        id: 'colors',
        label: 'Colors…',
        // The settings dialog is modal, so keep its edits (as Ok does) and close it before the colors panel opens.
        onClick: (chart) => {
          settingsOf(chart)?.dialog?.submit();
          appearanceOf(chart)?.open();
        },
      },
    ],
  };
}

const THEMES: { value: ShellTheme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

const DIRECTIONS: { value: ShellDirection; label: string }[] = [
  { value: 'ltr', label: 'Left to right' },
  { value: 'rtl', label: 'Right to left' },
];
