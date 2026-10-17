import { describe, expect, it } from 'vitest';
import { PriceBarBuilder, averageTrueRange, priceBars, type PriceBar, type PriceBarOptions } from '../src/price-bars';
import type { Bar } from '../src/types';
import { Chart } from '../src/chart';
import { fakeContainer } from './fake-dom';

/** Bars one minute apart from t = 60, flat at each close (open = close unless given). */
function closes(values: number[], volume?: number): Bar[] {
  return values.map((c, i) => ({ time: 60 * (i + 1), open: c, high: c, low: c, close: c, ...(volume !== undefined ? { volume } : {}) }));
}

/** [open, close, startTime, endTime] of each price bar. */
const shape = (bars: PriceBar[]) => bars.map((b) => [b.open, b.close, b.startTime, b.endTime]);

const fixed = (size: number) => ({ kind: 'fixed', size }) as const;

describe('renko', () => {
  const opts: PriceBarOptions = { type: 'renko', size: fixed(1) };

  it('draws a brick per box moved and reverses after two boxes from the last close', () => {
    const bars = priceBars(closes([10, 11.5, 13.2, 12.1, 10.9, 12.5, 13]), opts);
    expect(shape(bars)).toEqual([
      [10, 11, 60, 120],
      [11, 12, 120, 180],
      [12, 13, 180, 180],
      // 12.1 is under a box from the 13 close: nothing. 10.9 is two boxes: one brick from the last open.
      [12, 11, 180, 300],
      // 12.5 is 1.5 boxes over the 11 close; 13 is two.
      [12, 13, 300, 420],
    ]);
    // Bricks have no wicks and sit on evenly spaced slots from the first source time.
    expect(bars.map((b) => [b.time, b.high, b.low])).toEqual([
      [60, 11, 10],
      [120, 12, 11],
      [180, 13, 12],
      [240, 12, 11],
      [300, 13, 12],
    ]);
  });

  it('gives source volume to the last brick a bar completes, or the next one', () => {
    const bars = priceBars(closes([10, 11.5, 13.2, 12.1, 10.9, 12.5, 13], 1), opts);
    expect(bars.map((b) => b.volume)).toEqual([2, undefined, 1, 2, 2]);
  });

  it('needs `reversal` boxes to turn', () => {
    const bars = priceBars(closes([10, 13, 10.5, 10]), { ...opts, reversal: 3 });
    // Up to 13; 10.5 is 2.5 boxes back (not 3); 10 is 3: two bricks from the last open (12).
    expect(shape(bars)).toEqual([
      [10, 11, 60, 120],
      [11, 12, 120, 120],
      [12, 13, 120, 120],
      [12, 11, 120, 240],
      [11, 10, 240, 240],
    ]);
  });

  it('reads a rising bar low first and a falling bar high first with the high-low source', () => {
    const bars = priceBars(
      [
        { time: 60, open: 10, high: 10, low: 10, close: 10 },
        // Rising: the low (8) first draws two down bricks, then the high (11) reverses up.
        { time: 120, open: 10, high: 11, low: 8, close: 10.5 },
      ],
      { ...opts, source: 'highLow' },
    );
    expect(shape(bars)).toEqual([
      [10, 9, 60, 120],
      [9, 8, 120, 120],
      [9, 10, 120, 120],
      [10, 11, 120, 120],
    ]);
  });
});

describe('line break', () => {
  it('extends with each new extreme and reverses past the last three lines', () => {
    const bars = priceBars(closes([10, 10, 11, 12, 11.5, 10.5, 9, 9.5, 13]), { type: 'lineBreak' });
    expect(shape(bars)).toEqual([
      [10, 11, 60, 180],
      [11, 12, 180, 240],
      // 11.5 and 10.5 stay above the lowest of the last lines (10); 9 breaks it.
      [11, 9, 240, 420],
      // 9.5 is no new low and under the highest of the last three (12); 13 breaks it.
      [11, 13, 420, 540],
    ]);
    expect(bars.map((b) => [b.high, b.low])).toEqual([
      [11, 10],
      [12, 11],
      [11, 9],
      [13, 11],
    ]);
  });

  it('only counts the last `lines` lines', () => {
    const series = closes([10, 11, 12, 13, 14, 11.5, 10.5]);
    // Three lines: lows 11, 12, 13. 11.5 holds, 10.5 breaks.
    expect(shape(priceBars(series, { type: 'lineBreak' })).slice(4)).toEqual([[13, 10.5, 300, 420]]);
    // One line: 11.5 is under the last line's low (13) already, and 10.5 extends the fall.
    expect(shape(priceBars(series, { type: 'lineBreak', lines: 1 })).slice(4)).toEqual([
      [13, 11.5, 300, 360],
      [11.5, 10.5, 360, 420],
    ]);
  });
});

describe('range bars', () => {
  it('closes a bar when its range would exceed the size and opens the next there', () => {
    const bars = priceBars(closes([100, 101, 103, 98, 98.5]), { type: 'range', size: fixed(2), source: 'close' });
    expect(bars.map((b) => [b.open, b.high, b.low, b.close, b.startTime, b.endTime])).toEqual([
      [100, 102, 100, 102, 60, 180],
      [102, 103, 101, 101, 180, 240],
      // A fall of more than a whole size fills a bar of its own.
      [101, 101, 99, 99, 240, 240],
      // The newest bar is still forming.
      [99, 99, 98, 98.5, 240, 300],
    ]);
  });

  it('follows open, low, high, close of a rising bar with the high-low source', () => {
    const bars = priceBars([{ time: 60, open: 10, high: 13, low: 9, close: 12 }], { type: 'range', size: fixed(2) });
    // 10 -> 9 (range 1), then up to 13: closes at 11, then 11 -> 13 forms the next bar, close back to 12.
    expect(bars.map((b) => [b.open, b.high, b.low, b.close])).toEqual([
      [10, 11, 9, 11],
      [11, 13, 11, 12],
    ]);
  });
});

describe('kagi', () => {
  const opts: PriceBarOptions = { type: 'kagi', size: fixed(1) };

  it('runs on while price keeps its direction and turns after the reversal amount', () => {
    const bars = priceBars(closes([10, 10.5, 11, 12, 11.5, 11, 10.9, 12.5, 9]), opts);
    expect(shape(bars)).toEqual([
      // 10.5 is under the amount from the first price; 11 reaches it, 12 runs on.
      [10, 12, 60, 240],
      // 11.5 is half the amount back; 11 turns, 10.9 runs on.
      [12, 10.9, 240, 420],
      [10.9, 12.5, 420, 480],
      [12.5, 9, 480, 540],
    ]);
    expect(bars.map((b) => [b.high, b.low])).toEqual([
      [12, 10],
      [12, 10.9],
      [12.5, 10.9],
      [12.5, 9],
    ]);
  });

  it('extends and takes back the forming stretch live', () => {
    const b = new PriceBarBuilder(opts);
    b.setData(closes([10, 11, 12]));
    const tick = (time: number, close: number) => b.update({ time, open: close, high: close, low: close, close });
    expect(shape(tick(180, 12.5).bars)).toEqual([[10, 12.5, 60, 180]]);
    expect(shape(tick(240, 11).bars)).toEqual([[12.5, 11, 180, 240]]);
    // The bar at 240 now closes at 12: no turn after all.
    expect(tick(240, 12)).toEqual({ bars: [], reset: true });
    expect(shape(b.bars)).toEqual([[10, 12.5, 60, 180]]);
  });

  it('gives each stretch the volume of the source bars it covers', () => {
    const bars = priceBars(closes([10, 11, 12, 11, 10.5], 1), opts);
    expect(bars.map((b) => b.volume)).toEqual([3, 2]);
  });
});

describe('point & figure', () => {
  const opts: PriceBarOptions = { type: 'pointFigure', size: fixed(1) };

  it('stacks X and O boxes on the box grid and turns after three boxes', () => {
    const bars = priceBars(closes([10, 10.6, 11.2, 13.4, 12.1, 11, 10.4, 9.9, 12, 13.1]), opts);
    expect(shape(bars)).toEqual([
      // From the first price's box, once price reaches the next box: X boxes 10 to 13.
      [10, 13, 60, 240],
      // 9.9 is three boxes under 13: O boxes from one under the top, 12, down to 10.
      [12, 10, 240, 480],
      // 12 is two boxes over 10, 13.1 three: X boxes 11 to 13.
      [11, 13, 480, 600],
    ]);
    expect(bars.map((b) => [b.high, b.low])).toEqual([
      [13, 10],
      [12, 10],
      [13, 11],
    ]);
  });

  it('draws one-box columns with a one-box reversal', () => {
    const bars = priceBars(closes([10, 12, 11, 12, 10]), { ...opts, reversal: 1 });
    expect(shape(bars)).toEqual([
      [10, 12, 60, 120],
      [11, 11, 120, 180],
      [12, 12, 180, 240],
      [11, 10, 240, 300],
    ]);
  });

  it('keeps box prices on the grid of the box size', () => {
    const bars = priceBars(closes([1.03, 1.12, 1.2, 0.98]), { ...opts, size: fixed(0.05) });
    expect(shape(bars).map(([o, c]) => [o, c].map((v) => Math.round(v! / 0.05)))).toEqual([
      [21, 24],
      [23, 20],
    ]);
  });
});

describe('point & figure on any prices', () => {
  it('works below zero', () => {
    const bars = priceBars(closes([-10, -12.2, -13, -9.8]), { type: 'pointFigure', size: fixed(1) });
    expect(shape(bars)).toEqual([
      [-10, -13, 60, 180],
      [-12, -10, 180, 240],
    ]);
    expect(bars.map((b) => b.boxSize)).toEqual([1, 1]);
  });

  it('waits for a positive percent size when prices start at zero', () => {
    const b = new PriceBarBuilder({ type: 'pointFigure', size: { kind: 'percent', percent: 1 } });
    expect(b.setData(closes([0, 0, 0]))).toEqual([]);
    expect(b.size).toBe(0);
    const tick = (time: number, close: number) => b.update({ time, open: close, high: close, low: close, close });
    expect(tick(240, 10).bars).toEqual([]);
    expect(b.size).toBeCloseTo(0.1);
    const [col] = tick(300, 10.25).bars;
    expect([col!.open, col!.close, col!.boxSize]).toEqual([b.size * 100, b.size * 102, b.size]);
  });

  it('waits for a positive ATR size after flat bars', () => {
    const b = new PriceBarBuilder({ type: 'kagi', size: { kind: 'atr', length: 14 } });
    expect(b.setData(closes([5, 5, 5]))).toEqual([]);
    expect(b.size).toBe(0);
    b.update({ time: 240, open: 5, high: 6, low: 5, close: 6 });
    expect(b.size).toBe(1);
    expect(shape(b.update({ time: 300, open: 6, high: 7, low: 6, close: 7 }).bars)).toEqual([[6, 7, 240, 300]]);
  });
});

describe('box size', () => {
  it('averages true ranges plainly up to the length, then smooths', () => {
    const bars: Bar[] = [
      { time: 1, open: 10, high: 11, low: 9, close: 10 }, // 2
      { time: 2, open: 10, high: 14, low: 10, close: 13 }, // 4
      { time: 3, open: 13, high: 13, low: 12, close: 12 }, // 1
    ];
    expect(averageTrueRange(bars.slice(0, 2), 2)).toBe(3);
    // (3 * (2 - 1) + 1) / 2
    expect(averageTrueRange(bars, 2)).toBe(2);
    // A gap counts: high 20 against the previous close 12.
    expect(averageTrueRange([...bars, { time: 4, open: 20, high: 20, low: 19, close: 19 }], 10)).toBe((2 + 4 + 1 + 8) / 4);
  });

  it('resolves ATR and percent sizes from the loaded bars', () => {
    const bars = closes([100, 200]).map((b) => ({ ...b, high: b.close + 1, low: b.close - 1 }));
    const atr = new PriceBarBuilder({ type: 'renko', size: { kind: 'atr', length: 1 } });
    atr.setData(bars);
    expect(atr.size).toBe(101);
    const pct = new PriceBarBuilder({ type: 'range', size: { kind: 'percent', percent: 1 } });
    pct.setData(bars);
    expect(pct.size).toBe(2);
    expect(new PriceBarBuilder({ type: 'renko' }).size).toBeNaN();
  });

  it('rejects invalid options', () => {
    expect(() => new PriceBarBuilder({ type: 'footprint' as never })).toThrow(RangeError);
    expect(() => new PriceBarBuilder({ type: 'renko', size: fixed(0) })).toThrow(RangeError);
    expect(() => new PriceBarBuilder({ type: 'renko', size: { kind: 'atr', length: 1.5 } })).toThrow(RangeError);
    expect(() => new PriceBarBuilder({ type: 'renko', reversal: 1 })).toThrow(RangeError);
    expect(() => new PriceBarBuilder({ type: 'pointFigure', reversal: 0 })).toThrow(RangeError);
    expect(() => new PriceBarBuilder({ type: 'pointFigure', reversal: 1 })).not.toThrow();
    expect(() => new PriceBarBuilder({ type: 'lineBreak', lines: 0 })).toThrow(RangeError);
    expect(() => new PriceBarBuilder({ type: 'range', slotSeconds: -1 })).toThrow(RangeError);
  });

  it('caps the bars one source bar adds', () => {
    const bars = priceBars(closes([0, 1e9]), { type: 'renko', size: fixed(1) });
    expect(bars.length).toBe(10000);
  });
});

describe('live updates', () => {
  it('takes back bricks when the forming source bar retreats', () => {
    const b = new PriceBarBuilder({ type: 'renko', size: fixed(1) });
    b.setData(closes([10, 11.5, 13.2]));
    expect(b.bars.length).toBe(3);
    // The bar at 180 now closes at 12.5: only one brick past the first.
    expect(b.update({ time: 180, open: 12.5, high: 12.5, low: 12.5, close: 12.5 })).toEqual({ bars: [], reset: true });
    expect(shape(b.bars)).toEqual([
      [10, 11, 60, 120],
      [11, 12, 120, 180],
    ]);
    // Then runs to 14: two more bricks, nothing earlier changed.
    const change = b.update({ time: 180, open: 14, high: 14, low: 14, close: 14 });
    expect(change.reset).toBe(false);
    expect(shape(change.bars)).toEqual([
      [12, 13, 180, 180],
      [13, 14, 180, 180],
    ]);
    // A new source bar extends; an older one is ignored.
    expect(shape(b.update({ time: 240, open: 15.1, high: 15.1, low: 15.1, close: 15.1 }).bars)).toEqual([[14, 15, 180, 240]]);
    expect(b.update({ time: 60, open: 1, high: 1, low: 1, close: 1 })).toEqual({ bars: [], reset: false });
  });

  it('updates the forming range bar in place', () => {
    const b = new PriceBarBuilder({ type: 'range', size: fixed(2), source: 'close' });
    b.setData(closes([100, 101]));
    const change = b.update({ time: 180, open: 100.5, high: 100.5, low: 100.5, close: 100.5 });
    expect(change.reset).toBe(false);
    expect(change.bars.map((x) => [x.time, x.high, x.low, x.close, x.endTime])).toEqual([[60, 101, 100, 100.5, 180]]);
  });

  it('streams to the same bars as a one-go build, and the changes rebuild them', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const source: Bar[] = [];
    let price = 100;
    for (let i = 0; i < 400; i++) {
      const open = price;
      price += (rand() - 0.5) * 6;
      source.push({
        time: 60 * (i + 1),
        open,
        high: Math.max(open, price) + rand(),
        low: Math.min(open, price) - rand(),
        close: price,
        volume: 1,
      });
    }
    const variants: PriceBarOptions[] = [
      { type: 'renko', size: fixed(2), source: 'highLow' },
      { type: 'renko', size: fixed(1.5), reversal: 3 },
      { type: 'lineBreak', lines: 2 },
      { type: 'range', size: fixed(3) },
      { type: 'kagi', size: fixed(4) },
      { type: 'kagi', size: fixed(3), source: 'highLow' },
      { type: 'pointFigure', size: fixed(1) },
      { type: 'pointFigure', size: fixed(0.5), reversal: 2, source: 'highLow' },
    ];
    for (const options of variants) {
      const live = new PriceBarBuilder({ ...options, slotSeconds: 60 });
      let shown: PriceBar[] = live.setData([]);
      for (const bar of source) {
        // Each bar forms over three ticks before its final values.
        for (const close of [bar.open, (bar.open + bar.close) / 2, bar.close]) {
          const tick = close === bar.close ? bar : { ...bar, close, high: Math.max(bar.open, close), low: Math.min(bar.open, close) };
          const change = live.update(tick);
          if (change.reset) shown = live.bars;
          for (const b of change.bars) {
            if (shown.length && shown[shown.length - 1]!.time === b.time) shown[shown.length - 1] = b;
            else shown.push(b);
          }
        }
      }
      const once = priceBars(source, { ...options, slotSeconds: 60 });
      expect(live.bars, options.type).toEqual(once);
      expect(shown, options.type).toEqual(once);
      expect(once.length).toBeGreaterThan(10);
    }
  });

  it('continues as a one-go build after a forming bar is replaced, for every type', () => {
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const source: Bar[] = [];
    let price = 100;
    for (let i = 0; i < 200; i++) {
      const open = price;
      price += (rand() - 0.5) * 6;
      source.push({ time: 60 * (i + 1), open, high: Math.max(open, price) + rand(), low: Math.min(open, price) - rand(), close: price, volume: 1 });
    }
    const types: PriceBarOptions[] = [
      { type: 'renko', size: fixed(1.5) },
      { type: 'lineBreak', lines: 3 },
      { type: 'range', size: fixed(3) },
      { type: 'kagi', size: fixed(2) },
      { type: 'pointFigure', size: fixed(1) },
    ];
    for (const options of types) {
      const once = priceBars(source, { ...options, slotSeconds: 60 });
      for (const cut of [60, 140]) {
        const builder = new PriceBarBuilder({ ...options, slotSeconds: 60 });
        const loaded = JSON.stringify(builder.setData(source.slice(0, cut)));
        // A far-off tick of the newest bar moves the engine state, then the real bar
        // replaces it from the saved state: the build must go on as if the tick never came.
        const last = source[cut - 1]!;
        const spike = last.close + 40;
        builder.update({ ...last, close: spike, high: spike });
        expect(JSON.stringify(builder.bars), `${options.type} spike`).not.toBe(loaded);
        builder.update(last);
        expect(JSON.stringify(builder.bars), `${options.type} restored`).toBe(loaded);
        for (const bar of source.slice(cut)) builder.update(bar);
        expect(builder.bars, `${options.type} after ${cut}`).toEqual(once);
      }
    }
  });

  it('uses slotSeconds when built from updates alone', () => {
    const b = new PriceBarBuilder({ type: 'renko', size: fixed(1), slotSeconds: 300 });
    for (const bar of closes([10, 11.5, 13.2])) b.update(bar);
    expect(b.bars.map((x) => x.time)).toEqual([60, 360, 660]);
    expect(b.barAt(360)?.open).toBe(11);
  });

  it('finds the bar at a slot time', () => {
    const b = new PriceBarBuilder({ type: 'renko', size: fixed(1) });
    b.setData(closes([10, 11.5, 13.2]));
    expect(b.barAt(120)?.startTime).toBe(120);
    expect(b.barAt(130)?.open).toBe(11);
    expect(b.barAt(600)).toBeUndefined();
  });
});

describe('a chart of price bars', () => {
  it('reports and labels the source span of the bar in valuesAt', () => {
    const c = new Chart(fakeContainer(), { formatTime: (t) => `t${t}` });
    const bars = priceBars(closes([10, 11.5, 13.2, 12.1, 10.9]), { type: 'renko', size: fixed(1) });
    c.addCandles({ animate: false }).setData(bars);
    const at = c.valuesAt(bars[3]!.time)!;
    expect(at.source).toEqual({ time: 180, endTime: 300 });
    expect(at.timeText).toBe('t180 – t300');
    // A bar from one source bar shows its time once; plain bars report no span.
    expect(c.valuesAt(bars[2]!.time)!.timeText).toBe('t180');
    c.main!.setData(closes([1, 2]));
    const plain = c.valuesAt(60)!;
    expect(plain.timeText).toBe('t60');
    expect(plain).not.toHaveProperty('source');
    c.destroy();
  });
});
