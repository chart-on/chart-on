import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer, recordingWebgl2, type RecordingGl } from './fake-dom';
import { sharedContext } from '../src/builtins';
import { Chart } from '../src/chart';
import { contextBudget, setContextBudget } from '../src/gl/context-budget';
import { shared } from '../src/gl/shared';
import type { Bar } from '../src/types';

interface Fake {
  dispatch(type: string, event?: Record<string, unknown>): void;
}

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  setContextBudget(12);
});

const bars: Bar[] = Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 11, low: 9, close: 10.5 }));

function chart(gl: RecordingGl, mode: 'own' | 'shared' = 'shared'): Chart {
  const c = new Chart(fakeContainer({ webgl: gl.context }), { gl: mode, plugins: [sharedContext()] });
  charts.push(c);
  c.addCandles({ animate: false }).setData(bars);
  c.addHistogram().setData(bars.map((b) => ({ time: b.time, value: 1 })));
  return c;
}

function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

const rendererOf = (c: Chart) => (c as unknown as { renderer: unknown }).renderer;

describe("gl: 'shared'", () => {
  it('draws any number of charts through one context, counted once by the budget', () => {
    const gl = recordingWebgl2();
    const list = Array.from({ length: 32 }, () => chart(gl));
    for (const c of list) frame(c);
    expect(new Set(list.map(rendererOf)).size).toBe(1);
    expect(shared.size).toBe(32);
    expect(contextBudget.held).toBe(1);
    // Each chart drew into its own region: one viewport per pane per chart, all at the canvas's top-left.
    expect(gl.viewports.filter(([x]) => x === 0).length).toBeGreaterThanOrEqual(32);
    expect(list[0]!.options.gl).toBe('shared');
  });

  it('releases only the destroyed chart’s GPU objects; the others keep drawing', () => {
    const gl = recordingWebgl2();
    const [a, b] = [chart(gl), chart(gl)];
    frame(a);
    frame(b);
    const live = gl.live().buffer;
    charts.splice(charts.indexOf(a), 1);
    a.destroy();
    // Its two batches (candles, histogram) went; the shared context and the other chart's stayed.
    expect(gl.live().buffer).toBe(live - 2);
    expect(shared.size).toBe(1);
    const uploads = gl.uploads.length;
    b.main!.update({ time: 49 * 60, open: 10, high: 12, low: 9, close: 11 });
    frame(b);
    expect(gl.uploads.length).toBeGreaterThan(uploads);
  });

  it('restores every chart after a context loss', () => {
    const gl = recordingWebgl2();
    const list = [chart(gl), chart(gl), chart(gl)];
    const events: string[] = [];
    list.forEach((c, i) => {
      c.on('context:lost', ({ reason }) => events.push(`${i} lost ${reason}`));
      c.on('context:restored', ({ reason }) => events.push(`${i} restored ${reason}`));
    });
    const canvas = shared.canvas as unknown as Fake;
    canvas.dispatch('webglcontextlost');
    canvas.dispatch('webglcontextrestored');
    expect(events).toEqual([
      '0 lost browser',
      '1 lost browser',
      '2 lost browser',
      '0 restored browser',
      '1 restored browser',
      '2 restored browser',
    ]);
  });

  it('lets the shared context go with the last shared chart', () => {
    const gl = recordingWebgl2();
    const own = chart(gl, 'own');
    const a = chart(gl);
    expect(contextBudget.held).toBe(2);
    charts.splice(charts.indexOf(a), 1);
    a.destroy();
    expect(shared.size).toBe(0);
    expect(shared.canvas).toBeNull();
    expect(contextBudget.held).toBe(1);
    expect(own.options.gl).toBe('own');
  });

  it('keeps gl and interactive as created', () => {
    const c = chart(recordingWebgl2());
    c.applyOptions({ gl: 'own' } as never);
    expect(c.options.gl).toBe('shared');
    expect(c.options.interactive).toBe(true);
  });
});
