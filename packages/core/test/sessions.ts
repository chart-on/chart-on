import type { SessionRange, SessionSchedule, Weekday } from '../src/util/session';

/** Monday to Friday, the trading days of most exchanges. */
export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const EVERY_DAY: readonly Weekday[] = [...WEEKDAYS, 'sat', 'sun'];

/** A schedule with the same `[start, end]` ranges on each of `days`, every day by default. */
export function hours(ranges: readonly (readonly [string, string])[], days: readonly Weekday[] = EVERY_DAY): SessionSchedule {
  const day = (): SessionRange[] => ranges.map(([start, end]) => ({ start, end }));
  return { weekly: Object.fromEntries(days.map((d) => [d, day()])) };
}
