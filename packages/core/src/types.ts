/** Unix timestamp in seconds. */
export type Time = number;

/** One OHLC bar at `time`, with optional volume and per-bar colours. */
export interface Bar {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  /**
   * Part of `volume` from buy-side (aggressor) trades, when the data reports
   * it. The rest of `volume` counts as sell-side. Used by volume profiles.
   */
  buyVolume?: number;
  /**
   * This bar's body colour in candle styles (the bar and tick lines of bar
   * styles), over the series' up and down colours. Line and area styles ignore it.
   */
  color?: string;
  /** This bar's wick colour in candle styles that draw wicks (not the bar styles), while `wicks` is on. */
  wickColor?: string;
  /** This bar's body outline colour in candle styles that draw bodies (not the bar styles), while `borders` is on. */
  borderColor?: string;
}

/** One value at `time`, for line and histogram series, with optional per-point colours. */
export interface ValuePoint {
  time: Time;
  value: number;
  /**
   * Optional per-point colour: the column of a histogram, or on a line the
   * segment from this point to the next (see `colorMode`).
   */
  color?: string;
  /** Line series with `area`: the fill under the segment from this point to the next, fading downwards. */
  areaColor?: string;
}

/**
 * Time × price grid. One column per bar time; columns must be contiguous bars
 * of the main series. `values` is column-major: `values[col * rows + row]`,
 * row 0 is the lowest price bucket starting at `priceStart`.
 */
export interface HeatmapData {
  times: Time[];
  priceStart: number;
  priceStep: number;
  rows: number;
  values: Float32Array;
}

/** A point in css px. */
export interface Point {
  x: number;
  y: number;
}

/** A rectangle in css px: its top-left corner, width and height. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A range of logical bar indices, `from` to `to`. */
export interface IndexRange {
  from: number;
  to: number;
}

/** Turns a price into the text shown for it. */
export type PriceFormatter = (price: number) => string;
/** Turns a time (unix seconds) into the text shown for it. */
export type TimeFormatter = (time: Time) => string;
