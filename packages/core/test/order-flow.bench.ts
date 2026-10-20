/**
 * Order-flow chart types (#110) with thousands of visible rows: `pnpm build && pnpm bench`.
 *
 * Like `render.bench.ts`, this runs under Node with no-op WebGL and Canvas2D,
 * so a number is the CPU-side work of one frame: the chart's layout and
 * autoscale plus the series' own draw code walking every visible row and
 * cell (shading, imbalances, text layout, batching). Compare it with the
 * candle frames of `render.bench.ts` and the 16.7 ms frame budget at 60 Hz;
 * Canvas2D paint comes on top in a browser.
 */
import { afterAll, describe, test, type TestContext } from 'vitest';
import { Chart, footprintFromRows, footprintSeries, tpoColumns, tpoSeries, type FootprintBar, type FootprintLevel } from '@chart-on/core';
import { driveFrames, flushFrames, installTestEnvironment, sampleBars } from '@chart-on/core/testing';
import { seededRandom } from '../src/util/random';

const env = installTestEnvironment({ width: 1280, height: 720 });
const charts: Chart[] = [];
afterAll(() => {
  charts.splice(0).forEach((c) => c.destroy());
  env.uninstall();
});

/** Footprint bars over sample bars: one row per `rowSize` from low to high, volume peaking near the close. */
function footprintBars(count: number, rowSize: number): FootprintBar[] {
  const random = seededRandom(7);
  return sampleBars({ count, interval: 300 }).map((bar) => {
    const levels: FootprintLevel[] = [];
    for (let price = bar.low; price <= bar.high; price += rowSize) {
      const weight = 1 / (1 + Math.abs(price - bar.close));
      levels.push({ price, buy: Math.round(random() * 400 * weight), sell: Math.round(random() * 400 * weight) });
    }
    return footprintFromRows(bar.time, levels, rowSize);
  });
}

/** A chart with hidden candles setting the time axis, as the demo shows order flow. */
function newChart(bars: ReturnType<typeof sampleBars>): Chart {
  const chart = new Chart(env.container(), { priceAxisWidth: 76 });
  charts.push(chart);
  const candles = chart.addCandles();
  candles.setData(bars);
  candles.setVisible(false);
  return chart;
}

/**
 * Pan a few bars per frame at the `text`, `cells` and `narrow` bar spacings (px), each showing the
 * series at another level of detail, and zoom from `narrow` to `text` and back.
 *
 * A frame's cost depends on the rows in view, so every task (warmup included) starts from the same
 * bar and cycles over the same 64 frames: a run then measures the same data however many
 * iterations fit in its time, and the base and head builds stay comparable.
 */
async function panAndZoom(bench: TestContext['bench'], chart: Chart, times: number[], [text, cells, narrow]: [number, number, number]) {
  const START = 1_000;
  let frame = 0;
  const reset = (spacing: number) => () => {
    frame = 0;
    chart.setBarSpacing(spacing);
    chart.scrollToTime(times[START]!, false);
    flushFrames();
  };
  const pan = () => {
    chart.scrollToTime(times[START + (frame++ % 64) * 3]!, false);
    driveFrames();
  };
  await bench.compare(
    bench('pan with text', { beforeAll: reset(text) }, pan),
    bench('pan with cells', { beforeAll: reset(cells) }, pan),
    bench('pan zoomed out', { beforeAll: reset(narrow) }, pan),
    bench('zoom', { beforeAll: reset(narrow) }, () => {
      // From the narrow fallback up to text and back.
      chart.setBarSpacing(narrow + ((text - narrow) * Math.abs((frame++ % 32) - 16)) / 16);
      driveFrames();
    }),
  );
}

describe('footprint, 20,000 bars of about 18 rows', () => {
  const COUNT = 20_000;
  const bars = sampleBars({ count: COUNT, interval: 300 });
  const data = footprintBars(COUNT, 0.04);

  // At 6 px per bar about 200 bars and 3,600 rows are on screen; at 60 px about 20 bars with row text.
  test('pan and zoom', async ({ bench }) => {
    const chart = newChart(bars);
    chart.addCustomSeries(footprintSeries, { title: 'Footprint' }).setData(data);
    flushFrames();
    await panAndZoom(bench, chart, bars.map((b) => b.time), [60, 6, 1]);
  });
});

describe('TPO, 20,000 half-hour periods in daily sessions', () => {
  const COUNT = 20_000;
  // Half-hour periods, 48 per UTC day; rows of 0.05 give each session a profile of about 95 rows.
  const bars = sampleBars({ count: COUNT, interval: 1800 });
  const data = tpoColumns(bars, { rowSize: 0.05 });

  // At 6 px per bar about 200 columns of about 15 TPOs each, 3,000 cells, are on screen.
  test('pan and zoom', async ({ bench }) => {
    const chart = newChart(bars);
    chart.addCustomSeries(tpoSeries, { title: 'TPO' }).setData(data);
    flushFrames();
    await panAndZoom(bench, chart, bars.map((b) => b.time), [14, 6, 1]);
  });
});
