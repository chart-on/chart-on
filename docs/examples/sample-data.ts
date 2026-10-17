/**
 * Deterministic sample data for the docs examples: the same bars on every
 * page load, so the pictures and the code agree. Not part of the library;
 * in an app these come from your own feed.
 */
import type { Bar } from '@charton/core';

/** One hour, the interval of the sample bars. */
export const HOUR = 3600;

/** 2026-01-01 00:00 UTC, the time of the first sample bar. */
const START = Date.UTC(2026, 0, 1) / 1000;

/** A seeded random walk: hourly bars with volume and buy volume, starting at `from`. */
export function sampleBars(count = 300, { seed = 7, from = START, price = 100 } = {}): Bar[] {
  const rand = random(seed);
  const bars: Bar[] = [];
  let close = price;
  for (let i = 0; i < count; i++) {
    const open = close;
    close = Math.max(1, open + (rand() - 0.5) * 3);
    const high = Math.max(open, close) + rand() * 1.5;
    const low = Math.min(open, close) - rand() * 1.5;
    const volume = 500 + rand() * 1500;
    // Buyers dominate rising bars.
    const buyVolume = volume * (0.5 + (0.4 * (close - open)) / Math.max(high - low, 1e-9));
    bars.push({ time: from + i * HOUR, open, high, low, close, volume, buyVolume });
  }
  return bars;
}

/**
 * Stands in for a server: `count` older bars ending just before `before`,
 * after a short delay, or none before 2025.
 */
export async function fetchOlderBars(before: number, count = 200): Promise<Bar[]> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const from = Math.max(Date.UTC(2025, 0, 1) / 1000, before - count * HOUR);
  const n = Math.round((before - from) / HOUR);
  return n > 0 ? sampleBars(n, { seed: from, from, price: 100 }) : [];
}

/**
 * Stands in for a WebSocket: calls `onTick` every `ms` with the forming bar
 * moved a little, rolling a new bar every `ticksPerBar` ticks. Returns a stop function.
 */
export function sampleTicks(last: Bar, onTick: (bar: Bar) => void, { ms = 250, ticksPerBar = 20 } = {}): () => void {
  const rand = random(last.time);
  let bar = { ...last };
  let ticks = 0;
  const timer = setInterval(() => {
    if (++ticks % ticksPerBar === 0) bar = { time: bar.time + HOUR, open: bar.close, high: bar.close, low: bar.close, close: bar.close, volume: 0 };
    const close = Math.max(1, bar.close + (rand() - 0.5) * 0.8);
    bar = { ...bar, close, high: Math.max(bar.high, close), low: Math.min(bar.low, close), volume: (bar.volume ?? 0) + rand() * 40 };
    onTick(bar);
  }, ms);
  return () => clearInterval(timer);
}

function random(seed: number): () => number {
  let s = Math.abs(Math.floor(seed)) % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
