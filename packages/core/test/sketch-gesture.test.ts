import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import type { Point } from '../src/types';
import { resetOptionWarnings } from '../src/util/options-check';

const charts: Chart[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.useRealTimers();
});

function chart(options: ChartOptionsPatch = { features: { sketch: true } }) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 200 }, (_, i) => ({ time: i * 60, open: 150, high: 200, low: 100, close: 150 })));
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
  return c;
}

/** Client points for plot-space `points`. */
const client = (c: Chart, p: Point) => ({ clientX: p.x + c.plotLeft, clientY: p.y });

/** Press at the first point, wait `hold` ms, drag through the rest and release. */
function sketch(c: Chart, points: Point[], hold = 600, init: Record<string, unknown> = {}) {
  dispatch(c.root, 'pointerdown', { ...init, ...client(c, points[0]!) });
  vi.advanceTimersByTime(hold);
  points.slice(1).forEach((p, i) => dispatch(c.root, 'pointermove', { ...init, ...client(c, p), timeStamp: hold + i }));
  dispatch(c.root, 'pointerup', { ...init, ...client(c, points.at(-1)!), timeStamp: hold + points.length });
}

/** `n + 1` points along a straight line from `a` to `b`. */
const line = (a: Point, b: Point, n = 20): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));

describe('sketch gesture', () => {
  it('places the drawing a held stroke reads as, selected and undoable', () => {
    const c = chart();
    const created = vi.fn();
    c.on('drawing:create', created);
    sketch(c, line({ x: 100, y: 120 }, { x: 300, y: 122 }));
    const all = c.drawings.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.type).toBe('hline');
    expect(all[0]!.pane).toBe(0);
    expect(c.drawings.selection).toEqual([all[0]!.id]);
    expect(created).toHaveBeenCalledTimes(1);
    expect(c.drawings.undo()).toBe(true);
    expect(c.drawings.getAll()).toHaveLength(0);
  });

  it('stores anchors at bars and prices, like a placed drawing', () => {
    const c = chart();
    const offset = c.time.rightOffset;
    sketch(c, line({ x: 100, y: 100 }, { x: 300, y: 200 }));
    const d = c.drawings.getAll()[0]!;
    expect(d.type).toBe('trendline');
    expect(d.points.map((q) => q.time % 60)).toEqual([0, 0]);
    expect(d.points[0]!.price).toBeGreaterThan(d.points[1]!.price);
    // The hold kept the chart still and the stroke did not pan it.
    expect(c.time.rightOffset).toBe(offset);
  });

  it('places nothing for a stroke that fits no tool', () => {
    const c = chart();
    sketch(c, [{ x: 100, y: 100 }, { x: 160, y: 140 }, { x: 110, y: 180 }, { x: 170, y: 220 }, { x: 105, y: 110 }, { x: 180, y: 300 }]);
    expect(c.drawings.getAll()).toHaveLength(0);
    expect(c.drawings.isBusy).toBe(false);
  });

  it('skips tools the access rule refuses', () => {
    const c = chart();
    c.drawings.setAccess(({ id }) => id !== 'hline');
    sketch(c, line({ x: 100, y: 120 }, { x: 300, y: 120 }));
    expect(c.drawings.getAll().map((d) => d.type)).toEqual(['trendline']);
  });

  it('pans as before when the press moves before the hold ends', () => {
    const c = chart();
    const offset = c.time.rightOffset;
    dispatch(c.root, 'pointerdown', client(c, { x: 300, y: 150 }));
    dispatch(c.root, 'pointermove', { ...client(c, { x: 200, y: 150 }), timeStamp: 10 });
    vi.advanceTimersByTime(600);
    dispatch(c.root, 'pointermove', { ...client(c, { x: 100, y: 150 }), timeStamp: 620 });
    dispatch(c.root, 'pointerup', { ...client(c, { x: 100, y: 150 }), timeStamp: 630 });
    expect(c.time.rightOffset).not.toBe(offset);
    expect(c.drawings.getAll()).toHaveLength(0);
  });

  it('does nothing while the feature is off, the default', () => {
    const c = chart({});
    expect(c.features.sketch).toBe(false);
    const offset = c.time.rightOffset;
    sketch(c, line({ x: 300, y: 120 }, { x: 100, y: 120 }));
    expect(c.drawings.getAll()).toHaveLength(0);
    expect(c.time.rightOffset).not.toBe(offset);
  });

  it('erases the drawings a scribble crosses, as one undo step', () => {
    const c = chart();
    sketch(c, line({ x: 100, y: 120 }, { x: 300, y: 120 }));
    sketch(c, line({ x: 100, y: 60 }, { x: 300, y: 300 }));
    sketch(c, line({ x: 100, y: 250 }, { x: 300, y: 250 }));
    expect(c.drawings.getAll().map((d) => d.type)).toEqual(['hline', 'trendline', 'hline']);
    const removed = vi.fn();
    c.on('drawing:remove', removed);
    // Back and forth over the first hline and the trend line, away from the second hline.
    const scribble = [100, 110, 120, 130, 140, 150].map((y, i) => ({ x: i % 2 ? 260 : 120, y }));
    sketch(c, scribble.flatMap((p, i) => (i ? line(scribble[i - 1]!, p, 4).slice(1) : [p])));
    expect(c.drawings.getAll().map((d) => d.type)).toEqual(['hline']);
    expect(removed).toHaveBeenCalledTimes(2);
    expect(c.drawings.undo()).toBe(true);
    expect(c.drawings.getAll()).toHaveLength(3);
  });

  it('keeps locked drawings, and a scribble over nothing places nothing', () => {
    const c = chart();
    sketch(c, line({ x: 100, y: 120 }, { x: 300, y: 120 }));
    const id = c.drawings.getAll()[0]!.id;
    const scribble = [100, 110, 120, 130, 140, 150].map((y, i) => ({ x: i % 2 ? 260 : 120, y }));
    const stroke = scribble.flatMap((p, i) => (i ? line(scribble[i - 1]!, p, 4).slice(1) : [p]));
    c.drawings.update(id, { locked: true });
    sketch(c, stroke);
    expect(c.drawings.getAll().map((d) => d.id)).toEqual([id]);

    c.drawings.update(id, { locked: false });
    c.drawings.setLocked(true);
    sketch(c, stroke);
    expect(c.drawings.getAll().map((d) => d.id)).toEqual([id]);

    c.drawings.setLocked(false);
    sketch(c, stroke.map((p) => ({ x: p.x, y: p.y + 120 })));
    expect(c.drawings.getAll().map((d) => d.id)).toEqual([id]);
  });

  it('keeps a short touch long-press for inspecting, and Escape cancels a stroke', () => {
    const c = chart();
    sketch(c, line({ x: 300, y: 120 }, { x: 100, y: 120 }), 600, { pointerType: 'touch' });
    expect(c.drawings.getAll()).toHaveLength(0);

    dispatch(c.root, 'pointerdown', client(c, { x: 100, y: 120 }));
    vi.advanceTimersByTime(600);
    dispatch(c.root, 'pointermove', { ...client(c, { x: 300, y: 120 }), timeStamp: 600 });
    expect(c.drawings.isBusy).toBe(true);
    dispatch(c.root, 'keydown', { key: 'Escape' });
    expect(c.drawings.isBusy).toBe(false);
    dispatch(c.root, 'pointerup', { ...client(c, { x: 300, y: 120 }), timeStamp: 610 });
    expect(c.drawings.getAll()).toHaveLength(0);
  });
});

describe('sketch hold time', () => {
  /** Press still on the plot and report whether a sketch started after `ms`, then release. */
  function startsAfter(c: Chart, ms: number, init: Record<string, unknown> = {}) {
    dispatch(c.root, 'pointerdown', { ...init, ...client(c, { x: 100, y: 120 }) });
    vi.advanceTimersByTime(ms);
    const busy = c.drawings.isBusy;
    dispatch(c.root, 'keydown', { key: 'Escape' });
    dispatch(c.root, 'pointerup', { ...init, ...client(c, { x: 100, y: 120 }), timeStamp: ms });
    vi.advanceTimersByTime(2000);
    return busy;
  }

  it('defaults to 500 ms and follows sketch.holdMs from the next press', () => {
    const c = chart();
    expect(c.options.sketch).toEqual({ holdMs: 500 });
    expect(startsAfter(c, 490)).toBe(false);
    expect(startsAfter(c, 510)).toBe(true);
    c.applyOptions({ sketch: { holdMs: 1000 } });
    expect(c.options.sketch).toEqual({ holdMs: 1000 });
    expect(startsAfter(c, 900)).toBe(false);
    expect(startsAfter(c, 1010)).toBe(true);
  });

  it('takes a custom hold at creation, also as the extra hold on touch', () => {
    const c = chart({ features: { sketch: true }, sketch: { holdMs: 200 } });
    expect(startsAfter(c, 150)).toBe(false);
    expect(startsAfter(c, 210)).toBe(true);
    // Touch: the long-press (about 450 ms) and then the hold.
    expect(startsAfter(c, 600, { pointerType: 'touch' })).toBe(false);
    expect(startsAfter(c, 700, { pointerType: 'touch' })).toBe(true);
  });

  it('warns in development about a negative or non-numeric hold, like other numeric options', () => {
    resetOptionWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = chart();
    c.applyOptions({ sketch: { holdMs: -1 } });
    c.applyOptions({ sketch: { holdMs: '300' as unknown as number } });
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringMatching(/"sketch\.holdMs" should be .*got -1/),
      expect.stringMatching(/"sketch\.holdMs" should be .*got string/),
    ]);
    warn.mockRestore();
  });
});

describe('sketch on touch', () => {
  const touch = { pointerType: 'touch' };

  it('turns a long-press held still a little longer into a sketch', () => {
    const c = chart();
    const offset = c.time.rightOffset;
    dispatch(c.root, 'pointerdown', { ...touch, ...client(c, { x: 100, y: 120 }) });
    vi.advanceTimersByTime(500);
    // The crosshair comes first, as before.
    expect(c.inspecting).toBe(true);
    expect(c.drawings.isBusy).toBe(false);
    vi.advanceTimersByTime(500);
    expect(c.inspecting).toBe(false);
    expect(c.drawings.isBusy).toBe(true);
    line({ x: 100, y: 120 }, { x: 300, y: 122 }).forEach((p, i) => dispatch(c.root, 'pointermove', { ...touch, ...client(c, p), timeStamp: 1000 + i }));
    dispatch(c.root, 'pointerup', { ...touch, ...client(c, { x: 300, y: 122 }), timeStamp: 1100 });
    expect(c.drawings.getAll().map((d) => d.type)).toEqual(['hline']);
    expect(c.time.rightOffset).toBe(offset);
    expect(c.crosshair).toBeNull();
    expect(c.drawings.undo()).toBe(true);
  });

  it('keeps inspecting when the finger moves before the sketch hold ends', () => {
    const c = chart();
    dispatch(c.root, 'pointerdown', { ...touch, ...client(c, { x: 100, y: 120 }) });
    vi.advanceTimersByTime(500);
    dispatch(c.root, 'pointermove', { ...touch, ...client(c, { x: 140, y: 120 }), timeStamp: 500 });
    vi.advanceTimersByTime(1000);
    expect(c.inspecting).toBe(true);
    dispatch(c.root, 'pointermove', { ...touch, ...client(c, { x: 300, y: 120 }), timeStamp: 1500 });
    expect(c.crosshair?.x).toBe(300);
    dispatch(c.root, 'pointerup', { ...touch, ...client(c, { x: 300, y: 120 }), timeStamp: 1510 });
    expect(c.drawings.getAll()).toHaveLength(0);
  });

  it('sketches after a long-press that opens no menu with touchInspect off', () => {
    const c = chart({ features: { sketch: true }, touchInspect: 'off' });
    sketch(c, line({ x: 100, y: 100 }, { x: 300, y: 200 }), 1000, touch);
    expect(c.drawings.getAll().map((d) => d.type)).toEqual(['trendline']);
  });

  it('only inspects while the feature is off', () => {
    const c = chart({});
    dispatch(c.root, 'pointerdown', { ...touch, ...client(c, { x: 100, y: 120 }) });
    vi.advanceTimersByTime(2000);
    expect(c.inspecting).toBe(true);
    dispatch(c.root, 'pointermove', { ...touch, ...client(c, { x: 300, y: 120 }), timeStamp: 2000 });
    dispatch(c.root, 'pointerup', { ...touch, ...client(c, { x: 300, y: 120 }), timeStamp: 2010 });
    expect(c.drawings.getAll()).toHaveLength(0);
  });
});

/** Texts the drawing layer writes on pane 0's overlay. */
function overlayTexts(c: Chart): string[] {
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : k === 'fillText' ? (text: string) => texts.push(text) : k === 'measureText' ? (text: string) => ({ width: text.length * 6 }) : () => {}),
    set: (t, k, v) => ((t[k] = v), true),
  });
  c.drawingLayer!.render(ctx as unknown as CanvasRenderingContext2D, 0, 600, 400);
  return texts;
}

describe('sketch hint', () => {
  it('names the tool, and Tab swaps it for the next fit in the same undo step', () => {
    const c = chart();
    sketch(c, line({ x: 100, y: 120 }, { x: 300, y: 122 }));
    const [d] = c.drawings.getAll();
    expect(d!.type).toBe('hline');
    expect(overlayTexts(c)).toContain('Horizontal line · 1/2 · Tab');
    const tab = dispatch(c.root, 'keydown', { key: 'Tab' });
    expect(tab.defaultPrevented).toBe(true);
    expect(c.drawings.getAll().map((x) => [x.id, x.type])).toEqual([[d!.id, 'trendline']]);
    expect(c.drawings.selection).toEqual([d!.id]);
    expect(overlayTexts(c)).toContain('Trend line · 2/2 · Tab');
    dispatch(c.root, 'keydown', { key: 'Tab', shiftKey: true });
    expect(c.drawings.getAll()[0]!.type).toBe('hline');
    expect(c.drawings.undo()).toBe(true);
    expect(c.drawings.getAll()).toHaveLength(0);
    expect(c.drawings.canUndo).toBe(false);
  });

  it('Escape takes the sketched drawing back', () => {
    const c = chart();
    sketch(c, line({ x: 100, y: 120 }, { x: 300, y: 122 }));
    dispatch(c.root, 'keydown', { key: 'Escape' });
    expect(c.drawings.getAll()).toHaveLength(0);
    expect(overlayTexts(c)).toEqual([]);
  });

  it('ends on the next press or edit, and Tab is the page\'s again', () => {
    const c = chart();
    sketch(c, line({ x: 100, y: 120 }, { x: 300, y: 122 }));
    dispatch(c.root, 'pointerdown', client(c, { x: 400, y: 300 }));
    dispatch(c.root, 'pointerup', { ...client(c, { x: 400, y: 300 }), timeStamp: 5 });
    expect(overlayTexts(c).filter((t) => t.includes('Horizontal line'))).toEqual([]);
    expect(dispatch(c.root, 'keydown', { key: 'Tab' }).defaultPrevented).toBe(false);
    expect(c.drawings.getAll()[0]!.type).toBe('hline');

    sketch(c, line({ x: 100, y: 250 }, { x: 300, y: 252 }));
    const id = c.drawings.getAll()[1]!.id;
    c.drawings.update(id, { style: { color: '#123456' } });
    dispatch(c.root, 'keydown', { key: 'Escape' });
    expect(c.drawings.getAll()).toHaveLength(2);
  });
});
