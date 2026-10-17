import type { SerializedDrawings } from '../drawing/types';
import { isRecord } from '../util/records';
import type { ChartLayout } from '../layout';
import type { LayoutEntry, LayoutSummary, SettingsAdapter, StorageAdapter, TemplateKind } from './types';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** The part of the Web Storage API the adapter uses. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Options for `createLocalStorageAdapter`: the key prefix, the Web Storage object to use, and an error hook. */
export interface LocalStorageAdapterOptions {
  /** Prepended to every key. Default `'charton:'`; give each app or chart on a domain its own. */
  prefix?: string;
  /** The store to use. Default `localStorage`; `sessionStorage` or an in-memory stand-in also work. */
  storage?: KeyValueStorage;
  /**
   * Called when a read or write fails (blocked storage, quota full) or a
   * corrupt entry is dropped. Failures never throw; without this they are silent.
   */
  onError?: (error: unknown, key: string) => void;
}

/** A `StorageAdapter` with every method, plus a settings store under the same prefix. */
export type LocalStorageAdapter = Required<StorageAdapter> & { readonly settings: SettingsAdapter };

/** Version of the layout index the adapter writes. */
// 2: entries are `LayoutSummary`s (#860). A version 1 index is converted once on read, so upgrading keeps the list.
const INDEX_VERSION = 2;
/** Version of the template entries the adapter writes. */
const TEMPLATES_VERSION = 1;

/** One saved template in a kind's entry; `scope` is left out when there is none. */
interface StoredTemplate {
  name: string;
  scope?: string;
  content: unknown;
}

/**
 * A key part safe for any store: lower case, with every character outside
 * `a-z`, `0-9`, `_` and `-` replaced by `_`. Symbols that differ only there share a key.
 */
export function storageKeyPart(part: string): string {
  return part.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

/**
 * Chart state in the browser's `localStorage` (or any store with the same
 * three methods). Every access is guarded: private mode, blocked storage and
 * a full quota never break the chart. Unreadable entries read as `null` and
 * are removed.
 *
 * Keys: `<prefix>drawings:<key>`, `<prefix>layouts` (the index),
 * `<prefix>layout:<id>`, `<prefix>templates:<kind>` (every template of the
 * kind, names and scopes kept exactly), `<prefix>settings:<key>`.
 *
 * @example
 * ```ts
 * const storage = createLocalStorageAdapter({ prefix: 'my-app:' });
 * perSymbolDrawings(chart, storage);
 * const last = await loadLastLayout(chart, storage);
 * if (!last) await chart.setSymbol('ABC', '1d');
 * ```
 */
export function createLocalStorageAdapter(options: LocalStorageAdapterOptions = {}): LocalStorageAdapter {
  const prefix = options.prefix ?? 'charton:';
  const report = options.onError ?? (() => {});
  const store = (): KeyValueStorage | null => {
    // Reading `localStorage` itself throws where storage is blocked.
    try {
      return options.storage ?? globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };

  const getRaw = (key: string): string | null => {
    try {
      return store()?.getItem(key) ?? null;
    } catch (error) {
      report(error, key);
      return null;
    }
  };
  const setRaw = (key: string, value: string): boolean => {
    try {
      const s = store();
      if (!s) return false;
      s.setItem(key, value);
      return true;
    } catch (error) {
      report(error, key);
      return false;
    }
  };
  const removeRaw = (key: string): void => {
    try {
      store()?.removeItem(key);
    } catch (error) {
      report(error, key);
    }
  };

  /** Parsed JSON passing `valid`; anything else is dropped and reads as null. */
  const readJSON = <T>(key: string, valid: (value: unknown) => value is T): T | null => {
    const raw = getRaw(key);
    if (raw === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      report(error, key);
      removeRaw(key);
      return null;
    }
    if (valid(value)) return value;
    report(new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Dropped an unreadable entry at "${key}"` : ''), key);
    removeRaw(key);
    return null;
  };
  const writeJSON = (key: string, value: unknown): boolean => {
    let text: string;
    try {
      text = JSON.stringify(value);
    } catch (error) {
      report(error, key);
      return false;
    }
    return setRaw(key, text);
  };

  const drawingsKey = (key: string) => `${prefix}drawings:${storageKeyPart(key)}`;
  const layoutKey = (id: string) => `${prefix}layout:${storageKeyPart(id)}`;
  const indexKey = `${prefix}layouts`;
  const writeIndex = (layouts: LayoutSummary[]) => writeJSON(indexKey, { version: INDEX_VERSION, layouts });
  const readIndex = (): LayoutSummary[] => {
    const index = readJSON(indexKey, isIndex);
    if (index?.version !== 1) return index?.layouts.filter(isLayoutSummary) ?? [];
    const layouts = index.layouts.map(fromVersion1).filter(isLayoutSummary);
    writeIndex(layouts);
    return layouts;
  };

  // One entry per kind, so names and scopes are matched exactly rather than sanitized into keys.
  const templatesKey = (kind: TemplateKind) => `${prefix}templates:${storageKeyPart(kind)}`;
  const readTemplates = (kind: TemplateKind): StoredTemplate[] =>
    readJSON(templatesKey(kind), isTemplates)?.templates.filter(isStoredTemplate) ?? [];
  const writeTemplates = (kind: TemplateKind, templates: StoredTemplate[]) =>
    templates.length === 0
      ? removeRaw(templatesKey(kind))
      : void writeJSON(templatesKey(kind), { version: TEMPLATES_VERSION, templates });
  const sameTemplate = (t: StoredTemplate, name: string, scope: string | undefined) => t.name === name && t.scope === scope;

  const settingsKey = (key: string) => `${prefix}settings:${storageKeyPart(key)}`;
  const settings: SettingsAdapter = {
    get: (key) => getRaw(settingsKey(key)),
    set: (key, value) => void setRaw(settingsKey(key), value),
    remove: (key) => removeRaw(settingsKey(key)),
  };

  return {
    settings,
    loadDrawings: async (key) => readJSON(drawingsKey(key), isDrawings),
    saveDrawings: async (key, drawings) => void writeJSON(drawingsKey(key), drawings),
    removeDrawings: async (key) => removeRaw(drawingsKey(key)),
    listLayouts: async () => readIndex().map((summary) => ({ ...summary })),
    loadLayout: async (id) => readJSON(layoutKey(id), isLayout),
    saveLayout: async (entry: LayoutEntry) => {
      const id = entry.id ?? newLayoutId();
      if (!writeJSON(layoutKey(id), entry.layout)) return id;
      writeIndex([...readIndex().filter((l) => l.id !== id), { ...entry.summary, id }]);
      return id;
    },
    removeLayout: async (id) => {
      removeRaw(layoutKey(id));
      const index = readIndex();
      const kept = index.filter((l) => l.id !== id);
      if (kept.length !== index.length) writeIndex(kept);
    },
    listTemplates: async (kind, scope) =>
      readTemplates(kind)
        .filter((t) => t.scope === scope)
        .map((t) => t.name),
    loadTemplate: async (kind, name, scope) => readTemplates(kind).find((t) => sameTemplate(t, name, scope))?.content ?? null,
    saveTemplate: async (kind, name, content, scope) => {
      const template: StoredTemplate = { name, ...(scope !== undefined ? { scope } : {}), content };
      const templates = readTemplates(kind);
      const at = templates.findIndex((t) => sameTemplate(t, name, scope));
      // A replaced template keeps its place in the list.
      if (at === -1) templates.push(template);
      else templates[at] = template;
      writeTemplates(kind, templates);
    },
    removeTemplate: async (kind, name, scope) => {
      const templates = readTemplates(kind);
      const kept = templates.filter((t) => !sameTemplate(t, name, scope));
      if (kept.length !== templates.length) writeTemplates(kind, kept);
    },
  };
}

function newLayoutId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const isVersion = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0;

function isDrawings(value: unknown): value is SerializedDrawings {
  return isRecord(value) && isVersion(value.version) && Array.isArray(value.drawings);
}

function isLayout(value: unknown): value is ChartLayout {
  return isRecord(value) && isVersion(value.version);
}

function isIndex(value: unknown): value is { version: number; layouts: unknown[] } {
  return isRecord(value) && (value.version === INDEX_VERSION || value.version === 1) && Array.isArray(value.layouts);
}

/** A version 1 index entry (`{ id, name, symbol?, interval?, updatedAt }`) as a `LayoutSummary`; anything else is left for the check to drop. */
function fromVersion1(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { symbol, interval, updatedAt, ...rest } = value;
  const preview = { ...(typeof symbol === 'string' && { symbol }), ...(typeof interval === 'string' && { interval }) };
  return { ...rest, savedAt: updatedAt, ...(Object.keys(preview).length > 0 && { preview }) };
}

function isTemplates(value: unknown): value is { version: number; templates: unknown[] } {
  return isRecord(value) && value.version === TEMPLATES_VERSION && Array.isArray(value.templates);
}

function isStoredTemplate(value: unknown): value is StoredTemplate {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    (value.scope === undefined || typeof value.scope === 'string') &&
    value.content !== undefined
  );
}

function isLayoutSummary(value: unknown): value is LayoutSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.savedAt === 'number' &&
    (value.preview === undefined || isRecord(value.preview))
  );
}
