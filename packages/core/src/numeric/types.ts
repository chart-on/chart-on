import type { PriceAxisLabel, PrimitiveLayer } from '../primitives';
import type { ChartTheme } from '../theme';

/** One item of a numeric-axis series: a position on the horizontal axis and a value. */
export interface NumericItem {
  /** Horizontal position: a price, a maturity in years, a strike… Any finite number. */
  x: number;
  value: number;
  /** Colour of this histogram column; ignored by line series. */
  color?: string;
}

/** A position in data terms on a `NumericChart`: horizontal `x` and vertical `price`. */
export interface NumericPoint {
  x: number;
  price: number;
}

/** A data position plus where it is on screen, in chart-root css px. */
export interface NumericPointerEvent extends NumericPoint {
  point: { x: number; y: number };
}

/** Coordinates and context for a `NumericPrimitive`, in plot-local css px. */
export interface NumericPrimitiveEnv {
  /** The plot size. */
  width: number;
  height: number;
  pixelRatio: number;
  theme: ChartTheme;
  /** The visible x range, low to high (also when the axis is inverted). */
  from: number;
  to: number;
  xToPixel(x: number): number;
  pixelToX(px: number): number;
  priceToY(price: number): number;
  yToPrice(y: number): number;
  /** An x value as the crosshair labels it. */
  formatX(x: number): string;
  /** A price as the crosshair labels it. */
  formatPrice(price: number): string;
}

/** Handed to `NumericPrimitive.attached`. */
export interface NumericPrimitiveHost {
  /** Redraw the chart on the next frame. Primitives are not redrawn otherwise. */
  requestRedraw(): void;
  /**
   * The same as `requestRedraw`: a numeric chart redraws all its layers
   * together. Here so a primitive written for both chart types can call it.
   */
  requestOverlayRedraw(): void;
}

/**
 * Plugin that draws on a `NumericChart`, such as a marker, a band or an
 * alert line. Every member is optional. Attach with `chart.attachPrimitive`.
 */
export interface NumericPrimitive {
  /** `'below'` the series, `'normal'` (default) over them, or `'top'` over price lines and the crosshair. */
  layer?: PrimitiveLayer;
  attached?(host: NumericPrimitiveHost): void;
  detached?(): void;
  /** Draw in the plot area, clipped to it. */
  drawPlot?(ctx: CanvasRenderingContext2D, env: NumericPrimitiveEnv): void;
  /** Labels on the price axis, drawn like price line labels. */
  priceAxisLabels?(env: NumericPrimitiveEnv): PriceAxisLabel[];
  /** Price span to keep in view while x from `from` to `to` is visible. */
  priceRange?(from: number, to: number): [number, number] | null;
}
