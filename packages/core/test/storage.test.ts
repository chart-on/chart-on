import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type StateChangeReason } from '../src/chart';
import type { DataSource } from '../src/data/types';
import { intervalSeconds } from '../src/data/util';
import type { SerializedDrawings } from '../src/drawing/types';
import type { IndicatorDef } from '../src/indicators/types';
import type { ChartLayout } from '../src/layout';
import { autosave } from '../src/storage/autosave';
import { layoutEntry, loadLastLayout, perSymbolDrawings } from '../src/storage/drawings';
import { layouts } from '../src/builtins';
import { createLocalStorageAdapter, storageKeyPart, type KeyValueStorage } from '../src/storage/local';
import { createSettingsStore } from '../src/storage/settings';
import type { DrawingsDelta, SettingsAdapter, StorageAdapter } from '../src/storage/types';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.useRealTimers();
});

/** A Map-backed store with the Web Storage methods. */
function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
  };
}

const bars = (n: number): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ time: i * 60, open: 10 + i, high: 11 + i, low: 9 + i, close: 10 + i }));

const osc: IndicatorDef<{ length: number }> = {
  id: 'test/osc',
  name: 'Osc',
  placement: 'pane',
  inputs: [{ id: 'length', type: 'number', default: 14, min: 1 }],
  plots: [{ id: 'value', type: 'line' }],
  compute: (src) => ({ value: src.close.map((v) => v / 2) }),
};

const line = (id: string, pane = 0) => ({
  id,
  type: 'trendline',
  pane,
  points: [
    { time: 600, price: 15 },
    { time: 1800, price: 30 },
  ],
  style: {},
});

function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(bars(200));
  c.indicators.register(osc);
  return c;
}

const END = 100_000 * 60;
const source: DataSource = {
  symbol: async (symbol) => ({ symbol, name: symbol }),
  search: async () => [],
  history: async (_info, interval, req) => {
    const step = intervalSeconds(interval);
    const out: Bar[] = [];
    const newest = req.to === undefined ? END : req.to - step;
    for (let t = newest; t > END - 5000 * step && out.length < req.limit; t -= step) {
      out.unshift({ time: t, open: 1, high: 2, low: 0.5, close: 1 });
    }
    return { bars: out, atStart: out.length < req.limit };
  },
};

function sourced() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles();
  c.setDataSource(source, { initialBars: 300, pageBars: 300 });
  return c;
}

const trendAt = (time: number) => ({
  type: 'trendline',
  pane: 0,
  points: [
    { time, price: 1 },
    { time: time + 600, price: 2 },
  ],
  style: {},
});

function reasons(c: Chart): StateChangeReason[] {
  const out: StateChangeReason[] = [];
  c.on('state:change', ({ reason }) => out.push(reason));
  return out;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createLocalStorageAdapter', () => {
  it('swallows quota errors on write and reports them', async () => {
    const onError = vi.fn();
    const full: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => {},
    };
    const storage = createLocalStorageAdapter({ storage: full, onError });
    await expect(storage.saveDrawings('ABC', { version: 1, drawings: [] })).resolves.toBeUndefined();
    await expect(storage.saveLayout(layoutEntry({ version: 1 }, 'x'))).resolves.toEqual(expect.any(String));
    expect(() => storage.settings.set('k', 'v')).not.toThrow();
    expect(onError).toHaveBeenCalled();
  });

  it('reads blocked storage as empty', async () => {
    const blocked: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const storage = createLocalStorageAdapter({ storage: blocked });
    expect(await storage.loadDrawings('ABC')).toBeNull();
    expect(await storage.listLayouts()).toEqual([]);
    expect(storage.settings.get('k')).toBeNull();
    await expect(storage.removeLayout('x')).resolves.toBeUndefined();
  });

  it('returns null for corrupt JSON and invalid payloads, and drops them', async () => {
    const mem = memoryStorage();
    mem.map.set('app:drawings:abc', '{not json');
    mem.map.set('app:layout:l1', JSON.stringify({ symbol: 'ABC' }));
    mem.map.set('app:layouts', '[1, 2');
    const storage = createLocalStorageAdapter({ prefix: 'app:', storage: mem });
    expect(await storage.loadDrawings('ABC')).toBeNull();
    expect(await storage.loadLayout('l1')).toBeNull();
    expect(await storage.listLayouts()).toEqual([]);
    expect(mem.map.has('app:drawings:abc')).toBe(false);
    expect(mem.map.has('app:layout:l1')).toBe(false);
  });

  it('keeps drawings by sanitized key', async () => {
    const mem = memoryStorage();
    const storage = createLocalStorageAdapter({ storage: mem });
    const data: SerializedDrawings = { version: 1, drawings: [line('a') as never] };
    await storage.saveDrawings('BTC/USD', data);
    expect([...mem.map.keys()]).toEqual(['charton:drawings:btc_usd']);
    expect(await storage.loadDrawings('BTC/USD')).toEqual(data);
    await storage.removeDrawings('BTC/USD');
    expect(await storage.loadDrawings('BTC/USD')).toBeNull();
    expect(storageKeyPart('Es.Z4 Mini')).toBe('es_z4_mini');
  });

  it('lists, saves, loads and removes layouts', async () => {
    const storage = createLocalStorageAdapter({ storage: memoryStorage() });
    const layout: ChartLayout = { version: 1, symbol: 'ABC', interval: '1h', meta: { updatedAt: 100 } };
    vi.useFakeTimers({ toFake: ['Date'], now: 300_000 });
    const id = await storage.saveLayout(layoutEntry(layout, 'Swing'));
    expect(await storage.listLayouts()).toEqual([{ id, name: 'Swing', savedAt: 300, preview: { symbol: 'ABC', interval: '1h' } }]);
    expect(await storage.loadLayout(id)).toEqual(layout);
    vi.setSystemTime(400_000);
    await storage.saveLayout(layoutEntry(layout, 'Renamed', id));
    expect(await storage.listLayouts()).toMatchObject([{ id, name: 'Renamed', savedAt: 400 }]);
    vi.useRealTimers();
    await storage.removeLayout(id);
    expect(await storage.listLayouts()).toEqual([]);
    expect(await storage.loadLayout(id)).toBeNull();
  });

  it('stores the summary it is given as it is, without reading the layout', async () => {
    const storage = createLocalStorageAdapter({ storage: memoryStorage() });
    const summary = { name: 'Given', savedAt: 5, preview: { symbol: 'XYZ' } };
    const id = await storage.saveLayout({ summary, layout: { version: 1, symbol: 'ABC', interval: '1d', meta: { updatedAt: 9 } } });
    expect(await storage.listLayouts()).toEqual([{ ...summary, id }]);
  });

  it('builds the summary with layoutEntry from what the layout shows, stamped at the call', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 9_000 });
    // The layout's own time is not the save time: a loaded layout saved again keeps its old `updatedAt`.
    expect(layoutEntry({ version: 1, meta: { updatedAt: 7 } }, 'Bare')).toEqual({ summary: { name: 'Bare', savedAt: 9 }, layout: { version: 1, meta: { updatedAt: 7 } } });
    expect(layoutEntry({ version: 1, interval: '5m', meta: { updatedAt: 7 } }, 'Five', 'id-1')).toMatchObject({
      id: 'id-1',
      summary: { name: 'Five', savedAt: 9, preview: { interval: '5m' } },
    });
    vi.useRealTimers();
  });

  it('converts a version 1 index once, so upgrading keeps the list', async () => {
    const mem = memoryStorage();
    const old = [
      { id: 'a', name: 'A', symbol: 'ABC', interval: '1h', updatedAt: 1 },
      { id: 'b', name: 'B', updatedAt: 2 },
      { id: 'c', name: 'C' },
    ];
    mem.setItem('charton:layouts', JSON.stringify({ version: 1, layouts: old }));
    const onError = vi.fn();
    const storage = createLocalStorageAdapter({ storage: mem, onError });
    const converted = [
      { id: 'a', name: 'A', savedAt: 1, preview: { symbol: 'ABC', interval: '1h' } },
      { id: 'b', name: 'B', savedAt: 2 },
    ];
    expect(await storage.listLayouts()).toEqual(converted);
    expect(JSON.parse(mem.getItem('charton:layouts')!)).toEqual({ version: 2, layouts: converted });
    expect(await storage.listLayouts()).toEqual(converted);
    expect(onError).not.toHaveBeenCalled();
  });

  it('round-trips drawing templates per tool type', async () => {
    const mem = memoryStorage();
    const storage = createLocalStorageAdapter({ storage: mem });
    const thick = { color: '#2f6bff', width: 3 };
    await storage.saveTemplate('drawing', 'Thick', thick, 'trend-line');
    await storage.saveTemplate('drawing', 'Dashed', { dash: [4, 2] }, 'trend-line');
    await storage.saveTemplate('drawing', 'Thick', { width: 1 }, 'horizontal-line');
    expect([...mem.map.keys()]).toEqual(['charton:templates:drawing']);
    expect(await storage.listTemplates('drawing', 'trend-line')).toEqual(['Thick', 'Dashed']);
    expect(await storage.listTemplates('drawing', 'horizontal-line')).toEqual(['Thick']);
    expect(await storage.listTemplates('drawing')).toEqual([]);
    expect(await storage.loadTemplate('drawing', 'Thick', 'trend-line')).toEqual(thick);
    expect(await storage.loadTemplate('drawing', 'Thick', 'horizontal-line')).toEqual({ width: 1 });
    expect(await storage.loadTemplate('drawing', 'Thick', 'ray')).toBeNull();
    await storage.removeTemplate('drawing', 'Thick', 'trend-line');
    expect(await storage.listTemplates('drawing', 'trend-line')).toEqual(['Dashed']);
    expect(await storage.loadTemplate('drawing', 'Thick', 'horizontal-line')).toEqual({ width: 1 });
  });

  it('round-trips indicator templates per indicator id', async () => {
    const storage = createLocalStorageAdapter({ storage: memoryStorage() });
    const fast = { inputs: { length: 7 }, style: { color: '#f00' } };
    await storage.saveTemplate('indicator', 'Fast', fast, 'test/osc');
    // Ids that would share a sanitized key stay apart.
    await storage.saveTemplate('indicator', 'Fast', { inputs: { length: 30 } }, 'test_osc');
    expect(await storage.loadTemplate('indicator', 'Fast', 'test/osc')).toEqual(fast);
    expect(await storage.loadTemplate('indicator', 'Fast', 'test_osc')).toEqual({ inputs: { length: 30 } });
    expect(await storage.listTemplates('drawing', 'test/osc')).toEqual([]);
  });

  it('keeps indicator defaults apart from named indicator templates', async () => {
    const mem = memoryStorage();
    const storage = createLocalStorageAdapter({ storage: mem });
    await storage.saveTemplate('indicator-default', 'default', { version: 1, inputs: { length: 9 } }, 'test/osc');
    expect(await storage.loadTemplate('indicator-default', 'default', 'test/osc')).toEqual({ version: 1, inputs: { length: 9 } });
    expect(await storage.listTemplates('indicator', 'test/osc')).toEqual([]);
    expect([...mem.map.keys()]).toEqual(['charton:templates:indicator-default']);
    await storage.removeTemplate('indicator-default', 'default', 'test/osc');
    expect(await storage.loadTemplate('indicator-default', 'default', 'test/osc')).toBeNull();
  });

  it('round-trips chart templates, replacing one in place and keeping names exactly', async () => {
    const mem = memoryStorage();
    const storage = createLocalStorageAdapter({ prefix: 'app:', storage: mem });
    await storage.saveTemplate('chart', 'Night', { background: '#000' });
    await storage.saveTemplate('chart', 'night', { background: '#111' });
    await storage.saveTemplate('chart', 'Day / light', { background: '#fff' });
    await storage.saveTemplate('chart', 'Night', { background: '#222' });
    expect(await storage.listTemplates('chart')).toEqual(['Night', 'night', 'Day / light']);
    expect(await storage.loadTemplate('chart', 'Night')).toEqual({ background: '#222' });
    for (const name of ['Night', 'night', 'Day / light']) await storage.removeTemplate('chart', name);
    expect(await storage.listTemplates('chart')).toEqual([]);
    expect(mem.map.size).toBe(0);
  });

  it('drops unreadable template entries and survives failing storage', async () => {
    const mem = memoryStorage();
    mem.map.set('charton:templates:chart', JSON.stringify({ version: 1, templates: [{ name: 'Ok', content: 1 }, { name: 2 }, 'x'] }));
    mem.map.set('charton:templates:drawing', '{not json');
    const storage = createLocalStorageAdapter({ storage: mem });
    expect(await storage.listTemplates('chart')).toEqual(['Ok']);
    expect(await storage.listTemplates('drawing', 'ray')).toEqual([]);
    expect(mem.map.has('charton:templates:drawing')).toBe(false);

    const onError = vi.fn();
    const blocked: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    const failing = createLocalStorageAdapter({ storage: blocked, onError });
    await expect(failing.saveTemplate('chart', 'A', {})).resolves.toBeUndefined();
    expect(await failing.listTemplates('chart')).toEqual([]);
    expect(await failing.loadTemplate('chart', 'A')).toBeNull();
    expect(onError).toHaveBeenCalled();
  });

  it('keeps settings under its own prefix', () => {
    const mem = memoryStorage();
    const { settings } = createLocalStorageAdapter({ storage: mem });
    settings.set('theme', 'light');
    expect(mem.map.get('charton:settings:theme')).toBe('light');
    expect(settings.get('theme')).toBe('light');
    settings.remove('theme');
    expect(settings.get('theme')).toBeNull();
  });
});

describe('createSettingsStore', () => {
  const adapterOf = (init: Record<string, string> = {}): SettingsAdapter & { map: Map<string, string> } => {
    const map = new Map(Object.entries(init));
    return { map, get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v), remove: (k) => void map.delete(k) };
  };

  it('reads locked values first, then the snapshot, then the adapter', () => {
    const adapter = adapterOf({ theme: 'dark', interval: '1h', grid: 'off' });
    const store = createSettingsStore({ adapter, snapshot: { interval: '15m' }, locked: { grid: 'on' } });
    expect(store.get('theme')).toBe('dark');
    expect(store.get('interval')).toBe('15m');
    expect(store.get('grid')).toBe('on');
    store.set('grid', 'off');
    expect(store.get('grid')).toBe('on');
    expect(store.isLocked('grid')).toBe(true);
    store.set('interval', '4h');
    expect(store.get('interval')).toBe('4h');
    expect(adapter.map.get('interval')).toBe('4h');
    expect(store.values()).toMatchObject({ interval: '4h', theme: 'dark' });
    expect(store.values()).not.toHaveProperty('grid');
  });

  it('stores JSON and falls back on unreadable values', () => {
    const store = createSettingsStore({ snapshot: { bad: '{' } });
    store.setJSON('favs', ['a', 'b']);
    expect(store.getJSON('favs', [])).toEqual(['a', 'b']);
    expect(store.getJSON('bad', 7)).toBe(7);
    expect(store.getJSON('missing', null)).toBeNull();
  });

  it('never throws when the adapter fails', () => {
    const adapter: SettingsAdapter = {
      get: () => {
        throw new Error('blocked');
      },
      set: () => {
        throw new Error('blocked');
      },
      remove: () => {
        throw new Error('blocked');
      },
    };
    const store = createSettingsStore({ adapter });
    expect(store.get('x')).toBeNull();
    store.set('x', '1');
    expect(store.get('x')).toBe('1');
  });

  it('migrates older settings once', () => {
    const adapter = adapterOf({ rail: 'yes' });
    const migrate = vi.fn((store: SettingsAdapter, from: number) => {
      if (from < 2 && store.get('rail') !== null) {
        store.set('railVisible', store.get('rail') === 'yes' ? 'true' : 'false');
        store.remove('rail');
      }
    });
    createSettingsStore({ adapter, version: 2, migrate });
    expect(migrate).toHaveBeenCalledWith(expect.anything(), 0);
    expect(adapter.map.get('railVisible')).toBe('true');
    expect(adapter.map.has('rail')).toBe(false);
    createSettingsStore({ adapter, version: 2, migrate });
    expect(migrate).toHaveBeenCalledTimes(1);
  });
});

describe('state:change', () => {
  it('reports user and app edits by reason', () => {
    const c = chart();
    const seen = reasons(c);
    c.drawings.add(trendAt(600));
    c.indicators.add('test/osc');
    c.main!.applyOptions({ style: 'bars' });
    c.setPriceScaleMode('log');
    c.applyOptions({ grid: { vertical: { visible: false } } });
    expect(seen).toEqual(expect.arrayContaining(['drawings', 'indicators', 'series', 'panes', 'options']));
  });

  it('ignores main series options a layout does not keep', () => {
    const c = chart();
    const seen = reasons(c);
    c.main!.applyOptions({ title: 'Renamed' });
    expect(seen).toEqual([]);
  });

  it('stays quiet while loading drawings, indicators or a layout', () => {
    const c = chart();
    c.indicators.add('test/osc');
    c.drawings.add(trendAt(600));
    const saved = c.serializeLayout();
    const seen = reasons(c);
    c.drawings.load({ version: 1, drawings: [line('x')] });
    c.indicators.load([]);
    c.loadLayout(saved);
    c.loadLayout({ ...saved, mainSeries: { style: 'line' } });
    expect(seen).toEqual([]);
  });

  it('waits for a loaded layout symbol, then reports the edits made meanwhile', async () => {
    const a = sourced();
    await a.setSymbol('ABC', '5m');
    const saved = a.serializeLayout({ visibleRange: true });
    const b = sourced();
    const seen = reasons(b);
    const { ready } = b.loadLayout(saved);
    expect(b.layoutLoading).toBe(true);
    b.drawings.add(trendAt(END - 6000));
    expect(seen).toEqual([]);
    await ready;
    await tick();
    expect(b.layoutLoading).toBe(false);
    expect(seen).toEqual(['drawings']);
  });

  it('reports a symbol picked while a layout loads', async () => {
    const a = sourced();
    await a.setSymbol('ABC', '5m');
    const b = sourced();
    const seen = reasons(b);
    const { ready } = b.loadLayout(a.serializeLayout());
    const picked = b.setSymbol('XYZ', '1h');
    await Promise.all([ready, picked]);
    await tick();
    expect(seen).toContain('symbol');
  });

  it('reports a loaded symbol switch', async () => {
    const c = sourced();
    const seen = reasons(c);
    await c.setSymbol('ABC', '5m');
    expect(seen).toContain('symbol');
  });
});

describe('precedence', () => {
  it('a loaded layout wins over construction options, and later runtime calls win over the layout', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles({ style: 'line' }).setData(bars(50));
    c.loadLayout({ version: 1, mainSeries: { style: 'bars' } });
    expect(c.main!.options.style).toBe('bars');
    c.main!.applyOptions({ style: 'area' });
    expect(c.main!.options.style).toBe('area');
  });

  it('loading a layout leaves the theme alone', () => {
    const c = chart();
    c.applyOptions({ theme: { background: '#123456' } });
    c.loadLayout({ version: 1, mainSeries: { style: 'bars' } });
    expect(c.theme.background).toBe('#123456');
  });
});

describe('autosave', () => {
  it('reports a chart without layouts() through onError and keeps the changes for a later install', async () => {
    const c = new Chart(fakeContainer(), { plugins: [] });
    charts.push(c);
    const save = vi.fn();
    const onError = vi.fn();
    const saver = autosave(c, { save, onError, flushTarget: null });
    c.applyOptions({ grid: { vertical: { visible: false } } });
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toMatchObject({ code: 'not-registered', context: { call: 'serializeLayout', plugin: 'layouts()' } });
    c.install(layouts());
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![1]).toEqual(['options']);
    saver.stop();
  });

  it('saves once after many rapid changes', () => {
    vi.useFakeTimers();
    const c = chart();
    const save = vi.fn();
    autosave(c, { delayMs: 200, save, flushTarget: null });
    for (let i = 0; i < 10; i++) c.drawings.add(trendAt(600 + i * 60));
    vi.advanceTimersByTime(199);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].drawings.drawings).toHaveLength(10);
    expect(save.mock.calls[0]![1]).toEqual(['drawings']);
  });

  it('flushes a pending change on pagehide', () => {
    vi.useFakeTimers();
    const c = chart();
    const target = new EventTarget();
    const save = vi.fn();
    const saver = autosave(c, { save, flushTarget: target });
    c.drawings.add(trendAt(600));
    expect(saver.pending).toBe(true);
    target.dispatchEvent(new Event('pagehide'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(saver.pending).toBe(false);
    target.dispatchEvent(new Event('pagehide'));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does not save after a load', () => {
    vi.useFakeTimers();
    const c = chart();
    const saved = c.serializeLayout();
    const save = vi.fn();
    autosave(c, { delayMs: 10, save, flushTarget: null });
    c.loadLayout({ ...saved, drawings: { version: 1, drawings: [line('a')] } });
    c.drawings.load({ version: 1, drawings: [] });
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it('leaves viewport changes out unless included, and stops', () => {
    vi.useFakeTimers();
    const c = chart();
    const save = vi.fn();
    const saver = autosave(c, { delayMs: 10, save, flushTarget: null });
    c.emit('state:change', { reason: 'viewport' });
    vi.advanceTimersByTime(100);
    expect(save).not.toHaveBeenCalled();
    saver.stop();
    c.drawings.add(trendAt(600));
    vi.advanceTimersByTime(100);
    expect(save).not.toHaveBeenCalled();
  });

  it('saves the loaded visible range, not a half-applied one, after a layout loads', async () => {
    const a = sourced();
    await a.setSymbol('ABC', '5m');
    a.setVisibleTimeRange(END - 600 * 300, END - 300 * 300, false);
    const saved = a.serializeLayout({ visibleRange: true });

    const b = sourced();
    const layouts: ChartLayout[] = [];
    autosave(b, { delayMs: 0, serialize: { visibleRange: true }, save: (l) => void layouts.push(l), flushTarget: null });
    const { ready } = b.loadLayout(saved);
    b.drawings.add(trendAt(END - 6000));
    await tick();
    await ready;
    await tick();
    await tick();
    expect(layouts).toHaveLength(1);
    expect(layouts[0]!.symbol).toBe('ABC');
    expect(Math.abs(layouts[0]!.visibleRange!.from - saved.visibleRange!.from)).toBeLessThanOrEqual(300);
  });

  it('reports a failing save without throwing', async () => {
    const c = chart();
    const onError = vi.fn();
    const saver = autosave(c, {
      save: () => Promise.reject(new Error('offline')),
      onError,
      flushTarget: null,
    });
    c.drawings.add(trendAt(600));
    await saver.flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }));
  });
});

/** An in-memory storage adapter that records drawing saves. */
function memoryAdapter() {
  const drawings = new Map<string, SerializedDrawings>();
  const saves: { key: string; ids: string[]; delta?: DrawingsDelta }[] = [];
  const adapter: StorageAdapter = {
    loadDrawings: async (key) => drawings.get(key) ?? null,
    saveDrawings: async (key, data, delta) => {
      drawings.set(key, structuredClone(data));
      saves.push({ key, ids: data.drawings.map((d) => d.id), ...(delta ? { delta } : {}) });
    },
  };
  return { adapter, drawings, saves };
}

describe('perSymbolDrawings', () => {
  it('drops pending saves on destroy and removes the pagehide listener', async () => {
    const c = sourced();
    const { adapter, saves } = memoryAdapter();
    const target = new EventTarget();
    const handle = perSymbolDrawings(c, adapter, { delayMs: 50, flushTarget: target });
    await c.setSymbol('ABC', '5m');
    await tick();
    vi.useFakeTimers();
    c.drawings.add(trendAt(END - 3000));
    c.destroy();
    await vi.advanceTimersByTimeAsync(100);
    target.dispatchEvent(new Event('pagehide'));
    await handle.flush();
    expect(saves).toHaveLength(0);
  });

  it('drops a drawing load that resolves after destroy', async () => {
    const c = sourced();
    const { adapter, saves } = memoryAdapter();
    let release!: (saved: SerializedDrawings) => void;
    const pending = new Promise<SerializedDrawings>((resolve) => (release = resolve));
    const onError = vi.fn();
    perSymbolDrawings(c, { ...adapter, loadDrawings: () => pending }, { flushTarget: null, onError });
    await c.setSymbol('ABC', '5m');
    c.drawings.add(trendAt(END - 3000));
    c.destroy();
    release({ version: 1, drawings: [{ ...trendAt(END - 6000), id: 'saved' }] });
    await tick();
    expect(onError).not.toHaveBeenCalled();
    expect(saves).toHaveLength(0);
  });

  it('keeps an explicit flush before destroy and drops edits after stop', async () => {
    const c = sourced();
    const { adapter, saves } = memoryAdapter();
    const handle = perSymbolDrawings(c, adapter, { delayMs: 50, flushTarget: null });
    await c.setSymbol('ABC', '5m');
    await tick();
    const first = c.drawings.add(trendAt(END - 3000));
    await handle.flush();
    expect(saves.map((save) => save.ids)).toEqual([[first.id]]);
    c.drawings.add(trendAt(END - 1200));
    handle.stop();
    handle.stop();
    await handle.flush();
    c.destroy();
    expect(saves).toHaveLength(1);
  });

  it('saves the old symbol drawings and loads the new ones on a switch', async () => {
    const c = sourced();
    const { adapter, drawings, saves } = memoryAdapter();
    drawings.set('XYZ', { version: 1, drawings: [{ ...trendAt(END - 6000), id: 'saved-xyz' } as never] });
    const handle = perSymbolDrawings(c, adapter, { delayMs: 10, flushTarget: null });
    await c.setSymbol('ABC', '5m');
    expect(handle.key).toBe('ABC');
    const mine = c.drawings.add(trendAt(END - 6000));

    await c.setSymbol('XYZ', '5m');
    await tick();
    expect(saves).toEqual([{ key: 'ABC', ids: [mine.id], delta: { changed: [mine.id], removed: [] } }]);
    expect(c.drawings.getAll().map((d) => d.id)).toEqual(['saved-xyz']);

    await c.setSymbol('ABC', '5m');
    await tick();
    expect(c.drawings.getAll().map((d) => d.id)).toEqual([mine.id]);
    // Loading never saved: only the one save from the first switch.
    expect(saves).toHaveLength(1);
  });

  it('keeps drawings across an interval switch', async () => {
    const c = sourced();
    const { adapter, saves } = memoryAdapter();
    perSymbolDrawings(c, adapter, { delayMs: 10, flushTarget: null });
    await c.setSymbol('ABC', '5m');
    await tick();
    const d = c.drawings.add(trendAt(END - 6000));
    await c.setSymbol('ABC', '1h');
    expect(c.drawings.getAll().map((x) => x.id)).toEqual([d.id]);
    expect(saves).toHaveLength(0);
  });

  it('saves edits debounced with the removed ids', async () => {
    const c = sourced();
    const { adapter, saves } = memoryAdapter();
    perSymbolDrawings(c, adapter, { delayMs: 50, flushTarget: null });
    await c.setSymbol('ABC', '5m');
    await tick();
    vi.useFakeTimers();
    const a = c.drawings.add(trendAt(END - 6000));
    const b = c.drawings.add(trendAt(END - 3000));
    c.drawings.remove(a.id);
    c.drawings.add({ ...trendAt(END - 1200), persist: false });
    await vi.advanceTimersByTimeAsync(60);
    expect(saves).toHaveLength(1);
    expect(saves[0]!.ids).toEqual([b.id]);
    expect(saves[0]!.delta).toEqual({ changed: [b.id], removed: [a.id] });
  });

  it('keeps drawings made while the saved ones load, on top of them', async () => {
    const c = sourced();
    const { adapter, drawings, saves } = memoryAdapter();
    drawings.set('ABC', { version: 1, drawings: [{ ...trendAt(END - 6000), id: 'saved' } as never] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: StorageAdapter = {
      ...adapter,
      loadDrawings: async (key) => {
        await gate;
        return adapter.loadDrawings!(key);
      },
    };
    perSymbolDrawings(c, slow, { delayMs: 10, flushTarget: null });
    await c.setSymbol('ABC', '5m');
    const mine = c.drawings.add(trendAt(END - 3000));
    release();
    await tick();
    expect(c.drawings.getAll().map((d) => d.id)).toEqual(['saved', mine.id]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(saves.map((s) => s.ids)).toEqual([['saved', mine.id]]);
  });

  it('drops a slow load for a symbol switched away from', async () => {
    const c = sourced();
    const { adapter, drawings } = memoryAdapter();
    drawings.set('ABC', { version: 1, drawings: [{ ...trendAt(END - 6000), id: 'abc' } as never] });
    drawings.set('XYZ', { version: 1, drawings: [{ ...trendAt(END - 6000), id: 'xyz' } as never] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: StorageAdapter = {
      ...adapter,
      loadDrawings: async (key) => {
        if (key === 'ABC') await gate;
        return adapter.loadDrawings!(key);
      },
    };
    perSymbolDrawings(c, slow, { delayMs: 10, flushTarget: null });
    await c.setSymbol('ABC', '5m');
    await c.setSymbol('XYZ', '5m');
    await tick();
    release();
    await tick();
    expect(c.drawings.getAll().map((d) => d.id)).toEqual(['xyz']);
  });

  it('does not overwrite saved drawings that failed to load', async () => {
    const c = sourced();
    const { adapter, saves } = memoryAdapter();
    const onError = vi.fn();
    const failing: StorageAdapter = { ...adapter, loadDrawings: async () => Promise.reject(new Error('offline')) };
    const handle = perSymbolDrawings(c, failing, { delayMs: 10, flushTarget: null, onError });
    await c.setSymbol('ABC', '5m');
    await tick();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }));
    c.drawings.add(trendAt(END - 3000));
    await new Promise((resolve) => setTimeout(resolve, 30));
    await handle.flush();
    expect(saves).toHaveLength(0);
  });
});

describe('loadLastLayout', () => {
  it('loads the most recently saved layout, a re-saved older one included', async () => {
    const storage = createLocalStorageAdapter({ storage: memoryStorage() });
    vi.useFakeTimers({ toFake: ['Date'], now: 100_000 });
    const old = { version: 1, mainSeries: { style: 'line' }, meta: { updatedAt: 50 } } as const;
    const oldId = await storage.saveLayout(layoutEntry(old, 'old'));
    vi.setSystemTime(200_000);
    const id = await storage.saveLayout(layoutEntry({ version: 1, mainSeries: { style: 'bars' }, meta: { updatedAt: 200 } }, 'new'));
    const c = chart();
    const last = await loadLastLayout(c, storage);
    expect(last?.id).toBe(id);
    expect(c.main!.options.style).toBe('bars');
    // Saved again unchanged, with its old `meta.updatedAt`: it is now the newest.
    vi.setSystemTime(300_000);
    await storage.saveLayout(layoutEntry(old, 'old', oldId));
    vi.useRealTimers();
    expect((await loadLastLayout(chart(), storage))?.id).toBe(oldId);
  });

  it('resolves null without saved layouts', async () => {
    expect(await loadLastLayout(chart(), createLocalStorageAdapter({ storage: memoryStorage() }))).toBeNull();
    expect(await loadLastLayout(chart(), {})).toBeNull();
  });

  it('rejects on a chart without layouts() rather than reporting no layout', async () => {
    const storage = createLocalStorageAdapter({ storage: memoryStorage() });
    await storage.saveLayout(layoutEntry({ version: 1, mainSeries: { style: 'bars' } }, 'saved'));
    const plain = new Chart(fakeContainer(), { plugins: [] });
    charts.push(plain);
    await expect(loadLastLayout(plain, storage)).rejects.toMatchObject({ code: 'not-registered', context: { call: 'loadLayout', plugin: 'layouts()' } });
  });
});
