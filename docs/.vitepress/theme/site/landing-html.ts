/**
 * The landing page markup. Plain strings with no imports beyond data, so the
 * server render ships the whole page as HTML and `landing.ts` only adds the
 * charts and the few controls once it runs in the browser.
 */
import { APPEARANCES } from './appearance';
import { heroArt } from './hero-art';
import { measured, measurements } from './measurements';

export const REPO = 'https://github.com/chart-on/chart-on';
/** Project name, also the footer wordmark. */
const NAME = 'charton';
const EMAIL = 'contact@charton.dev';
const INSTALL = 'pnpm add @chart-on/core';
/** The credit line people can paste near their chart. */
const CREDIT = '<a href="https://charton.dev">Charts by charton</a>';

/**
 * Sponsors shown on the landing page, biggest first. Add one when a sponsor asks
 * to be listed (see `docs/sponsor.md`); `logo` is a path under `docs/public/`.
 */
const SPONSORS: { name: string; href: string; logo?: string }[] = [];

const icon = {
  arrow: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>',
  file: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5l3 3V14a.5.5 0 0 1-.5.5h-7.5A.5.5 0 0 1 3.5 14V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3"/></svg>',
  draw: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13l4-5 3 2 5-7"/><circle cx="6" cy="8" r="1.2"/><circle cx="14" cy="3" r="1.2"/></svg>',
  wave: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8h2.5l2-5 4 10 2-5h2.5"/></svg>',
  palette:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a6.5 6.5 0 1 0 0 13c1 0 1.5-.6 1.5-1.4 0-.9-.8-1.3-.8-2.1 0-.8.6-1.3 1.4-1.3h1.6a2.8 2.8 0 0 0 2.8-2.8C14.5 4 11.6 1.5 8 1.5z"/><circle cx="4.8" cy="7.5" r=".8"/><circle cx="7" cy="4.6" r=".8"/><circle cx="10.4" cy="4.9" r=".8"/></svg>',
  latest: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l4 4-4 4M9 4l4 4-4 4"/></svg>',
  info: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M8 7.2v4.3M8 4.7v.1"/></svg>',
  pause: '<svg class="lp-icon-pause" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5v9M10.5 3.5v9"/></svg>',
  play: '<svg class="lp-icon-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5l7.5 4.5L5 12.5z"/></svg>',
  star: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>',
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 10.5V4a1 1 0 0 1 1-1h6.5"/></svg>',
};

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ticks = (text: string) => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>');
const checklist = (items: string[]) =>
  `<ul class="lp-checks">${items.map((item) => `<li>${icon.check}<span>${ticks(item)}</span></li>`).join('')}</ul>`;

/** Tabs of the code section, each a small file that uses the real API. */
export const SNIPPETS: { id: string; label: string; code: string }[] = [
  {
    id: 'candles',
    label: 'Candles',
    code: `import { createChart } from '@chart-on/core';

const chart = createChart(document.getElementById('chart')!);
chart.addCandles({ title: 'BTC/USD' }).setData(bars);
chart.fitContent();`,
  },
  {
    id: 'live',
    label: 'Live data',
    code: `import { createChart, createWebSocketDataSource, dataSource } from '@chart-on/core';

const chart = createChart(el, { plugins: [dataSource()] });
chart.addCandles();
chart.setDataSource(createWebSocketDataSource(feed));

// History pages in on scroll; the forming bar updates live.
await chart.setSymbol('BTC/USD', '1m');`,
  },
  {
    id: 'indicators',
    label: 'Indicators',
    code: `import { builtinIndicators, rsiIndicator } from '@chart-on/indicators';

for (const def of builtinIndicators) chart.indicators.register(def);
chart.indicators.add('bbands');
chart.indicators.add(rsiIndicator, { length: 21 });`,
  },
  {
    id: 'drawings',
    label: 'Drawings',
    code: `const line = chart.drawings.add({
  type: 'hline',
  pane: 0,
  points: [{ time: 1767225600, price: 104 }],
  style: { lineStyle: 'dashed' },
});

chart.drawings.update(line.id, { text: 'Resistance', locked: true });`,
  },
  {
    id: 'panes',
    label: 'Panes',
    code: `import { volumeOf } from '@chart-on/core';

chart.addCandles().setData(bars);

// Volume in its own pane, following the main series.
const pane = chart.addPane({ stretch: 0.25 });
chart.addHistogram({ title: 'Volume', follow: volumeOf }, pane);`,
  },
  {
    id: 'theme',
    label: 'Theming',
    code: `import { builtInColorPresets, presetTheme } from '@chart-on/core';

const paper = builtInColorPresets.find((p) => p.id === 'paper-ink')!;
chart.applyOptions({ theme: presetTheme(paper, 'light') });

// Only the keys you pass change.
chart.applyOptions({ theme: { up: '#3d8bd9', down: '#e07b39' } });`,
  },
  {
    id: 'testing',
    label: 'Testing',
    code: `import { describeScene, flushFrames, installTestEnvironment } from '@chart-on/core/testing';

const env = installTestEnvironment({ width: 960, height: 540 });
const chart = createChart(env.container());
chart.addCandles().setData(bars);
flushFrames();

expect(describeScene(chart)).toMatchSnapshot();`,
  },
];

/** Layers of the "Make it yours" chart: a toggle, the file its code shows in, whether it starts on, and the code. */
export const CUSTOM_LAYERS: { id: string; label: string; file: string; on: boolean; code: string }[] = [
  {
    id: 'indicator',
    label: 'Indicator',
    file: 'regime.ts',
    on: true,
    code: `import { ema } from '@chart-on/ta';

const regime: IndicatorDef<{ length: number }> = {
  id: 'trend-regime',
  name: 'Trend regime',
  placement: 'overlay',
  inputs: [{ id: 'length', type: 'number', default: 21, min: 2 }],
  plots: [
    // Each bar takes a palette colour from the 'trend' output.
    { id: 'avg', type: 'line', lineWidth: 2, palette: ['#22a06b', '#e5484d', '#8b93a7'], colorOutput: 'trend', lastValueLabel: false },
    { id: 'tint', type: 'background', palette: ['rgba(34, 160, 107, 0.08)', 'rgba(229, 72, 77, 0.08)'] },
  ],
  compute(src, { length }) {
    const avg = ema(src.close, length);
    // 0 rising, 1 falling, 2 flat (also the first 8 bars): the change over 8 bars against 0.6% of the price.
    const trend = avg.map((v, i) => {
      const change = (v - avg[i - 8]) / v;
      return Number.isNaN(change) || Math.abs(change) < 0.006 ? 2 : Number(change < 0);
    });
    return { avg, trend, tint: trend };
  },
};

chart.indicators.add(regime);`,
  },
  {
    id: 'trades',
    label: 'Trades',
    file: 'trades.ts',
    on: true,
    code: `// Your users' fills, at the price they traded.
chart.annotations.setMarkers([
  { time: buy.time, shape: 'label', position: 'atPrice', price: buy.price, color: '#3d8bd9', text: 'Buy 2', tooltip: 'Bought 2' },
  { time: sell.time, shape: 'label', position: 'atPrice', price: sell.price, color: '#f5a524', text: 'Sell 1', tooltip: 'Sold 1' },
]);

// The open position's levels, labelled on the price axis.
chart.annotations.addPriceLine({ price: buy.price, title: 'Entry', color: '#3d8bd9' });
chart.annotations.addPriceLine({ price: stop, title: 'Stop', color: '#e5484d', lineStyle: 'dashed' });
chart.annotations.addPriceLine({ price: target, title: 'Target', color: '#22a06b', lineStyle: 'dashed' });`,
  },
  {
    id: 'zones',
    label: 'Zones',
    file: 'zones.ts',
    on: false,
    code: `// A range your own code found, boxed between its first and last bar.
chart.annotations.addPriceZone({
  from: range.low,
  to: range.high,
  fromTime: range.start,
  toTime: range.end,
  color: 'rgba(61, 139, 217, 0.12)',
  label: 'Range',
});

// An event window: the two days after earnings, shaded below the candles.
chart.annotations.addTimeBand({ from: earnings, to: earnings + 47 * HOUR, label: 'Earnings' });`,
  },
  {
    id: 'series',
    label: 'Custom series',
    file: 'bubbles.ts',
    on: false,
    code: `const bubbles: CustomSeriesDef<{ time: number; price: number; size: number; up: boolean }> = {
  type: 'bubbles',
  priceRange: (p) => [p.price, p.price],
  // Plain Canvas 2D, with the chart's scales and theme.
  draw(ctx, view) {
    for (const { item, x } of view.items) {
      ctx.beginPath();
      ctx.arc(x, view.priceToY(item.price), 3 + 9 * item.size, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(item.up ? view.theme.up : view.theme.down, 0.3);
      ctx.fill();
    }
  },
};

// Volume spikes: the top tenth of bars by volume.
chart.addCustomSeries(bubbles, { title: 'Volume spikes' }).setData(
  spikes.map((b) => ({ time: b.time, price: b.close, size: Math.sqrt(b.volume / maxVolume), up: b.close >= b.open })),
);`,
  },
  {
    id: 'colours',
    label: 'Colours',
    file: 'brand.ts',
    on: false,
    code: `// Only the keys you pass change; custom series read them from view.theme.
chart.applyOptions({
  theme: {
    background: '#0f1729',
    grid: '#1b2640',
    text: '#c3cde6',
    textMuted: '#7b88a8',
    up: '#2dd4bf',
    down: '#f472b6',
  },
});`,
  },
];

/** Keywords, strings, comments, numbers and calls: enough colour for short snippets. */
const TOKEN =
  /(\/\/[^\n]*)|('(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(import|from|const|let|await|for|of|new|return|export|function)\b|\b(\d[\d_.]*)\b|([A-Za-z_$][\w$]*)(?=\()/g;

function highlight(code: string): string {
  let out = '';
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    out += escape(code.slice(last, m.index));
    const kind = m[1] ? 'comment' : m[2] ? 'string' : m[3] ? 'keyword' : m[4] ? 'number' : 'call';
    out += `<span class="tk-${kind}">${escape(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + escape(code.slice(last));
}

/** A numbered, highlighted code block. */
const codeBlock = (code: string) =>
  `<pre><code>${code
    .split('\n')
    .map((line) => `<span class="lp-line">${highlight(line) || ' '}</span>`)
    .join('')}</code></pre>`;

/** Auto-pan speeds the speed demo offers, as multiples of its normal pace. */
const PAN_SPEEDS = [1, 10, 100, 1000];

/** Order-flow views the order flow tile lists. */
const FLOW_VIEWS = ['Liquidity heatmap', 'Depth lane', 'Footprint', 'Volume profile', 'TPO profile', 'Large trades'];

const PACKAGES = [
  ['@chart-on/core', 'The engine: canvases, scales, series, data sources, drawings.'],
  ['@chart-on/ui', 'Optional shell: toolbar, drawing rail, dialogs and themes.'],
  ['@chart-on/indicators', 'Built-in indicators, opt in one by one.'],
  ['@chart-on/ta', 'Technical-analysis helpers for writing your own.'],
  ['@chart-on/locales', 'Translations of the built-in text, one language at a time.'],
  ['@chart-on/react', 'Component wrapper.'],
  ['@chart-on/vue', 'Component wrapper.'],
  ['@chart-on/svelte', 'Component wrapper.'],
];

const FOOTER_LINKS: [string, [string, string][]][] = [
  [
    NAME,
    [
      ['Documentation', '/guide/getting-started'],
      ['Examples', '/guide/examples'],
      ['Playground', '/playground'],
      ['API reference', '/api/'],
    ],
  ],
  [
    'Guides',
    [
      ['Data sources', '/guide/data-sources'],
      ['Indicators', '/guide/indicators'],
      ['Drawing tools', '/guide/drawings'],
      ['Theming', '/guide/theming'],
    ],
  ],
  [
    'Community',
    [
      ['GitHub', REPO],
      ['Issues', `${REPO}/issues`],
      ['Changelog', `${REPO}/blob/main/CHANGELOG.md`],
      ['Contributing', `${REPO}/blob/main/CONTRIBUTING.md`],
      ['Sponsor', '/sponsor'],
      [EMAIL, `mailto:${EMAIL}`],
    ],
  ],
];

export function landingHtml(base: string): string {
  const link = (path: string) => `${base}${path.replace(/^\//, '')}`;
  return `
<div class="lp">
  <section class="lp-hero lp-frame">
    <div class="lp-hero-text">
      <p class="lp-eyebrow"><span class="lp-dot"></span>WebGL2 · TypeScript · Apache-2.0</p>
      <h1 class="lp-title">Next gen<br>charting library</h1>
      <p class="lp-lead">Financial charts that stay smooth with a million candles. A headless engine you can drive from any UI, plus an optional toolkit when you want one.</p>
      <div class="lp-actions">
        <a class="lp-btn lp-btn-primary" href="${link('/guide/getting-started')}">Get started ${icon.arrow}</a>
        <a class="lp-btn" href="${REPO}" target="_blank" rel="noreferrer">View on GitHub ${icon.arrow}</a>
      </div>
      <button type="button" class="lp-install" data-copy="${INSTALL}" aria-label="Copy install command">
        <span class="lp-install-prompt">$</span><code>${INSTALL}</code>${icon.copy}<span class="lp-install-done" aria-live="polite"></span>
      </button>
    </div>
    <div class="lp-hero-art-wrap">${heroArt()}</div>
  </section>

  <section class="lp-showcase lp-frame">
    <div class="lp-showcase-text">
      <p class="lp-label">Developer experience</p>
      <h2>A chart library for<br>developers and agents</h2>
      <p>Small, typed and predictable: options are plain objects, every subscription returns its own unsubscribe, and nothing hides in global state. Code that people and coding agents read the same way.</p>
      ${checklist([
        'Candles, lines, histograms, heatmaps and custom series.',
        'Indicators, drawing tools and multi-pane layouts.',
        'A test kit that runs charts under Node: `installTestEnvironment`.',
        'Wrappers for the common component frameworks.',
      ])}
      <a class="lp-btn" href="${link('/guide/concepts')}">Core concepts ${icon.arrow}</a>
    </div>
    <div class="lp-showcase-code">
      <div class="lp-editor-frame">
        <div class="lp-editor">
          <div class="lp-editor-tabs" role="tablist" aria-label="Code example">
            ${SNIPPETS.map(
              (s, i) =>
                `<button type="button" role="tab" class="lp-editor-tab" data-snippet="${s.id}" aria-selected="${i === 0}">${s.label}</button>`,
            ).join('')}
          </div>
          ${SNIPPETS.map(
            (s, i) => `<div data-snippet-panel="${s.id}"${i === 0 ? '' : ' hidden'}>
            ${codeBlock(s.code)}
          </div>`,
          ).join('')}
        </div>
      </div>
    </div>
  </section>

  <section class="lp-stats lp-frame" aria-label="Measured performance" title="Times are medians from pnpm bench on ${measured.machine}, ${measured.benchDate}. Size from pnpm size, ${measured.sizeDate}. Benchmarks time the chart's CPU work with the GPU stubbed out.">
    ${measurements
      .map(
        (m) => `<div class="lp-stat">
      <p class="lp-label">${escape(m.label)}</p>
      <p class="lp-stat-value">${m.value}<span>${m.unit}</span></p>
      <p class="lp-stat-detail">${ticks(m.detail)}</p>
    </div>`,
      )
      .join('')}
  </section>

  <section class="lp-bento lp-frame" aria-label="Features">
    <article class="lp-tile lp-tile-speed">
      <header class="lp-tile-head">
        <p class="lp-label">Speed</p>
        <h3>Faster than you can see</h3>
        <p>One million candles, panning on every frame. The numbers are measured live in your browser.</p>
      </header>
      <div class="lp-panel lp-tile-fill">
        <div class="lp-panel-bar">
          <div class="lp-readout">
            <span>FPS <b data-speed="fps">–</b></span>
            <span>CPU ms <b data-speed="cpu">–</b></span>
            <span>GPU ms <b data-speed="gpu">–</b></span>
            <div class="lp-tip">
              <button type="button" class="lp-tip-trigger" aria-label="About these numbers" aria-describedby="lp-speed-tip">${icon.info}</button>
              <span class="lp-tip-body" role="tooltip" id="lp-speed-tip">Measured live in your browser on every frame: FPS from the chart's own frame time, CPU and GPU ms from its render statistics. Your hardware sets them, so they differ between machines.</span>
            </div>
          </div>
          <span class="lp-panel-actions">
            <span class="lp-speeds" role="radiogroup" aria-label="Auto-pan speed">
              ${PAN_SPEEDS.map((rate) => `<button type="button" role="radio" aria-checked="${rate === 1}" data-speed-rate="${rate}">${rate}×</button>`).join('')}
            </span>
            <button type="button" class="lp-btn lp-btn-small lp-btn-icon" data-speed-toggle aria-pressed="true" aria-label="Pause auto-pan" title="Pause auto-pan">${icon.pause}${icon.play}</button>
            <button type="button" class="lp-btn lp-btn-small lp-btn-icon" data-speed-latest aria-label="Go to the newest bar" title="Go to the newest bar">${icon.latest}</button>
          </span>
        </div>
        <div class="lp-panel-chart">
          <div class="lp-chart-host" data-speed-chart></div>
          <p class="lp-panel-note" data-speed-note>Generating 1,000,000 candles…</p>
        </div>
      </div>
      <a class="lp-more" href="${link('/guide/performance')}">Performance guide ${icon.arrow}</a>
    </article>

    <article class="lp-tile lp-tile-agents">
      <p class="lp-label">Agent ready</p>
      <h3>Docs your coding agent can read</h3>
      <ul class="lp-files">
        <li><a href="${link('/llms.txt')}">${icon.file}<code>llms.txt</code></a><span>Index of every page</span></li>
        <li><a href="${link('/llms-full.txt')}">${icon.file}<code>llms-full.txt</code></a><span>All docs in one file</span></li>
        <li><span>${icon.file}<code>&lt;page&gt;.md</code></span><span>Each page as Markdown</span></li>
      </ul>
    </article>

    <article class="lp-tile lp-tile-packages lp-tile-feature">
      <p class="lp-label">Pick what you ship</p>
      <h3>Headless core, optional everything</h3>
      <p>Every feature beyond a basic chart is an opt-in export.</p>
      <ul class="lp-chips">
        ${PACKAGES.map(([name, text], i) => `<li class="lp-chip${i === 0 ? ' lp-chip-main' : ''}" title="${text}"><code>${name}</code></li>`).join('')}
      </ul>
    </article>

    <a class="lp-tile lp-tile-small lp-card" href="${link('/guide/drawings')}">
      <span class="lp-tile-icon">${icon.draw}</span>
      <p class="lp-label">Drawings</p>
      <h3>Drawing tools</h3>
      <p>Trend lines, Fibonacci, shapes and text, plus a plain-object contract for your own.</p>
    </a>
    <a class="lp-tile lp-tile-small lp-card" href="${link('/guide/indicators')}">
      <span class="lp-tile-icon">${icon.wave}</span>
      <p class="lp-label">Indicators</p>
      <h3>Indicators as pure functions</h3>
      <p>Declared inputs and outputs, O(1) live updates, panes that follow the main series.</p>
    </a>
    <a class="lp-tile lp-tile-small lp-card" href="${link('/guide/theming')}">
      <span class="lp-tile-icon">${icon.palette}</span>
      <p class="lp-label">Theming</p>
      <h3>Every token is yours</h3>
      <p>Built-in colour presets, CSS variables for the UI and a theme object for the canvas.</p>
    </a>
    <article class="lp-tile lp-tile-flow">
      <p class="lp-label">Order flow</p>
      <h3>See the liquidity, not just the bars</h3>
      <p>Resting size over time as a heatmap, the live book beside the price axis, and footprints and profiles from your trades. Simulated here; feed it any order book.</p>
      <ul class="lp-features">
        ${FLOW_VIEWS.map((name) => `<li>${icon.check}<code>${name}</code></li>`).join('')}
      </ul>
      <a class="lp-more" href="${link('/guide/depth-lane')}">Depth lane ${icon.arrow}</a>
    </article>

    <article class="lp-tile lp-tile-flow-chart">
      <div class="lp-panel lp-tile-fill">
        <div class="lp-panel-bar">
          <div class="lp-flow-key" role="group" aria-label="Views" data-flow-key>
            <button type="button" aria-pressed="true" data-flow-view="heatmap"><i class="lp-key-heat"></i>Heatmap</button>
            <button type="button" aria-pressed="true" data-flow-view="book"><i class="lp-key-bid"></i><i class="lp-key-ask"></i>Order book</button>
            <button type="button" aria-pressed="false" data-flow-view="footprint"><i class="lp-key-footprint"></i>Footprint</button>
          </div>
          <span class="lp-status">Simulated</span>
        </div>
        <div class="lp-panel-chart">
          <div class="lp-chart-host" data-flow-chart></div>
          <p class="lp-panel-note" data-flow-note hidden></p>
        </div>
      </div>
    </article>
    <article class="lp-tile lp-tile-custom">
      <p class="lp-label">Make it yours</p>
      <h3>Your indicators, your trades, your brand</h3>
      <p>Write indicators as pure functions, show your users' trades, mark zones your code finds, draw your own series and restyle every colour. Toggle a layer to see its code.</p>
      <div class="lp-editor lp-custom-editor">
        <div class="lp-editor-tabs lp-custom-files" role="tablist" aria-label="Layer code">
          ${CUSTOM_LAYERS.map(
            (l, i) => `<button type="button" role="tab" class="lp-editor-tab" data-custom-file="${l.id}" aria-selected="${i === 0}">${l.file}</button>`,
          ).join('')}
        </div>
        ${CUSTOM_LAYERS.map((l, i) => `<div class="lp-custom-code" data-custom-code="${l.id}"${i === 0 ? '' : ' hidden'}>${codeBlock(l.code)}</div>`).join('')}
      </div>
      <a class="lp-more" href="${link('/guide/indicators#writing-one')}">Write an indicator ${icon.arrow}</a>
    </article>
    <article class="lp-tile lp-tile-custom-chart">
      <div class="lp-panel lp-tile-fill">
        <div class="lp-panel-bar">
          <div class="lp-flow-key" role="group" aria-label="Layers" data-custom-key>
            ${CUSTOM_LAYERS.map((l) => `<button type="button" aria-pressed="${l.on}" data-custom-layer="${l.id}">${l.label}</button>`).join('')}
          </div>
        </div>
        <div class="lp-panel-chart">
          <div class="lp-chart-host" data-custom-chart></div>
          <p class="lp-panel-note" data-custom-note hidden></p>
        </div>
      </div>
    </article>
  </section>

  <section class="lp-oss lp-frame" aria-labelledby="lp-oss-title">
    <div class="lp-oss-text">
      <p class="lp-label">Open source</p>
      <h2 id="lp-oss-title">Build the chart<br>your traders deserve</h2>
      <p>Free and open source under Apache-2.0. Read the code, open an issue or send a pull request: every package, the docs and this site live in one repository.</p>
    </div>
    <div class="lp-oss-actions">
      <a class="lp-btn lp-btn-primary" href="${link('/guide/getting-started')}">Read the guide ${icon.arrow}</a>
      <a class="lp-btn" href="${REPO}" target="_blank" rel="noreferrer">View on GitHub ${icon.arrow}</a>
      <a class="lp-btn" href="${REPO}/blob/main/CONTRIBUTING.md" target="_blank" rel="noreferrer">Contributing ${icon.arrow}</a>
    </div>
  </section>

  <section class="lp-support lp-frame" aria-label="Support charton">
    <div class="lp-support-cell">
      <p class="lp-label">Attribution</p>
      <h2>Credit charton</h2>
      <p>Credit is optional and much appreciated. Keep the small logo the chart shows by default, or put a link near the chart so others can find the project.</p>
      <button type="button" class="lp-install" data-copy="${escape(CREDIT)}" aria-label="Copy the credit link">
        <code>${escape(CREDIT)}</code>${icon.copy}<span class="lp-install-done" aria-live="polite"></span>
      </button>
    </div>
    <div class="lp-support-cell">
      <p class="lp-label">GitHub</p>
      <h2>Star the repository</h2>
      <p>A star helps other developers find charton and tells us the work is useful.</p>
      <div class="lp-actions">
        <a class="lp-btn" href="${REPO}" target="_blank" rel="noreferrer">${icon.star} Star on GitHub</a>
      </div>
    </div>
  </section>

  <section class="lp-support lp-frame" aria-labelledby="lp-sponsors-title">
    <div class="lp-support-cell">
      <p class="lp-label">Sponsors</p>
      <h2 id="lp-sponsors-title">Back the project</h2>
      <p>charton is free and built in the open.</p>
      <div class="lp-actions">
        <a class="lp-btn lp-btn-primary" href="${link('/sponsor')}">Become a sponsor ${icon.arrow}</a>
      </div>
    </div>
    ${
      SPONSORS.length
        ? `<ul class="lp-sponsor-list">${SPONSORS.map(
            (s) =>
              `<li><a class="lp-sponsor" href="${escape(s.href)}" target="_blank" rel="noreferrer sponsored">${s.logo ? `<img src="${link(s.logo)}" alt="${escape(s.name)}" loading="lazy">` : escape(s.name)}</a></li>`,
          ).join('')}</ul>`
        : ''
    }
  </section>

  <footer class="lp-footer">
    <div class="lp-footer-row">
    <div class="lp-footer-cols">
      ${FOOTER_LINKS.map(
        ([title, links]) => `<nav class="lp-footer-col" aria-label="${title}">
        <p class="lp-footer-title">${title}</p>
        <ul>${links.map(([text, href]) => `<li><a href="${/^(https?|mailto):/.test(href) ? href : link(href)}">${text}</a></li>`).join('')}</ul>
      </nav>`,
      ).join('')}
    </div>
    </div>
    <div class="lp-footer-bottom">
      <div class="lp-appearance" role="radiogroup" aria-label="Colour scheme">
        ${APPEARANCES.map(
          ([mode, label, svg]) =>
            `<button type="button" role="radio" aria-checked="false" aria-label="${label}" title="${label}" data-appearance="${mode}">${svg}</button>`,
        ).join('')}
      </div>
      <p>© ${new Date().getFullYear()} ${NAME} contributors · <a href="${REPO}/blob/main/LICENSE">Apache-2.0</a></p>
    </div>
  </footer>
</div>`;
}
