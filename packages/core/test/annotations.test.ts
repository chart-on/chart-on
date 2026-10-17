import { describe, expect, it, vi } from 'vitest';
import { AnnotationManager, type AnnotationHost } from '../src/annotations/manager';
import { tradingManager } from './trading-manager';
import { barIndexOf, layoutMarkers, type MarkerBox, type MarkerLayoutEnv } from '../src/annotations/markers';
import { crossDirection, defaultTickSize, dragPrice, snapToTick } from '../src/annotations/lines';
import type { BarMarker } from '../src/annotations/types';
import { Pane } from '../src/pane';
import type { Primitive, PrimitiveEnv, PrimitiveRegistry } from '../src/primitives';
import { Chart } from '../src/chart';
import { fakeContainer } from './fake-dom';
import { PriceScale, TimeScale } from '../src/scales';
import { CandleSeries, type Series, type SeriesHost } from '../src/series';
import { darkTheme } from '../src/theme';
import { Timeline } from '../src/timeline';

function timeline(count = 10, interval = 60): Timeline {
  const tl = new Timeline();
  tl.set(Array.from({ length: count }, (_, i) => i * interval));
  return tl;
}

describe('barIndexOf', () => {
  it('maps exact times and times inside a bar to that bar', () => {
    const tl = timeline();
    expect(barIndexOf(tl, 120)).toBe(2);
    expect(barIndexOf(tl, 150)).toBe(2);
    expect(barIndexOf(tl, 179)).toBe(2);
    // The newest bar covers one interval.
    expect(barIndexOf(tl, 559)).toBe(9);
  });

  it('returns -1 outside the data', () => {
    const tl = timeline();
    expect(barIndexOf(tl, -1)).toBe(-1);
    expect(barIndexOf(tl, 600)).toBe(-1);
    expect(barIndexOf(new Timeline(), 0)).toBe(-1);
  });
});

/** Linear pane 500 px tall showing prices 0..500; every bar spans 90..110. */
function markerEnv(overrides: Partial<MarkerLayoutEnv> = {}): MarkerLayoutEnv {
  return {
    timeline: timeline(),
    rangeAt: () => [90, 110],
    priceToY: (price) => 500 - price,
    top: 0,
    bottom: 500,
    indexToX: (index) => index * 10,
    barSpacing: 10,
    fontSize: 12,
    ...overrides,
  };
}

/** No two boxes on the same bar overlap vertically. */
function expectNoOverlap(boxes: MarkerBox[]): void {
  for (const a of boxes) {
    for (const b of boxes) {
      if (a === b || a.x !== b.x) continue;
      expect(a.bottom <= b.top || b.bottom <= a.top).toBe(true);
    }
  }
}

describe('layoutMarkers', () => {
  it('stacks markers above the high outwards, first marker nearest the bar', () => {
    const markers: BarMarker[] = [
      { time: 120, shape: 'arrow-down' },
      { time: 130, shape: 'circle', text: 'B' },
      { time: 150, shape: 'square', position: 'above' },
    ];
    const boxes = layoutMarkers(markers, markerEnv());
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => b.x === 20)).toBe(true);
    // High 110 → y 390; the first marker starts 4 px above it.
    expect(boxes[0]!.bottom).toBe(386);
    expect(boxes[1]!.bottom).toBeLessThan(boxes[0]!.top);
    expect(boxes[2]!.bottom).toBeLessThan(boxes[1]!.top);
    // Text sits above its shape and is part of the box.
    expect(boxes[1]!.textY).toBeLessThan(boxes[1]!.y);
    expect(boxes[1]!.textY).toBeGreaterThan(boxes[1]!.top);
    expectNoOverlap(boxes);
  });

  it('stacks markers below the low downwards', () => {
    const markers: BarMarker[] = [
      { time: 60, shape: 'arrow-up', text: 'Buy' },
      { time: 60, shape: 'arrow-up', text: 'Buy' },
    ];
    const boxes = layoutMarkers(markers, markerEnv());
    // Low 90 → y 410.
    expect(boxes[0]!.top).toBe(414);
    expect(boxes[1]!.top).toBeGreaterThan(boxes[0]!.bottom);
    expect(boxes[0]!.textY).toBeGreaterThan(boxes[0]!.y);
    expectNoOverlap(boxes);
  });

  it('centres inside markers on the bar', () => {
    const markers: BarMarker[] = [
      { time: 0, shape: 'circle', position: 'inside' },
      { time: 0, shape: 'square', position: 'inside' },
    ];
    const boxes = layoutMarkers(markers, markerEnv());
    expect((boxes[0]!.top + boxes[1]!.bottom) / 2).toBeCloseTo(400);
    expectNoOverlap(boxes);
  });

  it('keeps bars and positions independent', () => {
    const markers: BarMarker[] = [
      { time: 0, shape: 'arrow-down' },
      { time: 0, shape: 'arrow-up' },
      { time: 60, shape: 'arrow-down' },
    ];
    const [a, b, c] = layoutMarkers(markers, markerEnv());
    expect(a!.bottom).toBe(386);
    expect(b!.top).toBe(414);
    expect(c!.bottom).toBe(386);
    expect(c!.x).toBe(10);
  });

  it('skips markers outside the data and bars without a value', () => {
    const markers: BarMarker[] = [
      { time: -30, shape: 'circle' },
      { time: 180, shape: 'circle' },
      { time: 900, shape: 'circle' },
    ];
    const boxes = layoutMarkers(markers, markerEnv({ rangeAt: (i) => (i === 3 ? [90, 110] : null) }));
    expect(boxes.map((b) => b.marker.time)).toEqual([180]);
  });

  it('anchors to the log-scaled high and keeps pixel spacing on a log scale', () => {
    const scale = new PriceScale({ marginTop: 0, marginBottom: 0 });
    scale.height = 300;
    scale.setMode('log');
    scale.fit(10, 1000);
    const markers: BarMarker[] = [
      { time: 0, shape: 'arrow-down' },
      { time: 0, shape: 'arrow-down' },
    ];
    const log = layoutMarkers(markers, markerEnv({ rangeAt: () => [50, 100], priceToY: (p) => scale.priceToY(p) }));
    // 100 is the middle of 10..1000 on a log scale.
    expect(log[0]!.bottom).toBeCloseTo(150 - 4);
    const linear = layoutMarkers(markers, markerEnv());
    expect(log[0]!.top - log[1]!.top).toBeCloseTo(linear[0]!.top - linear[1]!.top);
  });
});

describe('tick snapping', () => {
  it('snaps without float noise', () => {
    expect(snapToTick(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(snapToTick(101.37, 0.25)).toBe(101.25);
    expect(snapToTick(12345.678, 5)).toBe(12345);
    expect(snapToTick(1.23456789, 1e-8)).toBe(1.23456789);
  });

  it('reads the price through the scale', () => {
    const scale = new PriceScale({ marginTop: 0, marginBottom: 0 });
    scale.height = 400;
    scale.fit(0, 400);
    expect(dragPrice(scale, 100.4, 0.5)).toBe(299.5);
    // Kept inside the pane.
    expect(dragPrice(scale, -50, 1)).toBe(400);
    scale.setMode('log');
    scale.fit(1, 10000);
    expect(dragPrice(scale, 200, 0.01)).toBe(100);
  });
});

/* ---------------------------- AnnotationManager --------------------------- */

const seriesHost: SeriesHost = {
  timeline: new Timeline(),
  theme: darkTheme,
  maxTextureSize: 4096,
  mainDataChanged: () => {},
  mainLastBarChanged: () => {},
  requestRender: () => {},
};

function setup(main: Series | null = null) {
  const tl = timeline(100);
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = 100;
  const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  pane.height = 500;
  pane.price.height = 500;
  // Linear: price = 500 - y.
  pane.price.fit(0, 500);
  const host: AnnotationHost = {
    theme: darkTheme,
    timeline: tl,
    time,
    panes: [pane],
    plotLeft: 0,
    main,
    formatPrice: (_pane, price) => price.toFixed(2),
    formatAxis: (_pane, price) => price.toFixed(2),
    measureText: (text) => text.length * 7,
    axisLabel: () => {},
    requestOverlay: () => {},
    attachPrimitive: (primitive, series) => {
      const entry = { primitive, series };
      primitives.push(entry);
      return () => {
        const i = primitives.indexOf(entry);
        if (i >= 0) primitives.splice(i, 1);
      };
    },
  };
  const primitives: { primitive: Primitive; series: Series | null }[] = [];
  return { manager: tradingManager(host), pane, primitives };
}

/** Centre of the right-most block button (blocks end 8 px left of the axis; buttons are 20 px). */
const BUTTON_X = 1000 - 8 - 10;

describe('AnnotationManager trade lines', () => {
  it('reports dragged prices from the linear scale, snapped to the tick size', () => {
    const { manager } = setup();
    const onDrag = vi.fn();
    const onChange = vi.fn();
    const line = manager.addTradeLine({ price: 300, side: 'buy', tickSize: 0.5, confirmChanges: false, onDrag, onChange });
    // Grab 2 px below the line (y 200): the offset is kept, the line does not jump.
    expect(manager.pointerDown({ x: 300, y: 202 })).toBe(true);
    manager.pointerMove({ x: 300, y: 152.4 });
    expect(onDrag).toHaveBeenLastCalledWith({ part: 'entry', price: 349.5 });
    manager.pointerUp({ x: 300, y: 152.4 });
    expect(onChange).toHaveBeenCalledWith({ part: 'entry', price: 349.5, from: 300 });
    expect(line.options.price).toBe(349.5);
  });

  it('reports dragged prices from the log scale', () => {
    const { manager, pane } = setup();
    pane.price.setMode('log');
    pane.price.fit(10, 1000);
    const onChange = vi.fn();
    // 100 sits in the middle of the pane (y 250).
    manager.addTradeLine({ price: 100, side: 'sell', tickSize: 0.01, confirmChanges: false, onChange });
    expect(manager.pointerDown({ x: 300, y: 250 })).toBe(true);
    manager.pointerMove({ x: 300, y: 125 });
    manager.pointerUp({ x: 300, y: 125 });
    // log10 2.5 → 316.23, not the linear 752.5.
    expect(onChange).toHaveBeenCalledWith({ part: 'entry', price: 316.23, from: 100 });
  });

  it('defaults the tick size to the series precision', () => {
    const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
    const candles = new CandleSeries(seriesHost, pane, {
      title: '',
      style: 'candles',
      precision: 1,
      bodyRatio: 0.7,
      lineWidth: 1,
      lastValueLabel: true,
      animate: false,
    });
    expect(defaultTickSize(candles, 64000)).toBeCloseTo(0.1);
    expect(defaultTickSize(null, 64000)).toBeCloseTo(0.01);
    expect(defaultTickSize(null, 1.2345)).toBeCloseTo(0.0001);
  });

  it('defaults the tick size to the series price format', () => {
    const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
    const candles = new CandleSeries(seriesHost, pane, {
      title: '',
      style: 'candles',
      priceFormat: { type: 'fraction', denominator: 32 },
      bodyRatio: 0.7,
      lineWidth: 1,
      lastValueLabel: true,
      animate: false,
    });
    expect(defaultTickSize(candles, 101)).toBe(1 / 32);
  });

  it('restores the original price on Escape', () => {
    const { manager } = setup();
    const onDrag = vi.fn();
    const onChange = vi.fn();
    const line = manager.addTradeLine({ price: 300, side: 'buy', tickSize: 1, onDrag, onChange });
    manager.pointerDown({ x: 300, y: 200 });
    manager.pointerMove({ x: 300, y: 100 });
    expect(onDrag).toHaveBeenLastCalledWith({ part: 'entry', price: 400 });
    expect(manager.keyDown({ key: 'Escape' } as KeyboardEvent)).toBe(true);
    expect(onDrag).toHaveBeenLastCalledWith({ part: 'entry', price: 300 });
    manager.pointerUp({ x: 300, y: 100 });
    expect(onChange).not.toHaveBeenCalled();
    expect(line.options.price).toBe(300);
    expect(manager.isBusy).toBe(false);
  });

  it('only drags lines that have a drag callback', () => {
    const { manager } = setup();
    manager.addTradeLine({ price: 300, side: 'buy' });
    expect(manager.pointerDown({ x: 300, y: 200 })).toBe(false);
    expect(manager.cursor({ x: 300, y: 200 })).toBeNull();
  });

  it('ignores hidden lines and keeps their options', () => {
    const { manager } = setup();
    const line = manager.addTradeLine({ price: 300, side: 'buy', onChange: () => {} });
    line.setVisible(false);
    expect(manager.pointerDown({ x: 300, y: 200 })).toBe(false);
    line.setVisible(true);
    expect(manager.cursor({ x: 300, y: 200 })).toBe('ns-resize');
  });

  it('reports an action on release over its button only', () => {
    const { manager } = setup();
    const onAction = vi.fn();
    manager.addTradeLine({ price: 300, side: 'buy', onAction });
    expect(manager.cursor({ x: BUTTON_X, y: 200 })).toBe('pointer');
    expect(manager.pointerDown({ x: BUTTON_X, y: 200 })).toBe(true);
    manager.pointerUp({ x: 400, y: 200 });
    expect(onAction).not.toHaveBeenCalled();
    manager.pointerDown({ x: BUTTON_X, y: 200 });
    manager.pointerUp({ x: BUTTON_X, y: 201 });
    expect(onAction).toHaveBeenCalledWith({ action: 'cancel', part: 'entry' });
  });

  it('shows no buttons without onAction, and only the listed actions with it', () => {
    const { manager } = setup();
    const line = manager.addTradeLine({ price: 300, side: 'buy', onChange: () => {} });
    // The block is still there and drags, but has no button.
    expect(manager.cursor({ x: BUTTON_X, y: 200 })).toBe('ns-resize');
    const onAction = vi.fn();
    line.applyOptions({ onAction, actions: [] });
    expect(manager.cursor({ x: BUTTON_X, y: 200 })).toBe('ns-resize');
    line.applyOptions({ actions: ['close'] });
    manager.pointerDown({ x: BUTTON_X, y: 200 });
    manager.pointerUp({ x: BUTTON_X, y: 200 });
    expect(onAction).toHaveBeenCalledWith({ action: 'close', part: 'entry' });
  });

  it('reports bracket actions with their part', () => {
    const { manager } = setup();
    const onAction = vi.fn();
    manager.addTradeLine({ price: 300, side: 'buy', stopLoss: 200, onAction });
    manager.pointerDown({ x: BUTTON_X, y: 300 });
    manager.pointerUp({ x: BUTTON_X, y: 300 });
    expect(onAction).toHaveBeenCalledWith({ action: 'cancel', part: 'stopLoss' });
  });

  it('drags linked take-profit and stop-loss lines', () => {
    const { manager } = setup();
    const onChange = vi.fn();
    const line = manager.addTradeLine({ price: 300, side: 'buy', takeProfit: 400, stopLoss: 250, tickSize: 1, confirmChanges: false, onChange });
    manager.pointerDown({ x: 300, y: 100 });
    manager.pointerMove({ x: 300, y: 80 });
    manager.pointerUp({ x: 300, y: 80 });
    expect(onChange).toHaveBeenLastCalledWith({ part: 'takeProfit', price: 420, from: 400 });
    manager.pointerDown({ x: 300, y: 250 });
    manager.pointerMove({ x: 300, y: 270 });
    manager.pointerUp({ x: 300, y: 270 });
    expect(onChange).toHaveBeenLastCalledWith({ part: 'stopLoss', price: 230, from: 250 });
    expect(line.options).toMatchObject({ price: 300, takeProfit: 420, stopLoss: 230 });
  });

  it('keeps a position entry fixed and offers reverse and close by default', () => {
    const { manager } = setup();
    const onAction = vi.fn();
    const onChange = vi.fn();
    const line = manager.addTradeLine({ kind: 'position', price: 300, side: 'buy', quantity: 2, stopLoss: 200, onAction, onChange });
    expect(line.options).toMatchObject({ lineStyle: 'solid', actions: ['reverse', 'close'] });
    expect(manager.pointerDown({ x: 300, y: 200 })).toBe(false);
    manager.pointerDown({ x: BUTTON_X, y: 200 });
    manager.pointerUp({ x: BUTTON_X, y: 200 });
    expect(onAction).toHaveBeenLastCalledWith({ action: 'close', part: 'entry' });
    manager.pointerDown({ x: BUTTON_X - 20, y: 200 });
    manager.pointerUp({ x: BUTTON_X - 20, y: 200 });
    expect(onAction).toHaveBeenLastCalledWith({ action: 'reverse', part: 'entry' });
    // Its stop-loss still drags.
    expect(manager.pointerDown({ x: 300, y: 300 })).toBe(true);
  });

  it('ends the gesture when the line is removed mid-drag', () => {
    const { manager } = setup();
    const onChange = vi.fn();
    const line = manager.addTradeLine({ price: 300, side: 'buy', onChange });
    manager.pointerDown({ x: 300, y: 200 });
    line.remove();
    manager.pointerMove({ x: 300, y: 150 });
    manager.pointerUp({ x: 300, y: 150 });
    expect(onChange).not.toHaveBeenCalled();
    expect(manager.tradeLines).toHaveLength(0);
    expect(manager.isBusy).toBe(false);
  });

  it('rejects invalid prices', () => {
    const { manager } = setup();
    expect(() => manager.addTradeLine({ price: NaN, side: 'buy' })).toThrow();
    expect(() => manager.addTradeLine({ price: 1, side: 'buy', actions: ['undo' as never] })).toThrow();
    const line = manager.addPriceLine({ price: 10 });
    expect(() => line.applyOptions({ price: Infinity })).toThrow();
    expect(line.options.price).toBe(10);
  });
});

describe('AnnotationManager markers', () => {
  it('stores sorted copies per series', () => {
    const { manager } = setup();
    const input: BarMarker[] = [
      { time: 120, shape: 'circle', text: 'b' },
      { time: 60, shape: 'circle', text: 'a' },
      { time: 120, shape: 'square', text: 'c' },
    ];
    manager.setMarkers(input);
    input[0]!.text = 'changed';
    expect(manager.getMarkers().map((m) => m.text)).toEqual(['a', 'b', 'c']);
    manager.setMarkers([]);
    expect(manager.getMarkers()).toEqual([]);
    expect(() => manager.setMarkers([{ time: NaN, shape: 'circle' }])).toThrow();
  });
});

describe('AnnotationManager alert lines', () => {
  it('reports dragged prices from the linear scale, snapped to the tick size', () => {
    const { manager } = setup();
    const onDrag = vi.fn();
    const onChange = vi.fn();
    const line = manager.addAlertLine({ price: 300, tickSize: 0.5, onDrag, onChange });
    expect(line.options).toMatchObject({ label: 'Alert', lineStyle: 'dotted', lineWidth: 1 });
    // Grab 2 px below the line (y 200): the offset is kept, the line does not jump.
    expect(manager.pointerDown({ x: 300, y: 202 })).toBe(true);
    manager.pointerMove({ x: 300, y: 152.4 });
    expect(onDrag).toHaveBeenLastCalledWith({ price: 349.5 });
    manager.pointerUp({ x: 300, y: 152.4 });
    expect(onChange).toHaveBeenCalledWith({ price: 349.5, from: 300 });
    expect(line.options.price).toBe(349.5);
  });

  it('reports dragged prices from the log scale', () => {
    const { manager, pane } = setup();
    pane.price.setMode('log');
    pane.price.fit(10, 1000);
    const onChange = vi.fn();
    // 100 sits in the middle of the pane (y 250).
    const line = manager.addAlertLine({ price: 100, tickSize: 0.01, onChange });
    expect(manager.pointerDown({ x: 300, y: 250 })).toBe(true);
    manager.pointerMove({ x: 300, y: 125 });
    manager.pointerUp({ x: 300, y: 125 });
    // log10 2.5 → 316.23, not the linear 752.5.
    expect(onChange).toHaveBeenCalledWith({ price: 316.23, from: 100 });
    expect(line.options.price).toBe(316.23);
  });

  it('restores the original price on Escape', () => {
    const { manager } = setup();
    const onDrag = vi.fn();
    const onChange = vi.fn();
    const line = manager.addAlertLine({ price: 300, tickSize: 1, onDrag, onChange });
    manager.pointerDown({ x: 300, y: 200 });
    manager.pointerMove({ x: 300, y: 100 });
    expect(manager.keyDown({ key: 'Escape' } as KeyboardEvent)).toBe(true);
    expect(onDrag).toHaveBeenLastCalledWith({ price: 300 });
    manager.pointerUp({ x: 300, y: 100 });
    expect(onChange).not.toHaveBeenCalled();
    expect(line.options.price).toBe(300);
  });

  it('only drags with a change handler and shows a remove button only with onRemove', () => {
    const { manager } = setup();
    const line = manager.addAlertLine({ price: 300 });
    expect(manager.pointerDown({ x: 300, y: 200 })).toBe(false);
    expect(manager.cursor({ x: BUTTON_X, y: 200 })).toBeNull();
    line.applyOptions({ onChange: () => {} });
    // The block drags but has no button.
    expect(manager.cursor({ x: BUTTON_X, y: 200 })).toBe('ns-resize');
    const onRemove = vi.fn();
    line.applyOptions({ onRemove });
    expect(manager.cursor({ x: BUTTON_X, y: 200 })).toBe('pointer');
    manager.pointerDown({ x: BUTTON_X, y: 200 });
    manager.pointerUp({ x: BUTTON_X, y: 200 });
    expect(onRemove).toHaveBeenCalledTimes(1);
    // The app decides: the button does not remove the line by itself.
    expect(manager.alertLines).toEqual([line]);
  });

  it('lets a trade line at the same price win the pointer', () => {
    const { manager } = setup();
    const onAlert = vi.fn();
    const onTrade = vi.fn();
    manager.addAlertLine({ price: 300, tickSize: 1, onChange: onAlert });
    manager.addTradeLine({ price: 300, side: 'buy', tickSize: 1, confirmChanges: false, onChange: onTrade });
    manager.pointerDown({ x: 300, y: 200 });
    manager.pointerMove({ x: 300, y: 190 });
    manager.pointerUp({ x: 300, y: 190 });
    expect(onTrade).toHaveBeenCalled();
    expect(onAlert).not.toHaveBeenCalled();
  });

  it('draws through one top-layer primitive per line, detached on remove and clear', () => {
    const { manager, primitives } = setup();
    const a = manager.addAlertLine({ price: 300, title: 'Breakout', onRemove: () => {} });
    manager.addAlertLine({ price: 200 });
    expect(primitives).toHaveLength(2);
    expect(primitives[0]!.primitive.layer).toBe('top');
    expect(primitives[0]!.series).toBeNull();
    // Draws in the pane-local space primitives get (smoke test on a no-op context).
    const ctx = (fakeContainer() as unknown as HTMLCanvasElement).getContext('2d')!;
    expect(() => primitives[0]!.primitive.drawPlot!(ctx, {} as PrimitiveEnv)).not.toThrow();
    a.remove();
    expect(primitives).toHaveLength(1);
    expect(manager.alertLines).toHaveLength(1);
    manager.clear();
    expect(primitives).toHaveLength(0);
    expect(manager.alertLines).toHaveLength(0);
  });

  it('rejects invalid prices and tick sizes', () => {
    const { manager } = setup();
    expect(() => manager.addAlertLine({ price: NaN })).toThrow();
    const line = manager.addAlertLine({ price: 10 });
    expect(() => line.applyOptions({ tickSize: 0 })).toThrow();
    expect(line.options.tickSize).toBeUndefined();
  });
});

describe('alert crossings', () => {
  it('reports the direction a price crossed a level', () => {
    expect(crossDirection(100, 99, 101)).toBe('up');
    expect(crossDirection(100, 101, 99)).toBe('down');
    // Reaching the level counts; starting on it does not, so a touch reports once.
    expect(crossDirection(100, 99, 100)).toBe('up');
    expect(crossDirection(100, 100, 101)).toBeNull();
    expect(crossDirection(100, 100, 100)).toBeNull();
    expect(crossDirection(100, 101, 102)).toBeNull();
    expect(crossDirection(100, NaN, 101)).toBeNull();
  });

  it('lists the crossed alert lines of a series', () => {
    const { manager } = setup();
    const low = manager.addAlertLine({ price: 95 });
    const high = manager.addAlertLine({ price: 105 });
    const hidden = manager.addAlertLine({ price: 100 });
    hidden.setVisible(false);
    // Lines of another series are checked against that series' prices only.
    const other = {} as Series;
    const rsi = manager.addAlertLine({ price: 100, series: other });
    expect(manager.alertsCrossed(99, 101, other)).toEqual([{ line: rsi, direction: 'up' }]);
    expect(manager.alertsCrossed(98, 99)).toEqual([]);
    expect(manager.alertsCrossed(99, 106)).toEqual([
      { line: high, direction: 'up' },
      { line: hidden, direction: 'up' },
    ]);
    expect(manager.alertsCrossed(106, 94)).toEqual([
      { line: low, direction: 'down' },
      { line: high, direction: 'down' },
      { line: hidden, direction: 'down' },
    ]);
  });
});

describe('alert lines on a chart', () => {
  it('attach a primitive to the main pane and stay out of the drawings', () => {
    const chart = new Chart(fakeContainer());
    try {
      chart.addCandles().setData([0, 60, 120].map((time) => ({ time, open: 1, high: 2, low: 0, close: 1 })));
      const before = chart.drawings.serialize();
      const all = () => (chart as unknown as { primitives: PrimitiveRegistry }).primitives.all;
      const line = chart.annotations.addAlertLine({ price: 1.5, onChange: () => {} });
      expect(all()).toHaveLength(1);
      expect(all()[0]!.pane).toBe(chart.panes[0]);
      expect(chart.drawings.serialize()).toEqual(before);
      expect(chart.drawings.canUndo).toBe(false);
      line.remove();
      expect(all()).toHaveLength(0);
    } finally {
      chart.destroy();
    }
  });

  const bars = [0, 60, 120].map((time) => ({ time, open: 1, high: 2, low: 0, close: 1 }));
  const registry = (chart: Chart) => (chart as unknown as { primitives: PrimitiveRegistry }).primitives.all;

  it('leave no line behind when the series is not on the chart', () => {
    const chart = new Chart(fakeContainer());
    try {
      chart.addCandles().setData(bars);
      const removed = chart.addLine();
      chart.removeSeries(removed);
      expect(() => chart.annotations.addAlertLine({ price: 1.5, series: removed })).toThrow();
      expect(chart.annotations.alertLines).toHaveLength(0);
      expect(registry(chart)).toHaveLength(0);
    } finally {
      chart.destroy();
    }
  });

  it('keep their options when moving to a series that is not on the chart fails', () => {
    const chart = new Chart(fakeContainer());
    try {
      chart.addCandles().setData(bars);
      const removed = chart.addLine();
      chart.removeSeries(removed);
      const line = chart.annotations.addAlertLine({ price: 1.5 });
      expect(() => line.applyOptions({ price: 1.8, series: removed })).toThrow();
      expect(line.options.price).toBe(1.5);
      expect(line.options.series).toBeUndefined();
      expect(registry(chart)).toHaveLength(1);
      expect(registry(chart)[0]!.pane).toBe(chart.panes[0]);
    } finally {
      chart.destroy();
    }
  });

  it('stay listed but unshown when their series is removed, and can move back', () => {
    const chart = new Chart(fakeContainer());
    try {
      chart.addCandles().setData(bars);
      const other = chart.addLine();
      const line = chart.annotations.addAlertLine({ price: 1.5, series: other });
      expect(registry(chart)).toHaveLength(1);
      chart.removeSeries(other);
      expect(chart.annotations.alertLines).toEqual([line]);
      expect(registry(chart)).toHaveLength(0);
      expect(() => line.applyOptions({ series: undefined })).not.toThrow();
      expect(registry(chart)).toHaveLength(1);
      expect(registry(chart)[0]!.pane).toBe(chart.panes[0]);
    } finally {
      chart.destroy();
    }
  });

  it('attach to the pane of the main series, following it when the main series changes', () => {
    const chart = new Chart(fakeContainer());
    try {
      const lower = chart.addPane();
      const main = chart.addCandles({}, lower);
      main.setData(bars);
      chart.annotations.addAlertLine({ price: 1.5 });
      expect(registry(chart)).toHaveLength(1);
      expect(registry(chart)[0]!.pane).toBe(lower);
      // No main series: back to the main pane.
      chart.removeSeries(main);
      expect(registry(chart)).toHaveLength(1);
      expect(registry(chart)[0]!.pane).toBe(chart.panes[0]);
      // A new main series takes the line along.
      const next = chart.addCandles({}, chart.panes[1]);
      expect(chart.main).toBe(next);
      expect(registry(chart)).toHaveLength(1);
      expect(registry(chart)[0]!.pane).toBe(next.pane);
    } finally {
      chart.destroy();
    }
  });
});
