import { build, type Rollup } from 'vite';
import { describe, expect, it } from 'vitest';

// The shell's chrome, trading and replay parts are opt-in: an app that leaves a part's option out ships none of its
// code, and one that passes the part's factory ships it. Checked on what a bundler keeps of the UI
// sources (whole modules dropped) and of the UI built into one module like `dist/index.js`
// (only statement-level tree shaking can drop a part there).

/** A path next to this file as a bundler module path (`C:/...` on Windows, not `/C:/...`). */
const dirPath = (relative: string) => decodeURIComponent(new URL(relative, import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '');
const repoRoot = dirPath('../../../');
const uiSrc = dirPath('../src/');
const coreSrc = dirPath('../../core/src/');

const manifest: { sideEffects: unknown } = await import('../package.json', { with: { type: 'json' } });

const ENTRY = '\0ui-tree-shaking-entry';
const SINGLE = '\0ui-tree-shaking-single-module';

const inSources = (id: string, dir: string) => id.replaceAll('\\', '/').startsWith(dir);

function codeOf(output: Awaited<ReturnType<typeof build>>): string {
  const results = (Array.isArray(output) ? output : [output]) as Rollup.RollupOutput[];
  return results
    .flatMap((r) => r.output)
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
    .join('\n');
}

/** The UI's public entry bundled into one module, with the core left external as in `dist/index.js`. */
async function singleModuleUi(): Promise<string> {
  return codeOf(
    await build({
      root: repoRoot,
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        lib: { entry: `${uiSrc}index.ts`, formats: ['es'] },
        rollupOptions: { external: ['@chart-on/core'] },
      },
    }),
  );
}

/**
 * An app importing `imports` from `@chart-on/ui`, read from the sources, or from `built` (the UI as
 * one module) when given. The core comes from its sources; both packages are side-effect free
 * apart from the UI's stylesheet, as their manifests say.
 */
async function bundle(imports: string[], built?: string): Promise<string> {
  const ui = manifest.sideEffects;
  return codeOf(
    await build({
      root: repoRoot,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@chart-on/core': `${coreSrc}index.ts`, ...(built ? {} : { '@chart-on/ui': `${uiSrc}index.ts` }) } },
      plugins: [
        {
          name: 'ui-tree-shaking-entry',
          enforce: 'pre',
          resolveId: (id) => (id === 'entry' ? ENTRY : built && id === '@chart-on/ui' ? SINGLE : null),
          load: (id) =>
            id === ENTRY
              ? `import { ${imports.join(', ')} } from '@chart-on/ui';\nconsole.log(${imports.join(', ')});\n`
              : id === SINGLE
                ? built
                : null,
        },
      ],
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          input: 'entry',
          treeshake: {
            moduleSideEffects: (id: string) =>
              !(inSources(id, coreSrc) || id === SINGLE || (inSources(id, uiSrc) && Array.isArray(ui) && !id.endsWith('.css'))),
          },
        },
      },
    }),
  );
}

/** Top-level declarations a bundle contains, matched by name (a bundler may add a `$1` suffix). */
function declared(code: string, names: string[]): string[] {
  return names.filter((name) => new RegExp(`\\b(?:var|let|const|class|function)\\s+${name}(?:\\$\\d+)?\\b`).test(code));
}

const PARTS = {
  symbolSearch: ['createSymbolSearch', 'bindSymbolSearchKeys', 'createSearchController'],
  commandPalette: ['createCommandPalette', 'rankCommands'],
  favorites: ['createFavorites', 'sanitizeFavorites', 'placeFavoritesBar'],
  toasts: ['createToastStack'],
  toolbarCustomization: ['createToolbarCustomization', 'moveToolbarAction', 'toolbarBuiltins'],
  clusterList: ['createClusterList', 'clusterRowText', 'canCancel'],
  draftEditor: ['createDraftEditor', 'presetQuantity', 'presetLabel'],
};
const FACTORIES = Object.keys(PARTS);
const ALL = Object.values(PARTS).flat();
// Never part of the shell: the app mounts these itself, so a shell leaves them out too.
const STANDALONE = ['createDepthLadder', 'depthLadderRows', 'createShortcutSettings'];

describe('shell parts', () => {
  it('lists the stylesheet as the only side effect of the package', () => {
    expect(manifest.sideEffects).toEqual(['*.css']);
  });

  it('leaves every part out of a minimal shell and keeps each once its factory is imported', async () => {
    const minimal = await bundle(['createChartShell']);
    expect(declared(minimal, ['createChartShell'])).toEqual(['createChartShell']);
    expect(declared(minimal, [...ALL, ...STANDALONE])).toEqual([]);
    const full = await bundle(['createChartShell', ...FACTORIES]);
    expect(declared(full, ALL)).toEqual(ALL);
  }, 120_000);

  // One module, like the published `dist/index.js`: a part's top-level code must be pure for the
  // bundler to drop it statement by statement.
  it('does the same with the UI bundled into one module', async () => {
    const single = await singleModuleUi();
    const minimal = await bundle(['createChartShell'], single);
    expect(declared(minimal, ['createChartShell'])).toEqual(['createChartShell']);
    expect(declared(minimal, [...ALL, ...STANDALONE])).toEqual([]);
    for (const [factory, names] of Object.entries(PARTS)) {
      const code = await bundle(['createChartShell', factory], single);
      expect(declared(code, ALL), factory).toEqual(names);
    }
  }, 240_000);
});
