import { describe, expect, it } from 'vitest';
import * as ta from '../src/index';
import { makeBars, refExp, refRsi, refRunning, refSma, refStdev, refTr, refWindow, type Bars } from './reference';

const nan = (n: number) => new Float64Array(n).fill(NaN);

interface Case {
  name: string;
  lookback: number;
  /** Array form; returns every output. */
  run(b: Bars): Float64Array[];
  /** Slow reference straight from the formula. */
  ref(b: Bars): Float64Array[];
  /** The single-bar form applied bar by bar. */
  at(b: Bars): Float64Array[];
}

/** Applies a single-bar form that returns the value for bar `i`. */
const each = (n: number, f: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => f(i));
/** Applies a single-bar form that writes into `outs` itself. */
function eachInto(n: number, count: number, f: (i: number, outs: Float64Array[]) => void): Float64Array[] {
  const outs = Array.from({ length: count }, () => nan(n));
  for (let i = 0; i < n; i++) f(i, outs);
  return outs;
}

const hlc3 = (b: Bars) => b.close.map((c, i) => (b.high[i]! + b.low[i]! + c) / 3);
const len = (b: Bars) => b.close.length;

const cases: Case[] = [
  {
    name: 'sma',
    lookback: ta.smaLookback(5),
    run: (b) => [ta.sma(b.close, 5)],
    ref: (b) => [refSma(b.close, 5)],
    at: (b) => [each(len(b), (i) => ta.smaAt(b.close, i, 5))],
  },
  {
    name: 'ema',
    lookback: ta.emaLookback(5),
    run: (b) => [ta.ema(b.close, 5)],
    ref: (b) => [refExp(b.close, 5, 2 / 6)],
    at: (b) => eachInto(len(b), 1, (i, [o]) => ta.emaAt(b.close, i, 5, o!)),
  },
  {
    name: 'rma',
    lookback: ta.rmaLookback(5),
    run: (b) => [ta.rma(b.close, 5)],
    ref: (b) => [refExp(b.close, 5, 1 / 5)],
    at: (b) => eachInto(len(b), 1, (i, [o]) => ta.rmaAt(b.close, i, 5, o!)),
  },
  {
    name: 'wma',
    lookback: ta.wmaLookback(5),
    run: (b) => [ta.wma(b.close, 5)],
    ref: (b) => [
      refWindow([b.close], 5, (from) => {
        let s = 0;
        for (let k = 1; k <= 5; k++) s += k * b.close[from + k - 1]!;
        return s / 15;
      }),
    ],
    at: (b) => [each(len(b), (i) => ta.wmaAt(b.close, i, 5))],
  },
  {
    name: 'vwma',
    lookback: ta.vwmaLookback(5),
    run: (b) => [ta.vwma(b.close, b.volume, 5)],
    ref: (b) => [
      refWindow([b.close, b.volume], 5, (from, to) => {
        let pv = 0;
        let v = 0;
        for (let j = from; j <= to; j++) {
          pv += b.close[j]! * b.volume[j]!;
          v += b.volume[j]!;
        }
        return pv / v;
      }),
    ],
    at: (b) => [each(len(b), (i) => ta.vwmaAt(b.close, b.volume, i, 5))],
  },
  {
    name: 'tr',
    lookback: ta.trLookback(),
    run: (b) => [ta.tr(b.high, b.low, b.close)],
    ref: (b) => [refTr(b)],
    at: (b) => [each(len(b), (i) => ta.trAt(b.high, b.low, b.close, i))],
  },
  {
    name: 'atr',
    lookback: ta.atrLookback(5),
    run: (b) => [ta.atr(b.high, b.low, b.close, 5)],
    ref: (b) => [refExp(refTr(b), 5, 1 / 5)],
    at: (b) => eachInto(len(b), 1, (i, [o]) => ta.atrAt(b.high, b.low, b.close, i, 5, o!)),
  },
  {
    name: 'stdev',
    lookback: ta.stdevLookback(5),
    run: (b) => [ta.stdev(b.close, 5)],
    ref: (b) => [refStdev(b.close, 5)],
    at: (b) => [each(len(b), (i) => ta.stdevAt(b.close, i, 5))],
  },
  {
    name: 'bbands',
    lookback: ta.bbandsLookback(5),
    run: (b) => Object.values(ta.bbands(b.close, 5, 2)),
    ref: (b) => {
      const mid = refSma(b.close, 5);
      const sd = refStdev(b.close, 5);
      return [mid, mid.map((m, i) => m + 2 * sd[i]!), mid.map((m, i) => m - 2 * sd[i]!)];
    },
    at: (b) =>
      eachInto(len(b), 3, (i, [middle, upper, lower]) =>
        ta.bbandsAt(b.close, i, 5, 2, { middle: middle!, upper: upper!, lower: lower! }),
      ),
  },
  {
    name: 'rsi',
    lookback: ta.rsiLookback(5),
    run: (b) => [ta.rsi(b.close, 5)],
    ref: (b) => [refRsi(b.close, 5)],
    at: (b) =>
      eachInto(len(b), 3, (i, [o, avgGain, avgLoss]) =>
        ta.rsiAt(b.close, i, 5, o!, { avgGain: avgGain!, avgLoss: avgLoss! }),
      ).slice(0, 1),
  },
  {
    name: 'macd',
    lookback: ta.macdLookback(3, 6, 4),
    run: (b) => Object.values(ta.macd(b.close, 3, 6, 4)),
    ref: (b) => {
      const fast = refExp(b.close, 3, 2 / 4);
      const slow = refExp(b.close, 6, 2 / 7);
      const line = fast.map((f, i) => f - slow[i]!);
      const signal = refExp(line, 4, 2 / 5);
      return [line, signal, line.map((m, i) => m - signal[i]!)];
    },
    at: (b) =>
      eachInto(len(b), 5, (i, [macd, signal, histogram, fast, slow]) =>
        ta.macdAt(b.close, i, 3, 6, 4, { macd: macd!, signal: signal!, histogram: histogram! }, { fast: fast!, slow: slow! }),
      ).slice(0, 3),
  },
  {
    name: 'stoch',
    lookback: ta.stochLookback(5, 2, 3),
    run: (b) => Object.values(ta.stoch(b.high, b.low, b.close, 5, 2, 3)),
    ref: (b) => {
      const raw = refWindow([b.high, b.low, b.close], 5, (from, to) => {
        const hh = Math.max(...b.high.subarray(from, to + 1));
        const ll = Math.min(...b.low.subarray(from, to + 1));
        return hh === ll ? 50 : (100 * (b.close[to]! - ll)) / (hh - ll);
      });
      const k = refSma(raw, 2);
      return [k, refSma(k, 3)];
    },
    at: (b) =>
      eachInto(len(b), 2, (i, [k, d]) => ta.stochAt(b.high, b.low, b.close, i, 5, 2, 3, { k: k!, d: d! })),
  },
  {
    name: 'stochRsi',
    lookback: ta.stochRsiLookback(5, 4, 2, 3),
    run: (b) => Object.values(ta.stochRsi(b.close, 5, 4, 2, 3)),
    ref: (b) => {
      const r = refRsi(b.close, 5);
      const raw = refWindow([r], 4, (from, to) => {
        const hh = Math.max(...r.subarray(from, to + 1));
        const ll = Math.min(...r.subarray(from, to + 1));
        return hh === ll ? 50 : (100 * (r[to]! - ll)) / (hh - ll);
      });
      const k = refSma(raw, 2);
      return [k, refSma(k, 3)];
    },
    at: (b) =>
      eachInto(len(b), 5, (i, [k, d, rsi, avgGain, avgLoss]) =>
        ta.stochRsiAt(b.close, i, 5, 4, 2, 3, { k: k!, d: d! }, { rsi: rsi!, avgGain: avgGain!, avgLoss: avgLoss! }),
      ).slice(0, 2),
  },
  {
    name: 'keltner',
    lookback: ta.keltnerLookback(5, 3),
    run: (b) => Object.values(ta.keltner(b.high, b.low, b.close, 5, 2, 3)),
    ref: (b) => {
      const mid = refExp(b.close, 5, 2 / 6);
      const range = refExp(refTr(b), 3, 1 / 3);
      return [mid, mid.map((m, i) => m + 2 * range[i]!), mid.map((m, i) => m - 2 * range[i]!)];
    },
    at: (b) =>
      eachInto(len(b), 4, (i, [middle, upper, lower, atr]) =>
        ta.keltnerAt(b.high, b.low, b.close, i, 5, 2, 3, { middle: middle!, upper: upper!, lower: lower! }, { atr: atr! }),
      ).slice(0, 3),
  },
  {
    name: 'donchian',
    lookback: ta.donchianLookback(5),
    run: (b) => Object.values(ta.donchian(b.high, b.low, 5)),
    ref: (b) => {
      const upper = refWindow([b.high], 5, (from, to) => Math.max(...b.high.subarray(from, to + 1)));
      const lower = refWindow([b.low], 5, (from, to) => Math.min(...b.low.subarray(from, to + 1)));
      return [upper, lower, upper.map((u, i) => (u + lower[i]!) / 2)];
    },
    at: (b) =>
      eachInto(len(b), 3, (i, [upper, lower, middle]) =>
        ta.donchianAt(b.high, b.low, i, 5, { upper: upper!, lower: lower!, middle: middle! }),
      ),
  },
  {
    name: 'dmi',
    lookback: ta.dmiLookback(5, 4),
    run: (b) => Object.values(ta.dmi(b.high, b.low, b.close, 5, 4)),
    ref: (b) => {
      const move = (sign: 1 | -1) =>
        b.high.map((h, i) => {
          if (i < 1) return NaN;
          const up = h - b.high[i - 1]!;
          const down = b.low[i - 1]! - b.low[i]!;
          if (Number.isNaN(up + down)) return NaN;
          const [a, other] = sign === 1 ? [up, down] : [down, up];
          return a > other && a > 0 ? a : 0;
        });
      const range = refExp(refTr(b).map((t, i) => (i < 1 ? NaN : t)), 5, 1 / 5);
      const plus = refExp(move(1), 5, 1 / 5).map((m, i) => (range[i] === 0 ? 0 : (100 * m) / range[i]!));
      const minus = refExp(move(-1), 5, 1 / 5).map((m, i) => (range[i] === 0 ? 0 : (100 * m) / range[i]!));
      const dx = plus.map((p, i) => (p + minus[i]! === 0 ? 0 : (100 * Math.abs(p - minus[i]!)) / (p + minus[i]!)));
      return [plus, minus, refExp(dx, 4, 1 / 4)];
    },
    at: (b) =>
      eachInto(len(b), 6, (i, [plus, minus, adx, plusDm, minusDm, tr]) =>
        ta.dmiAt(b.high, b.low, b.close, i, 5, 4, { plus: plus!, minus: minus!, adx: adx! }, { plusDm: plusDm!, minusDm: minusDm!, tr: tr! }),
      ).slice(0, 3),
  },
  {
    name: 'supertrend',
    lookback: ta.supertrendLookback(5),
    run: (b) => Object.values(ta.supertrend(b.high, b.low, b.close, 5, 2)),
    ref: (b) => {
      const range = refExp(refTr(b), 5, 1 / 5);
      const line = nan(len(b));
      const direction = nan(len(b));
      let upper = NaN;
      let lower = NaN;
      let dir = NaN;
      for (let i = 0; i < len(b); i++) {
        const mid = (b.high[i]! + b.low[i]!) / 2;
        const c = b.close[i]!;
        if (Number.isNaN(range[i]!)) {
          upper = lower = dir = NaN;
          continue;
        }
        let u = mid + 2 * range[i]!;
        let l = mid - 2 * range[i]!;
        if (Number.isNaN(dir)) dir = c >= mid ? 1 : -1;
        else {
          if (!(u < upper || b.close[i - 1]! > upper)) u = upper;
          if (!(l > lower || b.close[i - 1]! < lower)) l = lower;
          dir = dir === 1 ? (c < l ? -1 : 1) : c > u ? 1 : -1;
        }
        upper = u;
        lower = l;
        direction[i] = dir;
        line[i] = dir === 1 ? l : u;
      }
      return [line, direction];
    },
    at: (b) =>
      eachInto(len(b), 5, (i, [line, direction, atr, upper, lower]) =>
        ta.supertrendAt(b.high, b.low, b.close, i, 5, 2, { line: line!, direction: direction! }, { atr: atr!, upper: upper!, lower: lower! }),
      ).slice(0, 2),
  },
  {
    name: 'ichimoku',
    lookback: ta.ichimokuLookback(3, 5, 8),
    run: (b) => Object.values(ta.ichimoku(b.high, b.low, 3, 5, 8)),
    ref: (b) => {
      const mid = (length: number) =>
        refWindow([b.high, b.low], length, (from, to) =>
          (Math.max(...b.high.subarray(from, to + 1)) + Math.min(...b.low.subarray(from, to + 1))) / 2,
        );
      const conversion = mid(3);
      const base = mid(5);
      return [conversion, base, conversion.map((c, i) => (c + base[i]!) / 2), mid(8)];
    },
    at: (b) =>
      eachInto(len(b), 4, (i, [conversion, base, spanA, spanB]) =>
        ta.ichimokuAt(b.high, b.low, i, 3, 5, 8, { conversion: conversion!, base: base!, spanA: spanA!, spanB: spanB! }),
      ),
  },
  {
    name: 'roc',
    lookback: ta.rocLookback(5),
    run: (b) => [ta.roc(b.close, 5)],
    ref: (b) => [b.close.map((c, i) => (i >= 5 ? (100 * (c - b.close[i - 5]!)) / b.close[i - 5]! : NaN))],
    at: (b) => [each(len(b), (i) => ta.rocAt(b.close, i, 5))],
  },
  {
    name: 'vwap',
    lookback: ta.vwapLookback(),
    run: (b) => [ta.vwap(hlc3(b), b.volume)],
    ref: (b) => {
      const p = hlc3(b);
      return [
        refRunning([p, b.volume], (from, to) => {
          let pv = 0;
          let v = 0;
          for (let j = from; j <= to; j++) {
            pv += p[j]! * b.volume[j]!;
            v += b.volume[j]!;
          }
          return pv / v;
        }),
      ];
    },
    at: (b) =>
      eachInto(len(b), 3, (i, [o, priceVolume, volume]) =>
        ta.vwapAt(hlc3(b), b.volume, i, o!, { priceVolume: priceVolume!, volume: volume! }),
      ).slice(0, 1),
  },
  {
    name: 'obv',
    lookback: ta.obvLookback(),
    run: (b) => [ta.obv(b.close, b.volume)],
    ref: (b) => [
      refRunning([b.close, b.volume], (from, to) => {
        let total = 0;
        for (let j = from + 1; j <= to; j++) total += Math.sign(b.close[j]! - b.close[j - 1]!) * b.volume[j]!;
        return total;
      }),
    ],
    at: (b) => eachInto(len(b), 1, (i, [o]) => ta.obvAt(b.close, b.volume, i, o!)),
  },
  {
    name: 'highest',
    lookback: ta.highestLookback(5),
    run: (b) => [ta.highest(b.high, 5)],
    ref: (b) => [refWindow([b.high], 5, (from, to) => Math.max(...b.high.subarray(from, to + 1)))],
    at: (b) => [each(len(b), (i) => ta.highestAt(b.high, i, 5))],
  },
  {
    name: 'lowest',
    lookback: ta.lowestLookback(5),
    run: (b) => [ta.lowest(b.low, 5)],
    ref: (b) => [refWindow([b.low], 5, (from, to) => Math.min(...b.low.subarray(from, to + 1)))],
    at: (b) => [each(len(b), (i) => ta.lowestAt(b.low, i, 5))],
  },
  {
    name: 'change',
    lookback: ta.changeLookback(2),
    run: (b) => [ta.change(b.close, 2)],
    ref: (b) => [b.close.map((c, i) => (i >= 2 ? c - b.close[i - 2]! : NaN))],
    at: (b) => [each(len(b), (i) => ta.changeAt(b.close, i, 2))],
  },
  {
    name: 'sum',
    lookback: ta.sumLookback(5),
    run: (b) => [ta.sum(b.volume, 5)],
    ref: (b) => [refWindow([b.volume], 5, (from, to) => b.volume.subarray(from, to + 1).reduce((s, x) => s + x, 0))],
    at: (b) => [each(len(b), (i) => ta.sumAt(b.volume, i, 5))],
  },
  {
    name: 'cum',
    lookback: ta.cumLookback(),
    run: (b) => [ta.cum(b.volume)],
    ref: (b) => [refRunning([b.volume], (from, to) => b.volume.subarray(from, to + 1).reduce((s, x) => s + x, 0))],
    at: (b) => eachInto(len(b), 1, (i, [o]) => ta.cumAt(b.volume, i, o!)),
  },
  {
    name: 'crossOver',
    lookback: ta.crossLookback() + ta.smaLookback(3),
    run: (b) => [ta.crossOver(b.close, ta.sma(b.close, 3))],
    ref: (b) => {
      const m = refSma(b.close, 3);
      return [b.close.map((c, i) => (i < 1 || Number.isNaN(m[i - 1]!) || Number.isNaN(c + b.close[i - 1]!) ? NaN : c > m[i]! && b.close[i - 1]! <= m[i - 1]! ? 1 : 0))];
    },
    at: (b) => {
      const m = ta.sma(b.close, 3);
      return [each(len(b), (i) => ta.crossOverAt(b.close, m, i))];
    },
  },
  {
    name: 'crossUnder',
    lookback: ta.crossLookback(),
    run: (b) => [ta.crossUnder(b.close, 100)],
    ref: (b) => [b.close.map((c, i) => (i < 1 || Number.isNaN(c + b.close[i - 1]!) ? NaN : c < 100 && b.close[i - 1]! >= 100 ? 1 : 0))],
    at: (b) => [each(len(b), (i) => ta.crossUnderAt(b.close, 100, i))],
  },
];

function expectSeries(actual: Float64Array[], expected: Float64Array[]): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((a, k) => {
    const e = expected[k]!;
    expect(a.length).toBe(e.length);
    for (let i = 0; i < a.length; i++) {
      const msg = `output ${k}, bar ${i}`;
      if (Number.isNaN(e[i]!)) expect(a[i], msg).toBeNaN();
      else expect(a[i], msg).toBeCloseTo(e[i]!, 8);
    }
  });
}

const firstValid = (a: Float64Array) => a.findIndex((x) => !Number.isNaN(x));
const copy = (b: Bars): Bars => ({ high: b.high.slice(), low: b.low.slice(), close: b.close.slice(), volume: b.volume.slice() });

describe.each(cases)('$name', (c) => {
  const clean = makeBars(120);
  const gapped = makeBars(120, [30, 31, 70]);

  it('matches the formula', () => {
    expectSeries(c.run(clean), c.ref(clean));
  });

  it('has NaN warmup for exactly its lookback', () => {
    // Multi-output helpers report the lookback of their slowest output.
    expect(Math.max(...c.run(clean).map(firstValid))).toBe(c.lookback);
  });

  it('handles empty input', () => {
    for (const out of c.run(makeBars(0))) expect(out.length).toBe(0);
  });

  it('handles length-1 input', () => {
    const one = makeBars(1);
    for (const out of c.run(one)) {
      expect(out.length).toBe(1);
      if (c.lookback > 0) expect(out[0]).toBeNaN();
      else expect(out[0]).not.toBeNaN();
    }
  });

  it('breaks and restarts at NaN gaps like the formula', () => {
    const outs = c.run(gapped);
    expectSeries(outs, c.ref(gapped));
    for (const out of outs) expect(out[30]).toBeNaN();
    // Values come back after the gap once the warmup is over again.
    for (const out of outs) expect(Number.isNaN(out[119]!)).toBe(false);
  });

  it('single-bar form matches the array form', () => {
    expectSeries(c.at(clean), c.run(clean));
    expectSeries(c.at(gapped), c.run(gapped));
  });

  it('does not mutate its inputs', () => {
    const before = copy(gapped);
    c.run(gapped);
    c.at(gapped);
    expect(gapped).toEqual(before);
  });
});
