import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };
/**
 * Access rules: which drawing tools and indicators users may add, and how
 * many indicators a chart holds, e.g. to gate paid features.
 *
 * Requirement (#860): the app decides per item. So the rule is one predicate
 * the app writes, not lists the chart interprets; an allow list, a deny list,
 * a plan check or a feature flag are all a line of code in it. Limits are
 * counts the chart enforces, since only the chart knows what it holds.
 */

/** One drawing tool or indicator the access rule is asked about, by its id. */
export interface AccessItem {
  kind: 'drawing' | 'indicator';
  id: string;
}

/** Whether users may add `item`. One shape for the chart option and both managers. */
export type AccessRule = (item: AccessItem) => boolean;

/** Most items of a kind the chart holds; a kind left out has no cap. */
export interface AccessLimits {
  /** Most indicators the chart holds, pending ones included. A non-negative integer. */
  indicators?: number;
}

/**
 * Which drawing tools and indicators users may add. Set it with `createChart`
 * or `applyOptions({ access })`; fields left out keep their current value.
 * Rules hold functions, so they are never saved with a layout.
 */
export interface AccessOptions {
  /**
   * Whether users may add `item`; `null` allows everything. Asked when the
   * rail, the picker or a menu lists an item and when `drawings.setTool()`
   * or `indicators.add()` runs. Drawings added with `drawings.add()`,
   * indicators added with `restricted: false`, and anything loaded from a
   * layout are not asked about.
   * Default `null`.
   */
  allow: AccessRule | null;
  /** Caps per kind. A patch replaces the whole object, so `{}` lifts every cap. Default `{}`. */
  limits: AccessLimits;
  /**
   * How built-in UI shows what the rules refuse: left out (`'hide'`), or
   * shown disabled (`'disable'`), where a press fires `tool:refuse` or
   * `indicator:refuse` for the app to handle. Default `'hide'`: an item the
   * user cannot use takes no room unless the app wants to advertise it.
   */
  refused: 'hide' | 'disable';
}

/** Default values for `AccessOptions`: everything allowed, no caps, refused items hidden. */
export const defaultAccessOptions: Readonly<AccessOptions> = {
  allow: null,
  limits: {},
  refused: 'hide',
};

/**
 * Throw on an invalid `access` patch, so `applyOptions` changes nothing when
 * one field is wrong. Undefined fields are left unchanged and pass.
 */
export function checkAccess(patch: Partial<AccessOptions>): void {
  const { allow, limits, refused } = patch;
  if (refused !== undefined && refused !== 'hide' && refused !== 'disable') {
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `access.refused must be 'hide' or 'disable', got ${JSON.stringify(refused)}` : '');
  }
  if (allow !== undefined && allow !== null && typeof allow !== 'function') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'access.allow must be a function or null' : '');
  if (limits !== undefined) {
    const max = limits?.indicators;
    if (typeof limits !== 'object' || limits === null || (max !== undefined && !(Number.isInteger(max) && max >= 0))) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `access.limits.indicators must be a non-negative integer, got ${String(max)}` : '');
    }
  }
}
