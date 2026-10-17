import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { MAX_PATHS, drawMarker, layoutMarkers, markerAt, MarkerPool, placeMarkers, type MarkerBox, type MarkerLayoutEnv } from '../src/annotations/markers';
import type { BarMarker, MarkerLeaveEvent, MarkerPointerEvent } from '../src/annotations/types';
import { PriceScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function timeline(count = 10, interval = 60): Timeline {
  const tl = new Timeline();
  tl.set(Array.from({ length: count }, (_, i) => i * interval));
  return tl;
}

/** Linear pane 500 px tall showing prices 0..500; every bar spans 90..110; text 7 px per character. */
function env(overrides: Partial<MarkerLayoutEnv> = {}): MarkerLayoutEnv {
  return {
    timeline: timeline(),
    rangeAt: () => [90, 110],
    priceToY: (price) => 500 - price,
    top: 0,
    bottom: 500,
    indexToX: (index) => index * 10,
    barSpacing: 10,
    fontSize: 12,
    measureText: (text) => text.length * 7,
    ...overrides,
  };
}

function overlaps(a: MarkerBox, b: MarkerBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe('price-anchored markers', () => {
  it('centre on their price on a linear scale', () => {
    const [box] = layoutMarkers([{ time: 120, shape: 'diamond', position: 'atPrice', price: 250 }], env());
    expect(box!.x).toBe(20);
    expect(box!.y).toBe(250);
  });

  it('follow a log scale', () => {
    const scale = new PriceScale({ marginTop: 0, marginBottom: 0 });
    scale.height = 300;
    scale.setMode('log');
    scale.fit(10, 1000);
    const [box] = layoutMarkers([{ time: 0, shape: 'circle', position: 'atPrice', price: 100 }], env({ priceToY: (p) => scale.priceToY(p) }));
    // 100 is the middle of 10..1000 on a log scale.
    expect(box!.y).toBeCloseTo(150);
  });

  it('need no bar value', () => {
    const boxes = layoutMarkers(
      [
        { time: 60, shape: 'circle', position: 'atPrice', price: 100 },
        { time: 60, shape: 'circle' },
      ],
      env({ rangeAt: () => null }),
    );
    expect(boxes.map((b) => b.marker.position)).toEqual(['atPrice']);
  });

  it('point side arrows at the bar from beside it, text on the far side', () => {
    const [right, left] = layoutMarkers(
      [
        { time: 60, shape: 'arrow-right', position: 'atPrice', price: 300, text: 'Buy' },
        { time: 60, shape: 'arrow-left', position: 'atPrice', price: 200, text: 'Sell' },
      ],
      env(),
    );
    expect(right!.x + right!.width / 2).toBeLessThanOrEqual(10);
    expect(right!.align).toBe('right');
    expect(right!.textX).toBeLessThan(right!.x);
    expect(right!.left).toBeLessThan(right!.textX - 20);
    expect(left!.x - left!.width / 2).toBeGreaterThanOrEqual(10);
    expect(left!.align).toBe('left');
    expect(left!.right).toBeGreaterThan(left!.textX + 27);
  });

  it('stack sideways at one price, keeping the price', () => {
    const markers: BarMarker[] = [
      { time: 60, shape: 'circle', position: 'atPrice', price: 100, text: 'A' },
      { time: 60, shape: 'square', position: 'atPrice', price: 100 },
      { time: 60, shape: 'diamond', position: 'atPrice', price: 101 },
      { time: 60, shape: 'arrow-right', position: 'atPrice', price: 100 },
      // Far enough away: stays on the bar.
      { time: 60, shape: 'circle', position: 'atPrice', price: 200 },
    ];
    const boxes = layoutMarkers(markers, env());
    expect(boxes.slice(0, 3).map((b) => b.y)).toEqual([400, 400, 399]);
    expect(boxes[1]!.left).toBeGreaterThan(boxes[0]!.right);
    expect(boxes[2]!.left).toBeGreaterThan(boxes[1]!.right);
    // The arrow sits left of the bar, clear of the centred circle.
    expect(boxes[3]!.right).toBeLessThan(boxes[0]!.left);
    expect(boxes[4]!.x).toBe(10);
    for (const a of boxes) for (const b of boxes) if (a !== b) expect(overlaps(a, b)).toBe(false);
  });

  it('do not move markers placed against the bar', () => {
    const boxes = layoutMarkers(
      [
        { time: 60, shape: 'arrow-down' },
        { time: 60, shape: 'circle', position: 'atPrice', price: 115 },
      ],
      env(),
    );
    expect(boxes[0]!.bottom).toBe(386);
    expect(boxes[1]!.x).toBe(10);
  });
});

describe('marker shapes', () => {
  it('sizes a label to its text and draws the text inside', () => {
    const [label, flag] = layoutMarkers(
      [
        { time: 0, shape: 'label', text: 'Stop', position: 'above' },
        { time: 0, shape: 'flag', text: 'Hi', position: 'above' },
      ],
      env(),
    );
    expect(label!.width).toBe(4 * 7 + 8);
    expect(label!.textY).toBeNull();
    expect(label!.right - label!.left).toBe(36);
    expect(flag!.textY).not.toBeNull();
  });

  it('defaults position and colour by direction', () => {
    const boxes = layoutMarkers(
      [
        { time: 0, shape: 'triangle-up' },
        { time: 0, shape: 'triangle-down' },
      ],
      env(),
    );
    expect(boxes[0]!.y).toBeGreaterThan(410);
    expect(boxes[1]!.y).toBeLessThan(390);
  });

  it('draws every shape', () => {
    const c = chart();
    const shapes = ['arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'triangle-up', 'triangle-down', 'circle', 'square', 'diamond', 'cross', 'x-cross', 'flag', 'label'] as const;
    c.annotations.setMarkers(shapes.map((shape, i) => ({ time: (10 + i) * 60, shape, text: 'x' })));
    expect(() => render(c)).not.toThrow();
  });
});

describe('cross shapes', () => {
  /** Corners of a marker 20 px across at (50, 50), rounded to 0.1 px. */
  function corners(shape: 'cross' | 'x-cross'): [number, number][] {
    const points: [number, number][] = [];
    const ctx = {
      beginPath() {},
      closePath() {},
      fill() {},
      lineTo: (x: number, y: number) => points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]),
    } as unknown as CanvasRenderingContext2D;
    const marker: BarMarker = { time: 0, shape };
    const box = { marker, x: 50, y: 50, size: 20, width: 20, textX: 0, textY: null, align: 'left' } as MarkerBox;
    drawMarker(ctx, box, '#000');
    return points;
  }

  it('draws an upright plus with arms to the edge of the marker', () => {
    const p = corners('cross');
    expect(p).toHaveLength(12);
    // Each arm tip is a short edge across the arm, 2.6 px wide.
    expect(p).toEqual(expect.arrayContaining([[60, 47.4], [60, 52.6], [50 - 2.6, 60], [40, 47.4], [52.6, 40]]));
    for (const [x, y] of p) expect(Math.max(Math.abs(x - 50), Math.abs(y - 50))).toBeLessThanOrEqual(10);
  });

  it('turns the plus by 45 degrees for x-cross', () => {
    const p = corners('x-cross');
    expect(p).toHaveLength(12);
    // Arm tips lie on the diagonals, 10 px from the centre.
    const far = p.filter(([x, y]) => Math.hypot(x - 50, y - 50) > 9.5);
    expect(far).toHaveLength(8);
    for (const [x, y] of far) expect(Math.abs(Math.abs(x - 50) - Math.abs(y - 50))).toBeLessThan(4);
  });
});

describe('marker icon paths', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps at most the limit of parsed paths, dropping the least recently used first', () => {
    const parsed: string[] = [];
    vi.stubGlobal('Path2D', class {
      constructor(d: string) {
        parsed.push(d);
      }
    });
    const ctx = new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D;
    const draw = (svgPath: string) =>
      drawMarker(ctx, { marker: { time: 0, shape: 'circle', icon: { svgPath } }, x: 0, y: 0, size: 10, width: 10, textX: 0, textY: null, align: 'left' } as MarkerBox, '#000');
    const paths = Array.from({ length: MAX_PATHS }, (_, i) => `M${i} 0`);
    for (const p of paths) draw(p);
    // Using the first path again makes the second the least recently used.
    draw(paths[0]!);
    draw('M0 1');
    expect(parsed).toHaveLength(MAX_PATHS + 1);
    for (const p of [paths[0]!, ...paths.slice(2), 'M0 1']) draw(p);
    expect(parsed).toHaveLength(MAX_PATHS + 1);
    draw(paths[1]!);
    expect(parsed.at(-1)).toBe(paths[1]);
  });
});

describe('marker hit testing', () => {
  it('hits the shape and its text, topmost first', () => {
    const pool = new MarkerPool();
    const markers: BarMarker[] = [
      { time: 60, shape: 'circle', position: 'atPrice', price: 200, text: 'Long text' },
      { time: 60, shape: 'square', position: 'inside' },
    ];
    placeMarkers(markers, 0, markers.length, env(), pool);
    const [a, b] = pool.boxes;
    expect(markerAt(pool, { x: a!.x, y: a!.y })).toBe(a);
    // On the text, right of the shape.
    expect(markerAt(pool, { x: a!.right - 3, y: a!.y })).toBe(a);
    expect(markerAt(pool, { x: a!.right + 10, y: a!.y })).toBeNull();
    expect(markerAt(pool, { x: b!.x, y: b!.y })).toBe(b);
  });

  it('reuses its boxes between layouts', () => {
    const pool = new MarkerPool();
    const markers: BarMarker[] = [{ time: 60, shape: 'circle' }];
    placeMarkers(markers, 0, 1, env(), pool);
    const box = pool.boxes[0];
    pool.reset();
    placeMarkers(markers, 0, 1, env(), pool);
    expect(pool.boxes[0]).toBe(box);
    expect(pool.used).toBe(1);
  });
});

const bars: Bar[] = Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 }));

function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(bars);
  render(c);
  return c;
}

function render(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
}

/** Plot-space point of a price on bar `index`. */
const at = (c: Chart, index: number, price: number) => ({ x: c.time.indexToX(index), y: c.panes[0]!.top + c.panes[0]!.primary.priceToY(price) });

describe('markers on the chart', () => {
  it('validates markers and ids', () => {
    const c = chart();
    expect(() => c.annotations.setMarkers([{ time: 0, shape: 'circle', position: 'atPrice' }])).toThrow(/price/);
    expect(() =>
      c.annotations.setMarkers([
        { id: 'a', time: 0, shape: 'circle' },
        { id: 'a', time: 60, shape: 'circle' },
      ]),
    ).toThrow(/Duplicate/);
    expect(c.annotations.getMarkers()).toEqual([]);
  });

  it('updates and removes one marker by id', () => {
    const c = chart();
    c.annotations.setMarkers([
      { id: 'a', time: 600, shape: 'circle' },
      { id: 'b', time: 1200, shape: 'square', tooltip: ['one'] },
    ]);
    expect(c.annotations.updateMarker('b', { time: 300, color: '#ff0000' })).toBe(true);
    expect(c.annotations.getMarkers().map((m) => [m.id, m.time, m.color])).toEqual([
      ['b', 300, '#ff0000'],
      ['a', 600, undefined],
    ]);
    // Clearing a field with undefined removes it.
    c.annotations.updateMarker('b', { color: undefined });
    expect('color' in c.annotations.getMarkers()[0]!).toBe(false);
    expect(() => c.annotations.updateMarker('b', { position: 'atPrice' })).toThrow(/price/);
    expect(c.annotations.getMarkers()[0]!.position).toBeUndefined();
    expect(c.annotations.updateMarker('zz', { time: 0 })).toBe(false);
    expect(c.annotations.removeMarker('a')).toBe(true);
    expect(c.annotations.removeMarker('a')).toBe(false);
    expect(c.annotations.getMarkers().map((m) => m.id)).toEqual(['b']);
  });

  it('emits hover once per marker, with a copy, the series and a root point', () => {
    const c = chart();
    const series = c.panes[0]!.series[0]!;
    c.annotations.setMarkers([{ id: 'fill', time: 40 * 60, shape: 'arrow-right', position: 'atPrice', price: 100, tooltip: 'Bought 2' }]);
    const hovers: MarkerPointerEvent[] = [];
    const ends: MarkerLeaveEvent[] = [];
    c.on('marker:hover', (e) => hovers.push(e));
    c.on('marker:hover-end', (e) => ends.push(e));
    const p = at(c, 40, 100);
    const on = { x: p.x - 6, y: p.y };
    c.annotations.pointerMove(on);
    c.annotations.pointerMove({ x: on.x - 1, y: on.y });
    expect(hovers).toHaveLength(1);
    expect(hovers[0]!.marker).toMatchObject({ id: 'fill', price: 100 });
    expect(hovers[0]!.series).toBe(series);
    expect(hovers[0]!.point).toEqual({ x: on.x + c.plotLeft, y: on.y });
    expect(c.annotations.isHovering).toBe(true);
    hovers[0]!.marker.price = 1;
    expect(c.annotations.getMarkers()[0]!.price).toBe(100);
    c.annotations.pointerMove({ x: 5, y: 5 });
    expect(ends).toHaveLength(1);
    expect(ends[0]!.marker.id).toBe('fill');
  });

  it('shows the tooltip with the theme label colours', () => {
    const c = chart();
    c.annotations.setMarkers([{ time: 40 * 60, shape: 'circle', position: 'atPrice', price: 100, tooltip: ['Bought 2', 'at 100'] }]);
    c.annotations.pointerMove(at(c, 40, 100));
    const texts: string[] = [];
    const fills: unknown[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, key) => (key === 'fillText' ? (t: string) => texts.push(t) : () => {}),
        set: (_t, key, value) => {
          if (key === 'fillStyle') fills.push(value);
          return true;
        },
      },
    ) as CanvasRenderingContext2D;
    c.annotations.renderLabels(ctx);
    expect(texts).toEqual(['Bought 2', 'at 100']);
    expect(fills).toEqual([c.theme.labelBackground, c.theme.labelText]);
  });

  it('takes a press only while marker:click has listeners', () => {
    const c = chart();
    c.annotations.setMarkers([{ id: 'm', time: 40 * 60, shape: 'circle', position: 'atPrice', price: 100 }]);
    const p = at(c, 40, 100);
    expect(c.annotations.pointerDown(p)).toBe(false);
    c.annotations.pointerUp(p);
    expect(c.annotations.cursor(p)).toBeNull();
    const clicks: MarkerPointerEvent[] = [];
    c.on('marker:click', (e) => clicks.push(e));
    expect(c.annotations.cursor(p)).toBe('pointer');
    expect(c.annotations.pointerDown(p)).toBe(true);
    c.annotations.pointerUp(p);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.marker.id).toBe('m');
    // Moved too far: not a click.
    c.annotations.pointerDown(p);
    c.annotations.pointerUp({ x: p.x + 10, y: p.y });
    expect(clicks).toHaveLength(1);
  });

  it('lets lines and fills win over markers', () => {
    const c = chart();
    c.annotations.setMarkers([{ time: 40 * 60, shape: 'circle', position: 'atPrice', price: 100 }]);
    c.annotations.setTrades([{ id: 't', time: 40 * 60, side: 'buy', price: 100, quantity: 1 }]);
    const hovers = vi.fn();
    const trades = vi.fn();
    c.on('marker:hover', hovers);
    c.on('trade:hover', trades);
    c.annotations.pointerMove(at(c, 40, 100));
    expect(trades).toHaveBeenCalledTimes(1);
    expect(hovers).not.toHaveBeenCalled();
  });

  it('ends the hover when the hovered marker goes, and keeps it across a resend with the same id', () => {
    const c = chart();
    const m: BarMarker = { id: 'm', time: 40 * 60, shape: 'circle', position: 'atPrice', price: 100 };
    c.annotations.setMarkers([m]);
    const ends = vi.fn();
    c.on('marker:hover-end', ends);
    c.annotations.pointerMove(at(c, 40, 100));
    c.annotations.setMarkers([{ ...m, color: '#00ff00' }]);
    expect(ends).not.toHaveBeenCalled();
    c.annotations.updateMarker('m', { text: 'x' });
    expect(ends).not.toHaveBeenCalled();
    c.annotations.removeMarker('m');
    expect(ends).toHaveBeenCalledTimes(1);
    expect(c.annotations.isHovering).toBe(false);
  });

  it('clicking a marker neither pans nor starts a drawing; an active tool still wins', () => {
    const c = chart();
    c.annotations.setMarkers([{ id: 'm', time: 40 * 60, shape: 'circle', position: 'atPrice', price: 100 }]);
    const clicks = vi.fn();
    c.on('marker:click', clicks);
    const p = at(c, 40, 100);
    const x = p.x + c.plotLeft;
    const offset = c.time.rightOffset;
    dispatch(c.root, 'pointerdown', { clientX: x, clientY: p.y });
    dispatch(c.root, 'pointermove', { clientX: x + 60, clientY: p.y });
    dispatch(c.root, 'pointerup', { clientX: x + 60, clientY: p.y });
    expect(c.time.rightOffset).toBe(offset);
    expect(c.drawings.getAll()).toHaveLength(0);
    dispatch(c.root, 'pointerdown', { clientX: x, clientY: p.y });
    dispatch(c.root, 'pointerup', { clientX: x, clientY: p.y });
    expect(clicks).toHaveBeenCalledTimes(1);

    c.drawings.setTool('hline');
    dispatch(c.root, 'pointerdown', { clientX: x, clientY: p.y });
    dispatch(c.root, 'pointerup', { clientX: x, clientY: p.y });
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(c.drawings.getAll().length).toBeGreaterThan(0);
  });

  it('without a click listener a press on a marker pans', () => {
    const c = chart();
    c.annotations.setMarkers([{ time: 40 * 60, shape: 'circle', position: 'atPrice', price: 100 }]);
    const p = at(c, 40, 100);
    const x = p.x + c.plotLeft;
    const offset = c.time.rightOffset;
    dispatch(c.root, 'pointerdown', { clientX: x, clientY: p.y });
    dispatch(c.root, 'pointermove', { clientX: x + 60, clientY: p.y });
    dispatch(c.root, 'pointerup', { clientX: x + 60, clientY: p.y });
    expect(c.time.rightOffset).not.toBe(offset);
  });
});
