/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countingWebgl2, fakeContainer } from '../../core/test/fake-dom';
import { examples } from '../../../docs/examples/index';
import type { MountExample } from '../../../docs/examples/types';

const modules = import.meta.glob<{ default: MountExample }>([
  '../../../docs/examples/*.ts',
  '!../../../docs/examples/index.ts',
  '!../../../docs/examples/types.ts',
  '!../../../docs/examples/sample-data.ts',
]);
const idOf = (path: string) => path.replace(/^.*\/(.*)\.ts$/, '$1');

beforeEach(() => {
  vi.useFakeTimers();
  // The shell reads its theme from CSS custom properties; none are set here.
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

describe('docs examples', () => {
  it('have one registry entry per example file', () => {
    expect(Object.keys(modules).map(idOf).sort()).toEqual(Object.keys(examples).sort());
  });

  for (const path of Object.keys(modules)) {
    it(`${idOf(path)} mounts in both schemes and leaves nothing behind`, async () => {
      const { default: mount } = await modules[path]!();
      for (const dark of [true, false]) {
        const gl = countingWebgl2();
        let released = 0;
        // `destroy` frees the whole context at once rather than each object.
        const context = new Proxy(gl.context as object, {
          get: (target, key) =>
            key === 'getExtension'
              ? (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: () => released++ } : null)
              : Reflect.get(target, key),
        });
        const el = fakeContainer({ webgl: context });
        const dispose = mount(el, { dark });
        await vi.advanceTimersByTimeAsync(1000);
        expect(gl.created.buffer).toBeGreaterThan(0);
        dispose();
        expect(released).toBe(1);
        expect((el as unknown as { children: unknown[] }).children).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
      }
    });
  }
});
