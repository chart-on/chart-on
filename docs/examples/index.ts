/**
 * The docs examples, in gallery order. Each id is a module in this folder
 * whose default export is a `MountExample`; the gallery, the `<Example>`
 * component and a test read this list.
 */
export type ExampleTag =
  | 'series'
  | 'panes'
  | 'data source'
  | 'realtime'
  | 'shell'
  | 'drawings'
  | 'volume profile'
  | 'annotations'
  | 'extending'
  | 'theming';

export interface ExampleInfo {
  title: string;
  /** One line under the title. */
  description: string;
  tags: readonly ExampleTag[];
  /** Plot height in css px. Default 420. */
  height?: number;
}

export const examples = {
  'first-chart': {
    title: 'A first chart',
    description: 'Candles from an array of bars, fitted to the plot.',
    tags: ['series'],
  },
  'candles-volume': {
    title: 'Candles with a volume pane',
    description: 'A histogram that follows the candles, on a pane of its own.',
    tags: ['series', 'panes'],
  },
  'volume-overlay': {
    title: 'Volume overlay in the price pane',
    description: 'The same histogram on its own scale at the bottom of the price pane.',
    tags: ['series'],
  },
  'derived-series': {
    title: 'Series derived from the bars',
    description: 'A line computed from each bar with a `follow` mapper.',
    tags: ['series', 'panes'],
  },
  panes: {
    title: 'Several panes',
    description: 'Volume and a cumulative delta line under the price pane.',
    tags: ['panes'],
  },
  'moving-average': {
    title: 'Moving average overlay',
    description: 'A line series computed from the closes, over the candles.',
    tags: ['series'],
  },
  realtime: {
    title: 'Realtime updates',
    description: 'Live ticks replace the forming bar and append new ones with `update`.',
    tags: ['realtime'],
  },
  'history-scroll': {
    title: 'Infinite scroll back',
    description: 'Older bars load as you pan towards the start, through `history:request`.',
    tags: ['realtime'],
  },
  'data-source': {
    title: 'Data source',
    description: 'History paging, live bars and caching handled by the chart, here with the mock source.',
    tags: ['data source', 'realtime'],
  },
  'custom-data-source': {
    title: 'Writing a data source',
    description: 'A `DataSource` by hand: symbol lookup, paged history in `[from, to)` and live bars.',
    tags: ['data source', 'realtime'],
  },
  'volume-profile': {
    title: 'Volume profile of the visible bars',
    description: 'Volume by price for the bars on screen, recomputed as you pan and zoom.',
    tags: ['volume profile'],
  },
  'volume-profile-sessions': {
    title: 'Volume profile per session',
    description: 'One profile per day, each growing from its first bar.',
    tags: ['volume profile'],
  },
  'annotation-zones': {
    title: 'Time bands, price zones and text labels',
    description: 'Highlights added from code: an event window, a price zone and a note on a bar.',
    tags: ['annotations'],
  },
  'custom-theme': {
    title: 'Custom chart colors',
    description: 'A partial theme over the built-in one, changed later with `applyOptions`.',
    tags: ['theming', 'series'],
  },
  shell: {
    title: 'Full shell with drawing tools',
    description: 'The UI package: toolbar, drawing-tool rail and bottom bar.',
    tags: ['shell', 'drawings'],
    height: 460,
  },
  'chart-grid': {
    title: 'Linked chart grid',
    description: 'Four charts in resizable cells that pan, zoom and move the crosshair together.',
    tags: ['shell'],
    height: 520,
  },
  'chart-type-switcher': {
    title: 'Chart type switcher',
    description: 'A toolbar menu that changes the candle style.',
    tags: ['shell', 'series'],
  },
  'custom-indicator': {
    title: 'Writing an indicator',
    description: 'A moving average defined with inputs, a plot and incremental updates, added twice.',
    tags: ['extending'],
  },
  'custom-series': {
    title: 'Custom series',
    description: 'A price channel drawn by your own series type, with autoscale, legend and axis label.',
    tags: ['extending', 'series'],
  },
  'custom-drawing-tool': {
    title: 'Custom drawing tool',
    description: 'A price band tool registered on the chart; click twice to place another.',
    tags: ['extending', 'drawings'],
  },
  'form-dialog': {
    title: 'Settings dialog with a custom input',
    description: 'A schema-driven form that previews changes live, with a stepper registered as a new input kind.',
    tags: ['shell'],
  },
} as const satisfies Record<string, ExampleInfo>;

export type ExampleId = keyof typeof examples;
