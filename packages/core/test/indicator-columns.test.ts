import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { IndicatorDef } from '../src/indicators/types';
import type { IndicatorRunner } from '../src/indicators/runner';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const avg: IndicatorDef = {
  id: 'avg',
  name: 'Avg',
  placement: 'overlay',
  inputs: [],
  plots: [{ id: 'v', type: 'line' }],
  compute: (src) => ({ v: Float64Array.from(src.close) }),
  update: (src, _inputs, i, out) => {
    out.v![i] = src.close[i]!;
  },
};

const bars = (from: number, to: number): Bar[] =>
  Array.from({ length: to - from }, (_, k) => {
    const close = 100 + Math.sin(from + k);
    return { time: (from + k) * 60, open: close, high: close + 1, low: close - 1, close, volume: 10 };
  });

function chart(indicators: number) {
  const c = new Chart(fakeContainer());
  charts.push(c);
  const main = c.addCandles();
  main.setData(bars(0, 300));
  for (let k = 0; k < indicators; k++) c.indicators.add(avg);
  return { c, main };
}

const runners = (c: Chart): IndicatorRunner[] => c.indicators.runners();
/** The storage behind each runner's bar columns. */
const storage = (c: Chart) => new Set(runners(c).flatMap((r) => [r.src.time.buffer, r.src.close.buffer]));

describe('shared indicator bar columns', () => {
  it('keeps one copy of the bars for every indicator', () => {
    const { c } = chart(4);
    expect(runners(c)).toHaveLength(4);
    // Time and close columns: one buffer each, whatever the number of indicators.
    expect(storage(c).size).toBe(2);
    for (const r of runners(c)) expect(Array.from(r.src.close)).toEqual(bars(0, 300).map((b) => b.close));
  });

  it('writes appended and ticking bars once and keeps every indicator in step', () => {
    const { c, main } = chart(3);
    main.update(bars(300, 301)[0]!);
    main.update({ ...bars(300, 301)[0]!, close: 7 });
    for (const r of runners(c)) {
      expect(r.length).toBe(301);
      expect(r.src.close[300]).toBe(7);
      expect(r.out.v![300]).toBe(7);
    }
    expect(storage(c).size).toBe(2);
  });

  it('reuses the columns across history pages, growing them only a few times', () => {
    const { c, main } = chart(3);
    const seen = new Set<ArrayBufferLike>();
    for (let page = 1; page <= 10; page++) {
      // A history page: 500 older bars in front of the ones loaded.
      main.setData(bars(-500 * page, 300));
      expect(storage(c).size).toBe(2);
      seen.add(runners(c)[0]!.src.close.buffer);
      for (const r of runners(c)) {
        expect(r.length).toBe(300 + 500 * page);
        expect(r.src.time[0]).toBe(-500 * page * 60);
        expect(r.out.v![0]).toBe(r.src.close[0]);
      }
    }
    // 800 to 5,300 bars with doubling growth: four buffers (1k, 2k, 4k, 8k bars), not ten.
    expect(seen.size).toBeLessThanOrEqual(4);
  });

  it('frees the columns when the last indicator goes, and fills them again for the next', () => {
    const { c } = chart(2);
    const host = (c.indicators as unknown as { host: { barColumns: { length: number } } }).host;
    const [a, b] = c.indicators.getAll();
    c.indicators.remove(a!);
    expect(host.barColumns.length).toBe(300);
    c.indicators.remove(b!);
    expect(host.barColumns.length).toBe(0);
    c.indicators.add(avg);
    expect(runners(c)[0]!.length).toBe(300);
  });

  it('adds an indicator without rewriting the columns', () => {
    const { c } = chart(2);
    const before = runners(c)[0]!.src.close.buffer;
    const write = vi.spyOn(Float64Array.prototype, 'set');
    c.indicators.add(avg);
    expect(runners(c)[2]!.src.close.buffer).toBe(before);
    // Only the new indicator's outputs are copied in, no bar columns.
    expect(write.mock.calls.filter(([source]) => (source as ArrayLike<number>).length >= 300)).toHaveLength(1);
    write.mockRestore();
  });
});
