import { describe, expect, it } from 'vitest';
import { distToSegment, pointInRect, rayEnd } from '../src/drawing/geometry';
import { DrawingManager, parseSerialized, type DrawingEvents, type DrawingHost } from '../src/drawing/manager';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { withBuiltinTools } from './builtin-tools';

describe('geometry', () => {
  it('distance to segment', () => {
    expect(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(Math.SQRT2);
  });

  it('extends a ray to the viewport edge', () => {
    expect(rayEnd({ x: 0, y: 0 }, { x: 10, y: 5 }, 100, 100)).toEqual({ x: 100, y: 50 });
    expect(rayEnd({ x: 50, y: 50 }, { x: 50, y: 40 }, 100, 100)).toEqual({ x: 50, y: 0 });
  });

  it('point in rect with tolerance', () => {
    expect(pointInRect({ x: 5, y: 5 }, { x: 10, y: 10 }, { x: 0, y: 0 })).toBe(true);
    expect(pointInRect({ x: 12, y: 5 }, { x: 10, y: 10 }, { x: 0, y: 0 }, 3)).toBe(true);
    expect(pointInRect({ x: 14, y: 5 }, { x: 10, y: 10 }, { x: 0, y: 0 }, 3)).toBe(false);
  });
});

function setup(roundPrice?: DrawingHost['roundPrice']) {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = 100;
  const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  pane.height = 500;
  pane.price.height = 500;
  pane.price.fit(0, 500);
  const events: { name: keyof DrawingEvents; payload: unknown }[] = [];
  const host: DrawingHost = {
    theme: darkTheme,
    timeline,
    time,
    panes: [pane],
    magnetPrice: (_i, price) => Math.round(price / 100) * 100,
    formatPrice: (_p, price) => price.toFixed(2),
    requestOverlay: () => {},
    editText: (_at, _initial, done) => done('Hello'),
    emit: (name, payload) => events.push({ name, payload }),
    roundPrice,
  };
  return { manager: withBuiltinTools(new DrawingManager(host)), events, time, pane };
}

describe('DrawingManager', () => {
  it('snaps drawing points to the price format tick size', () => {
    const { manager } = setup((_pane, price) => Math.round(price / 25) * 25);
    manager.setTool('hline');
    manager.pointerDown(0, { x: 100, y: 190 });
    manager.pointerUp({ x: 100, y: 190 });
    const [d] = manager.getAll();
    // y 190 of 500 on a 0-500 scale is price 310; the nearest tick of 25 is 300.
    expect(d!.points[0]!.price).toBe(300);
  });

  it('creates, drags and round-trips the extra line tools', () => {
    const { manager } = setup();
    for (const type of ['horizontal-ray', 'cross-line']) {
      manager.setTool(type);
      manager.pointerDown(0, { x: 100, y: 400 });
      manager.pointerUp({ x: 100, y: 400 });
    }
    for (const type of ['extended-line', 'info-line']) {
      manager.setTool(type);
      manager.pointerDown(0, { x: 100, y: 400 });
      manager.pointerUp({ x: 100, y: 400 });
      manager.pointerMove({ x: 300, y: 200 });
      manager.pointerDown(0, { x: 300, y: 200 });
      manager.pointerUp({ x: 300, y: 200 });
    }
    const all = manager.getAll();
    expect(all.map((d) => [d.type, d.points.length])).toEqual([
      ['horizontal-ray', 1],
      ['cross-line', 1],
      ['extended-line', 2],
      ['info-line', 2],
    ]);
    // Drag the info line's second anchor.
    manager.select(all[3]!.id);
    expect(manager.pointerDown(0, { x: 300, y: 200 })).toBe(true);
    manager.pointerMove({ x: 400, y: 100 });
    manager.pointerUp({ x: 400, y: 100 });
    expect(manager.getAll()[3]!.points[1]!.price).toBeCloseTo(400);
    const saved = manager.serialize();
    expect(parseSerialized(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it('creates a trend line by click-move-click and resets the tool', () => {
    const { manager } = setup();
    manager.setTool('trendline');
    expect(manager.pointerDown(0, { x: 100, y: 400 })).toBe(true);
    manager.pointerUp({ x: 100, y: 400 });
    manager.pointerMove({ x: 300, y: 200 });
    manager.pointerDown(0, { x: 300, y: 200 });
    manager.pointerUp({ x: 300, y: 200 });
    const [d] = manager.getAll();
    expect(d?.type).toBe('trendline');
    expect(d?.points).toHaveLength(2);
    // x=100 → index 0 + (100-1000)/10 + 99 = 9 → time 540; y=400 → price 100.
    expect(d?.points[0]).toEqual({ time: 540, price: expect.closeTo(100) });
    expect(d?.points[1]).toEqual({ time: 1740, price: expect.closeTo(300) });
    expect(manager.tool).toBeNull();
    expect(manager.selected?.id).toBe(d?.id);
  });

  it('creates by press-drag-release', () => {
    const { manager } = setup();
    manager.setTool('rectangle');
    manager.pointerDown(0, { x: 100, y: 100 });
    manager.pointerMove({ x: 200, y: 200 });
    manager.pointerUp({ x: 200, y: 200 });
    expect(manager.getAll()[0]?.points[1]).toEqual({ time: 1140, price: expect.closeTo(300) });
  });

  it('applies magnet snapping on creation', () => {
    const { manager } = setup();
    manager.setMagnet(true);
    manager.setTool('hline');
    manager.pointerDown(0, { x: 500, y: 260 });
    expect(manager.getAll()[0]?.points[0]?.price).toBe(200);
  });

  it('moves a drawing by dragging its body', () => {
    const { manager } = setup();
    const d = manager.add({ type: 'hline', pane: 0, points: [{ time: 3000, price: 250 }], style: {} });
    expect(manager.pointerDown(0, { x: 500, y: 250 })).toBe(true);
    manager.pointerMove({ x: 520, y: 200 });
    manager.pointerUp({ x: 520, y: 200 });
    const moved = manager.getAll().find((x) => x.id === d.id)!;
    expect(moved.points[0]!.price).toBeCloseTo(300);
    expect(moved.points[0]!.time).toBe(3000 + 2 * 60);
  });

  it('moves a drawing by a price ratio on a log scale', () => {
    const { manager, pane } = setup();
    pane.price.setMode('log');
    pane.price.fit(10, 1000);
    // y=0 → 1000, y=250 → 100, y=500 → 10: every 250px is a 10x ratio.
    const points = [{ time: 3000, price: 100 }, { time: 3600, price: 1000 }];
    const d = manager.add({ type: 'trendline', pane: 0, points, style: {} });
    expect(manager.pointerDown(0, { x: 560, y: 125 })).toBe(true);
    manager.pointerMove({ x: 560, y: 175 });
    manager.pointerUp({ x: 560, y: 175 });
    const [a, b] = manager.getAll().find((x) => x.id === d.id)!.points;
    expect(b!.price / a!.price).toBeCloseTo(10);
    // Both ends moved down 50px, so the on-screen shape is unchanged.
    expect(pane.price.priceToY(a!.price)).toBeCloseTo(300);
    expect(pane.price.priceToY(b!.price)).toBeCloseTo(50);
  });

  it('keeps moves additive on a percent scale', () => {
    const { manager, pane } = setup();
    pane.price.setMode('percent');
    const points = [{ time: 3000, price: 100 }, { time: 3600, price: 300 }];
    const d = manager.add({ type: 'trendline', pane: 0, points, style: {} });
    manager.pointerDown(0, { x: 560, y: 300 });
    manager.pointerMove({ x: 560, y: 250 });
    manager.pointerUp({ x: 560, y: 250 });
    const [a, b] = manager.getAll().find((x) => x.id === d.id)!.points;
    expect(a!.price).toBeCloseTo(150);
    expect(b!.price).toBeCloseTo(350);
  });

  it('locked drawings select but do not move', () => {
    const { manager } = setup();
    manager.add({ type: 'hline', pane: 0, points: [{ time: 3000, price: 250 }], style: {} });
    manager.setLocked(true);
    manager.pointerDown(0, { x: 500, y: 250 });
    expect(manager.pointerMove({ x: 500, y: 100 })).toBe(false);
    expect(manager.getAll()[0]!.points[0]!.price).toBe(250);
  });

  it('misses empty space and lets the chart pan', () => {
    const { manager } = setup();
    manager.add({ type: 'hline', pane: 0, points: [{ time: 3000, price: 250 }], style: {} });
    expect(manager.pointerDown(0, { x: 500, y: 50 })).toBe(false);
  });

  it('deletes the selection and escape cancels creation', () => {
    const { manager } = setup();
    manager.add({ type: 'hline', pane: 0, points: [{ time: 3000, price: 250 }], style: {} });
    manager.pointerDown(0, { x: 500, y: 250 });
    manager.pointerUp({ x: 500, y: 250 });
    expect(manager.deleteSelection()).toBe(true);
    expect(manager.getAll()).toHaveLength(0);

    manager.setTool('trendline');
    manager.pointerDown(0, { x: 100, y: 100 });
    manager.keyDown(key('Escape'));
    expect(manager.getAll()).toHaveLength(0);
  });

  it('prompts for text on text tools and drops empty text', () => {
    const { manager } = setup();
    manager.setTool('text');
    manager.pointerDown(0, { x: 100, y: 100 });
    expect(manager.getAll()[0]?.text).toBe('Hello');
  });

  it('emits change events and round-trips serialization', () => {
    const { manager, events } = setup();
    manager.add({ type: 'ray', pane: 0, points: [{ time: 0, price: 1 }, { time: 60, price: 2 }], style: { color: '#fff' } });
    expect(events.some((e) => e.name === 'drawings:change')).toBe(true);
    const json = JSON.parse(JSON.stringify(manager.serialize()));
    const other = setup().manager;
    other.load(json);
    expect(other.getAll()).toEqual(manager.getAll());
  });

  it('rejects unknown tools and malformed payloads', () => {
    const { manager } = setup();
    expect(() => manager.setTool('nope')).toThrow();
    expect(() => parseSerialized({ version: 2, drawings: [] })).toThrow();
    expect(() => parseSerialized({ version: 1, drawings: [{ id: 'x', type: 'ray', pane: 0, points: [{ time: 'a' }] }] })).toThrow();
  });
});

describe('DrawingManager history', () => {
  const hline = { type: 'hline', pane: 0, points: [{ time: 3000, price: 250 }], style: {} };
  // Trend line from index 10 (x=110) at price 100 (y=400) to index 30 (x=310) at price 300 (y=200).
  const trend = { type: 'trendline', pane: 0, points: [{ time: 600, price: 100 }, { time: 1800, price: 300 }], style: {} };

  it('undoes and redoes a click-move-click creation as one step', () => {
    const { manager } = setup();
    manager.setTool('trendline');
    manager.pointerDown(0, { x: 100, y: 400 });
    manager.pointerUp({ x: 100, y: 400 });
    manager.pointerMove({ x: 200, y: 300 });
    manager.pointerMove({ x: 300, y: 200 });
    manager.pointerDown(0, { x: 300, y: 200 });
    manager.pointerUp({ x: 300, y: 200 });
    const created = manager.getAll();
    expect(created).toHaveLength(1);

    expect(manager.undo()).toBe(true);
    expect(manager.getAll()).toEqual([]);
    expect(manager.selected).toBeNull();
    expect(manager.canUndo).toBe(false);
    expect(manager.canRedo).toBe(true);

    expect(manager.redo()).toBe(true);
    expect(manager.getAll()).toEqual(created);
    expect(manager.canRedo).toBe(false);
  });

  it('records a press-drag-release creation and a text drawing as one step each', () => {
    const { manager } = setup();
    manager.setTool('rectangle');
    manager.pointerDown(0, { x: 100, y: 100 });
    manager.pointerMove({ x: 150, y: 150 });
    manager.pointerMove({ x: 200, y: 200 });
    manager.pointerUp({ x: 200, y: 200 });
    manager.setTool('text');
    manager.pointerDown(0, { x: 400, y: 100 });
    expect(manager.getAll().map((d) => d.type)).toEqual(['rectangle', 'text']);

    manager.undo();
    expect(manager.getAll().map((d) => d.type)).toEqual(['rectangle']);
    manager.undo();
    expect(manager.getAll()).toEqual([]);
    expect(manager.canUndo).toBe(false);
  });

  it('coalesces a body drag into one step', () => {
    const { manager } = setup();
    const d = manager.add(hline);
    manager.pointerDown(0, { x: 500, y: 250 });
    for (let y = 245; y >= 200; y -= 5) manager.pointerMove({ x: 520, y });
    manager.pointerUp({ x: 520, y: 200 });
    expect(manager.getAll()[0]!.points[0]!.price).toBeCloseTo(300);

    manager.undo();
    expect(manager.getAll()).toEqual([d]);
    expect(manager.selected?.id).toBe(d.id);
    manager.undo();
    expect(manager.getAll()).toEqual([]);
    expect(manager.canUndo).toBe(false);
  });

  it('coalesces an anchor drag into one step', () => {
    const { manager } = setup();
    const d = manager.add(trend);
    manager.pointerDown(0, { x: 210, y: 300 });
    manager.pointerUp({ x: 210, y: 300 });
    manager.pointerDown(0, { x: 310, y: 200 });
    manager.pointerMove({ x: 360, y: 150 });
    manager.pointerMove({ x: 410, y: 100 });
    manager.pointerUp({ x: 410, y: 100 });
    expect(manager.getAll()[0]!.points[1]).toEqual({ time: 2400, price: expect.closeTo(400) });

    manager.undo();
    expect(manager.getAll()).toEqual([d]);
    manager.undo();
    expect(manager.canUndo).toBe(false);
  });

  it('adds no step for a click that only selects', () => {
    const { manager, events } = setup();
    manager.add(hline);
    manager.pointerDown(0, { x: 500, y: 250 });
    manager.pointerUp({ x: 500, y: 250 });
    expect(events.filter((e) => e.name === 'history:change')).toHaveLength(1);
    manager.undo();
    expect(manager.canUndo).toBe(false);
  });

  it('undoes text, style and lock edits', () => {
    const { manager } = setup();
    // Editable tool whose hit test needs no canvas text metrics.
    manager.register({
      type: 'note',
      label: 'Note',
      points: 1,
      editableText: true,
      render: () => {},
      hitTest: (d, p) => Math.hypot(d.points[0]!.x - p.x, d.points[0]!.y - p.y) < 5,
    });
    const d = manager.add({ type: 'note', pane: 0, points: [{ time: 3000, price: 250 }], style: { color: '#fff' }, text: 'Old' });
    expect(manager.doubleClick({ x: 510, y: 250 })).toBe(true);
    manager.update(d.id, { style: { color: '#f00', lineWidth: 2 } });
    manager.update(d.id, { locked: true });
    expect(manager.getAll()[0]).toMatchObject({ text: 'Hello', style: { color: '#f00', lineWidth: 2 }, locked: true });

    manager.undo();
    expect(manager.getAll()[0]!.locked).toBeUndefined();
    manager.undo();
    expect(manager.getAll()[0]!.style).toEqual({ color: '#fff' });
    manager.undo();
    expect(manager.getAll()[0]!.text).toBe('Old');
    manager.redo();
    manager.redo();
    manager.redo();
    expect(manager.getAll()[0]).toMatchObject({ text: 'Hello', style: { color: '#f00', lineWidth: 2 }, locked: true });
  });

  it('undoes delete and clear', () => {
    const { manager } = setup();
    const a = manager.add(hline);
    const b = manager.add(trend);
    manager.remove(a.id);
    manager.clear();
    expect(manager.getAll()).toEqual([]);

    manager.undo();
    expect(manager.getAll()).toEqual([b]);
    manager.undo();
    expect(manager.getAll()).toEqual([a, b]);
  });

  it('drops the redo branch on a new change', () => {
    const { manager } = setup();
    manager.add(hline);
    manager.undo();
    expect(manager.canRedo).toBe(true);
    manager.add(trend);
    expect(manager.canRedo).toBe(false);
    expect(manager.redo()).toBe(false);
  });

  it('keeps the selection only while the selected drawing exists', () => {
    const { manager } = setup();
    const d = manager.add(hline);
    manager.pointerDown(0, { x: 500, y: 250 });
    manager.pointerUp({ x: 500, y: 250 });
    manager.update(d.id, { style: { color: '#f00' } });
    manager.undo();
    expect(manager.selected?.id).toBe(d.id);
    manager.undo();
    expect(manager.selected).toBeNull();
  });

  it('cancels an unfinished gesture instead of stepping back', () => {
    const { manager } = setup();
    const d = manager.add(hline);
    manager.setTool('trendline');
    manager.pointerDown(0, { x: 100, y: 400 });
    manager.pointerUp({ x: 100, y: 400 });
    manager.pointerMove({ x: 300, y: 200 });
    expect(manager.undo()).toBe(true);
    expect(manager.getAll()).toEqual([d]);
    expect(manager.isBusy).toBe(false);

    manager.setTool(null);
    manager.pointerDown(0, { x: 500, y: 250 });
    manager.pointerMove({ x: 500, y: 100 });
    expect(manager.undo()).toBe(true);
    expect(manager.getAll()).toEqual([d]);
    manager.pointerUp({ x: 500, y: 100 });
    expect(manager.getAll()).toEqual([d]);
    expect(manager.undo()).toBe(true);
    expect(manager.getAll()).toEqual([]);
  });

  it('caps the history length', () => {
    const { manager } = setup();
    const d = manager.add(hline);
    for (let i = 1; i <= 150; i++) manager.update(d.id, { points: [{ time: 3000, price: 250 + i }] });
    let steps = 0;
    while (manager.undo()) steps++;
    expect(steps).toBe(100);
    expect(manager.getAll()[0]!.points[0]!.price).toBe(300);
  });

  it('starts a fresh history on load and emits history changes', () => {
    const { manager, events } = setup();
    manager.add(hline);
    manager.undo();
    const history = events.filter((e) => e.name === 'history:change').map((e) => e.payload);
    expect(history).toEqual([
      { canUndo: true, canRedo: false },
      { canUndo: false, canRedo: true },
    ]);

    manager.load({ version: 1, drawings: [{ id: 'x', ...trend }] });
    expect(manager.canUndo).toBe(false);
    expect(manager.canRedo).toBe(false);
    expect(events.at(-1)?.name).toBe('drawings:change');
    expect(manager.undo()).toBe(false);
    expect(manager.getAll()).toHaveLength(1);
  });

});

type Modifiers = Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>>;

/** Manager only reads `key` and modifiers; avoids needing a DOM in tests. */
function key(k: string, modifiers: Modifiers = {}): KeyboardEvent {
  return { key: k, ...modifiers } as KeyboardEvent;
}
