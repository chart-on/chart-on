import { afterEach, describe, expect, it } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { DrawingManager, type DrawingEvents, type DrawingHost } from '../src/drawing/manager';
import type { DrawingPoint } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { withBuiltinTools } from './builtin-tools';

// x = (index - 99) * 10 + 1000, time = index * 60. Pane 0: y 0..500, price = 500 - y.
function setup(host: Partial<DrawingHost> = {}) {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = 100;
  const main = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  main.height = 500;
  main.price.height = 500;
  main.price.fit(0, 500);
  const events: { name: keyof DrawingEvents; payload: unknown }[] = [];
  const manager = withBuiltinTools(new DrawingManager({
    theme: darkTheme,
    timeline,
    time,
    panes: [main],
    magnetPrice: (_i, price) => price,
    formatPrice: (_p, price) => price.toFixed(2),
    requestOverlay: () => {},
    editText: (_at, _initial, done) => done(null),
    emit: (name, payload) => events.push({ name, payload }),
    ...host,
  }));
  const of = (name: keyof DrawingEvents) => events.filter((e) => e.name === name).map((e) => e.payload);
  return { manager, of };
}

const pts = (...pairs: [number, number][]): DrawingPoint[] => pairs.map(([time, price]) => ({ time, price }));

/** A trend line from (x 100, y 400) to (x 300, y 200), shifted right by `dx` px. */
const line = (dx = 0) => ({ type: 'trendline', pane: 0, points: pts([540 + dx * 6, 100], [1740 + dx * 6, 300]), style: {} });

function drag(m: DrawingManager, from: [number, number], to: [number, number], shift = false) {
  m.pointerDown(0, { x: from[0], y: from[1] }, { shift });
  m.pointerMove({ x: to[0], y: to[1] });
  m.pointerUp({ x: to[0], y: to[1] });
}
const click = (m: DrawingManager, x: number, y: number, shift = false) => drag(m, [x, y], [x, y], shift);

describe('drawing groups', () => {
  it('groups the selection under a new default name, as one undo step', () => {
    const { manager, of } = setup();
    const a = manager.add(line());
    const b = manager.add(line(400));
    const c = manager.add(line(600));
    manager.setSelection([a.id, b.id]);
    const changes = of('drawings:change').length;
    expect(manager.group()).toBe('Group 1');
    expect(of('drawings:change')).toHaveLength(changes + 1);
    expect(manager.groups).toEqual([{ name: 'Group 1', ids: [a.id, b.id] }]);
    expect(manager.group([c.id])).toBe('Group 2');
    manager.undo();
    expect(manager.getById(c.id)!.group).toBeUndefined();
    manager.undo();
    expect(manager.groups).toEqual([]);
    expect(manager.group(['nope'])).toBeNull();
    expect(() => manager.group([a.id], '')).toThrow();
  });

  it('names new groups through the host', () => {
    const { manager } = setup({ groupName: (n) => `Gruppe ${n}` });
    const a = manager.add(line());
    expect(manager.group([a.id])).toBe('Gruppe 1');
    expect(manager.group([manager.add(line(400)).id])).toBe('Gruppe 2');
    // A host that repeats itself falls back to the plain names.
    const { manager: other } = setup({ groupName: () => 'Same' });
    other.add({ ...line(), group: 'Same' });
    expect(other.group([other.add(line(400)).id])).toBe('Group 1');
  });

  it('a click selects the whole group, and a drag moves it as one', () => {
    const { manager } = setup();
    const a = manager.add({ ...line(), group: 'g' });
    const b = manager.add({ ...line(400), group: 'g' });
    const c = manager.add(line(600));
    click(manager, 200, 300);
    expect(manager.selection).toEqual([b.id, a.id]);
    expect(manager.selected!.id).toBe(a.id);
    drag(manager, [600, 300], [610, 300]);
    expect(manager.getById(a.id)!.points[0]!.time).toBe(600);
    expect(manager.getById(b.id)!.points[0]!.time).toBe(3000);
    expect(manager.getById(c.id)!.points[0]!.time).toBe(540 + 3600);
    manager.undo();
    expect(manager.getById(a.id)!.points[0]!.time).toBe(540);
  });

  it('shift-click adds and removes the whole group', () => {
    const { manager } = setup();
    const a = manager.add({ ...line(), group: 'g' });
    const b = manager.add({ ...line(400), group: 'g' });
    const c = manager.add(line(600));
    click(manager, 800, 300);
    click(manager, 200, 300, true);
    expect(manager.selection).toEqual([c.id, b.id, a.id]);
    click(manager, 600, 300, true);
    expect(manager.selection).toEqual([c.id]);
    // A plain click on a selected group member leaves only its group selected.
    manager.setSelection([c.id, a.id, b.id]);
    click(manager, 200, 300);
    expect(manager.selection).toEqual([b.id, a.id]);
  });

  it('leaves out hidden members, and select() from code stays exact', () => {
    const { manager } = setup();
    const a = manager.add({ ...line(), group: 'g' });
    manager.add({ ...line(400), group: 'g', hidden: true });
    click(manager, 200, 300);
    expect(manager.selection).toEqual([a.id]);
    const b = manager.add({ ...line(600), group: 'g' });
    manager.select(b.id);
    expect(manager.selection).toEqual([b.id]);
  });

  it('the selection box adds whole groups', () => {
    const { manager } = setup();
    const a = manager.add({ ...line(), group: 'g' });
    const b = manager.add({ ...line(600), group: 'g' });
    drag(manager, [90, 150], [320, 450], true);
    expect(manager.selection).toEqual([b.id, a.id]);
  });

  it('ungroup dissolves the groups of the given drawings', () => {
    const { manager, of } = setup();
    const a = manager.add({ ...line(), group: 'g' });
    const b = manager.add({ ...line(400), group: 'g' });
    const c = manager.add({ ...line(600), group: 'h' });
    manager.setSelection([a.id]);
    const changes = of('drawings:change').length;
    expect(manager.ungroup()).toBe(2);
    expect(of('drawings:change')).toHaveLength(changes + 1);
    expect(manager.getById(b.id)!.group).toBeUndefined();
    expect(manager.groups).toEqual([{ name: 'h', ids: [c.id] }]);
    expect(manager.ungroup([a.id])).toBe(0);
    manager.undo();
    expect(manager.groups.map((g) => g.name)).toEqual(['g', 'h']);
  });

  it('renames groups, merging into a group of the new name', () => {
    const { manager } = setup();
    const a = manager.add({ ...line(), group: 'g' });
    const b = manager.add({ ...line(400), group: 'h' });
    expect(manager.renameGroup('g', 'Levels')).toBe(true);
    expect(manager.getById(a.id)!.group).toBe('Levels');
    expect(manager.renameGroup('h', 'Levels')).toBe(true);
    expect(manager.groups).toEqual([{ name: 'Levels', ids: [a.id, b.id] }]);
    expect(manager.renameGroup('nope', 'x')).toBe(false);
    expect(manager.renameGroup('Levels', 'Levels')).toBe(false);
    expect(() => manager.renameGroup('Levels', '')).toThrow();
  });

  it('pasted copies of a group form a new group; clones leave theirs', () => {
    const { manager } = setup();
    const a = manager.add({ ...line(), group: 'Group 1' });
    const b = manager.add({ ...line(400), group: 'Group 1' });
    const loose = manager.add(line(600));
    manager.copy([a.id, b.id, loose.id]);
    const copies = manager.paste();
    expect(copies.map((d) => d.group)).toEqual(['Group 2', 'Group 2', undefined]);
    expect(manager.getById(a.id)!.group).toBe('Group 1');
    expect(manager.clone(a.id)!.group).toBeUndefined();
  });

  it('duplicate copies in place and leaves what copy() kept alone', () => {
    const { manager, of } = setup();
    const a = manager.add({ ...line(), group: 'Group 1', locked: true });
    const b = manager.add(line(400));
    manager.copy([b.id]);
    const changes = of('drawings:change').length;
    const [copy] = manager.duplicate([a.id]);
    expect(of('drawings:change')).toHaveLength(changes + 1);
    expect(copy).toMatchObject({ group: 'Group 2', points: a.points });
    expect(copy!.locked).toBeUndefined();
    expect(manager.selection).toEqual([copy!.id]);
    expect(manager.paste().map((d) => d.points)).toEqual([b.points]);
    expect(manager.duplicate([])).toEqual([]);
  });
});

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart() {
  const c = new Chart(fakeContainer(), { smoothZoom: false });
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 1000 }, (_, i) => ({ time: i * 60, open: 10, high: 20, low: 0, close: 10 })));
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
  return c;
}
const press = (target: unknown, key: string, extra: Record<string, unknown> = {}) => dispatch(target, 'keydown', { key, code: '', ...extra });
const hline = (price: number) => ({ type: 'hline', pane: 0, points: [{ time: 3000, price }], style: {} });

describe('group and tool actions', () => {
  it('groups with Mod+G and ungroups with Mod+Shift+G', () => {
    const c = chart();
    const a = c.drawings.add(hline(5));
    const b = c.drawings.add(hline(6));
    expect(c.actions.get('group-drawings')!.enabled).toBe(false);
    c.drawings.setSelection([a.id, b.id]);
    expect(press(c.root, 'g', { code: 'KeyG', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(c.drawings.groups).toEqual([{ name: 'Group 1', ids: [a.id, b.id] }]);
    // The selection is that group already.
    expect(c.actions.get('group-drawings')!.enabled).toBe(false);
    expect(press(c.root, 'G', { code: 'KeyG', metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(c.drawings.groups).toEqual([]);
    expect(c.actions.get('ungroup-drawings')!.enabled).toBe(false);
  });

  it('names groups in the chart language', () => {
    const c = new Chart(fakeContainer(), { localization: { messages: { drawingGroupName: 'Gruppe {n}' } } });
    charts.push(c);
    expect(c.drawings.group([c.drawings.add(hline(5)).id])).toBe('Gruppe 1');
  });

  it('has a command per built-in tool that toggles it, with no default keys but bindable', () => {
    const c = chart();
    expect(c.actions.get('draw-trendline')).toMatchObject({ label: 'Draw: Trend line', keys: [], checked: false });
    expect(c.actions.list().filter((a) => a.id.startsWith('draw-') && a.defaultKeys.length > 0)).toEqual([]);
    expect(press(c.root, 'h', { code: 'KeyH', altKey: true }).defaultPrevented).toBe(false);
    // A saved keymap from before the defaults changed keeps working.
    c.actions.setKeymap({ 'draw-hline': ['Alt+H'], 'draw-trendline': ['Alt+T'], 'draw-vline': ['V'] });
    expect(c.actions.conflicts()).toEqual([]);
    expect(press(c.root, 'h', { code: 'KeyH', altKey: true }).defaultPrevented).toBe(true);
    expect(c.drawings.tool).toBe('hline');
    expect(c.actions.get('draw-hline')!.checked).toBe(true);
    press(c.root, 'h', { code: 'KeyH', altKey: true });
    expect(c.drawings.tool).toBeNull();
    // Where Alt types a symbol (Alt+T gives '†' on a common Mac layout), the physical key decides.
    expect(press(c.root, '†', { code: 'KeyT', altKey: true }).defaultPrevented).toBe(true);
    expect(c.drawings.tool).toBe('trendline');
    c.drawings.setTool(null);
    c.drawings.setAccess(({ id }) => id !== 'vline');
    expect(c.actions.get('draw-vline')!.enabled).toBe(false);
    expect(press(c.root, 'v', { code: 'KeyV' }).defaultPrevented).toBe(false);
    expect(c.drawings.tool).toBeNull();
  });
});
