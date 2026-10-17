import { describe, expect, it } from 'vitest';
import { cycleStarts, cyclicLines, sineLine, timeCycles } from '../src/drawing/cycles';
import { builtinTools } from '../src/drawing/tools';
import type { Drawing, DrawingEnv, DrawingStyle, ScreenDrawing } from '../src/drawing/types';
import { darkTheme } from '../src/theme';
import type { Point } from '../src/types';

function env(): DrawingEnv {
  return {
    width: 1000,
    height: 500,
    theme: darkTheme,
    pixelRatio: 1,
    formatPrice: (price) => price.toFixed(2),
    priceToY: (price) => 500 - price,
    yToPrice: (y) => 500 - y,
    timeToX: (time) => time / 6,
    xToTime: (x) => x * 6,
    barsBetween: () => 0,
    bars: () => [],
    measureText: (text, fontSize) => text.length * fontSize * 0.6,
  };
}

/** Screen drawing whose anchors sit at `points` (y = 500 - price). */
function screen(type: string, points: Point[], style: DrawingStyle = {}): ScreenDrawing {
  const drawing: Drawing = { id: 'x', type, pane: 0, points: points.map((p) => ({ time: p.x * 6, price: 500 - p.y })), style };
  return { drawing, points, selected: false, hovered: false };
}

/** Canvas stand-in recording path points, ellipses and fills. */
function recorder() {
  const points: Point[] = [];
  const ellipses: number[][] = [];
  let fills = 0;
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key) =>
      key in target
        ? target[key as string]
        : (...args: unknown[]) => {
            if (key === 'moveTo' || key === 'lineTo') points.push({ x: args[0] as number, y: args[1] as number });
            if (key === 'ellipse') ellipses.push(args as number[]);
            if (key === 'fill') fills++;
          },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, points, ellipses, fills: () => fills };
}

describe('cycleStarts', () => {
  it('repeats the period from the start within the range, in its direction only', () => {
    expect(cycleStarts(100, 250, 0, 1000)).toEqual([100, 350, 600, 850]);
    expect(cycleStarts(700, -250, 0, 1000)).toEqual([700, 450, 200]);
    // A start left of the range begins with the first period inside it.
    expect(cycleStarts(-1000, 300, 0, 1000)).toEqual([200, 500, 800]);
    // Past the range in the period's direction: nothing.
    expect(cycleStarts(1200, 100, 0, 1000)).toEqual([]);
  });

  it('gives just the start for a period under a pixel', () => {
    expect(cycleStarts(40, 0, 0, 1000)).toEqual([40]);
    expect(cycleStarts(40, 0.5, 0, 1000)).toEqual([40]);
  });
});

describe('cyclic lines', () => {
  const lines = (to = 300) => screen('cyclic-lines', [{ x: 100, y: 400 }, { x: to, y: 300 }]);

  it('draws a full-height line every cycle from the first anchor', () => {
    const { ctx, points } = recorder();
    cyclicLines.render(ctx, lines(), env());
    expect(points).toEqual([100, 300, 500, 700, 900].flatMap((x) => [{ x: x + 0.5, y: 0 }, { x: x + 0.5, y: 500 }]));
  });

  it('hits its lines anywhere up the pane, and nothing before the first anchor', () => {
    const e = env();
    expect(cyclicLines.hitTest(lines(), { x: 502, y: 20 }, e)).toBe(true);
    expect(cyclicLines.hitTest(lines(), { x: 400, y: 300 }, e)).toBe(false);
    expect(cyclicLines.hitTest(lines(), { x: -100, y: 300 }, e)).toBe(false);
    // Anchors the other way round repeat to the left.
    expect(cyclicLines.hitTest(lines(50), { x: 0, y: 300 }, e)).toBe(true);
  });

  it('is open in price and towards the cycles in time', () => {
    const d = lines().drawing;
    expect(cyclicLines.modelBounds!(d)).toEqual({ from: 600, to: Infinity, low: -Infinity, high: Infinity });
    expect(cyclicLines.modelBounds!(lines(50).drawing)).toEqual({ from: -Infinity, to: 600, low: -Infinity, high: Infinity });
  });
});

describe('time cycles', () => {
  // Cycles 200 px wide on y 400, 100 px high.
  const arcs = (b: Point = { x: 300, y: 300 }, style?: DrawingStyle) => screen('time-cycles', [{ x: 100, y: 400 }, b], style);

  it('draws a half ellipse per cycle over the baseline, under it for a lower second anchor', () => {
    const { ctx, ellipses, fills } = recorder();
    timeCycles.render(ctx, arcs(), env());
    expect(ellipses.map((e) => e[0])).toEqual([200, 400, 600, 800, 1000, 1200]);
    expect(ellipses[0]).toEqual([200, 400, 100, 100, 0, Math.PI, 0, false]);
    expect(fills()).toBe(0);
    const below = recorder();
    timeCycles.render(below.ctx, arcs({ x: 300, y: 450 }, { fill: '#123' }), env());
    expect(below.ellipses[0]).toEqual([200, 400, 100, 50, 0, Math.PI, 0, true]);
    expect(below.fills()).toBe(1);
  });

  it('starts the arcs left of the anchors when they run backwards', () => {
    const { ctx, ellipses } = recorder();
    timeCycles.render(ctx, screen('time-cycles', [{ x: 500, y: 400 }, { x: 300, y: 300 }]), env());
    expect(ellipses.map((e) => e[0])).toEqual([400, 200, 0, -200]);
  });

  it('hits the arcs, not their inside or the other side of the baseline', () => {
    const e = env();
    expect(timeCycles.hitTest(arcs(), { x: 200, y: 302 }, e)).toBe(true); // top of the first arc
    expect(timeCycles.hitTest(arcs(), { x: 300, y: 398 }, e)).toBe(true); // where two arcs meet
    expect(timeCycles.hitTest(arcs(), { x: 200, y: 360 }, e)).toBe(false);
    expect(timeCycles.hitTest(arcs(), { x: 200, y: 498 }, e)).toBe(false);
  });

  it('spans the anchors in price, towards the cycles in time', () => {
    expect(timeCycles.modelBounds!(arcs().drawing)).toEqual({ from: 600, to: Infinity, low: 100, high: 200 });
  });
});

describe('sine line', () => {
  // Crest at (100, 300), trough at (200, 400): period 200 px.
  const wave = (b: Point = { x: 200, y: 400 }) => screen('sine-line', [{ x: 100, y: 300 }, b]);

  it('passes through both anchors and repeats across the pane', () => {
    const { ctx, points } = recorder();
    sineLine.render(ctx, wave(), env());
    expect(points[0]!.x).toBe(0);
    expect(points.at(-1)!.x).toBeGreaterThanOrEqual(1000);
    const at = (x: number) => points.find((p) => p.x === x)!.y;
    expect(at(100)).toBeCloseTo(300);
    expect(at(200)).toBeCloseTo(400);
    expect(at(150)).toBeCloseTo(350);
    expect(at(900)).toBeCloseTo(300);
  });

  it('hits the curve, steep parts included, and nothing off it', () => {
    const e = env();
    expect(sineLine.hitTest(wave(), { x: 700, y: 302 }, e)).toBe(true);
    // Where the curve is steepest, a point beside it within the tolerance.
    expect(sineLine.hitTest(wave(), { x: 154, y: 350 }, e)).toBe(true);
    expect(sineLine.hitTest(wave(), { x: 100, y: 330 }, e)).toBe(false);
    // Anchors at the same time: a segment between them.
    expect(sineLine.hitTest(wave({ x: 100, y: 400 }), { x: 100, y: 350 }, e)).toBe(true);
  });

  it('is open in time and spans the anchors in price', () => {
    expect(sineLine.modelBounds!(wave().drawing)).toEqual({ from: -Infinity, to: Infinity, low: 100, high: 200 });
  });
});

it('registers the cycle tools in the time group', () => {
  const cycles = builtinTools.filter((t) => t.group === 'time').map((t) => t.type);
  expect(cycles).toEqual(expect.arrayContaining(['cyclic-lines', 'time-cycles', 'sine-line']));
});
