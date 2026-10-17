import { describe, expect, it } from 'vitest';
import { DrawingManager, type DrawingEvents, type DrawingHost } from '../src/drawing/manager';
import type { DrawingPoint } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { withBuiltinTools } from './builtin-tools';

// x = (index - 99) * 10 + 1000, time = index * 60.
// Pane 0: y 0..500, price = 500 - y. Pane 1: y 500..700, price = (700 - y) / 2.
function setup() {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = 100;
  const main = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  main.height = 500;
  main.price.height = 500;
  main.price.fit(0, 500);
  const lower = new Pane(1, { stretch: 1, marginTop: 0, marginBottom: 0 });
  lower.top = 500;
  lower.height = 200;
  lower.price.height = 200;
  lower.price.fit(0, 100);
  const events: { name: keyof DrawingEvents; payload: unknown }[] = [];
  const host: DrawingHost = {
    theme: darkTheme,
    timeline,
    time,
    panes: [main, lower],
    magnetPrice: (_i, price) => price,
    formatPrice: (_p, price) => price.toFixed(2),
    requestOverlay: () => {},
    editText: (_at, _initial, done) => done(null),
    emit: (name, payload) => events.push({ name, payload }),
  };
  const manager = withBuiltinTools(new DrawingManager(host));
  const panes = host.panes as Pane[];
  const of = (name: keyof DrawingEvents) => events.filter((e) => e.name === name).map((e) => e.payload);
  return { manager, main, panes, of };
}

const pts = (...pairs: [number, number][]): DrawingPoint[] => pairs.map(([time, price]) => ({ time, price }));

/** A trend line from (x 100, y 400) to (x 300, y 200) in pane 0, shifted by `dx` px and `dy` price. */
function line(dx = 0, dy = 0) {
  return { type: 'trendline', pane: 0, points: pts([540 + dx * 6, 100 + dy], [1740 + dx * 6, 300 + dy]), style: {} };
}

function drag(m: DrawingManager, from: [number, number], to: [number, number], shift = false) {
  const taken = m.pointerDown(0, { x: from[0], y: from[1] }, { shift });
  m.pointerMove({ x: to[0], y: to[1] });
  m.pointerUp({ x: to[0], y: to[1] });
  return taken;
}

const click = (m: DrawingManager, x: number, y: number, shift = false) => drag(m, [x, y], [x, y], shift);
const pointsOf = (m: DrawingManager, id: string) => m.getById(id)!.points;

describe('multi-select', () => {
  it('adds and removes drawings with shift-click, the last one being `selected`', () => {
    const { manager, of } = setup();
    const a = manager.add(line());
    const b = manager.add(line(400));
    click(manager, 200, 300);
    click(manager, 600, 300, true);
    expect(manager.selection).toEqual([a.id, b.id]);
    expect(manager.selected?.id).toBe(b.id);
    click(manager, 600, 300, true);
    expect(manager.selection).toEqual([a.id]);
    expect(of('drawing:select')).toEqual([
      { id: a.id, ids: [a.id] },
      { id: b.id, ids: [a.id, b.id] },
      { id: a.id, ids: [a.id] },
    ]);
  });

  it('a plain click on one of several selected drawings leaves only it selected', () => {
    const { manager } = setup();
    const a = manager.add(line());
    const b = manager.add(line(400));
    manager.setSelection([a.id, b.id]);
    click(manager, 200, 300);
    expect(manager.selection).toEqual([a.id]);
  });

  it('a click on empty space clears the whole selection', () => {
    const { manager } = setup();
    const a = manager.add(line());
    const b = manager.add(line(400));
    manager.setSelection([a.id, b.id]);
    expect(click(manager, 900, 50)).toBe(false);
    expect(manager.selection).toEqual([]);
  });

  it('setSelection leaves out unknown, hidden, unselectable and repeated ids', () => {
    const { manager } = setup();
    const a = manager.add(line());
    const hidden = manager.add({ ...line(100), hidden: true });
    const fixed = manager.add({ ...line(200), selectable: false });
    manager.setSelection([a.id, 'nope', hidden.id, fixed.id, a.id]);
    expect(manager.selection).toEqual([a.id]);
    expect(() => manager.setSelection('x' as unknown as string[])).toThrow();
  });

  it('drops drawings hidden or removed from the selection, keeping the rest', () => {
    const { manager } = setup();
    const a = manager.add(line());
    const b = manager.add(line(400));
    const c = manager.add(line(600));
    manager.setSelection([a.id, b.id, c.id]);
    manager.setVisible(b.id, false);
    manager.remove(c.id);
    expect(manager.selection).toEqual([a.id]);
  });

  it('labels no axis marks while several drawings are selected', () => {
    const { manager } = setup();
    const a = manager.add(line());
    const b = manager.add(line(400));
    manager.setSelection([a.id, b.id]);
    expect(manager.axisMarks()).toBeNull();
    manager.setSelection([b.id]);
    expect(manager.axisMarks()?.id).toBe(b.id);
  });
});

describe('group moves', () => {
  it('moves every selected drawing by the same bars and price, as one undo step', () => {
    const { manager, of } = setup();
    const a = manager.add(line());
    const b = manager.add(line(400));
    manager.setSelection([a.id, b.id]);
    const changes = of('drawings:change').length;
    drag(manager, [200, 300], [250, 250]);
    expect(pointsOf(manager, a.id)).toEqual(pts([840, 150], [2040, 350]));
    expect(pointsOf(manager, b.id)).toEqual(pts([3240, 150], [4440, 350]));
    expect(manager.selection).toEqual([a.id, b.id]);
    expect(of('drawings:change').length).toBe(changes + 1);
    manager.undo();
    expect(pointsOf(manager, a.id)).toEqual(line().points);
    expect(pointsOf(manager, b.id)).toEqual(line(400).points);
    expect(manager.canUndo).toBe(true);
    manager.undo();
    manager.undo();
    expect(manager.canUndo).toBe(false);
  });

  it('reports every moving drawing in progress', () => {
    const { manager, of } = setup();
    const a = manager.add(line());
    const b = manager.add(line(400));
    manager.setSelection([a.id, b.id]);
    manager.pointerDown(0, { x: 200, y: 300 });
    manager.pointerMove({ x: 220, y: 300 });
    expect(of('drawing:update-progress')).toEqual([{ id: a.id }, { id: b.id }]);
    manager.pointerUp({ x: 220, y: 300 });
  });

  it('leaves locked selected drawings in place', () => {
    const { manager } = setup();
    const a = manager.add(line());
    const b = manager.add({ ...line(400), locked: true });
    manager.setSelection([a.id, b.id]);
    drag(manager, [200, 300], [250, 300]);
    expect(pointsOf(manager, a.id)[0]!.time).toBe(840);
    expect(pointsOf(manager, b.id)).toEqual(line(400).points);
  });

  it('moves a drawing in another pane by the same height on its own scale', () => {
    const { manager } = setup();
    const a = manager.add(line());
    const b = manager.add({ type: 'trendline', pane: 1, points: pts([540, 20], [1740, 60]), style: {} });
    manager.setSelection([a.id, b.id]);
    drag(manager, [200, 300], [200, 250]);
    expect(pointsOf(manager, a.id)).toEqual(pts([540, 150], [1740, 350]));
    // 50px is 25 in the lower pane's price units.
    expect(pointsOf(manager, b.id)).toEqual(pts([540, 45], [1740, 85]));
  });

  it('keeps every drawing shape on a log scale', () => {
    const { manager, main } = setup();
    main.price.setMode('log');
    main.price.fit(10, 1000);
    const a = manager.add({ type: 'trendline', pane: 0, points: pts([3000, 100], [3600, 1000]), style: {} });
    const b = manager.add({ type: 'trendline', pane: 0, points: pts([4200, 20], [4800, 40]), style: {} });
    manager.setSelection([a.id, b.id]);
    drag(manager, [560, 125], [560, 175]);
    const [a0, a1] = pointsOf(manager, a.id);
    const [b0, b1] = pointsOf(manager, b.id);
    expect(a1!.price / a0!.price).toBeCloseTo(10);
    expect(b1!.price / b0!.price).toBeCloseTo(2);
    // Everything moved down 50px.
    expect(main.price.priceToY(b0!.price)).toBeCloseTo(main.price.priceToY(20) + 50);
  });

  it('drags one anchor of a selected drawing without moving the others', () => {
    const { manager } = setup();
    const a = manager.add(line());
    const b = manager.add(line(400));
    manager.setSelection([a.id, b.id]);
    drag(manager, [100, 400], [100, 350]);
    const [a0, a1] = pointsOf(manager, a.id);
    expect(a0!.time).toBe(540);
    expect(a0!.price).toBeCloseTo(150);
    expect(a1).toEqual({ time: 1740, price: 300 });
    expect(pointsOf(manager, b.id)).toEqual(line(400).points);
  });
});

describe('selection box', () => {
  it('shift-drag on empty space adds the drawings with every anchor inside', () => {
    const { manager, of } = setup();
    const a = manager.add(line());
    const b = manager.add(line(400));
    const outside = manager.add({ type: 'trendline', pane: 0, points: pts([540, 100], [5340, 300]), style: {} });
    manager.select(b.id);
    const changes = of('drawings:change').length;
    expect(drag(manager, [50, 150], [350, 450], true)).toBe(true);
    expect(manager.selection).toEqual([b.id, a.id]);
    expect(manager.selection).not.toContain(outside.id);
    // Selecting is no edit.
    expect(of('drawings:change').length).toBe(changes);
  });

  it('selects only in the pane it was drawn in', () => {
    const { manager } = setup();
    manager.add(line());
    const lower = manager.add({ type: 'trendline', pane: 1, points: pts([540, 20], [1740, 60]), style: {} });
    manager.pointerDown(1, { x: 50, y: 520 }, { shift: true });
    manager.pointerMove({ x: 350, y: 690 });
    manager.pointerUp({ x: 350, y: 690 });
    expect(manager.selection).toEqual([lower.id]);
  });

  it('a shift-click on empty space selects nothing and keeps the selection', () => {
    const { manager } = setup();
    const a = manager.add(line());
    manager.select(a.id);
    expect(click(manager, 900, 50, true)).toBe(true);
    expect(manager.selection).toEqual([a.id]);
  });

  it('leaves shift-drag to panning on a pane without selectable drawings', () => {
    const { manager } = setup();
    manager.add({ ...line(), selectable: false });
    expect(manager.pointerDown(0, { x: 900, y: 50 }, { shift: true })).toBe(false);
    expect(manager.isBusy).toBe(false);
  });
});

describe('delete, copy and paste', () => {
  it('deleteSelection removes every selected drawing as one undo step', () => {
    const { manager } = setup();
    const a = manager.add(line());
    const b = manager.add(line(400));
    const keep = manager.add(line(600));
    manager.setSelection([a.id, b.id]);
    expect(manager.deleteSelection()).toBe(true);
    expect(manager.getAll().map((d) => d.id)).toEqual([keep.id]);
    expect(manager.selection).toEqual([]);
    manager.undo();
    expect(manager.getAll().map((d) => d.id)).toEqual([a.id, b.id, keep.id]);
  });

  it('pastes unlocked copies in place, on top and selected, as one undo step', () => {
    const { manager } = setup();
    const a = manager.add({ ...line(), locked: true, style: { color: '#ff0000' } });
    const b = manager.add(line(400));
    manager.setSelection([b.id, a.id]);
    expect(manager.copy()).toBe(2);
    // Later edits do not reach the copies.
    manager.update(b.id, { points: line(500).points });
    const copies = manager.paste();
    expect(copies).toHaveLength(2);
    expect(copies.map((d) => d.points)).toEqual([line().points, line(400).points]);
    expect(copies[0]!.style.color).toBe('#ff0000');
    expect(copies.every((d) => d.locked === undefined && d.id !== a.id && d.id !== b.id)).toBe(true);
    expect(manager.selection).toEqual(copies.map((d) => d.id));
    expect(manager.getAll().slice(-2).map((d) => d.id)).toEqual(copies.map((d) => d.id));
    manager.undo();
    expect(manager.getAll()).toHaveLength(2);
    // Pasting again makes new copies.
    const again = manager.paste();
    expect(again.map((d) => d.id)).not.toEqual(copies.map((d) => d.id));
  });

  it('copy of nothing keeps what was copied before', () => {
    const { manager } = setup();
    const a = manager.add(line());
    manager.copy([a.id]);
    expect(manager.copy([])).toBe(0);
    expect(manager.paste()).toHaveLength(1);
  });

  it('leaves out copies of a pane the chart no longer has', () => {
    const { manager, panes } = setup();
    const a = manager.add(line());
    const b = manager.add({ type: 'trendline', pane: 1, points: pts([540, 20], [1740, 60]), style: {} });
    manager.copy([a.id, b.id]);
    manager.remapPanes([0, -1]);
    panes.pop();
    expect(manager.paste().map((d) => d.pane)).toEqual([0]);
  });
});
