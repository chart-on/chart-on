import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

type Internals = { render(dt: number): boolean; drawGL(): void; sceneDirty: boolean; overlayDirty: boolean };
const internals = (c: Chart) => c as unknown as Internals;

/** A chart whose log records each drawing drawn (by its id) and `gl` where the series draw. */
function chart() {
  const c = new Chart(fakeContainer(), { smoothScale: false });
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i })));
  const log: string[] = [];
  c.drawings.register({
    type: 'probe',
    label: 'Probe',
    points: 1,
    render: (_ctx, d) => void log.push(d.drawing.id),
    hitTest: () => true,
  });
  const gl = internals(c).drawGL.bind(c);
  internals(c).drawGL = () => {
    log.push('gl');
    gl();
  };
  return { c, log };
}

const frame = (c: Chart) => {
  c.invalidate();
  internals(c).render(0);
};

const probe = (text: string, extra: object = {}) => ({ type: 'probe', pane: 0, points: [{ time: 600, price: 120 }], style: {}, text, ...extra });

describe('drawings below the series', () => {
  it('draw before the series, the others after them', () => {
    const { c, log } = chart();
    const top = c.drawings.add(probe('top'));
    const under = c.drawings.add(probe('under', { below: true }));
    frame(c);
    expect(log).toEqual([under.id, 'gl', top.id]);
  });

  it('repaint the scene on drawing redraws while one is below, and on every committed change', () => {
    const { c } = chart();
    const d = c.drawings.add(probe('a'));
    frame(c);
    const dirty = () => {
      const { sceneDirty } = internals(c);
      internals(c).render(0);
      return sceneDirty;
    };
    // A preview only asks for a redraw; a change also reaches the scene (autoscale, below).
    c.drawings.preview(d.id, { style: { color: '#123456' } });
    expect(dirty()).toBe(false);
    c.drawings.update(d.id, { below: true });
    expect(dirty()).toBe(true);
    c.drawings.preview(d.id, { style: { color: '#654321' } });
    expect(dirty()).toBe(true);
    // The bottom layer still shows it until the scene is drawn again.
    c.drawings.update(d.id, { below: false });
    expect(dirty()).toBe(true);
    c.drawings.preview(d.id, { style: { color: '#123456' } });
    expect(dirty()).toBe(false);
  });

  it('are left out of a capture without drawings', () => {
    const { c, log } = chart();
    c.drawings.add(probe('under', { below: true }));
    (c as unknown as { capture: object | null }).capture = { drawings: false };
    frame(c);
    expect(log).toEqual(['gl']);
  });

  it('sit under the other drawings for hit testing, whatever their zIndex', () => {
    const { c } = chart();
    const top = c.drawings.add(probe('top'));
    const under = c.drawings.add(probe('under', { below: true, zIndex: 5 }));
    frame(c);
    const x = c.time.indexToX(10);
    const y = c.panes[0]!.primary.priceToY(120);
    expect(c.drawings.drawingAt({ x, y })).toBe(top.id);
    expect(c.drawings.getAll().map((d) => d.id)).toEqual([under.id, top.id]);
  });

  it('report the flag as an order change, keep it when saved and check its type', () => {
    const { c } = chart();
    const d = c.drawings.add(probe('a'));
    const changes: string[][] = [];
    c.on('drawing:update', (e) => changes.push(e.changes));
    c.drawings.update(d.id, { below: true });
    expect(changes).toEqual([['order']]);
    expect(c.drawings.serialize().drawings[0]!.below).toBe(true);
    expect(() => c.drawings.update(d.id, { below: 1 as unknown as boolean })).toThrow(/below/);
    c.drawings.update(d.id, { below: false });
    expect(c.drawings.serialize().drawings[0]).not.toHaveProperty('below');
  });
});
