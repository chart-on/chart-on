import { describe, expect, it } from 'vitest';
import { builtinSketchRecognizers, isScribble, recognizeSketch, type SketchRecognizer } from '../src/drawing/sketch';
import type { Point } from '../src/types';

/** Points every `step` px along the polyline through `corners`. */
function path(corners: Point[], step = 3): Point[] {
  const out: Point[] = [{ ...corners[0]! }];
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1]!;
    const b = corners[i]!;
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number, n = 80): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}

/** Deterministic hand jitter of up to `amount` px on each axis. */
function jitter(points: Point[], amount = 2): Point[] {
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
  return points.map((p) => ({ x: p.x + rand() * amount, y: p.y + rand() * amount }));
}

const best = (points: Point[], plotWidth?: number) => recognizeSketch(points, plotWidth === undefined ? {} : { plotWidth })[0];

describe('recognizeSketch', () => {
  it('reads a diagonal stroke as a trend line from its first to its last point', () => {
    const c = best(path([{ x: 10, y: 200 }, { x: 210, y: 60 }]));
    expect(c?.tool).toBe('trendline');
    expect(c?.points).toEqual([{ x: 10, y: 200 }, { x: 210, y: 60 }]);
  });

  it('reads a straight stroke into a side of the plot as a ray, with the trend line next', () => {
    const out = recognizeSketch(path([{ x: 100, y: 200 }, { x: 395, y: 80 }]), { plotWidth: 400 });
    expect(out.map((c) => c.tool)).toEqual(['ray', 'trendline']);
    expect(out[0]!.points).toEqual([{ x: 100, y: 200 }, { x: 395, y: 80 }]);
    expect(best(path([{ x: 300, y: 200 }, { x: 5, y: 80 }]), 400)?.tool).toBe('ray');
    expect(best(path([{ x: 100, y: 200 }, { x: 300, y: 80 }]), 400)?.tool).toBe('trendline');
  });

  it('reads a flat stroke as a horizontal line at its mean height', () => {
    const out = recognizeSketch(path([{ x: 20, y: 100 }, { x: 220, y: 108 }]));
    expect(out.map((c) => c.tool)).toEqual(['hline', 'trendline']);
    expect(out[0]!.points).toHaveLength(1);
    expect(out[0]!.points[0]!.y).toBeCloseTo(104, 0);
  });

  it('reads an upright stroke as a vertical line', () => {
    const out = recognizeSketch(path([{ x: 50, y: 20 }, { x: 46, y: 220 }]));
    expect(out[0]!.tool).toBe('vline');
    expect(out[0]!.points[0]!.x).toBeCloseTo(48, 0);
    expect(out[1]!.tool).toBe('trendline');
  });

  it('reads a closed four-corner loop as a rectangle between opposite corners', () => {
    const c = best(path([{ x: 40, y: 40 }, { x: 240, y: 40 }, { x: 240, y: 140 }, { x: 40, y: 140 }, { x: 40, y: 42 }]));
    expect(c?.tool).toBe('rectangle');
    expect(c?.points).toEqual([{ x: 40, y: 40 }, { x: 240, y: 140 }]);
  });

  it('reads a round loop as an ellipse in its bounding box', () => {
    const c = best(ellipsePath(150, 100, 80, 40));
    expect(c?.tool).toBe('ellipse');
    expect(c?.points[0]!.x).toBeCloseTo(70, 0);
    expect(c?.points[0]!.y).toBeCloseTo(60, 0);
    expect(c?.points[1]!.x).toBeCloseTo(230, 0);
    expect(c?.points[1]!.y).toBeCloseTo(140, 0);
  });

  it('reads a shaft with a hook as an arrow to the tip', () => {
    const out = recognizeSketch(path([{ x: 20, y: 200 }, { x: 220, y: 80 }, { x: 196, y: 102 }]));
    expect(out[0]!.tool).toBe('arrow');
    expect(out[0]!.points).toEqual([{ x: 20, y: 200 }, { x: 220, y: 80 }]);
    expect(out.map((c) => c.tool)).toContain('trendline');
  });

  it('reads a zig-zag as a Fibonacci retracement from swing to swing', () => {
    const c = best(path([{ x: 20, y: 150 }, { x: 80, y: 40 }, { x: 140, y: 200 }, { x: 200, y: 110 }]));
    expect(c?.tool).toBe('fib-retracement');
    // The high comes first from the left, then the low.
    expect(c?.points).toEqual([{ x: 80, y: 40 }, { x: 140, y: 200 }]);
  });

  it('reads noisy strokes as the same shapes', () => {
    expect(best(jitter(path([{ x: 10, y: 200 }, { x: 210, y: 60 }])))?.tool).toBe('trendline');
    expect(best(jitter(path([{ x: 20, y: 100 }, { x: 220, y: 106 }])))?.tool).toBe('hline');
    expect(best(jitter(path([{ x: 40, y: 40 }, { x: 240, y: 40 }, { x: 240, y: 140 }, { x: 40, y: 140 }, { x: 40, y: 44 }])))?.tool).toBe('rectangle');
    expect(best(jitter(ellipsePath(150, 100, 80, 40)))?.tool).toBe('ellipse');
    expect(best(jitter(path([{ x: 20, y: 200 }, { x: 220, y: 80 }, { x: 196, y: 102 }])))?.tool).toBe('arrow');
    expect(best(jitter(path([{ x: 20, y: 150 }, { x: 80, y: 40 }, { x: 140, y: 200 }, { x: 200, y: 110 }])))?.tool).toBe('fib-retracement');
  });

  it('matches nothing for taps, arcs, corners, triangles and scribbles', () => {
    expect(recognizeSketch([])).toEqual([]);
    expect(recognizeSketch([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 7 }])).toEqual([]);
    expect(recognizeSketch([{ x: Number.NaN, y: 0 }, { x: 100, y: 0 }])).toEqual([]);
    const arc = Array.from({ length: 41 }, (_, i) => {
      const t = Math.PI + (i / 40) * Math.PI;
      return { x: 150 + 100 * Math.cos(t), y: 150 + 100 * Math.sin(t) };
    });
    expect(recognizeSketch(arc)).toEqual([]);
    expect(recognizeSketch(path([{ x: 50, y: 40 }, { x: 50, y: 200 }, { x: 220, y: 200 }]))).toEqual([]);
    expect(recognizeSketch(path([{ x: 50, y: 40 }, { x: 120, y: 200 }, { x: 190, y: 40 }]))).toEqual([]);
    expect(recognizeSketch(path([{ x: 50, y: 200 }, { x: 150, y: 40 }, { x: 250, y: 200 }, { x: 52, y: 200 }]))).toEqual([]);
    const scribble = path([{ x: 50, y: 100 }, { x: 150, y: 110 }, { x: 52, y: 120 }, { x: 148, y: 130 }, { x: 54, y: 140 }, { x: 150, y: 150 }]);
    expect(recognizeSketch(scribble)).toEqual([]);
  });

  it('ranks candidates best first and drops those under minScore', () => {
    const stroke = path([{ x: 20, y: 100 }, { x: 220, y: 108 }]);
    const all = recognizeSketch(stroke, { minScore: 0 });
    for (let i = 1; i < all.length; i++) expect(all[i - 1]!.score).toBeGreaterThanOrEqual(all[i]!.score);
    expect(recognizeSketch(stroke, { minScore: 0.99 })).toEqual([]);
  });

  it('asks custom recognisers alongside the built-in ones', () => {
    const check: SketchRecognizer = (s) => {
      const [a, b, c] = [s.points[0]!, s.points[Math.floor(s.points.length / 4)]!, s.points[s.points.length - 1]!];
      return b.y > a.y && c.y < a.y ? [{ tool: 'checkmark', score: 0.99, points: [{ ...b }] }] : [];
    };
    const stroke = path([{ x: 20, y: 100 }, { x: 50, y: 140 }, { x: 140, y: 20 }]);
    expect(recognizeSketch(stroke)[0]?.tool).not.toBe('checkmark');
    expect(recognizeSketch(stroke, { recognizers: [...builtinSketchRecognizers, check] })[0]!.tool).toBe('checkmark');
    expect(recognizeSketch(path([{ x: 10, y: 200 }, { x: 210, y: 60 }]), { recognizers: [check] })).toEqual([]);
  });
});

describe('isScribble', () => {
  it('reads a stroke that doubles back four or more times as a scribble', () => {
    const across = path([{ x: 50, y: 100 }, { x: 150, y: 104 }, { x: 52, y: 108 }, { x: 148, y: 112 }, { x: 54, y: 116 }, { x: 150, y: 120 }]);
    expect(isScribble(across)).toBe(true);
    expect(isScribble(jitter(across))).toBe(true);
    // Rounded turns, up and down while drifting right.
    const wave = Array.from({ length: 200 }, (_, i) => ({ x: 100 + i * 0.3, y: 100 + 40 * Math.cos((i / 199) * 5 * Math.PI) }));
    expect(isScribble(wave)).toBe(true);
  });

  it('does not read shapes the recognisers place as scribbles', () => {
    expect(isScribble(path([{ x: 10, y: 200 }, { x: 210, y: 60 }]))).toBe(false);
    expect(isScribble(path([{ x: 40, y: 40 }, { x: 240, y: 40 }, { x: 240, y: 140 }, { x: 40, y: 140 }, { x: 40, y: 44 }]))).toBe(false);
    expect(isScribble(jitter(ellipsePath(150, 100, 80, 40)))).toBe(false);
    expect(isScribble(path([{ x: 20, y: 200 }, { x: 220, y: 80 }, { x: 196, y: 102 }]))).toBe(false);
    expect(isScribble(path([{ x: 20, y: 150 }, { x: 80, y: 40 }, { x: 140, y: 200 }, { x: 200, y: 110 }]))).toBe(false);
    // Three sharp turns are a steep zig-zag, not yet a scribble.
    expect(isScribble(path([{ x: 50, y: 100 }, { x: 150, y: 104 }, { x: 52, y: 108 }, { x: 148, y: 112 }, { x: 54, y: 116 }]))).toBe(false);
    expect(isScribble([{ x: 10, y: 10 }, { x: 12, y: 11 }])).toBe(false);
  });
});
