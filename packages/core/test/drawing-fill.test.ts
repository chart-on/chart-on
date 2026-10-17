import { describe, expect, it } from 'vitest';
import { fillOf } from '../src/drawing/draw';
import { fibSpeedFan, fibTime, fibTimeZone } from '../src/drawing/fibonacci';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import { deriveQuickFields } from '../src/drawing/quick-fields';
import { builtinTools } from '../src/drawing/tools';
import type { DrawingEnv, DrawingStyle, DrawingToolDef, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { darkTheme } from '../src/theme';
import { Timeline } from '../src/timeline';
import { withBuiltinTools } from './builtin-tools';

/** x = time / 6, y = 400 - price, in an 800 × 400 pane. */
const env: DrawingEnv = {
  width: 800,
  height: 400,
  theme: darkTheme,
  pixelRatio: 1,
  formatPrice: (p) => p.toFixed(2),
  priceToY: (price) => 400 - price,
  yToPrice: (y) => 400 - y,
  timeToX: (time) => time / 6,
  xToTime: (x) => x * 6,
  barsBetween: (a, b) => Math.round((b.time - a.time) / 60),
  bars: () => [],
  measureText: (t, size) => t.length * size * 0.6,
};

function screen(type: string, style: DrawingStyle): ScreenDrawing {
  const points = [{ time: 600, price: 200 }, { time: 1200, price: 300 }, { time: 1800, price: 150 }];
  return {
    drawing: { id: 'x', type, pane: 0, points, style },
    points: points.map((p) => ({ x: p.time / 6, y: 400 - p.price })),
    selected: false,
    hovered: false,
  };
}

/** The fill style of every fill the tool makes (rectangles and paths). */
function fills(tool: DrawingToolDef, style: DrawingStyle): unknown[] {
  const out: unknown[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => {
      if (key === 'fill' || key === 'fillRect') return () => out.push(target.fillStyle);
      return key in target ? target[key] : () => {};
    },
    set: (target, key, value) => ((target[key] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  tool.render(ctx, screen(tool.type, style), env);
  return out;
}

const withFill = builtinTools.filter((t) => t.styleFields?.includes('showFill'));

describe('fillOf', () => {
  it("is the style's fill, else the tool's tint, and transparent with showFill false", () => {
    expect(fillOf({}, 'tint')).toBe('tint');
    expect(fillOf({ fill: '#123456' }, 'tint')).toBe('#123456');
    expect(fillOf({ fill: '#123456', showFill: false }, 'tint')).toBe('transparent');
    expect(fillOf({ showFill: true }, 'tint')).toBe('tint');
  });
});

describe('the background switch', () => {
  it('is offered by the tools that fill without a fill of their own, after their quick fields', () => {
    const types = withFill.map((t) => t.type);
    for (const type of ['rectangle', 'ellipse', 'parallel-channel', 'regression-trend', 'fib-retracement', 'fib-channel', 'fib-arcs', 'gann-fan', 'gann-box', 'pitchfork', 'price-range']) {
      expect(types).toContain(type);
    }
    for (const tool of withFill) {
      expect(tool.styleFields, tool.type).toContain('fill');
      expect(deriveQuickFields({}, tool), tool.type).not.toContain('showFill');
    }
  });

  it('turns the background fills transparent', () => {
    // The data tools need bars to draw their bands, so only the others fill here.
    for (const tool of withFill.filter((t) => t.type !== 'regression-trend' && t.type !== 'anchored-vwap')) {
      const on = fills(tool, {});
      const off = fills(tool, { showFill: false });
      expect(on.length, tool.type).toBeGreaterThan(0);
      expect(on.includes('transparent'), tool.type).toBe(false);
      expect(off.length, tool.type).toBe(on.length);
      expect(off.includes('transparent'), tool.type).toBe(true);
    }
    expect(fills(withFill.find((t) => t.type === 'rectangle')!, { showFill: false })).toEqual(['transparent']);
  });

  it('declares the opacity the tool tints with, for settings swatches', () => {
    const alpha = (type: string) => builtinTools.find((t) => t.type === type)!.fillAlpha;
    expect(alpha('fib-retracement')).toBe(0.12);
    expect(alpha('gann-fan')).toBe(0.12);
    expect(alpha('parallel-channel')).toBe(0.12);
    expect(alpha('pitchfork')).toBe(0.1);
    expect(alpha('regression-trend')).toBe(0.1);
    expect(alpha('rectangle')).toBeUndefined();
  });
});

describe('opt-in fill on the speed fan and the Fib time tools', () => {
  for (const tool of [fibSpeedFan, fibTimeZone, fibTime]) {
    it(`${tool.type} draws no bands unless fill is set`, () => {
      expect(tool.styleFields).toContain('fill');
      // Labels off: their pills are fills too.
      expect(fills(tool, { showLabel: false })).toEqual([]);
      const banded = fills(tool, { showLabel: false, fill: '#123456' });
      expect(banded.length).toBeGreaterThan(1);
      expect(banded.every((f) => f === '#123456')).toBe(true);
      expect(fills(tool, { showLabel: false, fill: '#123456', showFill: false })).toEqual([]);
    });
  }
});

describe('time cycles fill', () => {
  it('goes through fillOf, so showFill false hides it too', () => {
    const cycles = builtinTools.find((t) => t.type === 'time-cycles')!;
    expect(fills(cycles, {})).toEqual([]);
    expect(fills(cycles, { fill: '#123456' })).toEqual(['#123456']);
    expect(fills(cycles, { fill: '#123456', showFill: false })).toEqual([]);
  });
});

describe('fill options in the manager', () => {
  it('saves showFill and rejects other values', () => {
    const timeline = new Timeline();
    timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
    const host: DrawingHost = {
      theme: darkTheme,
      timeline,
      time: new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 }),
      panes: [new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 })],
      magnetPrice: (_i, price) => price,
      formatPrice: (_p, price) => String(price),
      requestOverlay: () => {},
      editText: (_at, _initial, done) => done(null),
      emit: () => {},
    };
    const make = () => withBuiltinTools(new DrawingManager(host));
    const a = make();
    const points = [{ time: 0, price: 1 }, { time: 600, price: 2 }];
    a.add({ type: 'rectangle', pane: 0, points, style: { showFill: false } });
    a.add({ type: 'fib-time-zone', pane: 0, points, style: { fill: '#123456' } });
    const b = make();
    expect(b.load(JSON.parse(JSON.stringify(a.serialize()))).errors).toEqual([]);
    expect(b.getAll().map((d) => [d.style.showFill, d.style.fill])).toEqual([[false, undefined], [undefined, '#123456']]);
    expect(() => a.add({ type: 'rectangle', pane: 0, points, style: { showFill: 'no' as never } })).toThrow('Drawing "style.showFill" must be a boolean');
  });
});
