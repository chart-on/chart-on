/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { countingWebgl2, fakeContainer } from '../../core/test/fake-dom';
import { describeError, PlaygroundSyntaxError, run, transpile } from '../../../docs/.vitepress/playground/runner';
import { codeHash, decodeCode, encodeCode, encodedFromHash } from '../../../docs/.vitepress/playground/share';
import { ChartError } from '@chart-on/core';

const sources = import.meta.glob<string>(
  ['../../../docs/examples/*.ts', '!../../../docs/examples/index.ts', '!../../../docs/examples/types.ts', '!../../../docs/examples/sample-data.ts'],
  { query: '?raw', import: 'default', eager: true },
);

/** A container whose WebGL context counts `loseContext` calls, which `destroy` makes once per chart. */
function countingContainer(): { el: HTMLElement; released: () => number } {
  const gl = countingWebgl2();
  let released = 0;
  const context = new Proxy(gl.context as object, {
    get: (target, key) =>
      key === 'getExtension'
        ? (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: () => released++ } : null)
        : Reflect.get(target, key),
  });
  return { el: fakeContainer({ webgl: context }), released: () => released };
}

const children = (el: HTMLElement) => (el as unknown as { children: unknown[] }).children;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('playground links', () => {
  it('round-trip code through the URL fragment', async () => {
    const code = "const label = 'ü – 価格';\n".repeat(2000);
    const encoded = await encodeCode(code);
    expect(encoded).toMatch(/^[\w-]+$/);
    expect(encoded.length).toBeLessThan(code.length / 10);
    expect(encodedFromHash(codeHash(encoded))).toBe(encoded);
    expect(await decodeCode(encoded)).toBe(code);
  });

  it('ignore fragments without code and reject damaged code', async () => {
    expect(encodedFromHash('')).toBeNull();
    expect(encodedFromHash('#code=')).toBeNull();
    expect(encodedFromHash('#section')).toBeNull();
    await expect(decodeCode('not-deflate')).rejects.toThrow();
  });
});

describe('playground runner', () => {
  for (const [path, source] of Object.entries(sources)) {
    it(`runs the ${path.replace(/^.*\/(.*)\.ts$/, '$1')} example and cleans up`, async () => {
      const { el, released } = countingContainer();
      const dispose = run(transpile(ts, source), el, { dark: true });
      await vi.advanceTimersByTimeAsync(1000);
      dispose();
      expect(released()).toBe(1);
      expect(children(el)).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it('destroys charts the code did not clean up, once each, over repeated runs', () => {
    const { el, released } = countingContainer();
    const js = transpile(
      ts,
      `import { createChart } from '@chart-on/core';
       export default function mount(el: HTMLElement) {
         createChart(el);
         const kept = createChart(el);
         return () => kept.destroy();
       }`,
    );
    for (let i = 1; i <= 3; i++) {
      run(js, el, { dark: false })();
      expect(released()).toBe(2 * i);
      expect(children(el)).toEqual([]);
    }
  });

  it('cleans up what the code made before it threw, and keeps the ChartError code', () => {
    const { el, released } = countingContainer();
    const failing = transpile(
      ts,
      `import { createChart } from '@chart-on/core';
       export default function mount(el: HTMLElement) {
         createChart(el);
         const chart = createChart(el);
         chart.destroy();
         chart.loadLayout({});
       }`,
    );
    let thrown: unknown;
    try {
      run(failing, el, { dark: true });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ChartError);
    expect(describeError(thrown)).toMatch(/^ChartError \[destroyed\]: /);
    expect(children(el)).toEqual([]);
    expect(released()).toBe(2);
  });

  it('reports syntax errors with their position', () => {
    expect(() => transpile(ts, 'const a = ;')).toThrow(PlaygroundSyntaxError);
    expect(() => transpile(ts, 'const a = ;')).toThrow(/line 1, column 11/);
  });

  it('explains unknown imports and a missing default export', () => {
    const el = fakeContainer();
    expect(() => run(transpile(ts, "import 'left-pad';\nexport default () => () => {};"), el, { dark: true })).toThrow(
      /Cannot import "left-pad".*@chart-on\/core/,
    );
    expect(() => run(transpile(ts, 'export const x = 1;'), el, { dark: true })).toThrow(/default export/);
  });

  it('describes anything thrown', () => {
    expect(describeError(new TypeError('bad'))).toBe('TypeError: bad');
    expect(describeError('text')).toBe('Thrown: text');
    const wrapped = new ChartError('load-failed', 'load failed', { cause: new Error('offline') });
    expect(describeError(wrapped)).toBe('ChartError [load-failed]: load failed (cause: offline)');
  });
});
