// An app-side test written the way the testing docs suggest: only the public
// API and `@charton/core/testing`, no browser and no GPU.
import { afterEach, expect, it } from 'vitest';
import { annotations, createChart, volumeOf } from '@charton/core';
import { describeScene, flushFrames, installTestEnvironment, sampleBars } from '@charton/core/testing';

const env = installTestEnvironment({ width: 960, height: 540 });
afterEach(() => env.uninstall());

it('lays out candles with a volume overlay', () => {
  const chart = createChart(env.container(), { plugins: [annotations()] });
  const bars = sampleBars({ count: 300, seed: 42 });
  chart.addCandles({ title: 'Sample', animate: false }).setData(bars);
  chart.addHistogram({ title: 'Volume', follow: volumeOf, overlay: { top: 0.8, bottom: 0 } });
  chart.annotations.setMarkers([{ id: 'signal', time: bars[280]!.time, shape: 'arrow-up', text: 'Signal' }]);
  chart.annotations.addPriceLine({ price: 105.123456789, title: 'Level' });
  flushFrames();
  expect(describeScene(chart)).toMatchSnapshot();
  chart.destroy();
});
