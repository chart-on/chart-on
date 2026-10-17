import type { Chart } from '../chart';
import { UndoSteps } from '../history';
import type { Pane } from '../pane';
import type { ChartInternals, IndicatorsFeature } from '../registry';
import { createSelection } from '../selection';
import { scaleFormat } from '../series';
import { IndicatorManager } from './manager';
import { BarColumns } from './runner';
import type { IndicatorSet } from './sets';
import { parseIndicatorStates } from './state';
import { IndicatorSeries } from './series';
import type { IndicatorDef } from './types';

// The `indicators()` plugin (in `builtins.ts`): the indicator manager, its runners and series, and
// how they sit on the chart's panes live here, so a chart without it leaves them out.

/** The chart's internal hooks for indicators. */
type IndicatorsHost = { provideFeature(key: 'indicators', feature: IndicatorsFeature): () => void; internals(): ChartInternals };

/**
 * Give `chart` an indicator manager, with the indicators a layout loaded before kept. Returns a
 * function that takes it away again, keeping their saved state for a later install.
 */
export function installIndicators(chart: Chart): () => void {
  chart.selector((i) => createSelection(chart, i));
  const host = chart as unknown as IndicatorsHost;
  const internals = host.internals();
  const remove = host.provideFeature('indicators', indicatorClipboard(chart, createIndicators(chart, internals)));
  const manager = chart.indicators;
  const indicators = internals.takeLayout('indicators');
  if (indicators !== undefined) restore(chart, internals, manager, indicators);
  return () => {
    if (chart.indicatorLayer !== manager) return;
    if (!internals.destroying()) {
      const saved = manager.serialize();
      // Their panes stay, empty, so a save keeps the arrangement and indicators installed again go back there.
      const panes = chart.panes.map((pane) => [pane, pane.stretch] as const);
      manager.load([]);
      panes.forEach(([pane, stretch], i) => {
        if (!chart.panes.includes(pane)) chart.movePane(chart.addPane({ stretch }), i);
      });
      if (saved.length > 0) internals.keepLayout('indicators', saved);
    }
    remove();
  };
}

/** The indicators plugin's side of the chart: `manager` and the copy and paste of an indicator in memory. */
function indicatorClipboard(chart: Chart, manager: IndicatorManager): IndicatorsFeature {
  let copied: IndicatorSet | null = null;
  return {
    manager,
    get copied() {
      return copied;
    },
    // Through JSON, so a paste from memory gets what the system clipboard carries.
    copy: (indicator) => (copied = JSON.parse(JSON.stringify(manager.copySet(indicator))) as IndicatorSet),
    paste: (set) => {
      let type = '';
      try {
        const { added, skipped } = manager.pasteSet(set);
        if (added[0]) {
          chart.setSelection({ kind: 'indicator', indicator: added[0] });
          return true;
        }
        type = skipped[0]?.type ?? '';
      } catch {
        // Not a set this build reads: reported like an unknown indicator.
      }
      chart.notify({ message: chart.localization.text('indicatorPasteFailed', { type }), kind: 'error' });
      return false;
    },
    drop: () => (copied = null),
  };
}

/** Load the indicator states a layout kept while the plugin was not installed. */
function restore(chart: Chart, internals: ChartInternals, manager: IndicatorManager, indicators: unknown): void {
  // `loadLayout` keeps only valid states; load the ones that parse anyway, so a bad entry cannot fail the install.
  const valid = (state: unknown) => {
    try {
      return parseIndicatorStates([state]).length > 0;
    } catch {
      return false;
    }
  };
  const states = (Array.isArray(indicators) ? indicators.filter(valid) : []) as { pane: number }[];
  const panes = [...chart.panes];
  const empty = new Set(panes.filter((pane, i) => i > 0 && pane.series.length === 0));
  manager.load(states);
  // Each goes back to the empty pane kept where it sat. One kept for pending indicators goes: like
  // a newly added one, a pending indicator opens in a new pane once its definition is registered.
  const kept = new Set<Pane>();
  manager.getAll().forEach((indicator, i) => {
    const target = panes[states[i]!.pane];
    const series = indicator.series;
    if (!target || !empty.has(target)) return;
    kept.add(target);
    if (series && series.pane !== target) internals.moveSeries(series, target);
  });
  for (const pane of kept) {
    const at = chart.panes.indexOf(pane);
    if (at > 0 && pane.series.length === 0 && !internals.paneHasDrawings(at)) chart.removePane(pane);
  }
}

/**
 * A pane indicator's fixed range or autoscale rule, set on its scale through
 * the public range API, so the app can still zoom, set another range or clear it.
 */
function scaleRange(chart: Chart, def: IndicatorDef, pane: Pane, scaleId: string): void {
  if (def.placement !== 'pane' || !(def.fixedRange || def.autoscaleRule)) return;
  const scale = { fixedRange: def.fixedRange, autoscaleRule: def.autoscaleRule };
  chart.setPriceScaleOptions(scale, chart.panes.indexOf(pane), scaleId);
}

function createIndicators(chart: Chart, internals: ChartInternals): IndicatorManager {
  return new IndicatorManager({
    // One copy of the bars in columns for every indicator.
    barColumns: new BarColumns(),
    localization: () => chart.localization,
    createSeries: (def, runner, title, options) => {
      const placement = options.placement ?? (def.placement === 'pane' ? 'pane' : 'overlay');
      const pane = placement === 'pane' ? chart.addPane() : chart.panes[0]!;
      const scaleId = options.priceScale ?? def.priceScale ?? 'right';
      pane.claimScale(scaleId);
      const precision = def.precision;
      // Read the localizer when formatting, so a language change applies to indicators already added.
      const own =
        precision !== undefined
          ? (v: number) => chart.localization.number(v, precision)
          : (v: number) => (Math.abs(v) >= 1e4 ? chart.localization.compact(v) : chart.localization.number(v, 2));
      // Overlays on a priced scale use its format like every other label on it; on a scale of their own, theirs.
      // Read when formatting, as `setPriceScale` may move the series to another scale.
      let series: IndicatorSeries | null = null;
      const format =
        placement === 'overlay'
          ? (v: number) => (series ? scaleFormat(series.pane.series, series.scale)?.format(v) : null) ?? own(v)
          : own;
      const priceScale = scaleId !== 'right' ? { priceScale: scaleId } : {};
      const legend = options.legend === false ? { legend: false } : {};
      const renderer = options.renderer ? { renderer: options.renderer } : {};
      scaleRange(chart, def, pane, scaleId);
      series = new IndicatorSeries(chart, pane, { title, format, ...priceScale, ...legend, ...renderer }, runner);
      return internals.attach(series, false);
    },
    setPriceScale: (series, def, id) => {
      const pane = series.pane;
      pane.claimScale(id);
      const target = pane.scale(id);
      // Only a pane indicator alone on the new scale of a pane other than the price pane takes its range along.
      const alone = pane.series.every((s) => s === series || s.scale !== target);
      if (pane !== chart.panes[0] && alone) scaleRange(chart, def, pane, id);
      series.applyOptions({ priceScale: id });
      pane.pruneScales();
    },
    seriesAdded: (series, indicator) => chart.emit('series:add', { series, indicator }),
    intervalSeconds: internals.intervalSeconds,
    replaying: internals.replaying,
    placeCopy: (copy, original) => {
      // An overlay's copy joins the original's pane; a pane indicator's copy sits right below it.
      if (copy.pane === chart.panes[0]) {
        if (original.pane !== copy.pane) internals.moveSeries(copy, original.pane);
      } else {
        chart.movePane(copy.pane, chart.panes.indexOf(original.pane) + 1);
      }
    },
    removeSeries: (series, indicator) => {
      const pane = series.pane;
      internals.detach(series, indicator);
      // Whatever its placement: an overlay moved into a pane of its own leaves it empty too. The main pane,
      // and one still holding drawings, stays.
      const at = chart.panes.indexOf(pane);
      if (at > 0 && pane.series.length === 0 && !internals.paneHasDrawings(at)) chart.removePane(pane);
    },
    paneIndex: (pane) => chart.panes.indexOf(pane),
    history: chart.undoSteps((changed) => new UndoSteps(changed)),
    removing: (indicator) => {
      const layer = chart.drawingLayer;
      const tied = layer?.getAll().filter((d) => d.indicator === indicator.id) ?? [];
      if (layer && tied.length > 0) layer.batch(() => tied.forEach((d) => layer.remove(d.id)));
    },
    sets: {
      panes: chart.panes,
      addPane: () => chart.addPane(),
      removeIfEmpty: (pane) => {
        const i = chart.panes.indexOf(pane);
        const used = pane.series.length > 0 || internals.paneHasDrawings(i) || internals.primitives.all.some((e) => e.pane === pane);
        if (i > 0 && !used) chart.removePane(pane);
      },
      movePane: (pane, index) => chart.movePane(pane, index),
      moveSeries: (series, pane) => void internals.moveSeries(series, pane),
      heights: () => chart.getPaneHeights(),
      setHeights: (weights) => chart.setPaneHeights(weights),
      changed: () => internals.stateChanged('indicators'),
    },
    bars: () => chart.main?.data ?? [],
    context: () => {
      const c = chart.data;
      return c?.symbol && c.interval ? { symbol: c.symbol, interval: c.interval } : null;
    },
    source: () => chart.data?.source ?? null,
    invalidate: () => chart.redraw('series'),
    emit: (event, payload) => chart.emit(event, payload as never),
  });
}
