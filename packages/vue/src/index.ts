/**
 * Components and composables for `@chart-on/core`. The widget component is in
 * the `@chart-on/vue/shell` entry, so apps that use only the engine do not need
 * `@chart-on/ui`.
 */
export { Chart } from './chart';
export type { ChartExposed, ChartProps } from './chart';
export { useChart } from './context';
export type { ChartEventHandlers, ChartInputs } from './sync';
