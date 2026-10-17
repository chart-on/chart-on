/**
 * Builds playground code from a chart style and a set of add-ons, so a chart
 * can be put together with clicks before editing it by hand. The output is an
 * ordinary docs example (see `examples/types.ts`).
 */

/** The candle series styles the builder offers, with their labels. */
export const STYLES = [
  ['candles', 'Candles'],
  ['hollow', 'Hollow'],
  ['bars', 'Bars'],
  ['heikinAshi', 'Heikin-Ashi'],
  ['line', 'Line'],
  ['area', 'Area'],
  ['baseline', 'Baseline'],
] as const;

export type BuilderStyle = (typeof STYLES)[number][0];

interface Addon {
  id: string;
  label: string;
  /** Names imported from `@charton/core`. */
  core?: string[];
  /** A name imported from `@charton/indicators`. */
  indicator?: string;
  /** Names imported from `./sample-data`. */
  sampleData?: string[];
  /** Lines after the main series is created, before its data is set. */
  setup?: string[];
  /** Lines after the view is fitted, and a clean-up call they need. */
  live?: { lines: string[]; cleanup: string };
}

/** Add-ons, in the order their lines appear. */
export const ADDONS: readonly Addon[] = [
  {
    id: 'volume',
    label: 'Volume',
    core: ['volumeOf'],
    setup: ["chart.addHistogram({ title: 'Volume', follow: volumeOf }, chart.addPane({ stretch: 0.25 }));"],
  },
  { id: 'sma', label: 'SMA 20', indicator: 'smaIndicator', setup: ['chart.indicators.add(smaIndicator, { length: 20 });'] },
  { id: 'ema', label: 'EMA 50', indicator: 'emaIndicator', setup: ['chart.indicators.add(emaIndicator, { length: 50 });'] },
  { id: 'bollinger', label: 'Bollinger', indicator: 'bollingerIndicator', setup: ['chart.indicators.add(bollingerIndicator);'] },
  { id: 'rsi', label: 'RSI', indicator: 'rsiIndicator', setup: ['chart.indicators.add(rsiIndicator);'] },
  { id: 'macd', label: 'MACD', indicator: 'macdIndicator', setup: ['chart.indicators.add(macdIndicator);'] },
  {
    id: 'drawing',
    label: 'Price line',
    core: ['drawingTools'],
    setup: [
      'const last = bars[bars.length - 1]!;',
      'chart.drawings.add({',
      "  type: 'hline',",
      '  pane: 0,',
      '  points: [{ time: last.time, price: last.close }],',
      "  style: { lineStyle: 'dashed' },",
      '});',
    ],
  },
  {
    id: 'live',
    label: 'Live ticks',
    sampleData: ['sampleTicks'],
    live: { lines: ['// New ticks update the last bar, then start the next one.', 'const stopTicks = sampleTicks(bars[bars.length - 1]!, (bar) => main.update(bar));'], cleanup: 'stopTicks();' },
  },
];

const unique = (names: string[]) => [...new Set(names)].sort();

/** The example code for a style and the chosen add-on ids. */
export function buildCode(style: BuilderStyle, chosen: ReadonlySet<string>): string {
  const addons = ADDONS.filter((a) => chosen.has(a.id));
  const indicators = unique(addons.flatMap((a) => (a.indicator ? [a.indicator] : [])));
  const drawing = addons.some((a) => a.core?.includes('drawingTools'));
  const plugins = [...(indicators.length ? ['indicators()'] : []), ...(drawing ? ['drawingTools()'] : [])];
  const core = unique(['createChart', ...(indicators.length ? ['indicators'] : []), ...addons.flatMap((a) => a.core ?? [])]);
  const sample = unique(['sampleBars', ...addons.flatMap((a) => a.sampleData ?? [])]);
  const live = addons.flatMap((a) => (a.live ? [a.live] : []));
  const options = plugins.length ? `{ theme, plugins: [${plugins.join(', ')}] }` : '{ theme }';
  const series = style === 'candles' ? "{ title: 'SAMPLE' }" : `{ title: 'SAMPLE', style: '${style}' }`;

  const lines = [
    `import { ${core.join(', ')} } from '@charton/core';`,
    ...(indicators.length ? [`import { ${indicators.join(', ')} } from '@charton/indicators';`] : []),
    "import type { ExampleContext } from './types';",
    `import { ${sample.join(', ')} } from './sample-data';`,
    '',
    'export default function mount(el: HTMLElement, { theme }: ExampleContext) {',
    `  const chart = createChart(el, ${options});`,
    '  const bars = sampleBars();',
    `  const main = chart.addCandles(${series});`,
    ...addons.flatMap((a) => a.setup ?? []).map((line) => `  ${line}`),
    '  main.setData(bars);',
    '  chart.fitContent();',
    ...live.flatMap((l) => l.lines).map((line) => `  ${line}`),
    '',
    live.length
      ? `  return () => {\n${live.map((l) => `    ${l.cleanup}`).join('\n')}\n    chart.destroy();\n  };`
      : '  return () => chart.destroy();',
    '}',
    '',
  ];
  return lines.join('\n');
}
