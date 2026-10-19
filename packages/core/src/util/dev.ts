// Bundlers replace `process.env.NODE_ENV` in production builds. Declared here,
// module-local, so it never clashes with Node's own typings.
declare const process: { env: { NODE_ENV?: string } };

/**
 * True outside production builds. Code loaded without a bundler has no `process` and stays quiet.
 *
 * Callers of `devWarn` guard the call with
 * `/* @__PURE__ *\/ isDev() && process.env.NODE_ENV !== 'production'`, so a
 * production bundle drops the message strings too, whichever bundler folds it:
 * the replaced test is false, and the pure `isDev()` call before it goes with it.
 * `isDev()` comes first so the raw `process` read never runs without a bundler.
 */
export function isDev(): boolean {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

/** Every warning code development builds log; each has an entry on the errors and warnings docs page. */
export const DEV_WARNING_CODES = [
  'option-unknown',
  'option-type',
  'option-range',
  'option-color',
  'time-milliseconds',
  'time-fraction',
  'search-route-failed',
  'marker-icon',
  'annotations-missing',
  'stats-overlay-missing',
  'source-markers-missing',
  'adjustments-missing',
  'watermark-missing',
  'data-source-missing',
  'reference-lines-missing',
  'price-styles-missing',
  'grouping-missing',
  'pulse-missing',
  'countdown-missing',
  'market-status-missing',
  'localization-missing',
  'lanes-missing',
  'shared-context-missing',
] as const;

/** Code of a warning development builds log; see `DEV_WARNING_CODES`. */
export type DevWarningCode = (typeof DEV_WARNING_CODES)[number];

/** Where each deprecated API has an entry with its replacement. */
export const UPGRADING_DOCS_URL = 'https://github.com/chart-on/chart-on/blob/main/docs/upgrading/index.md';

/**
 * Say once per page load, in development builds only, that a deprecated API
 * is in use; `id` is the anchor of its entry on the upgrading page. Callers
 * guard the call like `devWarn`'s, so production bundles drop it.
 */
export function devDeprecated(message: string, id: string): void {
  try {
    if (process.env.NODE_ENV !== 'production' && !reported.has(`deprecated:${id}`)) {
      reported.add(`deprecated:${id}`);
      console.warn(`charton [deprecated]: ${message} (${UPGRADING_DOCS_URL}#${id})`);
    }
  } catch {
    // No `process` (loaded without a bundler): stay quiet, like `isDev`.
  }
}

/** Where each warning and error code is explained. */
export const ERRORS_DOCS_URL = 'https://github.com/chart-on/chart-on/blob/main/docs/guide/errors.md';

/** Warning codes already reported in this page load. */
const reported = new Set<string>();

/**
 * `console.warn` in development builds only, with the code and a link to its
 * explanation. The check is written inline, not through `isDev`, so
 * production bundles drop the body.
 */
export function devWarn(message: string, code: DevWarningCode): void {
  try {
    if (process.env.NODE_ENV !== 'production') console.warn(`charton [${code}]: ${message} (${ERRORS_DOCS_URL}#${code})`);
  } catch {
    // No `process` (loaded without a bundler): stay quiet, like `isDev`.
  }
}

/** `devWarn`, once per page load for each code. Production bundles drop it. */
export function devWarnOnce(message: string, code: DevWarningCode): void {
  try {
    if (process.env.NODE_ENV !== 'production' && !reported.has(code)) {
      reported.add(code);
      devWarn(message, code);
    }
  } catch {
    // No `process` (loaded without a bundler): stay quiet, like `isDev`.
  }
}

/**
 * Development warnings for the common mistakes in data times that still
 * produce a chart: millisecond timestamps and fractional seconds. `what`
 * names the data. Checked on full data only; production bundles drop it.
 */
export function warnTimes(times: ArrayLike<number>, what: string): void {
  try {
    if (process.env.NODE_ENV !== 'production' && times.length > 0) {
      const last = times[times.length - 1]!;
      if (last > 1e11) devWarn(`${what} times look like milliseconds (${last}); times are unix seconds`, 'time-milliseconds');
      for (let i = 0; i < times.length; i++) {
        if (!Number.isInteger(times[i])) {
          devWarn(`${what} time at index ${i} is not a whole second (${times[i]}); intervals are expected in whole seconds`, 'time-fraction');
          break;
        }
      }
    }
  } catch {
    // No `process` (loaded without a bundler): stay quiet, like `isDev`.
  }
}
