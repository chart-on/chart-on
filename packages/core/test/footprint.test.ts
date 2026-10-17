import { describe, expect, it } from 'vitest';
import {
  createFootprintBuilder,
  footprintFromRows,
  footprintImbalances,
  priceRow,
  type FootprintBar,
} from '../src/profile/footprint';
import { hours } from './sessions';

const rowsOf = (bar: FootprintBar) => bar.rows.map((r) => [r.price, r.buy, r.sell, r.volume]);

describe('priceRow', () => {
  it('puts boundary prices in the row above despite float noise', () => {
    expect(priceRow(0.3, 0.1)).toBe(3);
    expect(priceRow(100, 0.25)).toBe(400);
    expect(priceRow(100.24, 0.25)).toBe(400);
    expect(priceRow(-0.5, 1)).toBe(-1);
  });
});

describe('createFootprintBuilder', () => {
  it('groups sided trades into price rows with totals, delta and point of control', () => {
    const b = createFootprintBuilder({ interval: '1m', rowSize: 0.5 });
    b.push({ time: 60, price: 100.1, size: 2, side: 'buy' });
    b.push({ time: 61, price: 100.4, size: 3, side: 'sell' });
    b.push({ time: 62, price: 100.6, size: 4, side: 'buy' });
    const bar = b.push({ time: 63, price: 99.9, size: 1 })!;
    expect(bar.time).toBe(60);
    expect(bar.rowSize).toBe(0.5);
    expect(rowsOf(bar)).toEqual([
      [99.5, 0, 0, 1],
      [100, 2, 3, 5],
      [100.5, 4, 0, 4],
    ]);
    expect(bar.buy).toBe(6);
    expect(bar.sell).toBe(3);
    expect(bar.volume).toBe(10);
    expect(bar.delta).toBe(3);
    expect(bar.poc).toBe(1);
  });

  it('updates the forming bar live and starts the next bar on a new period', () => {
    const b = createFootprintBuilder({ interval: '1m', rowSize: 1 });
    const first = b.push({ time: 10, price: 5, size: 1, side: 'buy' })!;
    const second = b.push({ time: 20, price: 5, size: 2, side: 'buy' })!;
    expect(first.rows[0]!.buy).toBe(1); // returned bars are copies
    expect(second.rows[0]!.buy).toBe(3);
    const next = b.push({ time: 70, price: 6, size: 1, side: 'sell' })!;
    expect(next.time).toBe(60);
    expect(rowsOf(next)).toEqual([[6, 0, 1, 1]]);
    expect(b.bar!.time).toBe(60);
  });

  it('drops late, out-of-session and invalid trades', () => {
    const b = createFootprintBuilder({ interval: '1m', rowSize: 1 });
    expect(b.push({ time: NaN, price: 1 })).toBeNull();
    expect(b.push({ time: 1, price: Infinity })).toBeNull();
    expect(b.push({ time: 1, price: 1, size: -2 })).toBeNull();
    expect(b.push({ time: 120, price: 1, size: 1 })).not.toBeNull();
    expect(b.push({ time: 30, price: 1, size: 1 })).toBeNull();
    const s = createFootprintBuilder({
      interval: '1h',
      rowSize: 1,
      session: hours([['09:30', '16:00']]),
    });
    expect(s.push({ time: 3600, price: 1 })).toBeNull();
  });

  it('counts trades without a size as one', () => {
    const b = createFootprintBuilder({ interval: '1m', rowSize: 1 });
    b.push({ time: 0, price: 1, side: 'buy' });
    expect(b.push({ time: 1, price: 1, side: 'buy' })!.buy).toBe(2);
  });

  it('forgets the forming bar on reset', () => {
    const b = createFootprintBuilder({ interval: '1m', rowSize: 1 });
    b.push({ time: 120, price: 1, size: 1 });
    b.reset();
    expect(b.bar).toBeNull();
    expect(b.push({ time: 0, price: 1, size: 1 })!.time).toBe(0);
  });

  it('rejects a bad row size', () => {
    expect(() => createFootprintBuilder({ interval: '1m', rowSize: 0 })).toThrow(RangeError);
    expect(() => footprintFromRows(0, [], NaN)).toThrow(RangeError);
  });
});

describe('footprintFromRows', () => {
  it('builds a bar from pre-aggregated levels and regroups to a coarser row size', () => {
    const fine = footprintFromRows(0, [
      { price: 10.25, buy: 1, sell: 2 },
      { price: 10, buy: 3 },
      { price: 10.75, sell: 4, volume: 10 },
      { price: NaN, buy: 100 },
      { price: 11, buy: -1, sell: Infinity },
    ], 0.25);
    expect(rowsOf(fine)).toEqual([
      [10, 3, 0, 3],
      [10.25, 1, 2, 3],
      [10.75, 0, 4, 10],
      [11, 0, 0, 0],
    ]);
    expect(fine.poc).toBe(2);
    const coarse = footprintFromRows(0, fine.rows, 1);
    expect(rowsOf(coarse)).toEqual([
      [10, 4, 6, 16],
      [11, 0, 0, 0],
    ]);
    expect(coarse.delta).toBe(-2);
  });

  it('has no point of control without volume', () => {
    expect(footprintFromRows(0, [], 1).poc).toBe(-1);
  });
});

describe('footprintImbalances', () => {
  const bar = footprintFromRows(0, [
    { price: 1, buy: 1, sell: 2 },
    { price: 2, buy: 6, sell: 1 },
    { price: 3, buy: 3, sell: 9 },
    { price: 5, buy: 2, sell: 0 },
  ], 1);

  it('compares buying with selling one row lower and selling with buying one row higher', () => {
    expect(footprintImbalances(bar)).toEqual({
      // 1 vs nothing below, 6 >= 3 * 2, 3 >= 3 * 1, 2 vs missing row 4.
      buy: [true, true, true, true],
      // 2 < 3 * 6, 1 < 3 * 3, 9 >= 3 * 0 (no row 4), 0 is never imbalanced.
      sell: [false, false, true, false],
    });
  });

  it('honours ratio and minVolume', () => {
    expect(footprintImbalances(bar, { ratio: 4, minVolume: 3 })).toEqual({
      buy: [false, false, false, false],
      sell: [false, false, true, false],
    });
  });
});
