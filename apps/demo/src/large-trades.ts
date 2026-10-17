import type { Bar, ChartTheme, PointItem } from '@charton/core';
import { rng } from './data';

/** A simulated large print: when, at what price, how big, and which side took liquidity. */
export interface LargeTrade {
  time: number;
  price: number;
  size: number;
  buy: boolean;
}

/**
 * Made-up large trades inside `bar`: none to a few per bar at exact times
 * within it, prices inside its range, sizes heavy-tailed so a few prints
 * dwarf the rest. Seeded by the bar time, so reloads show the same trades.
 */
export function tradesIn(bar: Bar, interval: number): LargeTrade[] {
  const random = rng(bar.time);
  const count = Math.floor(random() ** 2 * 5);
  const out: LargeTrade[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      time: bar.time + random() * interval,
      price: bar.low + random() * (bar.high - bar.low),
      // Pareto tail: most prints near the minimum, rare ones far above it.
      size: 50 / (1 - random() * 0.98) ** 0.9,
      buy: random() < (bar.close >= bar.open ? 0.65 : 0.35),
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Trades of every bar, in time order. */
export function largeTrades(bars: readonly Bar[], interval: number): LargeTrade[] {
  return bars.flatMap((bar) => tradesIn(bar, interval));
}

/** As markers sized by trade size, buys in the theme's rising colour and sells in its falling one. */
export function tradePoint(trade: LargeTrade, theme: ChartTheme): PointItem {
  return { time: trade.time, value: trade.price, size: trade.size, color: trade.buy ? theme.up : theme.down };
}
