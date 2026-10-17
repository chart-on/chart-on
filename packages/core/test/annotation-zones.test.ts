import { describe, expect, it, vi } from 'vitest';
import { AnnotationManager, type AnnotationHost } from '../src/annotations/manager';
import { tradingManager } from './trading-manager';
import {
  barSlot,
  projectPriceZone,
  projectTextLabel,
  projectTimeBand,
  zoneRect,
  type PriceZoneOptions,
  type TextLabelOptions,
  type ZoneEnv,
} from '../src/annotations/zones';
import { Chart } from '../src/chart';
import { Pane } from '../src/pane';
import type { Primitive, PrimitiveEnv, PrimitiveRegistry } from '../src/primitives';
import { PriceScale, TimeScale } from '../src/scales';
import type { Series } from '../src/series';
import { darkTheme } from '../src/theme';
import { Timeline } from '../src/timeline';
import { fakeContainer } from './fake-dom';

/** Bars at 0, 60, …, 540. */
function timeline(count = 10, interval = 60): Timeline {
  const tl = new Timeline();
  tl.set(Array.from({ length: count }, (_, i) => i * interval));
  return tl;
}

/** 100 px wide, 500 tall, bars 10 px apart with bar `i` centred at `10 i + 5`; linear price = 500 - y. */
function env(overrides: Partial<ZoneEnv> = {}): ZoneEnv {
  return {
    width: 100,
    height: 500,
    barSpacing: 10,
    indexToX: (i) => i * 10 + 5,
    priceToY: (price) => 500 - price,
    ...overrides,
  };
}

function logScale(): PriceScale {
  const scale = new PriceScale({ marginTop: 0, marginBottom: 0 });
  scale.height = 300;
  scale.setMode('log');
  scale.fit(10, 1000);
  return scale;
}

const zone = (o: Partial<PriceZoneOptions> & Pick<PriceZoneOptions, 'from' | 'to'>): PriceZoneOptions => ({ axisLabel: false, ...o });
const label = (o: Partial<TextLabelOptions>): TextLabelOptions => ({
  time: 120,
  price: 100,
  text: 'Note',
  align: 'center',
  pointerLength: 0,
  ...o,
});

describe('barSlot', () => {
  it('maps times to the bar containing them and extrapolates past the data', () => {
    const tl = timeline();
    expect(barSlot(tl, 120)).toBe(2);
    expect(barSlot(tl, 179)).toBe(2);
    expect(barSlot(tl, 600)).toBe(10);
    expect(barSlot(tl, -60)).toBe(-1);
    expect(barSlot(tl, -30)).toBe(-1);
    expect(barSlot(new Timeline(), 0)).toBeNaN();
  });

  it('puts a time in a gap between bars on the earlier bar', () => {
    const tl = new Timeline();
    tl.set([0, 60, 600, 660]);
    expect(barSlot(tl, 300)).toBe(1);
  });
});

describe('projectTimeBand', () => {
  it('covers whole bars from the bar of `from` to the bar of `to`, full height', () => {
    const out = zoneRect();
    expect(projectTimeBand({ from: 120, to: 240 }, timeline(), env(), out)).toBe(true);
    expect(out).toEqual({ left: 20, right: 50, top: 0, bottom: 500 });
    // Reversed and mid-bar times give the same band.
    expect(projectTimeBand({ from: 250, to: 130 }, timeline(), env(), out)).toBe(true);
    expect(out).toEqual({ left: 20, right: 50, top: 0, bottom: 500 });
  });

  it('shades one bar without `to`', () => {
    const out = zoneRect();
    projectTimeBand({ from: 150 }, timeline(), env(), out);
    expect(out).toMatchObject({ left: 20, right: 30 });
  });

  it('clips a band partly outside the view and rejects one fully outside', () => {
    const out = zoneRect();
    // Bars 8..15: past the data and the right edge.
    expect(projectTimeBand({ from: 480, to: 900 }, timeline(), env(), out)).toBe(true);
    expect(out).toMatchObject({ left: 80, right: 100 });
    // Bars -2..0: before the data and the left edge.
    expect(projectTimeBand({ from: -120, to: 0 }, timeline(), env(), out)).toBe(true);
    expect(out).toMatchObject({ left: 0, right: 10 });
    expect(projectTimeBand({ from: 600, to: 900 }, timeline(), env(), out)).toBe(false);
    expect(projectTimeBand({ from: -600, to: -120 }, timeline(), env(), out)).toBe(false);
    expect(projectTimeBand({ from: 0 }, new Timeline(), env(), out)).toBe(false);
  });

  it('writes into the rect it is given, so drawing reuses one object', () => {
    const out = zoneRect();
    const before = out;
    projectTimeBand({ from: 0, to: 60 }, timeline(), env(), out);
    expect(out).toBe(before);
  });
});

describe('projectPriceZone', () => {
  it('spans the pane between two prices on a linear scale, in either order', () => {
    const out = zoneRect();
    expect(projectPriceZone(zone({ from: 100, to: 200 }), timeline(), env(), out)).toBe(true);
    expect(out).toEqual({ left: 0, right: 100, top: 300, bottom: 400 });
    projectPriceZone(zone({ from: 200, to: 100 }), timeline(), env(), out);
    expect(out).toEqual({ left: 0, right: 100, top: 300, bottom: 400 });
  });

  it('places prices through a log scale', () => {
    const scale = logScale();
    const out = zoneRect();
    expect(projectPriceZone(zone({ from: 10, to: 100 }), timeline(), env({ height: 300, priceToY: (p) => scale.priceToY(p) }), out)).toBe(true);
    // 100 is the middle of 10..1000 on a log scale; a linear mapping would put it near the bottom.
    expect(out.top).toBeCloseTo(150);
    expect(out.bottom).toBeCloseTo(300);
  });

  it('clips a zone partly outside the price range and rejects one fully outside', () => {
    const out = zoneRect();
    expect(projectPriceZone(zone({ from: 400, to: 800 }), timeline(), env(), out)).toBe(true);
    expect(out).toMatchObject({ top: 0, bottom: 100 });
    expect(projectPriceZone(zone({ from: 600, to: 700 }), timeline(), env(), out)).toBe(false);
    expect(projectPriceZone(zone({ from: -50, to: -10 }), timeline(), env(), out)).toBe(false);
    // On a log scale too: 100..10000 runs off the top.
    const scale = logScale();
    const log = env({ height: 300, priceToY: (p) => scale.priceToY(p) });
    expect(projectPriceZone(zone({ from: 100, to: 10000 }), timeline(), log, out)).toBe(true);
    expect(out.top).toBe(0);
    expect(out.bottom).toBeCloseTo(150);
  });

  it('starts and ends at bar edges with fromTime and toTime', () => {
    const out = zoneRect();
    projectPriceZone(zone({ from: 100, to: 200, fromTime: 120 }), timeline(), env(), out);
    expect(out).toMatchObject({ left: 20, right: 100 });
    projectPriceZone(zone({ from: 100, to: 200, toTime: 240 }), timeline(), env(), out);
    expect(out).toMatchObject({ left: 0, right: 50 });
    projectPriceZone(zone({ from: 100, to: 200, fromTime: 60, toTime: 120 }), timeline(), env(), out);
    expect(out).toMatchObject({ left: 10, right: 30 });
    // Starting after the view, or ending before its start, shows nothing.
    expect(projectPriceZone(zone({ from: 100, to: 200, fromTime: 900 }), timeline(), env(), out)).toBe(false);
    expect(projectPriceZone(zone({ from: 100, to: 200, fromTime: 240, toTime: 120 }), timeline(), env(), out)).toBe(false);
  });
});

describe('projectTextLabel', () => {
  const box = (o: Partial<TextLabelOptions>, e: ZoneEnv = env()) => {
    const out = zoneRect();
    const anchor = { x: 0, y: 0 };
    const visible = projectTextLabel(label(o), 40, 12, timeline(), e, out, anchor);
    return { visible, out, anchor };
  };

  it('anchors at the centre of the bar and the price, the box centred on it by default', () => {
    // Box is 40 + 2 × 6 wide and 12 + 2 × 3 tall.
    const { visible, out, anchor } = box({ time: 130 });
    expect(visible).toBe(true);
    expect(anchor).toEqual({ x: 25, y: 400 });
    expect(out).toEqual({ left: -1, right: 51, top: 391, bottom: 409 });
  });

  it('aligns the box and puts it above or below the anchor with a pointer', () => {
    expect(box({ align: 'left' }).out).toMatchObject({ left: 25, right: 77 });
    expect(box({ align: 'right' }).out).toMatchObject({ left: -27, right: 25 });
    expect(box({ pointerLength: 20 }).out).toMatchObject({ top: 362, bottom: 380 });
    expect(box({ pointerLength: -20 }).out).toMatchObject({ top: 420, bottom: 438 });
  });

  it('places the anchor through a log scale', () => {
    const scale = logScale();
    const { anchor } = box({ price: 100 }, env({ height: 300, priceToY: (p) => scale.priceToY(p) }));
    expect(anchor.y).toBeCloseTo(150);
  });

  it('is hidden only when the box and its pointer are both off screen', () => {
    expect(box({ time: 900 }).visible).toBe(false);
    expect(box({ price: 600 }).visible).toBe(false);
    // The anchor is below the pane, but the box sits inside it.
    expect(box({ price: -10, pointerLength: 30 }).visible).toBe(true);
  });
});

/** A 2D context that records fills and text. */
function recorder() {
  const fills: { style: unknown; rect: number[] }[] = [];
  const texts: string[] = [];
  const measureText = vi.fn((text: string) => ({ width: text.length * 6 }));
  const ctx = {
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    font: '',
    fillRect(...rect: number[]) {
      fills.push({ style: ctx.fillStyle, rect });
    },
    fillText(text: string) {
      texts.push(text);
    },
    measureText,
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, texts, measureText };
}

function primitiveEnv(): PrimitiveEnv {
  return {
    ...env(),
    pixelRatio: 1,
    theme: darkTheme,
    from: 0,
    to: 9,
    times: timeline().times,
    xToIndex: (x) => (x - 5) / 10,
    timeToX: (t) => t / 6 + 5,
    yToPrice: (y) => 500 - y,
    formatPrice: (p) => p.toFixed(2),
  };
}

function setup(priceFactor?: AnnotationHost['priceFactor']) {
  const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  pane.height = 500;
  pane.price.height = 500;
  pane.price.fit(0, 500);
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 100;
  time.barCount = 10;
  const primitives: { primitive: Primitive; series: Series | null }[] = [];
  const axisLabel = vi.fn();
  const requestRedraw = vi.fn();
  const host: AnnotationHost = {
    theme: darkTheme,
    timeline: timeline(),
    time,
    panes: [pane],
    plotLeft: 0,
    main: null,
    formatPrice: (_pane, price) => price.toFixed(2),
    formatAxis: (_pane, price) => price.toFixed(2),
    measureText: (text) => text.length * 6,
    axisLabel,
    requestOverlay: () => {},
    requestRedraw,
    ...(priceFactor ? { priceFactor } : {}),
    attachPrimitive: (primitive, series) => {
      const entry = { primitive, series };
      primitives.push(entry);
      return () => {
        const i = primitives.indexOf(entry);
        if (i >= 0) primitives.splice(i, 1);
      };
    },
  };
  const manager = tradingManager(host);
  const layer = (name: 'below' | 'top') => primitives.find((e) => e.primitive.layer === name)?.primitive;
  return { manager, primitives, layer, axisLabel, requestRedraw };
}

describe('time bands, price zones and text labels', () => {
  it('draw through one primitive per layer, below the series for areas and on top for labels', () => {
    const { manager, primitives, layer } = setup();
    manager.addTimeBand({ from: 120 });
    manager.addTimeBand({ from: 300, to: 360 });
    manager.addPriceZone({ from: 100, to: 200 });
    expect(primitives).toHaveLength(1);
    expect(layer('below')).toBeDefined();
    manager.addTextLabel({ time: 120, price: 100, text: 'Note' });
    manager.addTextLabel({ time: 180, price: 120, text: 'Other' });
    expect(primitives).toHaveLength(2);
    expect(layer('top')).toBeDefined();
    // Not hit-tested: nothing blocks panning.
    expect(primitives.every((e) => e.primitive.hitTest === undefined)).toBe(true);
  });

  it('fill bands and zones with the theme colour unless given one, skipping hidden ones', () => {
    const { manager, layer } = setup();
    const band = manager.addTimeBand({ from: 120, to: 240 });
    manager.addPriceZone({ from: 100, to: 200, color: 'rgba(0, 200, 0, 0.2)' });
    const { ctx, fills } = recorder();
    layer('below')!.drawPlot!(ctx, primitiveEnv());
    expect(fills).toEqual([
      { style: darkTheme.annotationFill, rect: [20, 0, 30, 500] },
      { style: 'rgba(0, 200, 0, 0.2)', rect: [0, 300, 100, 100] },
    ]);
    band.setVisible(false);
    fills.length = 0;
    layer('below')!.drawPlot!(ctx, primitiveEnv());
    expect(fills).toHaveLength(1);
  });

  it('draw band and zone labels, and text labels with the label colours', () => {
    const { manager, layer } = setup();
    manager.addTimeBand({ from: 120, label: 'Earnings' });
    manager.addPriceZone({ from: 100, to: 200, label: 'Demand' });
    manager.addTextLabel({ time: 120, price: 100, text: 'Note', pointerLength: 20 });
    const below = recorder();
    layer('below')!.drawPlot!(below.ctx, primitiveEnv());
    expect(below.texts).toEqual(['Earnings', 'Demand']);
    const top = recorder();
    layer('top')!.drawPlot!(top.ctx, primitiveEnv());
    expect(top.texts).toEqual(['Note']);
    expect(top.fills[0]!.style).toBe(darkTheme.labelBackground);
  });

  it('measure label text once, not every frame', () => {
    const { manager, layer } = setup();
    const note = manager.addTextLabel({ time: 120, price: 100, text: 'Note' });
    const { ctx, measureText } = recorder();
    for (let i = 0; i < 5; i++) layer('top')!.drawPlot!(ctx, primitiveEnv());
    expect(measureText).toHaveBeenCalledTimes(1);
    note.applyOptions({ text: 'Longer note' });
    for (let i = 0; i < 5; i++) layer('top')!.drawPlot!(ctx, primitiveEnv());
    expect(measureText).toHaveBeenCalledTimes(2);
  });

  it('label both zone edges on the price axis only with axisLabel, in the opaque zone colour', () => {
    const { manager, axisLabel } = setup();
    const z = manager.addPriceZone({ from: 100, to: 200, color: 'rgba(0, 128, 255, 0.15)' });
    manager.renderLabels({} as CanvasRenderingContext2D);
    expect(axisLabel).not.toHaveBeenCalled();
    z.applyOptions({ axisLabel: true });
    manager.renderLabels({} as CanvasRenderingContext2D);
    expect(axisLabel.mock.calls.map((c) => [c[1], c[2], c[3]])).toEqual([
      ['100.00', 400, 'rgb(0, 128, 255)'],
      ['200.00', 300, 'rgb(0, 128, 255)'],
    ]);
    // An edge outside the pane has no label.
    axisLabel.mockClear();
    z.applyOptions({ to: 900 });
    manager.renderLabels({} as CanvasRenderingContext2D);
    expect(axisLabel).toHaveBeenCalledTimes(1);
  });

  it('draw zones ending at a bar and text labels at the price factor of their bar', () => {
    // Prices before bar 3 (time 180) are halved, as by a 2-for-1 split there.
    const factor = vi.fn((_pane: Pane, time: number) => (time < 180 ? 0.5 : 1));
    const { manager, layer, axisLabel } = setup(factor);
    manager.addPriceZone({ from: 100, to: 200, toTime: 120, axisLabel: true });
    // Reaching the live edge, this one is a level of the live price.
    manager.addPriceZone({ from: 100, to: 200, fromTime: 120 });
    manager.addTextLabel({ time: 120, price: 100, text: 'Before' });
    manager.addTextLabel({ time: 240, price: 100, text: 'After' });
    const below = recorder();
    layer('below')!.drawPlot!(below.ctx, primitiveEnv());
    expect(below.fills.map((f) => [f.rect[1], f.rect[3]])).toEqual([
      [400, 50],
      [300, 100],
    ]);
    const top = recorder();
    layer('top')!.drawPlot!(top.ctx, primitiveEnv());
    // Boxes are centred on their anchors: y 450 before the split, 400 after.
    expect(top.fills.map((f) => f.rect[1]! + f.rect[3]! / 2)).toEqual([450, 400]);
    manager.renderLabels({} as CanvasRenderingContext2D);
    expect(axisLabel.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['50.00', 450],
      ['100.00', 400],
    ]);
  });

  it('validate options and keep the old ones on a bad update', () => {
    const { manager } = setup();
    expect(() => manager.addTimeBand({ from: NaN })).toThrow();
    expect(() => manager.addPriceZone({ from: 1, to: Infinity })).toThrow();
    expect(() => manager.addTextLabel({ time: 0, price: 1, text: 'x', align: 'top' as 'left' })).toThrow();
    expect(() => manager.addTextLabel({ time: 0, price: 1, text: 'x', fontSize: 0 })).toThrow();
    expect(manager.timeBands).toHaveLength(0);
    expect(manager.priceZones).toHaveLength(0);
    expect(manager.textLabels).toHaveLength(0);
    const z = manager.addPriceZone({ from: 1, to: 2 });
    expect(() => z.applyOptions({ to: NaN })).toThrow();
    expect(z.options.to).toBe(2);
  });

  it('redraw every layer on changes and detach their primitives once nothing uses them', () => {
    const { manager, primitives, requestRedraw } = setup();
    const band = manager.addTimeBand({ from: 0 });
    const note = manager.addTextLabel({ time: 0, price: 1, text: 'x' });
    expect(requestRedraw).toHaveBeenCalledTimes(2);
    band.applyOptions({ to: 60 });
    expect(requestRedraw).toHaveBeenCalledTimes(3);
    band.remove();
    expect(manager.timeBands).toHaveLength(0);
    expect(primitives.map((e) => e.primitive.layer)).toEqual(['top']);
    manager.addPriceZone({ from: 1, to: 2 });
    manager.clear();
    expect(primitives).toHaveLength(0);
    expect(manager.textLabels).toHaveLength(0);
    // A removed handle does nothing.
    note.remove();
    expect(primitives).toHaveLength(0);
  });
});

describe('time bands, price zones and text labels on a chart', () => {
  const bars = [0, 60, 120].map((time) => ({ time, open: 1, high: 2, low: 0, close: 1 }));
  const registry = (chart: Chart) => (chart as unknown as { primitives: PrimitiveRegistry }).primitives.all;

  it('stay out of the drawings and the undo stack', () => {
    const chart = new Chart(fakeContainer());
    try {
      chart.addCandles().setData(bars);
      const before = chart.drawings.serialize();
      chart.annotations.addTimeBand({ from: 60, label: 'Event' });
      chart.annotations.addPriceZone({ from: 0.5, to: 1.5, axisLabel: true });
      chart.annotations.addTextLabel({ time: 120, price: 2, text: 'Note' });
      expect(chart.drawings.serialize()).toEqual(before);
      expect(chart.drawings.canUndo).toBe(false);
      expect(registry(chart).map((e) => [e.primitive.layer, e.pane])).toEqual([
        ['below', chart.panes[0]],
        ['top', chart.panes[0]],
      ]);
      expect(chart.primitiveAt({ x: 50, y: 50 })).toBeNull();
    } finally {
      chart.destroy();
    }
  });

  it('follow a series into its pane, and stay listed when it is removed', () => {
    const chart = new Chart(fakeContainer());
    try {
      chart.addCandles().setData(bars);
      const lower = chart.addPane();
      const rsi = chart.addLine({}, lower);
      const z = chart.annotations.addPriceZone({ from: 30, to: 70, series: rsi });
      expect(registry(chart)).toHaveLength(1);
      expect(registry(chart)[0]!.pane).toBe(lower);
      chart.removeSeries(rsi);
      expect(chart.annotations.priceZones).toEqual([z]);
      expect(registry(chart)).toHaveLength(0);
      // Still editable, and it can move back to the main series.
      z.applyOptions({ label: 'Band' });
      z.applyOptions({ series: undefined });
      expect(registry(chart)).toHaveLength(1);
      expect(registry(chart)[0]!.pane).toBe(chart.panes[0]);
      expect(() => chart.annotations.addTimeBand({ from: 0, series: rsi })).toThrow();
      expect(chart.annotations.timeBands).toHaveLength(0);
    } finally {
      chart.destroy();
    }
  });

  it('follow the main series when it changes', () => {
    const chart = new Chart(fakeContainer());
    try {
      const lower = chart.addPane();
      const main = chart.addCandles({}, lower);
      main.setData(bars);
      chart.annotations.addTimeBand({ from: 60 });
      expect(registry(chart)[0]!.pane).toBe(lower);
      chart.removeSeries(main);
      expect(registry(chart)).toHaveLength(1);
      expect(registry(chart)[0]!.pane).toBe(chart.panes[0]);
      const next = chart.addCandles({}, lower);
      expect(registry(chart)).toHaveLength(1);
      expect(registry(chart)[0]!.pane).toBe(next.pane);
      chart.annotations.clear();
      expect(registry(chart)).toHaveLength(0);
    } finally {
      chart.destroy();
    }
  });
});
