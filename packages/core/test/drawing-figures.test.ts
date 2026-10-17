import { describe, expect, it } from 'vitest';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import { datePriceRange, dateRange, forecast, longPosition, priceRange, shortPosition } from '../src/drawing/measure-tools';
import { deriveQuickFields } from '../src/drawing/quick-fields';
import { measure } from '../src/drawing/tools';
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

/** Entry 200 at x 200, target 300 at x 400, stop 150 at x 400 (a long position's profit and loss). */
function screen(type: string, style: DrawingStyle, prices = [200, 300, 150]): ScreenDrawing {
  const points = prices.map((price, i) => ({ time: i === 0 ? 1200 : 2400, price }));
  return {
    drawing: { id: 'x', type, pane: 0, points, style },
    points: points.map((p) => ({ x: p.time / 6, y: 400 - p.price })),
    selected: false,
    hovered: false,
  };
}

/** What a tool draws: its texts, and the fill color of each filled rectangle. */
function drawn(tool: DrawingToolDef, style: DrawingStyle) {
  const texts: string[] = [];
  const fills: unknown[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => {
      if (key === 'fillText') return (t: string) => texts.push(t);
      if (key === 'fillRect') return () => fills.push(target.fillStyle);
      return key in target ? target[key] : () => {};
    },
    set: (target, key, value) => ((target[key] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  tool.render(ctx, screen(tool.type, style), env);
  return { texts, fills };
}

const measuring = [priceRange, dateRange, datePriceRange, forecast, longPosition, shortPosition, measure];

describe('measure tool figures', () => {
  it('can be hidden on every measuring tool, without changing its quick fields', () => {
    const before: Record<string, string[]> = {
      'price-range': ['color', 'fill', 'lineWidth', 'lineStyle'],
      'date-range': ['color', 'fill', 'lineWidth', 'lineStyle'],
      'date-price-range': ['color', 'fill', 'lineWidth', 'lineStyle'],
      forecast: ['color', 'lineWidth', 'lineStyle', 'textColor'],
      'long-position': ['color', 'lineWidth', 'lineStyle', 'textColor'],
      'short-position': ['color', 'lineWidth', 'lineStyle', 'textColor'],
      measure: ['textColor', 'fontSize', 'bold', 'italic'],
    };
    for (const tool of measuring) {
      expect(tool.styleFields, tool.type).toContain('showStats');
      expect(deriveQuickFields({}, tool), tool.type).toEqual(before[tool.type]);
    }
  });

  it('show by default and hide with showStats false', () => {
    for (const tool of measuring) {
      expect(drawn(tool, {}).texts.length, tool.type).toBeGreaterThan(0);
      expect(drawn(tool, { showStats: true }).texts, tool.type).toEqual(drawn(tool, {}).texts);
      if (tool === longPosition || tool === shortPosition) continue;
      expect(drawn(tool, { showStats: false }).texts, tool.type).toEqual([]);
    }
  });

  it('keep a position\'s entry, target and stop prices, dropping only P/L and R:R', () => {
    expect(drawn(longPosition, {}).texts).toEqual(['Long entry 200.00 · R:R 2.00', 'Target 300.00 · +100.00 (+50.00%)', 'Stop 150.00 · -50.00 (-25.00%)']);
    expect(drawn(longPosition, { showStats: false }).texts).toEqual(['Long entry 200.00', 'Target 300.00', 'Stop 150.00']);
    expect(drawn(shortPosition, { showStats: false }).texts).toEqual(['Short entry 200.00', 'Target 300.00', 'Stop 150.00']);
  });
});

describe('position zone colors', () => {
  it('default to the theme up and down colors', () => {
    const plain = drawn(longPosition, {}).fills;
    const themed = drawn(longPosition, { profitColor: darkTheme.up, lossColor: darkTheme.down }).fills;
    expect(plain).toHaveLength(2);
    expect(themed).toEqual(plain);
  });

  it('follow profitColor and lossColor, by profit and loss rather than by anchor', () => {
    const own = { profitColor: '#0000ff', lossColor: '#ff00ff' };
    const long = drawn(longPosition, own).fills;
    // Target zone first: in profit for a long position, so blue; the stop zone loses.
    expect(long).toEqual([expect.stringMatching(/0, 0, 255|#0000ff/i), expect.stringMatching(/255, 0, 255|#ff00ff/i)]);
    // The same anchors as a short position: the upper zone now loses and the lower one profits.
    const short = drawn(shortPosition, own).fills;
    expect(short).toEqual([long[1], long[0]]);
    for (const tool of [longPosition, shortPosition]) expect(tool.styleFields).toEqual(expect.arrayContaining(['profitColor', 'lossColor']));
  });
});

describe('figure options in the manager', () => {
  function manager() {
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
    return withBuiltinTools(new DrawingManager(host));
  }
  const points = [{ time: 0, price: 10 }, { time: 600, price: 12 }, { time: 600, price: 9 }];

  it('saves and restores them, and rejects colors that are not strings', () => {
    const a = manager();
    a.add({ type: 'long-position', pane: 0, points, style: { showStats: false, profitColor: '#0000ff', lossColor: '#ff00ff' } });
    a.add({ type: 'price-range', pane: 0, points: points.slice(0, 2), style: { showStats: false } });
    const saved = JSON.parse(JSON.stringify(a.serialize()));
    const b = manager();
    expect(b.load(saved).errors).toEqual([]);
    expect(b.getAll().map((d) => d.style)).toEqual([{ showStats: false, profitColor: '#0000ff', lossColor: '#ff00ff' }, { showStats: false }]);
    expect(() => a.add({ type: 'long-position', pane: 0, points, style: { profitColor: 5 as never } })).toThrow('Drawing "style.profitColor" must be a string');
    saved.drawings[0].style.lossColor = 1;
    const c = manager();
    expect(c.load(saved).errors).toEqual([{ index: 0, field: 'style.lossColor', reason: 'must be a string' }]);
  });
});
