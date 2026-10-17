import { afterEach, describe, expect, it, vi } from 'vitest';
import { countingWebgl2, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { RECT_STRIDE } from '../src/gl/rect-batch';
import type { RenderStats } from '../src/render-stats';
import { formatBytes, statsLines } from '../src/stats-overlay';
import type { Bar, HeatmapData } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

const times = (n: number) => Array.from({ length: n }, (_, i) => i * 60);
const bar = (time: number, close = 1): Bar => ({ time, open: 1, high: 2, low: 0, close });

const heatmap = (rows = 4): HeatmapData => ({
  times: times(20),
  priceStart: 0,
  priceStep: 0.5,
  rows,
  values: new Float32Array(rows * 20).fill(1),
});

/** Fake WebGL that also records buffer uploads: whole (`bufferData`) or partial (`bufferSubData`), in bytes. */
function recordingGl() {
  const counting = countingWebgl2();
  const uploads: { kind: 'data' | 'sub'; bytes: number }[] = [];
  const context = new Proxy(counting.context as object, {
    get: (target, key) => {
      if (key === 'bufferData') {
        return (_t: number, data: ArrayBufferView | number) =>
          uploads.push({ kind: 'data', bytes: typeof data === 'number' ? data : data.byteLength });
      }
      if (key === 'bufferSubData') {
        return (_t: number, _offset: number, _src: ArrayBufferView, _srcOffset: number, length: number) =>
          uploads.push({ kind: 'sub', bytes: length });
      }
      return (target as Record<string | symbol, unknown>)[key];
    },
  });
  return { context, uploads };
}

function setup(renderStats = true) {
  const gl = recordingGl();
  const c = new Chart(fakeContainer({ webgl: gl.context }), { renderStats, timezone: 'UTC' });
  charts.push(c);
  // No tween, so an update writes its final bar in the next frame.
  c.addCandles({ animate: false }).setData(times(20).map((t) => bar(t)));
  return { c, uploads: gl.uploads };
}

/** Draw the dirty layers once; frames never run on their own under the fake DOM. */
const render = (c: Chart) => (c as unknown as { render(dt: number): boolean }).render(0);
const frame = (c: Chart) => {
  c.invalidate();
  render(c);
};

describe('render statistics', () => {
  it('are off by default and cost no clock reads or snapshots', () => {
    const { c } = setup(false);
    const listener = vi.fn();
    c.on('frame:render', listener);
    const now = vi.spyOn(performance, 'now');
    frame(c);
    expect(now).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(c.frameStats).toBeNull();
    expect((c as unknown as { renderer: { counters: unknown } }).renderer.counters).toBeNull();
  });

  it('report draw calls, instances and per-phase times for a scene frame', () => {
    const { c } = setup();
    const events: RenderStats[] = [];
    c.on('frame:render', (s) => events.push(s));
    frame(c);
    const stats = c.frameStats!;
    expect(events).toEqual([stats]);
    expect(stats.kind).toBe('scene');
    expect(stats.drawCalls).toBeGreaterThan(0);
    expect(stats.instances).toBeGreaterThanOrEqual(stats.drawCalls);
    for (const ms of Object.values(stats.times)) expect(ms).toBeGreaterThanOrEqual(0);
    const { autoscale, drawBottom, drawGL, drawTop, drawCursor, total } = stats.times;
    expect(total).toBeGreaterThanOrEqual(autoscale + drawBottom + drawGL + drawTop + drawCursor - 1e-9);
  });

  it('counts one partial upload of perBar × stride bytes after updating the last bar', () => {
    const { c, uploads } = setup();
    frame(c);
    uploads.length = 0;
    c.main!.update(bar(19 * 60, 1.5));
    frame(c);
    const stats = c.frameStats!;
    const perBar = (c.main as unknown as { perBar: number }).perBar;
    const bytes = perBar * RECT_STRIDE;
    expect(perBar).toBeGreaterThan(0);
    expect(uploads).toEqual([{ kind: 'sub', bytes }]);
    expect(stats.bufferUploads).toBe(1);
    expect(stats.bufferBytes).toBe(bytes);
    expect(stats.textureUploads).toBe(0);
  });

  it('reports a crosshair move as a crosshair-layer frame without GPU work', () => {
    const { c } = setup();
    frame(c);
    c.setCrosshair({ x: 20, y: 20, pane: 0 });
    render(c);
    const stats = c.frameStats!;
    expect(stats.kind).toBe('cursor');
    expect(stats.drawCalls).toBe(0);
    expect(stats.times.drawGL).toBe(0);
    expect(stats.times.drawTop).toBe(0);
    expect(stats.times.drawCursor).toBeGreaterThanOrEqual(0);
  });

  it('reports an overlay frame, which redraws the crosshair layer with it', () => {
    const { c } = setup();
    frame(c);
    c.invalidateOverlay();
    render(c);
    const stats = c.frameStats!;
    expect(stats.kind).toBe('overlay');
    expect(stats.drawCalls).toBe(0);
  });

  it('can be switched on and off at runtime', () => {
    const { c } = setup(false);
    c.applyOptions({ renderStats: true });
    frame(c);
    expect(c.frameStats).not.toBeNull();
    c.applyOptions({ renderStats: false });
    expect(c.frameStats).toBeNull();
    const now = vi.spyOn(performance, 'now');
    frame(c);
    expect(now).not.toHaveBeenCalled();
    c.applyOptions({ renderStats: true });
    expect(c.frameStats).toBeNull();
  });
});

describe('GPU memory', () => {
  it('counts batch buffers and heatmap textures, and returns to zero when every series is removed', () => {
    const { c } = setup(false);
    frame(c);
    const candles = c.gpuMemory();
    expect(candles.buffers).toBeGreaterThan(0);
    expect(candles.buffers % RECT_STRIDE).toBe(0);
    expect(candles.textures).toBe(0);

    const map = c.addHeatmap();
    map.setData(heatmap(4));
    frame(c);
    const withMap = c.gpuMemory();
    expect(withMap.textures).toBeGreaterThanOrEqual(4 * 20 * 4);
    expect(withMap.total).toBe(withMap.buffers + withMap.textures);

    const volume = c.addHistogram();
    volume.setData(times(20).map((time) => ({ time, value: 1 })));
    frame(c);
    expect(c.gpuMemory().buffers).toBeGreaterThan(candles.buffers);

    c.removeSeries(map);
    c.removeSeries(volume);
    c.removeSeries(c.main!);
    expect(c.gpuMemory()).toEqual({ buffers: 0, textures: 0, total: 0 });
  });

  it('tracks a heatmap texture reallocated to a new size', () => {
    const { c } = setup(false);
    const map = c.addHeatmap();
    map.setData(heatmap(4));
    frame(c);
    const small = c.gpuMemory().textures;
    map.setData(heatmap(64));
    frame(c);
    expect(c.gpuMemory().textures).toBeGreaterThan(small);
    c.removeSeries(map);
    expect(c.gpuMemory().textures).toBe(0);
  });

  it('snapshots carry the memory after the frame', () => {
    const { c } = setup();
    frame(c);
    expect(c.frameStats!.memory).toEqual(c.gpuMemory());
  });
});

describe('redraw reasons', () => {
  it('say what asked for each frame', () => {
    const { c } = setup();
    // The first frame also carries the requests of setting the chart up.
    frame(c);
    expect(c.frameStats!.reasons).toEqual(expect.arrayContaining(['host', 'series']));
    frame(c);
    expect(c.frameStats!.reasons).toEqual(['host']);

    c.main!.update(bar(19 * 60, 1.5));
    render(c);
    expect(c.frameStats!.reasons).toEqual(['series']);

    c.setBarSpacing(12);
    c.applyOptions({ crosshair: { labels: { price: false } } });
    render(c);
    expect(c.frameStats!.reasons).toEqual(['view', 'options']);

    c.setCrosshair({ x: 20, y: 20, pane: 0 });
    render(c);
    expect(c.frameStats!.reasons).toEqual(['crosshair']);
  });

  it('are not recorded while statistics are off', () => {
    const { c } = setup(false);
    c.invalidate();
    c.setBarSpacing(12);
    c.applyOptions({ renderStats: true });
    render(c);
    // Turning statistics on is itself an options change.
    expect(c.frameStats!.reasons).toEqual(['options']);
  });
});

/** Recording GL that also offers the timer query extension, with results the test releases. */
function timedGl(extension = true) {
  const recording = recordingGl();
  const DISJOINT = 0x8fbb;
  const RESULT = 0x8866;
  const AVAILABLE = 0x8867;
  const queries: { done: boolean; ns: number }[] = [];
  const begun: object[] = [];
  const state = { disjoint: false };
  const ext = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: DISJOINT };
  const context = new Proxy(recording.context as Record<string | symbol, unknown>, {
    get: (target, key) => {
      if (key === 'QUERY_RESULT') return RESULT;
      if (key === 'QUERY_RESULT_AVAILABLE') return AVAILABLE;
      if (key === 'getExtension') return (name: string) => (extension && name === 'EXT_disjoint_timer_query_webgl2' ? ext : null);
      if (key === 'createQuery') {
        return () => {
          const query = { done: false, ns: 0 };
          queries.push(query);
          return query;
        };
      }
      if (key === 'beginQuery') return (_target: number, query: object) => begun.push(query);
      if (key === 'getQueryParameter') return (query: { done: boolean; ns: number }, p: number) => (p === AVAILABLE ? query.done : query.ns);
      if (key === 'getParameter') {
        const base = target.getParameter as (p: number) => unknown;
        return (p: number) => (p === DISJOINT ? state.disjoint : base(p));
      }
      return target[key];
    },
  });
  return { context, queries, begun, state };
}

function timedSetup(options: { extension?: boolean; renderStats?: boolean; plugins?: [] } = {}) {
  const gl = timedGl(options.extension ?? true);
  const c = new Chart(fakeContainer({ webgl: gl.context }), { renderStats: options.renderStats ?? true, timezone: 'UTC', plugins: options.plugins });
  charts.push(c);
  c.addCandles({ animate: false }).setData(times(20).map((t) => bar(t)));
  return { c, ...gl };
}

describe('GPU timing', () => {
  it('reads results back on later frames without waiting, reusing queries', () => {
    const { c, queries, begun } = timedSetup();
    frame(c);
    const timed = begun.length;
    expect(timed).toBeGreaterThan(0);
    expect(c.frameStats!.gpuTime).toBeNull();
    for (const query of queries) Object.assign(query, { done: true, ns: 2_500_000 });
    frame(c);
    expect(begun).toHaveLength(timed + 1);
    expect(c.frameStats!.gpuTime).toBe(2.5);
    // Queries whose results came back time the next frames.
    const made = queries.length;
    frame(c);
    expect(queries).toHaveLength(made);
    expect(begun).toHaveLength(timed + 2);
  });

  it('drops results spoilt by a disjoint event', () => {
    const { c, queries, state } = timedSetup();
    frame(c);
    for (const query of queries) Object.assign(query, { done: true, ns: 9_000_000 });
    state.disjoint = true;
    frame(c);
    expect(c.frameStats!.gpuTime).toBeNull();
  });

  it('pauses while results are pending, and skips frames without GPU work', () => {
    const { c, begun } = timedSetup();
    for (let i = 0; i < 8; i++) frame(c);
    expect(begun).toHaveLength(4);
    c.setCrosshair({ x: 20, y: 20, pane: 0 });
    render(c);
    expect(begun).toHaveLength(4);
  });

  it('is null without the extension and never starts while statistics are off', () => {
    const missing = timedSetup({ extension: false });
    frame(missing.c);
    expect(missing.c.frameStats!.gpuTime).toBeNull();
    const off = timedSetup({ renderStats: false });
    frame(off.c);
    expect(off.begun).toHaveLength(0);
  });

  it('needs the statsOverlay() plugin, as the other statistics do, and says so once in development builds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { c, begun } = timedSetup({ plugins: [] });
    const listener = vi.fn();
    c.on('frame:render', listener);
    const now = vi.spyOn(performance, 'now');
    frame(c);
    frame(c);
    expect(begun).toHaveLength(0);
    expect(now).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(c.frameStats).toBeNull();
    expect(warn.mock.calls.filter(([m]) => String(m).includes('[stats-overlay-missing]'))).toHaveLength(1);
  });
});

/** A 2D context that accepts every call and records text and outlines. */
function recordingContext() {
  const texts: string[] = [];
  const outlines: number[][] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => {
      if (key === 'fillText') return (text: string) => texts.push(text);
      if (key === 'strokeRect') return (...args: number[]) => outlines.push(args);
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (key in target) return target[key];
      return () => {};
    },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  return { ctx, texts, outlines };
}

function overlaySetup(renderStatsOverlay: boolean | 'bounds', interactive = true, plugins?: []) {
  const c = new Chart(fakeContainer(), { renderStatsOverlay, interactive, timezone: 'UTC', plugins });
  charts.push(c);
  c.addCandles({ animate: false }).setData(times(20).map((t) => bar(t)));
  const internals = c as unknown as { cursorLayer: HTMLCanvasElement | null; top: HTMLCanvasElement };
  const layer = internals.cursorLayer ?? internals.top;
  const rec = recordingContext();
  layer.getContext = (() => rec.ctx) as unknown as HTMLCanvasElement['getContext'];
  return { c, ...rec };
}

const drewPanel = (texts: string[]) => texts.some((t) => t.startsWith('draws '));

describe('render statistics overlay', () => {
  it('draws the last frame on the crosshair layer and measures frames while on', () => {
    const { c, texts } = overlaySetup(true);
    frame(c);
    expect(c.frameStats).not.toBeNull();
    expect(texts.some((t) => t.startsWith('scene '))).toBe(true);
    expect(drewPanel(texts)).toBe(true);
    texts.length = 0;
    frame(c);
    expect(texts).toContain('why host');
    texts.length = 0;
    c.setCrosshair({ x: 20, y: 20, pane: 0 });
    render(c);
    expect(texts.some((t) => t.startsWith('cursor '))).toBe(true);
  });

  it('disappears when turned off at runtime and costs nothing afterwards', () => {
    const { c, texts } = overlaySetup(true);
    frame(c);
    c.applyOptions({ renderStatsOverlay: false });
    texts.length = 0;
    const now = vi.spyOn(performance, 'now');
    frame(c);
    expect(drewPanel(texts)).toBe(false);
    expect(now).not.toHaveBeenCalled();
    expect(c.frameStats).toBeNull();
  });

  it('draws and measures nothing without the statsOverlay() plugin', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { c, texts, outlines } = overlaySetup('bounds', true, []);
    frame(c);
    frame(c);
    expect(drewPanel(texts)).toBe(false);
    expect(outlines).toEqual([]);
    expect(c.frameStats).toBeNull();
  });

  it('outlines the panes and axis areas with bounds', () => {
    const plain = overlaySetup(true);
    frame(plain.c);
    const bounds = overlaySetup('bounds');
    frame(bounds.c);
    // The panel's own border; with bounds also the pane, the axis column and the time axis.
    expect(plain.outlines).toHaveLength(1);
    expect(bounds.outlines.length).toBeGreaterThanOrEqual(4);
  });

  it('samples drawing hit regions with bounds, and reuses them on crosshair-only frames', () => {
    const { c } = overlaySetup('bounds');
    c.drawings.add({ type: 'cross-line', pane: 0, points: [{ time: 5 * 60, price: 1 }], style: {} });
    const sample = vi.spyOn(c.drawings, 'hitRuns');
    frame(c);
    expect(sample).toHaveBeenCalledTimes(1);
    expect(sample.mock.results[0]!.value).not.toEqual([]);
    c.setCrosshair({ x: 20, y: 20, pane: 0 });
    render(c);
    expect(sample).toHaveBeenCalledTimes(1);
    frame(c);
    expect(sample).toHaveBeenCalledTimes(2);
    c.applyOptions({ renderStatsOverlay: true });
    frame(c);
    expect(sample).toHaveBeenCalledTimes(2);
  });

  it('draws over the overlay on a static chart, and stays out of screenshots', () => {
    const { c, texts } = overlaySetup(true, false);
    frame(c);
    expect(drewPanel(texts)).toBe(true);
    texts.length = 0;
    (c as unknown as { capture: object | null }).capture = {};
    frame(c);
    (c as unknown as { capture: object | null }).capture = null;
    expect(drewPanel(texts)).toBe(false);
  });
});

describe('statsLines', () => {
  it('formats bytes, a missing GPU time and no reasons', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    const { c } = setup();
    frame(c);
    const lines = statsLines({ ...c.frameStats!, gpuTime: null, reasons: [] });
    expect(lines[0]).toContain('gpu n/a');
    expect(lines.at(-1)).toBe('why -');
  });
});
