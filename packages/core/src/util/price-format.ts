import { decimalsForStep, formatCompact } from './format';
import { isDev } from './dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Tick size for prices whose absolute value is at least `from`; the first band also covers prices below it. */
export interface TickBand {
  from: number;
  tickSize: number;
}

/**
 * Folding the leading zeros of very small prices into a count: with at least
 * `minZeros` zeros after the decimal point (default 4), 0.00000412 shows as
 * `0.0₅412` (`style: 'subscript'`, the default) or `0.0{5}412` (`'brace'`, for
 * fonts without subscript digits). The count includes the zero shown.
 */
export interface ZeroFold {
  minZeros?: number;
  style?: 'subscript' | 'brace';
}

/**
 * How a series' prices are shown and parsed, and the tick size they snap to.
 *
 * - `decimal`: fixed decimals. `tickSize` rounds prices to the tick and sets the
 *   decimals; a list of bands gives tick sizes that change with the price.
 *   `precision` overrides the decimals. `zeroFold` shortens the zeros of very
 *   small prices: 0.00000412 shows as `0.0₅412`.
 * - `fraction`: whole units plus a fraction, e.g. `101'16` for 101 16/32
 *   (`denominator: 32`). `subDenominator` splits each fraction further and adds
 *   one digit: with 4, `101'162` is 101 16.25/32 (digits 0, 2, 5, 7).
 * - `volume`: compact amounts (`1.25M`).
 * - `percent`: the value followed by `%`.
 * - `custom`: your own formatter, with an optional parser and tick size.
 *
 * `unit` (e.g. a currency) is shown on the price axis.
 */
export type PriceFormat =
  | { type: 'decimal'; tickSize?: number | TickBand[]; precision?: number; zeroFold?: ZeroFold; unit?: string }
  | { type: 'fraction'; denominator: number; subDenominator?: number; separator?: string; unit?: string }
  | { type: 'volume'; unit?: string }
  | { type: 'percent'; precision?: number; unit?: string }
  | {
      type: 'custom';
      format: (price: number) => string;
      parse?: (text: string) => number;
      tickSize?: number;
      unit?: string;
    };

/** A resolved {@link PriceFormat}: every price label in the chart goes through one of these. */
export interface PriceFormatModel {
  format(price: number): string;
  /** Inverse of `format`; NaN when the text is not a price in this format. */
  parse(text: string): number;
  /** Price increment at `price`; 0 when prices are not snapped. */
  tickSize(price: number): number;
  /** `price` rounded to the nearest tick (unchanged without a tick size). */
  round(price: number): number;
  /** A price-axis label step at least `step` that lands on ticks. */
  axisStep(step: number, price: number): number;
  unit?: string;
}

/** Build the formatter for `format`. Throws on an invalid tick size, precision or denominator. */
export function createPriceFormat(format: PriceFormat): PriceFormatModel {
  switch (format.type) {
    case 'decimal':
      return decimalFormatter(format.tickSize, format.precision, format.unit, format.zeroFold);
    case 'fraction':
      return fractionFormatter(format.denominator, format.subDenominator ?? 1, format.separator ?? "'", format.unit);
    case 'volume':
      return withTicks(formatCompact, parseCompact, () => 0, format.unit);
    case 'percent': {
      const digits = checkPrecision(format.precision ?? 2);
      return withTicks((v) => `${fixed(v, digits)}%`, (t) => parseNumber(t.replace(/%\s*$/, '')), () => 0, format.unit);
    }
    case 'custom': {
      const tick = format.tickSize ?? 0;
      if (tick !== 0) checkTick(tick);
      return withTicks(format.format, format.parse ?? parseNumber, () => tick, format.unit);
    }
  }
}

const decimalCache = new Map<number, PriceFormatModel>();

/** Shared formatter for plain `digits`-decimal prices. */
export function decimalPriceFormat(digits: number): PriceFormatModel {
  let f = decimalCache.get(digits);
  if (!f) decimalCache.set(digits, (f = decimalFormatter(undefined, digits)));
  return f;
}

/**
 * The format a data source's symbol info asks for: `priceFormat`, else a
 * decimal format from `tickSize` and `precision`, else undefined (auto).
 */
export function symbolPriceFormat(info: {
  priceFormat?: PriceFormat;
  precision?: number;
  tickSize?: number;
}): PriceFormat | undefined {
  if (info.priceFormat) return info.priceFormat;
  if (info.tickSize === undefined && info.precision === undefined) return undefined;
  const format: PriceFormat = { type: 'decimal' };
  if (info.tickSize !== undefined) format.tickSize = info.tickSize;
  if (info.precision !== undefined) format.precision = info.precision;
  return format;
}

function decimalFormatter(
  tickSize: number | TickBand[] | undefined,
  precision: number | undefined,
  unit?: string,
  zeroFold?: ZeroFold,
): PriceFormatModel {
  if (precision !== undefined) checkPrecision(precision);
  const fold = zeroFold ? zeroFolder(zeroFold) : (text: string) => text;
  const bands = typeof tickSize === 'number' ? [{ from: 0, tickSize }] : (tickSize ?? []);
  bands.forEach((b, i) => {
    checkTick(b.tickSize);
    if (!(b.from >= 0) || (i > 0 && !(b.from > bands[i - 1]!.from))) {
      throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'tick bands need ascending, non-negative `from` prices' : '');
    }
  });
  // The first band also covers prices below its `from`.
  const tickAt = (price: number) => {
    let tick = bands[0]?.tickSize ?? 0;
    for (const b of bands) if (Math.abs(price) >= b.from) tick = b.tickSize;
    return tick;
  };
  const digitsAt = (price: number) => precision ?? (bands.length > 0 ? decimalsForStep(tickAt(price)) : 2);
  return {
    format: (price) => {
      const tick = tickAt(price);
      return fold(fixed(tick > 0 ? roundTo(price, tick) : price, digitsAt(price)));
    },
    parse: parseNumber,
    tickSize: tickAt,
    round: (price) => roundTo(price, tickAt(price)),
    axisStep: (step, price) => alignStep(step, tickAt(price), [1, 2, 5]),
    unit,
  };
}

function fractionFormatter(denominator: number, sub: number, separator: string, unit?: string): PriceFormatModel {
  if (!Number.isInteger(denominator) || denominator < 2) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'denominator must be an integer of at least 2' : '');
  if (!Number.isInteger(sub) || sub < 1 || sub > 9) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'subDenominator must be an integer from 1 to 9' : '');
  const parts = denominator * sub;
  const width = String(denominator - 1).length;
  // One digit per sub-fraction: tenths of a fraction step, rounded down (quarters read 0, 2, 5, 7).
  const subDigits = Array.from({ length: sub }, (_, k) => String(Math.floor((k * 10) / sub)));
  const pattern = new RegExp(`^\\s*(-)?(\\d+)${escapeRegExp(separator)}(\\d{${width}})(\\d)${sub > 1 ? '' : '?'}\\s*$`);
  const tick = 1 / parts;
  return {
    format(price) {
      if (!Number.isFinite(price)) return String(price);
      const units = Math.round(Math.abs(price) * parts);
      const whole = Math.floor(units / parts);
      const rest = units - whole * parts;
      const numerator = String(Math.floor(rest / sub)).padStart(width, '0');
      const sign = units > 0 && price < 0 ? '-' : '';
      return `${sign}${whole}${separator}${numerator}${sub > 1 ? subDigits[rest % sub] : ''}`;
    },
    parse(text) {
      const m = pattern.exec(text);
      if (!m) return /^\s*-?\d+\s*$/.test(text) ? Number(text) : NaN;
      const numerator = Number(m[3]);
      const k = sub > 1 ? subDigits.indexOf(m[4]!) : 0;
      if (numerator >= denominator || k < 0 || (sub === 1 && m[4] !== undefined)) return NaN;
      const value = Number(m[2]) + (numerator * sub + k) / parts;
      return m[1] ? -value : value;
    },
    tickSize: () => tick,
    round: (price) => roundTo(price, tick),
    axisStep: (step) => alignStep(step, tick, [1, 2, 4, 8]),
    unit,
  };
}

function withTicks(
  format: (price: number) => string,
  parse: (text: string) => number,
  tickAt: (price: number) => number,
  unit: string | undefined,
): PriceFormatModel {
  return {
    format,
    parse,
    tickSize: tickAt,
    round: (price) => roundTo(price, tickAt(price)),
    axisStep: (step, price) => alignStep(step, tickAt(price), [1, 2, 5]),
    unit,
  };
}

/**
 * Nearest multiple of `tick`, without float noise such as 0.30000000000000004.
 * Ties round away from zero on both sides, so -0.25 and 0.25 mirror each other.
 */
function roundTo(price: number, tick: number): number {
  if (!(tick > 0) || !Number.isFinite(price)) return price;
  const abs = Number((Math.round(Math.abs(price) / tick) * tick).toFixed(Math.min(15, decimalsForStep(tick) + 2)));
  return price < 0 && abs !== 0 ? -abs : abs;
}

/** `value.toFixed(digits)` without a negative zero such as "-0.00". */
function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
}

/**
 * Keep `step` if it is a whole number of ticks; otherwise the next multiple
 * `m × 10^n` ticks from `mantissas` (decimal) or the next power of two
 * (fractions), so labels land on prices the format can show exactly.
 */
function alignStep(step: number, tick: number, mantissas: number[]): number {
  if (!(tick > 0)) return step;
  const ticks = step / tick;
  if (ticks <= 1) return tick;
  if (Math.abs(ticks - Math.round(ticks)) < 1e-9) return step;
  if (mantissas.includes(4)) return tick * 2 ** Math.ceil(Math.log2(ticks));
  const exp = 10 ** Math.floor(Math.log10(ticks));
  const m = mantissas.find((x) => x * exp >= ticks) ?? 10;
  return tick * m * exp;
}

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';

/** Fold the zeros after the decimal point of fixed-point `text` (see {@link ZeroFold}). */
function zeroFolder({ minZeros = 4, style = 'subscript' }: ZeroFold): (text: string) => string {
  if (!Number.isInteger(minZeros) || minZeros < 1) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `zeroFold.minZeros must be a whole number of at least 1, got ${minZeros}` : '');
  if (style !== 'subscript' && style !== 'brace') throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `zeroFold.style must be 'subscript' or 'brace', got ${String(style)}` : '');
  const count =
    style === 'brace' ? (n: number) => `{${n}}` : (n: number) => [...String(n)].map((d) => SUBSCRIPT_DIGITS[Number(d)]).join('');
  return (text) => {
    // A zero price stays as it is: there are no significant digits to keep.
    const m = /^(-?)0\.(0+)([1-9]\d*)$/.exec(text);
    if (!m || m[2]!.length < minZeros) return text;
    return `${m[1]}0.0${count(m[2]!.length)}${m[3]}`;
  };
}

/** Undo {@link zeroFolder}: `0.0₅412` and `0.0{5}412` back to `0.00000412`. */
function unfoldZeros(text: string): string {
  const m = /^([-+]?)0\.0(?:([₀-₉]+)|\{(\d+)\})(\d+)$/.exec(text);
  if (!m) return text;
  const zeros = m[2] !== undefined ? Number([...m[2]].map((d) => SUBSCRIPT_DIGITS.indexOf(d)).join('')) : Number(m[3]);
  // At least the zero shown; a silly count must not build a huge string.
  return zeros >= 1 && zeros <= 400 ? `${m[1]}0.${'0'.repeat(zeros)}${m[4]}` : text;
}

function parseNumber(text: string): number {
  const t = unfoldZeros(text.trim().replace(/,/g, ''));
  return t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? NaN : Number(t);
}

const SUFFIX: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/** A number with an optional K, M, B or T suffix, as `formatCompact` writes it; NaN when it is not one. */
export function parseCompact(text: string): number {
  const m = /^\s*(.*?)([KMBT])?\s*$/i.exec(text);
  const base = parseNumber(m?.[1] ?? '');
  const scale = m?.[2] ? SUFFIX[m[2].toUpperCase()]! : 1;
  return base * scale;
}

function checkTick(tick: number): void {
  if (!(tick > 0) || !Number.isFinite(tick)) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `tick size must be a positive number, got ${tick}` : '');
}

function checkPrecision(digits: number): number {
  if (!Number.isInteger(digits) || digits < 0 || digits > 100) {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `precision must be an integer from 0 to 100, got ${digits}` : '');
  }
  return digits;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
