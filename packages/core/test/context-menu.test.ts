import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartContextMenuEvent, type ChartOptions } from '../src/chart';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 20, low: 0, close: 10 }));

function chart(options: Partial<ChartOptions> = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  c.addCandles().setData(bars);
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
  return c;
}

function listen(c: Chart): ChartContextMenuEvent[] {
  const seen: ChartContextMenuEvent[] = [];
  c.on('chart:contextmenu', (e) => seen.push(e));
  return seen;
}

describe('contextmenu event', () => {
  it('is not taken without a listener or with the feature off', () => {
    const c = chart();
    expect(c.openContextMenu(100, 100, 0, 0)).toBe(false);
    const off = chart({ features: { contextMenu: false } });
    const seen = listen(off);
    expect(off.openContextMenu(100, 100, 0, 0)).toBe(false);
    expect(seen).toEqual([]);
  });

  it('describes the plot point under the pointer', () => {
    const c = chart();
    const seen = listen(c);
    const x = c.plotLeft + c.time.indexToX(10);
    expect(c.openContextMenu(x, 100, 400, 300)).toBe(true);
    const [e] = seen;
    expect(e).toMatchObject({ target: 'plot', pane: 0, time: 600, index: 10, scale: 'right', drawing: null, clientX: 400, clientY: 300 });
    expect(e!.x).toBe(x);
    expect(e!.price).toBeCloseTo(c.panes[0]!.primary.yToPrice(100));
  });

  it('targets and selects a drawing under the pointer', () => {
    const c = chart();
    const seen = listen(c);
    const price = c.panes[0]!.primary.yToPrice(100);
    const line = c.drawings.add({ type: 'hline', pane: 0, points: [{ time: 0, price }], style: {} });
    c.openContextMenu(c.plotLeft + 50, 100, 0, 0);
    expect(seen[0]).toMatchObject({ target: 'drawing', drawing: line.id });
    expect(c.drawings.selected?.id).toBe(line.id);
  });

  it('reports the price axis scale and price, without a time', () => {
    const c = chart();
    const seen = listen(c);
    c.openContextMenu(c.plotLeft + c.plotWidth + 5, 100, 0, 0);
    expect(seen[0]).toMatchObject({ target: 'priceAxis', pane: 0, scale: 'right', time: null, index: null });
    expect(seen[0]!.price).toBeCloseTo(c.panes[0]!.primary.yToPrice(100));
  });

  it('reports the bar on the time axis, without a price', () => {
    const c = chart();
    const seen = listen(c);
    c.openContextMenu(c.plotLeft + c.time.indexToX(5), c.plotHeight + 5, 0, 0);
    expect(seen[0]).toMatchObject({ target: 'timeAxis', pane: -1, time: 300, index: 5, price: null, scale: null });
  });

  it('takes chart-root x like pointAt, so its event round-trips', () => {
    const c = chart();
    c.addLine({ priceScale: 'left' }).setData(bars.map((b) => ({ time: b.time, value: b.close })));
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
    expect(c.plotLeft).toBeGreaterThan(0);
    const seen = listen(c);
    const x = c.plotLeft + c.time.indexToX(10);
    c.openContextMenu(x, 100, 0, 0);
    const [e] = seen;
    expect(e).toMatchObject({ target: 'plot', x, time: 600, index: 10 });
    expect(c.pointAt(e!.x, e!.y)).toMatchObject({ time: e!.time, index: e!.index });
    // Left of the plot is the left price axis, not the plot.
    c.openContextMenu(c.plotLeft - 5, 100, 0, 0);
    expect(seen[1]).toMatchObject({ target: 'priceAxis', scale: 'left' });
  });

  it('ignores pane separators', () => {
    const c = chart();
    listen(c);
    c.addPane();
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
    expect(c.openContextMenu(100, c.panes[1]!.top, 0, 0)).toBe(false);
  });
});
