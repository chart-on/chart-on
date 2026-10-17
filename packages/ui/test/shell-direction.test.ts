import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import css from '../src/style.css?raw';
import { dispatch, fakeContainer, installFakeDom } from '../../core/test/fake-dom';
import { h, inlineKey, placePopover } from '../src/dom';
import { rovingFocus } from '../src/keyboard';
import { createChartShell, type ChartShell } from '../src/shell';

installFakeDom();

/** The direction an element inherits: its own or its nearest ancestor's `dir`, as a browser computes it. */
function directionOf(el: { getAttribute?(name: string): string | null; parentElement?: unknown } | null): string {
  for (let p = el; p; p = p.parentElement as typeof el) {
    const dir = p.getAttribute?.('dir');
    if (dir) return dir;
  }
  return 'ltr';
}

const shells: ChartShell[] = [];
beforeEach(() => {
  vi.stubGlobal('getComputedStyle', (el: Element) => ({ getPropertyValue: () => '', direction: directionOf(el) }));
  vi.stubGlobal('MutationObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
});
afterEach(() => {
  shells.splice(0).forEach((s) => s.destroy());
  vi.unstubAllGlobals();
});

function shell(options: Parameters<typeof createChartShell>[1] = {}) {
  const s = createChartShell(fakeContainer(), { toolbar: [], appearance: false, settings: false, ...options });
  shells.push(s);
  return s;
}

const press = (target: unknown, key: string) => dispatch(target, 'keydown', { key });

describe('shell direction', () => {
  it('follows the page by default and sets dir for ltr and rtl', () => {
    const s = shell();
    expect(s.direction).toBe('auto');
    expect(s.el.getAttribute('dir')).toBeNull();

    s.setDirection('rtl');
    expect(s.direction).toBe('rtl');
    expect(s.el.getAttribute('dir')).toBe('rtl');
    s.setDirection('ltr');
    expect(s.el.getAttribute('dir')).toBe('ltr');
    s.setDirection('auto');
    expect(s.el.getAttribute('dir')).toBeNull();

    expect(shell({ direction: 'rtl' }).el.getAttribute('dir')).toBe('rtl');
  });

  it('passes the direction on to the chart, whose main price axis follows it', () => {
    const s = shell({ direction: 'rtl' });
    const side = () => s.chart.getPriceScaleOptions(0)!.side;
    expect(s.chart.options.direction).toBe('rtl');
    expect(side()).toBe('left');
    s.setDirection('ltr');
    expect(side()).toBe('right');
    // `auto`: the chart reads the page's direction through the shell.
    s.setDirection('auto');
    expect(s.chart.options.direction).toBe('auto');
    expect(side()).toBe('right');
    expect(shell({ chart: { direction: 'ltr' }, direction: 'rtl' }).chart.getPriceScaleOptions(0)!.side).toBe('right');
  });
});

describe('arrow keys in right-to-left chrome', () => {
  it('swaps left and right only where the layout is right to left', () => {
    const rtl = h('div', { dir: 'rtl' }, h('button', {}));
    const ltr = h('button', {});
    const event = (target: unknown, key: string) => ({ key, target }) as unknown as KeyboardEvent;
    expect(inlineKey(event(rtl.firstElementChild, 'ArrowLeft'))).toBe('ArrowRight');
    expect(inlineKey(event(rtl.firstElementChild, 'ArrowRight'))).toBe('ArrowLeft');
    expect(inlineKey(event(rtl.firstElementChild, 'ArrowUp'))).toBe('ArrowUp');
    expect(inlineKey(event(ltr, 'ArrowLeft'))).toBe('ArrowLeft');
  });

  it('moves a toolbar the way the arrows point', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((label) => h('button', { type: 'button' }, label));
    const group = h('div', { role: 'toolbar', dir: 'rtl' }, a!, b!, c!);
    const roving = rovingFocus(group);
    roving.focus();
    // The buttons run from right to left: the left arrow goes to the next one.
    press(a, 'ArrowLeft');
    expect(document.activeElement).toBe(b);
    press(b, 'ArrowRight');
    expect(document.activeElement).toBe(a);
    press(a, 'ArrowRight');
    expect(document.activeElement).toBe(c);
    roving.destroy();
  });
});

describe('popover placement in right-to-left chrome', () => {
  function place(dir: 'ltr' | 'rtl') {
    Object.defineProperty(document, 'documentElement', { value: { clientWidth: 1000, clientHeight: 800 }, configurable: true });
    // A trigger near the viewport's left edge.
    const trigger = { getBoundingClientRect: () => ({ left: 20, right: 52, top: 8, bottom: 40 }) } as unknown as HTMLElement;
    const toggle = vi.fn();
    const list = Object.assign(h('div', {}), { offsetWidth: 240, scrollHeight: 100, classList: { toggle } });
    h('div', { dir }, list);
    placePopover(list, trigger);
    return toggle.mock.calls.find(([name]) => name === 'pc-popover--end')?.[1];
  }

  it('keeps a list at the trigger start when it fits, and flips it where it would leave the viewport', () => {
    expect(place('ltr')).toBe(false);
    // Right to left the list starts at the trigger's right edge and would cross the viewport's left edge.
    expect(place('rtl')).toBe(true);
  });
});

describe('stylesheet', () => {
  it('lays out chrome with logical margins, padding, borders and text alignment', () => {
    // The overview strip's handles sit on its time scale, which runs left to right.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\.pc-navigator-handle \{[^}]*\}/, '');
    expect(code).not.toMatch(/\b(margin|padding|border)-(left|right)\b|text-align:\s*(left|right)\b/);
    // A four-value shorthand sets the left and right sides apart.
    const sides = [...code.matchAll(/[\s;{](?:margin|padding):\s*([^;}]*)/g)].map(([, value]) =>
      value!.replace(/\w+\([^()]*(\([^()]*\)[^()]*)*\)/g, 'f').trim().split(/\s+/).length,
    );
    expect(sides.length).toBeGreaterThan(0);
    expect(sides.filter((n) => n > 3)).toEqual([]);
  });
});
