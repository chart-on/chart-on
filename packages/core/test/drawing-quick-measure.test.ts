import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrawingManager, type DrawingEvents, type DrawingHost } from '../src/drawing/manager';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { withBuiltinTools } from './builtin-tools';

// x = (index - 99) * 10 + 1000, time = index * 60. Pane 0: y 0..500, price = 500 - y.
function setup(quickMeasure = true) {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = 100;
  const main = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  main.height = 500;
  main.price.height = 500;
  main.price.fit(0, 500);
  const events: (keyof DrawingEvents)[] = [];
  let overlays = 0;
  const host: DrawingHost = {
    theme: darkTheme,
    timeline,
    time,
    panes: [main],
    magnetPrice: (_i, price) => price,
    formatPrice: (_p, price) => price.toFixed(2),
    requestOverlay: () => overlays++,
    editText: (_at, _initial, done) => done(null),
    emit: (name) => events.push(name),
  };
  const manager = withBuiltinTools(new DrawingManager(host));
  manager.quickMeasure = quickMeasure;
  return { manager, events, overlays: () => overlays };
}

function click(m: DrawingManager, x: number, y: number, shift = false) {
  const taken = m.pointerDown(0, { x, y }, { shift });
  m.pointerUp({ x, y }, false, { shift });
  return taken;
}

/** The texts the manager writes for pane 0, with a stand-in canvas for measuring and drawing. */
function texts(m: DrawingManager): string[] {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ font: '', measureText: (t: string) => ({ width: t.length * 6 }) }) }) });
  const out: string[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => (key === 'fillText' ? (text: string) => out.push(text) : key in target ? target[key] : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  m.render(ctx, 0, 1000, 500);
  return out;
}

/** Just enough of a key event for `keyDown`. */
const escape = { key: 'Escape' } as KeyboardEvent;

afterEach(() => vi.unstubAllGlobals());

describe('quick measure', () => {
  it('shift+click starts a measurement that follows the pointer, a click fixes it and the next clears it', () => {
    const { manager } = setup();
    expect(click(manager, 500, 300, true)).toBe(true);
    manager.pointerMove({ x: 600, y: 200 });
    // 200 to 300 is +50%; 10 bars.
    expect(texts(manager).join(' ')).toMatch(/50\.00%.*10 bars/);
    expect(click(manager, 600, 200)).toBe(true);
    manager.pointerMove({ x: 900, y: 100 });
    expect(texts(manager).join(' ')).toMatch(/50\.00%.*10 bars/);
    expect(click(manager, 900, 100)).toBe(true);
    expect(texts(manager)).toEqual([]);
  });

  it('Escape clears it', () => {
    const { manager } = setup();
    click(manager, 500, 300, true);
    expect(manager.keyDown(escape)).toBe(true);
    expect(texts(manager)).toEqual([]);
    expect(manager.keyDown(escape)).toBe(false);
  });

  it('is not a drawing: not saved, copied or undoable, and fires no change', () => {
    const { manager, events } = setup();
    const saved = JSON.stringify(manager.serialize());
    click(manager, 500, 300, true);
    manager.pointerMove({ x: 600, y: 200 });
    click(manager, 600, 200);
    expect(manager.getAll()).toEqual([]);
    expect(JSON.stringify(manager.serialize())).toBe(saved);
    expect(manager.canUndo).toBe(false);
    expect(manager.copy()).toBe(0);
    expect(events.filter((e) => e === 'drawings:change')).toEqual([]);
  });

  it('shift+drag still draws a selection box', () => {
    const { manager } = setup();
    const line = manager.add({ type: 'trendline', pane: 0, points: [{ time: 5340, price: 200 }, { time: 5700, price: 220 }], style: {} });
    manager.pointerDown(0, { x: 400, y: 100 }, { shift: true });
    manager.pointerMove({ x: 1000, y: 400 }, { shift: true });
    manager.pointerUp({ x: 1000, y: 400 }, false, { shift: true });
    expect(manager.selection).toEqual([line.id]);
    expect(texts(manager).join(' ')).not.toMatch(/bars/);
  });

  it('is off by default, and picking a tool clears it', () => {
    const off = setup(false).manager;
    expect(click(off, 500, 300, true)).toBe(false);
    expect(texts(off)).toEqual([]);
    const { manager } = setup();
    click(manager, 500, 300, true);
    manager.setTool('trendline');
    expect(texts(manager)).toEqual([]);
  });
});
