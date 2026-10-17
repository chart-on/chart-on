import { afterEach, describe, expect, it } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { IndicatorDef } from '../src/indicators/types';
import type { Primitive, PrimitiveHost } from '../src/primitives';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  const main = c.addCandles();
  main.setData([0, 60, 120].map((time) => ({ time, open: 1, high: 2, low: 0, close: 1 })));
  return c;
}

describe('chart pane management', () => {
  it('reorders panes, keeping the main pane first and drawings with their pane', () => {
    const c = chart();
    const a = c.addPane();
    const b = c.addPane();
    c.drawings.add({ type: 'hline', pane: 2, points: [{ time: 0, price: 1 }], style: {} });
    c.movePane(b, 1);
    expect(c.panes).toEqual([c.panes[0], b, a]);
    expect(c.drawings.getAll()[0]!.pane).toBe(1);
    expect(() => c.movePane(c.panes[0]!, 2)).toThrow();
    c.movePane(b, 99);
    expect(c.panes.indexOf(b)).toBe(2);
    expect(() => c.movePane(b, NaN)).toThrow();
    expect(() => c.movePane(b, Infinity)).toThrow();
    expect(c.panes.indexOf(b)).toBe(2);
  });

  it('moves series between panes and removes panes left empty', () => {
    const c = chart();
    const pane = c.addPane();
    const line = c.addLine({}, pane);
    const hist = c.addHistogram({}, pane);
    expect(c.moveSeries(line, 'above')).toBe(c.panes[0]);
    expect(line.pane).toBe(c.panes[0]);
    expect(c.panes[0]!.series).toContain(line);
    expect(pane.series).toEqual([hist]);

    const fresh = c.moveSeries(line, 'new');
    expect(c.panes.indexOf(fresh)).toBe(1);
    expect(c.panes).toHaveLength(3);
    // Moving the only series out of a pane removes that pane.
    c.moveSeries(line, 'below');
    expect(c.panes).toHaveLength(2);
    expect(line.pane).toBe(pane);
    expect(() => c.moveSeries(c.main!, 'below')).toThrow();
  });

  it('keeps a pane that still holds drawings when its last series moves out', () => {
    const c = chart();
    const pane = c.addPane();
    const line = c.addLine({}, pane);
    c.drawings.add({ type: 'hline', pane: 1, points: [{ time: 0, price: 1 }], style: {} });
    c.moveSeries(line, 'above');
    expect(c.panes).toEqual([c.panes[0], pane]);
    expect(pane.series).toEqual([]);
    expect(c.drawings.getAll().map((d) => d.pane)).toEqual([1]);
  });

  it('reads and sets heights, maximizes and collapses', () => {
    const c = chart();
    const pane = c.addPane({ stretch: 1 });
    const events: unknown[] = [];
    c.on('panes:change', (e) => events.push(e));
    c.setPaneHeights([3, 1]);
    expect(c.getPaneHeights()).toEqual([0.75, 0.25]);
    expect(c.panes.map((p) => p.height)).toEqual([429, 143]); // 572px plot: 600 - 28 axis
    c.maximizePane(pane);
    expect(c.panes.map((p) => p.height)).toEqual([0, 572]);
    c.maximizePane(null);
    c.setPaneCollapsed(pane, true);
    expect(pane.height).toBe(24);
    expect(events.at(-1)).toEqual({ heights: [0.75, 0.25], maximized: -1, collapsed: [false, true], hidden: [false, false] });
  });

  it('toggles maximize on a plot double-click, unless turned off or a drawing handles it', () => {
    const c = chart();
    const pane = c.addPane({ stretch: 1 });
    const events: Array<{ maximized: number }> = [];
    c.on('panes:change', (e) => events.push(e));
    const dblclick = (y: number) => dispatch(c.root, 'dblclick', { clientX: 100, clientY: y });
    const y = pane.top + pane.height / 2;
    dblclick(y);
    expect(c.maximizedPane).toBe(pane);
    expect(events.at(-1)?.maximized).toBe(1);
    dblclick(c.panes[0]!.height / 2);
    expect(c.maximizedPane).toBeNull();
    // The pointer over a drawing: the drawing gets the double-click.
    c.drawings.add({ type: 'hline', pane: 1, points: [{ time: 60, price: 1 }], style: {} });
    dblclick(pane.top + pane.price.priceToY(1));
    expect(c.maximizedPane).toBeNull();
    c.applyOptions({ paneDoubleClickMaximize: false });
    dblclick(y);
    expect(c.maximizedPane).toBeNull();
  });

  it('keeps a collapsed pane expanded size when a separator is dragged', () => {
    const c = chart();
    const a = c.addPane();
    const b = c.addPane();
    const expanded = b.height;
    c.setPaneCollapsed(b, true);
    c.moveSeparator(1, -38);
    expect(a.height).toBe(148);
    c.setPaneCollapsed(b, false);
    expect(Math.abs(b.height - expanded)).toBeLessThanOrEqual(1); // px rounding
    expect(b.height).toBeGreaterThan(90);
  });

  it('hides a pane, giving its height to the others and keeping its series and drawings', () => {
    const c = chart();
    const a = c.addPane({ stretch: 1 });
    const b = c.addPane({ stretch: 1 });
    const line = c.addLine({}, a);
    c.drawings.add({ type: 'hline', pane: 1, points: [{ time: 0, price: 1 }], style: {} });
    c.setPaneHeights([2, 1, 1]);
    const heights = c.panes.map((p) => p.height);
    const events: { hidden: boolean[] }[] = [];
    c.on('panes:change', (e) => events.push(e));
    c.setPaneHidden(a, true);
    expect(a.hidden).toBe(true);
    expect(c.panes.map((p) => p.height)).toEqual([381, 0, 191]); // 572px split 2:1
    expect(events.at(-1)!.hidden).toEqual([false, true, false]);
    expect(a.series).toEqual([line]);
    expect(c.drawings.getAll().map((d) => d.pane)).toEqual([1]);
    // No separator at the hidden pane; the one above `b` resizes the main pane and `b`.
    expect(c.regionAt(10, a.top)).toMatchObject({ kind: 'separator', pane: 2 });
    expect(c.paneIndexAt(b.top + 1)).toBe(2);
    expect(c.valuesAt()!.series.map((v) => v.series)).not.toContain(line);
    c.moveSeparator(2, -20);
    expect(c.panes[0]!.height).toBe(361);
    expect(b.height).toBe(211);
    c.setPaneHidden(a, false);
    expect(a.hidden).toBe(false);
    expect(a.height).toBeGreaterThan(100); // back at its share
    expect(events).toHaveLength(3);
    c.setPaneHidden(a, false);
    expect(events).toHaveLength(3); // no change, no event
  });

  it('never hides the main pane, does not maximize a hidden pane and restores the others when the maximized pane hides', () => {
    const c = chart();
    const a = c.addPane();
    c.setPaneHidden(c.panes[0]!, true);
    expect(c.panes[0]!.hidden).toBe(false);
    c.maximizePane(a);
    c.setPaneHidden(a, true);
    expect(c.maximizedPane).toBeNull();
    expect(c.panes[0]!.height).toBe(572);
    c.maximizePane(a);
    expect(c.maximizedPane).toBeNull();
  });

  it('drops drawings of a removed pane', () => {
    const c = chart();
    const a = c.addPane();
    c.addPane();
    c.drawings.add({ type: 'hline', pane: 1, points: [{ time: 0, price: 1 }], style: {} });
    c.drawings.add({ type: 'hline', pane: 2, points: [{ time: 0, price: 1 }], style: {} });
    c.removePane(a);
    expect(c.drawings.getAll().map((d) => d.pane)).toEqual([1]);
  });

  it('detaches primitives of a removed pane and moves series primitives with their series', () => {
    const c = chart();
    const a = c.addPane();
    const b = c.addPane();
    const line = c.addLine({}, a);
    c.addHistogram({}, a);
    let host: PrimitiveHost | null = null;
    const onSeries: Primitive = { attached: (h) => (host = h) };
    let paneDetached = false;
    const onPane: Primitive = { detached: () => (paneDetached = true) };
    c.attachPrimitive(onSeries, { series: line });
    c.moveSeries(line, b);
    expect(host!.pane).toBe(b);
    c.attachPrimitive(onPane, { pane: a });
    c.removePane(a);
    expect(paneDetached).toBe(true);
    expect(host!.pane).toBe(b);
  });

  it('refuses to attach a primitive to a removed series', () => {
    const c = chart();
    const line = c.addLine({});
    c.removeSeries(line);
    expect(() => c.attachPrimitive({}, { series: line })).toThrow(/unknown series/);
  });

  it('removes an indicator pane, but never the main pane its series moved into', () => {
    const c = chart();
    const def: IndicatorDef = {
      id: 'close',
      name: 'Close',
      placement: 'pane',
      inputs: [],
      plots: [{ id: 'v', type: 'line' }],
      compute: (src) => ({ v: Float64Array.from(src.close) }),
    };
    const kept = c.indicators.add(def);
    const moved = c.indicators.add(def);
    expect(c.panes).toHaveLength(3);
    c.movePane(moved.pane!, 1);
    expect(c.panes.indexOf(kept.pane!)).toBe(2);
    c.moveSeries(moved.series!, c.panes[0]!);
    expect(c.panes).toHaveLength(2);
    c.removeSeries(c.main!);
    expect(() => c.indicators.remove(moved)).not.toThrow();
    expect(c.panes).toHaveLength(2);
    c.indicators.remove(kept);
    expect(c.panes).toHaveLength(1);
  });
});
