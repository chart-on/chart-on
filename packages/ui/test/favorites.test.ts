import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { createChartShell, type ChartShell, type ChartShellOptions } from '../src/shell';
import { favorites } from '../src/favorites';
import { favoriteChartStyles, favoriteIntervals } from '../src/favorites-toolbar';
import type { FavoritesRecord, FavoritesStorage } from '../src/favorites-model';

interface FakeNode {
  children: FakeNode[];
  hidden: boolean;
  dataset: Record<string, string>;
  getAttribute(name: string): string | null;
}
const fake = (el: unknown) => el as FakeNode;

function find(root: unknown, match: (n: FakeNode) => boolean): FakeNode | null {
  for (const child of fake(root).children) {
    if (match(child)) return child;
    const found = find(child, match);
    if (found) return found;
  }
  return null;
}
const byLabel = (root: unknown, label: string) => find(root, (n) => n.getAttribute('aria-label') === label);
/** Tool types of the bar's buttons, in order. */
const barTools = (s: ChartShell) => fake(s.favorites!.bar.el).children[1]!.children.map((b) => b.dataset.tool);

function memoryStorage(initial: unknown = null): FavoritesStorage & { saved: FavoritesRecord | null } {
  let data = initial;
  return {
    saved: null,
    load: () => data,
    save(record) {
      data = JSON.parse(JSON.stringify(record));
      this.saved = data as FavoritesRecord;
    },
  };
}

const shells: ChartShell[] = [];
beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});
afterEach(() => {
  shells.splice(0).forEach((s) => s.destroy());
  vi.unstubAllGlobals();
});

function shell(options: ChartShellOptions = {}) {
  const s = createChartShell(fakeContainer(), { toolbar: [], favorites: favorites({ storage: null }), ...options });
  shells.push(s);
  return s;
}

describe('shell favourites', () => {
  it('starts empty with the bar hidden until a tool is starred', () => {
    const s = shell();
    expect(s.favorites!.get()).toEqual([]);
    expect(s.favorites!.bar.visible).toBe(true);
    expect(s.favorites!.bar.el.hidden).toBe(true);
    s.favorites!.add('trendline');
    expect(s.favorites!.bar.el.hidden).toBe(false);
    expect(barTools(s)).toEqual(['trendline']);
    expect(byLabel(s.favorites!.bar.el, 'Trend line')).not.toBeNull();
  });

  it('skips unknown tools and repeats, and reports changes', () => {
    const s = shell();
    const changes: string[][] = [];
    s.favorites!.on('change', ({ types }) => changes.push(types));
    s.favorites!.set(['ray', 'nope', 'ray', 'trendline']);
    s.favorites!.add('nope');
    s.favorites!.add('ray');
    s.favorites!.remove('ray');
    s.favorites!.remove('missing');
    expect(changes).toEqual([['ray', 'trendline'], ['trendline']]);
    expect(() => s.favorites!.set('ray' as never)).toThrow(/array/);
  });

  it('arms a tool from the bar and highlights the active one', () => {
    const s = shell({ favorites: favorites({ storage: null, tools: ['trendline', 'ray'] }) });
    const ray = byLabel(s.favorites!.bar.el, 'Ray')!;
    dispatch(ray, 'click');
    expect(s.chart.drawings.tool).toBe('ray');
    expect(ray.getAttribute('aria-pressed')).toBe('true');
    expect(byLabel(s.favorites!.bar.el, 'Trend line')!.getAttribute('aria-pressed')).toBe('false');
    dispatch(ray, 'click');
    expect(s.chart.drawings.tool).toBeNull();
  });

  it('stars a tool from a rail flyout, keeping the flyout open', () => {
    const s = shell();
    dispatch(byLabel(s.rail!.el, 'More lines')!, 'click');
    const star = byLabel(s.rail!.el, 'Add Ray to favourites')!;
    expect(star.getAttribute('aria-checked')).toBe('false');
    dispatch(star, 'click');
    expect(s.favorites!.get()).toEqual(['ray']);
    expect(star.getAttribute('aria-checked')).toBe('true');
    expect(star.getAttribute('aria-label')).toBe('Remove Ray from favourites');
    expect(s.rail!.el.querySelector('.pc-popover')).not.toBeNull();
    dispatch(star, 'click');
    expect(s.favorites!.get()).toEqual([]);
    expect(s.favorites!.bar.el.hidden).toBe(true);
  });

  it('hides and shows the bar from the rail', () => {
    const s = shell({ favorites: favorites({ storage: null, tools: ['ray'] }) });
    const toggle = byLabel(s.rail!.el, 'Favourites bar')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    dispatch(toggle, 'click');
    expect(s.favorites!.bar.visible).toBe(false);
    expect(s.favorites!.bar.el.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    s.favorites!.bar.toggle();
    expect(s.favorites!.bar.el.hidden).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('tells the toast stack the room the bar takes, and none while it is hidden', () => {
    const s = shell({ favorites: favorites({ storage: null, tools: ['ray'] }) });
    // The stage, which holds the chart and the toast stack.
    const stage = s.chart.root.parentElement!;
    const room = (edge: 'top' | 'bottom') => (stage.style as unknown as Record<string, string>)[`--pc-favorites-${edge}`];
    // The bar starts at the bottom of the plot: toasts stack above it.
    const corner = /translate\(([\d.]+)px, ([\d.]+)px\)/.exec(s.favorites!.bar.el.style.transform)!;
    expect(room('bottom')).toBe(`${s.chart.height - Number(corner[2]) + 8}px`);
    expect(room('top')).toBe('');
    s.favorites!.bar.setVisible(false);
    expect(room('bottom')).toBe('');
    s.favorites!.bar.setVisible(true);
    expect(room('bottom')).not.toBe('');
    s.destroy();
    shells.splice(shells.indexOf(s), 1);
    expect(room('bottom')).toBe('');
  });

  it('reorders with Alt and the arrow keys', () => {
    const s = shell({ favorites: favorites({ storage: null, tools: ['trendline', 'ray', 'hline'] }) });
    const trend = byLabel(s.favorites!.bar.el, 'Trend line')!;
    dispatch(trend, 'keydown', { key: 'ArrowRight', altKey: true });
    expect(s.favorites!.get()).toEqual(['ray', 'trendline', 'hline']);
    // Without Alt the arrow keys do not reorder, and never reach the chart.
    const e = dispatch(byLabel(s.favorites!.bar.el, 'Trend line')!, 'keydown', { key: 'ArrowRight' });
    expect(s.favorites!.get()).toEqual(['ray', 'trendline', 'hline']);
    expect(e.defaultPrevented).toBe(false);
    dispatch(byLabel(s.favorites!.bar.el, 'Ray')!, 'keydown', { key: 'ArrowUp', altKey: true });
    expect(s.favorites!.get()).toEqual(['ray', 'trendline', 'hline']);
  });

  it('hides tools access denies but keeps them, in place, when reordering', () => {
    const s = shell({ favorites: favorites({ storage: null, tools: ['trendline', 'ray', 'hline'] }) });
    s.chart.drawings.setAccess(({ id }) => id !== 'ray');
    expect(barTools(s)).toEqual(['trendline', 'hline']);
    dispatch(byLabel(s.favorites!.bar.el, 'Horizontal line')!, 'keydown', { key: 'ArrowLeft', altKey: true });
    expect(s.favorites!.get()).toEqual(['hline', 'ray', 'trendline']);
    s.chart.drawings.setAccess(null);
    expect(barTools(s)).toEqual(['hline', 'ray', 'trendline']);
  });

  it('switches the layout from the bar', () => {
    const s = shell({ favorites: favorites({ storage: null, tools: ['ray'] }) });
    expect(s.favorites!.bar.el.dataset.orientation).toBe('horizontal');
    dispatch(byLabel(s.favorites!.bar.el, 'Lay out vertically')!, 'click');
    expect(s.favorites!.bar.orientation).toBe('vertical');
    expect(s.favorites!.bar.el.dataset.orientation).toBe('vertical');
    expect(s.favorites!.bar.el.getAttribute('aria-orientation')).toBe('vertical');
    expect(byLabel(s.favorites!.bar.el, 'Lay out horizontally')).not.toBeNull();
    expect(() => s.favorites!.bar.setOrientation('sideways' as never)).toThrow();
  });

  it('saves favourites, order, layout and position, and restores them', () => {
    const storage = memoryStorage();
    const s = shell({ favorites: favorites({ storage, tools: ['trendline'] }) });
    s.favorites!.set(['ray', 'trendline']);
    s.favorites!.bar.setOrientation('vertical');
    const handle = byLabel(s.favorites!.bar.el, 'Move favourites bar')!;
    const before = storage.saved!.bar.x;
    dispatch(handle, 'keydown', { key: 'ArrowLeft', shiftKey: true });
    expect(storage.saved!.bar.x).toBeLessThan(before);
    expect(storage.saved!.items.tool).toEqual(['ray', 'trendline']);

    // Saved favourites win over the `tools` option.
    const again = shell({ favorites: favorites({ storage, tools: ['hline'] }) });
    expect(again.favorites!.get()).toEqual(['ray', 'trendline']);
    expect(again.favorites!.bar.orientation).toBe('vertical');
  });

  it('starts the bar on the plot edge the legend does not use, and keeps a saved place', () => {
    const startY = (options: ChartShellOptions) => {
      const storage = memoryStorage();
      shell({ ...options, favorites: favorites({ storage, tools: ['ray'] }) }).favorites!.add('hline');
      return storage.saved!.bar.y;
    };
    expect(startY({})).toBe(1);
    expect(startY({ chart: { legend: { position: 'bottom-left' } } })).toBe(0);
    const saved = memoryStorage({ version: 1, items: { tool: ['ray'] }, bar: { x: 0.2, y: 0.3 } });
    shell({ favorites: favorites({ storage: saved }) }).favorites!.add('hline');
    expect(saved.saved!.bar).toMatchObject({ x: 0.2, y: 0.3 });
  });

  it('keeps saved kinds it does not use and saved tools it does not register, and tolerates bad saved data', () => {
    const storage = memoryStorage({ version: 1, items: { tool: ['ray', 'gone', 4], interval: ['1D'] }, bar: { x: 'far' } });
    const s = shell({ favorites: favorites({ storage }) });
    expect(s.favorites!.get()).toEqual(['ray', 'gone']);
    expect(barTools(s)).toEqual(['ray']);
    expect(s.favorites!.of('tool').isAvailable('gone')).toBe(false);
    s.favorites!.add('hline');
    expect(storage.saved!.items).toEqual({ tool: ['ray', 'gone', 'hline'], interval: ['1D'] });
    // A get, change and set keeps the unregistered tool; a new unknown one is still skipped.
    s.favorites!.set([...s.favorites!.get(), 'nope'].reverse());
    expect(s.favorites!.get()).toEqual(['hline', 'gone', 'ray']);
    expect(shell({ favorites: favorites({ storage: memoryStorage('garbage'), tools: ['ray'] }) }).favorites!.get()).toEqual(['ray']);
  });

  it('carries on when a custom storage throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage: FavoritesStorage = {
      load: () => {
        throw new Error('load failed');
      },
      save: () => {
        throw new Error('save failed');
      },
    };
    const s = shell({ favorites: favorites({ storage, tools: ['ray'] }) });
    expect(s.favorites!.get()).toEqual(['ray']);
    s.favorites!.add('hline');
    expect(s.favorites!.get()).toEqual(['ray', 'hline']);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('is absent without the favorites part', () => {
    const s = shell({ favorites: undefined });
    expect(s.favorites).toBeNull();
    expect(byLabel(s.rail!.el, 'Favourites bar')).toBeNull();
    dispatch(byLabel(s.rail!.el, 'More lines')!, 'click');
    expect(byLabel(s.rail!.el, 'Add Ray to favourites')).toBeNull();
  });

  it('removes the bar with the shell', () => {
    const s = shell({ favorites: favorites({ storage: null, tools: ['ray'] }) });
    const bar = s.favorites!.bar.el as unknown as { parent: unknown };
    expect(bar.parent).toBe(s.chart.root);
    s.destroy();
    shells.splice(shells.indexOf(s), 1);
    expect(bar.parent).toBeNull();
  });
});

describe('favourites of other kinds', () => {
  it('ignores saved kinds that are special object keys', () => {
    const items = JSON.parse('{"tool":["ray"],"__proto__":["x"],"constructor":["y"],"prototype":["z"],"symbol":["AAA"]}');
    const storage = memoryStorage({ version: 1, items });
    const s = shell({ favorites: favorites({ storage }) });
    expect(s.favorites!.of('symbol').get()).toEqual(['AAA']);
    s.favorites!.add('trendline');
    expect(storage.saved!.items).toEqual({ tool: ['ray', 'trendline'], symbol: ['AAA'] });
    expect(Object.getPrototypeOf(storage.saved!.items)).toBe(Object.prototype);
  });

  it('keeps each kind in order, once, and saves it with the tools in one record', () => {
    const storage = memoryStorage();
    const s = shell({ favorites: favorites({ storage }) });
    const intervals = s.favorites!.of('interval');
    expect(intervals.kind).toBe('interval');
    intervals.set(['1h', '', '1D', '1h', '5m']);
    expect(intervals.get()).toEqual(['1h', '1D', '5m']);
    intervals.add('1W');
    intervals.add('1D');
    intervals.remove('1h');
    expect(intervals.has('1W')).toBe(true);
    expect(intervals.has('1h')).toBe(false);
    intervals.move(2, 0);
    expect(intervals.get()).toEqual(['1W', '1D', '5m']);
    s.favorites!.add('ray');
    expect(storage.saved!.items).toEqual({ tool: ['ray'], interval: ['1W', '1D', '5m'] });
    intervals.clear();
    expect(s.favorites!.of('interval').get()).toEqual([]);
    expect(s.favorites!.get()).toEqual(['ray']);
  });

  it('restores saved kinds and shares the tool list with of(tool)', () => {
    const storage = memoryStorage({ version: 1, items: { tool: ['ray'], symbol: ['AAA', 'BBB'] } });
    const s = shell({ favorites: favorites({ storage }) });
    expect(s.favorites!.of('symbol').get()).toEqual(['AAA', 'BBB']);
    const tools = s.favorites!.of('tool');
    expect(tools.get()).toEqual(['ray']);
    tools.add('not-a-tool');
    tools.add('trendline');
    expect(s.favorites!.get()).toEqual(['ray', 'trendline']);
    expect(barTools(s)).toEqual(['ray', 'trendline']);
    tools.move(1, 0);
    expect(barTools(s)).toEqual(['trendline', 'ray']);
  });

  it('notifies listeners of the changed kind only', () => {
    const s = shell();
    const symbols = vi.fn();
    const toolEvents = vi.fn();
    const tools = vi.fn();
    const off = s.favorites!.of('symbol').on('change', symbols);
    s.favorites!.of('tool').on('change', tools);
    s.favorites!.on('change', toolEvents);
    s.favorites!.of('symbol').add('AAA');
    s.favorites!.of('symbol').add('AAA');
    expect(symbols).toHaveBeenCalledTimes(1);
    expect(symbols).toHaveBeenLastCalledWith({ items: ['AAA'] });
    expect(toolEvents).not.toHaveBeenCalled();
    s.favorites!.add('ray');
    expect(tools).toHaveBeenLastCalledWith({ items: ['ray'] });
    expect(toolEvents).toHaveBeenLastCalledWith({ types: ['ray'] });
    expect(symbols).toHaveBeenCalledTimes(1);
    off();
    s.favorites!.of('symbol').clear();
    expect(symbols).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty kind and a list that is not an array', () => {
    const s = shell();
    expect(() => s.favorites!.of('')).toThrow();
    for (const kind of ['__proto__', 'constructor', 'prototype']) expect(() => s.favorites!.of(kind)).toThrow();
    expect(() => s.favorites!.of('symbol').set('AAA' as unknown as string[])).toThrow();
  });
});

describe('favourite kinds, limits and the envelope', () => {
  it('refuses to star past a limit instead of evicting, and reports it', () => {
    const s = shell({ favorites: favorites({ storage: null, kinds: [{ id: 'interval', limit: 2 }] }) });
    const intervals = s.favorites!.of('interval');
    const limits = vi.fn();
    s.favorites!.on('limit', limits);
    expect(intervals.limit).toBe(2);
    expect(intervals.add('1m')).toBe(true);
    expect(intervals.add('1h')).toBe(true);
    expect(intervals.add('1D')).toBe(false);
    expect(intervals.add('1h')).toBe(false);
    expect(intervals.get()).toEqual(['1m', '1h']);
    expect(limits).toHaveBeenCalledTimes(1);
    expect(limits).toHaveBeenLastCalledWith({ kind: 'interval', ref: '1D', limit: 2 });
    intervals.set(['5m', '15m', '30m']);
    expect(intervals.get()).toEqual(['5m', '15m']);
    expect(limits).toHaveBeenLastCalledWith({ kind: 'interval', ref: '30m', limit: 2 });
  });

  it('caps every kind at 30 by default, tools included', () => {
    const s = shell();
    const symbols = s.favorites!.of('symbol');
    symbols.set(Array.from({ length: 40 }, (_, i) => `S${i}`));
    expect(symbols.get()).toHaveLength(30);
    expect(symbols.add('S99')).toBe(false);
    expect(s.favorites!.of('tool').limit).toBe(30);
  });

  it('reports a change of any kind through list:change', () => {
    const s = shell();
    const changes: { kind: string; items: string[] }[] = [];
    s.favorites!.on('list:change', (e) => changes.push(e));
    s.favorites!.of('symbol').add('AAA');
    s.favorites!.add('ray');
    expect(changes).toEqual([
      { kind: 'symbol', items: ['AAA'] },
      { kind: 'tool', items: ['ray'] },
    ]);
  });

  it('uses and checks references through a registered kind', () => {
    const s = shell();
    const used: string[] = [];
    const listed = new Set(['AAA']);
    const off = s.favorites!.registerKind({ id: 'symbol', limit: 5, isAvailable: (ref) => listed.has(ref), activate: (ref) => used.push(ref) });
    const symbols = s.favorites!.of('symbol');
    symbols.set(['AAA', 'GONE']);
    expect(symbols.limit).toBe(5);
    expect(symbols.isAvailable('GONE')).toBe(false);
    expect(symbols.activate('GONE')).toBe(false);
    expect(symbols.activate('AAA')).toBe(true);
    expect(used).toEqual(['AAA']);
    // Unavailable references stay starred.
    expect(symbols.get()).toEqual(['AAA', 'GONE']);
    off();
    expect(symbols.limit).toBe(30);
    expect(symbols.activate('AAA')).toBe(false);
    expect(() => s.favorites!.registerKind({ id: '__proto__' })).toThrow();
    expect(() => s.favorites!.registerKind({ id: 'symbol', limit: -1 })).toThrow();
  });

  it('arms a starred tool through activate', () => {
    const s = shell({ favorites: favorites({ storage: null, tools: ['ray'] }) });
    expect(s.favorites!.of('tool').activate('ray')).toBe(true);
    expect(s.chart.drawings.tool).toBe('ray');
    // Activating the armed tool keeps it armed.
    s.favorites!.of('tool').activate('ray');
    expect(s.chart.drawings.tool).toBe('ray');
    // A registered tool kind changes the limit and keeps the built-in behaviour.
    s.favorites!.registerKind({ id: 'tool', limit: 3 });
    expect(s.favorites!.of('tool').limit).toBe(3);
    s.chart.drawings.setTool(null);
    expect(s.favorites!.of('tool').activate('ray')).toBe(true);
    expect(s.chart.drawings.tool).toBe('ray');
  });

  it('round-trips every kind through export and import, keeping unknown kinds and references', () => {
    const storage = memoryStorage();
    const s = shell({ favorites: favorites({ storage }) });
    s.favorites!.set(['ray', 'trendline']);
    s.favorites!.of('interval').set(['1h', '1D']);
    s.favorites!.of('chart-style').set(['line']);
    s.favorites!.of('indicator').set(['rsi', 'ema']);
    s.favorites!.of('symbol').set(['AAA', 'DELISTED']);
    s.favorites!.of('host-kind').set(['x']);
    s.favorites!.bar.setOrientation('vertical');
    const envelope = JSON.parse(JSON.stringify(s.favorites!.export()));
    expect(envelope.version).toBe(1);

    const otherStorage = memoryStorage();
    const other = shell({ favorites: favorites({ storage: otherStorage }) });
    const changed = vi.fn();
    other.favorites!.on('list:change', changed);
    expect(other.favorites!.import({ ...envelope, items: { ...envelope.items, tool: ['ray', 'trendline', 'unregistered'] } })).toBe(true);
    expect(other.favorites!.get()).toEqual(['ray', 'trendline', 'unregistered']);
    expect(barTools(other)).toEqual(['ray', 'trendline']);
    for (const kind of ['interval', 'chart-style', 'indicator', 'symbol', 'host-kind']) {
      expect(other.favorites!.of(kind).get()).toEqual(envelope.items[kind]);
    }
    expect(other.favorites!.bar.orientation).toBe('vertical');
    expect(changed).toHaveBeenCalledTimes(6);
    // The import is saved, and loads back the same.
    const reloaded = shell({ favorites: favorites({ storage: otherStorage }) });
    expect(reloaded.favorites!.export()).toEqual(other.favorites!.export());
    expect(storage.saved!.items.symbol).toEqual(['AAA', 'DELISTED']);
  });

  it('refuses an envelope of another version or shape', () => {
    const s = shell({ favorites: favorites({ storage: null, tools: ['ray'] }) });
    expect(s.favorites!.import({ version: 2, items: { tool: ['hline'] } })).toBe(false);
    expect(s.favorites!.import('nonsense')).toBe(false);
    expect(s.favorites!.get()).toEqual(['ray']);
  });

  it('saves to a settings adapter under the favorites key', () => {
    const values = new Map<string, string>();
    const settings = { get: (k: string) => values.get(k) ?? null, set: (k: string, v: string) => void values.set(k, v), remove: (k: string) => void values.delete(k) };
    const s = shell({ favorites: favorites({ settings }) });
    s.favorites!.of('interval').add('4h');
    expect(JSON.parse(values.get('favorites')!)).toMatchObject({ version: 1, items: { interval: ['4h'] } });
    expect(shell({ favorites: favorites({ settings }) }).favorites!.of('interval').get()).toEqual(['4h']);
  });
});

describe('favourite interval and chart style strips', () => {
  // Menus place their list against the viewport.
  beforeEach(() => {
    (document as unknown as Record<string, unknown>).documentElement = { clientWidth: 1200, clientHeight: 800 };
  });
  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).documentElement;
  });
  const values = (el: unknown) => fake(el).children.map((b) => b.dataset.value);
  const hasClass = (cls: string) => (n: FakeNode) => String((n as unknown as { className: string }).className).split(/\s+/).includes(cls);
  const menuOf = (s: ChartShell, id: string) => find(s.toolbar!.get(id)!.el, hasClass('pc-menu-trigger'));
  const strip = (s: ChartShell, id: string) =>
    find(s.toolbar!.get(id)!.el, (n) => String((n as unknown as { className: string }).className).split(/\s+/).includes('pc-favorite-strip'))!;

  it('shows the starred intervals as buttons and stars them from the menu', () => {
    const onChange = vi.fn();
    const s = shell({ toolbar: [favoriteIntervals(['1m', '5m', '1h', '1d'], { onChange })] });
    const buttons = strip(s, 'interval');
    expect(buttons.hidden).toBe(true);
    s.favorites!.of('interval').set(['1d', '5m', '4h']);
    // Starred order; an interval the preset does not list is skipped, and stays starred.
    expect(values(buttons)).toEqual(['1d', '5m']);
    expect(s.favorites!.of('interval').get()).toEqual(['1d', '5m', '4h']);
    dispatch(byLabel(buttons, '5m') ?? fake(buttons).children[1]!, 'click');
    expect(onChange).toHaveBeenCalledWith('5m', s.chart);

    dispatch(menuOf(s, 'interval')!, 'click');
    const star = byLabel(s.toolbar!.get('interval')!.el, 'Add 1h to favorites')!;
    expect(star.getAttribute('aria-checked')).toBe('false');
    dispatch(star, 'click');
    expect(s.favorites!.of('interval').get()).toEqual(['1d', '5m', '4h', '1h']);
    expect(star.getAttribute('aria-checked')).toBe('true');
    expect(values(strip(s, 'interval'))).toEqual(['1d', '5m', '1h']);
    // A change made elsewhere shows in the open menu.
    s.favorites!.of('interval').remove('1h');
    expect(star.getAttribute('aria-checked')).toBe('false');
  });

  it('marks the current interval and switches from the menu', () => {
    const onChange = vi.fn();
    const s = shell({ toolbar: [favoriteIntervals(['1m', '1h'], { onChange, value: '1h' })] });
    s.favorites!.of('interval').set(['1m', '1h']);
    expect(fake(strip(s, 'interval')).children.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    dispatch(menuOf(s, 'interval')!, 'click');
    const option = find(s.toolbar!.get('interval')!.el, (n) => n.getAttribute('role') === 'menuitemradio' && n.getAttribute('aria-checked') === 'false')!;
    dispatch(option, 'click');
    expect(onChange).toHaveBeenCalledWith('1m', s.chart);
  });

  it('lists every interval as a button without the favorites part', () => {
    const s = shell({ favorites: undefined, toolbar: [favoriteIntervals(['1m', '1h'], { onChange: () => {} })] });
    expect(values(strip(s, 'interval'))).toEqual(['1m', '1h']);
    expect(menuOf(s, 'interval')).toBeNull();
  });

  it('applies a starred chart style from its button', () => {
    const s = shell({ toolbar: [favoriteChartStyles()] });
    s.chart.addCandles({ title: 'Price' });
    s.favorites!.of('chart-style').set(['line', 'bars']);
    const buttons = strip(s, 'style');
    expect(values(buttons)).toEqual(['line', 'bars']);
    dispatch(byLabel(buttons, 'Line')!, 'click');
    expect(s.chart.main!.options.style).toBe('line');
    expect(byLabel(buttons, 'Line')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows candles for a starred chart style that is no longer listed, such as hlcArea before its rename', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = shell({ toolbar: [favoriteChartStyles()] });
    s.chart.addCandles({ title: 'Price' });
    s.favorites!.of('chart-style').set(['hlcArea', 'rangeBand', 'candles']);
    // Candles once, where the old style was starred.
    expect(values(strip(s, 'style'))).toEqual(['candles', 'rangeBand']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('charton [option-range]: the starred chart-style "hlcArea" is unknown, so candles is shown'));
    // The reference stays as stored; unstarring it is the user's call.
    expect(s.favorites!.of('chart-style').get()).toEqual(['hlcArea', 'rangeBand', 'candles']);
    warn.mockRestore();
  });

  it('tells the user when the menu cannot star any more', () => {
    const notices: string[] = [];
    const s = shell({
      favorites: favorites({ storage: null, kinds: [{ id: 'interval', limit: 1 }] }),
      toolbar: [favoriteIntervals(['1m', '1h'], { onChange: () => {} })],
    });
    s.chart.on('ui:notify', (e) => notices.push(e.message));
    s.favorites!.of('interval').add('1m');
    dispatch(menuOf(s, 'interval')!, 'click');
    dispatch(byLabel(s.toolbar!.get('interval')!.el, 'Add 1h to favorites')!, 'click');
    expect(s.favorites!.of('interval').get()).toEqual(['1m']);
    expect(notices).toEqual(['1h not added: favorites hold at most 1']);
  });
});
