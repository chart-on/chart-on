import type { Chart, Indicator, IntervalRange, Series } from '@chart-on/core';
import { ArrowDown, ArrowUp, ChartCandlestick, Clock, Combine, Copy, Ruler, Settings, SquarePlus, Trash2 } from 'lucide';
import type { ContextMenuItem } from './context-menu';
import { keyOf, shellText, type Localized, type ShellMessageKey } from './messages';

/** An interval group of the "Show on" submenu. */
export interface IntervalGroup {
  id: string;
  label: string;
  range: IntervalRange;
}

/** The interval groups "Show on" offers, shortest first. */
export const INTERVAL_GROUPS: readonly IntervalGroup[] = [
  { id: 'seconds', label: 'Seconds', range: { from: '1s', to: '59s' } },
  { id: 'minutes', label: 'Minutes', range: { from: '1m', to: '59m' } },
  { id: 'hours', label: 'Hours', range: { from: '1h', to: '23h' } },
  { id: 'days', label: 'Days', range: { from: '1d', to: '6d' } },
  { id: 'weeks', label: 'Weeks', range: { from: '1w', to: '4w' } },
  { id: 'months', label: 'Months and longer', range: { from: '1M', to: '100y' } },
];

/** An interval group's label in the language of `chart`. */
export const intervalGroupText = (chart: Localized, group: IntervalGroup) =>
  // A built-in group's label is message `interval<Id>`.
  INTERVAL_GROUPS.some((g) => g.id === group.id) ? shellText(chart, keyOf('interval', group.id)) : group.label;

const sameRange = (a: IntervalRange, b: IntervalRange) => a.from === b.from && a.to === b.to;

/**
 * `ranges` with `group` switched on or off; null (every interval) once every
 * group is on. Switching off the only group left changes nothing, so the
 * indicator never ends up shown nowhere.
 */
export function toggleIntervalGroup(ranges: readonly IntervalRange[] | null, group: IntervalRange): IntervalRange[] | null {
  const current = ranges ?? INTERVAL_GROUPS.map((g) => g.range);
  const on = current.some((r) => sameRange(r, group));
  const next = on ? current.filter((r) => !sameRange(r, group)) : [...current, group];
  if (next.length === 0) return ranges ? [...ranges] : null;
  return INTERVAL_GROUPS.every((g) => next.some((r) => sameRange(r, g.range))) ? null : next;
}

/** Legend row title, as the legend shows it. */
function titleOf(chart: Chart, series: Series): string {
  const title = (series.options as { title?: string }).title;
  return title || shellText(chart, series.kind === 'candles' ? 'seriesPrice' : 'seriesFallback');
}

/** A pane named by the series in it, e.g. "Pane 2: RSI 14". */
function paneLabel(chart: Chart, index: number): string {
  if (index === 0) return shellText(chart, 'panePrice');
  const titles = chart.panes[index]!.series.map((s) => titleOf(chart, s));
  const number = index + 1;
  return titles.length > 0 ? shellText(chart, 'paneNumberTitles', { number, titles: titles.join(', ') }) : shellText(chart, 'paneNumber', { number });
}

/**
 * Default items for a legend row's menu (target `'legend'`): settings,
 * duplicate, moving between panes, intervals, folding and removal, each only
 * when it applies.
 */
export function legendMenuItems(chart: Chart, series: Series): ContextMenuItem[] {
  const indicator = chart.indicators.getAll().find((ind) => ind.series === series) ?? null;
  const main = (series as { isMain?: boolean }).isMain === true;
  const at = chart.panes.indexOf(series.pane);
  const last = chart.panes.length - 1;
  const items: ContextMenuItem[] = [{ type: 'label', label: titleOf(chart, series) }];
  const t = (key: ShellMessageKey) => shellText(chart, key);

  if (chart.hasSeriesSettings(series)) {
    items.push({ type: 'action', id: 'series-settings', label: t('seriesSettings'), icon: Settings, onSelect: () => chart.openSeriesSettings(series) });
  }
  // A copy the access rules refuse is left out, or with `access.refused: 'disable'`
  // kept so choosing it fires `indicator:refuse` for the app.
  const refused = indicator !== null && chart.indicators.refusal(indicator.type) !== null;
  if (indicator && !indicator.pending && (!refused || chart.options.access.refused === 'disable')) {
    items.push({ type: 'action', id: 'duplicate', label: t('seriesDuplicate'), icon: Copy, onSelect: () => duplicate(chart, indicator) });
  }

  if (!main && at >= 0) {
    items.push({ type: 'separator' });
    // The pane above the first indicator pane is the price pane, which has its own item.
    if (at > 1) items.push({ type: 'action', id: 'move-up', label: t('seriesMoveUp'), icon: ArrowUp, onSelect: () => chart.moveSeries(series, 'above') });
    if (at < last) items.push({ type: 'action', id: 'move-down', label: t('seriesMoveDown'), icon: ArrowDown, onSelect: () => chart.moveSeries(series, 'below') });
    if (at > 0) {
      items.push({ type: 'action', id: 'move-to-price-pane', label: t('seriesMoveToPricePane'), icon: ChartCandlestick, onSelect: () => chart.moveSeries(series, chart.panes[0]!) });
    }
    // Alone in its own pane, a new pane would change nothing.
    if (at === 0 || series.pane.series.length > 1) {
      items.push({ type: 'action', id: 'move-to-new-pane', label: t('seriesMoveToNewPane'), icon: SquarePlus, onSelect: () => chart.moveSeries(series, 'new') });
    }
    const targets = chart.panes.flatMap((pane, i) => (i > 0 && i !== at ? [{ pane, i }] : []));
    if (targets.length > 0) {
      items.push({
        type: 'submenu',
        id: 'merge-into-pane',
        label: t('seriesMergeIntoPane'),
        icon: Combine,
        items: targets.map(({ pane, i }) => ({
          type: 'action' as const,
          id: `merge-into-pane-${i}`,
          label: paneLabel(chart, i),
          onSelect: () => chart.moveSeries(series, pane),
        })),
      });
    }
  }

  items.push({ type: 'separator' });
  if (indicator && !indicator.pending) items.push(scaleItem(chart, indicator));
  if (indicator) items.push(showOnItem(chart, indicator));
  const folded = chart.isLegendFolded(series);
  items.push({ type: 'check', id: 'fold-legend', label: t('seriesFoldLegend'), checked: folded, onSelect: () => chart.setLegendFolded(series, !folded) });

  if (!main) {
    items.push({ type: 'separator' }, { type: 'action', id: 'remove', label: t('seriesRemove'), icon: Trash2, danger: true, onSelect: () => removeSeries(chart, series, indicator) });
  }
  return items;
}

/** "Scale ▸": the pane's right scale, its left scale, or a scale of the indicator's own with no axis. */
function scaleItem(chart: Chart, indicator: Indicator): ContextMenuItem {
  const id = indicator.priceScale;
  const own = id !== 'right' && id !== 'left';
  return {
    type: 'submenu',
    id: 'scale',
    label: shellText(chart, 'seriesScale'),
    icon: Ruler,
    items: [
      { type: 'check', id: 'scale-right', label: shellText(chart, 'seriesScaleRight'), checked: id === 'right', onSelect: () => indicator.setPriceScale('right') },
      { type: 'check', id: 'scale-left', label: shellText(chart, 'seriesScaleLeft'), checked: id === 'left', onSelect: () => indicator.setPriceScale('left') },
      {
        type: 'check',
        id: 'scale-own',
        label: shellText(chart, 'seriesScaleOwn'),
        checked: own,
        onSelect: () => {
          if (!own) indicator.setPriceScale(freeScaleId(chart));
        },
      },
    ],
  };
}

/** A scale id no pane has yet, so the indicator gets a scale to itself. */
function freeScaleId(chart: Chart): string {
  const taken = new Set(chart.panes.flatMap((pane) => pane.scales.map((scale) => scale.id)));
  let n = 1;
  while (taken.has(`own-${n}`)) n++;
  return `own-${n}`;
}

/** "Show on ▸": every interval, or groups of intervals. */
function showOnItem(chart: Chart, indicator: Indicator): ContextMenuItem {
  const ranges = indicator.visibleOn;
  const all = ranges === null;
  return {
    type: 'submenu',
    id: 'show-on',
    label: shellText(chart, indicator.hiddenByInterval ? 'seriesShowOnHidden' : 'seriesShowOn'),
    icon: Clock,
    items: [
      { type: 'check', id: 'show-on-all', label: shellText(chart, 'seriesShowOnAll'), checked: all, onSelect: () => indicator.setVisibleOn(null) },
      { type: 'separator' },
      ...INTERVAL_GROUPS.map(
        (group): ContextMenuItem => ({
          type: 'check',
          id: `show-on-${group.id}`,
          label: intervalGroupText(chart, group),
          checked: all || ranges.some((r) => sameRange(r, group.range)),
          onSelect: () => indicator.setVisibleOn(toggleIntervalGroup(indicator.visibleOn, group.range)),
        }),
      ),
    ],
  };
}

/** Duplicate `indicator`; a refusal is the app's to handle through `indicator:refuse`. */
function duplicate(chart: Chart, indicator: Indicator): void {
  try {
    chart.indicators.duplicate(indicator);
  } catch (err) {
    if (chart.indicators.refusal(indicator.type) === null) throw err;
  }
}

/** Remove a row's series as its legend remove button does: an indicator, a compared symbol, or a plain series. */
function removeSeries(chart: Chart, series: Series, indicator: Indicator | null): void {
  if (indicator) return indicator.remove();
  const compared = chart.compared.find((c) => c.series === series);
  if (compared) return compared.remove();
  // Its pane goes too once empty, as the legend's remove button does; removeSeries alone keeps it.
  const pane = series.pane;
  chart.removeSeries(series);
  const i = chart.panes.indexOf(pane);
  if (i > 0 && pane.series.length === 0 && !chart.drawingLayer?.getAll().some((d) => d.pane === i)) chart.removePane(pane);
}
