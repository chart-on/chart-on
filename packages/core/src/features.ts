/**
 * Switches for built-in chart UI and input handling. Every flag can change at
 * runtime through `chart.applyOptions({ features })`. They only gate user
 * input and built-in drawing; API calls such as `fitContent()` still work.
 */
export interface ChartFeatures {
  /** Series values in a corner of each pane (see the `legend` option). */
  legend: boolean;
  /** Show/hide, settings and remove buttons on each legend row, and a collapse toggle for long legends. */
  legendButtons: boolean;
  /** Last-value labels on the price axis and the dotted last-price line. */
  lastValueLabels: boolean;
  /** Right click (and long press with `touchInspect: 'off'`) emits `chart:contextmenu` and suppresses the browser menu while an app listens. */
  contextMenu: boolean;
  /** Pan by dragging the plot, horizontal wheel or trackpad scroll, momentum and arrow keys. */
  scroll: boolean;
  /** Zoom with the mouse wheel, trackpad or touch pinch and the `+` / `-` keys. */
  zoom: boolean;
  /** Drag the price or time axis to rescale it; double-click an axis to reset it. */
  axisDragScale: boolean;
  /** Keyboard shortcuts while the chart has focus, including the drawing shortcuts. */
  keyboard: boolean;
  /** One-finger drag pans on touch screens. Needs `scroll`. */
  touchScroll: boolean;
  /** Two-finger pinch zooms on touch screens. Needs `zoom`. */
  touchZoom: boolean;
  /** Time left in the current bar under the last price label. Needs `lastValueLabels` and the `countdown()` plugin. */
  countdown: boolean;
  /** The symbol and interval as a watermark behind the series (`chart.watermark`). */
  watermark: boolean;
  /** The "+" button by the crosshair price label, shown while the app listens for `plus:click`. */
  plusButton: boolean;
  /**
   * Press and hold the plot still for half a second with a mouse or pen, then
   * draw a stroke: on release it becomes the drawing it looks like most, see
   * `recognizeSketch`. Off by default.
   */
  sketch: boolean;
  /**
   * A small project logo at the bottom of the plot on the start side, linking
   * to the project site; screenshots show the mark and the site's name there.
   * On by default; set it to `false` to hide it.
   */
  attributionLogo: boolean;
}

/** Default values for `ChartFeatures`: every feature on except the watermark and sketching. */
export const defaultChartFeatures: Readonly<ChartFeatures> = {
  legend: true,
  legendButtons: true,
  lastValueLabels: true,
  contextMenu: true,
  scroll: true,
  zoom: true,
  axisDragScale: true,
  keyboard: true,
  touchScroll: true,
  touchZoom: true,
  countdown: true,
  watermark: false,
  plusButton: true,
  sketch: false,
  attributionLogo: true,
};

/** The options that set feature flags: `features`, and `legend.visible`. */
export interface FeatureOptions {
  features?: Partial<ChartFeatures>;
  legend?: { visible?: boolean };
}

/**
 * Merge flag changes into `current`. Undefined values leave a flag unchanged,
 * and `features.legend` wins over `legend.visible`.
 */
export function resolveFeatures(current: Readonly<ChartFeatures>, options: FeatureOptions): ChartFeatures {
  const next = { ...current };
  const legend = options.legend?.visible;
  if (legend !== undefined) next.legend = legend;
  for (const [key, value] of Object.entries(options.features ?? {})) {
    // Unknown flags are left out; development builds warn about them in `checkOptions`.
    if (!Object.hasOwn(defaultChartFeatures, key)) continue;
    if (value !== undefined) next[key as keyof ChartFeatures] = Boolean(value);
  }
  return next;
}
