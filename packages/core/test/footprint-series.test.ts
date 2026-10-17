import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { footprintFromRows, type FootprintBar } from '../src/profile/footprint';
import { footprintSeries, type FootprintSeriesOptions } from '../src/profile/footprint-series';
import type { CustomSeriesBaseOptions, CustomSeriesView } from '../src/series';
import { darkTheme } from '../src/theme';

type Call = [string, ...unknown[]];

/** A 2D context that records the calls the series makes, with the style in force for each fill. */
function recorder() {
  const calls: Call[] = [];
  const ctx = new Proxy(
    { fillStyle: '', strokeStyle: '', textAlign: 'start', font: '', textBaseline: 'alphabetic', lineWidth: 1 } as Record<string, unknown>,
    {
      get(target, key: string) {
        if (key in target) return target[key];
        return (...args: unknown[]) => {
          const style = key === 'strokeRect' ? target.strokeStyle : key.startsWith('fill') ? target.fillStyle : undefined;
          calls.push(style === undefined ? [key, ...args] : [key, style, ...args]);
        };
      },
      set(target, key: string, value) {
        target[key] = value;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, of: (name: string) => calls.filter((c) => c[0] === name) };
}

/** Rows 100 to 104 by 1; buy and sell per row from the lowest up. */
function bar(time = 0, buys = [5, 1, 2, 30, 4], sells = [1, 8, 3, 2, 40]): FootprintBar {
  return footprintFromRows(time, buys.map((buy, i) => ({ price: 100 + i, buy, sell: sells[i] })), 1);
}

/** A view drawing `bars` at `barSpacing` px with `rowPx` css px per price unit. */
function view(bars: FootprintBar[], barSpacing: number, rowPx: number, options: FootprintSeriesOptions = {}) {
  return {
    items: bars.map((item, i) => ({ item, index: i, x: 50 + i * barSpacing })),
    options: { title: 'Footprint', lastValueLabel: false, format: String, ...options } as FootprintSeriesOptions & CustomSeriesBaseOptions,
    width: 400,
    height: 400,
    barSpacing,
    pixelRatio: 1,
    theme: darkTheme,
    priceToY: (p: number) => 300 - (p - 100) * rowPx,
    yToPrice: (y: number) => 100 + (300 - y) / rowPx,
    indexToX: (i: number) => 50 + i * barSpacing,
  } satisfies CustomSeriesView<FootprintBar, FootprintSeriesOptions & CustomSeriesBaseOptions>;
}

describe('footprintSeries', () => {
  it('autoscales to the span of the rows', () => {
    expect(footprintSeries.priceRange(bar(), {})).toEqual([100, 105]);
    expect(footprintSeries.priceRange(footprintFromRows(0, [], 1), {})).toBeNull();
  });

  it('draws narrow bars as one range bar coloured by delta', () => {
    const { ctx, of } = recorder();
    const buying = bar(0, [9, 9, 9, 9, 9], [1, 1, 1, 1, 1]);
    const selling = bar(60, [1, 1, 1, 1, 1], [9, 9, 9, 9, 9]);
    footprintSeries.draw(ctx, view([buying, selling], 1.5, 20));
    expect(of('fillRect').map((c) => c[1])).toEqual([darkTheme.up, darkTheme.down]);
    // Rows 100..105 span 100 px.
    expect(of('fillRect')[0]!.slice(3)).toEqual([200, 1, 100]);
    expect(of('fillText')).toEqual([]);
  });

  it('falls back to a range bar when rows are thinner than 2 px', () => {
    const { ctx, of } = recorder();
    footprintSeries.draw(ctx, view([bar()], 80, 1));
    expect(of('fillRect')).toHaveLength(1);
    expect(of('rect')).toEqual([]);
  });

  it('draws one cell per row, batched by side and shade, and outlines the point of control', () => {
    const { ctx, of } = recorder();
    const b = bar();
    footprintSeries.draw(ctx, view([b], 20, 6));
    expect(of('rect')).toHaveLength(5);
    expect(of('fill')).toHaveLength(8);
    // POC is the 104 row (42 volume): drawn from y 270 to 276.
    expect(b.poc).toBe(4);
    expect(of('strokeRect')).toEqual([['strokeRect', darkTheme.text, 41.5, 270.5, 17, 5]]);
    // Too small for text.
    expect(of('fillText')).toEqual([]);
  });

  it('writes sell and buy per row when there is room, imbalances in the side colour', () => {
    const { ctx, of } = recorder();
    footprintSeries.draw(ctx, view([bar()], 80, 20));
    const texts = of('fillText');
    expect(texts).toHaveLength(10);
    // Row 103: buy 30 against sell 3 one row lower is a buy imbalance; sell 2 is not.
    const row103 = texts.slice(6, 8);
    expect(row103).toEqual([
      ['fillText', darkTheme.text, '2', 47, 230],
      ['fillText', darkTheme.up, '30', 53, 230],
    ]);
    // Row 104: sell 40 with no row above is a sell imbalance.
    expect(texts[8]!.slice(1, 3)).toEqual([darkTheme.down, '40']);
  });

  it('shows delta or total volume when asked, and can turn imbalances off', () => {
    const delta = recorder();
    footprintSeries.draw(delta.ctx, view([bar()], 80, 20, { values: 'delta' }));
    expect(delta.of('fillText').map((c) => c[2])).toEqual(['4', '-7', '-1', '28', '-36']);
    const volume = recorder();
    footprintSeries.draw(volume.ctx, view([bar()], 80, 20, { values: 'volume', imbalance: false }));
    expect(volume.of('fillText').map((c) => c[2])).toEqual(['6', '9', '5', '32', '44']);
    const plain = recorder();
    footprintSeries.draw(plain.ctx, view([bar()], 80, 20, { imbalance: false }));
    expect(new Set(plain.of('fillText').map((c) => c[1]))).toEqual(new Set([darkTheme.text]));
  });

  it('drops the text when it would not fit the bar', () => {
    const { ctx, of } = recorder();
    footprintSeries.draw(ctx, view([bar(0, [123456, 1, 1, 1, 1])], 30, 20));
    expect(of('rect')).toHaveLength(5);
    expect(of('fillText')).toEqual([]);
  });

  it('keeps cells on screen on an inverted scale', () => {
    const { ctx, of } = recorder();
    const v = view([bar()], 20, 6);
    footprintSeries.draw(ctx, { ...v, priceToY: (p) => 100 + (p - 100) * 6 });
    for (const [, , y, , h] of of('rect') as [string, number, number, number, number][]) {
      expect(h).toBe(5);
      expect(y).toBeGreaterThanOrEqual(100);
    }
    expect(of('strokeRect')[0]![5]).toBe(5);
  });

  it('uses option colours over the theme', () => {
    const { ctx, of } = recorder();
    footprintSeries.draw(ctx, view([bar(0, [9], [1]), bar(60, [1], [9])], 1, 20, { upColor: '#00ff00', downColor: '#ff0000' }));
    expect(of('fillRect').map((c) => c[1])).toEqual(['#00ff00', '#ff0000']);
    const outlined = recorder();
    footprintSeries.draw(outlined.ctx, view([bar()], 20, 6, { pocColor: '#123456' }));
    expect(outlined.of('strokeRect')[0]![1]).toBe('#123456');
  });

  it('shows volume and delta in the legend', () => {
    const o = view([], 1, 1).options;
    expect(footprintSeries.legend!(bar(), o)).toEqual([
      { label: 'V', text: '96' },
      { label: 'Δ', text: '-12' },
    ]);
    expect(footprintSeries.legend!(undefined, o)).toEqual([]);
  });

  it('sums the rows of grouped bars', () => {
    const o = view([], 1, 1).options;
    const g = footprintSeries.group!([bar(60), bar(120)], o);
    expect(g.time).toBe(60);
    expect(g.rows.map((r) => [r.buy, r.sell])).toEqual([
      [10, 2],
      [2, 16],
      [4, 6],
      [60, 4],
      [8, 80],
    ]);
    expect(g.delta).toBe(-24);
  });

  describe('on a chart', () => {
    const charts: Chart[] = [];
    afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

    it('draws through addCustomSeries, updates the forming bar and autoscales to its rows', () => {
      const c = new Chart(fakeContainer());
      charts.push(c);
      const errors = vi.fn();
      c.on('series:error', errors);
      c.addCandles().setData([0, 60, 120].map((time) => ({ time, open: 101, high: 102, low: 101, close: 102 })));
      const draw = vi.fn(footprintSeries.draw);
      const fp = c.addCustomSeries({ ...footprintSeries, draw }, { title: 'Footprint', values: 'delta' });
      fp.setData([bar(0), bar(60)]);
      fp.update(bar(120, [1], [2]));
      c.invalidate();
      (c as unknown as { render(t: number): void }).render(0);
      expect(errors).not.toHaveBeenCalled();
      expect(draw).toHaveBeenCalled();
      expect(draw.mock.calls.at(-1)![1].items.map((i) => i.item.time)).toEqual([0, 60, 120]);
      expect(fp.data).toHaveLength(3);
      expect(fp.priceRange(0, 2)).toEqual([100, 105]);
    });
  });
});
