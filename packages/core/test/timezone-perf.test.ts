import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer, recordingWebgl2 } from './fake-dom';
import { Chart } from '../src/chart';
import { TickWeight, computeTickWeights, tickWeight } from '../src/util/format';
import { Zone } from '../src/util/timezone';
import type { Bar } from '../src/types';

const HOUR = 3600;
const N = 1_000_000;
/** 2000-01-01; 1M hours run to about 2114, through many DST changes. */
const START = 946684800;

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
});

/** Milliseconds `run` takes, the fastest of `rounds` runs. */
function fastest(rounds: number, run: () => void): number {
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const t0 = performance.now();
    run();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

/**
 * Benchmark-style checks for #266. CI machines run in UTC, so these name
 * non-UTC zones explicitly. Each round builds a new `Zone`, so its offset
 * cache starts cold, as on the first `setData` after page load.
 *
 * Wall-clock bounds scale with the same work in UTC, so a busy machine that
 * slows both sides alike does not fail them. Unloaded, the zone costs a few
 * hundred milliseconds over UTC for 1M bars (well under twice the UTC cost);
 * the per-hour lookups this replaced cost seconds. A fixed margin over UTC
 * would shrink on a slow CI machine, where the cold offset scan slows too.
 * The deterministic guard against slower sampling is the `Intl` call budget
 * in `timezone.test.ts`.
 */
describe('timezone performance', () => {
  it.each(['America/New_York', 'Australia/Lord_Howe', 'America/St_Johns'])(
    'computes tick weights for 1M hourly bars in %s close to the UTC cost',
    (name) => {
      const times = Array.from({ length: N }, (_, i) => START + i * HOUR);
      const utc = fastest(2, () => computeTickWeights(times, new Zone('UTC')));
      const local = fastest(2, () => computeTickWeights(times, new Zone(name)));
      expect(local).toBeLessThan(2 * utc + 1000);
    },
    30_000,
  );

  it('sets 1M hourly bars on a chart in a non-UTC zone close to the UTC cost', () => {
    const data: Bar[] = Array.from({ length: N }, (_, i) => ({ time: START + i * HOUR, open: 10, high: 12, low: 8, close: 10 + (i % 7) }));
    const setData = (timezone: string) => {
      const c = new Chart(fakeContainer({ webgl: recordingWebgl2().context }), { timezone });
      charts.push(c);
      const t0 = performance.now();
      c.addCandles().setData(data.slice());
      return performance.now() - t0;
    };
    // Warm up the chart code itself, so the first timed run is not paying for that.
    setData('UTC');
    const utc = setData('UTC');
    // Charts share zones by name, so this is the zone's only cold run.
    const london = setData('Europe/London');
    expect(london).toBeLessThan(2 * utc + 1000);
  }, 30_000);
});

describe('tick weights', () => {
  /** The weight read with `Date` getters, the way it was computed before #266. */
  function viaDates(prev: number, curr: number, zone: Zone): number {
    const a = zone.date(prev);
    const b = zone.date(curr);
    const day = (d: Date) => Math.floor(d.getTime() / 86400000);
    if (day(a) !== day(b)) {
      if (a.getUTCFullYear() !== b.getUTCFullYear()) return TickWeight.Year;
      if (a.getUTCMonth() !== b.getUTCMonth()) return TickWeight.Month;
      return TickWeight.Day;
    }
    if (a.getUTCHours() !== b.getUTCHours()) return TickWeight.Hour;
    if (Math.floor(a.getUTCMinutes() / 15) !== Math.floor(b.getUTCMinutes() / 15)) return TickWeight.QuarterHour;
    return TickWeight.Minute;
  }

  it('match Date getters for odd steps, times before 1970 and half-hour zones', () => {
    for (const name of ['UTC', 'America/New_York', 'America/St_Johns', 'Asia/Kathmandu', 'Australia/Lord_Howe']) {
      const zone = new Zone(name);
      // A step of 7 min 13 s lands on every minute and hour sooner or later.
      for (const start of [-400_000_000, 0, 1_710_000_000]) {
        const times = Array.from({ length: 3000 }, (_, i) => start + i * 433);
        const weights = computeTickWeights(times, zone);
        for (let i = 1; i < times.length; i++) {
          const expected = viaDates(times[i - 1]!, times[i]!, zone);
          expect(weights[i], `${name} ${times[i]}`).toBe(expected);
          expect(tickWeight(times[i - 1]!, times[i]!, zone)).toBe(expected);
        }
      }
    }
    // About 90k assertions: a couple of seconds unloaded, past the 5 s default on a busy CI machine.
  }, 30_000);
});
