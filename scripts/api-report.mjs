// API reports: one `etc/<package>[-<subpath>].api.md` per public entry of each published package,
// written by API Extractor from the built declarations. Run after `pnpm build`.
//
//   node scripts/api-report.mjs          fail when a report differs from the API (pnpm api:check)
//   node scripts/api-report.mjs --update rewrite the reports (pnpm api:report)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractor, ExtractorConfig } from '@microsoft/api-extractor';

const root = fileURLToPath(new URL('..', import.meta.url));
const update = process.argv.includes('--update');

/** Warnings that go into the report, so a change to them shows up in review, instead of failing the run. */
const IN_REPORT = { logLevel: 'none', addToApiReportFile: true };
/**
 * Not reported: release tags (`@public`, `@internal`) are not used, since what is public is what an entry
 * exports, and missing member docs would add a line to most members (top-level docs are checked by a test).
 */
const IGNORED = { logLevel: 'none', addToApiReportFile: false };

/**
 * Types a public signature may use although its entry does not export them, by entry, with the reason.
 * Any other `ae-forgotten-export` warning fails the run: export the type, or keep it out of the
 * signature. A listed type that no longer needs listing fails it too, so the list stays current.
 */
const WIRING = 'what the chart hands the objects it creates, or a plugin to the chart; apps never build these';
const RENDERER = 'renderer and series internals reached through draw hooks and protected members';
const INTERNAL_MEMBER = 'used only by members tagged @internal';
const MAIN_ENTRY = 'a main entry type, imported from @charton/core';
const PART = 'what a shell part hands the shell or toolbar; apps pass the part without calling it';
const UI_MAIN_ENTRY = 'a main entry type, imported from @charton/ui';
const UNEXPORTED = {
  '@charton/core': {
    ...Object.fromEntries(
      [
        'AnnotationHost', 'AnnotationLayer', 'AnnotationLayerHost', 'ChartInternals', 'DrawingHost', 'Emit', 'HandleOwner', 'IndicatorHost',
        'IndicatorOwner', 'LineOwner', 'OptInFeatures', 'PulseClock', 'ReferenceHost', 'ReplayHost', 'SelectionFeature', 'SeriesHost', 'SeriesHost_2', 'SeriesLevels', 'UndoSteps', 'ZoneOwner',
      ].map((name) => [name, WIRING]),
    ),
    ...Object.fromEntries(
      ['Buckets', 'DrawView', 'FrontChange', 'GpuOwner', 'HeatmapGrid', 'IndicatorRunner', 'RangeBuilder', 'RectBatch', 'ReferenceLabel', 'RenderBackend'].map(
        (name) => [name, RENDERER],
      ),
    ),
    IndicatorEdits: INTERNAL_MEMBER,
    LiveIndicator: INTERNAL_MEMBER,
    PriceWindow: INTERNAL_MEMBER,
  },
  '@charton/core/testing': Object.fromEntries(['Bar', 'Chart', 'DataSource', 'Interval', 'Time'].map((name) => [name, MAIN_ENTRY])),
  '@charton/ui': { FavoritesController: PART, ToolbarCustomization: PART },
  '@charton/ui/templates': { DrawingSettingsOptions: UI_MAIN_ENTRY, IndicatorInitialState: UI_MAIN_ENTRY, IndicatorSettingsOptions: UI_MAIN_ENTRY },
  // No stability promise; its signatures use main entry types and engine classes.
  '@charton/core/internal': '*',
};

/** The types `report` says its entry should export but `UNEXPORTED` does not list, and listed types it no longer reports. */
function unexplainedExports(name, report) {
  const allowed = UNEXPORTED[name] ?? {};
  if (allowed === '*') return [];
  const found = new Set([...report.matchAll(/\(ae-forgotten-export\) The symbol "(\w+)"/g)].map((match) => match[1]));
  return [
    ...[...found].filter((symbol) => !(symbol in allowed)).map((symbol) => `${symbol} is used by a public signature but not exported`),
    ...Object.keys(allowed).filter((symbol) => !found.has(symbol)).map((symbol) => `${symbol} no longer needs its entry in UNEXPORTED`),
  ];
}

const entries = readdirSync(join(root, 'packages'), { withFileTypes: true }).flatMap((dir) => {
  const packageFolder = join(root, 'packages', dir.name);
  const manifest = join(packageFolder, 'package.json');
  if (!dir.isDirectory() || !existsSync(manifest)) return [];
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  if (pkg.private) return [];
  return Object.entries(pkg.exports ?? {})
    .filter(([subpath, target]) => typeof target === 'object' && target.types?.endsWith('.d.ts') && !subpath.endsWith('.css'))
    .map(([subpath, target]) => ({
      name: subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`,
      packageFolder,
      packageJsonFullPath: manifest,
      mainEntryPointFilePath: join(packageFolder, target.types),
      reportFileName: subpath === '.' ? dir.name : `${dir.name}-${subpath.slice(2).replaceAll('/', '-')}`,
    }));
});

let failed = 0;
for (const entry of entries) {
  if (!existsSync(entry.mainEntryPointFilePath)) {
    console.error(`${entry.name}: ${entry.mainEntryPointFilePath} is missing, run pnpm build first`);
    failed++;
    continue;
  }
  const config = ExtractorConfig.prepare({
    configObject: {
      projectFolder: entry.packageFolder,
      mainEntryPointFilePath: entry.mainEntryPointFilePath,
      // Read the declarations as published: no source path mapping from the repository's tsconfig.
      compiler: {
        overrideTsconfig: {
          compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM', 'DOM.Iterable'], strict: true, skipLibCheck: true },
          files: [entry.mainEntryPointFilePath],
        },
      },
      apiReport: {
        enabled: true,
        reportFileName: entry.reportFileName,
        reportFolder: join(root, 'etc'),
        reportTempFolder: join(root, 'node_modules/.cache/api-report'),
      },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      newlineKind: 'lf',
      messages: {
        compilerMessageReporting: { default: { logLevel: 'warning' } },
        extractorMessageReporting: { default: IN_REPORT, 'ae-missing-release-tag': IGNORED, 'ae-undocumented': IGNORED },
        tsdocMessageReporting: { default: IN_REPORT },
      },
    },
    configObjectFullPath: undefined,
    packageJsonFullPath: entry.packageJsonFullPath,
  });
  const result = Extractor.invoke(config, {
    localBuild: update,
    // Drop the per-entry notices (such as the compiler version); warnings and errors still print.
    messageCallback: (message) => {
      if (message.logLevel === 'info') message.handled = true;
    },
  });
  if (!result.succeeded) {
    failed++;
    if (result.apiReportChanged) console.error(`${entry.name}: etc/${entry.reportFileName}.api.md is out of date, run pnpm api:report`);
    continue;
  }
  const problems = unexplainedExports(entry.name, readFileSync(join(root, 'etc', `${entry.reportFileName}.api.md`), 'utf8'));
  for (const problem of problems) console.error(`${entry.name}: ${problem}`);
  if (problems.length > 0) failed++;
}

if (failed > 0) process.exit(1);
console.log(`${entries.length} API reports ${update ? 'written' : 'up to date'}`);
