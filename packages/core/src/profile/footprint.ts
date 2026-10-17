import type { Time } from '../types';
import { barBucket, type BarBucketOptions, type TradeTick } from '../data/aggregate';
import { pointOfControl } from './math';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** One price row of a footprint bar. */
export interface FootprintRow {
  /** Row number: the row covers [index * rowSize, (index + 1) * rowSize). */
  index: number;
  /** Lowest price of the row, `index * rowSize`. */
  price: number;
  /** Volume of buyer-initiated trades. */
  buy: number;
  /** Volume of seller-initiated trades. */
  sell: number;
  /** All volume in the row: `buy + sell` plus trades with no side. */
  volume: number;
}

/** Volume by price inside one bar, the data a footprint bar draws. */
export interface FootprintBar {
  /** Bar start time, as on the matching price bar. */
  time: Time;
  /** Height of a row in price units. */
  rowSize: number;
  /** Rows with volume, lowest price first. Prices with no trades have no row. */
  rows: FootprintRow[];
  /** Total buy volume. */
  buy: number;
  /** Total sell volume. */
  sell: number;
  /** Total volume, unsided trades included. */
  volume: number;
  /** `buy - sell`. */
  delta: number;
  /** Index into `rows` of the row with the most volume (point of control), or -1 without volume. */
  poc: number;
}

/** Options for `createFootprintBuilder`: the bar interval and the row grouping. */
export interface FootprintBuilderOptions extends BarBucketOptions {
  /** Row height in price units, usually the tick size or a multiple of it. */
  rowSize: number;
}

/** Builds live footprint bars from a trade stream; see `createFootprintBuilder`. */
export interface FootprintBuilder {
  /**
   * Add a trade. Returns the bar it changed (a copy), or null when the trade
   * is dropped: outside the session, older than the bar being built, or with
   * an invalid time, price or size.
   */
  push(trade: TradeTick): FootprintBar | null;
  /** The bar being built (a copy), or null before the first trade. */
  readonly bar: FootprintBar | null;
  /** Forget the bar being built, e.g. after a reconnect. */
  reset(): void;
}

/** Pre-aggregated volume at one price, as a data source may send it. */
export interface FootprintLevel {
  /** A price inside the level; it is grouped into the row holding it. */
  price: number;
  /** Buy volume at the price. */
  buy?: number;
  /** Sell volume at the price. */
  sell?: number;
  /** Total volume; `buy + sell` when unset, and never less than that. */
  volume?: number;
}

/** Options for `footprintImbalances`. */
export interface FootprintImbalanceOptions {
  /** How many times larger one side must be than the other to count. Default 3. */
  ratio?: number;
  /** Smallest volume of the larger side that can count. Default 0 (any positive volume). */
  minVolume?: number;
}

/** Imbalance flags per row of a footprint bar, aligned with its `rows`. */
export interface FootprintImbalances {
  /** Buying at the row outweighs selling one row lower by `ratio` or more. */
  buy: boolean[];
  /** Selling at the row outweighs buying one row higher by `ratio` or more. */
  sell: boolean[];
}

/** Rows a price falls in may be off by float noise (0.3 / 0.1 is 2.9999...); this nudges it back. */
const ROW_EPS = 1e-9;

/**
 * Row number of a price for a row height: rows are [k * rowSize, (k + 1) * rowSize).
 * A price on a boundary belongs to the row above it, despite float noise.
 */
export function priceRow(price: number, rowSize: number): number {
  return Math.floor(price / rowSize + ROW_EPS);
}

function checkRowSize(rowSize: number): number {
  if (!(Number.isFinite(rowSize) && rowSize > 0)) {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Footprint rowSize must be a positive finite number, got ${rowSize}` : '');
  }
  return rowSize;
}

/** Mutable rows of a bar being built, keyed by row number. */
class RowSet {
  readonly rows = new Map<number, FootprintRow>();

  constructor(readonly rowSize: number) {}

  add(price: number, buy: number, sell: number, volume: number): void {
    const index = priceRow(price, this.rowSize);
    let row = this.rows.get(index);
    if (!row) {
      row = { index, price: index * this.rowSize, buy: 0, sell: 0, volume: 0 };
      this.rows.set(index, row);
    }
    row.buy += buy;
    row.sell += sell;
    row.volume += volume;
  }

  toBar(time: Time): FootprintBar {
    const rows = [...this.rows.values()].sort((a, b) => a.index - b.index).map((r) => ({ ...r }));
    let buy = 0;
    let sell = 0;
    let volume = 0;
    for (const r of rows) {
      buy += r.buy;
      sell += r.sell;
      volume += r.volume;
    }
    const poc = pointOfControl(rows.map((r) => r.volume));
    return { time, rowSize: this.rowSize, rows, buy, sell, volume, delta: buy - sell, poc };
  }
}

/**
 * Turn a trade stream into footprint bars: for each bar of `interval`, the
 * volume traded at each price row, split by aggressor side. A trade updates
 * the bar of its period or starts the next one, using the same bucketing as
 * `createBarBuilder` (so the bars line up with price bars built from the same
 * trades). Trades without a `size` count as size 1; trades without a `side`
 * add to the row's `volume` only.
 */
export function createFootprintBuilder(options: FootprintBuilderOptions): FootprintBuilder {
  const rowSize = checkRowSize(options.rowSize);
  const bucket = barBucket(options);
  let time: Time | null = null;
  let set = new RowSet(rowSize);
  return {
    push(trade) {
      if (!Number.isFinite(trade.time) || !Number.isFinite(trade.price)) return null;
      const size = trade.size ?? 1;
      if (!(Number.isFinite(size) && size >= 0)) return null;
      const start = bucket(trade.time);
      if (start === null || (time !== null && start < time)) return null;
      if (time === null || start > time) {
        time = start;
        set = new RowSet(rowSize);
      }
      const buy = trade.side === 'buy' ? size : 0;
      const sell = trade.side === 'sell' ? size : 0;
      set.add(trade.price, buy, sell, size);
      return set.toBar(time);
    },
    get bar() {
      return time === null ? null : set.toBar(time);
    },
    reset() {
      time = null;
      set = new RowSet(rowSize);
    },
  };
}

/**
 * A footprint bar from pre-aggregated levels, such as a data source's
 * per-price volume or another footprint bar's `rows`. Levels falling in the
 * same row of `rowSize` are summed, so passing a bar's rows with a larger
 * `rowSize` regroups it (rows of 0.25 into rows of 1, say). Levels with a
 * non-finite price are skipped; negative or non-finite volumes count as 0.
 */
export function footprintFromRows(time: Time, levels: readonly FootprintLevel[], rowSize: number): FootprintBar {
  const set = new RowSet(checkRowSize(rowSize));
  for (const level of levels) {
    if (!Number.isFinite(level.price)) continue;
    const buy = amount(level.buy);
    const sell = amount(level.sell);
    set.add(level.price, buy, sell, Math.max(buy + sell, amount(level.volume)));
  }
  return set.toBar(time);
}

function amount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Diagonal imbalances of a footprint bar. Buyers lift the offer one row above
 * where sellers hit the bid, so buying at a row is compared with selling one
 * row lower, and selling at a row with buying one row higher. A side counts as
 * imbalanced when it is at least `ratio` times the other and at least
 * `minVolume`; a missing or empty opposite row counts as 0, so any positive
 * volume against it qualifies.
 */
export function footprintImbalances(bar: FootprintBar, options: FootprintImbalanceOptions = {}): FootprintImbalances {
  const { ratio = 3, minVolume = 0 } = options;
  const byIndex = new Map<number, FootprintRow>();
  for (const r of bar.rows) byIndex.set(r.index, r);
  const beats = (side: number, other: number) => side > 0 && side >= minVolume && side >= ratio * other;
  return {
    buy: bar.rows.map((r) => beats(r.buy, byIndex.get(r.index - 1)?.sell ?? 0)),
    sell: bar.rows.map((r) => beats(r.sell, byIndex.get(r.index + 1)?.buy ?? 0)),
  };
}
