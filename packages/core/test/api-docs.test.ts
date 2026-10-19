import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Package entries whose exports are public API. */
const ENTRIES = {
  '@chart-on/core': new URL('../src/index.ts', import.meta.url),
  '@chart-on/core/testing': new URL('../src/testing.ts', import.meta.url),
  '@chart-on/ui': new URL('../../ui/src/index.ts', import.meta.url),
  '@chart-on/ui/templates': new URL('../../ui/src/templates.ts', import.meta.url),
  '@chart-on/ta': new URL('../../ta/src/index.ts', import.meta.url),
  '@chart-on/indicators': new URL('../../indicators/src/index.ts', import.meta.url),
  '@chart-on/react': new URL('../../react/src/index.ts', import.meta.url),
  '@chart-on/react/shell': new URL('../../react/src/shell.ts', import.meta.url),
  '@chart-on/vue': new URL('../../vue/src/index.ts', import.meta.url),
  '@chart-on/vue/shell': new URL('../../vue/src/shell.ts', import.meta.url),
};

/** The main entry points of each package entry, which keep a short `@example`. */
const EXAMPLES: [URL, string[]][] = [
  [
    ENTRIES['@chart-on/core'],
    [
      'createChart',
      'builtins',
      'createLinkGroup',
      'createOhlcvDataSource',
      'createLocalStorageAdapter',
      'autosave',
      'createNumericChart',
      'createSeasonality',
      'IndicatorDef',
    ],
  ],
  [ENTRIES['@chart-on/core/testing'], ['installTestEnvironment']],
  [ENTRIES['@chart-on/ui'], ['createChartShell', 'createChartGrid', 'createToolbar']],
  [ENTRIES['@chart-on/ui/templates'], ['drawingTemplates']],
];

interface EntryExports {
  checker: ts.TypeChecker;
  /** Exported names and the symbols they resolve to. */
  symbols: Map<string, ts.Symbol>;
}

const compiled = new Map<string, EntryExports>();

/** The exports of `entry`, compiled once per test run. */
function entryExports(entry: URL): EntryExports {
  const file = fileURLToPath(entry);
  const cached = compiled.get(file);
  if (cached) return cached;
  const program = ts.createProgram([file], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    // Workspace imports resolve to source, so re-exports between packages keep their docs before a build.
    paths: { '@chart-on/core': [fileURLToPath(ENTRIES['@chart-on/core'])] },
  });
  const checker = program.getTypeChecker();
  const entrySymbol = checker.getSymbolAtLocation(program.getSourceFile(file)!)!;
  const symbols = new Map<string, ts.Symbol>();
  for (const exported of checker.getExportsOfModule(entrySymbol)) {
    symbols.set(exported.name, exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported);
  }
  compiled.set(file, { checker, symbols });
  return { checker, symbols };
}

/** Names exported by `entry` whose declaration has no doc comment, as `name (file)`. */
function undocumentedExports(entry: URL): string[] {
  const { checker, symbols } = entryExports(entry);
  const missing: string[] = [];
  for (const [name, symbol] of symbols) {
    if (ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim()) continue;
    const source = symbol.declarations?.[0]?.getSourceFile().fileName ?? '?';
    missing.push(`${name} (${source.replace(/^.*\/packages\//, '')})`);
  }
  return missing;
}

describe('public API', () => {
  for (const [name, entry] of Object.entries(ENTRIES)) {
    it(`${name} documents every export`, () => {
      expect(undocumentedExports(entry)).toEqual([]);
    }, 30_000);
  }

  it('gives the main entry points an example', () => {
    const missing: string[] = [];
    for (const [entry, names] of EXAMPLES) {
      const { checker, symbols } = entryExports(entry);
      for (const name of names) {
        const tags = symbols.get(name)?.getJsDocTags(checker) ?? [];
        if (!tags.some((tag) => tag.name === 'example')) missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  }, 60_000);
});
