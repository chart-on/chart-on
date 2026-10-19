import {
  clusterList,
  commandPalette,
  createChartShell,
  createDepthLadder,
  createDataWindow,
  createObjectTree,
  createShortcutSettings,
  draftEditor,
  favorites,
  replayControls,
  symbolSearch,
  tableViewOf,
  toasts,
  toolbarCustomization,
  type DataWindowHandle,
  type DepthLadderHandle,
  type ObjectTreeHandle,
  type ShellTheme,
  type SymbolSearchResult,
} from '@chart-on/ui';
import { drawingTemplates, indicatorDefaults, indicatorTemplates } from '@chart-on/ui/templates';
// Explicit, as the docs ask: a production build skips the stylesheet import inside the UI entry (#446).
import '@chart-on/ui/style.css';
import {
  DEFAULT_AUTOSAVE_REASONS,
  autosave,
  builtinTools,
  createImageTool,
  createIndexedDbCache,
  createLocalStorageAdapter,
  createMockDataSource,
  createSessionBands,
  createSettingsStore,
  createStickerTool,
  depthLane as depthLanePlugin,
  drawingTools,
  emojiTool,
  heatmap as heatmapPlugin,
  points as pointsPlugin,
  higherIntervalBars,
  iconTool,
  intervalSeconds,
  layoutEntry,
  perSymbolDrawings,
  statsOverlay,
  referenceLines,
  grouping,
  lastPointPulse,
  localization,
  countdown,
  marketStatus,
  utcDaySession,
  volumeOf,
  volumeProfile as volumeProfilePlugin,
} from '@chart-on/core';
import { builtinIndicators } from '@chart-on/indicators';
import type {
  Bar,
  Chart,
  CustomSeries,
  DataSource,
  HeatmapSeries,
  Interval,
  LineSeries,
  PointSeries,
  Quote,
  ReferenceLinesUpdate,
  SerializedDrawings,
  Series,
  SourceMarker,
  Time,
  VolumeProfileSeries,
} from '@chart-on/core';
import {
  AlignHorizontalJustifyEnd,
  CalendarRange,
  Blocks,
  ChartBarStacked,
  ChartScatter,
  ChartSpline,
  Columns3,
  Flame,
  LayoutDashboard,
  ListTree,
  MessageSquare,
  Rows2,
  Table,
  Table2,
} from 'lucide';
import { LiquiditySim } from './data';
import { largeTrades, tradePoint, tradesIn, type LargeTrade } from './large-trades';
import { openInterestIndicator } from './open-interest';
import { trendRegimeIndicator } from './trend-regime';
import { volumeSpikesIndicator } from './volume-spikes';
import { momentumColorsIndicator } from './momentum-colors';
import { heikinAshiIndicator } from './heikin-ashi';
import { higherRsiIndicator } from './higher-rsi';
import { showAccessNotices } from './access';
import { bandSeries, channelAt, type BandPoint } from './band';
import { offHoursShading } from './off-hours';
import { startDemoDepth, type DemoDepth } from './depth';
import { DEMO_SYMBOLS, demoSearchFilters, searchDemoSymbols, type DemoSymbol } from './symbols';
import { createSyncedChart, type SyncedChart } from './synced';
import { createPriceChart, type PriceChart } from './price-chart';
import { createTradingExample } from './trading';
import { demoSettings } from './app-settings';
import { cycleToggle, demoToolbar } from './toolbar';
import { expose } from './expose';

const INTERVALS: Interval[] = ['1m', '5m', '1h', '4h', '1d', '1w', '1M'];
/** Reference lines the toolbar toggle switches together; the extended-hours label shows with a session set. */
const REFERENCE_LINES = ['previousClose', 'high', 'low', 'average', 'bid', 'ask', 'extendedHours'] as const;
/** The demo keeps one layout; its drawings are kept per symbol. */
const LAYOUT_ID = 'demo';
/** Where earlier demo versions kept the whole layout, drawings included, and before that only the drawings. */
const OLD_LAYOUT_KEY = 'charton-demo-layout';
const OLD_DRAWINGS_KEY = 'charton-demo-drawings';
/** Layouts, per-symbol drawings and settings, in `localStorage` under `charton-demo:`. */
const storage = createLocalStorageAdapter({ prefix: 'charton-demo:' });
/**
 * User preferences. The colour scheme is one: it is not part of a layout, so
 * loading a layout never changes it, and the user's choice wins over the
 * app's default.
 */
const settings = createSettingsStore({ adapter: storage.settings });
const savedTheme = (): ShellTheme | undefined => {
  const theme = settings.get('theme');
  return theme === 'dark' || theme === 'light' || theme === 'system' ? theme : undefined;
};
let symbol: DemoSymbol = DEMO_SYMBOLS[0]!;
let intervalKey: Interval = '1d';
let bars: Bar[] = [];
let sim: LiquiditySim;
let live = true;
let connected = true;
// Assigned after the shell exists; toolbar callbacks may run before that.
let rangeProfile: VolumeProfileSeries | undefined;
// Optional layers exist only while switched on in Layers, so the legend lists only what draws (#923).
let heatmap: HeatmapSeries | undefined;
let sessionProfiles: VolumeProfileSeries | undefined;
let channel: CustomSeries<BandPoint, { color?: string }> | undefined;
let forecast: LineSeries | undefined;
let bigTrades: PointSeries | undefined;
let tradeList: LargeTrade[] = [];

let synced: SyncedChart | null = null;
let priceChart: PriceChart | null = null;
let dataWindow: DataWindowHandle | undefined;
let objectTree: ObjectTreeHandle | undefined;
let depth: DemoDepth | null = null;
/** The same synthetic book listed as a price ladder, while the depth lane is on. */
let ladder: DepthLadderHandle | null = null;

// Detach function while the off-hours shading primitive is attached.
let detachShading: (() => void) | null = null;
/** Regional sessions (Asia, Europe, Americas) along the bottom of the plot, listed in the bottom bar. */
const sessionBands = createSessionBands();

/** Layers menu entry for an optional layer: on creates it, off removes it. */
function optionalLayer<S extends Series>(get: () => S | undefined, set: (series?: S) => void, create: (c: Chart) => S) {
  return {
    isOn: () => get() !== undefined,
    toggle: (c: Chart) => {
      const series = get();
      if (series) c.removeSeries(series);
      set(series ? undefined : create(c));
    },
  };
}

const toolbar = demoToolbar({
  intervals: INTERVALS,
  interval: intervalKey,
  onInterval: (key) => {
    selectInterval(key);
    load();
  },
  compareSymbol: () => (symbol.symbol === 'XAUUSD' ? 'BTCUSD' : 'XAUUSD'),
  layers: [
    {
      value: 'heatmap',
      label: 'Liquidation heatmap',
      icon: Flame,
      ...optionalLayer(() => heatmap, (s) => (heatmap = s), createHeatmap),
    },
    {
      value: 'volume-profile',
      label: 'Visible-range volume profile',
      icon: ChartBarStacked,
      isOn: () => rangeProfile?.visible ?? true,
      toggle: () => rangeProfile?.setVisible(!rangeProfile.visible),
    },
    {
      value: 'session-profiles',
      label: 'Session volume profiles',
      icon: CalendarRange,
      ...optionalLayer(() => sessionProfiles, (s) => (sessionProfiles = s), createSessionProfiles),
    },
    {
      value: 'large-trades',
      label: 'Large trades (bubbles)',
      icon: ChartScatter,
      ...optionalLayer(() => bigTrades, (s) => (bigTrades = s), createBigTrades),
    },
    {
      value: 'channel',
      label: 'Price channel (custom series)',
      icon: Columns3,
      ...optionalLayer(() => channel, (s) => (channel = s), createChannel),
    },
    {
      value: 'depth',
      label: 'Depth lane and ladder (synthetic book)',
      icon: AlignHorizontalJustifyEnd,
      isOn: () => depth !== null,
      toggle: (c) => {
        if (depth) {
          depth.stop();
          ladder?.destroy();
          depth = ladder = null;
        } else {
          depth = startDemoDepth(c, () => bars[bars.length - 1]?.close ?? null);
          ladder = createDepthLadder(c.root.parentElement!, depth.lane, { depth: 8, formatPrice: (p) => main.format(p) });
          ladder.el.classList.add('demo-depth-ladder');
        }
      },
    },
    {
      value: 'forecast',
      label: 'Forecast into the future',
      icon: ChartSpline,
      ...optionalLayer(() => forecast, (s) => (forecast = s), createForecast),
    },
  ],
  // Display switches and bar grouping, in the View menu's Display section (roadmap/toolbar-layout.md).
  display: [
    {
      // Shades 16:00-08:00 UTC on intraday intervals.
      value: 'off-hours',
      label: 'Off-hours shading',
      isOn: () => detachShading !== null,
      toggle: (c) => {
        if (detachShading) {
          detachShading();
          detachShading = null;
        } else {
          detachShading = c.attachPrimitive(offHoursShading(8, 16));
        }
      },
    },
    {
      // Hourly bars drawn as boxes behind intervals below 1h.
      value: 'hourly-boxes',
      label: 'Hourly boxes',
      isOn: (c) => c.indicators.getAll().some((i) => i.type === 'higher-interval-bars'),
      toggle: (c) => {
        const on = c.indicators.getAll().find((i) => i.type === 'higher-interval-bars');
        if (on) on.remove();
        else c.indicators.add('higher-interval-bars', { interval: '1h' });
      },
    },
    // One entry for the session bands: as bands (the default), as columns, or off.
    cycleToggle('session-bands', [
      {
        label: 'Session bands',
        on: true,
        is: () => sessionBands.options.visible && sessionBands.options.mode === 'bands',
        apply: () => sessionBands.applyOptions({ visible: true, mode: 'bands' }),
      },
      {
        label: 'Session bands as columns',
        on: true,
        is: () => sessionBands.options.visible && sessionBands.options.mode === 'columns',
        apply: () => sessionBands.applyOptions({ visible: true, mode: 'columns' }),
      },
      { label: 'Session bands', is: () => !sessionBands.options.visible, apply: () => sessionBands.applyOptions({ visible: false }) },
    ]),
    {
      value: 'watermark',
      label: 'Symbol watermark',
      isOn: (c) => c.features.watermark,
      toggle: (c) => c.applyOptions({ features: { watermark: !c.features.watermark } }),
    },
    {
      // Hold the plot, then draw freehand.
      value: 'sketch',
      label: 'Sketch drawings',
      isOn: (c) => c.features.sketch,
      toggle: (c) => {
        c.applyOptions({ features: { sketch: !c.features.sketch } });
        // Explain the gesture once, the first time it is switched on.
        if (!c.features.sketch || settings.get('sketch-hint-shown')) return;
        settings.set('sketch-hint-shown', '1');
        c.notify({
          message:
            'Sketching is on: hold the plot still for half a second, then draw one stroke and it becomes the drawing it looks like. Tab tries the next fit, Escape takes it back, and a scribble erases. On touch, keep holding after the crosshair shows.',
          durationMs: 12000,
        });
      },
    },
    {
      value: 'reference-lines',
      label: 'Price reference lines',
      isOn: (c) => c.referenceLines.options.high.visible,
      toggle: (c) => {
        const on = !c.referenceLines.options.high.visible;
        c.referenceLines.applyOptions(
          Object.fromEntries(REFERENCE_LINES.map((kind) => [kind, { visible: on }])) as ReferenceLinesUpdate,
        );
      },
    },
    // Bar grouping: off, when zoomed out, or by calendar period.
    cycleToggle('grouping', [
      { label: 'Group bars', is: (c) => !c.options.grouping, apply: (c) => c.applyOptions({ grouping: null }) },
      {
        label: 'Group bars when zoomed out',
        on: true,
        is: (c) => c.options.grouping?.mode === 'pixel',
        apply: (c) => c.applyOptions({ grouping: { mode: 'pixel' } }),
      },
      {
        label: 'Group bars by calendar period',
        on: true,
        is: (c) => c.options.grouping?.mode === 'calendar',
        apply: (c) => c.applyOptions({ grouping: { mode: 'calendar' } }),
      },
    ]),
  ],
  // Panels, in the View menu's Panels section.
  view: [
    {
      value: 'pointer-tooltip',
      label: 'Pointer tooltip',
      icon: MessageSquare,
      isOn: () => shell.features.tooltip,
      toggle: () => shell.applyFeatures({ tooltip: !shell.features.tooltip }),
    },
    {
      value: 'data-window',
      label: 'Data window',
      icon: Table2,
      isOn: () => dataWindow?.el.hidden === false,
      toggle: () => {
        if (!dataWindow) return;
        dataWindow.el.hidden = !dataWindow.el.hidden;
        dataWindow.refresh();
      },
    },
    {
      value: 'object-tree',
      label: 'Object tree',
      icon: ListTree,
      isOn: () => objectTree?.el.hidden === false,
      toggle: () => {
        if (!objectTree) return;
        objectTree.el.hidden = !objectTree.el.hidden;
        objectTree.refresh();
      },
    },
    {
      // An accessible table of the visible bars that follows the view (#309).
      value: 'table-view',
      label: 'View as table',
      icon: Table,
      isOn: (c) => tableViewOf(c)?.isOpen ?? false,
      toggle: (c) => tableViewOf(c)?.toggle(),
    },
    {
      value: 'synced',
      label: 'Linked second chart',
      icon: Rows2,
      isOn: () => synced !== null,
      toggle: () => toggleSynced(),
    },
    {
      // Renko, line break, range, kagi and point & figure, in a chart below.
      value: 'price-chart',
      label: 'Price-based chart',
      icon: Blocks,
      isOn: () => priceChart !== null,
      toggle: () => togglePriceChart(),
    },
    // How the toolbar, rail and bottom bar sit around the chart.
    {
      ...cycleToggle('panels', [
        { label: 'Panels: floating', is: () => shell.panels.toolbar === 'floating', apply: () => shell.setPanels('floating') },
        { label: 'Panels: docked', is: () => shell.panels.toolbar === 'docked', apply: () => shell.setPanels('docked') },
        { label: 'Panels: inset', is: () => shell.panels.toolbar === 'inset', apply: () => shell.setPanels('inset') },
      ]),
      icon: LayoutDashboard,
    },
  ],
  // Data simulation and debugging switches, in the View menu's last section, Demo.
  demo: [
    // The simulated feed: live, paused, or dropped to show the reconnecting state.
    cycleToggle('live', [
      { label: 'Live updates', on: true, is: () => live && connected, apply: () => setFeed(true, true) },
      { label: 'Live updates paused', is: () => !live, apply: () => setFeed(false, true) },
      { label: 'Live feed dropped', is: () => !connected, apply: () => setFeed(true, false) },
    ]),
    {
      value: 'low-power',
      label: 'Low-power mode',
      isOn: (c) => c.options.lowPower,
      toggle: (c) => c.applyOptions({ lowPower: !c.options.lowPower }),
    },
    // A developer panel: frame times, GPU work and memory, drawn by the chart itself; optionally with bounds.
    cycleToggle('render-stats', [
      { label: 'Render statistics', is: (c) => !c.options.renderStatsOverlay, apply: (c) => c.applyOptions({ renderStatsOverlay: false }) },
      {
        label: 'Render statistics',
        on: true,
        is: (c) => c.options.renderStatsOverlay === true,
        apply: (c) => c.applyOptions({ renderStatsOverlay: true }),
      },
      {
        label: 'Render statistics with bounds',
        on: true,
        is: (c) => c.options.renderStatsOverlay === 'bounds',
        apply: (c) => c.applyOptions({ renderStatsOverlay: 'bounds' }),
      },
    ]),
  ],
  relabel: (id, options) => shell.toolbar?.update(id, { options }),
});

/** Images pasted on the chart or picked for the image tool, by reference. Not saved: after a reload their drawings show a crossed box. */
const pastedImages = new Map<string, Blob>();
function storeImage(image: Blob): string {
  // Unique across reloads: saved drawings keep their reference, and must not show an image pasted later.
  const ref = `pasted-${crypto.randomUUID()}`;
  pastedImages.set(ref, image);
  return ref;
}

// Per-indicator "Save as default" settings, kept in localStorage.
const savedDefaults = indicatorDefaults();

const shell = createChartShell(document.getElementById('app')!, {
  // Users add, remove and reorder toolbar actions; the symbol and interval stay put.
  toolbar: { items: toolbar, customize: toolbarCustomization({ locked: ['symbol', 'interval'] }), settings },
  // Theme, accessibility, language and direction in the settings dialog, plus a Colors… button there.
  settings: demoSettings({
    theme: () => shell.theme,
    setTheme: (theme) => shell.setTheme(theme),
    // The class swaps the stylesheet's tokens; the shell sees the change and recolours the chart.
    highContrast: () => shell.el.classList.contains('pc-theme-high-contrast'),
    setHighContrast: (on) => shell.el.classList.toggle('pc-theme-high-contrast', on),
    palette: () => shell.palette,
    setPalette: (palette) => shell.setPalette(palette),
    direction: () => shell.direction,
    setDirection: (direction) => shell.setDirection(direction),
  }),
  theme: savedTheme() ?? 'system',
  // The interval switcher keeps the period on screen. A range preset switches the
  // interval and then sets its span, which the chart applies again to the new bars.
  // The watermark shows the symbol and interval behind the series; it follows every load.
  // Access rules stand in for paid features: one drawing tool is gated (shown disabled,
  // a press shows a notice) and the chart holds at most four indicators.
  chart: {
    // The built-in drawing tools plus the opt-in emoji, icon and sticker tools (a sticker's reference is an
    // image URL), and the render statistics overlay and reference lines the view menu toggles; the shell
    // adds indicators, compare and annotations.
    plugins: [
      heatmapPlugin(),
      volumeProfilePlugin(),
      // The large-trades bubbles.
      pointsPlugin(),
      depthLanePlugin(),
      statsOverlay(),
      referenceLines(),
      // The View menu's bar grouping entry.
      grouping(),
      // The main series rings on each live update.
      lastPointPulse(),
      // The settings' language picker.
      localization(),
      // The time left in the newest bar, under the last price.
      countdown(),
      // The market phase and data delay badge in the legend.
      marketStatus(),
      drawingTools([
        ...builtinTools,
        emojiTool,
        iconTool,
        createStickerTool({ load: (ref) => Object.assign(new Image(), { src: ref }) }),
        // Pasted images (Ctrl/Cmd+V) become image drawings; this page keeps their files in memory only.
        createImageTool({ load: (ref) => pastedImages.get(ref) ?? Promise.reject(new Error(`No image ${ref} on this page`)), store: storeImage }),
      ]),
    ],
    keepRangeOnIntervalChange: true,
    features: { watermark: true },
    // Shows the access rules at work: one tool refused (shown disabled), at most four indicators.
    access: { allow: ({ kind, id }) => !(kind === 'drawing' && id === 'fib-extension'), limits: { indicators: 4 }, refused: 'disable' },
  },
  // Narrow windows get the compact layout: the rail opens as a bottom sheet.
  features: { railSheet: true },
  // Starter favourites for a first visit; the user's own are saved and win after that.
  favorites: favorites({ tools: ['trendline', 'hline', 'fib-retracement', 'rectangle'] }),
  // Style templates in the drawing and indicator settings, an opt-in add-on kept in localStorage,
  // with Save as default; indicators added from the picker start from a saved default.
  drawingSettings: { headerControl: drawingTemplates({ defaults: true }) },
  indicatorSettings: { headerControl: indicatorTemplates({ defaults: savedDefaults }) },
  // Overview strip of the whole history above the bottom bar.
  navigator: true,
  // Typing a letter on the focused chart opens the search too. It searches
  // through the data source; the dialog pages and filters the results.
  symbolSearch: symbolSearch({
    source: { search: (query) => feed.search(query), searchFilters: demoSearchFilters },
    onSelect: selectSymbol,
    pageSize: 10,
  }),
  // The demo always draws its own volume overlay, so the volume indicator would add a second one.
  indicatorPicker: { filter: (def) => def.id !== 'volume-ma', initialState: savedDefaults.initialState },
  // Ctrl/Cmd+K: every command on chart.actions, the picker's indicators, plus the demo symbols as an app source.
  commandPalette: commandPalette({
    sources: [
      {
        id: 'symbols',
        label: 'Symbols',
        entries: () =>
          DEMO_SYMBOLS.map((s) => ({ id: s.symbol, label: s.symbol, description: s.description, run: () => selectSymbol(s) })),
      },
    ],
  }),
  // Notifications and statuses over bars as toasts over the chart.
  toasts: toasts(),
  // Bar replay's play, pause, step and speed strip, and the trading example's order list and draft keypad.
  replayControls: replayControls(),
  clusterList: clusterList(),
  draftEditor: draftEditor(),
});
const chart = shell.chart;
// Opt-in: adds "Keyboard shortcuts…" to the chart settings; the user's keys are kept across reloads.
createShortcutSettings(chart, shell.el, { storageKey: 'charton-demo:shortcuts' });
showAccessNotices(chart, chart.root.parentElement!);
// Frames keep coming slowly: point at the low-power switch.
chart.on('frame:slow', ({ frameTime }) =>
  chart.notify({
    message: `Frames take ${Math.round(frameTime)} ms here. Low-power mode is in View > Display.`,
    durationMs: 8000,
  }),
);
chart.attachPrimitive(sessionBands);
// The image tool from the rail asks for a file, once per drawing: undo and redo bring a removed box
// back as a new drawing, and must not ask again. The file goes through the tool's own checks, as a paste
// does; a cancelled pick or a file it declines removes the empty box.
const imageTool = chart.drawings.getTools().find((t) => t.pasteImage);
const askedForImage = new Set<string>();
chart.on('drawing:create', ({ drawing }) => {
  if (!imageTool || drawing.type !== 'image' || drawing.text || askedForImage.has(drawing.id)) return;
  askedForImage.add(drawing.id);
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return chart.drawings.remove(drawing.id);
    void imageTool.pasteImage!(file).then((got) => {
      if (got) return chart.drawings.update(drawing.id, { text: got.text });
      chart.drawings.remove(drawing.id);
      chart.notify({ message: 'That file is not an image the chart takes (PNG, JPEG, GIF or WebP, up to 2 MB).', kind: 'error' });
    });
  });
  input.addEventListener('cancel', () => chart.drawings.remove(drawing.id));
  input.click();
});
for (const def of builtinIndicators) chart.indicators.register(def);
// Backed by its own (mock) data feed rather than computed from the bars.
chart.indicators.register(openInterestIndicator);
// Reads daily bars (by default) through the data source while the chart shows intraday ones.
chart.indicators.register(higherRsiIndicator);
// Boxes of a longer interval's bars behind the chart's (an opt-in plugin of core).
chart.install(higherIntervalBars());
// Step lines and a background shaded per bar.
chart.indicators.register(trendRegimeIndicator);
// Recolours the main bars where volume spikes.
chart.indicators.register(volumeSpikesIndicator);
// Columns and a line coloured bar by bar.
chart.indicators.register(momentumColorsIndicator);
// Heikin-Ashi candles drawn by an OHLC plot.
chart.indicators.register(heikinAshiIndicator);
// Floats over the stage (not the chart root, whose pointer handlers would pan under it).
dataWindow = createDataWindow(chart.root.parentElement!, chart);
dataWindow.el.classList.add('demo-data-window');
dataWindow.el.hidden = true;
objectTree = createObjectTree(chart.root.parentElement!, chart);
objectTree.el.classList.add('demo-object-tree');
objectTree.el.hidden = true;
// Volume colors and the synced chart follow the shell theme, so update them when it changes (also on OS switches).
shell.on('theme:change', ({ theme }) => {
  settings.set('theme', theme);
  synced?.chart.applyOptions({ theme: chart.theme });
  priceChart?.chart.applyOptions({ theme: chart.theme });
  bigTrades?.setData(tradeList.map((t) => tradePoint(t, chart.theme)));
});
// For devtools and the browser tests.
expose({ chart, shell });

// The pulse shows only in the line-based chart types (line, area, step, baseline).
const main = chart.addCandles({ title: `${symbol.symbol} · 1D · Demo`, lastPointPulse: 'on-update' });
// Follows the main bars: the chart keeps it in step on loads, live bars and theme changes.
chart.addHistogram({
  title: 'Vol',
  follow: volumeOf,
  overlay: { top: 0.8, bottom: 0 },
  columnRatio: 0.8,
  lastValueLabel: false,
});
rangeProfile = chart.addVolumeProfile({ title: 'Visible range profile' });
const liqPane = chart.addPane({ stretch: 0.2 });
const liquidations = chart.addHistogram(
  { title: 'Agg. liquidations', positiveColor: chart.theme.up, negativeColor: chart.theme.down },
  liqPane,
);
const cvdPane = chart.addPane({ stretch: 0.2 });
const cvd = chart.addLine({ title: 'Cumulative volume delta', area: true, baseline: 0 }, cvdPane);
/** A made-up forecast: the newest close drifting by the recent average change, over the next 20 bars. */
function updateForecast(target = forecast): void {
  const last = bars[bars.length - 1];
  if (!target || !last || bars.length < 21) return;
  const drift = (last.close - bars[bars.length - 21]!.close) / 20;
  const times = chart.timeline.projected(20);
  target.setData([{ time: last.time, value: last.close }, ...times.map((time, k) => ({ time, value: last.close + drift * (k + 1) }))]);
}

// The optional layers, created by the Layers menu (`optionalLayer`) with the data loaded so far.
function createHeatmap(c: Chart): HeatmapSeries {
  const series = c.addHeatmap({ title: 'Liquidation heatmap' });
  // Replay the seeded sim on the live sim's grid: the same columns it produced for these bars, and the next live column fits.
  if (bars.length) series.setData(new LiquiditySim(sim.priceStart, sim.priceStep, sim.rows).run(bars).heatmap);
  return series;
}
function createChannel(c: Chart): CustomSeries<BandPoint, { color?: string }> {
  // Channel values are prices, so they use the main series' price format.
  const series = c.addCustomSeries(bandSeries, { title: 'Channel 20', format: (v) => main.format(v) });
  series.setData(bars.map((_, i) => channelAt(bars, i)));
  return series;
}
function createBigTrades(c: Chart): PointSeries {
  // Large prints at their exact time and price, area by size: one GPU draw however many there are.
  const series = c.addPoints({ title: 'Large trades', sizeBy: { min: 3, max: 26 }, opacity: 0.45 });
  series.setData(tradeList.map((t) => tradePoint(t, c.theme)));
  return series;
}
function createSessionProfiles(c: Chart): VolumeProfileSeries {
  return c.addVolumeProfile({ title: 'Session profiles', range: 'session', sessionOf: sessionFor(intervalSeconds(intervalKey)) });
}
function createForecast(c: Chart): LineSeries {
  // Points after the newest bar sit on the projected bars of the time axis, so a forecast can run into the future.
  const series = c.addLine({ title: 'Forecast', lineStyle: 'dashed', color: '#a78bfa', lastValueLabel: false });
  updateForecast(series);
  // Show the space after the newest bar, where the forecast is.
  c.applyOptions({ rightOffset: 25 });
  return series;
}
createTradingExample(chart, main);

function selectInterval(key: Interval): void {
  intervalKey = key;
  // Not upper-cased: 1m is a minute, 1M a month.
  main.applyOptions({ title: `${symbol.symbol} · ${key} · Demo` });
  sessionProfiles?.applyOptions({ sessionOf: sessionFor(intervalSeconds(key)) });
}

/** Sessions that suit the interval: UTC days for intraday bars, weeks for daily, months for weekly. */
function sessionFor(seconds: number): (time: Time) => number {
  if (seconds < 86400) return utcDaySession;
  // Day 0 (1970-01-01) was a Thursday; shift so weeks start on Monday.
  if (seconds < 604800) return (t) => Math.floor((t / 86400 + 3) / 7);
  return (t) => {
    const d = new Date(t * 1000);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  };
}

// Load the picked symbol through the data source; drawings stay and the
// derived series are rebuilt on `data:loaded`.
function selectSymbol(picked: SymbolSearchResult): void {
  symbol = DEMO_SYMBOLS.find((s) => s.symbol === picked.symbol) ?? symbol;
  selectInterval(intervalKey); // refreshes the title
  load();
}


// All market data comes through the data source API; the mock adapter
// simulates history paging and live ticks. One mock per demo symbol, so each
// starts at its own price level.
const mocks = new Map(
  DEMO_SYMBOLS.map((s) => [s.symbol, createMockDataSource({ symbols: [s], historyBars: 12000, startPrice: s.price })]),
);
const mockFor = (key: string) => mocks.get(key) ?? mocks.get(DEMO_SYMBOLS[0]!.symbol)!;
const setPaused = (paused: boolean) => mocks.forEach((m) => m.setPaused(paused));
/** The View menu's live feed entry: run or pause the simulation, and keep or drop the connection. */
const setFeed = (running: boolean, linked: boolean) => {
  live = running;
  connected = linked;
  setPaused(!live);
  mocks.forEach((m) => m.setConnected(connected));
};
// The mock has no order book, so quotes are made up around each live close.
const quoteListeners = new Map<(quote: Quote) => void, string>();
const quoteOf = (close: number): Quote => {
  const half = close * 0.0003;
  return { bid: close - half, ask: close + half };
};
const feed: DataSource = {
  symbol: (key) => mockFor(key).symbol(key),
  search: searchDemoSymbols,
  history: (info, interval, request) => mockFor(info.symbol).history(info, interval, request),
  stream: (info, interval, onBar) =>
    mockFor(info.symbol).stream!(info, interval, (bar) => {
      onBar(bar);
      // Compared symbols stream bars too; only the quoted symbol's bars make quotes.
      for (const [listener, quoted] of quoteListeners) if (quoted === info.symbol) listener(quoteOf(bar.close));
    }),
  // Every mock drops and restores together, so any one reports the connection.
  onStatus: (listener) => mockFor(DEMO_SYMBOLS[0]!.symbol).onStatus!(listener),
  quotes: (info, onQuote) => {
    quoteListeners.set(onQuote, info.symbol);
    return () => quoteListeners.delete(onQuote);
  },
  now: () => mockFor(symbol.symbol).now!(),
  // A time-axis marker at the start of each week (Monday 00:00 UTC), for the synthetic data.
  markers: async (_info, _interval, { from, to }) => {
    const week = 7 * 86400;
    // The unix epoch fell on a Thursday: Mondays are 4 days past a multiple of a week.
    const monday = 4 * 86400;
    const markers: SourceMarker[] = [];
    for (let t = Math.ceil((from - monday) / week) * week + monday; t < to && markers.length < 500; t += week) {
      markers.push({ id: `week-${t}`, time: t, position: 'timeAxis', text: 'W', tooltip: `Week start\n${new Date(t * 1000).toISOString().slice(0, 10)}` });
    }
    return markers;
  },
};
// A short gap-fill limit, so dropping the connection for over 30 seconds shows the stale banner.
// The cache keeps the last window per symbol and interval in the browser, so a reload paints at once.
chart.setDataSource(feed, { initialBars: 1500, pageBars: 500, maxGapFillSeconds: 30, cache: createIndexedDbCache({ namespace: 'demo' }) });

function load(): void {
  chart.setSymbol(symbol.symbol, intervalKey).catch((err) => console.error('Could not load data', err));
}

/**
 * The title and interval switcher follow what the chart loaded, so a
 * `chart.setSymbol` call from outside the demo's controls shows up too, and so
 * does the nearest supported interval a symbol shows instead of the picked one.
 * The symbol header preset follows loads on its own.
 */
function followLoad(loaded: string, interval: Interval): void {
  symbol = DEMO_SYMBOLS.find((s) => s.symbol === loaded) ?? symbol;
  selectInterval(interval);
}

/** Second chart under the shell; its crosshair mirrors the main chart's by time. */
const syncedHost = document.createElement('div');
syncedHost.className = 'demo-synced';
syncedHost.hidden = true;
document.getElementById('app')!.append(syncedHost);

function toggleSynced(): void {
  if (synced) {
    synced.destroy();
    synced = null;
    syncedHost.hidden = true;
    return;
  }
  syncedHost.hidden = false;
  synced = createSyncedChart(syncedHost, chart);
  synced.load(bars);
}

/** Chart under the shell drawing the same bars as renko, line break or range bars, live. */
const priceHost = document.createElement('div');
priceHost.className = 'demo-synced';
priceHost.hidden = true;
document.getElementById('app')!.append(priceHost);

function togglePriceChart(): void {
  if (priceChart) {
    priceChart.destroy();
    priceChart = null;
    priceHost.hidden = true;
    return;
  }
  priceHost.hidden = false;
  priceChart = createPriceChart(priceHost, chart);
  priceChart.load(bars);
}

// Initial loads and history pages: rebuild the series derived from the bars.
chart.on('data:loaded', (e) => {
  if (e.kind === 'initial') followLoad(e.symbol.symbol, e.interval);
  bars = e.bars.slice();
  sim = LiquiditySim.forBars(bars);
  const data = sim.run(bars);
  channel?.setData(bars.map((_, i) => channelAt(bars, i)));
  heatmap?.setData(data.heatmap);
  tradeList = largeTrades(bars, intervalSeconds(intervalKey));
  bigTrades?.setData(tradeList.map((t) => tradePoint(t, chart.theme)));
  liquidations.setData(data.liquidations);
  cvd.setData(data.cvd);
  updateForecast();
  synced?.load(bars);
  priceChart?.load(bars);
});

// Live bars: move the forming bar, or roll the derived series onto a new one.
chart.on('data:bar', ({ bar, appended }) => {
  const last = bars[bars.length - 1];
  priceChart?.update(bar);
  if (!appended) {
    bars[bars.length - 1] = bar;
    channel?.update(channelAt(bars, bars.length - 1));
    return;
  }
  bars.push(bar);
  channel?.update(channelAt(bars, bars.length - 1));
  if (!last) return;
  // The bar before the new one has closed: its trades are final.
  for (const t of tradesIn(last, intervalSeconds(intervalKey))) {
    tradeList.push(t);
    bigTrades?.update(tradePoint(t, chart.theme));
  }
  const step = sim.step(last);
  heatmap?.updateColumn(bar.time, step.column);
  liquidations.update({ time: bar.time, value: step.liquidation });
  cvd.update({ time: bar.time, value: step.cvd });
  updateForecast();
});

// Drawings are kept per symbol: switching symbols saves the old ones and loads the new ones.
perSymbolDrawings(chart, storage);
// The rest of the layout (interval, chart type, panes, indicators and the visible range)
// saves after changes settle. Loading a layout never saves, and a save waits until a
// restored layout's symbol has loaded, so it never stores the old visible range.
autosave(chart, {
  delayMs: 500,
  include: [...DEFAULT_AUTOSAVE_REASONS, 'viewport'],
  serialize: { drawings: false, visibleRange: true },
  save: (layout) => storage.saveLayout(layoutEntry(layout, 'Demo', LAYOUT_ID)).then(() => {}),
});

/** Move what earlier demo versions saved into the storage adapter, once. */
async function migrateOldKeys(): Promise<void> {
  let old: { layout: Record<string, unknown> | null; drawings: unknown } = { layout: null, drawings: null };
  try {
    const layout: unknown = JSON.parse(localStorage.getItem(OLD_LAYOUT_KEY) ?? 'null');
    const drawings: unknown = JSON.parse(localStorage.getItem(OLD_DRAWINGS_KEY) ?? 'null');
    old = { layout: typeof layout === 'object' && layout !== null ? (layout as Record<string, unknown>) : null, drawings };
  } catch {
    return;
  }
  if (!old.layout && !old.drawings) return;
  const { drawings, ...layout } = old.layout ?? {};
  const symbolOf = typeof layout.symbol === 'string' ? layout.symbol : DEMO_SYMBOLS[0]!.symbol;
  const keep = (drawings ?? old.drawings) as SerializedDrawings | null;
  if (keep && typeof keep === 'object') await storage.saveDrawings(symbolOf, keep);
  if (old.layout) await storage.saveLayout(layoutEntry(layout as never, 'Demo', LAYOUT_ID));
  try {
    localStorage.removeItem(OLD_LAYOUT_KEY);
    localStorage.removeItem(OLD_DRAWINGS_KEY);
  } catch {
    // Blocked storage: nothing was there to move.
  }
}

/** Restore the saved layout and load its symbol; false when there is none to restore. */
async function restoreLayout(): Promise<boolean> {
  await migrateOldKeys();
  const saved = await storage.loadLayout(LAYOUT_ID);
  if (!saved) return false;
  const layout = saved as { symbol?: unknown; interval?: unknown };
  // Adopt the saved symbol and interval when the demo knows them, so the title and toolbar match.
  symbol = DEMO_SYMBOLS.find((s) => s.symbol === layout.symbol) ?? symbol;
  const savedInterval = INTERVALS.find((i) => i === layout.interval);
  if (savedInterval) {
    shell.toolbar?.setValue('interval', savedInterval);
    selectInterval(savedInterval);
  } else {
    selectInterval(intervalKey);
  }
  try {
    const { errors, ready } = chart.loadLayout({ ...layout, symbol: symbol.symbol, interval: intervalKey });
    if (errors.length > 0) console.warn('Parts of the saved layout were skipped', errors);
    shell.toolbar?.setValue('style', main.options.style);
    ready?.catch((err) => console.error('Could not load data', err));
    return ready !== null;
  } catch (err) {
    console.warn('Could not restore the layout', err);
    return false;
  }
}

const style = document.createElement('style');
style.textContent = `
  #app { display: flex; flex-direction: column; }
  #app > .pc-shell { flex: 1; height: auto; }
  .demo-synced { position: relative; flex: 0 0 32%; min-height: 0; border-top: 1px solid rgb(128 128 128 / 0.25); }
  .demo-synced[hidden] { display: none; }
  .demo-price-type { position: absolute; top: 6px; right: 72px; z-index: 3; font: inherit; font-size: 12px; }
  .demo-data-window { position: absolute; top: 8px; right: 84px; z-index: 3; max-height: calc(100% - 44px); }
  .demo-depth-ladder { position: absolute; top: 8px; right: 180px; z-index: 3; max-height: calc(100% - 44px); }
  .demo-object-tree { position: absolute; top: 8px; left: 8px; z-index: 3; max-height: calc(100% - 44px); }
`;
document.head.append(style);

void restoreLayout().then((restored) => {
  if (!restored) load();
});
