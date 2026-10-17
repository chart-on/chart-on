import {
  createChart,
  createFootprintBuilder,
  depthLane,
  footprintSeries,
  heatmap,
  type Bar,
  type Chart,
  type DepthLevel,
  type FootprintBar,
  type TradeTick,
} from '@charton/core';
import { errorText, retheme, rng, themeFor, whenVisible, type Section } from './section';

/** Price grid: rows of 5 from 59,400 up. */
const STEP = 5;
const ROWS = 240;
const LOW = 59_400;
/** One-minute bars, five ticks each; a tick every 0.8 s once live. */
const BAR = 60;
const TICKS = 5;
const TICK_MS = 800;
const HISTORY = 240;
/** Levels the depth lane shows per side. */
const LEVELS = 40;
/** Bar spacing (css px) that leaves room for footprint row text. */
const FOOTPRINT_SPACING = 56;
/** Chart width (css px) below which the legend shows closes only and the depth lane narrows. */
const NARROW = 480;

/**
 * A made-up order book: thin resting size that thickens away from the price,
 * plus large walls that appear, fade, get pulled, or get traded through. The
 * price wanders and often turns back from a large wall in its way.
 */
function createMarket(random: () => number) {
  const mid = LOW + (ROWS / 2) * STEP;
  const grain = Float32Array.from({ length: ROWS }, () => 0.6 + random() * 0.8);
  const walls = new Map<number, number>();
  const rowOf = (price: number) => Math.round((price - LOW) / STEP);
  let price = mid;

  const restingAt = (row: number) => {
    const distance = Math.abs(LOW + row * STEP - price) / STEP;
    if (distance < 1) return 0;
    return grain[row]! * (4 + 10 * (1 - Math.exp(-distance / 12))) + (walls.get(row) ?? 0);
  };

  return {
    tick(): number {
      if (random() < 0.35) {
        const row = rowOf(price) + (random() < 0.5 ? -1 : 1) * (3 + Math.floor(random() * 45));
        if (row >= 0 && row < ROWS) walls.set(row, (walls.get(row) ?? 0) + 20 + random() ** 3 * 260);
      }
      for (const [row, size] of walls) {
        const next = size * (0.98 + random() * 0.025);
        if (next < 6 || random() < 0.008) walls.delete(row);
        else walls.set(row, next);
      }
      let move = (random() - 0.5) * STEP * 5 + (mid - price) * 0.003;
      if ((walls.get(rowOf(price + Math.sign(move) * STEP * 2)) ?? 0) > 120 && random() < 0.75) move *= -0.6;
      const from = rowOf(price);
      price = Math.min(LOW + (ROWS - 20) * STEP, Math.max(LOW + 20 * STEP, price + move));
      // Size the price trades through is filled.
      const to = rowOf(price);
      for (let row = Math.min(from, to); row <= Math.max(from, to); row++) walls.delete(row);
      return Math.round(price * 100) / 100;
    },
    /** Resting size per price row, both sides. */
    column(): Float32Array {
      return Float32Array.from({ length: ROWS }, (_, row) => restingAt(row));
    },
    /** The nearest levels each side, for the depth lane. */
    book(): { bids: DepthLevel[]; asks: DepthLevel[] } {
      const at = rowOf(price);
      const side = (dir: 1 | -1) =>
        Array.from({ length: LEVELS }, (_, i) => at + dir * (i + 1))
          .filter((row) => row >= 0 && row < ROWS)
          .map((row) => ({ price: LOW + row * STEP, size: Math.round(restingAt(row)) }));
      return { bids: side(-1), asks: side(1) };
    },
  };
}

/** Candles over a liquidity heatmap with the live book beside the price axis, all simulated. */
export function mountOrderFlow(root: HTMLElement, dark: boolean): Section {
  const host = root.querySelector<HTMLElement>('[data-flow-chart]')!;
  const note = root.querySelector<HTMLElement>('[data-flow-note]')!;
  const key = root.querySelector<HTMLElement>('[data-flow-key]')!;
  let chart: Chart | null = null;
  let timer = 0;
  let isDark = dark;

  // The key's swatches take the chart theme's colours.
  const paintKey = () => {
    const theme = themeFor(isDark);
    key.style.setProperty('--lp-key-bid', theme.bid);
    key.style.setProperty('--lp-key-ask', theme.ask);
    key.style.setProperty('--lp-key-up', theme.up);
    key.style.setProperty('--lp-key-down', theme.down);
    key.style.setProperty('--lp-key-heat', `linear-gradient(90deg, ${theme.heatmap.join(', ')})`);
  };
  paintKey();

  const stopWatching = whenVisible(host, () => {
    try {
      const random = rng(7);
      const market = createMarket(random);
      const narrow = host.clientWidth < NARROW;
      const c = createChart(host, {
        theme: themeFor(isDark),
        legend: narrow ? { mode: 'compact', showChange: false } : undefined,
        plugins: [heatmap(), depthLane()],
      });
      chart = c;
      const candles = c.addCandles({ title: 'Simulated' });
      const heat = c.addHeatmap({ title: 'Resting size', legend: false, opacity: 0.85 });
      const footprint = c.addCustomSeries(footprintSeries, { title: 'Footprint' });
      footprint.setVisible(false);
      const lane = c.addDepthLane({ width: narrow ? 44 : 72, maxLevels: LEVELS });
      const builder = createFootprintBuilder({ interval: '1m', rowSize: STEP });
      const footprints: FootprintBar[] = [];

      /** A few trades for one tick, walking from the last price to the new one: buys lift, sells hit. */
      const tradesFor = (from: number, to: number, time: number): TradeTick[] => {
        const count = 2 + Math.floor(random() * 5);
        return Array.from({ length: count }, (_, i) => ({
          time: time + i * 0.1,
          price: from + ((to - from) * (i + 1)) / count,
          size: Math.round(1 / (1 - random() * 0.97)),
          side: random() < (to >= from ? 0.65 : 0.35) ? 'buy' : 'sell',
        }));
      };

      // One tick: the price moves, trades print, and the forming bar and footprint follow.
      let last = market.tick();
      let bar: Bar = { time: Math.floor(Date.now() / 1000 / BAR) * BAR - (HISTORY + 1) * BAR, open: last, high: last, low: last, close: last };
      let ticks = TICKS;
      const advance = () => {
        if (ticks === TICKS) {
          bar = { time: bar.time + BAR, open: last, high: last, low: last, close: last };
          ticks = 0;
        }
        const price = market.tick();
        for (const trade of tradesFor(last, price, bar.time + ticks * (BAR / TICKS))) {
          const changed = builder.push(trade);
          if (!changed) continue;
          if (footprints.at(-1)?.time === changed.time) footprints[footprints.length - 1] = changed;
          else footprints.push(changed);
        }
        bar.high = Math.max(bar.high, price);
        bar.low = Math.min(bar.low, price);
        bar.close = last = price;
        ticks++;
      };

      // History: one heatmap column per bar, taken at the bar's close.
      const bars: Bar[] = [];
      const values = new Float32Array(HISTORY * ROWS);
      for (let i = 0; i < HISTORY; i++) {
        do advance();
        while (ticks < TICKS);
        bars.push({ ...bar });
        values.set(market.column(), i * ROWS);
      }
      candles.setData(bars);
      footprint.setData(footprints);
      heat.setData({ times: bars.map((b) => b.time), priceStart: LOW, priceStep: STEP, rows: ROWS, values });
      lane.setLevels(market.book());

      // Each view switches on and off from the key, so the chart opens uncrowded.
      const spacing = c.barSpacing;
      const rightOffset = c.options.rightOffset;
      const views: Record<string, (on: boolean) => void> = {
        heatmap: (on) => heat.setVisible(on),
        book: (on) => lane.applyOptions({ visible: on }),
        // Footprint rows need room: it replaces the candles and zooms in on the newest bars.
        footprint: (on) => {
          footprint.setVisible(on);
          candles.setVisible(!on);
          c.applyOptions({ rightOffset: on ? 1 : rightOffset });
          c.setBarSpacing(on ? FOOTPRINT_SPACING : spacing);
          c.scrollToRealtime(false);
        },
      };
      for (const button of key.querySelectorAll<HTMLButtonElement>('[data-flow-view]')) {
        button.addEventListener('click', () => {
          const on = button.getAttribute('aria-pressed') !== 'true';
          button.setAttribute('aria-pressed', String(on));
          views[button.dataset.flowView!]?.(on);
        });
      }

      // Live: the newest bar forms tick by tick, then the next one starts.
      timer = window.setInterval(() => {
        if (document.hidden || !chart) return;
        advance();
        candles.update({ ...bar });
        footprint.update(footprints[footprints.length - 1]!);
        heat.updateColumn(bar.time, market.column());
        lane.setLevels(market.book());
      }, TICK_MS);
    } catch (error) {
      note.textContent = errorText(error);
      note.hidden = false;
    }
  });

  return {
    setDark(value) {
      isDark = value;
      paintKey();
      retheme([chart], value);
    },
    destroy() {
      stopWatching();
      clearInterval(timer);
      chart?.destroy();
      chart = null;
    },
  };
}
