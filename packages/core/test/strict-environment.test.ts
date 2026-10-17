import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.unstubAllGlobals();
});

interface Node {
  tagName?: string;
  textContent: string;
  children: Node[];
}
function* walk(node: Node): Generator<Node> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

/** Draw a frame now (the fake DOM runs no frames by itself). */
const frame = (c: Chart) => {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(16);
};

const MARKUP = '<img src=x onerror="alert(1)"><b>Bold</b>';

describe('strict environments', () => {
  it('makes no network requests and loads no code while drawing', () => {
    const calls: string[] = [];
    const record = (name: string) =>
      function (this: unknown) {
        calls.push(name);
        throw new Error(`${name} is not allowed here`);
      };
    vi.stubGlobal('fetch', record('fetch'));
    vi.stubGlobal('XMLHttpRequest', record('XMLHttpRequest'));
    vi.stubGlobal('WebSocket', record('WebSocket'));
    vi.stubGlobal('Worker', record('Worker'));
    vi.stubGlobal('EventSource', record('EventSource'));
    const c = new Chart(fakeContainer());
    charts.push(c);
    const candles = c.addCandles({ title: 'A' });
    candles.setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    c.addLine({ title: 'B' });
    c.drawings.add({ type: 'text', pane: 0, points: [{ time: 600, price: 1 }], style: {}, text: 'note' });
    frame(c);
    frame(c);
    expect(calls).toEqual([]);
  });

  it('shows markup in titles as text', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles({ title: MARKUP }).setData([{ time: 0, open: 1, high: 2, low: 0, close: 1 }]);
    frame(c);
    const nodes = [...walk(c.root as unknown as Node)];
    expect(nodes.some((n) => n.textContent === MARKUP)).toBe(true);
    expect(nodes.filter((n) => /^(img|b|script)$/i.test(n.tagName ?? ''))).toEqual([]);
  });
});
