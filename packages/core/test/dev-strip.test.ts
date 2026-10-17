import { describe, expect, it } from 'vitest';
import { build, type Rollup } from 'vite';

/** Minified bundle of `code` for `NODE_ENV` `env`, with `@charton/core` and `@charton/ui` from source. */
async function bundle(code: string, env = 'production'): Promise<string> {
  const id = '\0entry';
  const result = (await build({
    configFile: false,
    logLevel: 'silent',
    mode: env,
    define: { 'process.env.NODE_ENV': JSON.stringify(env) },
    resolve: {
      alias: {
        '@charton/core': new URL('../src/index.ts', import.meta.url).pathname,
        '@charton/ui': new URL('../../ui/src/index.ts', import.meta.url).pathname,
      },
    },
    plugins: [{ name: 'entry', resolveId: (s) => (s === 'entry' ? id : null), load: (s) => (s === id ? code : null) }],
    build: { write: false, minify: true, rollupOptions: { input: 'entry' } },
  })) as Rollup.RollupOutput;
  return result.output.map((chunk) => (chunk.type === 'chunk' ? chunk.code : '')).join('\n');
}

// Strings only the checker and the rules contain (the empty `devCheck` calls stay, with their arguments),
// and the development warnings about data times and marker icons.
const DEV_ONLY = [
  'did you mean',
  'is ignored',
  'chart can read',
  'option-unknown',
  'whenAtEnd:0',
  'light:0,system:0',
  'look like milliseconds',
  'is not a whole second',
  'marker icon image',
  'draw through annotations',
  // The table of option rules by series kind.
  'heatmap:`heatmap`,volumeProfile:`volumeProfile`',
];

const APP = `
  import { createChart } from '@charton/core';
  import { createChartShell } from '@charton/ui';
  const chart = createChart(document.body, { barSpacing: 6 });
  chart.addCandles({ upColor: '#0f0' });
  createChartShell(document.body, { theme: 'dark' });
`;

describe('bundles', () => {
  it('leave out the option rules and the checker in production', { timeout: 30_000 }, async () => {
    const js = await bundle(APP);
    expect(js.length).toBeGreaterThan(10_000);
    expect(DEV_ONLY.filter((m) => js.includes(m))).toEqual([]);
  });

  it('keep them in development', { timeout: 30_000 }, async () => {
    const js = await bundle(APP, 'development');
    expect(DEV_ONLY.filter((m) => !js.includes(m))).toEqual([]);
  });
});

/**
 * Minified source modules for `NODE_ENV` `env`, each with its imports left out. The bundler then
 * cannot see that `devWarn` does nothing in production, like a bundler that does
 * not look inside the functions it calls, so only the guard at each call site drops a message.
 */
async function modules(files: string[], env: string): Promise<string> {
  const result = (await build({
    configFile: false,
    logLevel: 'silent',
    mode: env,
    define: { 'process.env.NODE_ENV': JSON.stringify(env) },
    build: {
      write: false,
      minify: true,
      rollupOptions: {
        input: files.map((file) => new URL(`../src/${file}`, import.meta.url).pathname),
        external: (_id, importer) => importer !== undefined,
        preserveEntrySignatures: 'strict',
      },
    },
  })) as Rollup.RollupOutput;
  return result.output.map((chunk) => (chunk.type === 'chunk' ? chunk.code : '')).join('\n');
}

// Messages built where `devWarn` is called.
const MESSAGES = ['draw through annotations', 'marker icon image could not be decoded', 'symbol search of route'];
const CALLERS = ['chart.ts', 'annotations/markers.ts', 'data/router.ts'];

describe('warning messages', () => {
  it('leave production code', { timeout: 60_000 }, async () => {
    const js = await modules(CALLERS, 'production');
    expect(js).toContain('getDataTable');
    expect(MESSAGES.filter((m) => js.includes(m))).toEqual([]);
  });

  it('stay in development code', { timeout: 60_000 }, async () => {
    const js = await modules(CALLERS, 'development');
    expect(MESSAGES.filter((m) => !js.includes(m))).toEqual([]);
  });
});

// Error messages built at throw sites, in modules that throw `Error`, `RangeError` and `ChartError`
// (directly and through `toChartError` and `migrateVersions`).
const ERROR_MESSAGES = ['Cannot remove the main pane', 'goToTime needs a finite time', 'strictly ascending', 'Could not load older bars', 'Invalid layout: expected'];
const THROWERS = ['chart.ts', 'series.ts', 'data/controller.ts', 'layout.ts'];

describe('error messages', () => {
  it('leave production code', { timeout: 60_000 }, async () => {
    const js = await modules(THROWERS, 'production');
    expect(js).toContain('getDataTable');
    expect(ERROR_MESSAGES.filter((m) => js.includes(m))).toEqual([]);
  });

  it('stay in development code', { timeout: 60_000 }, async () => {
    const js = await modules(THROWERS, 'development');
    expect(ERROR_MESSAGES.filter((m) => !js.includes(m))).toEqual([]);
  });
});
