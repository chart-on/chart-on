import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeDevicePixelRatio, dispatch, fakeContainer, runFrame } from './fake-dom';
import { NumericChart, createNumericChart } from '../src/numeric/chart';
import { Chart } from '../src/chart';
import { ChartError } from '../src/errors';
import type { NumericPrimitive, NumericPrimitiveEnv, NumericPrimitiveHost } from '../src/numeric/types';

const charts: NumericChart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

let now = 0;
function frame(): void {
  runFrame((now += 16));
}

function chart(options: Parameters<typeof createNumericChart>[1] = {}): NumericChart {
  const c = createNumericChart(fakeContainer(), options);
  charts.push(c);
  return c;
}

const curve = [
  { x: 0.25, value: 4.1 },
  { x: 1, value: 4.4 },
  { x: 2, value: 4.2 },
  { x: 10, value: 4.6 },
  { x: 30, value: 4.9 },
];

describe('NumericChart', () => {
  it('lays out a plot beside the price axis and above the x axis', () => {
    const c = chart();
    expect(c.width).toBe(800);
    expect(c.height).toBe(600);
    expect(c.plotWidth).toBeGreaterThan(0);
    expect(c.plotWidth).toBeLessThan(800);
    expect(c.plotHeight).toBeLessThan(600);
  });

  it('fits the x range to the data, linear in x rather than by item index', () => {
    const c = chart({ horizontalScale: { margin: 0 } });
    c.addLine().setData(curve);
    frame();
    expect(c.getVisibleRange()).toEqual({ from: 0.25, to: 30 });
    const at = (x: number) => c.coordinateFor(x)!.x;
    // The 2..10 gap is eight times the 1..2 gap on screen too.
    expect(at(10) - at(2)).toBeCloseTo(8 * (at(2) - at(1)));
  });

  it('sorts items and drops invalid ones with a data:dropped event', () => {
    const c = chart();
    const dropped = vi.fn();
    c.on('item:dropped', dropped);
    const s = c.addLine();
    s.setData([{ x: 3, value: 1 }, { x: NaN, value: 1 }, { x: 1, value: Infinity }, { x: 1, value: 2 }, null as never]);
    expect(s.data.map((i) => i.x)).toEqual([1, 3]);
    expect(dropped).toHaveBeenCalledTimes(3);
    expect(dropped.mock.calls[0]![0]).toMatchObject({ series: s, reason: 'invalid' });
  });

  it('converts between data and screen both ways', () => {
    const c = chart();
    c.addLine().setData(curve);
    frame();
    const p = c.coordinateFor(5, 4.5)!;
    const back = c.pointAt(p.x, p.y!)!;
    expect(back.x).toBeCloseTo(5);
    expect(back.price).toBeCloseTo(4.5);
    expect(back.point).toEqual({ x: p.x, y: p.y });
    expect(c.pointAt(-1, 10)).toBeNull();
    expect(c.pointAt(c.plotWidth + 5, 10)).toBeNull();
    expect(c.coordinateFor(5)!.y).toBeNull();
  });

  it('fits the price axis to what is visible', () => {
    const c = chart();
    c.addLine().setData(curve);
    frame();
    const span = () => c.getPriceRange().to - c.getPriceRange().from;
    const all = span();
    c.setVisibleRange({ from: 0, to: 1.5 });
    frame();
    expect(span()).toBeLessThan(all);
    const y = c.coordinateFor(1, 4.1)!.y!;
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(c.plotHeight);
  });

  it('zooms at the pointer on the wheel and stops following new data', () => {
    const c = chart();
    const s = c.addLine();
    s.setData(curve);
    frame();
    const x = c.plotWidth * 0.75;
    const before = c.pointAt(x, 10)!.x;
    dispatch(c.root, 'wheel', { clientX: x, clientY: 10, deltaY: -120, deltaX: 0, deltaMode: 0 });
    expect(c.pointAt(x, 10)!.x).toBeCloseTo(before);
    const zoomed = c.getVisibleRange();
    expect(zoomed.to - zoomed.from).toBeLessThan(30);
    s.setData([...curve, { x: 50, value: 5 }]);
    expect(c.getVisibleRange()).toEqual(zoomed);
    c.fitContent();
    expect(c.getVisibleRange().to).toBeGreaterThan(50);
  });

  it('pans with a pointer drag and reports the view', () => {
    const c = chart();
    c.addLine().setData(curve);
    frame();
    const views = vi.fn();
    c.on('range:change', views);
    const from = c.getVisibleRange().from;
    dispatch(c.root, 'pointerdown', { clientX: 300, clientY: 100 });
    dispatch(c.root, 'pointermove', { clientX: 400, clientY: 100 });
    dispatch(c.root, 'pointerup', { clientX: 400, clientY: 100 });
    expect(c.getVisibleRange().from).toBeLessThan(from);
    frame();
    expect(views).toHaveBeenCalledWith(c.getVisibleRange());
  });

  it('reports the crosshair in x and price, and clears it on leave', () => {
    const c = chart();
    c.addLine().setData(curve);
    frame();
    const moves = vi.fn();
    c.on('crosshair:move', moves);
    dispatch(c.root, 'pointermove', { clientX: 200, clientY: 150 });
    const event = moves.mock.calls[0]![0];
    expect(event.x).toBeCloseTo(c.pointAt(200, 150)!.x);
    expect(event.price).toBeCloseTo(c.pointAt(200, 150)!.price);
    dispatch(c.root, 'pointerleave');
    expect(moves).toHaveBeenLastCalledWith(null);
  });

  it('emits click with the data position', () => {
    const c = chart();
    c.addLine().setData(curve);
    frame();
    const clicks = vi.fn();
    c.on('plot:click', clicks);
    dispatch(c.root, 'pointerdown', { clientX: 120, clientY: 80 });
    dispatch(c.root, 'pointerup', { clientX: 120, clientY: 80 });
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(clicks.mock.calls[0]![0].x).toBeCloseTo(c.pointAt(120, 80)!.x);
  });

  it('reads step, line and histogram values at an x', () => {
    const c = chart();
    const line = c.addLine();
    line.setData([{ x: 0, value: 0 }, { x: 10, value: 10 }]);
    expect(line.valueAt(2.5)).toBeCloseTo(2.5);
    expect(line.valueAt(11)).toBeNull();
    const step = c.addLine({ lineType: 'step' });
    step.setData([{ x: 0, value: 1 }, { x: 10, value: 3 }]);
    expect(step.valueAt(9.9)).toBe(1);
    expect(step.valueAt(10)).toBe(3);
    expect(step.valueAt(-1)).toBeNull();
    const bars = c.addHistogram();
    bars.setData([{ x: 100, value: 5 }, { x: 110, value: 7 }]);
    expect(bars.columnWidth()).toBeCloseTo(8);
    expect(bars.valueAt(103)).toBe(5);
    expect(bars.valueAt(105)).toBeNull();
    expect(bars.valueAt(108)).toBe(7);
  });

  it('includes a histogram base and keeps half a column inside the fit', () => {
    const c = chart({ horizontalScale: { margin: 0 } });
    c.addHistogram().setData([{ x: 100, value: 5 }, { x: 110, value: 7 }]);
    frame();
    expect(c.getVisibleRange()).toEqual({ from: 96, to: 114 });
    expect(c.getPriceRange().from).toBeLessThanOrEqual(0);
  });

  it('inverts the horizontal axis', () => {
    const c = chart({ horizontalScale: { invert: true } });
    c.addLine().setData(curve);
    frame();
    expect(c.coordinateFor(30)!.x).toBeLessThan(c.coordinateFor(1)!.x);
  });

  it('adds, changes and removes price lines and series', () => {
    const c = chart();
    const s = c.addLine();
    s.setData(curve);
    const line = c.addPriceLine({ price: 4.5, title: 'Target' });
    expect(line.options).toMatchObject({ price: 4.5, axisLabel: true, lineStyle: 'dashed' });
    line.applyOptions({ price: 4.7 });
    expect(line.options.price).toBe(4.7);
    line.remove();
    frame();
    s.remove();
    expect(c.getSeries()).toEqual([]);
    frame();
  });

  it('reports a throwing listener as a ChartError instead of breaking the frame', () => {
    const c = chart();
    const errors = vi.fn();
    c.on('chart:error', errors);
    c.on('range:change', () => {
      throw new Error('boom');
    });
    c.addLine().setData(curve);
    expect(() => frame()).not.toThrow();
    const error = errors.mock.calls[0]![0].error;
    expect(error).toBeInstanceOf(ChartError);
    expect(error.code).toBe('listener-failed');
  });

  it('has none of the time chart’s time-only API', () => {
    const c = chart() as unknown as Record<string, unknown>;
    for (const name of ['addCandles', 'setDataSource', 'setSymbol', 'timeToX']) {
      expect(typeof (Chart.prototype as unknown as Record<string, unknown>)[name], name).toBe('function');
      expect(c[name], name).toBeUndefined();
    }
    expect(c.indicators).toBeUndefined();
    expect(c.drawings).toBeUndefined();
  });

  it('switches themes and interactivity', () => {
    const c = chart();
    c.addHistogram().setData([{ x: 1, value: 1 }]);
    c.applyOptions({ theme: { line: '#ff0000' }, interactive: false, horizontalScale: { format: { type: 'percent' } } });
    expect(c.theme.line).toBe('#ff0000');
    expect(c.root.tabIndex).toBe(-1);
    const moves = vi.fn();
    c.on('crosshair:move', moves);
    dispatch(c.root, 'pointermove', { clientX: 100, clientY: 100 });
    expect(moves).not.toHaveBeenCalled();
    frame();
    c.applyOptions({ horizontalScale: { format: undefined } });
    expect(c.options.horizontalScale.format).toBeUndefined();
  });

  it('merges theme patches like the time chart and reports them', () => {
    const c = chart();
    const themes = vi.fn();
    c.on('theme:change', themes);
    c.applyOptions({ theme: { line: '#ff0000' } });
    c.applyOptions({ theme: { grid: '#00ff00' } });
    expect(c.theme.line).toBe('#ff0000');
    expect(c.theme.grid).toBe('#00ff00');
    expect(themes).toHaveBeenCalledTimes(2);
    expect(themes.mock.calls[1]![0].theme).toBe(c.theme);
    c.applyOptions({ grid: false });
    expect(themes).toHaveBeenCalledTimes(2);
  });

  it('lays out again when the theme changes the font size', () => {
    const c = chart();
    const before = c.plotHeight;
    c.applyOptions({ theme: { fontSize: 24 } });
    expect(c.plotHeight).toBeLessThan(before);
  });

  it('follows a device pixel ratio change without a resize', () => {
    const c = chart();
    try {
      changeDevicePixelRatio(2);
      expect(c.dpr).toBe(2);
      changeDevicePixelRatio(1.5);
      expect(c.dpr).toBe(1.5);
    } finally {
      changeDevicePixelRatio(1);
    }
    expect(c.dpr).toBe(1);
  });

  it('leaves key combinations with modifiers to the page', () => {
    const c = chart();
    c.addLine().setData(curve);
    frame();
    const before = c.getVisibleRange();
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      const e = dispatch(c.root, 'keydown', { key: '+', [mod]: true });
      expect(e.defaultPrevented).toBe(false);
    }
    expect(c.getVisibleRange()).toEqual(before);
    const e = dispatch(c.root, 'keydown', { key: '+' });
    expect(e.defaultPrevented).toBe(true);
    expect(c.getVisibleRange()).not.toEqual(before);
  });

  it('never lets a drag or zoom lose the data off screen', () => {
    const c = chart({ horizontalScale: { margin: 0 } });
    c.addLine().setData(curve);
    frame();
    dispatch(c.root, 'pointerdown', { clientX: 10, clientY: 100 });
    for (let x = 20; x <= 2000; x += 10) dispatch(c.root, 'pointermove', { clientX: x, clientY: 100 });
    dispatch(c.root, 'pointerup', { clientX: 2000, clientY: 100 });
    let range = c.getVisibleRange();
    expect(range.to).toBeGreaterThan(0.25);
    for (let i = 0; i < 100; i++) dispatch(c.root, 'wheel', { clientX: 100, clientY: 100, deltaY: 500, deltaX: 0, deltaMode: 0 });
    range = c.getVisibleRange();
    expect(range.to - range.from).toBeLessThanOrEqual(10 * (30 - 0.25) + 1e-9);
    expect(range.to).toBeGreaterThan(0.25);
    expect(range.from).toBeLessThan(30);
  });

  it('handles x values near the float limit', () => {
    const c = chart();
    const s = c.addLine();
    s.setData([
      { x: -Number.MAX_VALUE, value: 1 },
      { x: Number.MAX_VALUE, value: 2 },
    ]);
    expect(() => frame()).not.toThrow();
    const range = c.getVisibleRange();
    expect(Number.isFinite(range.to - range.from)).toBe(true);
    s.setData([{ x: 1e-300, value: 1 }, { x: 2e-300, value: 2 }]);
    expect(() => frame()).not.toThrow();
  });

  it('works out histogram column widths again after new data', () => {
    const c = chart();
    const bars = c.addHistogram();
    bars.setData([{ x: 0, value: 1 }, { x: 10, value: 2 }]);
    expect(bars.columnWidth()).toBeCloseTo(8);
    bars.setData([{ x: 0, value: 1 }, { x: 5, value: 2 }]);
    expect(bars.columnWidth()).toBeCloseTo(4);
    bars.applyOptions({ columnWidth: 2 });
    expect(bars.columnWidth()).toBe(2);
  });

  it('reports destroy', () => {
    const c = chart();
    const destroyed = vi.fn();
    c.on('chart:destroy', destroyed);
    c.destroy();
    expect(destroyed).toHaveBeenCalledTimes(1);
  });

  it('cleans up on destroy', () => {
    const c = chart();
    c.addLine().setData(curve);
    c.destroy();
    c.destroy();
    expect(() => c.invalidate()).not.toThrow();
  });
});

describe('NumericChart primitives', () => {
  it('draws each layer in order with coordinates in x', () => {
    const c = chart({ horizontalScale: { margin: 0 } });
    c.addLine().setData(curve);
    const order: string[] = [];
    let seen: NumericPrimitiveEnv | null = null;
    const draw = (name: string) => (_ctx: CanvasRenderingContext2D, env: NumericPrimitiveEnv) => {
      order.push(name);
      seen = env;
    };
    c.attachPrimitive({ layer: 'top', drawPlot: draw('top') });
    c.attachPrimitive({ drawPlot: draw('normal') });
    c.attachPrimitive({ layer: 'below', drawPlot: draw('below') });
    frame();
    expect(order).toEqual(['below', 'normal', 'top']);
    const env = seen!;
    expect(env).toMatchObject({ width: c.plotWidth, height: c.plotHeight, from: 0.25, to: 30, theme: c.theme });
    expect(env.xToPixel(10)).toBeCloseTo(c.coordinateFor(10)!.x);
    expect(env.pixelToX(env.xToPixel(7))).toBeCloseTo(7);
    expect(env.priceToY(4.5)).toBeCloseTo(c.coordinateFor(10, 4.5)!.y!);
    expect(env.yToPrice(env.priceToY(4.5))).toBeCloseTo(4.5);
    expect(env.formatX(2.5)).toMatch(/^2\.5/);
    expect(typeof env.formatPrice(4.5)).toBe('string');
  });

  it('keeps a primitive price range in view and asks for its axis labels', () => {
    const c = chart();
    c.addLine().setData(curve);
    const labels = vi.fn(() => [{ price: 8, text: 'Alert', color: '#f59e0b' }]);
    const range = vi.fn((): [number, number] => [8, 8]);
    c.attachPrimitive({ priceRange: range, priceAxisLabels: labels });
    frame();
    expect(c.getPriceRange().to).toBeGreaterThanOrEqual(8);
    const { from, to } = c.getVisibleRange();
    expect(range).toHaveBeenCalledWith(from, to);
    expect(labels).toHaveBeenCalled();
    // Ranges that are not finite or run backwards are ignored.
    c.attachPrimitive({ priceRange: () => [Infinity, 1] });
    c.attachPrimitive({ priceRange: () => [3, 2] });
    frame();
    expect(Number.isFinite(c.getPriceRange().from)).toBe(true);
  });

  it('attaches, redraws on request and detaches', () => {
    const c = chart();
    let host: NumericPrimitiveHost | null = null;
    const detached = vi.fn();
    const drawPlot = vi.fn();
    const p: NumericPrimitive = { attached: (h) => (host = h), detached, drawPlot };
    const detach = c.attachPrimitive(p);
    expect(() => c.attachPrimitive(p)).toThrow('already attached');
    frame();
    expect(drawPlot).toHaveBeenCalledTimes(1);
    host!.requestRedraw();
    frame();
    expect(drawPlot).toHaveBeenCalledTimes(2);
    detach();
    expect(detached).toHaveBeenCalledTimes(1);
    frame();
    expect(drawPlot).toHaveBeenCalledTimes(2);
    // A stale handle does not detach a later attachment.
    c.attachPrimitive(p);
    detach();
    expect(detached).toHaveBeenCalledTimes(1);
    c.detachPrimitive(p);
    expect(detached).toHaveBeenCalledTimes(2);
  });

  it('does not attach a primitive whose attached throws', () => {
    const c = chart();
    const drawPlot = vi.fn();
    expect(() =>
      c.attachPrimitive({
        attached: () => {
          throw new Error('no');
        },
        drawPlot,
      }),
    ).toThrow('no');
    frame();
    expect(drawPlot).not.toHaveBeenCalled();
  });

  it('detaches every primitive on destroy', () => {
    const c = chart();
    const detached = vi.fn();
    c.attachPrimitive({ detached });
    c.destroy();
    expect(detached).toHaveBeenCalledTimes(1);
  });
});

describe('NumericChart primitives that fail', () => {
  const boom = () => {
    throw new Error('boom');
  };

  it('reports a throwing member once and keeps drawing the rest', () => {
    const c = chart();
    c.addLine().setData(curve);
    const errors = vi.fn();
    c.on('chart:error', errors);
    const drawPlot = vi.fn();
    c.attachPrimitive({ drawPlot: boom, priceRange: boom, priceAxisLabels: boom });
    c.attachPrimitive({ layer: 'top', drawPlot: boom });
    c.attachPrimitive({ drawPlot, priceRange: () => [9, 9] });
    expect(() => frame()).not.toThrow();
    c.invalidate();
    expect(() => frame()).not.toThrow();
    expect(drawPlot).toHaveBeenCalledTimes(2);
    expect(c.getPriceRange().to).toBeGreaterThanOrEqual(9);
    // One report per failing primitive, not per call or frame.
    expect(errors).toHaveBeenCalledTimes(2);
    const error = errors.mock.calls[0]![0].error;
    expect(error).toBeInstanceOf(ChartError);
    expect(error.code).toBe('primitive-failed');
  });

  it('finishes destroy when a detached throws', () => {
    const c = chart();
    const errors = vi.fn();
    c.on('chart:error', errors);
    const detached = vi.fn();
    c.attachPrimitive({ detached: boom });
    c.attachPrimitive({ detached });
    expect(() => c.destroy()).not.toThrow();
    expect(detached).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
    // Destroy went past detaching: the chart counts as destroyed.
    expect(() => c.attachPrimitive({})).toThrow(expect.objectContaining({ code: 'destroyed' }));
  });

  it('throws a ChartError when attaching after destroy', () => {
    const c = chart();
    c.destroy();
    expect(() => c.attachPrimitive({})).toThrow(expect.objectContaining({ code: 'destroyed' }));
  });

  it('leaves axis labels off the visible prices out of the axis width', () => {
    const c = chart();
    c.addLine().setData(curve);
    frame();
    const width = c.plotWidth;
    const long = 'a much longer label than any tick';
    c.attachPrimitive({
      priceAxisLabels: () => [
        { price: 1e6, text: long, color: '#f59e0b' },
        { price: NaN, text: long, color: '#f59e0b' },
      ],
    });
    frame();
    expect(c.plotWidth).toBe(width);
    c.attachPrimitive({ priceAxisLabels: () => [{ price: 4.5, text: long, color: '#f59e0b' }] });
    frame();
    expect(c.plotWidth).toBeLessThan(width);
  });

  it('redraws on requestOverlayRedraw too', () => {
    const c = chart();
    let host: NumericPrimitiveHost | null = null;
    const drawPlot = vi.fn();
    c.attachPrimitive({ attached: (h) => (host = h), drawPlot });
    frame();
    host!.requestOverlayRedraw();
    frame();
    expect(drawPlot).toHaveBeenCalledTimes(2);
  });
});
