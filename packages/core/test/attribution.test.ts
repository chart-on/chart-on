import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import { localization, watermark } from '../src/builtins';
import { createAttributionLoader, drawAttributionMark } from '../src/attribution';
import { ROOT_RULE } from '../src/root-style';

type Call = { op: string; args: unknown[]; fillStyle: unknown };

/** A 2D context that records every call with the fill style at that moment; `measureText` answers 6 px a character. */
function recorder() {
  const calls: Call[] = [];
  const state: Record<string | symbol, unknown> = { fillStyle: '#000' };
  const ctx = new Proxy(state, {
    get: (t, key) => {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (key in t) return t[key];
      return (...args: unknown[]) => void calls.push({ op: String(key), args, fillStyle: t.fillStyle });
    },
    set: (t, key, value) => ((t[key] = value), true),
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

/** Where each mark was drawn: the `translate` and `scale` before the mark's shoulder arc, and its colour. */
function marks(calls: readonly Call[]) {
  const out: { x: number; y: number; size: number; color: unknown }[] = [];
  calls.forEach((c, i) => {
    if (c.op !== 'arc' || c.args[0] !== 54 || c.args[2] !== 46) return;
    const before = calls.slice(0, i).reverse();
    const scale = before.find((p) => p.op === 'scale')!;
    const at = before.find((p) => p.op === 'translate')!;
    const fill = calls.slice(i).find((p) => p.op === 'fill')!;
    out.push({ x: at.args[0] as number, y: at.args[1] as number, size: (scale.args[0] as number) * 100, color: fill.fillStyle });
  });
  return out;
}

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  c.addCandles({ precision: 2 }).setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 150, high: 200, low: 100, close: 150 })));
  return c;
}

/** Draw a scene into a recording context and return the marks drawn. */
function frame(c: Chart) {
  const rec = recorder();
  (c as unknown as { ctx: () => CanvasRenderingContext2D }).ctx = () => rec.ctx;
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
  return marks(rec.calls);
}

describe('drawAttributionMark', () => {
  it('fills the mark in the colour given, scaled from its 100-unit grid', () => {
    const { ctx, calls } = recorder();
    drawAttributionMark(ctx, 10, 20, 50, 'rgba(0, 0, 0, 0.1)');
    expect(marks(calls)).toEqual([{ x: 10, y: 20, size: 50, color: 'rgba(0, 0, 0, 0.1)' }]);
    expect(calls.filter((c) => c.op === 'fill')).toHaveLength(1);
    expect(calls.at(-1)!.op).toBe('restore');
  });
});

type FakeEl = {
  tagName: string;
  className: string;
  href: string;
  target: string;
  rel: string;
  title: string;
  textContent: string;
  style: Record<string, string>;
  children: FakeEl[];
  getAttribute(k: string): string | null;
  dispatch(type: string, event?: Record<string, unknown>): void;
};

/** The chart's attribution badge, if it has made one. */
const badgeOf = (c: Chart) => (c.root as unknown as FakeEl).children.find((e) => e.className === 'pc-attribution');

describe('attribution badge on a chart', () => {
  it('links to the project site from the bottom of the start side, drawing nothing on the canvas', () => {
    const c = chart();
    expect(c.options.features.attributionLogo).toBe(true);
    expect(frame(c)).toEqual([]);
    const b = badgeOf(c)!;
    expect([b.tagName, b.href, b.target, b.rel]).toEqual(['a', 'https://charton.dev', '_blank', 'noopener']);
    expect(b.getAttribute('aria-label')).toBe('Made with charton');
    expect([b.style.position, b.style.display]).toEqual(['absolute', 'flex']);
    // Not a Tab stop: the chart's areas keep their keyboard order.
    expect((b as unknown as { tabIndex: number }).tabIndex).toBe(-1);
    expect(b.style.left).toBe(`${c.plotLeft + 8}px`);
    expect(b.style.right).toBe('');
    expect(b.style.bottom).toBe(`${c.height - c.plotHeight + 8}px`);
    expect(b.style.color).toBe(c.theme.textMuted);
    // The mark, then the name.
    expect(b.children.map((e) => e.tagName)).toEqual(['svg', 'span']);
    expect(b.children[1]!.textContent).toBe('charton');
  });

  it('hides when the flag is off, at creation and at runtime', () => {
    const off = chart({ features: { attributionLogo: false } });
    frame(off);
    expect(badgeOf(off)).toBeUndefined();
    const c = chart();
    frame(c);
    c.applyOptions({ features: { attributionLogo: false } });
    frame(c);
    expect(badgeOf(c)!.style.display).toBe('none');
    c.applyOptions({ features: { attributionLogo: true } });
    frame(c);
    expect(badgeOf(c)!.style.display).toBe('flex');
  });

  it('sits out the loading indicator', () => {
    const c = chart();
    frame(c);
    c.setStatus({ kind: 'loading' });
    frame(c);
    expect(badgeOf(c)!.style.display).toBe('none');
    c.setStatus(null);
    frame(c);
    expect(badgeOf(c)!.style.display).toBe('flex');
  });

  it('moves to the bottom right in a right-to-left chart', () => {
    const c = chart({ direction: 'rtl' });
    frame(c);
    const b = badgeOf(c)!;
    expect(b.style.left).toBe('');
    expect(b.style.right).toBe(`${c.width - c.plotLeft - c.plotWidth + 8}px`);
  });

  it('shows its name on hover and keyboard focus through the chart stylesheet, and a press on it does not start a pan', () => {
    expect(ROOT_RULE).toContain(':where(.pc-attribution){');
    expect(ROOT_RULE).toContain('opacity:0.6');
    expect(ROOT_RULE).toContain(':where(.pc-attribution) span{display:none}');
    expect(ROOT_RULE).toContain(':where(.pc-attribution:hover,.pc-attribution:focus-visible){opacity:1;background:var(--pc-root-background)}');
    expect(ROOT_RULE).toContain(':where(.pc-attribution:hover,.pc-attribution:focus-visible) span{display:inline}');
    const c = chart();
    frame(c);
    const stop = vi.fn();
    badgeOf(c)!.dispatch('pointerdown', { stopPropagation: stop });
    expect(stop).toHaveBeenCalled();
  });

  it('follows the theme and the localization', () => {
    const c = chart({ plugins: [localization()] });
    frame(c);
    c.applyOptions({ theme: { textMuted: '#123456' }, localization: { messages: { attribution: 'Gemacht mit charton' } } });
    const b = badgeOf(c)!;
    expect(b.style.color).toBe('#123456');
    expect(b.getAttribute('aria-label')).toBe('Gemacht mit charton');
  });

  it('leaves the built-in watermark without the mark', () => {
    const c = chart({ plugins: [watermark()], features: { watermark: true } });
    expect(c.watermark.options.logo).toBe(false);
    expect(frame(c)).toEqual([]);
    expect(badgeOf(c)!.style.display).toBe('flex');
  });
});

type SvgNode = { tagName: string; children: SvgNode[]; getAttribute(k: string): string | null; animate?: ReturnType<typeof vi.fn> };
const all = (n: SvgNode): SvgNode[] => [n, ...n.children.flatMap(all)];

/** Build a loader with `animate` stubbed on every element it creates. */
function loader(still = false) {
  const create = document.createElementNS.bind(document);
  const spy = vi.spyOn(document, 'createElementNS').mockImplementation(((ns: string, tag: string) => {
    const el = create(ns, tag) as unknown as SvgNode;
    el.animate = vi.fn();
    return el;
  }) as typeof document.createElementNS);
  const svg = createAttributionLoader(40, still) as unknown as SvgNode;
  spy.mockRestore();
  return svg;
}

describe('createAttributionLoader', () => {
  it('clips the three steps through windows of its own, then the whole block and the square', () => {
    const a = loader();
    const b = loader();
    const ids = (svg: SvgNode) => all(svg).filter((n) => n.tagName === 'clipPath').map((n) => n.getAttribute('id'));
    expect(ids(a)).toHaveLength(3);
    expect(new Set([...ids(a), ...ids(b)]).size).toBe(6);
    const group = a.children.find((n) => n.tagName === 'g')!;
    expect(group.children.map((n) => [n.tagName, n.getAttribute('clip-path')])).toEqual([
      ['path', `url(#${ids(a)[0]})`],
      ['path', `url(#${ids(a)[1]})`],
      ['path', `url(#${ids(a)[2]})`],
      ['path', null],
      ['rect', null],
    ]);
    expect([a.getAttribute('width'), a.getAttribute('fill'), a.getAttribute('aria-hidden')]).toEqual(['40', 'currentColor', 'true']);
  });

  it('ends each window at the bottom of its step, so no step shows a sliver of the one below', () => {
    const rects = all(loader()).filter((n) => n.tagName === 'clipPath').map((n) => n.children[0]!);
    expect(rects.map((r) => Number(r.getAttribute('y')) + Number(r.getAttribute('height')))).toEqual([46, 77, 100]);
  });

  it('loops every 3 s, each loop starting from nothing, and stays still with reduced motion', () => {
    const svg = loader();
    const animated = all(svg).filter((n) => n.animate!.mock.calls.length > 0);
    // Three windows, the whole block, the square and the group.
    expect(animated).toHaveLength(6);
    for (const n of animated) {
      const [frames, timing] = n.animate!.mock.calls[0]! as [Keyframe[], KeyframeAnimationOptions];
      expect(timing).toEqual({ duration: 3000, iterations: Infinity });
      expect([frames[0]!.offset, frames.at(-1)!.offset]).toEqual([0, 1]);
    }
    const windows = all(svg).filter((n) => n.tagName === 'rect' && n.animate!.mock.calls.length > 0).slice(0, 3);
    // The second step starts 250 ms after the first and takes 750 ms.
    const second = windows[1]!.animate!.mock.calls[0]![0] as Keyframe[];
    expect(second.map((f) => [f.transform, f.offset])).toEqual([
      ['scaleX(0)', 0],
      ['scaleX(0)', 250 / 3000],
      ['none', 1000 / 3000],
      ['none', 1],
    ]);
    expect(all(loader(true)).some((n) => n.animate!.mock.calls.length > 0)).toBe(false);
  });
});
