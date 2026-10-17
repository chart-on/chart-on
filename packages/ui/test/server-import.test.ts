import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Server-rendered frameworks import the packages on a server, where there is no
 * DOM. Importing must not read `window`, `document` or WebGL: only calling into
 * the chart may. Each browser global below throws when read during the imports.
 */
const BROWSER_GLOBALS = [
  'window',
  'document',
  'self',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'matchMedia',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'ResizeObserver',
  'MutationObserver',
  'IntersectionObserver',
  'HTMLElement',
  'HTMLCanvasElement',
  'Element',
  'Node',
  'CSSStyleSheet',
  'WebGL2RenderingContext',
  'OffscreenCanvas',
  'Image',
  'devicePixelRatio',
];

const saved = new Map<string, PropertyDescriptor | undefined>();
const touched: string[] = [];
/** Only reads during the imports count; the test runner itself may look at globals. */
let importing = false;

beforeAll(() => {
  // Earlier files may have installed the fake DOM; this file must see a bare server runtime.
  for (const name of BROWSER_GLOBALS) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      // Undefined, as on a server; reads are recorded rather than thrown so every one shows up.
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
    ['@charton/core', () => import('@charton/core')],
    ['@charton/core/internal', () => import('@charton/core/internal')],
    ['@charton/core/testing', () => import('@charton/core/testing')],
    ['@charton/ui', () => import('@charton/ui')],
    ['@charton/ui/templates', () => import('@charton/ui/templates')],
    ['@charton/ta', () => import('@charton/ta')],
    ['@charton/indicators', () => import('@charton/indicators')],
    ['@charton/react', () => import('@charton/react')],
    ['@charton/react/shell', () => import('@charton/react/shell')],
  ])(
    '%s touches no browser global',
    async (_name, load) => {
      touched.length = 0;
      importing = true;
      const module = await load().finally(() => (importing = false));
      expect(Object.keys(module).length).toBeGreaterThan(0);
      expect(touched).toEqual([]);
    },
    // The first import transforms the whole engine from source, which takes several seconds
    // on a loaded machine; a timeout would leave `importing` set and fail the later entries.
    60_000,
  );

  it('answers feature detection on a server without throwing', async () => {
    const { isWebGL2Supported } = await import('@charton/core');
    expect(isWebGL2Supported()).toBe(false);
  });
});
