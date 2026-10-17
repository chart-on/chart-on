// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChart, type Chart } from '@charton/core';
import { builtinIndicators } from '@charton/indicators';
import { fakeWebgl2 } from '../../core/src/testing/environment';
import { createFavorites } from '../src/favorites';
import { createIndicatorPicker, type IndicatorPickerOptions } from '../src/indicator-picker';
import type { IndicatorPickerMemory, IndicatorPickerStorage } from '../src/indicator-picker-model';
import { modalOpen } from '../src/shortcuts';

/** A Canvas2D context whose every call does nothing and returns something callable. */
function context2d(): unknown {
  const sink: unknown = new Proxy(() => sink, {
    get: (_t, key) => (key === 'measureText' ? (text: string) => ({ width: text.length * 6 }) : key === Symbol.toPrimitive ? () => 0 : sink),
    set: () => true,
    apply: () => sink,
  });
  return sink;
}

/** Storage kept in a plain object, so several pickers can share it like they share a `localStorage` key. */
function memoryStorage(): IndicatorPickerStorage & { stored: IndicatorPickerMemory | null } {
  return {
    stored: null,
    load() {
      return this.stored;
    },
    save(memory) {
      this.stored = { recents: [...memory.recents], favorites: [...memory.favorites] };
    },
  };
}

type Tracked = { target: EventTarget; type: string; fn: unknown; capture: boolean };

/** Listeners attached to `targets` and not removed yet, counted through `addEventListener` and `removeEventListener`. */
function trackListeners(targets: EventTarget[]): () => number {
  const live: Tracked[] = [];
  const captureOf = (options: unknown) => options === true || (typeof options === 'object' && options !== null && Boolean((options as { capture?: boolean }).capture));
  for (const target of targets) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type, fn, options) => {
      const capture = captureOf(options);
      if (!live.some((l) => l.target === target && l.type === type && l.fn === fn && l.capture === capture)) {
        live.push({ target, type, fn, capture });
      }
      add(type, fn, options);
    });
    vi.spyOn(target, 'removeEventListener').mockImplementation((type, fn, options) => {
      const capture = captureOf(options);
      const at = live.findIndex((l) => l.target === target && l.type === type && l.fn === fn && l.capture === capture);
      if (at >= 0) live.splice(at, 1);
      remove(type, fn, options);
    });
  }
  return () => live.length;
}

/** Chart event subscriptions not yet unsubscribed. */
function trackChartListeners(chart: Chart): () => number {
  let live = 0;
  const on = chart.on.bind(chart);
  vi.spyOn(chart, 'on').mockImplementation(((event: never, listener: never) => {
    const off = on(event, listener);
    live++;
    let done = false;
    return () => {
      if (!done) {
        done = true;
        live--;
      }
      off();
    };
  }) as typeof chart.on);
  return () => live;
}

let container: HTMLElement;
let chart: Chart;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    type === 'webgl2' ? fakeWebgl2() : context2d()) as never);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  container = document.createElement('div');
  document.body.append(container);
  chart = createChart(container);
  for (const def of builtinIndicators) chart.indicators.register(def);
});

afterEach(() => {
  chart.destroy();
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function picker(options: IndicatorPickerOptions = {}) {
  return createIndicatorPicker(chart, { debounce: 0, storage: null, ...options });
}

const options = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[role="option"]')];
const optionFor = (el: HTMLElement, id: string) =>
  options(el).find((o) => o.id && o.getAttribute('aria-label')?.startsWith(builtinIndicators.find((d) => d.id === id)!.name));

describe('indicator picker lifecycle', () => {
  it('returns document, window, chart and shortcut listeners to their baseline after close and destroy', () => {
    const slash = document.createElement('div');
    container.append(slash);
    const domListeners = trackListeners([document, window, chart.root, slash]);
    const chartListeners = trackChartListeners(chart);
    const before = { dom: domListeners(), chart: chartListeners() };

    const handle = picker({ openOnSlash: slash });
    const created = { dom: domListeners(), chart: chartListeners() };
    expect(created.dom).toBeGreaterThan(before.dom); // the `/` shortcut on `slash`

    handle.open();
    expect(handle.isOpen).toBe(true);
    expect(domListeners()).toBeGreaterThan(created.dom);
    expect(chartListeners()).toBeGreaterThan(created.chart);
    handle.close();
    expect({ dom: domListeners(), chart: chartListeners() }).toEqual(created);

    // Destroying while open closes first.
    handle.open();
    handle.destroy();
    expect({ dom: domListeners(), chart: chartListeners() }).toEqual(before);
    expect(handle.el.isConnected).toBe(false);
    expect(chart.actions.has('indicator-picker')).toBe(false);
  });

  it('marks itself modal only while open, so shortcuts outside it still run (#672)', () => {
    const handle = picker();
    expect(modalOpen()).toBe(false);
    handle.open();
    expect(modalOpen()).toBe(true);
    handle.close();
    expect(modalOpen()).toBe(false);
  });

  it('makes its siblings inert while open, leaving ones inert already as they were', () => {
    const handle = picker();
    const host = handle.el.parentElement!;
    const sibling = document.createElement('div');
    const inertAlready = document.createElement('div');
    inertAlready.setAttribute('inert', '');
    host.prepend(sibling, inertAlready);
    handle.open();
    expect(sibling.hasAttribute('inert')).toBe(true);
    expect(handle.el.hasAttribute('inert')).toBe(false);
    handle.close();
    expect(sibling.hasAttribute('inert')).toBe(false);
    expect(inertAlready.hasAttribute('inert')).toBe(true);
    handle.destroy();
  });
});

describe('indicator picker rows', () => {
  it('keeps options text-only, with the row buttons beside them in a presentational row', () => {
    const handle = picker({ actions: [{ id: 'info', label: 'About', icon: [], onClick: () => {} }] });
    handle.open();
    const all = options(handle.el);
    expect(all.length).toBeGreaterThan(0);
    for (const option of all) {
      expect(option.querySelector('button')).toBeNull();
      expect(option.parentElement!.getAttribute('role')).toBe('presentation');
    }
    const row = optionFor(handle.el, 'sma')!.parentElement!;
    expect(row.querySelectorAll('button').length).toBeGreaterThanOrEqual(2); // star and the host action
    handle.destroy();
  });

  it('shows the default inputs after the name and in the accessible name', () => {
    const handle = picker();
    handle.open();
    const sma = optionFor(handle.el, 'sma')!;
    expect(sma.querySelector('.pc-indicator-picker-inputs')?.textContent).toBe('20, close');
    expect(sma.getAttribute('aria-label')).toMatch(/^SMA, 20, close, /);
    // A custom legend title decides: RSI's shows the length, not its guide levels.
    expect(optionFor(handle.el, 'rsi')!.querySelector('.pc-indicator-picker-inputs')?.textContent).toBe('14');
    handle.destroy();
  });

  it('adds from the Add button of a row and stays open', () => {
    const handle = picker();
    handle.open('sma');
    const row = optionFor(handle.el, 'sma')!.parentElement!;
    const add = row.querySelector<HTMLButtonElement>('.pc-indicator-picker-add')!;
    expect(add.getAttribute('aria-label')).toBe('Add SMA to the chart');
    // The first result is active, so its Add button is the one Tab reaches.
    expect(row.hasAttribute('data-active')).toBe(true);
    expect(add.tabIndex).toBe(0);
    const others = [...handle.el.querySelectorAll<HTMLButtonElement>('.pc-indicator-picker-add')].filter((b) => b !== add);
    expect(others.length).toBeGreaterThan(0);
    for (const b of others) expect(b.tabIndex).toBe(-1);
    add.click();
    // Adding re-renders the rows: click the new row's button for a second instance.
    optionFor(handle.el, 'sma')!.parentElement!.querySelector<HTMLButtonElement>('.pc-indicator-picker-add')!.click();
    expect(chart.indicators.getAll().map((i) => i.type)).toEqual(['sma', 'sma']);
    expect(handle.isOpen).toBe(true);
    handle.destroy();
  });

  it('does not remove an indicator with Delete in an empty search box', () => {
    chart.indicators.add('sma');
    const handle = picker();
    handle.open();
    handle.el.querySelector<HTMLElement>('[data-tab="on-chart"]')!.click();
    expect(options(handle.el)).toHaveLength(1);
    const input = handle.el.querySelector('input')!;
    for (let i = 0; i < 3; i++) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, repeat: i > 0 }));
    expect(chart.indicators.getAll()).toHaveLength(1);
    handle.destroy();
  });
});

describe('indicator picker keyboard', () => {
  const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input')!;
  const press = (target: HTMLElement, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const active = (el: HTMLElement) => document.getElementById(input(el).getAttribute('aria-activedescendant') ?? '');
  const search = (el: HTMLElement, text: string) => {
    input(el).value = text;
    input(el).dispatchEvent(new Event('input'));
  };

  it('moves the active row with the arrows, wrapping, and adds with Enter', () => {
    const handle = picker();
    handle.open('ma');
    const first = active(handle.el)!;
    expect(first.getAttribute('aria-selected')).toBe('true');
    press(input(handle.el), 'ArrowDown');
    const second = active(handle.el)!;
    expect(second).not.toBe(first);
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(first.getAttribute('aria-selected')).toBe('false');
    press(input(handle.el), 'ArrowUp');
    expect(active(handle.el)).toBe(first);
    press(input(handle.el), 'ArrowUp');
    expect(active(handle.el)).toBe(options(handle.el).at(-1));
    press(input(handle.el), 'ArrowDown');
    expect(active(handle.el)).toBe(first);
    press(input(handle.el), 'Enter');
    expect(chart.indicators.getAll()).toHaveLength(1);
    expect(handle.isOpen).toBe(true);
    handle.destroy();
  });

  it('finds a definition through a typo and lists favourites first among equal matches', () => {
    const handle = picker({ storage: memoryStorage() });
    handle.open('rsl');
    expect(options(handle.el)[0]!.getAttribute('aria-label')).toMatch(/^RSI,/);
    // SMA and EMA both have the alias "MA"; starring EMA puts it first.
    search(handle.el, 'ma');
    const names = () => options(handle.el).slice(0, 2).map((o) => o.getAttribute('aria-label')!.split(',')[0]);
    expect(names()).toEqual(['SMA', 'EMA']);
    handle.toggleFavorite('ema');
    search(handle.el, 'ma');
    expect(names()).toEqual(['EMA', 'SMA']);
    handle.destroy();
  });

  it('keeps focus on a row star across the redraw, and sends arrows on it back to the search box', () => {
    const handle = picker();
    handle.open('sma');
    const star = () => optionFor(handle.el, 'sma')!.parentElement!.querySelector<HTMLButtonElement>('.pc-indicator-picker-star')!;
    star().focus();
    star().click();
    expect(handle.favorites).toEqual(['sma']);
    expect(document.activeElement).toBe(star());
    expect(star().getAttribute('aria-pressed')).toBe('true');
    press(star(), 'ArrowDown');
    expect(document.activeElement).toBe(input(handle.el));
    expect(active(handle.el)).not.toBe(optionFor(handle.el, 'sma'));
    handle.destroy();
  });

  it('keeps focus on the star when unstarring from Favorites moves the row to All indicators', () => {
    const storage = memoryStorage();
    const handle = picker({ storage });
    handle.toggleFavorite('sma');
    handle.open();
    // The Favorites row of SMA comes first and is active.
    const first = active(handle.el)!;
    expect(first.getAttribute('aria-label')).toMatch(/^SMA,/);
    const star = first.parentElement!.querySelector<HTMLButtonElement>('.pc-indicator-picker-star')!;
    star.focus();
    star.click();
    expect(handle.favorites).toEqual([]);
    const focused = document.activeElement as HTMLElement;
    expect(focused.classList.contains('pc-indicator-picker-star')).toBe(true);
    expect(focused.getAttribute('aria-pressed')).toBe('false');
    // It is the star of SMA's row in All indicators, which is now the active row.
    expect(focused.parentElement!.querySelector('[role="option"]')).toBe(active(handle.el));
    expect(active(handle.el)!.getAttribute('aria-label')).toMatch(/^SMA,/);
    handle.destroy();
  });

  it('combines typo tolerance with favourites first', () => {
    const handle = picker({ storage: memoryStorage() });
    // "avarage" is one letter off "average", an alias word of several definitions.
    handle.open('avarage');
    const names = () => options(handle.el).map((o) => o.getAttribute('aria-label')!.split(',')[0]);
    const before = names();
    expect(before).toContain('VWAP');
    expect(before[0]).not.toBe('VWAP');
    handle.toggleFavorite('vwap');
    search(handle.el, 'avarage');
    expect(names()[0]).toBe('VWAP');
    expect(new Set(names())).toEqual(new Set(before));
    handle.destroy();
  });

  it('moves between tabs with the arrows, keeping focus on the selected tab', () => {
    const handle = picker();
    handle.open();
    const selected = () => handle.el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
    selected().focus();
    press(selected(), 'ArrowDown');
    expect(selected().getAttribute('data-tab')).toBe('on-chart');
    expect(document.activeElement).toBe(selected());
    press(selected(), 'End');
    expect(selected()).toBe([...handle.el.querySelectorAll('[role="tab"]')].at(-1));
    expect(document.activeElement).toBe(selected());
    handle.destroy();
  });
});

describe('indicator picker source switch', () => {
  const mine = { id: 'mine', label: 'My indicators', includes: (def: { id: string }) => def.id === 'rsi' || def.id === 'macd' };
  const switchEl = (el: HTMLElement) => el.querySelector<HTMLElement>('.pc-indicator-picker-sources')!;
  const radio = (el: HTMLElement, value: string) => switchEl(el).querySelector<HTMLButtonElement>(`[data-value="${value}"]`)!;
  const tabIds = (el: HTMLElement) => [...el.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('data-tab'));
  const listed = (el: HTMLElement) => new Set(options(el).map((o) => o.getAttribute('aria-label')!.split(',')[0]));

  it('is hidden without host groups', () => {
    const handle = picker({ sourceSwitch: true });
    handle.open();
    expect(switchEl(handle.el).hidden).toBe(true);
    expect(listed(handle.el).has('RSI')).toBe(true);
    handle.destroy();
  });

  it('is off by default: All lists every definition, groups stay tabs', () => {
    const handle = picker({ groups: [mine] });
    handle.open();
    expect(switchEl(handle.el).hidden).toBe(true);
    expect(listed(handle.el).has('RSI')).toBe(true);
    expect(listed(handle.el).has('SMA')).toBe(true);
    expect(tabIds(handle.el)).toContain('group:mine');
    handle.destroy();
  });

  it('is one tab stop moved with the arrow keys', () => {
    const handle = picker({ groups: [mine], sourceSwitch: true });
    handle.open();
    expect([...switchEl(handle.el).querySelectorAll<HTMLElement>('[role="radio"]')].map((b) => b.tabIndex)).toEqual([0, -1]);
    radio(handle.el, 'built-in').focus();
    radio(handle.el, 'built-in').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(radio(handle.el, 'host'));
    expect(listed(handle.el)).toEqual(new Set(['RSI', 'MACD']));
    handle.destroy();
  });

  it('lists built-in definitions first, and host ones with their group tabs on the other side', () => {
    const handle = picker({ groups: [mine], sourceSwitch: true });
    handle.open();
    expect(switchEl(handle.el).hidden).toBe(false);
    expect(radio(handle.el, 'built-in').getAttribute('aria-checked')).toBe('true');
    expect(listed(handle.el).has('RSI')).toBe(false);
    expect(listed(handle.el).has('SMA')).toBe(true);
    expect(tabIds(handle.el)).not.toContain('group:mine');

    radio(handle.el, 'host').click();
    expect(listed(handle.el)).toEqual(new Set(['RSI', 'MACD']));
    expect(tabIds(handle.el)).toEqual(['all', 'on-chart', 'category:momentum', 'group:mine']);
    // Search stays within the side.
    handle.open('sma');
    expect(options(handle.el)).toHaveLength(0);
    handle.close();

    // Opening again starts on the built-in side.
    handle.open();
    expect(radio(handle.el, 'built-in').getAttribute('aria-checked')).toBe('true');
    expect(listed(handle.el).has('RSI')).toBe(false);
    handle.destroy();
  });

  it('stays hidden when every definition is in a group', () => {
    const handle = picker({ groups: [{ id: 'all', label: 'Everything', includes: () => true }], sourceSwitch: true });
    handle.open();
    expect(switchEl(handle.el).hidden).toBe(true);
    expect(tabIds(handle.el)).toContain('group:all');
    handle.destroy();
  });
});

describe('indicator picker storage', () => {
  it('merges with what other pickers on the same storage saved', () => {
    const storage = memoryStorage();
    const a = picker({ storage });
    const b = picker({ storage });
    a.toggleFavorite('sma');
    b.toggleFavorite('ema');
    expect(storage.stored!.favorites).toEqual(expect.arrayContaining(['sma', 'ema']));

    // Adding from b keeps a's favourite and records the recent.
    b.open();
    expect(b.favorites).toEqual(expect.arrayContaining(['sma', 'ema']));
    optionFor(b.el, 'rsi')!.click();
    expect(chart.indicators.getAll().map((i) => i.type)).toEqual(['rsi']);
    expect(storage.stored).toEqual({ recents: ['rsi'], favorites: expect.arrayContaining(['sma', 'ema']) });
    b.close();

    // a sees b's recent when it opens, and keeps it when it changes the lists.
    a.open();
    expect(a.recents).toEqual(['rsi']);
    a.toggleFavorite('sma');
    expect(storage.stored).toEqual({ recents: ['rsi'], favorites: ['ema'] });
    a.destroy();
    b.destroy();
  });

  it('shares lists between pickers on the same localStorage key', () => {
    const a = createIndicatorPicker(chart, { storageKey: 'test:picker' });
    const b = createIndicatorPicker(chart, { storageKey: 'test:picker', openOnSlash: false });
    a.toggleFavorite('sma');
    b.toggleFavorite('ema');
    expect(JSON.parse(localStorage.getItem('test:picker')!).favorites).toEqual(expect.arrayContaining(['sma', 'ema']));
    expect(a.favorites).toEqual(expect.arrayContaining(['sma', 'ema']));
    a.destroy();
    b.destroy();
  });

  it('logs and carries on when a host storage throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const storage: IndicatorPickerStorage = {
      load: () => {
        throw new Error('load failed');
      },
      save: () => {
        throw new Error('save failed');
      },
    };
    const onAdd = vi.fn();
    const handle = picker({ storage, onAdd });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'load failed' }));

    handle.open();
    expect(() => handle.toggleFavorite('sma')).not.toThrow();
    expect(handle.favorites).toEqual(['sma']);
    optionFor(handle.el, 'ema')!.click();
    expect(chart.indicators.getAll().map((i) => i.type)).toEqual(['ema']);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(handle.recents).toEqual(['ema']);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'save failed' }));
    handle.destroy();
  });
});

describe('indicator picker language', () => {
  it('reads the chart language when it opens, and keeps English by default', () => {
    const handle = picker();
    handle.open();
    const title = () => document.querySelector('.pc-indicator-picker .pc-dialog-title')!.textContent;
    const input = () => document.querySelector<HTMLInputElement>('.pc-indicator-picker input')!;
    const tabs = () => [...document.querySelectorAll('.pc-indicator-picker-tab')].map((t) => t.firstChild!.textContent);
    expect(title()).toBe('Indicators');
    expect(input().placeholder).toBe('Search by name, acronym or alias');
    expect(tabs().slice(0, 3)).toEqual(['All', 'On chart', 'Trend']);
    handle.close();

    chart.applyOptions({
      localization: {
        messages: {
          actionIndicatorPicker: 'Indikatoren',
          indicatorsSearch: 'Indikatoren suchen',
          indicatorsSearchPlaceholder: 'Name, Kürzel oder Alias',
          paletteAll: 'Alle',
          indicatorsOnChart: 'Im Chart',
          'category.trend': 'Trendfolger',
          indicatorsNoMatch: 'Kein Indikator passt zu „{text}“.',
        },
      },
    });
    handle.open('zzzz-none');
    expect(title()).toBe('Indikatoren');
    expect(input().getAttribute('aria-label')).toBe('Indikatoren suchen');
    expect(input().placeholder).toBe('Name, Kürzel oder Alias');
    expect(tabs().slice(0, 3)).toEqual(['Alle', 'Im Chart', 'Trendfolger']);
    expect(document.querySelector('.pc-indicator-picker .pc-symbol-search-message')!.textContent).toBe('Kein Indikator passt zu „zzzz-none“.');
    handle.destroy();
  });
});

describe('indicator picker settings adapter', () => {
  /** A `SettingsAdapter` kept in a map. */
  function mapSettings() {
    const map = new Map<string, string>();
    return {
      map,
      get: (key: string) => map.get(key) ?? null,
      set: (key: string, value: string) => void map.set(key, value),
      remove: (key: string) => void map.delete(key),
    };
  }

  it('keeps recents and favourites under the indicator-picker key, not in localStorage', () => {
    const settings = mapSettings();
    const a = createIndicatorPicker(chart, { debounce: 0, settings });
    a.toggleFavorite('sma');
    a.open();
    optionFor(a.el, 'rsi')!.click();
    expect(JSON.parse(settings.map.get('indicator-picker')!)).toEqual({ recents: ['rsi'], favorites: ['sma'] });
    expect(localStorage.length).toBe(0);
    a.destroy();

    // Another picker on the same store starts from what was saved.
    const b = createIndicatorPicker(chart, { debounce: 0, settings, openOnSlash: false });
    expect(b.recents).toEqual(['rsi']);
    expect(b.favorites).toEqual(['sma']);
    b.destroy();
  });

  it('lets storage win over settings, and reads corrupt settings as empty', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const settings = mapSettings();
    settings.map.set('indicator-picker', '{not json');
    const corrupt = createIndicatorPicker(chart, { debounce: 0, settings });
    expect(corrupt.favorites).toEqual([]);
    expect(error).toHaveBeenCalled();
    corrupt.destroy();

    const storage = memoryStorage();
    const handle = createIndicatorPicker(chart, { debounce: 0, settings, storage, openOnSlash: false });
    handle.toggleFavorite('ema');
    expect(storage.stored!.favorites).toEqual(['ema']);
    expect(settings.map.get('indicator-picker')).toBe('{not json');
    handle.destroy();
  });
});

describe('indicator picker command palette source', () => {
  type Entry = { id: string; label: string; description?: string; disabled?: boolean; run(): void };
  const signal = () => new AbortController().signal;

  it('lists the catalogue ranked like the picker, and adds as a row does', () => {
    const onAdd = vi.fn();
    const handle = picker({ filter: (def) => def.id !== 'vwap', onAdd });
    const source = handle.commandSource;
    expect(source).toMatchObject({ id: 'indicators', label: 'Indicators', ranked: true });
    const all = (source.entries('', signal()) as Entry[]).map((e) => e.id);
    expect(all).toContain('rsi');
    expect(all).not.toContain('vwap');

    const found = source.entries(' bb ', signal()) as Entry[];
    expect(found[0]).toMatchObject({ id: 'bbands', label: 'BB', description: 'Volatility' });
    found[0]!.run();
    expect(chart.indicators.getAll().map((i) => i.type)).toEqual(['bbands']);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(handle.recents).toEqual(['bbands']);
    handle.destroy();
  });

  it('marks indicators the chart refuses as disabled', () => {
    chart.applyOptions({ access: { allow: ({ id }) => id !== 'rsi', refused: 'disable' } });
    const handle = picker();
    const entries = handle.commandSource.entries('rsi', signal()) as Entry[];
    expect(entries.find((e) => e.id === 'rsi')?.disabled).toBe(true);
    handle.destroy();
  });
});

describe('indicator picker search-all footer', () => {
  const footer = () => document.querySelector<HTMLElement>('.pc-indicator-picker .pc-symbol-search-footer')!;

  it('hands the query on, closing first, while the search box has text', () => {
    const onSearchAll = vi.fn();
    const handle = picker({ onSearchAll });
    handle.open();
    expect(footer().hidden).toBe(true);
    handle.open('macd');
    expect(footer().hidden).toBe(false);
    const button = footer().querySelector('button')!;
    expect(button.textContent).toBe('Search everything for “macd”');
    button.click();
    expect(handle.isOpen).toBe(false);
    expect(onSearchAll).toHaveBeenCalledWith('macd');
    handle.destroy();
  });

  it('shows no footer without onSearchAll', () => {
    const handle = picker();
    handle.open('macd');
    expect(footer().hidden).toBe(true);
    handle.destroy();
  });
});

describe('indicator picker on shared favourites', () => {
  it('stars through the shared list, moves its own saved favourites there once, and follows outside changes', () => {
    const storage = memoryStorage();
    storage.stored = { recents: ['ema'], favorites: ['rsi'] };
    const shared = createFavorites(chart, { storage: null }).of('indicator');
    const handle = picker({ storage, favorites: shared });
    expect(shared.get()).toEqual(['rsi']);
    expect(storage.stored).toEqual({ recents: ['ema'], favorites: [] });
    handle.toggleFavorite('sma');
    expect(shared.get()).toEqual(['rsi', 'sma']);
    expect(handle.favorites).toEqual(['rsi', 'sma']);
    expect(storage.stored!.favorites).toEqual([]);
    handle.open('sma');
    const star = () => optionFor(handle.el, 'sma')!.parentElement!.querySelector<HTMLButtonElement>('.pc-indicator-picker-star')!;
    expect(star().getAttribute('aria-pressed')).toBe('true');
    shared.remove('sma');
    expect(star().getAttribute('aria-pressed')).toBe('false');
    handle.destroy();
    // Once moved, a picker on the same storage leaves the shared list alone.
    shared.clear();
    picker({ storage, favorites: shared }).destroy();
    expect(shared.get()).toEqual([]);
  });

  it('keeps saved favourites past the shared limit in its own storage', () => {
    const storage = memoryStorage();
    storage.stored = { recents: [], favorites: ['sma', 'ema', 'rsi'] };
    const shared = createFavorites(chart, { storage: null, kinds: [{ id: 'indicator', limit: 2 }] }).of('indicator');
    picker({ storage, favorites: shared }).destroy();
    expect(shared.get()).toEqual(['sma', 'ema']);
    expect(storage.stored!.favorites).toEqual(['rsi']);
  });

  it('refuses a star past the limit and says why', () => {
    const shared = createFavorites(chart, { storage: null, kinds: [{ id: 'indicator', limit: 1 }] }).of('indicator');
    const handle = picker({ favorites: shared });
    handle.toggleFavorite('sma');
    handle.toggleFavorite('rsi');
    expect(shared.get()).toEqual(['sma']);
    expect(handle.el.querySelector('[role="status"]')!.textContent).toContain('at most 1');
    handle.destroy();
  });
});
