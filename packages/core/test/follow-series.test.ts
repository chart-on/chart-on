import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { volumeOf } from '../src/series';
import { darkTheme } from '../src/theme';
import { withAlpha } from '../src/util/color';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  return c;
}

const bar = (i: number, close = 10 + i, volume = 100 + i): Bar => ({ time: i * 60, open: 10 + i, high: close + 1, low: 5, close, volume });
const bars = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => bar(from + k));
const values = (data: readonly { value: number }[]) => data.map((p) => p.value);
const times = (data: readonly { time: number }[]) => data.map((p) => p.time);

describe('volumeOf', () => {
  it('colors by close against the previous close, or the open for the first bar', () => {
    const up = withAlpha(darkTheme.up, 0.5);
    const down = withAlpha(darkTheme.down, 0.5);
    expect(volumeOf(bar(1, 12), bar(0, 11), darkTheme)).toEqual({ time: 60, value: 101, color: up });
    expect(volumeOf(bar(1, 10), bar(0, 11), darkTheme).color).toBe(down);
    expect(volumeOf({ ...bar(0), volume: undefined, open: 11, close: 10 }, undefined, darkTheme)).toMatchObject({ value: 0, color: down });
  });
});

describe('following series', () => {
  it('maps the initial load, and series added after the data', () => {
    const c = chart();
    const main = c.addCandles();
    const before = c.addHistogram({ follow: volumeOf });
    main.setData(bars(0, 5));
    expect(values(before.data)).toEqual([100, 101, 102, 103, 104]);
    const after = c.addLine({ follow: (b) => ({ time: b.time, value: b.close * 2 }) });
    expect(values(after.data)).toEqual([20, 22, 24, 26, 28]);
  });

  it('replaces the forming bar in place without rebuilding', () => {
    const c = chart();
    const main = c.addCandles();
    main.setData(bars(0, 5));
    const volume = c.addHistogram({ follow: volumeOf });
    const data = volume.data;
    const first = data[0];
    const rebuild = vi.spyOn(volume, 'rebuild');
    main.update({ ...bar(4), volume: 999 });
    expect(volume.data).toBe(data);
    expect(data[0]).toBe(first);
    expect(values(data)).toEqual([100, 101, 102, 103, 999]);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('appends on a new bar', () => {
    const c = chart();
    const main = c.addCandles();
    main.setData(bars(0, 3));
    const volume = c.addHistogram({ follow: volumeOf });
    main.update(bar(3));
    expect(times(volume.data)).toEqual([0, 60, 120, 180]);
    expect(values(volume.data).at(-1)).toBe(103);
  });

  it('keeps values across a history prepend and resets on a symbol switch', () => {
    const c = chart();
    const main = c.addCandles();
    main.setData(bars(5, 10));
    const volume = c.addHistogram({ follow: volumeOf });
    main.setData([...bars(0, 5), ...bars(5, 10)]);
    expect(values(volume.data)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    main.setData([bar(0, 50, 7), bar(1, 51, 8)]);
    expect(values(volume.data)).toEqual([7, 8]);
  });

  it('leaves out bars the mapper returns null for, and drops the forming one when it does', () => {
    const c = chart();
    const main = c.addCandles();
    main.setData(bars(0, 4));
    const odd = c.addLine({ follow: (b) => ((b.volume ?? 0) % 2 ? { time: b.time, value: b.volume! } : null) });
    expect(values(odd.data)).toEqual([101, 103]);
    main.update({ ...bar(3), volume: 200 });
    expect(values(odd.data)).toEqual([101]);
  });

  it('maps again when the theme changes', () => {
    const c = chart();
    c.addCandles().setData(bars(0, 2));
    const volume = c.addHistogram({ follow: volumeOf });
    c.applyOptions({ theme: { up: '#000000' } });
    expect(volume.data[1]!.color).toBe(withAlpha('#000000', 0.5));
  });

  it('works for custom series', () => {
    const c = chart();
    const main = c.addCandles();
    const custom = c.addCustomSeries(
      { type: 'range', draw() {}, priceRange: () => null },
      { follow: (b: Bar) => ({ time: b.time, low: b.low, high: b.high }) },
    );
    main.setData(bars(0, 3));
    expect(custom.data).toEqual([
      { time: 0, low: 5, high: 11 },
      { time: 60, low: 5, high: 12 },
      { time: 120, low: 5, high: 13 },
    ]);
  });
});

describe('following series: option changes and main removal', () => {
  it('maps the main bars when follow is set, swapped or removed later', () => {
    const c = chart();
    c.addCandles().setData(bars(0, 3));
    const line = c.addLine();
    expect(line.data).toEqual([]);
    line.applyOptions({ follow: (b) => ({ time: b.time, value: b.close }) });
    expect(values(line.data)).toEqual([10, 11, 12]);
    line.applyOptions({ follow: (b) => ({ time: b.time, value: b.high }) });
    expect(values(line.data)).toEqual([11, 12, 13]);
    line.applyOptions({ follow: undefined });
    expect(line.data).toEqual([]);
    expect(line.priceRange(0, 2)).toBeNull();
  });

  it('leaves the data of a series that never followed alone', () => {
    const c = chart();
    c.addCandles().setData(bars(0, 3));
    const line = c.addLine();
    line.setData([{ time: 0, value: 5 }]);
    line.applyOptions({ follow: undefined, color: '#ff0000' });
    expect(values(line.data)).toEqual([5]);
  });

  it('keeps the old mapper and points when a new mapper is bad', () => {
    const c = chart();
    c.addCandles().setData(bars(0, 3));
    const follow = (b: Bar) => ({ time: b.time, value: b.close });
    const line = c.addLine({ follow });
    expect(() => line.applyOptions({ follow: (b) => ({ time: b.time + 1, value: 0 }) })).toThrow(/differs from bar time/);
    expect(line.options.follow).toBe(follow);
    expect(values(line.data)).toEqual([10, 11, 12]);
  });

  it('empties followers when the main series is removed, and follows the next one', () => {
    const c = chart();
    const main = c.addCandles();
    main.setData(bars(0, 3));
    const volume = c.addHistogram({ follow: volumeOf });
    c.removeSeries(main);
    expect(volume.data).toEqual([]);
    expect(volume.priceRange(0, 10)).toBeNull();
    expect(volume.legend(0).parts).toEqual([]);
    c.addCandles().setData(bars(0, 2));
    expect(values(volume.data)).toEqual([100, 101]);
  });
});

describe('following series: bad mappers', () => {
  const shifted = (b: Bar) => ({ time: b.time + 1, value: b.close });

  it('throws a clear error on a load whose point time differs from the bar, after the others are mapped', () => {
    const c = chart();
    const main = c.addCandles();
    const bad = c.addLine({ follow: (b) => (b.time >= 120 ? shifted(b) : { time: b.time, value: b.close }) });
    const volume = c.addHistogram({ follow: volumeOf });
    expect(() => main.setData(bars(0, 4))).toThrow(/Line follow: point time 121 differs from bar time 120/);
    expect(values(volume.data)).toEqual([100, 101, 102, 103]);
    expect(volume.priceRange(0, 3)).toEqual([0, 103]);
    expect(bad.data).toEqual([]);
  });

  it('refuses a follower whose mapper is bad on attach', () => {
    const c = chart();
    c.addCandles().setData(bars(0, 2));
    expect(() => c.addLine({ follow: shifted })).toThrow(/differs from bar time/);
    expect(c.panes[0]!.series.filter((s) => s.kind === 'line')).toEqual([]);
  });

  it('reports a bad point on a tick or append and keeps the other followers running', () => {
    const c = chart();
    const main = c.addCandles();
    main.setData(bars(0, 3));
    let broken = false;
    const line = c.addLine({ follow: (b) => (broken ? shifted(b) : { time: b.time, value: b.close }) });
    const thrower = c.addLine({
      follow: (b) => {
        if (broken) throw new Error('boom');
        return { time: b.time, value: b.close };
      },
    });
    const volume = c.addHistogram({ follow: volumeOf });
    const errors: { series: unknown; hook: string; error: unknown }[] = [];
    c.on('series:error', (e) => errors.push(e));
    broken = true;
    expect(() => main.update({ ...bar(2), volume: 500 })).not.toThrow();
    expect(values(volume.data)).toEqual([100, 101, 500]);
    expect(values(line.data)).toEqual([10, 11, 12]);
    main.update(bar(3));
    expect(values(volume.data)).toEqual([100, 101, 500, 103]);
    expect(times(line.data)).toEqual([0, 60, 120]);
    expect(errors.map((e) => [e.series, e.hook])).toEqual([
      [line, 'follow'],
      [thrower, 'follow'],
      [line, 'follow'],
      [thrower, 'follow'],
    ]);
    expect(String(errors[0]!.error)).toMatch(/point time 121 differs from bar time 120/);
  });
});

describe('following series: forming bar on every series type', () => {
  it('replaces the forming point of a line in place', () => {
    const c = chart();
    const main = c.addCandles();
    main.setData(bars(0, 3));
    const line = c.addLine({ follow: (b) => ({ time: b.time, value: b.close }) });
    const rebuild = vi.spyOn(line, 'rebuild');
    main.update({ ...bar(2), close: 40 });
    expect(values(line.data)).toEqual([10, 11, 40]);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('drops the forming point of a line without rebuilding when the value turns null', () => {
    const c = chart();
    const main = c.addCandles();
    main.setData(bars(0, 3));
    const line = c.addLine({ follow: (b) => (b.close > 30 ? null : { time: b.time, value: b.close }) });
    const rebuild = vi.spyOn(line, 'rebuild');
    main.update({ ...bar(2), close: 40 });
    expect(values(line.data)).toEqual([10, 11]);
    expect(line.priceRange(0, 2)).toEqual([10, 11]);
    expect(line.legend(2).parts).toEqual([]);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('drops the forming column of a histogram without rebuilding when the value turns null', () => {
    const c = chart();
    const main = c.addCandles();
    main.setData(bars(0, 3));
    const volume = c.addHistogram({ follow: (b) => (b.volume === 0 ? null : volumeOf(b, undefined, darkTheme)) });
    const rebuild = vi.spyOn(volume, 'rebuild');
    main.update({ ...bar(2), volume: 0 });
    expect(values(volume.data)).toEqual([100, 101]);
    expect(volume.batch.count).toBe(2);
    expect(volume.priceRange(0, 2)).toEqual([0, 101]);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('replaces the forming item of a custom series in place', () => {
    const c = chart();
    const main = c.addCandles();
    main.setData(bars(0, 2));
    const custom = c.addCustomSeries(
      { type: 'range', draw() {}, priceRange: () => null },
      { follow: (b: Bar) => ({ time: b.time, low: b.low, high: b.high }) },
    );
    const rebuild = vi.spyOn(custom, 'rebuild');
    main.update({ ...bar(1), high: 99 });
    expect(custom.data.at(-1)).toEqual({ time: 60, low: 5, high: 99 });
    expect(rebuild).not.toHaveBeenCalled();
  });
});
