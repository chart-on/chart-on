import type { Time } from '../types';

const DAY = 86400;
/**
 * Offsets are sampled every this many days. A zone that changed its offset and
 * back between two samples would be missed. In the timezone data the shortest
 * such change (1850 to 2100, every zone) lasts about a week, so three days
 * leaves twice that margin while asking `Intl` a third as often as daily.
 */
const SAMPLE_DAYS = 3;
const SAMPLE = SAMPLE_DAYS * DAY;
/** Offsets are worked out in blocks of this many days (about a year, a multiple of `SAMPLE_DAYS`). */
const BLOCK_DAYS = 366;
const BLOCK = BLOCK_DAYS * DAY;
/** Blocks kept per zone (centuries of data); past this the cache restarts. */
const MAX_CACHED_BLOCKS = 1000;

/**
 * The offsets in one block: `offsets[i]` applies from `starts[i]` up to the
 * next start (or the end of the block). `starts[0]` is the block start.
 */
interface Block {
  starts: number[];
  offsets: number[];
}

/** `M/D/YYYY, HH:MM:SS`, the shape en-US `format()` gives for the options below. */
const WALL_PATTERN = /^(\d+)\/(\d+)\/(\d+),? (\d+):(\d+):(\d+)$/;

/** Wall-clock date and time in `timeZone` as en-US numbers (`M/D/YYYY, HH:MM:SS`); throws a RangeError for an unknown zone. */
export function wallFormat(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
}

/**
 * An IANA timezone. Converts between unix time and wall-clock time ("what the
 * clock on the wall shows"), DST-correct via `Intl`. Wall time is expressed as
 * seconds read with UTC getters, so `new Date(wall * 1000).getUTCHours()` is
 * the local hour.
 *
 * `Intl` lookups are slow (microseconds each), so the zone finds where its
 * offset changes once per block and answers every other lookup from that.
 */
export class Zone {
  readonly isUtc: boolean;
  private readonly format: Intl.DateTimeFormat | null;
  readonly #blocks = new Map<number, Block>();
  /** The span the last `offset` call landed in, `[from, to)` with one offset. */
  #spanFrom = 0;
  #spanTo = 0;
  #spanOffset = 0;

  /** Throws a RangeError for unknown timezone names. */
  constructor(readonly name: string) {
    const fmt = wallFormat(name);
    this.isUtc = fmt.resolvedOptions().timeZone === 'UTC';
    this.format = this.isUtc ? null : fmt;
  }

  /** Seconds to add to unix time to get wall-clock time at `time`. */
  offset(time: Time): number {
    if (!this.format) return 0;
    // Consecutive bars nearly always share the span of the previous call.
    if (time >= this.#spanFrom && time < this.#spanTo) return this.#spanOffset;
    const index = Math.floor(time / BLOCK);
    let block = this.#blocks.get(index);
    if (!block) {
      block = this.#scanBlock(index * BLOCK);
      if (this.#blocks.size >= MAX_CACHED_BLOCKS) this.#blocks.clear();
      this.#blocks.set(index, block);
    }
    const { starts, offsets } = block;
    let i = starts.length - 1;
    while (starts[i]! > time) i--;
    this.#spanFrom = starts[i]!;
    this.#spanTo = i + 1 < starts.length ? starts[i + 1]! : (index + 1) * BLOCK;
    this.#spanOffset = offsets[i]!;
    return this.#spanOffset;
  }

  /**
   * Offsets across the block starting at `start`: sampled every `SAMPLE_DAYS`,
   * with the exact second of each change found by binary search between two
   * samples.
   * Changes do not always fall on a whole hour (some zones switch at :30), and
   * historic offsets can have seconds, so the search goes to the second.
   */
  #scanBlock(start: number): Block {
    const starts = [start];
    const offsets = [this.#lookup(start)];
    for (let day = SAMPLE_DAYS; day <= BLOCK_DAYS; day += SAMPLE_DAYS) {
      const end = start + day * DAY;
      const target = this.#lookup(end);
      // More than one change between two samples is found one at a time.
      while (offsets[offsets.length - 1] !== target) {
        const before = offsets[offsets.length - 1]!;
        // Smallest second in (lo, end] whose offset is no longer `before`.
        let lo = Math.max(starts[starts.length - 1]!, end - SAMPLE);
        let hi = end;
        let after = target;
        while (hi - lo > 1) {
          const mid = Math.floor((lo + hi) / 2);
          const o = this.#lookup(mid);
          if (o === before) lo = mid;
          else {
            hi = mid;
            after = o;
          }
        }
        // A change at the very end of the block belongs to the next block.
        if (hi >= start + BLOCK) break;
        starts.push(hi);
        offsets.push(after);
      }
    }
    return { starts, offsets };
  }

  /** Uncached offset at `time` (whole seconds) via `Intl`. */
  #lookup(time: Time): number {
    const date = new Date(time * 1000);
    const m = WALL_PATTERN.exec(this.format!.format(date));
    let wall: number;
    if (m) {
      wall = Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!, +m[4]! % 24, +m[5]!, +m[6]!);
    } else {
      // Not the usual shape (e.g. an era for very old dates): read the parts.
      const parts: Record<string, number> = {};
      for (const p of this.format!.formatToParts(date)) parts[p.type] = Number(p.value);
      wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour! % 24, parts.minute!, parts.second!);
    }
    return wall / 1000 - time;
  }

  wall(time: Time): number {
    return time + this.offset(time);
  }

  /**
   * Unix time of a wall-clock time. Ambiguous times (clocks going back) resolve
   * to the first occurrence; skipped times (clocks going forward) move forward.
   */
  fromWall(wall: number): Time {
    // Transitions are months apart, so the offsets a day either side are the
    // ones before and after any transition near this time.
    const candidates = [wall - this.offset(wall - DAY), wall - this.offset(wall + DAY)];
    const valid = candidates.filter((t) => this.wall(t) === wall);
    return valid.length > 0 ? Math.min(...valid) : Math.max(...candidates);
  }

  /** A Date whose UTC fields are the wall-clock fields at `time`. */
  date(time: Time): Date {
    return new Date(this.wall(time) * 1000);
  }
}

/** The UTC timezone: wall-clock times equal unix times. */
export const UTC = new Zone('UTC');

const zones = new Map<string, Zone>([['UTC', UTC]]);

/** The `timezone` value meaning the machine's own timezone. */
export const LOCAL_TIMEZONE = 'local';

/**
 * The machine's IANA timezone, or `'UTC'` when it is unavailable or not a
 * name `Intl` accepts. `resolve` reads the name; tests pass their own.
 */
export function localTimeZone(resolve: () => string | undefined = () => new Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  try {
    const name = resolve();
    if (!name) return 'UTC';
    zoneOf(name);
    return name;
  } catch {
    return 'UTC';
  }
}

/** Shared `Zone` instance for a timezone name; `'local'` is the machine's timezone. */
export function zoneOf(name: string): Zone {
  if (name === LOCAL_TIMEZONE) return zoneOf(localTimeZone());
  let z = zones.get(name);
  if (!z) {
    z = new Zone(name);
    zones.set(name, z);
  }
  return z;
}
