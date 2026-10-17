import { afterEach, describe, expect, it } from 'vitest';
import { countingWebgl2, fakeContainer, type CountingGl } from './fake-dom';
import { Chart } from '../src/chart';
import type { IndicatorDef } from '../src/indicators/types';
import type { HeatmapData } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
});

function setup(): { c: Chart; gl: CountingGl } {
  const gl = countingWebgl2();
  const c = new Chart(fakeContainer({ webgl: gl.context }));
  charts.push(c);
  c.addCandles().setData(times(20).map((time) => ({ time, open: 1, high: 2, low: 0, close: 1 })));
  return { c, gl };
}

function times(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i * 60);
}

/** Run one frame's scene work; frames never run on their own under the fake DOM. */
function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

const heatmap = (rows = 4): HeatmapData => ({
  times: times(20),
  priceStart: 0,
  priceStep: 0.5,
  rows,
  values: new Float32Array(rows * 20).fill(1),
});

const histogramDef: IndicatorDef = {
  id: 'bars',
  name: 'Bars',
  placement: 'pane',
  inputs: [],
  plots: [{ id: 'v', type: 'histogram' }],
  compute: (src) => ({ v: new Float64Array(src.length).fill(1) }),
};

/** `live` plus the heatmap program's VAO, which the renderer makes on the first heatmap draw and keeps. */
const withHeatmapProgram = (live: ReturnType<CountingGl['live']>) => ({ ...live, vertexArray: live.vertexArray + 1 });

describe('GPU objects of removed series', () => {
  it('a drawn histogram owns a VAO and buffer until it is removed', () => {
    const { c, gl } = setup();
    frame(c);
    const before = gl.live();
    const histogram = c.addHistogram();
    histogram.setData(times(20).map((time) => ({ time, value: 1 })));
    frame(c);
    expect(gl.live().vertexArray).toBe(before.vertexArray + 1);
    expect(gl.live().buffer).toBe(before.buffer + 1);
    c.removeSeries(histogram);
    expect(gl.live()).toEqual(before);
  });

  it('removing a candle series deletes its VAO and buffer', () => {
    const { c, gl } = setup();
    frame(c);
    const before = gl.live();
    const compare = c.addCandles();
    compare.setData(times(20).map((time) => ({ time, open: 1, high: 2, low: 0, close: 1 })));
    frame(c);
    expect(gl.live().vertexArray).toBe(before.vertexArray + 1);
    c.removeSeries(compare);
    expect(gl.live()).toEqual(before);
  });

  it('removing a heatmap deletes its value, level and colour textures', () => {
    const { c, gl } = setup();
    frame(c);
    const before = gl.live();
    const map = c.addHeatmap();
    map.setData(heatmap());
    frame(c);
    expect(gl.live().texture).toBe(before.texture + 3);
    c.removeSeries(map);
    expect(gl.live()).toEqual(withHeatmapProgram(before));
  });

  it('adding and removing series in a loop does not grow the GPU object count', () => {
    const { c, gl } = setup();
    frame(c);
    const before = gl.live();
    for (let i = 0; i < 10; i++) {
      const pane = c.addPane();
      const histogram = c.addHistogram({}, pane);
      histogram.setData(times(20).map((time) => ({ time, value: i })));
      const map = c.addHeatmap();
      map.setData(heatmap());
      const profile = c.addVolumeProfile();
      const indicator = c.indicators.add(histogramDef);
      frame(c);
      c.removeSeries(map);
      c.removeSeries(profile);
      indicator.remove();
      c.removePane(pane);
    }
    expect(gl.created.vertexArray).toBeGreaterThan(before.vertexArray + 10);
    expect(gl.created.texture).toBeGreaterThanOrEqual(before.texture + 20);
    expect(gl.live()).toEqual(withHeatmapProgram(before));
  });

  it('reuses the same objects when a batch or grid grows', () => {
    const { c, gl } = setup();
    const main = c.main!;
    const map = c.addHeatmap();
    map.setData(heatmap());
    frame(c);
    const created = { ...gl.created };
    // Grow the candle batch well past its capacity and reallocate the heatmap texture.
    main.setData(times(2000).map((time) => ({ time, open: 1, high: 2, low: 0, close: 1 })));
    map.setData(heatmap(64));
    frame(c);
    expect(gl.created).toEqual(created);
  });

  it('a series drawn again after release gets fresh objects', () => {
    const { c, gl } = setup();
    frame(c);
    const before = gl.live();
    const main = c.main!;
    c.releaseGpu(main.batch);
    expect(gl.live().vertexArray).toBe(before.vertexArray - 1);
    frame(c);
    expect(gl.live()).toEqual(before);
  });
});
