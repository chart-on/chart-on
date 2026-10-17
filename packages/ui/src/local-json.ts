/**
 * Internal: a `localStorage` entry holding JSON, behind the `local…Storage` adapters. `read`
 * checks the parsed value; `write` shapes the saved one. Unavailable or blocked storage reads as
 * empty and saves nothing, so the change still applies for this visit. Saving an empty object
 * removes the entry.
 */
export function localJson<T, S = T>(key: string, read: (data: unknown) => S | null, write: (value: T) => object = (value) => value as object) {
  return {
    load(): S | null {
      try {
        const raw = localStorage.getItem(key);
        return raw ? read(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    save(value: T): void {
      try {
        const data = write(value);
        if (Object.keys(data).length === 0) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(data));
      } catch {
        // Storage full or blocked.
      }
    },
  };
}
