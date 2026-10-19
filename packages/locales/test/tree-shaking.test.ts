import { build, type Rollup } from 'vite';
import { describe, expect, it } from 'vitest';
import type { LocalizationOptions } from '@chart-on/core';

// Locale packs are opt-in: an app that imports none ships none of their text, and an app that
// imports one ships only that one. Checked on what a bundler keeps, with each pack's own
// `scrollToLatest` text as its marker.

/** A path next to this file as a bundler module path (`C:/...` on Windows, not `/C:/...`). */
const path = (relative: string) => decodeURIComponent(new URL(relative, import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '');

const manifest = '../package.json';
const pkg: { exports: Record<string, unknown> } = await import(manifest, { with: { type: 'json' } });
const tags = Object.keys(pkg.exports)
  .filter((subpath) => subpath !== './package.json')
  .map((subpath) => subpath.slice(2));
const markers = new Map(
  await Promise.all(
    tags.map(async (tag) => {
      const [pack] = Object.values((await import(`../src/${tag}.ts`)) as Record<string, LocalizationOptions>);
      return [tag, pack!.messages!.scrollToLatest!] as const;
    }),
  ),
);

const ENTRY = '\0locale-pack-entry';

/** Unminified code of an app whose single module is `code`, with the packages read from their sources. */
async function bundle(code: string): Promise<string> {
  const output = (await build({
    root: path('../../../'),
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: {
        '@chart-on/core': path('../../core/src/index.ts'),
        '@chart-on/ui': path('../../ui/src/index.ts'),
      },
    },
    plugins: [{ name: 'locale-pack-entry', resolveId: (id) => (id === 'entry' ? ENTRY : null), load: (id) => (id === ENTRY ? code : null) }],
    build: { write: false, minify: false, rollupOptions: { input: 'entry' } },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[];
  return (Array.isArray(output) ? output : [output])
    .flatMap((result) => result.output)
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
    .join('\n');
}

/** The tags whose marker text is in `code`. */
const packsIn = (code: string) => tags.filter((tag) => code.includes(markers.get(tag)!));

describe('locale packs', () => {
  it('have distinct marker texts', () => {
    expect(new Set(markers.values()).size).toBe(tags.length);
  });

  it('stay out of a chart with the default shell', async () => {
    const code = await bundle(
      "import { createChart } from '@chart-on/core';\nimport { createChartShell } from '@chart-on/ui';\nconsole.log(createChart, createChartShell);\n",
    );
    expect(code).toContain('createChartShell');
    expect(packsIn(code)).toEqual([]);
  }, 120_000);

  it.each(tags)('%s keeps no other pack', async (tag) => {
    const code = await bundle(`import * as pack from '${path(`../src/${tag}.ts`)}';\nconsole.log(pack);\n`);
    expect(packsIn(code)).toEqual([tag]);
  }, 60_000);
});
