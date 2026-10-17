import { describe, expect, it } from 'vitest';
import { Chart } from '../src/chart';
import { fakeContainer } from './fake-dom';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import { distToSegment } from '../src/drawing/geometry';
import type { DrawingToolDef } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { withBuiltinTools } from './builtin-tools';

// x = (index - 99) * 10 + 1000, time = index * 60, price = 500 - y. The magnet snaps prices to multiples of 100.
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
    magnetPrice: (_i, price) => Math.round(price / 100) * 100,
    formatPrice: (_p, price) => price.toFixed(2),
    requestOverlay: () => {},
    editText: (_at, _initial, done) => done(null),
    emit: () => {},
  };
  const manager = withBuiltinTools(new DrawingManager(host));
  for (const tool of [segment, brush, note]) manager.register(tool);
  return { manager };
}

const segment: DrawingToolDef = {
  type: 'segment',
  label: 'Segment',
  points: 2,
  render() {},
  hitTest: (d, p) => distToSegment(p, d.points[0]!, d.points[1]!) <= 6,
};

const brush: DrawingToolDef = { ...segment, type: 'brush', label: 'Brush', points: 'free' };

const note: DrawingToolDef = { ...segment, type: 'note', label: 'Note', points: 1, anchoring: 'screen' };

function click(m: DrawingManager, x: number, y: number) {
  m.pointerMove({ x, y });
  m.pointerDown(0, { x, y });
  m.pointerUp({ x, y });
}

const points = (...pairs: [number, number][]) => pairs.map(([time, price]) => ({ time, price }));

describe('axis marks of the selected drawing', () => {
  it("labels every anchor's price and time, in the drawing's color", () => {
    const { manager } = setup();
    const d = manager.add({ type: 'segment', pane: 0, points: points([600, 100], [1200, 300]), style: { color: '#ff0000' } });
    expect(manager.axisMarks()).toBeNull();
    manager.select(d.id);
    expect(manager.axisMarks()).toEqual({ id: d.id, pane: 0, color: '#ff0000', prices: [100, 300], times: [600, 1200] });
  });

  it('falls back to the theme color and lists repeated values once', () => {
    const { manager } = setup();
    const d = manager.add({ type: 'segment', pane: 0, points: points([600, 100], [600, 100]), style: {} });
    manager.select(d.id);
    expect(manager.axisMarks()).toMatchObject({ color: darkTheme.drawing, prices: [100], times: [600] });
  });

  it('marks the drawing being placed', () => {
    const { manager } = setup();
    manager.setTool('segment');
    click(manager, 500, 400);
    manager.pointerMove({ x: 600, y: 300 });
    const marks = manager.axisMarks()!;
    expect(marks.prices.map((p) => Math.round(p))).toEqual([100, 200]);
    expect(marks.times).toEqual([2940, 3540]);
  });

  it("uses a freehand stroke's extremes and nothing for screen-anchored tools", () => {
    const { manager } = setup();
    const stroke = manager.add({ type: 'brush', pane: 0, points: points([600, 100], [900, 400], [700, 50]), style: {} });
    manager.select(stroke.id);
    expect(manager.axisMarks()).toMatchObject({ prices: [50, 400], times: [600, 900] });
    const pinned = manager.add({ type: 'note', pane: 0, points: points([0.5, 0.5]), style: {} });
    manager.select(pinned.id);
    expect(manager.axisMarks()).toBeNull();
  });

  it("follows the tool's axisMarks, dropping values that are not finite", () => {
    const { manager } = setup();
    manager.register({ ...segment, type: 'priced', axisMarks: (d) => ({ prices: [d.points[1]!.price, NaN, Infinity] }) });
    manager.register({ ...segment, type: 'quiet', axisMarks: () => null });
    const priced = manager.add({ type: 'priced', pane: 0, points: points([600, 100], [1200, 300]), style: {} });
    manager.select(priced.id);
    expect(manager.axisMarks()).toMatchObject({ prices: [300], times: [] });
    const quiet = manager.add({ type: 'quiet', pane: 0, points: points([600, 100], [1200, 300]), style: {} });
    manager.select(quiet.id);
    expect(manager.axisMarks()).toBeNull();
  });

  it('labels only the price of a horizontal line and the time of a vertical line', () => {
    const { manager } = setup();
    const h = manager.add({ type: 'hline', pane: 0, points: points([600, 100]), style: {} });
    manager.select(h.id);
    expect(manager.axisMarks()).toMatchObject({ prices: [100], times: [] });
    const v = manager.add({ type: 'vline', pane: 0, points: points([600, 100]), style: {} });
    manager.select(v.id);
    expect(manager.axisMarks()).toMatchObject({ prices: [], times: [600] });
  });

  it('shows nothing with axis labels off or drawings hidden', () => {
    const { manager } = setup();
    const d = manager.add({ type: 'segment', pane: 0, points: points([600, 100], [1200, 300]), style: {} });
    manager.select(d.id);
    manager.setAxisLabels(false);
    expect(manager.axisMarks()).toBeNull();
    manager.setAxisLabels(true);
    expect(manager.axisMarks()).not.toBeNull();
    manager.setHidden(true);
    expect(manager.axisMarks()).toBeNull();
  });
});

describe('tool snapping', () => {
  const one: DrawingToolDef = { ...segment, type: 'one', points: 1, hitTest: () => false };
  const place = (manager: DrawingManager, type: string, magnet: boolean) => {
    manager.setMagnet(magnet);
    manager.setTool(type);
    click(manager, 500, 260); // price 240
    return manager.getAll().at(-1)!.points[0]!;
  };

  it('follows the magnet by default', () => {
    const { manager } = setup();
    manager.register(one);
    expect(place(manager, 'one', false).price).toBeCloseTo(240);
    expect(place(manager, 'one', true).price).toBe(200);
  });

  it("snaps 'ohlc' tools whatever the magnet, and 'time' tools never", () => {
    const { manager } = setup();
    manager.register({ ...one, type: 'ohlc', snap: 'ohlc' });
    manager.register({ ...one, type: 'time', snap: 'time' });
    expect(place(manager, 'ohlc', false).price).toBe(200);
    const timeOnly = place(manager, 'time', true);
    expect(timeOnly.price).toBeCloseTo(240);
    expect(timeOnly.time).toBe(2940);
  });

  it('rejects an unknown snap mode', () => {
    const { manager } = setup();
    expect(() => manager.register({ ...one, type: 'bad', snap: 'close' as 'ohlc' })).toThrow(/snap/);
  });

  it("applies the tool's snap while an anchor is dragged", () => {
    const { manager } = setup();
    manager.register({ ...segment, type: 'ohlc-segment', snap: 'ohlc' });
    const d = manager.add({ type: 'ohlc-segment', pane: 0, points: points([2940, 100], [3540, 300]), style: {} });
    manager.select(d.id);
    // The first anchor is at (500, 400).
    manager.pointerDown(0, { x: 500, y: 400 });
    manager.pointerMove({ x: 520, y: 330 }); // price 170
    manager.pointerUp({ x: 520, y: 330 });
    expect(manager.getById(d.id)!.points[0]).toEqual({ time: 3060, price: 200 });
  });
});

describe('drawings kept out of history', () => {
  it('adds no undo step for their changes', () => {
    const { manager } = setup();
    const d = manager.add({ type: 'segment', pane: 0, points: points([600, 100], [1200, 300]), style: {}, history: false });
    expect(manager.canUndo).toBe(false);
    manager.update(d.id, { points: points([600, 150], [1200, 300]) });
    manager.remove(d.id);
    expect(manager.canUndo).toBe(false);
    expect(manager.getAll()).toEqual([]);
  });

  it('leaves them as they are when other changes are undone and redone', () => {
    const { manager } = setup();
    const kept = manager.add({ type: 'segment', pane: 0, points: points([600, 100], [1200, 300]), style: {} });
    const app = manager.add({ type: 'segment', pane: 0, points: points([0, 0], [60, 0]), style: {}, history: false });
    manager.update(kept.id, { style: { color: '#00ff00' } });
    manager.update(app.id, { points: points([0, 50], [60, 50]) });
    expect(manager.undo()).toBe(true);
    expect(manager.getById(kept.id)!.style.color).toBeUndefined();
    expect(manager.getById(app.id)!.points[0]!.price).toBe(50);
    // Undoing the first drawing's creation keeps the untracked one, in its place on top.
    expect(manager.undo()).toBe(true);
    expect(manager.getAll().map((x) => x.id)).toEqual([app.id]);
    expect(manager.canUndo).toBe(false);
    expect(manager.redo()).toBe(true);
    expect(manager.redo()).toBe(true);
    expect(manager.getAll().map((x) => x.id)).toEqual([kept.id, app.id]);
    expect(manager.getById(kept.id)!.style.color).toBe('#00ff00');
    expect(manager.getById(app.id)!.points[0]!.price).toBe(50);
  });

  it('does not bring back an untracked drawing removed after the saved step', () => {
    const { manager } = setup();
    const app = manager.add({ type: 'segment', pane: 0, points: points([0, 0], [60, 0]), style: {}, history: false });
    manager.add({ type: 'segment', pane: 0, points: points([600, 100], [1200, 300]), style: {} });
    manager.remove(app.id);
    manager.undo();
    expect(manager.getAll()).toEqual([]);
  });

  it('records no step for switching the flag', () => {
    const { manager } = setup();
    const d = manager.add({ type: 'segment', pane: 0, points: points([600, 100], [1200, 300]), style: {} });
    manager.undo();
    manager.redo();
    manager.update(d.id, { history: false });
    manager.update(d.id, { points: points([600, 200], [1200, 300]) });
    manager.update(d.id, { history: true });
    // The one step left is the drawing's creation, so undoing it removes the drawing.
    expect(manager.getById(d.id)!.history).toBeUndefined();
    expect(manager.undo()).toBe(true);
    expect(manager.getAll()).toEqual([]);
  });

  it('saves the flag and drops an ill-typed one on load', () => {
    const { manager } = setup();
    manager.add({ type: 'segment', pane: 0, points: points([600, 100], [1200, 300]), style: {}, history: false });
    const saved = manager.serialize();
    expect(saved.drawings[0]!.history).toBe(false);
    const result = manager.load({ version: 1, drawings: [{ ...saved.drawings[0], history: 'no' }] });
    expect(result.errors).toEqual([{ index: 0, field: 'history', reason: 'must be a boolean' }]);
    expect(manager.getAll()[0]!.history).toBeUndefined();
    expect(() => manager.update(manager.getAll()[0]!.id, { history: 1 as unknown as boolean })).toThrow(/history/);
  });
});

describe('axis labels on the chart', () => {
  /** The top layer's text and filled rectangles, with the fill each was drawn in. */
  function recorded() {
    const c = new Chart(fakeContainer(), { timezone: 'UTC' });
    c.addCandles().setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 3600, open: 10, high: 20, low: 0, close: 10 })));
    const texts: { text: string; fill: unknown }[] = [];
    const rects: { args: number[]; fill: unknown }[] = [];
    const state: Record<string, unknown> = {};
    const ctx = new Proxy(state, {
      get: (_t, key) => {
        if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
        if (key === 'fillText') return (text: string) => texts.push({ text, fill: state.fillStyle });
        if (key === 'fillRect') return (...args: number[]) => rects.push({ args, fill: state.fillStyle });
        if (typeof key === 'string' && key in state) return state[key];
        return () => ({ addColorStop() {} });
      },
      set: (_t, key, value) => {
        state[key as string] = value;
        return true;
      },
    });
    (c as unknown as { top: { getContext(): unknown } }).top.getContext = () => ctx;
    const frame = () => {
      texts.length = 0;
      rects.length = 0;
      c.invalidate();
      (c as unknown as { render(t: number): void }).render(0);
    };
    return { c, texts, rects, frame };
  }

  it("draws the selected drawing's prices, times and ranges in its color", () => {
    const { c, texts, rects, frame } = recorded();
    const d = c.drawings.add({ type: 'trendline', pane: 0, points: points([3600 * 10, 5], [3600 * 20, 15]), style: { color: '#ff0000' } });
    frame();
    const red = (fill: unknown) => typeof fill === 'string' && fill.includes('255, 0, 0');
    const marks = ['5.0000', '15.0000', c.formatTime(3600 * 10), c.formatTime(3600 * 20)];
    const labelled = () => texts.filter((t) => marks.includes(t.text));
    expect(labelled()).toEqual([]);
    expect(rects.filter((r) => red(r.fill))).toEqual([]);

    c.drawings.select(d.id);
    frame();
    // White text on the red pills.
    expect(labelled().map((t) => t.text).sort()).toEqual([...marks].sort());
    expect(labelled().every((t) => t.fill === '#fff')).toBe(true);
    // One band on the price axis, one on the time axis.
    expect(rects.filter((r) => red(r.fill))).toHaveLength(2);

    c.drawings.setAxisLabels(false);
    frame();
    expect(labelled()).toEqual([]);
  });
});
