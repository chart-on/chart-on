import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type SeriesHoverEvent } from '../src/chart';
import { pointDiameter, type PointItem, type PointSeriesOptions } from '../src/points';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  for (const c of charts.splice(0)) c.destroy();
});

const bar = (i: number): Bar => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 });

function setup(options: Partial<PointSeriesOptions> = {}) {
  const c = new Chart(fakeContainer());
  charts.push(c);
  const main = c.addCandles({ animate: false });
  main.setData(Array.from({ length: 10 }, (_, i) => bar(i)));
  const points = c.addPoints(options);
  return { c, main, points };
}

function render(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
}

describe('pointDiameter', () => {
  const base = { size: 6 };

  it('uses the series size for items without a usable size', () => {
    expect(pointDiameter(-1, base, [0, 0])).toBe(6);
    expect(pointDiameter(-1, { ...base, sizeBy: { min: 2, max: 20 } }, [0, 10])).toBe(6);
  });

  it('reads item sizes as css px without sizeBy', () => {
    expect(pointDiameter(14, base, [0, 100])).toBe(14);
  });

  it('maps linearly across the domain and clamps outside it', () => {
    const o = { ...base, sizeBy: { min: 4, max: 24, scale: 'linear' as const } };
    expect(pointDiameter(0, o, [0, 10])).toBe(4);
    expect(pointDiameter(5, o, [0, 10])).toBe(14);
    expect(pointDiameter(10, o, [0, 10])).toBe(24);
    expect(pointDiameter(-0, o, [2, 10])).toBe(4);
    expect(pointDiameter(50, o, [0, 10])).toBe(24);
  });

  it('makes area track the quantity with sqrt (the default)', () => {
    const o = { ...base, sizeBy: { min: 0, max: 20 } };
    // A quarter of the quantity is half the diameter, so a quarter of the area.
    expect(pointDiameter(25, o, [0, 100])).toBeCloseTo(10);
    expect(pointDiameter(100, o, [0, 100])).toBeCloseTo(20);
  });

  it('prefers an explicit domain and treats a single-value domain as the largest', () => {
    const o = { ...base, sizeBy: { min: 2, max: 10, domain: [0, 4] as [number, number], scale: 'linear' as const } };
    expect(pointDiameter(2, o, [0, 1000])).toBe(6);
    expect(pointDiameter(7, { ...base, sizeBy: { min: 2, max: 10 } }, [7, 7])).toBe(10);
  });
});

describe('PointSeries data', () => {
  it('keeps the order of items that share a time', () => {
    const { points } = setup();
    const items: PointItem[] = [
      { time: 60, value: 101 },
      { time: 120, value: 102 },
      { time: 120, value: 103 },
      { time: 120, value: 104 },
    ];
    points.setData(items);
    expect(points.data.map((p) => p.value)).toEqual([101, 102, 103, 104]);
    points.update({ time: 120, value: 105 });
    expect(points.data.map((p) => p.value)).toEqual([101, 102, 103, 104, 105]);
  });

  it('sorts stably with normalize and throws on unsorted times without it', () => {
    const { points } = setup();
    const items: PointItem[] = [
      { time: 180, value: 1 },
      { time: 60, value: 2 },
      { time: 180, value: 3 },
      { time: 60, value: 4 },
    ];
    expect(() => points.setData(items)).toThrow(/ascending/);
    points.setData(items, { normalize: true });
    expect(points.data.map((p) => p.value)).toEqual([2, 4, 1, 3]);
  });

  it('drops points older than the newest and leaves out points without a value', () => {
    const { c, points } = setup();
    const dropped = vi.fn();
    c.on('data:dropped', dropped);
    points.setData([{ time: 120, value: 1 }, { time: 180, value: Number.NaN }]);
    expect(points.data).toHaveLength(1);
    points.update({ time: 60, value: 2 });
    expect(points.data).toHaveLength(1);
    expect(dropped).toHaveBeenCalledTimes(1);
  });

  it('places items at their exact time, between bars and past the last one', () => {
    const { points } = setup();
    points.setData([{ time: 90, value: 100 }, { time: 540, value: 100 }, { time: 600, value: 100 }]);
    expect(points.positionOf(0)).toBeCloseTo(1.5);
    expect(points.positionOf(1)).toBe(9);
    expect(points.positionOf(2)).toBe(10);
  });

  it('moves points past the last bar onto a newly appended bar without rewriting the others', () => {
    const { main, points } = setup();
    points.setData([{ time: 30, value: 100 }, { time: 630, value: 100 }]);
    const write = vi.spyOn(points.batch, 'setPoint');
    main.update(bar(10));
    expect(write.mock.calls.map((call) => call[0])).toEqual([1]);
    // Bar 10 sits at 600 s: 630 s is half a bar past it, as before.
    expect(points.positionOf(1)).toBeCloseTo(10.5);
  });
});

describe('PointSeries drawing', () => {
  it('uploads once: panning changes uniforms and the drawn span only', () => {
    const { c, points } = setup();
    points.setData(Array.from({ length: 1000 }, (_, i) => ({ time: i * 0.54, value: 100 + (i % 7), size: i % 13 })));
    render(c);
    expect(points.batch.dirtyFrom).toBe(Infinity);
    const write = vi.spyOn(points.batch, 'setPoint');
    c.time.rightOffset = 3;
    render(c);
    expect(write).not.toHaveBeenCalled();
    expect(points.batch.dirtyFrom).toBe(Infinity);
  });

  it('widens the size domain on update without rewriting earlier points', () => {
    const { points } = setup({ sizeBy: { min: 2, max: 20 } });
    points.setData([{ time: 0, value: 100, size: 5 }, { time: 60, value: 100, size: 10 }]);
    expect(points.sizeDomain).toEqual([5, 10]);
    const write = vi.spyOn(points.batch, 'setPoint');
    points.update({ time: 120, value: 100, size: 40 });
    expect(points.sizeDomain).toEqual([5, 40]);
    expect(write.mock.calls.map((call) => call[0])).toEqual([2]);
  });

  it('autoscales over the visible points', () => {
    const { points } = setup();
    points.setData([{ time: 0, value: 50 }, { time: 120, value: 150 }, { time: 120, value: 120 }, { time: 540, value: 300 }]);
    expect(points.priceRange(1, 3)).toEqual([120, 150]);
    expect(points.priceRange(0, 9)).toEqual([50, 300]);
    expect(points.priceRange(5, 6)).toBeNull();
  });

  it('shows the newest value and the point count of the bar in the legend', () => {
    const { points } = setup({ title: 'Trades' });
    points.setData([{ time: 100, value: 101 }, { time: 120, value: 102 }, { time: 130, value: 103 }]);
    const entry = points.legend(2);
    expect(entry.parts[0]!.text).toBe(points.formatValue(103));
    expect(entry.parts[1]).toEqual({ label: 'N', text: '3' });
    expect(points.legend(5).parts).toEqual([]);
  });
});

describe('PointSeries hit testing', () => {
  function at(c: Chart, index: number, price: number, scale = c.panes[0]!.scale('right')) {
    return [c.plotLeft + c.time.indexToX(index), c.panes[0]!.top + scale.priceToY(price)] as const;
  }

  it('finds the nearest marker within its radius', () => {
    const { c, main, points } = setup({ size: 10 });
    main.setVisible(false);
    points.setData([{ time: 120, value: 100 }, { time: 150, value: 100 }]);
    render(c);
    const [x, y] = at(c, 2, 100);
    expect(c.seriesAt(x, y)).toBe(points);
    const spacing = c.time.barSpacing;
    expect(points.itemAt(c.time.indexToX(2) + spacing * 0.4, y - c.panes[0]!.top, viewOf(c, points))).toBe(1);
    expect(points.itemAt(c.time.indexToX(2) - 1, y - c.panes[0]!.top, viewOf(c, points))).toBe(0);
    // Far from both markers.
    expect(c.seriesAt(x, y - 40)).toBeNull();
  });

  it('hits the later of two markers at the same place, as drawn on top', () => {
    const { c, main, points } = setup();
    main.setVisible(false);
    points.setData([{ time: 120, value: 100 }, { time: 120, value: 100 }]);
    render(c);
    const [x, y] = at(c, 2, 100);
    expect(points.itemAt(x - c.plotLeft, y - c.panes[0]!.top, viewOf(c, points))).toBe(1);
  });

  it('counts sized markers by their diameter', () => {
    const { c, main, points } = setup({ sizeBy: { min: 4, max: 40, scale: 'linear' } });
    main.setVisible(false);
    points.setData([{ time: 120, value: 100, size: 1 }, { time: 300, value: 100, size: 2 }]);
    render(c);
    const [x, y] = at(c, 5, 100);
    // 15 px above the big marker's centre: inside its 20 px radius.
    expect(c.seriesAt(x, y - 15)).toBe(points);
    const [x2, y2] = at(c, 2, 100);
    expect(c.seriesAt(x2, y2 - 15)).toBeNull();
  });

  it('reports the hovered item and emits again when it changes within the series', () => {
    const { c, main, points } = setup({ size: 10 });
    main.setVisible(false);
    points.setData([{ time: 60, value: 100 }, { time: 300, value: 100 }]);
    render(c);
    const events: SeriesHoverEvent[] = [];
    c.on('series:hover', (e) => events.push(e));
    const hover = (index: number) => {
      const [x, y] = at(c, index, 100);
      c.updateHover({ x: x - c.plotLeft, y });
    };
    hover(1);
    hover(1);
    hover(5);
    c.updateHover(null);
    expect(events.map((e) => [e.series, e.item])).toEqual([
      [points, points.data[0]],
      [points, points.data[1]],
      [null, undefined],
    ]);
  });
});

function viewOf(c: Chart, points: { scale: { priceToY(p: number): number } }) {
  return {
    indexToX: (i: number) => c.time.indexToX(i),
    xToIndex: (x: number) => c.time.xToIndex(x),
    priceToY: (p: number) => points.scale.priceToY(p),
  };
}
