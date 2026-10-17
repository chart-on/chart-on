import { bisect } from './util/search';
/**
 * Coarser levels of a series for zoomed-out views. Level `L` merges the items
 * of `2^L` consecutive timeline indices into one bucket: bucket `j` covers
 * indices `j << L` to `((j + 1) << L) - 1`. Buckets are aligned to absolute
 * timeline indices, not to the view, so panning never changes what a bucket
 * holds. Level 0 is the series itself and is read through the source.
 */

/** How a field of a bucket comes from its items. */
export type Merge = 'first' | 'last' | 'min' | 'max' | 'sum';

/**
 * How the view groups timeline indices into buckets: `2^level` indices each
 * (`PowerBuckets`, the `pixel` grouping mode), or one calendar period each
 * (`CalendarBuckets`). Buckets are aligned to absolute timeline indices.
 */
export interface Buckets {
  /** Groupings with equal keys bucket every index the same way. */
  readonly key: string;
  /** The power-of-two level; 0 for calendar buckets. */
  readonly level: number;
  /** Bucket holding timeline index `index`; -1 before the first bar. */
  of(index: number): number;
  /** First timeline index of bucket `j`. */
  start(j: number): number;
  /** First timeline index after bucket `j`. */
  end(j: number): number;
}

/** `2^level` timeline indices per bucket. */
export class PowerBuckets implements Buckets {
  readonly key: string;
  private readonly width: number;

  constructor(readonly level: number) {
    this.key = `p${level}`;
    this.width = 2 ** level;
  }

  of(index: number): number {
    return Math.floor(index / this.width);
  }

  start(j: number): number {
    return j * this.width;
  }

  end(j: number): number {
    return (j + 1) * this.width;
  }
}

/**
 * One calendar period per bucket, given as the timeline index each bucket
 * starts at (ascending, the first 0). Indices past the last bar belong to the
 * last bucket.
 */
export class CalendarBuckets implements Buckets {
  readonly level = 0;

  constructor(
    readonly key: string,
    /** Start index of each bucket; only the first `count` entries are used. */
    private readonly starts: Int32Array,
    readonly count: number,
    /** Timeline length. */
    private readonly length: number,
  ) {}

  of(index: number): number {
    if (!(index >= 0) || this.count === 0) return -1;
    // Last bucket starting at or before `index`.
    return bisect(this.count, (i) => this.starts[i]! <= index) - 1;
  }

  start(j: number): number {
    return j <= 0 ? 0 : j < this.count ? this.starts[j]! : this.length;
  }

  end(j: number): number {
    return j + 1 < this.count ? this.starts[j + 1]! : this.length;
  }
}

/** Timeline index at the centre of bucket `j`. */
export const bucketCenter = (g: Buckets, j: number): number => (g.start(j) + g.end(j) - 1) / 2;

/** First and last bucket with any timeline index in `from` to `to`, clamped to `size` buckets. */
export function bucketRange(from: number, to: number, g: Buckets, size: number): [first: number, last: number] {
  return [Math.max(0, g.of(Math.floor(from))), Math.min(size - 1, g.of(Math.floor(to)))];
}

/** The items a pyramid summarises: aligned positions `k` in ascending timeline index. */
export interface PyramidSource<F extends string> {
  /** Aligned items. */
  count(): number;
  /** Timeline index of item `k`. */
  index(k: number): number;
  /** Item at timeline index `index`, or -1 when there is none (a gap). */
  itemAt(index: number): number;
  /** Field `field` of item `k`. */
  value(k: number, field: F): number;
}

const IDENTITY: Record<Merge, number> = { first: NaN, last: NaN, min: Infinity, max: -Infinity, sum: 0 };

/** One level: per-field values and item counts per bucket. */
class Level<F extends string> {
  size = 0;
  counts = new Int32Array(0);
  values: Record<F, Float64Array>;

  constructor(fields: readonly F[]) {
    this.values = {} as Record<F, Float64Array>;
    for (const f of fields) this.values[f] = new Float64Array(0);
  }

  /** Make room for `size` buckets, keeping buckets below `keep`. */
  resize(size: number, keep: number, fields: readonly F[]): void {
    if (size > this.counts.length) {
      const capacity = Math.ceil(size * 1.25) + 16;
      const counts = new Int32Array(capacity);
      counts.set(this.counts.subarray(0, keep));
      this.counts = counts;
      for (const f of fields) {
        const next = new Float64Array(capacity);
        next.set(this.values[f].subarray(0, keep));
        this.values[f] = next;
      }
    }
    this.size = size;
  }
}

/**
 * Levels built on first use and kept in step with appends and changes to the
 * newest items in O(new items + levels). A query over any index range reads
 * O(log n) buckets.
 */
export class Pyramid<F extends string> {
  readonly #fields: readonly F[];
  /** `levels[L - 1]` is level `L`; built up to the highest level asked for. */
  #levels: Level<F>[] = [];
  /** The calendar buckets last asked for and their values, built from the items directly. */
  #calendar: { buckets: Buckets; level: Level<F> } | null = null;
  /** Buckets and items read by `extreme`, for tests. */
  reads = 0;

  constructor(
    private readonly merges: Readonly<Record<F, Merge>>,
    private readonly source: PyramidSource<F>,
  ) {
    this.#fields = Object.keys(merges) as F[];
  }

  /** The source was replaced: drop every level. */
  reset(): void {
    this.#levels = [];
    this.#calendar = null;
  }

  /** Levels built so far (0 when none). */
  get depth(): number {
    return this.#levels.length;
  }

  /** Buckets of `g` (a level `L >= 1`, or a bucketing), building what it needs. */
  size(g: number | Buckets): number {
    return this.#bucketsOf(g).size;
  }

  /** Items in bucket `j` of `g`. */
  count(g: number | Buckets, j: number): number {
    return this.#bucketsOf(g).counts[j] ?? 0;
  }

  /** Field `field` of bucket `j` of `g`; NaN or ±Infinity for an empty bucket. */
  get(g: number | Buckets, j: number, field: F): number {
    const level = this.#bucketsOf(g);
    return j >= 0 && j < level.size ? level.values[field][j]! : IDENTITY[this.merges[field]];
  }

  /** The values of `g`: a power-of-two level, or calendar buckets built on first use. */
  #bucketsOf(g: number | Buckets): Level<F> {
    if (typeof g === 'number') return this.level(g);
    if (g.level > 0) return this.level(g.level);
    const cal = this.#calendar;
    if (cal && cal.buckets.key === g.key) {
      if (cal.buckets !== g) {
        // The same boundaries, maybe with buckets appended after them: items already
        // placed stay in their buckets; only items past the old last bucket need placing.
        cal.buckets = g;
        const src = this.source;
        const n = src.count();
        const size = n > 0 ? g.of(src.index(n - 1)) + 1 : 0;
        if (size !== cal.level.size) this.#buildCalendar(Math.max(0, cal.level.size - 1));
      }
      return cal.level;
    }
    this.#calendar = { buckets: g, level: new Level(this.#fields) };
    this.#buildCalendar(0);
    return this.#calendar.level;
  }

  /**
   * Items from aligned position `k` on were appended or changed (items before
   * it are as they were): bring the built levels up to date.
   */
  update(k: number): void {
    if (this.#levels.length === 0 && !this.#calendar) return;
    const src = this.source;
    const n = src.count();
    if (n === 0 || k >= n) {
      if (n === 0) this.reset();
      return;
    }
    if (this.#calendar) this.#buildCalendar(this.#calendar.buckets.of(src.index(k)));
    // Bucket of the first changed item; every bucket from it on is rebuilt.
    let j = src.index(k) >> 1;
    for (let L = 1; L <= this.#levels.length; L++) {
      this.#build(L, j);
      j >>= 1;
    }
  }

  /**
   * The smallest (`'min'`) or largest (`'max'`) value of `field` over items
   * at timeline indices `from` to `to` (inclusive): full buckets from the
   * coarsest level that fits, partial edges from finer ones. `leaf` is the
   * same field for a single item. Infinity (or -Infinity) when there are none.
   */
  extreme(field: F, op: 'min' | 'max', from: number, to: number): number {
    const src = this.source;
    const n = src.count();
    if (n === 0) return op === 'min' ? Infinity : -Infinity;
    const last = src.index(n - 1);
    let lo = Math.max(0, Math.ceil(from));
    let hi = Math.min(last, Math.floor(to)) + 1;
    let out = op === 'min' ? Infinity : -Infinity;
    const take = (v: number) => {
      this.reads++;
      if (op === 'min' ? v < out : v > out) out = v;
    };
    const leaf = (index: number) => {
      const k = src.itemAt(index);
      if (k >= 0) take(src.value(k, field));
      else this.reads++;
    };
    // Bottom-up segment tree walk over the bucket keys of each level.
    for (let L = 0; lo < hi; L++) {
      if (lo & 1) {
        if (L === 0) leaf(lo);
        else take(this.get(L, lo, field));
        lo++;
      }
      if (hi & 1) {
        hi--;
        if (L === 0) leaf(hi);
        else take(this.get(L, hi, field));
      }
      lo >>= 1;
      hi >>= 1;
    }
    return out;
  }

  /** Recompute calendar buckets `from` on from the items. */
  #buildCalendar(from: number): void {
    const cal = this.#calendar;
    if (!cal) return;
    const { buckets, level } = cal;
    const src = this.source;
    const n = src.count();
    const size = n > 0 ? buckets.of(src.index(n - 1)) + 1 : 0;
    from = Math.max(0, Math.min(from, level.size, size));
    level.resize(size, from, this.#fields);
    const { counts, values } = level;
    for (let j = from; j < size; j++) {
      counts[j] = 0;
      for (const f of this.#fields) values[f][j] = IDENTITY[this.merges[f]];
    }
    for (let k = lowerBound(src, buckets.start(from)); k < n; k++) {
      const j = buckets.of(src.index(k));
      if (j < from) continue;
      counts[j]!++;
      for (const f of this.#fields) values[f][j] = merge(this.merges[f], values[f][j]!, src.value(k, f));
    }
  }

  private level(L: number): Level<F> {
    while (this.#levels.length < L) {
      this.#levels.push(new Level(this.#fields));
      this.#build(this.#levels.length, 0);
    }
    return this.#levels[L - 1]!;
  }

  /** Recompute buckets `from` on of level `L` from the level below. */
  #build(L: number, from: number): void {
    const level = this.#levels[L - 1]!;
    const src = this.source;
    const n = src.count();
    const size = n > 0 ? (src.index(n - 1) >> L) + 1 : 0;
    from = Math.min(from, level.size, size);
    level.resize(size, from, this.#fields);
    const { counts, values } = level;
    for (let j = from; j < size; j++) {
      counts[j] = 0;
      for (const f of this.#fields) values[f][j] = IDENTITY[this.merges[f]];
    }
    if (L === 1) {
      // From the items themselves, starting at the first one in bucket `from`.
      for (let k = lowerBound(src, from << 1); k < n; k++) {
        const j = src.index(k) >> 1;
        counts[j]!++;
        for (const f of this.#fields) values[f][j] = merge(this.merges[f], values[f][j]!, src.value(k, f));
      }
      return;
    }
    const below = this.#levels[L - 2]!;
    for (let j = from; j < size; j++) {
      for (const child of [2 * j, 2 * j + 1]) {
        if (child >= below.size || below.counts[child] === 0) continue;
        counts[j]! += below.counts[child]!;
        for (const f of this.#fields) values[f][j] = merge(this.merges[f], values[f][j]!, below.values[f][child]!);
      }
    }
  }
}

function merge(op: Merge, acc: number, v: number): number {
  switch (op) {
    case 'first':
      return Number.isNaN(acc) ? v : acc;
    case 'last':
      return v;
    case 'min':
      return v < acc ? v : acc;
    case 'max':
      return v > acc ? v : acc;
    case 'sum':
      return acc + v;
  }
}

/** First item at or after timeline index `index`. */
function lowerBound(src: PyramidSource<string>, index: number): number {
  return bisect(src.count(), (i) => src.index(i) < index);
}

/**
 * The level for a bar spacing of `spacing` device px: the smallest whose
 * buckets are at least `MIN_BUCKET_PX` wide, 0 when single bars already are.
 */
export function groupLevel(spacing: number): number {
  if (!(spacing > 0) || spacing >= MIN_BUCKET_PX) return 0;
  return Math.min(MAX_LEVEL, Math.ceil(Math.log2(MIN_BUCKET_PX / spacing)));
}

/** Narrowest bucket drawn, in device px: about one bucket per two pixels. */
export const MIN_BUCKET_PX = 2;
/** Coarsest level: 2^30 bars per bucket is more than any timeline holds. */
const MAX_LEVEL = 30;

/** What a bucket of line points keeps: its first, lowest, highest and last value. */
export const LINE_MERGES = { first: 'first', low: 'min', high: 'max', last: 'last' } as const;
export type LineField = keyof typeof LINE_MERGES;

/**
 * The vertices of a grouped line: for each non-empty bucket in view, its
 * first, lowest, highest and last value, all at the bucket's centre. The line
 * path keeps all four in one pixel column, so spikes inside a bucket stay
 * visible. Buffers are reused frame after frame.
 */
export class GroupedLine {
  index = new Float64Array(64);
  value = new Float64Array(64);
  length = 0;
  /** Vertex each bucket's four start at, for `snapColumns`. */
  #starts = new Int32Array(16);
  private buckets = 0;

  /**
   * Fill with the buckets of `g` (a level, or a bucketing) covering timeline
   * indices `from` to `to`, plus one either side. With `breakGaps`, a NaN
   * vertex separates buckets that are not next to each other, so the line
   * breaks there.
   */
  fill(p: Pyramid<LineField>, g: number | Buckets, from: number, to: number, breakGaps = false): this {
    this.length = 0;
    this.buckets = 0;
    const b = typeof g === 'number' ? new PowerBuckets(g) : g;
    const [ja, jb] = bucketRange(from, to, b, p.size(b));
    let prev = -2;
    for (let j = Math.max(0, ja - 1); j <= Math.min(p.size(b) - 1, jb + 1); j++) {
      if (p.count(b, j) === 0) continue;
      const center = bucketCenter(b, j);
      if (breakGaps && prev >= 0 && j !== prev + 1) this.#push(center, NaN);
      prev = j;
      if (this.buckets === this.#starts.length) {
        const starts = new Int32Array(this.buckets * 2);
        starts.set(this.#starts);
        this.#starts = starts;
      }
      this.#starts[this.buckets++] = this.length;
      this.#push(center, p.get(b, j, 'first'));
      this.#push(center, p.get(b, j, 'low'));
      this.#push(center, p.get(b, j, 'high'));
      this.#push(center, p.get(b, j, 'last'));
    }
    return this;
  }

  /**
   * Move each bucket's lowest, highest and last value into the pixel column
   * of its centre, the highest first when `highFirst`, leaving its first value
   * at the centre. Index `i` is at css x `i * x[0] + x[1]`, and the column is
   * that x rounded. That is where a path that reduces each pixel column to its
   * first, top, bottom and last value puts them, as the canvas line does
   * (`buildLinePath`); the GPU draws the vertices as they are.
   * With `forward`, a first value right of its column moves there too, so the
   * line never steps back: fills need each segment to run left to right.
   */
  snapColumns(x: readonly [scale: number, offset: number], highFirst: boolean, forward: boolean): void {
    const { index, value } = this;
    const [scale, offset] = x;
    for (let b = 0; b < this.buckets; b++) {
      const s = this.#starts[b]!;
      const at = (Math.round(index[s]! * scale + offset) - offset) / scale;
      index[s + 1] = index[s + 2] = index[s + 3] = at;
      if (forward && at < index[s]!) index[s] = at;
      if (highFirst) {
        const low = value[s + 1]!;
        value[s + 1] = value[s + 2]!;
        value[s + 2] = low;
      }
    }
  }

  #push(index: number, value: number): void {
    if (this.length === this.index.length) {
      const index = new Float64Array(this.length * 2);
      const value = new Float64Array(this.length * 2);
      index.set(this.index);
      value.set(this.value);
      this.index = index;
      this.value = value;
    }
    this.index[this.length] = index;
    this.value[this.length] = value;
    this.length++;
  }
}
