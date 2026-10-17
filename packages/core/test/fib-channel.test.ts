import { describe, expect, it, vi } from 'vitest';
import { disjointChannel, flatTopBottom, parallelChannel, parallelOffset, sideLine } from '../src/drawing/channel';
import {
  FIB_EXTENSION_LEVELS,
  FIB_LEVELS,
  fibArcs,
  fibChannel,
  fibCircles,
  fibExtension,
  fibExtensionLevels,
  fibLevels,
  fibRetracement,
  fibSpeedFan,
  fibSpiral,
  fibTime,
  fibTimeZone,
  fibWedge,
  goldenSpiral,
} from '../src/drawing/fibonacci';
import { angleInSweep, arcBounds } from '../src/drawing/geometry';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import type { Drawing, DrawingEnv, DrawingLevel, DrawingStyle, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { levelColor, resolveLevelColor } from '../src/drawing/level-color';
import { darkTheme, highContrastDarkTheme, highContrastLightTheme, lightTheme, neutralTheme } from '../src/theme';
import type { Point } from '../src/types';
import { withBuiltinTools } from './builtin-tools';

/** Same viewport as drawing.test.ts: x = 10 * index + 10, time = index * 60, y = 500 - price. */
function setup() {
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
  return { manager: withBuiltinTools(new DrawingManager(host)), pane };
}

/** Env matching `setup()` for calling tools directly. */
function env(overrides: Partial<DrawingEnv> = {}): DrawingEnv {
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
    ...overrides,
  };
}

/** Screen drawing whose anchors sit at `points` (y = 500 - price, as in `env()`). */
function screen(type: string, points: Point[], style: DrawingStyle = {}): ScreenDrawing {
  const drawing: Drawing = {
    id: 'x',
    type,
    pane: 0,
    points: points.map((p) => ({ time: (p.x - 10) * 6, price: 500 - p.y })),
    style,
  };
  return { drawing, points, selected: false, hovered: false };
}

/** Canvas stand-in that records path points and text, enough to run the tools outside a browser. */
function recorder() {
  const points: Point[] = [];
  const texts: { text: string; x: number }[] = [];
  const strokes: string[] = [];
  const arcs: { x: number; y: number; r: number; from: number; to: number; ccw: boolean }[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key) =>
      key in target
        ? target[key as string]
        : (...args: unknown[]) => {
            if (key === 'moveTo' || key === 'lineTo') points.push({ x: args[0] as number, y: args[1] as number });
            if (key === 'arc') {
              const [x, y, r, from, to, ccw] = args as [number, number, number, number, number, boolean?];
              arcs.push({ x, y, r, from, to, ccw: ccw === true });
            }
            if (key === 'fillText') texts.push({ text: args[0] as string, x: args[1] as number });
            if (key === 'stroke') strokes.push(String(target.strokeStyle));
          },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, points, texts, strokes, arcs };
}

const finite = (points: Point[]) => points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

describe('fibLevels', () => {
  it('measures retracements back from the end of the move', () => {
    const levels = fibLevels(100, 200);
    expect(levels.map((l) => l.level)).toEqual([...FIB_LEVELS]);
    const prices = levels.map((l) => l.price);
    [200, 176.4, 161.8, 150, 138.2, 121.4, 100].forEach((p, i) => expect(prices[i]).toBeCloseTo(p));
  });

  it('handles downward moves, custom levels and skips invalid ones', () => {
    const levels = fibLevels(200, 100, [0.5, 1.618, NaN, -0.272]);
    expect(levels.map((l) => l.level)).toEqual([0.5, 1.618, -0.272]);
    expect(levels[0]!.price).toBeCloseTo(150);
    expect(levels[1]!.price).toBeCloseTo(261.8);
    expect(levels[2]!.price).toBeCloseTo(72.8);
  });
});

describe('fib retracement tool', () => {
  // Move from price 100 (x 100) up to 300 (x 300): levels at y 200, 247.2, 276.4, 300, 323.6, 357.2, 400.
  const fib = (style?: DrawingStyle) => screen('fib-retracement', [{ x: 100, y: 400 }, { x: 300, y: 200 }], style);

  it('hits the level lines between the anchors and the guide line', () => {
    expect(fibRetracement.hitTest(fib(), { x: 250, y: 300 }, env())).toBe(true);
    expect(fibRetracement.hitTest(fib(), { x: 120, y: 355 }, env())).toBe(true);
    expect(fibRetracement.hitTest(fib(), { x: 130, y: 370 }, env())).toBe(true); // dashed guide
    expect(fibRetracement.hitTest(fib(), { x: 280, y: 262 }, env())).toBe(false); // between levels
    expect(fibRetracement.hitTest(fib(), { x: 350, y: 300 }, env())).toBe(false); // right of the range
    expect(fibRetracement.hitTest(fib(), { x: 50, y: 300 }, env())).toBe(false); // left of the range
  });

  it('extends levels to the right edge on request', () => {
    expect(fibRetracement.hitTest(fib({ extendRight: true }), { x: 950, y: 300 }, env())).toBe(true);
    expect(fibRetracement.hitTest(fib({ extendRight: true }), { x: 50, y: 300 }, env())).toBe(false);
  });

  it('uses levels from the style and skips hidden or malformed ones', () => {
    const custom = fib({ levels: [{ value: 0 }, { value: 0.5, visible: false }, { value: 1.618 }] });
    expect(fibRetracement.hitTest(custom, { x: 250, y: 300 }, env())).toBe(false);
    expect(fibRetracement.hitTest(custom, { x: 250, y: 500 - (300 - 200 * 1.618) }, env())).toBe(true);
    const junk = [null, { value: 'x' }, { value: 0.5 }] as unknown as DrawingLevel[];
    expect(fibRetracement.hitTest(fib({ levels: junk }), { x: 250, y: 300 }, env())).toBe(true);
    const broken = fib({ levels: 'nope' as unknown as DrawingLevel[] });
    expect(fibRetracement.hitTest(broken, { x: 250, y: 300 }, env())).toBe(true);
  });

  it('places levels by price, so they follow a log scale', () => {
    const { manager, pane } = setup();
    pane.price.setMode('log');
    pane.price.fit(1, 10_000); // y = 500 * (1 - log10(price) / 4)
    manager.add({ type: 'fib-retracement', pane: 0, points: [{ time: 540, price: 10 }, { time: 1740, price: 1000 }], style: {} });
    const y = (price: number) => 500 * (1 - Math.log10(price) / 4);
    expect(manager.cursor({ x: 290, y: y(505) })).toBe('pointer'); // 0.5 level
    expect(manager.cursor({ x: 290, y: 250 })).toBeNull(); // halfway in pixels is not a level
  });

  it('is created with two clicks and round-trips its levels', () => {
    const { manager } = setup();
    manager.setTool('fib-retracement');
    manager.pointerDown(0, { x: 100, y: 400 });
    manager.pointerUp({ x: 100, y: 400 });
    manager.pointerMove({ x: 300, y: 200 });
    manager.pointerDown(0, { x: 300, y: 200 });
    manager.pointerUp({ x: 300, y: 200 });
    const [d] = manager.getAll();
    expect(d?.type).toBe('fib-retracement');
    expect(d?.points.map((p) => p.price)).toEqual([expect.closeTo(100), expect.closeTo(300)]);

    const levels = [{ value: 0 }, { value: 0.5, color: '#f59e0b' }, { value: 1 }];
    manager.update(d!.id, { style: { levels } });
    const other = setup().manager;
    other.load(JSON.parse(JSON.stringify(manager.serialize())));
    expect(other.getAll()[0]?.style.levels).toEqual(levels);
    expect(other.cursor({ x: 250, y: 300 })).toBe('pointer'); // 0.5
    expect(other.cursor({ x: 250, y: 323.6 })).toBeNull(); // 0.618 is no longer drawn
  });

  it('draws one line per level and renders before the second anchor is placed', () => {
    const { ctx, points } = recorder();
    fibRetracement.render(ctx, fib(), env());
    const levelLines = points.filter((p, i) => i % 2 === 0 && points[i + 1]?.y === p.y && p.x === 100);
    expect(levelLines.map((p) => p.y)).toEqual([200.5, 247.5, 276.5, 300.5, 324.5, 357.5, 400.5]);

    const single = recorder();
    expect(() => fibRetracement.render(single.ctx, screen('fib-retracement', [{ x: 100, y: 400 }]), env())).not.toThrow();
    expect(finite(single.points)).toBe(true);
  });

  it('colors levels individually and falls back to the drawing color', () => {
    const { ctx, strokes } = recorder();
    const levels = [{ value: 0 }, { value: 0.5, color: '#f59e0b' }, { value: 1 }];
    fibRetracement.render(ctx, fib({ color: '#22c55e', levels }), env());
    expect(strokes.slice(1)).toEqual(['#22c55e', '#f59e0b', '#22c55e']); // after the dashed guide
  });

  it('defaults to the shared level rule, with 0.618 in the accent, in every built-in theme', () => {
    for (const tool of [fibRetracement, fibExtension]) {
      const levels = tool.defaultStyle!.levels!;
      expect(levels.map((l) => l.value)).toEqual([...(tool === fibRetracement ? FIB_LEVELS : FIB_EXTENSION_LEVELS)]);
      for (const theme of [darkTheme, lightTheme, neutralTheme, highContrastDarkTheme, highContrastLightTheme]) {
        const colors = levels.map((l) => resolveLevelColor(l, theme));
        expect(colors.every((c) => typeof c === 'string' && c.startsWith('#'))).toBe(true);
        expect(colors[levels.findIndex((l) => l.value === 0.618)]).toBe(theme.drawing);
        // Neighbours differ, so adjacent lines and bands stay apart.
        colors.slice(1).forEach((c, i) => expect(c).not.toBe(colors[i]));
      }
    }
  });

  it('draws default levels in the rule colors, so they follow the theme', () => {
    const { manager } = setup();
    manager.setTool('fib-retracement');
    manager.pointerDown(0, { x: 100, y: 400 });
    manager.pointerUp({ x: 100, y: 400 });
    manager.pointerDown(0, { x: 300, y: 200 });
    manager.pointerUp({ x: 300, y: 200 });
    const style = manager.getAll()[0]!.style;
    expect(style.levels?.every((l) => l.color === 'auto')).toBe(true);
    for (const theme of [darkTheme, lightTheme]) {
      const { ctx, strokes } = recorder();
      fibRetracement.render(ctx, fib(style), env({ theme }));
      expect(strokes.slice(1)).toEqual(FIB_LEVELS.map((v) => levelColor(v, theme)));
      expect(strokes[5]).toBe(theme.drawing); // 0.618
    }
  });

  it('draws saved levels that name the theme level colors as before', () => {
    const levels = [{ value: 0, color: 'levelNeutral' }, { value: 0.5, color: 'levelBlue' }, { value: 0.618, color: 'levelGreen' }];
    for (const theme of [darkTheme, lightTheme]) {
      const { ctx, strokes } = recorder();
      fibRetracement.render(ctx, fib({ levels }), env({ theme }));
      expect(strokes.slice(1)).toEqual([theme.levelNeutral, theme.levelBlue, theme.levelGreen]);
    }
  });

  it('lets a level color override the default, and falls back to the drawing color for an unset theme color', () => {
    const { ctx, strokes } = recorder();
    const levels = [{ value: 0, color: 'levelRed' }, { value: 0.618, color: '#123456' }, { value: 1, color: 'levelBlue' }];
    const { levelBlue: _, ...theme } = darkTheme;
    fibRetracement.render(ctx, fib({ color: '#22c55e', levels }), env({ theme }));
    expect(strokes.slice(1)).toEqual([darkTheme.levelRed, '#123456', '#22c55e']);
  });

  it('labels levels with their price and skips labels that would overlap', () => {
    const { ctx, texts } = recorder();
    // 112 px tall: 0.5 sits 13 px from 0.382, closer than a line of text.
    fibRetracement.render(ctx, screen('fib-retracement', [{ x: 100, y: 400 }, { x: 300, y: 288 }]), env());
    expect(texts.map((t) => t.text)).toEqual([
      '0 (212.00)',
      '0.236 (185.57)',
      '0.382 (169.22)',
      '0.618 (142.78)',
      '0.786 (123.97)',
      '1 (100.00)',
    ]);
  });

  it('keeps labels on screen only while the levels are', () => {
    const near = recorder();
    fibRetracement.render(near.ctx, screen('fib-retracement', [{ x: 20, y: 400 }, { x: 300, y: 200 }]), env());
    expect(near.texts.every((t) => t.x > 0)).toBe(true);
    const gone = recorder();
    fibRetracement.render(gone.ctx, screen('fib-retracement', [{ x: -400, y: 400 }, { x: -200, y: 200 }]), env());
    expect(gone.texts.every((t) => t.x < -200)).toBe(true);
  });
});

describe('parallelOffset', () => {
  it('offsets vertically so both lines span the same bars', () => {
    expect(parallelOffset({ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 50, y: 100 })).toEqual({ x: 0, y: 50 });
    expect(parallelOffset({ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 200, y: -150 })).toEqual({ x: 0, y: -50 });
    expect(parallelOffset({ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 100, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('offsets horizontally when the base line is vertical', () => {
    expect(parallelOffset({ x: 10, y: 0 }, { x: 10, y: 100 }, { x: 40, y: 30 })).toEqual({ x: 30, y: 0 });
  });
});

describe('parallel channel tool', () => {
  // Base (100,400)→(300,300); third anchor 100 px above the base: parallel (100,300)→(300,200).
  const channel = (style?: DrawingStyle) =>
    screen('parallel-channel', [{ x: 100, y: 400 }, { x: 300, y: 300 }, { x: 200, y: 250 }], style);

  it('hits the base, parallel and middle lines but not the fill', () => {
    expect(parallelChannel.hitTest(channel(), { x: 200, y: 352 }, env())).toBe(true); // base
    expect(parallelChannel.hitTest(channel(), { x: 250, y: 225 }, env())).toBe(true); // parallel
    expect(parallelChannel.hitTest(channel(), { x: 200, y: 300 }, env())).toBe(true); // middle
    expect(parallelChannel.hitTest(channel(), { x: 150, y: 310 }, env())).toBe(false); // inside
    expect(parallelChannel.hitTest(channel(), { x: 400, y: 250 }, env())).toBe(false); // past the end
  });

  it('can hide the middle line', () => {
    expect(parallelChannel.hitTest(channel({ middleLine: false }), { x: 200, y: 300 }, env())).toBe(false);
    const { ctx, points } = recorder();
    parallelChannel.render(ctx, channel({ middleLine: false }), env());
    expect(points).toContainEqual({ x: 300, y: 200 });
    expect(points).not.toContainEqual({ x: 300, y: 250 });
  });

  it('renders with only some anchors placed', () => {
    const pts = [{ x: 100, y: 400 }, { x: 300, y: 300 }];
    for (let n = 1; n <= 2; n++) {
      const { ctx, points } = recorder();
      expect(() => parallelChannel.render(ctx, screen('parallel-channel', pts.slice(0, n)), env())).not.toThrow();
      expect(finite(points)).toBe(true);
    }
  });

  it('is created with three clicks and previews the offset before the last one', () => {
    const { manager } = setup();
    manager.setTool('parallel-channel');
    const click = (p: Point) => {
      manager.pointerMove(p);
      manager.pointerDown(0, p);
      manager.pointerUp(p);
    };
    click({ x: 100, y: 400 });
    click({ x: 300, y: 300 });
    manager.pointerMove({ x: 200, y: 250 });
    expect(manager.getAll()[0]?.points[2]?.price).toBeCloseTo(250); // follows the pointer
    expect(manager.tool).toBe('parallel-channel');
    click({ x: 200, y: 250 });
    const [d] = manager.getAll();
    expect(d?.points.map((p) => p.price)).toEqual([expect.closeTo(100), expect.closeTo(200), expect.closeTo(250)]);
    expect(manager.tool).toBeNull();
    expect(manager.selected?.id).toBe(d?.id);
  });

  it('drags the third anchor to change the width', () => {
    const { manager } = setup();
    const d = manager.add({
      type: 'parallel-channel',
      pane: 0,
      points: [
        { time: 540, price: 100 },
        { time: 1740, price: 200 },
        { time: 1140, price: 250 },
      ],
      style: {},
    });
    manager.pointerDown(0, { x: 200, y: 350 }); // select via the base line
    manager.pointerUp({ x: 200, y: 350 });
    expect(manager.selected?.id).toBe(d.id);
    manager.pointerDown(0, { x: 200, y: 250 }); // third anchor
    manager.pointerMove({ x: 200, y: 200 });
    manager.pointerUp({ x: 200, y: 200 });
    expect(manager.getAll()[0]?.points[2]?.price).toBeCloseTo(300);
    expect(manager.cursor({ x: 200, y: 200 })).toBe('move'); // the anchor followed
    expect(manager.cursor({ x: 250, y: 175 })).toBe('pointer'); // new parallel line
    expect(manager.cursor({ x: 250, y: 225 })).toBeNull(); // old parallel line
  });
});

describe('sideLine', () => {
  const a = { x: 100, y: 400 };
  const b = { x: 300, y: 300 };

  it('spans the base bars through the third point with the scaled slope', () => {
    const c = { x: 200, y: 200 };
    const o = parallelOffset(a, b, c);
    expect(sideLine(a, b, c, 1)).toEqual([{ x: 100, y: 400 + o.y }, { x: 300, y: 300 + o.y }]);
    expect(sideLine(a, b, c, 0)).toEqual([{ x: 100, y: 200 }, { x: 300, y: 200 }]);
    expect(sideLine(a, b, c, -1)).toEqual([{ x: 100, y: 150 }, { x: 300, y: 250 }]);
  });

  it('is the vertical through the third point over a vertical base', () => {
    expect(sideLine({ x: 10, y: 0 }, { x: 10, y: 100 }, { x: 40, y: 30 }, -1)).toEqual([{ x: 40, y: 0 }, { x: 40, y: 100 }]);
  });
});

describe('flat top/bottom and disjoint channel tools', () => {
  // Base (100,400)→(300,300); third anchor at (200,200).
  const pts = [{ x: 100, y: 400 }, { x: 300, y: 300 }, { x: 200, y: 200 }];

  it('draws a flat line at the third anchor over the base bars', () => {
    const d = screen('flat-top-bottom', pts);
    expect(flatTopBottom.hitTest(d, { x: 200, y: 350 }, env())).toBe(true); // base
    expect(flatTopBottom.hitTest(d, { x: 150, y: 200 }, env())).toBe(true); // flat line
    expect(flatTopBottom.hitTest(d, { x: 200, y: 275 }, env())).toBe(false); // no middle line
    expect(flatTopBottom.hitTest(d, { x: 350, y: 200 }, env())).toBe(false); // past the end
    const { ctx, points } = recorder();
    flatTopBottom.render(ctx, d, env());
    expect(points).toContainEqual({ x: 100, y: 200 });
    expect(points).toContainEqual({ x: 300, y: 200 });
  });

  it('mirrors the base slope through the third anchor for a disjoint channel', () => {
    const d = screen('disjoint-channel', pts);
    expect(disjointChannel.hitTest(d, { x: 200, y: 350 }, env())).toBe(true); // base
    expect(disjointChannel.hitTest(d, { x: 250, y: 225 }, env())).toBe(true); // mirrored line
    expect(disjointChannel.hitTest(d, { x: 200, y: 275 }, env())).toBe(false); // no middle line
    const { ctx, points } = recorder();
    disjointChannel.render(ctx, d, env());
    expect(points).toContainEqual({ x: 100, y: 150 });
    expect(points).toContainEqual({ x: 300, y: 250 });
  });

  it('only the parallel channel offers the middle line', () => {
    expect(parallelChannel.styleFields).toContain('middleLine');
    for (const tool of [flatTopBottom, disjointChannel]) {
      expect(tool.styleFields).toEqual(['color', 'fill', 'lineWidth', 'lineStyle', 'extendLeft', 'extendRight', 'showFill']);
      expect(tool.group).toBe('parallels');
      expect(tool.points).toBe(3);
    }
  });

  it('renders with only some anchors placed', () => {
    for (const tool of [flatTopBottom, disjointChannel]) {
      for (let n = 1; n <= 2; n++) {
        const { ctx, points } = recorder();
        expect(() => tool.render(ctx, screen(tool.type, pts.slice(0, n)), env())).not.toThrow();
        expect(finite(points)).toBe(true);
      }
    }
  });

  it('is created with three clicks, round-trips and undoes', () => {
    const { manager } = setup();
    manager.setTool('disjoint-channel');
    for (const p of pts) {
      manager.pointerMove(p);
      manager.pointerDown(0, p);
      manager.pointerUp(p);
    }
    const [d] = manager.getAll();
    expect(d?.type).toBe('disjoint-channel');
    expect(d?.points.map((p) => p.price)).toEqual([expect.closeTo(100), expect.closeTo(200), expect.closeTo(300)]);
    const saved = manager.serialize();
    manager.undo();
    expect(manager.getAll()).toEqual([]);
    manager.load(saved);
    expect(manager.getAll()[0]?.type).toBe('disjoint-channel');
  });
});

describe('trend-based Fibonacci extension', () => {
  it('projects the move from the retracement point', () => {
    // Up from 100 to 300, back to 200: level 1 adds the whole 200.
    expect(fibExtensionLevels(100, 300, 200, [0, 0.618, 1, 1.618])).toEqual([
      { level: 0, price: 200 },
      { level: 0.618, price: expect.closeTo(323.6) },
      { level: 1, price: 400 },
      { level: 1.618, price: expect.closeTo(523.6) },
    ]);
    // A down move projects downwards.
    expect(fibExtensionLevels(300, 100, 200, [1])).toEqual([{ level: 1, price: 0 }]);
    expect(fibExtensionLevels(1, 2, 3, [Number.NaN, 1])).toEqual([{ level: 1, price: 4 }]);
    expect(FIB_EXTENSION_LEVELS).toContain(1.618);
  });

  // Anchors: start (100, price 100), end (200, price 300), retracement (300, price 200).
  const ext = (style?: DrawingStyle) =>
    screen('fib-extension', [{ x: 100, y: 400 }, { x: 200, y: 200 }, { x: 300, y: 300 }], style);

  it('hits its levels from the retracement point for the trend width, and its guides', () => {
    const e = env();
    // Level 1 sits at price 400 (y 100), from x 300 to 400: the retracement
    // point is the rightmost anchor, so the trend's 100 px width gives the length.
    expect(fibExtension.hitTest(ext(), { x: 300, y: 101 }, e)).toBe(true);
    expect(fibExtension.hitTest(ext(), { x: 390, y: 100 }, e)).toBe(true);
    expect(fibExtension.hitTest(ext(), { x: 420, y: 100 }, e)).toBe(false);
    expect(fibExtension.hitTest(ext(), { x: 200, y: 100 }, e)).toBe(false);
    // Dashed guides start → end → retracement.
    expect(fibExtension.hitTest(ext(), { x: 150, y: 300 }, e)).toBe(true);
    expect(fibExtension.hitTest(ext(), { x: 250, y: 250 }, e)).toBe(true);
    expect(fibExtension.hitTest(ext(), { x: 150, y: 450 }, e)).toBe(false);
  });

  it('keeps its levels the trend width long with the extensions on', () => {
    const e = env();
    // Extending left reaches the pane edge on the left and keeps the minimum length on the right.
    expect(fibExtension.hitTest(ext({ extendLeft: true }), { x: 20, y: 100 }, e)).toBe(true);
    expect(fibExtension.hitTest(ext({ extendLeft: true }), { x: 390, y: 100 }, e)).toBe(true);
    expect(fibExtension.hitTest(ext({ extendLeft: true }), { x: 420, y: 100 }, e)).toBe(false);
    // Extending right goes past the minimum to the pane edge.
    expect(fibExtension.hitTest(ext({ extendRight: true }), { x: 420, y: 100 }, e)).toBe(true);
  });

  it('extends right and takes custom levels from the style', () => {
    const e = env();
    expect(fibExtension.hitTest(ext({ extendRight: true }), { x: 900, y: 100 }, e)).toBe(true);
    const custom = ext({ levels: [{ value: 2 }] });
    // Level 2 is price 600 (y -100); level 1 is no longer drawn.
    expect(fibExtension.hitTest(custom, { x: 300, y: -100 }, e)).toBe(true);
    expect(fibExtension.hitTest(custom, { x: 300, y: 100 }, e)).toBe(false);
  });

  it('draws a label per level', () => {
    const { ctx, texts } = recorder();
    fibExtension.render(ctx, ext(), env());
    expect(texts.map((t) => t.text)).toContain('1 (400.00)');
    expect(texts.map((t) => t.text)).toContain('1.618 (523.60)');
  });
});

/** Clicks each point with the active tool, moving the pointer there first. */
function clickAll(manager: DrawingManager, points: Point[]): void {
  for (const p of points) {
    manager.pointerMove(p);
    manager.pointerDown(0, p);
    manager.pointerUp(p);
  }
}

/** Saves the manager's drawings and loads them into a fresh one. */
function roundTrip(manager: DrawingManager): DrawingManager {
  const other = setup().manager;
  other.load(JSON.parse(JSON.stringify(manager.serialize())));
  return other;
}

describe('default levels of the other Fibonacci tools', () => {
  it('take rule colors that differ between neighbours in every built-in theme', () => {
    for (const tool of [fibChannel, fibSpeedFan, fibTime, fibCircles, fibArcs, fibWedge]) {
      const levels = tool.defaultStyle!.levels!;
      expect(levels.find((l) => l.value === 0.618)?.color).toBe('auto');
      for (const theme of [darkTheme, lightTheme, neutralTheme, highContrastDarkTheme, highContrastLightTheme]) {
        const colors = levels.map((l) => resolveLevelColor(l, theme));
        expect(colors.every((c) => typeof c === 'string' && c.startsWith('#'))).toBe(true);
        colors.slice(1).forEach((c, i) => expect(c).not.toBe(colors[i]));
      }
    }
    expect(fibTimeZone.defaultStyle!.levels!.map((l) => l.value)).toEqual([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]);
  });

  it('are copied per tool, so editing one drawing leaves the defaults alone', () => {
    const { manager } = setup();
    const d = manager.add({ type: 'fib-channel', pane: 0, points: [{ time: 540, price: 100 }], style: {} });
    expect(d.style.levels).toEqual(fibChannel.defaultStyle!.levels);
    expect(d.style.levels).not.toBe(fibChannel.defaultStyle!.levels);
  });
});

describe('Fibonacci channel', () => {
  // Base (100,400)→(300,400); the third anchor puts level 1 100 px above: level k at y 400 - 100k.
  const channel = (style?: DrawingStyle) =>
    screen('fib-channel', [{ x: 100, y: 400 }, { x: 300, y: 400 }, { x: 200, y: 300 }], style);

  it('hits its level lines between the anchors, but not the bands', () => {
    const e = env();
    expect(fibChannel.hitTest(channel(), { x: 200, y: 350 }, e)).toBe(true); // 0.5
    expect(fibChannel.hitTest(channel(), { x: 150, y: 238 }, e)).toBe(true); // 1.618
    expect(fibChannel.hitTest(channel(), { x: 200, y: 270 }, e)).toBe(false); // between 1 and 1.618
    expect(fibChannel.hitTest(channel(), { x: 50, y: 350 }, e)).toBe(false); // left of the anchors
    expect(fibChannel.hitTest(channel(), { x: 900, y: 350 }, e)).toBe(false);
  });

  it('runs its levels parallel to a sloped base line', () => {
    // Base (100,400)→(300,300), third anchor 100 px above the base: level 0.5 from (100,350) to (300,250).
    const sloped = screen('fib-channel', [{ x: 100, y: 400 }, { x: 300, y: 300 }, { x: 200, y: 250 }]);
    expect(fibChannel.hitTest(sloped, { x: 200, y: 300 }, env())).toBe(true);
    expect(fibChannel.hitTest(sloped, { x: 300, y: 250 }, env())).toBe(true);
    const { ctx, points } = recorder();
    fibChannel.render(ctx, sloped, env());
    expect(points).toContainEqual({ x: 100, y: 350 });
    expect(points).toContainEqual({ x: 300, y: 250 });
  });

  it('extends its levels to either edge on request', () => {
    const e = env();
    expect(fibChannel.hitTest(channel({ extendLeft: true }), { x: 10, y: 350 }, e)).toBe(true);
    expect(fibChannel.hitTest(channel({ extendLeft: true }), { x: 900, y: 350 }, e)).toBe(false);
    expect(fibChannel.hitTest(channel({ extendRight: true }), { x: 900, y: 350 }, e)).toBe(true);
  });

  it('takes levels from the style and skips hidden or malformed ones', () => {
    const levels = [{ value: 0.5, visible: false }, { value: 2 }, null] as unknown as DrawingLevel[];
    expect(fibChannel.hitTest(channel({ levels }), { x: 200, y: 350 }, env())).toBe(false);
    expect(fibChannel.hitTest(channel({ levels }), { x: 200, y: 200 }, env())).toBe(true);
  });

  it('labels each level left of its line, on screen while the line is', () => {
    // 200 px wide, so no two labels overlap.
    const { ctx, texts } = recorder();
    fibChannel.render(ctx, screen('fib-channel', [{ x: 100, y: 400 }, { x: 300, y: 400 }, { x: 200, y: 200 }]), env());
    expect(texts.map((t) => t.text)).toEqual(['0', '0.236', '0.382', '0.5', '0.618', '0.786', '1', '1.618']);
    expect(texts.every((t) => t.x < 100)).toBe(true);
    // 100 px wide: 0.382 would overlap 0.236.
    const tight = recorder();
    fibChannel.render(tight.ctx, channel(), env());
    expect(tight.texts.map((t) => t.text)).not.toContain('0.382');
    const near = recorder();
    fibChannel.render(near.ctx, screen('fib-channel', [{ x: -50, y: 400 }, { x: 300, y: 400 }, { x: 200, y: 300 }]), env());
    expect(near.texts.every((t) => t.x > 0)).toBe(true);
    const hidden = recorder();
    fibChannel.render(hidden.ctx, channel({ showLabel: false }), env());
    expect(hidden.texts).toEqual([]);
  });

  it('renders with only some anchors placed', () => {
    const pts = [{ x: 100, y: 400 }, { x: 300, y: 400 }];
    for (let n = 1; n <= 2; n++) {
      const { ctx, points } = recorder();
      expect(() => fibChannel.render(ctx, screen('fib-channel', pts.slice(0, n)), env())).not.toThrow();
      expect(finite(points)).toBe(true);
    }
  });

  it('is open in price, and in time too when its base line is vertical', () => {
    const at = (time: number, price: number) => ({ time, price });
    const d = (points: { time: number; price: number }[]): Drawing => ({ id: 'x', type: 'fib-channel', pane: 0, points, style: {} });
    expect(fibChannel.modelBounds!(d([at(540, 100), at(1740, 100), at(1140, 200)]))).toEqual({
      from: 540,
      to: 1740,
      low: -Infinity,
      high: Infinity,
    });
    expect(fibChannel.modelBounds!(d([at(540, 100), at(540, 200), at(1140, 200)])).from).toBe(-Infinity);
  });

  it('is created with three clicks and round-trips', () => {
    const { manager } = setup();
    manager.setTool('fib-channel');
    clickAll(manager, [{ x: 100, y: 400 }, { x: 300, y: 400 }, { x: 200, y: 300 }]);
    const [d] = manager.getAll();
    expect(d?.type).toBe('fib-channel');
    expect(d?.points.map((p) => p.price)).toEqual([expect.closeTo(100), expect.closeTo(100), expect.closeTo(200)]);
    const other = roundTrip(manager);
    expect(other.getAll()[0]?.style.levels).toEqual(d?.style.levels);
    expect(other.cursor({ x: 200, y: 350 })).toBe('pointer'); // 0.5
    expect(other.cursor({ x: 200, y: 270 })).toBeNull();
  });
});

describe('Fibonacci time zones', () => {
  // Anchors 20 px apart: zones at x 100, 120, 140, 160, 200, 260, 360, 520, 780, 1200, 1880.
  const zones = (style?: DrawingStyle, to = 120) => screen('fib-time-zone', [{ x: 100, y: 400 }, { x: to, y: 300 }], style);

  it('draws a full-height line at each Fibonacci multiple of the anchor distance', () => {
    const { ctx, points } = recorder();
    fibTimeZone.render(ctx, zones(), env());
    const tops = points.filter((p, i) => p.y === 0 && points[i + 1]?.y === 500 && points[i + 1]?.x === p.x).map((p) => p.x);
    expect(tops).toEqual([100.5, 120.5, 140.5, 160.5, 200.5, 260.5, 360.5, 520.5, 780.5, 1200.5, 1880.5]);
  });

  it('hits its lines anywhere up the pane, and nothing between them', () => {
    const e = env();
    expect(fibTimeZone.hitTest(zones(), { x: 160, y: 20 }, e)).toBe(true);
    expect(fibTimeZone.hitTest(zones(), { x: 522, y: 480 }, e)).toBe(true);
    expect(fibTimeZone.hitTest(zones(), { x: 180, y: 300 }, e)).toBe(false);
    expect(fibTimeZone.hitTest(zones(), { x: 80, y: 300 }, e)).toBe(false);
    // Anchors the other way round count backwards.
    expect(fibTimeZone.hitTest(zones({}, 80), { x: 40, y: 300 }, e)).toBe(true);
  });

  it('takes levels from the style', () => {
    const custom = zones({ levels: [{ value: 0 }, { value: 4 }, { value: 8, visible: false }] });
    expect(fibTimeZone.hitTest(custom, { x: 180, y: 300 }, env())).toBe(true);
    expect(fibTimeZone.hitTest(custom, { x: 260, y: 300 }, env())).toBe(false);
  });

  it('labels each zone with its number along the bottom', () => {
    const { ctx, texts } = recorder();
    fibTimeZone.render(ctx, zones(), env());
    expect(texts.map((t) => t.text)).toEqual(['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89']);
    // 5 px apart: labels that would overlap one already drawn are skipped.
    const tight = recorder();
    fibTimeZone.render(tight.ctx, zones({}, 105), env());
    expect(tight.texts.map((t) => t.text).slice(0, 3)).toEqual(['0', '5', '13']);
  });

  it('is open in price and towards the zones in time', () => {
    const d = (points: { time: number; price: number }[], style: DrawingStyle = {}): Drawing => ({
      id: 'x',
      type: 'fib-time-zone',
      pane: 0,
      points,
      style,
    });
    const a = { time: 540, price: 100 };
    expect(fibTimeZone.modelBounds!(d([a, { time: 660, price: 0 }]))).toEqual({ from: 540, to: Infinity, low: -Infinity, high: Infinity });
    expect(fibTimeZone.modelBounds!(d([a, { time: 420, price: 0 }]))).toEqual({ from: -Infinity, to: 540, low: -Infinity, high: Infinity });
    expect(fibTimeZone.modelBounds!(d([a, { time: 660, price: 0 }], { levels: [{ value: -1 }, { value: 1 }] })).from).toBe(-Infinity);
    expect(fibTimeZone.axisMarks!(d([a, { time: 660, price: 0 }]))).toEqual({ times: [540, 660] });
  });

  it('is created with two clicks, moves sideways and round-trips', () => {
    const { manager } = setup();
    manager.setTool('fib-time-zone');
    clickAll(manager, [{ x: 100, y: 400 }, { x: 120, y: 300 }]);
    const [d] = manager.getAll();
    expect(d?.points.map((p) => p.time)).toEqual([540, 660]);
    expect(manager.cursor({ x: 160, y: 50 })).toBe('ew-resize');
    const other = roundTrip(manager);
    expect(other.cursor({ x: 260, y: 50 })).toBe('ew-resize'); // 8
    expect(other.cursor({ x: 230, y: 50 })).toBeNull();
  });
});

describe('trend-based Fibonacci time', () => {
  // Move from x 100 to x 200 (100 px), projected from x 300: level k at x 300 + 100k.
  const trend = (style?: DrawingStyle, c = { x: 300, y: 350 }) =>
    screen('fib-time', [{ x: 100, y: 400 }, { x: 200, y: 300 }, c], style);

  it('draws a full-height line per level, counted from the third anchor', () => {
    const { ctx, points } = recorder();
    fibTime.render(ctx, trend({ levels: [{ value: 0 }, { value: 0.618 }, { value: 2 }] }), env());
    const tops = points.filter((p, i) => p.y === 0 && points[i + 1]?.y === 500 && points[i + 1]?.x === p.x).map((p) => p.x);
    expect(tops).toEqual([300.5, 362.5, 500.5]);
    // Dashed guide through the anchors.
    expect(points).toContainEqual({ x: 100, y: 400 });
    expect(points).toContainEqual({ x: 300, y: 350 });
  });

  it('hits its lines and its guide, but not between them', () => {
    const e = env();
    expect(fibTime.hitTest(trend(), { x: 338, y: 20 }, e)).toBe(true); // 0.382
    expect(fibTime.hitTest(trend(), { x: 561, y: 480 }, e)).toBe(true); // 2.618
    expect(fibTime.hitTest(trend(), { x: 150, y: 350 }, e)).toBe(true); // guide
    expect(fibTime.hitTest(trend(), { x: 420, y: 100 }, e)).toBe(false); // between 1 and 1.618
    expect(fibTime.hitTest(trend(), { x: 150, y: 100 }, e)).toBe(false);
    // A move to the left projects to the left.
    const back = screen('fib-time', [{ x: 200, y: 400 }, { x: 100, y: 300 }, { x: 600, y: 350 }]);
    expect(fibTime.hitTest(back, { x: 500, y: 100 }, e)).toBe(true); // 1
    expect(fibTime.hitTest(back, { x: 700, y: 100 }, e)).toBe(false);
  });

  it('labels each line with its level along the bottom', () => {
    const { ctx, texts } = recorder();
    fibTime.render(ctx, screen('fib-time', [{ x: 0, y: 400 }, { x: 600, y: 300 }, { x: 0, y: 350 }]), env());
    expect(texts.map((t) => t.text)).toEqual(['0', '0.382', '0.618', '1', '1.618', '2.618']);
    const hidden = recorder();
    fibTime.render(hidden.ctx, trend({ showLabel: false }), env());
    expect(hidden.texts).toEqual([]);
  });

  it('renders with only some anchors placed, projecting from the second until the third is placed', () => {
    const one = recorder();
    expect(() => fibTime.render(one.ctx, screen('fib-time', [{ x: 100, y: 400 }]), env())).not.toThrow();
    expect(finite(one.points)).toBe(true);
    const two = screen('fib-time', [{ x: 100, y: 400 }, { x: 200, y: 300 }]);
    expect(fibTime.hitTest(two, { x: 300, y: 50 }, env())).toBe(true); // level 1 from the second anchor
  });

  it('covers the anchors and, in time, the side its lines run to', () => {
    const at = (time: number, price: number) => ({ time, price });
    const d = (points: { time: number; price: number }[], style: DrawingStyle = {}): Drawing => ({
      id: 'x',
      type: 'fib-time',
      pane: 0,
      points,
      style,
    });
    expect(fibTime.modelBounds!(d([at(540, 100), at(1140, 200), at(1740, 150)]))).toEqual({
      from: 540,
      to: Infinity,
      low: -Infinity,
      high: Infinity,
    });
    expect(fibTime.modelBounds!(d([at(1140, 100), at(540, 200), at(1740, 150)]))).toEqual({
      from: -Infinity,
      to: 1740,
      low: -Infinity,
      high: Infinity,
    });
    expect(fibTime.modelBounds!(d([at(540, 100), at(1140, 200), at(1740, 150)], { levels: [{ value: -1 }] })).from).toBe(-Infinity);
  });

  it('is created with three clicks and round-trips', () => {
    const { manager } = setup();
    manager.setTool('fib-time');
    clickAll(manager, [{ x: 100, y: 400 }, { x: 200, y: 300 }, { x: 300, y: 350 }]);
    const [d] = manager.getAll();
    expect(d?.type).toBe('fib-time');
    expect(d?.points.map((p) => p.time)).toEqual([540, 1140, 1740]);
    const other = roundTrip(manager);
    expect(other.getAll()[0]?.style.levels).toEqual(fibTime.defaultStyle!.levels);
    expect(other.cursor({ x: 400, y: 50 })).toBe('pointer'); // 1
    expect(other.cursor({ x: 420, y: 50 })).toBeNull();
  });
});

describe('Fibonacci speed resistance fan', () => {
  // Box from A (100,400) to B (300,200). Price rays pass (300, 200 + 200k), time rays (300 - 200k, 200).
  const fan = (style?: DrawingStyle, b = { x: 300, y: 200 }) => screen('fib-speed-fan', [{ x: 100, y: 400 }, b], style);

  it('casts rays from the start through the level points on both far edges of the box', () => {
    const e = env();
    const half = fan({ levels: [{ value: 0.5 }] });
    expect(fibSpeedFan.hitTest(half, { x: 500, y: 200 }, e)).toBe(true); // price ray past the box
    expect(fibSpeedFan.hitTest(half, { x: 150, y: 300 }, e)).toBe(true); // time ray
    expect(fibSpeedFan.hitTest(half, { x: 300, y: 200 }, e)).toBe(false); // level 0 is off
    expect(fibSpeedFan.hitTest(half, { x: 50, y: 425 }, e)).toBe(false); // behind the start
    expect(fibSpeedFan.hitTest(fan(), { x: 200, y: 300 }, e)).toBe(true); // level 0 runs through B
    expect(fibSpeedFan.hitTest(fan(), { x: 800, y: 400 }, e)).toBe(true); // level 1 is level with A
  });

  it('draws a ray per level and side, level 0 once, plus the box grid', () => {
    const { ctx, points } = recorder();
    fibSpeedFan.render(ctx, fan({ levels: [{ value: 0 }, { value: 0.5 }], showLabel: false }), env());
    // Grid: price level 0.5 across the box, time level 0.5 down it.
    expect(points).toContainEqual({ x: 100, y: 300 });
    expect(points).toContainEqual({ x: 200, y: 400 });
    // Rays leave A three times: level 0, price 0.5 and time 0.5.
    expect(points.filter((p) => p.x === 100 && p.y === 400)).toHaveLength(3);
    expect(finite(points)).toBe(true);
  });

  it('labels the levels on the far edges of the box', () => {
    const { ctx, texts } = recorder();
    fibSpeedFan.render(ctx, fan({ levels: [{ value: 0 }, { value: 0.5 }] }), env());
    const at = texts.map((t) => `${t.text}@${Math.round(t.x)}`);
    expect(at).toContain('0@309'); // right of B, at its price (pill left 304 plus its padding)
    expect(at.filter((t) => t.startsWith('0.5@'))).toHaveLength(2);
    // Drawn backwards, B is the box's left edge: its labels go there with labelSide 'left', and right of the box otherwise.
    const back = recorder();
    fibSpeedFan.render(back.ctx, fan({ levels: [{ value: 0 }], labelSide: 'left' }, { x: 0, y: 200 }), env());
    expect(back.texts[0]!.x).toBeLessThan(0);
    const unset = recorder();
    fibSpeedFan.render(unset.ctx, fan({ levels: [{ value: 0 }] }, { x: 0, y: 200 }), env());
    expect(unset.texts[0]!.x).toBeGreaterThan(0);
  });

  it('renders before its second anchor is placed', () => {
    const { ctx, points } = recorder();
    expect(() => fibSpeedFan.render(ctx, screen('fib-speed-fan', [{ x: 100, y: 400 }]), env())).not.toThrow();
    expect(finite(points)).toBe(true);
  });

  it('is open in price and towards B in time, and behind A for time levels above 1', () => {
    const d = (style: DrawingStyle = {}): Drawing => ({
      id: 'x',
      type: 'fib-speed-fan',
      pane: 0,
      points: [{ time: 540, price: 100 }, { time: 1740, price: 300 }],
      style,
    });
    expect(fibSpeedFan.modelBounds!(d())).toEqual({ from: 540, to: Infinity, low: -Infinity, high: Infinity });
    expect(fibSpeedFan.modelBounds!(d({ levels: [{ value: 1.5 }] })).from).toBe(-Infinity);
  });

  it('is created with two clicks and round-trips', () => {
    const { manager } = setup();
    manager.setTool('fib-speed-fan');
    clickAll(manager, [{ x: 100, y: 400 }, { x: 300, y: 200 }]);
    const [d] = manager.getAll();
    expect(d?.points.map((p) => p.price)).toEqual([expect.closeTo(100), expect.closeTo(300)]);
    const other = roundTrip(manager);
    expect(other.getAll()[0]?.style.levels).toEqual(fibSpeedFan.defaultStyle!.levels);
    expect(other.cursor({ x: 500, y: 200 })).toBe('pointer'); // 0.5 price ray
  });
});

describe('arc geometry', () => {
  it('tells whether an angle lies on an arc, either way round', () => {
    expect(angleInSweep(Math.PI / 2, 0, Math.PI)).toBe(true);
    expect(angleInSweep(-Math.PI / 2, 0, Math.PI)).toBe(false);
    expect(angleInSweep(-Math.PI / 2, 0, -Math.PI)).toBe(true);
    expect(angleInSweep(Math.PI / 2, 0, -Math.PI)).toBe(false);
    // Wraps past a full turn.
    expect(angleInSweep(0.1, 3 * Math.PI / 2, Math.PI)).toBe(true);
    expect(angleInSweep(5, 0, 2 * Math.PI)).toBe(true);
    expect(angleInSweep(0, 0, 0)).toBe(true);
  });

  it('bounds an arc by its ends and the points due right, down, left and up it passes', () => {
    const c = { x: 100, y: 100 };
    expect(arcBounds(c, 10, 0, 2 * Math.PI)).toEqual({ x: 90, y: 90, width: 20, height: 20 });
    const lower = arcBounds(c, 10, 0, Math.PI); // through due down
    expect(lower.x).toBeCloseTo(90);
    expect(lower.y).toBeCloseTo(100);
    expect(lower.width).toBeCloseTo(20);
    expect(lower.height).toBeCloseTo(10);
    const quarter = arcBounds(c, 10, 0, -Math.PI / 2); // right to up, anticlockwise
    expect(quarter.x).toBeCloseTo(100);
    expect(quarter.y).toBeCloseTo(90);
    expect(quarter.width).toBeCloseTo(10);
    expect(quarter.height).toBeCloseTo(10);
  });
});

/** Radii of the arcs stroked around `c` (bands draw each radius too, so duplicates are dropped). */
const radii = (arcs: { x: number; y: number; r: number }[], c: Point) =>
  [...new Set(arcs.filter((a) => a.x === c.x && a.y === c.y).map((a) => Math.round(a.r * 10) / 10))].sort((a, b) => a - b);

describe('Fibonacci circles', () => {
  // Centre (300,250), level 1 through (400,250): level k has radius 100k.
  const circles = (style?: DrawingStyle) => screen('fib-circles', [{ x: 300, y: 250 }, { x: 400, y: 250 }], style);

  it('draws a circle per level around the first anchor', () => {
    const { ctx, arcs } = recorder();
    fibCircles.render(ctx, circles(), env());
    expect(radii(arcs, { x: 300, y: 250 })).toEqual([23.6, 38.2, 50, 61.8, 78.6, 100, 161.8]);
    expect(arcs.every((a) => a.to - a.from === 2 * Math.PI || a.from - a.to === 2 * Math.PI)).toBe(true);
  });

  it('hits its circles and guide, but not the bands between them', () => {
    const e = env();
    expect(fibCircles.hitTest(circles(), { x: 300, y: 150 }, e)).toBe(true); // 1, straight up
    expect(fibCircles.hitTest(circles(), { x: 300, y: 312 }, e)).toBe(true); // 0.618
    expect(fibCircles.hitTest(circles(), { x: 138, y: 250 }, e)).toBe(true); // 1.618
    expect(fibCircles.hitTest(circles(), { x: 350, y: 251 }, e)).toBe(true); // guide
    expect(fibCircles.hitTest(circles(), { x: 300, y: 320 }, e)).toBe(false); // between 0.618 and 0.786
    expect(fibCircles.hitTest(circles(), { x: 300, y: 50 }, e)).toBe(false); // outside
  });

  it('takes levels from the style and skips hidden, malformed and non-positive ones', () => {
    const levels = [{ value: 0 }, { value: 0.5, visible: false }, { value: -1 }, { value: 2 }, null] as unknown as DrawingLevel[];
    const { ctx, arcs } = recorder();
    fibCircles.render(ctx, circles({ levels }), env());
    expect(radii(arcs, { x: 300, y: 250 })).toEqual([200]);
    expect(fibCircles.hitTest(circles({ levels }), { x: 300, y: 300 }, env())).toBe(false);
  });

  it('labels the circles on the side away from the second anchor', () => {
    const { ctx, texts } = recorder();
    fibCircles.render(ctx, circles({ levels: [{ value: 1 }, { value: 2 }] }), env());
    expect(texts.map((t) => t.text)).toEqual(['1', '2']);
    expect(texts.every((t) => t.x < 300)).toBe(true);
    const hidden = recorder();
    fibCircles.render(hidden.ctx, circles({ showLabel: false }), env());
    expect(hidden.texts).toEqual([]);
  });

  it('reports the extent of its largest circle', () => {
    const box = fibCircles.bounds!(circles(), env())!;
    expect(box.x).toBeCloseTo(138.2);
    expect(box.y).toBeCloseTo(88.2);
    expect(box.width).toBeCloseTo(323.6);
    expect(box.height).toBeCloseTo(323.6);
    expect(fibCircles.bounds!(screen('fib-circles', [{ x: 300, y: 250 }]), env())).toBeNull();
  });

  it('is drawn while only its circles reach into view', () => {
    const { manager } = setup();
    const render = vi.fn();
    manager.register({ ...fibCircles, type: 'fib-circles-spy', render });
    // Anchors far above the pane (prices 1500 and 900: y -1000 and -400); level 2 reaches y 200.
    const points = [{ time: 2940, price: 1500 }, { time: 2940, price: 900 }];
    manager.add({ type: 'fib-circles-spy', pane: 0, points, style: { levels: [{ value: 2 }] } });
    manager.add({ type: 'fib-circles-spy', pane: 0, points, style: { levels: [{ value: 1 }] } });
    manager.render(recorder().ctx, 0, 1000, 500);
    expect(render).toHaveBeenCalledOnce();
  });

  it('renders before its second anchor is placed, and is created with two clicks and round-trips', () => {
    const one = recorder();
    expect(() => fibCircles.render(one.ctx, screen('fib-circles', [{ x: 300, y: 250 }]), env())).not.toThrow();
    expect(one.arcs).toEqual([]);
    const { manager } = setup();
    manager.setTool('fib-circles');
    clickAll(manager, [{ x: 300, y: 250 }, { x: 400, y: 250 }]);
    const [d] = manager.getAll();
    expect(d?.type).toBe('fib-circles');
    const other = roundTrip(manager);
    expect(other.getAll()[0]?.style.levels).toEqual(fibCircles.defaultStyle!.levels);
    expect(other.cursor({ x: 300, y: 150 })).toBe('pointer'); // 1
    expect(other.cursor({ x: 300, y: 320 })).toBeNull();
  });
});

describe('Fibonacci arcs', () => {
  // Rise from A (300,350) to B (300,250): half circles around B, below it, radius 100k.
  const rise = (style?: DrawingStyle) => screen('fib-arcs', [{ x: 300, y: 350 }, { x: 300, y: 250 }], style);

  it('draws a half circle per level around the end of the move, on the start side', () => {
    const { ctx, arcs } = recorder();
    fibArcs.render(ctx, rise({ fill: 'transparent' }), env());
    expect(radii(arcs, { x: 300, y: 250 })).toEqual([23.6, 38.2, 50, 61.8, 78.6, 100, 161.8]);
    const strokes = arcs.filter((a) => !a.ccw);
    expect(strokes.every((a) => a.from === 0 && a.to === Math.PI)).toBe(true);
    // After a fall they open upwards.
    const fall = recorder();
    fibArcs.render(fall.ctx, screen('fib-arcs', [{ x: 300, y: 150 }, { x: 300, y: 250 }]), env());
    expect(fall.arcs.filter((a) => !a.ccw).every((a) => a.from === Math.PI && a.to === 2 * Math.PI)).toBe(true);
  });

  it('hits its arcs on the start side only, and the guide', () => {
    const e = env();
    expect(fibArcs.hitTest(rise(), { x: 300, y: 350 }, e)).toBe(true); // 1, at A
    expect(fibArcs.hitTest(rise(), { x: 362, y: 250 }, e)).toBe(true); // 0.618, at the arc's end
    expect(fibArcs.hitTest(rise(), { x: 335, y: 285 }, e)).toBe(true); // 0.5, half way round
    expect(fibArcs.hitTest(rise(), { x: 335, y: 215 }, e)).toBe(false); // above B: no arc there
    expect(fibArcs.hitTest(rise(), { x: 300, y: 300 }, e)).toBe(true); // guide
    expect(fibArcs.hitTest(rise(), { x: 370, y: 300 }, e)).toBe(false);
  });

  it('labels each arc at its lowest point, and reports the half circle as its extent', () => {
    const { ctx, texts } = recorder();
    fibArcs.render(ctx, rise({ levels: [{ value: 0.5 }, { value: 1 }] }), env());
    expect(texts.map((t) => t.text)).toEqual(['0.5', '1']);
    const box = fibArcs.bounds!(rise({ levels: [{ value: 1 }] }), env())!;
    expect(box.x).toBeCloseTo(200);
    expect(box.y).toBeCloseTo(250);
    expect(box.width).toBeCloseTo(200);
    expect(box.height).toBeCloseTo(100);
  });

  it('is created with two clicks and round-trips', () => {
    const { manager } = setup();
    manager.setTool('fib-arcs');
    clickAll(manager, [{ x: 300, y: 350 }, { x: 300, y: 250 }]);
    const other = roundTrip(manager);
    expect(other.getAll()[0]?.type).toBe('fib-arcs');
    expect(other.cursor({ x: 335, y: 285 })).toBe('pointer');
    expect(other.cursor({ x: 335, y: 215 })).toBeNull();
  });
});

describe('Fibonacci wedge', () => {
  // Apex (200,300), edges to the right (through B, level 1 = 100 px) and straight down: a quarter turn clockwise.
  const wedge = (style?: DrawingStyle, c = { x: 200, y: 450 }) =>
    screen('fib-wedge', [{ x: 200, y: 300 }, { x: 300, y: 300 }, c], style);

  it('draws arcs between its edges, across the smaller angle', () => {
    const { ctx, arcs, points } = recorder();
    fibWedge.render(ctx, wedge({ levels: [{ value: 0.5 }, { value: 1 }] }), env());
    expect(radii(arcs, { x: 200, y: 300 })).toEqual([50, 100]);
    expect(arcs.filter((a) => a.from === 0).every((a) => a.to === Math.PI / 2 && !a.ccw)).toBe(true);
    // Edges run from the apex as far as the outer arc.
    expect(points).toContainEqual({ x: 300, y: 300 });
    expect(points.some((p) => Math.abs(p.x - 200) < 1e-9 && Math.abs(p.y - 400) < 1e-9)).toBe(true);
    // The third anchor on the other side turns anticlockwise.
    const up = recorder();
    fibWedge.render(up.ctx, wedge({ levels: [{ value: 1 }] }, { x: 200, y: 100 }), env());
    expect(up.arcs.every((a) => (a.from === 0 ? a.ccw : true))).toBe(true);
  });

  it('hits its edges and arcs inside the wedge only', () => {
    const e = env();
    const at = (r: number, angle: number) => ({ x: 200 + r * Math.cos(angle), y: 300 + r * Math.sin(angle) });
    expect(fibWedge.hitTest(wedge(), at(61.8, Math.PI / 4), e)).toBe(true); // 0.618
    expect(fibWedge.hitTest(wedge(), at(161.8, 0.1), e)).toBe(true); // 1.618
    expect(fibWedge.hitTest(wedge(), at(61.8, -Math.PI / 4), e)).toBe(false); // outside the wedge
    expect(fibWedge.hitTest(wedge(), at(70, Math.PI / 4), e)).toBe(false); // between levels
    expect(fibWedge.hitTest(wedge(), { x: 201, y: 420 }, e)).toBe(true); // second edge
    expect(fibWedge.hitTest(wedge(), { x: 200, y: 480 }, e)).toBe(false); // past the edge's end
  });

  it('labels the middle of each arc and reports the wedge as its extent', () => {
    const { ctx, texts } = recorder();
    fibWedge.render(ctx, wedge({ levels: [{ value: 1 }] }), env());
    expect(texts.map((t) => t.text)).toEqual(['1']);
    const box = fibWedge.bounds!(wedge({ levels: [{ value: 1 }] }), env())!;
    expect(box.x).toBeCloseTo(200);
    expect(box.y).toBeCloseTo(300);
    expect(box.width).toBeCloseTo(100);
    expect(box.height).toBeCloseTo(100);
  });

  it('shows one edge until its third anchor is placed', () => {
    const one = recorder();
    expect(() => fibWedge.render(one.ctx, screen('fib-wedge', [{ x: 200, y: 300 }]), env())).not.toThrow();
    expect(finite(one.points)).toBe(true);
    const two = screen('fib-wedge', [{ x: 200, y: 300 }, { x: 300, y: 300 }]);
    expect(fibWedge.hitTest(two, { x: 350, y: 301 }, env())).toBe(true); // edge out to 1.618
    expect(fibWedge.hitTest(two, { x: 200, y: 400 }, env())).toBe(false);
  });

  it('is created with three clicks and round-trips', () => {
    const { manager } = setup();
    manager.setTool('fib-wedge');
    clickAll(manager, [{ x: 200, y: 300 }, { x: 300, y: 300 }, { x: 200, y: 450 }]);
    const [d] = manager.getAll();
    expect(d?.points).toHaveLength(3);
    const other = roundTrip(manager);
    expect(other.getAll()[0]?.style.levels).toEqual(fibWedge.defaultStyle!.levels);
    expect(other.cursor({ x: 200 + 50 * Math.SQRT1_2, y: 300 + 50 * Math.SQRT1_2 })).toBe('pointer'); // 0.5
  });
});

describe('goldenSpiral', () => {
  const PHI = (1 + Math.sqrt(5)) / 2;
  const c = { x: 0, y: 0 };
  const r = (p: Point) => Math.hypot(p.x, p.y);
  const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;

  it('passes the anchor and grows by the golden ratio every quarter turn, anticlockwise on screen', () => {
    const pts = goldenSpiral(c, { x: 100, y: 0 }, 1000);
    const i = pts.findIndex((p) => near(p, { x: 100, y: 0 }));
    expect(i).toBeGreaterThan(0);
    // 16 steps of pi/32 make a quarter turn: up on screen, 100·phi out.
    expect(near(pts[i + 16]!, { x: 0, y: -100 * PHI })).toBe(true);
    expect(near(pts[i - 16]!, { x: 0, y: 100 / PHI })).toBe(true);
    expect(r(pts[0]!)).toBeCloseTo(0.5);
    expect(r(pts[pts.length - 1]!)).toBeCloseTo(1000);
  });

  it('reaches the anchor even when it lies past the outer radius, and is empty at the centre', () => {
    const pts = goldenSpiral(c, { x: 0, y: 200 }, 50);
    expect(near(pts[pts.length - 1]!, { x: 0, y: 200 })).toBe(true);
    expect(goldenSpiral(c, c, 1000)).toEqual([]);
    expect(goldenSpiral(c, { x: 0.2, y: 0 }, 1000)).toEqual([]);
  });
});

describe('Fibonacci spiral', () => {
  const PHI = (1 + Math.sqrt(5)) / 2;
  // Centre (300,300), through (400,300): a quarter turn on it passes (300, 300 - 100·phi).
  const spiral = () => screen('fib-spiral', [{ x: 300, y: 300 }, { x: 400, y: 300 }]);

  it('draws the guide and the spiral out past the pane', () => {
    const { ctx, points } = recorder();
    fibSpiral.render(ctx, spiral(), env());
    expect(finite(points)).toBe(true);
    expect(points.some((p) => Math.abs(p.x - 300) < 1e-6 && Math.abs(p.y - (300 - 100 * PHI)) < 1e-6)).toBe(true);
    expect(Math.max(...points.map((p) => Math.hypot(p.x - 300, p.y - 300)))).toBeCloseTo(Math.hypot(700, 300));
  });

  it('hits the curve and the guide, not the gaps between turns', () => {
    const e = env();
    expect(fibSpiral.hitTest(spiral(), { x: 302, y: 300 - 100 * PHI }, e)).toBe(true);
    expect(fibSpiral.hitTest(spiral(), { x: 350, y: 302 }, e)).toBe(true); // guide
    expect(fibSpiral.hitTest(spiral(), { x: 430, y: 300 }, e)).toBe(false); // between 100 and 100·phi^4
    expect(fibSpiral.hitTest(spiral(), { x: 300, y: 400 }, e)).toBe(false);
  });

  it('reports the curve as its extent, and nothing before it has a size', () => {
    const { ctx, points } = recorder();
    fibSpiral.render(ctx, spiral(), env());
    const curve = points.slice(2); // after the guide
    const box = fibSpiral.bounds!(spiral(), env())!;
    expect(box.x).toBeCloseTo(Math.min(...curve.map((p) => p.x)));
    expect(box.y).toBeCloseTo(Math.min(...curve.map((p) => p.y)));
    expect(box.x + box.width).toBeCloseTo(Math.max(...curve.map((p) => p.x)));
    expect(box.y + box.height).toBeCloseTo(Math.max(...curve.map((p) => p.y)));
    expect(fibSpiral.bounds!(screen('fib-spiral', [{ x: 300, y: 300 }]), env())).toBeNull();
    const one = recorder();
    expect(() => fibSpiral.render(one.ctx, screen('fib-spiral', [{ x: 300, y: 300 }]), env())).not.toThrow();
  });

  it('is created with two clicks and round-trips', () => {
    const { manager } = setup();
    manager.setTool('fib-spiral');
    clickAll(manager, [{ x: 300, y: 300 }, { x: 400, y: 300 }]);
    const other = roundTrip(manager);
    expect(other.getAll()[0]?.type).toBe('fib-spiral');
    expect(other.cursor({ x: 300, y: 300 - 100 * PHI })).toBe('pointer');
    expect(other.cursor({ x: 430, y: 300 })).toBeNull();
  });
});
