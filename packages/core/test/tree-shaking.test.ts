/// <reference types="vite/client" />
import { build, type Rollup } from 'vite';
import { describe, expect, it } from 'vitest';

// Bundles a small app the way a consumer's bundler would, and checks which parts of the engine
// end up in it. Modules of a package are only dropped when its manifest says so, so this reads
// `sideEffects` from the manifest instead of assuming it.

/** A directory next to this file as a bundler module path (`C:/...` on Windows, not `/C:/...`). */
const dirPath = (relative: string) => decodeURIComponent(new URL(relative, import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '');
const repoRoot = dirPath('../../../');
const coreSrc = dirPath('../src/');

type Manifest = { name: string; sideEffects?: unknown };
const manifests = Object.values(
  import.meta.glob<string>('../../*/package.json', { query: '?raw', import: 'default', eager: true }),
).map((raw) => JSON.parse(raw) as Manifest);
const manifest = (pkg: string): Manifest => manifests.find((m) => m.name === `@chart-on/${pkg}`)!;

const ENTRY = '\0tree-shaking-entry';

const SINGLE = '\0tree-shaking-single-module-core';

/**
 * With `built`, the app imports that code (core bundled into one module) instead of the sources,
 * so only statement-level tree shaking can drop parts of it.
 */
async function bundle(imports: string[], built?: string): Promise<string> {
  const sideEffects = manifest('core').sideEffects;
  return codeOf(
    await build({
      root: repoRoot,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: built ? {} : { '@chart-on/core': `${coreSrc}index.ts` } },
      plugins: [
        {
          name: 'tree-shaking-entry',
          enforce: 'pre',
          resolveId: (id) => (id === 'tree-shaking-entry' ? ENTRY : built && id === '@chart-on/core' ? SINGLE : null),
          load: (id) =>
            id === ENTRY
              ? `import { ${imports.join(', ')} } from '@chart-on/core';\nconsole.log(${imports.join(', ')});\n`
              : id === SINGLE
                ? built
                : null,
        },
      ],
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          input: 'tree-shaking-entry',
          treeshake: {
            moduleSideEffects: (id: string) =>
              !((id === SINGLE || id.replaceAll('\\', '/').startsWith(coreSrc)) && sideEffects === false),
          },
        },
      },
    }),
  );
}

/** Core's public entry bundled into one module, so statement-level purity is checked on its own. */
async function singleModuleCore(): Promise<string> {
  return codeOf(
    await build({
      root: repoRoot,
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        lib: { entry: `${coreSrc}index.ts`, formats: ['es'] },
      },
    }),
  );
}

function codeOf(output: Awaited<ReturnType<typeof build>>): string {
  const results = (Array.isArray(output) ? output : [output]) as Rollup.RollupOutput[];
  return results
    .flatMap((r) => r.output)
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
    .join('\n');
}

const BUILT = '\0built-core/';

/** The core as published, built in memory with its own config: file name to code. */
async function builtCore(): Promise<Map<string, string>> {
  const output = await build({
    root: dirPath('../'),
    configFile: dirPath('../vite.config.ts'),
    logLevel: 'silent',
    build: { write: false, sourcemap: false },
  });
  const results = (Array.isArray(output) ? output : [output]) as Rollup.RollupOutput[];
  return new Map(results.flatMap((r) => r.output).flatMap((c) => (c.type === 'chunk' ? [[c.fileName, c.code] as const] : [])));
}

/**
 * Source modules of the built core that an app importing `imports` keeps, as file names. The built
 * files are minified, so this reads what the bundler kept of each file instead of matching names.
 */
async function keptFromBuilt(files: Map<string, string>, imports: string[]): Promise<string[]> {
  const sideEffects = manifest('core').sideEffects;
  const output = await build({
    root: repoRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'built-core',
        enforce: 'pre',
        resolveId(id, importer) {
          if (id === 'tree-shaking-entry') return ENTRY;
          if (id === '@chart-on/core') return `${BUILT}index.js`;
          if (!importer?.startsWith(BUILT) || !id.startsWith('.')) return null;
          return BUILT + new URL(id, `file:///${importer.slice(BUILT.length)}`).pathname.slice(1);
        },
        load(id) {
          if (id === ENTRY) return `import { ${imports.join(', ')} } from '@chart-on/core';\nconsole.log(${imports.join(', ')});\n`;
          return id.startsWith(BUILT) ? files.get(id.slice(BUILT.length)) : null;
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: 'tree-shaking-entry',
        treeshake: { moduleSideEffects: (id: string) => !(id.startsWith(BUILT) && sideEffects === false) },
      },
    },
  });
  const results = (Array.isArray(output) ? output : [output]) as Rollup.RollupOutput[];
  return results
    .flatMap((r) => r.output)
    .flatMap((chunk) => (chunk.type === 'chunk' ? Object.entries(chunk.modules) : []))
    .filter(([id, module]) => id.startsWith(BUILT) && module.renderedLength > 0)
    .map(([id]) => id.slice(BUILT.length));
}

/** Top-level declarations a bundle contains, matched by name (comments do not count). */
function declared(code: string, names: string[]): string[] {
  return names.filter((name) => new RegExp(`\\b(?:var|let|const|class|function)\\s+${name}\\b`).test(code));
}

const VOLUME_PROFILE = ['VolumeProfileSeries', 'computeVolumeProfile'];
const HEATMAP = ['HeatmapSeries', 'HeatmapInspector'];
const HEATMAP_GPU = ['HEATMAP_FS', 'heatmapProgram'];
const POINTS = ['PointSeries'];
const VIEWPORT_BOUNDS = ['viewportBoundsFeature', 'checkViewportBounds'];
const DEPTH_LANE = ['createDepthLane', 'layoutDepthRows', 'measureLanes', 'drawLanes', 'paneLanes'];
const STATS_OVERLAY = ['StatsOverlay', 'GpuTimer', 'FrameStats', 'FrameClock', 'reasonsOf', 'zeroCounters'];
const DATA_SOURCE = ['DataController', 'connectSource', 'makeSnapshot', 'readSnapshot'];
const SOURCE_MARKERS = ['MarkersLoader', 'toBarMarker', 'readMarker'];
const ADJUSTMENTS = ['adjustBars', 'adjustBar', 'sameAdjustmentsAfter', 'priceFactor', 'adjustmentMarkers'];
const WATERMARK = ['createWatermark', 'symbolWatermarkLines', 'drawWatermark'];
const LAYOUTS = ['serializeLayout', 'loadLayout', 'migrateLayout', 'loadPanes', 'loadScales', 'parseIndicatorStates'];
const REFERENCE_LINES = ['ReferenceLines', 'defaultReferenceLinesOptions'];
const PRICE_STYLES = ['PriceStyles', 'kagiLines'];
/** The bucketing and coarser levels of bar grouping; the series' grouped draw paths stay. */
const GROUPING = ['Grouping', 'CalendarBucketing', 'CalendarBuckets', 'PowerBuckets', 'Pyramid', 'GroupedLine'];
const PULSE = ['PulseClock', 'resolvePulse'];
/** The `Intl` localizer; the built-in English one (`englishLocalizer`) stays. */
const LOCALIZATION = ['createLocalizer', 'numberSymbols', 'localeHourCycle'];
const UNDO = ['UndoSteps'];
/** The selection and its edit commands, which the drawings and indicators plugins bring. */
const SELECTION = ['createSelection'];
const COUNTDOWN = ['barCountdown', 'formatCountdown'];
const CAPTURE = ['compositeImage', 'drawLegend'];
const MARKET = ['marketStatusFeature', 'marketPhase'];
const SHARED = ['SharedContext'];
const DRAWING_TOOLS = ['builtinTools', 'fibRetracement', 'gannBox', 'gannFan', 'longPosition', 'parallelChannel', 'patternTools', 'anchoredNote', 'anchoredText'];
/** Drawing tools outside the built-in set, which even `builtins()` leaves out. */
const ADD_ON_TOOLS = ['emojiTool', 'iconTool', 'createStickerTool', 'glyphTool', 'pictureTool', 'createImageTool', 'shrinkImage'];
/** Level tables and tool factories of the built-in drawing tools. */
const TOOL_INTERNALS = [
  'copyLevels',
  'RETRACEMENT_LEVELS',
  'EXTENSION_LEVELS',
  'CHANNEL_LEVELS',
  'TIME_ZONE_LEVELS',
  'ARC_LEVELS',
  'positionTool',
  'glyphArrow',
  'pitchforkTool',
  'patternTools',
];
const DRAWINGS = ['DrawingManager', 'DrawingClipboard', 'placeDrawings'];
const ANNOTATIONS = ['AnnotationManager', 'ZoneLayer', 'MarkerPool', 'PriceLine', 'TimeBand'];
const TRADING = ['TradeFills', 'TradeLayer', 'TradingLines', 'TradeLine', 'AlertLine', 'DraftLine'];
const INDICATORS = ['IndicatorManager', 'Indicator', 'IndicatorRunner', 'IndicatorSeries', 'BarColumns', 'ExternalFeed', 'IntervalFeed'];
const COMPARISONS = ['createComparisons', 'ComparedLoader', 'PairFeed'];
const CHART = ['Chart', 'createChart', 'GLRenderer'];
const ORDER_FLOW = ['footprintSeries', 'tpoSeries'];
const NUMERIC = ['NumericChart', 'NumericScale', 'depthCurve'];
const REPLAY = ['Replay'];
const PICK_BAR = ['pickBar', 'cancelPickBar'];
/** Add-ons that ship as exports of their own (`createSonifier`, `createSeasonality`), outside the agreed core scope. */
const ADD_ONS = ['ChartSonifier', 'createSonifier', 'SeasonalityView', 'createSeasonality', 'computeSeasonality'];
/** What the drawings, annotations, indicators and heatmap plugins wire into the chart: the managers' hosts, axis marks, the indicator clipboard, the hover grid. */
const GLUE = ['drawingHost', 'drawingsGlue', 'annotationHost', 'indicatorClipboard', 'inspectHeatmap'];

describe('tree shaking', () => {
  it('declares sideEffects in every published manifest', () => {
    // Without the field, bundlers must keep every module of the package that is imported anywhere.
    expect(manifest('core').sideEffects).toBe(false);
    expect(manifest('ta').sideEffects).toBe(false);
    expect(manifest('indicators').sideEffects).toBe(false);
    expect(manifest('ui').sideEffects).toEqual(['*.css']);
  });

  // Without `sideEffects: false` this keeps `GLRenderer`: the bundler must assume its module does
  // something when loaded.
  it('leaves the chart, renderer, series and drawing tools out of a data-source-only bundle', async () => {
    const code = await bundle(['createRestDataSource']);
    expect(declared(code, ['createRestDataSource'])).toEqual(['createRestDataSource']);
    expect(declared(code, [...CHART, ...VOLUME_PROFILE, ...HEATMAP, ...DRAWING_TOOLS])).toEqual([]);
    expect(declared(code, ['createDataSourceRouter'])).toEqual([]);
  }, 60_000);

  it('keeps the data source router free of chart code', async () => {
    const code = await bundle(['createDataSourceRouter']);
    expect(declared(code, ['createDataSourceRouter'])).toEqual(['createDataSourceRouter']);
    expect(declared(code, [...CHART, ...VOLUME_PROFILE, ...HEATMAP, ...DRAWING_TOOLS])).toEqual([]);
  }, 60_000);

  // Data sources, indicators, compared symbols, annotations, heatmaps, volume profiles, depth lanes, drawings and the built-in
  // drawing tools are opt-in (`builtins()` plugins), so a chart bundle that never registers them
  // leaves them out, the indicator manager and series, the compare loaders, the heatmap shaders,
  // the drawing manager, the annotation layers and the chart glue of each included.
  it('leaves data source, indicator, compare, annotation, drawing, volume-profile, heatmap, point series, viewport bounds, depth lane, stats overlay, source marks, adjustments, watermark, layout, reference line, kagi and point & figure, grouping, last-point pulse, localization, undo history, selection, countdown, image capture, market status, shared context, bar picking, footprint, TPO and numeric chart code out of a createChart bundle', async () => {
    const code = await bundle(['createChart', 'createRestDataSource']);
    expect(declared(code, ['createChart', 'createRestDataSource'])).toHaveLength(2);
    expect(
      declared(code, [
        ...DATA_SOURCE,
        ...INDICATORS,
        ...COMPARISONS,
        ...VOLUME_PROFILE,
        ...HEATMAP,
        ...HEATMAP_GPU,
        ...POINTS,
        ...VIEWPORT_BOUNDS,
        ...DEPTH_LANE,
        ...STATS_OVERLAY,
        ...SOURCE_MARKERS,
        ...ADJUSTMENTS,
        ...WATERMARK,
        ...LAYOUTS,
        ...REFERENCE_LINES,
        ...PRICE_STYLES,
        ...GROUPING,
        ...PULSE,
        ...LOCALIZATION,
        ...UNDO,
        ...SELECTION,
        ...COUNTDOWN,
        ...CAPTURE,
        ...MARKET,
        ...SHARED,
        ...DRAWING_TOOLS,
        ...ADD_ON_TOOLS,
        ...DRAWINGS,
        ...ANNOTATIONS,
        ...TRADING,
        ...ORDER_FLOW,
        ...NUMERIC,
        ...GLUE,
        ...REPLAY,
        ...PICK_BAR,
        ...ADD_ONS,
      ]),
    ).toEqual([]);
    // The flat option aliases are gone; only the nested `crosshair` and `timeAxis` fields merge.
    expect(code).not.toMatch(/crosshairMode|crosshairPriceLabel|crosshairTimeLabel|timeAxisHeight/);
    // Opt-in parts come through one hook, not a method each on the chart.
    expect(new Set(code.match(/\bprovide[A-Z]\w*/g))).toEqual(new Set(['provideFeature', 'provideSeriesSettings']));
  }, 60_000);

  it('keeps the sonifier and seasonality once the app imports them', async () => {
    const code = await bundle(['createChart', 'createSonifier', 'createSeasonality']);
    expect(declared(code, ADD_ONS)).toEqual(ADD_ONS);
  }, 60_000);

  // In one module, `sideEffects: false` cannot drop the tool modules: any top-level call, spread or
  // computed value in them stays, with what it uses. Apps that bundle the core into one file see this.
  it('leaves the drawing tools out of a createChart bundle of the core as a single module', async () => {
    const code = await bundle(['createChart', 'createRestDataSource'], await singleModuleCore());
    expect(declared(code, ['createChart'])).toEqual(['createChart']);
    expect(declared(code, [...DRAWING_TOOLS, ...ADD_ON_TOOLS, ...TOOL_INTERNALS])).toEqual([]);
  }, 60_000);

  it('keeps them once the app registers them', async () => {
    const all = [...DATA_SOURCE, ...INDICATORS, ...COMPARISONS, ...VOLUME_PROFILE, ...HEATMAP, ...HEATMAP_GPU, ...POINTS, ...VIEWPORT_BOUNDS, ...DEPTH_LANE, ...STATS_OVERLAY, ...SOURCE_MARKERS, ...ADJUSTMENTS, ...WATERMARK, ...LAYOUTS, ...REFERENCE_LINES, ...PRICE_STYLES, ...GROUPING, ...PULSE, ...LOCALIZATION, ...UNDO, ...SELECTION, ...COUNTDOWN, ...CAPTURE, ...MARKET, ...SHARED, ...DRAWING_TOOLS, ...DRAWINGS, ...ANNOTATIONS, ...TRADING, ...GLUE];
    const code = await bundle(['createChart', 'builtins']);
    expect(declared(code, all)).toEqual(all);
    expect(declared(code, ADD_ON_TOOLS)).toEqual([]);
  }, 60_000);

  // `drawings()` brings the manager without the built-in tools; `annotations()`, `trading()`,
  // `indicators()` and `comparisons()` only their own part.
  it('keeps only what each plugin brings', async () => {
    const drawings = await bundle(['createChart', 'drawings']);
    expect(declared(drawings, [...DRAWINGS, ...DRAWING_TOOLS, ...ANNOTATIONS])).toEqual(DRAWINGS);
    const annotations = await bundle(['createChart', 'annotations']);
    expect(declared(annotations, [...DRAWINGS, ...DRAWING_TOOLS, ...ANNOTATIONS, ...TRADING])).toEqual(ANNOTATIONS);
    const trading = await bundle(['createChart', 'annotations', 'trading']);
    expect(declared(trading, [...DRAWINGS, ...ANNOTATIONS, ...TRADING])).toEqual([...ANNOTATIONS, ...TRADING]);
    const indicators = await bundle(['createChart', 'indicators']);
    expect(declared(indicators, [...INDICATORS, ...COMPARISONS, ...DRAWINGS, ...ANNOTATIONS])).toEqual(INDICATORS);
    const comparisons = await bundle(['createChart', 'comparisons']);
    expect(declared(comparisons, [...INDICATORS, ...COMPARISONS, ...DRAWINGS, ...ANNOTATIONS])).toEqual(COMPARISONS);
    const points = await bundle(['createChart', 'points']);
    expect(declared(points, [...POINTS, ...HEATMAP, ...VOLUME_PROFILE])).toEqual(POINTS);
    const bounds = await bundle(['createChart', 'viewportBounds']);
    expect(declared(bounds, [...VIEWPORT_BOUNDS, ...POINTS])).toEqual(VIEWPORT_BOUNDS);
    const replay = await bundle(['createChart', 'replay']);
    expect(declared(replay, [...REPLAY, ...INDICATORS, ...DRAWINGS, ...ANNOTATIONS])).toEqual(REPLAY);
    const stats = await bundle(['createChart', 'statsOverlay']);
    expect(declared(stats, [...STATS_OVERLAY, ...DRAWINGS, ...ANNOTATIONS])).toEqual(STATS_OVERLAY);
    const data = await bundle(['createChart', 'dataSource']);
    expect(declared(data, [...DATA_SOURCE, ...SOURCE_MARKERS, ...ADJUSTMENTS])).toEqual(DATA_SOURCE);
    const marks = await bundle(['createChart', 'sourceMarkers']);
    expect(declared(marks, [...SOURCE_MARKERS, ...STATS_OVERLAY, ...ANNOTATIONS])).toEqual(SOURCE_MARKERS);
    const adjust = await bundle(['createChart', 'adjustments']);
    expect(declared(adjust, [...ADJUSTMENTS, ...SOURCE_MARKERS, ...ANNOTATIONS])).toEqual(ADJUSTMENTS);
    const mark = await bundle(['createChart', 'watermark']);
    expect(declared(mark, [...WATERMARK, ...ADJUSTMENTS, ...ANNOTATIONS])).toEqual(WATERMARK);
    const layouts = await bundle(['createChart', 'layouts']);
    expect(declared(layouts, [...LAYOUTS, ...INDICATORS, ...DRAWINGS, ...WATERMARK])).toEqual(LAYOUTS);
    const lines = await bundle(['createChart', 'referenceLines']);
    expect(declared(lines, [...REFERENCE_LINES, ...WATERMARK, ...ANNOTATIONS])).toEqual(REFERENCE_LINES);
    const styles = await bundle(['createChart', 'priceStyles']);
    expect(declared(styles, [...PRICE_STYLES, ...WATERMARK, ...HEATMAP])).toEqual(PRICE_STYLES);
    const grouped = await bundle(['createChart', 'grouping']);
    expect(declared(grouped, [...GROUPING, ...INDICATORS, ...WATERMARK])).toEqual(GROUPING);
    // Indicator series group through the chart too, so indicators alone leave the levels out.
    expect(declared(indicators, GROUPING)).toEqual([]);
    const pulse = await bundle(['createChart', 'lastPointPulse']);
    expect(declared(pulse, [...PULSE, ...GROUPING, ...WATERMARK])).toEqual(PULSE);
    const localized = await bundle(['createChart', 'localization']);
    expect(declared(localized, [...LOCALIZATION, ...GROUPING, ...WATERMARK])).toEqual(LOCALIZATION);
    const counted = await bundle(['createChart', 'countdown']);
    expect(declared(counted, [...COUNTDOWN, ...LOCALIZATION, ...WATERMARK])).toEqual(COUNTDOWN);
    const captured = await bundle(['createChart', 'imageCapture']);
    expect(declared(captured, [...CAPTURE, ...COUNTDOWN, ...WATERMARK])).toEqual(CAPTURE);
    const market = await bundle(['createChart', 'marketStatus']);
    expect(declared(market, [...MARKET, ...CAPTURE, ...WATERMARK])).toEqual(MARKET);
    const shared = await bundle(['createChart', 'sharedContext']);
    expect(declared(shared, [...SHARED, ...MARKET, ...CAPTURE])).toEqual(SHARED);
    // Only drawings and indicators make undo steps, so they bring the steps' class.
    expect(declared(drawings, UNDO)).toEqual(UNDO);
    expect(declared(indicators, UNDO)).toEqual(UNDO);
    expect(declared(comparisons, UNDO)).toEqual([]);
  }, 60_000);

  // The published core is one file per source module, so an app's bundler drops whole modules it
  // does not use instead of judging each top-level statement of one large shared file.
  it('leaves the drawing, annotation and indicator managers and the data controller out of a createChart bundle built from the published files', async () => {
    const files = await builtCore();
    expect(files.has('drawing/manager.js')).toBe(true);
    const kept = await keptFromBuilt(files, ['createChart', 'createRestDataSource']);
    expect(kept).toContain('chart.js');
    const managers = ['drawing/manager.js', 'annotations/manager.js', 'indicators/manager.js', 'data/controller.js'];
    expect(kept.filter((file) => managers.includes(file))).toEqual([]);
  }, 60_000);
});
