import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { withBuiltinTools } from './builtin-tools';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

/** 50 bars, one a minute, trading between 99 and 150. */
function chart() {
  const c = new Chart(fakeContainer(), { smoothScale: false });
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i })));
  frame(c);
  return c;
}

/** Run the next frame's work as it is: frames never run on their own under the fake DOM. */
const render = (c: Chart) => (c as unknown as { render(dt: number): boolean }).render(0);

function frame(c: Chart): void {
  c.invalidate();
  render(c);
}

const hline = (price: number, extra: object = {}) => ({ type: 'hline', pane: 0, points: [{ time: 600, price }], style: {}, ...extra });

describe('drawings with autoscale', () => {
  it('keep their prices in view, and only while the flag is on', () => {
    const c = chart();
    const scale = c.panes[0]!.primary;
    const off = c.drawings.add(hline(300));
    frame(c);
    expect(scale.maxPrice).toBeLessThan(300);
    // The flag change alone schedules the refit.
    c.drawings.update(off.id, { autoscale: true });
    render(c);
    expect(scale.maxPrice).toBeGreaterThanOrEqual(300);
    c.drawings.update(off.id, { autoscale: false });
    render(c);
    expect(scale.maxPrice).toBeLessThan(300);
  });

  it('widen the range downwards too, from every anchor', () => {
    const c = chart();
    c.drawings.add({ type: 'trendline', pane: 0, points: [{ time: 60, price: 20 }, { time: 1200, price: 260 }], style: {}, autoscale: true });
    frame(c);
    const scale = c.panes[0]!.primary;
    expect(scale.minPrice).toBeLessThanOrEqual(20);
    expect(scale.maxPrice).toBeGreaterThanOrEqual(260);
  });

  it('add nothing out of view, hidden, without a price side or with drawings hidden', () => {
    const c = chart();
    const scale = c.panes[0]!.primary;
    // Starts after the newest bar.
    c.drawings.add({ type: 'trendline', pane: 0, points: [{ time: 6000, price: 400 }, { time: 7200, price: 500 }], style: {}, autoscale: true });
    c.drawings.add({ type: 'vline', pane: 0, points: [{ time: 600, price: 900 }], style: {}, autoscale: true });
    const hidden = c.drawings.add(hline(700, { autoscale: true, hidden: true }));
    frame(c);
    expect(scale.maxPrice).toBeLessThan(200);
    c.drawings.setVisible(hidden.id, true);
    render(c);
    expect(scale.maxPrice).toBeGreaterThanOrEqual(700);
    c.drawings.setHidden(true);
    render(c);
    expect(scale.maxPrice).toBeLessThan(200);
  });

  it('report the flag as a flags change and keep it when saved', () => {
    const c = chart();
    const d = c.drawings.add(hline(300));
    const changes: string[][] = [];
    c.on('drawing:update', (e) => changes.push(e.changes));
    c.drawings.update(d.id, { autoscale: true });
    expect(changes).toEqual([['flags']]);
    expect(c.drawings.serialize().drawings[0]!.autoscale).toBe(true);
    expect(() => c.drawings.update(d.id, { autoscale: 'yes' as unknown as boolean })).toThrow(/autoscale/);
  });
});

describe('DrawingManager.fitRange', () => {
  // x = (index - 99) * 10 + 1000, time = index * 60, price = 500 - y.
  function setup() {
    const timeline = new Timeline();
    timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
    const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
    time.width = 1000;
    time.barCount = 100;
    const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
    pane.height = 500;
    pane.price.height = 500;
    pane.price.fit(0, 500);
    const host: DrawingHost = {
      theme: darkTheme,
      timeline,
      time,
      panes: [pane],
      magnetPrice: (_i, price) => price,
      formatPrice: (_p, price) => price.toFixed(2),
      requestOverlay: () => {},
      editText: (_at, _initial, done) => done(null),
      emit: () => {},
    };
    return withBuiltinTools(new DrawingManager(host));
  }

  it('holds still while a drawing is dragged and refits on release', () => {
    const m = setup();
    m.add(hline(200, { autoscale: true }));
    expect(m.fitRange(0, 0, 5940, false)).toEqual([200, 200]);
    m.pointerMove({ x: 500, y: 300 });
    m.pointerDown(0, { x: 500, y: 300 });
    m.pointerMove({ x: 500, y: 100 });
    expect(m.fitRange(0, 0, 5940, false)).toEqual([200, 200]);
    m.pointerUp({ x: 500, y: 100 });
    expect(m.fitRange(0, 0, 5940, false)).toEqual([400, 400]);
  });

  it('skips prices a log scale cannot show, other panes and screen-anchored tools', () => {
    const m = setup();
    m.add(hline(-5, { autoscale: true }));
    m.add(hline(50, { autoscale: true, pane: 1 }));
    m.register({ type: 'note', label: 'Note', points: 1, anchoring: 'screen', render() {}, hitTest: () => false });
    m.add({ type: 'note', pane: 0, points: [{ time: 0, price: 0.5 }], style: {}, autoscale: true });
    expect(m.fitRange(0, 0, 5940, true)).toBeNull();
    expect(m.fitRange(0, 0, 5940, false)).toEqual([-5, -5]);
    // A copy each time: the chart widens it in place.
    const r = m.fitRange(0, 0, 5940, false)!;
    r[1] = 99;
    expect(m.fitRange(0, 0, 5940, false)).toEqual([-5, -5]);
  });
});
