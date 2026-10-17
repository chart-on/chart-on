import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars: Bar[] = Array.from({ length: 200 }, (_, i) => ({ time: i * 60, open: 100, high: 105, low: 95, close: 101 }));
const frame = (c: Chart) => {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
};
const button = (c: Chart) =>
  (c.root as unknown as { children: HTMLButtonElement[] }).children.find((e) => e.className === 'pc-scroll-realtime')!;

describe('scroll-to-newest button', () => {
  it('leaves the Tab order and the accessibility tree while hidden', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles({ title: 'ABC' }).setData(bars);
    frame(c);
    const b = button(c);
    expect([b.tabIndex, b.inert]).toEqual([-1, true]);
    c.setVisibleIndexRange(20, 80, false);
    frame(c);
    expect([b.tabIndex, b.inert]).toEqual([0, false]);
    c.scrollToRealtime(false);
    frame(c);
    expect([b.tabIndex, b.inert]).toEqual([-1, true]);
  });

  it('hands focus to the chart when it hides while focused', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles({ title: 'ABC' }).setData(bars);
    c.setVisibleIndexRange(20, 80, false);
    frame(c);
    const b = button(c);
    expect(b.tabIndex).toBe(0);
    b.focus();
    c.scrollToRealtime(false);
    frame(c);
    expect(b.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(c.root);
  });
});
