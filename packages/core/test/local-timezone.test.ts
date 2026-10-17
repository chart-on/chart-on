import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { localTimeZone, zoneOf } from '../src/util/timezone';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

function chart(options = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  return c;
}

/** Pretend the machine runs in `timeZone`, whatever zone the tests run in. */
function machineZone(timeZone: string | undefined): void {
  const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...resolved.call(this), timeZone } as Intl.ResolvedDateTimeFormatOptions;
  });
}

describe('localTimeZone', () => {
  it('returns the name the resolver reports', () => {
    expect(localTimeZone(() => 'Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it('falls back to UTC for a missing or unknown name', () => {
    expect(localTimeZone(() => undefined)).toBe('UTC');
    expect(localTimeZone(() => '')).toBe('UTC');
    expect(localTimeZone(() => 'Not/AZone')).toBe('UTC');
    expect(
      localTimeZone(() => {
        throw new Error('no Intl');
      }),
    ).toBe('UTC');
  });

  it("resolves 'local' through zoneOf", () => {
    expect(zoneOf('local').name).toBe(localTimeZone());
  });
});

describe('chart timezone', () => {
  it("defaults to the machine's timezone", () => {
    machineZone('Asia/Tokyo');
    const c = chart();
    expect(c.zone.name).toBe('Asia/Tokyo');
    expect(c.zone.offset(0)).toBe(9 * 3600);
  });

  it('falls back to UTC when the machine reports no timezone', () => {
    machineZone(undefined);
    expect(chart().zone.name).toBe('UTC');
  });

  it('loads a long hourly history in a DST zone without an Intl call per bar', () => {
    machineZone('America/Chicago');
    const c = chart();
    expect(c.zone.name).toBe('America/Chicago');
    const start = Date.UTC(2014, 0, 1) / 1000;
    const bars = Array.from({ length: 100_000 }, (_, i) => ({ time: start + i * 3600, open: 1, high: 2, low: 0, close: 1 }));
    // `format` is a getter on the prototype, though TypeScript types it as a method.
    const format = vi.spyOn(Intl.DateTimeFormat.prototype as unknown as { format: object }, 'format', 'get');
    const formatToParts = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    c.addCandles().setData(bars);
    // About a day's worth of lookups per year of data, not two per hour.
    expect(format.mock.calls.length + formatToParts.mock.calls.length).toBeLessThan(10_000);
  });

  it("switches between 'UTC', a named zone and 'local' at runtime", () => {
    machineZone('Asia/Tokyo');
    const c = chart({ timezone: 'UTC' });
    expect(c.zone.name).toBe('UTC');
    c.applyOptions({ timezone: 'America/New_York' });
    expect(c.zone.name).toBe('America/New_York');
    c.applyOptions({ timezone: 'local' });
    expect(c.zone.name).toBe('Asia/Tokyo');
    c.applyOptions({ timezone: 'UTC' });
    expect(c.zone.isUtc).toBe(true);
  });
});
