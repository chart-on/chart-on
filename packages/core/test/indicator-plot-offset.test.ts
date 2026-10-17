import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { IndicatorDef, PlotDef } from '../src/indicators/types';
import { RectBatch } from '../src/gl/rect-batch';
import { LineBatch } from '../src/gl/line-batch';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

const bar = (i: number): Bar => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 });
const bars = Array.from({ length: 20 }, (_, i) => bar(i));

const LINE = '#4a7bd0';
const FILL = '#7bd04a';

/** A line `l` at i (bar i's value is i), a histogram `h` at i + 1 and a flat line `f` at 10, filled between `f` and `l`. */
const def = (line: Partial<PlotDef> = {}, histogram: Partial<PlotDef> = {}): IndicatorDef => ({
  id: 'test/plot-offset',
  name: 'Plot offset',
  placement: 'pane',
  inputs: [
    { id: 'shift', type: 'number', default: 3 },
    { id: 'tint', type: 'color', default: '' },
  ],
  plots: [
    { id: 'l', type: 'line', color: LINE, ...line } as PlotDef,
    { id: 'h', type: 'histogram', ...histogram } as PlotDef,
    { id: 'f', type: 'line', offset: 2 },
  ],
  fills: [{ between: ['f', 'l'], color: FILL }],
  compute: (src) => ({
    l: Float64Array.from({ length: src.length }, (_, i) => i),
    h: Float64Array.from({ length: src.length }, (_, i) => i + 1),
    f: new Float64Array(src.length).fill(10),
  }),
});

function setup(d: IndicatorDef = def(), options: Record<string, unknown> = {}, renderer: 'canvas' | 'gpu' = 'gpu') {
  const c = new Chart(fakeContainer(), { animateViewChanges: false, ...options });
  charts.push(c);
  c.addCandles().setData(bars);
  c.fitContent(false);
  const indicator = c.indicators.add(d, {}, { renderer });
  return { c, indicator, series: indicator.series! };
}

type Internals = { render(dt: number): boolean; ctx(canvas: unknown): CanvasRenderingContext2D; time: { xToIndex(x: number): number } };
const internals = (c: Chart) => c as unknown as Internals;

/** A 2D context recording the points of each filled or stroked path with the style it was painted in. */
function recorder() {
  const paths: { style: unknown; points: [number, number][] }[] = [];
  let points: [number, number][] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, key: string) => {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (key === 'beginPath') return () => (points = []);
      if (key === 'moveTo' || key === 'lineTo') return (x: number, y: number) => points.push([x, y]);
      if (key === 'fill') return () => paths.push({ style: state.fillStyle, points });
      if (key === 'stroke') return () => paths.push({ style: state.strokeStyle, points });
      if (key in state) return state[key];
      return () => {};
    },
    set: (_t, key: string, value) => {
      state[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, paths };
}

function frame(c: Chart, ctx?: CanvasRenderingContext2D): void {
  if (ctx) internals(c).ctx = () => ctx;
  c.invalidate();
  internals(c).render(0);
}

const legendText = (series: { legend(i: number): { parts: { text: string }[] } }, i: number) => series.legend(i).parts.map((p) => p.text);

describe('indicator plot offset', () => {
  it('rejects a fractional offset and an unknown or non-number offset input', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    expect(() => c.indicators.add(def({ offset: 1.5 }))).toThrow(/plot "l" offset must be a whole number/);
    expect(() => c.indicators.add(def({}, { offsetInput: 'missing' }))).toThrow(/plot "h" names unknown number input "missing"/);
    expect(() => c.indicators.add(def({ offsetInput: 'tint' }))).toThrow(/unknown number input "tint"/);
  });

  it('legend, autoscale and hit tests read the value drawn at a bar', () => {
    const { series } = setup(def({ offset: 3 }, { offset: -2 }));
    // Bar 5 shows line output 2 and histogram output 7 (value 8); `f` is 10 from bar 2 on.
    expect(legendText(series, 5)).toEqual(['2.00', '8.00', '10.00']);
    expect(legendText(series, 1)).toEqual(['—', '4.00', '—']);
    // Bars 0-4: line outputs 0-1, histogram outputs 2-6 (3-7) and its base 0, `f` from bar 2.
    expect(series.priceRange(0, 4)).toEqual([0, 10]);
    // The histogram column at bar 10 is output 12, up to 13.
    const y = (v: number) => series.scale.priceToY(v);
    expect(series.hits(10, y(13))).toBe(true);
    expect(series.hits(3, y(13))).toBe(false);
  });

  it('keeps the newest value for the last-value label and the price line', () => {
    const { series } = setup(def({ offset: 3, priceLine: { source: 'lastVisible' } }, { offset: -2 }));
    expect(series.lastValues().map((l) => l.value)).toEqual([19, 20, 10]);
    // The newest line value drawn by bar 10 is output 7.
    expect(series.priceLines(10).map((l) => l.value)).toEqual([7]);
  });

  it('follows its number input', () => {
    const { indicator, series } = setup(def({ offsetInput: 'shift' }));
    expect(legendText(series, 5)[0]).toBe('2.00');
    indicator.applyInputs({ shift: -1 });
    expect(legendText(series, 5)[0]).toBe('6.00');
  });

  it('writes histogram columns that many bars on', () => {
    const set = vi.spyOn(RectBatch.prototype, 'set');
    setup(def({}, { offset: 4 }));
    const columns = set.mock.calls.filter((call) => call[4] !== undefined && call[3] === (call[0] as number) + 1);
    expect(columns.length).toBeGreaterThan(0);
    for (const call of columns) expect(call[1]).toBe((call[0] as number) + 4);
  });

  it('moves GPU lines and fills through their index shift', () => {
    const range = vi.spyOn(LineBatch.prototype, 'vertexRange');
    const { c } = setup(def({ offset: 3 }));
    frame(c);
    const shifts = new Set(range.mock.contexts.map((batch) => (batch as LineBatch).indexShift));
    // `l` by 3, `f` and the fill (its first plot's) by 2.
    expect(shifts).toEqual(new Set([3, 2]));
  });

  it('draws canvas lines past the last bar, and a fill reads its second plot at the same bars', () => {
    const { c, series } = setup(def({ offset: -1 }), { rightOffset: 10 }, 'canvas');
    frame(c);
    const r = recorder();
    frame(c, r.ctx);
    const time = internals(c).time;
    const at = (p: [number, number]): [number, number] => [Math.round(time.xToIndex(p[0])) + 0, Math.round(series.scale.yToPrice(p[1])) + 0];
    const flat = r.paths.find((p) => p.style !== LINE && p.style !== FILL && p.points.every((q) => at(q)[1] === 10))!;
    // `f` (offset 2) reaches bar 21, past the last bar 19.
    expect(Math.max(...flat.points.map((q) => at(q)[0]))).toBe(21);
    const line = r.paths.find((p) => p.style === LINE)!;
    // Bar p shows output p + 1, from the neighbour left of the screen on.
    expect(at(line.points[0]!)).toEqual([-1, 0]);
    for (const [p, v] of line.points.map(at)) expect(v).toBe(p + 1);
    const fill = r.paths.find((p) => p.style === FILL)!;
    // Top edge `f` at 10, bottom edge `l` as drawn.
    const bottom = fill.points.map(at).filter(([, v]) => v !== 10);
    expect(bottom.length).toBeGreaterThan(0);
    for (const [p, v] of bottom) expect(v).toBe(p + 1);
  });

  it('shifts lines and legend values while the view groups bars', () => {
    const n = 50_000;
    const shift = 5000;
    const c = new Chart(fakeContainer(), { animateViewChanges: false, grouping: { mode: 'pixel' } });
    charts.push(c);
    c.addCandles().setData(Array.from({ length: n }, (_, i) => bar(i)));
    c.fitContent(false);
    const series = c.indicators.add(def({ offset: shift }), {}, { renderer: 'canvas' }).series!;
    frame(c);
    const g = c.buckets!;
    expect(g).toBeTruthy();
    // Bar 20000 shows the last value of the bucket holding output 15000.
    expect(legendText(series, 20_000)[0]).toBe(series.options.format(Math.min(g.end(g.of(15_000)), n) - 1));
    const r = recorder();
    frame(c, r.ctx);
    const time = internals(c).time;
    const line = r.paths.find((p) => p.style === LINE)!;
    const width = g.end(g.of(n / 2)) - g.start(g.of(n / 2));
    for (const [x, y] of line.points) {
      expect(Math.abs(series.scale.yToPrice(y) - (time.xToIndex(x) - shift))).toBeLessThan(2 * width + 1000);
    }
  });
});

describe('plot offset on live bars', () => {
  it('keeps GPU line and fill vertices shifted when bars are appended', () => {
    const build = vi.spyOn(LineBatch.prototype, 'build');
    const band = vi.spyOn(LineBatch.prototype, 'buildBand');
    const c = new Chart(fakeContainer(), { animateViewChanges: false });
    charts.push(c);
    const main = c.addCandles();
    main.setData(bars);
    c.fitContent(false);
    // Incremental, so appended bars write only the new vertices.
    const d = def({ offset: 3 });
    d.update = (_src, _inputs, i, out) => {
      out.l![i] = i;
      out.h![i] = i + 1;
      out.f![i] = 10;
    };
    c.indicators.add(d, {}, { renderer: 'gpu' });
    internals(c).render(0);
    main.update(bar(20));
    main.update(bar(21));
    c.invalidate();
    internals(c).render(0);
    expect(build.mock.calls.map((args) => args[4])).toContain(20);
    /** Drawn points as [timeline index, value, lower value]. */
    const points = (batch: LineBatch) => {
      const f = new Float32Array(batch.bytes.buffer, batch.bytes.byteOffset, batch.count * 4);
      const rows: number[][] = [];
      for (let i = 0; i < batch.count; i++) if (f[i * 4 + 3]) rows.push([f[i * 4]! + batch.indexShift, f[i * 4 + 1]! + batch.base, f[i * 4 + 2]! + batch.base]);
      return rows;
    };
    // Line `l` (value i at bar i) draws 3 bars on.
    const line = points(build.mock.contexts[0] as LineBatch);
    expect(line).toHaveLength(22);
    for (const [index, value] of line) expect(index).toBe(value! + 3);
    // The fill shifts with `f` (2 bars) and reads `l` at the same bars: its lower edge is l drawn there.
    const fill = points(band.mock.contexts[0] as LineBatch);
    expect(fill.length).toBeGreaterThan(18);
    for (const [index, , lower] of fill) expect(index).toBe(lower! + 3);
  });
});
