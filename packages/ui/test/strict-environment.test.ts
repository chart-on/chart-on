import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer, installFakeDom, runFrame } from '../../core/test/fake-dom';
import { createChartShell, type ChartShell } from '../src/shell';
import { symbolSearch } from '../src/symbol-search';

/**
 * The shell under a strict content security policy (docs/guide/security.md): with its
 * dialogs open in both themes it writes no inline `style` or event handler attributes,
 * parses no markup, creates no script or frame elements and makes no requests.
 */

installFakeDom();

interface El {
  tagName: string;
  textContent: string;
  innerHTML: string;
  attributes: Map<string, string>;
  className: string;
  children: El[];
  setSelectionRange?: () => void;
}

const MARKUP = '<img src=x onerror="alert(1)"><b>Bold</b>';
const NETWORK = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker'];

const byClass = (root: El, cls: string): El | null => {
  for (const child of root.children) {
    if (child.className.split(/\s+/).includes(cls)) return child;
    const found = byClass(child, cls);
    if (found) return found;
  }
  return null;
};

const all = (root: El): El[] => root.children.flatMap((child) => [child, ...all(child)]);

let created: El[];
let requests: string[];
const shells: ChartShell[] = [];

beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal('MutationObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('HTMLElement', class {});
  requests = [];
  for (const name of NETWORK) {
    vi.stubGlobal(name, function () {
      requests.push(name);
      throw new Error(`${name} is not allowed here`);
    });
  }
  // Every element the shell makes, attached or not.
  created = [];
  for (const method of ['createElement', 'createElementNS'] as const) {
    const make = document[method].bind(document) as (...args: unknown[]) => El;
    vi.spyOn(document, method).mockImplementation(((...args: unknown[]) => {
      const el = make(...args);
      created.push(el);
      return el;
    }) as never);
  }
});

afterEach(() => {
  shells.splice(0).forEach((s) => s.destroy());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('shell in a strict environment', () => {
  it('opens its dialogs in both themes without inline markup, styles or requests', async () => {
    const shell = createChartShell(fakeContainer(), {
      theme: 'dark',
      symbolSearch: symbolSearch({
        source: { search: async () => [{ symbol: MARKUP, name: MARKUP, description: MARKUP }] },
        onSelect: () => {},
        debounce: 0,
      }),
    });
    shells.push(shell);
    const { chart } = shell;
    chart.addCandles({ title: MARKUP }).setData(
      Array.from({ length: 30 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })),
    );
    const note = chart.drawings.add({ type: 'text', pane: 0, points: [{ time: 600, price: 1 }], style: {}, text: MARKUP });
    runFrame(16);

    for (const theme of ['dark', 'light'] as const) {
      shell.setTheme(theme);
      shell.settings!.open();
      shell.settings!.close();
      shell.drawingSettings!.open(note.id);
      shell.drawingSettings!.dialog!.close();
      byClass(shell.el as unknown as El, 'pc-symbol-search-input')!.setSelectionRange = () => {};
      shell.symbolSearch!.open(MARKUP);
      // Let the search answer and the results render.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const results = all(byClass(shell.el as unknown as El, 'pc-symbol-search')!);
      expect(results.some((el) => el.textContent === MARKUP)).toBe(true);
      shell.symbolSearch!.close();
      runFrame(32);
    }

    expect(requests).toEqual([]);
    expect(created.length).toBeGreaterThan(100);
    const unsafe = created.flatMap((el) => [
      ...[...el.attributes.keys()].filter((name) => name === 'style' || /^on/i.test(name)).map((name) => `${el.tagName}[${name}]`),
      ...(el.innerHTML ? [`${el.tagName}.innerHTML`] : []),
      ...(/^(script|style|iframe|object|embed|b)$/i.test(el.tagName) ? [el.tagName] : []),
    ]);
    expect(unsafe).toEqual([]);
    // The markup reached the page as text.
    expect(created.some((el) => el.textContent === MARKUP || el.attributes.get('value') === MARKUP)).toBe(true);
  });
});
