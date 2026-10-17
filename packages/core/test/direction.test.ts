import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.unstubAllGlobals();
});

const bars: Bar[] = Array.from({ length: 200 }, (_, i) => ({ time: i * 60, open: 100, high: 105, low: 95, close: 101 }));

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  c.addCandles({ title: 'ABC' }).setData(bars);
  return c;
}

interface El {
  className: string;
  children: El[];
  style: Record<string, string>;
}
const part = (c: Chart, name: string) => (c.root as unknown as El).children.find((e) => e.className === name)!;
const frame = (c: Chart) => {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
};
const side = (c: Chart, pane = 0) => c.getPriceScaleOptions(pane)!.side;
/** Price axis space on each side. */
const axes = (c: Chart) => ({ left: c.plotLeft, right: c.width - c.plotLeft - c.plotWidth });

describe('chart direction', () => {
  it('keeps the main price axis on the right and the legend top left by default', () => {
    const c = chart();
    frame(c);
    expect(c.options.direction).toBe('auto');
    expect(c.legendSettings.position).toBe('top-start');
    expect(side(c)).toBe('right');
    expect(axes(c).left).toBe(0);
    expect(axes(c).right).toBeGreaterThan(0);
    expect(part(c, 'pc-legend').style).toMatchObject({ left: `${c.plotLeft + 10}px`, right: '' });
  });

  it('puts the main axis, the empty axis column and the buttons on the left in rtl, and the legend start on the right', () => {
    const c = chart({ direction: 'rtl' });
    c.addPane();
    frame(c);
    expect(side(c)).toBe('left');
    expect(side(c, 1)).toBe('left');
    expect(axes(c).right).toBe(0);
    expect(axes(c).left).toBeGreaterThan(0);
    expect(part(c, 'pc-legend').style).toMatchObject({ left: '', right: '10px', alignItems: 'flex-end' });
    expect(part(c, 'pc-pane-controls').style).toMatchObject({ left: `${c.plotLeft + 6}px`, right: '' });
    expect(part(c, 'pc-scroll-realtime').style.right).toBe('');
    expect(part(c, 'pc-scroll-realtime').style.left).not.toBe('');
  });

  it('keeps the physical legend corners where they say', () => {
    const c = chart({ direction: 'rtl', legend: { position: 'top-left' } });
    frame(c);
    expect(part(c, 'pc-legend').style).toMatchObject({ left: `${c.plotLeft + 10}px`, right: '' });
    c.applyOptions({ legend: { position: 'top-end' } });
    frame(c);
    expect(part(c, 'pc-legend').style).toMatchObject({ left: `${c.plotLeft + 10}px`, right: '' });
    c.applyOptions({ direction: 'ltr' });
    frame(c);
    expect(part(c, 'pc-legend').style.left).toBe('');
  });

  it('moves an end-corner legend below the pane buttons on the side they share', () => {
    const c = chart({ direction: 'rtl', legend: { position: 'top-end' } });
    c.addPane();
    frame(c);
    expect(parseFloat(part(c, 'pc-legend').style.top!)).toBeGreaterThan(c.panes[0]!.top + 6);
    c.applyOptions({ legend: { position: 'top-start' } });
    frame(c);
    expect(part(c, 'pc-legend').style.top).toBe(`${c.panes[0]!.top + 6}px`);
  });

  it('follows applyOptions, but not for a main scale the app gave a side', () => {
    const c = chart();
    c.addPane();
    c.setPriceScaleOptions({ side: 'right' }, 1);
    c.applyOptions({ direction: 'rtl' });
    expect(side(c)).toBe('left');
    expect(side(c, 1)).toBe('right');
    c.applyOptions({ direction: 'ltr' });
    expect(side(c)).toBe('right');
    c.setPriceScaleOptions({ side: 'right' }, 0);
    c.applyOptions({ direction: 'rtl' });
    expect(side(c)).toBe('right');
  });

  it("reads the container's computed direction in auto mode, on creation and on applyOptions", () => {
    let direction = 'rtl';
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', direction }));
    const c = chart();
    expect(side(c)).toBe('left');
    direction = 'ltr';
    c.applyOptions({});
    expect(side(c)).toBe('right');
    c.applyOptions({ direction: 'rtl' });
    expect(side(c)).toBe('left');
  });
});
