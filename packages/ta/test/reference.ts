// Slow, direct implementations of each formula, used as test references.
// They restart at NaN gaps the same way the library documents.

export interface Bars {
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
}

/** Deterministic random bars; `gaps` are bar indices set to NaN in every column. */
export function makeBars(n: number, gaps: number[] = [], seed = 7): Bars {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const bars: Bars = {
    high: new Float64Array(n),
    low: new Float64Array(n),
    close: new Float64Array(n),
    volume: new Float64Array(n),
  };
  let price = 100;
  for (let i = 0; i < n; i++) {
    const open = price;
    price = Math.max(1, price + (rand() - 0.5) * 4);
    bars.close[i] = price;
    bars.high[i] = Math.max(open, price) + rand() * 2;
    bars.low[i] = Math.min(open, price) - rand() * 2;
    bars.volume[i] = 1 + Math.floor(rand() * 1000);
  }
  for (const g of gaps) for (const col of Object.values(bars)) col[g] = NaN;
  return bars;
}

const nan = (n: number) => new Float64Array(n).fill(NaN);
const valid = (cols: ArrayLike<number>[], i: number) => cols.every((c) => !Number.isNaN(c[i]!));

/** First bar of the NaN-free run that ends at `i`. */
function runStart(cols: ArrayLike<number>[], i: number): number {
  let s = i;
  while (s > 0 && valid(cols, s - 1)) s--;
  return s;
}

/** `f(from, to)` over each full NaN-free window of `length`, else NaN. */
export function refWindow(cols: ArrayLike<number>[], length: number, f: (from: number, to: number) => number) {
  const n = cols[0]!.length;
  const out = nan(n);
  for (let i = 0; i < n; i++) {
    if (valid(cols, i) && i - length + 1 >= runStart(cols, i)) out[i] = f(i - length + 1, i);
  }
  return out;
}

export function refSma(v: ArrayLike<number>, length: number) {
  return refWindow([v], length, (a, b) => {
    let s = 0;
    for (let j = a; j <= b; j++) s += v[j]!;
    return s / length;
  });
}

export function refStdev(v: ArrayLike<number>, length: number) {
  return refWindow([v], length, (a, b) => {
    let mean = 0;
    for (let j = a; j <= b; j++) mean += v[j]! / length;
    let s = 0;
    for (let j = a; j <= b; j++) s += (v[j]! - mean) ** 2;
    return Math.sqrt(s / length);
  });
}

/** Exponential average seeded by the mean of the first `length` values of each run. */
export function refExp(v: ArrayLike<number>, length: number, alpha: number) {
  const out = nan(v.length);
  for (let i = 0; i < v.length; i++) {
    if (Number.isNaN(v[i]!)) continue;
    const s = runStart([v], i);
    if (i - s + 1 < length) continue;
    let avg = 0;
    for (let j = s; j < s + length; j++) avg += v[j]! / length;
    for (let j = s + length; j <= i; j++) avg += alpha * (v[j]! - avg);
    out[i] = avg;
  }
  return out;
}

export function refTr(b: Bars) {
  return Float64Array.from(b.close, (_, i) => {
    const range = b.high[i]! - b.low[i]!;
    if (i === 0) return range;
    const c = b.close[i - 1]!;
    return Math.max(range, Math.abs(b.high[i]! - c), Math.abs(b.low[i]! - c));
  });
}

export function refRsi(v: ArrayLike<number>, length: number) {
  const d = Float64Array.from(v, (x, i) => (i > 0 ? x - v[i - 1]! : NaN));
  const gain = refExp(d.map((x) => Math.max(x, 0)), length, 1 / length);
  const loss = refExp(d.map((x) => Math.max(-x, 0)), length, 1 / length);
  return gain.map((g, i) => {
    const l = loss[i]!;
    if (Number.isNaN(g)) return NaN;
    if (l === 0) return g === 0 ? 50 : 100;
    return 100 - 100 / (1 + g / l);
  });
}

/** Running fold from the start of each NaN-free run of `cols`. */
export function refRunning(cols: ArrayLike<number>[], f: (from: number, to: number) => number) {
  const n = cols[0]!.length;
  const out = nan(n);
  for (let i = 0; i < n; i++) if (valid(cols, i)) out[i] = f(runStart(cols, i), i);
  return out;
}
