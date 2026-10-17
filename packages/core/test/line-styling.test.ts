import { describe, expect, it, vi } from 'vitest';
import { LinePath, buildLinePath, lineDash, traceRun, type LineShape } from '../src/line-path';
import { CandleSeries, LineSeries, drawPolyline, type LineSeriesOptions, type PaneEnv, type SeriesHost } from '../src/series';
import { IndicatorSeries } from '../src/indicators/series';
import type { IndicatorRunner } from '../src/indicators/runner';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';

type Call = [string, ...unknown[]];

/** Canvas stub that records every method call and property write, in order. */
function recorder() {
  const calls: Call[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_t, key) => {
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...args: unknown[]) => {
        calls.push([String(key), ...args]);
      };
    },
    set: (_t, key, value) => {
      calls.push(['set', String(key), value]);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const named = (name: string) => calls.filter((c) => c[0] === name);
  const sets = (prop: string) => calls.filter((c) => c[0] === 'set' && c[1] === prop).map((c) => c[2]);
  return { ctx, calls, named, sets };
}

/** Vertices of each run as [x, y] pairs. */
function runs(path: LinePath): [number, number][][] {
  const out: [number, number][][] = [];
  for (let r = 0; r < path.runCount; r++) {
    const run: [number, number][] = [];
    for (let i = path.start(r); i < path.end(r); i++) run.push([path.x[i]!, path.y[i]!]);
    out.push(run);
  }
  return out;
}

/** Path of `values` at consecutive indices (or `indices`), x = index * spacing, y = value. */
function build(values: number[], shape: LineShape = {}, spacing = 10, indices?: number[]): LinePath {
  return buildLinePath(
    new LinePath(),
    0,
    values.length,
    (k) => indices?.[k] ?? k,
    (k) => values[k]!,
    (i) => i * spacing,
    (v) => v,
    shape,
  );
}

describe('buildLinePath: simple', () => {
  it('keeps every point while each has its own pixel column', () => {
    expect(runs(build([5, 7, 6]))).toEqual([
      [
        [0, 5],
        [10, 7],
        [20, 6],
      ],
    ]);
  });

  it('keeps first, lowest, highest and last of points sharing a column', () => {
    // 0.1 px apart: indices 0..4 round to column 0, index 10 to column 1.
    const values = [5, 9, 1, 4, 3];
    const path = buildLinePath(new LinePath(), 0, 6, (k) => (k < 5 ? k : 10), (k) => values[k] ?? 8, (i) => i * 0.1, (v) => v);
    expect(runs(path)).toEqual([
      [
        [0, 5],
        [0, 1],
        [0, 9],
        [0, 3],
        [1, 8],
      ],
    ]);
  });

  it('stays O(width) however many points there are', () => {
    const n = 100_000;
    const path = buildLinePath(new LinePath(), 0, n, (k) => k, (k) => Math.sin(k), (i) => (i / n) * 500, (v) => v);
    expect(path.length).toBeLessThanOrEqual(4 * 501);
  });

  it('leaves gaps at NaN values without empty runs', () => {
    const path = build([NaN, 1, 2, NaN, NaN, 3, 4, NaN]);
    expect(runs(path)).toEqual([
      [
        [10, 1],
        [20, 2],
      ],
      [
        [50, 3],
        [60, 4],
      ],
    ]);
    expect(build([NaN, NaN]).runCount).toBe(0);
    expect(build([]).runCount).toBe(0);
  });

  it('breaks on missing bars only with breakGaps', () => {
    const indices = [0, 1, 4, 5];
    expect(build([1, 2, 3, 4], {}, 10, indices).runCount).toBe(1);
    expect(runs(build([1, 2, 3, 4], { breakGaps: true }, 10, indices))).toEqual([
      [
        [0, 1],
        [10, 2],
      ],
      [
        [40, 3],
        [50, 4],
      ],
    ]);
  });

  it('does not count a NaN gap as a missing bar break twice', () => {
    // breakGaps after a NaN: the run already ended, so no empty run appears.
    expect(build([1, NaN, 3, 4], { breakGaps: true }, 10, [0, 1, 5, 6]).runCount).toBe(2);
  });

  it('reuses its buffers between builds and grows when needed', () => {
    const path = new LinePath();
    const x = path.x;
    buildLinePath(path, 0, 100, (k) => k, (k) => k, (i) => i * 10, (v) => v);
    buildLinePath(path, 0, 50, (k) => k, (k) => k, (i) => i * 10, (v) => v);
    expect(path.x).toBe(x);
    expect(path.length).toBe(50);
    buildLinePath(path, 0, 1000, (k) => k, (k) => k, (i) => i * 10, (v) => v);
    expect(path.length).toBe(1000);
    expect(path.x[999]).toBe(9990);
  });
});

describe('buildLinePath: step', () => {
  it('holds each value until the next point, then jumps', () => {
    expect(runs(build([5, 7, 7, 6], { lineType: 'step' }))).toEqual([
      [
        [0, 5],
        [10, 5],
        [10, 7],
        [20, 7],
        [30, 7],
        [30, 6],
      ],
    ]);
  });

  it('does not step across a NaN gap or a breakGaps break', () => {
    expect(runs(build([5, NaN, 7, 8], { lineType: 'step' }))).toEqual([
      [[0, 5]],
      [
        [20, 7],
        [30, 7],
        [30, 8],
      ],
    ]);
    expect(runs(build([5, 6, 7], { lineType: 'step', breakGaps: true }, 10, [0, 2, 3]))).toEqual([
      [[0, 5]],
      [
        [20, 6],
        [30, 6],
        [30, 7],
      ],
    ]);
  });

  it('decimates before stepping, so dense data stays O(width) and keeps its extremes', () => {
    const n = 50_000;
    const path = buildLinePath(new LinePath(), 0, n, (k) => k, (k) => (k % 7) - 3, (i) => (i / n) * 300, (v) => v, {
      lineType: 'step',
    });
    expect(path.length).toBeLessThanOrEqual(8 * 301);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < path.length; i++) {
      lo = Math.min(lo, path.y[i]!);
      hi = Math.max(hi, path.y[i]!);
      // Every segment is horizontal or vertical.
      if (i > 0) expect(path.x[i] === path.x[i - 1] || path.y[i] === path.y[i - 1]).toBe(true);
    }
    expect([lo, hi]).toEqual([-3, 3]);
  });
});

describe('buildLinePath: curved', () => {
  it('gives monotone tangents: flat at extremes and ends that follow the secant', () => {
    const path = build([0, 10, 20, 10], { lineType: 'curved' });
    const slopes = Array.from(path.slope.subarray(0, path.length));
    expect(slopes[0]).toBeCloseTo(1); // first secant
    expect(slopes[1]).toBeCloseTo(1); // harmonic mean of 1 and 1
    expect(slopes[2]).toBe(0); // local maximum
    expect(slopes[3]).toBeCloseTo(-1); // last secant
  });

  it('never overshoots: control points stay between the segment ends', () => {
    const values = [0, 30, 31, 5, 5, 40, -10];
    const path = build(values, { lineType: 'curved' });
    const { ctx, named } = recorder();
    traceRun(ctx, path, 0, true);
    const curves = named('bezierCurveTo');
    expect(curves).toHaveLength(values.length - 1);
    curves.forEach((c, i) => {
      const [, , y1, , y2, , y] = c as [string, number, number, number, number, number, number];
      const lo = Math.min(values[i]!, y);
      const hi = Math.max(values[i]!, y);
      for (const cy of [y1, y2]) {
        expect(cy).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(cy).toBeLessThanOrEqual(hi + 1e-9);
      }
    });
  });

  it('draws points stacked in one column as straight segments', () => {
    const values = [5, 9, 1, 4, 3];
    const path = buildLinePath(new LinePath(), 0, 6, (k) => (k < 5 ? k : 10), (k) => values[k] ?? 8, (i) => i * 0.1, (v) => v, {
      lineType: 'curved',
    });
    const { ctx, named } = recorder();
    traceRun(ctx, path, 0, true);
    expect(named('lineTo')).toHaveLength(3);
    expect(named('bezierCurveTo')).toHaveLength(1);
  });

  it('computes tangents per run across NaN gaps and breakGaps', () => {
    const path = build([0, 10, NaN, 50, 40], { lineType: 'curved' });
    expect(path.runCount).toBe(2);
    // Each run's ends follow their own secant, not one across the gap.
    expect(path.slope[0]).toBeCloseTo(1);
    expect(path.slope[1]).toBeCloseTo(1);
    expect(path.slope[2]).toBeCloseTo(-1);
    expect(path.slope[3]).toBeCloseTo(-1);
    const gaps = build([0, 10, 50, 40], { lineType: 'curved', breakGaps: true }, 10, [0, 1, 3, 4]);
    expect(gaps.runCount).toBe(2);
    expect(Array.from(gaps.slope.subarray(0, 4)).map((v) => Math.round(v))).toEqual([1, 1, -1, -1]);
    // A lone point has a flat tangent.
    expect(build([NaN, 3, NaN], { lineType: 'curved' }).slope[0]).toBe(0);
  });
});

describe('lineDash', () => {
  it('is empty for solid lines and scales with the width otherwise', () => {
    expect(lineDash('solid', 2)).toEqual([]);
    expect(lineDash(undefined, 2)).toEqual([]);
    expect([...lineDash('dashed', 1.5)]).toEqual([6, 4]);
    expect([...lineDash('dashed', 4)]).toEqual([12, 8]);
    expect([...lineDash('dotted', 1.5)]).toEqual([1.5, 3]);
    expect([...lineDash('dotted', 3)]).toEqual([3, 6]);
  });
});

function setup(options: Partial<LineSeriesOptions> = {}, barSpacing = 20) {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 10 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 200;
  time.barCount = 10;
  const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  pane.height = 200;
  pane.price.height = 200;
  pane.price.fit(0, 200);
  const host = {
    timeline,
    theme: darkTheme,
    maxTextureSize: 4096,
    mainDataChanged: () => {},
    mainLastBarChanged: () => {},
    requestRender: vi.fn(),
  } satisfies SeriesHost;
  const series = new LineSeries(host, pane, {
    title: 'L',
    lineWidth: 2,
    area: false,
    format: String,
    lastValueLabel: true,
    color: '#123456',
    renderer: 'canvas',
    ...options,
  });
  series.setData(Array.from({ length: 10 }, (_, i) => ({ time: i * 60, value: 100 + i })));
  const env: PaneEnv = { time, pane, width: 200, height: 200, from: 0, to: 9, dpr: 1, theme: darkTheme };
  return { series, env, time, pane, host };
}

describe('drawPolyline', () => {
  it('dashes the stroke, then resets the dash', () => {
    const { env } = setup();
    const { ctx, named } = recorder();
    drawPolyline(ctx, env, 0, 3, (k) => k, (k) => k * 10, { color: 'red', lineWidth: 2, lineStyle: 'dashed' });
    expect(named('setLineDash').map((c) => c[1])).toEqual([[6, 4], []]);
    const { ctx: solid, named: solidNamed } = recorder();
    drawPolyline(solid, env, 0, 3, (k) => k, (k) => k * 10, { color: 'red', lineWidth: 2 });
    expect(solidNamed('setLineDash')).toEqual([]);
  });

  it('fills each run down to the bottom separately', () => {
    const { env } = setup();
    const { ctx, named } = recorder();
    const values = [1, 2, NaN, 4, 5];
    drawPolyline(ctx, env, 0, 5, (k) => k, (k) => values[k]!, { color: 'red', lineWidth: 1, fill: ['a', 'b'] });
    expect(named('closePath')).toHaveLength(2);
    expect(named('fill')).toHaveLength(1);
    // Fill and stroke both start each run with a moveTo.
    expect(named('moveTo')).toHaveLength(4);
    expect(named('stroke')).toHaveLength(1);
  });
});

describe('LineSeries styling', () => {
  it('draws curves for the curved type and keeps straight lines by default', () => {
    const curved = setup({ lineType: 'curved' });
    const a = recorder();
    curved.series.draw2D(a.ctx, curved.env);
    expect(a.named('bezierCurveTo').length).toBeGreaterThan(0);
    const plain = setup();
    const b = recorder();
    plain.series.draw2D(b.ctx, plain.env);
    expect(b.named('bezierCurveTo')).toEqual([]);
    expect(b.named('arc')).toEqual([]); // no markers by default
  });

  it('applies breakGaps and the line style in baseline mode too', () => {
    const { series, env } = setup({ baseline: 104, breakGaps: true, lineStyle: 'dotted' });
    series.setData([0, 1, 2, 5, 6].map((i) => ({ time: i * 60, value: 100 + i })));
    const { ctx, named } = recorder();
    series.draw2D(ctx, env);
    // Two clipped halves with two runs each, then the base level line.
    expect(named('moveTo')).toHaveLength(5);
    expect(named('setLineDash').map((c) => c[1])).toContainEqual([2, 4]);
  });

  it('puts a dot on every point while bars are wide enough', () => {
    const wide = setup({ pointMarkers: true }, 20);
    const a = recorder();
    wide.series.draw2D(a.ctx, wide.env);
    const arcs = a.named('arc');
    expect(arcs).toHaveLength(10);
    expect(arcs[0]![3]).toBe(3); // default radius: line width + 1
    expect(a.sets('fillStyle')).toEqual(['#123456']);

    const narrow = setup({ pointMarkers: { radius: 5 } }, 10);
    const b = recorder();
    narrow.series.draw2D(b.ctx, narrow.env);
    expect(b.named('arc')).toEqual([]);
  });

  it('colours point markers by side in baseline mode', () => {
    const { series, env } = setup({ baseline: 104.5, aboveColor: '#00ff00', belowColor: '#ff0000', pointMarkers: true });
    const { ctx, sets } = recorder();
    series.draw2D(ctx, env);
    expect(sets('fillStyle').filter((c) => c === '#00ff00' || c === '#ff0000')).toEqual(['#ff0000', '#00ff00']);
  });

  it('marks where the crosshair meets the line', () => {
    const { series, env } = setup({ crosshairMarker: { radius: 6, color: '#abcdef' } });
    const { ctx, named, sets } = recorder();
    series.drawCrosshair2D(ctx, { ...env, crosshair: 3 });
    const arcs = named('arc');
    expect(arcs).toHaveLength(1);
    expect(arcs[0]![1]).toBeCloseTo(env.time.indexToX(3));
    expect(arcs[0]![2]).toBeCloseTo(series.scale.priceToY(103));
    expect(arcs[0]![3]).toBe(6);
    expect(sets('fillStyle')).toContain('#abcdef');

    // No crosshair, or a bar without a point: nothing. The line itself never draws
    // it: it is on the crosshair layer, which redraws without the line.
    const none = recorder();
    series.drawCrosshair2D(none.ctx, env);
    series.drawCrosshair2D(none.ctx, { ...env, crosshair: 42 });
    series.draw2D(none.ctx, { ...env, crosshair: 3 });
    expect(none.named('arc')).toEqual([]);
  });

  it('leaves the legend unchanged', () => {
    const styled = setup({ lineStyle: 'dashed', lineType: 'step', pointMarkers: true, crosshairMarker: true });
    const plain = setup();
    expect(styled.series.legend(4)).toEqual(plain.series.legend(4));
    expect(styled.series.lastValues()).toEqual(plain.series.lastValues());
  });
});

describe('lineStyle on candles and indicators', () => {
  function candleSetup(style: 'line' | 'area' | 'step' | 'baseline') {
    const { host, pane, env } = setup();
    const series = new CandleSeries(host, pane, {
      title: 'C',
      style,
      bodyRatio: 0.7,
      lineWidth: 2,
      lastValueLabel: true,
      animate: false,
      renderer: 'canvas',
      lineStyle: 'dashed',
    });
    series.isMain = true;
    series.setData(Array.from({ length: 10 }, (_, i) => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 + i })));
    series.rebuild();
    return { series, env };
  }

  it.each(['line', 'area', 'step', 'baseline'] as const)('dashes the %s style', (style) => {
    const { series, env } = candleSetup(style);
    const { ctx, named } = recorder();
    series.draw2D(ctx, env);
    expect(named('setLineDash').map((c) => c[1])).toContainEqual([6, 4]);
  });

  it('dashes indicator line plots and leaves NaN gaps', () => {
    const { host, pane, env } = setup();
    const values = new Float64Array([1, 2, 3, NaN, NaN, 6, 7, 8, 9, 10]).map((v) => v + 100);
    const runner = {
      def: { plots: [{ id: 'v', type: 'line', lineStyle: 'dotted', lineWidth: 2 }] },
      out: { v: values },
      length: values.length,
      inputs: {},
      dispose() {},
    } as unknown as IndicatorRunner;
    const series = new IndicatorSeries(host, pane, { title: 'I', format: String, renderer: 'canvas' }, runner);
    const { ctx, named } = recorder();
    series.draw2D(ctx, env);
    expect(named('setLineDash').map((c) => c[1])).toContainEqual([2, 4]);
    expect(named('moveTo')).toHaveLength(2);
  });
});
