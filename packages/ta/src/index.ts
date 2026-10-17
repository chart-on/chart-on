/**
 * Technical-analysis helpers for indicator authors.
 *
 * Conventions shared by every function:
 * - Inputs and outputs are columns of the same length, one value per bar.
 * - Bars before the first value (the warmup) are NaN. `<name>Lookback(...)`
 *   returns how many bars that is on input without gaps.
 * - A NaN input breaks the series: window functions read NaN while it is in
 *   their window, and recursive ones (averages, running totals) restart after it.
 * - Inputs are never mutated. An optional `out` array is filled and returned
 *   instead of allocating; it must not be one of the inputs.
 * - `<name>At(...)` computes one bar from earlier bars, for an indicator's live
 *   `update`. It gives the same values as the array form, up to floating-point
 *   rounding (rolling sums are rebuilt every `length` bars to keep it small).
 */
export type { Series } from './internal';
export * from './average';
export * from './volatility';
export * from './momentum';
export * from './trend';
export * from './volume';
export * from './helpers';
export * from './lunar';
