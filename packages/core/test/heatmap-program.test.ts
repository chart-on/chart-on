import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { fakeWebgl2 } from '../src/testing/environment';
import { Chart } from '../src/chart';
import type { CellReduce } from '../src/gl/heatmap-reduce';

type FakeShader = { source: string };
type FakeProgram = { shaders: FakeShader[] };

/** A no-op WebGL2 context that keeps shader sources and records the programs drawn with. */
function programWebgl2() {
  const base = fakeWebgl2() as Record<string, unknown>;
  const used: FakeProgram[] = [];
  const calls: Record<string, (...args: never[]) => unknown> = {
    createShader: () => ({ source: '' }),
    shaderSource: (shader: FakeShader, source: string) => (shader.source = source),
    createProgram: () => ({ shaders: [] }),
    attachShader: (program: FakeProgram, shader: FakeShader) => program.shaders.push(shader),
    useProgram: (program: FakeProgram) => used.push(program),
  };
  const context = new Proxy(base, { get: (target, key) => (typeof key === 'string' && key in calls ? calls[key] : target[key as string]) });
  return { context, used };
}

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

/** The fragment shader sources the heatmap drew with, one per frame. */
function heatmapShaders(reduce: CellReduce): string[] {
  const gl = programWebgl2();
  const c = new Chart(fakeContainer({ webgl: gl.context }));
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 60 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
  c.addHeatmap({ cellReduce: reduce }).setData({ rows: 4, priceStart: 0, priceStep: 1, times: [0, 60], values: new Float32Array(8).fill(1) });
  c.invalidate();
  (c as unknown as { render(now: number): void }).render(0);
  return gl.used.flatMap((p) => p.shaders.map((s) => s.source)).filter((s) => s.includes('uniform int u_levelCount'));
}

describe('heatmap programs', () => {
  it("draws 'nearest' with its own program and the reducing modes with the other", () => {
    const nearest = heatmapShaders('nearest');
    expect(nearest.length).toBeGreaterThan(0);
    for (const source of nearest) expect(source).toContain('const bool NEAREST = true;');
    for (const reduce of ['max', 'sum'] as const) {
      const sources = heatmapShaders(reduce);
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) expect(source).toContain('const bool NEAREST = false;');
    }
  });

  it('keeps #version on the first line of both variants', () => {
    for (const source of [...heatmapShaders('nearest'), ...heatmapShaders('max')]) expect(source.startsWith('#version 300 es\n')).toBe(true);
  });
});
