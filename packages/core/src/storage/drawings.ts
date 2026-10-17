import type { Chart } from '../chart';
import type { ChartLayout, LayoutLoadOptions, LayoutLoadResult } from '../layout';
import { DRAWINGS_VERSION } from '../drawing/manager';
import { ChartError } from '../errors';
import type { Drawing } from '../drawing/types';
import { Debouncer, onPageHide } from './autosave';
import type { LayoutEntry, LayoutPreview, StorageAdapter } from './types';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Options for `perSymbolDrawings`: the storage key per symbol, the save delay, error handling, and the flush-on-leave target. */
export interface PerSymbolDrawingsOptions {
  /** Storage key for a symbol id. Default the symbol id itself; add a layout id to keep drawings per layout and symbol. */
  key?: (symbol: string) => string;
  /** Wait this long after the last change before saving. Default 500. */
  delayMs?: number;
  /** A load or save failed. Default logs it. */
  onError?: (error: unknown) => void;
  /** Where to listen for `pagehide`, which saves a pending change at once. Default `globalThis`; null turns it off. */
  flushTarget?: EventTarget | null;
}

/** A running `perSymbolDrawings` binding: the current storage key, plus flushing and stopping. */
export interface PerSymbolDrawings {
  /** Storage key of the symbol whose drawings are on the chart; null before the first symbol loads. */
  readonly key: string | null;
  /** Save a pending change now. */
  flush(): Promise<void>;
  /** Stop following symbol switches; a pending change is dropped (call `flush` first to keep it). */
  stop(): void;
}

/**
 * Keep drawings per symbol through `storage`. When the chart switches to
 * another symbol, the old symbol's drawings are saved and cleared, and the
 * new symbol's are loaded. Edits save debounced, with the ids that changed.
 * Loading never saves. Switching intervals keeps the drawings. When a
 * symbol's drawings fail to load, nothing saves under its key until the next
 * switch, so the stored drawings are not overwritten.
 * The binding stops on chart destruction; flush first to keep pending edits.
 *
 * Clearing on a switch removes drawings added with `persist: false` too; add
 * yours again on `data:loaded`. Save layouts with `serializeLayout({ drawings: false })`
 * (or `autosave`'s `serialize` option) so they don't hold drawings as well.
 */
export function perSymbolDrawings(chart: Chart, storage: StorageAdapter, options: PerSymbolDrawingsOptions = {}): PerSymbolDrawings {
  // Throws at once on a chart without the drawings plugin.
  void chart.drawings;
  const keyOf = options.key ?? ((symbol: string) => symbol);
  const onError = options.onError ?? ((error: unknown) => console.error('Saving drawings failed', error));
  let key: string | null = null;
  let changed = new Set<string>();
  let removed = new Set<string>();
  let dirty = false;
  /** Bumped per switch, so a slow load for an earlier symbol is dropped. */
  let generation = 0;
  /** True while the current symbol's drawings are being fetched. */
  let fetching = false;
  /**
   * The current symbol's saved drawings failed to load. Saving would replace
   * them with only what is on the chart, so edits stay unsaved until the next switch.
   */
  let unreadable = false;

  const save = (): Promise<void> => {
    debounce.cancel();
    if (!dirty || key === null || fetching || unreadable) return Promise.resolve();
    const persisted = new Set(chart.drawings.serialize().drawings.map((d) => d.id));
    const delta = { changed: [...changed].filter((id) => persisted.has(id)), removed: [...removed] };
    const drawings = chart.drawings.serialize();
    dirty = false;
    changed = new Set();
    removed = new Set();
    if (!storage.saveDrawings) return Promise.resolve();
    try {
      return storage.saveDrawings(key, drawings, delta).catch(onError);
    } catch (error) {
      onError(error);
      return Promise.resolve();
    }
  };
  const debounce = new Debouncer(options.delayMs ?? 500, () => void save());

  const load = (next: string): void => {
    void save();
    // Anything not saved (the old symbol's drawings were still loading) stays with it.
    debounce.cancel();
    dirty = false;
    changed = new Set();
    removed = new Set();
    key = next;
    unreadable = false;
    const run = ++generation;
    // Quiet: `drawings.load` is not a `state:change`.
    chart.drawings.load({ version: DRAWINGS_VERSION, drawings: [] });
    if (!storage.loadDrawings) return;
    fetching = true;
    let pending: Promise<unknown>;
    try {
      pending = storage.loadDrawings(next);
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending
      .then((saved) => {
        if (run !== generation) return;
        fetching = false;
        // Drawn while the saved ones loaded: keep them on top, and save the merge.
        const drawn: Drawing[] = dirty ? chart.drawings.getAll().filter((d) => d.persist !== false) : [];
        if (saved) {
          const result = chart.drawings.load(saved);
          if (result.errors.length > 0) onError(new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Skipped ${result.errors.length} saved drawing(s) for "${next}"` : ''));
        }
        const ids = new Set(chart.drawings.getAll().map((d) => d.id));
        for (const d of drawn) if (!ids.has(d.id)) chart.drawings.add(d);
      })
      .catch((error: unknown) => {
        if (run === generation) {
          fetching = false;
          unreadable = true;
        }
        onError(error);
      })
      .finally(() => {
        if (run === generation && dirty) debounce.touch();
      });
  };

  const offs = [
    chart.on('data:loading', ({ symbol, kind }) => {
      if (kind !== 'initial') return;
      const next = keyOf(symbol);
      if (next !== key) load(next);
    }),
    chart.on('state:change', ({ reason }) => {
      if (reason !== 'drawings' || key === null) return;
      dirty = true;
      if (!fetching) debounce.touch();
    }),
    chart.on('drawing:create', ({ drawing }) => {
      changed.add(drawing.id);
      removed.delete(drawing.id);
    }),
    chart.on('drawing:update', ({ drawing }) => changed.add(drawing.id)),
    chart.on('drawing:remove', ({ id }) => {
      changed.delete(id);
      removed.add(id);
    }),
    onPageHide(options.flushTarget, () => void save()),
    chart.on('chart:destroy', () => stop()),
  ];

  const stop = (): void => {
    offs.forEach((off) => off());
    debounce.cancel();
    generation++;
    dirty = false;
  };

  // Already showing a symbol: its drawings are the ones on the chart.
  const current = chart.data?.symbol?.symbol;
  if (current !== undefined) load(keyOf(current));

  return {
    get key() {
      return key;
    },
    flush: save,
    stop,
  };
}

/**
 * What `storage.saveLayout()` takes for `layout`: the layout and the summary
 * `listLayouts` returns for it. `savedAt` is now: call it when saving, so a
 * layout loaded and saved again (whose `meta.updatedAt` is still the old
 * time) sorts as the newest. Leave `id` out to save a new layout.
 *
 * ```ts
 * await storage.saveLayout(layoutEntry(chart.serializeLayout(), 'Swing'));
 * ```
 */
export function layoutEntry(layout: ChartLayout, name: string, id?: string): LayoutEntry {
  const { symbol, interval } = layout;
  const preview: LayoutPreview = { ...(symbol !== undefined && { symbol }), ...(interval !== undefined && { interval }) };
  return {
    ...(id !== undefined && { id }),
    summary: { name, savedAt: Math.floor(Date.now() / 1000), ...((symbol ?? interval) !== undefined && { preview }) },
    layout,
  };
}

/** The layout `loadLastLayout` loaded: its storage id and the `loadLayout` result. */
export interface LastLayout {
  id: string;
  result: LayoutLoadResult;
}

/**
 * Load the most recently updated layout from `storage` into the chart.
 * Layouts that are missing or not layouts are skipped for the next newest.
 * Resolves with its id and the `loadLayout` result, or null when there is none.
 * Rejects with a `not-registered` `ChartError` on a chart without the
 * `layouts()` plugin, which has a saved layout but cannot load it.
 */
export async function loadLastLayout(chart: Chart, storage: StorageAdapter, options: LayoutLoadOptions = {}): Promise<LastLayout | null> {
  if (!storage.listLayouts || !storage.loadLayout) return null;
  const layouts = [...(await storage.listLayouts())].sort((a, b) => b.savedAt - a.savedAt);
  for (const { id } of layouts) {
    const layout = await storage.loadLayout(id);
    if (!layout) continue;
    try {
      return { id, result: chart.loadLayout(layout, options) };
    } catch (error) {
      // No other layout loads either on a chart without `layouts()`.
      if (error instanceof ChartError && error.code === 'not-registered') throw error;
      // Not a layout any version understands: try the next one.
    }
  }
  return null;
}
