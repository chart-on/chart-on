import { describe, expect, it } from 'vitest';
import { DrawingManager, type DrawingEvents, type DrawingHost } from '../src/drawing/manager';
import { simplifyPolyline } from '../src/drawing/geometry';
import { arc, arcThrough, bend, brush, circle, curve, doubleBend, doubleCurve, ellipse, highlighter, path, polyline, rotatedRectangle, triangle } from '../src/drawing/shape-tools';
import type { DrawingEnv, DrawingToolDef, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import type { Point } from '../src/types';
import { withBuiltinTools } from './builtin-tools';

const env = { width: 1000, height: 500, theme: darkTheme } as DrawingEnv;
const screen = (type: string, points: Point[], style = {}): ScreenDrawing => ({
  drawing: { id: 'x', type, pane: 0, points: points.map(() => ({ time: 0, price: 0 })), style },
  points,
  selected: false,
  hovered: false,
});

describe('simplifyPolyline', () => {
  it('keeps the ends and drops points within the tolerance', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0.4 },
      { x: 2, y: -0.3 },
      { x: 3, y: 0 },
    ];
    expect(simplifyPolyline(pts, 1)).toEqual([0, 3]);
  });

  it('keeps corners further than the tolerance', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 0.2 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
    ];
    expect(simplifyPolyline(pts, 1)).toEqual([0, 2, 4]);
  });

  it('returns short lines unchanged', () => {
    expect(simplifyPolyline([], 1)).toEqual([]);
    expect(simplifyPolyline([{ x: 0, y: 0 }], 1)).toEqual([0]);
    expect(simplifyPolyline([{ x: 0, y: 0 }, { x: 1, y: 1 }], 1)).toEqual([0, 1]);
  });

  it('drops points within the tolerance of the previous kept point before simplifying', () => {
    // RDP alone keeps the spike at index 2; the radial pre-filter drops it first
    // because it lies within the tolerance of index 1.
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0.9 },
      { x: 10.6, y: 1.6 },
      { x: 20, y: 0 },
    ];
    expect(simplifyPolyline(pts, 1)).toEqual([0, 3]);
  });

  it('collapses densely sampled jitter cheaply', () => {
    const pts = Array.from({ length: 200_000 }, (_, i) => ({ x: (i % 7) * 0.1, y: (i % 5) * 0.1 }));
    pts.push({ x: 50, y: 50 });
    expect(simplifyPolyline(pts, 1)).toEqual([0, pts.length - 1]);
  });

  it('handles long strokes without recursion limits', () => {
    const pts = Array.from({ length: 20_000 }, (_, i) => ({ x: i, y: Math.sin(i / 50) * 40 }));
    const kept = simplifyPolyline(pts, 1);
    expect(kept[0]).toBe(0);
    expect(kept.at(-1)).toBe(pts.length - 1);
    expect(kept.length).toBeLessThan(pts.length / 10);
  });
});

describe('shape hit testing', () => {
  it('circle: inside and on the edge, not outside', () => {
    const d = screen('circle', [{ x: 100, y: 100 }, { x: 150, y: 100 }]);
    expect(circle.hitTest(d, { x: 100, y: 120 }, env)).toBe(true);
    expect(circle.hitTest(d, { x: 152, y: 100 }, env)).toBe(true);
    expect(circle.hitTest(d, { x: 160, y: 100 }, env)).toBe(false);
  });

  it('ellipse: inside its box corners, not in the corners themselves', () => {
    const d = screen('ellipse', [{ x: 0, y: 0 }, { x: 200, y: 100 }]);
    expect(ellipse.hitTest(d, { x: 100, y: 50 }, env)).toBe(true);
    expect(ellipse.hitTest(d, { x: 200, y: 50 }, env)).toBe(true);
    expect(ellipse.hitTest(d, { x: 5, y: 5 }, env)).toBe(false);
  });

  it('brush: near the stroke, not away from it', () => {
    const d = screen('brush', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(brush.hitTest(d, { x: 50, y: 4 }, env)).toBe(true);
    expect(brush.hitTest(d, { x: 104, y: 60 }, env)).toBe(true);
    expect(brush.hitTest(d, { x: 50, y: 50 }, env)).toBe(false);
  });

  it('triangle: inside and near its edges, not outside', () => {
    const d = screen('triangle', [{ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 200, y: 100 }]);
    expect(triangle.hitTest(d, { x: 100, y: 60 }, env)).toBe(true);
    expect(triangle.hitTest(d, { x: 100, y: 102 }, env)).toBe(true);
    expect(triangle.hitTest(d, { x: 20, y: 20 }, env)).toBe(false);
  });

  it('rotated rectangle: the third point sets the width across the first side', () => {
    // First side from (0, 0) to (100, 100); the third point lies 50·√2 px across it.
    const d = screen('rotated-rectangle', [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }]);
    expect(rotatedRectangle.bounds!(d, env)).toEqual({ x: 0, y: -50, width: 150, height: 150 });
    expect(rotatedRectangle.hitTest(d, { x: 75, y: 25 }, env)).toBe(true);
    expect(rotatedRectangle.hitTest(d, { x: 140, y: 40 }, env)).toBe(true);
    expect(rotatedRectangle.hitTest(d, { x: 20, y: 80 }, env)).toBe(false);
    // Before the third point moves off the first side, the shape is that side.
    const flat = screen('rotated-rectangle', [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 100 }]);
    expect(rotatedRectangle.bounds!(flat, env)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('curve: passes through the third point halfway along, and is straight until it is placed', () => {
    const pts = bend({ x: 0, y: 100 }, { x: 200, y: 100 }, { x: 100, y: 0 });
    expect(pts[0]).toEqual({ x: 0, y: 100 });
    expect(pts.at(-1)).toEqual({ x: 200, y: 100 });
    expect(pts[pts.length >> 1]).toEqual({ x: 100, y: 0 });
    // The midpoint is the curve's peak.
    expect(Math.min(...pts.map((q) => q.y))).toBe(0);
    const d = screen('curve', [{ x: 0, y: 100 }, { x: 200, y: 100 }, { x: 100, y: 0 }]);
    expect(curve.bounds!(d, env)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(curve.hitTest(d, { x: 100, y: 3 }, env)).toBe(true);
    expect(curve.hitTest(d, { x: 100, y: 60 }, env)).toBe(false);
    const flat = screen('curve', [{ x: 0, y: 100 }, { x: 200, y: 100 }]);
    const box = curve.bounds!(flat, env)!;
    expect([box.x, box.y, box.width, box.height].map(Math.round)).toEqual([0, 100, 200, 0]);
  });

  it('double curve: an S through the third point and its mirror, smooth at the middle', () => {
    const pts = doubleBend({ x: 0, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 50 });
    const n = pts.length;
    expect(pts[0]).toEqual({ x: 0, y: 100 });
    expect(pts[n - 1]).toEqual({ x: 200, y: 100 });
    expect(pts).toContainEqual({ x: 50, y: 50 });
    expect(pts).toContainEqual({ x: 150, y: 150 });
    // Both halves meet at the middle with the same direction.
    const m = n / 2;
    expect(pts[m - 1]).toEqual({ x: 100, y: 100 });
    const before = Math.atan2(pts[m - 1]!.y - pts[m - 2]!.y, pts[m - 1]!.x - pts[m - 2]!.x);
    const after = Math.atan2(pts[m + 1]!.y - pts[m]!.y, pts[m + 1]!.x - pts[m]!.x);
    expect(after).toBeCloseTo(before, 1);
    const d = screen('double-curve', [{ x: 0, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 50 }]);
    expect(doubleCurve.hitTest(d, { x: 150, y: 148 }, env)).toBe(true);
    expect(doubleCurve.hitTest(d, { x: 150, y: 60 }, env)).toBe(false);
  });

  it('arc: the circular arc through the three points, the way that passes the third', () => {
    const near = (pts: { x: number; y: number }[], x: number, y: number) => pts.some((q) => Math.hypot(q.x - x, q.y - y) < 1e-6);
    // Upper half of the circle of radius 100 around (100, 100).
    const upper = arcThrough({ x: 0, y: 100 }, { x: 200, y: 100 }, { x: 100, y: 0 });
    expect(upper[0]!.x).toBeCloseTo(0);
    expect(upper.at(-1)!.x).toBeCloseTo(200);
    expect(near(upper, 100, 0)).toBe(true);
    expect(upper.every((q) => q.y <= 100 + 1e-9 && Math.abs(Math.hypot(q.x - 100, q.y - 100) - 100) < 1e-9)).toBe(true);
    // Through a point below the chord, the long way round.
    const lower = arcThrough({ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 100, y: 200 });
    expect(near(lower, 100, 200)).toBe(true);
    expect(near(lower, 200, 100)).toBe(true);
    // In line: the straight segment.
    expect(arcThrough({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 })).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    const d = screen('arc', [{ x: 0, y: 100 }, { x: 200, y: 100 }, { x: 100, y: 0 }]);
    const box = arc.bounds!(d, env)!;
    expect([box.x, box.y, box.width, box.height].map(Math.round)).toEqual([0, 0, 200, 100]);
    expect(arc.hitTest(d, { x: 171, y: 29 }, env)).toBe(true);
    expect(arc.hitTest(d, { x: 100, y: 100 }, env)).toBe(false);
  });

  it('polyline, path and highlighter: near their segments, not inside the bend', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    for (const tool of [polyline, path]) {
      const d = screen(tool.type, pts);
      expect(tool.hitTest(d, { x: 50, y: 5 }, env)).toBe(true);
      expect(tool.hitTest(d, { x: 50, y: 50 }, env)).toBe(false);
    }
    // The highlighter's hit area follows its wide line.
    const wide = screen('highlighter', pts, { lineWidth: 12 });
    expect(highlighter.hitTest(wide, { x: 50, y: 11 }, env)).toBe(true);
    expect(highlighter.hitTest(wide, { x: 50, y: 14 }, env)).toBe(false);
  });

  it('path ends in an arrow head at its last point; the highlighter strokes translucent', () => {
    const calls: unknown[][] = [];
    const rec = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : (...args: unknown[]) => calls.push([k, ...args])),
      set: (t, k, v) => ((t[k as string] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    path.render(rec, screen('path', [{ x: 0, y: 0 }, { x: 100, y: 0 }]), env);
    expect(calls.filter((c) => c[0] === 'lineTo').at(-2)).toEqual(['lineTo', 100, 0]);
    expect(calls.filter((c) => c[0] === 'stroke')).toHaveLength(2);
    highlighter.render(rec, screen('highlighter', [{ x: 0, y: 0 }, { x: 9, y: 9 }], { color: '#ff0000' }), env);
    expect(rec.strokeStyle).toBe('rgba(255, 0, 0, 0.400)');
  });
});

// x = (index - 99) * 10 + 1000, time = index * 60, price = 500 - y (see drawing.test.ts).
function setup(events: { name: keyof DrawingEvents; payload: unknown }[] = []) {
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
    emit: (name, payload) => events.push({ name, payload }),
  };
  return withBuiltinTools(new DrawingManager(host));
}

describe('shape tools in the manager', () => {
  it('simplifies a brush stroke when it ends', () => {
    const m = setup();
    m.setTool('brush');
    m.pointerDown(0, { x: 100, y: 300 });
    // A straight stroke with a little jitter, then a sharp turn.
    for (let x = 103; x <= 400; x += 3) m.pointerMove({ x, y: 300 + (x % 2 ? 0.3 : -0.3) });
    for (let y = 297; y >= 100; y -= 3) m.pointerMove({ x: 400, y });
    m.pointerUp({ x: 400, y: 100 });
    const [stroke] = m.getAll();
    expect(stroke!.type).toBe('brush');
    expect(stroke!.points.length).toBeLessThanOrEqual(4);
    expect(stroke!.points[0]).toEqual({ time: 540, price: 200 });
    expect(stroke!.points.at(-1)!.price).toBeCloseTo(398); // the last recorded move
  });

  it('drags and serializes circles and ellipses like other two-point tools', () => {
    const m = setup();
    for (const type of ['circle', 'ellipse']) {
      m.setTool(type);
      m.pointerDown(0, { x: 200, y: 200 });
      m.pointerUp({ x: 200, y: 200 });
      m.pointerDown(0, { x: 300, y: 300 });
      m.pointerUp({ x: 300, y: 300 });
    }
    const [c, e] = m.getAll();
    expect(c).toMatchObject({ type: 'circle', points: [{ time: 1140, price: 300 }, { time: 1740, price: 200 }] });
    expect(e).toMatchObject({ type: 'ellipse' });
    // Drag the ellipse (topmost) by its middle 10 px right.
    m.pointerDown(0, { x: 250, y: 250 });
    m.pointerMove({ x: 260, y: 250 });
    m.pointerUp({ x: 260, y: 250 });
    expect(m.getAll()[1]!.points[0]!.time).toBe(1200);
    const copy = setup();
    copy.load(JSON.parse(JSON.stringify(m.serialize())));
    expect(copy.getAll()).toEqual(m.getAll());
  });

  it('places polylines and paths point by point until Enter, and three-point shapes in three clicks', () => {
    const m = setup();
    for (const type of ['polyline', 'path']) {
      m.setTool(type);
      for (const [x, y] of [[100, 300], [200, 200], [300, 300]] as const) {
        m.pointerDown(0, { x, y });
        m.pointerUp({ x, y });
      }
      expect(m.keyDown({ key: 'Enter' } as KeyboardEvent)).toBe(true);
    }
    for (const type of ['triangle', 'rotated-rectangle', 'curve', 'double-curve', 'arc']) {
      m.setTool(type);
      for (const [x, y] of [[400, 300], [500, 200], [600, 300]] as const) {
        m.pointerDown(0, { x, y });
        m.pointerUp({ x, y });
      }
    }
    const all = m.getAll();
    expect(all.map((d) => [d.type, d.points.length])).toEqual([
      ['polyline', 3],
      ['path', 3],
      ['triangle', 3],
      ['rotated-rectangle', 3],
      ['curve', 3],
      ['double-curve', 3],
      ['arc', 3],
    ]);
    expect(all[0]!.points).toEqual([{ time: 540, price: 200 }, { time: 1140, price: 300 }, { time: 1740, price: 200 }]);
    const copy = setup();
    copy.load(JSON.parse(JSON.stringify(m.serialize())));
    expect(copy.getAll()).toEqual(all);
  });

  it('draws a highlighter stroke wide by default and simplifies it', () => {
    const m = setup();
    m.setTool('highlighter');
    m.pointerDown(0, { x: 100, y: 300 });
    for (let x = 105; x <= 300; x += 5) m.pointerMove({ x, y: 300 });
    m.pointerUp({ x: 300, y: 300 });
    const [stroke] = m.getAll();
    expect(stroke).toMatchObject({ type: 'highlighter', style: { lineWidth: 12 } });
    expect(stroke!.points).toHaveLength(2);
  });

  it('simplifies only tools that opt in', () => {
    const m = setup();
    const plain: DrawingToolDef = { ...brush, type: 'plain-free', simplify: undefined };
    m.register(plain);
    m.setTool('plain-free');
    m.pointerDown(0, { x: 100, y: 300 });
    for (let x = 110; x <= 300; x += 10) m.pointerMove({ x, y: 300 });
    m.pointerUp({ x: 300, y: 300 });
    expect(m.getAll()[0]!.points).toHaveLength(21);
    expect(brush.simplify).toBeTruthy();
  });

  it('bounds a selected brush with a huge number of points', () => {
    const events: { name: keyof DrawingEvents; payload: unknown }[] = [];
    const m = setup(events);
    const points = Array.from({ length: 200_000 }, (_, i) => ({ time: 540 + (i % 1000) * 1.2, price: 100 + (i % 300) }));
    const d = m.add({ type: 'brush', pane: 0, points, style: {} });
    m.select(d.id);
    m.render(ctx, 0, 1000, 500);
    const bounds = events.filter((e) => e.name === 'drawing:bounds').at(-1)?.payload;
    expect(bounds).toEqual({ id: d.id, rect: { x: 100, y: 101, width: 200, height: 299 } });
    // 200k points are needed: spreading fewer into Math.min/max does not reliably overflow.
  }, 30_000);

  it("bounds a selected circle by its extent, not just its anchors", () => {
    const events: { name: keyof DrawingEvents; payload: unknown }[] = [];
    const m = setup(events);
    // Centre at (200, 200), edge at (300, 300): radius 141.42.
    const d = m.add({ type: 'circle', pane: 0, points: [{ time: 1140, price: 300 }, { time: 1740, price: 200 }], style: {} });
    m.select(d.id);
    m.render(ctx, 0, 1000, 500);
    const bounds = events.filter((e) => e.name === 'drawing:bounds').at(-1)?.payload;
    expect(bounds).toEqual({ id: d.id, rect: { x: 59, y: 59, width: 283, height: 283 } });
  });

  it('moves a brush stroke as a whole', () => {
    const m = setup();
    const points = [
      { time: 540, price: 200 },
      { time: 600, price: 220 },
      { time: 660, price: 180 },
    ];
    m.add({ type: 'brush', pane: 0, points, style: {} });
    // Grab the stroke at its second point (x 110, y 280) and drag 20 px right, 10 px up.
    m.pointerDown(0, { x: 110, y: 280 });
    m.pointerMove({ x: 130, y: 270 });
    m.pointerUp({ x: 130, y: 270 });
    const moved = m.getAll()[0]!.points;
    expect(moved.map((q) => q.time)).toEqual([660, 720, 780]);
    moved.forEach((q, i) => expect(q.price).toBeCloseTo(points[i]!.price + 10));
  });

  it('round-trips a brush stroke through serialize and load', () => {
    const m = setup();
    m.setTool('brush');
    m.pointerDown(0, { x: 100, y: 300 });
    for (let i = 1; i <= 40; i++) m.pointerMove({ x: 100 + i * 5, y: 300 + Math.sin(i / 3) * 40 });
    m.pointerUp({ x: 300, y: 300 });
    const saved = m.serialize();
    expect(saved.drawings[0]!.type).toBe('brush');
    const copy = setup();
    copy.load(JSON.parse(JSON.stringify(saved)));
    expect(copy.getAll()).toEqual(m.getAll());
    expect(copy.serialize()).toEqual(saved);
  });
});

const ctx = new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D;
