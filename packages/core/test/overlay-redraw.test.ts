import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { LineSeries, Series } from '../src/series';
import type { PrimitiveEnv, PrimitiveRegistry } from '../src/primitives';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

const N = 200;
const times = Array.from({ length: N }, (_, i) => i * 60);

/** Internals the tests reach. */
interface Inside {
  render(dt: number): boolean;
  top: { getContext(type: string): unknown };
  cursorLayer: { getContext(type: string): unknown } | null;
  autoscale(dt: number): boolean;
}
const inside = (c: Chart) => c as unknown as Inside;

/** A 2D context that records the names of the methods called on it. */
function recording() {
  const calls: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
        return () => calls.push(key);
      },
      set: () => true,
    },
  );
  return { ctx, calls };
}

/** Candles, 5 canvas lines (one in a pane of its own) and 50 trend lines, drawn once. */
function busyChart(options: { interactive?: boolean } = {}) {
  const c = new Chart(fakeContainer(), { timezone: 'UTC', ...options });
  charts.push(c);
  c.addCandles({ animate: false }).setData(times.map((time, i) => ({ time, open: 100, high: 110 + (i % 7), low: 90, close: 105 })));
  const lines: LineSeries[] = [];
  for (let k = 0; k < 5; k++) {
    const pane = k === 4 ? c.addPane() : undefined;
    const line = c.addLine({ crosshairMarker: k === 0 }, pane);
    line.setData(times.map((time, i) => ({ time, value: 100 + k + Math.sin(i / 5) })));
    lines.push(line);
  }
  for (let k = 0; k < 50; k++) {
    const i = 100 + k * 2;
    c.drawings.add({ type: 'trendline', pane: 0, points: [{ time: times[i]!, price: 95 }, { time: times[i + 1]!, price: 108 }], style: {} });
  }
  c.invalidate();
  inside(c).render(0);
  return { c, lines };
}

/** Swap the overlay and crosshair canvases' contexts for recording ones. */
function recordLayers(c: Chart) {
  const top = recording();
  const cursor = recording();
  inside(c).top.getContext = () => top.ctx;
  if (inside(c).cursorLayer) inside(c).cursorLayer!.getContext = () => cursor.ctx;
  return { top: top.calls, cursor: cursor.calls };
}

describe('crosshair moves', () => {
  it('redraw only the crosshair layer: no series, drawings, autoscale or GPU work', () => {
    const { c, lines } = busyChart();
    const layers = recordLayers(c);
    const draw2D = vi.spyOn(Series.prototype, 'draw2D');
    const lineDraw2D = vi.spyOn(LineSeries.prototype, 'draw2D');
    const drawGL = vi.spyOn(Series.prototype, 'drawGL');
    const drawings = vi.spyOn(c.drawings, 'render');
    const autoscale = vi.spyOn(inside(c), 'autoscale');
    const marker = vi.spyOn(lines[0]!, 'drawCrosshair2D');

    for (let x = 100; x < 700; x += 50) {
      c.setCrosshair({ x, y: 100, pane: 0 });
      inside(c).render(0);
    }

    expect(draw2D).not.toHaveBeenCalled();
    expect(lineDraw2D).not.toHaveBeenCalled();
    expect(drawGL).not.toHaveBeenCalled();
    expect(drawings).not.toHaveBeenCalled();
    expect(autoscale).not.toHaveBeenCalled();
    expect(layers.top).toEqual([]);
    // The crosshair lines, its labels and the line's marker are on the crosshair layer.
    expect(layers.cursor).toContain('stroke');
    expect(layers.cursor).toContain('fillText');
    expect(marker).toHaveBeenCalledTimes(12);
  });

  it('from the pointer redraw only the crosshair layer too', () => {
    const { c } = busyChart();
    const layers = recordLayers(c);
    const lineDraw2D = vi.spyOn(LineSeries.prototype, 'draw2D');
    for (let x = 100; x < 400; x += 30) {
      // Clear of the trend lines (around y 100-200), so no hover changes.
      dispatch(c.root, 'pointermove', { clientX: x, clientY: 20, pointerType: 'mouse' });
      inside(c).render(0);
    }
    expect(c.crosshair).not.toBeNull();
    expect(lineDraw2D).not.toHaveBeenCalled();
    expect(layers.top).toEqual([]);
    expect(layers.cursor).toContain('stroke');
  });

  it('build no legend keys with JSON', () => {
    const { c } = busyChart();
    c.setCrosshair({ x: 300, y: 100, pane: 0 });
    inside(c).render(0);
    const stringify = vi.spyOn(JSON, 'stringify');
    for (let x = 310; x < 400; x += 10) {
      c.setCrosshair({ x, y: 100, pane: 0 });
      inside(c).render(0);
    }
    expect(stringify).not.toHaveBeenCalled();
  });

  it('on a static chart redraw the overlay, which holds the crosshair there', () => {
    const { c } = busyChart({ interactive: false });
    expect(inside(c).cursorLayer).toBeNull();
    const layers = recordLayers(c);
    c.setCrosshairAt(times[150]!, 100);
    inside(c).render(0);
    // Cleared once and redrawn from scratch, with the crosshair on top.
    expect(layers.top.filter((m) => m === 'clearRect')).toHaveLength(1);
    expect(layers.top.lastIndexOf('stroke')).toBeGreaterThan(layers.top.indexOf('clearRect'));
  });

  it('still draw the crosshair after an overlay or scene redraw', () => {
    const { c } = busyChart();
    c.setCrosshair({ x: 300, y: 100, pane: 0 });
    inside(c).render(0);
    const layers = recordLayers(c);
    c.invalidateOverlay();
    inside(c).render(0);
    expect(layers.top).toContain('clearRect');
    expect(layers.cursor).toContain('stroke');
    layers.cursor.length = 0;
    c.invalidate();
    inside(c).render(0);
    expect(layers.cursor).toContain('stroke');
  });
});

describe('overlay frames', () => {
  it('hand primitives coordinate functions made once, which follow their series', () => {
    const { c, lines } = busyChart();
    const envs: PrimitiveEnv[] = [];
    c.attachPrimitive({ drawPlot: (_ctx, env) => void envs.push(env) }, { series: lines[0]! });
    const layer = vi.spyOn((c as unknown as { primitives: PrimitiveRegistry }).primitives, 'layer');
    c.invalidate();
    inside(c).render(0);
    c.invalidateOverlay();
    inside(c).render(0);
    expect(envs).toHaveLength(2);
    expect(layer).not.toHaveBeenCalled();
    const [a, b] = envs as [PrimitiveEnv, PrimitiveEnv];
    expect(b.priceToY).toBe(a.priceToY);
    expect(b.priceToY(104)).toBeCloseTo(lines[0]!.scale.priceToY(104));
    expect(b.formatPrice(104)).toBe(c.formatPrice(0, 104));
    // The series moves to a scale of its own: the same function now reads that one.
    lines[0]!.applyOptions({ overlay: { top: 0.5, bottom: 0 } });
    c.invalidate();
    inside(c).render(0);
    expect(envs[2]!.priceToY).toBe(a.priceToY);
    expect(a.priceToY(104)).toBeCloseTo(lines[0]!.scale.priceToY(104));
  });

  it('skip primitives of hidden series and other layers', () => {
    const { c, lines } = busyChart();
    const normal = vi.fn();
    const top = vi.fn();
    c.attachPrimitive({ drawPlot: normal }, { series: lines[0]! });
    c.attachPrimitive({ layer: 'top', drawPlot: top });
    c.invalidate();
    inside(c).render(0);
    expect(normal).toHaveBeenCalledTimes(1);
    expect(top).toHaveBeenCalledTimes(1);
    lines[0]!.setVisible(false);
    c.invalidate();
    inside(c).render(0);
    expect(normal).toHaveBeenCalledTimes(1);
    expect(top).toHaveBeenCalledTimes(2);
  });
});

