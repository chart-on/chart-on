import { describe, expect, it } from 'vitest';
import { moonPhase, SYNODIC_MONTH } from '@charton/ta';
import { inputFields, resolveInputs, type Bar, type BarArrays, type IndicatorDef, type InputValue } from '@charton/core';
import { indicatorTitle, validateIndicatorDef } from '../../core/src/indicators/indicator';
import { IndicatorRunner } from '../../core/src/indicators/runner';
import {
  bollingerIndicator,
  builtinIndicators,
  cumulativeVolumeIndicator,
  emaIndicator,
  macdIndicator,
  rsiIndicator,
  smaIndicator,
  volumeMaIndicator,
  vwapIndicator,
  atrIndicator,
  stochIndicator,
  stochRsiIndicator,
  dmiIndicator,
  obvIndicator,
  keltnerIndicator,
  donchianIndicator,
  supertrendIndicator,
  ichimokuIndicator,
  moonPhaseIndicator,
} from '../src/index';

const N = NaN;

function columns(bars: Bar[]): BarArrays {
  const col = (f: (b: Bar) => number) => Float64Array.from(bars, f);
  return {
    length: bars.length,
    time: col((b) => b.time),
    open: col((b) => b.open),
    high: col((b) => b.high),
    low: col((b) => b.low),
    close: col((b) => b.close),
    volume: col((b) => b.volume ?? NaN),
  };
}

/** Flat bars (open = high = low = close) with the given closes, one minute apart. */
const flat = (closes: number[], volume = 1): Bar[] =>
  closes.map((c, i) => ({ time: i * 60, open: c, high: c, low: c, close: c, volume }));

function run<I extends Record<string, InputValue>>(def: IndicatorDef<I>, bars: Bar[], inputs: Partial<I> = {}) {
  const resolved = resolveInputs(def.inputs, inputs as Record<string, InputValue>) as I;
  return def.compute(columns(bars), resolved, {}, {}) as Record<string, Float64Array>;
}

function expectValues(actual: Float64Array | undefined, expected: number[]): void {
  expect(actual).toBeDefined();
  expect(actual!.length).toBe(expected.length);
  expected.forEach((e, i) => {
    if (Number.isNaN(e)) expect(actual![i], `bar ${i}`).toBeNaN();
    else expect(actual![i], `bar ${i}`).toBeCloseTo(e, 8);
  });
}

describe('legend titles', () => {
  const title = (def: IndicatorDef) => indicatorTitle(def, resolveInputs(def.inputs, {}));

  it('show only the meaningful inputs', () => {
    expect(title(rsiIndicator as unknown as IndicatorDef)).toBe('RSI 14');
    expect(title(macdIndicator as unknown as IndicatorDef)).toBe('MACD 12 26 9');
    expect(title(bollingerIndicator as unknown as IndicatorDef)).toBe('BB 20 2');
    expect(title(smaIndicator as unknown as IndicatorDef)).toBe('SMA 20 close');
  });
});

describe('reference values', () => {
  const closes = [2, 4, 6, 8, 12];

  it('SMA and EMA', () => {
    expectValues(run(smaIndicator, flat(closes), { length: 3 }).sma, [N, N, 4, 6, 26 / 3]);
    // Seed (2 + 4 + 6) / 3, then smoothing 0.5.
    expectValues(run(emaIndicator, flat(closes), { length: 3 }).ema, [N, N, 4, 6, 9]);
  });

  it('SMA reads the chosen source', () => {
    const bars: Bar[] = [
      { time: 0, open: 1, high: 4, low: 0, close: 2 },
      { time: 60, open: 2, high: 6, low: 2, close: 4 },
    ];
    expectValues(run(smaIndicator, bars, { length: 2, source: 'hl2' }).sma, [N, 3]);
  });

  it('Bollinger Bands', () => {
    // Window [2, 4, 4, 4, 5, 5, 7, 9]: mean 5, population stdev 2.
    const out = run(bollingerIndicator, flat([2, 4, 4, 4, 5, 5, 7, 9]), { length: 8, mult: 2 });
    expect(out.middle![7]).toBeCloseTo(5, 10);
    expect(out.upper![7]).toBeCloseTo(9, 10);
    expect(out.lower![7]).toBeCloseTo(1, 10);
    expect(out.upper![6]).toBeNaN();
  });

  it('VWAP restarts each UTC day', () => {
    const day = 86400;
    const bars: Bar[] = [
      { time: day - 120, open: 10, high: 10, low: 10, close: 10, volume: 1 },
      { time: day - 60, open: 20, high: 20, low: 20, close: 20, volume: 3 },
      { time: day, open: 30, high: 30, low: 30, close: 30, volume: 1 },
      { time: day + 60, open: 40, high: 40, low: 40, close: 40, volume: 1 },
      { time: day + 120, open: 50, high: 50, low: 50, close: 50 },
    ];
    expectValues(run(vwapIndicator, bars).vwap, [10, 17.5, 30, 35, N]);
  });

  it('VWAP skips a bar without volume mid-session', () => {
    const bars = flat([10, 20, 30]).map((b, i) => (i === 1 ? { ...b, volume: undefined } : b));
    expectValues(run(vwapIndicator, bars).vwap, [10, N, 20]);
  });

  it('RSI with its guides', () => {
    // Changes +1 +1 -1 -1 +1 with length 2.
    const out = run(rsiIndicator, flat([1, 2, 3, 2, 1, 2]), { length: 2 });
    expectValues(out.rsi, [N, N, 100, 50, 25, 62.5]);
    expectValues(out.upper, [70, 70, 70, 70, 70, 70]);
    expectValues(out.lower, [30, 30, 30, 30, 30, 30]);
  });

  it('RSI declares a fixed 0-100 pane range', () => {
    expect(rsiIndicator.fixedRange).toEqual({ min: 0, max: 100 });
    expect(() => validateIndicatorDef(rsiIndicator as unknown as IndicatorDef)).not.toThrow();
  });

  it('MACD', () => {
    // On a straight line EMA(2) lags by 0.5 and EMA(3) by 1, so the MACD line is 0.5.
    const out = run(macdIndicator, flat([1, 2, 3, 4, 5, 6]), { fast: 2, slow: 3, signal: 2 });
    expectValues(out.macd, [N, N, 0.5, 0.5, 0.5, 0.5]);
    expectValues(out.signal, [N, N, N, 0.5, 0.5, 0.5]);
    expectValues(out.histogram, [N, N, N, 0, 0, 0]);
  });

  it('volume moving average', () => {
    const bars = flat([1, 1, 1, 1]).map((b, i) => ({ ...b, volume: [100, 200, 300, 600][i]! }));
    const out = run(volumeMaIndicator, bars, { length: 2 });
    expectValues(out.volume, [100, 200, 300, 600]);
    expectValues(out.ma, [N, 150, 250, 450]);
  });

  it('cumulative volume, plain and signed by bar direction', () => {
    // Up, down, unchanged, no volume, up.
    const bars: Bar[] = [
      { time: 0, open: 1, high: 2, low: 1, close: 2, volume: 100 },
      { time: 60, open: 2, high: 2, low: 1, close: 1, volume: 40 },
      { time: 120, open: 1, high: 1, low: 1, close: 1, volume: 10 },
      { time: 180, open: 1, high: 3, low: 1, close: 3 },
      { time: 240, open: 3, high: 4, low: 3, close: 4, volume: 5 },
    ];
    expectValues(run(cumulativeVolumeIndicator, bars).total, [100, 140, 150, 150, 155]);
    expectValues(run(cumulativeVolumeIndicator, bars, { signed: true }).total, [100, 60, 60, 60, 65]);
  });

  it('cumulative volume draws on the left scale', () => {
    expect(cumulativeVolumeIndicator.placement).toBe('overlay');
    expect(cumulativeVolumeIndicator.priceScale).toBe('left');
    const title = (signed: boolean) => indicatorTitle(cumulativeVolumeIndicator as unknown as IndicatorDef, { signed, color: '' });
    expect(title(false)).toBe('Cumulative volume');
    expect(title(true)).toBe('Cumulative volume (signed)');
  });

  it('signed cumulative volume updates live like a full recompute', () => {
    const def = cumulativeVolumeIndicator as unknown as IndicatorDef;
    const inputs = resolveInputs(def.inputs, { signed: true });
    const bars = randomBars(120);
    const listener = { change: () => {}, error: (e: unknown) => { throw e; } };
    const live = new IndicatorRunner(def, inputs, listener);
    live.setBars(bars.slice(0, 80));
    for (const bar of bars.slice(80)) {
      live.updateLast({ ...bar, close: bar.open, volume: 1 }, true);
      live.updateLast(bar, false);
    }
    const full = new IndicatorRunner(def, inputs, listener);
    full.setBars(bars);
    expectValues(live.out.total, Array.from(full.out.total!));
  });
});

/** Deterministic bars with real ranges and volume. */
function randomBars(n: number): Bar[] {
  let s = 11;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let price = 100;
  return Array.from({ length: n }, (_, i) => {
    const open = price;
    price = Math.max(1, price + (rand() - 0.5) * 3);
    return {
      time: i * 3600,
      open,
      high: Math.max(open, price) + rand(),
      low: Math.min(open, price) - rand(),
      close: price,
      // Some bars have no volume, to exercise gaps in live updates.
      volume: i % 37 === 5 ? undefined : Math.floor(rand() * 1000),
    };
  });
}

describe.each(builtinIndicators.map((def) => ({ def, name: def.name })))('$name', ({ def }) => {
  it('is a valid definition', () => {
    expect(() => validateIndicatorDef(def)).not.toThrow();
  });

  it('live updates match a full recompute', () => {
    const bars = randomBars(300);
    const listener = { change: () => {}, error: (e: unknown) => { throw e; } };
    const live = new IndicatorRunner(def, resolveInputs(def.inputs, {}), listener);
    live.setBars(bars.slice(0, 200));
    // Each new bar arrives and then ticks before the next one.
    for (const bar of bars.slice(200)) {
      live.updateLast({ ...bar, close: bar.open }, true);
      live.updateLast(bar, false);
    }
    const full = new IndicatorRunner(def, resolveInputs(def.inputs, {}), listener);
    full.setBars(bars);
    for (const plot of def.plots) {
      const a = live.out[plot.id]!;
      const b = full.out[plot.id]!;
      expect(a.length).toBe(300);
      for (let i = 0; i < 300; i++) {
        if (Number.isNaN(b[i]!)) expect(a[i], `${plot.id} bar ${i}`).toBeNaN();
        else expect(a[i], `${plot.id} bar ${i}`).toBeCloseTo(b[i]!, 8);
      }
      // Supertrend draws one of its two lines at a time, depending on the trend;
      // moon phases mark a few bars a month.
      if (def.id !== 'supertrend' && def.id !== 'moon-phase') expect(Number.isNaN(b[299]!)).toBe(false);
    }
    if (def.id === 'supertrend') {
      expect(Number.isNaN(full.out.up![299]!) !== Number.isNaN(full.out.down![299]!)).toBe(true);
    }
  });

  it('handles no bars and a single bar', () => {
    for (const bars of [[], randomBars(1)]) {
      const out = def.compute(columns(bars), resolveInputs(def.inputs, {}), {}, {}) as Record<string, Float64Array>;
      for (const plot of def.plots) expect(out[plot.id]!.length).toBe(bars.length);
    }
  });
});

describe('lookback', () => {
  // The plot whose first value ends each indicator's warm-up.
  const main: [IndicatorDef, string][] = [
    [smaIndicator as unknown as IndicatorDef, 'sma'],
    [emaIndicator as unknown as IndicatorDef, 'ema'],
    [bollingerIndicator as unknown as IndicatorDef, 'middle'],
    [vwapIndicator as unknown as IndicatorDef, 'vwap'],
    [rsiIndicator as unknown as IndicatorDef, 'rsi'],
    [macdIndicator as unknown as IndicatorDef, 'histogram'],
    [volumeMaIndicator as unknown as IndicatorDef, 'ma'],
    [cumulativeVolumeIndicator as unknown as IndicatorDef, 'total'],
    [atrIndicator as unknown as IndicatorDef, 'atr'],
    [stochIndicator as unknown as IndicatorDef, 'd'],
    [stochRsiIndicator as unknown as IndicatorDef, 'd'],
    [dmiIndicator as unknown as IndicatorDef, 'adx'],
    [obvIndicator as unknown as IndicatorDef, 'obv'],
    [keltnerIndicator as unknown as IndicatorDef, 'upper'],
    [donchianIndicator as unknown as IndicatorDef, 'middle'],
    // The trailing line before it is split into the up and down plots.
    [supertrendIndicator as unknown as IndicatorDef, 'line'],
    [ichimokuIndicator as unknown as IndicatorDef, 'spanB'],
  ];
  const bars = flat(Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1));

  it('is declared by every built-in', () => {
    // Moon phases mark events rather than warm up; tested on their own.
    const warming = builtinIndicators.filter((d) => d.id !== 'moon-phase');
    expect(main.map(([def]) => def.id).sort()).toEqual(warming.map((d) => d.id).sort());
  });

  it.each(main)('matches the first valid value of %s', (def, plot) => {
    const custom: Record<string, InputValue> = { length: 7, fast: 5, slow: 9, signal: 4 };
    for (const given of [{}, custom]) {
      const known = Object.fromEntries(Object.entries(given).filter(([k]) => def.inputs.some((d) => d.id === k)));
      const inputs = resolveInputs(def.inputs, known);
      const out = run(def, bars, inputs)[plot]!;
      expect(out.findIndex((v) => !Number.isNaN(v))).toBe(def.lookback!(inputs));
    }
  });
});

/** Bars from columns, one minute apart; open is the previous close. */
function ohlc(high: number[], low: number[], close: number[], volume?: (number | undefined)[]): Bar[] {
  return close.map((c, i) => ({
    time: i * 60,
    open: i > 0 ? close[i - 1]! : c,
    high: high[i]!,
    low: low[i]!,
    close: c,
    volume: volume ? volume[i] : 1,
  }));
}

describe('trend, volatility and oscillator reference values', () => {
  it('ATR', () => {
    // True ranges 2, 3, 4; Wilder's average over 2 seeds at 2.5.
    const bars = ohlc([10, 12, 11], [8, 9, 7], [9, 11, 8]);
    expectValues(run(atrIndicator, bars, { length: 2 }).atr, [N, 2.5, 3.25]);
  });

  it('Stochastic with its guides', () => {
    // Raw %K over 2 bars: 75, 20, 250/3.
    const bars = ohlc([4, 6, 5, 7], [2, 3, 1, 4], [3, 5, 2, 6]);
    const out = run(stochIndicator, bars, { kLength: 2, kSmooth: 1, dLength: 2 });
    expectValues(out.k, [N, 75, 20, 250 / 3]);
    expectValues(out.d, [N, N, 47.5, 155 / 3]);
    expectValues(out.upper, [80, 80, 80, 80]);
    expectValues(out.lower, [20, 20, 20, 20]);
  });

  it('Stochastic RSI', () => {
    // RSI(2) is [N, N, 100, 50, 25, 62.5].
    const out = run(stochRsiIndicator, flat([1, 2, 3, 2, 1, 2]), { rsiLength: 2, stochLength: 2, kSmooth: 1, dLength: 2 });
    expectValues(out.k, [N, N, N, 0, 0, 100]);
    expectValues(out.d, [N, N, N, N, 0, 50]);
  });

  it('DMI', () => {
    const bars = ohlc([10, 12, 13, 12, 11], [8, 9, 10, 8, 7], [9, 11, 12, 9, 8]);
    const out = run(dmiIndicator, bars, { length: 2, adxLength: 2 });
    expectValues(out.plus, [N, N, 50, 150 / 7, 10]);
    expectValues(out.minus, [N, N, 0, 200 / 7, 80 / 3]);
    expectValues(out.adx, [N, N, N, 400 / 7, 3950 / 77]);
  });

  it('OBV skips a bar without volume', () => {
    const bars = flat([10, 11, 11, 9, 10]).map((b, i) => ({ ...b, volume: [5, 3, 4, 2, undefined][i] }));
    expectValues(run(obvIndicator, bars).obv, [0, 3, 3, 1, 1]);
  });

  it('Keltner and Donchian channels', () => {
    const close = [10, 11, 12, 13];
    const bars = ohlc(close.map((c) => c + 1), close.map((c) => c - 1), close);
    const kc = run(keltnerIndicator, bars, { length: 2, mult: 2, atrLength: 2 });
    expectValues(kc.middle, [N, 10.5, 11.5, 12.5]);
    expectValues(kc.upper, [N, 14.5, 15.5, 16.5]);
    expectValues(kc.lower, [N, 6.5, 7.5, 8.5]);
    const dc = run(donchianIndicator, ohlc([3, 5, 4, 6], [1, 2, 2, 3], [2, 4, 3, 5]), { length: 2 });
    expectValues(dc.upper, [N, 5, 5, 6]);
    expectValues(dc.lower, [N, 1, 2, 2]);
    expectValues(dc.middle, [N, 3, 3.5, 4]);
  });

  it('Supertrend splits its line by trend', () => {
    const bars = ohlc([11, 12, 11, 9, 12], [9, 10, 7, 7, 10], [10.5, 11.5, 7.5, 8, 11.8]);
    const out = run(supertrendIndicator, bars, { length: 1, mult: 1 });
    expectValues(out.up, [8, 9, N, N, 7]);
    expectValues(out.down, [N, N, 12, 10, N]);
  });

  it('Ichimoku shifts the leading spans forward', () => {
    const bars = ohlc([4, 6, 5, 7], [2, 3, 1, 4], [3, 5, 2, 6]);
    const out = run(ichimokuIndicator, bars, { conversionLength: 1, baseLength: 2, spanBLength: 3, displacement: 1 });
    expectValues(out.conversion, [3, 4.5, 3, 5.5]);
    expectValues(out.base, [N, 4, 3.5, 4]);
    expectValues(out.spanA, [N, N, 4.25, 3.25]);
    expectValues(out.spanB, [N, N, N, 3.5]);
  });

  it('oscillators declare a fixed 0-100 pane range', () => {
    expect(stochIndicator.fixedRange).toEqual({ min: 0, max: 100 });
    expect(stochRsiIndicator.fixedRange).toEqual({ min: 0, max: 100 });
  });

  it('legend titles', () => {
    const title = (def: IndicatorDef) => indicatorTitle(def, resolveInputs(def.inputs, {}));
    expect(title(stochIndicator as unknown as IndicatorDef)).toBe('Stoch 14 3 3');
    expect(title(stochRsiIndicator as unknown as IndicatorDef)).toBe('Stoch RSI 14 14 3 3');
    expect(title(dmiIndicator as unknown as IndicatorDef)).toBe('DMI 14 14');
    expect(title(atrIndicator as unknown as IndicatorDef)).toBe('ATR 14');
    expect(title(keltnerIndicator as unknown as IndicatorDef)).toBe('KC 20 2 10');
    expect(title(supertrendIndicator as unknown as IndicatorDef)).toBe('Supertrend 10 3');
    expect(title(ichimokuIndicator as unknown as IndicatorDef)).toBe('Ichimoku 9 26 52 26');
  });
});

describe('settings groups', () => {
  const groups = (def: IndicatorDef) => inputFields(def.inputs).map((g) => [g.name, g.fields.map((f) => f.input.id)]);

  it('MACD and Bollinger Bands group their inputs into sections', () => {
    expect(groups(macdIndicator as unknown as IndicatorDef)).toEqual([
      ['Calculation', ['fast', 'slow', 'signal', 'source']],
      ['Lines', ['color', 'signalColor']],
      ['Histogram', ['upColor', 'downColor']],
    ]);
    expect(groups(bollingerIndicator as unknown as IndicatorDef)).toEqual([
      ['Basis', ['length', 'source']],
      ['Bands', ['mult']],
      ['Style', ['color']],
    ]);
  });
});

describe('moon phases', () => {
  const DAY = 86400;
  // Bars from 2024-01-01 00:00 UTC; `step` seconds apart, skipping any time `skip` keeps out.
  function bars(count: number, step: number, skip: (t: number) => boolean = () => false): Bar[] {
    const out: Bar[] = [];
    for (let t = 1704067200; out.length < count; t += step) {
      if (!skip(t)) out.push({ time: t, open: 1, high: 1, low: 1, close: 1 });
    }
    return out;
  }
  const marked = (values: Float64Array, list: Bar[]) => list.filter((_, i) => !Number.isNaN(values[i]!)).map((b) => b.time);
  const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

  it('marks the first daily bar on or after each new and full moon', () => {
    const list = bars(120, DAY);
    const out = run(moonPhaseIndicator, list);
    // Mean new moons 2024-01-11 08:16, 02-09 21:00, 03-10 09:44, 04-08 22:28 UTC;
    // full moons 01-26 02:38, 02-24 15:22, 03-25 04:06, 04-23 16:50.
    expect(marked(out.newMoon!, list).map(date)).toEqual(['2024-01-12', '2024-02-10', '2024-03-11', '2024-04-09']);
    expect(marked(out.fullMoon!, list).map(date)).toEqual(['2024-01-27', '2024-02-25', '2024-03-26', '2024-04-24']);
  });

  it('marks one intraday bar per event', () => {
    const list = bars(60 * 24, 3600);
    const out = run(moonPhaseIndicator, list);
    expect(marked(out.newMoon!, list)).toHaveLength(2);
    expect(marked(out.fullMoon!, list)).toHaveLength(2);
    // The marked hour bar is the first at or after the event.
    for (const t of marked(out.newMoon!, list)) expect(moonPhase(t).age).toBeLessThan(1 / 24);
    for (const t of marked(out.fullMoon!, list)) {
      expect(moonPhase(t).age - SYNODIC_MONTH / 2).toBeGreaterThanOrEqual(0);
      expect(moonPhase(t).age - SYNODIC_MONTH / 2).toBeLessThan(1 / 24);
    }
  });

  it('keeps events that fall in a gap on the next bar', () => {
    // Weekdays only, so the bars on Saturday 2024-01-27, Saturday 02-10 and
    // Sunday 02-25 are missing: those events land on the Mondays after.
    const weekend = (t: number) => [0, 6].includes(new Date(t * 1000).getUTCDay());
    const list = bars(80, DAY, weekend);
    const out = run(moonPhaseIndicator, list);
    expect(marked(out.newMoon!, list).map(date)).toEqual(['2024-01-12', '2024-02-12', '2024-03-11', '2024-04-09']);
    expect(marked(out.fullMoon!, list).map(date)).toEqual(['2024-01-29', '2024-02-26', '2024-03-26']);
  });

  it('hides either kind with its input and never marks the first bar', () => {
    const list = bars(60, DAY);
    const out = run(moonPhaseIndicator, list, { showNew: false });
    expect(marked(out.newMoon!, list)).toEqual([]);
    expect(marked(out.fullMoon!, list)).toHaveLength(2);
    // The first bar has no earlier bar to tell whether the event was before the data.
    expect(run(moonPhaseIndicator, bars(1, DAY)).newMoon![0]).toBeNaN();
    expect(moonPhaseIndicator.lookback!(resolveInputs(moonPhaseIndicator.inputs, {}) as never)).toBe(1);
  });
});
