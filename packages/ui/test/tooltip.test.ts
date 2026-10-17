import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chart } from '@charton/core';
import { dispatch, documentListeners, fakeContainer, fireWindowResize, installFakeDom } from '../../core/test/fake-dom';
import { iconButton } from '../src/controls';
import { createToolbar } from '../src/toolbar';
import { print } from '../src/toolbar-presets';
import { placeTip, retainTips, type TipBox } from '../src/tooltip';

installFakeDom();

const area: TipBox = { left: 0, top: 0, width: 800, height: 400 };
const size = { width: 120, height: 24 };
const button = (left: number, top: number): TipBox => ({ left, top, width: 28, height: 28 });

describe('placeTip', () => {
  it('opens below, centred on the trigger, when it fits', () => {
    expect(placeTip(button(300, 10), size, area, 'bottom')).toEqual({ x: 254, y: 44, side: 'bottom' });
  });

  it('opens above and beside with their own gaps', () => {
    expect(placeTip(button(300, 300), size, area, 'top')).toEqual({ x: 254, y: 270, side: 'top' });
    expect(placeTip(button(10, 100), size, area, 'right')).toEqual({ x: 46, y: 102, side: 'right' });
  });

  it('flips to the opposite side when the preferred one has no room', () => {
    expect(placeTip(button(300, 368), size, area, 'bottom')).toEqual({ x: 254, y: 338, side: 'top' });
    expect(placeTip(button(300, 4), size, area, 'top').side).toBe('bottom');
    expect(placeTip(button(700, 100), size, area, 'right')).toEqual({ x: 572, y: 102, side: 'left' });
  });

  it('lines up with the area edge for a trigger at the right or left edge', () => {
    const right = placeTip(button(768, 10), size, area, 'bottom');
    expect(right).toEqual({ x: 676, y: 44, side: 'bottom' });
    expect(right.x + size.width).toBe(area.width - 4);
    expect(placeTip(button(4, 10), size, area, 'bottom').x).toBe(4);
  });

  it('respects an area that does not start at the origin', () => {
    const dialog: TipBox = { left: 200, top: 50, width: 300, height: 200 };
    expect(placeTip(button(470, 60), size, dialog, 'bottom')).toEqual({ x: 376, y: 94, side: 'bottom' });
  });

  it('takes the roomier side and stays inside when neither side has room', () => {
    const short: TipBox = { left: 0, top: 0, width: 800, height: 60 };
    expect(placeTip(button(300, 20), size, short, 'bottom')).toEqual({ x: 254, y: 4, side: 'top' });
    expect(placeTip(button(300, 10), size, short, 'top')).toEqual({ x: 254, y: 32, side: 'bottom' });
  });

  it('keeps the start of a tooltip wider than the area in view', () => {
    expect(placeTip(button(40, 10), { width: 300, height: 24 }, { left: 0, top: 0, width: 200, height: 400 }, 'bottom').x).toBe(4);
  });
});

interface Node509 {
  parent: Node509 | null;
  children: Node509[];
  className: string;
  hidden: boolean;
  id: string;
  textContent: string;
  style: Record<string, string>;
  dataset: Record<string, string>;
  getAttribute(k: string): string | null;
  setAttribute(k: string, v: string): void;
  append(...n: unknown[]): void;
  remove(): void;
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number };
  offsetWidth: number;
  offsetHeight: number;
}

// The fake DOM has no selectors or connection state; enough of both for the tooltip.
const proto = Object.getPrototypeOf(document.createElement('div')) as Record<string, unknown>;
const matchesSelector = (n: Node509, sel: string) =>
  sel.startsWith('.') ? !sel.includes('[') && n.className.split(/\s+/).includes(sel.slice(1)) : sel.startsWith('[') ? n.getAttribute(sel.slice(1, -1)) !== null : false;
Object.defineProperty(proto, 'closest', {
  configurable: true,
  value(this: Node509, sel: string) {
    for (let n: Node509 | null = this; n; n = n.parent) if (matchesSelector(n, sel)) return n;
    return null;
  },
});
Object.defineProperty(proto, 'matches', { configurable: true, value: () => true });
Object.defineProperty(proto, 'isConnected', {
  configurable: true,
  get(this: Node509) {
    let n: Node509 = this;
    while (n.parent) n = n.parent;
    return (n as unknown as { connected?: boolean }).connected === true;
  },
});
Object.defineProperty(proto, 'parentNode', {
  configurable: true,
  get(this: Node509) {
    return this.parent;
  },
});

/** Stand-in MutationObserver: the test triggers it by hand. */
const observers: { fn: (records: { type: string }[]) => void; on: boolean }[] = [];
class FakeObserver {
  entry: { fn: (records: { type: string }[]) => void; on: boolean };
  constructor(fn: (records: { type: string }[]) => void) {
    this.entry = { fn, on: false };
    observers.push(this.entry);
  }
  observe() {
    this.entry.on = true;
  }
  disconnect() {
    this.entry.on = false;
  }
}
const mutate = (type: string) => observers.filter((o) => o.on).forEach((o) => o.fn([{ type }]));
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });

/** An 800x400 `.pc-shell` root on the page, with triggers in it. */
function fakeShell() {
  const root = document.createElement('div') as unknown as Node509 & { connected: boolean };
  root.className = 'pc-shell';
  root.connected = true;
  root.getBoundingClientRect = () => rect(0, 0, 800, 400);
  const trigger = (tip: string, left: number, top = 10, attrs: Record<string, string> = {}) => {
    const t = document.createElement('button') as unknown as Node509;
    for (const [k, v] of Object.entries({ 'data-tip': tip, ...attrs })) t.setAttribute(k, v);
    let at = { left, top };
    t.getBoundingClientRect = () => rect(at.left, at.top, 28, 28);
    root.append(t);
    return Object.assign(t, { moveTo: (l: number, tp: number) => (at = { left: l, top: tp }) });
  };
  const tip = () => root.children.find((c) => c.className === 'pc-tip') ?? null;
  return { root, trigger, tip };
}

describe('retainTips', () => {
  let release: () => void = () => {};
  beforeEach(() => {
    vi.stubGlobal('MutationObserver', FakeObserver);
    release = retainTips();
  });
  afterEach(() => {
    release();
    vi.unstubAllGlobals();
  });

  it('shows the hovered trigger’s text inside the shell, and hides when the pointer leaves', () => {
    const shell = fakeShell();
    const edge = shell.trigger('Download data', 768);
    dispatch(edge, 'pointerover');
    const tip = shell.tip()!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe('Download data');
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.getAttribute('aria-hidden')).toBeNull();
    tip.offsetWidth = 120;
    dispatch(document, 'scroll');
    // 120px wide: lined up with the shell's right inset instead of centred past the edge.
    expect(tip.style.transform).toBe('translate(676px, 44px)');
    dispatch(edge, 'pointerout', { relatedTarget: null });
    expect(tip.hidden).toBe(true);
  });

  it('follows data-tip-side and moves straight to the next trigger', () => {
    const shell = fakeShell();
    const a = shell.trigger('A', 100);
    const b = shell.trigger('B', 300, 300, { 'data-tip-side': 'top' });
    dispatch(a, 'pointerover');
    dispatch(a, 'pointerout', { relatedTarget: b });
    dispatch(b, 'pointerover');
    expect(shell.tip()!.textContent).toBe('B');
    expect(shell.tip()!.dataset.side).toBe('top');
  });

  it('stays hidden for touch, empty tips, expanded triggers and triggers outside a shell', () => {
    const shell = fakeShell();
    dispatch(shell.trigger('Tap', 100), 'pointerover', { pointerType: 'touch' });
    dispatch(shell.trigger('Menu', 140, 10, { 'aria-expanded': 'true' }), 'pointerover');
    dispatch(shell.trigger('', 180), 'pointerover');
    const loose = document.createElement('button') as unknown as Node509;
    loose.setAttribute('data-tip', 'Outside');
    dispatch(loose, 'pointerover');
    expect(shell.tip()?.hidden ?? true).toBe(true);
  });

  it('shows on keyboard focus and hides on blur', () => {
    const shell = fakeShell();
    const focused = shell.trigger('Focused', 220);
    dispatch(focused, 'focusin');
    expect(shell.tip()!.hidden).toBe(false);
    dispatch(focused, 'focusout');
    expect(shell.tip()!.hidden).toBe(true);
  });

  it('describes the trigger only when the tooltip says more than its name', () => {
    const shell = fakeShell();
    const chip = shell.trigger('Show the last month', 100);
    chip.textContent = '1M';
    const named = shell.trigger('Undo', 200, 10, { 'aria-label': 'Undo' });
    dispatch(chip, 'pointerover');
    const id = shell.tip()!.getAttribute('id');
    expect(id).toMatch(/^pc-tip-/);
    expect(chip.getAttribute('aria-describedby')).toBe(id);
    dispatch(chip, 'pointerout', { relatedTarget: named });
    dispatch(named, 'pointerover');
    expect(chip.getAttribute('aria-describedby')).toBeNull();
    expect(named.getAttribute('aria-describedby')).toBeNull();
  });

  it('hides when the shown trigger is removed, and on aria-expanded', () => {
    const shell = fakeShell();
    const gone = shell.trigger('Gone', 100);
    dispatch(gone, 'pointerover');
    expect(shell.tip()!.hidden).toBe(false);
    gone.remove();
    mutate('childList');
    expect(shell.tip()!.hidden).toBe(true);
    // The pointer can come back to another trigger.
    const menu = shell.trigger('Menu', 200);
    dispatch(menu, 'pointerover');
    expect(shell.tip()!.hidden).toBe(false);
    menu.setAttribute('aria-expanded', 'true');
    mutate('attributes');
    expect(shell.tip()!.hidden).toBe(true);
  });

  it('follows its trigger when content scrolls or the window resizes', () => {
    const shell = fakeShell();
    const t = shell.trigger('Swatch', 100, 100);
    dispatch(t, 'pointerover');
    expect(shell.tip()!.style.transform).toBe('translate(114px, 134px)');
    t.moveTo(100, 40);
    dispatch(shell.root, 'scroll');
    expect(shell.tip()!.style.transform).toBe('translate(114px, 74px)');
    t.moveTo(300, 40);
    fireWindowResize();
    expect(shell.tip()!.style.transform).toBe('translate(314px, 74px)');
    // A scrolled shell moves its padding box, so the offsets add its scroll position.
    Object.assign(shell.root, { scrollLeft: 5, scrollTop: 20 });
    dispatch(shell.root, 'scroll');
    expect(shell.tip()!.style.transform).toBe('translate(319px, 94px)');
  });

  it('removes its listeners and tooltips on the last release, with triggers still on the page', () => {
    const before = documentListeners('pointerover');
    const second = retainTips();
    const shell = fakeShell();
    const t = shell.trigger('Live', 100);
    dispatch(t, 'pointerover');
    second();
    second();
    expect(documentListeners('pointerover')).toBe(before);
    expect(shell.tip()!.hidden).toBe(false);
    release();
    release = () => {};
    expect(documentListeners('pointerover')).toBe(before - 1);
    expect(documentListeners('scroll')).toBe(0);
    expect(shell.tip()).toBeNull();
    expect(t.getAttribute('aria-describedby')).toBeNull();
    dispatch(t, 'pointerover');
    expect(shell.tip()).toBeNull();
  });
});

describe('standalone components', () => {
  it('a toolbar under a .pc-shell wrapper, without the chart shell, shows its tooltips until destroyed', () => {
    // Connected, the toolbar measures its fit.
    vi.stubGlobal('getComputedStyle', () => new Proxy({}, { get: () => '0' }));
    const wrapper = fakeContainer() as unknown as Node509 & { connected: boolean };
    wrapper.className = 'pc-shell';
    wrapper.connected = true;
    wrapper.getBoundingClientRect = () => rect(0, 0, 800, 400);
    const chart = new Chart(fakeContainer());
    const toolbar = createToolbar(wrapper as unknown as HTMLElement, chart, [print()]);
    const find = (n: Node509): Node509 | null => (n.getAttribute('data-tip') ? n : n.children.map(find).find(Boolean) ?? null);
    const button = find(toolbar.el as unknown as Node509)!;
    expect(button).not.toBeNull();
    dispatch(button, 'pointerover');
    const tip = wrapper.children.find((c) => c.className === 'pc-tip')!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe(button.getAttribute('data-tip'));
    toolbar.destroy();
    expect(wrapper.children.find((c) => c.className === 'pc-tip')).toBeUndefined();
    chart.destroy();
    vi.unstubAllGlobals();
  });

  it('an icon button shows its tooltip without any retained listener', () => {
    const shell = fakeShell();
    const b = iconButton({ icon: () => document.createElement('span') as unknown as Element, label: 'Zoom in' }) as unknown as Node509;
    shell.root.append(b);
    b.getBoundingClientRect = () => rect(10, 10, 28, 28);
    dispatch(b, 'pointerover');
    expect(shell.tip()!.textContent).toBe('Zoom in');
    dispatch(b, 'pointerout', { relatedTarget: null });
    expect(shell.tip()!.hidden).toBe(true);
  });
});
