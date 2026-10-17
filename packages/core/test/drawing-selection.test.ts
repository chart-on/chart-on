import { describe, expect, it } from 'vitest';
import { DrawingManager, type DrawingEvents, type DrawingHost } from '../src/drawing/manager';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { withBuiltinTools } from './builtin-tools';

// x = (index - 99) * 10 + 1000, time = index * 60, price = 500 - y (see drawing.test.ts).
function setup() {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
  // No pan limit, so the drawing can scroll fully out of view.
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0, minBarCoverage: 0 });
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
    magnetPrice: (_i, price) => price,
    formatPrice: (_p, price) => price.toFixed(2),
    requestOverlay: () => {},
    editText: (_at, _initial, done) => done(null),
    emit: (name, payload) => events.push({ name, payload }),
  };
  const manager = withBuiltinTools(new DrawingManager(host));
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D;
  const render = () => manager.render(ctx, 0, 1000, 500);
  const bounds = () => events.filter((e) => e.name === 'drawing:bounds').map((e) => e.payload);
  const count = (name: keyof DrawingEvents) => events.filter((e) => e.name === name).length;
  return { manager, time, render, bounds, count };
}

const line = { type: 'trendline', pane: 0, points: [{ time: 540, price: 100 }, { time: 1740, price: 300 }], style: {} };

describe('drawing selection', () => {
  it('emits the selected drawing bounds when they change', () => {
    const { manager, render, bounds } = setup();
    const d = manager.add(line);
    render();
    expect(bounds()).toEqual([]);
    manager.select(d.id);
    render();
    render();
    expect(bounds()).toEqual([{ id: d.id, rect: { x: 100, y: 200, width: 200, height: 200 } }]);
  });

  it('reports null bounds when the drawing scrolls out of view or is deselected', () => {
    const { manager, render, bounds, time } = setup();
    const d = manager.add(line);
    manager.select(d.id);
    render();
    time.pan(2000);
    render();
    expect(bounds().at(-1)).toEqual({ id: d.id, rect: null });
    manager.select(null);
    expect(bounds().at(-1)).toEqual({ id: null, rect: null });
  });

  it('ignores unknown ids', () => {
    const { manager } = setup();
    manager.select('nope');
    expect(manager.selected).toBeNull();
  });

  it('clones a drawing unlocked and selects the copy', () => {
    const { manager } = setup();
    const d = manager.add({ ...line, locked: true, style: { color: '#ff0000' } });
    const copy = manager.clone(d.id)!;
    expect(copy.id).not.toBe(d.id);
    expect(copy.locked).toBeUndefined();
    expect(copy.points).toEqual(d.points);
    expect(copy.style).toEqual({ color: '#ff0000' });
    expect(manager.selected?.id).toBe(copy.id);
    expect(manager.getAll()).toHaveLength(2);
    expect(manager.clone('nope')).toBeNull();
    // One undo step removes the copy.
    manager.undo();
    expect(manager.getAll()).toHaveLength(1);
  });

  it('previews edits without recording them until update() commits once', () => {
    const { manager, count } = setup();
    const d = manager.add({ ...line, style: { color: '#ff0000' } });
    const changes = count('drawings:change');
    for (const color of ['#00ff00', '#0000ff', '#123456']) manager.preview(d.id, { style: { color } });
    expect(manager.getAll()[0]!.style.color).toBe('#123456');
    expect(manager.canUndo).toBe(true); // only the add so far
    expect(count('drawings:change')).toBe(changes);
    manager.update(d.id, { style: { color: '#123456' } });
    expect(count('drawings:change')).toBe(changes + 1);
    manager.undo();
    expect(manager.getAll()[0]!.style.color).toBe('#ff0000');
    // The add is the only step left.
    manager.undo();
    expect(manager.getAll()).toHaveLength(0);
    expect(manager.canUndo).toBe(false);
  });

  it('discards a pending preview on undo', () => {
    const { manager } = setup();
    const d = manager.add({ ...line, style: { color: '#ff0000' } });
    manager.preview(d.id, { style: { color: '#00ff00' } });
    manager.undo();
    expect(manager.getAll()).toHaveLength(1);
    expect(manager.getAll()[0]!.style.color).toBe('#ff0000');
  });

  it('cancels a pending preview without touching the history', () => {
    const { manager, count } = setup();
    const d = manager.add({ ...line, style: { color: '#ff0000' } });
    expect(manager.cancelPreview()).toBe(false);
    const changes = count('drawings:change');
    manager.preview(d.id, { style: { color: '#00ff00', lineWidth: 3 } });
    expect(manager.cancelPreview()).toBe(true);
    expect(manager.getAll()[0]!.style).toEqual({ color: '#ff0000' });
    expect(count('drawings:change')).toBe(changes);
    expect(manager.cancelPreview()).toBe(false);
    // Undo still reverts the add rather than being spent on the dropped preview.
    manager.undo();
    expect(manager.getAll()).toHaveLength(0);
  });
});

describe('drawing hit regions', () => {
  const cross = { type: 'cross-line', pane: 0, points: [{ time: 540, price: 300 }], style: {} };

  it('samples the tools\' own hit tests into runs of cells', () => {
    const { manager } = setup();
    manager.add(cross);
    const runs = manager.hitRuns(4);
    const rows: number[][] = [];
    for (let i = 0; i < runs.length; i += 3) rows.push(runs.slice(i, i + 3));
    // The cross sits at x 100, y 200 and hits within 6 px: four full-width rows, and a 16 px band in every other row.
    expect(rows.filter((r) => r[2] === 1000).map((r) => r[1])).toEqual([192, 196, 200, 204]);
    expect(rows.filter((r) => r[2] !== 1000).every((r) => r[0] === 92 && r[2] === 16)).toBe(true);
    expect(rows).toHaveLength(125);
  });

  it('leaves out drawings the pointer cannot grab', () => {
    const { manager } = setup();
    manager.add({ ...cross, selectable: false });
    manager.add({ ...cross, hidden: true });
    expect(manager.hitRuns(4)).toEqual([]);
    manager.add(cross);
    manager.setHidden(true);
    expect(manager.hitRuns(4)).toEqual([]);
  });
});

