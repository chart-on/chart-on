import { describe, expect, it } from 'vitest';
import { lowerBound } from '../src/data/util';
import { AnchoredVwap, RangeProfileCache, RegressionCache, regressionChannel, SpanTracker } from '../src/drawing/bar-studies';
import {
  anchoredVwap,
  barsPattern,
  barsPatternCopy,
  fixedRangeVolumeProfile,
  projection,
  projectionCopy,
  regressionTrend,
} from '../src/drawing/data-tools';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import { builtinTools } from '../src/drawing/tools';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import type { BarSpan, Drawing, DrawingEnv, DrawingStyle, ScreenDrawing } from '../src/drawing/types';
import { computeVolumeProfile } from '../src/profile/math';
import { darkTheme, lightTheme } from '../src/theme';
import { contrastRatio } from '../src/util/color';
import type { Bar, Point } from '../src/types';
import { withBuiltinTools } from './builtin-tools';

/** Bar `i` at time `i * 60`; `close` defaults to the middle of the range. */
function bar(i: number, low: number, high: number, volume?: number, close = (low + high) / 2): Bar {
  return { time: i * 60, open: close, high, low, close, volume };
}

const closes = (values: number[]): Bar[] => values.map((c, i) => bar(i, c, c, 1, c));

function spanOf(bars: readonly Bar[], from: number, to: number): BarSpan {
  let end = lowerBound(bars, to);
  if (bars[end]?.time === to) end++;
  return { bars, start: lowerBound(bars, from), end };
}

/** `bars` behind a proxy that counts index reads, to show what an update touched. */
function counted(bars: Bar[]) {
  const reads = { n: 0 };
  const proxy = new Proxy(bars, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.n++;
      return Reflect.get(target, key, receiver);
    },
  });
  return { bars: proxy, reads };
}

describe('regressionChannel', () => {
  it('fits a line through the closes by bar offset', () => {
    // x 0..3, mean 1.5; y 2, 4, 3, 5, mean 3.5; Sxx 5, Sxy 4, Syy 5.
    const fit = regressionChannel(closes([2, 4, 3, 5]))!;
    expect(fit.count).toBe(4);
    expect(fit.slope).toBeCloseTo(0.8, 12);
    expect(fit.intercept).toBeCloseTo(2.3, 12);
    // Residuals -0.3, 0.9, -0.9, 0.3: squared sum 1.8 over 4 bars.
    expect(fit.deviation).toBeCloseTo(Math.sqrt(0.45), 12);
    expect(fit.r).toBeCloseTo(0.8, 12);
  });

  it('is exact on a straight line and flat on one bar', () => {
    const fit = regressionChannel(closes([10, 12, 14, 16, 18]))!;
    expect(fit.slope).toBeCloseTo(2, 12);
    expect(fit.intercept).toBeCloseTo(10, 12);
    expect(fit.deviation).toBeCloseTo(0, 9);
    expect(fit.r).toBeCloseTo(1, 12);
    expect(regressionChannel(closes([7]))).toEqual({ count: 1, intercept: 7, slope: 0, deviation: 0, r: 0 });
    expect(regressionChannel([])).toBeNull();
  });

  it('keeps its precision at large prices', () => {
    const fit = regressionChannel(closes([2, 4, 3, 5].map((c) => c + 1e7)))!;
    expect(fit.slope).toBeCloseTo(0.8, 6);
    expect(fit.deviation).toBeCloseTo(Math.sqrt(0.45), 6);
  });

  it('fits only the bars of the range', () => {
    const fit = regressionChannel(closes([100, 2, 4, 3, 5, 100]), 1, 5)!;
    expect(fit.slope).toBeCloseTo(0.8, 12);
    expect(fit.intercept).toBeCloseTo(2.3, 12);
  });
});

describe('SpanTracker', () => {
  it('tells live tail changes from reloads', () => {
    const t = new SpanTracker();
    const bars = closes([1, 2, 3]);
    expect(t.check(spanOf(bars, 0, Infinity), 'k')).toBe('reset');
    expect(t.settled).toBe(2);
    expect(t.check(spanOf(bars, 0, Infinity), 'k')).toBe('none');
    bars[2] = { ...bars[2]!, close: 4 };
    expect(t.check(spanOf(bars, 0, Infinity), 'k')).toBe('tail');
    expect([t.previous, t.settled]).toEqual([2, 2]);
    // The newest bar changed in place and handed to update again.
    bars[2]!.close = 6;
    expect(t.check(spanOf(bars, 0, Infinity), 'k')).toBe('tail');
    expect(t.check(spanOf(bars, 0, Infinity), 'k')).toBe('none');
    bars.push(...closes([0, 0, 0, 5]).slice(3));
    expect(t.check(spanOf(bars, 0, Infinity), 'k')).toBe('tail');
    expect([t.previous, t.settled, t.end]).toEqual([2, 3, 4]);
    expect(t.check(spanOf(bars, 0, Infinity), 'other')).toBe('reset');
    // History prepended: a new array.
    expect(t.check(spanOf([...closes([0]), ...bars], 0, Infinity), 'other')).toBe('reset');
  });
});

describe('RegressionCache', () => {
  it('follows live bars one bar at a time', () => {
    const base = closes([2, 4, 3, 5, 6, 8, 7, 9]);
    const { bars, reads } = counted(base);
    const cache = new RegressionCache();
    expect(cache.get(spanOf(bars, 0, Infinity))).toEqual(regressionChannel(base));
    base[7] = { ...base[7]!, close: 12 };
    let span = spanOf(bars, 0, Infinity);
    reads.n = 0;
    expect(cache.get(span)!.slope).toBeCloseTo(regressionChannel(base)!.slope, 12);
    expect(reads.n).toBeLessThan(4);
    base.push(closes([0, 0, 0, 0, 0, 0, 0, 0, 10])[8]!);
    span = spanOf(bars, 0, Infinity);
    reads.n = 0;
    const fit = cache.get(span)!;
    const full = regressionChannel(base)!;
    expect(fit.slope).toBeCloseTo(full.slope, 12);
    expect(fit.intercept).toBeCloseTo(full.intercept, 12);
    expect(fit.deviation).toBeCloseTo(full.deviation, 12);
    expect(reads.n).toBeLessThan(6);
  });

  it('ignores bars after its range', () => {
    const bars = closes([2, 4, 3, 5, 50]);
    const cache = new RegressionCache();
    expect(cache.get(spanOf(bars, 0, 180), 'a')!.slope).toBeCloseTo(0.8, 12);
    bars[4] = { ...bars[4]!, close: -50 };
    expect(cache.get(spanOf(bars, 0, 180), 'a')!.slope).toBeCloseTo(0.8, 12);
  });
});

describe('AnchoredVwap', () => {
  // Typical prices 10 and 12, volumes 100 and 300.
  const two = () => [bar(0, 8, 12, 100, 10), bar(1, 10, 14, 300, 12)];

  it('averages the typical price by volume from the anchor', () => {
    const vwap = new AnchoredVwap().update(spanOf(two(), 0, Infinity));
    expect(vwap.values).toEqual([10, 11.5]);
    // Weighted variance: (100 * 0² + 300 * 2²) / 400 - 1.5² = 0.75 around the origin 10.
    expect(vwap.deviations[0]).toBe(0);
    expect(vwap.deviations[1]).toBeCloseTo(Math.sqrt(0.75), 12);
  });

  it('starts at the anchor bar and holds through bars without volume', () => {
    const bars = [bar(0, 0, 100, 1000, 50), ...two().map((b, i) => ({ ...b, time: (i + 1) * 60 })), bar(3, 0, 0, 0)];
    const vwap = new AnchoredVwap().update(spanOf(bars, 60, Infinity));
    expect(vwap.start).toBe(1);
    expect(vwap.values).toEqual([10, 11.5, 11.5]);
    const empty = new AnchoredVwap().update(spanOf([bar(0, 1, 2)], 0, Infinity));
    expect(empty.values[0]).toBeNaN();
  });

  it('updates the live bar and appends without recomputing', () => {
    const base = two();
    const { bars, reads } = counted(base);
    const vwap = new AnchoredVwap();
    vwap.update(spanOf(bars, 0, Infinity));
    base[1] = bar(1, 10, 14, 100, 12);
    let span = spanOf(bars, 0, Infinity);
    reads.n = 0;
    vwap.update(span);
    expect(vwap.values).toEqual([10, 11]);
    expect(reads.n).toBeLessThan(4);
    base.push(bar(2, 13, 17, 200, 15));
    span = spanOf(bars, 0, Infinity);
    reads.n = 0;
    vwap.update(span);
    // (100 * 10 + 100 * 12 + 200 * 15) / 400
    expect(vwap.values).toEqual([10, 11, 13]);
    expect(reads.n).toBeLessThan(6);
  });
});

describe('RangeProfileCache', () => {
  it('bins the bars of the range like computeVolumeProfile', () => {
    // Rows [0, 5) and [5, 10]: 100 spread over both, 60 in the lower one.
    const bars = [bar(0, 0, 10, 100), bar(1, 0, 5, 60)];
    const profile = new RangeProfileCache().get(spanOf(bars, 0, 60), 2, 70);
    expect(Array.from(profile.volume.subarray(0, 2))).toEqual([110, 50]);
    expect(profile.poc).toBe(0);
    // 110 of 160 is under 70%, so the value area takes the upper row too.
    expect([profile.valueAreaLow, profile.valueAreaHigh]).toEqual([0, 1]);
  });

  it('bins only the live bar while it stays inside the range', () => {
    const base = Array.from({ length: 50 }, (_, i) => bar(i, 100 + (i % 7), 110 + (i % 5), 10 + i));
    const { bars, reads } = counted(base);
    const cache = new RangeProfileCache();
    cache.get(spanOf(bars, 0, Infinity), 12, 70);
    base[49] = bar(49, 102, 108, 500);
    const span = spanOf(bars, 0, Infinity);
    reads.n = 0;
    const profile = cache.get(span, 12, 70);
    expect(reads.n).toBeLessThan(6);
    const full = computeVolumeProfile(base, 0, base.length, { rows: 12 });
    for (let r = 0; r < 12; r++) expect(profile.volume[r]).toBeCloseTo(full.volume[r]!, 9);
    expect(profile.poc).toBe(full.poc);

    // A new high lays the rows out again over the whole range.
    base.push(bar(50, 105, 130, 40));
    const grown = cache.get(spanOf(bars, 0, Infinity), 12, 70);
    const again = computeVolumeProfile(base, 0, base.length, { rows: 12 });
    expect(grown.rowHigh(11)).toBeCloseTo(130, 9);
    for (let r = 0; r < 12; r++) expect(grown.volume[r]).toBeCloseTo(again.volume[r]!, 9);
  });
});

/* ---------------- Tools ---------------- */

/** x = time / 6 + 10 (10 px per bar), y = 500 - price, over `bars`. */
function env(bars: Bar[], width = 1000): DrawingEnv {
  return {
    width,
    height: 500,
    theme: darkTheme,
    pixelRatio: 1,
    formatPrice: (price) => price.toFixed(2),
    priceToY: (price) => 500 - price,
    yToPrice: (y) => 500 - y,
    timeToX: (time) => time / 6 + 10,
    xToTime: (x) => (x - 10) * 6,
    barsBetween: () => 0,
    bars: (from, to) => {
      const s = spanOf(bars, from, to);
      return bars.slice(s.start, s.end);
    },
    barSpan: (from, to) => spanOf(bars, from, to),
    measureText: (text, fontSize) => text.length * fontSize * 0.6,
  };
}

function screen(type: string, times: number[], style: DrawingStyle = {}): ScreenDrawing {
  const drawing: Drawing = { id: 'x', type, pane: 0, points: times.map((time) => ({ time, price: 100 })), style };
  return { drawing, points: times.map((t) => ({ x: t / 6 + 10, y: 400 })), selected: false, hovered: false };
}

/** Canvas stand-in that records path points, filled rectangles and text with its fill. */
function recorder() {
  const points: Point[] = [];
  const rects: number[][] = [];
  const texts: { text: string; color: unknown }[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key) =>
      key in target
        ? target[key as string]
        : (...args: unknown[]) => {
            if (key === 'moveTo' || key === 'lineTo') points.push({ x: args[0] as number, y: args[1] as number });
            if (key === 'fillRect') rects.push(args as number[]);
            if (key === 'fillText') texts.push({ text: args[0] as string, color: target.fillStyle });
          },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, points, rects, texts };
}

describe('data-aware drawing tools', () => {
  it('are built in, with kebab-case ids and rail groups', () => {
    const byType = new Map(builtinTools.map((t) => [t.type, t]));
    expect(byType.get('regression-trend')?.group).toBe('parallels');
    expect(byType.get('anchored-vwap')?.group).toBe('measure');
    expect(byType.get('fixed-range-volume-profile')?.group).toBe('measure');
    expect(anchoredVwap.axisMarks!(screen('anchored-vwap', [60]).drawing)).toEqual({ times: [60] });
  });

  it('regression-trend draws the fit and its deviation lines', () => {
    // Closes 100, 102, ... 118: a straight rise of 2 per bar, then one bar outside the range.
    const bars = [...closes(Array.from({ length: 10 }, (_, i) => 100 + 2 * i)), ...closes([0]).map((b) => ({ ...b, time: 600 }))];
    const d = screen('regression-trend', [0, 540]);
    const { ctx, points } = recorder();
    regressionTrend.render(ctx, d, env(bars));
    // No deviation on an exact line: only the middle line, from bar 0 to bar 9.
    expect(points[0]).toEqual({ x: 10, y: 400 });
    expect(points.at(-1)!.x).toBeCloseTo(100, 9);
    expect(points.at(-1)!.y).toBeCloseTo(500 - 118, 9);
    expect(regressionTrend.hitTest(d, { x: 55, y: 500 - 109 }, env(bars))).toBe(true);
    expect(regressionTrend.hitTest(d, { x: 55, y: 300 }, env(bars))).toBe(false);
  });

  it('regression-trend offsets its outer lines by the deviation', () => {
    const bars = closes([2, 4, 3, 5]);
    const d = screen('regression-trend', [0, 180], { deviation: 1 });
    // Upper line starts at 2.3 + sqrt(0.45).
    const y = 500 - (2.3 + Math.sqrt(0.45));
    expect(regressionTrend.hitTest(d, { x: 10, y }, env(bars))).toBe(true);
    const { ctx, points } = recorder();
    regressionTrend.render(ctx, d, env(bars));
    expect(points.some((p) => p.x === 10 && Math.abs(p.y - y) < 1e-9)).toBe(true);
  });

  it('regression-trend extends to the pane edge', () => {
    const bars = closes([2, 4, 3, 5]);
    const { ctx, points } = recorder();
    regressionTrend.render(ctx, screen('regression-trend', [0, 180], { extendRight: true }), env(bars, 400));
    expect(Math.max(...points.map((p) => p.x))).toBe(400);
  });

  it('regression-trend extends to the left pane edge', () => {
    const bars = closes([2, 4, 3, 5]);
    const d = screen('regression-trend', [120, 180], { extendLeft: true });
    const { ctx, points } = recorder();
    regressionTrend.render(ctx, d, env(bars, 400));
    // The fit over bars 2 and 3 (x 30 and 40) runs on to x 0, and only there.
    expect(Math.min(...points.map((p) => p.x))).toBe(0);
    expect(Math.max(...points.map((p) => p.x))).toBe(40);
    expect(regressionTrend.styleFields).toEqual(expect.arrayContaining(['extendLeft', 'extendRight']));
  });

  it('anchored-vwap draws from its anchor bar over the visible bars', () => {
    const bars = [bar(0, 0, 100, 1000, 50), bar(1, 8, 12, 100, 10), bar(2, 10, 14, 300, 12)];
    const d = screen('anchored-vwap', [60]);
    const { ctx, points } = recorder();
    anchoredVwap.render(ctx, d, env(bars));
    expect(points.slice(0, 2)).toEqual([
      { x: 20, y: 490 },
      { x: 30, y: 488.5 },
    ]);
    expect(anchoredVwap.hitTest(d, { x: 25, y: 489 }, env(bars))).toBe(true);
    expect(anchoredVwap.hitTest(d, { x: 25, y: 300 }, env(bars))).toBe(false);
  });

  it('fixed-range-volume-profile draws rows from the left anchor', () => {
    const bars = [bar(0, 0, 10, 100), bar(1, 0, 5, 60), bar(2, 0, 10, 1e6)];
    const d = screen('fixed-range-volume-profile', [60, 0], { rows: 2, profileWidth: 100 });
    const { ctx, rects } = recorder();
    fixedRangeVolumeProfile.render(ctx, d, env(bars));
    // Background box, then the rows: the larger one spans the range width (10 px).
    const rows = rects.slice(1);
    expect(rows.map((r) => r[0])).toEqual([10, 10]);
    expect(rows[0]![2]).toBeCloseTo(10, 9);
    expect(rows[1]![2]).toBeCloseTo(50 / 11, 9);
    expect(fixedRangeVolumeProfile.bounds!(d, env(bars))).toEqual({ x: 10, y: 490, width: 10, height: 10 });
    expect(fixedRangeVolumeProfile.hitTest(d, { x: 15, y: 495 }, env(bars))).toBe(true);
    expect(fixedRangeVolumeProfile.hitTest(d, { x: 15, y: 300 }, env(bars))).toBe(false);
  });

  it('fixed-range-volume-profile without rows gives one row per 10 px of its height', () => {
    // Lows 100, highs 140 or 160: 40 px tall at one px per price unit, then 60 px.
    const tall = (high: number) => Array.from({ length: 30 }, (_, i) => bar(i, 100, i === 3 ? high : 140, 10));
    for (const [high, rows] of [[140, 4], [160, 6]] as const) {
      const d = screen('fixed-range-volume-profile', [0, 29 * 60]);
      const { ctx, rects } = recorder();
      fixedRangeVolumeProfile.render(ctx, d, env(tall(high)));
      expect(rects.length - 1).toBe(rows);
    }
  });

  it('fixed-range-volume-profile keeps rows saved in its style, and 0 rows is automatic', () => {
    const bars = Array.from({ length: 30 }, (_, i) => bar(i, 100, 140, 10));
    const rowsOf = (style: DrawingStyle) => {
      const { ctx, rects } = recorder();
      fixedRangeVolumeProfile.render(ctx, screen('fixed-range-volume-profile', [0, 29 * 60], style), env(bars));
      return rects.length - 1;
    };
    // A drawing saved before rows became automatic stored the old 24 rows and keeps them.
    expect(rowsOf({ rows: 24, profileWidth: 30 })).toBe(24);
    // 40 px tall at one px per price unit: 4 automatic rows.
    expect(rowsOf({ rows: 0 })).toBe(4);
    expect(fixedRangeVolumeProfile.defaultStyle).toMatchObject({ profileWidth: 50 });
    expect(fixedRangeVolumeProfile.defaultStyle!.rows).toBeUndefined();
  });

  it('recompute nothing on a redraw without new data', () => {
    const base = Array.from({ length: 30 }, (_, i) => bar(i, 100 + (i % 4), 104 + (i % 3), 10));
    const { bars, reads } = counted(base);
    const e = env(bars as Bar[]);
    const d = screen('fixed-range-volume-profile', [0, 29 * 60]);
    fixedRangeVolumeProfile.render(recorder().ctx, d, e);
    reads.n = 0;
    fixedRangeVolumeProfile.render(recorder().ctx, d, e);
    // Only the span lookup's binary search reads bars.
    expect(reads.n).toBeLessThan(20);
  });
});

describe('bars-pattern', () => {
  /** Bars 0..3 at 10 px steps: a rise, a fall, a rise, then one bar outside the range. */
  const bars: Bar[] = [
    { time: 0, open: 100, high: 112, low: 98, close: 110 },
    { time: 60, open: 110, high: 111, low: 100, close: 102 },
    { time: 120, open: 102, high: 120, low: 101, close: 118 },
    { time: 180, open: 0, high: 500, low: 0, close: 0 },
  ];
  /** Source anchors on bars 0 and 2, the target at time 600 (x 110) and price 200 (y 300). */
  function pattern(target = 600, price = 200): ScreenDrawing {
    const d = screen('bars-pattern', [0, 120, target]);
    d.drawing.points[2]!.price = price;
    return d;
  }

  it('is built in, in the measure group, with three points', () => {
    const tool = builtinTools.find((t) => t.type === 'bars-pattern');
    expect(tool).toBe(barsPattern);
    expect([tool?.group, tool?.points]).toEqual(['measure', 3]);
  });

  it('copies the bars between the first two anchors to the third, opening at its price', () => {
    const copy = barsPatternCopy(pattern(), env(bars))!;
    expect(copy).toMatchObject({ start: 0, end: 3, shift: 100, x: 110, step: 10 });
    // A target placed before the source copies the same bars; anchors in either order.
    const back = screen('bars-pattern', [120, 0, -60]);
    expect(barsPatternCopy(back, env(bars))).toMatchObject({ start: 0, end: 3, shift: 0, x: 0, step: 10 });
  });

  it('has no copy before the third anchor or without bars in the range', () => {
    expect(barsPatternCopy(screen('bars-pattern', [0, 120]), env(bars))).toBeNull();
    expect(barsPatternCopy(screen('bars-pattern', [300, 360, 600]), env(bars))).toBeNull();
    // One bar: no neighbour to measure the step from.
    expect(barsPatternCopy(screen('bars-pattern', [60, 60, 600]), env(bars))).toMatchObject({ start: 1, end: 2, step: 8 });
  });

  it('draws the copied bars moved in price, filling the falling ones', () => {
    const { ctx, points, rects } = recorder();
    barsPattern.render(ctx, pattern(), env(bars));
    // Source line, then the wicks of bars 0..2 at x 110, 120, 130 (+0.5 for crisp lines).
    expect(points.slice(0, 2)).toEqual([
      { x: 10, y: 400 },
      { x: 30, y: 400 },
    ]);
    const wicks = points.slice(2);
    expect(wicks.map((p) => p.x)).toEqual([110.5, 110.5, 110.5, 110.5, 120.5, 120.5, 120.5, 120.5, 130.5, 130.5, 130.5, 130.5]);
    // Bar 0 moved up 100: high 212, body 200..210, low 198.
    expect(wicks.slice(0, 4).map((p) => 500 - p.y)).toEqual([212, 210, 200, 198]);
    // Only bar 1 falls: its body 210..202 is filled, 6 px wide (60% of the 10 px step).
    expect(rects).toEqual([[117.5, 500 - 210, 6, 8]]);
  });

  it('bounds and hit tests the copy and the source line', () => {
    const d = pattern();
    const e = env(bars);
    // From the first body's left edge to the last one's right edge, high 220 to low 198.
    expect(barsPattern.bounds!(d, e)).toEqual({ x: 107, y: 280, width: 26, height: 22 });
    expect(barsPattern.hitTest(d, { x: 120, y: 290 }, e)).toBe(true);
    expect(barsPattern.hitTest(d, { x: 20, y: 400 }, e)).toBe(true);
    expect(barsPattern.hitTest(d, { x: 160, y: 290 }, e)).toBe(false);
    expect(barsPattern.hitTest(d, { x: 120, y: 200 }, e)).toBe(false);
  });

  it('follows the bars as history loads', () => {
    const data: Bar[] = [];
    const e = env(data);
    const d = pattern();
    const empty = recorder();
    barsPattern.render(empty.ctx, d, e);
    expect(empty.points).toHaveLength(2);
    data.push(...bars);
    const loaded = recorder();
    barsPattern.render(loaded.ctx, d, e);
    expect(loaded.points).toHaveLength(14);
  });

  it('stays in view to the right of its anchors', () => {
    expect(barsPattern.modelBounds!(pattern().drawing)).toEqual({ from: 0, to: Infinity, low: -Infinity, high: Infinity });
  });
});

describe('projection', () => {
  /** Closes 100, 110, 104 on bars 0..2, then two more bars; the newest closes at 150. */
  const bars: Bar[] = [100, 110, 104, 120, 150].map((close, i) => bar(i, close, close, 1, close));

  it('is built in, in the measure group, with two points', () => {
    const tool = builtinTools.find((t) => t.type === 'projection');
    expect(tool).toBe(projection);
    expect([tool?.group, tool?.points]).toEqual(['measure', 2]);
  });

  it('replays the closes between the anchors from the newest bar, starting on its close', () => {
    // Newest bar at time 240 (x 50); the copy moves up 50 so its first close sits on 150.
    expect(projectionCopy(screen('projection', [0, 120]), env(bars))).toMatchObject({ start: 0, end: 3, shift: 50, x: 50, step: 10 });
    // Anchors in either order, and a range that ends on the newest bar.
    expect(projectionCopy(screen('projection', [240, 180]), env(bars))).toMatchObject({ start: 3, end: 5, shift: 30, x: 50, step: 10 });
  });

  it('has no copy without bars between the anchors', () => {
    expect(projectionCopy(screen('projection', [300, 360]), env(bars))).toBeNull();
    expect(projectionCopy(screen('projection', [0, 120]), env([]))).toBeNull();
    // One bar: no neighbour to measure the step from.
    expect(projectionCopy(screen('projection', [60, 60]), env(bars))).toMatchObject({ start: 1, end: 2, shift: 40, step: 8 });
  });

  it('draws the source line, then the moved close path', () => {
    const { ctx, points } = recorder();
    projection.render(ctx, screen('projection', [0, 120]), env(bars));
    expect(points).toEqual([
      { x: 10, y: 400 },
      { x: 30, y: 400 },
      { x: 50, y: 500 - 150 },
      { x: 60, y: 500 - 160 },
      { x: 70, y: 500 - 154 },
    ]);
  });

  it('bounds and hit tests the path and the source line', () => {
    const d = screen('projection', [0, 120]);
    const e = env(bars);
    expect(projection.bounds!(d, e)).toEqual({ x: 50, y: 340, width: 20, height: 10 });
    expect(projection.hitTest(d, { x: 55, y: 345 }, e)).toBe(true);
    expect(projection.hitTest(d, { x: 20, y: 400 }, e)).toBe(true);
    expect(projection.hitTest(d, { x: 55, y: 300 }, e)).toBe(false);
    expect(projection.bounds!(screen('projection', [300, 360]), e)).toBeNull();
  });

  it('follows the newest bar and fills in as history loads', () => {
    const data: Bar[] = [];
    const e = env(data);
    const d = screen('projection', [0, 120]);
    const empty = recorder();
    projection.render(empty.ctx, d, e);
    expect(empty.points).toHaveLength(2);
    data.push(...bars.slice(0, 4));
    expect(projectionCopy(d, e)).toMatchObject({ shift: 20, x: 40 });
    data.push(bars[4]!);
    expect(projectionCopy(d, e)).toMatchObject({ shift: 50, x: 50 });
    const loaded = recorder();
    projection.render(loaded.ctx, d, e);
    expect(loaded.points).toHaveLength(5);
  });

  it('stays in view to the right of its anchors', () => {
    expect(projection.modelBounds!(screen('projection', [120, 60]).drawing)).toEqual({ from: 60, to: Infinity, low: -Infinity, high: Infinity });
  });
});

describe('data-aware drawings in the manager', () => {
  function manager(bars: Bar[]) {
    const timeline = new Timeline();
    timeline.set(bars.map((b) => b.time));
    const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
    time.width = 1000;
    time.barCount = bars.length;
    const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
    pane.height = 500;
    pane.price.height = 500;
    pane.price.fit(0, 500);
    const host: DrawingHost = {
      theme: darkTheme,
      timeline,
      time,
      panes: [pane],
      magnetPrice: (_i, price) => price,
      formatPrice: (_p, price) => price.toFixed(2),
      requestOverlay: () => {},
      editText: (_at, _initial, done) => done(null),
      emit: () => {},
      barSpan: (from, to) => spanOf(bars, from, to),
    };
    return withBuiltinTools(new DrawingManager(host));
  }

  it('saves and loads their settings, and drops invalid ones', () => {
    const bars = closes([2, 4, 3, 5]);
    const m = manager(bars);
    m.add({ type: 'fixed-range-volume-profile', pane: 0, points: [{ time: 0, price: 3 }, { time: 180, price: 3 }], style: { rows: 12, valueArea: 60 } });
    const saved = JSON.parse(JSON.stringify(m.serialize()));
    const other = manager(bars);
    expect(other.load(saved).errors).toEqual([]);
    expect(other.getAll()[0]?.style).toMatchObject({ rows: 12, valueArea: 60 });

    saved.drawings[0].style.rows = -1;
    const result = manager(bars).load(saved);
    expect(result.errors).toEqual([{ index: 0, field: 'style.rows', reason: 'must be a finite number >= 0' }]);
  });

  it('render through a host that only copies bars', () => {
    const bars = closes([2, 4, 3, 5]);
    const m = manager(bars);
    m.add({ type: 'regression-trend', pane: 0, points: [{ time: 0, price: 3 }, { time: 180, price: 3 }], style: {} });
    m.add({ type: 'anchored-vwap', pane: 0, points: [{ time: 60, price: 3 }], style: { deviation: 1, showLabel: false } });
    // Without a label nothing measures text, which needs a DOM.
    const { ctx, points } = recorder();
    m.render(ctx, 0, 1000, 500);
    expect(points.length).toBeGreaterThan(4);
  });
});

describe('data tool labels', () => {
  // Picked for its luminance alone: pale enough that the light theme's white
  // background, the old label text color, would vanish on it.
  const PALE = '#f2e394';
  const bars = Array.from({ length: 10 }, (_, i) => bar(i, 100 + i, 104 + i, 10 + i));
  const e = { ...env(bars), theme: lightTheme };

  it('write black or white text, whichever contrasts with the label color', () => {
    const labels = (render: (ctx: CanvasRenderingContext2D) => void) => {
      const { ctx, texts } = recorder();
      render(ctx);
      return texts;
    };
    const drawn = [
      ...labels((ctx) => regressionTrend.render(ctx, screen('regression-trend', [0, 540], { color: PALE, showStats: true }), e)),
      ...labels((ctx) => anchoredVwap.render(ctx, screen('anchored-vwap', [0], { color: PALE }), e)),
      ...labels((ctx) => fixedRangeVolumeProfile.render(ctx, screen('fixed-range-volume-profile', [0, 540], { color: PALE }), e)),
    ];
    expect(drawn).toHaveLength(3);
    for (const t of drawn) expect(contrastRatio(t.color as string, PALE), t.text).toBeGreaterThanOrEqual(4.5);
  });
});
