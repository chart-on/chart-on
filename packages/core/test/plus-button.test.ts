import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch, type PlusButtonEvent } from '../src/chart';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  c.addCandles({ precision: 2 }).setData(Array.from({ length: 200 }, (_, i) => ({ time: i * 60, open: 150, high: 200, low: 100, close: 150 })));
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
  return c;
}

type Internals = { plusButtonAt(p: { x: number; y: number }): boolean; plusButtonEvent(): PlusButtonEvent | null };
const internals = (c: Chart) => c as unknown as Internals;

/** Plot point on the button for a crosshair at `y`. */
const onButton = (c: Chart, y: number) => ({ x: c.plotWidth - 10, y });

describe('plus button', () => {
  it('shows only while the app listens and the flag is on', () => {
    const c = chart();
    c.setCrosshair({ x: 100, y: 200, pane: 0 });
    expect(internals(c).plusButtonAt(onButton(c, 200))).toBe(false);
    const off = c.on('plus:click', () => {});
    expect(internals(c).plusButtonAt(onButton(c, 200))).toBe(true);
    expect(internals(c).plusButtonAt({ x: 100, y: 200 })).toBe(false);
    c.applyOptions({ features: { plusButton: false } });
    expect(internals(c).plusButtonAt(onButton(c, 200))).toBe(false);
    c.applyOptions({ features: { plusButton: true } });
    c.setCrosshairAt(60 * 50, 150);
    expect(internals(c).plusButtonEvent()).toBeNull();
    // A locked crosshair has no button either.
    c.setCrosshair({ x: 100, y: 200, pane: 0 });
    c.lockCrosshair(true);
    expect(internals(c).plusButtonAt(onButton(c, 200))).toBe(false);
    c.lockCrosshair(false);
    off();
  });

  it('reports the axis price, rounded to the price format, on linear and log scales', () => {
    for (const mode of ['normal', 'log'] as const) {
      const c = chart();
      c.setPriceScaleMode(mode);
      c.invalidate();
      (c as unknown as { render(t: number): void }).render(0);
      c.on('plus:click', () => {});
      const pane = c.panes[0]!;
      const y = pane.top + pane.height * 0.37;
      c.setCrosshair({ x: 100, y, pane: 0 });
      const e = internals(c).plusButtonEvent()!;
      const expected = Math.round(pane.price.yToPrice(y - pane.top) * 100) / 100;
      expect(e.price).toBeCloseTo(expected, 8);
      expect(e).toMatchObject({ pane: 0, scale: 'right', y });
    }
  });

  it('emits on a press and release on the button, without panning', () => {
    const c = chart();
    const clicks = vi.fn();
    c.on('plus:click', clicks);
    const root = (p: { x: number; y: number }) => ({ clientX: p.x + c.plotLeft, clientY: p.y });
    const p = onButton(c, 220);
    dispatch(c.root, 'pointermove', root(p));
    const offset = c.time.rightOffset;
    dispatch(c.root, 'pointerdown', root(p));
    dispatch(c.root, 'pointermove', root({ x: p.x - 2, y: p.y }));
    dispatch(c.root, 'pointerup', root({ x: p.x - 2, y: p.y }));
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(clicks.mock.calls[0]![0].y).toBe(220);
    expect(c.time.rightOffset).toBe(offset);
    // A press that travels away is no click.
    dispatch(c.root, 'pointermove', root(p));
    dispatch(c.root, 'pointerdown', root(p));
    dispatch(c.root, 'pointerup', root({ x: p.x - 60, y: p.y }));
    expect(clicks).toHaveBeenCalledTimes(1);
  });
});
