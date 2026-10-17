import { afterEach, describe, expect, it, vi } from 'vitest';
import { emojiTool } from '../src/drawing/emoji-tool';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import type { Drawing, DrawingEnv, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { darkTheme } from '../src/theme';
import { Timeline } from '../src/timeline';
import type { Point } from '../src/types';

/** Glyphs measure `aspect` times their size wide; data coordinates are pane pixels. */
const env = (aspect = 1): DrawingEnv => ({
  width: 800,
  height: 400,
  theme: darkTheme,
  pixelRatio: 1,
  formatPrice: (p) => p.toFixed(2),
  priceToY: (price) => price,
  yToPrice: (y) => y,
  timeToX: (time) => time,
  xToTime: (x) => x,
  barsBetween: () => 0,
  bars: () => [],
  measureText: (_t, size) => size * aspect,
});

const C = { x: 200, y: 100 };

const emoji = (style: Drawing['style'] = {}): Drawing => ({ id: 'e', type: 'emoji', pane: 0, points: [{ time: C.x, price: C.y }], style, text: '🚀' });

const screen = (style: Drawing['style'] = {}): ScreenDrawing => ({ drawing: emoji(style), points: [C], selected: true, hovered: false });

/** The style after dragging handle `index` to `at`. */
function drag(style: Drawing['style'], index: number, at: Point, aspect = 1) {
  const moved = emojiTool.moveHandle!(emoji(style), index, { time: at.x, price: at.y }, at, env(aspect));
  return (moved as { style: Drawing['style'] }).style;
}

describe('emoji tool', () => {
  it('puts the size handle on the lower right corner and the rotation handle above the glyph', () => {
    // 32 px glyph: the box reaches 16 + 3 px from its centre; the rotation handle stands 18 px above it.
    expect(emojiTool.handles!(screen(), env())).toEqual([
      { x: 219, y: 119 },
      { x: 200, y: 63 },
    ]);
    const [size, turn] = emojiTool.handles!(screen({ angle: 90 }), env());
    expect(size!.x).toBeCloseTo(181);
    expect(size!.y).toBeCloseTo(119);
    expect(turn!.x).toBeCloseTo(237);
    expect(turn!.y).toBeCloseTo(100);
  });

  it('sizes the glyph so its corner follows the pointer', () => {
    for (const aspect of [1, 2.5]) {
      for (const fontSize of [12, 54, 200]) {
        const [corner] = emojiTool.handles!(screen({ fontSize }), env(aspect));
        expect(drag({}, 0, corner!, aspect).fontSize).toBe(fontSize);
      }
    }
    // Rotated, the corner moves with the glyph.
    const [corner] = emojiTool.handles!(screen({ fontSize: 40, angle: 30 }), env());
    expect(drag({ angle: 30 }, 0, corner!).fontSize).toBe(40);
    // Clamped to 8..512 px.
    expect(drag({}, 0, C).fontSize).toBe(8);
    expect(drag({}, 0, { x: 5000, y: 5000 }).fontSize).toBe(512);
  });

  it('turns the glyph towards the pointer in whole degrees, keeping its size', () => {
    expect(drag({ fontSize: 40 }, 1, { x: 200, y: 0 })).toEqual({ fontSize: 40, angle: 0 });
    expect(drag({}, 1, { x: 300, y: 100 }).angle).toBe(90);
    expect(drag({}, 1, { x: 100, y: 100 }).angle).toBe(-90);
    expect(drag({}, 1, { x: 200, y: 300 }).angle).toBe(-180);
    expect(drag({}, 1, { x: 300, y: 0.4 }).angle).toBe(45);
    // The rotation handle lands back under the pointer.
    for (const angle of [-135, -20, 0, 70, 160]) {
      const [, turn] = emojiTool.handles!(screen({ angle }), env());
      expect(drag({}, 1, turn!).angle).toBe(angle);
    }
  });

  it('hit-tests and bounds the rotated box', () => {
    // A glyph three times as wide as tall: 51 px to the side, 19 px up and down.
    const wide = env(3);
    expect(emojiTool.hitTest(screen(), { x: 245, y: 100 }, wide)).toBe(true);
    expect(emojiTool.hitTest(screen(), { x: 200, y: 125 }, wide)).toBe(false);
    expect(emojiTool.hitTest(screen({ angle: 90 }), { x: 245, y: 100 }, wide)).toBe(false);
    expect(emojiTool.hitTest(screen({ angle: 90 }), { x: 200, y: 145 }, wide)).toBe(true);
    expect(emojiTool.bounds!(screen(), wide)).toEqual({ x: 149, y: 81, width: 102, height: 38 });
    const b = emojiTool.bounds!(screen({ angle: 90 }), wide)!;
    expect([b.x, b.y, b.width, b.height].map(Math.round)).toEqual([181, 49, 38, 102]);
  });
});

describe('emoji tool in a chart', () => {
  afterEach(() => vi.unstubAllGlobals());

  // x = (index - 99) * 10 + 1000 with time = index * 60, and price = 500 - y.
  function setup() {
    // No canvas to measure with: text is 0.6 of the size wide per character, so '🚀' (two) is 1.2.
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
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
      magnetPrice: (_i, price) => price,
      formatPrice: (_p, price) => price.toFixed(2),
      requestOverlay: () => {},
      editText: (_at, _initial, done) => done('🚀'),
      emit: () => {},
      barSpan: () => ({ bars: [], start: 0, end: 0 }),
    };
    const manager = new DrawingManager(host);
    manager.register(emojiTool);
    return manager;
  }

  function dragFrom(manager: DrawingManager, from: Point, to: Point) {
    manager.pointerMove(from);
    expect(manager.pointerDown(0, from)).toBe(true);
    manager.pointerMove(to);
    manager.pointerUp(to);
  }

  it('places with the glyph as text, resizes and rotates by handles, and undoes each drag', () => {
    const manager = setup();
    manager.setTool('emoji');
    manager.pointerMove({ x: 510, y: 250 });
    manager.pointerDown(0, { x: 510, y: 250 });
    manager.pointerUp({ x: 510, y: 250 });
    const placed = manager.getAll()[0]!;
    expect(placed).toMatchObject({ type: 'emoji', text: '🚀', style: { fontSize: 32 } });
    manager.select(placed.id);

    // The corner of a 32 px glyph 1.2 times as wide sits 19.2 + 3 px right and 16 + 3 px down; a 64 px one 41.4 and 35.
    expect(manager.cursor({ x: 532.2, y: 269 })).toBe('nwse-resize');
    dragFrom(manager, { x: 532.2, y: 269 }, { x: 551.4, y: 285 });
    expect(manager.getAll()[0]!.style).toEqual({ fontSize: 64 });
    expect(manager.getAll()[0]!.points).toEqual(placed.points);

    // The rotation handle stands 32 + 3 + 18 px above the centre; drag it to the right.
    expect(manager.cursor({ x: 510, y: 197 })).toBe('grab');
    dragFrom(manager, { x: 510, y: 197 }, { x: 600, y: 250 });
    expect(manager.getAll()[0]!.style).toEqual({ fontSize: 64, angle: 90 });

    manager.undo();
    expect(manager.getAll()[0]!.style).toEqual({ fontSize: 64 });
    manager.undo();
    expect(manager.getAll()[0]!.style).toEqual({ fontSize: 32 });
  });

  it('serializes size, angle and glyph, and drops an angle that is not a number', () => {
    const manager = setup();
    manager.add({ type: 'emoji', pane: 0, points: [{ time: 3000, price: 250 }], style: { fontSize: 48, angle: -30 }, text: '🎯' });
    const other = setup();
    other.load(JSON.parse(JSON.stringify(manager.serialize())));
    expect(other.getAll()).toEqual(manager.getAll());

    const saved = manager.serialize();
    const result = other.load({ ...saved, drawings: [{ ...saved.drawings[0]!, style: { fontSize: 48, angle: 'up' } }] });
    expect(result.errors).toEqual([{ index: 0, field: 'style.angle', reason: 'must be a finite number' }]);
    expect(other.getAll()[0]!.style).toEqual({ fontSize: 48 });
    expect(() => manager.add({ type: 'emoji', pane: 0, points: [{ time: 0, price: 0 }], style: { angle: Infinity } })).toThrow('style.angle');
  });
});
