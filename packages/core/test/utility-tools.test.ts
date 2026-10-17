import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { Point } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 200 }, (_, i) => ({ time: i * 60, open: 150, high: 200, low: 100, close: 150 })));
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
  return c;
}

/** Client coordinates of plot-space `p`. */
const client = (c: Chart, p: Point) => ({ clientX: p.x + c.plotLeft, clientY: p.y });

/** Press at the first point, move through the rest and release at the last. */
function drag(c: Chart, points: Point[]) {
  dispatch(c.root, 'pointerdown', client(c, points[0]!));
  points.slice(1).forEach((p, i) => dispatch(c.root, 'pointermove', { ...client(c, p), timeStamp: i + 1 }));
  dispatch(c.root, 'pointerup', { ...client(c, points.at(-1)!), timeStamp: points.length });
}

/** Horizontal lines at plot heights `ys`, placed with the tool. */
function hlines(c: Chart, ys: number[]): string[] {
  for (const y of ys) {
    c.drawings.setTool('hline');
    drag(c, [{ x: 200, y }]);
  }
  return c.drawings.getAll().map((d) => d.id);
}

describe('eraser', () => {
  it('removes the drawing a click hits, as one undo step, then goes back to the cursor', () => {
    const c = chart();
    const [a, b] = hlines(c, [100, 200]);
    c.drawings.setTool('eraser');
    // A click on nothing erases nothing and keeps the eraser.
    drag(c, [{ x: 150, y: 150 }]);
    expect(c.drawings.getAll()).toHaveLength(2);
    expect(c.drawings.tool).toBe('eraser');
    const removed = vi.fn();
    c.on('drawing:remove', removed);
    drag(c, [{ x: 150, y: 100 }]);
    expect(c.drawings.getAll().map((d) => d.id)).toEqual([b]);
    expect(removed).toHaveBeenCalledTimes(1);
    expect(c.drawings.tool).toBe(null);
    expect(c.drawings.undo()).toBe(true);
    expect(c.drawings.getAll().map((d) => d.id)).toEqual([a, b]);
  });

  it('removes every unlocked drawing a drag crosses; a kept eraser stays', () => {
    const c = chart();
    const [a, b, d] = hlines(c, [100, 150, 200]);
    c.drawings.update(b!, { locked: true });
    c.drawings.setTool('eraser', { keep: true });
    drag(c, [{ x: 150, y: 80 }, { x: 160, y: 140 }, { x: 170, y: 220 }]);
    expect(c.drawings.getAll().map((x) => x.id)).toEqual([b]);
    expect(c.drawings.tool).toBe('eraser');
    expect(c.drawings.undo()).toBe(true);
    expect(c.drawings.getAll().map((x) => x.id)).toEqual([a, b, d]);
    // Nothing goes while all drawings are locked.
    c.drawings.setLocked(true);
    drag(c, [{ x: 150, y: 80 }, { x: 170, y: 220 }]);
    expect(c.drawings.getAll()).toHaveLength(3);
  });
});

describe('zoom box', () => {
  it('zooms the view to the dragged box, then goes back to the cursor', () => {
    const c = chart();
    const pane = c.panes[0]!;
    const [from, to] = [c.time.xToIndex(100), c.time.xToIndex(300)];
    const [high, low] = [pane.primary.yToPrice(80 - pane.top), pane.primary.yToPrice(240 - pane.top)];
    c.drawings.setTool('zoom-box');
    drag(c, [{ x: 300, y: 240 }, { x: 200, y: 160 }, { x: 100, y: 80 }]);
    expect(c.drawings.getAll()).toHaveLength(0);
    expect(c.drawings.tool).toBe(null);
    const range = c.getPriceRange()!;
    expect(range.from).toBeCloseTo(low, 6);
    expect(range.to).toBeCloseTo(high, 6);
    const view = c.getVisibleIndexRange()!;
    expect(view.from).toBeCloseTo(from, 3);
    expect(view.to).toBeCloseTo(to, 3);
  });

  it('ignores a click or a flat drag, and Escape drops the box', () => {
    const c = chart();
    const view = c.getVisibleIndexRange();
    c.drawings.setTool('zoom-box');
    drag(c, [{ x: 100, y: 100 }]);
    drag(c, [{ x: 100, y: 100 }, { x: 300, y: 102 }]);
    expect(c.drawings.tool).toBe('zoom-box');
    dispatch(c.root, 'pointerdown', client(c, { x: 100, y: 100 }));
    dispatch(c.root, 'pointermove', { ...client(c, { x: 300, y: 200 }), timeStamp: 1 });
    dispatch(c.root, 'keydown', { key: 'Escape' });
    dispatch(c.root, 'pointerup', { ...client(c, { x: 300, y: 200 }), timeStamp: 2 });
    expect(c.getVisibleIndexRange()).toEqual(view);
    expect(c.getPriceScaleOptions(0, 'right')!.autoScale).toBe(true);
  });
});
