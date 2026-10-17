import { describe, expect, it, vi } from 'vitest';
import { DRAWINGS_VERSION, DrawingManager, migrateDrawings, type DrawingEvents, type DrawingHost } from '../src/drawing/manager';
import type { DrawingToolDef } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { withBuiltinTools } from './builtin-tools';

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
  const events: { name: keyof DrawingEvents; payload: unknown }[] = [];
  const requestOverlay = vi.fn();
  const host: DrawingHost = {
    theme: darkTheme,
    timeline,
    time,
    panes: [pane],
    magnetPrice: (_i, price) => price,
    formatPrice: (_p, price) => price.toFixed(2),
    requestOverlay,
    editText: (_at, _initial, done) => done(null),
    emit: (name, payload) => events.push({ name, payload }),
  };
  return { manager: withBuiltinTools(new DrawingManager(host)), events, requestOverlay };
}

const line = (id: string) => ({
  id,
  type: 'trendline',
  pane: 0,
  points: [
    { time: 600, price: 100 },
    { time: 1800, price: 300 },
  ],
  style: {},
});

describe('DrawingManager.load', () => {
  it('loads the valid drawings and reports the invalid one', () => {
    const { manager, events } = setup();
    const result = manager.load({ version: 1, drawings: [line('a'), { ...line('b'), points: [{ time: 'x' }] }, line('c')] });
    expect(result.loaded).toBe(2);
    expect(result.errors).toEqual([{ index: 1, reason: expect.stringContaining('point') }]);
    expect(manager.getAll().map((d) => d.id)).toEqual(['a', 'c']);
    expect(events.find((e) => e.name === 'drawings:invalid')?.payload).toEqual({ errors: result.errors });
  });

  it('skips drawings with too few points, so render and hit testing do not throw', () => {
    const { manager } = setup();
    const result = manager.load({
      version: 1,
      drawings: [
        { ...line('empty'), points: [] },
        { ...line('short'), points: [{ time: 600, price: 100 }] },
        { ...line('plugin'), type: 'my-lib/unknown', points: [] },
        { ...line('ok'), type: 'my-lib/unknown', points: [{ time: 600, price: 100 }] },
      ],
    });
    expect(result.errors.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(result.errors[1]!.reason).toMatch(/2 points/);
    expect(manager.getAll().map((d) => d.id)).toEqual(['ok']);
    const ctx = new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D;
    expect(() => manager.render(ctx, 0, 1000, 500)).not.toThrow();
    expect(() => manager.drawingAt({ x: 100, y: 100 })).not.toThrow();
  });

  it('skips a drawing whose pane is not an integer', () => {
    const { manager } = setup();
    const result = manager.load({ version: 1, drawings: [{ ...line('a'), pane: 0.5 }, line('b')] });
    expect(result.errors).toEqual([{ index: 0, reason: expect.stringContaining('pane') }]);
    expect(manager.getAll().map((d) => d.id)).toEqual(['b']);
  });

  it('starts a fresh history: nothing to undo after a load', () => {
    const { manager } = setup();
    manager.add(line('a'));
    expect(manager.canUndo).toBe(true);
    manager.load({ version: 1, drawings: [line('b')] });
    expect(manager.canUndo).toBe(false);
    expect(manager.canRedo).toBe(false);
  });

  it('reports ill-typed flags and text it drops, and still loads the drawing', () => {
    const { manager } = setup();
    const raw = { ...line('a'), locked: 'true', hidden: 1, zIndex: 'top', group: 7, selectable: false, text: 3 };
    const result = manager.load({ version: 1, drawings: [raw] });
    expect(result.loaded).toBe(1);
    expect(result.errors.map((e) => e.field)).toEqual(['text', 'locked', 'zIndex', 'hidden', 'group']);
    expect(result.errors.every((e) => e.index === 0)).toBe(true);
    const d = manager.getAll()[0]!;
    expect(d.locked).toBeUndefined();
    expect(d.hidden).toBeUndefined();
    expect(d.selectable).toBe(false);
  });

  it('reports ill-typed style fields it drops', () => {
    const { manager } = setup();
    const style = { lineWidth: -1, color: '#fff', levels: [{ value: 0.5 }, { value: 'x' }] };
    const result = manager.load({ version: 1, drawings: [{ ...line('a'), style }] });
    expect(result.loaded).toBe(1);
    expect(result.errors).toEqual([
      { index: 0, field: 'style.lineWidth', reason: expect.any(String) },
      { index: 0, field: 'style.levels[1]', reason: expect.any(String) },
    ]);
    expect(manager.getAll()[0]!.style).toEqual({ color: '#fff', levels: [{ value: 0.5 }] });
  });

  it('reports malformed entries and duplicate ids by index', () => {
    const { manager, events } = setup();
    const result = manager.load({ version: 1, drawings: [null, { ...line('a'), id: 3 }, { ...line('b'), pane: -1 }, line('c'), line('c')] });
    expect(result.errors.map((e) => e.index)).toEqual([0, 1, 2, 4]);
    expect(result.errors[3]!.reason).toMatch(/duplicate/);
    expect(result.loaded).toBe(1);
    expect(events.filter((e) => e.name === 'drawings:invalid')).toHaveLength(1);
  });

  it('emits no drawings:invalid when everything loads', () => {
    const { manager, events } = setup();
    expect(manager.load({ version: 1, drawings: [line('a')] })).toEqual({ loaded: 1, errors: [] });
    expect(events.some((e) => e.name === 'drawings:invalid')).toBe(false);
  });

  it('throws, changing nothing, on a payload that is not drawings at all', () => {
    const { manager } = setup();
    manager.load({ version: 1, drawings: [line('a')] });
    expect(() => manager.load(null)).toThrow();
    expect(() => manager.load({ version: 1, drawings: 'none' })).toThrow();
    expect(() => manager.load({ version: 7, drawings: [] })).toThrow(/version 7/);
    expect(manager.getAll().map((d) => d.id)).toEqual(['a']);
  });

  it('drops ill-typed style fields and keeps the rest', () => {
    const { manager } = setup();
    const style = {
      color: 5,
      fill: '#123',
      lineWidth: 'wide',
      fontSize: Number.NaN,
      lineStyle: 'wavy',
      bold: 'yes',
      italic: true,
      levels: [{ value: 0.5, color: '#f00', visible: 'no', label: 'half' }, { value: 'half' }, null],
      custom: { plugin: 1 },
    };
    manager.load({ version: 1, drawings: [{ ...line('a'), style }] });
    // Unknown keys, top-level or on a level, are kept for plugin tools.
    expect(manager.getAll()[0]!.style).toEqual({
      fill: '#123',
      italic: true,
      levels: [{ value: 0.5, color: '#f00', label: 'half' }],
      custom: { plugin: 1 },
    });
  });

  it('drops levels that are not an array', () => {
    const { manager } = setup();
    manager.load({ version: 1, drawings: [{ ...line('a'), style: { levels: 'all', lineWidth: 2 } }] });
    expect(manager.getAll()[0]!.style).toEqual({ lineWidth: 2 });
  });

  it('keeps a drawing of an unregistered tool through load and serialize', () => {
    const { manager, requestOverlay } = setup();
    const plugin = { ...line('p'), type: 'my-lib/zigzag', style: { color: '#abc' } };
    manager.load({ version: 1, drawings: [plugin, line('a')] });
    expect(manager.serialize().drawings.find((d) => d.id === 'p')).toEqual(plugin);
    // Registering the tool later redraws, so the waiting drawing appears.
    requestOverlay.mockClear();
    const tool: DrawingToolDef = { type: 'my-lib/zigzag', label: 'Zigzag', points: 2, render: () => {}, hitTest: () => false };
    manager.register(tool);
    expect(requestOverlay).toHaveBeenCalled();
  });
});

describe('drawing migrations', () => {
  // A pretend format 2 that renamed `points` to `anchors`.
  const toV2 = (data: Record<string, unknown>) => ({
    version: 2,
    drawings: (data.drawings as Record<string, unknown>[]).map(({ points, ...d }) => ({ ...d, anchors: points })),
  });

  it('upgrades a v1 payload step by step to the current version', () => {
    const v1 = { version: 1, drawings: [line('a')] };
    const out = migrateDrawings(v1, 2, { 1: toV2 });
    expect(out.version).toBe(2);
    expect((out.drawings as Record<string, unknown>[])[0]!.anchors).toEqual(line('a').points);
  });

  it('runs the hook once for versions the steps do not cover, then continues with the steps', () => {
    const hook = vi.fn((data: Record<string, unknown>) => ({ version: 1, drawings: data.items }));
    const out = migrateDrawings({ version: 'legacy', items: [line('a')] }, 2, { 1: toV2 }, hook);
    expect(hook).toHaveBeenCalledWith({ version: 'legacy', items: [line('a')] }, 'legacy');
    expect(hook).toHaveBeenCalledTimes(1);
    expect(out.version).toBe(2);
  });

  it('throws when a step does not produce a newer version', () => {
    const stuck = (data: Record<string, unknown>) => data;
    expect(() => migrateDrawings({ version: 1, drawings: [] }, 3, { 1: stuck })).toThrow(/version 1/);
    const up = (data: Record<string, unknown>) => ({ ...data, version: 2 });
    const back = (data: Record<string, unknown>) => ({ ...data, version: 1 });
    expect(() => migrateDrawings({ version: 1, drawings: [] }, 3, { 1: up, 2: back })).toThrow(/version 2/);
  });

  it('throws when nothing upgrades the payload, and never calls the hook twice', () => {
    expect(() => migrateDrawings({ version: 0, drawings: [] }, 2, {})).toThrow(/version 0/);
    const hook = vi.fn((data: Record<string, unknown>) => data);
    expect(() => migrateDrawings({ version: 0, drawings: [] }, 2, {}, hook)).toThrow(/version 0/);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('loads a v1 payload through a v2 migration', () => {
    const { manager } = setup();
    // A pretend format 2 that renamed the trend line tool from "trend".
    const rename = (data: Record<string, unknown>) => ({
      version: 2,
      drawings: (data.drawings as Record<string, unknown>[]).map((d) => ({ ...d, type: d.type === 'trend' ? 'trendline' : d.type })),
    });
    const formats = manager as unknown as { formatVersion: number; migrations: Record<number, unknown> };
    formats.formatVersion = 2;
    formats.migrations = { 1: rename };
    const result = manager.load({ version: 1, drawings: [{ ...line('a'), type: 'trend' }] });
    expect(result).toEqual({ loaded: 1, errors: [] });
    expect(manager.getAll()[0]!.type).toBe('trendline');
    // A payload already at the current version is read as it is.
    expect(manager.load({ version: 2, drawings: [line('b')] }).loaded).toBe(1);
  });

  it('loads an app format through the manager hook', () => {
    const { manager } = setup();
    manager.migrate = (data, from) => (from === undefined ? { version: DRAWINGS_VERSION, drawings: data.list } : data);
    expect(manager.load({ list: [line('a')] }).loaded).toBe(1);
    expect(manager.getAll()[0]!.id).toBe('a');
  });
});

describe('DrawingManager style validation', () => {
  it('update() and add() reject ill-typed style fields, as they do flags', () => {
    const { manager } = setup();
    manager.add(line('a'));
    expect(() => manager.update('a', { style: { lineWidth: -1 } })).toThrow(/lineWidth/);
    expect(() => manager.update('a', { style: { lineStyle: 'wavy' as never } })).toThrow(/lineStyle/);
    expect(() => manager.update('a', { style: { levels: [{ value: Number.NaN }] } })).toThrow(/levels/);
    expect(() => manager.update('a', { locked: 'true' as never })).toThrow(/locked/);
    expect(() => manager.add({ ...line('b'), style: { color: 5 as never } })).toThrow(/color/);
    expect(manager.getAll().map((d) => d.id)).toEqual(['a']);
    expect(manager.getAll()[0]!.style).toEqual({});
    manager.update('a', { style: { lineWidth: 2, custom: 1 } as never });
    expect(manager.getAll()[0]!.style).toEqual({ lineWidth: 2, custom: 1 });
  });
});
