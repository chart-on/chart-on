import type { Chart, StateChangeReason } from '../chart';
import type { ChartLayout, LayoutSerializeOptions } from '../layout';

/** Everything but `'viewport'`, which changes on every pan and zoom. */
export const DEFAULT_AUTOSAVE_REASONS: readonly StateChangeReason[] = ['drawings', 'indicators', 'series', 'panes', 'symbol', 'options'];

/** Options for `autosave`: the debounce delay, which changes save, how the layout is serialized and stored, error handling, and the flush-on-leave target. */
export interface AutosaveOptions {
  /** Wait this long after the last change before saving. Default 1000. */
  delayMs?: number;
  /** Changes that trigger a save. Default every reason but `'viewport'`. */
  include?: readonly StateChangeReason[];
  /** Passed to `serializeLayout`, e.g. `{ drawings: false }` when drawings are kept per symbol. */
  serialize?: LayoutSerializeOptions;
  /** Store the layout. `reasons` lists what changed since the last save. */
  save: (layout: ChartLayout, reasons: StateChangeReason[]) => void | Promise<void>;
  /** A save threw or rejected. Default logs it. */
  onError?: (error: unknown) => void;
  /**
   * Where to listen for `pagehide`, which saves a pending change at once so
   * the last edit is not lost. Default `globalThis`; null turns it off.
   */
  flushTarget?: EventTarget | null;
}

/** A running autosave from `autosave`: shows whether a save is pending, and saves, drops or stops it. */
export interface Autosave {
  /** A change is waiting for the delay. */
  readonly pending: boolean;
  /** Save a pending change now. Resolves once it is saved (at once when nothing is pending). */
  flush(): Promise<void>;
  /** Drop a pending change without saving it. */
  cancel(): void;
  /** Stop listening; a pending change is dropped (call `flush` first to keep it). */
  stop(): void;
}

/** @internal Calls `run` once `delayMs` passes without another `touch`. */
export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly delayMs: number,
    private readonly run: () => void,
  ) {}

  get pending(): boolean {
    return this.timer !== undefined;
  }

  touch(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.run();
    }, this.delayMs);
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/** @internal Listen for `pagehide` on `target`; returns the unsubscribe function. */
export function onPageHide(target: EventTarget | null | undefined, listener: () => void): () => void {
  const t = target === undefined ? (globalThis as Partial<EventTarget>) : target;
  if (!t || typeof t.addEventListener !== 'function') return () => {};
  t.addEventListener('pagehide', listener);
  return () => t.removeEventListener!('pagehide', listener);
}

/**
 * Save the chart's layout after changes, debounced. Listens to `state:change`,
 * so loading a layout, drawings or indicators never saves. Saving needs the
 * `layouts()` plugin; without it each save fails through `onError`, and the
 * changes stay for the next save, e.g. after `chart.install(layouts())`. A save due while a
 * loaded layout's symbol is still loading is dropped: the chart reports the
 * edits made meanwhile once it has loaded, and those save then.
 *
 * Before loading another layout into the chart, `await flush()` so pending
 * changes go to the layout they belong to.
 *
 * @example
 * ```ts
 * const saver = autosave(chart, {
 *   save: (layout) => storage.saveLayout(layoutEntry(layout, 'Main', 'main')).then(() => {}),
 * });
 * await saver.flush(); // before loading another layout
 * ```
 */
export function autosave(chart: Chart, options: AutosaveOptions): Autosave {
  const include = new Set(options.include ?? DEFAULT_AUTOSAVE_REASONS);
  const onError = options.onError ?? ((error: unknown) => console.error('Autosave failed', error));
  let reasons = new Set<StateChangeReason>();

  const save = (): Promise<void> => {
    debounce.cancel();
    if (reasons.size === 0) return Promise.resolve();
    // Half-applied: the chart re-reports edits made during the load once it settles.
    if (chart.layoutLoading) {
      reasons = new Set();
      return Promise.resolve();
    }
    const changed = [...reasons];
    reasons = new Set();
    try {
      return Promise.resolve(options.save(chart.serializeLayout(options.serialize), changed)).catch(onError);
    } catch (error) {
      // Nothing was saved (no `layouts()` plugin yet, say): the next save takes these changes too.
      for (const reason of changed) reasons.add(reason);
      onError(error);
      return Promise.resolve();
    }
  };
  const debounce = new Debouncer(options.delayMs ?? 1000, () => void save());

  const off = chart.on('state:change', ({ reason }) => {
    if (!include.has(reason)) return;
    reasons.add(reason);
    debounce.touch();
  });
  const offHide = onPageHide(options.flushTarget, () => void save());

  return {
    get pending() {
      return debounce.pending;
    },
    flush: save,
    cancel: () => {
      debounce.cancel();
      reasons = new Set();
    },
    stop: () => {
      off();
      offHide();
      debounce.cancel();
      reasons = new Set();
    },
  };
}
