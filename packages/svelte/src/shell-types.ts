import type { Snippet } from 'svelte';
import type { Chart } from '@chart-on/core';
import type { ChartShell, ChartShellOptions, ShellEvents, ShellFeatures, ShellPalette, ShellTheme } from '@chart-on/ui';
import type { ChartInputs } from './sync.js';
import type { ContainerAttributes } from './types.js';

/** One callback per shell event the app listens to, keyed by event name. */
export type ShellEventHandlers = { [K in keyof ShellEvents]?: (payload: ShellEvents[K]) => void };

/** Shell options that can only be chosen when the shell is created. */
export type ShellCreationOptions = Omit<ChartShellOptions, 'chart' | 'theme' | 'palette' | 'features'>;

/** The props of `<ChartShell>`. */
export interface ChartShellProps extends ChartInputs, ContainerAttributes {
  /** Colour scheme of the chrome and the chart; changes go through `setTheme`. Default `dark`. */
  theme?: ShellTheme;
  /** Up and down colours; changes go through `setPalette`. */
  palette?: ShellPalette;
  /** Shell parts to show or hide; changes go through `applyFeatures` and are compared by value. */
  features?: Partial<ShellFeatures>;
  /**
   * Toolbar, rail, dialogs and the rest of the shell's set-up. Read once, when
   * the shell is created: to change them, remount the component on purpose,
   * for example inside a `{#key}` block.
   */
  shellOptions?: ShellCreationOptions;
  /** Shell events to listen to, keyed by event name, e.g. `{ 'theme:change': (e) => … }`. */
  shellOn?: ShellEventHandlers;
  /** The `ChartShell` while the component is mounted; null before, after and on a server. Read it with `bind:shell`. */
  shell?: ChartShell | null;
  /** The shell's chart, `shell.chart`, under the same conditions. Read it with `bind:chart`. */
  chart?: Chart | null;
  /** Content rendered inside the container, where `useChart()` and `useChartShell()` return the shell's chart and the shell. */
  children?: Snippet;
}
