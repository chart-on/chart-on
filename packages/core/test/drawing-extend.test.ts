import { describe, expect, it } from 'vitest';
import { disjointChannel, flatTopBottom, parallelChannel } from '../src/drawing/channel';
import { fibExtension, fibRetracement } from '../src/drawing/fibonacci';
import { infoLine } from '../src/drawing/line-tools';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import { lineEnds } from '../src/drawing/draw';
import { lineBounds } from '../src/drawing/model-bounds';
import { arrow, rectangle, trendLine } from '../src/drawing/tools';
import type { Drawing, DrawingEnv, DrawingStyle, DrawingToolDef, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { darkTheme } from '../src/theme';
import { Timeline } from '../src/timeline';
import type { Point } from '../src/types';
import { withBuiltinTools } from './builtin-tools';

/** x = time / 6, y = 400 - price, in an 800 × 400 pane. */
const env: DrawingEnv = {
  width: 800,
  height: 400,
  theme: darkTheme,
  pixelRatio: 1,
  formatPrice: (p) => p.toFixed(2),
  priceToY: (price) => 400 - price,
  yToPrice: (y) => 400 - y,
  timeToX: (time) => time / 6,
  xToTime: (x) => x * 6,
  barsBetween: (a, b) => Math.round((b.time - a.time) / 60),
  bars: () => [],
  measureText: (t, size) => t.length * size * 0.6,
};

/** Anchors at x 200 and 400, y 200 and 180 by default; a third at x 400, y 190. */
function screen(type: string, style: DrawingStyle, prices = [200, 220, 210]): ScreenDrawing {
  const points = prices.map((price, i) => ({ time: 1200 * (i === 2 ? 2 : i + 1), price }));
  return {
    drawing: { id: 'x', type, pane: 0, points, style },
    points: points.map((p) => ({ x: p.time / 6, y: 400 - p.price })),
    selected: false,
    hovered: false,
  };
}

/** Canvas stand-in that records path points and filled rectangles. */
function recorder() {
  const points: Point[] = [];
  const rects: number[][] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key) =>
      key in target
        ? target[key as string]
        : (...args: unknown[]) => {
            if (key === 'moveTo' || key === 'lineTo') points.push({ x: args[0] as number, y: args[1] as number });
            if (key === 'fillRect') rects.push(args as number[]);
          },
    set: (target, key, value) => ((target[key as string] = value), true),
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, points, rects };
}

function drawnXs(tool: DrawingToolDef, style: DrawingStyle): number[] {
  const { ctx, points } = recorder();
  tool.render(ctx, screen(tool.type, style), env);
  return points.map((p) => p.x);
}

const lines = [trendLine, arrow, infoLine];
const channels = [parallelChannel, flatTopBottom, disjointChannel];

describe('extend left and right', () => {
  it('is offered by the line, channel, rectangle and Fibonacci level tools', () => {
    for (const tool of [...lines, ...channels, rectangle, fibRetracement, fibExtension]) {
      expect(tool.styleFields, tool.type).toEqual(expect.arrayContaining(['extendLeft', 'extendRight']));
    }
  });

  it('carries lines and channels to the pane edges only on the sides the style extends', () => {
    for (const tool of [...lines, ...channels]) {
      const plain = drawnXs(tool, {});
      expect(Math.min(...plain), tool.type).toBe(200);
      expect(Math.max(...plain), tool.type).toBe(400);
      expect(Math.min(...drawnXs(tool, { extendLeft: true })), tool.type).toBe(0);
      expect(Math.max(...drawnXs(tool, { extendLeft: true })), tool.type).toBe(400);
      expect(Math.min(...drawnXs(tool, { extendRight: true })), tool.type).toBe(200);
      expect(Math.max(...drawnXs(tool, { extendRight: true })), tool.type).toBe(800);
    }
  });

  it('keeps the slope of an extended line and hits it past its anchors', () => {
    for (const tool of lines) {
      // Slope -0.1 px per px: x 0 is y 220, x 800 is y 120.
      const d = screen(tool.type, { extendLeft: true, extendRight: true });
      expect(tool.hitTest(d, { x: 100, y: 210 }, env), tool.type).toBe(true);
      expect(tool.hitTest(d, { x: 600, y: 160 }, env), tool.type).toBe(true);
      expect(tool.hitTest(screen(tool.type, {}), { x: 100, y: 210 }, env), tool.type).toBe(false);
    }
  });

  it('keeps the arrow head on the second point', () => {
    const { ctx, points } = recorder();
    arrow.render(ctx, screen('arrow', { extendRight: true }), env);
    // The head's tip is drawn at the second anchor (400, 180).
    expect(points).toContainEqual({ x: 400, y: 180 });
  });

  it('widens a rectangle to the pane edges', () => {
    const fill = (style: DrawingStyle) => {
      const { ctx, rects } = recorder();
      rectangle.render(ctx, screen('rectangle', style), env);
      return rects[0];
    };
    expect(fill({})).toEqual([200, 180, 200, 20]);
    expect(fill({ extendLeft: true })).toEqual([0, 180, 400, 20]);
    expect(fill({ extendRight: true })).toEqual([200, 180, 600, 20]);
    const d = screen('rectangle', { extendRight: true });
    expect(rectangle.hitTest(d, { x: 700, y: 190 }, env)).toBe(true);
    expect(rectangle.hitTest(screen('rectangle', {}), { x: 700, y: 190 }, env)).toBe(false);
  });

  it('starts Fibonacci level lines at the left pane edge', () => {
    for (const tool of [fibRetracement, fibExtension]) {
      const { ctx, rects } = recorder();
      tool.render(ctx, screen(tool.type, { extendLeft: true }), env);
      expect(rects.length, tool.type).toBeGreaterThan(0);
      expect(rects.every((r) => r[0] === 0), tool.type).toBe(true);
      expect(tool.hitTest(screen(tool.type, { extendLeft: true }), { x: 50, y: 190 }, env), tool.type).toBe(true);
      expect(tool.hitTest(screen(tool.type, {}), { x: 50, y: 190 }, env), tool.type).toBe(false);
    }
  });
});

describe('lineEnds on a vertical segment', () => {
  it('leaves it as placed: it has no left or right side to extend', () => {
    const d = screen('trendline', { extendLeft: true, extendRight: true });
    const a = { x: 300, y: 100 };
    const b = { x: 300, y: 250 };
    expect(lineEnds(d, env, a, b)).toEqual([a, b]);
    expect(lineEnds(d, env, b, a)).toEqual([b, a]);
  });
});

describe('lineBounds', () => {
  const drawing = (style: DrawingStyle, prices = [10, 20]): Drawing => ({
    id: 'x',
    type: 'trendline',
    pane: 0,
    points: prices.map((price, i) => ({ time: 60 * (i + 1), price })),
    style,
  });

  it('is the anchors box without extensions', () => {
    expect(lineBounds(drawing({}))).toEqual({ from: 60, to: 120, low: 10, high: 20 });
  });

  it('opens the extended sides, and the price of a sloped line', () => {
    expect(lineBounds(drawing({ extendRight: true }))).toEqual({ from: 60, to: Infinity, low: -Infinity, high: Infinity });
    expect(lineBounds(drawing({ extendLeft: true }))).toEqual({ from: -Infinity, to: 120, low: -Infinity, high: Infinity });
    expect(lineBounds(drawing({ extendLeft: true }, [10, 10]))).toEqual({ from: -Infinity, to: 120, low: 10, high: 10 });
  });
});

describe('extend options in the manager', () => {
  function manager() {
    const timeline = new Timeline();
    timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
    const host: DrawingHost = {
      theme: darkTheme,
      timeline,
      time: new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 }),
      panes: [new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 })],
      magnetPrice: (_i, price) => price,
      formatPrice: (_p, price) => String(price),
      requestOverlay: () => {},
      editText: (_at, _initial, done) => done(null),
      emit: () => {},
    };
    return withBuiltinTools(new DrawingManager(host));
  }

  it('saves and restores them, and lists them in the style fields', () => {
    const a = manager();
    const points = [{ time: 0, price: 1 }, { time: 600, price: 2 }, { time: 300, price: 3 }];
    for (const type of ['trendline', 'arrow', 'info-line', 'rectangle', 'parallel-channel', 'fib-retracement', 'regression-trend']) {
      const d = a.add({ type, pane: 0, points: points.slice(0, type === 'parallel-channel' ? 3 : 2), style: { extendLeft: true, extendRight: true } });
      expect(a.styleFields(d.id), type).toEqual(expect.arrayContaining(['extendLeft', 'extendRight']));
    }
    const b = manager();
    expect(b.load(JSON.parse(JSON.stringify(a.serialize()))).errors).toEqual([]);
    for (const d of b.getAll()) expect(d.style, d.type).toMatchObject({ extendLeft: true, extendRight: true });
  });
});
