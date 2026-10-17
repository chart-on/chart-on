import type { Time } from '../types';

/** How many of the indices [0, n) pass `before`, by binary search: it must hold for a prefix of them and fail for the rest. */
export function bisect(n: number, before: (i: number) => boolean): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (before(mid)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose time is past `time` (`>=` when `inclusive`, else `>`), in time-sorted data. */
export function boundByTime(data: readonly { time: Time }[], time: Time, inclusive: boolean): number {
  return bisect(data.length, (i) => {
    const t = data[i]!.time;
    return t < time || (!inclusive && t === time);
  });
}

/** The point at exactly `time`, if any. */
export function atTime<T extends { time: Time }>(data: readonly T[], time: Time): T | undefined {
  const point = data[boundByTime(data, time, true)];
  return point?.time === time ? point : undefined;
}
