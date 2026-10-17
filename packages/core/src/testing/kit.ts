import type { Chart } from '../chart';
import type { CandleSeries, CustomSeries, HeatmapSeries, HistogramSeries, LineSeries, Series } from '../series';
import type { Bar, Time } from '../types';
import { seededRandom } from '../util/random';
import { dispatch, fakeContainer, fakeWindow, frames, installFakeDom, runFrame, size } from './environment';

/* ------------------------------ environment ------------------------------ */

/** Options of {@link installTestEnvironment}. */
export interface TestEnvironmentOptions {
  /** Size every element reports, css px. Default 800. */
  width?: number;
  /** Default 600. */
  height?: number;
  /** `window.devicePixelRatio`. Default 1. */
  devicePixelRatio?: number;
}

/** The environment {@link installTestEnvironment} installed. */
export interface TestEnvironment {
  /** A new element to create a chart in. */
  container(): HTMLElement;
  /** Put back the globals the environment replaced and drop pending frames. */
  uninstall(): void;
}

/** Globals the environment sets; `uninstall` restores them. */
const GLOBALS = ['document', 'window', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', '__fakeDom'];

/**
 * Install just enough DOM, Canvas2D and WebGL2 for a chart to run under Node,
 * without a browser or GPU. Drawing calls do nothing; layout, data, scales,
 * events and the frame loop work as in a browser. Frames run only through
 * `driveFrames` or `flushFrames`. Use it in a Node test environment, not a
 * DOM one (jsdom, happy-dom): it replaces `document` and `window` outright.
 *
 * @example
 * ```ts
 * import { createChart } from '@charton/core';
 * import { describeScene, flushFrames, installTestEnvironment, sampleBars } from '@charton/core/testing';
 *
 * const env = installTestEnvironment({ width: 960, height: 540 });
 * const chart = createChart(env.container());
 * chart.addCandles().setData(sampleBars({ count: 300, seed: 1 }));
 * flushFrames();
 * expect(describeScene(chart)).toMatchSnapshot();
 * chart.destroy();
 * env.uninstall();
 * ```
 */
export function installTestEnvironment(options: TestEnvironmentOptions = {}): TestEnvironment {
  const g = globalThis as Record<string, unknown>;
  const saved = GLOBALS.map((key) => [key, Object.getOwnPropertyDescriptor(g, key)] as const);
  delete g.__fakeDom;
  installFakeDom();
  size.width = options.width ?? 800;
  size.height = options.height ?? 600;
  fakeWindow.devicePixelRatio = options.devicePixelRatio ?? 1;
  return {
    container: () => fakeContainer(),
    uninstall() {
      frames.clear();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(g, key, descriptor);
        else delete g[key];
      }
    },
  };
}

/* --------------------------------- frames -------------------------------- */

/** Timestamp of the last frame run, so frame times only go forward across calls. */
let clock = 0;

/**
 * Run up to `count` frames (default 1), `step` ms apart (default 16): each
 * runs the frame callbacks pending at that moment, like a browser frame.
 * Stops early when nothing is pending. Returns how many frames ran.
 */
export function driveFrames(options: { count?: number; step?: number } = {}): number {
  const count = options.count ?? 1;
  const step = options.step ?? 16;
  let ran = 0;
  while (ran < count && frames.size > 0) {
    clock += step;
    runFrame(clock);
    ran++;
  }
  return ran;
}

/**
 * Run frames until none is pending: the chart has drawn and its animations
 * have settled. Throws after `max` frames (default 1000), e.g. for an
 * animation that never ends.
 */
export function flushFrames(max = 1000): number {
  const ran = driveFrames({ count: max });
  if (frames.size > 0) throw new Error(`Frames still pending after ${max}; something keeps animating`);
  return ran;
}

/** Settle the chart's data source loads (including ones a load starts), then its frames. */
export async function waitForData(chart: Chart): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const load = chart.data?.initialLoad;
    if (!load) break;
    await load.catch(() => {});
  }
  // Let follow-up work queued by the load (history pages, listeners) run.
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushFrames();
}

/* -------------------------------- pointer -------------------------------- */

/** Where and how {@link emitPointer} sends a pointer event. */
export interface PointerAt {
  /** `'move'` hovers (crosshair), `'click'` presses and releases in place, `'dblclick'` double-clicks, `'leave'` leaves the chart. */
  type: 'move' | 'click' | 'dblclick' | 'leave';
  time: Time;
  price: number;
  /** Default 0. */
  pane?: number;
}

/**
 * Send a mouse pointer event to `chart` at a time and price, as a user
 * would: the chart's own input handling runs, so `crosshair:move`,
 * `plot:click`, drawing tools and the rest react as in a browser. Returns
 * false when the point has no position (before layout, no data, a hidden
 * pane, a price a log scale cannot show).
 */
export function emitPointer(chart: Chart, at: PointerAt): boolean {
  const p = chart.coordinateFor(at.time, at.price, at.pane ?? 0);
  if (!p || p.y === null) return false;
  const rect = chart.root.getBoundingClientRect();
  const init = { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 0, clientX: rect.left + p.x, clientY: rect.top + p.y };
  switch (at.type) {
    case 'move':
      dispatch(chart.root, 'pointermove', init);
      break;
    case 'click':
      dispatch(chart.root, 'pointerdown', { ...init, buttons: 1 });
      dispatch(chart.root, 'pointerup', init);
      break;
    case 'dblclick':
      dispatch(chart.root, 'dblclick', init);
      break;
    case 'leave':
      dispatch(chart.root, 'pointerleave', init);
      break;
  }
  return true;
}

/* ---------------------------------- data --------------------------------- */

/** Options of {@link sampleBars}. */
export interface SampleBarsOptions {
  /** Default 200. */
  count?: number;
  /** Same seed, same bars. Default 1. */
  seed?: number;
  /** Seconds between bars. Default 60. */
  interval?: number;
  /** Time of the first bar, unix seconds. Default 2024-01-01 00:00 UTC. */
  start?: Time;
  /** Open of the first bar. Default 100. */
  price?: number;
}

/**
 * Deterministic OHLCV bars: a seeded random walk, prices rounded to cents, so
 * the same options give the same bars on every machine.
 */
export function sampleBars(options: SampleBarsOptions = {}): Bar[] {
  const count = options.count ?? 200;
  const interval = options.interval ?? 60;
  const start = options.start ?? 1704067200;
  const random = seededRandom(options.seed ?? 1);
  const cents = (v: number) => Math.round(v * 100) / 100;
  const bars: Bar[] = [];
  let close = options.price ?? 100;
  for (let i = 0; i < count; i++) {
    const open = close;
    close = cents(Math.max(0.01, open * (1 + (random() - 0.5) * 0.02)));
    const high = cents(Math.max(open, close) * (1 + random() * 0.005));
    const low = cents(Math.min(open, close) * (1 - random() * 0.005));
    bars.push({ time: start + i * interval, open, high, low, close, volume: Math.round(1000 + random() * 9000) });
  }
  return bars;
}

/* --------------------------------- scene --------------------------------- */

/** What {@link describeScene} reports: a plain, serialisable summary of a chart for snapshots. */
export interface SceneDescription {
  size: { width: number; height: number };
  barSpacing: number;
  /** Times at the edges of the visible bars, or null without bars. */
  visibleRange: { from: Time; to: Time } | null;
  panes: ScenePane[];
  drawings: { type: string; pane: number; points: { time: Time; price: number }[] }[];
  /** App-owned annotations in data coordinates; targets use pane/series indices, never generated ids. */
  annotations: {
    kind: 'marker' | 'trade' | 'price-line' | 'trade-line' | 'alert-line' | 'draft-line' | 'time-band' | 'price-zone' | 'text-label';
    pane: number;
    series: number | null;
    visible: boolean;
    /** Scalar options only: callbacks, images, series references and structured options are omitted. */
    options: Record<string, string | number | boolean | null>;
  }[];
}

/** One pane of a {@link SceneDescription}. */
export interface ScenePane {
  height: number;
  collapsed: boolean;
  scales: { id: string; side: string; mode: string; from: number; to: number }[];
  series: SceneSeries[];
}

/** One series of a {@link ScenePane}. */
export interface SceneSeries {
  kind: string;
  title: string;
  visible: boolean;
  scale: string;
  /** Aligned raw data items in the visible time range, before grouping; hidden/collapsed series report zero. Heatmaps and indicators count finite cells/plot outputs. */
  visiblePointCount: number;
  /** Raw values at the newest bar (or the crosshair's), as `chart.valuesAt` gives them. */
  values: Record<string, number> | null;
  /** The legend row as text. */
  legend: string | null;
}

/**
 * A stable, JSON-serialisable summary of what the chart shows, for snapshot
 * tests without pixels. Numbers are rounded to 6 significant digits, so tiny
 * floating-point differences between machines do not change it. Run the
 * frames first (`flushFrames`) so ranges are fitted.
 */
export function describeScene(chart: Chart): SceneDescription {
  const values = chart.valuesAt();
  const valuesOf = (series: unknown) => values?.series.find((v) => v.series === series);
  return {
    size: { width: chart.width, height: chart.height },
    barSpacing: round(chart.barSpacing),
    visibleRange: chart.getVisibleRange(),
    panes: chart.panes.map((pane, index) => ({
      height: round(pane.height),
      collapsed: pane.collapsed,
      scales: pane.scales.map((s) => {
        const range = chart.getPriceRange(index, s.id);
        return { id: s.id, side: s.side, mode: s.mode, from: round(range?.from ?? 0), to: round(range?.to ?? 0) };
      }),
      series: pane.series.map((s) => {
        const v = valuesOf(s);
        const legend = v?.legend;
        const title = (s.options as { title?: string }).title ?? '';
        return {
          kind: s.kind,
          title,
          visible: s.visible,
          scale: s.scale.id,
          visiblePointCount: visiblePointCount(chart, s),
          values: v?.values ? roundValues(v.values) : null,
          legend: legend ? [legend.title, ...legend.parts.map((p) => `${p.label ?? ''}${p.text}`)].filter(Boolean).join(' ') : null,
        };
      }),
    })),
    drawings: (chart.drawingLayer?.getAll() ?? []).map((d) => ({
      type: d.type,
      pane: d.pane,
      points: d.points.map((p) => ({ time: p.time, price: round(p.price) })),
    })),
    annotations: describeAnnotations(chart),
  };
}

function visiblePointCount(chart: Chart, series: Series): number {
  if (!series.visible || series.pane.collapsed) return 0;
  const { from, to } = chart.time.visibleRange();
  let count = 0;
  if (series.kind === 'indicator') {
    const indicator = chart.indicatorLayer?.getAll().find((item) => item.series === series);
    if (!indicator?.def) return 0;
    for (const plot of indicator.def.plots) {
      if (indicator.plotStyles[plot.id]?.visible === false) continue;
      const values = indicator.values[plot.id];
      if (!values) continue;
      for (let i = from; i <= Math.min(to, values.length - 1); i++) {
        if (Number.isFinite(values[i])) count++;
      }
    }
  } else if (isHeatmap(series)) {
    for (let i = from; i <= to; i++) {
      const cell = series.cellAt(i, series.grid.priceStart);
      if (!cell) continue;
      for (let row = 0; row < series.grid.rows; row++) {
        if (Number.isFinite(series.valueAt(cell.col, row))) count++;
      }
    }
  } else if (hasTimeData(series)) {
    for (const point of series.data) {
      const index = chart.timeline.slotOf(point.time);
      if (index >= from && index <= to && index >= 0) count++;
    }
  }
  return count;
}

// Narrow by the built-in kind, keeping series implementations out of this entry's runtime imports.
function isHeatmap(series: Series): series is HeatmapSeries {
  return series.kind === 'heatmap';
}

function hasTimeData(series: Series): series is CandleSeries | LineSeries | HistogramSeries | CustomSeries<{ time: Time }> {
  return series.kind === 'candles' || series.kind === 'line' || series.kind === 'histogram' || series.kind === 'custom';
}

function describeAnnotations(chart: Chart): SceneDescription['annotations'] {
  const layer = chart.annotationLayer;
  const out: SceneDescription['annotations'] = [];
  if (!layer) return out;
  const add = (kind: SceneDescription['annotations'][number]['kind'], options: object, series: Series | null = chart.main, visible = true) => {
    const pane = series ? chart.panes.indexOf(series.pane) : 0;
    out.push({
      kind,
      pane,
      series: series ? (chart.panes[pane]?.series.indexOf(series) ?? -1) : null,
      visible,
      options: scalarOptions(options, kind === 'time-band'),
    });
  };
  // The main series' default set is also returned when that series is passed explicitly.
  for (const marker of layer.getMarkers()) add('marker', marker);
  for (const pane of chart.panes) {
    for (const series of pane.series) {
      if (series === chart.main) continue;
      for (const marker of layer.getMarkers(series)) add('marker', marker, series);
    }
  }
  // Fills need the trading() plugin; a chart without it has none.
  if (chart.installedPlugins.includes('@charton/core/trading')) for (const trade of layer.getTrades()) add('trade', trade);
  const groups = [
    ['price-line', layer.priceLines], ['trade-line', layer.tradeLines],
    ['alert-line', layer.alertLines], ['draft-line', layer.draftLines],
    ['time-band', layer.timeBands], ['price-zone', layer.priceZones], ['text-label', layer.textLabels],
  ] as const;
  for (const [kind, items] of groups) {
    for (const item of items) add(kind, item.options, item.options.series ?? chart.main, item.visible);
  }
  return out;
}

function scalarOptions(options: object, timeBand: boolean): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(options).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (typeof value === 'number') {
      const time = key === 'time' || key.endsWith('Time') || (timeBand && (key === 'from' || key === 'to'));
      out[key] = Number.isFinite(value) ? (time ? Number(value.toFixed(6)) : round(value)) : null;
    } else if (typeof value === 'string' || typeof value === 'boolean' || value === null) out[key] = value;
  }
  return out;
}

function round(v: number): number {
  return Number.isFinite(v) ? Number(v.toPrecision(6)) : v;
}

function roundValues(values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(values).sort()) out[key] = round(values[key]!);
  return out;
}
