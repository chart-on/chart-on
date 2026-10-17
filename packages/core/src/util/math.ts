/** `value` limited to [min, max]; `max` when `min` is above it. */
export function clampNum(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `value` limited to [min, max]; `min` when `max` is below it. */
export function clampLow(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** The middle of the device pixel nearest `v` (one css px per device px), where a 1 px line draws sharp. */
export function sharp(v: number): number {
  return Math.round(v) + 0.5;
}
