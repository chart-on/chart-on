import type { Bar } from '../types';
import { clampNum } from '../util/math';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/**
 * Price rows of a volume profile. Row `r` covers
 * [start + r * rowSize, start + (r + 1) * rowSize). The bottom and top rows are
 * open-ended, so volume outside the layout lands in the edge rows.
 */
export interface ProfileLayout {
  start: number;
  rowSize: number;
  rows: number;
}

/** How a volume profile divides prices into rows: a row count across the price range, or a fixed row height. */
export interface ProfileRowOptions {
  /**
   * Rows across the price range; used when `rowSize` is not set. Unset, the
   * row count follows the bar count by the Rice rule, `ceil(2 * n^(1/3))`, a
   * standard histogram bin count; the profile series and the drawing size their
   * rows by pixels instead (`onScreenRows`).
   */
  rows?: number;
  /** Fixed row height in price units. Rows then align to multiples of it. */
  rowSize?: number;
}

/** Options for `computeVolumeProfile`: its rows and the share of volume in the value area. */
export interface ProfileOptions extends ProfileRowOptions {
  /** Share of the total volume inside the value area, in percent. Default 70. */
  valueArea?: number;
}

/** Inclusive row range. Both ends are -1 when there is no volume. */
export interface RowRange {
  low: number;
  high: number;
}

/** Most rows a profile can have, so a tiny `rowSize` cannot exhaust memory. */
export const MAX_PROFILE_ROWS = 4096;

/**
 * Target row height (css px) of a profile whose `rows` is unset: the default
 * bar spacing, so the rows have the same pitch as the candles beside them.
 */
const ROW_PX = 10;

/** Rows profile `p` should have at its height on screen (`priceToY`): one per `ROW_PX`, so rows keep their height at any zoom. 0 for an empty profile. */
export function screenRows(p: ProfileLayout, priceToY: (price: number) => number): number {
  const px = Math.abs(priceToY(p.start + p.rows * p.rowSize) - priceToY(p.start));
  return p.rows && clampNum(Math.round(px / ROW_PX), 1, MAX_PROFILE_ROWS);
}

/**
 * A profile with automatic rows: `layout(first)`, laid out again with
 * `screenRows` when they differ. The low and high do not depend on the rows,
 * so one more layout settles them.
 */
export function onScreenRows<P extends ProfileLayout>(layout: (rows: number) => P, first: number, priceToY: (price: number) => number): P {
  const p = layout(first);
  const rows = screenRows(p, priceToY);
  return rows && rows !== p.rows ? layout(rows) : p;
}

/**
 * Throw when `rows` or `rowSize` is set but is not a positive finite number;
 * otherwise return `options`. Such values would leave the layout NaN.
 */
export function checkRowOptions<T extends ProfileRowOptions>(options: T): T {
  const { rows, rowSize } = options;
  if (rowSize !== undefined && !(Number.isFinite(rowSize) && rowSize > 0)) {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Volume profile rowSize must be a positive finite number, got ${rowSize}` : '');
  }
  if (rows !== undefined && !(Number.isFinite(rows) && rows > 0)) {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Volume profile rows must be a positive finite number, got ${rows}` : '');
  }
  return options;
}

/**
 * Rows covering [low, high]. With `rowSize`, rows start at a multiple of it
 * (the size is scaled up when it would need more than `MAX_PROFILE_ROWS`).
 * Otherwise `rows` rows split the range evenly; this low-level layout has no
 * bar count, so unset `rows` is one row (`computeVolumeProfile` applies the Rice
 * rule first). A flat range gets one row centred on the price; an empty one
 * (non-finite bounds) gets zero rows.
 */
export function profileLayout(low: number, high: number, options: ProfileRowOptions = {}): ProfileLayout {
  checkRowOptions(options);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { start: 0, rowSize: 1, rows: 0 };
  if (high < low) [low, high] = [high, low];
  const fixed = options.rowSize;
  if (fixed !== undefined) {
    let rowSize = fixed;
    let rows = alignedRows(low, high, rowSize);
    if (rows > MAX_PROFILE_ROWS) {
      rowSize *= Math.ceil(rows / MAX_PROFILE_ROWS);
      rows = alignedRows(low, high, rowSize);
    }
    return { start: Math.floor(low / rowSize) * rowSize, rowSize, rows };
  }
  const rows = clampNum(Math.round(options.rows ?? 1), 1, MAX_PROFILE_ROWS);
  if (!(high > low)) {
    const rowSize = Math.abs(low) * 1e-3 || 1e-3;
    return { start: low - rowSize / 2, rowSize, rows: 1 };
  }
  return { start: low, rowSize: (high - low) / rows, rows };
}

function alignedRows(low: number, high: number, rowSize: number): number {
  const start = Math.floor(low / rowSize) * rowSize;
  // The epsilon keeps float noise from adding an empty row when high sits on a boundary.
  return Math.max(1, Math.ceil((high - start) / rowSize - 1e-9));
}

/**
 * Volume per price row, with the point of control and value area. Storage is
 * reused across computations, so recomputing allocates nothing once warm.
 */
export class VolumeProfile implements ProfileLayout {
  start = 0;
  rowSize = 1;
  rows = 0;
  /** Volume per row. Entries from `rows` on are unused. */
  volume = new Float64Array(0);
  /** Buy-side volume per row, from bars that carry `buyVolume`. */
  buy = new Float64Array(0);
  /** Sell-side volume per row (`volume - buyVolume` of those bars). */
  sell = new Float64Array(0);
  /** True when at least one binned bar carried `buyVolume`. */
  hasBuySell = false;
  /** Total binned volume. */
  total = 0;
  /** Largest row volume, set by `updateStats`. */
  maxVolume = 0;
  /** Point-of-control row, or -1 when there is no volume. Set by `updateStats`. */
  poc = -1;
  /** Lowest and highest value-area rows, or -1. Set by `updateStats`. */
  valueAreaLow = -1;
  valueAreaHigh = -1;

  /** Adopt `layout` and empty every row, growing storage when needed. */
  reset(layout: ProfileLayout): this {
    this.start = layout.start;
    this.rowSize = layout.rowSize;
    this.rows = layout.rows;
    if (this.volume.length < layout.rows) {
      const size = Math.max(layout.rows, 64);
      this.volume = new Float64Array(size);
      this.buy = new Float64Array(size);
      this.sell = new Float64Array(size);
    } else {
      this.volume.fill(0, 0, layout.rows);
      this.buy.fill(0, 0, layout.rows);
      this.sell.fill(0, 0, layout.rows);
    }
    this.hasBuySell = false;
    this.total = 0;
    this.maxVolume = 0;
    this.poc = this.valueAreaLow = this.valueAreaHigh = -1;
    return this;
  }

  /** Recompute the largest row, point of control and value area. */
  updateStats(valueAreaPercent = 70): this {
    let max = 0;
    for (let r = 0; r < this.rows; r++) max = Math.max(max, this.volume[r]!);
    this.maxVolume = max;
    this.poc = pointOfControl(this.volume, this.rows);
    const va = valueArea(this.volume, this.rows, this.poc, valueAreaPercent);
    this.valueAreaLow = va.low;
    this.valueAreaHigh = va.high;
    return this;
  }

  rowLow(row: number): number {
    return this.start + row * this.rowSize;
  }

  rowHigh(row: number): number {
    return this.start + (row + 1) * this.rowSize;
  }

  /** Middle price of a row. */
  rowPrice(row: number): number {
    return this.start + (row + 0.5) * this.rowSize;
  }
}

/**
 * Add the volume of bars [from, to) to the profile's rows.
 *
 * A bar's volume is spread evenly over its high–low range: each row gets the
 * share of the range it overlaps. A bar whose high equals its low puts all of
 * its volume in the row containing that price. Bars with no positive volume or
 * an invalid range are skipped. When a bar has `buyVolume`, every share is
 * split into buy (`buyVolume / volume`, capped at 1) and sell (the rest).
 */
export function binVolume(bars: readonly Bar[], from: number, to: number, profile: VolumeProfile): VolumeProfile {
  const { start, rowSize, rows, volume, buy, sell } = profile;
  if (rows <= 0) return profile;
  const last = rows - 1;
  const end = Math.min(to, bars.length);
  for (let i = Math.max(0, from); i < end; i++) {
    const bar = bars[i]!;
    const v = bar.volume;
    const lo = bar.low;
    const hi = bar.high;
    if (v === undefined || !(v > 0) || !(hi >= lo)) continue;
    const b = bar.buyVolume;
    const split = b !== undefined && b >= 0;
    const buyShare = split ? Math.min(1, b / v) : 0;
    if (split) profile.hasBuySell = true;
    profile.total += v;
    let r0 = Math.floor((lo - start) / rowSize);
    let r1 = Math.floor((hi - start) / rowSize);
    r0 = r0 < 0 ? 0 : r0 > last ? last : r0;
    r1 = r1 < 0 ? 0 : r1 > last ? last : r1;
    if (r0 === r1) {
      volume[r0]! += v;
      if (split) {
        buy[r0]! += v * buyShare;
        sell[r0]! += v * (1 - buyShare);
      }
      continue;
    }
    // Overlap with the first and last rows is partial; rows in between are full.
    // Edge rows are open-ended, so the shares always add up to the bar's volume.
    const density = v / (hi - lo);
    for (let r = r0; r <= r1; r++) {
      const bottom = r === r0 ? lo : start + r * rowSize;
      const top = r === r1 ? hi : start + (r + 1) * rowSize;
      const add = (top - bottom) * density;
      volume[r]! += add;
      if (split) {
        buy[r]! += add * buyShare;
        sell[r]! += add * (1 - buyShare);
      }
    }
  }
  return profile;
}

/**
 * Row with the most volume, or -1 when every row is empty. Ties go to the row
 * nearest the middle of the profile; equally near ties go to the lower row.
 */
export function pointOfControl(volume: ArrayLike<number>, rows = volume.length): number {
  const mid = (rows - 1) / 2;
  let best = -1;
  let max = 0;
  for (let r = 0; r < rows; r++) {
    const v = volume[r]!;
    if (v > max) {
      max = v;
      best = r;
    } else if (v === max && best >= 0 && Math.abs(r - mid) < Math.abs(best - mid)) {
      best = r;
    }
  }
  return best;
}

/**
 * Smallest row range around the point of control holding at least `percent`
 * of the total volume. Starting from the POC, it repeatedly adds whichever
 * neighbouring row (above or below) has more volume; when both have the same
 * volume it adds both. Returns -1 bounds when `poc` is not a valid row.
 */
export function valueArea(volume: ArrayLike<number>, rows: number, poc: number, percent = 70): RowRange {
  if (poc < 0 || poc >= rows) return { low: -1, high: -1 };
  let total = 0;
  for (let r = 0; r < rows; r++) total += volume[r]!;
  const target = (total * clampNum(percent, 0, 100)) / 100;
  let low = poc;
  let high = poc;
  let sum = volume[poc]!;
  while (sum < target && (low > 0 || high < rows - 1)) {
    // -1 marks a side with no rows left, so the other side always wins.
    const up = high < rows - 1 ? volume[high + 1]! : -1;
    const down = low > 0 ? volume[low - 1]! : -1;
    if (up > down) {
      high++;
      sum += up;
    } else if (down > up) {
      low--;
      sum += down;
    } else {
      high++;
      low--;
      sum += up + down;
    }
  }
  return { low, high };
}

/**
 * Profile of bars [from, to): rows over their low–high range, binned volume,
 * point of control and value area. Pass `out` to reuse its storage.
 */
export function computeVolumeProfile(
  bars: readonly Bar[],
  from: number,
  to: number,
  options: ProfileOptions = {},
  out = new VolumeProfile(),
): VolumeProfile {
  let low = Infinity;
  let high = -Infinity;
  const end = Math.min(to, bars.length);
  for (let i = Math.max(0, from); i < end; i++) {
    const bar = bars[i]!;
    if (bar.low < low) low = bar.low;
    if (bar.high > high) high = bar.high;
  }
  const rows = options.rows ?? Math.ceil(2 * Math.cbrt(Math.max(1, end - from)));
  out.reset(profileLayout(low, high, { rows, rowSize: options.rowSize }));
  binVolume(bars, from, to, out);
  return out.updateStats(options.valueArea);
}
