import { describe, expect, it, vi } from 'vitest';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import { patternTools } from '../src/drawing/pattern-tools';
import { builtinTools } from '../src/drawing/tools';
import type { DrawingEnv, DrawingStyle, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale, type PriceScaleMode } from '../src/scales';
import { darkTheme, lightTheme } from '../src/theme';
import { Timeline } from '../src/timeline';
import type { Point } from '../src/types';
import { withBuiltinTools } from './builtin-tools';

const expected = [
  ['elliott-correction', ['A', 'B', 'C']],
  ['elliott-double-combo', ['W', 'X', 'Y']],
  ['abcd', ['A', 'B', 'C', 'D']],
  ['triangle-pattern', ['A', 'B', 'C', 'D']],
  ['cypher', ['X', 'A', 'B', 'C', 'D']],
  ['elliott-triangle', ['A', 'B', 'C', 'D', 'E']],
  ['elliott-triple-combo', ['W', 'X', 'Y', 'X', 'Z']],
  ['xabcd', ['X', 'A', 'B', 'C', 'D']],
  ['elliott-impulse', ['0', '1', '2', '3', '4', '5']],
  ['head-shoulders', ['', 'Left shoulder', '', 'Head', '', 'Right shoulder', '']],
  ['three-drives', ['0', '1', 'A', '2', 'B', '3', 'C']],
] as const;

const env = (theme = darkTheme): DrawingEnv => ({
  width: 1000, height: 500, theme, pixelRatio: 1,
  formatPrice: String,
  priceToY: (price) => 500 - price, yToPrice: (y) => 500 - y,
  timeToX: (time) => time / 6, xToTime: (x) => x * 6,
  barsBetween: () => 0, bars: () => [],
  measureText: (text, size) => text.length * size * 0.6,
});

const anchors = (count: number): Point[] => Array.from({ length: count }, (_, i) => ({ x: 100 + i * 60, y: i % 2 ? 220 : 300 }));
const screen = (type: string, points: Point[], style: DrawingStyle = {}): ScreenDrawing => ({
  drawing: { id: 'x', type, pane: 0, points: points.map((p) => ({ time: p.x * 6, price: 500 - p.y })), style },
  points, selected: false, hovered: false,
});

function recorder() {
  const fillText = vi.fn();
  const moveTo = vi.fn();
  const lineTo = vi.fn();
  const ctx = new Proxy({ fillText, moveTo, lineTo } as Record<string, unknown>, {
    get: (target, key) => target[key as string] ?? (() => {}),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, fillText, moveTo, lineTo };
}

function setup(mode: PriceScaleMode = 'normal') {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = 100;
  const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  pane.height = pane.price.height = 500;
  pane.price.setMode(mode);
  pane.price.percentBase = 200;
  pane.price.fit(100, 500);
  const host: DrawingHost = {
    theme: darkTheme, timeline, time, panes: [pane],
    magnetPrice: (_i, price) => price,
    formatPrice: (_pane, price) => price.toFixed(2),
    requestOverlay() {}, editText: (_at, _initial, done) => done(null), emit() {},
  };
  return { manager: withBuiltinTools(new DrawingManager(host)), pane };
}

function click(manager: DrawingManager, p: Point) {
  manager.pointerMove(p);
  manager.pointerDown(0, p);
  manager.pointerUp(p);
}

it('registers every pattern and wave in the patterns rail group', () => {
  expect(builtinTools.filter((t) => t.group === 'patterns')).toEqual(patternTools);
  expect(patternTools.map((t) => [t.type, t.points])).toEqual(expected.map(([type, labels]) => [type, labels.length]));
});

describe.each(expected)('%s', (type, labels) => {
  const tool = patternTools.find((t) => t.type === type)!;

  it('draws each segment and its labels in both themes, including a one-point preview', () => {
    for (const theme of [darkTheme, lightTheme]) {
      const points = anchors(labels.length);
      const r = recorder();
      tool.render(r.ctx, screen(type, points), env(theme));
      expect(r.moveTo.mock.calls).toEqual([[points[0]!.x, points[0]!.y]]);
      expect(r.lineTo.mock.calls).toEqual(points.slice(1).map((p) => [p.x, p.y]));
      expect(r.fillText.mock.calls.map(([text]) => text)).toEqual(labels.filter(Boolean));
      const preview = recorder();
      tool.render(preview.ctx, screen(type, points.slice(0, 1)), env(theme));
      expect(preview.lineTo).not.toHaveBeenCalled();
      expect(tool.hitTest(screen(type, points.slice(0, 1)), points[0]!, env(theme))).toBe(false);
    }
  });

  it('hits every segment, including coincident points, and misses distant points', () => {
    const points = anchors(labels.length);
    const d = screen(type, points);
    points.slice(1).forEach((p, i) => {
      const a = points[i]!;
      expect(tool.hitTest(d, { x: (a.x + p.x) / 2 + 2, y: (a.y + p.y) / 2 }, env())).toBe(true);
    });
    expect(tool.hitTest(d, { x: 800, y: 50 }, env())).toBe(false);
    expect(tool.hitTest(screen(type, [points[0]!, points[0]!]), points[0]!, env())).toBe(true);
  });

  it('honors text style and hides labels without hiding the line', () => {
    const points = anchors(labels.length);
    const r = recorder();
    tool.render(r.ctx, screen(type, points, { fontSize: 24, bold: true, italic: true, textColor: '#123456' }), env());
    expect(r.ctx.font).toBe(`italic bold 24px ${darkTheme.fontFamily}`);
    expect(r.ctx.fillStyle).toBe('#123456');
    const hidden = recorder();
    const d = screen(type, points, { showLabel: false });
    tool.render(hidden.ctx, d, env());
    expect(hidden.fillText).not.toHaveBeenCalled();
    expect(hidden.lineTo).toHaveBeenCalledTimes(points.length - 1);
    expect(tool.bounds!(d, env())).toBeNull();
  });

  it.each(['normal', 'log', 'percent'] as const)('places, edits, saves and undoes on a %s scale', (mode) => {
    const { manager, pane } = setup(mode);
    const points = anchors(labels.length);
    manager.setTool(type);
    points.forEach((p, i) => {
      click(manager, p);
      expect(manager.tool).toBe(i === points.length - 1 ? null : type);
    });
    const saved = manager.serialize();
    const drawing = saved.drawings[0]!;
    expect(drawing.points).toHaveLength(labels.length);
    points.forEach((p, i) => {
      expect(drawing.points[i]!.time).toBe((p.x - 10) * 6);
      expect(pane.price.priceToY(drawing.points[i]!.price)).toBeCloseTo(p.y);
    });
    expect(manager.selected?.id).toBe(drawing.id);
    const moved = { x: points[1]!.x + 20, y: points[1]!.y - 20 };
    manager.pointerDown(0, points[1]!);
    manager.pointerMove(moved);
    manager.pointerUp(moved);
    const edited = manager.getAll()[0]!.points;
    expect(edited[1]!.time).toBe((moved.x - 10) * 6);
    expect(pane.price.priceToY(edited[1]!.price)).toBeCloseTo(moved.y);
    expect(edited.filter((_p, i) => i !== 1)).toEqual(drawing.points.filter((_p, i) => i !== 1));
    expect(manager.undo()).toBe(true);
    expect(manager.serialize()).toEqual(saved);
    expect(manager.undo()).toBe(true);
    expect(manager.getAll()).toEqual([]);
    expect(manager.redo()).toBe(true);
    expect(manager.serialize()).toEqual(saved);
    const copy = setup(mode).manager;
    expect(copy.load(JSON.parse(JSON.stringify(saved)))).toEqual({ loaded: 1, errors: [] });
    expect(copy.serialize()).toEqual(saved);
  });
});

it('includes large labels beyond the anchors in selection and culling bounds', () => {
  const tool = patternTools.find((t) => t.type === 'head-shoulders')!;
  const d = screen(tool.type, anchors(7), { fontSize: 80 });
  const bounds = tool.bounds!(d, env())!;
  // Right shoulder's label is wider than the distance to the final anchor.
  const halfWidth = (env().measureText('Right shoulder', 80) + 10) / 2;
  expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(d.points[5]!.x + halfWidth);
  expect(bounds.y).toBeLessThan(100);
  expect(bounds.y + bounds.height).toBeGreaterThan(400);
});
