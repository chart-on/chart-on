import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chart, darkTheme, lightTheme } from '@chart-on/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import {
  createAppearance,
  mergePatch,
  overridesDiff,
  resetSection,
  sanitizePatch,
  themeWithOverrides,
  type AppearancePatch,
} from '../src/appearance';
import { createColorControl, defaultSwatches, joinColor, splitColor } from '../src/color-control';

describe('color parts', () => {
  it('round-trips colors with and without opacity', () => {
    expect(splitColor('#3CC4A0')).toEqual({ hex: '#3cc4a0', alpha: 1 });
    expect(splitColor('rgba(60, 196, 160, 0.4)')).toEqual({ hex: '#3cc4a0', alpha: 0.4 });
    expect(joinColor({ hex: '#3cc4a0', alpha: 1 })).toBe('#3cc4a0');
    expect(joinColor({ hex: '#3cc4a0', alpha: 0.4 })).toBe('rgba(60, 196, 160, 0.4)');
    expect(joinColor({ hex: '#000000', alpha: 0 })).toBe('rgba(0, 0, 0, 0)');
    for (const color of ['#121217', 'rgba(36, 36, 45, 0.6)', 'rgba(255, 0, 0, 0.05)']) {
      expect(joinColor(splitColor(color))).toBe(color);
    }
  });

  it('clamps opacity', () => {
    expect(joinColor({ hex: '#ffffff', alpha: 2 })).toBe('#ffffff');
    expect(joinColor({ hex: '#ffffff', alpha: -1 })).toBe('rgba(255, 255, 255, 0)');
  });
});

describe('appearance overrides', () => {
  const patch: AppearancePatch = {
    theme: { up: '#00ff00', background: 'rgba(0, 0, 0, 0.5)' },
    grid: { vertical: { visible: false } },
  };

  it('merges at every depth, and removes overrides set to undefined', () => {
    expect(mergePatch(patch, { theme: { down: '#ff0000', up: undefined }, grid: { vertical: { color: '#111111' } } })).toEqual({
      theme: { background: 'rgba(0, 0, 0, 0.5)', down: '#ff0000' },
      grid: { vertical: { visible: false, color: '#111111' } },
    });
    expect(mergePatch({ grid: { vertical: { visible: false } } }, { grid: { vertical: { visible: undefined } } })).toEqual({});
  });

  it('resets one section', () => {
    expect(resetSection(patch, 'candles')).toEqual({ theme: { background: 'rgba(0, 0, 0, 0.5)' }, grid: patch.grid });
    expect(resetSection(patch, 'grid')).toEqual({ theme: patch.theme });
  });

  it('keeps overrides across a dark/light switch and updates the rest', () => {
    const dark = themeWithOverrides(darkTheme, patch);
    const light = themeWithOverrides(lightTheme, patch);
    expect([dark.up, light.up]).toEqual(['#00ff00', '#00ff00']);
    expect(dark.text).toBe(darkTheme.text);
    expect(light.text).toBe(lightTheme.text);
  });

  it('clears unset optional candle colors and the gradient bottom', () => {
    const theme = themeWithOverrides(darkTheme, {});
    expect('upWick' in theme && theme.upWick === undefined).toBe(true);
    expect('backgroundBottom' in theme && theme.backgroundBottom === undefined).toBe(true);
    expect(themeWithOverrides(darkTheme, { theme: { upWick: '#ffffff' } }).upWick).toBe('#ffffff');
    expect(themeWithOverrides(lightTheme, { theme: { backgroundBottom: '#eeeeee' } }).backgroundBottom).toBe('#eeeeee');
  });

  it('changes only the overrides that changed; a removed one falls back to its base value', () => {
    const base = { ...darkTheme, upWick: undefined };
    expect(overridesDiff({}, {}, base, {})).toEqual({});
    expect(overridesDiff({ theme: { up: '#00ff00' } }, { theme: { up: '#00ff00', down: '#ff0000' } }, base, {})).toEqual({ theme: { down: '#ff0000' } });
    const cleared = overridesDiff({ theme: { up: '#00ff00', upWick: '#ffffff' } }, {}, base, {});
    expect(cleared.theme).toEqual({ up: darkTheme.up, upWick: undefined });
    expect('upWick' in cleared.theme!).toBe(true);
    expect(
      overridesDiff({ grid: { horizontal: { color: '#111111', visible: false } } }, { grid: { vertical: { lineStyle: 'dotted' } } }, base, {
        horizontal: { lineStyle: 'dashed', visible: false },
      }),
    ).toEqual({ grid: { horizontal: { color: undefined, visible: false }, vertical: { lineStyle: 'dotted' } } });
    expect(overridesDiff({ grid: { vertical: { visible: false } } }, {}, base, {})).toEqual({ grid: { vertical: { visible: true } } });
  });

  it('accepts only known keys and values from storage', () => {
    expect(sanitizePatch(null)).toEqual({});
    expect(
      sanitizePatch({
        theme: { up: '#00ff00', fontSize: 30, heatmap: ['#000'], nope: '#fff', down: 5 },
        grid: { horizontal: { visible: 'no', color: '#111111', lineStyle: 'wavy' }, vertical: { lineStyle: 'dotted' }, diagonal: {} },
        extra: true,
      }),
    ).toEqual({ theme: { up: '#00ff00' }, grid: { horizontal: { color: '#111111' }, vertical: { lineStyle: 'dotted' } } });
  });

  it('drops strings that are not colors', () => {
    expect(
      sanitizePatch({
        theme: { up: 'not a color', down: '#ff0000', text: 'rgba(1, 2, 3, 0.5)', background: 'currentColor', crosshair: '#12345' },
        grid: { horizontal: { color: 'nope', visible: false }, vertical: { color: '#abc' } },
      }),
    ).toEqual({ theme: { down: '#ff0000', text: 'rgba(1, 2, 3, 0.5)' }, grid: { horizontal: { visible: false }, vertical: { color: '#abc' } } });
  });

  it('keeps a watermark name with text and drops an empty one', () => {
    expect(sanitizePatch({ watermarkText: ' Jo ' })).toEqual({ watermarkText: ' Jo ' });
    expect(sanitizePatch({ watermarkText: '  ' })).toEqual({});
    expect(sanitizePatch({ watermarkText: 3 })).toEqual({});
    expect(resetSection({ watermarkText: 'Jo', theme: { up: '#ff0000' } }, 'watermark')).toEqual({ theme: { up: '#ff0000' } });
    expect(resetSection({ watermarkText: 'Jo' }, 'grid')).toEqual({ watermarkText: 'Jo' });
  });

  it('keeps the logo choice and usable watermark sizes, and resets them with the watermark', () => {
    expect(sanitizePatch({ logo: false, watermarkSizes: { author: 20, symbol: 300, interval: 12.5, other: 30 } })).toEqual({
      logo: false,
      watermarkSizes: { author: 20 },
    });
    expect(sanitizePatch({ logo: 'no', watermarkSizes: 5 })).toEqual({});
    expect(resetSection({ logo: false, watermarkSizes: { symbol: 40 }, theme: { up: '#ff0000' } }, 'watermark')).toEqual({ theme: { up: '#ff0000' } });
  });
});

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  return c;
}

type Node = { children: Node[]; className: string; getAttribute(k: string): string | null; style: Record<string, string> };
function find(root: unknown, match: (n: Node) => boolean): Node | null {
  for (const child of (root as Node).children) {
    if (match(child)) return child;
    const found = find(child, match);
    if (found) return found;
  }
  return null;
}
const byLabel = (root: unknown, label: string) => find(root, (n) => n.getAttribute('aria-label') === label);
const panelOf = (c: Chart) => find(c.root, (n) => n.className === 'pc-appearance');

describe('appearance on a chart', () => {
  it('keeps changes made through the API when the panel commits', () => {
    const c = chart();
    const a = createAppearance(c, { storage: null, defaultPreset: null });
    c.applyOptions({ theme: { up: '#123456' }, grid: { vertical: { visible: false } } });
    a.set({ theme: { down: '#ff0000' } });
    expect([c.appearance().theme.up, c.appearance().theme.down, c.options.grid.vertical.visible]).toEqual(['#123456', '#ff0000', false]);
    a.set({ grid: { horizontal: { color: '#111111' } } });
    a.reset('grid');
    expect(c.appearance().grid.horizontal.color).toBe(darkTheme.grid);
    expect(c.options.grid.vertical.visible).toBe(false);
    a.set({ theme: { down: undefined } });
    expect([c.appearance().theme.up, c.appearance().theme.down]).toEqual(['#123456', darkTheme.down]);
    a.destroy();
  });

  it('applies only valid stored values, also from a custom storage', () => {
    const c = chart();
    const storage = { load: () => ({ theme: { up: 'garbage', down: '#ff0000', fontSize: 30 } }) as never, save: vi.fn() };
    const a = createAppearance(c, { storage });
    expect(a.overrides).toEqual({ theme: { down: '#ff0000' } });
    expect(c.appearance().theme.up).toBe(darkTheme.up);
    expect(c.appearance().theme.down).toBe('#ff0000');
    a.destroy();
  });

  it('keeps choices under its own storage key', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    const a = createAppearance(chart(), { storageKey: 'chart-a' });
    const b = createAppearance(chart());
    a.set({ theme: { up: '#00ff00' } });
    b.set({ theme: { up: '#0000ff' } });
    expect(JSON.parse(store.get('chart-a')!)).toEqual({ theme: { up: '#00ff00' } });
    expect(JSON.parse(store.get('charton:appearance')!)).toEqual({ theme: { up: '#0000ff' } });
    a.destroy();
    b.destroy();
  });

  it('shows unset wicks in the body color and unset borders as transparent', () => {
    const c = chart();
    const a = createAppearance(c, { storage: null });
    a.open();
    const chip = (label: string) => find(byLabel(panelOf(c), label), (n) => n.className === 'pc-color-chip')!.style.background;
    expect(chip('Rising wick')).toBe(darkTheme.up);
    expect(chip('Falling wick')).toBe(darkTheme.down);
    expect(chip('Rising border')).toBe('rgba(0, 0, 0, 0)');
    expect(chip('Falling border')).toBe('rgba(0, 0, 0, 0)');
    a.destroy();
  });

  it('keeps wheel, double-click and context menu events inside the panel', () => {
    const c = chart();
    const a = createAppearance(c, { storage: null });
    a.open();
    const reached = vi.fn();
    for (const type of ['wheel', 'dblclick', 'contextmenu']) c.root.addEventListener(type, reached);
    const panel = panelOf(c);
    const wheel = dispatch(panel, 'wheel', { deltaY: 120 });
    dispatch(panel, 'dblclick');
    dispatch(panel, 'contextmenu');
    expect(reached).not.toHaveBeenCalled();
    // Not prevented, so the panel still scrolls natively.
    expect(wheel.defaultPrevented).toBe(false);
    a.destroy();
  });

  it('edits the watermark name live, saves it and clears it on reset', () => {
    const c = chart();
    const save = vi.fn();
    const a = createAppearance(c, { storage: { load: () => ({ watermarkText: 'Jo' }), save } });
    expect(c.watermark.options.author).toBe('Jo');
    a.open();
    const input = byLabel(panelOf(c), 'Name') as unknown as HTMLInputElement;
    expect(input.value).toBe('Jo');
    input.value = 'Jo Doe';
    dispatch(input as never, 'input');
    expect(c.watermark.options.author).toBe('Jo Doe');
    expect(save).toHaveBeenLastCalledWith({ watermarkText: 'Jo Doe' });
    input.value = '   ';
    dispatch(input as never, 'input');
    expect(c.watermark.options.author).toBe('');
    expect(save).toHaveBeenLastCalledWith({});
    input.value = 'Jo Doe';
    dispatch(input as never, 'input');
    a.reset('watermark');
    expect(c.watermark.options.author).toBe('');
    expect(input.value).toBe('');
    expect(save).toHaveBeenLastCalledWith({});
    a.destroy();
  });

  it('turns the logo off and on from the panel, saves it and goes back to the app setting on reset', () => {
    const c = chart();
    const save = vi.fn();
    const a = createAppearance(c, { storage: { load: () => null, save } });
    a.open();
    const box = byLabel(panelOf(c), 'Show logo') as unknown as HTMLInputElement;
    expect(box.checked).toBe(true);
    box.checked = false;
    dispatch(box as never, 'change');
    expect(c.features.attributionLogo).toBe(false);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ logo: false }));
    a.reset('watermark');
    expect(c.features.attributionLogo).toBe(true);
    expect(box.checked).toBe(true);
    a.destroy();
  });

  it('applies a saved logo choice when created', () => {
    const c = chart();
    const a = createAppearance(c, { storage: { load: () => ({ logo: false }), save: () => {} } });
    expect(c.features.attributionLogo).toBe(false);
    a.destroy();
  });

  it('sizes the name, symbol and interval lines from the panel', () => {
    const c = chart();
    const save = vi.fn();
    const a = createAppearance(c, { storage: { load: () => ({ watermarkSizes: { author: 30 } }), save } });
    expect(c.watermark.options.authorSize).toBe(30);
    a.open();
    const panel = panelOf(c);
    const name = byLabel(panel, 'Name size') as unknown as HTMLInputElement;
    const symbol = byLabel(panel, 'Symbol size') as unknown as HTMLInputElement;
    const interval = byLabel(panel, 'Interval size') as unknown as HTMLInputElement;
    expect(name.value).toBe('30');
    symbol.value = '40';
    dispatch(symbol as never, 'input');
    interval.value = '14';
    dispatch(interval as never, 'input');
    expect(c.watermark.options.lineSizes).toEqual([40, 14]);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ watermarkSizes: { author: 30, symbol: 40, interval: 14 } }));
    // Out of range waits; empty goes back to the watermark's own size.
    symbol.value = '1000';
    dispatch(symbol as never, 'input');
    expect(c.watermark.options.lineSizes).toEqual([40, 14]);
    symbol.value = '';
    dispatch(symbol as never, 'input');
    expect(c.watermark.options.lineSizes).toEqual([null, 14]);
    a.reset('watermark');
    expect(c.watermark.options.authorSize).toBeNull();
    expect(c.watermark.options.lineSizes).toEqual([null, null]);
    a.destroy();
  });

  it('opens on a chart without the watermark() plugin, with no watermark name row', () => {
    const c = new Chart(fakeContainer(), { plugins: [] });
    charts.push(c);
    const a = createAppearance(c, { storage: { load: () => ({ watermarkText: 'Jo' }), save: () => {} } });
    expect(() => a.open()).not.toThrow();
    expect(byLabel(panelOf(c), 'Name')).toBeNull();
    expect(byLabel(panelOf(c), 'Symbol size')).toBeNull();
    // The logo is the chart's own, so its switch stays.
    expect(byLabel(panelOf(c), 'Show logo')).not.toBeNull();
    expect(() => a.set({ watermarkText: 'Jo Doe' })).not.toThrow();
    a.destroy();
  });

  it('reports open and close, and returns focus to where it was', () => {
    const c = chart();
    const onOpenChange = vi.fn();
    const a = createAppearance(c, { storage: null, onOpenChange });
    const toggle = document.createElement('button');
    c.root.append(toggle);
    toggle.focus();
    a.open();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(document.activeElement).not.toBe(toggle);
    a.close();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(toggle);
    a.destroy();
  });
});

describe('color control', () => {
  it('returns focus to its trigger when the picker closes', () => {
    chart();
    const control = createColorControl({ label: 'Up', value: '#ffffff', onInput() {} });
    const trigger = find(control.el, (n) => n.className === 'pc-color-trigger') as unknown as { dispatch(t: string): void };
    trigger.dispatch('click');
    expect(document.activeElement).not.toBe(trigger);
    control.destroy();
    expect(document.activeElement).toBe(trigger);
  });

  it('makes a fully transparent color visible when a swatch is picked', () => {
    chart();
    const onInput = vi.fn();
    const control = createColorControl({ label: 'Border', value: 'rgba(0, 0, 0, 0)', onInput });
    (find(control.el, (n) => n.className === 'pc-color-trigger') as unknown as { dispatch(t: string): void }).dispatch('click');
    (find(control.el, (n) => n.className === 'pc-swatch') as unknown as { dispatch(t: string): void }).dispatch('click');
    expect(onInput).toHaveBeenLastCalledWith('#ffffff');
    control.destroy();
  });

  it('moves between swatches with the arrow keys, a row of ten at a time, one Tab stop', () => {
    chart();
    const onInput = vi.fn();
    const control = createColorControl({ label: 'Up', value: '#ffffff', onInput });
    (find(control.el, (n) => n.className === 'pc-color-trigger') as unknown as { dispatch(t: string): void }).dispatch('click');
    const all: HTMLElement[] = [];
    const walk = (n: HTMLElement) => {
      if (n.className === 'pc-swatch') all.push(n);
      for (const c of Array.from(n.children ?? []) as HTMLElement[]) walk(c);
    };
    walk(control.el);
    expect(all).toHaveLength(defaultSwatches.length);
    expect(document.activeElement).toBe(all[0]);
    expect(all.filter((n) => n.tabIndex === 0)).toEqual([all[0]]);
    const key = (k: string) => dispatch(document.activeElement, 'keydown', { key: k });
    key('ArrowDown');
    expect(document.activeElement).toBe(all[10]);
    key('ArrowRight');
    expect(document.activeElement).toBe(all[11]);
    key('ArrowUp');
    key('ArrowLeft');
    expect(document.activeElement).toBe(all[0]);
    key('End');
    expect(document.activeElement).toBe(all[all.length - 1]);
    expect(all.filter((n) => n.tabIndex === 0)).toEqual([all[all.length - 1]]);
    key('Home');
    expect(document.activeElement).toBe(all[0]);
    expect(onInput).not.toHaveBeenCalled();
    control.destroy();
  });
});
