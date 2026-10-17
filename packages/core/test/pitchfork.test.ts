import { describe, expect, it } from 'vitest';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import {
  insidePitchfork,
  modifiedSchiffPitchfork,
  pitchfan,
  pitchfork,
  pitchforkMedian,
  schiffPitchfork,
} from '../src/drawing/pitchfork';
import { builtinTools } from '../src/drawing/tools';
import type { Drawing, DrawingEnv, DrawingLevel, DrawingStyle, DrawingToolDef, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import type { Point } from '../src/types';
import { withBuiltinTools } from './builtin-tools';

/** Viewport where x = 10 * index + 10, time = index * 60 and y = 500 - price. */
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

function env(): DrawingEnv {
  return {
    width: 1000,
    height: 500,
    theme: darkTheme,
    pixelRatio: 1,
    formatPrice: (price) => price.toFixed(2),
    priceToY: (price) => 500 - price,
    yToPrice: (y) => 500 - y,
    timeToX: (time) => time / 6 + 10,
    xToTime: (x) => (x - 10) * 6,
    barsBetween: () => 0,
    bars: () => [],
    measureText: (text, fontSize) => text.length * fontSize * 0.6,
  };
}

/** Anchors A, B and C used throughout: the midpoint of B and C is (250, 250). */
const A: Point = { x: 100, y: 400 };
const B: Point = { x: 200, y: 200 };
const C: Point = { x: 300, y: 300 };

function screen(type: string, points: Point[] = [A, B, C], style: DrawingStyle = {}): ScreenDrawing {
  const drawing: Drawing = {
    id: 'x',
    type,
    pane: 0,
    points: points.map((p) => ({ time: (p.x - 10) * 6, price: 500 - p.y })),
    style,
  };
  return { drawing, points, selected: false, hovered: false };
}

const hits = (tool: DrawingToolDef, p: Point, style?: DrawingStyle) => tool.hitTest(screen(tool.type, [A, B, C], style), p, env());

/** Canvas stand-in that records path points. */
function recorder() {
  const points: Point[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key) =>
      key in target
        ? target[key as string]
        : (...args: unknown[]) => {
            if (key === 'moveTo' || key === 'lineTo') points.push({ x: args[0] as number, y: args[1] as number });
          },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, points };
}

describe('pitchforkMedian', () => {
  it('aims every variant at the midpoint of B and C', () => {
    for (const variant of ['standard', 'schiff', 'modified-schiff', 'inside'] as const) {
      expect(pitchforkMedian(variant, A, B, C).mid).toEqual({ x: 250, y: 250 });
    }
  });

  it('starts the standard median at A', () => {
    expect(pitchforkMedian('standard', A, B, C).origin).toEqual(A);
  });

  it('starts the Schiff median at A in time, halfway to B in price', () => {
    expect(pitchforkMedian('schiff', A, B, C).origin).toEqual({ x: 100, y: 300 });
  });

  it('starts the modified Schiff median halfway between A and B', () => {
    expect(pitchforkMedian('modified-schiff', A, B, C).origin).toEqual({ x: 150, y: 300 });
  });

  it('starts the inside median halfway between A and C, parallel to A→B', () => {
    const { origin, mid } = pitchforkMedian('inside', A, B, C);
    expect(origin).toEqual({ x: 200, y: 350 });
    // Same slope as A→B.
    expect((mid.y - origin.y) / (mid.x - origin.x)).toBeCloseTo((B.y - A.y) / (B.x - A.x));
  });

  it('works in time and price as well as pixels', () => {
    const { origin, mid } = pitchforkMedian('modified-schiff', { x: 0, y: 10 }, { x: 600, y: 30 }, { x: 1200, y: 20 });
    expect(origin).toEqual({ x: 300, y: 20 });
    expect(mid).toEqual({ x: 900, y: 25 });
  });
});

describe('pitchfork tools', () => {
  it('are built in, in the parallels rail group, with three points', () => {
    const ids = ['inside-pitchfork', 'modified-schiff-pitchfork', 'pitchfan', 'pitchfork', 'schiff-pitchfork'];
    const tools = builtinTools.filter((t) => ids.includes(t.type));
    expect(tools.map((t) => t.type)).toEqual(ids);
    for (const t of tools) expect(t.group).toBe('parallels');
    for (const t of tools) expect(t.points).toBe(3);
  });

  it('hits the standard median, both tines and the B–C line', () => {
    // Median y = 500 - x from A onwards; tines y = 400 - x through B and y = 600 - x through C.
    expect(hits(pitchfork, { x: 400, y: 100 })).toBe(true);
    expect(hits(pitchfork, { x: 300, y: 100 })).toBe(true);
    expect(hits(pitchfork, { x: 400, y: 200 })).toBe(true);
    expect(hits(pitchfork, { x: 225, y: 225 })).toBe(true);
    expect(hits(pitchfork, { x: 400, y: 150 })).toBe(false); // between median and tine
    expect(hits(pitchfork, { x: 50, y: 450 })).toBe(false); // behind A
  });

  it('runs the median to the pane edge', () => {
    expect(hits(pitchfork, { x: 495, y: 5 })).toBe(true);
  });

  it('hits the Schiff median, its tines and the guide from A', () => {
    // Origin (100, 300), direction (150, -50).
    expect(hits(schiffPitchfork, { x: 400, y: 200 })).toBe(true);
    expect(hits(schiffPitchfork, { x: 500, y: 100 })).toBe(true); // tine through B
    expect(hits(schiffPitchfork, { x: 600, y: 200 })).toBe(true); // tine through C
    expect(hits(schiffPitchfork, { x: 100, y: 350 })).toBe(true); // guide
    expect(hits(pitchfork, { x: 600, y: 200 })).toBe(false);
  });

  it('hits the modified Schiff median', () => {
    // Origin (150, 300), direction (100, -50).
    expect(hits(modifiedSchiffPitchfork, { x: 350, y: 200 })).toBe(true);
    expect(hits(modifiedSchiffPitchfork, { x: 400, y: 150 })).toBe(false);
  });

  it('hits the inside median', () => {
    // Origin (200, 350), direction (50, -100).
    expect(hits(insidePitchfork, { x: 300, y: 150 })).toBe(true);
    expect(hits(insidePitchfork, { x: 400, y: 200 })).toBe(false);
  });

  it('fans rays from A through B, the midpoint and C', () => {
    expect(hits(pitchfan, { x: 250, y: 100 })).toBe(true);
    expect(hits(pitchfan, { x: 400, y: 100 })).toBe(true);
    expect(hits(pitchfan, { x: 500, y: 200 })).toBe(true);
    expect(hits(pitchfan, { x: 300, y: 100 })).toBe(false); // a standard tine, not a ray
  });

  it('draws only the levels that are visible', () => {
    // Level 0.5 runs through (225, 225) and (275, 275), parallel to the median.
    expect(hits(pitchfork, { x: 325, y: 125 })).toBe(false);
    const half: DrawingLevel[] = [{ value: 0.5 }];
    expect(hits(pitchfork, { x: 325, y: 125 }, { levels: half })).toBe(true);
    expect(hits(pitchfork, { x: 300, y: 100 }, { levels: half })).toBe(false); // tines hidden
    expect(hits(pitchfork, { x: 300, y: 100 }, { levels: [{ value: 1, visible: false }] })).toBe(false);
  });

  it('places outer levels on the extended B–C line', () => {
    // Level 2 starts at (150, 150) and (350, 350).
    const style = { levels: [{ value: 1 }, { value: 2 }] };
    expect(hits(pitchfork, { x: 250, y: 50 }, style)).toBe(true);
    expect(hits(pitchfork, { x: 175, y: 175 }, style)).toBe(true); // base reaches the outer level
    expect(hits(pitchfork, { x: 175, y: 175 })).toBe(false);
  });

  it('falls back to the default levels when the saved ones are malformed', () => {
    const broken = { levels: 'nope' as unknown as DrawingLevel[] };
    expect(hits(pitchfork, { x: 300, y: 100 }, broken)).toBe(true);
    const junk = [null, { value: 'x' }, { value: 1 }] as unknown as DrawingLevel[];
    expect(hits(pitchfork, { x: 300, y: 100 }, { levels: junk })).toBe(true);
  });

  it('renders finite geometry while being placed and once complete', () => {
    for (const tool of [pitchfork, schiffPitchfork, modifiedSchiffPitchfork, insidePitchfork, pitchfan]) {
      for (const n of [1, 2, 3]) {
        const { ctx, points } = recorder();
        const d = screen(tool.type, [A, B, C].slice(0, n), { levels: [{ value: 0.5 }, { value: 1 }, { value: 2 }] });
        expect(() => tool.render(ctx, d, env())).not.toThrow();
        expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      }
    }
  });

  it('starts fork bands on the B–C line and fan bands at A', () => {
    const { ctx, points } = recorder();
    pitchfork.render(ctx, screen('pitchfork'), env());
    // The first band is a fill path: B–C midpoint, along the median, back along a tine.
    expect(points[0]).toEqual({ x: 250, y: 250 });
    const fan = recorder();
    pitchfan.render(fan.ctx, screen('pitchfan'), env());
    expect(fan.points[0]).toEqual(A);
  });

  it('is open in time towards where the lines run', () => {
    const d = screen('pitchfork').drawing;
    expect(pitchfork.modelBounds!(d)).toEqual({ from: (100 - 10) * 6, to: Infinity, low: -Infinity, high: Infinity });
    const back = screen('pitchfork', [{ x: 400, y: 400 }, B, C]).drawing;
    expect(pitchfork.modelBounds!(back).from).toBe(-Infinity);
    expect(pitchfork.modelBounds!(back).to).toBe((400 - 10) * 6);
    expect(pitchfan.modelBounds!(d).from).toBe((100 - 10) * 6);
    expect(pitchfan.modelBounds!(d).to).toBe(Infinity);
  });
});

describe('pitchforks in the drawing manager', () => {
  const click = (manager: DrawingManager, p: Point) => {
    manager.pointerMove(p);
    manager.pointerDown(0, p);
    manager.pointerUp(p);
  };

  it('places a pitchfork with three clicks', () => {
    const { manager } = setup();
    manager.setTool('schiff-pitchfork');
    click(manager, A);
    click(manager, B);
    click(manager, C);
    const [d] = manager.getAll();
    expect(d?.type).toBe('schiff-pitchfork');
    expect(d?.points.map((p) => p.price)).toEqual([expect.closeTo(100), expect.closeTo(300), expect.closeTo(200)]);
    expect(d?.style.levels).toHaveLength(4);
    expect(manager.tool).toBeNull();
    expect(manager.cursor({ x: 400, y: 200 })).toBe('pointer'); // Schiff median
  });

  it('serializes and loads with its levels', () => {
    const { manager } = setup();
    const levels: DrawingLevel[] = [{ value: 0.5, color: 'levelOrange' }, { value: 1 }, { value: 1.5, visible: false }];
    manager.add({
      type: 'pitchfan',
      pane: 0,
      points: [
        { time: 540, price: 100 },
        { time: 1140, price: 300 },
        { time: 1740, price: 200 },
      ],
      style: { levels, fill: 'transparent' },
    });
    const saved = JSON.parse(JSON.stringify(manager.serialize()));
    const { manager: other } = setup();
    expect(other.load(saved).errors).toEqual([]);
    const [d] = other.getAll();
    expect(d?.type).toBe('pitchfan');
    expect(d?.points).toEqual(manager.getAll()[0]?.points);
    // New pitchforks carry their labels' default, off.
    expect(d?.style).toEqual({ levels, fill: 'transparent', showLabel: false });
  });
});
