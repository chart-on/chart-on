import { afterEach, describe, expect, it } from 'vitest';
import { countingWebgl2, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { BoxGlyph } from '../src/gl/renderer';
import { RECT_STRIDE, type RectBatch } from '../src/gl/rect-batch';
import { priceBars } from '../src/price-bars';
import { kagiLines } from '../src/price-styles';
import type { CandleSeries, CandleSeriesOptions } from '../src/series';
import type { Bar } from '../src/types';
import type { ChartPlugin } from '../src/plugins';
import { PriceBarBuilder } from '../src/price-bars';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

/** Bars one minute apart from t = 60, flat at each close. */
const closes = (values: number[]): Bar[] => values.map((c, i) => ({ time: 60 * (i + 1), open: c, high: c, low: c, close: c }));

/** A kagi stretch or point & figure column at slot `k`. */
const column = (k: number, open: number, close: number): Bar => ({
  time: 60 * (k + 1),
  open,
  close,
  high: Math.max(open, close),
  low: Math.min(open, close),
});

describe('kagiLines', () => {
  const run = (bars: Bar[]) => kagiLines(bars.length, (k) => k, (k) => bars[k]!);

  it('starts thick on a rising stretch and thins where the line falls below the last waist', () => {
    const { yang, yin } = run([column(0, 10, 12), column(1, 12, 10.9), column(2, 10.9, 12.5), column(3, 12.5, 9)]);
    // Up, across, down to the waist 10.9, across, up, across, down to the waist: thick so far.
    expect(yang).toEqual({ index: [0, 0, 1, 1, 2, 2, 3, 3], value: [10, 12, 12, 10.9, 10.9, 12.5, 12.5, 10.9] });
    // Below the waist the line is thin.
    expect(yin).toEqual({ index: [3, 3], value: [10.9, 9] });
  });

  it('starts thin on a falling stretch and thickens where the line rises above the last shoulder', () => {
    const { yang, yin } = run([column(0, 10, 8), column(1, 8, 9), column(2, 9, 7), column(3, 7, 9.5)]);
    expect(yin).toEqual({ index: [0, 0, 1, 1, 2, 2, 3, 3], value: [10, 8, 8, 9, 9, 7, 7, 9] });
    expect(yang).toEqual({ index: [3, 3], value: [9, 9.5] });
  });

  it('breaks the most recent shoulder, also one a failed thin rally set', () => {
    // Thin from the fall under the waist 11. The thin rally to 11.2 fails under the shoulder 11.5 but
    // is the new shoulder, so the rally to 11.8 turns thick at 11.2, not at 11.5.
    const bars = [column(0, 10, 12), column(1, 12, 11), column(2, 11, 11.5), column(3, 11.5, 10.5), column(4, 10.5, 11.2), column(5, 11.2, 10.8), column(6, 10.8, 11.8)];
    const { yang } = run(bars);
    expect(yang.index.slice(-2)).toEqual([6, 6]);
    expect(yang.value.slice(-2)).toEqual([11.2, 11.8]);
  });

  it('breaks a thickness into separate runs', () => {
    // Without a waist before it, the first fall stays thick.
    expect(run([column(0, 10, 12), column(1, 12, 9), column(2, 9, 13)]).yin).toEqual({ index: [], value: [] });
    const { yin } = run([column(0, 10, 12), column(1, 12, 11), column(2, 11, 11.5), column(3, 11.5, 10), column(4, 10, 13)]);
    // Thin from the break under the waist 11 until the break over the shoulder 11.5.
    expect(yin).toEqual({ index: [3, 3, 4, 4], value: [11, 10, 10, 11.5] });
  });
});

/** A chart whose main series draws `bars` in `style`, with the GL program of each instanced draw recorded. */
function setup(style: CandleSeriesOptions['style'], bars: Bar[], options: Partial<CandleSeriesOptions> = {}, plugins?: ChartPlugin[]) {
  const counting = countingWebgl2();
  const draws: { program: string; instances: number }[] = [];
  const sources = new Map<unknown, string>();
  const programs = new Map<unknown, string>();
  let current = 'other';
  const context = new Proxy(counting.context as Record<string, unknown>, {
    get: (target, key) => {
      if (key === 'shaderSource') return (shader: unknown, source: string) => sources.set(shader, source);
      if (key === 'attachShader') {
        return (program: unknown, shader: unknown) => {
          const source = sources.get(shader) ?? '';
          if (source.includes('v_glyph')) programs.set(program, 'box');
          else if (source.includes('firstDraws')) programs.set(program, 'line');
          else if (source.includes('v_hollow')) programs.set(program, 'rect');
        };
      }
      if (key === 'useProgram') return (program: unknown) => (current = programs.get(program) ?? 'other');
      if (key === 'drawArraysInstanced') {
        return (_mode: number, _first: number, _count: number, instances: number) => draws.push({ program: current, instances });
      }
      return target[key as string];
    },
  });
  const c = new Chart(fakeContainer({ webgl: context }), plugins ? { plugins } : {});
  charts.push(c);
  const series = c.addCandles({ style, ...options });
  series.setData(bars);
  const render = () => {
    draws.length = 0;
    c.invalidate();
    (c as unknown as { render(dt: number): boolean }).render(0);
    return draws;
  };
  return { c, series, render, counting };
}

/** The [glyph, lower edge, upper edge] of each box in the series' box batch. */
function boxes(series: CandleSeries): number[][] {
  const batch = (series as unknown as { priceStyle: { boxes: RectBatch } }).priceStyle.boxes;
  const f = new Float32Array(batch.bytes.slice().buffer);
  return Array.from({ length: batch.count }, (_, i) => {
    const o = (i * RECT_STRIDE) / 4;
    return [f[o + 3]!, f[o + 1]! + batch.base, f[o + 2]! + batch.base];
  });
}

describe('kagi style', () => {
  const bars = priceBars(closes([10, 10.5, 11, 12, 11.5, 11, 10.9, 12.5, 9]), { type: 'kagi', size: { kind: 'fixed', size: 1 } });

  it('draws the thin and the thick line on the GPU, not candles', () => {
    const { series, render } = setup('kagi', bars);
    const draws = render();
    expect(draws.filter((d) => d.program === 'line').length).toBe(2);
    expect(draws.filter((d) => d.program === 'rect' || d.program === 'box')).toEqual([]);
    expect(series.drawsOnGpu).toBe(true);
  });

  it('autoscales on the whole line and reports open, high, low and close', () => {
    const { series } = setup('kagi', bars);
    expect(series.priceRange(-1, 10)).toEqual([9, 12.5]);
    expect(series.drawnBarAt(0)).toEqual({ open: 10, high: 12, low: 10, close: 12 });
    expect(series.legend(3)!.parts.map((p) => p.text).slice(0, 4)).toEqual(['12.5', '12.5', '9', '9'].map((v) => series.format(Number(v))));
  });

  it('lets its line go when the style changes', () => {
    const { series, render } = setup('kagi', bars);
    render();
    const kagi = (series as unknown as { priceStyle: { kagi: { yang: { gpu: unknown } } } }).priceStyle.kagi;
    expect(kagi.yang.gpu).not.toBeNull();
    series.applyOptions({ style: 'candles' });
    expect(render().some((d) => d.program === 'rect')).toBe(true);
    expect(kagi.yang.gpu).toBeNull();
  });
});

describe('point & figure style', () => {
  const bars = priceBars(closes([10, 10.6, 11.2, 13.4, 12.1, 11, 10.4, 9.9, 12, 13.1]), {
    type: 'pointFigure',
    size: { kind: 'fixed', size: 1 },
  });

  it('draws an X per rising box and an O per falling box with the box shader', () => {
    const { series, render } = setup('pointFigure', bars);
    const draws = render();
    expect(draws).toEqual([{ program: 'box', instances: 10 }]);
    const { x, o } = BoxGlyph;
    expect(boxes(series)).toEqual([
      [x, 9.5, 10.5],
      [x, 10.5, 11.5],
      [x, 11.5, 12.5],
      [x, 12.5, 13.5],
      [o, 9.5, 10.5],
      [o, 10.5, 11.5],
      [o, 11.5, 12.5],
      [x, 10.5, 11.5],
      [x, 11.5, 12.5],
      [x, 12.5, 13.5],
    ]);
  });

  it('reads the box size from the bars, or takes it from `boxSize`', () => {
    const { series } = setup('pointFigure', bars);
    // Box prices are box middles: the range reaches half a box beyond them.
    expect(series.priceRange(-1, 10)).toEqual([9.5, 13.5]);
    series.applyOptions({ boxSize: 0.5 });
    expect(series.priceRange(-1, 10)).toEqual([9.75, 13.25]);
  });

  it('turns one-box columns from the column before', () => {
    const one = priceBars(closes([10, 12, 11, 12, 10]), { type: 'pointFigure', size: { kind: 'fixed', size: 1 }, reversal: 1 });
    const { series, render } = setup('pointFigure', one);
    render();
    expect(boxes(series).map(([glyph]) => glyph)).toEqual([0, 0, 0, 1, 0, 1, 1].map((g) => (g ? BoxGlyph.o : BoxGlyph.x)));
  });

  it('rewrites the forming column on a live update', () => {
    const { series, render } = setup('pointFigure', bars, { animate: false });
    render();
    series.update(column(2, 11, 15));
    expect(render()).toEqual([{ program: 'box', instances: 12 }]);
    expect(boxes(series).slice(-1)).toEqual([[BoxGlyph.x, 14.5, 15.5]]);
  });
});

describe('price style GPU objects', () => {
  it('are released when the chart is destroyed', () => {
    const kagiBars = priceBars(closes([10, 12, 10, 13]), { type: 'kagi', size: { kind: 'fixed', size: 1 } });
    const k = setup('kagi', kagiBars);
    k.render();
    const kagi = (k.series as unknown as { priceStyle: { kagi: { yang: { gpu: unknown }; yin: { gpu: unknown } } } }).priceStyle.kagi;
    expect(kagi.yang.gpu).not.toBeNull();
    const pf = setup('pointFigure', priceBars(closes([10, 13, 9]), { type: 'pointFigure', size: { kind: 'fixed', size: 1 } }));
    pf.render();
    const box = (pf.series as unknown as { priceStyle: { boxes: RectBatch } }).priceStyle.boxes;
    expect(box.gpu).not.toBeNull();
    const before = [k.counting.deleted.buffer, pf.counting.deleted.buffer];
    k.c.destroy();
    pf.c.destroy();
    expect([kagi.yang.gpu, kagi.yin.gpu, box.gpu]).toEqual([null, null, null]);
    expect(k.counting.deleted.buffer).toBeGreaterThan(before[0]!);
    expect(pf.counting.deleted.buffer).toBeGreaterThan(before[1]!);
  });
});

describe('price styles without the plugin', () => {
  it('frees the GPU objects on the next frame once the plugin is uninstalled', () => {
    for (const [style, owner] of [
      ['kagi', (d: { kagi: { yang: { gpu: unknown } } }) => d.kagi.yang],
      ['pointFigure', (d: { boxes: { gpu: unknown } }) => d.boxes],
    ] as const) {
      const bars = priceBars(closes([10, 12, 10, 13]), { type: style, size: { kind: 'fixed', size: 1 } });
      const { c, series, render, counting } = setup(style, bars);
      render();
      const drawer = (series as unknown as { priceStyle: Parameters<typeof owner>[0] }).priceStyle;
      expect(owner(drawer as never).gpu).not.toBeNull();
      const before = counting.deleted.buffer;
      c.uninstall('@charton/core/price-styles');
      expect(render()).toEqual([]);
      expect(owner(drawer as never).gpu).toBeNull();
      expect(counting.deleted.buffer).toBeGreaterThan(before);
      expect((series as unknown as { priceStyle: unknown }).priceStyle).toBeNull();
    }
  });

  it('draws renko, line break and range bars as candles, from priceBars and PriceBarBuilder', () => {
    const source = closes([10, 11, 12, 13, 11, 9, 8, 10, 12, 14]);
    for (const type of ['renko', 'lineBreak', 'range'] as const) {
      const options = { type, size: { kind: 'fixed', size: 1 } } as const;
      for (const bars of [priceBars(source, options), new PriceBarBuilder(options).setData(source)]) {
        expect(bars.length, type).toBeGreaterThan(0);
        const { render } = setup('candles', [...bars], {}, []);
        const draws = render();
        expect(draws.some((d) => d.program === 'rect'), type).toBe(true);
      }
    }
    // Without the plugin, point & figure draws nothing.
    const { render } = setup('pointFigure', priceBars(source, { type: 'pointFigure', size: { kind: 'fixed', size: 1 } }), {}, []);
    expect(render()).toEqual([]);
  });
});

describe('point & figure box size', () => {
  // Columns without a box size: it reads as the smallest step from a column's close to the next one's open.
  const columns = (steps: [open: number, close: number][]) => steps.map(([open, close], k) => column(k, open, close));

  it('reads it again after new bars, a live update and a history page', () => {
    const { series } = setup('pointFigure', columns([[10, 13], [12, 9]]), { animate: false });
    // Box 1: the boxes reach half a box past the prices.
    expect(series.priceRange(-5, 20)).toEqual([8.5, 13.5]);
    series.setData(columns([[10, 14], [12, 8]]));
    expect(series.priceRange(-5, 20)).toEqual([7, 15]);
    series.setData(columns([[10, 13], [12, 9]]));
    series.update(column(2, 9.5, 12));
    expect(series.priceRange(-5, 20)).toEqual([8.75, 13.25]);
    series.prependBars([{ time: 0, open: 11, high: 11, low: 10.25, close: 10.25 }]);
    expect(series.priceRange(-5, 20)).toEqual([8.875, 13.125]);
  });
});

describe('point & figure boxes in view', () => {
  it('reads the box size the bars carry, even from a single column', () => {
    const one = priceBars(closes([10, 13]), { type: 'pointFigure', size: { kind: 'fixed', size: 1 } });
    expect(one.map((b) => b.boxSize)).toEqual([1]);
    const { series } = setup('pointFigure', one);
    expect(series.priceRange(-1, 10)).toEqual([9.5, 13.5]);
  });

  it('writes only the boxes in the visible price range', () => {
    const { series, render } = setup('pointFigure', [{ ...column(0, 0, 1000), boxSize: 1 } as Bar]);
    series.scale.setRange(400, 420);
    const [draw] = render();
    // 21 boxes in view and one either side beyond the edges, not all 1001.
    expect(draw!.instances).toBeLessThan(30);
    const all = boxes(series);
    expect(all.every(([glyph]) => glyph === BoxGlyph.x)).toBe(true);
    expect(Math.min(...all.map((b) => b[1]!))).toBeGreaterThanOrEqual(397.5);
    expect(Math.max(...all.map((b) => b[2]!))).toBeLessThanOrEqual(422.5);
  });

  it('fills a column whose boxes are too small for a glyph', () => {
    const { series, render } = setup('pointFigure', [{ ...column(0, 0, 100000), boxSize: 1 } as Bar]);
    expect(render()).toEqual([{ program: 'box', instances: 1 }]);
    const [[glyph, low, high]] = boxes(series) as [number[]];
    expect(glyph).toBe(BoxGlyph.fill);
    expect(low).toBeLessThanOrEqual(0);
    expect(high).toBeGreaterThanOrEqual(99999);
  });

  it('keeps boxes on the grid far up a long column', () => {
    const box = 0.05;
    const { series, render } = setup('pointFigure', [{ ...column(0, 50000, 51000), boxSize: box } as Bar]);
    series.scale.setRange(50999, 51000.5);
    render();
    const all = boxes(series);
    expect(all.length).toBeGreaterThan(20);
    for (const [, low, high] of all) {
      // Every box sits on the grid of the box size from the column's low, to float32 precision.
      const mid = (low! + high!) / 2;
      expect(Math.abs(mid / box - Math.round(mid / box))).toBeLessThan(1e-3);
      expect(high! - low!).toBeCloseTo(box, 3);
    }
    expect(Math.max(...all.map((b) => b[2]!))).toBeCloseTo(51000 + box / 2, 3);
  });
});
