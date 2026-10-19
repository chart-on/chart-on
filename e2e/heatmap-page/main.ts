import { builtins, createChart, darkTheme, lightTheme, type CellReduce, type Chart, type HeatmapSeries } from '@chart-on/core';
import { seededRandom } from '@chart-on/core/internal';
import { sampleBars } from '@chart-on/core/testing';

/**
 * Heatmap scenes for ../heatmap.spec.ts and bench.ts, picked with `?scene=`:
 * - `probe`: one bright cell in a 2,000-row grid at 2 columns and 4 rows per
 *   device pixel, which `window.heatmapPage.probe` pans by sub-pixel offsets.
 * - `visual`: a seeded order-book-like grid under candles, zoomed out in a
 *   short pane, for the screenshot baselines.
 * - `bench`: a large grid filling the window, which `window.heatmapPage.bench`
 *   pans every frame while it times frames with GPU timer queries.
 * `?theme=light` picks the light theme, `?reduce=` the `cellReduce` mode.
 * Sets `data-done` on <html> when drawn, or `data-error` with the message when a scene throws.
 */

const params = new URLSearchParams(location.search);
const light = params.get('theme') === 'light';
const scene = params.get('scene') ?? 'probe';
const reduce = (params.get('reduce') ?? 'max') as CellReduce;
const num = (key: string, fallback: number) => Number(params.get(key) ?? fallback);

const DAY = 86400;
/** Grid lines off, so only the heatmap shows in the plot. */
const NO_GRID = { horizontal: { visible: false }, vertical: { visible: false } };
const PROBE = { cols: 400, rows: 2000, col: 200, row: 1000, rowsPerPx: 4, colsPerPx: 2, width: 480, height: 560 };

const frames = async (count = 3) => {
  for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
};

function mount(width: number, height: number, options: Parameters<typeof createChart>[1] = {}): Chart {
  const el = document.getElementById('chart')!;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  return createChart(el, {
    theme: light ? lightTheme : darkTheme,
    plugins: builtins(),
    // No eased view changes, so a frame shows the view just set.
    animateViewChanges: false,
    smoothScale: false,
    ...options,
  });
}

/** Where a probe lands, in css px from the page origin (device scale 1). */
export interface ProbeResult {
  /** The chart canvas's top-left corner; the shader's pixel grid starts there. */
  canvas: { x: number; y: number };
  plot: { x: number; y: number; width: number; height: number };
  /** Centres of the bright cells. */
  cells: Array<{ x: number; y: number }>;
  colsPerPx: number;
  rowsPerPx: number;
}

/** One frame's statistics, as bench.ts reads them. */
export interface BenchFrame {
  /** GPU ms of the frame, or null without a timer query result. */
  gpuTime: number | null;
  /** CPU ms of the chart's frame callback. */
  cpuTime: number;
  /** ms since the previous frame. */
  interval: number;
  /** Draw calls the chart made between this frame's query begin and end; 0 when it drew outside them. */
  draws: number;
}

export interface HeatmapPage {
  probe?(o: { reduce: CellReduce; col: number; row: number; pair?: boolean }): Promise<ProbeResult>;
  bench?(count: number): Promise<{ frames: BenchFrame[]; dropped: number; columns: number; rows: number; colsPerPx: number; rowsPerPx: number; renderer: string; glError: number }>;
}

const page: HeatmapPage = {};
(window as unknown as { heatmapPage: HeatmapPage }).heatmapPage = page;

/** Hidden candles give the chart its timeline; the heatmap's columns share their times. */
function timeline(chart: Chart, count: number, visible = false) {
  const bars = sampleBars({ count, interval: DAY, price: 1000 });
  const main = chart.addCandles({ title: 'SAMPLE' });
  main.setData(bars);
  main.setVisible(visible);
  return bars;
}

/** Value of the single bright cell, the top of the range; each of a pair holds `PAIR_VALUE`. */
const PROBE_VALUE = 100;
const PAIR_VALUE = 30;

function probeScene(): void {
  const { cols, rows, width, height } = PROBE;
  // `renderStats` for the `frame:render` event, so a probe waits for the draw it asked for.
  const chart = mount(width, height, { grid: NO_GRID, barSpacing: 1 / PROBE.colsPerPx, minBarSpacing: 0.05, rightOffset: 20, renderStats: true });
  const bars = timeline(chart, cols);
  const heat = chart.addHeatmap({ title: 'Probe', legend: false, colors: ['#000000', '#ff00ff'], range: { min: 0, max: PROBE_VALUE }, gap: 0, opacity: 1 });
  const times = bars.map((b) => b.time);
  // One bright cell, or two in neighbouring rows of one column, which share a pixel at 4 rows a pixel.
  const bright = (pair: boolean) => (pair ? [PROBE.row, PROBE.row + 1] : [PROBE.row]);
  let shownPair: boolean | null = null;
  const show = (pair: boolean) => {
    if (pair === shownPair) return;
    const values = new Float32Array(cols * rows);
    for (const row of bright(pair)) values[PROBE.col * rows + row] = pair ? PAIR_VALUE : PROBE_VALUE;
    heat.setData({ times, priceStart: 0, priceStep: 1, rows, values });
    shownPair = pair;
  };
  chart.setAutoScale(false, 0);
  const price = chart.panes[0]!.price;
  const canvasRect = () => document.querySelector('#chart canvas')!.getBoundingClientRect();
  const cellX = () => canvasRect().left + chart.plotLeft + chart.time.indexToX(PROBE.col);
  const cellY = (row: number) => canvasRect().top + chart.panes[0]!.top + price.priceToY(row + 0.5);
  /** Price range for a pan of `row` rows: 4 rows a pixel, the bright row near the middle. */
  const setRows = (row: number) => {
    const span = price.height * PROBE.rowsPerPx;
    price.setRange(PROBE.row - span / 2 + row, PROBE.row + span / 2 + row, false);
  };
  const frac = (v: number) => v - Math.floor(v);
  // Pans that put the cell's centre 1/8 px into a pixel across and 17/32 px down, set on the
  // first probe once the chart is laid out. The offsets then step it by quarter and sixteenth
  // pixels, so it never sits on a pixel edge (the pixel it counts in is never ambiguous) and
  // crosses one in each axis. At the base offset the pair's second centre, a quarter pixel
  // away, is in the same pixel.
  let base: { col: number; row: number } | null = null;
  const align = () => {
    const col0 = chart.time.rightOffset;
    const x0 = cellX();
    // A larger right offset moves bars left by `barSpacing` css px per bar.
    const col = col0 + frac(x0 - 1 / 8) / chart.time.barSpacing;
    setRows(0);
    const y0 = cellY(PROBE.row);
    setRows(1);
    const yPerRow = cellY(PROBE.row) - y0;
    return { col, row: frac(17 / 32 - frac(y0)) / yPerRow };
  };
  const drawn = () => new Promise<void>((resolve) => {
    const off = chart.on('frame:render', (stats) => {
      if (stats.kind !== 'scene') return;
      off();
      resolve();
    });
  });

  page.probe = async ({ reduce, col, row, pair = false }) => {
    base ??= align();
    heat.applyOptions({ cellReduce: reduce });
    show(pair);
    setRows(base.row + row);
    chart.time.rightOffset = base.col + col;
    const frame = drawn();
    chart.invalidate();
    await frame;
    const canvas = canvasRect();
    const top = chart.panes[0]!.top;
    return {
      canvas: { x: canvas.left, y: canvas.top },
      plot: { x: canvas.left + chart.plotLeft, y: canvas.top + top, width: chart.plotWidth, height: chart.panes[0]!.height },
      cells: bright(pair).map((r) => ({ x: cellX(), y: cellY(r) })),
      colsPerPx: 1 / chart.time.barSpacing,
      rowsPerPx: (price.maxPrice - price.minPrice) / price.height,
    };
  };
}

/**
 * Order-book-like columns: resting levels one row tall at fixed prices near
 * the price, each living a few dozen to a few hundred bars, plus a faint band
 * around the close. In a short pane many rows share a pixel, so a
 * point-sampled view loses most levels where max keeps them.
 */
function bookValues(bars: { close: number }[], rows: number, priceStart: number, priceStep: number, seed: number): Float32Array {
  const random = seededRandom(seed);
  const values = new Float32Array(bars.length * rows);
  const spawn = (close: number) => ({ row: Math.floor((close * (1 + (random() - 0.5) * 0.25) - priceStart) / priceStep), size: 5 + random() ** 3 * 95, life: 30 + Math.floor(random() * 300) });
  const levels = Array.from({ length: 40 }, () => spawn(bars[0]!.close));
  bars.forEach((bar, c) => {
    levels.forEach((l, i) => {
      if (l.life-- <= 0) levels[i] = l = spawn(bar.close);
      if (l.row >= 0 && l.row < rows) values[c * rows + l.row]! += l.size * (0.8 + random() * 0.4);
    });
    const mid = (bar.close - priceStart) / priceStep;
    for (let r = Math.max(0, Math.floor(mid - 30)); r < Math.min(rows, mid + 30); r++) values[c * rows + r]! += 3 * random();
  });
  return values;
}

function addBook(chart: Chart, bars: { time: number; close: number }[], rows: number, options: Partial<{ reduce: CellReduce; memoryBudget: number }> = {}): HeatmapSeries {
  const closes = bars.map((b) => b.close);
  const lo = Math.min(...closes) * 0.8;
  const hi = Math.max(...closes) * 1.2;
  const priceStep = (hi - lo) / rows;
  const heat = chart.addHeatmap({ title: 'Book', cellReduce: options.reduce ?? reduce, memoryBudget: options.memoryBudget });
  heat.setData({ times: bars.map((b) => b.time), priceStart: lo, priceStep, rows, values: bookValues(bars, rows, lo, priceStep, 7) });
  return heat;
}

async function visualScene(): Promise<void> {
  // Short pane: about 4 rows of the 1,600-row grid per device px, and 600 bars at under a px each.
  const chart = mount(480, 200, { minBarSpacing: 0.05 });
  const bars = timeline(chart, 600, true);
  addBook(chart, bars, 1600);
  chart.fitContent(false);
  chart.setAutoScale(false, 0);
  const lows = bars.map((b) => b.low);
  const highs = bars.map((b) => b.high);
  chart.panes[0]!.price.setRange(Math.min(...lows) * 0.97, Math.max(...highs) * 1.03, false);
  await frames();
}

async function benchScene(): Promise<void> {
  // Device px per column and rows per device px come from the query, so cases are easy to vary.
  const colsPerPx = num('colsPerPx', 2);
  const rowsPerPx = num('rowsPerPx', 8);
  const rows = num('rows', 2000);
  const width = num('width', 1600);
  const cols = Math.ceil(width * devicePixelRatio * colsPerPx) + 200;
  const chart = mount(width, num('height', 300), {
    grid: NO_GRID,
    barSpacing: 1 / (colsPerPx * devicePixelRatio),
    minBarSpacing: 0.01,
    rightOffset: 0,
  });
  const bars = timeline(chart, cols);
  const heat = addBook(chart, bars, rows, { memoryBudget: num('memoryBudget', 256 * 2 ** 20) });
  await frames();
  chart.setAutoScale(false, 0);
  const price = chart.panes[0]!.price;
  const { priceStart, priceStep } = heat.grid;
  const span = rowsPerPx * price.height * devicePixelRatio * priceStep;
  const mid = priceStart + (rows / 2) * priceStep;
  const [lo, hi] = [mid - span / 2, mid + span / 2];
  price.setRange(lo, hi, false);
  const probeGl = document.createElement('canvas').getContext('webgl2');
  const info = probeGl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = probeGl && info ? String(probeGl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  // The chart's own WebGL2 context: the one canvas of the chart that has it.
  const gl = [...document.querySelectorAll('#chart canvas')]
    .map((c) => (c as HTMLCanvasElement).getContext('webgl2'))
    .find((c): c is WebGL2RenderingContext => c !== null);
  const timer = gl?.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null | undefined;

  // Count the chart's draw calls, so a timed frame the chart did not draw in can be dropped.
  let draws = 0;
  if (gl) {
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'] as const) {
      const draw = gl[name].bind(gl) as (...args: unknown[]) => void;
      (gl as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        draws++;
        draw(...args);
      };
    }
  }

  /**
   * Pans by sub-pixel steps until `count` frames are timed. Each frame is wrapped in a GPU
   * timer query of our own, begun in a frame callback queued before the chart's and ended in
   * one queued after it, so it times all the chart's GPU work in that frame and works the
   * same on any version of the chart (its own timer, `renderStats`, stays off). When the
   * chart's callback was already queued before ours (a redraw it asked for itself), it draws
   * before the query begins: such frames have no draw calls inside the query and are dropped.
   */
  page.bench = async (count) => {
    const out: BenchFrame[] = [];
    let dropped = 0;
    const pending: Array<{ query: WebGLQuery; frame: BenchFrame }> = [];
    const collect = () => {
      while (gl && timer && pending.length > 0 && gl.getQueryParameter(pending[0]!.query, gl.QUERY_RESULT_AVAILABLE)) {
        const { query, frame } = pending.shift()!;
        if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) frame.gpuTime = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(query);
      }
    };
    const start = chart.time.rightOffset;
    let last = performance.now();
    for (let i = 0; out.length < count && i < count * 3; i++) {
      const frame: BenchFrame = { gpuTime: null, cpuTime: 0, interval: 0, draws: 0 };
      let begun = 0;
      requestAnimationFrame((now) => {
        frame.interval = now - last;
        last = now;
        begun = performance.now();
        draws = 0;
        if (!gl || !timer) return;
        const query = gl.createQuery();
        gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
        pending.push({ query, frame });
      });
      // Sub-pixel pans in both axes, so every frame redraws the grid somewhere new.
      chart.time.rightOffset = start + (i % 40) * 0.37;
      const shift = ((i % 13) / 13) * priceStep * 3;
      price.setRange(lo + shift, hi + shift, false);
      chart.invalidate();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          if (gl && timer) gl.endQuery(timer.TIME_ELAPSED_EXT);
          frame.cpuTime = performance.now() - begun;
          frame.draws = draws;
          resolve();
        }),
      );
      if (frame.draws > 0) out.push(frame);
      else dropped++;
      collect();
    }
    for (let i = 0; i < 30 && pending.length > 0; i++) {
      await new Promise(requestAnimationFrame);
      collect();
    }
    return {
      frames: out,
      dropped,
      columns: heat.grid.cols,
      rows: heat.grid.rows,
      colsPerPx: 1 / (chart.time.barSpacing * devicePixelRatio),
      rowsPerPx: (price.maxPrice - price.minPrice) / priceStep / (price.height * devicePixelRatio),
      renderer,
      glError: gl ? gl.getError() : -1,
    };
  };
  await frames();
}

async function run(): Promise<void> {
  if (scene === 'probe') probeScene();
  else if (scene === 'visual') await visualScene();
  else if (scene === 'bench') await benchScene();
  await frames();
}

run().then(
  () => {
    document.documentElement.dataset.done = '';
  },
  (error: unknown) => {
    document.documentElement.dataset.error = error instanceof Error ? error.message : String(error);
  },
);
