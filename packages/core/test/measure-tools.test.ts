import { describe, expect, it } from 'vitest';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import {
  datePriceRange,
  dateRange,
  dateRangeLabel,
  forecast,
  formatDuration,
  longPosition,
  positionLabels,
  positionStats,
  priceChange,
  priceRange,
  priceRangeLabel,
  shortPosition,
  stackLabels,
} from '../src/drawing/measure-tools';
import type { DrawingEnv, DrawingPoint, DrawingToolDef, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { darkTheme, lightTheme } from '../src/theme';
import { Timeline } from '../src/timeline';
import type { Point } from '../src/types';
import { withBuiltinTools } from './builtin-tools';

const fmt = (p: number) => p.toFixed(2);

describe('figures', () => {
  it('computes signed price change and percent', () => {
    expect(priceChange(100, 125)).toEqual({ change: 25, percent: 25 });
    expect(priceChange(200, 150)).toEqual({ change: -50, percent: -25 });
    // Percent follows the direction of the move for negative values too.
    expect(priceChange(-100, -50)).toEqual({ change: 50, percent: 50 });
    expect(priceChange(0, 5).percent).toBe(0);
  });

  it('computes long position P/L and risk/reward', () => {
    const s = positionStats('long', 100, 110, 95);
    expect(s.targetPnl).toBeCloseTo(10);
    expect(s.targetPercent).toBeCloseTo(10);
    expect(s.stopPnl).toBeCloseTo(-5);
    expect(s.stopPercent).toBeCloseTo(-5);
    expect(s.riskReward).toBeCloseTo(2);
  });

  it('computes short position P/L and risk/reward', () => {
    const s = positionStats('short', 200, 170, 210);
    expect(s.targetPnl).toBeCloseTo(30);
    expect(s.targetPercent).toBeCloseTo(15);
    expect(s.stopPnl).toBeCloseTo(-10);
    expect(s.stopPercent).toBeCloseTo(-5);
    expect(s.riskReward).toBeCloseTo(3);
  });

  it('has no risk/reward when the target or stop is on the wrong side', () => {
    expect(positionStats('long', 100, 90, 95).riskReward).toBeNull();
    expect(positionStats('long', 100, 110, 105).riskReward).toBeNull();
    expect(positionStats('short', 100, 110, 105).riskReward).toBeNull();
    expect(positionStats('long', 100, 110, 100).riskReward).toBeNull();
  });
});

describe('formatDuration', () => {
  it('uses the two largest units', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(3725)).toBe('1h 2m');
    expect(formatDuration(86400)).toBe('1d');
    expect(formatDuration(90061)).toBe('1d 1h');
    expect(formatDuration(400 * 86400)).toBe('400d');
  });

  it('skips units below a zero unit, keeps the sign and handles zero', () => {
    expect(formatDuration(86400 + 300)).toBe('1d');
    expect(formatDuration(-5400)).toBe('-1h 30m');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(Number.NaN)).toBe('0s');
  });
});

describe('range labels', () => {
  it('shows signed price change and percent', () => {
    expect(priceRangeLabel(200, 250, fmt)).toBe('+50.00 (+25.00%)');
    expect(priceRangeLabel(200, 150, fmt)).toBe('-50.00 (-25.00%)');
    expect(priceRangeLabel(200, 200, fmt)).toBe('0.00 (0.00%)');
  });

  it('shows bar count and duration', () => {
    expect(dateRangeLabel(24, 86400)).toBe('24 bars · 1d');
    expect(dateRangeLabel(1, 3600)).toBe('1 bar · 1h');
    expect(dateRangeLabel(-12, -43200)).toBe('-12 bars · -12h');
  });
});

describe('position labels', () => {
  it('formats target, stop and entry', () => {
    expect(positionLabels('long', 100, 110, 95, fmt)).toEqual({
      target: 'Target 110.00 · +10.00 (+10.00%)',
      stop: 'Stop 95.00 · -5.00 (-5.00%)',
      entry: 'Long entry 100.00 · R:R 2.00',
    });
    expect(positionLabels('short', 200, 170, 210, fmt)).toEqual({
      target: 'Target 170.00 · +30.00 (+15.00%)',
      stop: 'Stop 210.00 · -10.00 (-5.00%)',
      entry: 'Short entry 200.00 · R:R 3.00',
    });
  });

  it('drops the sign of figures that show as zero and marks a missing ratio', () => {
    const l = positionLabels('long', 100, 100.001, 100, fmt);
    expect(l.target).toBe('Target 100.00 · 0.00 (0.00%)');
    expect(l.entry).toBe('Long entry 100.00 · R:R —');
  });
});

describe('stackLabels', () => {
  it('keeps labels that do not overlap where they are', () => {
    expect(stackLabels([50, 100, 150], 20, 0, 400)).toEqual([50, 100, 150]);
  });

  it('spreads overlapping labels apart and keeps their order', () => {
    const ys = stackLabels([105, 100, 110], 20, 0, 400);
    const sorted = [...ys].sort((a, b) => a - b);
    expect(sorted[1]! - sorted[0]!).toBeGreaterThanOrEqual(20);
    expect(sorted[2]! - sorted[1]!).toBeGreaterThanOrEqual(20);
    expect(ys[1]).toBeLessThan(ys[0]!);
    expect(ys[0]).toBeLessThan(ys[2]!);
  });

  it('pulls labels back inside the pane', () => {
    expect(stackLabels([-50, 5], 20, 0, 400)).toEqual([10, 30]);
    expect(stackLabels([395, 450], 20, 0, 400)).toEqual([370, 390]);
  });
});

/* ------------------------------ rendering ------------------------------ */

const env: DrawingEnv = {
  width: 800,
  height: 400,
  theme: darkTheme,
  pixelRatio: 1,
  formatPrice: fmt,
  priceToY: (price) => 400 - price,
  yToPrice: (y) => 400 - y,
  timeToX: (time) => time / 6,
  xToTime: (x) => x * 6,
  barsBetween: (a, b) => Math.round((b.time - a.time) / 60),
  bars: () => [],
  measureText: (text, fontSize) => text.length * fontSize * 0.6,
};

interface DrawnText {
  text: string;
  x: number;
  y: number;
  color: unknown;
}

/** Canvas stand-in that records text draws and ignores everything else. */
function recorder() {
  const texts: DrawnText[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get: (target, key) => {
      if (key !== 'fillText') return key in target ? target[key] : () => {};
      return (text: string, x: number, y: number) => texts.push({ text, x, y, color: target.fillStyle });
    },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

/** Screen drawing with y = 400 - price and x = time / 6 (a 10px bar every 60s). */
function screen(type: string, points: DrawingPoint[]): ScreenDrawing {
  return {
    drawing: { id: 'x', type, pane: 0, points, style: {} },
    points: points.map((p) => ({ x: p.time / 6, y: 400 - p.price })),
    selected: false,
    hovered: false,
  };
}

function draw(tool: DrawingToolDef, d: ScreenDrawing, e: DrawingEnv = env): DrawnText[] {
  const { ctx, texts } = recorder();
  tool.render(ctx, d, e);
  return texts;
}

const pos = (time: number, price: number): DrawingPoint => ({ time, price });

describe('position tools', () => {
  it('labels target, stop and entry with readable colors', () => {
    const texts = draw(longPosition, screen('long-position', [pos(600, 200), pos(1800, 300), pos(1800, 150)]));
    expect(texts.map((t) => t.text).sort()).toEqual([
      'Long entry 200.00 · R:R 2.00',
      'Stop 150.00 · -50.00 (-25.00%)',
      'Target 300.00 · +100.00 (+50.00%)',
    ]);
    const target = texts.find((t) => t.text.startsWith('Target'))!;
    const stop = texts.find((t) => t.text.startsWith('Stop'))!;
    const entry = texts.find((t) => t.text.startsWith('Long'))!;
    expect(target.y).toBeLessThan(entry.y);
    expect(stop.y).toBeGreaterThan(entry.y);
    expect(entry.color).toBe(darkTheme.labelText);
    expect(target.color).toBe('#000000');
  });

  it('shows only the target until the stop is placed', () => {
    const texts = draw(shortPosition, screen('short-position', [pos(600, 200), pos(1800, 150), pos(1800, 150)]));
    expect(texts.map((t) => t.text)).toEqual(['Short entry 200.00 · R:R —', 'Target 150.00 · +50.00 (+25.00%)']);
  });

  it('keeps labels inside the pane and apart when zoomed out', () => {
    // A thin position: all three levels within a few pixels, partly off the left edge.
    const d = screen('long-position', [pos(-600, 200), pos(300, 202), pos(300, 199)]);
    const texts = draw(longPosition, d, { ...env, theme: lightTheme });
    expect(texts).toHaveLength(3);
    const ys = texts.map((t) => t.y).sort((a, b) => a - b);
    const h = lightTheme.fontSize + 8;
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(h);
    expect(ys[2]! - ys[1]!).toBeGreaterThanOrEqual(h);
    for (const t of texts) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + env.measureText(t.text, lightTheme.fontSize)).toBeLessThanOrEqual(env.width);
    }
  });

  it('skips labels when the drawing is off screen', () => {
    expect(draw(longPosition, screen('long-position', [pos(6000, 200), pos(7000, 300), pos(7000, 150)]))).toEqual([]);
  });

  it('hit tests both zones', () => {
    const d = screen('long-position', [pos(600, 200), pos(1800, 300), pos(1800, 150)]);
    expect(longPosition.hitTest(d, { x: 200, y: 150 }, env)).toBe(true);
    expect(longPosition.hitTest(d, { x: 200, y: 230 }, env)).toBe(true);
    expect(longPosition.hitTest(d, { x: 200, y: 50 }, env)).toBe(false);
    expect(longPosition.hitTest(d, { x: 400, y: 200 }, env)).toBe(false);
  });
});

describe('range tools', () => {
  it('labels a price range beyond its end anchor', () => {
    const up = draw(priceRange, screen('price-range', [pos(600, 200), pos(1200, 250)]));
    expect(up.map((t) => t.text)).toEqual(['+50.00 (+25.00%)']);
    expect(up[0]!.y).toBeLessThan(400 - 250);
    const down = draw(priceRange, screen('price-range', [pos(600, 200), pos(1200, 150)]));
    expect(down.map((t) => t.text)).toEqual(['-50.00 (-25.00%)']);
    expect(down[0]!.y).toBeGreaterThan(400 - 150);
  });

  it('labels a date range with bars and elapsed time', () => {
    const texts = draw(dateRange, screen('date-range', [pos(600, 200), pos(4200, 180)]));
    expect(texts.map((t) => t.text)).toEqual(['60 bars · 1h']);
    expect(texts[0]!.y).toBeGreaterThan(400 - 180);
  });

  it('uses a readable label color for the range color', () => {
    const [accent] = draw(priceRange, screen('price-range', [pos(600, 200), pos(1200, 250)]));
    expect(accent!.color).toBe('#000000');
    const d = screen('price-range', [pos(600, 200), pos(1200, 250)]);
    d.drawing.style.color = '#1e1b4b';
    expect(draw(priceRange, d)[0]!.color).toBe('#ffffff');
  });

  it('keeps the label inside the pane when the range is clipped', () => {
    // Spans past both horizontal edges and the bottom edge.
    const texts = draw(dateRange, screen('date-range', [pos(-6000, 100), pos(12000, -200)]));
    const h = env.theme.fontSize + 8;
    expect(texts[0]!.x).toBeGreaterThanOrEqual(0);
    expect(texts[0]!.y).toBeLessThanOrEqual(env.height - h / 2);
  });

  it('hit tests inside the box', () => {
    const d = screen('date-range', [pos(600, 200), pos(1200, 150)]);
    expect(dateRange.hitTest(d, { x: 150, y: 225 }, env)).toBe(true);
    expect(priceRange.hitTest(d, { x: 150, y: 300 }, env)).toBe(false);
  });
});

describe('date and price range', () => {
  /** Places the anchors through `e`, as the manager does for any scale mode. */
  const placed = (e: DrawingEnv, points: DrawingPoint[]): ScreenDrawing => ({
    ...screen('date-price-range', points),
    points: points.map((p) => ({ x: e.timeToX(p.time), y: e.priceToY(p.price) })),
  });

  it('labels price change, percent, bars and elapsed time in one box, beyond the end anchor', () => {
    const up = draw(datePriceRange, placed(env, [pos(600, 200), pos(4200, 250)]));
    expect(up.map((t) => t.text)).toEqual(['+50.00 (+25.00%) · 60 bars · 1h']);
    expect(up[0]!.y).toBeLessThan(400 - 250);
    const down = draw(datePriceRange, placed(env, [pos(4200, 200), pos(600, 150)]));
    expect(down.map((t) => t.text)).toEqual(['-50.00 (-25.00%) · -60 bars · -1h']);
    expect(down[0]!.y).toBeGreaterThan(400 - 150);
  });

  it('reads the same values on log and percent scales', () => {
    const points = [pos(600, 100), pos(4200, 1000)];
    const log: DrawingEnv = { ...env, priceToY: (p) => 300 - 100 * Math.log10(p), yToPrice: (y) => 10 ** ((300 - y) / 100) };
    // Percent of a base price of 100, 1px per percent.
    const percent: DrawingEnv = { ...env, priceToY: (p) => 300 - (p / 100 - 1) * 100, yToPrice: (y) => (1 + (300 - y) / 100) * 100 };
    for (const e of [env, log, percent]) {
      expect(draw(datePriceRange, placed(e, points), e).map((t) => t.text)).toEqual(['+900.00 (+900.00%) · 60 bars · 1h']);
    }
  });

  it('hit tests inside the box only', () => {
    const d = screen('date-price-range', [pos(600, 200), pos(1200, 150)]);
    expect(datePriceRange.hitTest(d, { x: 150, y: 225 }, env)).toBe(true);
    expect(datePriceRange.hitTest(d, { x: 150, y: 300 }, env)).toBe(false);
    expect(datePriceRange.hitTest(d, { x: 300, y: 225 }, env)).toBe(false);
  });
});

describe('forecast', () => {
  /** Recorder that also keeps every stroke and fill color and the dash in force at each stroke. */
  function strokes(d: ScreenDrawing, e: DrawingEnv = env) {
    const dashes: number[][] = [];
    const { ctx, texts } = recorder();
    let current: number[] = [];
    Object.assign(ctx, {
      setLineDash: (v: number[]) => (current = v),
      stroke: () => dashes.push(current),
    });
    forecast.render(ctx, d, e);
    return { texts, dashes };
  }

  it('labels the change, percent and bar count beyond its target', () => {
    const up = draw(forecast, screen('forecast', [pos(600, 200), pos(1800, 250)]));
    expect(up.map((t) => t.text)).toEqual(['+50.00 (+25.00%) · 20 bars']);
    expect(up[0]!.y).toBeLessThan(400 - 250);
    const down = draw(forecast, screen('forecast', [pos(600, 200), pos(660, 150)]));
    expect(down.map((t) => t.text)).toEqual(['-50.00 (-25.00%) · 1 bar']);
    expect(down[0]!.y).toBeGreaterThan(400 - 150);
  });

  it('is colored by direction in either theme unless the style sets a color', () => {
    for (const theme of [darkTheme, lightTheme]) {
      const d = screen('forecast', [pos(600, 200), pos(1800, 150)]);
      const { ctx } = recorder();
      forecast.render(ctx, d, { ...env, theme });
      expect((ctx as unknown as Record<string, unknown>).strokeStyle).toBe(theme.down);
    }
    const d = screen('forecast', [pos(600, 200), pos(1800, 150)]);
    d.drawing.style.color = '#1e1b4b';
    const [label] = draw(forecast, d);
    expect(label!.color).toBe('#ffffff');
  });

  it('dashes the line as a hypothesis but draws a solid arrowhead', () => {
    const d = screen('forecast', [pos(600, 200), pos(1800, 250)]);
    d.drawing.style.lineStyle = 'dashed';
    expect(strokes(d).dashes).toEqual([[6, 4], []]);
    expect(forecast.defaultStyle).toEqual({ lineStyle: 'dashed' });
  });

  it('hit tests along the arrow only', () => {
    const d = screen('forecast', [pos(600, 200), pos(1800, 300)]);
    expect(forecast.hitTest(d, { x: 200, y: 150 }, env)).toBe(true);
    expect(forecast.hitTest(d, { x: 200, y: 180 }, env)).toBe(false);
    expect(forecast.hitTest(d, { x: 400, y: 50 }, env)).toBe(false);
  });

  it('skips the label when the drawing is off screen', () => {
    expect(draw(forecast, screen('forecast', [pos(6000, 200), pos(7000, 300)]))).toEqual([]);
  });
});

/* -------------------------- manager integration ------------------------- */

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
  const host: DrawingHost = {
    theme: darkTheme,
    timeline,
    time,
    panes: [pane],
    magnetPrice: (_i, price) => price,
    formatPrice: (_p, price) => price.toFixed(2),
    requestOverlay: () => {},
    editText: (_at, _initial, done) => done(null),
    emit: () => {},
  };
  return withBuiltinTools(new DrawingManager(host));
}

/** Click (press and release in place) at a plot-space point. */
function click(manager: DrawingManager, p: Point): void {
  manager.pointerMove(p);
  manager.pointerDown(0, p);
  manager.pointerUp(p);
}

describe('position tools in the drawing manager', () => {
  // x → bar index 99 + (x - 1000) / 10, time = index * 60; y → price 500 - y.
  it('places entry, target and stop with three clicks', () => {
    const manager = setup();
    manager.setTool('long-position');
    click(manager, { x: 500, y: 300 });
    click(manager, { x: 600, y: 200 });
    click(manager, { x: 600, y: 350 });
    const [d] = manager.getAll();
    expect(d?.points).toEqual([
      { time: 2940, price: expect.closeTo(200) },
      { time: 3540, price: expect.closeTo(300) },
      { time: 3540, price: expect.closeTo(150) },
    ]);
    expect(manager.tool).toBeNull();
    expect(manager.selected?.id).toBe(d?.id);
  });

  it('drags each anchor on its own', () => {
    const manager = setup();
    const d = manager.add({
      type: 'short-position',
      pane: 0,
      points: [pos(2940, 200), pos(3540, 150), pos(3540, 250)],
      style: {},
    });
    click(manager, { x: 550, y: 300 }); // select via the entry line
    expect(manager.selected?.id).toBe(d.id);
    // Stop anchor sits at x 600, y 250.
    manager.pointerDown(0, { x: 600, y: 250 });
    manager.pointerMove({ x: 650, y: 230 });
    manager.pointerUp({ x: 650, y: 230 });
    const after = manager.getAll()[0]!;
    expect(after.points[0]).toEqual(pos(2940, 200));
    expect(after.points[1]).toEqual(pos(3540, 150));
    expect(after.points[2]).toEqual({ time: 3840, price: expect.closeTo(270) });
  });
});

describe('range tools in the drawing manager', () => {
  it('creates a price range by press-drag-release and selects it by its body', () => {
    const manager = setup();
    manager.setTool('price-range');
    manager.pointerDown(0, { x: 500, y: 300 });
    manager.pointerMove({ x: 600, y: 250 });
    manager.pointerUp({ x: 600, y: 250 });
    const [d] = manager.getAll();
    expect(d?.points).toEqual([
      { time: 2940, price: expect.closeTo(200) },
      { time: 3540, price: expect.closeTo(250) },
    ]);
    click(manager, { x: 10, y: 10 });
    expect(manager.selected).toBeNull();
    click(manager, { x: 550, y: 280 });
    expect(manager.selected?.id).toBe(d?.id);
  });

  it('registers all measurement tools', () => {
    const types = setup().getTools().map((t) => t.type);
    expect(types).toEqual(expect.arrayContaining(['long-position', 'short-position', 'forecast', 'price-range', 'date-range', 'date-price-range']));
  });
});

describe('arrow heads of the measure tools', () => {
  interface Stroke {
    dash: number[];
    path: Point[];
  }
  /** Every stroke a tool makes: the path since the last beginPath and the dash in force. */
  function strokesOf(tool: DrawingToolDef, d: ScreenDrawing): Stroke[] {
    const out: Stroke[] = [];
    const { ctx } = recorder();
    let dash: number[] = [];
    let path: Point[] = [];
    Object.assign(ctx, {
      getLineDash: () => dash,
      setLineDash: (v: number[]) => (dash = v),
      beginPath: () => (path = []),
      moveTo: (x: number, y: number) => path.push({ x, y }),
      lineTo: (x: number, y: number) => path.push({ x, y }),
      stroke: () => out.push({ dash, path }),
    });
    tool.render(ctx, d, env);
    return out;
  }
  /** Heads are three-point strokes; returns each with its leg length. */
  const heads = (strokes: Stroke[]) =>
    strokes
      .filter((s) => s.path.length === 3)
      .map((s) => ({ dash: s.dash, tip: s.path[1]!, leg: Math.hypot(s.path[0]!.x - s.path[1]!.x, s.path[0]!.y - s.path[1]!.y) }));

  it('draw 10 px heads at the end anchor of a price range and a forecast', () => {
    const range = heads(strokesOf(priceRange, screen('price-range', [pos(600, 100), pos(1200, 200)])));
    expect(range).toHaveLength(1);
    expect(range[0]!.tip).toEqual({ x: 150, y: 200 });
    expect(range[0]!.leg).toBeCloseTo(10);
    const ahead = heads(strokesOf(forecast, screen('forecast', [pos(600, 200), pos(1800, 250)])));
    expect(ahead).toHaveLength(1);
    expect(ahead[0]!.leg).toBeCloseTo(10);
  });

  it('keep both shafts of a dashed date and price range dashed, with solid heads', () => {
    const d = screen('date-price-range', [pos(600, 100), pos(1800, 200)]);
    d.drawing.style.lineStyle = 'dashed';
    const strokes = strokesOf(datePriceRange, d);
    const shafts = strokes.filter((s) => s.path.length === 2);
    expect(shafts).toHaveLength(2);
    expect(shafts.map((s) => s.dash)).toEqual([[6, 4], [6, 4]]);
    expect(heads(strokes).map((h) => [h.dash, Math.round(h.leg)])).toEqual([
      [[], 10],
      [[], 10],
    ]);
  });

  it('keep the head to half a short shaft', () => {
    // 8 px tall: the legs shrink to 4 px.
    const [head] = heads(strokesOf(priceRange, screen('price-range', [pos(600, 100), pos(1200, 108)])));
    expect(head!.leg).toBeCloseTo(4);
  });
});
