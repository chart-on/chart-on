import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer, installFakeDom } from './fake-dom';
import { Chart } from '../src/chart';
import { RECT_STRIDE } from '../src/gl/rect-batch';
import type { CandleSeries, CandleSeriesOptions, Series } from '../src/series';
import { parseColor } from '../src/util/color';
import type { Bar } from '../src/types';

// Browser semantics for colours the fast parsers do not read: a canvas keeps
// its previous fillStyle on an invalid write, and CSS.supports says no.
const NAMED: Record<string, string> = { red: '#ff0000', orange: '#ffa500' };
const cssColor = (v: string) => v in NAMED || /^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\(/i.test(v);
let fillWrites = 0;
installFakeDom();
const createElement = document.createElement.bind(document);
const canvasSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
  const el = createElement(tag) as HTMLCanvasElement;
  if (tag !== 'canvas') return el;
  const getContext = el.getContext.bind(el) as (type: string) => object;
  (el as { getContext: unknown }).getContext = (type: string) => {
    const ctx = getContext(type);
    if (type !== '2d') return ctx;
    let fill = '#000000';
    return new Proxy(ctx, {
      get: (t, k) => (k === 'fillStyle' ? fill : Reflect.get(t, k)),
      set: (t, k, v) => {
        if (k !== 'fillStyle') return Reflect.set(t, k, v);
        fillWrites++;
        if (typeof v === 'string' && cssColor(v)) fill = NAMED[v] ?? v;
        return true;
      },
    });
  };
  return el;
});
vi.stubGlobal('CSS', { supports: (_property: string, value: string) => cssColor(value) });
afterAll(() => {
  canvasSpy.mockRestore();
  vi.unstubAllGlobals();
});

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bar = (i: number, patch: Partial<Bar> = {}): Bar => ({ time: i * 60, open: 10, high: 12, low: 9, close: 11, ...patch });

function setup(options: Partial<CandleSeriesOptions> = {}, bars = Array.from({ length: 5 }, (_, i) => bar(i))) {
  const c = new Chart(fakeContainer());
  charts.push(c);
  const series = c.addCandles({ animate: false, ...options });
  series.setData(bars);
  return { c, series };
}

/** RGBA of every instance in the series' GPU batch. */
function colors(series: CandleSeries): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < series.batch.count; i++) out.push([...series.batch.bytes.subarray(i * RECT_STRIDE + 20, i * RECT_STRIDE + 24)]);
  return out;
}

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const GREEN = [0, 128, 0, 255];

describe('per-bar colours', () => {
  it('change only the instances of that bar', () => {
    const plain = colors(setup().series);
    const bars = Array.from({ length: 5 }, (_, i) => bar(i, i === 2 ? { color: '#ff0000', wickColor: '#0000ff', borderColor: '#008000' } : {}));
    const { series } = setup({}, bars);
    const coloured = colors(series);
    // Candles write a wick, a body and an outline per bar.
    expect(coloured.slice(6, 9)).toEqual([BLUE, RED, GREEN]);
    expect([...coloured.slice(0, 6), ...coloured.slice(9)]).toEqual([...plain.slice(0, 6), ...plain.slice(9)]);
  });

  it('colour the lines of bar styles and the body of hollow candles', () => {
    const bars = [bar(0), bar(1, { color: '#ff0000' })];
    expect(colors(setup({ style: 'bars' }, bars).series).slice(3)).toEqual([RED, RED, RED]);
    expect(colors(setup({ style: 'hlcBars' }, bars).series).slice(2)).toEqual([RED, RED]);
    // A falling hollow candle has a filled body in the bar's colour.
    const hollow = colors(setup({ style: 'hollow' }, [bar(0), bar(1, { open: 12, close: 9, color: '#ff0000' })]).series);
    expect(hollow[6]).toEqual(RED);
  });

  it('survive Heikin Ashi and the live-bar tween', () => {
    const ha = setup({ style: 'heikinAshi' }, [bar(0), bar(1, { color: '#ff0000' })]);
    expect(colors(ha.series)[4]).toEqual(RED);
    const { c, series } = setup({ animate: true }, [bar(0), bar(1, { color: '#ff0000' })]);
    series.update(bar(1, { close: 11.5, color: '#ff0000' }));
    series.step(16);
    expect(colors(series)[4]).toEqual(RED);
    // An update without the colour goes back to the series colours.
    series.update(bar(1, { close: 11.6 }));
    series.step(16);
    expect(colors(series)[4]).not.toEqual(RED);
    c.invalidate();
  });

  it('fall back to the series colour when unparsable, and stay out of exports', () => {
    const { c, series } = setup({}, [bar(0), bar(1, { color: 'not a colour' })]);
    const plain = colors(setup({}, [bar(0), bar(1)]).series);
    expect(colors(series)).toEqual(plain);
    expect(c.getDataTable().columns).toEqual(['time', 'open', 'high', 'low', 'close']);
  });

  it('read any CSS colour the browser resolves', () => {
    expect(colors(setup({}, [bar(0), bar(1, { color: 'red' })]).series)[4]).toEqual(RED);
  });

  it('only recolour wicks and borders the options draw', () => {
    const bars = [bar(0), bar(1, { wickColor: '#0000ff', borderColor: '#008000' })];
    const CLEAR = [0, 0, 0, 0];
    expect(colors(setup({ wicks: false }, bars).series)[3]).toEqual(CLEAR);
    expect(colors(setup({ borders: false }, bars).series)[5]).toEqual(CLEAR);
    const hollow = colors(setup({ style: 'hollow', wicks: false, borders: false }, bars).series);
    expect(hollow.slice(4, 6)).toEqual([CLEAR, CLEAR]);
    expect(hollow[7]).not.toEqual(GREEN);
  });

  it('survive an O(1) append', () => {
    const { series } = setup();
    const rebuild = vi.spyOn(series, 'rebuild');
    series.update(bar(5, { color: '#ff0000', wickColor: '#0000ff' }));
    expect(colors(series).slice(15, 17)).toEqual([BLUE, RED]);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('colour the last-value label and price line like the drawn bar', () => {
    const bars = [bar(0), bar(1, { color: '#ff0000' })];
    expect(setup({}, bars).series.lastValue()?.color).toBe('#ff0000');
    expect(setup({}, [bar(0), bar(1, { color: 'not a colour' })]).series.lastValue()?.color).not.toBe('not a colour');
    // Line styles do not draw per-bar colours, so neither does their label.
    expect(setup({ style: 'line' }, bars).series.lastValue()?.color).not.toBe('#ff0000');
  });
});

describe('colour parsing', () => {
  it('keeps its cache bounded', () => {
    parseColor('orange');
    const writes = fillWrites;
    parseColor('orange');
    expect(fillWrites).toBe(writes);
    for (let i = 0; i < 1100; i++) parseColor(`#${i.toString(16).padStart(6, '0')}`);
    parseColor('orange');
    expect(fillWrites).toBeGreaterThan(writes);
  });
});

describe('series z-order', () => {
  it('draws by zIndex, then the usual grouping, and changes without re-uploading', () => {
    const { c, series } = setup();
    const line = c.addLine();
    line.setData(Array.from({ length: 5 }, (_, i) => ({ time: i * 60, value: 11 })));
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
    const order = () => (c as unknown as { panes: { series: unknown[] }[] }).panes[0]!.series;
    expect(order()).toEqual([series, line]);
    const rebuild = vi.spyOn(series, 'rebuild');
    const dirty = series.batch.dirtyFrom;
    c.sendToBack(line);
    expect(line.zIndex).toBeLessThan(series.zIndex);
    c.moveSeriesToFront(line);
    expect(line.zIndex).toBeGreaterThan(series.zIndex);
    c.sendToBack(series);
    expect(rebuild).not.toHaveBeenCalled();
    expect(series.batch.dirtyFrom).toBe(dirty);
  });

  it('orders GPU series among themselves by zIndex', () => {
    const { c, series } = setup();
    const other = c.addCandles({ animate: false });
    other.setData(Array.from({ length: 5 }, (_, i) => bar(i)));
    const drawn: unknown[] = [];
    for (const s of [series, other]) vi.spyOn(s, 'drawGL').mockImplementation(() => void drawn.push(s));
    series.zIndex = 1;
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
    expect(drawn.indexOf(series)).toBeGreaterThan(drawn.indexOf(other));
    expect(() => (series.zIndex = Number.NaN)).toThrow(/zIndex/);
  });

  it('hit-tests 2D series above GPU series, whatever their zIndex', () => {
    const { c, series } = setup();
    const line = c.addLine({ renderer: 'canvas' });
    line.setData(Array.from({ length: 5 }, (_, i) => ({ time: i * 60, value: 10.5 })));
    series.zIndex = 5;
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
    const at = (s: Series, price: number) => [c.plotLeft + c.time.indexToX(2), c.panes[0]!.top + s.scale.priceToY(price)] as const;
    // Inside the candle body and on the line: the line is drawn on top.
    expect(c.seriesAt(...at(line, 10.5))).toBe(line);
    // Inside the body, away from the line.
    expect(c.seriesAt(...at(series, 11.9))).toBe(series);
  });
});
