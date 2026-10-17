import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { aggregate, TradeLayer, type Trade, type TradePointerEvent } from '../src/annotations/trades';
import { Timeline } from '../src/timeline';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const fill = (id: string, time: number, side: 'buy' | 'sell', price: number, quantity: number): Trade => ({ id, time, side, price, quantity });
const timeline = (n = 10) => {
  const tl = new Timeline();
  tl.set(Array.from({ length: n }, (_, i) => i * 60));
  return tl;
};

describe('trade aggregation', () => {
  it('computes the volume-weighted price, total quantity and count', () => {
    expect(aggregate([fill('a', 0, 'buy', 100, 1), fill('b', 0, 'buy', 110, 3)])).toEqual({ price: 107.5, quantity: 4, count: 2 });
  });

  it('groups per bar and side, fills oldest first', () => {
    const layer = new TradeLayer();
    layer.set([fill('a', 70, 'buy', 100, 1), fill('b', 60, 'buy', 102, 1), fill('c', 65, 'sell', 101, 2), fill('d', 300, 'buy', 90, 1)]);
    const groups = layer.grouped(timeline());
    expect(groups.map((g) => [g.index, g.side, g.price, g.count])).toEqual([
      [1, 'buy', 101, 2],
      [1, 'sell', 101, 1],
      [5, 'buy', 90, 1],
    ]);
    expect(groups[0]!.trades.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('regroups only the bar a new or replaced fill touches', () => {
    const tl = timeline();
    const layer = new TradeLayer();
    layer.set([fill('a', 60, 'buy', 100, 1), fill('b', 300, 'buy', 90, 1)]);
    const before = layer.grouped(tl);
    const untouched = before[1];
    layer.add(fill('c', 61, 'buy', 110, 1), 'default', tl);
    const after = layer.grouped(tl);
    expect(after[1]).toBe(untouched);
    expect(after[0]).toMatchObject({ index: 1, price: 105, count: 2 });
    // Moving fill 'a' to another bar regroups both bars.
    layer.add(fill('a', 120, 'buy', 100, 1), 'default', tl);
    expect(layer.grouped(tl).map((g) => [g.index, g.count])).toEqual([
      [1, 1],
      [2, 1],
      [5, 1],
    ]);
  });

  it('keeps sources apart', () => {
    const layer = new TradeLayer();
    layer.set([fill('a', 0, 'buy', 1, 1)], 'app');
    layer.set([fill('a', 0, 'buy', 2, 1)], 'host');
    expect(layer.trades()).toHaveLength(2);
    layer.clear('app');
    expect(layer.trades().map((t) => t.price)).toEqual([2]);
  });

  it('rejects fills it cannot place', () => {
    const layer = new TradeLayer();
    expect(() => layer.set([fill('a', NaN, 'buy', 1, 1)])).toThrow(/time/);
    expect(() => layer.set([fill('a', 0, 'buy', 1, 0)])).toThrow(/quantity/);
  });

  it('rejects duplicate ids in one set', () => {
    const layer = new TradeLayer();
    layer.set([fill('a', 0, 'buy', 1, 1)]);
    expect(() => layer.set([fill('b', 0, 'buy', 1, 1), fill('b', 60, 'sell', 2, 1)])).toThrow(/duplicate/i);
    // The previous fills stay.
    expect(layer.trades().map((t) => t.id)).toEqual(['a']);
  });

  it('places a fill only inside its bar interval, in gaps as at the tail', () => {
    const tl = new Timeline();
    tl.set([0, 60, 120, 600, 660]);
    const layer = new TradeLayer();
    layer.set([fill('in', 150, 'buy', 1, 1), fill('gap', 300, 'buy', 1, 1), fill('after-gap', 630, 'buy', 1, 1), fill('tail', 700, 'buy', 1, 1), fill('past', 800, 'buy', 1, 1)]);
    expect(layer.grouped(tl).map((g) => [g.index, g.trades.map((t) => t.id)])).toEqual([
      [2, ['in']],
      [3, ['after-gap']],
      [4, ['tail']],
    ]);
  });

  it('does not drop fills by a guessed interval on a one-bar timeline', () => {
    const tl = new Timeline();
    tl.set([1000]);
    const layer = new TradeLayer();
    layer.set([fill('a', 1000 + 3600, 'buy', 1, 1)]);
    expect(layer.grouped(tl).map((g) => g.index)).toEqual([0]);
    // A known data source interval still bounds the bar.
    expect(layer.grouped(tl, 60)).toEqual([]);
    expect(layer.grouped(tl, 86400).map((g) => g.index)).toEqual([0]);
  });

  it('moves a fill past the last bar onto a newly appended bar without regrouping the rest', () => {
    const tl = timeline(3);
    const layer = new TradeLayer();
    layer.set([fill('old', 0, 'buy', 1, 1), fill('last', 130, 'buy', 1, 1), fill('next', 200, 'buy', 1, 1)]);
    const before = layer.grouped(tl);
    expect(before.map((g) => g.index)).toEqual([0, 2]);
    tl.append(180);
    const after = layer.grouped(tl);
    expect(after.map((g) => [g.index, g.trades.map((t) => t.id)])).toEqual([
      [0, ['old']],
      [2, ['last']],
      [3, ['next']],
    ]);
    expect(after[0]).toBe(before[0]);
  });
});

const bars: Bar[] = Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 }));

function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(bars);
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
  return c;
}

/** Marker centre of a group on the chart (plot space). */
const at = (c: Chart, index: number, price: number) => ({ x: c.time.indexToX(index), y: c.panes[0]!.top + c.panes[0]!.primary.priceToY(price) });

describe('trade markers on the chart', () => {
  it('stacks markers of one bar without overlap', () => {
    const c = chart();
    c.annotations.setTrades([fill('a', 40 * 60, 'buy', 100, 1), fill('b', 40 * 60, 'sell', 100, 1)]);
    const fills = (c.annotations as unknown as { layers: Map<string, { env(): { env: unknown }; layer: TradeLayer }> }).layers.get('trading/fills')!;
    const env = fills.env().env;
    const layer = fills.layer;
    const pool = (layer as unknown as { pool: { y: number; hh: number }[]; used: number });
    layer.hitTest({ x: -100, y: -100 }, env as never);
    expect(pool.used).toBe(2);
    expect(pool.pool[1]!.y - pool.pool[0]!.y).toBeGreaterThanOrEqual(pool.pool[0]!.hh + pool.pool[1]!.hh);
    // Layout reuses its boxes: no new objects per frame.
    const boxes = [...pool.pool];
    layer.hitTest({ x: -100, y: -100 }, env as never);
    expect(pool.pool).toEqual(boxes);
    expect(pool.pool[0]).toBe(boxes[0]);
  });

  it('emits hover once per marker and click with the fills', () => {
    const c = chart();
    c.annotations.setTrades([fill('a', 40 * 60, 'buy', 100, 1), fill('b', 40 * 60 + 5, 'buy', 102, 3)]);
    const hovers: TradePointerEvent[] = [];
    const ends = vi.fn();
    const clicks: TradePointerEvent[] = [];
    c.on('trade:hover', (e) => hovers.push(e));
    c.on('trade:hover-end', ends);
    const p = at(c, 40, 101.5);
    c.annotations.pointerMove(p);
    c.annotations.pointerMove({ x: p.x + 1, y: p.y });
    expect(hovers).toHaveLength(1);
    expect(hovers[0]!.trades.map((t) => t.id)).toEqual(['a', 'b']);
    expect(hovers[0]!.group).toMatchObject({ price: 101.5, quantity: 4, count: 2 });
    // Without click listeners the press is left to panning.
    expect(c.annotations.pointerDown(p)).toBe(false);
    c.on('trade:click', (e) => clicks.push(e));
    expect(c.annotations.pointerDown(p)).toBe(true);
    c.annotations.pointerUp(p);
    expect(clicks).toHaveLength(1);
    c.annotations.pointerMove({ x: 5, y: 5 });
    expect(ends).toHaveBeenCalledTimes(1);
  });

  it('treats a touch tap as hover plus click', () => {
    const c = chart();
    c.annotations.setTrades([fill('a', 10 * 60, 'sell', 100, 1)]);
    const seen: string[] = [];
    c.on('trade:hover', () => seen.push('hover'));
    c.on('trade:click', () => seen.push('click'));
    const p = at(c, 10, 100);
    c.annotations.pointerDown(p);
    c.annotations.pointerUp(p);
    expect(seen).toEqual(['hover', 'click']);
  });

  it('syncs fills, orders and positions in one go', () => {
    const c = chart();
    c.annotations.addTradeLine({ price: 95, side: 'buy' });
    const { orders, positions } = c.annotations.syncTrades({
      trades: [fill('a', 0, 'buy', 100, 1)],
      orders: [{ price: 105, side: 'sell' }],
      positions: [{ price: 100, side: 'buy' }],
    });
    expect(c.annotations.tradeLines.map((l) => [l.options.kind, l.options.price])).toEqual([
      ['order', 105],
      ['position', 100],
    ]);
    expect(orders).toHaveLength(1);
    expect(positions).toHaveLength(1);
    expect(c.annotations.getTrades()).toHaveLength(1);
  });
  it('leaves everything as it was when a sync entry is invalid', () => {
    const c = chart();
    c.annotations.setTrades([fill('a', 0, 'buy', 100, 1)]);
    const order = c.annotations.addTradeLine({ price: 95, side: 'buy' });
    const position = c.annotations.addTradeLine({ price: 96, side: 'buy', kind: 'position' });
    expect(() =>
      c.annotations.syncTrades({ orders: [{ price: 105, side: 'sell' }], positions: [{ price: NaN, side: 'buy' }] }),
    ).toThrow(/price/);
    expect(c.annotations.tradeLines).toEqual([order, position]);
    expect(() =>
      c.annotations.syncTrades({ trades: [fill('b', 0, 'buy', 100, 0)], orders: [{ price: 105, side: 'sell' }] }),
    ).toThrow(/quantity/);
    expect(c.annotations.tradeLines).toEqual([order, position]);
    expect(c.annotations.getTrades().map((t) => t.id)).toEqual(['a']);
    expect(() =>
      c.annotations.syncTrades({ trades: [fill('b', 0, 'buy', 100, 1)], orders: [{ price: 105, side: 'up' as never }] }),
    ).toThrow(/side/);
    expect(c.annotations.getTrades().map((t) => t.id)).toEqual(['a']);
  });

  it('keeps the hover when fills change on another bar', () => {
    const c = chart();
    c.annotations.setTrades([fill('a', 40 * 60, 'buy', 100, 1)]);
    const ends = vi.fn();
    c.on('trade:hover-end', ends);
    c.annotations.pointerMove(at(c, 40, 100));
    expect(c.annotations.isHovering).toBe(true);
    c.annotations.addTrade(fill('b', 10 * 60, 'sell', 100, 1));
    expect(ends).not.toHaveBeenCalled();
    expect(c.annotations.isHovering).toBe(true);
    c.annotations.addTrade(fill('c', 40 * 60 + 1, 'buy', 101, 1));
    expect(ends).not.toHaveBeenCalled();
    c.annotations.clearTrades();
    expect(ends).toHaveBeenCalledTimes(1);
    expect(c.annotations.isHovering).toBe(false);
  });

  it('forgets a fill press on cancel, so the next line click goes through', () => {
    const c = chart();
    c.annotations.setTrades([fill('a', 40 * 60, 'buy', 100, 1)]);
    c.on('trade:click', () => {});
    expect(c.annotations.pointerDown(at(c, 40, 100))).toBe(true);
    expect(c.annotations.cancelGesture()).toBe(true);
    const onClick = vi.fn();
    c.annotations.addPriceLine({ price: 95, onClick } as never);
    const line = { x: c.time.indexToX(10), y: at(c, 10, 95).y };
    expect(c.annotations.pointerDown(line)).toBe(true);
    c.annotations.pointerUp(line);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('allows more travel for a touch tap than a mouse click', () => {
    const c = chart();
    c.annotations.setTrades([fill('a', 40 * 60, 'buy', 100, 1)]);
    const clicks = vi.fn();
    c.on('trade:click', clicks);
    const p = at(c, 40, 100);
    const moved = { x: p.x + 6, y: p.y };
    c.annotations.pointerDown(p);
    c.annotations.pointerUp(moved);
    expect(clicks).not.toHaveBeenCalled();
    c.annotations.pointerDown(p, true);
    c.annotations.pointerUp(moved);
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('ignores markers outside the main pane', () => {
    const c = chart();
    c.annotations.setTrades([fill('a', 40 * 60, 'buy', 1000, 1)]);
    const pane = c.panes[0]!;
    const p = at(c, 40, 1000);
    expect(p.y < pane.top || p.y > pane.top + pane.height).toBe(true);
    c.annotations.pointerMove(p);
    expect(c.annotations.isHovering).toBe(false);
  });

  it('hands out copies of groups and fills', () => {
    const c = chart();
    c.annotations.setTrades([fill('a', 40 * 60, 'buy', 100, 1)]);
    const group = c.annotations.tradeGroups[0] as unknown as { price: number; trades: Trade[] };
    group.price = 1;
    group.trades[0]!.price = 1;
    expect(c.annotations.tradeGroups[0]).toMatchObject({ price: 100, trades: [{ price: 100 }] });
    const hovers: TradePointerEvent[] = [];
    c.on('trade:hover', (e) => hovers.push(e));
    c.annotations.pointerMove(at(c, 40, 100));
    (hovers[0]!.group as { price: number }).price = 1;
    (hovers[0]!.group.trades[0] as Trade).price = 1;
    expect(c.annotations.tradeGroups[0]).toMatchObject({ price: 100, trades: [{ price: 100 }] });
  });
});
