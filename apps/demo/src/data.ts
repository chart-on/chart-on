import type { Bar, HeatmapData, ValuePoint } from '@chart-on/core';
import { seededRandom } from '@chart-on/core/internal';

/** Deterministic PRNG so reloads show the same simulation. */
export const rng = seededRandom;

export interface Liquidity {
  heatmap: HeatmapData;
  liquidations: ValuePoint[];
  cvd: ValuePoint[];
}

interface Level {
  price: number;
  size: number;
  long: boolean;
}

/**
 * Simulated liquidation levels: each bar opens leveraged positions whose
 * liquidation prices persist until price trades through them.
 */
export class LiquiditySim {
  private levels: Level[] = [];
  private cvdTotal = 0;
  private readonly rand: () => number;

  constructor(
    readonly priceStart: number,
    readonly priceStep: number,
    readonly rows: number,
    seed = 11,
  ) {
    this.rand = rng(seed);
  }

  static forBars(bars: Bar[], rows = 480): LiquiditySim {
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of bars) {
      lo = Math.min(lo, b.low);
      hi = Math.max(hi, b.high);
    }
    lo *= 0.8;
    hi *= 1.2;
    return new LiquiditySim(lo, (hi - lo) / rows, rows);
  }

  /** Advance one bar; returns heatmap column, net liquidation and cvd. */
  step(bar: Bar): { column: Float32Array; liquidation: number; cvd: number } {
    const r = this.rand;
    let liquidated = 0;
    this.levels = this.levels.filter((l) => {
      const hit = l.long ? bar.low <= l.price : bar.high >= l.price;
      if (hit) liquidated += l.long ? -l.size : l.size;
      return !hit;
    });
    const spawn = 6 + Math.floor(r() * 10);
    for (let i = 0; i < spawn; i++) {
      const leverage = [5, 10, 20, 25, 50, 100][Math.floor(r() * 6)]!;
      const long = r() < 0.5;
      const dist = (1 / leverage) * (0.9 + r() * 0.2);
      this.levels.push({ price: bar.close * (long ? 1 - dist : 1 + dist), size: Math.pow(r(), 3) * 40, long });
    }
    if (this.levels.length > 4000) this.levels.splice(0, this.levels.length - 4000);
    const column = this.column();
    this.cvdTotal += (bar.close - bar.open) * 120 + gaussLike(r) * 4000;
    return { column, liquidation: liquidated * 1e5, cvd: this.cvdTotal * 1e3 };
  }

  /** Snapshot of the current levels (for live updates of the forming bar). */
  column(): Float32Array {
    const col = new Float32Array(this.rows);
    for (const l of this.levels) {
      const row = Math.floor((l.price - this.priceStart) / this.priceStep);
      if (row >= 0 && row < this.rows) col[row]! += l.size;
    }
    return col;
  }

  run(bars: Bar[]): Liquidity {
    const values = new Float32Array(bars.length * this.rows);
    const liquidations: ValuePoint[] = [];
    const cvd: ValuePoint[] = [];
    bars.forEach((bar, i) => {
      const s = this.step(bar);
      values.set(s.column, i * this.rows);
      liquidations.push({ time: bar.time, value: s.liquidation });
      cvd.push({ time: bar.time, value: s.cvd });
    });
    return {
      heatmap: {
        times: bars.map((b) => b.time),
        priceStart: this.priceStart,
        priceStep: this.priceStep,
        rows: this.rows,
        values,
      },
      liquidations,
      cvd,
    };
  }
}

function gaussLike(r: () => number): number {
  return r() + r() + r() - 1.5;
}
