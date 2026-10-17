import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { percentBaseBar } from '../src/scales';
import { Timeline } from '../src/timeline';
import type { Bar } from '../src/types';

const HOUR = 3600;
const DAY = 86400;

/** Hourly bars 08:00 to 16:00 UTC over `days` days, skipping the weekend after day 4 (a Friday). */
function sessionTimes(days: number): number[] {
  const times: number[] = [];
  // 1970-01-05 was a Monday.
  for (let d = 0, day = 4; d < days; day++) {
    if (day % 7 === 3 || day % 7 === 2) continue; // Saturday, Sunday
    for (let h = 8; h <= 16; h++) times.push(day * DAY + h * HOUR);
    d++;
  }
  return times;
}

function timeline(times: number[]): Timeline {
  const t = new Timeline();
  t.set(times);
  return t;
}

describe('percentBaseBar', () => {
  const tl = timeline(sessionTimes(6)); // Mon to Fri, then the next Monday
  const day = (i: number) => i * 9; // first bar of trading day i

  it('reads the first visible bar by default', () => {
    expect(percentBaseBar('firstVisible', tl, 12.4, 40)).toEqual({ index: 12.4, field: 'close' });
  });

  it('opens the trading day holding the newest visible bar', () => {
    expect(percentBaseBar('sessionOpen', tl, 0, day(2) + 4)).toEqual({ index: day(2), field: 'open' });
    // Past the last bar: the last trading day.
    expect(percentBaseBar('sessionOpen', tl, 0, 1e6)).toEqual({ index: day(5), field: 'open' });
  });

  it('takes the close before that day, across a weekend', () => {
    // The Monday after the weekend measures from Friday's last bar.
    expect(percentBaseBar('previousClose', tl, 0, day(5) + 3)).toEqual({ index: day(5) - 1, field: 'close' });
    // The very first day has no close before it: its open instead.
    expect(percentBaseBar('previousClose', tl, 0, 3)).toEqual({ index: 0, field: 'open' });
  });

  it('anchors a time to the first bar at or after it', () => {
    const times = tl.times;
    expect(percentBaseBar({ time: times[20]! }, tl, 0, 50)).toEqual({ index: 20, field: 'close' });
    // Saturday: the next bar is Monday's first.
    expect(percentBaseBar({ time: 9 * DAY }, tl, 0, 50)).toEqual({ index: day(5), field: 'close' });
    expect(percentBaseBar({ time: times[times.length - 1]! + DAY }, tl, 0, 50).index).toBe(times.length - 1);
  });

  it('treats every daily bar as its own session', () => {
    const daily = timeline(Array.from({ length: 10 }, (_, i) => i * DAY));
    expect(percentBaseBar('sessionOpen', daily, 0, 7)).toEqual({ index: 7, field: 'open' });
    expect(percentBaseBar('previousClose', daily, 0, 7)).toEqual({ index: 6, field: 'close' });
  });
});

describe('percent base setting', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  const times = sessionTimes(3);
  const bars: Bar[] = times.map((time, i) => ({ time, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i }));

  function chart() {
    const c = new Chart(fakeContainer(), { timezone: 'UTC' });
    charts.push(c);
    c.addCandles({ animate: false }).setData(bars);
    c.setPriceScaleMode('percent');
    return c;
  }

  function frame(c: Chart): void {
    c.invalidate();
    (c as unknown as { render(dt: number): boolean }).render(0);
  }

  it('measures from the session open, the previous close or a time', () => {
    const c = chart();
    const scale = c.panes[0]!.price;
    c.setPriceScaleOptions({ percentBase: 'sessionOpen' });
    frame(c);
    expect(scale.percentBase).toBe(bars[18]!.open);
    c.setPriceScaleOptions({ percentBase: 'previousClose' });
    frame(c);
    expect(scale.percentBase).toBe(bars[17]!.close);
    c.setPriceScaleOptions({ percentBase: { time: times[4]! } });
    frame(c);
    expect(scale.percentBase).toBe(bars[4]!.close);
    expect(c.getPriceScaleOptions()!.percentBase).toEqual({ time: times[4] });
  });

  it('measures every linked scale from the root scale bar', () => {
    const c = chart();
    const pane = c.panes[0]!;
    const other = c.addLine({ priceScale: 'cmp' });
    other.setData(times.map((time, i) => ({ time, value: 50 + i * 2 })));
    const cmp = pane.scale('cmp');
    cmp.side = 'none';
    cmp.link = pane.price;
    c.setPriceScaleOptions({ percentBase: { time: times[6]! } });
    frame(c);
    expect(pane.price.percentBase).toBe(bars[6]!.close);
    expect(cmp.percentBase).toBe(50 + 6 * 2);
  });

  it('rejects an unknown base and keeps a copy the caller cannot change', () => {
    const c = chart();
    expect(() => c.setPriceScaleOptions({ percentBase: 'open' as never })).toThrow(/percentBase/);
    expect(() => c.setPriceScaleOptions({ percentBase: { time: Number.NaN } })).toThrow(/percentBase/);
    const base = { time: times[2]! };
    c.setPriceScaleOptions({ percentBase: base });
    base.time = 0;
    expect(c.getPriceScaleOptions()!.percentBase).toEqual({ time: times[2] });
  });

  it('saves the base in layouts and loads it back', () => {
    const c = chart();
    c.setPriceScaleOptions({ percentBase: 'previousClose' });
    const saved = JSON.parse(JSON.stringify(c.serializeLayout()));
    const d = chart();
    expect(d.loadLayout(saved).errors).toEqual([]);
    expect(d.getPriceScaleOptions()!.percentBase).toBe('previousClose');
    saved.panes[0].scales.right.percentBase = 'tomorrow';
    const e = chart();
    expect(e.loadLayout(saved).errors.map((p) => p.part).join(' ')).toMatch(/percentBase/);
  });
});
