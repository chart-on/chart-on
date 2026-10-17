import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { IntervalRange } from '../src/data/types';
import { DrawingManager, type DrawingEvents, type DrawingHost } from '../src/drawing/manager';
import type { DrawingToolDef } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import type { CandleSeries } from '../src/series';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { withBuiltinTools } from './builtin-tools';

// x = (index - 99) * 10 + 1000, time = index * 60, price = 500 - y (see drawing-selection.test.ts).
function setup(seconds: number | null = 60) {
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
  const state = { seconds };
  const host: DrawingHost = {
    theme: darkTheme,
    timeline,
    time,
    panes: [pane],
    magnetPrice: (_i, price) => price,
    formatPrice: (_p, price) => price.toFixed(2),
    requestOverlay: () => {},
    editText: (_at, _initial, done) => done(null),
    intervalSeconds: () => state.seconds,
    emit: (name, payload) => events.push({ name, payload }),
  };
  const manager = withBuiltinTools(new DrawingManager(host));
  const rendered: string[] = [];
  const base = manager.getTools().find((t) => t.type === 'trendline')!;
  const spy: DrawingToolDef = { ...base, type: 'spy', render: (_ctx, d) => void rendered.push(d.drawing.id) };
  manager.register(spy);
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D;
  const render = () => {
    rendered.length = 0;
    manager.render(ctx, 0, 1000, 500);
    return [...rendered];
  };
  const setInterval = (s: number | null) => {
    state.seconds = s;
    manager.intervalChanged();
  };
  const of = (name: keyof DrawingEvents) => events.filter((e) => e.name === name).map((e) => e.payload);
  return { manager, render, setInterval, of };
}

const line = { type: 'spy', pane: 0, points: [{ time: 540, price: 100 }, { time: 1740, price: 300 }], style: {} };
/** A point on `line`, in plot-space css px. */
const onLine = { x: 200, y: 300 };
const minutes: IntervalRange[] = [{ from: '1m', to: '15m' }];

describe('drawing interval visibility', () => {
  it('draws and hit-tests a drawing only on its intervals', () => {
    const { manager, render, setInterval } = setup(60);
    const d = manager.add({ ...line, visibleOn: minutes });
    expect(render()).toEqual([d.id]);
    expect(manager.drawingAt(onLine)).toBe(d.id);
    expect(manager.hiddenByInterval(d.id)).toBe(false);

    setInterval(3600);
    expect(manager.hiddenByInterval(d.id)).toBe(true);
    expect(render()).toEqual([]);
    expect(manager.drawingAt(onLine)).toBeNull();
    expect(manager.pointerDown(0, onLine)).toBe(false);
    manager.select(d.id);
    expect(manager.selected).toBeNull();
    // Still listed and saved.
    expect(manager.getById(d.id)?.visibleOn).toEqual(minutes);
    expect(manager.serialize().drawings).toHaveLength(1);

    // Both ends are included.
    setInterval(900);
    expect(render()).toEqual([d.id]);
  });

  it('shows every drawing while the interval is unknown, and without ranges', () => {
    const { manager, render } = setup(null);
    const limited = manager.add({ ...line, visibleOn: [{ from: '1d', to: '1d' }] });
    const free = manager.add(line);
    expect(render()).toEqual([limited.id, free.id]);
    expect(manager.hiddenByInterval(limited.id)).toBe(false);
    expect(manager.hiddenByInterval('missing')).toBe(false);
  });

  it('drops the selection and hover when the interval hides the drawing', () => {
    const { manager, setInterval, of } = setup(60);
    const d = manager.add({ ...line, visibleOn: minutes });
    manager.pointerMove(onLine);
    expect(manager.isHovering).toBe(true);
    manager.select(d.id);
    setInterval(86400);
    expect(manager.selected).toBeNull();
    expect(manager.isHovering).toBe(false);
    expect(of('drawing:select').at(-1)).toEqual({ id: null, ids: [] });
  });

  it('keeps drawings off their intervals out of multi-selection', () => {
    const { manager, setInterval } = setup(60);
    const limited = manager.add({ ...line, visibleOn: minutes });
    const free = manager.add(line);
    manager.setSelection([limited.id, free.id]);
    expect(manager.selection).toEqual([limited.id, free.id]);
    setInterval(86400);
    expect(manager.selection).toEqual([free.id]);
    manager.setSelection([limited.id, free.id]);
    expect(manager.selection).toEqual([free.id]);
  });

  it('changes visibility in one undo step, with a visibility update', () => {
    const { manager, render, of } = setup(3600);
    const d = manager.add(line);
    const steps = of('history:change').length;
    manager.setVisibleOn(d.id, minutes);
    expect(of('history:change').length).toBe(steps + 1);
    expect(of('drawing:update').at(-1)).toMatchObject({ change: 'visibility', changes: ['visibility'] });
    expect(render()).toEqual([]);

    expect(manager.undo()).toBe(true);
    expect(manager.getById(d.id)?.visibleOn).toBeUndefined();
    expect(render()).toEqual([d.id]);
    expect(manager.redo()).toBe(true);
    expect(manager.getById(d.id)?.visibleOn).toEqual(minutes);

    // The same ranges again are no change.
    const before = of('history:change').length;
    manager.setVisibleOn(d.id, [{ from: '1m', to: '15m' }]);
    expect(of('history:change').length).toBe(before);
  });

  it('clears the ranges with null or an empty list', () => {
    const { manager } = setup();
    const d = manager.add({ ...line, visibleOn: [] });
    expect('visibleOn' in manager.getById(d.id)!).toBe(false);
    manager.setVisibleOn(d.id, minutes);
    manager.setVisibleOn(d.id, []);
    expect('visibleOn' in manager.getById(d.id)!).toBe(false);
    manager.update(d.id, { visibleOn: minutes });
    manager.update(d.id, { visibleOn: null });
    expect('visibleOn' in manager.getById(d.id)!).toBe(false);
  });

  it('keeps the ranges a copy, and on clones', () => {
    const { manager } = setup();
    const ranges: IntervalRange[] = [{ from: '1m', to: '15m' }];
    const d = manager.add({ ...line, visibleOn: ranges });
    ranges[0]!.to = '1d';
    manager.getById(d.id)!.visibleOn![0]!.to = '1d';
    expect(manager.getById(d.id)?.visibleOn).toEqual(minutes);
    expect(manager.clone(d.id)?.visibleOn).toEqual(minutes);
  });

  it('rejects invalid ranges in add, update and setVisibleOn', () => {
    const { manager } = setup();
    expect(() => manager.add({ ...line, visibleOn: [{ from: '1h', to: '1m' }] })).toThrow(/visibleOn\[0\]/);
    expect(manager.getAll()).toHaveLength(0);
    const d = manager.add(line);
    const bad = [{ from: '1m', to: '1h' }, { from: '1x', to: '1h' }] as unknown as IntervalRange[];
    expect(() => manager.setVisibleOn(d.id, bad)).toThrow(/visibleOn\[1\]/);
    expect(() => manager.update(d.id, { visibleOn: '1m' as unknown as IntervalRange[] })).toThrow(/must be an array/);
    expect(manager.getById(d.id)?.visibleOn).toBeUndefined();
  });

  it('round-trips through serialize and load, dropping invalid saved ranges', () => {
    const { manager, render } = setup(60);
    const d = manager.add({ ...line, visibleOn: [{ from: '1d', to: '1w' }] });
    const saved = JSON.parse(JSON.stringify(manager.serialize()));
    expect(saved.drawings[0].visibleOn).toEqual([{ from: '1d', to: '1w' }]);

    const other = setup(60);
    expect(other.manager.load(saved).errors).toEqual([]);
    expect(other.manager.getById(d.id)?.visibleOn).toEqual([{ from: '1d', to: '1w' }]);
    expect(other.render()).toEqual([]);

    const raw = { ...saved.drawings[0], id: 'b', visibleOn: [{ from: '1h', to: '1m' }, { from: '1m', to: '5m' }, 'x'] };
    const notArray = { ...saved.drawings[0], id: 'c', visibleOn: { from: '1m', to: '5m' } };
    const allBad = { ...saved.drawings[0], id: 'e', visibleOn: [{ from: '0m', to: '5m' }] };
    const { loaded, errors } = manager.load({ version: 1, drawings: [raw, notArray, allBad] });
    expect(loaded).toBe(3);
    expect(errors.map((e) => [e.index, e.field])).toEqual([
      [0, 'visibleOn[0]'],
      [0, 'visibleOn[2]'],
      [1, 'visibleOn'],
      [2, 'visibleOn[0]'],
    ]);
    expect(manager.getById('b')?.visibleOn).toEqual([{ from: '1m', to: '5m' }]);
    expect(manager.getById('c')?.visibleOn).toBeUndefined();
    expect(manager.getById('e')?.visibleOn).toBeUndefined();
    expect(render()).toEqual(['b', 'c', 'e']);
  });
});

describe('drawing interval visibility on a chart', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  const minuteBars = Array.from({ length: 10 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 + i }));
  const dailyBars = minuteBars.map((b, i) => ({ ...b, time: i * 86400 }));

  it('follows the interval of the bars the app sets', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    const series = c.addCandles();
    series.setData(minuteBars);
    const d = c.drawings.add({ type: 'hline', pane: 0, points: [{ time: 0, price: 1 }], style: {}, visibleOn: [{ from: '1d', to: '1d' }] });
    c.drawings.select(d.id);
    expect(c.drawings.hiddenByInterval(d.id)).toBe(true);
    expect(c.drawings.selected).toBeNull();

    (series as CandleSeries).setData(dailyBars);
    expect(c.drawings.hiddenByInterval(d.id)).toBe(false);
    c.drawings.select(d.id);
    expect(c.drawings.selected?.id).toBe(d.id);
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);

    (series as CandleSeries).setData(minuteBars);
    expect(c.drawings.selected).toBeNull();
  });
});
