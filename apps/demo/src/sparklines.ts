import { createChart, createMockDataSource, dataSource, type Chart } from '@chart-on/core';
import { light, theme } from './page-theme';
import { expose } from './expose';

// Static charts for thumbnails and sparklines next to one interactive chart: the
// static ones give their WebGL context back after each drawing, so 41 charts stay
// within the browser's context limit.

const main = createChart(document.getElementById('main')!, { theme: theme(), timezone: 'UTC', plugins: [dataSource()] });
main.setDataSource(createMockDataSource({ startPrice: 100 }));
void main.setSymbol('DEMO', '1h');

const charts: Chart[] = [main];
const grid = document.getElementById('grid')!;
for (let i = 0; i < 40; i++) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  const label = document.createElement('div');
  label.textContent = `SYM${String(i + 1).padStart(2, '0')}`;
  const host = document.createElement('div');
  host.className = 'spark';
  tile.append(label, host);
  grid.append(tile);
  const chart = createChart(host, {
    interactive: false,
    theme: theme(),
    timezone: 'UTC',
    plugins: [dataSource()],
    grid: { horizontal: { visible: false }, vertical: { visible: false } },
    features: { legend: false, lastValueLabels: false },
  });
  // Each sparkline is the close line of its own random walk, fitted to its tile, without live
  // ticks: each redraw of a static chart takes a context back, which costs far more than a frame
  // of a chart that keeps one, so static charts suit data that changes now and then.
  const source = createMockDataSource({ startPrice: 20 + i * 7, seed: i + 1, historyBars: 400 });
  source.setPaused(true);
  chart.setDataSource(source, { initialBars: 120 });
  void chart.setSymbol('DEMO', '1d').then(() => {
    chart.main?.applyOptions({ style: 'line' });
    chart.fitContent(false);
  });
  charts.push(chart);
}

light.addEventListener('change', () => {
  for (const chart of charts) chart.applyOptions({ theme: theme() });
});

expose({ charts });
