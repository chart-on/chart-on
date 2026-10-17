import { describe, expect, it, vi } from 'vitest';
import { ColorPalette, LinePath, buildLinePath, type LineShape } from '../src/line-path';
import { LineSeries, drawColoredLine, type LineSeriesOptions, type PaneEnv, type SeriesHost } from '../src/series';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import type { ValuePoint } from '../src/types';
import { PulseClock } from '../src/pulse';

type Call = [string, ...unknown[]];

/** Canvas stub that records every method call and property write, in order. */
function recorder() {
  const calls: Call[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_t, key) => {
      if (key === 'createLinearGradient') {
        return (...args: unknown[]) => {
          const stops: unknown[] = [];
          calls.push(['createLinearGradient', ...args]);
          return { stops, addColorStop: (at: number, c: string) => stops.push([at, c]) };
        };
      }
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
  /** The stroke style in effect at each `stroke` call. */
  const strokes = () => {
    const out: unknown[] = [];
    let style: unknown;
    for (const c of calls) {
      if (c[0] === 'set' && c[1] === 'strokeStyle') style = c[2];
      if (c[0] === 'stroke') out.push(style);
    }
    return out;
  };
  return { ctx, calls, named, strokes };
}

/**
 * Path of `values` at consecutive indices (or `indices`), x = index * spacing,
 * y = value, with line colour ids `line` and fill ids `fill` per point.
 */
function build(values: number[], line: number[], shape: LineShape = {}, spacing = 10, fill: number[] = [], indices?: number[]) {
  return buildLinePath(
    new LinePath(),
    0,
    values.length,
    (k) => indices?.[k] ?? k,
    (k) => values[k]!,
    (i) => i * spacing,
    (v) => v,
    shape,
    { line: (k) => line[k]!, fill: (k) => fill[k] ?? 0 },
  );
}

/** Each run's vertices as [x, y, line id]. */
function runs(path: LinePath): [number, number, number][][] {
  const out: [number, number, number][][] = [];
  for (let r = 0; r < path.runCount; r++) {
    const run: [number, number, number][] = [];
    for (let i = path.start(r); i < path.end(r); i++) run.push([path.x[i]!, path.y[i]!, path.color![i]!]);
    out.push(run);
  }
  return out;
}

describe('buildLinePath: colours', () => {
  it('gives each vertex the colours of its point', () => {
    const path = build([5, 7, 6], [1, 2, 0], {}, 10, [3, 0, 0]);
    expect(path.colored).toBe(true);
    expect(runs(path)).toEqual([[[0, 5, 1], [10, 7, 2], [20, 6, 0]]]);
    expect([...path.fill!.subarray(0, 3)]).toEqual([3, 0, 0]);
  });

  it('keeps the colours of a pixel column’s last point through decimation', () => {
    // Four points share column 0 (spacing 0.1), then one point in column 10.
    const path = build([5, 1, 9, 4, 6], [1, 1, 2, 3, 4], {}, 0.1, [], [0, 1, 2, 3, 100]);
    const [run] = runs(path);
    // First, lowest, highest and last of the column all take id 3; the next column its own.
    expect(run!.map((v) => v[2])).toEqual([3, 3, 3, 3, 4]);
    expect(run!.map((v) => v[1])).toEqual([5, 1, 9, 4, 6]);
  });

  it('colours a step corner with the point it levels out from', () => {
    const path = build([5, 7, 6], [1, 2, 3], { lineType: 'step' });
    expect(runs(path)).toEqual([
      [
        [0, 5, 1],
        [10, 5, 1],
        [10, 7, 2],
        [20, 7, 2],
        [20, 6, 3],
      ],
    ]);
  });

  it('keeps colours and tangents on curved lines', () => {
    const path = build([5, 6, 7, 9], [1, 1, 2, 2], { lineType: 'curved' });
    expect(runs(path)[0]!.map((v) => v[2])).toEqual([1, 1, 2, 2]);
    expect(path.slope[1]).not.toBe(0);
  });

  it('keeps colour runs apart across gaps', () => {
    const nan = build([5, NaN, 6, 7], [1, 2, 3, 4]);
    expect(runs(nan)).toEqual([[[0, 5, 1]], [[20, 6, 3], [30, 7, 4]]]);
    const gaps = build([5, 6, 7], [1, 2, 3], { breakGaps: true }, 10, [], [0, 1, 4]);
    expect(runs(gaps)).toEqual([[[0, 5, 1], [10, 6, 2]], [[40, 7, 3]]]);
  });

  it('keeps colours when the buffers grow', () => {
    const n = 600;
    const path = build(
      Array.from({ length: n }, (_, i) => i),
      Array.from({ length: n }, (_, i) => (i % 5) + 1),
    );
    expect(path.length).toBe(n);
    for (let i = 0; i < n; i++) expect(path.color![i]).toBe((i % 5) + 1);
  });

  it('makes no colour buffers for a path without colours', () => {
    const path = buildLinePath(new LinePath(), 0, 3, (k) => k, (k) => k, (i) => i * 10, (v) => v);
    expect(path.colored).toBe(false);
    expect(path.color).toBeNull();
    expect(path.fill).toBeNull();
  });
});

describe('ColorPalette', () => {
  it('gives each colour one id and unset or unusable colours 0', () => {
    const p = new ColorPalette();
    expect(p.id(undefined)).toBe(0);
    expect(p.id('var(--x)')).toBe(0);
    const red = p.id('#ff0000');
    expect(red).toBeGreaterThan(0);
    expect(p.id('#00ff00')).not.toBe(red);
    expect(p.id('#ff0000')).toBe(red);
    expect(p.colors[red]).toBe('#ff0000');
  });
});

function setup(options: Partial<LineSeriesOptions> = {}, points?: ValuePoint[]) {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 10 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 20, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
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
    // As the `lastPointPulse()` plugin gives a chart.
    pulse: (still: () => boolean) => new PulseClock(still),
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
  series.setData(points ?? Array.from({ length: 10 }, (_, i) => ({ time: i * 60, value: 100 + i })));
  const env: PaneEnv = { time, pane, width: 200, height: 200, from: 0, to: 9, dpr: 1, theme: darkTheme };
  return { series, env };
}

/** Ten points, the first five red and the rest green. */
const twoColours = Array.from({ length: 10 }, (_, i) => ({
  time: i * 60,
  value: 100 + i,
  color: i < 5 ? '#ff0000' : '#00ff00',
}));

describe('LineSeries: per-point colours', () => {
  it('strokes once per colour run', () => {
    const { series, env } = setup({}, twoColours);
    const rec = recorder();
    series.draw2D(rec.ctx, env);
    expect(rec.strokes()).toEqual(['#ff0000', '#00ff00']);
  });

  it('draws one stroke in the series colour when no point has a colour', () => {
    const { series, env } = setup();
    const rec = recorder();
    series.draw2D(rec.ctx, env);
    expect(rec.strokes()).toEqual(['#123456']);
  });

  it('uses the series colour for points without one', () => {
    const points = twoColours.map((p, i) => (i < 5 ? { time: p.time, value: p.value } : p));
    const { series, env } = setup({}, points);
    const rec = recorder();
    series.draw2D(rec.ctx, env);
    expect(rec.strokes()).toEqual(['#123456', '#00ff00']);
  });

  it('blends between point colours in gradient mode', () => {
    const { series, env } = setup({ colorMode: 'gradient' }, twoColours);
    const rec = recorder();
    series.draw2D(rec.ctx, env);
    // Red run, one blended segment, green run.
    expect(rec.named('stroke')).toHaveLength(3);
    expect(rec.named('createLinearGradient')).toHaveLength(1);
  });

  it('fills each run of fill colour, from areaColor or the line colour', () => {
    const points = twoColours.map((p, i) => (i < 5 ? { ...p, areaColor: 'rgba(0, 0, 255, 0.5)' } : p));
    const { series, env } = setup({ area: true }, points);
    const rec = recorder();
    series.draw2D(rec.ctx, env);
    expect(rec.named('fill')).toHaveLength(2);
  });

  it('lets point colours win over the baseline colours', () => {
    const points = twoColours.map((p, i) => (i < 5 ? { time: p.time, value: p.value } : p));
    const { series, env } = setup({ baseline: 102, aboveColor: '#aaaaaa', belowColor: '#bbbbbb' }, points);
    const rec = recorder();
    series.draw2D(rec.ctx, env);
    // The uncoloured run is split at the base; the coloured run is not.
    expect(rec.strokes().slice(0, 3)).toEqual(['#aaaaaa', '#bbbbbb', '#00ff00']);
  });

  it('runs the dash on across colour changes', () => {
    const { series, env } = setup({ lineStyle: 'dashed' }, twoColours);
    const rec = recorder();
    series.draw2D(rec.ctx, env);
    const offsets = rec.calls.filter((c) => c[0] === 'set' && c[1] === 'lineDashOffset').map((c) => c[2] as number);
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBeGreaterThan(0);
  });

  it('gives the legend, last value and crosshair marker the point colour', () => {
    const { series, env } = setup({ crosshairMarker: true }, twoColours);
    expect(series.legend(2).parts[0]!.color).toBe('#ff0000');
    expect(series.legend(7).parts[0]!.color).toBe('#00ff00');
    expect(series.lastValue()!.color).toBe('#00ff00');
    const rec = recorder();
    series.drawCrosshair2D(rec.ctx, { ...env, crosshair: 3 });
    const fills = rec.calls.filter((c) => c[0] === 'set' && c[1] === 'fillStyle').map((c) => c[2]);
    expect(fills).toContain('#ff0000');
  });

  it('gives the last-point pulse the last point colour', () => {
    const { series, env } = setup({ lastPointPulse: 'continuous' }, twoColours);
    series.stepOverlay(16);
    const rec = recorder();
    series.draw2D(rec.ctx, env);
    const fills = rec.calls.filter((c) => c[0] === 'set' && c[1] === 'fillStyle').map((c) => c[2]);
    expect(fills.at(-1)).toBe('#00ff00');
  });

  it('turns colours on with an update and keeps the canvas path for them', () => {
    const { series, env } = setup({ renderer: 'gpu' });
    series.update({ time: 9 * 60, value: 110, color: '#ff0000' });
    const rec = recorder();
    series.draw2D(rec.ctx, env);
    // Off the GPU: the canvas strokes the line, the last segment start in red.
    expect(rec.strokes()).toEqual(['#123456']);
    series.update({ time: 9 * 60, value: 110, color: '#ff0000' });
    expect(series.legend(9).parts[0]!.color).toBe('#ff0000');
  });

  it('draws a GPU line with point colours on the canvas, with or without area', () => {
    expect(setup({ renderer: 'gpu' }).series.drawsOnGpu).toBe(true);
    expect(setup({ renderer: 'gpu' }, twoColours).series.drawsOnGpu).toBe(false);
    expect(setup({ renderer: 'gpu', area: true }, twoColours).series.drawsOnGpu).toBe(false);
  });

  it('ignores the colour of an update it drops', () => {
    const { series } = setup({ renderer: 'gpu' });
    series.update({ time: 0, value: 1, color: '#ff0000' });
    series.update({ time: 9 * 60, value: Number.NaN, color: '#ff0000' });
    expect(series.drawsOnGpu).toBe(true);
  });
});

describe('drawColoredLine', () => {
  it('draws nothing for a path built without colours', () => {
    const path = buildLinePath(new LinePath(), 0, 3, (k) => k, (k) => k, (i) => i * 10, (v) => v);
    const rec = recorder();
    const env = { width: 100, height: 100 } as PaneEnv;
    drawColoredLine(rec.ctx, env, path, { palette: [''], color: 'red', lineWidth: 1, gradient: false, area: false });
    expect(rec.calls).toEqual([]);
  });
});
