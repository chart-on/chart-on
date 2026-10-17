import { describe, expect, it } from 'vitest';
import { rebaseX } from '../src/gl/renderer';
import { MAX_EXACT_INDEX, RECT_STRIDE, RectBatch } from '../src/gl/rect-batch';
import { TimeScale } from '../src/scales';
import type { Rgba } from '../src/util/color';

const f = Math.fround;

/** The candle centre the rect shader computes, in float32 like the GPU: floor(((i - origin) * s + o) * dpr). */
function shaderCentre(index: number, x: [number, number], dpr: number): number {
  const r = rebaseX(x);
  return Math.floor(f(f(f(f(index) - f(r.origin)) * f(r.scale) + f(r.offset)) * f(dpr)));
}

/** The same without rebasing, as the shader computed it before. */
function unrebasedCentre(index: number, [s, o]: [number, number], dpr: number): number {
  return Math.floor(f(f(f(f(index) * f(s)) + f(o)) * f(dpr)));
}

function scale(bars: number, spacing: number): TimeScale {
  const t = new TimeScale({ barSpacing: spacing, minBarSpacing: 0.5, maxBarSpacing: 80, rightOffset: 5.37 });
  t.width = 1283;
  t.barCount = bars;
  return t;
}

describe('rebaseX', () => {
  it('describes the same line as the original transform', () => {
    const r = rebaseX([80, -8e7 + 123.25]);
    for (const i of [999_990, 1_000_000, 1_000_003.5]) {
      expect((i - r.origin) * r.scale + r.offset).toBeCloseTo(i * 80 - 8e7 + 123.25, 6);
    }
    expect(Number.isInteger(r.origin)).toBe(true);
  });

  it('keeps the rebased offset within one bar of the view', () => {
    const t = scale(1_000_000, 80);
    const r = rebaseX(t.xTransform());
    expect(Math.abs(r.offset)).toBeLessThanOrEqual(40);
  });

  it('leaves degenerate transforms alone', () => {
    expect(rebaseX([0, 10])).toEqual({ scale: 0, offset: 10, origin: 0 });
  });
});

describe('GPU candle position in float32', () => {
  it('matches indexToX for the last of 1M bars at maximum zoom', () => {
    const t = scale(1_000_000, 80);
    const last = 999_999;
    for (const dpr of [1, 2]) {
      const expected = Math.floor(t.indexToX(last) * dpr);
      expect(shaderCentre(last, t.xTransform(), dpr)).toBe(expected);
    }
    // The old form is off by pixels here, which is what the rebase fixes.
    expect(Math.abs(unrebasedCentre(last, t.xTransform(), 1) - Math.floor(t.indexToX(last)))).toBeGreaterThan(1);
  });

  it('matches indexToX for every visible bar at large and small indices', () => {
    for (const [bars, spacing] of [
      [1_000_000, 80],
      [1_000_000, 6],
      [500, 6],
    ] as const) {
      const t = scale(bars, spacing);
      const { from, to } = t.visibleRange();
      for (let i = from; i <= to; i++) expect(shaderCentre(i, t.xTransform(), 1)).toBe(Math.floor(t.indexToX(i)));
    }
  });
});

const white: Rgba = [255, 255, 255, 255];

/** Span edges the span shader computes from batch instance `i`, in float32 like the GPU. */
function shaderSpan(batch: RectBatch, i: number, x: [number, number], dpr: number): [number, number] {
  const r = rebaseX(x);
  const slots = new Float32Array(batch.bytes.buffer, i * RECT_STRIDE, 5);
  const shift = f(slots[4]! - f(r.origin));
  const edge = (rel: number) => Math.floor(f(f(f(f(rel + shift) * f(r.scale)) + f(r.offset)) * f(dpr)) + 0.5);
  return [edge(slots[0]!), edge(slots[3]!)];
}

/** The same edge with the end stored as an absolute float32 x, as before the per-span base. */
function absoluteSpanEdge(x0: number, x: [number, number], dpr: number): number {
  const r = rebaseX(x);
  return Math.floor(f(f(f(f(f(x0) - f(r.origin)) * f(r.scale)) + f(r.offset)) * f(dpr)) + 0.5);
}

/** The edge in double precision, as the CPU places it. */
function cpuSpanEdge(x0: number, [s, o]: [number, number], dpr: number): number {
  return Math.floor((x0 * s + o) * dpr + 0.5);
}

describe('GPU volume profile spans in float32', () => {
  it('match the CPU edges within a device pixel at 1M bars and spacing 80', () => {
    const t = scale(1_000_000, 80);
    const x = t.xTransform();
    const { from, to } = t.visibleRange();
    const batch = new RectBatch();
    // Sessions of 7 bars across the view, rows growing from each session's left edge.
    const ends: [number, number][] = [];
    for (let start = from - 3; start < to; start += 7) {
      for (let row = 1; row <= 9; row++) {
        const x0 = start - 0.5;
        ends.push([x0, x0 + (7 * 0.7 * row) / 9.3]);
      }
    }
    batch.resize(ends.length);
    ends.forEach(([x0, x1], i) => batch.setSpan(i, x0, x1, 0, 1, white, Math.floor(x0 + 0.5)));
    let oldWorst = 0;
    for (const dpr of [1, 2]) {
      ends.forEach(([x0, x1], i) => {
        const [a, b] = shaderSpan(batch, i, x, dpr);
        expect(Math.abs(a - cpuSpanEdge(x0, x, dpr))).toBeLessThanOrEqual(1);
        expect(Math.abs(b - cpuSpanEdge(x1, x, dpr))).toBeLessThanOrEqual(1);
        oldWorst = Math.max(oldWorst, Math.abs(absoluteSpanEdge(x1, x, dpr) - cpuSpanEdge(x1, x, dpr)));
      });
    }
    // Absolute float32 ends keep 1/16 of a bar here, several pixels at spacing 80.
    expect(oldWorst).toBeGreaterThan(1);
  });

  it('keeps visible-range spans, written from base 0, unchanged', () => {
    const batch = new RectBatch();
    batch.resize(1);
    batch.setSpan(0, 0, 0.25, 0, 1, white);
    expect(shaderSpan(batch, 0, [-200, 800], 1)).toEqual([800, 750]);
  });

  it('stores integer bases exactly up to the float32 limit', () => {
    expect(f(MAX_EXACT_INDEX - 1)).toBe(MAX_EXACT_INDEX - 1);
    expect(f(MAX_EXACT_INDEX + 1)).not.toBe(MAX_EXACT_INDEX + 1);
  });
});

describe('GPU heatmap columns in float32', () => {
  /** The fractional column the heatmap shader computes for css x, in float32 like the GPU. */
  function shaderColumn(px: number, x: [number, number], firstIndex: number): number {
    const r = rebaseX(x);
    const grid = f(firstIndex - r.origin);
    return f(f(f(f(f(px) - f(r.offset)) / f(r.scale)) - grid) + 0.5);
  }

  it('matches the CPU column within a hundredth of a device pixel at 1M bars', () => {
    for (const spacing of [80, 6]) {
      const t = scale(1_000_000, spacing);
      const x = t.xTransform();
      const firstIndex = t.visibleRange().from - 50;
      for (let px = 0.5; px < t.width; px += 0.5) {
        const cpu = (px - x[1]) / x[0] - firstIndex + 0.5;
        expect(Math.abs(shaderColumn(px, x, firstIndex) - cpu) * spacing).toBeLessThan(0.01);
      }
    }
  });
});
