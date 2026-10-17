import { describe, expect, it, vi } from 'vitest';
import { Chart } from '../src/chart';
import { fakeContainer } from './fake-dom';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import { distToSegment } from '../src/drawing/geometry';
import { arrowHead, fillBetween, labelPill, labelledPolyline, levelLines, strokeLine } from '../src/drawing/draw';
import type { DrawingEnv, DrawingToolDef } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import type { Bar } from '../src/types';
import { withBuiltinTools } from './builtin-tools';

// Same geometry as drawing.test.ts: x = (index - 99) * 10 + 1000, time = index * 60, price = 500 - y.
function setup(bars: Bar[] = []) {
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
    barSpan: (from, to) => {
      const kept = bars.filter((b) => b.time >= from && b.time <= to);
      return { bars: kept, start: 0, end: kept.length };
    },
    pixelRatio: 2,
  };
  const manager = withBuiltinTools(new DrawingManager(host));
  for (const tool of [polyline, brush, note, level, target]) manager.register(tool);
  return { manager, time, pane };
}

const segments = (pts: { x: number; y: number }[]) => pts.slice(1).map((b, i) => [pts[i]!, b] as const);

const polyline: DrawingToolDef = {
  type: 'polyline',
  label: 'Polyline',
  points: 'n',
  render() {},
  hitTest: (d, p) => segments(d.points).some(([a, b]) => distToSegment(p, a, b) <= 6),
};

const brush: DrawingToolDef = { ...polyline, type: 'brush', label: 'Brush', points: 'free' };

const note: DrawingToolDef = {
  type: 'note',
  label: 'Note',
  points: 1,
  anchoring: 'screen',
  render() {},
  hitTest: (d, p) => Math.hypot(p.x - d.points[0]!.x, p.y - d.points[0]!.y) <= 10,
};

/** Two points kept at the same price. */
const level: DrawingToolDef = {
  type: 'level',
  label: 'Level',
  points: 2,
  constrain: (points, anchor) => points.map((q) => ({ ...q, price: points[anchor]!.price })),
  render() {},
  hitTest: (d, p) => distToSegment(p, d.points[0]!, d.points[1]!) <= 6,
};

/** A line with a draggable handle 100px above its first point that sets the second point's price. */
const target: DrawingToolDef = {
  type: 'target',
  label: 'Target',
  points: 2,
  handles: (d) => [{ x: d.points[0]!.x, y: d.points[0]!.y - 100 }],
  moveHandle: (d, _i, to) => [d.points[0]!, { ...d.points[1]!, price: to.price + 100 }],
  render() {},
  hitTest: (d, p) => distToSegment(p, d.points[0]!, d.points[1]!) <= 6,
};

function click(m: DrawingManager, x: number, y: number) {
  m.pointerMove({ x, y });
  m.pointerDown(0, { x, y });
  m.pointerUp({ x, y });
}

const key = (k: string) => ({ key: k }) as KeyboardEvent;

describe('drawing tool contract', () => {
  it('validates point counts on register', () => {
    const { manager } = setup();
    expect(() => manager.register({ ...polyline, type: 'bad', points: 0 })).toThrow();
    expect(() => manager.register({ ...polyline, type: 'bad', points: 1.5 })).toThrow();
    expect(() => manager.register({ ...polyline, type: 'bad', points: 'x' as unknown as number })).toThrow();
  });

  it("places 'n' points until double click", () => {
    const { manager } = setup();
    manager.setTool('polyline');
    click(manager, 100, 400);
    click(manager, 200, 300);
    expect(manager.getAll()[0]?.points).toHaveLength(3); // two placed + preview
    click(manager, 300, 350);
    click(manager, 300, 350); // the second press of a double click
    expect(manager.doubleClick({ x: 300, y: 350 })).toBe(true);
    const [d] = manager.getAll();
    expect(d?.points.map((q) => q.time)).toEqual([540, 1140, 1740]);
    expect(d?.points[2]?.price).toBeCloseTo(150);
    expect(manager.tool).toBeNull();
    expect(manager.selected?.id).toBe(d?.id);
  });

  it("finishes 'n' points with Enter and cancels with fewer than two", () => {
    const { manager } = setup();
    manager.setTool('polyline');
    click(manager, 100, 400);
    click(manager, 200, 300);
    expect(manager.keyDown(key('Enter'))).toBe(true);
    expect(manager.getAll()[0]?.points).toHaveLength(2);

    manager.setTool('polyline');
    click(manager, 400, 400);
    manager.doubleClick({ x: 400, y: 400 });
    expect(manager.getAll()).toHaveLength(1);
  });

  it("records a 'free' stroke at exact times and drops plain clicks", () => {
    const { manager } = setup();
    manager.setTool('brush');
    manager.pointerDown(0, { x: 100, y: 400 });
    manager.pointerMove({ x: 101, y: 400 }); // under the 2px step
    manager.pointerMove({ x: 105, y: 390 });
    manager.pointerMove({ x: 115, y: 380 });
    manager.pointerUp({ x: 115, y: 380 });
    const [d] = manager.getAll();
    expect(d?.points.map((q) => q.time)).toEqual([540, 570, 630]);
    expect(manager.tool).toBeNull();

    manager.setTool('brush');
    manager.pointerDown(0, { x: 500, y: 100 });
    manager.pointerUp({ x: 500, y: 100 });
    expect(manager.getAll()).toHaveLength(1);
  });

  it('moves freehand strokes without snapping to bars', () => {
    const { manager } = setup();
    const d = manager.add({ type: 'brush', pane: 0, points: [{ time: 570, price: 100 }, { time: 600, price: 120 }], style: {} });
    manager.pointerDown(0, { x: 105, y: 400 });
    manager.pointerMove({ x: 108, y: 400 });
    manager.pointerUp({ x: 108, y: 400 });
    expect(manager.getAll().find((x) => x.id === d.id)!.points[0]!.time).toBeCloseTo(588);
  });

  it('applies constrain while placing and dragging anchors', () => {
    const { manager } = setup();
    manager.setTool('level');
    click(manager, 100, 400);
    click(manager, 300, 200);
    const [d] = manager.getAll();
    expect(d?.points.map((q) => Math.round(q.price))).toEqual([300, 300]);

    // Drag the first anchor (selected after creation): the second follows its price.
    manager.pointerDown(0, { x: 100, y: 200 });
    manager.pointerMove({ x: 100, y: 450 });
    manager.pointerUp({ x: 100, y: 450 });
    expect(manager.getAll()[0]?.points.map((q) => Math.round(q.price))).toEqual([50, 50]);
  });

  it('drags extra handles through moveHandle', () => {
    const { manager } = setup();
    const moveHandle = vi.spyOn(target, 'moveHandle');
    manager.setTool('target');
    click(manager, 100, 400);
    click(manager, 300, 400);
    expect(manager.cursor({ x: 100, y: 300 })).toBe('move');
    expect(manager.pointerDown(0, { x: 100, y: 300 })).toBe(true);
    manager.pointerMove({ x: 100, y: 250 });
    manager.pointerUp({ x: 100, y: 250 });
    expect(moveHandle).toHaveBeenCalled();
    const [a, b] = manager.getAll()[0]!.points;
    expect(a!.price).toBeCloseTo(100);
    expect(b!.price).toBeCloseTo(350);
  });

  it('keeps screen-anchored drawings fixed while the chart scrolls', () => {
    const { manager, time } = setup();
    manager.setTool('note');
    click(manager, 500, 250);
    expect(manager.getAll()[0]?.points[0]).toEqual({ time: 0.5, price: 0.5 });
    time.pan(200);
    manager.keyDown(key('Escape')); // deselect, so the drag below moves the body
    // Still hit at the same screen position after panning.
    expect(manager.cursor({ x: 500, y: 250 })).toBe('pointer');
    manager.pointerDown(0, { x: 500, y: 250 });
    manager.pointerMove({ x: 600, y: 300 });
    manager.pointerUp({ x: 600, y: 300 });
    const p = manager.getAll()[0]!.points[0]!;
    expect(p.time).toBeCloseTo(0.6);
    expect(p.price).toBeCloseTo(0.6);
  });

  it('gives tools coordinate helpers, bars and the pixel ratio', () => {
    const bars = [0, 60, 120, 180].map((t) => ({ time: t, open: 1, high: 2, low: 0, close: 1 }));
    const { manager } = setup(bars);
    let env: DrawingEnv | null = null;
    manager.register({ ...polyline, type: 'probe', points: 1, render: (_ctx, _d, e) => (env = e) });
    manager.add({ type: 'probe', pane: 0, points: [{ time: 0, price: 0 }], style: {} });
    const ctx = new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D;
    manager.render(ctx, 0, 1000, 500);
    const e = env as unknown as DrawingEnv;
    expect(e.pixelRatio).toBe(2);
    // Detached, as a tool may destructure it.
    const { bars: barsOf } = e;
    expect(barsOf(60, 120).map((b) => b.time)).toEqual([60, 120]);
    expect(e.timeToX(570)).toBeCloseTo(105);
    expect(e.xToTime(105)).toBeCloseTo(570);
    expect(e.yToPrice(e.priceToY(123))).toBeCloseTo(123);
  });
});

describe('render helpers', () => {
  /** Records path calls; everything else is a no-op. */
  function recorder() {
    const calls: [string, ...number[]][] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, name) => (name === 'calls' ? calls : (...args: number[]) => calls.push([String(name), ...args])),
        set: () => true,
      },
    ) as CanvasRenderingContext2D & { calls: typeof calls };
    return ctx;
  }
  const env = {
    width: 1000,
    height: 500,
    theme: darkTheme,
    measureText: (text: string) => text.length * 6,
  } as unknown as DrawingEnv;
  const screen = (style = {}) => ({
    drawing: { id: 'd', type: 't', pane: 0, points: [], style },
    points: [{ x: 300, y: 200 }, { x: 400, y: 300 }],
    selected: false,
    hovered: false,
  });

  it('strokeLine extends to the pane edges on request', () => {
    const plain = recorder();
    strokeLine(plain, screen(), env, { x: 400, y: 300 }, { x: 300, y: 200 });
    expect(plain.calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')).toEqual([
      ['moveTo', 300, 200],
      ['lineTo', 400, 300],
    ]);
    const both = recorder();
    strokeLine(both, screen({ extendLeft: true, extendRight: true }), env, { x: 300, y: 200 }, { x: 400, y: 300 });
    expect(both.calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')).toEqual([
      ['moveTo', 100, 0],
      ['lineTo', 600, 500],
    ]);
  });

  it('arrowHead draws one size, solid, kept to half a short shaft', () => {
    const dashes: number[][] = [];
    let pattern = [6, 4];
    const dashed = { getLineDash: () => pattern, setLineDash: (p: number[]) => dashes.push((pattern = p)) };
    const ctx = new Proxy(recorder(), {
      get: (t, name) => (name in dashed ? dashed[name as keyof typeof dashed] : Reflect.get(t, name)),
    });
    const legs = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      ctx.calls.length = 0;
      arrowHead(ctx, a, b);
      const start = ctx.calls.find((c) => c[0] === 'moveTo')!;
      return Math.hypot(start[1]! - b.x, start[2]! - b.y);
    };
    expect(legs({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(10);
    expect(legs({ x: 0, y: 0 }, { x: 0, y: 8 })).toBeCloseTo(4);
    expect(dashes.at(-2)).toEqual([]);
    expect(pattern).toEqual([6, 4]);
    ctx.calls.length = 0;
    arrowHead(ctx, { x: 5, y: 5 }, { x: 5, y: 5 });
    expect(ctx.calls).toEqual([]);
  });

  it('fillBetween traces the upper line forward and the lower line back', () => {
    const ctx = recorder();
    fillBetween(ctx, [{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 5 }, { x: 10, y: 5 }], 'red');
    expect(ctx.calls.map((c) => c.join())).toEqual(['beginPath', 'moveTo,0,0', 'lineTo,10,0', 'lineTo,10,5', 'lineTo,0,5', 'closePath', 'fill']);
  });

  it('labelPill aligns around x and returns its width', () => {
    const ctx = recorder();
    const w = labelPill(ctx, env, 'abc', 100, 50, { align: 'right' });
    expect(w).toBe(28);
    expect(ctx.calls.find((c) => c[0] === 'roundRect')?.[1]).toBe(72);
  });

  it('levelLines skips labels that would overlap', () => {
    const ctx = recorder();
    levelLines(ctx, env, [
      { y: 100, color: 'red', label: 'a' },
      { y: 105, color: 'red', label: 'b' },
      { y: 200, color: 'red', label: 'c' },
    ], 300, 600);
    expect(ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1])).toEqual(['a', 'c']);
  });

  it('labelledPolyline puts labels above peaks and below troughs', () => {
    const ctx = recorder();
    const d = { ...screen(), points: [{ x: 0, y: 100 }, { x: 50, y: 20 }, { x: 100, y: 120 }] };
    labelledPolyline(ctx, d, env, ['A', 'B', 'C']);
    const texts = ctx.calls.filter((c) => c[0] === 'fillText');
    const offset = darkTheme.fontSize + 2;
    expect(texts.map((c) => [c[1], c[3]])).toEqual([
      ['A', 100 + offset + 0.5],
      ['B', 20 - offset + 0.5],
      ['C', 120 + offset + 0.5],
    ]);
  });
});

/** Two screen-anchored points joined by a line. */
const box: DrawingToolDef = { ...polyline, type: 'box', label: 'Box', points: 2, anchoring: 'screen' };

describe('placement and history edge cases', () => {
  function stroke(m: DrawingManager) {
    m.pointerDown(0, { x: 100, y: 400 });
    m.pointerMove({ x: 110, y: 390 });
    m.pointerMove({ x: 120, y: 380 });
  }

  it('Escape cancels a freehand stroke in progress and keeps the tool', () => {
    const { manager } = setup();
    manager.setTool('brush');
    stroke(manager);
    expect(manager.keyDown(key('Escape'))).toBe(true);
    expect(manager.isBusy).toBe(false);
    manager.pointerMove({ x: 130, y: 370 });
    manager.pointerUp({ x: 130, y: 370 });
    expect(manager.getAll()).toEqual([]);
    expect(manager.canUndo).toBe(false);
    expect(manager.tool).toBe('brush');
  });

  it('switching tools cancels a freehand stroke in progress', () => {
    const { manager } = setup();
    manager.setTool('brush');
    stroke(manager);
    manager.setTool('polyline');
    manager.pointerUp({ x: 120, y: 380 });
    expect(manager.getAll()).toEqual([]);
    expect(manager.canUndo).toBe(false);
  });

  it('undo during a freehand stroke drops only the stroke', () => {
    const { manager } = setup();
    manager.add({ type: 'level', pane: 0, points: [{ time: 0, price: 100 }, { time: 60, price: 100 }], style: {} });
    manager.setTool('brush');
    stroke(manager);
    expect(manager.undo()).toBe(true);
    manager.pointerUp({ x: 120, y: 380 });
    expect(manager.getAll().map((d) => d.type)).toEqual(['level']);
    expect(manager.canUndo).toBe(true); // the add() step is still there
  });

  it('Escape and undo cancel multi-point placement without an undo step', () => {
    const { manager } = setup();
    manager.setTool('polyline');
    click(manager, 100, 400);
    click(manager, 200, 300);
    expect(manager.keyDown(key('Escape'))).toBe(true);
    expect(manager.getAll()).toEqual([]);
    expect(manager.tool).toBe('polyline');

    click(manager, 100, 400);
    click(manager, 200, 300);
    expect(manager.undo()).toBe(true);
    expect(manager.getAll()).toEqual([]);
    expect(manager.canUndo).toBe(false);

    // Placement starts over cleanly.
    click(manager, 100, 400);
    click(manager, 200, 300);
    manager.keyDown(key('Enter'));
    expect(manager.getAll()[0]?.points).toHaveLength(2);
  });

  it('a double click that moves between presses adds a single anchor', () => {
    const { manager } = setup();
    manager.setTool('polyline');
    click(manager, 100, 400);
    click(manager, 200, 300);
    click(manager, 300, 350);
    click(manager, 301, 349); // the second press of the double click, 1px off
    expect(manager.doubleClick({ x: 301, y: 349 })).toBe(true);
    const points = manager.getAll()[0]!.points;
    expect(points.map((q) => q.time)).toEqual([540, 1140, 1740]);
    expect(points[2]!.price).toBeCloseTo(150);
  });

  it('a double click after a single anchor cancels', () => {
    const { manager } = setup();
    manager.setTool('polyline');
    click(manager, 100, 400);
    click(manager, 101, 401);
    manager.doubleClick({ x: 101, y: 401 });
    expect(manager.getAll()).toEqual([]);
    expect(manager.canUndo).toBe(false);
  });

  it('records exactly one undo step per new drawing', () => {
    const { manager } = setup();
    manager.register(box);
    manager.setTool('polyline');
    click(manager, 100, 400);
    click(manager, 200, 300);
    click(manager, 300, 350);
    click(manager, 300, 350);
    manager.doubleClick({ x: 300, y: 350 });
    manager.setTool('level');
    manager.pointerDown(0, { x: 100, y: 200 }); // press-drag-release
    manager.pointerMove({ x: 200, y: 200 });
    manager.pointerUp({ x: 200, y: 200 });
    manager.setTool('brush');
    stroke(manager);
    manager.pointerUp({ x: 120, y: 380 });
    manager.setTool('note');
    click(manager, 500, 250);
    manager.setTool('box');
    click(manager, 100, 100);
    click(manager, 200, 200);
    expect(manager.getAll().map((d) => d.type)).toEqual(['polyline', 'level', 'brush', 'note', 'box']);

    for (const left of [4, 3, 2, 1, 0]) {
      expect(manager.undo()).toBe(true);
      expect(manager.getAll()).toHaveLength(left);
    }
    expect(manager.undo()).toBe(false);
  });

  it('keeps screen-anchored drawings on the pane while moving them', () => {
    const { manager } = setup();
    manager.register(box);
    const d = manager.add({ type: 'box', pane: 0, points: [{ time: 0.2, price: 0.2 }, { time: 0.6, price: 0.4 }], style: {} });
    // Drag the body far past the bottom right: it stops at the edges and keeps its shape.
    manager.pointerDown(0, { x: 400, y: 150 });
    manager.pointerMove({ x: 1400, y: 900 });
    let [a, b] = manager.getById(d.id)!.points;
    expect([a!.time, a!.price, b!.time, b!.price].map((v) => +v.toFixed(6))).toEqual([0.6, 0.8, 1, 1]);
    // Back past the top left, in the same gesture.
    manager.pointerMove({ x: -600, y: -400 });
    manager.pointerUp({ x: -600, y: -400 });
    [a, b] = manager.getById(d.id)!.points;
    expect([a!.time, a!.price, b!.time, b!.price].map((v) => +v.toFixed(6))).toEqual([0, 0, 0.4, 0.2]);
    expect(manager.canUndo).toBe(true);
  });

  it('keeps screen anchors on the pane while placing and dragging them', () => {
    const { manager } = setup();
    manager.register(box);
    manager.setTool('box');
    click(manager, 100, 100);
    click(manager, 1200, 700); // outside the 1000 x 500 pane
    const [, placed] = manager.getAll()[0]!.points;
    expect(placed).toEqual({ time: 1, price: 1 });

    // The drawing is selected after creation: drag its first anchor off the top left.
    manager.pointerDown(0, { x: 100, y: 100 });
    manager.pointerMove({ x: -50, y: -80 });
    manager.pointerUp({ x: -50, y: -80 });
    expect(manager.getAll()[0]!.points[0]).toEqual({ time: 0, price: 0 });
  });

  it('lets a screen-anchored drawing saved off the pane move back on', () => {
    const { manager } = setup();
    const d = manager.add({ type: 'note', pane: 0, points: [{ time: 1.2, price: 0.5 }], style: {} });
    manager.select(d.id);
    manager.select(null);
    // Drawn at x = 1200: hit there, then dragged left by 400px.
    manager.pointerDown(0, { x: 1200, y: 250 });
    manager.pointerMove({ x: 800, y: 250 });
    manager.pointerUp({ x: 800, y: 250 });
    expect(manager.getById(d.id)!.points[0]!.time).toBeCloseTo(0.8);
  });
});

describe('chart drawing host', () => {
  /** The `env.bars` a tool gets inside a real chart with hourly bars 0..9 (or none). */
  function chartBars(withSeries: boolean) {
    const c = new Chart(fakeContainer(), { timezone: 'UTC' });
    if (withSeries) {
      c.addCandles().setData(Array.from({ length: 10 }, (_, i) => ({ time: i * 3600, open: 1, high: 2, low: 0, close: 1 })));
    }
    let env: DrawingEnv | null = null;
    c.drawings.register({ ...note, type: 'probe', render: (_ctx, _d, e) => (env = e) });
    c.drawings.add({ type: 'probe', pane: 0, points: [{ time: 0.5, price: 0.5 }], style: {} });
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
    const e = env as DrawingEnv | null;
    c.destroy();
    if (!e) throw new Error('probe was not rendered');
    return (from: number, to: number) => e.bars(from, to).map((b) => b.time / 3600);
  }

  it('returns the main series bars in [from, to], both ends included', () => {
    const bars = chartBars(true);
    expect(bars(2 * 3600, 5 * 3600)).toEqual([2, 3, 4, 5]);
    expect(bars(2.5 * 3600, 5.5 * 3600)).toEqual([3, 4, 5]);
    expect(bars(4 * 3600, 4 * 3600)).toEqual([4]);
    expect(bars(-3600, 3600)).toEqual([0, 1]);
    expect(bars(8 * 3600, 99 * 3600)).toEqual([8, 9]);
    expect(bars(20 * 3600, 30 * 3600)).toEqual([]);
    expect(bars(5 * 3600, 2 * 3600)).toEqual([]);
  });

  it('returns no bars without a main series', () => {
    expect(chartBars(false)(0, 1e9)).toEqual([]);
  });
});
