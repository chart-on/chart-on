/**
 * What a strict content security policy with Trusted Types enforced blocks, and what
 * would make the library load anything of its own. Shared by the source scan
 * (`packages/core/test/safe-sources.test.ts`) and the scan of the built files
 * (`scripts/check-csp.mjs`). See docs/guide/security.md.
 *
 * Plain TypeScript with no imports, so Node runs it as is and the core tests can import it.
 */

export type Rule = [pattern: RegExp, why: string];

/** Markup parsing, code evaluation, other Trusted Types sinks and inline styles. */
export const UNSAFE: Rule[] = [
  [/\.(inner|outer)HTML\b/, 'parses markup; build nodes with createElement / createElementNS and textContent'],
  [/\b(insertAdjacentHTML|createContextualFragment|DOMParser|setHTMLUnsafe|parseHTMLUnsafe)\b|\bdocument\.write|\.srcdoc\b/, 'parses markup'],
  [/(^|[^.\w$])eval\s*\(|\bnew Function\b/, 'evaluates code'],
  [/\bset(Timeout|Interval)\(\s*['"`]/, 'evaluates a string'],
  [/setAttribute\(\s*['"`]on[a-z]|\bjavascript:/i, 'inline event handler or script URL; use addEventListener'],
  [/createElement(NS)?\([^)]*['"`](script|iframe|object|embed)['"`]/, 'loads a script or embeds a document'],
  [/setAttribute\(\s*['"`]style['"`]|\.cssText\b|createElement\(\s*['"`]style['"`]/, 'inline style markup; set properties on element.style'],
];

/** Code and resources loaded from the network rather than bundled. */
export const LOADS: Rule[] = [
  [/\bnew (Shared)?Worker\b|\bimportScripts\b|(^|[^.\w$])import\s*\(\s*['"`h]/, 'loads code'],
  [/@import\b|@font-face\b|url\(\s*['"]?(https?:|\/\/)/, 'loads a remote resource from CSS'],
];

/**
 * Absolute URLs allowed in built files, none of them fetched: XML namespaces,
 * documentation links in messages, and the project site the logo badge links to.
 */
export const URL_ALLOWED = ['http://www.w3.org/', 'https://github.com/chart-on/chart-on/', 'https://charton.dev'];

/** `file:line: why` for every rule that matches a line. */
function scanLines(file: string, lines: string[], rules: Rule[]): string[] {
  const found: string[] = [];
  lines.forEach((line, i) => {
    for (const [pattern, why] of rules) if (pattern.test(line)) found.push(`${file}:${i + 1}: ${why}`);
  });
  return found;
}

/**
 * Scan one built file (minified or not; comments are scanned too, as a bundler may keep
 * them). JS gets every rule plus a check for hard-coded remote URLs; CSS gets the
 * resource rules plus `url()` anything but a data URL.
 */
export function scanBuilt(file: string, text: string): string[] {
  const lines = text.split('\n');
  if (file.endsWith('.css')) {
    return scanLines(file, lines, [...LOADS, [/url\(\s*['"]?(?!data:|#)/, 'loads a resource from CSS']]);
  }
  const found = scanLines(file, lines, [...UNSAFE, ...LOADS]);
  lines.forEach((line, i) => {
    for (const [url] of line.matchAll(/https?:\/\/[^\s'"`)<>\\]+/g)) {
      if (!URL_ALLOWED.some((allowed) => url.startsWith(allowed))) {
        found.push(`${file}:${i + 1}: hard-codes a remote URL (${url})`);
      }
    }
  });
  return found;
}
