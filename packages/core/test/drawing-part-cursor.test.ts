import { describe, expect, it, vi } from 'vitest';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import { distToSegment } from '../src/drawing/geometry';
import type { DrawingPart, DrawingToolDef } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import type { Point } from '../src/types';
import { withBuiltinTools } from './builtin-tools';

// The pane starts 100 px down: x = (index - 99) * 10 + 1000, time = index * 60, price = 500 - (y - 100).
function setup(tool: DrawingToolDef) {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = 100;
  const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  pane.top = 100;
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
  const manager = withBuiltinTools(new DrawingManager(host));
  manager.register(tool);
  return manager;
}

// A segment from (110, 500) to (210, 300) in plot space, with a handle 50 px above its first anchor.
const segment: DrawingToolDef = {
  type: 'segment',
  label: 'Segment',
  points: 2,
  render() {},
  handles: (d) => [{ x: d.points[0]!.x, y: d.points[0]!.y - 50 }],
  moveHandle: (d) => d.points,
  hitTest: (d, p) => distToSegment(p, d.points[0]!, d.points[1]!) <= 6,
};

const points = [
  { time: 600, price: 100 },
  { time: 1200, price: 300 },
];
const body: Point = { x: 160, y: 400 };
const anchor: Point = { x: 210, y: 300 };
const handle: Point = { x: 110, y: 450 };

describe('cursor per drawing part', () => {
  it('defaults to pointer on the drawing and move on anchors and handles', () => {
    const manager = setup(segment);
    const d = manager.add({ type: 'segment', pane: 0, points, style: {} });
    expect(manager.cursor(body)).toBe('pointer');
    // Anchors and handles count only while selected.
    expect(manager.cursor(handle)).toBeNull();
    manager.select(d.id);
    expect(manager.cursor(body)).toBe('pointer');
    expect(manager.cursor(anchor)).toBe('move');
    expect(manager.cursor(handle)).toBe('move');
  });

  it("asks the tool with the part and the pane-local point, and falls back when it returns nothing", () => {
    const parts: [DrawingPart, Point][] = [];
    const cursor = vi.fn((_d, part: DrawingPart, p: Point) => {
      parts.push([part, p]);
      return part.kind === 'anchor' ? 'nwse-resize' : part.kind === 'handle' ? 'ns-resize' : undefined;
    });
    const manager = setup({ ...segment, cursor });
    const d = manager.add({ type: 'segment', pane: 0, points, style: {} });
    manager.select(d.id);
    expect(manager.cursor(body)).toBe('pointer');
    expect(manager.cursor(anchor)).toBe('nwse-resize');
    expect(manager.cursor(handle)).toBe('ns-resize');
    expect(parts).toEqual([
      [{ kind: 'body' }, { x: 160, y: 300 }],
      [{ kind: 'anchor', index: 1 }, { x: 210, y: 200 }],
      [{ kind: 'handle', index: 0 }, { x: 110, y: 350 }],
    ]);
    expect(cursor.mock.calls[0]![0].drawing.id).toBe(d.id);
  });

  it('does not ask the tool while locked or dragging', () => {
    const cursor = vi.fn(() => 'ns-resize');
    const manager = setup({ ...segment, cursor });
    const d = manager.add({ type: 'segment', pane: 0, points, style: {}, locked: true });
    expect(manager.cursor(body)).toBe('pointer');
    manager.update(d.id, { locked: false });
    manager.setLocked(true);
    expect(manager.cursor(body)).toBe('pointer');
    expect(cursor).not.toHaveBeenCalled();
    manager.setLocked(false);
    expect(manager.cursor(body)).toBe('ns-resize');
    manager.pointerMove(body);
    manager.pointerDown(0, body);
    manager.pointerMove({ x: 170, y: 410 });
    expect(manager.cursor({ x: 170, y: 410 })).toBe('grabbing');
    manager.pointerUp({ x: 170, y: 410 });
  });

  it('shows a vertical resize cursor on horizontal lines and a horizontal one on vertical lines', () => {
    const manager = setup(segment);
    const h = manager.add({ type: 'hline', pane: 0, points: [{ time: 600, price: 100 }], style: {} });
    expect(manager.cursor({ x: 500, y: 500 })).toBe('ns-resize');
    manager.select(h.id);
    expect(manager.cursor({ x: 110, y: 500 })).toBe('ns-resize');
    manager.remove(h.id);
    manager.add({ type: 'vline', pane: 0, points: [{ time: 600, price: 100 }], style: {} });
    expect(manager.cursor({ x: 110, y: 200 })).toBe('ew-resize');
  });
});
