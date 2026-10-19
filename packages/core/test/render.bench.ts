/**
 * Benchmarks for large datasets: `pnpm build && pnpm bench`.
 *
 * They run under Node in the test environment, where WebGL and Canvas2D calls
 * do nothing. So the frame numbers measure the chart's CPU-side work per frame
 * (layout, autoscale, visible-range scans, grouping, vertex packing, axis and
 * label code), not GPU time or real paint cost. They catch regressions in that
 * work; they do not predict frame rate in a browser.
 *
 * Only the public API is used, so CI can run this file against the base
 * branch's build too and compare (`scripts/compare-bench.mjs`).
 *
 * `render-counts.test.ts` checks the GPU work of the same scenarios (draw
 * calls, instances, uploads, memory) as part of `pnpm test`.
 */
import { afterAll, describe, test } from 'vitest';
import { Chart, type ChartOptions } from '@chart-on/core';
import { driveFrames, flushFrames, installTestEnvironment, sampleBars } from '@chart-on/core/testing';

const MILLION = 1_000_000;
const env = installTestEnvironment({ width: 1280, height: 720 });
const charts: Chart[] = [];
afterAll(() => {
  charts.splice(0).forEach((c) => c.destroy());
  env.uninstall();
});

function newChart(options: Partial<ChartOptions> = {}): Chart {
  const chart = new Chart(env.container(), options);
  charts.push(chart);
  return chart;
}

describe('setData', () => {
  for (const count of [100_000, MILLION]) {
    test(`${count.toLocaleString('en')} candles`, async ({ bench }) => {
      const bars = sampleBars({ count });
      const series = newChart().addCandles();
      await bench('setData', () => series.setData(bars)).run({ iterations: 10, time: 0 });
    });
  }
});

describe(`frame with ${MILLION.toLocaleString('en')} candles`, () => {
  const data = sampleBars({ count: MILLION });

  // Each iteration changes the view the way a drag or wheel would, then draws one frame.
  test('pan and zoom', async ({ bench }) => {
    const chart = newChart();
    chart.addCandles().setData(data);
    flushFrames();
    let at = 0;
    /** Scroll a few bars further each frame, wrapping within the data. */
    const pan = () => {
      at = (at + 7) % (MILLION - 10_000);
      chart.scrollToTime(data[5_000 + at]!.time, false);
      driveFrames();
    };
    let frame = 0;
    await bench.compare(
      bench('pan', { beforeAll: () => chart.setBarSpacing(6) }, pan),
      bench('zoom', () => {
        // In and out between 2 and 18 px per bar.
        chart.setBarSpacing(2 + Math.abs((frame++ % 32) - 16));
        driveFrames();
      }),
      // At the narrowest spacing without grouping: thousands of bars on screen.
      bench('pan zoomed out', { beforeAll: () => chart.setBarSpacing(0.5) }, pan),
    );
  });

  test('zoom with every bar on screen, grouped', async ({ bench }) => {
    const chart = newChart({ grouping: { mode: 'pixel' } });
    chart.addCandles().setData(data);
    chart.fitContent(false);
    flushFrames();
    const fit = chart.barSpacing;
    let frame = 0;
    await bench('zoom grouped', () => {
      // Between all bars and an eighth of them on screen.
      chart.setBarSpacing(fit * (1 + Math.abs((frame++ % 16) - 8) * 0.875));
      driveFrames();
    }).run();
  });
});
