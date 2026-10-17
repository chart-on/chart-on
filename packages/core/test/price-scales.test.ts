import { describe, expect, it } from 'vitest';
import { Pane, axisColumns, visibleAxes } from '../src/pane';
import { PriceScale } from '../src/scales';
import { LineSeries, type LineSeriesOptions, type SeriesHost } from '../src/series';
import { darkTheme } from '../src/theme';
import { Timeline } from '../src/timeline';
import { spreadLabels } from '../src/util/labels';

function scale(options: Partial<PriceScale> = {}): PriceScale {
  const s = new PriceScale({ marginTop: 0, marginBottom: 0 });
  s.height = 100;
  Object.assign(s, options);
  s.fit(0, 100);
  return s;
}

describe('inverted price scale', () => {
  it('puts higher prices lower down', () => {
    const s = scale({ invert: true });
    expect(s.priceToY(100)).toBeCloseTo(100);
    expect(s.priceToY(0)).toBeCloseTo(0);
    expect(s.priceToY(25)).toBeCloseTo(25);
    expect(s.yToPrice(25)).toBeCloseTo(25);
  });

  it('keeps the GPU transform consistent with priceToY', () => {
    for (const invert of [false, true]) {
      const s = scale({ invert });
      const [k, offset] = s.yTransform();
      for (const p of [0, 30, 100]) expect(p * k + offset).toBeCloseTo(s.priceToY(p));
    }
  });

  it('keeps screen margins: the top margin stays above the lowest price', () => {
    const s = new PriceScale({ marginTop: 0.2, marginBottom: 0 });
    s.height = 100;
    s.invert = true;
    s.fit(0, 80);
    expect(s.priceToY(0)).toBeCloseTo(20);
    expect(s.priceToY(80)).toBeCloseTo(100);
  });

  it('pans and zooms in screen direction', () => {
    const s = scale({ invert: true });
    s.pan(10); // content moves down
    expect(s.priceToY(50)).toBeCloseTo(60);
    const z = scale({ invert: true });
    z.zoom(2, 25);
    expect(z.priceToY(z.yToPrice(25))).toBeCloseTo(25);
    expect(z.yToPrice(25)).toBeCloseTo(25);
  });
});

describe('indexed price scale', () => {
  it('indexes prices to 100 at the base', () => {
    const s = scale({ mode: 'indexed', percentBase: 50 });
    expect(s.toIndexed(50)).toBe(100);
    expect(s.toIndexed(75)).toBe(150);
    expect(s.fromIndexed(150)).toBe(75);
    // Drawn like a normal scale.
    expect(s.priceToY(50)).toBeCloseTo(50);
  });
});

describe('scale ids and sides', () => {
  it('default to the right scale', () => {
    const s = new PriceScale({ marginTop: 0, marginBottom: 0 });
    expect(s.id).toBe('right');
    expect(s.side).toBe('right');
    const left = new PriceScale({ marginTop: 0, marginBottom: 0, id: 'left', side: 'left' });
    expect(left.side).toBe('left');
  });
});

describe('spreadLabels', () => {
  it('leaves labels that do not collide', () => {
    expect(spreadLabels([10, 50, 90], 16, 0, 100)).toEqual([10, 50, 90]);
  });

  it('spreads a collision evenly around the wanted positions', () => {
    const out = spreadLabels([50, 52], 16, 0, 100);
    expect(out[1]! - out[0]!).toBeCloseTo(16);
    expect((out[0]! + out[1]!) / 2).toBeCloseTo(51);
  });

  it('keeps input order and merges chains of collisions', () => {
    const out = spreadLabels([60, 40, 50], 16, 0, 200);
    expect(out[1]! < out[2]! && out[2]! < out[0]!).toBe(true);
    expect(out[2]! - out[1]!).toBeCloseTo(16);
    expect(out[0]! - out[2]!).toBeCloseTo(16);
    expect(out[2]).toBeCloseTo(50);
  });

  it('stays inside the bounds when the labels fit', () => {
    const top = spreadLabels([0, 1], 16, 0, 100);
    expect(top).toEqual([0, 16]);
    const bottom = spreadLabels([100, 99], 16, 0, 100);
    expect(bottom[0]).toBeCloseTo(100);
    expect(bottom[1]).toBeCloseTo(84);
  });

  it('keeps clear of taller labels above', () => {
    // The first label is 40 tall, so the next centre sits at least 40 below it.
    const out = spreadLabels([50, 55], [40, 16], 0, 200);
    expect(out[1]! - out[0]!).toBeCloseTo(40);
    // Centred on what they want: the group's top is the mean of 50 and 55 - 40.
    expect(out[0]).toBeCloseTo(32.5);
  });

  it('handles no labels', () => {
    expect(spreadLabels([], 16, 0, 100)).toEqual([]);
  });
});

const host: SeriesHost = {
  timeline: new Timeline(),
  theme: darkTheme,
  maxTextureSize: 4096,
  mainDataChanged: () => {},
  mainLastBarChanged: () => {},
  requestRender: () => {},
};

function lineOn(pane: Pane, options: Partial<LineSeriesOptions> = {}): LineSeries {
  const s = new LineSeries(host, pane, { title: '', lineWidth: 1, area: false, format: String, lastValueLabel: true, ...options });
  pane.series.push(s);
  return s;
}

const newPane = () => new Pane(0, { stretch: 1, marginTop: 0.1, marginBottom: 0.1 });

describe('scale assignment', () => {
  it('puts series on the right scale by default and on named scales by id', () => {
    const pane = newPane();
    const right = lineOn(pane);
    const left = lineOn(pane, { priceScale: 'left' });
    const custom = lineOn(pane, { priceScale: 'volume' });
    const overlay = lineOn(pane, { priceScale: 'left', overlay: { top: 0.8, bottom: 0 } });
    expect(right.scale).toBe(pane.price);
    expect(left.scale).toBe(pane.scale('left'));
    expect(left.scale.side).toBe('left');
    expect(custom.scale.side).toBe('none');
    expect(custom.scale).not.toBe(pane.price);
    expect(overlay.scale).toBe(overlay.overlayScale);
    // New scales start with the pane's margins.
    expect(left.scale.marginTop).toBe(0.1);
  });

  it('follows priceScale changes', () => {
    const pane = newPane();
    const s = lineOn(pane);
    s.applyOptions({ priceScale: 'left' });
    expect(s.scale).toBe(pane.scale('left'));
  });

  it('lists scales right first, then in creation order', () => {
    const pane = newPane();
    pane.scale('b');
    pane.scale('a');
    expect(pane.scales.map((s) => s.id)).toEqual(['right', 'b', 'a']);
  });
});

describe('visible axes', () => {
  it('show scales with a side and a visible series, left first', () => {
    const pane = newPane();
    lineOn(pane);
    lineOn(pane, { priceScale: 'left' });
    lineOn(pane, { priceScale: 'other' });
    expect(visibleAxes(pane).map((s) => s.id)).toEqual(['left', 'right']);
    pane.scale('other').side = 'right';
    expect(visibleAxes(pane).map((s) => s.id)).toEqual(['left', 'right', 'other']);
  });

  it('hide a scale when everything on it is hidden', () => {
    const pane = newPane();
    lineOn(pane);
    const left = lineOn(pane, { priceScale: 'left' });
    left.setVisible(false);
    expect(visibleAxes(pane).map((s) => s.id)).toEqual(['right']);
  });

  it('keep the right axis on an empty pane or one with only overlays', () => {
    const pane = newPane();
    expect(visibleAxes(pane)).toEqual([pane.price]);
    lineOn(pane, { priceScale: 'volume' });
    expect(visibleAxes(pane)).toEqual([pane.price]);
  });

  it('drop the right axis when only a left scale is used', () => {
    const pane = newPane();
    lineOn(pane, { priceScale: 'left' });
    expect(visibleAxes(pane).map((s) => s.id)).toEqual(['left']);
  });

  it('let the default scale hide its axis with side none', () => {
    const pane = newPane();
    lineOn(pane);
    pane.price.side = 'none';
    expect(visibleAxes(pane)).toEqual([]);
  });

  it('pick the primary scale for drawings and pointer prices', () => {
    const pane = newPane();
    const left = lineOn(pane, { priceScale: 'left' });
    expect(pane.primary).toBe(left.scale);
    lineOn(pane);
    expect(pane.primary).toBe(pane.price);
    const empty = newPane();
    expect(empty.primary).toBe(empty.price);
  });

  it('size the axis columns by the busiest pane on each side', () => {
    const a = newPane();
    lineOn(a, { priceScale: 'left' });
    lineOn(a);
    const b = newPane();
    lineOn(b);
    lineOn(b, { priceScale: 'x' });
    b.scale('x').side = 'right';
    expect(axisColumns([a, b])).toEqual({ left: 1, right: 2 });
    expect(axisColumns([newPane()])).toEqual({ left: 0, right: 1 });
  });
});
