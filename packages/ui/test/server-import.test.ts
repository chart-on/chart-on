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
    ['@chart-on/core', () => import('@chart-on/core')],
    ['@chart-on/core/internal', () => import('@chart-on/core/internal')],
    ['@chart-on/core/testing', () => import('@chart-on/core/testing')],
    ['@chart-on/ui', () => import('@chart-on/ui')],
    ['@chart-on/ui/templates', () => import('@chart-on/ui/templates')],
    ['@chart-on/ta', () => import('@chart-on/ta')],
    ['@chart-on/indicators', () => import('@chart-on/indicators')],
    ['@chart-on/react', () => import('@chart-on/react')],
    ['@chart-on/react/shell', () => import('@chart-on/react/shell')],
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
    const { isWebGL2Supported } = await import('@chart-on/core');
    expect(isWebGL2Supported()).toBe(false);
  });
});
