/**
 * What each option object accepts, for development-build warnings
 * (`checkOptions`). Every `OptionShape` names all fields of its interface, so
 * adding an option without a rule here fails to compile. The rules are built
 * on first use, and only `devCheck` uses them behind a `NODE_ENV` test that
 * bundlers fold, so production bundles drop them.
 */
import type { ChartOptions, CrosshairLineOptions, CrosshairOptions, GridLineOptions, GroupingOptions, ZoomAnchor, ZoomAnchorOptions } from './chart';
import type { ChartFeatures } from './features';
import type { AccessOptions } from './access';
import type { LegendOptions } from './legend';
import type { PaneOptions } from './pane';
import type { CrosshairMode } from './pointer';
import type { PointSeriesOptions, PointShape, PointSizeBy } from './points';
import type { VolumeProfileOptions } from './profile/series';
import type { ExtendedHoursLineOptions, ReferenceLineKind, ReferenceLineOptions } from './reference-lines';
import type {
  CandleSeriesOptions,
  CandleStyle,
  CustomSeriesBaseOptions,
  HeatmapSeriesOptions,
  HistogramSeriesOptions,
  LegendMode,
  LineSeriesOptions,
  OverlayMargins,
  PriceLineSeriesOptions,
  SeriesPriceLineOptions,
} from './series';
import { chartThemeTokens, isThemeColorKey, type ChartTheme } from './theme';
import type { ChartTypography, FontSettings, NumeralStyle } from './typography';
import type { DrawingLevel, DrawingStyle } from './drawing/types';
import type { LineType } from './line-path';
import type { LastPointPulseMode, LastPointPulseOptions } from './pulse';
import type { AccessibilityOptions } from './a11y';
import type { LocalizationOptions } from './util/locale';
import type { CellReduce } from './gl/heatmap-reduce';
import { checkOptions, either, int, list, num, oneOf, shape, type OptionRule, type OptionShape } from './util/options-check';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

function buildRules() {
  const lineStyle = oneOf<'solid' | 'dashed' | 'dotted'>({ solid: 0, dashed: 0, dotted: 0 });
  const renderer = oneOf<'canvas' | 'gpu'>({ canvas: 0, gpu: 0 });
  const fraction = num(0, 1);
  const positive = num(0);

  const zoomAnchor = oneOf<ZoomAnchor>({ pointer: 0, newest: 0, 'right-edge': 0 });

  const fontSettings: OptionShape<FontSettings> = {
    fontFamily: 'string',
    fontSize: positive,
    fontWeight: either(int(1, 1000), oneOf<'normal' | 'bold'>({ normal: 0, bold: 0 })),
    numerals: oneOf<NumeralStyle>({ tabular: 0, proportional: 0 }),
  };
  const surfaceFont = shape(fontSettings);
  const typographyShape: OptionShape<ChartTypography> = {
    ...fontSettings,
    axis: surfaceFont,
    legend: surfaceFont,
    labels: surfaceFont,
    drawings: surfaceFont,
    watermark: surfaceFont,
    markers: surfaceFont,
  };

  const themeShape: OptionShape<ChartTheme> = {
    background: 'color',
    backgroundBottom: 'color',
    grid: 'color',
    gridHorizontal: 'color',
    gridVertical: 'color',
    separator: 'color',
    text: 'color',
    textMuted: 'color',
    fontFamily: 'string',
    fontSize: positive,
    typography: shape(typographyShape),
    crosshair: 'color',
    labelBackground: 'color',
    labelText: 'color',
    up: 'color',
    down: 'color',
    upWick: 'color',
    downWick: 'color',
    upBorder: 'color',
    downBorder: 'color',
    line: 'color',
    drawing: 'color',
    drawingSelected: 'color',
    drawingFill: 'color',
    referenceLine: 'color',
    bid: 'color',
    ask: 'color',
    depthBid: 'color',
    depthAsk: 'color',
    extendedHours: 'color',
    alert: 'color',
    timeMark: 'color',
    annotationFill: 'color',
    heatmap: list('color'),
    watermark: 'color',
    levelNeutral: 'color',
    levelRed: 'color',
    levelOrange: 'color',
    levelGreen: 'color',
    levelBlue: 'color',
    levelPurple: 'color',
  };

  const gridLine = shape<GridLineOptions>({ visible: 'boolean', color: 'color', lineStyle });

  const crosshairLine = shape<CrosshairLineOptions>({ visible: 'boolean', color: 'color', width: positive, lineStyle });

  const crosshairShape: OptionShape<CrosshairOptions> = {
    mode: oneOf<CrosshairMode>({ free: 0, close: 0, ohlc: 0, hidden: 0 }),
    vertical: crosshairLine,
    horizontal: crosshairLine,
    horizontalInAllPanes: 'boolean',
    labels: shape<CrosshairOptions['labels']>({ price: 'boolean', time: 'boolean' }),
    timeLabelPosition: oneOf<'top' | 'bottom'>({ top: 0, bottom: 0 }),
    cursor: oneOf<CrosshairOptions['cursor']>({ cross: 0, pointer: 0 }),
  };

  const featuresShape: OptionShape<ChartFeatures> = {
    legend: 'boolean',
    legendButtons: 'boolean',
    lastValueLabels: 'boolean',
    contextMenu: 'boolean',
    scroll: 'boolean',
    zoom: 'boolean',
    axisDragScale: 'boolean',
    keyboard: 'boolean',
    touchScroll: 'boolean',
    touchZoom: 'boolean',
    countdown: 'boolean',
    watermark: 'boolean',
    plusButton: 'boolean',
    sketch: 'boolean',
    attributionLogo: 'boolean',
  };

  const legendShape: OptionShape<LegendOptions> = {
    visible: 'boolean',
    position: oneOf<NonNullable<LegendOptions['position']>>({
      'top-start': 0,
      'top-end': 0,
      'bottom-start': 0,
      'bottom-end': 0,
      'top-left': 0,
      'top-right': 0,
      'bottom-left': 0,
      'bottom-right': 0,
    }),
    mode: oneOf<LegendMode>({ full: 0, compact: 0, title: 0 }),
    showChange: 'boolean',
    changeArrows: 'boolean',
    whenIdle: oneOf<'last' | 'hidden'>({ last: 0, hidden: 0 }),
    background: either('boolean', oneOf<'auto'>({ auto: 0 })),
    hiddenSeries: oneOf<'dimmed' | 'omit'>({ dimmed: 0, omit: 0 }),
    formatter: 'function',
  };

  const referenceLine: OptionShape<ReferenceLineOptions> = {
    visible: 'boolean',
    color: 'color',
    lineStyle,
    lineWidth: positive,
    axisLabel: 'boolean',
    title: 'string',
  };

  const referenceLinesShape: OptionShape<Record<ReferenceLineKind, unknown>> = {
    previousClose: shape(referenceLine),
    high: shape(referenceLine),
    low: shape(referenceLine),
    average: shape(referenceLine),
    bid: shape(referenceLine),
    ask: shape(referenceLine),
    extendedHours: shape<ExtendedHoursLineOptions>({ ...referenceLine, postTitle: 'string' }),
  };

  const accessShape: OptionShape<AccessOptions> = {
    allow: 'function',
    limits: shape<AccessOptions['limits']>({ indicators: int(0) }),
    refused: oneOf<AccessOptions['refused']>({ hide: 0, disable: 0 }),
  };

  const chartShape: OptionShape<ChartOptions> = {
    theme: shape(themeShape),
    grid: shape<ChartOptions['grid']>({ horizontal: gridLine, vertical: gridLine }),
    features: shape(featuresShape),
    access: shape(accessShape),
    priceAxisWidth: either(positive, oneOf<'auto'>({ auto: 0 })),
    priceAxis: shape<ChartOptions['priceAxis']>({
      padding: num(0),
      minWidth: positive,
      maxWidth: positive,
      ticks: 'boolean',
      border: 'boolean',
      fontSize: positive,
      labelMode: oneOf<ChartOptions['priceAxis']['labelMode']>({ fill: 0, content: 0 }),
      labelPointer: 'boolean',
      labelPaddingY: num(0),
    }),
    timeAxis: shape<ChartOptions['timeAxis']>({
      visible: 'boolean',
      height: positive,
      ticks: 'boolean',
      border: 'boolean',
      showTime: 'boolean',
      showSeconds: 'boolean',
      fontSize: positive,
    }),
    barSpacing: positive,
    minBarSpacing: positive,
    maxBarSpacing: positive,
    rightOffset: 'number',
    fixLeftEdge: 'boolean',
    fixRightEdge: 'boolean',
    maxRightOffset: 'number',
    minBarCoverage: fraction,
    lockVisibleRangeOnResize: 'boolean',
    followNewBars: oneOf<ChartOptions['followNewBars']>({ always: 0, whenAtEnd: 0, never: 0 }),
    maxGlDpr: num(0.1),
    lowPower: 'boolean',
    focusable: 'boolean',
    interactive: 'boolean',
    gl: oneOf<'own' | 'shared'>({ own: 0, shared: 0 }),
    inertia: 'boolean',
    smoothZoom: 'boolean',
    wheel: oneOf<ChartOptions['wheel']>({ zoom: 0, pan: 0, page: 0 }),
    zoomAnchor: either(zoomAnchor, shape<ZoomAnchorOptions>({ plot: zoomAnchor, timeAxis: zoomAnchor })),
    accessibility: shape<AccessibilityOptions>({
      summary: 'boolean',
      crosshairReadout: 'boolean',
      label: 'string',
      throttleMs: num(0),
      announceBars: 'boolean',
      announceIntervalMs: num(0),
    }),
    keyboard: shape<ChartOptions['keyboard']>({ scope: oneOf<ChartOptions['keyboard']['scope']>({ hover: 0, focus: 0, global: 0 }) }),
    plotDragScale: 'boolean',
    smoothScale: 'boolean',
    animateViewChanges: 'boolean',
    renderWhenHidden: 'boolean',
    scrollButton: 'boolean',
    legend: shape(legendShape),
    paneButtons: 'boolean',
    paneDoubleClickMaximize: 'boolean',
    direction: oneOf<ChartOptions['direction']>({ ltr: 0, rtl: 0, auto: 0 }),
    historyThreshold: num(0),
    timezone: 'string',
    localization: shape<LocalizationOptions>({
      locale: 'string',
      decimalSeparator: 'string',
      grouping: 'boolean',
      hourCycle: oneOf<'h12' | 'h23'>({ h12: 0, h23: 0 }),
      dateFormat: 'object',
      messages: 'object',
      translate: 'function',
    }),
    applySymbolTimezone: 'boolean',
    session: 'object',
    sessionBreaks: 'boolean',
    sessionShading: 'boolean',
    keepRangeOnIntervalChange: 'boolean',
    keepZoomOnSymbolChange: 'boolean',
    adjustment: oneOf<ChartOptions['adjustment']>({ none: 0, splits: 0, all: 0 }),
    adjustmentMarkers: 'boolean',
    marks: 'boolean',
    timeMarks: 'boolean',
    extendedSession: 'object',
    marketStatus: 'boolean',
    touchInspect: oneOf<ChartOptions['touchInspect']>({ release: 0, tap: 0, off: 0 }),
    crosshair: shape(crosshairShape),
    sketch: shape<ChartOptions['sketch']>({ holdMs: positive }),
    formatTime: 'function',
    formatTimeTick: 'function',
    grouping: shape<GroupingOptions>({ mode: oneOf<GroupingOptions['mode']>({ pixel: 0, calendar: 0 }), steps: list('string') }),
    referenceLines: shape(referenceLinesShape),
    renderStats: 'boolean',
    renderStatsOverlay: either('boolean', oneOf<'bounds'>({ bounds: 0 })),
  };

  const chartOptionsRule = shape<ChartOptions & { plugins: unknown }>({ ...chartShape, plugins: 'object' });

  const paneOptionsRule = shape<PaneOptions>({ stretch: positive, marginTop: fraction, marginBottom: fraction });

  const priceLine = shape<SeriesPriceLineOptions>({
    color: 'color',
    lineWidth: positive,
    lineStyle,
    source: oneOf<'last' | 'lastVisible'>({ last: 0, lastVisible: 0 }),
  });

  const priceLineShape: OptionShape<PriceLineSeriesOptions> = {
    priceLine: either('boolean', priceLine),
    offscreenLastPrice: oneOf<'hollow' | 'hidden'>({ hollow: 0, hidden: 0 }),
    autoscale: either('boolean', 'function'),
  };

  /** Fields every value series shares. */
  const seriesShape = {
    ...priceLineShape,
    title: 'string',
    legend: 'boolean',
    lastValueLabel: 'boolean',
    axisTitle: 'boolean',
    priceFormat: 'object',
    overlay: shape<OverlayMargins>({ top: fraction, bottom: fraction }),
    priceScale: 'string',
  } as const satisfies Record<string, OptionRule>;

  const candleStyle = oneOf<CandleStyle>({
    candles: 0,
    hollow: 0,
    volumeCandles: 0,
    bars: 0,
    hlcBars: 0,
    heikinAshi: 0,
    highLow: 0,
    columns: 0,
    line: 0,
    lineMarkers: 0,
    step: 0,
    area: 0,
    rangeBand: 0,
    baseline: 0,
    kagi: 0,
    pointFigure: 0,
  });

  const pulseMode = oneOf<LastPointPulseMode>({ off: 0, 'on-update': 0, continuous: 0 });
  const lastPointPulse = either(
    pulseMode,
    shape<LastPointPulseOptions>({ mode: pulseMode, color: 'color', radius: positive, durationMs: positive }),
  );

  const candleOptionsRule = shape<CandleSeriesOptions>({
    ...seriesShape,
    style: candleStyle,
    upColor: 'color',
    downColor: 'color',
    upWickColor: 'color',
    downWickColor: 'color',
    upBorderColor: 'color',
    downBorderColor: 'color',
    wicks: 'boolean',
    borders: 'boolean',
    colorByPreviousClose: 'boolean',
    hollowDown: 'boolean',
    precision: int(0),
    bodyRatio: fraction,
    thinBars: 'boolean',
    lineWidth: positive,
    lineStyle,
    renderer,
    animate: 'boolean',
    baseLevel: 'object',
    boxSize: positive,
    lastPointPulse,
  });

  const histogramOptionsRule = shape<HistogramSeriesOptions>({
    ...seriesShape,
    follow: 'function',
    color: 'color',
    positiveColor: 'color',
    negativeColor: 'color',
    base: 'number',
    columnRatio: fraction,
    groupBy: oneOf<NonNullable<HistogramSeriesOptions['groupBy']>>({ sum: 0, max: 0, last: 0 }),
    format: 'function',
  });

  const lineOptionsRule = shape<LineSeriesOptions>({
    ...seriesShape,
    follow: 'function',
    color: 'color',
    lineWidth: positive,
    area: 'boolean',
    colorMode: oneOf<'segment' | 'gradient'>({ segment: 0, gradient: 0 }),
    baseline: 'number',
    aboveColor: 'color',
    belowColor: 'color',
    breakGaps: 'boolean',
    lineStyle,
    renderer,
    lineType: oneOf<LineType>({ simple: 0, step: 0, curved: 0 }),
    pointMarkers: either('boolean', shape<{ radius?: number }>({ radius: positive })),
    crosshairMarker: either('boolean', shape<{ radius?: number; color?: string }>({ radius: positive, color: 'color' })),
    lastPointPulse,
    format: 'function',
  });

  const customOptionsRule = shape<CustomSeriesBaseOptions>(
    { ...seriesShape, follow: 'function', format: 'function' },
    true,
  );

  const heatmapOptionsRule = shape<HeatmapSeriesOptions>({
    title: 'string',
    legend: 'boolean',
    colors: list('color'),
    range: shape<{ min: number; max: number }>({ min: 'number', max: 'number' }),
    lowPercentile: num(0, 100),
    highPercentile: num(0, 100),
    gap: positive,
    opacity: fraction,
    cellReduce: oneOf<CellReduce>({ max: 0, sum: 0, nearest: 0 }),
    inspector: 'boolean',
    format: 'function',
    maxColumns: int(1),
    memoryBudget: positive,
  });

  const pointOptionsRule = shape<PointSeriesOptions>({
    ...seriesShape,
    shape: oneOf<PointShape>({ circle: 0, square: 0, diamond: 0 }),
    color: 'color',
    size: positive,
    sizeBy: shape<PointSizeBy>({
      min: positive,
      max: positive,
      domain: list('number'),
      scale: oneOf<NonNullable<PointSizeBy['scale']>>({ linear: 0, sqrt: 0 }),
    }),
    opacity: fraction,
    stroke: 'color',
    strokeWidth: positive,
    format: 'function',
  });

  const volumeProfileOptionsRule = shape<VolumeProfileOptions>({
    title: 'string',
    legend: 'boolean',
    range: 'any',
    rows: int(1),
    rowSize: num(0),
    width: positive,
    placement: oneOf<'left' | 'right'>({ left: 0, right: 0 }),
    valueArea: num(0, 100),
    sessionOf: 'function',
    throttleMs: positive,
    opacity: fraction,
    pocLine: 'boolean',
    valueAreaLines: 'boolean',
    color: 'color',
    upColor: 'color',
    downColor: 'color',
    pocColor: 'color',
    valueAreaColor: 'color',
  });

  // A level color may name a theme color instead (`'levelGreen'`), or `'auto'` for the shared level rule.
  const themeColors = Object.fromEntries([...Object.keys(chartThemeTokens).filter(isThemeColorKey), 'auto'].map((k) => [k, 0]));
  const levelColor = either('color', oneOf(themeColors));
  const drawingStyleRule = shape<DrawingStyle>(
    {
      color: 'color',
      lineWidth: positive,
      lineStyle,
      fill: 'color',
      fontSize: positive,
      levels: list(shape<DrawingLevel>({ value: 'number', color: levelColor, visible: 'boolean' }, true)),
      extendLeft: 'boolean',
      extendRight: 'boolean',
      showLabel: 'boolean',
      labelSide: oneOf<'left' | 'right'>({ left: 0, right: 0 }),
      labelContent: oneOf<'level' | 'price' | 'both' | 'percent'>({ level: 0, price: 0, both: 0, percent: 0 }),
      showStats: 'boolean',
      profitColor: 'color',
      lossColor: 'color',
      showFill: 'boolean',
      bold: 'boolean',
      italic: 'boolean',
      textColor: 'color',
      middleLine: 'boolean',
      deviation: positive,
      rows: positive,
      valueArea: positive,
      profileWidth: positive,
      angle: 'number',
    },
    true,
  );

  return {
    chart: chartOptionsRule,
    pane: paneOptionsRule,
    candles: candleOptionsRule,
    histogram: histogramOptionsRule,
    line: lineOptionsRule,
    custom: customOptionsRule,
    heatmap: heatmapOptionsRule,
    volumeProfile: volumeProfileOptionsRule,
    points: pointOptionsRule,
    drawingStyle: drawingStyleRule,
  };
}

/** The rules for each kind of options object, by name. */
export type OptionRuleName = keyof ReturnType<typeof buildRules>;

let rules: ReturnType<typeof buildRules> | undefined;

/**
 * Warn about mistakes in `value` against the rule `name`, in development
 * builds only; `where` names the call that took the options. Production
 * builds reduce this to an empty function and drop the rules.
 */
export function devCheck(where: string, value: unknown, name: OptionRuleName): void {
  // Written so bundlers fold it: with NODE_ENV replaced by 'production' the
  // whole block is dead and the rules go with it. Without a bundler, `process`
  // (or its `env`) may be missing; that read throws and the checks stay off.
  let checking = false;
  try {
    if (process.env.NODE_ENV !== 'production') {
      checking = true;
      checkOptions(where, value, (rules ??= buildRules())[name]);
    }
  } catch (error) {
    if (checking) throw error;
  }
}
