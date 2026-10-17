import { describe, expect, it } from 'vitest';
import { gannBox, gannFan, gannFanLayout, gannRatio, gannSquare, gannSquareFixed } from '../src/drawing/gann';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import type { Drawing, DrawingEnv, DrawingStyle, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { resolveLevelColor } from '../src/drawing/level-color';
import { darkTheme, highContrastDarkTheme, highContrastLightTheme, lightTheme, neutralTheme } from '../src/theme';
import type { Point } from '../src/types';
import { withBuiltinTools } from './builtin-tools';

/** Same viewport as fib-channel.test.ts: x = 10 * index + 10, time = index * 60, y = 500 - price. */
function setup(): DrawingManager {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = 100;
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
  };
  return withBuiltinTools(new DrawingManager(host));
}

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

function screen(type: string, points: Point[], style: DrawingStyle = {}): ScreenDrawing {
  const drawing: Drawing = { id: 'x', type, pane: 0, points: points.map((p) => ({ time: (p.x - 10) * 6, price: 500 - p.y })), style };
  return { drawing, points, selected: false, hovered: false };
}

/** Canvas stand-in that records path points, filled rectangles and text. */
function recorder() {
  const points: Point[] = [];
  const rects: number[][] = [];
  const texts: string[] = [];
  let fills = 0;
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key) =>
      key in target
        ? target[key as string]
        : (...args: unknown[]) => {
            if (key === 'moveTo' || key === 'lineTo') points.push({ x: args[0] as number, y: args[1] as number });
            if (key === 'fillRect') rects.push(args as number[]);
            if (key === 'fill') fills++;
            if (key === 'fillText') texts.push(args[0] as string);
          },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, points, rects, texts, fills: () => fills };
}

const finite = (points: Point[]) => points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
const A = { x: 100, y: 400 };

describe('Gann box', () => {
  // Box from A (100,400) to B (300,200): level k sits at x = 100 + 200k and y = 400 - 200k.
  const box = (style?: DrawingStyle) => screen('gann-box', [A, { x: 300, y: 200 }], style);

  it('cuts the box in price and in time at each level, inside the box only', () => {
    const e = env();
    expect(gannBox.hitTest(box(), { x: 150, y: 300 }, e)).toBe(true); // 0.5 in price
    expect(gannBox.hitTest(box(), { x: 200, y: 380 }, e)).toBe(true); // 0.5 in time
    expect(gannBox.hitTest(box(), { x: 250, y: 220 }, e)).toBe(true); // 0.75 in time
    expect(gannBox.hitTest(box(), { x: 120, y: 330 }, e)).toBe(false); // between levels
    expect(gannBox.hitTest(box(), { x: 400, y: 300 }, e)).toBe(false); // past the box
    expect(gannBox.hitTest(box(), { x: 130, y: 230 }, e)).toBe(false); // no diagonals
  });

  it('fills a band between neighbouring price levels and labels each level twice', () => {
    const { ctx, rects, texts, points } = recorder();
    gannBox.render(ctx, box(), env());
    expect(rects).toHaveLength(4);
    expect(rects[0]).toEqual([100, 350, 200, 50]); // 0 to 0.25
    expect(texts.filter((t) => t === '0.5')).toHaveLength(2);
    expect(finite(points)).toBe(true);
    const off = recorder();
    gannBox.render(off.ctx, box({ showLabel: false }), env());
    expect(off.texts).toEqual([]);
  });

  it('stretches the grid to levels outside 0..1 and reports it as its extent', () => {
    expect(gannBox.bounds!(box(), env())).toEqual({ x: 100, y: 200, width: 200, height: 200 });
    const wide = box({ levels: [{ value: -0.5 }, { value: 1.5 }] });
    expect(gannBox.bounds!(wide, env())).toEqual({ x: 0, y: 100, width: 400, height: 400 });
    expect(gannBox.hitTest(wide, { x: 350, y: 498 }, env())).toBe(true); // level -0.5 in price
  });

  it('renders before its second anchor is placed', () => {
    const { ctx, points } = recorder();
    expect(() => gannBox.render(ctx, screen('gann-box', [A]), env())).not.toThrow();
    expect(finite(points)).toBe(true);
  });
});

describe('Gann squares', () => {
  const square = (b: Point = { x: 300, y: 200 }) => screen('gann-square', [A, b]);

  it('adds both diagonals and the angles from the first point to the quarter levels', () => {
    const e = env();
    expect(gannSquare.hitTest(square(), { x: 130, y: 230 }, e)).toBe(true); // diagonal from (100,200) to (300,400)
    expect(gannSquare.hitTest(square(), { x: 160, y: 385 }, e)).toBe(true); // A to the 0.25 level on the far edge (300,350)
    expect(gannSquare.hitTest(square(), { x: 240, y: 285 }, e)).toBe(false);
    expect(gannSquare.defaultStyle!.levels!.map((l) => l.value)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('keeps the fixed square square on screen, as wide as the second point is from the first', () => {
    const e = env();
    const above = screen('gann-square-fixed', [A, { x: 300, y: 380 }]);
    expect(gannSquareFixed.bounds!(above, e)).toEqual({ x: 100, y: 200, width: 200, height: 200 });
    expect(gannSquareFixed.hitTest(above, { x: 200, y: 200 }, e)).toBe(true); // top edge
    expect(gannSquare.hitTest(screen('gann-square', [A, { x: 300, y: 380 }]), { x: 200, y: 200 }, e)).toBe(false);
    const below = screen('gann-square-fixed', [A, { x: 0, y: 450 }]);
    expect(gannSquareFixed.bounds!(below, e)).toEqual({ x: 0, y: 400, width: 100, height: 100 });
  });
});

describe('Gann fan', () => {
  // A (100,400), B (200,300): the 1x1 ray runs up at 45 degrees.
  const fan = (style?: DrawingStyle, b: Point = { x: 200, y: 300 }) => screen('gann-fan', [A, b], style);

  it('formats the ratios', () => {
    expect([1 / 8, 1 / 3, 1, 4].map(gannRatio)).toEqual(['1x8', '1x3', '1x1', '4x1']);
  });

  it('casts a ray per ratio from the first point, past the pane', () => {
    const e = env();
    expect(gannFan.hitTest(fan(), { x: 400, y: 100 }, e)).toBe(true); // 1x1
    expect(gannFan.hitTest(fan(), { x: 150, y: 300 }, e)).toBe(true); // 2x1
    expect(gannFan.hitTest(fan(), { x: 300, y: 300 }, e)).toBe(true); // 1x2
    expect(gannFan.hitTest(fan(), { x: 300, y: 400 }, e)).toBe(false);
    expect(gannFan.hitTest(fan(), { x: 50, y: 450 }, e)).toBe(false); // behind the first point
    const rays = gannFanLayout(fan(), e);
    expect(rays.map((r) => r.value)).toEqual([1 / 8, 1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 8]);
    for (const r of rays) expect(Math.max(Math.abs(r.to.x - 500), Math.abs(r.to.y - 250))).toBeGreaterThan(1000);
  });

  it('fills the bands between neighbouring rays and labels every ratio', () => {
    const { ctx, points, fills } = recorder();
    gannFan.render(ctx, fan({ showLabel: false }), env());
    expect(fills()).toBe(8);
    const { ctx: labelled, texts } = recorder();
    gannFan.render(labelled, fan({}, { x: 500, y: 0 }), env()); // room for every label
    expect(texts).toEqual(expect.arrayContaining(['1x8', '1x4', '1x3', '1x2', '1x1', '2x1', '3x1', '4x1', '8x1']));
    expect(finite(points)).toBe(true);
  });

  it('renders before its second anchor is placed', () => {
    const { ctx, points } = recorder();
    expect(() => gannFan.render(ctx, screen('gann-fan', [A]), env())).not.toThrow();
    expect(finite(points)).toBe(true);
  });

  it('is open in price and towards the second point in time', () => {
    const d = (to: number): Drawing => ({ id: 'x', type: 'gann-fan', pane: 0, points: [{ time: 540, price: 100 }, { time: to, price: 300 }], style: {} });
    expect(gannFan.modelBounds!(d(1740))).toEqual({ from: 540, to: Infinity, low: -Infinity, high: Infinity });
    expect(gannFan.modelBounds!(d(0))).toEqual({ from: -Infinity, to: 540, low: -Infinity, high: Infinity });
  });
});

describe('Gann tools', () => {
  const tools = [gannBox, gannSquare, gannSquareFixed, gannFan];

  it('default to rule level colors that differ between neighbours in every built-in theme', () => {
    for (const tool of tools) {
      const levels = tool.defaultStyle!.levels!;
      for (const theme of [darkTheme, lightTheme, neutralTheme, highContrastDarkTheme, highContrastLightTheme]) {
        const colors = levels.map((l) => resolveLevelColor(l, theme));
        expect(colors.every((c) => typeof c === 'string' && c.startsWith('#'))).toBe(true);
        colors.slice(1).forEach((c, i) => expect(c).not.toBe(colors[i]));
      }
    }
  });

  it('are created with two clicks, round-trip and stay in the ratios group', () => {
    for (const tool of tools) {
      expect(tool.group).toBe('ratios');
      const manager = setup();
      manager.setTool(tool.type);
      for (const p of [A, { x: 300, y: 200 }]) {
        manager.pointerMove(p);
        manager.pointerDown(0, p);
        manager.pointerUp(p);
      }
      const other = setup();
      other.load(JSON.parse(JSON.stringify(manager.serialize())));
      const [d] = other.getAll();
      expect(d?.type).toBe(tool.type);
      expect(d?.points.map((p) => p.price)).toEqual([expect.closeTo(100), expect.closeTo(300)]);
      expect(d?.style.levels).toEqual(tool.defaultStyle!.levels);
      expect(d?.style.levels).not.toBe(tool.defaultStyle!.levels);
    }
  });
});
