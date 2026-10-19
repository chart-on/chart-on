import type { Chart, DepthLane, DepthLevel } from '@chart-on/core';

/**
 * A synthetic order book for the demo's depth lane: levels on both sides of
 * the newest close, with sizes that drift ten times a second. A real app
 * would feed the lane from its own market data instead.
 */
export interface DemoDepth {
  lane: DepthLane & { remove(): void };
  stop(): void;
}

const LEVELS = 60;
const UPDATE_MS = 100;

/** A price step that gives about LEVELS rows over a few percent of `price`. */
function tickFor(price: number): number {
  const raw = (price * 0.03) / LEVELS;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / magnitude;
  return (unit < 2 ? 1 : unit < 5 ? 2 : 5) * magnitude;
}

export function startDemoDepth(chart: Chart, lastPrice: () => number | null): DemoDepth {
  const lane = chart.addDepthLane({ width: 90, labels: true });
  let center = NaN;
  let tick = 1;

  const level = (price: number, distance: number): DepthLevel => ({
    price: Number(price.toFixed(10)),
    // Thicker further from the spread, with some noise and the odd large resting order.
    size: Math.round((5 + distance * 1.5) * (0.5 + Math.random()) * (Math.random() < 0.05 ? 6 : 1)),
  });

  const snapshot = () => {
    const price = lastPrice();
    if (price === null || !(price > 0)) return;
    tick = tickFor(price);
    center = Math.round(price / tick) * tick;
    const bids: DepthLevel[] = [];
    const asks: DepthLevel[] = [];
    for (let i = 0; i < LEVELS; i++) {
      bids.push(level(center - (i + 1) * tick, i));
      asks.push(level(center + i * tick + tick, i));
    }
    lane.setLevels({ bids, asks });
  };

  const step = () => {
    const price = lastPrice();
    if (price === null) return;
    // The book recentres when price leaves it; otherwise a few levels change size.
    if (!Number.isFinite(center) || Math.abs(price - center) > tick * 3) {
      snapshot();
      return;
    }
    const bids: DepthLevel[] = [];
    const asks: DepthLevel[] = [];
    for (let k = 0; k < 8; k++) {
      const i = Math.floor(Math.random() * LEVELS);
      if (Math.random() < 0.5) bids.push(level(center - (i + 1) * tick, i));
      else asks.push(level(center + (i + 1) * tick, i));
    }
    lane.update({ bids, asks });
  };

  snapshot();
  const timer = setInterval(step, UPDATE_MS);
  return {
    lane,
    stop() {
      clearInterval(timer);
      lane.remove();
    },
  };
}
