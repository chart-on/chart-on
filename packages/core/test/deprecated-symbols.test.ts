/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

/** Public sources of every package, and the upgrading guide pages. */
const sources = import.meta.glob<string>('../../*/src/**/*.ts', { query: '?raw', import: 'default', eager: true });
const guides = import.meta.glob<string>('../../../docs/upgrading/*.md', { query: '?raw', import: 'default', eager: true });

/** Names declared right after each `@deprecated` JSDoc tag in `files`, as `file: name`. */
function deprecatedNames(files: Record<string, string>): { file: string; name: string }[] {
  const found: { file: string; name: string }[] = [];
  for (const [file, text] of Object.entries(files)) {
    for (const tag of text.matchAll(/@deprecated/g)) {
      const end = text.indexOf('*/', tag.index);
      const next = text.slice(end + 2).match(/^\s*(?:export\s+)?(?:declare\s+)?(?:readonly\s+|get\s+|const\s+|function\s+|class\s+|interface\s+|type\s+)?(?:['"]([\w$:-]+)|([\w$-]+))/);
      // A quoted key may hold a colon, like an event name.
      found.push({ file, name: next?.[1] ?? next?.[2] ?? '(unknown)' });
    }
  }
  return found;
}

/** Deprecated names with no `### \`name\`…` heading on any upgrading page. */
function missingEntries(files: Record<string, string>, pages: Record<string, string>): string[] {
  const headings = Object.values(pages).flatMap((page) => [...page.matchAll(/^#{2,4} `([^`]+)`/gm)].map((m) => m[1]!));
  return deprecatedNames(files)
    .filter(({ name }) => !headings.includes(name))
    .map(({ file, name }) => `${file.replace(/^(\.\.\/)+/, '')}: ${name}`);
}

describe('deprecated public APIs', () => {
  it('each have an entry in docs/upgrading', () => {
    expect(Object.keys(guides).length).toBeGreaterThan(0);
    expect(missingEntries(sources, guides)).toEqual([]);
  });

  it('reports a new deprecation without an entry', () => {
    const file = '/** Old name.\n * @deprecated Use `newOption`.\n */\n  oldOption?: boolean;\n';
    expect(missingEntries({ 'x.ts': file }, guides)).toEqual(['x.ts: oldOption']);
    expect(missingEntries({ 'x.ts': file }, { 'g.md': '### `oldOption`\n' })).toEqual([]);
  });
});
