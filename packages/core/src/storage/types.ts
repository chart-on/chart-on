import type { Interval } from '../data/types';
import type { SerializedDrawings } from '../drawing/types';
import type { ChartLayout } from '../layout';
import type { Time } from '../types';

/** Drawings that changed since the last save, for backends that store them one by one. */
export interface DrawingsDelta {
  /** Ids created or updated. */
  changed: string[];
  /** Ids removed. */
  removed: string[];
}

/**
 * One saved layout as `listLayouts` returns it: what a layout picker shows
 * without loading the layout (#860). A picker row needs a name to read,
 * when it was saved to sort and date it, and what the chart shows to tell
 * similar names apart; nothing else, so adapters keep it small.
 */
export interface LayoutSummary {
  id: string;
  name: string;
  /** When it was saved, unix seconds. */
  savedAt: Time;
  /** What it shows, when the layout names a symbol or an interval. */
  preview?: LayoutPreview;
}

/** What a saved layout shows: its symbol id and interval, each when the layout has one. */
export interface LayoutPreview {
  symbol?: string;
  interval?: Interval;
}

/**
 * What `saveLayout` stores: the layout, and its summary for `listLayouts`.
 * Build it with `layoutEntry()`. Adapters store the summary as it is, with the
 * id, and never read fields out of the layout. `id` is left out for a new
 * layout, and the adapter picks one.
 */
export interface LayoutEntry {
  id?: string;
  summary: Omit<LayoutSummary, 'id'>;
  layout: ChartLayout;
}

/**
 * What a template holds: a drawing tool's style (`scope` is the tool type), an
 * indicator's inputs and style (`scope` is the indicator id), the chart's
 * style, a group of indicators with their panes (`'indicator-set'`, an
 * `IndicatorSet` from `chart.indicators.serializeSet()`, no scope), or the
 * inputs and plot styles a new indicator starts with (`'indicator-default'`,
 * `scope` is the indicator id, one entry named `'default'`).
 */
export type TemplateKind = 'drawing' | 'indicator' | 'chart' | 'indicator-set' | 'indicator-default';

/**
 * Where chart state is kept: the browser, a server, anything. Every method is
 * async and optional; implement only what your app uses. Helpers check for a
 * method before calling it. Reads return null for missing or unreadable
 * entries; the chart validates what it loads.
 */
export interface StorageAdapter {
  /** Drawings saved under `key`, e.g. a symbol id. */
  loadDrawings?(key: string): Promise<SerializedDrawings | null>;
  /**
   * Save all drawings under `key`. `delta` lists what changed since the last
   * save under that key, when known, so a server can update only those.
   */
  saveDrawings?(key: string, drawings: SerializedDrawings, delta?: DrawingsDelta): Promise<void>;
  removeDrawings?(key: string): Promise<void>;
  /** Saved layouts, in any order. */
  listLayouts?(): Promise<LayoutSummary[]>;
  loadLayout?(id: string): Promise<ChartLayout | null>;
  /** Save a layout; resolves with its id (a new one when `entry.id` is left out). */
  saveLayout?(entry: LayoutEntry): Promise<string>;
  removeLayout?(id: string): Promise<void>;
  /** Names of the saved templates of `kind` under `scope`, in the order they were first saved. */
  listTemplates?(kind: TemplateKind, scope?: string): Promise<string[]>;
  /** A template's content, or null when there is none by that name. Validate it before use. */
  loadTemplate?(kind: TemplateKind, name: string, scope?: string): Promise<unknown>;
  /** Save `content` (JSON-serializable) under `name`, replacing a template of the same name. */
  saveTemplate?(kind: TemplateKind, name: string, content: unknown, scope?: string): Promise<void>;
  removeTemplate?(kind: TemplateKind, name: string, scope?: string): Promise<void>;
}

/**
 * A small synchronous key/value store for UI preferences: favourites, the
 * last interval, panel visibility. Values are strings; serialize anything else.
 */
export interface SettingsAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}
