import type { Bar } from '../types';
import { clampNum } from '../util/math';
import { hash32, seededRandom } from '../util/random';

/**
 * Cell lengths in seconds, coarsest first: week, day, hour, minute, second.
 * Each length divides the one before it, and cells are aligned to the epoch.
 */
const LEVELS = [604800, 86400, 3600, 60, 1];
const WEEK = LEVELS[0]!;
/** Volatility of the log price over one day. */
const DAILY_VOL = 0.028;
/** Spread of the weekly log price around the start price, for the long-run walk. */
const LONG_RUN_VOL = 0.6;
/** Mean volume per second. */
const VOLUME_PER_SECOND = 58;
/** Child lists kept before the cache is dropped and rebuilt on demand. */
const CACHE_LIMIT = 4096;

/** A bar of the path; volumes are always present. */
export interface PathBar extends Bar {
  volume: number;
  buyVolume: number;
}

/**
 * One symbol's simulated market as a function of time, shared by every
 * interval. It is built top-down: weekly cells come from a mean-reverting walk
 * in log space, and each cell is split into the cells of the next level (days,
 * hours, minutes, seconds) by a seeded bridge that starts at the cell's open,
 * ends at its close and stays within its high and low. A cell is therefore
 * exactly the aggregate of its children, and a bar of any interval, built from
 * the cells it covers, agrees with the bars of every other interval.
 *
 * Cells are made on demand and keyed by time, so the result never depends on
 * what was asked for first. Deterministic for a seed, start price and anchor.
 */
export class MockPath {
  /** Weekly log prices relative to the start price: `forward[i]` at week `anchor + i`, `backward[i]` at `anchor - i`. */
  readonly #forward = [0];
  readonly #backward = [0];
  private readonly children = new Map<string, PathBar[]>();
  readonly #anchorWeek: number;
  readonly #reversion: number;
  readonly #weeklyVol = DAILY_VOL * Math.sqrt(WEEK / 86400);

  /**
   * @param anchor - Unix seconds; the week holding it opens at `startPrice`.
   */
  constructor(
    private readonly seed: number,
    private readonly startPrice: number,
    anchor: number,
  ) {
    this.#anchorWeek = Math.floor(anchor / WEEK);
    this.#reversion = Math.sqrt(1 - (this.#weeklyVol / LONG_RUN_VOL) ** 2);
  }

  /** The aggregate of the path over `[from, to)` (unix seconds), stamped `from`; null when empty. */
  range(from: number, to: number): PathBar | null {
    let acc: PathBar | null = null;
    for (let w = Math.floor(from / WEEK); w * WEEK < to; w++) acc = this.#collect(this.#week(w), 0, from, to, acc);
    return acc && { ...acc, time: from };
  }

  #collect(cell: PathBar, level: number, from: number, to: number, acc: PathBar | null): PathBar | null {
    const length = LEVELS[level]!;
    if (cell.time >= to || cell.time + length <= from) return acc;
    if ((from <= cell.time && cell.time + length <= to) || level === LEVELS.length - 1) return merge(acc, cell);
    const list = this.split(cell, level);
    const step = LEVELS[level + 1]!;
    const first = Math.max(0, Math.floor((from - cell.time) / step));
    const last = Math.min(list.length, Math.ceil((to - cell.time) / step));
    for (let i = first; i < last; i++) acc = this.#collect(list[i]!, level + 1, from, to, acc);
    return acc;
  }

  /** The weekly cell with index `w` (weeks since the epoch). */
  #week(w: number): PathBar {
    const open = this.startPrice * Math.exp(this.#weekLog(w));
    const close = this.startPrice * Math.exp(this.#weekLog(w + 1));
    const rand = random(this.seed, 0, w);
    const wick = () => Math.abs(gauss(rand)) * this.#weeklyVol * 0.5;
    const high = Math.max(open, close) * Math.exp(wick());
    const low = Math.min(open, close) * Math.exp(-wick());
    const volume = VOLUME_PER_SECOND * WEEK * (0.6 + 0.8 * rand());
    return { time: w * WEEK, open, high, low, close, volume, buyVolume: volume * buyShare(open, high, low, close) };
  }

  /** Log price at the start of week `w`, relative to the start price. */
  #weekLog(w: number): number {
    const offset = w - this.#anchorWeek;
    // The walk is the same forwards and backwards in time, so both directions
    // step away from the anchor with their own draws.
    const list = offset >= 0 ? this.#forward : this.#backward;
    const n = Math.abs(offset);
    while (list.length <= n) {
      const i = list.length;
      const step = gauss(random(this.seed, -1, offset >= 0 ? this.#anchorWeek + i : this.#anchorWeek - i));
      list.push(this.#reversion * list[i - 1]! + this.#weeklyVol * step);
    }
    return list[n]!;
  }

  /** The cells of level `level + 1` inside `cell`, oldest first. */
  private split(cell: PathBar, level: number): PathBar[] {
    const key = `${level}:${cell.time}`;
    const cached = this.children.get(key);
    if (cached) return cached;
    if (this.children.size >= CACHE_LIMIT) this.children.clear();

    const step = LEVELS[level + 1]!;
    const count = LEVELS[level]! / step;
    const rand = random(this.seed, level + 1, cell.time);
    const vol = DAILY_VOL * Math.sqrt(step / 86400);

    // A random walk between the open and the close (in log space), with a wick
    // either side of each child.
    const open = Math.log(cell.open);
    const close = Math.log(cell.close);
    const walk = [0];
    for (let i = 1; i <= count; i++) walk.push(walk[i - 1]! + gauss(rand) * vol);
    // Tilt the walk so it ends on the close.
    const points = walk.map((w, i) => open + w + (i / count) * (close - open - walk[count]!));
    points[0] = open;
    points[count] = close;
    const highs: number[] = [];
    const lows: number[] = [];
    for (let i = 0; i < count; i++) {
      highs.push(Math.max(points[i]!, points[i + 1]!) + Math.abs(gauss(rand)) * vol * 0.5);
      lows.push(Math.min(points[i]!, points[i + 1]!) - Math.abs(gauss(rand)) * vol * 0.5);
    }

    // Stretch the parts above the body and below it so the highest child high
    // lands on the cell's high and the lowest child low on its low. The map is
    // monotonic and keeps the open and close, so every child stays a valid bar.
    const top = Math.max(open, close);
    const bottom = Math.min(open, close);
    const iHigh = argBest(highs, (a, b) => a > b);
    const iLow = argBest(lows, (a, b) => a < b);
    const up = scale(Math.log(cell.high) - top, highs[iHigh]! - top);
    const down = scale(bottom - Math.log(cell.low), bottom - lows[iLow]!);
    const fit = (y: number) =>
      clamp(Math.exp(y > top ? top + up * (y - top) : y < bottom ? bottom - down * (bottom - y) : y), cell.low, cell.high);

    const weights: number[] = [];
    for (let i = 0; i < count; i++) weights.push(0.5 + rand());
    const total = weights.reduce((a, b) => a + b, 0);

    const list: PathBar[] = [];
    let prev = cell.open;
    let volumeLeft = cell.volume;
    for (let i = 0; i < count; i++) {
      const o = prev;
      const c = i === count - 1 ? cell.close : fit(points[i + 1]!);
      const h = i === iHigh ? cell.high : Math.max(fit(highs[i]!), o, c);
      const l = i === iLow ? cell.low : Math.min(fit(lows[i]!), o, c);
      const v = i === count - 1 ? volumeLeft : (cell.volume * weights[i]!) / total;
      volumeLeft -= v;
      list.push({ time: cell.time + i * step, open: o, high: h, low: l, close: c, volume: v, buyVolume: 0 });
      prev = c;
    }
    splitBuyVolume(list, cell);
    this.children.set(key, list);
    return list;
  }
}

/**
 * Give each child a buy share that follows its own direction, shifted so the
 * children's buy volumes add up to the parent's and kept within 0..1.
 */
function splitBuyVolume(list: PathBar[], parent: PathBar): void {
  const target = parent.volume > 0 ? parent.buyVolume / parent.volume : 0.5;
  const shares = list.map((b) => buyShare(b.open, b.high, b.low, b.close));
  const mean = list.reduce((sum, b, i) => sum + b.volume * shares[i]!, 0) / Math.max(parent.volume, 1e-12);
  let lambda = 1;
  for (const share of shares) {
    const d = share - mean;
    if (d > 0) lambda = Math.min(lambda, (1 - target) / d);
    else if (d < 0) lambda = Math.min(lambda, target / -d);
  }
  list.forEach((b, i) => (b.buyVolume = b.volume * (target + lambda * (shares[i]! - mean))));
}

/** Buyers dominate rising bars, sellers falling ones. */
function buyShare(open: number, high: number, low: number, close: number): number {
  return 0.5 + (0.4 * (close - open)) / Math.max(high - low, 1e-12);
}

function merge(acc: PathBar | null, cell: PathBar): PathBar {
  if (!acc) return { ...cell };
  acc.high = Math.max(acc.high, cell.high);
  acc.low = Math.min(acc.low, cell.low);
  acc.close = cell.close;
  acc.volume += cell.volume;
  acc.buyVolume += cell.buyVolume;
  return acc;
}

/** Factor that maps an excursion of `actual` onto `target`; 0 when there is no excursion to stretch. */
function scale(target: number, actual: number): number {
  return actual > 1e-12 ? target / actual : 0;
}

function argBest(values: number[], better: (a: number, b: number) => boolean): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (better(values[i]!, values[best]!)) best = i;
  return best;
}

function clamp(value: number, min: number, max: number): number {
  return clampNum(value, min, max);
}

/** A seeded generator for one cell, so cells can be made in any order. */
function random(seed: number, level: number, index: number): () => number {
  // Indexes go past 2^32 (second cells), so hash the high and low parts.
  const h = hash32(hash32(hash32(seed, level), index >>> 0), Math.floor(index / 4294967296));
  return seededRandom(h);
}

function gauss(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
}
