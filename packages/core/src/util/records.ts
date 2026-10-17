import { ChartError, type ChartErrorCode } from '../errors';
import { isDev } from './dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** A finite number; `Number.isFinite` that narrows the type. */
export function isNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

/** A non-empty string, such as an id or a name. */
export function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** A plain object: not null and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Upgrades a saved payload of one version to a newer one. */
type Migration = (data: Record<string, unknown>, fromVersion: unknown) => unknown;

/**
 * Upgrade a saved payload (drawings or a layout) to `current`, step by step
 * through `steps`. A version the steps don't cover goes through `hook` once,
 * which may return the current version or an older one the steps continue
 * from. A payload already at `current` is returned as it is. Throws a
 * `ChartError` with `code` when `isPayload` rejects the payload (`invalid`
 * is the message), when no step or hook applies, or when a step does not
 * return a newer version; `name` names the payload in those messages.
 * @internal
 */
export function migrateVersions(
  data: unknown,
  current: number,
  steps: Readonly<Record<number, Migration>>,
  hook: Migration | null,
  isPayload: (value: unknown) => value is Record<string, unknown>,
  code: ChartErrorCode,
  invalid: string,
  name: 'Drawings' | 'Layout',
): Record<string, unknown> {
  let hooked = false;
  for (;;) {
    if (!isPayload(data)) throw new ChartError(code, /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? invalid : '');
    const version = data.version;
    if (version === current) return data;
    const step = typeof version === 'number' && version < current ? steps[version] : undefined;
    if (step) {
      data = step(data, version);
      // A step that does not move forward would loop forever.
      const next = isPayload(data) ? data.version : undefined;
      if (!(typeof next === 'number' && next > (version as number))) {
        throw new ChartError(code, /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${name} migration from version ${version} returned version ${JSON.stringify(next)}` : '');
      }
    } else if (hook && !hooked) {
      hooked = true;
      data = hook(data, version);
    } else throw new ChartError(code, /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unsupported ${name.toLowerCase()} version ${JSON.stringify(version)}` : '');
  }
}
