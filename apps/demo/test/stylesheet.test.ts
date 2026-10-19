/// <reference types="vite/client" />
import { build, type Rollup } from 'vite';
import { describe, expect, it } from 'vitest';

// Builds the demo the way `pnpm --filter demo build` does and checks that the pages using the
// shell link its stylesheet. `pnpm dev` injects every CSS import, so a stylesheet a production
// bundler drops only shows up here (#446).

/** A directory next to this file as a bundler module path (`C:/...` on Windows, not `/C:/...`). */
const dirPath = (relative: string) => decodeURIComponent(new URL(relative, import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '');
const demoRoot = dirPath('../');

async function buildDemo(): Promise<Map<string, string>> {
  const output = await build({
    root: demoRoot,
    configFile: `${demoRoot}vite.config.ts`,
    logLevel: 'silent',
    build: { write: false, minify: false },
  });
  const files = new Map<string, string>();
  for (const result of (Array.isArray(output) ? output : [output]) as Rollup.RollupOutput[]) {
    for (const file of result.output) {
      files.set(file.fileName, file.type === 'asset' ? String(file.source) : file.code);
    }
  }
  return files;
}

/** The stylesheets a built page links, by output file name (the demo builds with relative `./` URLs). */
function linkedStylesheets(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)]
    .map((tag) => /\bhref="\.?\/?([^"]+)"/.exec(tag[0])?.[1])
    .filter((href): href is string => href !== undefined);
}

describe('demo production build', () => {
  it('links the UI stylesheet from every page that uses the shell', async () => {
    const files = await buildDemo();
    for (const page of ['index.html', 'grid.html']) {
      const html = files.get(page);
      expect(html, page).toBeDefined();
      const css = linkedStylesheets(html!).map((name) => files.get(name) ?? '');
      expect(
        css.some((source) => source.includes('.pc-shell')),
        `${page} links no stylesheet with the shell rules`,
      ).toBe(true);
    }
  }, 120_000);
});
