/**
 * Components and hooks for `@chart-on/core`. The widget component is in the
 * `@chart-on/react/shell` entry, so apps that use only the engine do not need
 * `@chart-on/ui`.
 */
export { Chart } from './chart';
export type { ChartProps } from './chart';
export { useChart } from './context';
export type { ChartEventHandlers, ChartInputs } from './sync';
