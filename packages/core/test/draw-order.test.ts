import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, drawOrder } from '../src/chart';
import type { LineSeries } from '../src/series';
import type { Pane } from '../src/pane';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const times = Array.from({ length: 50 }, (_, i) => i * 60);

/** Candles and four lines in the main pane, a fifth line in a pane of its own. */
function setup() {
  const c = new Chart(fakeContainer(), { timezone: 'UTC' });
  charts.push(c);
  c.addCandles({ animate: false }).setData(times.map((time) => ({ time, open: 1, high: 2, low: 0, close: 1 })));
  const lines: LineSeries[] = [];
  for (let k = 0; k < 5; k++) {
    const line = c.addLine({}, k === 4 ? c.addPane() : undefined);
    line.setData(times.map((time) => ({ time, value: k })));
    lines.push(line);
  }
  return { c, lines };
}

const frame = (c: Chart) => {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
};

describe('draw order', () => {
  it('is sorted once and kept while nothing it depends on changes', () => {
    const { c, lines } = setup();
    const pane = c.panes[0]!;
    const order = drawOrder(pane);
    for (let k = 0; k < 3; k++) {
      frame(c);
      c.setCrosshair({ x: 100 + k * 50, y: 100, pane: 0 });
      frame(c);
    }
    expect(drawOrder(pane)).toBe(order);
    expect(order[0]).toBe(c.main);
    expect(order.slice(1)).toEqual(lines.slice(0, 4));
  });

  it('follows zIndex changes and added, removed and moved series', () => {
    const { c, lines } = setup();
    const [main, extra] = c.panes as [Pane, Pane];
    lines[1]!.zIndex = -1;
    expect(drawOrder(main)[0]).toBe(lines[1]);
    const added = c.addLine();
    added.zIndex = -2;
    expect(drawOrder(main)[0]).toBe(added);
    c.removeSeries(added);
    expect(drawOrder(main)).not.toContain(added);
    expect(drawOrder(main)[0]).toBe(lines[1]);
    c.moveSeries(lines[1]!, extra);
    expect(drawOrder(main)).not.toContain(lines[1]);
    expect(drawOrder(extra)).toEqual([lines[1], lines[4]]);
  });

  it('puts overlay-scale series below the rest at equal zIndex', () => {
    const { c, lines } = setup();
    const pane = c.panes[0]!;
    expect(drawOrder(pane)[0]).toBe(c.main);
    lines[2]!.applyOptions({ overlay: { top: 0.8, bottom: 0 } });
    expect(lines[2]!.overlayScale).not.toBeNull();
    expect(drawOrder(pane)[0]).toBe(lines[2]);
  });
});
