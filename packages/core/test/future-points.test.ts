import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { Bar } from '../src/types';

const DAY = 86400;
/** 2024-01-01, a Monday. */
const MON = Date.UTC(2024, 0, 1) / 1000;

/** Daily bars on weekdays for `weeks` weeks: the last one is a Friday. */
function weekdayBars(weeks: number): Bar[] {
  const out: Bar[] = [];
  for (let d = 0; d < weeks * 7; d++) if (d % 7 < 5) out.push({ time: MON + d * DAY, open: 100, high: 101, low: 99, close: 100 });
  return out;
}

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function setup() {
  const c = new Chart(fakeContainer(), { timezone: 'UTC' });
  charts.push(c);
  const main = c.addCandles({ animate: false });
  main.setData(weekdayBars(4));
  return { c, main };
}

const alignOf = (s: unknown) => (s as { align: { count: number; index: Int32Array } }).align;

describe('points after the last bar', () => {
  it('sit on the projected bars, skipping closed days', () => {
    const { c } = setup();
    const n = c.timeline.length;
    const future = c.timeline.projected(5);
    const forecast = c.addLine();
    // The Saturday after the last bar (a Friday) is not a projected bar, so that point has no slot.
    const saturday = c.timeline.times[n - 1]! + DAY;
    forecast.setData([saturday, ...future].map((time, i) => ({ time, value: 100 + i })));
    const align = alignOf(forecast);
    expect(align.count).toBe(5);
    expect([...align.index.subarray(0, 5)]).toEqual([n, n + 1, n + 2, n + 3, n + 4]);
    expect(c.timeline.slotOf(future[2]!)).toBe(n + 2);
    expect(c.timeline.slotOf(saturday)).toBe(-1);
  });

  it('count in autoscale and the legend where they are in view', () => {
    const { c } = setup();
    const future = c.timeline.projected(3);
    const forecast = c.addLine();
    forecast.setData(future.map((time, i) => ({ time, value: 200 + i })));
    const n = c.timeline.length;
    expect(forecast.priceRange(n - 1, n + 2)).toEqual([200, 202]);
    expect(forecast.legend(n + 1).parts[0]!.text).toBe(forecast.formatValue(201));
  });

  it('move when a bar arrives where the projection had none', () => {
    const { c, main } = setup();
    const n = c.timeline.length;
    const monday = c.timeline.projected(1)[0]!;
    const forecast = c.addLine();
    forecast.setData([{ time: monday, value: 1 }]);
    expect(alignOf(forecast).index[0]).toBe(n);
    // An unexpected Saturday bar: Monday is now one bar further.
    main.update({ time: monday - 2 * DAY, open: 100, high: 101, low: 99, close: 100 });
    expect(alignOf(forecast).count).toBe(1);
    expect(alignOf(forecast).index[0]).toBe(n + 1);
  });

  it('keep a drawing three sessions ahead on its time as bars fill in', () => {
    const { c, main } = setup();
    const ahead = c.timeline.projected(3)[2]!;
    const index = c.timeline.indexFromTime(ahead);
    const { id } = c.drawings.add({ type: 'vline', pane: 0, points: [{ time: ahead, price: 100 }], style: {} });
    for (const time of c.timeline.projected(2)) main.update({ time, open: 100, high: 101, low: 99, close: 100 });
    expect(c.drawings.getAll().find((d) => d.id === id)!.points[0]!.time).toBe(ahead);
    expect(c.timeline.indexFromTime(ahead)).toBe(index);
  });
});
