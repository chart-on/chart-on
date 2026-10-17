/** A numeric column, one value per bar. `Float64Array` is the fast path. */
export type Series = ArrayLike<number>;

/** Throws unless `value` is an integer of at least 1. */
export function checkLength(value: number, name = 'length'): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be an integer of at least 1, got ${value}`);
  }
}

/** The shared length of `inputs`; throws when they differ. */
export function commonLength(...inputs: Series[]): number {
  const n = inputs[0]!.length;
  for (const input of inputs) {
    if (input.length !== n) throw new RangeError(`inputs differ in length: ${n} and ${input.length}`);
  }
  return n;
}

/** `out` checked for length and aliasing, or a new array of `n`. */
export function output(n: number, out: Float64Array | undefined, ...inputs: Series[]): Float64Array {
  if (!out) return new Float64Array(n);
  if (out.length !== n) throw new RangeError(`out has length ${out.length}, expected ${n}`);
  if (inputs.includes(out)) throw new Error('out must not be one of the inputs');
  return out;
}

/**
 * True on bars where a rolling window sum is rebuilt from scratch: when a run
 * of `run` NaN-free bars first fills the window, then every `length` bars.
 * Rebuilding keeps the rounding drift of add-and-subtract updates bounded.
 */
export function reanchor(run: number, length: number): boolean {
  return run >= length && (run - length) % length === 0;
}

/** True when `values[from..to]` (inclusive) exist and none is NaN. */
export function windowValid(values: Series, from: number, to: number): boolean {
  if (from < 0) return false;
  for (let j = from; j <= to; j++) if (Number.isNaN(values[j]!)) return false;
  return true;
}

/** Previous value of a recursive output, or NaN on the first bar. */
export function previous(out: Float64Array, i: number): number {
  return i > 0 ? out[i - 1]! : NaN;
}

/**
 * Exponential average with smoothing `alpha`, seeded by the simple average of
 * the first `length` values. A NaN input breaks the run: the output is NaN
 * there and the average warms up again from the next value.
 */
export function expAverage(values: Series, length: number, alpha: number, res: Float64Array): Float64Array {
  let avg = NaN;
  let run = 0;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isNaN(v)) {
      avg = NaN;
      run = 0;
      seed = 0;
    } else if (!Number.isNaN(avg)) {
      avg += alpha * (v - avg);
    } else if (++run === length) {
      avg = (seed + v) / length;
    } else {
      seed += v;
    }
    res[i] = avg;
  }
  return res;
}

/** Single-bar form of {@link expAverage}; `value(j)` reads input bar `j`. */
export function expAverageAt(
  value: (j: number) => number,
  i: number,
  length: number,
  alpha: number,
  out: Float64Array,
): number {
  const v = value(i);
  const prev = previous(out, i);
  let avg = NaN;
  if (Number.isNaN(v)) avg = NaN;
  else if (!Number.isNaN(prev)) avg = prev + alpha * (v - prev);
  else if (i >= length - 1) {
    let sum = 0;
    for (let j = i - length + 1; j <= i; j++) sum += value(j);
    avg = sum / length;
  }
  out[i] = avg;
  return avg;
}
