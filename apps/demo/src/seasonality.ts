import {
  createChart,
  createSeasonality,
  createStaticDataSource,
  dataSource,
  type Bar,
  type SeasonalAlign,
  type SeasonalAverage,
  type SeasonalNormalize,
  type SeasonalWindow,
} from '@charton/core';
import { light, theme } from './page-theme';
import { expose } from './expose';

// Five years of synthetic weekday closes with a seasonal swing (strong spring,
// soft late summer), loaded through a data source like any symbol.
const DAY = 86400;

function seasonalBars(years: number): Bar[] {
  const end = Math.floor(Date.now() / 1000 / DAY) * DAY;
  const start = Date.UTC(new Date().getUTCFullYear() - years + 1, 0, 1) / 1000 - 30 * DAY;
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const bars: Bar[] = [];
  let close = 100;
  for (let time = start; time <= end; time += DAY) {
    const day = new Date(time * 1000).getUTCDay();
    if (day === 0 || day === 6) continue;
    const phase = ((time / DAY) % 365.25) / 365.25;
    const drift = 0.0012 * Math.sin(2 * Math.PI * (phase + 0.1));
    const open = close;
    close = Math.max(1, open * (1 + drift + (random() - 0.5) * 0.024));
    const high = Math.max(open, close) * (1 + random() * 0.006);
    const low = Math.min(open, close) * (1 - random() * 0.006);
    bars.push({ time, open, high, low, close, volume: 1000 + random() * 500 });
  }
  return bars;
}

const history = seasonalBars(5);
const source = createStaticDataSource({
  symbols: [{ symbol: 'SEASON', name: 'Seasonal demo', precision: 2 }],
  bars: (_symbol, interval) => (interval === '1d' ? history : undefined),
});

const chart = createChart(document.getElementById('chart')!, { theme: theme(), timezone: 'UTC', plugins: [dataSource()] });
chart.setDataSource(source);
const view = createSeasonality(chart, { symbol: 'SEASON', years: 5, average: 'mean' });
light.addEventListener('change', () => chart.applyOptions({ theme: theme() }));

const select = <T extends string>(id: string, apply: (value: T) => void) => {
  const el = document.getElementById(id) as HTMLSelectElement;
  el.addEventListener('change', () => apply(el.value as T));
};
select<SeasonalWindow>('window', (window) => view.applyOptions({ window, period: undefined }));
select<SeasonalNormalize>('normalize', (normalize) => view.applyOptions({ normalize }));
select<SeasonalAlign>('align', (align) => view.applyOptions({ align }));
select<SeasonalAverage | ''>('average', (average) => view.applyOptions({ average: average || null }));

expose({ chart, seasonality: view });
