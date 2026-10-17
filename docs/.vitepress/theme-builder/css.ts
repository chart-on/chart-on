/**
 * A small reader for the parts of a stylesheet the theme builder needs: the
 * custom properties each rule declares. Not a general CSS parser: it knows
 * rules, at-rule blocks, comments and quoted strings, which is all
 * `@charton/ui/style.css` and an exported theme block use.
 */

/** One style rule: its selectors (whitespace collapsed, double quotes as single) and its custom properties. */
export interface CssRule {
  selectors: string[];
  vars: Map<string, string>;
  /** Inside an at-rule block such as `@media`. */
  nested: boolean;
}

/** Index after the quoted string that starts at `start`. */
function skipString(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === quote) return i + 1;
  }
  return text.length;
}

/** Index of the `}` that closes the `{` at `open`, or the end of `text` when it is never closed. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i = skipString(text, i) - 1;
    } else if (c === '{') {
      depth++;
    } else if (c === '}' && --depth === 0) {
      return i;
    }
  }
  return text.length;
}

function stripComments(css: string): string {
  let out = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!;
    if (c === '"' || c === "'") {
      const end = skipString(css, i);
      out += css.slice(i, end);
      i = end - 1;
    } else if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
    } else {
      out += c;
    }
  }
  return out;
}

export function normalizeSelector(selector: string): string {
  return selector.trim().replace(/\s+/g, ' ').replace(/"/g, "'");
}

/** The custom property declarations in a rule body; nested blocks are skipped, the last declaration wins. */
export function declarations(body: string): Map<string, string> {
  const vars = new Map<string, string>();
  let start = 0;
  let parens = 0;
  const take = (end: number) => {
    const part = body.slice(start, end);
    start = end + 1;
    const colon = part.indexOf(':');
    if (colon < 0) return;
    const name = part.slice(0, colon).trim();
    if (!name.startsWith('--')) return;
    vars.set(name, part.slice(colon + 1).trim().replace(/\s*!important$/i, ''));
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'") i = skipString(body, i) - 1;
    else if (c === '(') parens++;
    else if (c === ')') parens--;
    else if (c === ';' && parens === 0) take(i);
    else if (c === '{') {
      // A nested rule: drop it along with its selector.
      i = closingBrace(body, i);
      start = i + 1;
    }
  }
  take(body.length);
  return vars;
}

function walk(css: string, nested: boolean, out: CssRule[]): void {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) return;
    const close = closingBrace(css, open);
    let prelude = css.slice(i, open);
    // Statements such as `@import …;` before the rule.
    prelude = prelude.slice(prelude.lastIndexOf(';') + 1).trim();
    const body = css.slice(open + 1, close);
    if (/^@(media|supports|container|layer)\b/i.test(prelude)) walk(body, true, out);
    else if (!prelude.startsWith('@')) out.push({ selectors: prelude.split(',').map(normalizeSelector), vars: declarations(body), nested });
    i = close + 1;
  }
}

/** Every style rule in `css`, in source order, including those inside `@media` and similar blocks. */
export function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  walk(stripComments(css), false, rules);
  return rules;
}

/** The custom properties of the top-level rules that list `selector`, merged in source order. */
export function ruleVars(rules: readonly CssRule[], selector: string): Map<string, string> {
  const wanted = normalizeSelector(selector);
  const vars = new Map<string, string>();
  for (const rule of rules) {
    if (rule.nested || !rule.selectors.includes(wanted)) continue;
    for (const [name, value] of rule.vars) vars.set(name, value);
  }
  return vars;
}
