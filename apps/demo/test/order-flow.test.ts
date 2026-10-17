// The order-flow page under the test environment: synthetic trades in, footprint and TPO data out.
import { afterAll, expect, it, vi } from 'vitest';
import type { Chart, CustomSeries, FootprintBar, TpoColumn } from '@charton/core';
import { flushFrames, installTestEnvironment } from '@charton/core/testing';

const env = installTestEnvironment({ width: 960, height: 400 });
afterAll(() => {
  vi.useRealTimers();
  env.uninstall();
});

/** The custom series on a chart the page made (the hidden candles come first). */
function custom<T extends { time: number }>(chart: Chart): CustomSeries<T, object> {
  return chart.panes[0]!.series[1] as unknown as CustomSeries<T, object>;
}

it('builds footprint bars and TPO columns from synthetic trades, and keeps them live', async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 0, 6, 12, 2), toFake: ['setInterval', 'Date'] });
  const controls = { addEventListener: () => {} };
  Object.assign(document, { getElementById: (id: string) => (id === 'footprint' || id === 'tpo' ? env.container() : controls) });
  await import('../src/order-flow');
  const { footprintChart, tpoChart } = window as unknown as { footprintChart: Chart; tpoChart: Chart };
  flushFrames();

  const footprint = custom<FootprintBar>(footprintChart).data;
  const tpo = custom<TpoColumn>(tpoChart).data;
  // From midnight three days back to 12:02: 5-minute bars and 30-minute periods, the newest forming.
  expect(footprint.length).toBe(3.5 * 288 + 1);
  expect(tpo.length).toBe(3.5 * 48 + 1);
  expect(new Set(tpo.map((c) => c.profile)).size).toBe(4);
  const last = footprint[footprint.length - 1]!;
  expect(last.rows.length).toBeGreaterThan(3);
  expect([last.buy > 0, last.sell > 0, last.poc >= 0]).toEqual([true, true, true]);

  // A minute later the forming bar has more volume, and a new period starts after half an hour.
  const volume = last.volume;
  vi.advanceTimersByTime(60_000);
  expect(custom<FootprintBar>(footprintChart).data.at(-1)!.volume).toBeGreaterThan(volume);
  vi.advanceTimersByTime(30 * 60_000);
  expect(custom<TpoColumn>(tpoChart).data.length).toBe(3.5 * 48 + 2);
}, 30_000);
