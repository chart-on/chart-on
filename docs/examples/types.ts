import type { ChartTheme } from '@charton/core';

/** What the docs pass to an example besides its element. */
export interface ExampleContext {
  /** The docs page is in its dark scheme; examples follow it. */
  dark: boolean;
  /**
   * The chart theme that matches the docs page. In an app, pass `darkTheme`,
   * `lightTheme` or your own; without one the chart uses `darkTheme`.
   */
  theme?: ChartTheme;
}

/** An example: draws into `el` and returns a function that removes everything it made. */
export type MountExample = (el: HTMLElement, context: ExampleContext) => () => void;
