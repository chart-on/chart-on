import {
  annotations,
  createChart,
  indicators,
  withAlpha,
  type Bar,
  type Chart,
  type CustomSeriesDef,
  type IndicatorDef,
} from '@charton/core';
import { ema } from '@charton/ta';
import { HOUR } from '../../../examples/sample-data';
import { errorText, rng, themeFor, whenVisible, type Section } from './section';
import { slidingIndicator } from './slide';

/**
 * The code the "Make it yours" tiles show for each layer lives in
 * `landing-html.ts`; the definitions below are that code with the sample
 * data filled in, so what the visitor reads is what draws.
 */

/** An average coloured by its trend (rising, falling or flat), with a tint behind each stretch. */
const regime: IndicatorDef<{ length: number }> = {
  id: 'trend-regime',
  name: 'Trend regime',
  placement: 'overlay',
  inputs: [{ id: 'length', type: 'number', default: 21, min: 2 }],
  plots: [
    { id: 'avg', type: 'line', lineWidth: 2, palette: ['#22a06b', '#e5484d', '#8b93a7'], colorOutput: 'trend', lastValueLabel: false },
    { id: 'tint', type: 'background', palette: ['rgba(34, 160, 107, 0.08)', 'rgba(229, 72, 77, 0.08)'] },
  ],
  compute(src, { length }) {
    const avg = ema(src.close, length);
    // 0 rising, 1 falling, 2 flat (also the first 8 bars): the change over 8 bars against 0.6% of the price.
    const trend = avg.map((v, i) => {
      const change = (v - avg[i - 8]!) / v;
      return Number.isNaN(change) || Math.abs(change) < 0.006 ? 2 : Number(change < 0);
    });
    return { avg, trend, tint: trend };
  },
};

interface Bubble {
  time: number;
  price: number;
  size: number;
  up: boolean;
}

/** Volume spikes as bubbles at the close, in the theme's up and down colours. */
const bubbles: CustomSeriesDef<Bubble> = {
  type: 'bubbles',
  priceRange: (p) => [p.price, p.price],
  draw(ctx, view) {
    for (const { item, x } of view.items) {
      ctx.beginPath();
      ctx.arc(x, view.priceToY(item.price), 3 + 9 * item.size, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(item.up ? view.theme.up : view.theme.down, 0.3);
      ctx.fill();
    }
  },
};

/** The brand the colours layer swaps in, whatever the site's scheme. */
const BRAND = { background: '#0f1729', grid: '#1b2640', text: '#c3cde6', textMuted: '#7b88a8', up: '#2dd4bf', down: '#f472b6' };

/** The stretches of the sample market: bars, drift per bar, noise and volume. */
const REGIMES = [
  { name: 'drift', bars: 20, drift: -0.12, noise: 0.9, volume: 0.9 },
  { name: 'rally', bars: 30, drift: 0.3, noise: 1, volume: 1.1 },
  { name: 'range', bars: 50, drift: 0, noise: 0.9, volume: 0.8 },
  { name: 'selloff', bars: 17, drift: -0.45, noise: 1.2, volume: 1.4 },
  { name: 'base', bars: 23, drift: 0, noise: 0.8, volume: 0.9 },
  { name: 'recovery', bars: 20, drift: 0.2, noise: 1, volume: 1 },
] as const;

type RegimeName = (typeof REGIMES)[number]['name'];

/** Seeded hourly bars through the regimes above, and the bar each one starts at. */
function regimeBars(): { bars: Bar[]; start: Record<RegimeName, number> } {
  const random = rng(5);
  const bars: Bar[] = [];
  const start = {} as Record<RegimeName, number>;
  let time = Date.UTC(2026, 0, 5) / 1000;
  let close = 100;
  for (const r of REGIMES) {
    start[r.name] = bars.length;
    const level = close;
    // The sell-off opens with a gap.
    if (r.name === 'selloff') close -= 2;
    for (let i = 0; i < r.bars; i++) {
      const open = close;
      // Flat stretches pull back to where they began.
      const pull = r.drift === 0 ? (level - open) * 0.12 : 0;
      close = open + r.drift + pull + (random() - 0.5) * 2 * r.noise;
      bars.push({
        time,
        open,
        high: Math.max(open, close) + random() * r.noise,
        low: Math.min(open, close) - random() * r.noise,
        close,
        // Now and then a burst of volume.
        volume: 900 * r.volume * (0.5 + random()) * (1 + Math.abs(close - open)) * (random() < 0.08 ? 2.5 : 1),
      });
      time += HOUR;
    }
  }
  return { bars, start };
}

/** Chart width (css px) below which the tile shows a shorter stretch of bars. */
const NARROW = 480;

/** Turns one layer on or off. */
type Layer = (on: boolean) => void;

/**
 * One chart with layers a developer adds on top: their own indicator, their
 * users' trades, zones, a custom series and their own colours. Each toggle in
 * the panel switches a layer and shows its code.
 */
export function mountCustomize(root: HTMLElement, dark: boolean): Section {
  const host = root.querySelector<HTMLElement>('[data-custom-chart]')!;
  const note = root.querySelector<HTMLElement>('[data-custom-note]')!;
  const key = root.querySelector<HTMLElement>('[data-custom-key]')!;
  const tabs = root.querySelector<HTMLElement>('.lp-custom-files')!;
  const panels = [...root.querySelectorAll<HTMLElement>('[data-custom-code]')];
  let chart: Chart | null = null;
  let isDark = dark;
  let branded = false;

  const theme = () => (branded ? { ...themeFor(isDark), ...BRAND } : themeFor(isDark));

  // The code panel follows the last layer touched.
  const show = (id: string) => {
    for (const tab of tabs.querySelectorAll<HTMLElement>('[data-custom-file]')) {
      const selected = tab.dataset.customFile === id;
      tab.setAttribute('aria-selected', String(selected));
      // Narrow tiles scroll the file tabs; keep the selected one in view.
      if (selected) tabs.scrollTo({ left: tab.offsetLeft - (tabs.clientWidth - tab.offsetWidth) / 2 });
    }
    for (const panel of panels) panel.hidden = panel.dataset.customCode !== id;
  };
  const removeSlide = slidingIndicator(tabs);
  tabs.addEventListener('click', (event) => {
    const tab = (event.target as Element).closest<HTMLElement>('[data-custom-file]');
    if (tab) show(tab.dataset.customFile!);
  });

  const stopWatching = whenVisible(host, () => {
    try {
      const narrow = host.clientWidth < NARROW;
      // Narrow tiles move the legend to the bottom, clear of the band label at the top.
      const legend = narrow ? { position: 'bottom-start' as const } : undefined;
      const c = createChart(host, { theme: theme(), legend, plugins: [indicators(), annotations()] });
      chart = c;
      const { bars, start } = regimeBars();
      // No OHLC row in the legend: the layers' labels use the top of the pane.
      c.addCandles({ title: 'SAMPLE', legend: false, priceFormat: { type: 'decimal', tickSize: 0.01 } }).setData(bars);
      // Room above the highs for the legend and the zone labels.
      c.setPriceScaleOptions({ marginTop: 0.18 });
      const layers = buildLayers(c, bars, start, (on) => {
        branded = on;
        c.applyOptions({ theme: theme() });
      });

      for (const button of key.querySelectorAll<HTMLButtonElement>('[data-custom-layer]')) {
        const id = button.dataset.customLayer!;
        if (button.getAttribute('aria-pressed') === 'true') layers[id]?.(true);
        button.addEventListener('click', () => {
          const on = button.getAttribute('aria-pressed') !== 'true';
          button.setAttribute('aria-pressed', String(on));
          layers[id]?.(on);
          show(id);
        });
      }
      // Narrow tiles start at the rally and leave room after the last bar, so the
      // zone labels fit their areas and the line titles clear the candles.
      if (narrow) c.setVisibleIndexRange(start.rally, bars.length + 30, false);
      else c.fitContent();
    } catch (error) {
      note.textContent = errorText(error);
      note.hidden = false;
    }
  });

  return {
    setDark(value) {
      isDark = value;
      chart?.applyOptions({ theme: theme() });
    },
    destroy() {
      stopWatching();
      removeSlide();
      chart?.destroy();
      chart = null;
    },
  };
}

/** Each layer, built on first use and shown or hidden after that. */
function buildLayers(chart: Chart, bars: Bar[], start: Record<RegimeName, number>, setBrand: Layer): Record<string, Layer> {
  const lazy = <T extends { setVisible(on: boolean): void }>(make: () => T[]): Layer => {
    let items: T[] | null = null;
    return (on) => {
      if (on && !items) items = make();
      items?.forEach((item) => item.setVisible(on));
    };
  };
  const round = (price: number) => Math.round(price * 100) / 100;

  // The sample user's trade: in near the base's low, half out at the recovery's
  // first high. Early in the recovery, so the label stays clear of the axis and
  // the line titles at its right.
  const buy = bars[start.base + 7]!;
  const sell = bars.slice(start.recovery, start.recovery + 10).reduce((a, b) => (b.close > a.close ? b : a));
  const range = bars.slice(start.range, start.selloff);
  const rangeLow = Math.min(...range.map((b) => b.low));
  const rangeHigh = Math.max(...range.map((b) => b.high));
  const bottom = Math.min(...bars.slice(start.selloff, start.recovery).map((b) => b.low));

  const lines = lazy(() => [
    chart.annotations.addPriceLine({ price: round(buy.close), title: 'Entry', color: '#3d8bd9' }),
    chart.annotations.addPriceLine({ price: round(bottom - 0.5), title: 'Stop', color: '#e5484d', lineStyle: 'dashed' }),
    chart.annotations.addPriceLine({ price: round(rangeLow), title: 'Target', color: '#22a06b', lineStyle: 'dashed' }),
  ]);
  const fills = [
    { time: buy.time, shape: 'label', position: 'atPrice', price: buy.close, color: '#3d8bd9', text: 'Buy 2', tooltip: `Bought 2 @ ${buy.close.toFixed(2)}` },
    { time: sell.time, shape: 'label', position: 'atPrice', price: sell.close, color: '#f5a524', text: 'Sell 1', tooltip: `Sold 1 @ ${sell.close.toFixed(2)}` },
  ] as const;

  return {
    indicator: lazy(() => [chart.indicators.add(regime)]),
    trades: (on) => {
      lines(on);
      chart.annotations.setMarkers(on ? [...fills] : []);
    },
    zones: lazy(() => [
      chart.annotations.addPriceZone({
        from: rangeLow,
        to: rangeHigh,
        fromTime: range[0]!.time,
        toTime: range.at(-1)!.time,
        color: 'rgba(61, 139, 217, 0.12)',
        label: 'Range',
      }),
      chart.annotations.addTimeBand({ from: bars[start.selloff]!.time, to: bars[start.selloff]!.time + 47 * HOUR, label: 'Earnings' }),
    ]),
    series: lazy(() => {
      const volumes = bars.map((b) => b.volume ?? 0);
      const max = Math.max(...volumes);
      // Only the top tenth by volume.
      const cut = [...volumes].sort((a, b) => a - b)[Math.floor(volumes.length * 0.9)]!;
      const series = chart.addCustomSeries(bubbles, { title: 'Volume spikes', legend: false, lastValueLabel: false });
      series.setData(
        bars.flatMap((b) => ((b.volume ?? 0) >= cut ? [{ time: b.time, price: b.close, size: Math.sqrt(b.volume! / max), up: b.close >= b.open }] : [])),
      );
      return [series];
    }),
    colours: setBrand,
  };
}
