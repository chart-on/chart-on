import { builtins, createChart, darkTheme, lightTheme, volumeOf, type Chart } from '@charton/core';
import { sampleBars } from '@charton/core/testing';
import { builtinIndicators } from '@charton/indicators';
import { createChartShell, favorites } from '@charton/ui';
import '@charton/ui/style.css';

/**
 * Fixed-size scenes for the screenshot tests in ../visual.spec.ts: candles with volume, a
 * line on a percent scale, an indicator pane under a log scale, drawings and the UI shell.
 * Seeded data, so every run draws the same pixels. `?theme=light` picks the light theme.
 * Sets `data-done` on <html> when drawn.
 */

const light = new URLSearchParams(location.search).get('theme') === 'light';
const DAY = 86400;
const bars = sampleBars({ count: 120, interval: DAY });
const at = (i: number, price: number) => ({ time: bars[i]!.time, price });
const frames = async () => {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
};

function chart(id: string): Chart {
  return createChart(document.getElementById(id)!, { theme: light ? lightTheme : darkTheme, plugins: builtins() });
}

async function run(): Promise<void> {
  const volume = chart('candles-volume');
  volume.addCandles({ title: 'SAMPLE' }).setData(bars);
  volume.addHistogram({ title: 'Volume', follow: volumeOf }, volume.addPane({ stretch: 0.25 }));

  // Lines follow the main series' times: the main series drawn as a line, plus a line series,
  // on a percent scale.
  const line = chart('line');
  line.panes[0]!.price.setMode('percent');
  line.addCandles({ title: 'SAMPLE', style: 'line' }).setData(bars);
  line.addLine({ title: 'Mean 10' }).setData(
    bars.slice(9).map((b, i) => ({ time: b.time, value: bars.slice(i, i + 10).reduce((sum, x) => sum + x.close, 0) / 10 })),
  );

  const indicator = chart('indicator');
  for (const def of builtinIndicators) indicator.indicators.register(def);
  indicator.addCandles({ title: 'SAMPLE' }).setData(bars);
  indicator.indicators.add('rsi');
  indicator.panes[0]!.price.setMode('log');

  const drawings = chart('drawings');
  drawings.addCandles({ title: 'SAMPLE' }).setData(bars);
  drawings.drawings.add({ type: 'trendline', pane: 0, points: [at(10, bars[10]!.low), at(90, bars[90]!.high)], style: {} });
  // The retracement spans the swing from the lowest low to the highest high of bars 40 to 110,
  // so its levels spread out whatever the seeded data does.
  let lowest = 40;
  let highest = 40;
  for (let i = 41; i <= 110; i++) {
    if (bars[i]!.low < bars[lowest]!.low) lowest = i;
    if (bars[i]!.high > bars[highest]!.high) highest = i;
  }
  drawings.drawings.add({ type: 'fib-retracement', pane: 0, points: [at(lowest, bars[lowest]!.low), at(highest, bars[highest]!.high)], style: {} });

  // The favourites part keeps the rail's favourites button in the shot.
  const shell = createChartShell(document.getElementById('shell')!, { theme: light ? 'light' : 'dark', favorites: favorites() });
  shell.chart.addCandles({ title: 'SAMPLE' }).setData(bars);

  for (const c of [volume, line, indicator, drawings, shell.chart]) c.fitContent();
  await frames();
}

run().finally(() => {
  document.documentElement.dataset.done = '';
});
