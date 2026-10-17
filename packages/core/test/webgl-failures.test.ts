import { afterEach, describe, expect, it, vi } from 'vitest';
import { countingWebgl2, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { ChartError, isWebGL2Supported } from '../src/errors';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

interface Fake {
  children: unknown[];
  dispatch(type: string, event?: Record<string, unknown>): void;
}

/**
 * A counting fake context that also counts programs and shaders, and whose
 * shaders stop compiling after `state.compiles` more successes (unlimited by
 * default).
 */
function switchableGl() {
  const counting = countingWebgl2();
  const state = { compiles: Infinity };
  const objects = { programs: 0, shaders: 0 };
  const loseContext = vi.fn();
  const context = new Proxy(counting.context as Record<string | symbol, unknown>, {
    get: (target, key) => {
      switch (key) {
        case 'getShaderParameter':
          return () => state.compiles-- > 0;
        case 'getShaderInfoLog':
          return () => 'bad shader';
        case 'getExtension':
          return (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null);
        case 'createProgram':
          return () => (objects.programs++, {});
        case 'deleteProgram':
          return () => objects.programs--;
        case 'createShader':
          return () => (objects.shaders++, {});
        case 'deleteShader':
          return () => objects.shaders--;
        default:
          return target[key];
      }
    },
  });
  return { counting, state, objects, loseContext, context };
}

function chartWith(context: unknown) {
  const c = new Chart(fakeContainer({ webgl: context }));
  charts.push(c);
  c.addCandles().setData(times(10).map((time) => ({ time, open: 1, high: 2, low: 0, close: 1 })));
  return c;
}

function times(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i * 60);
}

const frame = (c: Chart) => {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
};
const renderer = (c: Chart) => (c as unknown as { renderer: { isLost: boolean; beginFrame(dpr: number): void } }).renderer;
const glCanvas = (c: Chart) => (c as unknown as { glCanvas: Fake }).glCanvas;

describe('construction failures', () => {
  it('throws a typed error without WebGL2 and leaves the container untouched', () => {
    const container = fakeContainer({ webgl: null });
    let error: unknown;
    try {
      new Chart(container);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ChartError);
    expect((error as ChartError).code).toBe('webgl2-unavailable');
    expect((container as unknown as Fake).children).toEqual([]);
  });

  it('reports shader failures with their own code, freeing what it made and the context', () => {
    const { counting, state, objects, loseContext, context } = switchableGl();
    // The heatmap program fails after the quad and two programs were made.
    state.compiles = 4;
    const container = fakeContainer({ webgl: context });
    expect(() => new Chart(container)).toThrow(expect.objectContaining({ name: 'ChartError', code: 'webgl-shader' }));
    expect((container as unknown as Fake).children).toEqual([]);
    expect(counting.created.buffer).toBe(1);
    expect(counting.live()).toEqual({ buffer: 0, vertexArray: 0, texture: 0 });
    expect(objects).toEqual({ programs: 0, shaders: 0 });
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('probes WebGL2 support', () => {
    fakeContainer();
    expect(isWebGL2Supported()).toBe(true);
  });
});

describe('context loss', () => {
  it('emits lost and restored, skips draws while lost and re-creates GPU objects once', () => {
    const { counting, objects, context } = switchableGl();
    const c = chartWith(context);
    const map = c.addHeatmap();
    map.setData({ times: times(10), priceStart: 0, priceStep: 0.5, rows: 4, values: new Float32Array(40).fill(1) });
    const events: string[] = [];
    c.on('context:lost', () => events.push('lost'));
    c.on('context:restored', () => events.push('restored'));
    frame(c);
    const created = { ...counting.created };
    const deleted = { ...counting.deleted };
    // One VAO and buffer per batch, besides the heatmap VAO and quad buffer from setup.
    const batches = created.vertexArray - 1;
    expect(batches).toBeGreaterThan(0);
    expect(created.buffer - 1).toBe(batches);
    // The heatmap's values, levels and colour ramp.
    expect(created.texture).toBe(3);
    const begin = vi.spyOn(renderer(c), 'beginFrame');

    glCanvas(c).dispatch('webglcontextlost');
    frame(c);
    expect(events).toEqual(['lost']);
    expect(begin).not.toHaveBeenCalled();

    glCanvas(c).dispatch('webglcontextrestored');
    expect(events).toEqual(['lost', 'restored']);
    // Handles from before the loss died with it: releasing them deletes nothing.
    c.releaseGpu(c.main!.batch);
    c.releaseGpu(map.grid);
    expect(counting.deleted).toEqual(deleted);

    frame(c);
    frame(c);
    expect(begin).toHaveBeenCalledTimes(2);
    expect(counting.deleted).toEqual(deleted);
    expect(counting.created.vertexArray - created.vertexArray).toBe(1 + batches);
    expect(counting.created.buffer - created.buffer).toBe(1 + batches);
    expect(counting.created.texture - created.texture).toBe(3);
    // Each program's shaders are freed once it links.
    expect(objects.shaders).toBe(0);
  });

  it('stays lost and reports a failed restore, deleting what the restore made', async () => {
    const { counting, state, objects, loseContext, context } = switchableGl();
    const c = chartWith(context);
    const failures: ChartError[] = [];
    c.on('context:restore-failed', ({ error }) => failures.push(error));
    glCanvas(c).dispatch('webglcontextlost');
    const live = counting.live();
    const before = { ...objects };
    state.compiles = 4;
    glCanvas(c).dispatch('webglcontextrestored');
    expect(failures.map((e) => e.code)).toEqual(['webgl-restore-failed']);
    expect((failures[0]!.cause as ChartError).code).toBe('webgl-shader');
    expect(counting.live()).toEqual(live);
    expect(objects).toEqual(before);
    expect(loseContext).not.toHaveBeenCalled();
    expect(renderer(c).isLost).toBe(true);
    expect(() => frame(c)).not.toThrow();
    await expect(c.captureImage()).resolves.toBeNull();
  });
});
