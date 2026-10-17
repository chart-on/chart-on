import { afterEach, describe, expect, it } from 'vitest';
import { changeDevicePixelRatio, fakeContainer } from './fake-dom';
import { Chart, type ChartOptions } from '../src/chart';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  changeDevicePixelRatio(1);
});

function chart(options: Partial<ChartOptions> = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  return c;
}

const glCanvas = (c: Chart) => (c as unknown as { glCanvas: { width: number; height: number } }).glCanvas;

describe('focusable', () => {
  it('puts the chart in the Tab order by default, and out with false', () => {
    expect(chart().root.tabIndex).toBe(0);
    const c = chart({ focusable: false });
    expect(c.root.tabIndex).toBe(-1);
    c.applyOptions({ focusable: true });
    expect(c.root.tabIndex).toBe(0);
    c.applyOptions({ crosshair: { mode: 'free' } });
    expect(c.root.tabIndex).toBe(0);
  });
});

describe('maxGlDpr', () => {
  it('resizes the GL canvas when changed later', () => {
    changeDevicePixelRatio(2);
    const c = chart();
    // The fake container is 800 × 600 css px.
    expect(glCanvas(c)).toMatchObject({ width: 1600, height: 1200 });
    c.applyOptions({ maxGlDpr: 1 });
    expect(glCanvas(c)).toMatchObject({ width: 800, height: 600 });
  });
});
