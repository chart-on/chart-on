import { builtins, createChart, darkTheme, lightTheme, type Chart } from '@charton/core';
import { builtinIndicators } from '@charton/indicators';
import { createChartShell, symbolSearch } from '@charton/ui';
import '@charton/ui/style.css';

/**
 * Runs the demo's scenarios under the strict policy in vite.config.ts: a core chart with
 * candles, a heatmap, drawings and indicators, and the UI shell with its dialogs open. Text
 * that would run script if it were parsed as markup goes into titles, drawings and search
 * results. `?theme=light` picks the light theme. Sets `data-done` on <html> when finished.
 */

const MARKUP = '<img src=x onerror="alert(1)"><b>Bold</b>';
const theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
const STEP = 60;

const bars = Array.from({ length: 200 }, (_, i) => {
  const open = 100 + 10 * Math.sin(i / 9);
  const close = 100 + 10 * Math.sin((i + 1) / 9);
  return { time: i * STEP, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000 + i };
});
const at = (i: number, price: number) => ({ time: i * STEP, price });
const frames = async () => {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
};

function populate(chart: Chart) {
  for (const def of builtinIndicators) chart.indicators.register(def);
  chart.addCandles({ title: MARKUP }).setData(bars);
  chart.indicators.add('sma', { length: 20 });
  const rsi = chart.indicators.add('rsi');
  chart.drawings.add({ type: 'trendline', pane: 0, points: [at(20, 95), at(120, 108)], style: {} });
  const note = chart.drawings.add({ type: 'text', pane: 0, points: [at(150, 104)], style: {}, text: MARKUP });
  return { rsi, note: note.id };
}

async function run(): Promise<void> {
  const core = createChart(document.getElementById('core')!, {
    theme: theme === 'light' ? lightTheme : darkTheme,
    plugins: builtins(),
  });
  populate(core);
  const rows = 40;
  const values = new Float32Array(bars.length * rows).map((_, i) => (i * 7919) % 97);
  core.addHeatmap({ title: MARKUP }).setData({ times: bars.map((b) => b.time), priceStart: 85, priceStep: 0.75, rows, values });
  await frames();

  const shell = createChartShell(document.getElementById('shell')!, {
    theme,
    symbolSearch: symbolSearch({
      source: { search: async () => [{ symbol: MARKUP, name: MARKUP, description: MARKUP }] },
      onSelect: () => {},
      debounce: 0,
    }),
  });
  const { rsi, note } = populate(shell.chart);
  await frames();
  shell.settings!.open();
  await frames();
  shell.settings!.close();
  shell.drawingSettings!.open(note);
  await frames();
  shell.drawingSettings!.dialog!.close();
  const panel = shell.indicatorSettings!.open(rsi);
  await frames();
  panel!.close();
  shell.symbolSearch!.open(MARKUP);
  await frames();
}

run().finally(() => {
  document.documentElement.dataset.done = '';
});
