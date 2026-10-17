import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { BaselineHandles, draggedLevel } from '../src/baseline-handle';
import { PriceScale, TimeScale, type PriceScaleMode } from '../src/scales';
import { Pane } from '../src/pane';
import { darkTheme } from '../src/theme';
import {
  CandleSeries,
  DEFAULT_BASE_LEVEL,
  drawBaseline,
  resolveBaseLevel,
  type BaseLevel,
  type PaneEnv,
} from '../src/series';
import type { Bar } from '../src/types';

const H = 400;

/** A scale fitted to [lo, hi] in a pane H px tall. */
function scale(mode: PriceScaleMode, lo = 50, hi = 200, invert = false): PriceScale {
  const s = new PriceScale({ marginTop: 0, marginBottom: 0 });
  s.height = H;
  s.invert = invert;
  s.setMode(mode);
  s.percentBase = 100;
  s.fit(lo, hi);
  return s;
}

const MODES: PriceScaleMode[] = ['normal', 'log', 'percent'];

describe('resolveBaseLevel', () => {
  it.each(MODES)('puts the default level at the middle of the pane (%s scale)', (mode) => {
    const s = scale(mode);
    expect(resolveBaseLevel(DEFAULT_BASE_LEVEL, s, H, undefined)).toBeCloseTo(s.yToPrice(H / 2), 9);
  });

  it.each(MODES)('maps a height level from the bottom of the pane (%s scale)', (mode) => {
    const s = scale(mode);
    const price = resolveBaseLevel({ kind: 'height', percent: 25 }, s, H, undefined);
    expect(s.priceToY(price)).toBeCloseTo(H * 0.75, 6);
    expect(resolveBaseLevel({ kind: 'height', percent: 100 }, s, H, undefined)).toBeCloseTo(s.maxPrice, 6);
  });

  it.each(MODES)('keeps a fixed price as is (%s scale)', (mode) => {
    expect(resolveBaseLevel({ kind: 'price', price: 123.45 }, scale(mode), H, undefined)).toBe(123.45);
  });

  it('uses the first visible close, else the middle of the pane', () => {
    const s = scale('normal');
    expect(resolveBaseLevel({ kind: 'firstVisible' }, s, H, 87)).toBe(87);
    expect(resolveBaseLevel({ kind: 'firstVisible' }, s, H, undefined)).toBeCloseTo(s.yToPrice(H / 2), 9);
  });

  it('falls back to the middle for invalid levels instead of throwing', () => {
    const s = scale('normal');
    const middle = s.yToPrice(H / 2);
    expect(resolveBaseLevel({ kind: 'price', price: NaN }, s, H, undefined)).toBeCloseTo(middle, 9);
    expect(resolveBaseLevel({ kind: 'height', percent: Infinity }, s, H, undefined)).toBeCloseTo(middle, 9);
    expect(resolveBaseLevel({ kind: 'bogus' } as unknown as BaseLevel, s, H, undefined)).toBeCloseTo(middle, 9);
  });
});

/** Canvas stub that records the clip rects and line points drawBaseline emits. */
function recorder() {
  const rects: [number, number, number, number][] = [];
  const lineTo: [number, number][] = [];
  const strokes: string[] = [];
  let strokeStyle = '';
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    clip() {},
    fill() {},
    stroke() {
      strokes.push(strokeStyle);
    },
    setLineDash() {},
    moveTo() {},
    rect(x: number, y: number, w: number, h: number) {
      rects.push([x, y, w, h]);
    },
    lineTo(x: number, y: number) {
      lineTo.push([x, y]);
    },
    createLinearGradient: () => ({ addColorStop() {} }),
    set strokeStyle(v: string) {
      strokeStyle = v;
    },
    get strokeStyle() {
      return strokeStyle;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rects, lineTo, strokes };
}

function env(s: PriceScale): PaneEnv {
  const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  const time = new TimeScale({ barSpacing: 100, minBarSpacing: 1, maxBarSpacing: 200, rightOffset: 0 });
  time.width = 500;
  time.barCount = 4;
  return { time, pane, width: 500, height: H, from: 0, to: 10, dpr: 1, theme: darkTheme };
}

describe('baseline fills', () => {
  const values = [60, 180, 90, 150];
  for (const mode of MODES) {
    for (const invert of [false, true]) {
      it(`split exactly at the base price (${mode} scale${invert ? ', inverted' : ''})`, () => {
        const s = scale(mode, 50, 200, invert);
        const base = 120;
        const { ctx, rects } = recorder();
        drawBaseline(ctx, env(s), s, 0, values.length, (k) => k, (k) => values[k]!, base, '#00ff00', '#ff0000', 2);
        // Two clip bands: top [0, baseY) and bottom [baseY, H).
        expect(rects).toHaveLength(2);
        const [top, bottom] = rects as [[number, number, number, number], [number, number, number, number]];
        const baseY = s.priceToY(base);
        expect(top[1] + top[3]).toBeCloseTo(baseY, 9);
        expect(bottom[1]).toBeCloseTo(baseY, 9);
        expect(s.yToPrice(bottom[1])).toBeCloseTo(base, 9);
      });
    }
  }

  it('colours the band above the base price with the above colour', () => {
    const s = scale('log');
    const { ctx, strokes } = recorder();
    drawBaseline(ctx, env(s), s, 0, values.length, (k) => k, (k) => values[k]!, 120, '#00ff00', '#ff0000', 2);
    // Upper band first, then the lower band, then the dashed base line.
    expect(strokes.slice(0, 2)).toEqual(['#00ff00', '#ff0000']);
  });
});

const BARS: Bar[] = Array.from({ length: 50 }, (_, i) => ({
  time: i * 60,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100 + i,
}));

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart(baseLevel?: BaseLevel) {
  const c = new Chart(fakeContainer());
  charts.push(c);
  const s = c.addCandles({ style: 'baseline', ...(baseLevel ? { baseLevel } : {}) });
  s.setData(BARS);
  frame(c);
  return { c, s };
}

/** Run one frame's scene work; frames never run on their own under the fake DOM. */
function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

describe('baseline series base level', () => {
  it('defaults to the middle of the pane, as before', () => {
    const { c, s } = chart();
    const pane = c.panes[0]!;
    expect(s.basePrice).toBeCloseTo(s.scale.yToPrice(pane.height / 2), 9);
  });

  it('uses a fixed price', () => {
    const { s } = chart({ kind: 'price', price: 110 });
    expect(s.basePrice).toBe(110);
  });

  it('uses the first visible close, the percent scale base', () => {
    const { c, s } = chart({ kind: 'firstVisible' });
    const from = c.time.visibleRange().from;
    expect(s.basePrice).toBe(s.closeFrom(from));
    c.setPriceScaleMode('percent');
    frame(c);
    expect(s.basePrice).toBe(s.scale.percentBase);
    expect(s.scale.toPercent(s.basePrice!)).toBe(0);
  });

  it('follows a height level', () => {
    const { c, s } = chart({ kind: 'height', percent: 20 });
    expect(s.scale.priceToY(s.basePrice!)).toBeCloseTo(c.panes[0]!.height * 0.8, 6);
  });

  it('clears the base price when the style changes', () => {
    const { c, s } = chart();
    s.applyOptions({ style: 'line' });
    frame(c);
    expect(s.basePrice).toBeNull();
  });

  it('labels the base level on the axis only while shown', () => {
    const { s } = chart({ kind: 'price', price: 110 });
    expect(s.lastValues().map((v) => v.value)).toEqual([149]);
    s.showBaseLevel = true;
    expect(s.lastValues().map((v) => v.value)).toEqual([149, 110]);
  });
});

describe('base level handle', () => {
  function setup(baseLevel?: BaseLevel) {
    const { c, s } = chart(baseLevel);
    const handles = new BaselineHandles(c);
    const pane = c.panes[0]!;
    const axisX = c.plotWidth + 10;
    const baseY = () => pane.top + s.scale.priceToY(s.basePrice!);
    return { c, s, handles, pane, axisX, baseY };
  }

  it('is found on the price axis at the base level only', () => {
    const { c, s, handles, axisX, baseY } = setup();
    expect(handles.at(c.regionAt(axisX, baseY()), baseY())).toBe(s);
    expect(handles.at(c.regionAt(axisX, baseY() + 20), baseY() + 20)).toBeNull();
    // Not in the plot.
    expect(handles.at(c.regionAt(10, baseY()), baseY())).toBeNull();
    handles.destroy();
  });

  it('shows the base label while hovering the handle or the series', () => {
    const { c, s, handles, axisX, baseY } = setup();
    expect(handles.pointerMove(c.regionAt(axisX, baseY()), baseY())).toBe(true);
    expect(s.showBaseLevel).toBe(true);
    handles.pointerMove(null, 0);
    expect(s.showBaseLevel).toBe(false);
    c.emit('series:hover', { series: s, point: null });
    expect(s.showBaseLevel).toBe(true);
    c.emit('series:hover', { series: null, point: null });
    expect(s.showBaseLevel).toBe(false);
    handles.destroy();
  });

  it('drags a height level and emits baseline:change', () => {
    const { c, s, handles, pane, axisX, baseY } = setup();
    const listener = vi.fn();
    c.on('baseline:change', listener);
    expect(handles.pointerDown(c.regionAt(axisX, baseY()), baseY())).toBe(true);
    const y = pane.top + pane.height * 0.25;
    handles.drag(y);
    expect(s.options.baseLevel).toEqual({ kind: 'height', percent: 75 });
    expect(listener).toHaveBeenCalledWith({ series: s, baseLevel: { kind: 'height', percent: 75 }, price: s.scale.yToPrice(pane.height * 0.25) });
    handles.pointerUp();
    frame(c);
    expect(s.scale.priceToY(s.basePrice!)).toBeCloseTo(pane.height * 0.25, 6);
    expect(s.showBaseLevel).toBe(false);
    handles.destroy();
  });

  it('keeps the label when the mouse is released over the handle', () => {
    const { c, s, handles, pane, axisX, baseY } = setup();
    handles.pointerDown(c.regionAt(axisX, baseY()), baseY());
    const y = pane.top + pane.height * 0.25;
    handles.drag(y);
    expect(handles.pointerUp(c.regionAt(axisX, y), y)).toBe(true);
    expect(s.showBaseLevel).toBe(true);
    handles.pointerMove(c.regionAt(axisX, y + 40), y + 40);
    expect(s.showBaseLevel).toBe(false);
    handles.destroy();
  });

  it('drags a fixed price, rounded to the tick size', () => {
    const { c, s, handles, pane, axisX, baseY } = setup({ kind: 'price', price: 120 });
    s.applyOptions({ priceFormat: { type: 'decimal', tickSize: 0.5 } });
    const listener = vi.fn();
    c.on('baseline:change', listener);
    handles.pointerDown(c.regionAt(axisX, baseY()), baseY());
    handles.drag(pane.top + s.scale.priceToY(130.2));
    expect(s.options.baseLevel).toEqual({ kind: 'price', price: 130 });
    expect(listener.mock.calls[0]![0].price).toBe(130);
    handles.destroy();
  });

  it('pins a first-visible level to the dragged price', () => {
    const { s, pane } = setup({ kind: 'firstVisible' });
    const { baseLevel } = draggedLevel(s, pane, s.scale.priceToY(125));
    expect(baseLevel.kind).toBe('price');
    expect((baseLevel as { price: number }).price).toBeCloseTo(125, 6);
  });

  it('keeps the dragged base inside the pane', () => {
    const { c, s, handles, pane, axisX, baseY } = setup();
    handles.pointerDown(c.regionAt(axisX, baseY()), baseY());
    handles.drag(pane.top - 500);
    expect(s.options.baseLevel).toEqual({ kind: 'height', percent: 100 });
    handles.destroy();
  });
});

describe('base level review fixes', () => {
  /** The `sub` (countdown) of each price-axis pill drawn for pane 0. */
  function pillSubs(c: Chart): (string | undefined)[] {
    const internals = c as unknown as {
      axisPill: (...args: unknown[]) => void;
      drawLastValueLabels(ctx: unknown, pane: Pane, index: number): void;
    };
    const spy = vi.spyOn(internals, 'axisPill').mockImplementation(() => {});
    internals.drawLastValueLabels({}, c.panes[0]!, 0);
    const subs = spy.mock.calls.map((args) => args[5] as string | undefined);
    spy.mockRestore();
    return subs;
  }

  afterEach(() => vi.useRealTimers());

  it('never puts the bar countdown on the base label', () => {
    vi.useFakeTimers();
    // The newest bar (t = 2940, 60 s bars) is still forming.
    vi.setSystemTime(2950_000);
    const { c, s } = chart({ kind: 'price', price: 120 });
    s.showBaseLevel = true;
    expect(pillSubs(c).filter(Boolean)).toHaveLength(1);
    s.applyOptions({ lastValueLabel: false });
    frame(c);
    // Only the base label is left, and it has no countdown.
    expect(s.lastValues().map((v) => v.value)).toEqual([120]);
    expect(pillSubs(c)).toEqual([undefined]);
  });

  it('keeps a fixed base price inside the autoscaled range', () => {
    const { s } = chart({ kind: 'price', price: 20 });
    expect(s.priceRange(0, 49)).toEqual([20, 149]);
    s.applyOptions({ baseLevel: { kind: 'price', price: 500 } });
    expect(s.priceRange(0, 49)).toEqual([100, 500]);
    // Other levels follow the view, so they do not widen it.
    s.applyOptions({ baseLevel: { kind: 'height', percent: 10 } });
    expect(s.priceRange(0, 49)).toEqual([100, 149]);
    s.applyOptions({ style: 'line', baseLevel: { kind: 'price', price: 20 } });
    expect(s.priceRange(0, 49)).toEqual([100, 149]);
  });

  it('falls back to the default base for a non-positive price on a log scale', () => {
    const s = scale('log');
    const middle = s.yToPrice(H / 2);
    expect(resolveBaseLevel({ kind: 'price', price: 0 }, s, H, undefined)).toBeCloseTo(middle, 9);
    expect(resolveBaseLevel({ kind: 'price', price: -5 }, s, H, undefined)).toBeCloseTo(middle, 9);
    expect(resolveBaseLevel({ kind: 'price', price: -5 }, scale('normal'), H, undefined)).toBe(-5);

    const { c, s: series } = chart({ kind: 'price', price: -5 });
    c.setPriceScaleMode('log');
    frame(c);
    expect(series.priceRange(0, 49)).toEqual([100, 149]);
    expect(series.basePrice).toBeCloseTo(series.scale.yToPrice(c.panes[0]!.height / 2), 6);
  });

  it('moves the base on drag without rebuilding the series', () => {
    const { c, s } = chart();
    const handles = new BaselineHandles(c);
    const pane = c.panes[0]!;
    const baseY = pane.top + s.scale.priceToY(s.basePrice!);
    const rebuild = vi.spyOn(s, 'rebuild');
    handles.pointerDown(c.regionAt(c.plotWidth + 10, baseY), baseY);
    handles.drag(pane.top + pane.height * 0.25);
    expect(rebuild).not.toHaveBeenCalled();
    expect(s.options.baseLevel).toEqual({ kind: 'height', percent: 75 });
    handles.destroy();
  });
});

describe('base level handle and axisDragScale', () => {
  function pointer(c: Chart) {
    const it = (c as unknown as { interaction: Record<string, (e: unknown) => void> }).interaction;
    const root = c.root as unknown as Record<string, unknown>;
    root.setPointerCapture ??= () => {};
    root.releasePointerCapture ??= () => {};
    const ev = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, timeStamp: 0, preventDefault() {} });
    return {
      down: (x: number, y: number) => it.onDown!(ev(x, y)),
      move: (x: number, y: number) => it.onMove!(ev(x, y)),
      up: (x: number, y: number) => it.onUp!(ev(x, y)),
    };
  }

  for (const axisDragScale of [true, false]) {
    it(`${axisDragScale ? 'drags' : 'locks'} the base handle with axisDragScale ${axisDragScale ? 'on' : 'off'}`, () => {
      const { c, s } = chart();
      c.applyOptions({ features: { axisDragScale } });
      frame(c);
      const pane = c.panes[0]!;
      const x = c.plotLeft + c.plotWidth + 10;
      const baseY = pane.top + s.scale.priceToY(s.basePrice!);
      const p = pointer(c);
      p.move(x, baseY);
      expect(c.root.style.cursor === 'grab').toBe(axisDragScale);
      p.down(x, baseY);
      p.move(x, pane.top + pane.height * 0.25);
      if (axisDragScale) expect(c.root.style.cursor).toBe('grabbing');
      p.up(x, pane.top + pane.height * 0.25);
      if (axisDragScale) {
        expect(s.options.baseLevel).toEqual({ kind: 'height', percent: 75 });
        // Released over the handle: the label and the grab cursor stay without another move.
        expect(s.showBaseLevel).toBe(true);
        expect(c.root.style.cursor).toBe('grab');
      } else expect(s.options.baseLevel).toBeUndefined();
    });
  }

  it('drops the label and the grab cursor when released away from the handle', () => {
    const { c, s } = chart();
    const pane = c.panes[0]!;
    const x = c.plotLeft + c.plotWidth + 10;
    const baseY = pane.top + s.scale.priceToY(s.basePrice!);
    const p = pointer(c);
    p.move(x, baseY);
    p.down(x, baseY);
    const y = pane.top + pane.height * 0.25;
    p.move(c.plotLeft + 50, y);
    p.up(c.plotLeft + 50, y);
    expect(s.showBaseLevel).toBe(false);
    expect(c.root.style.cursor).toBe('crosshair');
  });

  it('ends a base handle drag when axisDragScale is turned off', () => {
    const { c, s } = chart();
    const pane = c.panes[0]!;
    const x = c.plotLeft + c.plotWidth + 10;
    const baseY = pane.top + s.scale.priceToY(s.basePrice!);
    const p = pointer(c);
    p.down(x, baseY);
    c.applyOptions({ features: { axisDragScale: false } });
    p.move(x, pane.top + pane.height * 0.25);
    expect(s.options.baseLevel).toBeUndefined();
    expect(s.showBaseLevel).toBe(false);
  });
});
