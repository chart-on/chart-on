import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { recordingBackend, type RecordingBackend } from './recording-backend';
import { Chart } from '../src/chart';
import type { HeatmapData } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
});

const times = (n: number) => Array.from({ length: n }, (_, i) => i * 60);

function setup(): { c: Chart; backend: RecordingBackend } {
  const c = new Chart(fakeContainer(), { timezone: 'UTC' });
  charts.push(c);
  const backend = recordingBackend();
  (c as unknown as { renderer: RecordingBackend }).renderer = backend;
  return { c, backend };
}

function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

describe('render backend', () => {
  it('draws a frame through the backend: begin, a pane, the series, end', () => {
    const { c, backend } = setup();
    c.addCandles().setData(times(20).map((time) => ({ time, open: 1, high: 2, low: 0, close: 1.5 })));
    frame(c);
    const ops = backend.ops();
    expect(ops[0]).toBe('beginFrame');
    expect(ops[1]).toBe('setPane');
    expect(ops).toContain('drawRects');
    expect(ops.at(-1)).toBe('endFrame');
  });

  it('draws a heatmap through the backend and releases its grid on removal', () => {
    const { c, backend } = setup();
    c.addCandles().setData(times(20).map((time) => ({ time, open: 1, high: 2, low: 0, close: 1 })));
    const data: HeatmapData = { times: times(20), priceStart: 0, priceStep: 0.5, rows: 4, values: new Float32Array(80).fill(1) };
    const map = c.addHeatmap();
    map.setData(data);
    frame(c);
    const draw = backend.calls.find((call) => call.op === 'drawHeatmap');
    expect(draw).toBeDefined();
    expect((draw!.args[1] as { reduce: string }).reduce).toBe('max');
    c.removeSeries(map);
    expect(backend.ops()).toContain('release');
  });
});
