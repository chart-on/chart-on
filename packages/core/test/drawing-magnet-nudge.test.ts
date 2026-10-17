import { afterEach, describe, expect, it } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { constrainAngle } from '../src/drawing/geometry';
import { DrawingManager, type DrawingEvents, type DrawingHost, type DrawingModifiers } from '../src/drawing/manager';
import type { DrawingPoint, DrawingToolDef } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import type { Point } from '../src/types';
import { withBuiltinTools } from './builtin-tools';

// x = (index - 99) * 10 + 1000, time = index * 60. The magnet snaps prices to multiples of 100.
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
    magnetPrice: (_i, price) => Math.round(price / 100) * 100,
    formatPrice: (_p, price) => price.toFixed(2),
    requestOverlay: () => {},
    editText: (_at, _initial, done) => done(null),
    emit: (name, payload) => events.push({ name, payload }),
  };
  const manager = withBuiltinTools(new DrawingManager(host));
  const of = (name: keyof DrawingEvents) => events.filter((e) => e.name === name).map((e) => e.payload);
  return { manager, main, of };
}

const pts = (...pairs: [number, number][]): DrawingPoint[] => pairs.map(([time, price]) => ({ time, price }));
const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, ...mods }) as KeyboardEvent;
const at = (x: number, y: number): Point => ({ x, y });

/** Place a two-point tool on pane 0 from `a` to `b`, holding `mods` for the second point. */
function place(m: DrawingManager, type: string, a: Point, b: Point, mods: DrawingModifiers = {}) {
  m.setTool(type);
  m.pointerDown(0, a);
  m.pointerUp(a);
  m.pointerMove(b, mods);
  m.pointerDown(0, b, mods);
  m.pointerUp(b, false, mods);
  return m.getAll().at(-1)!;
}

/** Trend line from (x 100, y 400) to (x 300, y 200): time 540 → 1740, price 100 → 300. */
const trend = { type: 'trendline', pane: 0, points: pts([540, 100], [1740, 300]), style: {} };

describe('constrainAngle', () => {
  it('keeps a drag horizontal, vertical or at 45°', () => {
    const o = at(100, 100);
    expect(constrainAngle(o, at(200, 120))).toEqual(at(200, 100));
    expect(constrainAngle(o, at(90, 0))).toEqual(at(100, 0));
    expect(constrainAngle(o, at(200, 0))).toEqual(at(200, 0));
    expect(constrainAngle(o, at(190, 10))).toEqual(at(190, 10));
    expect(constrainAngle(o, at(20, 160))).toEqual(at(30, 170));
    expect(constrainAngle(o, o)).toEqual(o);
  });
});

describe('magnet modes', () => {
  it('starts off, remembers the last mode and emits magnet:change on changes only', () => {
    const { manager, of } = setup();
    expect(manager.magnetMode).toBe('off');
    expect(manager.magnet).toBe(false);
    manager.setMagnetMode('weak');
    manager.setMagnetMode('weak');
    expect(manager.magnet).toBe(true);
    manager.setMagnet(true);
    expect(manager.magnetMode).toBe('weak');
    manager.setMagnet(false);
    manager.setMagnet(true);
    expect(manager.magnetMode).toBe('weak');
    manager.magnet = false;
    expect(manager.magnetMode).toBe('off');
    expect(of('magnet:change')).toEqual([{ mode: 'weak' }, { mode: 'off' }, { mode: 'weak' }, { mode: 'off' }]);
    expect(() => manager.setMagnetMode('on' as 'weak')).toThrow(/Magnet mode/);
  });

  it('turns on strong the first time', () => {
    const { manager } = setup();
    manager.setMagnet(true);
    expect(manager.magnetMode).toBe('strong');
  });

  it('strong snaps every placed point, weak only those within a few pixels', () => {
    const { manager } = setup();
    manager.setMagnetMode('strong');
    expect(place(manager, 'trendline', at(100, 380), at(300, 192)).points.map((q) => q.price)).toEqual([100, 300]);
    manager.setMagnetMode('weak');
    // 120 is 20 px from 100: too far. 308 is 8 px from 300: pulled in.
    expect(place(manager, 'trendline', at(100, 380), at(300, 192)).points.map((q) => q.price)).toEqual([120, 300]);
  });

  it('snaps fully while Ctrl/Cmd is held, whatever the mode, in the main pane only', () => {
    const { manager } = setup();
    expect(place(manager, 'trendline', at(100, 380), at(300, 180), { ctrl: true }).points.map((q) => q.price)).toEqual([120, 300]);
    manager.setMagnetMode('weak');
    expect(place(manager, 'trendline', at(100, 380), at(300, 180), { ctrl: true }).points[1]!.price).toBe(300);
    expect(place(manager, 'trendline', at(100, 380), at(300, 180)).points[1]!.price).toBe(320);
    manager.setTool('hline');
    manager.pointerDown(1, at(500, 640), { ctrl: true });
    expect(manager.getAll().at(-1)!.points[0]!.price).toBeCloseTo(30);
  });

  it('snaps anchors dragged with the magnet on', () => {
    const { manager } = setup();
    const d = manager.add(trend);
    manager.select(d.id);
    manager.setMagnetMode('strong');
    manager.pointerDown(0, at(300, 200));
    manager.pointerMove(at(400, 230));
    manager.pointerUp(at(400, 230));
    expect(manager.getById(d.id)!.points[1]).toEqual({ time: 2340, price: 300 });
  });
});

describe('Shift-constrained drags', () => {
  it('places the next point horizontally, vertically or at 45° from the last', () => {
    const { manager } = setup();
    const level = place(manager, 'trendline', at(100, 400), at(300, 380), { shift: true }).points;
    expect(level[1]).toEqual({ time: 1740, price: level[0]!.price });
    expect(level[1]!.price).toBeCloseTo(100);
    const upright = place(manager, 'trendline', at(100, 400), at(110, 200), { shift: true }).points;
    expect(upright[1]).toEqual({ time: 540, price: expect.closeTo(300) });
    const diagonal = place(manager, 'trendline', at(100, 400), at(292, 212), { shift: true }).points;
    expect(diagonal[1]).toEqual({ time: 1680, price: expect.closeTo(290) });
  });

  it('wins over the magnet', () => {
    const { manager } = setup();
    manager.setTool('trendline');
    manager.pointerDown(0, at(100, 380));
    manager.pointerUp(at(100, 380));
    manager.setMagnetMode('strong');
    manager.pointerMove(at(300, 370), { shift: true, ctrl: true });
    manager.pointerDown(0, at(300, 370), { shift: true, ctrl: true });
    expect(manager.getAll()[0]!.points).toEqual(pts([540, 120], [1740, 120]));
  });

  it('keeps a dragged anchor level with its neighbour', () => {
    const { manager } = setup();
    const d = manager.add(trend);
    manager.select(d.id);
    manager.pointerDown(0, at(300, 200));
    manager.pointerMove(at(400, 390), { shift: true });
    manager.pointerUp(at(400, 390), false, { shift: true });
    expect(manager.getById(d.id)!.points).toEqual(pts([540, 100], [2340, 100]));
    // The first anchor measures from the second.
    manager.pointerDown(0, at(100, 400));
    manager.pointerMove(at(410, 100), { shift: true });
    manager.pointerUp(at(410, 100), false, { shift: true });
    expect(manager.getById(d.id)!.points).toEqual(pts([2340, 400], [2340, 100]));
  });

  it('moves a whole drawing along one axis, as one undo step', () => {
    const { manager } = setup();
    const d = manager.add(trend);
    manager.select(d.id);
    manager.pointerDown(0, at(200, 300));
    manager.pointerMove(at(260, 290), { shift: true });
    manager.pointerUp(at(260, 290), false, { shift: true });
    expect(manager.getById(d.id)!.points).toEqual(pts([900, 100], [2100, 300]));
    manager.undo();
    expect(manager.getById(d.id)!.points).toEqual(trend.points);
  });
});

describe('arrow-key nudge', () => {
  it('moves the selection by a bar or a pixel, ten with Shift, one undo step per press', () => {
    const { manager } = setup();
    const d = manager.add(trend);
    manager.select(d.id);
    expect(manager.keyDown(key('ArrowRight'))).toBe(true);
    expect(manager.getById(d.id)!.points).toEqual(pts([600, 100], [1800, 300]));
    manager.keyDown(key('ArrowUp'));
    expect(manager.getById(d.id)!.points).toEqual(pts([600, 101], [1800, 301]));
    manager.keyDown(key('ArrowLeft', { shiftKey: true }));
    manager.keyDown(key('ArrowDown', { shiftKey: true }));
    expect(manager.getById(d.id)!.points).toEqual(pts([0, 91], [1200, 291]));
    for (let i = 0; i < 4; i++) manager.undo();
    expect(manager.getById(d.id)!.points).toEqual(trend.points);
  });

  it("merges a held key's repeats into the step of its first press", () => {
    const { manager } = setup();
    const d = manager.add(trend);
    manager.select(d.id);
    manager.keyDown(key('ArrowRight'));
    for (let i = 0; i < 3; i++) manager.keyDown(key('ArrowRight', { repeat: true }));
    manager.keyDown(key('ArrowRight'));
    expect(manager.getById(d.id)!.points[0]!.time).toBe(540 + 5 * 60);
    manager.undo();
    expect(manager.getById(d.id)!.points[0]!.time).toBe(540 + 4 * 60);
    manager.undo();
    expect(manager.getById(d.id)!.points).toEqual(trend.points);
    // After an undo, a repeat starts a step of its own.
    manager.keyDown(key('ArrowRight', { repeat: true }));
    manager.undo();
    expect(manager.getById(d.id)!.points).toEqual(trend.points);
  });

  it('moves every unlocked selected drawing on its own pane scale', () => {
    const { manager, main } = setup();
    main.price.setMode('log');
    const a = manager.add(trend);
    const b = manager.add({ type: 'trendline', pane: 1, points: pts([540, 20], [1740, 60]), style: {} });
    const fixed = manager.add({ ...trend, locked: true });
    manager.setSelection([a.id, b.id, fixed.id]);
    manager.keyDown(key('ArrowUp'));
    const [p0, p1] = manager.getById(a.id)!.points;
    expect(p1!.price / p0!.price).toBeCloseTo(3);
    expect(p0!.price).toBeGreaterThan(100);
    expect(manager.getById(b.id)!.points.map((q) => q.price)).toEqual([20.5, 60.5]);
    expect(manager.getById(fixed.id)!.points).toEqual(trend.points);
  });

  it('moves screen-anchored drawings by pixels, stopping at the pane edge', () => {
    const { manager } = setup();
    const note: DrawingToolDef = {
      type: 'note',
      label: 'Note',
      points: 1,
      anchoring: 'screen',
      render: () => {},
      hitTest: () => false,
    };
    manager.register(note);
    const d = manager.add({ type: 'note', pane: 0, points: pts([0.5, 0.004]), style: {} });
    manager.select(d.id);
    manager.keyDown(key('ArrowRight', { shiftKey: true }));
    manager.keyDown(key('ArrowUp', { shiftKey: true }));
    expect(manager.getById(d.id)!.points[0]).toEqual({ time: 0.51, price: 0 });
  });

  it('leaves the arrows alone with nothing to move', () => {
    const { manager } = setup();
    const d = manager.add(trend);
    expect(manager.keyDown(key('ArrowLeft'))).toBe(false);
    manager.select(d.id);
    expect(manager.keyDown(key('ArrowLeft', { ctrlKey: true }))).toBe(false);
    expect(manager.keyDown(key('ArrowLeft', { altKey: true }))).toBe(false);
    manager.setLocked(true);
    expect(manager.keyDown(key('ArrowLeft'))).toBe(false);
    manager.setLocked(false);
    manager.update(d.id, { locked: true });
    expect(manager.keyDown(key('ArrowLeft'))).toBe(false);
    expect(manager.getById(d.id)!.points).toEqual(trend.points);
  });
});

describe('chart keys', () => {
  const charts: Chart[] = [];
  afterEach(() => {
    charts.splice(0).forEach((c) => c.destroy());
    if (typeof document !== 'undefined') (document as unknown as { activeElement: unknown }).activeElement = null;
  });

  function chart() {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles().setData(Array.from({ length: 1000 }, (_, i) => ({ time: i * 60, open: 10, high: 20, low: 0, close: 10 })));
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
    c.root.focus();
    return c;
  }
  const press = (c: Chart, k: string) => dispatch(c.root, 'keydown', { key: k, code: '' });

  it('pans with the arrows while nothing is selected and nudges the selection otherwise', () => {
    const c = chart();
    const d = c.drawings.add({ type: 'hline', pane: 0, points: pts([990 * 60, 10]), style: {} });
    const offset = c.time.rightOffset;
    expect(press(c, 'ArrowLeft').defaultPrevented).toBe(true);
    expect(c.time.rightOffset).not.toBe(offset);
    expect(press(c, 'ArrowUp').defaultPrevented).toBe(false);
    c.drawings.select(d.id);
    const view = c.time.rightOffset;
    expect(press(c, 'ArrowLeft').defaultPrevented).toBe(true);
    expect(press(c, 'ArrowUp').defaultPrevented).toBe(true);
    expect(c.time.rightOffset).toBe(view);
    const moved = c.drawings.getById(d.id)!.points[0]!;
    expect(moved.time).toBe(989 * 60);
    expect(moved.price).toBeGreaterThan(10);
  });

  it('emits magnet:change on the chart', () => {
    const c = chart();
    const modes: string[] = [];
    c.on('magnet:change', ({ mode }) => modes.push(mode));
    c.drawings.setMagnetMode('weak');
    c.drawings.setMagnet(false);
    expect(modes).toEqual(['weak', 'off']);
  });
});
