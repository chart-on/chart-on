import { describe, expect, it } from 'vitest';
import { crossLine, horizontalRay } from '../src/drawing/line-tools';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import { horizontalLine, verticalLine } from '../src/drawing/tools';
import type { DrawingEnv, DrawingStyle, DrawingToolDef, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { darkTheme } from '../src/theme';
import { Timeline } from '../src/timeline';
import { withBuiltinTools } from './builtin-tools';

/** x = time / 6, y = 400 - price, in an 800 × 400 pane; labels measure 6 px per character at 10 px. */
const env: DrawingEnv = {
  width: 800,
  height: 400,
  theme: darkTheme,
  pixelRatio: 1,
  formatPrice: (p) => p.toFixed(2),
  formatTime: (t) => `t${t}`,
  priceToY: (price) => 400 - price,
  yToPrice: (y) => 400 - y,
  timeToX: (time) => time / 6,
  xToTime: (x) => x * 6,
  barsBetween: () => 0,
  bars: () => [],
  measureText: (t, size) => t.length * size * 0.6,
};

function screen(type: string, style: DrawingStyle, time = 1200, price = 150): ScreenDrawing {
  return {
    drawing: { id: 'x', type, pane: 0, points: [{ time, price }], style },
    points: [{ x: time / 6, y: 400 - price }],
    selected: false,
    hovered: false,
  };
}

interface Drawn {
  text: string;
  x: number;
  y: number;
}

/** Texts a tool draws, with where. */
function texts(tool: DrawingToolDef, d: ScreenDrawing, e: DrawingEnv = env): Drawn[] {
  const out: Drawn[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => (key === 'fillText' ? (text: string, x: number, y: number) => out.push({ text, x, y }) : key in target ? target[key] : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  tool.render(ctx, d, e);
  return out;
}

const added = [verticalLine, horizontalRay, crossLine];

describe('reference line labels', () => {
  it('offer the same fields as the horizontal line, with the new labels off by default', () => {
    for (const tool of [horizontalLine, ...added]) {
      expect(tool.styleFields, tool.type).toEqual(['color', 'lineWidth', 'lineStyle', 'showLabel', 'textColor', 'fontSize', 'bold', 'italic']);
    }
    expect(horizontalLine.defaultStyle?.showLabel).toBeUndefined();
    for (const tool of added) expect(tool.defaultStyle, tool.type).toEqual({ showLabel: false });
  });

  it('draw nothing but the lines unless showLabel is true, so saved drawings keep their look', () => {
    for (const tool of added) {
      expect(texts(tool, screen(tool.type, {})), tool.type).toEqual([]);
      expect(texts(tool, screen(tool.type, { showLabel: false })), tool.type).toEqual([]);
    }
    // The horizontal line keeps its label on unless turned off.
    expect(texts(horizontalLine, screen('hline', {})).map((t) => t.text)).toEqual(['150.00']);
  });

  it('labels a vertical line with its time along the bottom, kept inside the pane', () => {
    const [label] = texts(verticalLine, screen('vline', { showLabel: true }));
    // The pill is centred on the line, drawn crisp at x 200.5; its text starts 5 px in.
    const w = env.measureText('t1200', darkTheme.fontSize) + 10;
    expect(label!.text).toBe('t1200');
    expect(label!.x).toBe(200.5 - w / 2 + 5);
    expect(label!.y).toBeGreaterThan(380);
    expect(texts(verticalLine, screen('vline', { showLabel: true }, 0))[0]!.x).toBe(7);
    expect(texts(verticalLine, screen('vline', { showLabel: true }), { ...env, formatTime: undefined })).toEqual([]);
  });

  it('labels a horizontal ray with its price at the right edge, like a horizontal line', () => {
    const ray = texts(horizontalRay, screen('horizontal-ray', { showLabel: true }));
    expect(ray).toEqual(texts(horizontalLine, screen('hline', {})));
    expect(ray[0]!.x).toBeGreaterThan(700);
  });

  it('labels a cross line with its price and its time', () => {
    const drawn = texts(crossLine, screen('cross-line', { showLabel: true }));
    expect(drawn.map((t) => t.text)).toEqual(['150.00', 't1200']);
  });
});

describe('reference lines in the manager', () => {
  function manager(formatTime?: (t: number) => string) {
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
      formatPrice: (_p, price) => String(price),
      formatTime,
      requestOverlay: () => {},
      editText: (_at, _initial, done) => done(null),
      emit: () => {},
    };
    return withBuiltinTools(new DrawingManager(host));
  }

  it("hands tools the host's time format", () => {
    const m = manager((t) => `at ${t}`);
    let seen: DrawingEnv | null = null;
    m.register({ type: 'probe', label: 'Probe', points: 1, render: (_ctx, _d, e) => (seen = e), hitTest: () => false });
    m.add({ type: 'probe', pane: 0, points: [{ time: 60, price: 1 }], style: {} });
    m.render(new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D, 0, 1000, 500);
    expect((seen as unknown as DrawingEnv).formatTime!(120)).toBe('at 120');
  });

  it('start new labels off, save the switch, and label the axes at the anchor', () => {
    const a = manager();
    for (const type of ['vline', 'horizontal-ray', 'cross-line']) {
      const d = a.add({ type, pane: 0, points: [{ time: 600, price: 100 }], style: {} });
      expect(d.style.showLabel, type).toBe(false);
      a.update(d.id, { style: { showLabel: true } });
      a.select(d.id);
      const marks = a.axisMarks()!;
      // A vertical line only labels its time; the ray and the cross line both.
      expect([marks.prices, marks.times], type).toEqual(type === 'vline' ? [[], [600]] : [[100], [600]]);
    }
    const b = manager();
    expect(b.load(JSON.parse(JSON.stringify(a.serialize()))).errors).toEqual([]);
    for (const d of b.getAll()) expect(d.style.showLabel, d.type).toBe(true);
  });
});

describe('cross line labels near the corner', () => {
  /** Boxes of the pills a tool draws. */
  function boxes(d: ScreenDrawing): { x: number; y: number; w: number; h: number }[] {
    const out: { x: number; y: number; w: number; h: number }[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) => (key === 'roundRect' ? (x: number, y: number, w: number, h: number) => out.push({ x, y, w, h }) : key in target ? target[key] : () => {}),
      set: (target, key, value) => ((target[key] = value), true),
    }) as unknown as CanvasRenderingContext2D;
    crossLine.render(ctx, d, env);
    return out;
  }
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it('keeps the time pill clear of the price pill in the bottom-right corner', () => {
    // At x 790 and y 395 both pills would sit in the corner.
    const [price, time] = boxes(screen('cross-line', { showLabel: true }, 4740, 5));
    expect(overlap(price!, time!)).toBe(false);
    expect(time!.x + time!.w).toBeLessThanOrEqual(price!.x);
  });

  it('leaves the time pill on the line elsewhere', () => {
    const [, time] = boxes(screen('cross-line', { showLabel: true }, 4740, 300));
    // Clamped only by the pane's right edge, as on a vertical line.
    expect(time!.x + time!.w).toBeCloseTo(798, 6);
  });
});
