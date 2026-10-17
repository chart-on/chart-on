import type { Chart, ComparedSymbol } from '../chart';
import type { ChartError } from '../errors';
import type { Pane } from '../pane';
import type { ChartInternals, ComparisonsFeature } from '../registry';
import type { PriceScaleMode } from '../scales';
import { CandleSeries, LineSeries, type CandleSeriesOptions, type Series } from '../series';
import type { Bar, Time, ValuePoint } from '../types';
import { withAlpha } from '../util/color';
import {
  ComparedLoader,
  PairFeed,
  checkPair,
  floorTime,
  mergeBars,
  pairName,
  pairSymbols,
  snapBarsToGrid,
  snapToGrid,
  type CompareMode,
  type CompareTarget,
} from './compare';
import type { DataLoadKind } from './types';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

// The `comparisons()` plugin (in `builtins.ts`): `chart.compare` and the compared symbols' loaders
// live here, so a chart without it leaves them out.

/** The chart's internal hooks for comparisons. */
type ComparisonsHost = { provideFeature(key: 'comparisons', feature: ComparisonsFeature): () => void; internals(): ChartInternals };

/** Give `chart` compared symbols. Returns a function that takes them away again. */
export function installComparisons(chart: Chart): () => void {
  const host = chart as unknown as ComparisonsHost;
  return host.provideFeature('comparisons', createComparisons(chart, host.internals()));
}

/** Line colours given to compared symbols in turn. */
const COMPARE_COLORS = ['#f59e0b', '#22d3ee', '#e879f9', '#a3e635', '#fb7185'];

/** Candle colours for a compared symbol drawn over the main candles: rising solid, falling faded. */
function compareCandleColors(color: string): Partial<CandleSeriesOptions> {
  const faded = withAlpha(color, 0.4);
  return { upColor: color, downColor: faded, upWickColor: color, downWickColor: color, upBorderColor: color, downBorderColor: color };
}

function createComparisons(chart: Chart, internals: ChartInternals): ComparisonsFeature {
  const comparisons: ComparedSymbol[] = [];
  const entries = new Map<ComparedSymbol, { loaders: ComparedLoader[]; snap: () => void }>();
  /** The main scale's mode before a percent comparison switched it, restored when the last one goes. */
  let modeBefore: PriceScaleMode | null = null;

  /** The last percent comparison gives the main scale back the mode it had before. */
  const restoreMode = () => {
    const restore = modeBefore;
    if (restore !== null && !comparisons.some((c) => c.mode === 'percent')) {
      modeBefore = null;
      if (chart.panes[0]!.price.mode === 'percent') chart.setPriceScaleMode(restore);
    }
  };

  const add: ComparisonsFeature['add'] = (what, options) => {
    const source = chart.data?.source;
    // These two messages stay in production: the shell's compare button shows them to the user.
    if (!source) throw new Error('compare() needs a data source: install dataSource() and call setDataSource first');
    const pair = typeof what === 'string' ? null : what;
    if (pair) checkPair(pair);
    const symbol = pair ? pairName(pair) : (what as string);
    if (comparisons.some((c) => c.symbol === symbol)) throw new Error(`"${symbol}" is already compared`);
    const style = options.style ?? 'line';
    if (!['line', 'candles', 'bars'].includes(style)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown compare style "${style}"` : '');
    const checkMode = (m: CompareMode) => {
      if (!['percent', 'scale', 'pane'].includes(m)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown compare mode "${m}"` : '');
      if (style !== 'line' && m === 'percent') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Compare style "${style}" needs mode "scale" or "pane"` : '');
    };
    let mode = options.mode ?? 'percent';
    checkMode(mode);
    const color = options.color ?? COMPARE_COLORS[comparisons.length % COMPARE_COLORS.length]!;
    let pane = mode === 'pane' ? chart.addPane() : chart.panes[0]!;
    // Its scale on the main pane; in its own pane it uses that pane's right scale.
    const mainScaleId = `compare:${symbol}`;
    let scaleId = mode === 'pane' ? 'right' : mainScaleId;
    const title = options.title ?? symbol;
    const series =
      style === 'line'
        ? chart.addLine({ title, color, priceScale: scaleId, breakGaps: true }, pane)
        : internals.attach(
            new CandleSeries(chart, pane, {
              title,
              style,
              bodyRatio: 0.7,
              lineWidth: 2,
              lastValueLabel: true,
              animate: false,
              priceScale: scaleId,
              // Beside the main candles, both directions take the compare colour so the two read apart.
              ...(mode === 'scale' ? compareCandleColors(color) : {}),
            }),
          );
    const setUpScale = () => {
      if (mode !== 'pane') {
        // Set every field: a scale id can be reused after an earlier compare of the same symbol.
        const scale = pane.scale(scaleId);
        scale.side = mode === 'scale' ? 'left' : 'none';
        scale.link = mode === 'percent' ? pane.price : null;
        scale.invert = false;
        scale.autoScale = true;
        if (mode === 'scale') scale.setMode('normal');
      }
      if (mode === 'percent' && pane.price.mode !== 'percent' && pane.price.mode !== 'indexed') {
        modeBefore ??= pane.price.mode;
        chart.setPriceScaleMode('percent');
      }
    };
    setUpScale();
    // Where it was before `setMode` took it off the main pane or out of its own pane.
    let mainRow: number | null = null;
    let ownPane: { index: number; stretch: number } | null = null;
    const moveTo = (dest: Pane, id: string, at: number | null) => {
      const from = series.pane;
      from.series.splice(from.series.indexOf(series), 1);
      dest.series.splice(Math.min(at ?? dest.series.length, dest.series.length), 0, series);
      series.pane = dest;
      (series as Series<{ priceScale?: string }>).applyOptions({ priceScale: id });
      internals.primitives.followSeries(series);
    };
    const setMode = (next: CompareMode) => {
      if (!comparisons.includes(handle)) return;
      checkMode(next);
      if (next === mode) return;
      const main = chart.panes[0]!;
      const from = pane;
      if (next === 'pane') {
        mainRow = main.series.indexOf(series);
        const at = ownPane?.index ?? chart.panes.length;
        pane = chart.addPane();
        chart.movePane(pane, at);
        if (ownPane) pane.stretch = ownPane.stretch;
        scaleId = 'right';
        moveTo(pane, scaleId, null);
        main.removeScale(mainScaleId);
      } else {
        if (mode === 'pane') ownPane = { index: chart.panes.indexOf(from), stretch: from.stretch };
        pane = main;
        scaleId = mainScaleId;
        if (from !== main) moveTo(main, scaleId, mainRow);
      }
      mode = next;
      setUpScale();
      // Beside the main candles both directions take the compare colour; in a pane of their own, the theme's.
      if (series instanceof CandleSeries) {
        const colors = compareCandleColors(color);
        if (mode === 'scale') series.applyOptions(colors);
        else series.applyOptions(Object.fromEntries(Object.keys(colors).map((k) => [k, undefined])));
      }
      // Its own pane goes with it, unless something else was put there.
      const fromIndex = chart.panes.indexOf(from);
      if (from !== main && fromIndex > 0 && from.series.length === 0 && !internals.paneHasDrawings(fromIndex)) {
        chart.removePane(from);
      } else {
        internals.panesChanged();
      }
      restoreMode();
      chart.redraw('series');
    };
    // Raw bars, re-snapped onto the main bars whenever the main series changes.
    let raw: Bar[] = [];
    const close = (b: Bar): ValuePoint => ({ time: b.time, value: b.close });
    const snap = () => {
      if (series instanceof LineSeries) series.setData(snapToGrid(raw.map(close), chart.timeline.times));
      else series.setData(snapBarsToGrid(raw, chart.timeline.times));
    };
    const target: CompareTarget = {
      setData: (bars) => {
        raw = bars;
        snap();
      },
      update: (bar) => {
        if (raw.length > 0 && raw[raw.length - 1]!.time === bar.time) raw[raw.length - 1] = bar;
        else raw.push(bar);
        const times = chart.timeline.times;
        const last = times[times.length - 1];
        const slot = (t: Time) => (last === undefined || t > last ? t : floorTime(times, t));
        const time = slot(bar.time);
        if (time === null) return;
        if (series instanceof LineSeries) {
          series.update({ time, value: bar.close });
          return;
        }
        // Every raw bar in the same main bar makes up the candle.
        let i = raw.length - 1;
        while (i > 0 && slot(raw[i - 1]!.time) === time) i--;
        let merged: Bar = { ...raw[i]!, time };
        for (let k = i + 1; k < raw.length; k++) merged = mergeBars(merged, raw[k]!);
        series.update(merged);
      },
      setPriceFormat: (priceFormat) => series.applyOptions({ priceFormat }),
    };
    const onError = (leg: string) => (error: ChartError) => chart.emit('compare:error', { symbol: leg, error });
    // A pair loads both of its symbols; their bars meet in the feed.
    const feed = pair ? new PairFeed(pair, target) : null;
    const loaders = feed
      ? pairSymbols(pair!).map((leg, i) => new ComparedLoader(source, leg, feed.leg(i as 0 | 1), onError(leg)))
      : [new ComparedLoader(source, symbol, target, onError(symbol))];
    const interval = chart.data?.interval;
    // Before the main symbol has loaded, its first load starts this one too.
    if (interval) for (const loader of loaders) loader.load(interval, chart.timeline.times[0] ?? null).catch(() => {});
    const handle: ComparedSymbol = {
      symbol,
      pair,
      get mode() {
        return mode;
      },
      style,
      series,
      get info() {
        return loaders[0]!.info;
      },
      ready: Promise.all(loaders.map((l) => l.ready)).then(() => {}),
      serialize: () => ({
        symbol,
        mode,
        style,
        color: series instanceof LineSeries ? (series.options.color ?? color) : color,
        ...(pair ? { pair } : {}),
      }),
      setMode,
      remove: () => {
        const i = comparisons.indexOf(handle);
        // Already removed, or the chart was destroyed (which released its loaders and series).
        if (i < 0) return;
        comparisons.splice(i, 1);
        entries.delete(handle);
        for (const loader of loaders) loader.dispose();
        chart.removeSeries(series);
        if (mode === 'pane') {
          if (chart.panes.includes(pane)) chart.removePane(pane);
        } else {
          pane.removeScale(scaleId);
        }
        restoreMode();
      },
    };
    comparisons.push(handle);
    entries.set(handle, { loaders, snap });
    return handle;
  };

  return {
    list: comparisons,
    add,
    sync: (kind: DataLoadKind) => {
      // Keep compared symbols on the main symbol's interval and history.
      const interval = chart.data?.interval;
      const from = chart.timeline.times[0] ?? null;
      for (const { loaders, snap } of entries.values()) {
        if (kind === 'initial' && interval) for (const loader of loaders) void loader.load(interval, from).catch(() => {});
        else {
          // Older main bars may now hold points that had no bar to sit on.
          snap();
          if (from !== null) for (const loader of loaders) void loader.cover(from);
        }
      }
    },
    reload: () => {
      for (const { loaders } of entries.values()) for (const loader of loaders) void loader.reload().catch(() => {});
    },
    clear: (destroying) => {
      if (!destroying) {
        for (const c of [...comparisons]) c.remove();
        return;
      }
      // Compared loaders run on their own controllers; a late response must find them disposed.
      for (const { loaders } of entries.values()) for (const loader of loaders) loader.dispose();
      comparisons.length = 0;
      entries.clear();
    },
  };
}
