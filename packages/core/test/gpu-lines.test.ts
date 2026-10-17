import { afterEach, describe, expect, it, vi } from 'vitest';
import { countingWebgl2, fakeContainer, recordingWebgl2, type CountingGl } from './fake-dom';
import { Chart } from '../src/chart';
import { LineBatch } from '../src/gl/line-batch';
import { strokeGpu, type CandleSeries, type CandleSeriesOptions, type CandleStyle, type LineSeries, type LineSeriesOptions, type PaneEnv } from '../src/series';
import type { RenderBackend } from '../src/gl/backend';
import type { PriceScale } from '../src/scales';
import type { IndicatorAddOptions } from '../src/indicators/manager';
import type { BarArrays, IndicatorDef } from '../src/indicators/types';
import { resetOptionWarnings } from '../src/util/options-check';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

/** The batch's vertices as [index, value, arc, flag] rows, values with the base added back. */
function vertices(batch: LineBatch): number[][] {
  const f = new Float32Array(batch.bytes.buffer, batch.bytes.byteOffset, batch.count * 4);
  return Array.from({ length: batch.count }, (_, i) => {
    const [index, value, arc, flag] = f.subarray(i * 4, i * 4 + 4);
    return [index!, flag ? value! + batch.base : 0, arc!, flag!];
  });
}

const SIMPLE = { step: false, breakGaps: false };

function build(batch: LineBatch, points: [number, number][], shape = SIMPLE, from = 0): void {
  batch.build(points.length, (k) => points[k]![0], (k) => points[k]![1], shape, from);
}

describe('LineBatch', () => {
  it('builds a band with the lower line in the arc slot, and a gap where either line has none', () => {
    const batch = new LineBatch();
    const upper = [10, 12, 13, NaN, 15];
    const lower = [5, NaN, 6, 7, 8];
    batch.buildBand(5, (k) => k, (k) => upper[k]!, (k) => lower[k]!);
    const f = new Float32Array(batch.bytes.buffer, batch.bytes.byteOffset, batch.count * 4);
    const rows = Array.from({ length: batch.count }, (_, i) => f.subarray(i * 4, i * 4 + 4));
    expect(rows.map(([index, value, low, flag]) => (flag ? [index, value! + batch.base, low! + batch.base] : 'break'))).toEqual([
      'break', [0, 10, 5], 'break', [2, 13, 6], 'break', [4, 15, 8], 'break',
    ]);
  });

  it('stores points by index and value, with runs between break vertices', () => {
    const batch = new LineBatch();
    build(batch, [[0, 10], [1, 12], [2, NaN], [3, 11], [4, 13]]);
    expect(batch.base).toBe(10);
    expect(vertices(batch)).toEqual([
      [0, 0, 0, 0],
      [0, 10, 0, 1],
      [1, 12, 0, 1],
      [0, 0, 0, 0],
      [3, 11, 0, 1],
      [4, 13, 0, 1],
      [0, 0, 0, 0],
    ]);
  });

  it('breaks at index gaps with breakGaps, and adds the held level of step lines', () => {
    const batch = new LineBatch();
    build(batch, [[0, 1], [1, 2], [3, 2], [4, 5]], { step: true, breakGaps: true });
    expect(vertices(batch).map(([i, v, , f]) => (f ? [i, v] : 'break'))).toEqual([
      'break', [0, 1], [1, 1], [1, 2], 'break', [3, 2], [4, 2], [4, 5], 'break',
    ]);
  });

  it('adds no held level where a step line moves at one index, as in a grouped column', () => {
    const batch = new LineBatch();
    build(batch, [[0, 1], [1.5, 3], [1, 5], [1, 2], [1, 4], [3, 4]], { step: true, breakGaps: false });
    expect(vertices(batch).map(([i, v, , f]) => (f ? [i, v] : 'break'))).toEqual([
      'break', [0, 1], [1.5, 1], [1.5, 3], [1, 3], [1, 5], [1, 2], [1, 4], [3, 4], 'break',
    ]);
  });

  it('rewrites only the tail on a partial build', () => {
    const batch = new LineBatch();
    const points: [number, number][] = [[0, 1], [1, 2], [2, 3]];
    build(batch, points);
    batch.dirtyFrom = Infinity;
    batch.dirtyTo = 0;
    points[2] = [2, 4];
    points.push([3, 5]);
    build(batch, points, SIMPLE, 2);
    expect(batch.dirtyFrom).toBe(3);
    expect(vertices(batch).slice(1, -1).map(([i, v]) => [i, v])).toEqual([[0, 1], [1, 2], [2, 4], [3, 5]]);
    // A new shape rebuilds everything.
    build(batch, points, { step: true, breakGaps: false }, 3);
    expect(batch.dirtyFrom).toBe(0);
  });

  it('maps points to the vertex range holding them and a neighbour either side', () => {
    const batch = new LineBatch();
    build(batch, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
    // Vertices: break, p0..p4 at 1..5, break.
    expect(batch.vertexRange(2, 3)).toEqual([2, 5]);
    expect(batch.vertexRange(0, 5)).toEqual([1, 6]);
  });

  it('measures the arc on screen from an origin, running on across segments and restarting after a break', () => {
    const batch = new LineBatch();
    const points: [number, number][] = Array.from({ length: 40 }, (_, i) => [i, i === 20 ? NaN : (i % 2) * 3]);
    build(batch, points);
    const xOf = (i: number) => i * 4;
    const yOf = (v: number) => v * 10;
    const origin = batch.vertexOf(8);
    batch.measure(0, origin, batch.count, xOf, yOf, 7);
    const rows = vertices(batch);
    expect(rows[origin]![2]).toBe(0);
    for (let i = 1; i < rows.length; i++) {
      const [x0, v0, arc0, f0] = rows[i - 1]!;
      const [x1, v1, arc1, f1] = rows[i]!;
      if (!f0 || !f1) continue;
      // Each vertex's arc is the previous one's plus the segment's length on screen, modulo the period.
      const d = Math.hypot(xOf(x1!) - xOf(x0!), yOf(v1!) - yOf(v0!));
      const gap = (((arc1! - arc0! - d) % 7) + 7) % 7;
      expect(Math.min(gap, 7 - gap)).toBeLessThan(1e-3);
    }
    // The run after the break starts its own pattern.
    expect(rows[batch.vertexOf(21)]![2]).toBe(0);
  });

  it('keeps its vertices when the indices shift, and projects, extends and measures them at the shifted index', () => {
    const batch = new LineBatch();
    const points: [number, number][] = [[0, 1], [1, 2], [2, 3]];
    build(batch, points);
    // The timeline grew by 5 at the front: the same points now sit at 5, 6 and 7.
    batch.indexShift += 5;
    points.forEach((p) => (p[0] += 5));
    points.push([8, 4]);
    build(batch, points, SIMPLE, 3);
    expect(vertices(batch).slice(1, -1).map(([i]) => i! + batch.indexShift)).toEqual([5, 6, 7, 8]);

    let x: readonly [number, number] = [0, 0];
    const backend = { drawLine: (_b: LineBatch, _f: number, _e: number, u: { x: readonly [number, number] }) => (x = u.x) };
    const time = { xTransform: (): [number, number] => [4, 10], indexToX: (i: number) => i * 4 + 10 };
    const scale = { yTransform: (): [number, number] => [1, 0], isLog: false, priceToY: (v: number) => v };
    const env = { time } as unknown as PaneEnv;
    strokeGpu(backend as unknown as RenderBackend, env, scale as unknown as PriceScale, batch, 1, batch.count - 1, 1, {
      lineWidth: 1,
      lineStyle: 'dashed',
      step: false,
      color: '#000',
    });
    const [index, , arc] = vertices(batch)[2]!;
    expect(index! * x[0] + x[1]).toBe(time.indexToX(6));
    // One segment from index 5 to 6 on screen: 4 px across, 1 px down.
    expect(arc).toBeCloseTo(Math.hypot(4, 1), 5);

    // A full rebuild stores the indices as they are.
    build(batch, points);
    expect(batch.indexShift).toBe(0);
    expect(vertices(batch)[1]![0]).toBe(5);
  });

  it('prepends points in its front headroom, matching a full build, and keeps the other vertices in place', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // Absolute indices with the shift added back, breaks as 0; values exact in float32.
    const decoded = (b: LineBatch) => vertices(b).map(([i, v, , f]) => (f ? [i! + b.indexShift, v] : 0));
    for (const shape of [SIMPLE, { step: true, breakGaps: false }, { step: false, breakGaps: true }, { step: true, breakGaps: true }]) {
      for (let run = 0; run < 25; run++) {
        // Points with gaps in their indices and missing values, on a timeline that grows at the front.
        const all: [number, number][] = [];
        for (let k = 0, index = 0; k < 40; k++, index += random() < 0.2 ? 2 : 1) {
          all.push([index, random() < 0.15 ? NaN : Math.floor(random() * 4)]);
        }
        const batch = new LineBatch();
        let points = all.slice(30);
        build(batch, points, shape);
        // Bars the timeline gained at the front so far: every index moves up by it.
        let shift = 0;
        for (const page of [8, 1, 0, 21]) {
          // The first one or two points may be replaced, as when a page also brings in the item before them.
          const dropped = Math.min(Math.floor(random() * 3), points.length - 2);
          const start = all.length - points.length;
          const next = all.slice(start - page);
          const old = batch.storage.slice((batch.head + batch.vertexOf(dropped + 1)) * 16, (batch.head + batch.count) * 16);
          const capacity = batch.capacity;
          shift += page;
          batch.indexShift += page;
          batch.markClean();
          expect(batch.prepend(page + dropped, dropped, (k) => next[k]![0] + shift, (k) => next[k]![1])).toBe(true);
          const fresh = new LineBatch();
          build(fresh, next.map(([i, v]) => [i + shift, v]), shape);
          expect(decoded(batch)).toEqual(decoded(fresh));
          for (let k = 0; k <= next.length; k++) expect(batch.vertexOf(k)).toBe(fresh.vertexOf(k));
          // The kept vertices did not move in storage, and unless it grew, only the front changed (nothing with no change).
          const kept = batch.vertexOf(page + dropped + 1);
          expect(batch.storage.slice((batch.head + kept) * 16, (batch.head + batch.count) * 16)).toEqual(old);
          if (batch.capacity === capacity) expect([batch.dirtyFrom, batch.dirtyTo]).toEqual(page + dropped ? [0, kept] : [Infinity, 0]);
          points = next;
        }
      }
    }
  });
});

interface Instanced {
  instances: number;
  /** 'line' or 'fill' for the segment programs, else 'other'. */
  program: string;
}

/** A counting context that also records instanced draws (with the program drawing) and uniform values. */
function recordingGl(): CountingGl & { draws: Instanced[]; uniforms: unknown[][] } {
  const counting = countingWebgl2();
  const draws: Instanced[] = [];
  const uniforms: unknown[][] = [];
  const sources = new Map<unknown, string>();
  const programs = new Map<unknown, string>();
  let current = 'other';
  const context = new Proxy(counting.context as Record<string, unknown>, {
    get: (target, key) => {
      if (key === 'shaderSource') return (shader: unknown, source: string) => sources.set(shader, source);
      if (key === 'attachShader') {
        return (program: unknown, shader: unknown) => {
          const source = sources.get(shader) ?? '';
          if (source.includes('beforeVertex')) programs.set(program, 'fill');
          else if (source.includes('firstDraws')) programs.set(program, 'line');
        };
      }
      if (key === 'useProgram') return (program: unknown) => (current = programs.get(program) ?? 'other');
      if (key === 'drawArraysInstanced') {
        return (_mode: number, _first: number, _count: number, instances: number) => draws.push({ instances, program: current });
      }
      if (typeof key === 'string' && key.startsWith('uniform')) return (...args: unknown[]) => uniforms.push([key, ...args.slice(1)]);
      return target[key as string];
    },
  });
  return { ...counting, context, draws, uniforms };
}

const programsDrawn = (draws: Instanced[]) => draws.map((d) => d.program);

interface Call {
  name: string;
  strokeStyle: unknown;
  fillStyle: unknown;
}

/** A 2D context recording each call with the stroke and fill styles at the time. */
function recorder() {
  const calls: Call[] = [];
  let strokeStyle: unknown;
  let fillStyle: unknown;
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, key: string) => {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      return () => calls.push({ name: key, strokeStyle, fillStyle });
    },
    set: (_t, key: string, value) => {
      if (key === 'strokeStyle') strokeStyle = value;
      if (key === 'fillStyle') fillStyle = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff'];

function setup(options: Partial<LineSeriesOptions> = {}) {
  const gl = recordingGl();
  const c = new Chart(fakeContainer({ webgl: gl.context }));
  charts.push(c);
  // The main series sets the view the lines draw in.
  c.addCandles().setData(Array.from({ length: 300 }, (_, i) => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 })));
  const lines = COLORS.map((color, n) => {
    const s = c.addLine({ color, ...options });
    s.setData(Array.from({ length: 300 }, (_, i) => ({ time: i * 60, value: 100 + Math.sin(i / 7 + n) * 10 })));
    return s;
  });
  return { c, gl, lines };
}

const internals = (c: Chart) =>
  c as unknown as { render(dt: number): boolean; ctx(canvas: unknown): CanvasRenderingContext2D };

/** Run a frame, optionally with the 2D layer drawing into `ctx`. */
function frame(c: Chart, scene: boolean, ctx?: CanvasRenderingContext2D): void {
  if (ctx) internals(c).ctx = () => ctx;
  if (scene) c.invalidate();
  else c.invalidateOverlay();
  internals(c).render(0);
}

const lineStrokes = (calls: Call[]) => calls.filter((call) => call.name === 'stroke' && COLORS.includes(String(call.strokeStyle)));

describe('GPU line series', () => {
  it('issues no 2D strokes for series lines on scene frames or crosshair moves', () => {
    const { c, gl } = setup({ renderer: 'gpu' });
    const { ctx, calls } = recorder();
    frame(c, true, ctx);
    // One instanced draw per line (after the candles' one), each with a segment per vertex pair.
    const lineDraws = gl.draws.slice(1);
    expect(lineDraws.length).toBe(COLORS.length);
    expect(lineDraws.every((d) => d.instances > 0)).toBe(true);
    c.setCrosshair({ x: 200, y: 100, pane: 0 });
    frame(c, false, ctx);
    expect(lineStrokes(calls)).toEqual([]);
  });

  it('strokes on the GPU by default, and on the canvas when opted out', () => {
    const { c, gl, lines } = setup();
    const { ctx, calls } = recorder();
    frame(c, true, ctx);
    expect(lineStrokes(calls)).toEqual([]);
    expect(gl.draws.length).toBe(1 + COLORS.length); // the candles, then a draw per line

    const before = gl.live().buffer;
    for (const s of lines) s.applyOptions({ renderer: 'canvas' });
    calls.length = 0;
    frame(c, true, ctx);
    expect(lineStrokes(calls).length).toBe(COLORS.length);
    // Their vertex buffers are let go.
    expect(gl.live().buffer).toBe(before - COLORS.length);
  });

  it('keeps curved lines on the canvas, and fills areas on the GPU below their line', () => {
    const { c, gl, lines } = setup({ renderer: 'gpu' });
    lines[0]!.applyOptions({ lineType: 'curved' });
    lines[1]!.applyOptions({ area: true });
    const { ctx, calls } = recorder();
    frame(c, true, ctx);
    expect(programsDrawn(gl.draws)).toEqual(['other', 'fill', 'line', 'line', 'line', 'line']);
    expect(lineStrokes(calls).map((call) => call.strokeStyle)).toEqual(['#ff0000']);
    // The area's gradient is not painted on the canvas either.
    expect(calls.filter((call) => call.name === 'fill' && typeof call.fillStyle === 'object')).toEqual([]);
  });

  it('fills an area down to the pane bottom, and a baseline to its base with the colours split there', () => {
    const { c, gl, lines } = setup({ renderer: 'gpu', area: true });
    lines.slice(1).forEach((s) => c.removeSeries(s));
    const s = lines[0]!;
    frame(c, true);
    const fillUniforms = () => {
      // The fill program's own uniforms come after its six projection ones: band, level, pane, top, bottom, split.
      const at = gl.uniforms.findIndex((u) => u[0] === 'uniform1i');
      return gl.uniforms.slice(at, at + 6);
    };
    const height = c.panes[0]!.height;
    let [band, level, , top, bottom, split] = fillUniforms();
    expect(band).toEqual(['uniform1i', 0]);
    expect(level).toEqual(['uniform1f', height]);
    // Red, from 0.28 alpha at the top of the pane to clear at the bottom.
    expect((top![1] as number[]).map((v) => +v.toFixed(2))).toEqual([1, 0, 0, 0.28, 1, 0, 0, 0]);
    expect(bottom).toEqual(top);
    expect(split).toEqual(['uniform1f', 1e30]);

    s.applyOptions({ baseline: 100, aboveColor: '#00ff00', belowColor: '#0000ff' });
    gl.uniforms.length = 0;
    frame(c, true);
    [band, level, , top, bottom, split] = fillUniforms();
    const y = s.scale.priceToY(100);
    expect(level![1]).toBeCloseTo(y, 6);
    expect(split![1]).toBeCloseTo(y, 6);
    expect((top![1] as number[]).map((v) => +v.toFixed(2))).toEqual([0, 1, 0, 0.28, 0, 1, 0, 0.05]);
    expect((bottom![1] as number[]).map((v) => +v.toFixed(2))).toEqual([0, 0, 1, 0.05, 0, 0, 1, 0.28]);
  });

  it('passes the dash, join and baseline split to the shader', () => {
    const { c, gl, lines } = setup({ renderer: 'gpu' });
    lines.slice(1).forEach((s) => c.removeSeries(s));
    lines[0]!.applyOptions({ lineStyle: 'dashed', lineType: 'step', lineWidth: 2, baseline: 100 });
    frame(c, true);
    const last = (name: string) => [...gl.uniforms].reverse().find((u) => u[0] === name);
    // Dashed at width 2: 6 on, 4 off (css px), at the fake device pixel ratio of 1.
    expect(last('uniform2f')).toEqual(['uniform2f', 6, 4]);
    expect(last('uniform1i')).toEqual(['uniform1i', 1]);
    const split = last('uniform1f');
    expect(split?.[1]).toBeCloseTo(lines[0]!.scale.priceToY(100), 6);
  });

  it('uploads nothing when the view moves, and only the new tail on a live update', () => {
    const gl = recordingWebgl2();
    const c = new Chart(fakeContainer({ webgl: gl.context }));
    charts.push(c);
    const bars = Array.from({ length: 300 }, (_, i) => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 }));
    c.addCandles().setData(bars);
    const s = c.addLine({ renderer: 'gpu' });
    s.setData(bars.map((b, i) => ({ time: b.time, value: 100 + (i % 9) })));
    frame(c, true);
    gl.uploads.length = 0;
    expect(c.setVisibleTimeRange(100 * 60, 200 * 60, false)).toBe(true);
    frame(c, true);
    expect(gl.uploads).toEqual([]);
    s.update({ time: 299 * 60, value: 50 });
    frame(c, true);
    // The last point's vertex and the trailing break.
    expect(gl.uploads).toEqual([{ kind: 'sub', offset: 300 * 16, bytes: 2 * 16 }]);
  });

  it('keeps its vertices when the timeline grows at the front under the same points', () => {
    const gl = recordingGl();
    const c = new Chart(fakeContainer({ webgl: gl.context }));
    charts.push(c);
    const data = Array.from({ length: 300 }, (_, i) => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 + (i % 7) }));
    const main = c.addCandles();
    main.setData(data.slice(100));
    c.addLine().setData(data.slice(100).map((b) => ({ time: b.time, value: b.close })));
    frame(c, true);
    const build = vi.spyOn(LineBatch.prototype, 'build');
    expect(main.prependBars(data.slice(0, 100))).toBe(true);
    frame(c, true);
    expect(build).not.toHaveBeenCalled();
  });

  it('writes the older points a history page brings into view at the right bars', () => {
    const gl = recordingGl();
    const c = new Chart(fakeContainer({ webgl: gl.context }));
    charts.push(c);
    const data = Array.from({ length: 300 }, (_, i) => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 + (i % 7) }));
    const main = c.addCandles();
    main.setData(data.slice(100));
    // The line has points before the first bar: they align once those bars arrive. Its vertex batch is the one it builds first.
    const build = vi.spyOn(LineBatch.prototype, 'build');
    c.addLine().setData(data.map((b) => ({ time: b.time, value: b.close })));
    frame(c, true);
    const live = build.mock.contexts[0] as LineBatch;
    expect(main.prependBars(data.slice(0, 100))).toBe(true);
    frame(c, true);
    // The same vertices as a line built with every bar there, at the same timeline indices.
    const fresh = new Chart(fakeContainer({ webgl: recordingGl().context }));
    charts.push(fresh);
    fresh.addCandles().setData(data);
    fresh.addLine().setData(data.map((b) => ({ time: b.time, value: b.close })));
    build.mockClear();
    frame(fresh, true);
    const built = build.mock.contexts[0] as LineBatch;
    const decoded = (b: LineBatch) => vertices(b).map(([i, v, , f]) => (f ? [i! + b.indexShift, v] : 0));
    expect(live.count).toBeGreaterThan(300);
    expect(decoded(live)).toEqual(decoded(built));
  });

  it('releases the vertex buffer when the series is removed', () => {
    const { c, gl, lines } = setup({ renderer: 'gpu' });
    frame(c, true);
    const before = gl.live().buffer;
    c.removeSeries(lines[0]!);
    expect(gl.live().buffer).toBe(before - 1);
  });

  it('hit-tests a canvas line above a GPU line, as they are drawn', () => {
    const { c, lines } = setup();
    const [canvas, gpu] = lines as [LineSeries, LineSeries];
    const points = Array.from({ length: 300 }, (_, i) => ({ time: i * 60, value: 100 }));
    canvas.setData(points);
    gpu.setData(points);
    // Later and higher: on top if both were drawn by the same renderer.
    canvas.applyOptions({ renderer: 'canvas' });
    gpu.zIndex = 5;
    frame(c, true);
    const x = c.plotLeft + c.time.indexToX(295);
    const y = c.panes[0]!.top + canvas.scale.priceToY(100);
    expect(gpu.drawsOnGpu).toBe(true);
    expect(c.seriesAt(x, y)).toBe(canvas);
    gpu.applyOptions({ renderer: 'canvas' });
    expect(c.seriesAt(x, y)).toBe(gpu);
  });

  it('warns about an unknown renderer in development', () => {
    resetOptionWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { lines } = setup();
    lines[0]!.applyOptions({ renderer: 'webgpu' as never });
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toMatch(/renderer/);
  });

  it('draws a grouped line with each bucket range in its pixel column, as the canvas path has it', () => {
    const gl = recordingGl();
    const c = new Chart(fakeContainer({ webgl: gl.context }), { animateViewChanges: false, grouping: { mode: 'pixel' } });
    charts.push(c);
    c.addCandles().setData(bandBars(20_000));
    for (const area of [false, true]) {
      const s = c.addLine({ renderer: 'gpu', area });
      s.setData(bandBars(20_000).map((b, i) => ({ time: b.time, value: b.close + (i % 7) })));
      c.fitContent(false);
      frame(c, true);
      expect(c.groupLevel).toBeGreaterThan(0);
      const rows = vertices((s as unknown as { groupBatch: LineBatch }).groupBatch).filter((row) => row[3] === 1);
      expect(rows.length).toBeGreaterThan(100);
      for (let k = 0; k + 3 < rows.length; k += 4) {
        const [first, top, bottom, last] = rows.slice(k, k + 4).map(([index]) => c.time.indexToX(index!));
        // Lowest, highest and last share the rounded column; the first value stays at the bucket centre,
        // or under an area moves back into the column so the fill never runs right to left.
        // (Vertices are float32 timeline indices: close to the pixel, not exact.)
        expect(Math.abs(top! - Math.round(top!))).toBeLessThan(1e-3);
        expect(bottom).toBeCloseTo(top!, 3);
        expect(last).toBeCloseTo(top!, 3);
        expect(Math.abs(first! - top!)).toBeLessThanOrEqual(0.5 + 1e-3);
        if (area) expect(first!).toBeLessThanOrEqual(top! + 1e-3);
        // The top of the column first, as the canvas strokes it.
        expect(rows[k + 1]![1]!).toBeGreaterThanOrEqual(rows[k + 2]![1]! - 1e-3);
      }
      c.removeSeries(s);
    }
  });
});

/** An overlay indicator with five line plots around the close (the middle one dashed), and fills between the first two and the last two. */
function bandsDef(dashed = true): IndicatorDef {
  const ids = ['p0', 'p1', 'p2', 'p3', 'p4'];
  const at = (src: BarArrays, n: number, i: number) => (i < 3 ? NaN : src.close[i]! + (n - 2) * 2);
  return {
    id: 'bands',
    name: 'Bands',
    placement: 'overlay',
    inputs: [],
    plots: ids.map((id, n) => ({ id, type: 'line', color: COLORS[n]!, ...(n === 2 && dashed ? { lineStyle: 'dashed' as const } : {}) })),
    fills: [
      { between: ['p0', 'p1'], color: 'rgba(1, 2, 3, 0.2)' },
      { between: ['p3', 'p4'], color: 'rgba(4, 5, 6, 0.2)' },
    ],
    compute: (src) => Object.fromEntries(ids.map((id, n) => [id, Float64Array.from({ length: src.length }, (_, i) => at(src, n, i))])),
    update: (src, _inputs, i, out) => ids.forEach((id, n) => (out[id]![i] = at(src, n, i))),
  };
}

const bandBars = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 + Math.sin(i / 9) * 5 }));

describe('GPU indicator lines and fills', () => {
  function indicatorSetup(options: IndicatorAddOptions = { renderer: 'gpu' }) {
    const gl = recordingGl();
    const c = new Chart(fakeContainer({ webgl: gl.context }));
    charts.push(c);
    c.addCandles().setData(bandBars(300));
    const indicator = c.indicators.add(bandsDef(), {}, options);
    return { c, gl, indicator };
  }

  const fills = (calls: Call[]) => calls.filter((call) => call.name === 'fill' && /^rgba\((1, 2, 3|4, 5, 6)/.test(String(call.fillStyle)));

  it('issues no 2D strokes or fills for its plots on scene frames or crosshair moves', () => {
    const { c, gl } = indicatorSetup();
    const { ctx, calls } = recorder();
    frame(c, true, ctx);
    // The candles, then the two fills below the five lines.
    expect(programsDrawn(gl.draws)).toEqual(['other', 'fill', 'fill', 'line', 'line', 'line', 'line', 'line']);
    expect(gl.draws.slice(1).every((d) => d.instances > 0)).toBe(true);
    c.setCrosshair({ x: 200, y: 100, pane: 0 });
    frame(c, false, ctx);
    expect(lineStrokes(calls)).toEqual([]);
    expect(fills(calls)).toEqual([]);
  });

  it('draws on the GPU by default, and on the canvas when opted out, letting the vertex buffers go', () => {
    const { c, gl, indicator } = indicatorSetup({});
    const { ctx, calls } = recorder();
    frame(c, true, ctx);
    expect(lineStrokes(calls)).toEqual([]);
    expect(fills(calls)).toEqual([]);
    expect(programsDrawn(gl.draws)).toEqual(['other', 'fill', 'fill', 'line', 'line', 'line', 'line', 'line']);

    const before = gl.live().buffer;
    indicator.series!.applyOptions({ renderer: 'canvas' });
    calls.length = 0;
    frame(c, true, ctx);
    expect(lineStrokes(calls).length).toBe(5);
    expect(fills(calls).length).toBe(2);
    expect(gl.live().buffer).toBe(before - 7);
    // A copy of an indicator added on the canvas stays there.
    const opted = c.indicators.add('bands', {}, { renderer: 'canvas' });
    expect(c.indicators.duplicate(opted).series!.options.renderer).toBe('canvas');
  });

  it('releases its line and fill buffers when removed, and copies keep the renderer', () => {
    const { c, gl, indicator } = indicatorSetup();
    frame(c, true);
    const before = gl.live().buffer;
    const copy = c.indicators.duplicate(indicator);
    frame(c, true);
    expect(copy.series!.options.renderer).toBe('gpu');
    expect(gl.live().buffer).toBe(before + 7);
    indicator.remove();
    copy.remove();
    expect(gl.live().buffer).toBe(before - 7);
  });

  it('uploads nothing when the view moves, and only the new tail on a live update', () => {
    const gl = recordingWebgl2();
    const c = new Chart(fakeContainer({ webgl: gl.context }));
    charts.push(c);
    const candles = c.addCandles();
    candles.setData(bandBars(300));
    c.indicators.add(bandsDef(false), {}, { renderer: 'gpu' });
    frame(c, true);
    gl.uploads.length = 0;
    expect(c.setVisibleTimeRange(100 * 60, 200 * 60, false)).toBe(true);
    frame(c, true);
    expect(gl.uploads).toEqual([]);
    candles.update({ ...bandBars(300)[299]!, close: 50 });
    frame(c, true);
    // Per line and fill: the last point's vertex and the trailing break.
    expect(gl.uploads.length).toBe(7);
    expect(gl.uploads.every((u) => u.kind === 'sub' && u.bytes === 2 * 16)).toBe(true);
  });

  it('draws the buckets on screen while the view groups bars', () => {
    const gl = recordingGl();
    const c = new Chart(fakeContainer({ webgl: gl.context }), { animateViewChanges: false, grouping: { mode: 'pixel' } });
    charts.push(c);
    c.addCandles().setData(bandBars(20_000));
    c.indicators.add(bandsDef(), {}, { renderer: 'gpu' });
    c.fitContent(false);
    const { ctx, calls } = recorder();
    frame(c, true, ctx);
    expect(c.groupLevel).toBeGreaterThan(0);
    const segments = gl.draws.filter((d) => d.program !== 'other');
    expect(segments.map((d) => d.program)).toEqual(['fill', 'fill', 'line', 'line', 'line', 'line', 'line']);
    // About one segment per bucket, or four per bucket for the lines (first, low, high, last).
    expect(segments.every((d) => d.instances > 0 && d.instances < 20_000 / 2)).toBe(true);
    expect(lineStrokes(calls)).toEqual([]);
  });

  it('strokes with the plot styles set over the definition, and leaves hidden plots and their fills out', () => {
    const { c, gl, indicator } = indicatorSetup();
    indicator.setPlotStyle('p0', { visible: false });
    indicator.setPlotStyle('p4', { lineWidth: 2, lineStyle: 'dashed' });
    gl.uniforms.length = 0;
    frame(c, true);
    // The candles, the fill between p3 and p4 (p0 is hidden), then four lines.
    expect(programsDrawn(gl.draws)).toEqual(['other', 'fill', 'line', 'line', 'line', 'line']);
    // The last line, p4: dashed at width 2 is 6 on, 4 off.
    expect([...gl.uniforms].reverse().find((u) => u[0] === 'uniform2f')).toEqual(['uniform2f', 6, 4]);
  });

  it('keeps hidden plots current, so they show again with the latest values', () => {
    const gl = recordingWebgl2();
    const c = new Chart(fakeContainer({ webgl: gl.context }));
    charts.push(c);
    const candles = c.addCandles();
    candles.setData(bandBars(300));
    const indicator = c.indicators.add(bandsDef(false), {}, { renderer: 'gpu' });
    frame(c, true);
    indicator.setPlotStyle('p1', { visible: false });
    frame(c, true);
    gl.uploads.length = 0;
    candles.update({ ...bandBars(300)[299]!, close: 50 });
    frame(c, true);
    // The shown lines and fills upload the new tail now; p1 and its fill once they show again.
    expect(gl.uploads.length).toBe(5);
    gl.uploads.length = 0;
    indicator.setPlotStyle('p1', null);
    frame(c, true);
    expect(gl.uploads.length).toBe(2);
    expect(gl.uploads.every((u) => u.kind === 'sub' && u.bytes === 2 * 16)).toBe(true);
  });

  it('rejects an unknown renderer', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    expect(() => c.indicators.add(bandsDef(), {}, { renderer: 'webgpu' as never })).toThrow(/renderer/);
  });
});

describe('GPU candle line styles', () => {
  const UP = '#00ff00';
  const DOWN = '#0000ff';
  const bars = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const close = 100 + Math.sin(i / 7) * 10;
      return { time: i * 60, open: close - 1, high: close + 3, low: close - 3, close };
    });

  function candleSetup(options: Partial<CandleSeriesOptions> = {}, n = 300, chartOptions = {}) {
    const gl = recordingGl();
    const c = new Chart(fakeContainer({ webgl: gl.context }), chartOptions);
    charts.push(c);
    const s = c.addCandles({ upColor: UP, downColor: DOWN, animate: false, ...options });
    s.setData(bars(n));
    return { c, gl, s };
  }

  const lineColor = (s: CandleSeries) => (s as unknown as { host: { theme: { line: string } } }).host.theme.line;
  /** 2D calls that paint a style's lines or fills: the theme line colour, the up and down tints, or a gradient. */
  const stylePaint = (calls: Call[], s: CandleSeries) =>
    calls.filter(
      (call) =>
        (call.name === 'stroke' && (call.strokeStyle === lineColor(s) || /^rgba\(0, (255, 0|0, 255)/.test(String(call.strokeStyle)))) ||
        (call.name === 'fill' && (typeof call.fillStyle === 'object' || /^rgba\(0, (255, 0|0, 255)/.test(String(call.fillStyle)))),
    );

  const STYLES: [CandleStyle, string[]][] = [
    ['line', ['line']],
    ['lineMarkers', ['line']],
    ['step', ['line']],
    ['area', ['fill', 'line']],
    ['baseline', ['fill', 'line']],
    ['rangeBand', ['fill', 'fill', 'line', 'line', 'line']],
  ];

  it.each(STYLES)('draws %s on the GPU by default and not on the canvas, and on the canvas when opted out', (style, programs) => {
    const { c, gl, s } = candleSetup({ style });
    const { ctx, calls } = recorder();
    frame(c, true, ctx);
    expect(programsDrawn(gl.draws)).toEqual(programs);
    expect(gl.draws.every((d) => d.instances > 0)).toBe(true);
    expect(s.drawsOnGpu).toBe(true);
    c.setCrosshair({ x: 200, y: 100, pane: 0 });
    frame(c, false, ctx);
    expect(stylePaint(calls, s)).toEqual([]);

    s.applyOptions({ renderer: 'canvas' });
    calls.length = 0;
    gl.draws.length = 0;
    frame(c, true, ctx);
    expect(stylePaint(calls, s).length).toBeGreaterThan(0);
    expect(programsDrawn(gl.draws)).toEqual([]);
  });

  it('keeps the markers of lineMarkers and the base level of baseline on the canvas', () => {
    const { c, s } = candleSetup({ style: 'lineMarkers', renderer: 'gpu' });
    const { ctx, calls } = recorder();
    frame(c, true, ctx);
    expect(calls.filter((call) => call.name === 'arc').length).toBeGreaterThan(0);
    s.applyOptions({ style: 'baseline' });
    calls.length = 0;
    frame(c, true, ctx);
    expect(calls.some((call) => call.name === 'setLineDash')).toBe(true);
    expect(s.basePrice).not.toBeNull();
  });

  it('moves step points half a bar back and holds the last close half a bar past it, with mitred joins', () => {
    const { c, gl, s } = candleSetup({ style: 'step', renderer: 'gpu' }, 0);
    const closes = [1, 2, 2, 5];
    s.setData(closes.map((close, i) => ({ time: i * 60, open: close, high: close, low: close, close })));
    frame(c, true);
    const batch = (s as unknown as { lines: { close: LineBatch } }).lines.close;
    expect(vertices(batch).map(([i, v, , f]) => (f ? [i, v] : 'break'))).toEqual([
      'break', [-0.5, 1], [0.5, 1], [0.5, 2], [1.5, 2], [2.5, 2], [2.5, 5], [3.5, 5], 'break',
    ]);
    expect([...gl.uniforms].reverse().find((u) => u[0] === 'uniform1i')).toEqual(['uniform1i', 1]);
  });

  it('fills a baseline to its base, split there, with the up colour above', () => {
    const { c, gl, s } = candleSetup({ style: 'baseline', renderer: 'gpu', baseLevel: { kind: 'price', price: 100 } });
    frame(c, true);
    const at = gl.uniforms.findIndex((u) => u[0] === 'uniform1i');
    const [band, level, , top, bottom, split] = gl.uniforms.slice(at, at + 6);
    const y = s.scale.priceToY(100);
    expect(s.basePrice).toBe(100);
    expect(band).toEqual(['uniform1i', 0]);
    expect(level![1]).toBeCloseTo(y, 6);
    expect(split![1]).toBeCloseTo(y, 6);
    expect((top![1] as number[]).map((v) => +v.toFixed(2))).toEqual([0, 1, 0, 0.28, 0, 1, 0, 0.05]);
    expect((bottom![1] as number[]).map((v) => +v.toFixed(2))).toEqual([0, 0, 1, 0.05, 0, 0, 1, 0.28]);
  });

  it('uploads nothing when the view moves, and only the new tail on a live update', () => {
    const gl = recordingWebgl2();
    const c = new Chart(fakeContainer({ webgl: gl.context }));
    charts.push(c);
    const s = c.addCandles({ style: 'line', renderer: 'gpu', animate: false });
    const data = bars(300);
    s.setData(data);
    frame(c, true);
    gl.uploads.length = 0;
    expect(c.setVisibleTimeRange(100 * 60, 200 * 60, false)).toBe(true);
    frame(c, true);
    expect(gl.uploads).toEqual([]);
    s.update({ ...data[299]!, close: 95 });
    frame(c, true);
    // The last bar's vertex and the trailing break.
    expect(gl.uploads).toEqual([{ kind: 'sub', offset: 300 * 16, bytes: 2 * 16 }]);
  });

  it('frees its line buffers when switched back to the canvas, to a candle style, or removed', () => {
    const { c, gl, s } = candleSetup({ style: 'rangeBand', renderer: 'canvas' });
    frame(c, true);
    const before = gl.live().buffer;
    s.applyOptions({ renderer: 'gpu' });
    frame(c, true);
    expect(gl.live().buffer).toBe(before + 3);
    s.applyOptions({ style: 'area' });
    frame(c, true);
    // The bands go; the close line stays.
    expect(gl.live().buffer).toBe(before + 1);
    s.applyOptions({ renderer: 'canvas' });
    frame(c, true);
    expect(gl.live().buffer).toBe(before);
    s.applyOptions({ renderer: 'gpu', style: 'line' });
    frame(c, true);
    s.applyOptions({ style: 'candles' });
    frame(c, true);
    const rects = gl.live().buffer;
    c.removeSeries(s);
    expect(gl.live().buffer).toBeLessThan(rects);
    expect(gl.live().buffer).toBeLessThanOrEqual(before);
  });

  it('draws the buckets on screen while the view groups bars', () => {
    const { c, gl } = candleSetup({ style: 'rangeBand', renderer: 'gpu' }, 20_000, {
      animateViewChanges: false,
      grouping: { mode: 'pixel' },
    });
    c.fitContent(false);
    const { ctx, calls } = recorder();
    frame(c, true, ctx);
    expect(c.groupLevel).toBeGreaterThan(0);
    expect(programsDrawn(gl.draws)).toEqual(['fill', 'fill', 'line', 'line', 'line']);
    // About one segment per bucket on screen.
    expect(gl.draws.every((d) => d.instances > 0 && d.instances < 20_000 / 4)).toBe(true);
    expect(calls.filter((call) => call.name === 'stroke' && /^rgba\(0, (255, 0|0, 255)/.test(String(call.strokeStyle)))).toEqual([]);
  });

  it('hit-tests a canvas line above GPU line-style candles', () => {
    const { c, s } = candleSetup({ style: 'line', renderer: 'gpu' });
    const line = c.addLine({ renderer: 'canvas' });
    line.setData(bars(300).map((b) => ({ time: b.time, value: b.close })));
    line.zIndex = -5;
    frame(c, true);
    const x = c.plotLeft + c.time.indexToX(295);
    const y = c.panes[0]!.top + s.scale.priceToY(bars(300)[295]!.close);
    expect(c.seriesAt(x, y)).toBe(line);
  });

  it('warns about an unknown renderer in development', () => {
    resetOptionWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { s } = candleSetup();
    s.applyOptions({ renderer: 'webgpu' as never });
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toMatch(/renderer/);
  });
});
