import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeContainer, fakeIntersection, pendingFrames, recordingWebgl2, setPageHidden, type FakeIntersection } from './fake-dom';
import { sharedContext } from '../src/builtins';
import { Chart, type ChartOptions } from '../src/chart';
import { RECT_STRIDE, RectBatch } from '../src/gl/rect-batch';
import { GLRenderer, UPLOAD_CHUNK_BYTES } from '../src/gl/renderer';
import { PendingRanges } from '../src/gl/pending-ranges';
import { driveFrames, flushFrames } from '../src/testing/kit';
import type { RenderStats } from '../src/render-stats';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
let io: FakeIntersection;
beforeEach(() => {
  io = fakeIntersection();
});
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  io.uninstall();
  setPageHidden(false);
});

const bar = (i: number): Bar => ({ time: i * 60, open: 10, high: 12, low: 8, close: 10 + (i % 7) });
const bars = (n: number) => Array.from({ length: n }, (_, i) => bar(i));
/** Candles write three rects per bar: 200k bars are 14.4 MB, several frames' worth. */
const LARGE = 200_000;
const PER_BAR = 3 * RECT_STRIDE;

interface Internals {
  renderer: { uploadsPending: boolean };
  uploading: boolean;
  root: unknown;
  glCanvas: { dispatch(type: string): void };
}
const inside = (c: Chart) => c as unknown as Internals;

/** Byte ranges written into each buffer, merged. */
class Written {
  private readonly ranges = new Map<object, PendingRanges>();
  reset(buffer: object): void {
    this.ranges.set(buffer, new PendingRanges());
  }
  add(buffer: object, from: number, to: number): void {
    if (!this.ranges.has(buffer)) this.reset(buffer);
    this.ranges.get(buffer)!.add(from, to);
  }
  /** Whether every byte of [from, to) was written into `buffer`. */
  covers(buffer: object, from: number, to: number): boolean {
    const copy = new PendingRanges();
    const r = this.ranges.get(buffer);
    if (!r) return false;
    for (const [a, b] of pairs(r)) copy.add(a, b);
    const hit = copy.take(from, to);
    return hit.length === 2 && hit[0] === from && hit[1] === to;
  }
}

function pairs(r: PendingRanges): Array<[number, number]> {
  // Read without consuming: copy the ranges out and put them back.
  const flat = r.all();
  const out: Array<[number, number]> = [];
  for (let i = 0; i < flat.length; i += 2) {
    out.push([flat[i]!, flat[i + 1]!]);
    r.add(flat[i]!, flat[i + 1]!);
  }
  return out;
}

/**
 * A recording context that also tracks which bytes of each buffer hold data,
 * and checks every instanced draw of a batch: each instance it reads must
 * have been uploaded. Rect draws read `RECT_STRIDE` bytes per instance; line
 * draws read four vertices per segment, `LINE_STRIDE` (16) bytes each.
 * It also mirrors each buffer's bytes, to compare with the batch storage.
 */
function checkingGl() {
  const gl = recordingWebgl2();
  const written = new Written();
  const contents = new Map<object, Uint8Array>();
  const gaps: string[] = [];
  let draws = 0;
  let bound: object | null = null;
  let pointer: { buffer: object; offset: number; stride: number } | null = null;
  const base = gl.context as Record<string, (...args: unknown[]) => unknown>;
  const calls: Record<string, (...args: never[]) => unknown> = {
    bindBuffer: (target: number, buffer: object | null) => {
      bound = buffer;
      return base.bindBuffer!(target, buffer);
    },
    bufferData: (target: number, data: ArrayBufferView | number, usage: number) => {
      if (bound) {
        written.reset(bound);
        if (typeof data !== 'number') written.add(bound, 0, data.byteLength);
        const bytes = new Uint8Array(typeof data === 'number' ? data : data.byteLength);
        if (typeof data !== 'number') bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        contents.set(bound, bytes);
      }
      return base.bufferData!(target, data, usage);
    },
    bufferSubData: (target: number, offset: number, src: ArrayBufferView, srcOffset: number, length: number) => {
      if (bound) {
        written.add(bound, offset, offset + length);
        // The renderer uploads byte arrays, so the source offset is in bytes.
        contents.get(bound)?.set(new Uint8Array(src.buffer, src.byteOffset + srcOffset, length), offset);
      }
      return base.bufferSubData!(target, offset, src, srcOffset, length);
    },
    vertexAttribPointer: (index: number, size: number, type: number, norm: boolean, stride: number, offset: number) => {
      if (index === 1 && bound && (stride === RECT_STRIDE || stride === 16)) pointer = { buffer: bound, offset, stride };
      return base.vertexAttribPointer!(index, size, type, norm, stride, offset);
    },
    drawArraysInstanced: (mode: number, first: number, count: number, instances: number) => {
      if (pointer) {
        draws++;
        const { buffer, offset, stride } = pointer;
        const end = offset + (stride === RECT_STRIDE ? instances : instances + 3) * stride;
        if (!written.covers(buffer, offset, end)) gaps.push(`draw of bytes [${offset}, ${end}) reads data not uploaded`);
      }
      pointer = null;
      return base.drawArraysInstanced!(mode, first, count, instances);
    },
  };
  const context = new Proxy(base, {
    get: (target, key) => (typeof key === 'string' && key in calls ? calls[key] : target[key as string]),
  });
  /** Whether the GPU copy of a rect batch holds its storage's bytes for every instance. */
  const matches = (batch: RectBatch) => {
    const buffer = (batch.gpu as { buffer: object }).buffer;
    const gpu = contents.get(buffer);
    if (!gpu) return false;
    const from = batch.head * RECT_STRIDE;
    const live = batch.bytes;
    const copy = gpu.subarray(from, from + live.byteLength);
    return copy.byteLength === live.byteLength && copy.every((b, i) => b === live[i]);
  };
  return { ...gl, context, gaps, draws: () => draws, matches };
}

function setup(n: number, options: Partial<ChartOptions> = {}) {
  const gl = checkingGl();
  const c = new Chart(fakeContainer({ webgl: gl.context }), { timezone: 'UTC', ...options });
  charts.push(c);
  const main = c.addCandles();
  main.setData(bars(n));
  return { c, main, gl };
}

/** One frame's scene work, without the frame loop. */
function render(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

/** Bytes uploaded with `bufferSubData` since `from` (an index into `uploads`). */
const subBytes = (uploads: { kind: string; bytes: number }[], from = 0) =>
  uploads.slice(from).reduce((sum, u) => sum + (u.kind === 'sub' ? u.bytes : 0), 0);

describe('PendingRanges', () => {
  it('merges overlapping and touching ranges', () => {
    const r = new PendingRanges();
    r.add(10, 20);
    r.add(30, 40);
    r.add(20, 25);
    r.add(5, 12);
    expect(r.all()).toEqual([5, 25, 30, 40]);
    expect(r.empty).toBe(true);
  });

  it('takes the part of a range a draw needs, leaving the rest on both sides', () => {
    const r = new PendingRanges();
    r.add(0, 100);
    expect(r.take(40, 60)).toEqual([40, 60]);
    expect(r.size).toBe(80);
    expect(r.take(50, 70)).toEqual([60, 70]);
    expect(r.all()).toEqual([0, 40, 70, 100]);
  });

  it('hands out pieces nearest the focus first, growing away from it', () => {
    const r = new PendingRanges();
    r.add(0, 40);
    r.add(60, 100);
    // Focus 55: the lower range ends 16 away, the upper starts 5 away.
    expect(r.next(55, 10)).toEqual([60, 70]);
    expect(r.next(55, 10)).toEqual([70, 80]);
    // Now the lower range is nearer: its end is 16 away, the upper's start 25.
    expect(r.next(55, 30)).toEqual([10, 40]);
    expect(r.next(55, 15)).toEqual([80, 95]);
    expect(r.next(55, 100)).toEqual([95, 100]);
    expect(r.next(55, 100)).toEqual([0, 10]);
    expect(r.next(55, 10)).toBeNull();
  });
});

describe('chunked GPU uploads', () => {
  it('uploads a small batch in one go, as before', () => {
    const { c, gl } = setup(1000);
    render(c);
    const whole = gl.uploads.filter((u) => u.kind === 'data' && u.bytes > 1000);
    expect(whole).toHaveLength(1);
    expect(whole[0]!.bytes).toBeGreaterThanOrEqual(1000 * PER_BAR);
    expect(gl.uploads.filter((u) => u.kind === 'sub')).toEqual([]);
    expect(inside(c).renderer.uploadsPending).toBe(false);
    expect(gl.gaps).toEqual([]);
  });

  it('uploads the bars on screen first and the rest over the next frames, nearest first, without gaps', () => {
    const { c, main, gl } = setup(LARGE);
    render(c);
    const batch = main.batch;
    const end = (batch.head + batch.count) * RECT_STRIDE;
    // Allocated at full size without data, then the visible bars (the newest) uploaded.
    expect(gl.uploads[1]).toEqual({ kind: 'data', offset: 0, bytes: batch.capacity * RECT_STRIDE });
    const first = gl.uploads.findIndex((u) => u.kind === 'sub');
    const visible = gl.uploads[first]!;
    expect(visible.offset + visible.bytes).toBe(end);
    expect(visible.bytes).toBeLessThan(10_000 * PER_BAR);
    expect(subBytes(gl.uploads)).toBeLessThanOrEqual(visible.bytes + UPLOAD_CHUNK_BYTES);
    expect(inside(c).renderer.uploadsPending).toBe(true);

    // The rest arrives in bounded pieces, each frame no more than the budget, newest first.
    const total = batch.count * RECT_STRIDE;
    const frames: number[] = [];
    let mark = gl.uploads.length;
    for (let i = 0; i < 100 && inside(c).renderer.uploadsPending; i++) {
      render(c);
      frames.push(subBytes(gl.uploads, mark));
      mark = gl.uploads.length;
    }
    expect(inside(c).renderer.uploadsPending).toBe(false);
    for (const bytes of frames) expect(bytes).toBeLessThanOrEqual(UPLOAD_CHUNK_BYTES);
    // The first frame spent its budget too; the other layers' small uploads may take a little of it.
    expect(frames.length).toBeGreaterThanOrEqual(Math.ceil(total / UPLOAD_CHUNK_BYTES) - 1);
    expect(frames.length).toBeLessThanOrEqual(Math.ceil(total / UPLOAD_CHUNK_BYTES));
    const pieces = gl.uploads.slice(first).filter((u) => u.kind === 'sub');
    for (let i = 1; i < pieces.length; i++) expect(pieces[i]!.offset + pieces[i]!.bytes).toBe(pieces[i - 1]!.offset);
    expect(pieces.at(-1)!.offset).toBe(batch.head * RECT_STRIDE);
    expect(subBytes(gl.uploads)).toBe(total);
    expect(gl.matches(batch)).toBe(true);
    expect(gl.gaps).toEqual([]);
    expect(gl.draws()).toBeGreaterThan(frames.length);
  });

  it('draws bars it jumps to before their piece arrived', () => {
    const { c, gl } = setup(LARGE);
    render(c);
    c.scrollToTime(bar(10).time as number, false);
    render(c);
    c.scrollToTime(bar(LARGE / 2).time as number, false);
    render(c);
    expect(gl.gaps).toEqual([]);
    expect(inside(c).renderer.uploadsPending).toBe(true);
  });

  it('asks for frames until the upload is done, and none while the chart is hidden', async () => {
    const { c, gl } = setup(LARGE);
    driveFrames({ count: 2 });
    expect(inside(c).renderer.uploadsPending).toBe(true);
    expect(pendingFrames()).toBe(1);
    setPageHidden(true);
    driveFrames({ count: 1 });
    await Promise.resolve();
    expect(pendingFrames()).toBe(0);
    const uploads = gl.uploads.length;
    driveFrames({ count: 5 });
    expect(gl.uploads.length).toBe(uploads);
    setPageHidden(false);
    await Promise.resolve();
    // Shown again: it draws at once, and the frame loop finishes the upload.
    flushFrames();
    expect(inside(c).renderer.uploadsPending).toBe(false);
    expect(gl.gaps).toEqual([]);
  });

  it('counts each piece in the render statistics', () => {
    const { c, main } = setup(LARGE, { renderStats: true });
    const stats: RenderStats[] = [];
    c.on('frame:render', (s) => stats.push(s));
    flushFrames();
    const total = main.batch.count * RECT_STRIDE;
    const bytes = stats.reduce((sum, s) => sum + s.bufferBytes, 0);
    // The candles plus the small batches of the chart's other layers.
    expect(bytes).toBeGreaterThanOrEqual(total);
    expect(bytes).toBeLessThan(total + 64 * 1024);
    expect(stats.length).toBeGreaterThan(3);
    for (const s of stats) expect(s.bufferBytes).toBeLessThanOrEqual(UPLOAD_CHUNK_BYTES + 400_000);
    expect(stats.reduce((sum, s) => sum + s.bufferUploads, 0)).toBeGreaterThanOrEqual(stats.length);
  });

  it('starts over after a context loss mid-upload', () => {
    const { c, main, gl } = setup(LARGE);
    render(c);
    render(c);
    expect(inside(c).renderer.uploadsPending).toBe(true);
    inside(c).glCanvas.dispatch('webglcontextlost');
    expect(inside(c).renderer.uploadsPending).toBe(false);
    const before = gl.uploads.length;
    render(c);
    expect(gl.uploads.length).toBe(before);

    inside(c).glCanvas.dispatch('webglcontextrestored');
    gl.gaps.length = 0;
    render(c);
    const batch = main.batch;
    expect(gl.uploads.slice(before)).toContainEqual({ kind: 'data', offset: 0, bytes: batch.capacity * RECT_STRIDE });
    expect(inside(c).renderer.uploadsPending).toBe(true);
    for (let i = 0; i < 100 && inside(c).renderer.uploadsPending; i++) render(c);
    expect(inside(c).renderer.uploadsPending).toBe(false);
    expect(subBytes(gl.uploads, before)).toBe(batch.count * RECT_STRIDE);
    expect(gl.gaps).toEqual([]);
  });

  it('stops uploading a batch released mid-upload', () => {
    const { c, main, gl } = setup(LARGE);
    render(c);
    expect(inside(c).renderer.uploadsPending).toBe(true);
    const live = gl.live().buffer;
    c.removeSeries(main);
    expect(gl.live().buffer).toBe(live - 1);
    expect(inside(c).renderer.uploadsPending).toBe(false);
    const before = subBytes(gl.uploads);
    render(c);
    render(c);
    expect(subBytes(gl.uploads)).toBeLessThan(before + 64 * 1024);
    expect(gl.gaps).toEqual([]);
  });

  it('uploads a large line from the view outwards too', () => {
    const gl = checkingGl();
    const c = new Chart(fakeContainer({ webgl: gl.context }), { timezone: 'UTC' });
    charts.push(c);
    // The timeline comes from the main series.
    c.addCandles().setData(bars(400_000));
    const line = c.addLine({ renderer: 'gpu' });
    // 400k points are 6.4 MB of vertices: more than a frame's budget.
    line.setData(bars(400_000).map((b) => ({ time: b.time, value: b.close })));
    render(c);
    expect(inside(c).renderer.uploadsPending).toBe(true);
    c.scrollToTime(bar(5).time as number, false);
    render(c);
    for (let i = 0; i < 100 && inside(c).renderer.uploadsPending; i++) render(c);
    expect(inside(c).renderer.uploadsPending).toBe(false);
    expect(gl.gaps).toEqual([]);
  });

  it('counts small batches against the frame budget too, queueing what does not fit', () => {
    const gl = checkingGl();
    const c = new Chart(fakeContainer({ webgl: gl.context }), { timezone: 'UTC', renderStats: true });
    charts.push(c);
    const stats: RenderStats[] = [];
    c.on('frame:render', (f) => stats.push(f));
    // Six series of 25k candles, 1.8 MB each: under a piece apiece, 10.8 MB together.
    const series = Array.from({ length: 6 }, () => c.addCandles());
    for (const s of series) s.setData(bars(25_000));
    render(c);
    // The budget, plus the bars on screen of the series that did not fit.
    expect(stats[0]!.bufferBytes).toBeLessThanOrEqual(UPLOAD_CHUNK_BYTES + series.length * 300 * PER_BAR);
    expect(inside(c).renderer.uploadsPending).toBe(true);
    for (let i = 0; i < 100 && inside(c).renderer.uploadsPending; i++) render(c);
    expect(inside(c).renderer.uploadsPending).toBe(false);
    for (const s of series) expect(gl.matches(s.batch)).toBe(true);
    expect(gl.gaps).toEqual([]);
  });

  it('uploads everything a frame shows, even past the budget: fitting a fresh load on screen', () => {
    // Only a tiny `minBarSpacing` puts this many bars on screen: at the default 0.5 px, 800 px show 1,600.
    const { c, main, gl } = setup(LARGE, { minBarSpacing: 0.001 });
    render(c);
    expect(inside(c).renderer.uploadsPending).toBe(true);
    const mark = gl.uploads.length;
    c.fitContent(false);
    render(c);
    // Every bar is on screen, so all of them upload in this frame (the documented exception).
    expect(subBytes(gl.uploads, mark)).toBeGreaterThan(UPLOAD_CHUNK_BYTES);
    expect(inside(c).renderer.uploadsPending).toBe(false);
    expect(gl.matches(main.batch)).toBe(true);
    expect(gl.gaps).toEqual([]);
  });

  it('forgets waiting slots dropped from the front of a batch', () => {
    const gl = checkingGl();
    fakeContainer({ webgl: gl.context });
    const r = new GLRenderer(document.createElement('canvas'), { lost() {}, restored() {}, restoreFailed() {} });
    const batch = new RectBatch();
    const n = 200_000;
    batch.resize(n);
    for (let i = 0; i < n; i++) batch.set(i, i, 1, 2, 0, [1, 2, 3, 4]);
    const u = { x: [1, 0] as [number, number], y: [1, 0] as [number, number], log: [0, 0] as [number, number], bodyRatio: 0.8, columnRatio: 0.8 };
    r.beginFrame(1);
    r.drawRects(batch, n - 100, 100, u);
    r.flushUploads();
    expect(r.uploadsPending).toBe(true);
    // Drop the first half: those slots hold nothing to draw any more.
    const cut = (batch.head + n / 2) * RECT_STRIDE;
    batch.growFront(-n / 2);
    const mark = gl.uploads.length;
    for (let i = 0; i < 100 && r.uploadsPending; i++) {
      r.beginFrame(1);
      r.drawRects(batch, batch.count - 100, 100, u);
      r.flushUploads();
    }
    expect(r.uploadsPending).toBe(false);
    expect(gl.uploads.slice(mark).filter((up) => up.kind === 'sub' && up.offset < cut)).toEqual([]);
    expect(gl.matches(batch)).toBe(true);
    r.destroy();
  });

  describe("charts sharing a context (gl: 'shared')", () => {
    const shared = (gl: ReturnType<typeof checkingGl>, n: number) => {
      const c = new Chart(fakeContainer({ webgl: gl.context }), { timezone: 'UTC', gl: 'shared', plugins: [sharedContext()] });
      charts.push(c);
      const main = c.addCandles();
      main.setData(bars(n));
      return { c, main };
    };

    it('share one upload budget per animation frame', () => {
      const gl = checkingGl();
      const a = shared(gl, LARGE);
      const b = shared(gl, LARGE);
      // Each chart's bars on screen may go over the budget; nothing else does.
      const visible = 2 * 300 * PER_BAR;
      let mark = gl.uploads.length;
      for (let i = 0; i < 100 && pendingFrames() > 0; i++) {
        driveFrames({ count: 1 });
        expect(subBytes(gl.uploads, mark)).toBeLessThanOrEqual(UPLOAD_CHUNK_BYTES + visible);
        mark = gl.uploads.length;
      }
      expect(inside(a.c).renderer.uploadsPending).toBe(false);
      expect(gl.matches(a.main.batch)).toBe(true);
      expect(gl.matches(b.main.batch)).toBe(true);
      expect(gl.gaps).toEqual([]);
    });

    it("keep drawing only for their own uploads: one chart's queue does not drive another's frames", () => {
      const gl = checkingGl();
      const a = shared(gl, LARGE);
      render(a.c);
      expect(inside(a.c).uploading).toBe(true);
      const b = shared(gl, 1000);
      render(b.c);
      // A's data still waits, but B has nothing of its own to wait for.
      expect(inside(b.c).renderer.uploadsPending).toBe(true);
      expect(inside(b.c).uploading).toBe(false);
      // Drawing B again sends none of A's queue.
      const mark = gl.uploads.length;
      render(b.c);
      expect(subBytes(gl.uploads, mark)).toBe(0);
      for (let i = 0; i < 100 && inside(a.c).uploading; i++) render(a.c);
      expect(inside(a.c).renderer.uploadsPending).toBe(false);
      expect(gl.matches(a.main.batch)).toBe(true);
    });
  });
});
