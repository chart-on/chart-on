import { describe, expect, it } from 'vitest';
import { DrawingManager, type DrawingEvents, type DrawingHost } from '../src/drawing/manager';
import type { Drawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { withBuiltinTools } from './builtin-tools';

// x = (index - 99) * 10 + 1000, time = index * 60, price = 500 - y (see drawing.test.ts).
function setup(text: string | null = null) {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = 100;
  const panes = [0, 1].map((i) => {
    const pane = new Pane(i, { stretch: 1, marginTop: 0, marginBottom: 0 });
    pane.top = i * 500;
    pane.height = 500;
    pane.price.height = 500;
    pane.price.fit(0, 500);
    return pane;
  });
  const events: { name: keyof DrawingEvents; payload: unknown }[] = [];
  const host: DrawingHost = {
    theme: darkTheme,
    timeline,
    time,
    panes,
    magnetPrice: (_i, price) => price,
    formatPrice: (_p, price) => price.toFixed(2),
    requestOverlay: () => {},
    editText: (_at, _initial, done) => done(text),
    emit: (name, payload) => events.push({ name, payload }),
  };
  const manager = withBuiltinTools(new DrawingManager(host));
  const drawn: string[] = [];
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D;
  // Record render order through a tool whose render logs the drawing id.
  manager.register({
    type: 'probe',
    label: 'Probe',
    points: 2,
    render: (_ctx, d) => drawn.push(d.drawing.id),
    hitTest: () => true,
  });
  const render = (pane = 0) => {
    drawn.length = 0;
    manager.render(ctx, pane, 1000, 500);
    return [...drawn];
  };
  const of = <K extends keyof DrawingEvents>(name: K) =>
    events.filter((e) => e.name === name).map((e) => e.payload as DrawingEvents[K]);
  const clearEvents = () => (events.length = 0);
  return { manager, host, render, of, clearEvents };
}

const line = { type: 'trendline', pane: 0, points: [{ time: 540, price: 100 }, { time: 1740, price: 300 }], style: {} };
const probe = (pane = 0) => ({ type: 'probe', pane, points: [{ time: 0, price: 0 }, { time: 60, price: 1 }], style: {} });
/** A point on `line`, in plot space. */
const onLine = { x: 200, y: 300 };
const ids = (list: Drawing[]) => list.map((d) => d.id);

describe('drawing manager lookups', () => {
  it('gets a copy of a drawing by id', () => {
    const { manager } = setup();
    const d = manager.add(line);
    const found = manager.getById(d.id)!;
    expect(found).toEqual(d);
    found.points[0]!.price = 1;
    expect(manager.getById(d.id)!.points[0]!.price).toBe(100);
    expect(manager.getById('nope')).toBeUndefined();
  });
});

describe('stacking order', () => {
  it('brings a drawing to the front and sends it to the back', () => {
    const { manager, render } = setup();
    const [a, b, c] = [manager.add(probe()), manager.add(probe()), manager.add(probe())];
    manager.bringToFront(a.id);
    expect(render()).toEqual([b.id, c.id, a.id]);
    manager.sendToBack(c.id);
    expect(render()).toEqual([c.id, b.id, a.id]);
    expect(ids(manager.getAll())).toEqual([c.id, b.id, a.id]);
  });

  it('moves one step within the pane', () => {
    const { manager, render } = setup();
    const a = manager.add(probe());
    const other = manager.add(probe(1));
    const b = manager.add(probe());
    manager.bringForward(a.id);
    expect(render()).toEqual([b.id, a.id]);
    expect(ids(manager.getAll())).toEqual([other.id, b.id, a.id]);
    manager.bringForward(a.id); // already on top of its pane
    expect(ids(manager.getAll())).toEqual([other.id, b.id, a.id]);
    manager.sendBackward(a.id);
    expect(render()).toEqual([a.id, b.id]);
  });

  it('draws by zIndex and reordering adopts the passed zIndex', () => {
    const { manager, render } = setup();
    const top = manager.add({ ...probe(), zIndex: 5 });
    const a = manager.add(probe());
    const b = manager.add(probe());
    expect(render()).toEqual([a.id, b.id, top.id]);
    manager.bringToFront(a.id);
    expect(manager.getById(a.id)!.zIndex).toBe(5);
    expect(render()).toEqual([b.id, top.id, a.id]);
    manager.sendToBack(a.id);
    expect(manager.getById(a.id)!.zIndex).toBeUndefined();
    expect(render()).toEqual([a.id, b.id, top.id]);
  });

  it('records reordering as an undo step', () => {
    const { manager, render } = setup();
    const a = manager.add(probe());
    const b = manager.add(probe());
    manager.bringToFront(a.id);
    manager.undo();
    expect(render()).toEqual([a.id, b.id]);
  });

  it('hit-tests the top drawing first', () => {
    const { manager } = setup();
    const a = manager.add(line);
    manager.add(line);
    manager.bringToFront(a.id);
    manager.pointerDown(0, onLine);
    expect(manager.selected?.id).toBe(a.id);
  });
});

describe('per-drawing flags', () => {
  it('hides and shows a drawing', () => {
    const { manager, render } = setup();
    const a = manager.add(probe());
    manager.select(a.id);
    manager.setVisible(a.id, false);
    expect(manager.getById(a.id)!.hidden).toBe(true);
    expect(manager.selected).toBeNull();
    expect(render()).toEqual([]);
    manager.setVisible(a.id, true);
    expect(render()).toEqual([a.id]);
  });

  it('does not hit-test hidden or unselectable drawings', () => {
    const { manager } = setup();
    const hidden = manager.add({ ...line, hidden: true });
    expect(manager.pointerDown(0, onLine)).toBe(false);
    manager.setVisible(hidden.id, true);
    manager.update(hidden.id, { selectable: false });
    expect(manager.pointerDown(0, onLine)).toBe(false);
    expect(manager.cursor(onLine)).toBeNull();
    manager.update(hidden.id, { selectable: true });
    expect(manager.pointerDown(0, onLine)).toBe(true);
  });

  it('deselects a drawing made unselectable', () => {
    const { manager } = setup();
    const a = manager.add(line);
    manager.select(a.id);
    manager.update(a.id, { selectable: false });
    expect(manager.selected).toBeNull();
  });

  it('leaves non-persistent drawings out of serialize', () => {
    const { manager } = setup();
    const kept = manager.add({ ...line, group: 'levels', zIndex: 2 });
    manager.add({ ...line, persist: false });
    const saved = manager.serialize();
    expect(ids(saved.drawings)).toEqual([kept.id]);
    expect(manager.getAll()).toHaveLength(2);
  });

  it('round-trips flags through load', () => {
    const { manager } = setup();
    manager.load({
      version: 1,
      drawings: [{ ...line, id: 'x', selectable: false, zIndex: 3, hidden: true, group: 'g', persist: true }],
    });
    expect(manager.getById('x')).toMatchObject({ selectable: false, zIndex: 3, hidden: true, group: 'g', persist: true });
  });

  it('ignores malformed flags in load', () => {
    const { manager } = setup();
    manager.load({ version: 1, drawings: [{ ...line, id: 'x', selectable: 'no', zIndex: 'top', hidden: 1, group: 7 }] });
    const d = manager.getById('x')!;
    expect(d.selectable).toBeUndefined();
    expect(d.zIndex).toBeUndefined();
    expect(d.hidden).toBeUndefined();
    expect(d.group).toBeUndefined();
  });
});

describe('tool access', () => {
  it('refuses denied tools in setTool and drops the active one', () => {
    const { manager, of } = setup();
    manager.setTool('rectangle');
    manager.setAccess(({ id }) => id !== 'rectangle');
    expect(manager.tool).toBeNull();
    expect(() => manager.setTool('rectangle')).toThrow(/not allowed/);
    expect(manager.isToolAllowed('trendline')).toBe(true);
    expect(of('access:change').at(-1)).toEqual({ allow: manager.access });
  });

  it('takes an allow list as a predicate, and allows everything after null', () => {
    const { manager } = setup();
    manager.setAccess(({ id }) => id === 'trendline');
    expect(manager.isToolAllowed('trendline')).toBe(true);
    expect(manager.isToolAllowed('rectangle')).toBe(false);
    manager.setTool('trendline');
    expect(manager.tool).toBe('trendline');
    manager.setAccess(null);
    expect(manager.access).toBeNull();
    expect(manager.isToolAllowed('rectangle')).toBe(true);
  });

  it('does not restrict add() from code', () => {
    const { manager } = setup();
    manager.setAccess(() => false);
    expect(() => manager.add(line)).not.toThrow();
  });
});

describe('kept tool', () => {
  /** Place a trend line from x0 to x1 with two clicks. */
  const place = (manager: DrawingManager, x0: number, x1: number) => {
    manager.pointerDown(0, { x: x0, y: 400 });
    manager.pointerUp({ x: x0, y: 400 });
    manager.pointerDown(0, { x: x1, y: 200 });
    manager.pointerUp({ x: x1, y: 200 });
  };
  const key = (k: string) => ({ key: k }) as KeyboardEvent;

  it('stays active over several drawings without touching stayInDrawingMode', () => {
    const { manager, of } = setup();
    manager.setTool('trendline', { keep: true });
    expect(manager.toolKept).toBe(true);
    expect(of('tool:change')).toEqual([{ tool: 'trendline', kept: true }]);
    place(manager, 100, 300);
    place(manager, 400, 600);
    place(manager, 700, 900);
    expect(manager.getAll()).toHaveLength(3);
    expect(manager.tool).toBe('trendline');
    expect(manager.toolKept).toBe(true);
    expect(manager.stayInDrawingMode).toBe(false);
  });

  it('goes back to the cursor after one drawing without keep', () => {
    const { manager, of } = setup();
    manager.setTool('trendline');
    expect(manager.toolKept).toBe(false);
    place(manager, 100, 300);
    expect(manager.tool).toBeNull();
    expect(of('tool:change')).toEqual([
      { tool: 'trendline', kept: false },
      { tool: null, kept: false },
    ]);
  });

  it('ends on Escape, on picking the tool again, another tool or the cursor', () => {
    const { manager } = setup();
    manager.setTool('trendline', { keep: true });
    place(manager, 100, 300);
    expect(manager.keyDown(key('Escape'))).toBe(true);
    expect(manager.tool).toBeNull();
    expect(manager.toolKept).toBe(false);

    manager.setTool('trendline', { keep: true });
    manager.setTool('trendline');
    expect(manager.toolKept).toBe(false);
    place(manager, 100, 300);
    expect(manager.tool).toBeNull();

    manager.setTool('trendline', { keep: true });
    manager.setTool('rectangle');
    expect(manager.toolKept).toBe(false);

    manager.setTool('trendline', { keep: true });
    manager.setTool(null);
    expect(manager.toolKept).toBe(false);
    manager.setTool(null, { keep: true });
    expect(manager.toolKept).toBe(false);
  });

  it('Escape while placing cancels the drawing and keeps the tool', () => {
    const { manager } = setup();
    manager.setTool('trendline', { keep: true });
    manager.pointerDown(0, { x: 100, y: 400 });
    manager.pointerUp({ x: 100, y: 400 });
    manager.keyDown(key('Escape'));
    expect(manager.getAll()).toHaveLength(0);
    expect(manager.tool).toBe('trendline');
    expect(manager.toolKept).toBe(true);
  });

  it('never keeps a refused tool, and ends when access denies the kept one', () => {
    const { manager, of } = setup();
    manager.setAccess(({ id }) => id !== 'rectangle');
    expect(() => manager.setTool('rectangle', { keep: true })).toThrow(/not allowed/);
    expect(manager.toolKept).toBe(false);
    expect(of('tool:refuse')).toEqual([{ tool: 'rectangle' }]);
    manager.setTool('trendline', { keep: true });
    manager.setAccess(({ id }) => id !== 'trendline');
    expect(manager.tool).toBeNull();
    expect(manager.toolKept).toBe(false);
  });
});

describe('granular events', () => {
  it('emits create, update with the change kinds, and remove', () => {
    const { manager, of } = setup();
    const d = manager.add(line);
    expect(of('drawing:create')).toEqual([{ drawing: d }]);
    manager.update(d.id, { style: { color: '#f00' }, text: 'x' });
    expect(of('drawing:update').at(-1)).toMatchObject({ change: 'style', changes: ['style', 'text'] });
    manager.update(d.id, { locked: true });
    expect(of('drawing:update').at(-1)!.change).toBe('lock');
    manager.setVisible(d.id, false);
    expect(of('drawing:update').at(-1)!.change).toBe('visibility');
    manager.update(d.id, { group: 'g' });
    expect(of('drawing:update').at(-1)!.change).toBe('flags');
    manager.remove(d.id);
    expect(of('drawing:remove')).toEqual([{ id: d.id }]);
  });

  it('reports a drag as a points update', () => {
    const { manager, of } = setup();
    const d = manager.add(line);
    manager.pointerDown(0, onLine);
    manager.pointerMove({ x: 250, y: 280 });
    manager.pointerUp({ x: 250, y: 280 });
    expect(of('drawing:update')).toHaveLength(1);
    expect(of('drawing:update')[0]).toMatchObject({ drawing: { id: d.id }, change: 'points' });
  });

  it('reports reordering as an order update', () => {
    const { manager, of, clearEvents } = setup();
    const a = manager.add(probe());
    manager.add(probe());
    clearEvents();
    manager.bringToFront(a.id);
    expect(of('drawing:update').map((e) => e.change)).toEqual(['order', 'order']);
    expect(of('drawing:update').some((e) => e.drawing.id === a.id)).toBe(true);
  });

  it('emits the inverse events on undo and redo', () => {
    const { manager, of, clearEvents } = setup();
    const d = manager.add(line);
    clearEvents();
    manager.undo();
    expect(of('drawing:remove')).toEqual([{ id: d.id }]);
    manager.redo();
    expect(of('drawing:create')).toEqual([{ drawing: d }]);
  });

  it('emits create for a drawing the user places', () => {
    const { manager, of } = setup();
    manager.setTool('trendline');
    manager.pointerDown(0, { x: 100, y: 400 });
    manager.pointerUp({ x: 100, y: 400 });
    expect(of('drawing:create')).toEqual([]);
    manager.pointerDown(0, { x: 300, y: 200 });
    manager.pointerUp({ x: 300, y: 200 });
    expect(of('drawing:create')).toHaveLength(1);
    expect(of('drawing:create')[0]!.drawing.type).toBe('trendline');
  });

  it('emits create once the text of a new text drawing is entered', () => {
    const { manager, of } = setup('Note');
    manager.setTool('text');
    manager.pointerDown(0, { x: 100, y: 400 });
    expect(of('drawing:create')).toHaveLength(1);
    expect(of('drawing:create')[0]!.drawing.text).toBe('Note');
  });

  it('emits nothing for a text drawing whose entry is cancelled', () => {
    const { manager, of } = setup(null);
    manager.setTool('text');
    manager.pointerDown(0, { x: 100, y: 400 });
    expect(of('drawing:create')).toEqual([]);
    expect(of('drawing:remove')).toEqual([]);
  });

  it('emits remove and pane updates when panes are remapped', () => {
    const { manager, of, clearEvents } = setup();
    const gone = manager.add(probe(1));
    const moved = manager.add({ ...probe(), pane: 0 });
    clearEvents();
    manager.remapPanes([1, -1]);
    expect(of('drawing:remove')).toEqual([{ id: gone.id }]);
    expect(of('drawing:update')).toMatchObject([{ drawing: { id: moved.id, pane: 1 }, change: 'pane' }]);
  });

  it('keeps load quiet apart from drawings:change', () => {
    const { manager, of } = setup();
    manager.load({ version: 1, drawings: [{ ...line, id: 'x' }] });
    expect(of('drawing:create')).toEqual([]);
    expect(of('drawings:change')).toHaveLength(1);
  });

  it('emits click for a press and release without dragging', () => {
    const { manager, of } = setup();
    const d = manager.add(line);
    manager.pointerDown(0, onLine);
    manager.pointerUp({ x: onLine.x + 1, y: onLine.y });
    expect(of('drawing:click')).toEqual([{ id: d.id }]);
    manager.pointerDown(0, onLine);
    manager.pointerMove({ x: 260, y: 300 });
    manager.pointerUp({ x: 260, y: 300 });
    expect(of('drawing:click')).toHaveLength(1);
  });

  it('emits click on locked drawings too', () => {
    const { manager, of } = setup();
    const d = manager.add({ ...line, locked: true });
    manager.pointerDown(0, onLine);
    manager.pointerUp(onLine);
    expect(of('drawing:click')).toEqual([{ id: d.id }]);
  });

  it('emits dblclick on a drawing', () => {
    const { manager, of } = setup();
    const d = manager.add(line);
    expect(manager.doubleClick(onLine)).toBe(false);
    expect(of('drawing:dblclick')).toEqual([{ id: d.id }]);
    manager.doubleClick({ x: 900, y: 50 });
    expect(of('drawing:dblclick')).toHaveLength(1);
  });

  it('emits no click for a cancelled press', () => {
    const { manager, of } = setup();
    manager.add(line);
    manager.pointerDown(0, onLine);
    manager.pointerUp(onLine, true);
    expect(of('drawing:click')).toEqual([]);
  });

  it('emits remove for every drawing on clear', () => {
    const { manager, of, clearEvents } = setup();
    const [a, b] = [manager.add(line), manager.add(probe())];
    clearEvents();
    manager.clear();
    expect(of('drawing:remove')).toEqual([{ id: a.id }, { id: b.id }]);
  });

  it('emits create for a clone and selects it', () => {
    const { manager, of, clearEvents } = setup();
    const d = manager.add({ ...line, locked: true });
    clearEvents();
    const copy = manager.clone(d.id)!;
    expect(of('drawing:create')).toEqual([{ drawing: copy }]);
    expect(copy.locked).toBeUndefined();
    expect(manager.selected?.id).toBe(copy.id);
    expect(of('drawing:select')).toEqual([{ id: copy.id, ids: [copy.id] }]);
  });

  it('emits no granular events for a preview', () => {
    const { manager, of, clearEvents } = setup();
    const d = manager.add(line);
    clearEvents();
    manager.preview(d.id, { style: { color: '#f00' } });
    expect(of('drawing:update')).toEqual([]);
    expect(of('drawings:change')).toEqual([]);
    manager.update(d.id, { style: { color: '#0f0' } });
    expect(of('drawing:update')).toMatchObject([{ change: 'style' }]);
  });

  it('treats patching a flag to its default as no change', () => {
    const { manager, of, clearEvents } = setup();
    const d = manager.add(line);
    clearEvents();
    manager.setVisible(d.id, true);
    manager.update(d.id, { selectable: true, persist: true, zIndex: 0, group: '', locked: false });
    expect(of('drawings:change')).toEqual([]);
    expect(of('drawing:update')).toEqual([]);
    expect(of('history:change')).toEqual([]);
    manager.undo();
    expect(manager.getAll()).toEqual([]);
  });

  it('treats re-setting a loaded default flag as no change', () => {
    const { manager, of, clearEvents } = setup();
    manager.load({ version: 1, drawings: [{ ...line, id: 'x', persist: true, selectable: true }] });
    clearEvents();
    manager.update('x', { persist: true, selectable: true, hidden: false });
    expect(of('drawings:change')).toEqual([]);
    expect(manager.canUndo).toBe(false);
  });

  it('stores no default flags and reports clearing a flag as a change', () => {
    const { manager, of } = setup();
    const d = manager.add({ ...line, group: 'g', zIndex: 2 });
    manager.update(d.id, { group: '', zIndex: 0 });
    const stored = manager.getById(d.id)!;
    expect('group' in stored).toBe(false);
    expect('zIndex' in stored).toBe(false);
    expect(of('drawing:update').at(-1)!.changes).toEqual(['order', 'flags']);
  });

  it('keeps a half-built drawing out of commits made while it is drawn', () => {
    const { manager, of } = setup();
    manager.setTool('trendline');
    manager.pointerDown(0, { x: 100, y: 400 });
    manager.pointerUp({ x: 100, y: 400 });
    const other = manager.add(probe());
    expect(of('drawing:create')).toEqual([{ drawing: other }]);
    expect(of('drawings:change').at(-1)!.drawings).toEqual([other]);
    manager.keyDown({ key: 'Escape' } as KeyboardEvent);
    manager.undo();
    expect(manager.getAll()).toEqual([]);
    manager.redo();
    expect(manager.getAll()).toEqual([other]);
  });

  it('keeps a new text drawing out of commits until its text is entered', () => {
    const { manager, host, of, clearEvents } = setup();
    let finish: (text: string | null) => void = () => {};
    host.editText = (_at, _initial, done) => (finish = done);
    manager.setTool('text');
    manager.pointerDown(0, { x: 100, y: 400 });
    const other = manager.add(probe());
    expect(of('drawing:create')).toEqual([{ drawing: other }]);
    expect(of('drawings:change').at(-1)!.drawings).toEqual([other]);
    clearEvents();
    finish('Note');
    expect(of('drawing:create')).toHaveLength(1);
    expect(of('drawing:create')[0]!.drawing.text).toBe('Note');
    manager.undo();
    expect(ids(manager.getAll())).toEqual([other.id]);
  });
});

describe('selection rules', () => {
  it('does not select hidden or unselectable drawings', () => {
    const { manager, of } = setup();
    const hidden = manager.add({ ...line, hidden: true });
    const fixed = manager.add({ ...line, selectable: false });
    manager.select(hidden.id);
    manager.select(fixed.id);
    expect(manager.selected).toBeNull();
    expect(of('drawing:select')).toEqual([]);
    const copy = manager.clone(hidden.id)!;
    expect(copy.hidden).toBe(true);
    expect(manager.selected).toBeNull();
  });
});

describe('input validation', () => {
  it('validates setAccess input', () => {
    const { manager } = setup();
    expect(() => manager.setAccess(['trendline'] as unknown as () => boolean)).toThrow(/function or null/);
    expect(manager.access).toBeNull();
  });

  it('validates flags in add, update and preview', () => {
    const { manager } = setup();
    expect(() => manager.add({ ...line, zIndex: Number.NaN })).toThrow(/zIndex/);
    expect(() => manager.add({ ...line, group: 7 as unknown as string })).toThrow(/group/);
    expect(() => manager.add({ ...line, hidden: 1 as unknown as boolean })).toThrow(/hidden/);
    expect(manager.getAll()).toEqual([]);
    const d = manager.add(line);
    expect(() => manager.update(d.id, { selectable: 'no' as unknown as boolean })).toThrow(/selectable/);
    expect(() => manager.update(d.id, { persist: null as unknown as boolean })).toThrow(/persist/);
    expect(() => manager.update(d.id, { zIndex: Infinity })).toThrow(/zIndex/);
    expect(() => manager.preview(d.id, { group: {} as unknown as string })).toThrow(/group/);
    expect(manager.getById(d.id)).toEqual(d);
  });

  it('rejects a drawing without a pane index, as loading does', () => {
    const { manager } = setup();
    const { pane: _pane, ...noPane } = line;
    for (const input of [noPane, { ...line, pane: -1 }, { ...line, pane: 0.5 }]) {
      expect(() => manager.add(input as typeof line)).toThrow(
        expect.objectContaining({ code: 'invalid-drawings', message: '"pane" must be a pane index' }),
      );
    }
    expect(manager.getAll()).toEqual([]);
  });
});

describe('moving to a position', () => {
  it('moves a drawing to an index among the drawings of its pane', () => {
    const { manager, render } = setup();
    const a = manager.add(probe());
    const other = manager.add(probe(1));
    const b = manager.add(probe());
    const c = manager.add(probe());
    manager.moveTo(a.id, 2);
    expect(render()).toEqual([b.id, c.id, a.id]);
    manager.moveTo(a.id, 1);
    expect(render()).toEqual([b.id, a.id, c.id]);
    manager.moveTo(c.id, -5);
    expect(render()).toEqual([c.id, b.id, a.id]);
    expect(render(1)).toEqual([other.id]);
  });

  it('records one undo step and ignores no-op and non-finite moves', () => {
    const { manager, render, of, clearEvents } = setup();
    const a = manager.add(probe());
    const b = manager.add(probe());
    clearEvents();
    manager.moveTo(a.id, 9);
    manager.moveTo(a.id, 1);
    manager.moveTo(a.id, NaN);
    expect(of('history:change')).toHaveLength(1);
    expect(render()).toEqual([b.id, a.id]);
    manager.undo();
    expect(render()).toEqual([a.id, b.id]);
  });
});

describe('batches', () => {
  it('records the changes of a batch as one undo step with one drawings:change', () => {
    const { manager, of, clearEvents } = setup();
    const a = manager.add(probe());
    const b = manager.add(probe());
    clearEvents();
    manager.batch(() => {
      manager.setVisible(a.id, false);
      manager.batch(() => manager.update(b.id, { locked: true }));
      expect(of('drawings:change')).toHaveLength(0);
      manager.remove(a.id);
    });
    expect(of('drawings:change')).toHaveLength(1);
    expect(of('history:change')).toHaveLength(1);
    expect(of('drawing:remove')).toEqual([{ id: a.id }]);
    expect(of('drawing:update').map((e) => e.change)).toEqual(['lock']);
    manager.undo();
    expect(manager.getById(a.id)?.hidden).toBeUndefined();
    expect(manager.getById(b.id)?.locked).toBeUndefined();
  });

  it('commits what ran before an error, and adds no step for a batch that changes nothing', () => {
    const { manager } = setup();
    const a = manager.add(probe());
    expect(() =>
      manager.batch(() => {
        manager.remove(a.id);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(manager.getAll()).toEqual([]);
    manager.undo();
    manager.undo();
    expect(manager.canUndo).toBe(false);
    manager.batch(() => manager.remove('missing'));
    expect(manager.canUndo).toBe(false);
  });
});

describe('drawing names', () => {
  it('renames as an undoable name change that persists', () => {
    const { manager, of, clearEvents } = setup();
    const a = manager.add(probe());
    clearEvents();
    manager.update(a.id, { name: 'Support' });
    expect(of('drawing:update').map((e) => e.changes)).toEqual([['name']]);
    expect(manager.serialize().drawings[0]!.name).toBe('Support');
    manager.update(a.id, { name: '' });
    expect(manager.getById(a.id)).not.toHaveProperty('name');
    manager.undo();
    expect(manager.getById(a.id)!.name).toBe('Support');
  });

  it('validates names in update and load', () => {
    const { manager } = setup();
    const a = manager.add(probe());
    expect(() => manager.update(a.id, { name: 3 as unknown as string })).toThrow(/name/);
    const result = manager.load({
      version: 1,
      drawings: [
        { ...probe(), id: 'x', name: false },
        { ...probe(), id: 'y', name: 'Kept' },
      ],
    });
    expect(result.errors).toMatchObject([{ index: 0, field: 'name', reason: 'must be a string' }]);
    expect(manager.getById('x')).not.toHaveProperty('name');
    expect(manager.getById('y')!.name).toBe('Kept');
  });
});
