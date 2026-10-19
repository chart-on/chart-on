import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch, type ViewportClampEvent } from '../src/chart';
import { dataSource, viewportBounds } from '../src/builtins';
import type { DataSource, SymbolInfo } from '../src/data/types';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bar = (i: number): Bar => ({ time: i * 60, open: 150, high: 200, low: 100, close: 150 });

/** 300 one-minute bars, prices 100..200. */
function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), { animateViewChanges: false, plugins: [viewportBounds(), dataSource()], ...options });
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 300 }, (_, i) => bar(i)));
  render(c);
  return c;
}

function render(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
}

/** Fractional bar indices at the plot edges. */
const edges = (c: Chart) => ({ left: c.time.xToIndex(0), right: c.time.xToIndex(c.time.width) });

describe('time bounds', () => {
  it('stop panning at each edge without changing the zoom', () => {
    const c = chart();
    c.setViewportBounds({ time: { from: 100 * 60, to: 200 * 60 } });
    // The newest bars are outside the window: the view slides back to it.
    expect(edges(c).right).toBeCloseTo(200.5);
    const spacing = c.time.barSpacing;
    c.time.pan(-500);
    expect(edges(c).right).toBeCloseTo(200.5);
    c.time.pan(100_000);
    expect(edges(c).left).toBeCloseTo(99.5);
    expect(c.time.barSpacing).toBe(spacing);
  });

  it('snap-fit the window when zooming out past it', () => {
    const c = chart();
    c.setViewportBounds({ time: { from: 100 * 60, to: 149 * 60 } });
    c.time.zoom(0.01, c.time.width / 2);
    expect(c.time.barSpacing).toBeCloseTo(c.time.width / 50);
    expect(edges(c).left).toBeCloseTo(99.5);
    expect(edges(c).right).toBeCloseTo(149.5);
  });

  it('narrow programmatic view changes and report them', () => {
    const c = chart();
    const clamps: ViewportClampEvent[] = [];
    c.on('viewport:clamp', (e) => clamps.push(e));
    c.setViewportBounds({ time: { to: 250 * 60 } });
    c.scrollToRealtime(false);
    expect(Math.floor(edges(c).right)).toBe(250);
    expect(clamps.at(-1)?.applied.to).toBe(250 * 60);
    c.setVisibleTimeRange(200 * 60, 290 * 60, false);
    expect(edges(c).right).toBeLessThanOrEqual(250.5 + 1e-9);
    expect(clamps.at(-1)?.requested.to).toBe(290 * 60);
    const before = clamps.length;
    c.setVisibleTimeRange(100 * 60, 150 * 60, false);
    expect(clamps).toHaveLength(before);
  });

  it('follow the times when history is prepended', () => {
    const c = chart();
    c.setViewportBounds({ time: { from: 100 * 60, to: 200 * 60 } });
    c.main!.setData(Array.from({ length: 400 }, (_, i) => bar(i - 100)));
    render(c);
    // Bar time 200 * 60 is now index 300.
    expect(edges(c).right).toBeCloseTo(300.5);
  });

  it('clear on a symbol change unless kept, and validate', async () => {
    const c = chart();
    const source: DataSource = {
      symbol: async (symbol) => ({ symbol, name: symbol }) as SymbolInfo,
      search: async () => [],
      history: async () => ({ bars: Array.from({ length: 300 }, (_, i) => bar(i)) }),
    };
    c.setDataSource(source);
    await c.setSymbol('A', '1m');
    c.setViewportBounds({ time: { to: 100 * 60 } });
    await c.setSymbol('B', '1m');
    expect(c.viewportBounds).toBeNull();
    c.setViewportBounds({ time: { to: 100 * 60 }, keepOnContextChange: true });
    await c.setSymbol('B', '5m');
    expect(c.viewportBounds?.time).toEqual({ to: 6000 });
    expect(() => c.setViewportBounds({ time: { from: 10, to: 5 } })).toThrow(/from <= to/);
    expect(() => c.setViewportBounds({ price: { low: 5, high: 5 } })).toThrow(/low < high/);
    expect(() => c.setViewportBounds({ price: { low: 1, pane: 4 } })).toThrow(/pane 4/);
  });

  it('go with the plugin', () => {
    const c = chart();
    c.setViewportBounds({ time: { to: 100 * 60 }, price: { low: 120, high: 180 } });
    c.uninstall('@chart-on/core/viewport-bounds');
    expect(c.viewportBounds).toBeNull();
    expect(c.time.bounds).toBeNull();
    expect(c.panes[0]!.price.bounds).toBeNull();
    expect(c.panes[0]!.price.autoScale).toBe(true);
  });
});

describe('price bounds', () => {
  it('keep a scale inside the band through zoom and pan, and restore autoscale when cleared', () => {
    const c = chart();
    const scale = c.panes[0]!.price;
    const events = vi.fn();
    c.on('scale:change', events);
    c.setViewportBounds({ price: { low: 120, high: 180 } });
    expect(scale.autoScale).toBe(false);
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ autoScale: false }));
    expect(scale.minPrice).toBeGreaterThanOrEqual(120);
    expect(scale.maxPrice).toBeLessThanOrEqual(180);
    scale.zoom(4);
    expect([scale.minPrice, scale.maxPrice]).toEqual([120, 180]);
    scale.zoom(0.25);
    // Dragging content down far shows higher prices, up to the band's top.
    scale.pan(10_000);
    expect(scale.maxPrice).toBeCloseTo(180);
    expect(scale.minPrice).toBeGreaterThan(120);
    c.setViewportBounds(null);
    expect(scale.autoScale).toBe(true);
    expect(scale.bounds).toBeNull();
  });

  it('narrow setPriceRange and report it', () => {
    const c = chart();
    const clamps: ViewportClampEvent[] = [];
    c.on('viewport:clamp', (e) => clamps.push(e));
    c.setViewportBounds({ price: { low: 120, high: 180 } });
    c.setPriceRange({ from: 150, to: 200 });
    expect(c.getPriceRange()).toEqual({ from: expect.closeTo(130), to: expect.closeTo(180) });
    expect(clamps).toEqual([
      { axis: 'price', pane: 0, scale: 'right', requested: { from: 150, to: 200 }, applied: { from: expect.closeTo(130), to: expect.closeTo(180) } },
    ]);
    c.setPriceRange({ from: 130, to: 170 });
    expect(clamps).toHaveLength(1);
  });

  it('bound autoscale too', () => {
    const c = chart();
    c.setViewportBounds({ price: { high: 160 } });
    c.setAutoScale(true);
    render(c);
    expect(c.panes[0]!.price.maxPrice).toBeLessThanOrEqual(160 + 1e-9);
  });
});
