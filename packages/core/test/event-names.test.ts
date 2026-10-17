/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import chartSource from '../src/chart.ts?raw';
import dataSource from '../src/data/types.ts?raw';
import indicatorSource from '../src/indicators/manager.ts?raw';
import drawingSource from '../src/drawing/manager.ts?raw';
import baselineSource from '../src/baseline-handle.ts?raw';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

/** Keys of `name` in `source`. */
function eventKeys(source: string, name: string): string[] {
  const body = new RegExp(`export interface ${name}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1] ?? '';
  return [...body.matchAll(/^ {2}'?([\w:-]+)'?\??:/gm)].map((m) => m[1]!);
}

describe('event names', () => {
  it('follow noun:verb', () => {
    const keys = [
      ...eventKeys(chartSource, 'ChartEvents'),
      ...eventKeys(dataSource, 'DataEvents'),
      ...eventKeys(indicatorSource, 'IndicatorEvents'),
      ...eventKeys(drawingSource, 'DrawingEvents'),
      ...eventKeys(baselineSource, 'BaselineEvents'),
    ];
    expect(keys.length).toBeGreaterThan(40);
    expect(keys.filter((k) => !/^[a-z]+:[a-z-]+$/.test(k))).toEqual([]);
  });

  it('carry the visible time range on view:change', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles({ animate: false }).setData(Array.from({ length: 30 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    const seen = vi.fn();
    c.on('view:change', seen);
    c.invalidate();
    (c as unknown as { render(dt: number): boolean }).render(0);
    const range = c.getVisibleRange()!;
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ from: range.from, to: range.to }));
  });
});
