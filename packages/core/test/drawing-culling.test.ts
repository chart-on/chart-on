import { describe, expect, it, vi } from 'vitest';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import { horizontalLine, ray, trendLine, verticalLine } from '../src/drawing/tools';
import type { Drawing, DrawingToolDef } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { withBuiltinTools } from './builtin-tools';

const BARS = 10_000;

/**
 * 10,000 bars at 10 px with the newest on the right edge of a 1000 px plot:
 * bars 9900..9999 are in view. time = index * 60, price = 500 - y.
 */
function setup() {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: BARS }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = BARS;
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

/** A copy of `tool` under a new type whose `render` and `hitTest` are spies. */
function spied(tool: DrawingToolDef) {
  const render = vi.fn();
  const hitTest = vi.fn<DrawingToolDef['hitTest']>(() => false);
  const def: DrawingToolDef = { ...tool, type: `${tool.type}-spy`, render, hitTest };
  return { def, render, hitTest };
}

/** A canvas context whose every method is a no-op. */
const ctx = new Proxy({}, { get: () => () => {}, set: () => true }) as unknown as CanvasRenderingContext2D;

const at = (index: number, price: number) => ({ time: index * 60, price });
const x = (index: number) => (index - 9999) * 10 + 1000;

describe('drawing culling', () => {
  it('draws and hit-tests only the drawings in view', () => {
    const m = setup();
    const spy = spied(trendLine);
    m.register(spy.def);
    // 490 drawings far back in history, 10 in view.
    for (let i = 0; i < 490; i++) m.add({ type: spy.def.type, pane: 0, points: [at(i * 10, 100), at(i * 10 + 5, 200)], style: {} });
    for (let i = 0; i < 10; i++) {
      m.add({ type: spy.def.type, pane: 0, points: [at(9900 + i * 10, 100), at(9905 + i * 10, 200)], style: {} });
    }
    m.render(ctx, 0, 1000, 500);
    expect(spy.render).toHaveBeenCalledTimes(10);

    m.pointerMove({ x: x(9950), y: 300 });
    expect(spy.hitTest.mock.calls.length).toBeGreaterThan(0);
    expect(spy.hitTest.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it('keeps drawings just outside the view, within the margin for labels', () => {
    const m = setup();
    const spy = spied(trendLine);
    m.register(spy.def);
    // Ends 5 bars (50 px) left of the view: its label may still show.
    m.add({ type: spy.def.type, pane: 0, points: [at(9880, 100), at(9895, 200)], style: {} });
    // Ends 50 bars (500 px) left: well out.
    m.add({ type: spy.def.type, pane: 0, points: [at(9800, 100), at(9850, 200)], style: {} });
    // Prices far above the pane (it shows 0..500).
    m.add({ type: spy.def.type, pane: 0, points: [at(9950, 5000), at(9960, 6000)], style: {} });
    m.render(ctx, 0, 1000, 500);
    expect(spy.render).toHaveBeenCalledTimes(1);
  });

  it('draws and hits extended lines, rays and horizontal lines anchored out of view', () => {
    const m = setup();
    const extended = spied(trendLine);
    const rays = spied(ray);
    const hline = spied(horizontalLine);
    const vline = spied(verticalLine);
    for (const s of [extended, rays, hline, vline]) m.register(s.def);
    m.add({ type: extended.def.type, pane: 0, points: [at(100, 300), at(200, 300)], style: { extendRight: true } });
    m.add({ type: rays.def.type, pane: 0, points: [at(100, 300), at(200, 300)], style: {} });
    m.add({ type: hline.def.type, pane: 0, points: [at(100, 300)], style: {} });
    // A vertical line far back in history is out of view.
    m.add({ type: vline.def.type, pane: 0, points: [at(100, 300)], style: {} });
    m.render(ctx, 0, 1000, 500);
    expect(extended.render).toHaveBeenCalledOnce();
    expect(rays.render).toHaveBeenCalledOnce();
    expect(hline.render).toHaveBeenCalledOnce();
    expect(vline.render).not.toHaveBeenCalled();

    m.pointerMove({ x: x(9950), y: 200 });
    expect(extended.hitTest).toHaveBeenCalled();
    expect(rays.hitTest).toHaveBeenCalled();
    expect(hline.hitTest).toHaveBeenCalled();
    expect(vline.hitTest).not.toHaveBeenCalled();
  });

  it('skips a ray pointing away from the view', () => {
    const m = setup();
    const rays = spied(ray);
    m.register(rays.def);
    m.add({ type: rays.def.type, pane: 0, points: [at(200, 300), at(100, 300)], style: {} });
    m.render(ctx, 0, 1000, 500);
    expect(rays.render).not.toHaveBeenCalled();
  });

  it('always draws the selected drawing', () => {
    const m = setup();
    const spy = spied(trendLine);
    m.register(spy.def);
    const d = m.add({ type: spy.def.type, pane: 0, points: [at(100, 100), at(200, 200)], style: {} });
    m.select(d.id);
    m.render(ctx, 0, 1000, 500);
    expect(spy.render).toHaveBeenCalledOnce();
  });

  it('keeps the z-order list between frames and rebuilds it on changes', () => {
    const m = setup();
    m.register(spied(trendLine).def);
    const ordered = () => (m as unknown as { ordered(): Drawing[] }).ordered();
    const a = m.add({ type: 'trendline-spy', pane: 0, points: [at(9950, 100), at(9960, 200)], style: {} });
    const b = m.add({ type: 'trendline-spy', pane: 0, points: [at(9950, 100), at(9960, 200)], style: {} });
    const first = ordered();
    m.render(ctx, 0, 1000, 500);
    m.pointerMove({ x: 500, y: 250 });
    expect(ordered()).toBe(first);

    m.update(a.id, { zIndex: 1 });
    expect(ordered().map((d) => d.id)).toEqual([b.id, a.id]);
    const second = ordered();
    m.update(a.id, { points: [at(9951, 100), at(9960, 200)] });
    expect(ordered()).toBe(second);
    m.remove(b.id);
    expect(ordered().map((d) => d.id)).toEqual([a.id]);
    m.add({ type: 'trendline-spy', pane: 0, points: [at(9950, 100), at(9960, 200)], style: {} });
    expect(ordered()).toHaveLength(2);
  });
});
