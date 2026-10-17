/**
 * Four linked charts panning together (#82): `pnpm build && pnpm bench`.
 *
 * Like `render.bench.ts`, this runs under Node with no-op WebGL and Canvas2D,
 * so a number is the CPU-side work of one synced frame: the link group
 * passing the range or crosshair on, and all four charts laying out and
 * packing their frames. Compare it with the 16.7 ms frame budget at 60 Hz;
 * paint and GPU time come on top in a browser.
 */
import { afterAll, describe, test } from 'vitest';
import { Chart, createLinkGroup } from '@charton/core';
import { driveFrames, emitPointer, flushFrames, installTestEnvironment, sampleBars } from '@charton/core/testing';

const BARS = 100_000;
// A 1280 x 720 page split into a 2 x 2 grid.
const env = installTestEnvironment({ width: 640, height: 360 });
const charts = Array.from({ length: 4 }, (_, i) => {
  const chart = new Chart(env.container());
  chart.addCandles().setData(sampleBars({ count: BARS, seed: i + 1 }));
  return chart;
});
const group = createLinkGroup(charts);
const [leader] = charts as [Chart, ...Chart[]];
const data = sampleBars({ count: BARS, seed: 1 });
flushFrames();

afterAll(() => {
  group.destroy();
  charts.forEach((c) => c.destroy());
  env.uninstall();
});

describe(`four linked charts, ${BARS.toLocaleString('en')} candles each`, () => {
  test('pan, zoom and crosshair on one chart', async ({ bench }) => {
    let at = 0;
    /** Scroll the leader a few bars further each frame; the group moves the other three. */
    const pan = () => {
      at = (at + 7) % (BARS - 5_000);
      leader.scrollToTime(data[2_000 + at]!.time, false);
      driveFrames();
    };
    let frame = 0;
    await bench.compare(
      bench('pan', { beforeAll: () => leader.setBarSpacing(6) }, pan),
      bench('zoom', () => {
        // In and out between 2 and 18 px per bar.
        leader.setBarSpacing(2 + Math.abs((frame++ % 32) - 16));
        driveFrames();
      }),
      bench('pan zoomed out', { beforeAll: () => leader.setBarSpacing(0.5) }, pan),
      bench(
        'crosshair',
        {
          beforeAll: () => {
            leader.setBarSpacing(6);
            leader.scrollToTime(data[BARS - 1]!.time, false);
            flushFrames();
          },
        },
        () => {
          // Hover across the newest bars; the other three draw the mirrored line.
          const bar = data[BARS - 1 - (frame++ % 60)]!;
          if (!emitPointer(leader, { type: 'move', time: bar.time, price: bar.close })) throw new Error('bar off screen');
          driveFrames();
        },
      ),
    );
  });
});
