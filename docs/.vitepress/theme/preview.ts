/**
 * The /preview page: the UI shell set up as a trading terminal, on live market
 * data from Hyperliquid through the CCXT library. The maintainers asked for the
 * provider and library to be named on this page (#3); nowhere else in the
 * packages or guides names them.
 */
import ccxt from 'ccxt';
import { createOhlcvDataSource, volumeOf, type Interval } from '@chart-on/core';
import { builtinIndicators } from '@chart-on/indicators';
import {
  chartStyle,
  clock,
  commandPalette,
  createChartShell,
  defaultIntervals,
  favorites,
  fullscreen,
  indicatorPickerToolbarItem,
  intervals,
  replayControls,
  replayToolbarItem,
  scaleMode,
  screenshot,
  settingsToolbarItem,
  symbolHeader,
  symbolSearch,
  toasts,
  undoRedo,
} from '@chart-on/ui';
import '@chart-on/ui/style.css';
import { installShellPalette } from './site-theme';

/** HYPE perpetual, the market the page opens on. */
const START_SYMBOL = 'HYPE/USDC:USDC';
const START_INTERVAL: Interval = '1h';
/** The venue serves at most this many candles per request. */
const MAX_BARS_PER_REQUEST = 1000;

export interface Preview {
  setDark(dark: boolean): void;
  destroy(): void;
}

export function mountPreview(el: HTMLElement, dark: boolean): Preview {
  installShellPalette();
  // Spot and perpetual markets only: also listing the builder-deployed perp dexes costs a dozen
  // more heavy requests per visit against the venue's per-IP rate limit.
  const exchange = new ccxt.pro.hyperliquid({ options: { fetchMarkets: { types: ['spot', 'swap'] } } });
  const source = createOhlcvDataSource(exchange, { maxBarsPerRequest: MAX_BARS_PER_REQUEST });

  const shell = createChartShell(el, {
    theme: dark ? 'dark' : 'light',
    chart: { features: { watermark: true } },
    toolbar: [
      symbolHeader(),
      intervals(defaultIntervals),
      chartStyle(),
      indicatorPickerToolbarItem(),
      ...undoRedo(),
      screenshot({ filename: 'hype-preview' }),
      replayToolbarItem(),
      fullscreen(),
      settingsToolbarItem(),
      // Clock and price scale menu at the right end: the page has no bottom bar.
      { type: 'separator', id: 'clock-separator', align: 'end' },
      clock(),
      scaleMode(),
    ],
    navigator: true,
    features: { railSheet: true },
    favorites: favorites({ tools: ['trendline', 'hline', 'fib-retracement', 'rectangle'] }),
    symbolSearch: symbolSearch({
      source,
      onSelect: (result) => void load(result.symbol, shell.chart.data?.requested?.interval ?? START_INTERVAL),
      pageSize: 10,
    }),
    commandPalette: commandPalette(),
    toasts: toasts(),
    replayControls: replayControls(),
  });
  const chart = shell.chart;

  for (const def of builtinIndicators) chart.indicators.register(def);
  chart.addCandles();
  chart.addHistogram({ title: 'Volume', follow: volumeOf }, chart.addPane({ stretch: 0.2 }));
  chart.indicators.add('ema', { length: 21 });
  chart.setDataSource(source);

  let retry: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  /**
   * Load `symbol`; on failure try again after 2, 4, 8... (at most 30) seconds,
   * since the venue rate-limits per IP and a busy network can be refused for a
   * while. A newer load, from the toolbar or the search, ends the retries.
   */
  function load(symbol: string, interval: Interval, attempt = 0): Promise<void> {
    clearTimeout(retry);
    return chart.setSymbol(symbol, interval).catch((error: unknown) => {
      if (destroyed) return;
      const requested = chart.data?.requested;
      if (requested && (requested.symbol !== symbol || requested.interval !== interval)) return;
      const delay = Math.min(30_000, 2000 * 2 ** attempt);
      if (attempt === 0) {
        const message = error instanceof Error ? error.message : String(error);
        chart.notify({ message: `Could not load ${symbol}: ${message}. Trying again shortly.`, kind: 'error' });
      }
      retry = setTimeout(() => void load(symbol, interval, attempt + 1), delay);
    });
  }
  void load(START_SYMBOL, START_INTERVAL);

  return {
    // The class on <html> that holds the palette tokens flips with the scheme, so restyle after it.
    setDark: (next) => requestAnimationFrame(() => shell.setTheme(next ? 'dark' : 'light')),
    destroy: () => {
      destroyed = true;
      clearTimeout(retry);
      shell.destroy();
      void exchange.close();
    },
  };
}
