import type { Chart } from './chart';
import { isActivityInterval, isCalendarInterval, nextIntervalStart, symbolZone } from './data/interval';
import type { Time } from './types';
import { formatCountdown } from './util/format';

// The time left in the newest bar, under the main series' last price label (the `countdown`
// feature flag). The `countdown()` plugin gives the chart this, so a chart without it leaves it out.

/** @internal Time left in the newest bar of `chart`, or undefined when it is not forming now. */
export function barCountdown(chart: Chart): string | undefined {
  // Trade and volume bars close on activity, not on time.
  const interval = chart.data?.interval;
  if (interval && isActivityInterval(interval)) return undefined;
  const timeline = chart.timeline;
  const last = timeline.times[timeline.lastIndex];
  if (last === undefined) return undefined;
  const close = barClose(chart, last);
  const remaining = close - Date.now() / 1000;
  if (!(remaining > 0) || remaining > close - last) return undefined;
  return formatCountdown(remaining);
}

/** When the bar opening at `time` (the newest) closes. */
function barClose(chart: Chart, time: Time): Time {
  const data = chart.data;
  let calendar = false;
  try {
    calendar = !!data?.interval && isCalendarInterval(data.interval);
  } catch {
    // Not an interval the chart can parse: measure the bars instead.
  }
  // Months, quarters and years vary in length; they follow the symbol's calendar.
  if (calendar) return nextIntervalStart(time, data!.interval!, symbolZone(data!.symbol?.timezone));
  const interval = chart.timeline.interval;
  // Daily and longer bars close at local midnight, which DST can move by an hour.
  const zone = chart.timeline.zone;
  return interval >= 86400 ? zone.fromWall(zone.wall(time) + interval) : time + interval;
}
