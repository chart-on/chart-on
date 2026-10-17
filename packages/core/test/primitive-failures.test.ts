import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { ChartError } from '../src/errors';
import { PrimitiveGuard, type Primitive } from '../src/primitives';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const render = (c: Chart) => (c as unknown as { render(dt: number): boolean }).render(0);

function chart(): Chart {
  const c = new Chart(fakeContainer(), { timezone: 'UTC' });
  charts.push(c);
  c.addCandles({ animate: false }).setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 100, high: 110, low: 90, close: 105 })));
  return c;
}

const boom = () => {
  throw new Error('boom');
};

describe('PrimitiveGuard', () => {
  it('returns the fallback, reports the first failure of each primitive and restores the context', () => {
    const report = vi.fn();
    const guard = new PrimitiveGuard(report);
    const a = {};
    expect(guard.call(a, 'priceRange', boom, null)).toBeNull();
    expect(guard.call(a, 'priceRange', boom, null)).toBeNull();
    expect(guard.call({}, 'lane', () => 3, 0)).toBe(3);
    expect(report).toHaveBeenCalledTimes(1);
    const error = report.mock.calls[0]![0] as ChartError;
    expect(error).toBeInstanceOf(ChartError);
    expect(error.code).toBe('primitive-failed');
    expect(error.context).toEqual({ member: 'priceRange' });
    expect((error.cause as Error).message).toBe('boom');

    const calls: string[] = [];
    const ctx = { save: () => calls.push('save'), restore: () => calls.push('restore') } as unknown as CanvasRenderingContext2D;
    guard.draw(a, 'drawPlot', ctx, boom);
    expect(calls).toEqual(['save', 'restore']);
  });
});

describe('a throwing primitive on the time chart', () => {
  it('is reported once while the other primitives and the frame keep drawing', () => {
    const c = chart();
    const errors = vi.fn();
    c.on('chart:error', errors);
    const broken: Primitive = {
      drawPlot: boom,
      drawPriceAxis: boom,
      drawTimeAxis: boom,
      priceRange: boom,
      priceAxisLabels: boom,
      lane: boom,
      hitTest: boom,
    };
    const drawPlot = vi.fn();
    c.attachPrimitive(broken);
    c.attachPrimitive({ drawPlot, priceRange: () => [500, 500] });
    expect(() => render(c)).not.toThrow();
    expect(() => render(c)).not.toThrow();
    expect(drawPlot).toHaveBeenCalled();
    // The healthy primitive's range still reaches the fit.
    expect(c.panes[0]!.price.maxPrice).toBeGreaterThanOrEqual(500);
    expect(c.primitiveAt({ x: 10, y: 10 })).toBeNull();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]![0].error.code).toBe('primitive-failed');
  });

  it('detaches the others and finishes destroy when a detached throws', () => {
    const c = chart();
    const detached = vi.fn();
    c.attachPrimitive({ detached: boom });
    c.attachPrimitive({ detached });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => c.destroy()).not.toThrow();
    expect(detached).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
