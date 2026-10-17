import type { Time } from '../types';
import { compileSession, sessionIntervals, type CompiledSession, type SessionSchedule } from './session';
import type { Zone } from './timezone';

const DAY = 86400;
/** Trading days searched ahead for the next open or close (long holidays included), and behind for the last close. */
const HORIZON_DAYS = 21;

/**
 * Where the market stands: `open` within regular hours, `pre` and `post`
 * within extended hours before and after them, `closed` otherwise.
 */
export type MarketPhase = 'pre' | 'open' | 'post' | 'closed';

/** Where a market stands at a moment, from `marketPhase`: its current phase and the next change. */
export interface MarketStatus {
  phase: MarketPhase;
  /** The next phase change, or null when none falls within three weeks (or the market never closes). */
  next: { phase: MarketPhase; time: Time } | null;
}

type Interval = [number, number];

/**
 * Market phase at `now` for regular hours `regular` and, optionally, wider
 * extended hours `extended`, both in `zone`. Each takes a `SessionSchedule`
 * or a `CompiledSession` from `compileSession`.
 *
 * A null `regular`, or one that is always open, means the market never
 * closes. A null `extended` means no extended hours; an always-open
 * `SessionSchedule` (e.g. `ALWAYS_OPEN`) means extended hours around the
 * clock. Extended hours are `pre` until regular hours open within the same
 * stretch, and `post` once regular hours have closed in it.
 */
export function marketPhase(
  regular: SessionSchedule | CompiledSession | null,
  extended: SessionSchedule | CompiledSession | null,
  zone: Zone,
  now: Time,
): MarketStatus {
  const regularHours = regular && compiled(regular);
  if (!regularHours) return { phase: 'open', next: null };
  const wall = zone.wall(now);
  const day = Math.floor(wall / DAY);
  const from = day - HORIZON_DAYS;
  const to = day + HORIZON_DAYS;
  const reg = sessionIntervals(regularHours, from, to);
  const ext = extended ? intervals(extended, from, to) : [];
  // A stretch that reaches the end of the window may run on: its end is unknown.
  const horizon = (to + 1) * DAY;
  const at = (list: Interval[], t: number) => list.find(([a, b]) => t >= a && t < b);
  const after = (list: Interval[], t: number) => list.find(([a]) => a > t);
  const time = (w: number) => zone.fromWall(w);

  const open = at(reg, wall);
  if (open) {
    const end = open[1];
    return { phase: 'open', next: { phase: at(ext, end) ? 'post' : 'closed', time: time(end) } };
  }
  const stretch = at(ext, wall);
  const nextOpen = after(reg, wall);
  if (stretch) {
    const [start, end] = stretch;
    // Pre-market until regular hours have closed within this stretch.
    const closedInStretch = reg.some(([, close]) => close >= start && close <= wall);
    if (nextOpen && nextOpen[0] <= end) {
      return { phase: closedInStretch ? 'post' : 'pre', next: { phase: 'open', time: time(nextOpen[0]) } };
    }
    return { phase: 'post', next: end >= horizon ? null : { phase: 'closed', time: time(end) } };
  }
  const nextExtended = after(ext, wall);
  if (nextExtended && (!nextOpen || nextExtended[0] < nextOpen[0])) {
    const pre = nextOpen && nextOpen[0] <= nextExtended[1];
    return { phase: 'closed', next: { phase: pre ? 'pre' : 'post', time: time(nextExtended[0]) } };
  }
  return { phase: 'closed', next: nextOpen ? { phase: 'open', time: time(nextOpen[0]) } : null };
}

function compiled(session: SessionSchedule | CompiledSession): CompiledSession | null {
  return 'hasOvernight' in session ? session : compileSession(session);
}

/** Wall-clock intervals of `session`; an always-open schedule is one stretch over the whole window. */
function intervals(session: SessionSchedule | CompiledSession, from: number, to: number): Interval[] {
  const hours = compiled(session);
  return hours ? sessionIntervals(hours, from, to) : [[from * DAY, (to + 1) * DAY]];
}
