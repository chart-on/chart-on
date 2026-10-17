import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import type { MarkdownRenderer } from 'vitepress';
import { examples, type ExampleId } from '../examples/index';

const exampleFile = (id: string) => fileURLToPath(new URL(`../examples/${id}.ts`, import.meta.url));

const EXAMPLE = /^<!-- example: ([\w-]+) -->$/gm;
const GALLERY = /^<!-- example-gallery -->$/m;

/** `source` encoded as `encodeCode` in `playground/share.ts` does it, synchronously for the Markdown pass. */
function encodeForPlayground(source: string): string {
  return deflateRawSync(source).toString('base64url');
}

/**
 * The live chart and, under it, the file it runs, as Markdown. `plain` leaves
 * out the chart component, for the plain-text copies of the docs.
 */
function exampleMarkdown(id: string, plain = false): string {
  if (!Object.hasOwn(examples, id)) throw new Error(`Unknown docs example "${id}"; add it to docs/examples/index.ts`);
  const source = readFileSync(exampleFile(id), 'utf8').trimEnd();
  // A fence longer than any backtick run in the file.
  const fence = '`'.repeat(Math.max(3, ...[...source.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  const code = `${fence}ts\n${source}\n${fence}`;
  if (plain) return `Example \`${id}\` (runs live on the docs page):\n\n${code}`;
  return `<Example id="${id}" playground="${encodeForPlayground(source)}" />\n\n${code}`;
}

/** Every example in registry order: heading, description, tags, chart and source. */
function galleryMarkdown(plain = false): string {
  return (Object.keys(examples) as ExampleId[])
    .map((id) => {
      const info = examples[id];
      const tags = plain
        ? `Tags: ${info.tags.join(', ')}`
        : info.tags.map((tag) => `<Badge type="info" text="${tag}" />`).join(' ');
      const heading = plain ? `## ${info.title}` : `## ${info.title} {#${id}}`;
      return `${heading}\n\n${info.description}\n\n${tags}\n\n${exampleMarkdown(id, plain)}`;
    })
    .join('\n\n');
}

/** `markdown` with its example markers expanded to plain Markdown: headings, text and source, no components. */
export function expandExamplesPlain(markdown: string): string {
  return markdown.replace(GALLERY, () => galleryMarkdown(true)).replace(EXAMPLE, (_, id: string) => exampleMarkdown(id, true));
}

/**
 * Expands `<!-- example: id -->` lines in the docs into the live `<Example>`
 * and the source of `docs/examples/<id>.ts`, and `<!-- example-gallery -->`
 * into every example, before Markdown is parsed. So the code is highlighted
 * and gets the usual copy button, and the picture and the code always come
 * from the same file. In `docs:dev`, edit the page too to refresh a shown source.
 */
export function examplesMarkdown(md: MarkdownRenderer): void {
  md.core.ruler.before('normalize', 'charton-examples', (state) => {
    if (!state.src.includes('<!-- example')) return;
    state.src = state.src.replace(GALLERY, () => galleryMarkdown()).replace(EXAMPLE, (_, id: string) => exampleMarkdown(id));
  });
}
