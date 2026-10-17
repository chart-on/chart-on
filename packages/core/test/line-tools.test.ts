import { describe, expect, it } from 'vitest';
import { crossLine, extendedLine, horizontalRay, infoLine, infoLineLabel, infoLineStats, trendAngle } from '../src/drawing/line-tools';
import { builtinTools } from '../src/drawing/tools';
import type { DrawingEnv, DrawingStyle, ScreenDrawing } from '../src/drawing/types';
import { darkTheme } from '../src/theme';
import type { Point } from '../src/types';

const env = { width: 400, height: 200 } as DrawingEnv;

function drawing(type: string, ...points: Point[]): ScreenDrawing {
  return {
    drawing: { id: 'd', type, pane: 0, points: points.map(() => ({ time: 0, price: 0 })), style: {} },
    points,
    selected: false,
    hovered: false,
  } as ScreenDrawing;
}

describe('extended line', () => {
  const d = drawing('extended-line', { x: 100, y: 100 }, { x: 200, y: 50 });
  it('hits beyond both points along the line', () => {
    expect(extendedLine.hitTest(d, { x: 150, y: 75 }, env)).toBe(true);
    expect(extendedLine.hitTest(d, { x: 300, y: 0 }, env)).toBe(true);
    expect(extendedLine.hitTest(d, { x: 20, y: 140 }, env)).toBe(true);
    expect(extendedLine.hitTest(d, { x: 150, y: 120 }, env)).toBe(false);
  });
});

describe('horizontal ray', () => {
  const d = drawing('horizontal-ray', { x: 100, y: 80 });
  it('hits to the right of its point only', () => {
    expect(horizontalRay.hitTest(d, { x: 350, y: 82 }, env)).toBe(true);
    expect(horizontalRay.hitTest(d, { x: 100, y: 80 }, env)).toBe(true);
    expect(horizontalRay.hitTest(d, { x: 40, y: 80 }, env)).toBe(false);
    expect(horizontalRay.hitTest(d, { x: 300, y: 100 }, env)).toBe(false);
  });
});

describe('cross line', () => {
  const d = drawing('cross-line', { x: 100, y: 80 });
  it('hits both its lines', () => {
    expect(crossLine.hitTest(d, { x: 300, y: 81 }, env)).toBe(true);
    expect(crossLine.hitTest(d, { x: 99, y: 10 }, env)).toBe(true);
    expect(crossLine.hitTest(d, { x: 200, y: 150 }, env)).toBe(false);
  });
});

describe('info line', () => {
  it('hits the segment only', () => {
    const d = drawing('info-line', { x: 100, y: 100 }, { x: 200, y: 100 });
    expect(infoLine.hitTest(d, { x: 150, y: 103 }, env)).toBe(true);
    expect(infoLine.hitTest(d, { x: 250, y: 100 }, env)).toBe(false);
  });

  it('computes change, percent, bars and angle', () => {
    const stats = infoLineStats({ time: 0, price: 100 }, { time: 600, price: 105 }, { x: 0, y: 100 }, { x: 100, y: 0 }, 10);
    expect(stats.change).toBe(5);
    expect(stats.percent).toBeCloseTo(5);
    expect(stats.bars).toBe(10);
    expect(stats.angle).toBeCloseTo(45);
    const down = infoLineStats({ time: 0, price: 100 }, { time: 600, price: 80 }, { x: 0, y: 0 }, { x: 100, y: 100 }, 10);
    expect(down.percent).toBeCloseTo(-20);
    expect(down.angle).toBeCloseTo(-45);
    expect(infoLineStats({ time: 0, price: 0 }, { time: 60, price: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 1).percent).toBe(0);
  });

  it('formats a signed label', () => {
    const fmt = (p: number) => p.toFixed(2);
    expect(infoLineLabel({ change: 5, percent: 5, bars: 10, angle: 45 }, fmt)).toBe('+5.00 (+5.00%) · 10 bars · 45.0°');
    expect(infoLineLabel({ change: -20, percent: -20, bars: 3, angle: -45 }, fmt)).toBe('-20.00 (-20.00%) · 3 bars · -45.0°');
  });
});

describe('info line label', () => {
  const renderEnv = {
    ...env,
    theme: darkTheme,
    formatPrice: (p: number) => p.toFixed(2),
    barsBetween: () => 5,
    measureText: (text: string, fontSize: number) => text.length * fontSize * 0.6,
  } as DrawingEnv;
  const h = darkTheme.fontSize + 8;

  /** Renders an info line and returns the y of each drawn label. */
  function labelYs(a: Point, b: Point, style: DrawingStyle = {}): number[] {
    const ys: number[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) => (key === 'fillText' ? (_t: string, _x: number, y: number) => ys.push(y) : key in target ? target[key] : () => {}),
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const d = drawing('info-line', a, b);
    d.drawing.points = [
      { time: 0, price: 100 },
      { time: 300, price: 110 },
    ];
    d.drawing.style = style;
    infoLine.render(ctx, d, renderEnv);
    return ys.map((y) => y - 0.5);
  }

  it('keeps the label inside the pane vertically', () => {
    const [top] = labelYs({ x: 100, y: 100 }, { x: 200, y: 2 });
    expect(top).toBe(h / 2);
    const [bottom] = labelYs({ x: 100, y: 100 }, { x: 200, y: 198 });
    expect(bottom).toBe(env.height - h / 2);
    const [free] = labelYs({ x: 100, y: 150 }, { x: 200, y: 100 });
    expect(free).toBe(86);
  });

  it('shows stats by default and hides them when showStats is false', () => {
    expect(labelYs({ x: 100, y: 150 }, { x: 200, y: 100 })).toHaveLength(1);
    expect(labelYs({ x: 100, y: 150 }, { x: 200, y: 100 }, { showStats: true })).toHaveLength(1);
    expect(labelYs({ x: 100, y: 150 }, { x: 200, y: 100 }, { showStats: false })).toHaveLength(0);
  });
});

describe('trend angle', () => {
  const renderEnv = { ...env, theme: darkTheme, measureText: (text: string, fontSize: number) => text.length * fontSize * 0.6 } as DrawingEnv;

  /** Renders a trend angle and returns its arcs and label texts. */
  function render(a: Point, b: Point, style: DrawingStyle = {}) {
    const arcs: { r: number; from: number; to: number; ccw: boolean }[] = [];
    const texts: string[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) =>
        key === 'arc'
          ? (_x: number, _y: number, r: number, from: number, to: number, ccw?: boolean) => arcs.push({ r, from, to, ccw: ccw === true })
          : key === 'fillText'
            ? (t: string) => texts.push(t)
            : key in target
              ? target[key]
              : () => {},
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const d = drawing('trend-angle', a, b);
    d.drawing.style = style;
    trendAngle.render(ctx, d, renderEnv);
    return { arcs, texts };
  }

  it('labels the screen angle from the horizontal, up being positive', () => {
    expect(render({ x: 100, y: 100 }, { x: 200, y: 0 }).texts).toEqual(['45.0°']);
    expect(render({ x: 100, y: 100 }, { x: 200, y: 200 }).texts).toEqual(['-45.0°']);
    expect(render({ x: 100, y: 100 }, { x: 0, y: 100 - 100 * Math.tan(Math.PI / 6) }).texts).toEqual(['150.0°']);
    expect(render({ x: 100, y: 100 }, { x: 200, y: 0 }, { showLabel: false }).texts).toEqual([]);
  });

  it('draws the arc the short way round, no wider than the line is long', () => {
    const [up] = render({ x: 100, y: 100 }, { x: 200, y: 0 }).arcs;
    expect(up).toMatchObject({ r: 32, from: 0, ccw: true });
    expect(up!.to).toBeCloseTo(-Math.PI / 4);
    const [down] = render({ x: 100, y: 100 }, { x: 110, y: 110 }).arcs;
    expect(down).toMatchObject({ from: 0, ccw: false });
    expect(down!.r).toBeCloseTo(Math.SQRT2 * 10);
    expect(render({ x: 100, y: 100 }, { x: 100, y: 100 }).arcs).toEqual([]);
  });

  it('hits the line only and reports the arc around its first point as its extent', () => {
    const d = drawing('trend-angle', { x: 100, y: 100 }, { x: 200, y: 0 });
    expect(trendAngle.hitTest(d, { x: 150, y: 52 }, env)).toBe(true);
    expect(trendAngle.hitTest(d, { x: 125, y: 100 }, env)).toBe(false); // reference line
    expect(trendAngle.bounds!(d, env)).toEqual({ x: 68, y: 68, width: 64, height: 64 });
  });
});

describe('registration', () => {
  it('ships the tools in the lines group', () => {
    for (const type of ['extended-line', 'info-line', 'trend-angle', 'horizontal-ray', 'cross-line']) {
      expect(builtinTools.find((t) => t.type === type)?.group).toBe('lines');
    }
  });
});
