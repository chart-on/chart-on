import { sampleBars } from '@chart-on/core/testing';
import { chartStyle, createChartShell, intervals, symbolHeader, symbolSearch, type ChartShell } from '@chart-on/ui';
import '@chart-on/ui/style.css';

/**
 * The UI shell for the keyboard tests in ../keyboard.spec.ts: toolbar (two menus, a button
 * that counts presses in `window.presses`, and buttons that overflow on a narrow page), rail,
 * chart with a legend, navigator and bottom bar (with a timezone menu), plus a symbol search
 * over a static list. Seeded data. `?theme=light` picks the light theme. The shell is
 * `window.shell`; `data-done` is set on <html> once the chart has drawn its data, or
 * `data-error` (with the message) if setting up failed.
 */

const theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
const DAY = 86400;
const bars = sampleBars({ count: 300, interval: DAY });
const symbols = [
  { symbol: 'SAMPLE', name: 'Sample', description: 'Sample instrument' },
  { symbol: 'OTHER', name: 'Other', description: 'Other instrument' },
];
const page = window as unknown as { shell: ChartShell; presses: number };
page.presses = 0;

async function run(): Promise<void> {
  const shell = createChartShell(document.getElementById('shell')!, {
    theme,
    toolbar: [
      symbolHeader(),
      intervals(['1m', '5m', '1h', '1d'], { display: 'menu', value: '1d', onChange: () => {} }),
      chartStyle(),
      { type: 'button', id: 'press', label: 'Press', text: 'Press', onClick: () => void page.presses++ },
      // Wide buttons that go into the More menu on a narrow page.
      ...['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map((name) => ({
        type: 'button' as const,
        id: name.toLowerCase(),
        label: name,
        text: `${name} action`,
        onClick: () => {},
      })),
    ],
    bottomBar: {
      timezones: {
        options: [
          { value: 'UTC', label: 'UTC' },
          { value: 'America/New_York', label: 'New York' },
          { value: 'Asia/Tokyo', label: 'Tokyo' },
        ],
        value: 'UTC',
      },
    },
    // `renderStats` makes the chart report each drawn frame, so the page can wait for one.
    chart: { timezone: 'UTC', renderStats: true },
    navigator: true,
    symbolSearch: symbolSearch({
      source: { search: async (query) => symbols.filter((s) => s.symbol.includes(query.toUpperCase())) },
      onSelect: () => {},
      debounce: 0,
    }),
  });
  const drawn = new Promise((resolve) => shell.chart.once('frame:render', resolve));
  shell.chart.addCandles({ title: 'SAMPLE' }).setData(bars);
  shell.chart.addLine({ title: 'Close' }).setData(bars.map((b) => ({ time: b.time, value: b.close })));
  page.shell = shell;
  await drawn;
}

run().then(
  () => {
    document.documentElement.dataset.done = '';
  },
  (error: unknown) => {
    document.documentElement.dataset.error = String(error instanceof Error ? error.message : error);
  },
);
