import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';
import type { Chart } from '@chart-on/core';
import type { ChartInputs } from './sync.js';

/** Attributes of the container `div` that the components pass on: `class`, `style`, `id` and the rest. */
export type ContainerAttributes = Omit<HTMLAttributes<HTMLDivElement>, 'children'>;

/** The props of `<Chart>`. */
export interface ChartProps extends ChartInputs, ContainerAttributes {
  /**
   * The `Chart` while the component is mounted; null before, after and on a
   * server. Read it with `bind:chart`; the component sets it, the app does not.
   */
  chart?: Chart | null;
  /** Content rendered inside the container, where `useChart()` returns this chart. */
  children?: Snippet;
}
