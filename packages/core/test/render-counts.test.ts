/**
 * Work budgets for the scenarios in `render.bench.ts`: what one frame asks of
 * the GPU (draw calls, instances, uploads, memory) with 1,000,000 candles.
 * Counts do not depend on the machine, so unlike the timings they can fail a
 * plain test run: a change that, say, re-uploads every bar while panning
 * fails here even when the CPU time hardly moves.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Chart } from '../src/chart';
import { RECT_STRIDE } from '../src/gl/rect-batch';
import { UPLOAD_CHUNK_BYTES } from '../src/gl/renderer';
import { MIN_BUCKET_PX } from '../src/lod';
import type { RenderStats } from '../src/render-stats';
import { driveFrames, flushFrames, installTestEnvironment, sampleBars } from '../src/testing/kit';
import type { Bar } from '../src/types';

const MILLION = 1_000_000;
const WIDTH = 1280;
const env = installTestEnvironment({ width: WIDTH, height: 720 });
const data = sampleBars({ count: MILLION });
const charts: Chart[] = [];
afterAll(() => {
  charts.splice(0).forEach((c) => c.destroy());
  env.uninstall();
});

/** A chart with candles over `data`, settled, collecting the stats of every frame it draws. */
function setup(options: ConstructorParameters<typeof Chart>[1] = {}) {
  const chart = new Chart(env.container(), { renderStats: true, ...options });
  charts.push(chart);
  const frames: RenderStats[] = [];
  chart.on('frame:render', (stats) => frames.push(stats));
  const series = chart.addCandles({ animate: false });
  series.setData(data);
  flushFrames();
  /** Instances each candle draws. */
  const perBar = (series as unknown as { perBar: number }).perBar;
  return {
    chart,
    series,
    frames,
    barBytes: perBar * RECT_STRIDE,
    /** Most instances a frame should draw at `spacing` css px per bar: the bars across the canvas. */
    maxInstances: (spacing: number) => perBar * Math.ceil(WIDTH / spacing + 2),
  };
}

/** Run `steps` view changes, one frame each, and return every frame they drew. */
function eachFrame(frames: RenderStats[], steps: number, step: (i: number) => void): RenderStats[] {
  frames.length = 0;
  for (let i = 0; i < steps; i++) {
    step(i);
    driveFrames();
  }
  flushFrames();
  expect(frames.length).toBeGreaterThanOrEqual(steps);
  return frames.splice(0);
}

// A million bars take a few seconds per test; a busy machine running the whole suite can pass the 5 s default.
describe(`frame budgets with ${MILLION.toLocaleString('en')} candles`, { timeout: 30_000 }, () => {
  it('setData uploads every bar once, in one buffer, a piece per frame', () => {
    const s = setup();
    const uploads = s.frames.filter((f) => f.bufferUploads > 0);
    const bytes = MILLION * s.barBytes;
    // The bars on screen first, the rest over the next frames (#559): no frame sends more than a piece.
    expect(uploads.reduce((sum, f) => sum + f.bufferBytes, 0)).toBe(bytes);
    expect(uploads.length).toBeGreaterThanOrEqual(Math.ceil(bytes / UPLOAD_CHUNK_BYTES));
    expect(uploads.length).toBeLessThanOrEqual(Math.ceil(bytes / UPLOAD_CHUNK_BYTES) + 1);
    for (const frame of uploads) {
      expect(frame).toMatchObject({ kind: 'scene', drawCalls: 1 });
      expect(frame.bufferUploads).toBeLessThanOrEqual(2);
      expect(frame.bufferBytes).toBeLessThanOrEqual(UPLOAD_CHUNK_BYTES);
    }
    expect(s.chart.gpuMemory()).toEqual({ buffers: bytes, textures: 0, total: bytes });
  });

  describe('panning and zooming', () => {
    let s: ReturnType<typeof setup>;
    let held: number;
    beforeAll(() => {
      s = setup();
      held = s.chart.gpuMemory().total;
    });

    /** Each frame: one draw call, the bars on screen at most, nothing uploaded, no memory added. */
    function expectViewOnly(frames: RenderStats[], spacing: number) {
      for (const frame of frames) {
        expect(frame).toMatchObject({ drawCalls: 1, bufferUploads: 0, bufferBytes: 0, textureUploads: 0 });
        expect(frame.instances).toBeLessThanOrEqual(s.maxInstances(spacing));
        expect(frame.memory.total).toBe(held);
      }
    }

    for (const spacing of [6, 0.5]) {
      it(`pan at ${spacing} px per bar draws the visible bars and uploads nothing`, () => {
        s.chart.setBarSpacing(spacing);
        flushFrames();
        let at = 0;
        const frames = eachFrame(s.frames, 20, () => {
          at = (at + 7) % (MILLION - 10_000);
          s.chart.scrollToTime(data[5_000 + at]!.time, false);
        });
        expectViewOnly(frames, spacing);
        // And it does draw them: thousands of bars when zoomed out.
        expect(Math.max(...frames.map((f) => f.instances))).toBeGreaterThan(s.maxInstances(spacing) / 2);
      });
    }

    it('zoom draws the visible bars and uploads nothing', () => {
      // In and out between 2 and 18 px per bar; the bound allows the narrowest.
      const frames = eachFrame(s.frames, 32, (i) => s.chart.setBarSpacing(2 + Math.abs((i % 32) - 16)));
      expectViewOnly(frames, 2);
    });
  });

  it('grouped zoom with every bar on screen draws the buckets on screen and uploads buckets, not bars', () => {
    const s = setup({ grouping: { mode: 'pixel' } });
    s.chart.fitContent(false);
    flushFrames();
    const fit = s.chart.barSpacing;
    const zoom = (i: number) => fit * (1 + Math.abs((i % 16) - 8) * 0.875);
    // A level's buffer holds every bucket of the series (buckets are at least MIN_BUCKET_PX wide),
    // written when the zoom reaches that level; storage grows by half again when it fills.
    const maxBuckets = Math.ceil((MILLION * zoom(0)) / MIN_BUCKET_PX);
    const maxBytes = 1.5 * maxBuckets * s.barBytes;
    const frames = eachFrame(s.frames, 16, (i) => s.chart.setBarSpacing(zoom(i)));
    for (const frame of frames) {
      expect(frame.drawCalls).toBe(1);
      expect(frame.instances).toBeLessThanOrEqual(s.maxInstances(MIN_BUCKET_PX));
      expect(frame.bufferUploads).toBeLessThanOrEqual(1);
      expect(frame.bufferBytes).toBeLessThanOrEqual(maxBytes);
      // The bars' own buffer, uploaded before the view grouped, is kept for zooming back in; nothing else grows.
      expect(frame.memory.total).toBeLessThanOrEqual(MILLION * s.barBytes + maxBytes);
    }
  });

  describe('live updates', () => {
    let s: ReturnType<typeof setup>;
    let last: Bar;
    beforeAll(() => {
      s = setup();
      last = data[MILLION - 1]!;
    });

    it('updating the last bar uploads that bar only', () => {
      const frames = eachFrame(s.frames, 10, (i) => s.series.update({ ...last, close: last.close + i + 1 }));
      for (const frame of frames.filter((f) => f.bufferUploads > 0)) {
        expect(frame).toMatchObject({ drawCalls: 1, bufferUploads: 1, bufferBytes: s.barBytes });
      }
      expect(frames.some((f) => f.bufferUploads > 0)).toBe(true);
    });

    it('appending bars uploads each new bar only, apart from one buffer growth', () => {
      const frames = eachFrame(s.frames, 1_000, (i) => s.series.update({ ...last, time: last.time + 60 * (i + 1) }));
      const uploading = frames.filter((f) => f.bufferUploads > 0);
      expect(uploading.length).toBe(1_000);
      // The buffer filled up at a million bars; it grows once, re-sending everything a piece per
      // frame (#559) next to each frame's new bar, then has room.
      for (const frame of uploading) expect(frame.bufferBytes).toBeLessThanOrEqual(UPLOAD_CHUNK_BYTES);
      const growth = uploading.filter((f) => f.bufferBytes > s.barBytes);
      expect(growth.length).toBeLessThanOrEqual(Math.ceil((MILLION * s.barBytes) / UPLOAD_CHUNK_BYTES) + 1);
      const resent = growth.reduce((sum, f) => sum + f.bufferBytes, 0);
      expect(resent).toBeLessThanOrEqual((MILLION + 1_000 + growth.length) * s.barBytes);
      const single = uploading.filter((f) => f.bufferUploads === 1 && f.bufferBytes === s.barBytes);
      expect(single.length).toBe(1_000 - growth.length);
    });

    it('a crosshair move draws nothing on the GPU', () => {
      s.frames.length = 0;
      s.chart.setCrosshair({ x: 400, y: 200, pane: 0 });
      flushFrames();
      const frames = s.frames.splice(0);
      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) expect(frame).toMatchObject({ kind: 'cursor', drawCalls: 0, bufferUploads: 0 });
    });
  });
});
