import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { createDepthLane, layoutDepthRows, type DepthBook, type DepthLevel } from '../src/depth-lane';
import type { PrimitiveEnv, PrimitiveHost } from '../src/primitives';
import { PriceScale } from '../src/scales';
import { darkTheme } from '../src/theme';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.useRealTimers();
});

function chart(): Chart {
  const c = new Chart(fakeContainer(), { timezone: 'UTC' });
  charts.push(c);
  const bars: Bar[] = Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 100, high: 101 + (i % 3), low: 99, close: 100 }));
  c.addCandles({ animate: false }).setData(bars);
  frame(c);
  return c;
}

/** Run one frame's scene work; frames never run on their own under the fake DOM. */
function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

/** A 2D context that accepts every call and records filled rectangles. */
function recordingContext(): { ctx: CanvasRenderingContext2D; rects: number[][]; texts: string[] } {
  const rects: number[][] = [];
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => {
      if (key === 'fillRect') return (...args: number[]) => rects.push(args);
      if (key === 'fillText') return (text: string) => texts.push(text);
      if (key in target) return target[key];
      return () => {};
    },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, rects, texts };
}

function laneEnv(priceToY: (p: number) => number, width = 80, height = 200): PrimitiveEnv {
  return {
    width,
    height,
    pixelRatio: 1,
    theme: darkTheme,
    from: 0,
    to: 10,
    barSpacing: 6,
    times: [],
    indexToX: (i) => i,
    xToIndex: (x) => x,
    timeToX: (t) => t,
    priceToY,
    yToPrice: (y) => y,
    formatPrice: (p) => String(p),
  };
}

const levels = (pairs: [number, number][]): DepthLevel[] => pairs.map(([price, size]) => ({ price, size }));

describe('layoutDepthRows', () => {
  it('maps levels to rows on a linear scale', () => {
    const book: DepthBook = {
      bids: levels([[100, 5], [99, 10], [98, 2]]),
      asks: levels([[101, 20], [102, 4]]),
    };
    // 10 px per price unit, 110 at the top.
    const rows = layoutDepthRows(book, { width: 80, height: 200, priceToY: (p) => (110 - p) * 10 });
    expect(rows.map((r) => [r.side, r.price, r.y, r.thickness, r.length, r.best])).toEqual([
      ['bid', 100, 100, 9, 20, true],
      ['bid', 99, 110, 9, 40, false],
      ['bid', 98, 120, 9, 8, false],
      ['ask', 101, 90, 9, 80, true],
      ['ask', 102, 80, 9, 16, false],
    ]);
  });

  it('follows a log scale: rows sit where the scale puts their price', () => {
    const scale = new PriceScale({ marginTop: 0, marginBottom: 0 });
    scale.height = 300;
    scale.setMode('log');
    scale.fit(10, 1000);
    // Halving prices are equally spaced on a log scale, so the bars are equally thick.
    const book = { bids: levels([[100, 1], [50, 2], [25, 4]]), asks: levels([[200, 1]]) };
    const rows = layoutDepthRows(book, { width: 60, height: 300, priceToY: (p) => scale.priceToY(p) });
    expect(rows[0]!.y).toBeCloseTo(150);
    const step = rows[1]!.y - rows[0]!.y;
    expect(rows[2]!.y - rows[1]!.y).toBeCloseTo(step);
    expect(new Set(rows.slice(0, 3).map((r) => r.thickness.toFixed(6))).size).toBe(1);
    // The lone ask gets a default thickness; the largest size (4) fills the lane.
    expect(rows[3]!.thickness).toBe(6);
    expect(rows[2]!.length).toBe(60);
  });

  it('scales to the largest visible size and leaves out rows off the area or unplaceable', () => {
    const book = { bids: levels([[100, 10], [0, 999], [50, 1000]]), asks: levels([[101, 5]]) };
    const priceToY = (p: number) => (p <= 0 ? NaN : (110 - p) * 10);
    const rows = layoutDepthRows(book, { width: 100, height: 200, priceToY });
    // 50 sits at y 600, far below the area; 0 has no position.
    expect(rows.map((r) => r.price)).toEqual([100, 101]);
    expect(rows.map((r) => r.length)).toEqual([100, 50]);
  });
});

describe('depth lane levels', () => {
  it('sorts best first, applies incremental updates and cuts to maxLevels', () => {
    const lane = createDepthLane({ maxLevels: 3 });
    const changes: DepthBook[] = [];
    lane.on('levels:change', (book) => changes.push(book));
    lane.setLevels({
      bids: levels([[98, 1], [100, 2], [99, 3], [97, 4]]),
      asks: levels([[102, 1], [101, 2], [103, 0], [Number.NaN, 5]]),
    });
    expect(lane.levels.bids).toEqual(levels([[100, 2], [99, 3], [98, 1]]));
    expect(lane.levels.asks).toEqual(levels([[101, 2], [102, 1]]));
    expect(lane.bestBid).toEqual({ price: 100, size: 2 });

    // Size 0 removes a level; 97 moves up into view. A new better ask is inserted.
    lane.update({ bids: levels([[100, 0], [99, 7]]), asks: levels([[100.5, 9], [-1, -2]]) });
    expect(lane.levels.bids).toEqual(levels([[99, 7], [98, 1], [97, 4]]));
    expect(lane.levels.asks).toEqual(levels([[100.5, 9], [101, 2], [102, 1]]));
    expect(lane.bestAsk).toEqual({ price: 100.5, size: 9 });

    lane.applyOptions({ maxLevels: 1 });
    expect(lane.levels).toEqual({ bids: levels([[99, 7]]), asks: levels([[100.5, 9]]) });
    lane.clear();
    expect(lane.levels).toEqual({ bids: [], asks: [] });
    expect(changes).toHaveLength(4);
    expect(changes[1]!.asks[0]).toEqual({ price: 100.5, size: 9 });
  });

  it('repaints the overlay at most once per repaintInterval', () => {
    vi.useFakeTimers();
    const lane = createDepthLane({ repaintInterval: 100 });
    const host = { pane: null, series: null, requestRedraw: vi.fn(), requestOverlayRedraw: vi.fn() };
    lane.attached!(host as unknown as PrimitiveHost);
    lane.setLevels({ bids: levels([[100, 1]]) });
    expect(host.requestOverlayRedraw).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(10);
      lane.update({ bids: levels([[100, i + 2]]) });
    }
    expect(host.requestOverlayRedraw).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10);
    expect(host.requestOverlayRedraw).toHaveBeenCalledTimes(2);
    // Level changes never ask for a full redraw; options do.
    expect(host.requestRedraw).not.toHaveBeenCalled();
    lane.applyOptions({ width: 60 });
    expect(host.requestRedraw).toHaveBeenCalledTimes(1);
    // A pending repaint is dropped on detach.
    lane.update({ bids: levels([[100, 1]]) });
    lane.detached!();
    vi.advanceTimersByTime(500);
    expect(host.requestOverlayRedraw).toHaveBeenCalledTimes(2);
  });

  it('draws bars from the axis side, best levels in the solid bid and ask colours', () => {
    const lane = createDepthLane({ width: 80, labels: true });
    lane.setLevels({ bids: levels([[100, 10], [99, 5]]), asks: levels([[101, 20]]) });
    const { ctx, rects, texts } = recordingContext();
    lane.drawLane!(ctx, laneEnv((p) => (110 - p) * 10));
    // Right lane: bars end at the lane's right edge.
    expect(rects.map(([x, , w]) => x! + w!)).toEqual([80, 80, 80]);
    expect(rects.map(([, , w]) => w)).toEqual([40, 20, 80]);
    expect(texts).toContain('20');
    const left = createDepthLane({ side: 'left', width: 80 });
    left.setLevels({ bids: levels([[100, 10]]) });
    const drawn = recordingContext();
    left.drawLane!(drawn.ctx, laneEnv((p) => (110 - p) * 10));
    expect(drawn.rects[0]![0]).toBe(0);
  });

  it('keeps 10 updates a second of 200 levels well inside a 16 ms frame', () => {
    const lane = createDepthLane({ width: 80, labels: true });
    const book = (seed: number) => ({
      bids: Array.from({ length: 200 }, (_, i) => ({ price: 100 - i * 0.01, size: ((i * 7 + seed) % 50) + 1 })),
      asks: Array.from({ length: 200 }, (_, i) => ({ price: 100.01 + i * 0.01, size: ((i * 11 + seed) % 50) + 1 })),
    });
    const { ctx } = recordingContext();
    const env = laneEnv((p) => (100.5 - p) * 400, 80, 400);
    lane.setLevels(book(0));
    lane.drawLane!(ctx, env);
    const times: number[] = [];
    for (let k = 1; k <= 10; k++) {
      const start = performance.now();
      lane.update(book(k));
      lane.drawLane!(ctx, env);
      times.push(performance.now() - start);
    }
    // The median, not the worst: a GC pause or a busy CI runner can stall any single update.
    times.sort((a, b) => a - b);
    expect(times[5]!).toBeLessThan(16);
  });
});

describe('chart.addDepthLane', () => {
  it('narrows the plot by the lane width and keeps the price axis in place', () => {
    const c = chart();
    const plotWidth = c.plotWidth;
    const axis = c.priceAxisSpace('right');
    const scale = c.panes[0]!.price;
    const range = [scale.min, scale.max];
    const hidden = c.addDepthLane({ width: 90, visible: false });
    frame(c);
    // A hidden lane takes no width.
    expect(c.plotWidth).toBe(plotWidth);

    hidden.applyOptions({ visible: true });
    frame(c);
    expect(c.plotWidth).toBe(plotWidth - 90);
    expect(c.priceAxisSpace('right')).toBe(axis);
    expect([scale.min, scale.max]).toEqual(range);
    // The lane is inert: neither plot nor an axis column; the axis keeps its region.
    expect(c.regionAt(c.plotWidth + 10, 50)).toEqual({ kind: 'priceAxis', pane: 0, scale: null });
    expect(c.regionAt(c.plotWidth + 95, 50)).toEqual({ kind: 'priceAxis', pane: 0, scale });

    hidden.remove();
    frame(c);
    expect(c.plotWidth).toBe(plotWidth);
  });

  it('draws the lane with its width and the pane scale', () => {
    const c = chart();
    const lane = c.addDepthLane({ width: 70 });
    const draw = vi.spyOn(lane, 'drawLane');
    lane.setLevels({ bids: levels([[100, 1]]), asks: levels([[101, 2]]) });
    frame(c);
    expect(draw).toHaveBeenCalled();
    const env = draw.mock.calls.at(-1)![1];
    expect(env.width).toBe(70);
    expect(env.priceToY(100)).toBe(c.panes[0]!.price.priceToY(100));
  });

  it('reserves left lanes beside the left edge and stacks lanes of one side', () => {
    const c = chart();
    const left0 = c.plotLeft;
    const width0 = c.plotWidth;
    c.addDepthLane({ side: 'left', width: 40 });
    c.addDepthLane({ width: 30 });
    c.addDepthLane({ width: 20 });
    frame(c);
    expect(c.plotLeft).toBe(left0 + 40);
    expect(c.plotWidth).toBe(width0 - 40 - 50);
    expect(c.priceAxisSpace('left')).toBe(left0);
  });
});
