import { intervalRangeOf } from '../data/interval';
import { parsePlotStyles } from './plot-style';
import { isRecord, isText } from '../util/records';
import type { IndicatorState, InputValue, IntervalRange } from './types';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Validate untrusted saved indicator states; throws on a malformed payload. */
export function parseIndicatorStates(data: unknown): IndicatorState[] {
  if (!Array.isArray(data)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Invalid indicators payload: expected an array of indicator states' : '');
  return data.map((raw: unknown, i): IndicatorState => {
    const version = isRecord(raw) ? raw.version : undefined;
    if (
      !isRecord(raw) ||
      typeof raw.type !== 'string' ||
      raw.type === '' ||
      (raw.inputs !== undefined && !isRecord(raw.inputs)) ||
      (version !== undefined && !(Number.isInteger(version) && (version as number) >= 1))
    ) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid indicator state at index ${i}` : '');
    }
    const pane = raw.pane;
    const visibleOn = parseRanges(raw.visibleOn);
    const plotStyles = parsePlotStyles(raw.plotStyles);
    return {
      // A malformed id is dropped: the indicator gets a new one.
      ...(isText(raw.id) ? { id: raw.id } : {}),
      type: raw.type,
      ...(version !== undefined ? { version: version as number } : {}),
      // Checked against the definition once it is registered.
      inputs: { ...(raw.inputs as Record<string, InputValue> | undefined) },
      pane: typeof pane === 'number' && Number.isInteger(pane) && pane >= 0 ? pane : 0,
      visible: raw.visible !== false,
      ...(visibleOn ? { visibleOn } : {}),
      // Checked against the plots once the definition is registered.
      ...(plotStyles ? { plotStyles } : {}),
      // A malformed scale id is dropped: the definition's scale applies.
      ...(isScaleId(raw.priceScale) ? { priceScale: raw.priceScale } : {}),
      ...(raw.folded === true ? { folded: true } : {}),
    };
  });
}

/** Saved interval ranges, invalid ones dropped; null when none are left (every interval). */
export function parseRanges(value: unknown): IntervalRange[] | null {
  if (!Array.isArray(value)) return null;
  const ranges = value.map(intervalRangeOf).filter((r): r is IntervalRange => r !== null);
  return ranges.length > 0 ? ranges : null;
}

/** A usable price scale id: a non-empty string. */
export function isScaleId(value: unknown): value is string {
  return isText(value);
}

export { isRecord };
