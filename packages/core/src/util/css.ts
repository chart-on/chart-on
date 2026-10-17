/** Anything with `getPropertyValue`, such as the result of `getComputedStyle`. */
export interface CssPropertyReader {
  getPropertyValue(name: string): string;
}

/** Deeper than any sane token chain; also stops reference cycles. */
const MAX_VAR_DEPTH = 16;

/**
 * Substitute `var(--name, fallback)` references in `value` using `reader`.
 * Returns `''` when a reference cannot be resolved, like an invalid value in CSS.
 */
export function resolveCssVars(value: string, reader: CssPropertyReader, depth = 0): string {
  let out = value.trim();
  let start = out.indexOf('var(');
  while (start >= 0) {
    if (depth >= MAX_VAR_DEPTH) return '';
    const open = start + 3;
    const close = matchingParen(out, open);
    if (close < 0) return '';
    const inner = out.slice(open + 1, close);
    const comma = indexOfTopLevel(inner, ',');
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    let sub = resolveCssVars(reader.getPropertyValue(name), reader, depth + 1);
    if (!sub && comma >= 0) sub = resolveCssVars(inner.slice(comma + 1), reader, depth + 1);
    if (!sub) return '';
    out = out.slice(0, start) + sub + out.slice(close + 1);
    start = out.indexOf('var(', start + sub.length);
  }
  return out;
}

/** Split on commas that are not inside parentheses, e.g. a list of `rgba()` colors. */
export function splitCssList(value: string): string[] {
  const parts: string[] = [];
  let rest = value;
  for (let i = indexOfTopLevel(rest, ','); i >= 0; i = indexOfTopLevel(rest, ',')) {
    parts.push(rest.slice(0, i).trim());
    rest = rest.slice(i + 1);
  }
  parts.push(rest.trim());
  return parts.filter((p) => p !== '');
}

function matchingParen(text: string, open: number): number {
  let level = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') level++;
    else if (text[i] === ')' && --level === 0) return i;
  }
  return -1;
}

function indexOfTopLevel(text: string, char: string): number {
  let level = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') level++;
    else if (c === ')') level--;
    else if (c === char && level === 0) return i;
  }
  return -1;
}
