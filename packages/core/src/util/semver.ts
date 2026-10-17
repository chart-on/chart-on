import { isDev } from './dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };
/**
 * Just enough semantic-version range matching to check a plugin's `requires`
 * against the core version: `1.2.3`, `=1.2.3`, comparators (`>=`, `>`, `<=`,
 * `<`), caret (`^1.2.3`), tilde (`~1.2.3`), `x` ranges (`1.x`, `1.2.*`, `*`),
 * space-separated sets that must all match, and `||` alternatives.
 * Pre-release tags are ignored; a version with one compares as its release.
 */

type Triple = [number, number, number];

/** `version` as numbers, or null when it is not `major.minor.patch` (optionally with a tag). */
export function parseVersion(version: string): Triple | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a: Triple, b: Triple): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

type Test = (v: Triple) => boolean;

/** Whether `version` falls in `range`. Throws for a range it cannot read. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid version "${version}"` : '');
  return range.split('||').some((set) => {
    const parts = set.trim().split(/\s+/).filter(Boolean);
    return (parts.length === 0 ? [() => true] : parts.map((p) => comparator(p, range))).every((test) => test(v));
  });
}

function comparator(text: string, range: string): Test {
  const m = /^(\^|~|>=|<=|>|<|=)?v?(\*|x|X|\d+)(?:\.(\*|x|X|\d+))?(?:\.(\*|x|X|\d+))?(?:[-+].*)?$/.exec(text);
  if (!m) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid version range "${range}"` : '');
  const op = m[1] ?? '';
  const nums = [m[2], m[3], m[4]].map((p) => (p === undefined || /^[*xX]$/.test(p) ? null : Number(p)));
  // How many leading parts were given before the first wildcard or missing part.
  const fixed = nums.findIndex((n) => n === null);
  const given = fixed < 0 ? 3 : fixed;
  const base: Triple = [nums[0] ?? 0, given > 1 ? nums[1]! : 0, given > 2 ? nums[2]! : 0];
  if (given === 0) return () => op === '' || op === '=' || op === '>=' || op === '<=' || op === '^' || op === '~';
  const at = (b: Triple) => (v: Triple) => compare(v, b);
  const cmp = at(base);
  // The first version past the range a partial or wildcard version stands for (1.2 -> 1.3.0).
  const next: Triple = given === 1 ? [base[0] + 1, 0, 0] : given === 2 ? [base[0], base[1] + 1, 0] : [base[0], base[1], base[2] + 1];
  switch (op) {
    case '>=':
      return (v) => cmp(v) >= 0;
    case '>':
      return given === 3 ? (v) => cmp(v) > 0 : (v) => compare(v, next) >= 0;
    case '<':
      return (v) => cmp(v) < 0;
    case '<=':
      return given === 3 ? (v) => cmp(v) <= 0 : (v) => compare(v, next) < 0;
    case '^': {
      // Up to the next change of the first non-zero part given.
      const upper: Triple =
        base[0] > 0 || given === 1 ? [base[0] + 1, 0, 0] : base[1] > 0 || given === 2 ? [0, base[1] + 1, 0] : [0, 0, base[2] + 1];
      return (v) => cmp(v) >= 0 && compare(v, upper) < 0;
    }
    case '~': {
      const upper: Triple = given === 1 ? [base[0] + 1, 0, 0] : [base[0], base[1] + 1, 0];
      return (v) => cmp(v) >= 0 && compare(v, upper) < 0;
    }
    default:
      return given === 3 ? (v) => cmp(v) === 0 : (v) => cmp(v) >= 0 && compare(v, next) < 0;
  }
}
