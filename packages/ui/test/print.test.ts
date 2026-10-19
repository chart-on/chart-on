import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chart, ScreenshotOptions } from '@chart-on/core';
import { printChart, PRINT_VIEW_CLASS, PRINTING_CLASS } from '../src/print';

interface Node {
  tag: string;
  className: string;
  alt?: string;
  src?: string;
  children: Node[];
  parent: Node | null;
  append(...nodes: Node[]): void;
  remove(): void;
}

function node(tag: string): Node {
  const n: Node = {
    tag,
    className: '',
    children: [],
    parent: null,
    append(...nodes) {
      for (const child of nodes) {
        child.parent = n;
        n.children.push(child);
      }
    },
    remove() {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
      n.parent = null;
    },
  };
  return n;
}

/** A document and window just big enough for the print view, with a print dialog that `close()` dismisses. */
function fakePage(options: { printThrows?: boolean } = {}) {
  const listeners = new Map<string, Set<() => void>>();
  const classes = new Set<string>();
  const body = node('body');
  const win = {
    addEventListener: (type: string, fn: () => void) => listeners.set(type, (listeners.get(type) ?? new Set()).add(fn)),
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
    print: vi.fn(() => {
      if (options.printThrows) throw new Error('blocked');
    }),
  };
  const doc = {
    body,
    defaultView: win,
    documentElement: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } },
    createElement: node,
  };
  const close = () => [...(listeners.get('afterprint') ?? [])].forEach((fn) => fn());
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:print', revokeObjectURL: revoke });
  return { doc, win, body, classes, close, revoke, listeners };
}

function chartOn(doc: unknown, blob: Blob | null) {
  const captureImage = vi.fn((_options?: ScreenshotOptions) => Promise.resolve(blob));
  return { chart: { captureImage, root: { ownerDocument: doc } } as unknown as Chart, captureImage };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

afterEach(() => vi.unstubAllGlobals());

describe('printChart', () => {
  it('prints a light, captioned PNG in a print-only view and cleans up after the dialog', async () => {
    const page = fakePage();
    const { chart, captureImage } = chartOn(page.doc, new Blob(['png']));
    let settled = false;
    const done = printChart(chart, { padding: 12 }).then(() => (settled = true));
    await flush();
    expect(captureImage).toHaveBeenCalledWith({ theme: 'light', caption: true, scale: 2, padding: 12, type: 'image/png' });
    expect(page.win.print).toHaveBeenCalledTimes(1);
    const view = page.body.children[0]!;
    expect(view.className).toBe(PRINT_VIEW_CLASS);
    expect(view.children[0]).toMatchObject({ tag: 'img', src: 'blob:print' });
    expect(page.classes.has(PRINTING_CLASS)).toBe(true);
    expect(settled).toBe(false);

    page.close();
    await done;
    expect(page.body.children).toEqual([]);
    expect(page.classes.has(PRINTING_CLASS)).toBe(false);
    expect(page.revoke).toHaveBeenCalledWith('blob:print');
    expect(page.listeners.get('afterprint')?.size).toBe(0);
  });

  it('lets the caller override the print defaults', async () => {
    const page = fakePage();
    const { chart, captureImage } = chartOn(page.doc, new Blob(['png']));
    const done = printChart(chart, { theme: 'dark', caption: 'Weekly', scale: 1 });
    await flush();
    expect(captureImage).toHaveBeenCalledWith({ theme: 'dark', caption: 'Weekly', scale: 1, type: 'image/png' });
    page.close();
    await done;
  });

  it('replaces a print view left by an earlier call', async () => {
    const page = fakePage();
    const { chart } = chartOn(page.doc, new Blob(['png']));
    const first = printChart(chart);
    await flush();
    const second = printChart(chart);
    await first;
    await flush();
    expect(page.body.children.length).toBe(1);
    page.close();
    await second;
    expect(page.body.children).toEqual([]);
  });

  it('rejects without a view when the chart cannot be captured', async () => {
    const page = fakePage();
    const { chart } = chartOn(page.doc, null);
    await expect(printChart(chart)).rejects.toThrow('could not be captured');
    expect(page.body.children).toEqual([]);
    expect(page.win.print).not.toHaveBeenCalled();
  });

  it('cleans up and rejects when the browser refuses to print', async () => {
    const page = fakePage({ printThrows: true });
    const { chart } = chartOn(page.doc, new Blob(['png']));
    await expect(printChart(chart)).rejects.toThrow('blocked');
    expect(page.body.children).toEqual([]);
    expect(page.classes.has(PRINTING_CLASS)).toBe(false);
  });
});
