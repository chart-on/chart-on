import { sourceAt, sourceOf, type IndicatorDef, type IndicatorOutputs, type InputDef, type SourceKey } from '@charton/core';
import {
  atr,
  atrAt,
  atrLookback,
  bbands,
  bbandsAt,
  bbandsLookback,
  dmi,
  dmiAt,
  dmiLookback,
  donchian,
  donchianAt,
  donchianLookback,
  ema,
  emaAt,
  emaLookback,
  ichimoku,
  ichimokuAt,
  ichimokuLookback,
  keltner,
  keltnerAt,
  keltnerLookback,
  macd,
  macdAt,
  macdLookback,
  moonPhase,
  obv,
  obvAt,
  obvLookback,
  rsi,
  rsiAt,
  rsiLookback,
  sma,
  smaAt,
  smaLookback,
  SYNODIC_MONTH,
  stoch,
  stochAt,
  stochLookback,
  stochRsi,
  stochRsiAt,
  stochRsiLookback,
  supertrend,
  supertrendAt,
  supertrendLookback,
  vwap,
  vwapAt,
  vwapLookback,
  type SessionStart,
} from '@charton/ta';

// Colour inputs default to '' (the theme's line colour). Guides and fills are
// translucent greys and blues that read on dark and light backgrounds.
const GUIDE = 'rgba(139, 139, 153, 0.6)';
const GUIDE_FILL = 'rgba(139, 139, 153, 0.08)';
const BAND_FILL = 'rgba(56, 132, 255, 0.08)';
const SIGNAL = '#f29a2e';
const VOLUME = 'rgba(139, 139, 153, 0.45)';
// The default theme's up and down colours, for lines that switch with the trend.
const UP = '#3cc4a0';
const DOWN = '#e8574a';
const CLOUD_FILL = 'rgba(139, 139, 153, 0.12)';

const lengthInput = (value: number): InputDef => ({
  id: 'length',
  type: 'number',
  label: 'Length',
  default: value,
  min: 1,
  max: 1000,
  step: 1,
});
const sourceInput = (value: SourceKey = 'close'): InputDef => ({ id: 'source', type: 'source', label: 'Source', default: value });
const colorInput = (id = 'color', value = '', label = 'Color'): InputDef => ({ id, type: 'color', label, default: value });
/** `input` in settings-form section `group`. */
const inGroup = (group: string, input: InputDef): InputDef => ({ ...input, group });

/** The input values of `smaIndicator` and `emaIndicator`, by input id. */
export type MaInputs = { length: number; source: SourceKey; color: string };

// Indicators keep their source as an extra output, so `update` reads one new
// value per tick instead of rebuilding a derived source (hl2, hlc3...).

/** Simple moving average, on the price pane unless added in a pane of its own. */
export const smaIndicator: IndicatorDef<MaInputs> = {
  id: 'sma',
  name: 'SMA',
  description: 'Average of the last N closes, weighting each bar equally.',
  category: 'trend',
  aliases: ['Simple Moving Average', 'MA'],
  placement: 'either',
  inputs: [lengthInput(20), sourceInput(), colorInput()],
  plots: [{ id: 'sma', type: 'line', colorInput: 'color' }],
  compute(src, { length, source }) {
    const values = sourceOf(src, source);
    return { sma: sma(values, length), source: values };
  },
  update(src, { length, source }, i, out) {
    out.source![i] = sourceAt(src, source, i);
    out.sma![i] = smaAt(out.source!, i, length);
  },
  lookback: ({ length }) => smaLookback(length),
};

/** Exponential moving average, on the price pane unless added in a pane of its own. */
export const emaIndicator: IndicatorDef<MaInputs> = {
  id: 'ema',
  name: 'EMA',
  description: 'Moving average that weights recent bars more, so it turns sooner than an SMA.',
  category: 'trend',
  aliases: ['Exponential Moving Average', 'MA'],
  placement: 'either',
  inputs: [lengthInput(20), sourceInput(), colorInput()],
  plots: [{ id: 'ema', type: 'line', colorInput: 'color' }],
  compute(src, { length, source }) {
    const values = sourceOf(src, source);
    return { ema: ema(values, length), source: values };
  },
  update(src, { length, source }, i, out) {
    out.source![i] = sourceAt(src, source, i);
    emaAt(out.source!, i, length, out.ema!);
  },
  lookback: ({ length }) => emaLookback(length),
};

/** The input values of `bollingerIndicator`, by input id. */
export type BandsInputs = { length: number; mult: number; source: SourceKey; color: string };

/** Bollinger Bands: an SMA with bands `mult` standard deviations away, filled between. */
export const bollingerIndicator: IndicatorDef<BandsInputs> = {
  id: 'bbands',
  name: 'BB',
  title: ({ length, mult }) => `BB ${length} ${mult}`,
  description: 'Moving average with bands a number of standard deviations above and below it.',
  category: 'volatility',
  aliases: ['Bollinger Bands', 'BBands'],
  placement: 'overlay',
  inputs: [
    inGroup('Basis', lengthInput(20)),
    inGroup('Basis', sourceInput()),
    { id: 'mult', type: 'number', label: 'StdDev', group: 'Bands', default: 2, min: 0.1, max: 10, step: 0.1 },
    inGroup('Style', colorInput()),
  ],
  plots: [
    { id: 'upper', type: 'line', title: 'Upper', colorInput: 'color', lineWidth: 1 },
    { id: 'middle', type: 'line', title: 'Basis', colorInput: 'color', lineWidth: 1 },
    { id: 'lower', type: 'line', title: 'Lower', colorInput: 'color', lineWidth: 1 },
  ],
  fills: [{ between: ['upper', 'lower'], color: BAND_FILL }],
  compute(src, { length, mult, source }) {
    const values = sourceOf(src, source);
    return { ...bbands(values, length, mult), source: values };
  },
  update(src, { length, mult, source }, i, out) {
    out.source![i] = sourceAt(src, source, i);
    bbandsAt(out.source!, i, length, mult, { middle: out.middle!, upper: out.upper!, lower: out.lower! });
  },
  lookback: ({ length }) => bbandsLookback(length),
};

/** The input values of `vwapIndicator`, by input id. */
export type VwapInputs = { source: SourceKey; color: string };

const DAY = 86400;

/** True on the first bar of each UTC day. */
const dailyUtc =
  (time: ArrayLike<number>): SessionStart =>
  (i) =>
    i > 0 && Math.floor(time[i]! / DAY) !== Math.floor(time[i - 1]! / DAY);

/** Volume as weights: a bar without volume adds nothing, instead of restarting the sums. */
const weight = (volume: number) => (Number.isNaN(volume) ? 0 : volume);

/**
 * Volume-weighted average price, restarting each UTC day. A bar without volume
 * reads no value and leaves the session's sums as they were.
 */
export const vwapIndicator: IndicatorDef<VwapInputs> = {
  id: 'vwap',
  name: 'VWAP',
  description: 'Average price weighted by volume, restarting each day.',
  category: 'volume',
  aliases: ['Volume Weighted Average Price'],
  placement: 'overlay',
  inputs: [sourceInput('hlc3'), colorInput()],
  plots: [{ id: 'vwap', type: 'line', colorInput: 'color' }],
  compute(src, { source }) {
    const n = src.length;
    const price = sourceOf(src, source);
    const weights = src.volume.map(weight);
    const state = { priceVolume: new Float64Array(n), volume: new Float64Array(n) };
    const out = vwap(price, weights, dailyUtc(src.time), undefined, state);
    for (let i = 0; i < n; i++) if (Number.isNaN(src.volume[i]!)) out[i] = NaN;
    return { vwap: out, source: price, weights, pv: state.priceVolume, vol: state.volume };
  },
  update(src, { source }, i, out) {
    out.source![i] = sourceAt(src, source, i);
    out.weights![i] = weight(src.volume[i]!);
    vwapAt(out.source!, out.weights!, i, out.vwap!, { priceVolume: out.pv!, volume: out.vol! }, dailyUtc(src.time));
    if (Number.isNaN(src.volume[i]!)) out.vwap![i] = NaN;
  },
  lookback: () => vwapLookback(),
};

/** The input values of `rsiIndicator`, by input id. */
export type RsiInputs = { length: number; source: SourceKey; upper: number; lower: number; color: string };

/** Wilder's RSI in its own pane, with shaded upper and lower guides (70 and 30). */
export const rsiIndicator: IndicatorDef<RsiInputs> = {
  id: 'rsi',
  name: 'RSI',
  title: ({ length }) => `RSI ${length}`,
  description: 'Momentum from 0 to 100 comparing recent gains with losses, with overbought and oversold guides.',
  category: 'momentum',
  aliases: ['Relative Strength Index'],
  placement: 'pane',
  fixedRange: { min: 0, max: 100 },
  precision: 2,
  inputs: [
    lengthInput(14),
    sourceInput(),
    { id: 'upper', type: 'number', label: 'Upper', default: 70, min: 0, max: 100 },
    { id: 'lower', type: 'number', label: 'Lower', default: 30, min: 0, max: 100 },
    colorInput(),
  ],
  plots: [
    { id: 'upper', type: 'line', title: 'Upper', color: GUIDE, lineWidth: 1, lastValueLabel: false },
    { id: 'lower', type: 'line', title: 'Lower', color: GUIDE, lineWidth: 1, lastValueLabel: false },
    { id: 'rsi', type: 'line', title: 'RSI', colorInput: 'color' },
  ],
  fills: [{ between: ['upper', 'lower'], color: GUIDE_FILL }],
  compute(src, { length, source, upper, lower }) {
    const n = src.length;
    const values = sourceOf(src, source);
    const state = { avgGain: new Float64Array(n), avgLoss: new Float64Array(n) };
    return {
      rsi: rsi(values, length, undefined, state),
      upper: new Float64Array(n).fill(upper),
      lower: new Float64Array(n).fill(lower),
      source: values,
      ...state,
    };
  },
  update(src, { length, source, upper, lower }, i, out) {
    out.source![i] = sourceAt(src, source, i);
    out.upper![i] = upper;
    out.lower![i] = lower;
    rsiAt(out.source!, i, length, out.rsi!, { avgGain: out.avgGain!, avgLoss: out.avgLoss! });
  },
  lookback: ({ length }) => rsiLookback(length),
};

/** The input values of `macdIndicator`, by input id. */
export type MacdInputs = {
  fast: number;
  slow: number;
  signal: number;
  source: SourceKey;
  color: string;
  signalColor: string;
  upColor: string;
  downColor: string;
};

/** MACD line, signal line and a histogram in up and down colours (the theme's by default), in its own pane. */
export const macdIndicator: IndicatorDef<MacdInputs> = {
  id: 'macd',
  name: 'MACD',
  title: ({ fast, slow, signal }) => `MACD ${fast} ${slow} ${signal}`,
  description: 'Gap between a fast and a slow EMA, its signal line and their difference as a histogram.',
  category: 'momentum',
  aliases: ['Moving Average Convergence Divergence'],
  placement: 'pane',
  inputs: [
    { id: 'fast', type: 'number', label: 'Fast', group: 'Calculation', default: 12, min: 1, max: 500, step: 1 },
    { id: 'slow', type: 'number', label: 'Slow', group: 'Calculation', default: 26, min: 1, max: 500, step: 1 },
    { id: 'signal', type: 'number', label: 'Signal', group: 'Calculation', default: 9, min: 1, max: 500, step: 1 },
    inGroup('Calculation', sourceInput()),
    inGroup('Lines', colorInput('color', '', 'MACD')),
    inGroup('Lines', colorInput('signalColor', SIGNAL, 'Signal')),
    { id: 'upColor', type: 'color', label: 'Positive', group: 'Histogram', role: 'up', default: '' },
    { id: 'downColor', type: 'color', label: 'Negative', group: 'Histogram', role: 'down', default: '' },
  ],
  plots: [
    { id: 'histogram', type: 'histogram', title: 'Histogram', positiveColorInput: 'upColor', negativeColorInput: 'downColor' },
    { id: 'macd', type: 'line', title: 'MACD', colorInput: 'color' },
    { id: 'signal', type: 'line', title: 'Signal', colorInput: 'signalColor' },
  ],
  compute(src, { fast, slow, signal, source }) {
    const n = src.length;
    const values = sourceOf(src, source);
    const state = { fast: new Float64Array(n), slow: new Float64Array(n) };
    const out = macd(values, fast, slow, signal, undefined, state);
    return { ...out, source: values, fastEma: state.fast, slowEma: state.slow };
  },
  update(src, { fast, slow, signal, source }, i, out) {
    out.source![i] = sourceAt(src, source, i);
    macdAt(
      out.source!,
      i,
      fast,
      slow,
      signal,
      { macd: out.macd!, signal: out.signal!, histogram: out.histogram! },
      { fast: out.fastEma!, slow: out.slowEma! },
    );
  },
  lookback: ({ fast, slow, signal }) => macdLookback(fast, slow, signal),
};

/** The input values of `volumeMaIndicator`, by input id. */
export type VolumeMaInputs = { length: number; color: string };

/** Volume columns with their simple moving average, in their own pane. */
export const volumeMaIndicator: IndicatorDef<VolumeMaInputs> = {
  id: 'volume-ma',
  name: 'Volume',
  description: 'Traded volume per bar as columns, with a moving average line.',
  category: 'volume',
  aliases: ['Volume MA'],
  placement: 'pane',
  inputs: [lengthInput(20), colorInput()],
  plots: [
    { id: 'volume', type: 'histogram', title: 'Volume', color: VOLUME, lastValueLabel: false },
    { id: 'ma', type: 'line', title: 'MA', colorInput: 'color' },
  ],
  compute(src, { length }) {
    return { volume: src.volume.slice(), ma: sma(src.volume, length) };
  },
  update(src, { length }, i, out) {
    out.volume![i] = src.volume[i]!;
    out.ma![i] = smaAt(src.volume, i, length);
  },
  lookback: ({ length }) => smaLookback(length),
};

/** The input values of `cumulativeVolumeIndicator`, by input id. */
export type CumulativeVolumeInputs = { signed: boolean; color: string };

/** One bar's change to the running total: its volume, signed by direction when asked; none without volume. */
function volumeStep(src: { open: Float64Array; close: Float64Array; volume: Float64Array }, i: number, signed: boolean): number {
  const volume = weight(src.volume[i]!);
  if (!signed) return volume;
  const move = src.close[i]! - src.open[i]!;
  return move > 0 ? volume : move < 0 ? -volume : 0;
}

/**
 * Running total of volume since the first loaded bar, on the left price scale
 * so it does not squash the candles. With `signed`, up bars (close above open)
 * add their volume, down bars subtract it and unchanged bars add nothing. A
 * bar without volume leaves the total as it was.
 */
export const cumulativeVolumeIndicator: IndicatorDef<CumulativeVolumeInputs> = {
  id: 'cumulative-volume',
  name: 'Cumulative volume',
  description: 'Running total of volume, optionally signed by bar direction, on its own left scale.',
  category: 'volume',
  aliases: ['Accumulated volume', 'Cumulative Volume'],
  title: ({ signed }) => (signed ? 'Cumulative volume (signed)' : 'Cumulative volume'),
  placement: 'overlay',
  priceScale: 'left',
  inputs: [{ id: 'signed', type: 'boolean', label: 'Signed by bar direction', default: false }, colorInput()],
  plots: [{ id: 'total', type: 'line', colorInput: 'color' }],
  compute(src, { signed }) {
    const total = new Float64Array(src.length);
    let sum = 0;
    for (let i = 0; i < src.length; i++) total[i] = sum += volumeStep(src, i, signed);
    return { total };
  },
  update(src, { signed }, i, out) {
    out.total![i] = (i > 0 ? out.total![i - 1]! : 0) + volumeStep(src, i, signed);
  },
  lookback: () => 0,
};

/** A whole-number input in settings-form section `group`. */
const countInput = (id: string, label: string, value: number, group?: string): InputDef => ({
  id,
  type: 'number',
  label,
  group,
  default: value,
  min: 1,
  max: 1000,
  step: 1,
});
const multInput = (value: number, group?: string): InputDef => ({
  id: 'mult',
  type: 'number',
  label: 'Multiplier',
  group,
  default: value,
  min: 0.1,
  max: 20,
  step: 0.1,
});
const levelInput = (id: 'upper' | 'lower', value: number): InputDef => ({
  id,
  type: 'number',
  label: id === 'upper' ? 'Upper' : 'Lower',
  group: 'Levels',
  default: value,
  min: 0,
  max: 100,
});

/** The input values of `atrIndicator`, by input id. */
export type AtrInputs = { length: number; color: string };

/** Average true range (Wilder's smoothing) in its own pane. */
export const atrIndicator: IndicatorDef<AtrInputs> = {
  id: 'atr',
  name: 'ATR',
  description: 'Average true range of the bars, a measure of how much price moves.',
  category: 'volatility',
  aliases: ['Average True Range'],
  placement: 'pane',
  inputs: [lengthInput(14), colorInput()],
  plots: [{ id: 'atr', type: 'line', colorInput: 'color' }],
  compute(src, { length }) {
    return { atr: atr(src.high, src.low, src.close, length) };
  },
  update(src, { length }, i, out) {
    atrAt(src.high, src.low, src.close, i, length, out.atr!);
  },
  lookback: ({ length }) => atrLookback(length),
};

/** The input values of `stochIndicator`, by input id. */
export type StochInputs = {
  kLength: number;
  kSmooth: number;
  dLength: number;
  upper: number;
  lower: number;
  color: string;
  signalColor: string;
};

/** Stochastic oscillator (%K and %D) in its own pane, with shaded upper and lower guides (80 and 20). */
export const stochIndicator: IndicatorDef<StochInputs> = {
  id: 'stoch',
  name: 'Stoch',
  description: 'Where the close sits in the recent high-low range, from 0 to 100, with a smoothed signal line.',
  category: 'momentum',
  aliases: ['Stochastic', 'Stochastic Oscillator'],
  title: ({ kLength, kSmooth, dLength }) => `Stoch ${kLength} ${kSmooth} ${dLength}`,
  placement: 'pane',
  fixedRange: { min: 0, max: 100 },
  precision: 2,
  inputs: [
    countInput('kLength', '%K length', 14, 'Calculation'),
    countInput('kSmooth', '%K smoothing', 3, 'Calculation'),
    countInput('dLength', '%D length', 3, 'Calculation'),
    levelInput('upper', 80),
    levelInput('lower', 20),
    inGroup('Lines', colorInput('color', '', '%K')),
    inGroup('Lines', colorInput('signalColor', SIGNAL, '%D')),
  ],
  plots: [
    { id: 'upper', type: 'line', title: 'Upper', color: GUIDE, lineWidth: 1, lastValueLabel: false },
    { id: 'lower', type: 'line', title: 'Lower', color: GUIDE, lineWidth: 1, lastValueLabel: false },
    { id: 'k', type: 'line', title: '%K', colorInput: 'color' },
    { id: 'd', type: 'line', title: '%D', colorInput: 'signalColor' },
  ],
  fills: [{ between: ['upper', 'lower'], color: GUIDE_FILL }],
  compute(src, { kLength, kSmooth, dLength, upper, lower }) {
    const n = src.length;
    return {
      ...stoch(src.high, src.low, src.close, kLength, kSmooth, dLength),
      upper: new Float64Array(n).fill(upper),
      lower: new Float64Array(n).fill(lower),
    };
  },
  update(src, { kLength, kSmooth, dLength, upper, lower }, i, out) {
    out.upper![i] = upper;
    out.lower![i] = lower;
    stochAt(src.high, src.low, src.close, i, kLength, kSmooth, dLength, { k: out.k!, d: out.d! });
  },
  lookback: ({ kLength, kSmooth, dLength }) => stochLookback(kLength, kSmooth, dLength),
};

/** The input values of `stochRsiIndicator`, by input id. */
export type StochRsiInputs = {
  rsiLength: number;
  stochLength: number;
  kSmooth: number;
  dLength: number;
  source: SourceKey;
  upper: number;
  lower: number;
  color: string;
  signalColor: string;
};

/** Stochastic RSI (%K and %D) in its own pane, with shaded upper and lower guides (80 and 20). */
export const stochRsiIndicator: IndicatorDef<StochRsiInputs> = {
  id: 'stoch-rsi',
  name: 'Stoch RSI',
  description: 'The stochastic formula applied to RSI instead of price, from 0 to 100.',
  category: 'momentum',
  aliases: ['Stochastic RSI', 'StochRSI'],
  title: ({ rsiLength, stochLength, kSmooth, dLength }) => `Stoch RSI ${rsiLength} ${stochLength} ${kSmooth} ${dLength}`,
  placement: 'pane',
  fixedRange: { min: 0, max: 100 },
  precision: 2,
  inputs: [
    countInput('rsiLength', 'RSI length', 14, 'Calculation'),
    countInput('stochLength', 'Stochastic length', 14, 'Calculation'),
    countInput('kSmooth', '%K smoothing', 3, 'Calculation'),
    countInput('dLength', '%D length', 3, 'Calculation'),
    inGroup('Calculation', sourceInput()),
    levelInput('upper', 80),
    levelInput('lower', 20),
    inGroup('Lines', colorInput('color', '', '%K')),
    inGroup('Lines', colorInput('signalColor', SIGNAL, '%D')),
  ],
  plots: [
    { id: 'upper', type: 'line', title: 'Upper', color: GUIDE, lineWidth: 1, lastValueLabel: false },
    { id: 'lower', type: 'line', title: 'Lower', color: GUIDE, lineWidth: 1, lastValueLabel: false },
    { id: 'k', type: 'line', title: '%K', colorInput: 'color' },
    { id: 'd', type: 'line', title: '%D', colorInput: 'signalColor' },
  ],
  fills: [{ between: ['upper', 'lower'], color: GUIDE_FILL }],
  compute(src, { rsiLength, stochLength, kSmooth, dLength, source, upper, lower }) {
    const n = src.length;
    const values = sourceOf(src, source);
    const state = { rsi: new Float64Array(n), avgGain: new Float64Array(n), avgLoss: new Float64Array(n) };
    return {
      ...stochRsi(values, rsiLength, stochLength, kSmooth, dLength, undefined, state),
      upper: new Float64Array(n).fill(upper),
      lower: new Float64Array(n).fill(lower),
      source: values,
      ...state,
    };
  },
  update(src, { rsiLength, stochLength, kSmooth, dLength, source, upper, lower }, i, out) {
    out.source![i] = sourceAt(src, source, i);
    out.upper![i] = upper;
    out.lower![i] = lower;
    stochRsiAt(
      out.source!,
      i,
      rsiLength,
      stochLength,
      kSmooth,
      dLength,
      { k: out.k!, d: out.d! },
      { rsi: out.rsi!, avgGain: out.avgGain!, avgLoss: out.avgLoss! },
    );
  },
  lookback: ({ rsiLength, stochLength, kSmooth, dLength }) => stochRsiLookback(rsiLength, stochLength, kSmooth, dLength),
};

/** The input values of `dmiIndicator`, by input id. */
export type DmiInputs = { length: number; adxLength: number; color: string; plusColor: string; minusColor: string };

/** Directional movement: +DI, -DI and their average (ADX) in their own pane. */
export const dmiIndicator: IndicatorDef<DmiInputs> = {
  id: 'dmi',
  name: 'DMI',
  description: 'Upward and downward directional movement with ADX, the strength of the trend.',
  category: 'trend',
  aliases: ['Directional Movement Index', 'ADX'],
  title: ({ length, adxLength }) => `DMI ${length} ${adxLength}`,
  placement: 'pane',
  precision: 2,
  inputs: [
    countInput('length', 'DI length', 14, 'Calculation'),
    countInput('adxLength', 'ADX smoothing', 14, 'Calculation'),
    inGroup('Lines', colorInput('color', '', 'ADX')),
    inGroup('Lines', colorInput('plusColor', UP, '+DI')),
    inGroup('Lines', colorInput('minusColor', DOWN, '-DI')),
  ],
  plots: [
    { id: 'plus', type: 'line', title: '+DI', colorInput: 'plusColor', lineWidth: 1 },
    { id: 'minus', type: 'line', title: '-DI', colorInput: 'minusColor', lineWidth: 1 },
    { id: 'adx', type: 'line', title: 'ADX', colorInput: 'color' },
  ],
  compute(src, { length, adxLength }) {
    const n = src.length;
    const state = { plusDm: new Float64Array(n), minusDm: new Float64Array(n), tr: new Float64Array(n) };
    return { ...dmi(src.high, src.low, src.close, length, adxLength, undefined, state), ...state };
  },
  update(src, { length, adxLength }, i, out) {
    dmiAt(
      src.high,
      src.low,
      src.close,
      i,
      length,
      adxLength,
      { plus: out.plus!, minus: out.minus!, adx: out.adx! },
      { plusDm: out.plusDm!, minusDm: out.minusDm!, tr: out.tr! },
    );
  },
  lookback: ({ length, adxLength }) => dmiLookback(length, adxLength),
};

/** The input values of `obvIndicator`, by input id. */
export type ObvInputs = { color: string };

/**
 * On-balance volume in its own pane: the running total adds a bar's volume
 * when the close rises and subtracts it when it falls. A bar without volume
 * leaves the total as it was.
 */
export const obvIndicator: IndicatorDef<ObvInputs> = {
  id: 'obv',
  name: 'OBV',
  description: 'Running total that adds volume on up bars and subtracts it on down bars.',
  category: 'volume',
  aliases: ['On Balance Volume'],
  placement: 'pane',
  inputs: [colorInput()],
  plots: [{ id: 'obv', type: 'line', colorInput: 'color' }],
  compute(src) {
    const weights = src.volume.map(weight);
    return { obv: obv(src.close, weights), weights };
  },
  update(src, _inputs, i, out) {
    out.weights![i] = weight(src.volume[i]!);
    obvAt(src.close, out.weights!, i, out.obv!);
  },
  lookback: () => obvLookback(),
};

/** The input values of `keltnerIndicator`, by input id. */
export type KeltnerInputs = { length: number; mult: number; atrLength: number; color: string };

/** Keltner channels: an EMA of the close with bands `mult` ATRs away, filled between. */
export const keltnerIndicator: IndicatorDef<KeltnerInputs> = {
  id: 'keltner',
  name: 'KC',
  description: 'Moving average with bands a multiple of ATR above and below it.',
  category: 'volatility',
  aliases: ['Keltner Channels', 'Keltner'],
  title: ({ length, mult, atrLength }) => `KC ${length} ${mult} ${atrLength}`,
  placement: 'overlay',
  inputs: [
    inGroup('Basis', lengthInput(20)),
    multInput(2, 'Bands'),
    countInput('atrLength', 'ATR length', 10, 'Bands'),
    inGroup('Style', colorInput()),
  ],
  plots: [
    { id: 'upper', type: 'line', title: 'Upper', colorInput: 'color', lineWidth: 1 },
    { id: 'middle', type: 'line', title: 'Basis', colorInput: 'color', lineWidth: 1 },
    { id: 'lower', type: 'line', title: 'Lower', colorInput: 'color', lineWidth: 1 },
  ],
  fills: [{ between: ['upper', 'lower'], color: BAND_FILL }],
  compute(src, { length, mult, atrLength }) {
    const state = { atr: new Float64Array(src.length) };
    return { ...keltner(src.high, src.low, src.close, length, mult, atrLength, undefined, state), ...state };
  },
  update(src, { length, mult, atrLength }, i, out) {
    keltnerAt(
      src.high,
      src.low,
      src.close,
      i,
      length,
      mult,
      atrLength,
      { middle: out.middle!, upper: out.upper!, lower: out.lower! },
      { atr: out.atr! },
    );
  },
  lookback: ({ length, atrLength }) => keltnerLookback(length, atrLength),
};

/** The input values of `donchianIndicator`, by input id. */
export type DonchianInputs = { length: number; color: string };

/** Donchian channels: the highest high and lowest low over `length` bars and their midpoint, filled between. */
export const donchianIndicator: IndicatorDef<DonchianInputs> = {
  id: 'donchian',
  name: 'DC',
  description: 'Highest high and lowest low of the last N bars, with their midline.',
  category: 'volatility',
  aliases: ['Donchian Channels', 'Donchian'],
  placement: 'overlay',
  inputs: [lengthInput(20), colorInput()],
  plots: [
    { id: 'upper', type: 'line', title: 'Upper', colorInput: 'color', lineWidth: 1 },
    { id: 'middle', type: 'line', title: 'Basis', colorInput: 'color', lineWidth: 1 },
    { id: 'lower', type: 'line', title: 'Lower', colorInput: 'color', lineWidth: 1 },
  ],
  fills: [{ between: ['upper', 'lower'], color: BAND_FILL }],
  compute(src, { length }) {
    return { ...donchian(src.high, src.low, length) };
  },
  update(src, { length }, i, out) {
    donchianAt(src.high, src.low, i, length, { upper: out.upper!, lower: out.lower!, middle: out.middle! });
  },
  lookback: ({ length }) => donchianLookback(length),
};

/** The input values of `supertrendIndicator`, by input id. */
export type SupertrendInputs = { length: number; mult: number; upColor: string; downColor: string };

/** The trailing line split by trend: `up` holds it in an uptrend, `down` in a downtrend, NaN otherwise. */
function splitTrend(line: number, direction: number): [up: number, down: number] {
  return [direction === 1 ? line : NaN, direction === -1 ? line : NaN];
}

/**
 * Supertrend on the price pane: a trailing line `mult` ATRs from the bar's
 * midpoint, drawn below price in the up colour during an uptrend and above it
 * in the down colour during a downtrend.
 */
export const supertrendIndicator: IndicatorDef<SupertrendInputs> = {
  id: 'supertrend',
  name: 'Supertrend',
  description: 'Trailing line set a multiple of ATR from price that flips side when the trend turns.',
  category: 'trend',
  aliases: ['ATR trailing stop'],
  title: ({ length, mult }) => `Supertrend ${length} ${mult}`,
  placement: 'overlay',
  inputs: [
    countInput('length', 'ATR length', 10),
    multInput(3),
    { id: 'upColor', type: 'color', label: 'Uptrend', group: 'Style', role: 'up', default: UP },
    { id: 'downColor', type: 'color', label: 'Downtrend', group: 'Style', role: 'down', default: DOWN },
  ],
  plots: [
    { id: 'up', type: 'line', title: 'Up', colorInput: 'upColor' },
    { id: 'down', type: 'line', title: 'Down', colorInput: 'downColor' },
  ],
  compute(src, { length, mult }) {
    const n = src.length;
    const state = { atr: new Float64Array(n), upper: new Float64Array(n), lower: new Float64Array(n) };
    const { line, direction } = supertrend(src.high, src.low, src.close, length, mult, undefined, state);
    const up = new Float64Array(n);
    const down = new Float64Array(n);
    for (let i = 0; i < n; i++) [up[i], down[i]] = splitTrend(line[i]!, direction[i]!);
    return { up, down, line, direction, ...state };
  },
  update(src, { length, mult }, i, out) {
    supertrendAt(
      src.high,
      src.low,
      src.close,
      i,
      length,
      mult,
      { line: out.line!, direction: out.direction! },
      { atr: out.atr!, upper: out.upper!, lower: out.lower! },
    );
    [out.up![i], out.down![i]] = splitTrend(out.line![i]!, out.direction![i]!);
  },
  lookback: ({ length }) => supertrendLookback(length),
};

/** The input values of `ichimokuIndicator`, by input id. */
export type IchimokuInputs = {
  conversionLength: number;
  baseLength: number;
  spanBLength: number;
  displacement: number;
  conversionColor: string;
  baseColor: string;
  spanAColor: string;
  spanBColor: string;
};

/**
 * Ichimoku on the price pane: conversion and base lines, and the two leading
 * spans drawn `displacement` bars later with the cloud filled between them.
 * The cloud stops at the last bar, and the lagging line is not drawn: plots
 * have no offset into the future or the past yet.
 */
export const ichimokuIndicator: IndicatorDef<IchimokuInputs> = {
  id: 'ichimoku',
  name: 'Ichimoku',
  description: 'Conversion and base lines, a shifted cloud and a lagging line showing trend, support and momentum.',
  category: 'trend',
  aliases: ['Ichimoku Cloud', 'Ichimoku Kinko Hyo'],
  placement: 'overlay',
  inputs: [
    countInput('conversionLength', 'Conversion line', 9, 'Calculation'),
    countInput('baseLength', 'Base line', 26, 'Calculation'),
    countInput('spanBLength', 'Leading span B', 52, 'Calculation'),
    countInput('displacement', 'Displacement', 26, 'Calculation'),
    inGroup('Style', colorInput('conversionColor', '#3884ff', 'Conversion')),
    inGroup('Style', colorInput('baseColor', SIGNAL, 'Base')),
    inGroup('Style', colorInput('spanAColor', UP, 'Span A')),
    inGroup('Style', colorInput('spanBColor', DOWN, 'Span B')),
  ],
  plots: [
    { id: 'conversion', type: 'line', title: 'Conversion', colorInput: 'conversionColor', lineWidth: 1 },
    { id: 'base', type: 'line', title: 'Base', colorInput: 'baseColor', lineWidth: 1 },
    { id: 'spanA', type: 'line', title: 'Span A', colorInput: 'spanAColor', lineWidth: 1 },
    { id: 'spanB', type: 'line', title: 'Span B', colorInput: 'spanBColor', lineWidth: 1 },
  ],
  fills: [{ between: ['spanA', 'spanB'], color: CLOUD_FILL }],
  compute(src, { conversionLength, baseLength, spanBLength, displacement }) {
    const n = src.length;
    const lines = ichimoku(src.high, src.low, conversionLength, baseLength, spanBLength);
    const spanA = new Float64Array(n).fill(NaN);
    const spanB = new Float64Array(n).fill(NaN);
    for (let i = displacement; i < n; i++) {
      spanA[i] = lines.spanA[i - displacement]!;
      spanB[i] = lines.spanB[i - displacement]!;
    }
    return { conversion: lines.conversion, base: lines.base, spanA, spanB, rawSpanA: lines.spanA, rawSpanB: lines.spanB };
  },
  update(src, { conversionLength, baseLength, spanBLength, displacement }, i, out) {
    ichimokuAt(src.high, src.low, i, conversionLength, baseLength, spanBLength, {
      conversion: out.conversion!,
      base: out.base!,
      spanA: out.rawSpanA!,
      spanB: out.rawSpanB!,
    });
    out.spanA![i] = i >= displacement ? out.rawSpanA![i - displacement]! : NaN;
    out.spanB![i] = i >= displacement ? out.rawSpanB![i - displacement]! : NaN;
  },
  lookback: ({ conversionLength, baseLength, spanBLength, displacement }) =>
    ichimokuLookback(conversionLength, baseLength, spanBLength) + displacement,
};

/** The input values of `moonPhaseIndicator`, by input id. */
export type MoonInputs = { showNew: boolean; showFull: boolean; newColor: string; fullColor: string };

/** A ring, so a new moon reads apart from a full moon's filled disc without colour. */
const RING = { svgPath: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM12 5a7 7 0 1 1 0 14a7 7 0 1 1 0-14z' };

/**
 * 1 when the moon reaches `phase` (days into its cycle) after bar `i - 1`
 * and at or before bar `i`, else NaN: the event marks the first bar at or
 * after it, so a gap in the bars keeps it.
 */
function reaches(time: Float64Array, i: number, phase: number): number {
  if (i < 1) return NaN;
  const before = moonPhase(time[i - 1]!).age - phase;
  const elapsed = (time[i]! - time[i - 1]!) / 86400;
  return Math.floor((before + elapsed) / SYNODIC_MONTH) > Math.floor(before / SYNODIC_MONTH) ? 1 : NaN;
}

function moonsAt(time: Float64Array, { showNew, showFull }: MoonInputs, i: number, out: IndicatorOutputs): void {
  out.newMoon![i] = showNew ? reaches(time, i, 0) : NaN;
  out.fullMoon![i] = showFull ? reaches(time, i, SYNODIC_MONTH / 2) : NaN;
}

/** Marks new and full moons on the price pane, from the bar times alone. */
export const moonPhaseIndicator: IndicatorDef<MoonInputs> = {
  id: 'moon-phase',
  name: 'Moon phases',
  description: 'Marks the first bar at or after each new moon and full moon, from the mean lunar cycle.',
  category: 'cycles',
  aliases: ['Lunar cycle', 'New moon', 'Full moon'],
  placement: 'overlay',
  inputs: [
    { id: 'showNew', type: 'boolean', label: 'New moons', default: true },
    { id: 'showFull', type: 'boolean', label: 'Full moons', default: true },
    inGroup('Style', colorInput('newColor', '#8b8b99', 'New moon')),
    inGroup('Style', colorInput('fullColor', SIGNAL, 'Full moon')),
  ],
  plots: [
    { id: 'newMoon', type: 'shape', title: 'New moon', shape: 'circle', icon: RING, position: 'above', colorInput: 'newColor', kind: 'moon' },
    { id: 'fullMoon', type: 'shape', title: 'Full moon', shape: 'circle', position: 'above', colorInput: 'fullColor', kind: 'moon' },
  ],
  compute(src, inputs) {
    const out = { newMoon: new Float64Array(src.length), fullMoon: new Float64Array(src.length) };
    for (let i = 0; i < src.length; i++) moonsAt(src.time, inputs, i, out);
    return out;
  },
  update: (src, inputs, i, out) => moonsAt(src.time, inputs, i, out),
  lookback: () => 1,
};

/** Every built-in indicator, e.g. for a picker. */
export const builtinIndicators: readonly IndicatorDef[] = [
  smaIndicator,
  emaIndicator,
  bollingerIndicator,
  vwapIndicator,
  rsiIndicator,
  macdIndicator,
  volumeMaIndicator,
  cumulativeVolumeIndicator,
  keltnerIndicator,
  donchianIndicator,
  supertrendIndicator,
  ichimokuIndicator,
  atrIndicator,
  stochIndicator,
  stochRsiIndicator,
  dmiIndicator,
  obvIndicator,
  moonPhaseIndicator,
];
