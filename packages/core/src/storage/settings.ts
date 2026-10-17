import type { SettingsAdapter } from './types';

/** Key the settings store keeps its version under. */
export const SETTINGS_VERSION_KEY = 'settings-version';

/** Options for `createSettingsStore`: where values persist, preloaded and locked values, and the version with its migration. */
export interface SettingsStoreOptions {
  /** Where values are written, and read when the snapshot doesn't have them. Default none: values live for this page only. */
  adapter?: SettingsAdapter | null;
  /**
   * Values loaded ahead of time, e.g. fetched from your server before the
   * chart starts, so reads stay synchronous. They win over the adapter.
   */
  snapshot?: Readonly<Record<string, string>>;
  /** Values the app fixes: reads return them and writes to them are ignored. */
  locked?: Readonly<Record<string, string>>;
  /** Version of the stored settings. Default 1. */
  version?: number;
  /**
   * Upgrade settings stored by an older version (`fromVersion` is 0 when none
   * was recorded): read old keys from `store` and write new ones. Runs once,
   * when the store is created; the new version is saved after it.
   */
  migrate?: (store: SettingsAdapter, fromVersion: number) => void;
}

/** User preferences from `createSettingsStore`: synchronous string and JSON reads and writes, with values the app locked. */
export interface SettingsStore extends SettingsAdapter {
  /** True when the app locked `key`. */
  isLocked(key: string): boolean;
  /** A JSON value, or `fallback` when missing or unreadable. */
  getJSON<T>(key: string, fallback: T): T;
  setJSON(key: string, value: unknown): void;
  /** Every value set or read so far, plus the snapshot, e.g. to send to a server. Locked values are left out. */
  values(): Record<string, string>;
}

/**
 * User preferences with synchronous reads. A value comes from, in order: the
 * app's `locked` values, then what the user set (this session, the
 * `snapshot`, or the adapter), then the caller's fallback. Adapter failures
 * never throw.
 */
export function createSettingsStore(options: SettingsStoreOptions = {}): SettingsStore {
  const adapter = options.adapter ?? null;
  const locked = new Map(Object.entries(options.locked ?? {}));
  const values = new Map<string, string | null>(Object.entries(options.snapshot ?? {}));

  const read = (key: string): string | null => {
    if (values.has(key)) return values.get(key)!;
    let value: string | null = null;
    try {
      value = adapter?.get(key) ?? null;
    } catch {
      value = null;
    }
    values.set(key, value);
    return value;
  };
  const write = (key: string, value: string | null): void => {
    values.set(key, value);
    try {
      if (value === null) adapter?.remove(key);
      else adapter?.set(key, value);
    } catch {
      // Blocked or full storage: the value lives for this page only.
    }
  };

  const store: SettingsStore = {
    get: (key) => locked.get(key) ?? read(key),
    set: (key, value) => {
      if (!locked.has(key)) write(key, String(value));
    },
    remove: (key) => {
      if (!locked.has(key)) write(key, null);
    },
    isLocked: (key) => locked.has(key),
    getJSON: <T>(key: string, fallback: T): T => {
      const raw = store.get(key);
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    setJSON: (key, value) => store.set(key, JSON.stringify(value)),
    values: () => {
      const out: Record<string, string> = {};
      for (const [key, value] of values) if (value !== null && !locked.has(key)) out[key] = value;
      return out;
    },
  };

  const version = options.version ?? 1;
  const stored = Number(read(SETTINGS_VERSION_KEY) ?? 0);
  const from = Number.isFinite(stored) ? stored : 0;
  if (from < version) {
    try {
      options.migrate?.(store, from);
    } finally {
      write(SETTINGS_VERSION_KEY, String(version));
    }
  }
  return store;
}
