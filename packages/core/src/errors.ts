import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Every `ChartErrorCode`, for code that needs the list at runtime. */
export const CHART_ERROR_CODES = [
  /** The browser or device has no WebGL2. */
  'webgl2-unavailable',
  /** A shader failed to compile or link, e.g. a driver bug. */
  'webgl-shader',
  /** The GPU context came back after a loss but could not be set up again. */
  'webgl-restore-failed',
  /**
   * The data source's `symbol` threw, for any reason: a symbol it does
   * not know, but also a network or server failure. `cause` tells them apart.
   */
  'unknown-symbol',
  /** The data source failed to load a symbol's first bars. */
  'load-failed',
  /** The data source failed to load a page of older bars. */
  'history-failed',
  /** The data source failed to reload bars after it reported a reset (`onReset`) or after `chart.reload()`. */
  'reset-failed',
  /** The data source's `adjustments` failed: the bars load unadjusted, reported as `data:warning`. */
  'adjustments-failed',
  /** The data source's `markers` failed, reported as `sourcemarkers:error`. */
  'markers-failed',
  /** An interval string the chart cannot parse, such as `'1x'`. */
  'invalid-interval',
  /** A saved drawings payload that is not `{ version, drawings: [] }`. */
  'invalid-drawings',
  /** A saved layout that is not an object with a version, or has a version nothing can upgrade. */
  'invalid-layout',
  /** An event listener threw; the error it threw is the `cause`. */
  'listener-failed',
  /** A primitive's member threw; the error it threw is the `cause`, `context.member` names the member. */
  'primitive-failed',
  /** The chart was destroyed: `setSymbol` and `compare` cannot load data any more. */
  'destroyed',
  /** A plugin's `requires` range does not include this core version, or cannot be read. */
  'plugin-incompatible',
  /**
   * An opt-in feature the chart was not given: `addHeatmap` on a chart
   * without the `heatmap()` plugin, or a drawing tool type it does not have.
   */
  'not-registered',
] as const;

/** What went wrong, as a stable code apps can branch on; the docs list each one with its cause and fix. */
export type ChartErrorCode = (typeof CHART_ERROR_CODES)[number];

/**
 * An error with a stable `code` for apps to branch on. When the error came
 * from somewhere else (a data source, an event listener), that original
 * error is `cause`; `context` holds the details, such as the symbol.
 * Production builds leave out the English message: the message is then the code.
 */
export class ChartError extends Error {
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    readonly code: ChartErrorCode,
    message: string,
    options: { cause?: unknown; context?: Record<string, unknown> } = {},
  ) {
    super(message || code, 'cause' in options ? { cause: options.cause } : undefined);
    this.name = 'ChartError';
    this.context = options.context ?? {};
  }
}

/** `error` itself when it is a `ChartError` already, else one with `code` that wraps it as `cause`. */
export function toChartError(
  error: unknown,
  code: ChartErrorCode,
  message: string,
  context: Record<string, unknown> = {},
): ChartError {
  if (error instanceof ChartError) return error;
  return new ChartError(code, /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${message}: ${errorText(error)}` : '', { cause: error, context });
}

/** The message of a thrown `Error`, or anything else thrown as text. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let webgl2: boolean | undefined;

/**
 * Whether this browser can create a WebGL2 context, which the chart needs.
 * Checked once on a detached canvas whose context is released straight away;
 * later calls return the cached answer.
 */
export function isWebGL2Supported(): boolean {
  if (webgl2 !== undefined) return webgl2;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    webgl2 = gl !== null && gl !== undefined;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl2 = false;
  }
  return webgl2;
}
