import { describe, expect, it } from 'vitest';
import * as core from '../src/index';
import * as internal from '../src/internal';

/**
 * Every runtime export of the package entry. A change here is a change to the
 * public API: update the list on purpose, and note it under "API notes" in the PR.
 */
const EXPORTS = [
    'ALWAYS_OPEN', 'ActionRegistry', 'AlertLine', 'AnnotationManager', 'CHART_ERROR_CODES', 'CORE_VERSION', 'CandleSeries',
    'Chart', 'ChartError', 'CustomSeries', 'DEFAULT_AUTOSAVE_REASONS', 'DEFAULT_BASE_LEVEL', 'DEFAULT_SESSION_LANES', 'DEFAULT_TRADE_SOURCE', 'DEV_WARNING_CODES',
    'DRAWINGS_VERSION', 'DataController', 'DraftLine', 'DrawingManager', 'ERRORS_DOCS_URL', 'FIB_EXTENSION_LEVELS',
    'FIB_LEVELS', 'HeatmapSeries', 'HistogramSeries', 'INDICATOR_SET_VERSION', 'Indicator','IndicatorManager', 'LAYOUT_VERSION',
    'LOCAL_TIMEZONE', 'LineSeries', 'MAX_INDICATOR_SET_ENTRIES', 'MAX_PROFILE_ROWS', 'NumericChart', 'NumericHistogramSeries', 'NumericLineSeries', 'NumericScale', 'PointSeries', 'PriceBarBuilder', 'PriceLine', 'PriceScale', 'PriceZone', 'ReferenceLines', 'SETTINGS_VERSION_KEY', 'Series',
    'TextLabel', 'TickWeight', 'TimeBand', 'TimeScale', 'TradeLine', 'UTC', 'VolumeProfile', 'VolumeProfileSeries', 'Zone',
    'adjustBar', 'adjustBars', 'adjustments', 'aggregateTrades', 'alignSteps', 'annotations', 'applyChartSettings', 'autoPrecision', 'autosave', 'barBucket',
    'buildLut', 'builtInColorPresets', 'builtinSketchRecognizers', 'builtinTools', 'builtins', 'calendarMonths', 'cancelPickBar', 'changeText', 'chartSettingsSchema', 'chartThemeTokens', 'chartTypographyTokens',
    'checkOptions', 'colorSafeUpDown', 'comparisons', 'compileSession', 'computeSeasonality', 'computeTpoProfile', 'computeTpoProfiles', 'computeVolumeProfile', 'contrastRatio', 'contrastText', 'countdown', 'createBarBuilder', 'createChart',
    'createDataSourceRouter', 'createDepthLane', 'createFootprintBuilder', 'createImageTool', 'createIndexedDbCache', 'createLinkGroup', 'createLocalStorageAdapter', 'createLocalizer', 'createMemoryCache', 'createMockDataSource', 'createNumericChart',
    'createOhlcvDataSource', 'createPollingDataSource', 'createPriceFormat', 'createRestDataSource', 'createSeasonality', 'createSessionBands', 'createSettingsStore', 'createSonifier',
    'createStaticDataSource', 'createStickerTool', 'createWatermark',
    'createWebSocketDataSource', 'crisp', 'crispLine', 'crossDirection', 'darkTheme', 'dataSource', 'dedupeByTime',
    'defaultAccessOptions', 'defaultAccessibilityOptions', 'defaultAnnotationOptions', 'defaultChartFeatures', 'defaultChartOptions', 'defaultDataControllerOptions', 'defaultDepthLaneOptions',
    'defaultLegendSettings', 'defaultLinkGroupOptions', 'defaultMessages', 'defaultNumericChartOptions', 'defaultReferenceLinesOptions', 'defaultSeasonalOptions', 'defaultSessionBandsOptions', 'defaultSonifierOptions', 'defaultTradeMarkerOptions', 'defaultWatermarkOptions',
    'depthCurve', 'depthLane', 'distToSegment', 'drawingFont', 'drawingTools', 'drawingWeight', 'drawings', 'easeOutCubic', 'either', 'emojiTool', 'englishLocalizer', 'fibExtensionLevels', 'fibLevels',
    'fillBetween', 'fillNumerals', 'fillOf', 'fontCss', 'footprintFromRows', 'footprintImbalances', 'footprintSeries', 'forcedColorsTheme', 'formatCompact', 'formatCountdown', 'formatDuration', 'formingSteps', 'getContextBudget', 'grouping', 'heatmap', 'heikinAshi', 'heikinAshiBar', 'highContrastDarkTheme', 'highContrastLightTheme', 'higherIntervalBars', 'iconTool', 'imageCapture', 'inSession', 'indicatorSetFits', 'indicators', 'inputFields',
    'int', 'intervalSeconds', 'intervalStart', 'isActivityInterval', 'isCalendarInterval', 'isColor', 'isInterval', 'isThemeColorKey', 'isValidBar',
    'isWebGL2Supported', 'labelPill', 'labelledPolyline', 'lastPointPulse', 'layoutDepthRows', 'layoutEntry', 'layoutWatermark', 'layouts', 'legendEntryFor',
    'levelColor', 'levelLines', 'lightTheme', 'list', 'loadLastLayout', 'localTimeZone', 'localization', 'logPriceTicks', 'marketPhase', 'marketStatus', 'matchRank', 'matchScore', 'matchTiers', 'measureNumerals',
    'mergeGrid', 'mergeTypography', 'migrateDrawings', 'migrateLayout', 'mixColors', 'nearestInterval', 'neutralTheme', 'nextIntervalStart', 'niceStep',
    'normalizeBars', 'normalizeShortcut',
    'normalizedRect', 'num', 'oneOf', 'optionIssues', 'parallelOffset', 'parseColor', 'parseCsv', 'parseInterval',
    'parseSerialized', 'perSymbolDrawings', 'pickBar', 'pitchforkMedian', 'pluralText', 'pointInRect', 'pointOfControl', 'points', 'positionStats', 'presetTheme', 'priceBars', 'priceChange', 'priceRow',
    'priceStyles', 'priceTicks', 'rayEnd', 'readChartSetting', 'recognizeSketch', 'referenceLines', 'regressionChannel', 'replay', 'resampleBars', 'resolveFont', 'resolveGrid', 'resolveInputs',
    'resolveLegendSettings', 'resolveLevelColor', 'resolvePlotStyle', 'resolveTheme', 'resolveThemeColor', 'searchIndicators', 'seasonalPosition', 'seasonalSlots', 'sessionLaneIntervals', 'sessionLaneState',
    'setContextBudget', 'shape', 'sharedContext', 'simplifyPolyline', 'sliceBars', 'sourceAt', 'sourceMarkers', 'sourceOf', 'statsOverlay', 'storageKeyPart',
    'strokeLine', 'symbolPriceFormat', 'symbolWatermarkLines', 'themeFromCss', 'timezoneChoices', 'toCSV', 'tpoColumns', 'tpoLetter', 'tpoSeries', 'tradesToBars', 'trading', 'tradingDay', 'utcDaySession', 'utcOffsetText',
    'valueArea', 'valueToPitch', 'viewportBounds', 'volumeOf', 'volumeProfile', 'watermark', 'withAlpha', 'zoneOf',
];

describe('package entry', () => {
  it('exports exactly the public API', () => {
    expect(Object.keys(core).sort()).toEqual(EXPORTS);
  });

  it('exports nothing undefined', () => {
    for (const name of EXPORTS) expect(core[name as keyof typeof core], name).toBeDefined();
  });
});

/** Runtime exports of `@chart-on/core/internal`: engine internals with no stability promise. */
const INTERNAL = [
  'COLLAPSED_PANE_HEIGHT', 'Pane', 'Timeline', 'binVolume', 'drawBaseline', 'drawPolyline', 'layoutPanes', 'profileLayout',
  'resolveBaseLevel', 'seededRandom',
];

describe('internal entry', () => {
  it('exports the internals and nothing the main entry has', () => {
    expect(Object.keys(internal).sort()).toEqual(INTERNAL);
    for (const name of INTERNAL) expect(core, name).not.toHaveProperty(name);
  });
});
