import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Loaded before the checks start: the framework's runtime looks for a DOM with `typeof window`
// and the like when it loads, which is safe on a server. Only the wrapper's own imports count.
import 'svelte';
import 'svelte/server';

/**
 * Server-rendered apps import the wrapper on a server, where there is no DOM.
 * Importing it must not read browser globals; each one below records reads
 * made during the imports. The engine and shell have the same check in
 * `packages/ui/test/server-import.test.ts`.
 */
const BROWSER_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'matchMedia', 'requestAnimationFrame', 'ResizeObserver', 'devicePixelRatio'];

const saved = new Map<string, PropertyDescriptor | undefined>();
const touched: string[] = [];
let importing = false;

beforeAll(() => {
  for (const name of BROWSER_GLOBALS) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        if (importing) touched.push(name);
        return undefined;
      },
    });
  }
});

afterAll(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
});

describe('importing on a server', () => {
  it.each([
    ['@charton/svelte', () => import('@charton/svelte')],
    ['@charton/svelte/shell', () => import('@charton/svelte/shell')],
  ])(
    '%s touches no browser global',
    async (_name, load) => {
      touched.length = 0;
      importing = true;
      const module = await load().finally(() => (importing = false));
      expect(Object.keys(module).length).toBeGreaterThan(0);
      expect(touched).toEqual([]);
    },
    // The first import transforms the engine and the shell from source.
    60_000,
  );
});
