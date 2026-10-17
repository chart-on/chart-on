import { describe, expect, it } from 'vitest';
import * as ta from '../src/index';

const N = NaN;
const f64 = (values: number[]) => Float64Array.from(values);

function expectValues(actual: Float64Array, expected: number[]): void {
  expect(actual.length).toBe(expected.length);
  expected.forEach((e, i) => {
    if (Number.isNaN(e)) expect(actual[i], `bar ${i}`).toBeNaN();
    else expect(actual[i], `bar ${i}`).toBeCloseTo(e, 6);
  });
}

describe('hand-computed values', () => {
  const v = f64([2, 4, 6, 8, 12]);

  it('averages', () => {
    expectValues(ta.sma(v, 3), [N, N, 4, 6, 26 / 3]);
    // Seed (2 + 4 + 6) / 3 = 4, then alpha 0.5.
    expectValues(ta.ema(v, 3), [N, N, 4, 6, 9]);
    // Same seed, alpha 1/3.
    expectValues(ta.rma(v, 3), [N, N, 4, 16 / 3, 16 / 3 + (12 - 16 / 3) / 3]);
    expectValues(ta.wma(v, 3), [N, N, 28 / 6, 40 / 6, 58 / 6]);
    expectValues(ta.vwma(v, f64([1, 1, 2, 2, 0]), 2), [N, 3, 16 / 3, 7, 8]);
  });

  it('rsi', () => {
    // Changes +1 +1 -1 -1 +1; length 2.
    expectValues(ta.rsi(f64([1, 2, 3, 2, 1, 2]), 2), [N, N, 100, 50, 25, 62.5]);
  });

  it('true range and stdev', () => {
    const high = f64([10, 12, 11]);
    const low = f64([8, 9, 7]);
    const close = f64([9, 11, 8]);
    expectValues(ta.tr(high, low, close), [2, 3, 4]);
    expectValues(ta.stdev(f64([2, 4, 4, 4, 5, 5, 7, 9]), 8), [N, N, N, N, N, N, N, 2]);
  });

  it('stochastic rsi', () => {
    // RSI(2) is [N, N, 100, 50, 25, 62.5] (see above); %K over 2 bars, unsmoothed.
    const out = ta.stochRsi(f64([1, 2, 3, 2, 1, 2]), 2, 2, 1, 2);
    expectValues(out.k, [N, N, N, 0, 0, 100]);
    expectValues(out.d, [N, N, N, N, 0, 50]);
  });

  it('channels', () => {
    const close = f64([10, 11, 12, 13]);
    const high = close.map((c) => c + 1);
    const low = close.map((c) => c - 1);
    // Every true range is 2, so ATR(2) is 2; EMA(2) seeds at 10.5, then alpha 2/3.
    const kc = ta.keltner(high, low, close, 2, 2, 2);
    expectValues(kc.middle, [N, 10.5, 11.5, 12.5]);
    expectValues(kc.upper, [N, 14.5, 15.5, 16.5]);
    expectValues(kc.lower, [N, 6.5, 7.5, 8.5]);
    const dc = ta.donchian(f64([3, 5, 4, 6]), f64([1, 2, 2, 3]), 2);
    expectValues(dc.upper, [N, 5, 5, 6]);
    expectValues(dc.lower, [N, 1, 2, 2]);
    expectValues(dc.middle, [N, 3, 3.5, 4]);
  });

  it('directional movement', () => {
    // +DM 2 1 0 0, -DM 0 0 2 1 and TR 3 3 4 4 from bar 1; Wilder averages over 2.
    const high = f64([10, 12, 13, 12, 11]);
    const low = f64([8, 9, 10, 8, 7]);
    const close = f64([9, 11, 12, 9, 8]);
    const out = ta.dmi(high, low, close, 2, 2);
    expectValues(out.plus, [N, N, 50, 150 / 7, 10]);
    expectValues(out.minus, [N, N, 0, 200 / 7, 80 / 3]);
    // DX 100, 100/7, 500/11.
    expectValues(out.adx, [N, N, N, 400 / 7, 3950 / 77]);
  });

  it('supertrend', () => {
    // ATR(1) is the true range: 2, 2, 4.5, 2, 4. Down on bar 2, up again on bar 4.
    const high = f64([11, 12, 11, 9, 12]);
    const low = f64([9, 10, 7, 7, 10]);
    const close = f64([10.5, 11.5, 7.5, 8, 11.8]);
    const out = ta.supertrend(high, low, close, 1, 1);
    // Bands: the upper one holds at 12 on bars 1-2, drops to 10 on bar 3 and holds there.
    expectValues(out.line, [8, 9, 12, 10, 7]);
    expectValues(out.direction, [1, 1, -1, -1, 1]);
  });

  it('ichimoku', () => {
    const out = ta.ichimoku(f64([4, 6, 5]), f64([2, 3, 1]), 1, 2, 3);
    expectValues(out.conversion, [3, 4.5, 3]);
    expectValues(out.base, [N, 4, 3.5]);
    expectValues(out.spanA, [N, 4.25, 3.25]);
    expectValues(out.spanB, [N, N, 3.5]);
  });

  it('momentum and volume', () => {
    expectValues(ta.roc(f64([10, 11, 12, 9]), 2), [N, N, 20, -200 / 11]);
    expectValues(ta.obv(f64([10, 11, 11, 9]), f64([5, 3, 4, 2])), [0, 3, 3, 1]);
    expectValues(ta.vwap(f64([10, 20, 30]), f64([1, 3, 0])), [10, 17.5, 17.5]);
    expectValues(ta.change(f64([1, 4, 9])), [N, 3, 5]);
    expectValues(ta.cum(f64([1, 4, 9])), [1, 5, 14]);
    expectValues(ta.highest(f64([3, 1, 4, 1, 5]), 2), [N, 3, 4, 4, 5]);
    expectValues(ta.lowest(f64([3, 1, 4, 1, 5]), 2), [N, 1, 1, 1, 1]);
    expectValues(ta.crossOver(f64([1, 3, 2, 4]), 2), [N, 1, 0, 1]);
    expectValues(ta.crossUnder(f64([3, 1, 2, 1]), 2), [N, 1, 0, 1]);
  });
});

describe('edge cases', () => {
  it('rsi reads 50 on a flat series', () => {
    expectValues(ta.rsi(f64([5, 5, 5, 5]), 2), [N, N, 50, 50]);
  });

  it('stoch reads 50 when the range is zero', () => {
    const flat = f64([5, 5, 5]);
    expectValues(ta.stoch(flat, flat, flat, 2, 1, 1).k, [N, 50, 50]);
  });

  it('roc, vwma and vwap are NaN on a zero base or zero volume', () => {
    expectValues(ta.roc(f64([0, 1]), 1), [N, N]);
    expectValues(ta.vwma(f64([1, 2]), f64([0, 0]), 2), [N, N]);
    expectValues(ta.vwap(f64([1, 2]), f64([0, 1])), [N, 2]);
  });

  it('vwma is NaN on an all-zero-volume window after fractional volumes', () => {
    // The window is rebuilt at bar 2; by bar 4 subtracting 0.1 and 0.2 leaves
    // rounding residue in the rolling volume although every volume is 0.
    const price = f64([10, 20, 30, 40, 50]);
    const volume = f64([0.1, 0.2, 0, 0, 0]);
    expectValues(ta.vwma(price, volume, 3), [N, N, 50 / 3, 20, N]);
    expect(ta.vwmaAt(price, volume, 4, 3)).toBeNaN();
  });

  it('rolling sums stay close to the single-bar forms on long series', () => {
    let x = 0.1;
    const values = Float64Array.from({ length: 20000 }, () => (x = (x * 9301 + 49297) % 233280) / 7);
    const volume = Float64Array.from(values, (v, i) => (i % 7 === 0 ? 0 : v / 3));
    const last = values.length - 1;
    const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9 * Math.max(1, Math.abs(b)));
    close(ta.sma(values, 50)[last]!, ta.smaAt(values, last, 50));
    close(ta.wma(values, 50)[last]!, ta.wmaAt(values, last, 50));
    close(ta.vwma(values, volume, 50)[last]!, ta.vwmaAt(values, volume, last, 50));
    close(ta.sum(values, 50)[last]!, ta.sumAt(values, last, 50));
    close(ta.stdev(values, 50)[last]!, ta.stdevAt(values, last, 50));
  });

  it('vwap restarts on each new session', () => {
    const price = f64([10, 20, 30, 40]);
    const volume = f64([1, 1, 1, 1]);
    const session = (i: number) => i === 2;
    expectValues(ta.vwap(price, volume, session), [10, 15, 30, 35]);
    const state = { priceVolume: new Float64Array(4), volume: new Float64Array(4) };
    const out = new Float64Array(4);
    for (let i = 0; i < 4; i++) ta.vwapAt(price, volume, i, out, state, session);
    expectValues(out, [10, 15, 30, 35]);
  });

  it('stdev stays accurate on large prices', () => {
    const values = Float64Array.from({ length: 500 }, (_, i) => 1e9 + (i % 2));
    const out = ta.stdev(values, 10);
    expect(out[499]).toBeCloseTo(0.5, 9);
  });

  it('single-bar forms continue a live last bar', () => {
    // An indicator's update rewrites the last bar on every tick.
    const close = f64([1, 2, 3, 4, 5, 6]);
    const out = ta.ema(close, 3);
    close[5] = 9;
    ta.emaAt(close, 5, 3, out);
    expect(out[5]).toBeCloseTo(ta.ema(close, 3)[5]!, 12);
  });

  it('fills and returns a given out array', () => {
    const out = new Float64Array(3);
    expect(ta.sma(f64([1, 2, 3]), 2, out)).toBe(out);
    const bands = { middle: new Float64Array(3), upper: new Float64Array(3), lower: new Float64Array(3) };
    expect(ta.bbands(f64([1, 2, 3]), 2, 2, bands).upper).toBe(bands.upper);
  });

  it('rejects bad arguments', () => {
    const v = f64([1, 2, 3]);
    expect(() => ta.sma(v, 0)).toThrow(RangeError);
    expect(() => ta.ema(v, 2.5)).toThrow(RangeError);
    expect(() => ta.sma(v, 2, new Float64Array(2))).toThrow(RangeError);
    expect(() => ta.sma(v, 2, v)).toThrow();
    expect(() => ta.tr(v, v, f64([1, 2]))).toThrow(RangeError);
    expect(() => ta.macd(v, 3, 6, 0)).toThrow(RangeError);
    expect(() => ta.highestAt(v, 2, 0)).toThrow(RangeError);
    expect(() => ta.smaAt(v, 2, 1.5)).toThrow(RangeError);
    expect(() => ta.emaAt(v, 2, 0, new Float64Array(3))).toThrow(RangeError);
    expect(() => ta.dmi(v, v, v, 3, 0)).toThrow(RangeError);
    expect(() => ta.keltner(v, v, v, 3, 2, 1.5)).toThrow(RangeError);
    expect(() => ta.stochRsi(v, 0, 3, 1, 1)).toThrow(RangeError);
    expect(() => ta.ichimoku(v, f64([1, 2]), 1, 2, 3)).toThrow(RangeError);
  });

  it('accepts plain number arrays', () => {
    expectValues(ta.sma([1, 2, 3], 2), [N, 1.5, 2.5]);
  });
});

describe('moonPhase', () => {
  const at = (iso: string) => ta.moonPhase(Date.parse(iso) / 1000);
  const half = ta.SYNODIC_MONTH / 2;

  // Published times of eclipses, which fall on new moons (solar) and full moons (lunar).
  it.each(['2010-01-15T07:11Z', '2017-08-21T18:30Z', '2024-04-08T18:21Z', '2026-08-12T17:37Z'])('is about new at %s', (iso) => {
    const { age, illumination } = at(iso);
    expect(Math.min(age, ta.SYNODIC_MONTH - age)).toBeLessThan(1);
    expect(illumination).toBeLessThan(0.03);
  });

  it.each(['2019-01-21T05:16Z', '2022-11-08T11:02Z', '2025-03-14T06:55Z'])('is about full at %s', (iso) => {
    const { age, illumination } = at(iso);
    expect(Math.abs(age - half)).toBeLessThan(1);
    expect(illumination).toBeGreaterThan(0.97);
  });

  it('ages from 0 up to a month, also before the reference new moon', () => {
    for (const iso of ['1970-01-01T00:00Z', '1999-12-31T00:00Z', '2030-06-01T12:00Z']) {
      const { age, illumination } = at(iso);
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(ta.SYNODIC_MONTH);
      expect(illumination).toBeGreaterThanOrEqual(0);
      expect(illumination).toBeLessThanOrEqual(1);
    }
    const newMoon = Date.parse('2000-01-06T18:14Z') / 1000;
    expect(ta.moonPhase(newMoon).age).toBeCloseTo(0, 6);
    expect(ta.moonPhase(newMoon + half * 86400).illumination).toBeCloseTo(1, 8);
  });
});
