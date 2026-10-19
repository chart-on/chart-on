import { afterEach, describe, expect, it, vi } from 'vitest';
import * as core from '@chart-on/core';
import type { IndicatorDef } from '@chart-on/core';
import {
  categoryLabel,
  categoryOf,
  countByType,
  definitionsInTab,
  filterInstances,
  inputSummary,
  listedDefinitions,
  localIndicatorPickerStorage,
  matchRank,
  pickerSections,
  pickerTabs,
  placementChoices,
  placementFor,
  pushRecent,
  RECENT_LIMIT,
  sanitizeMemory,
  searchIndicators,
  stepTab,
  toggleFavorite,
  type PickerViewInput,
} from '../src/indicator-picker-model';
import { matchTiers as matchRanks } from '../src/picker-model';

function def(id: string, extra: Partial<IndicatorDef> = {}): IndicatorDef {
  return {
    id,
    name: id.toUpperCase(),
    placement: 'overlay',
    inputs: [],
    plots: [],
    compute: () => ({}),
    ...extra,
  };
}

const sma = def('sma', { name: 'SMA', category: 'trend', aliases: ['Simple Moving Average', 'MA'], placement: 'either' });
const ema = def('ema', { name: 'EMA', category: 'trend', aliases: ['Exponential Moving Average', 'MA'], placement: 'either' });
const bb = def('bbands', {
  name: 'BB',
  category: 'volatility',
  aliases: ['Bollinger Bands'],
  description: 'Bands a number of standard deviations around an average.',
});
const rsi = def('rsi', { name: 'RSI', category: 'momentum', aliases: ['Relative Strength Index'], placement: 'pane' });
const vwap = def('vwap', { name: 'VWAP', category: 'volume', aliases: ['Volume Weighted Average Price'] });
const custom = def('my-lib/heat', { name: 'Heat', category: 'flow', description: 'Order flow heat.' });
const plain = def('plain', { name: 'Plain' });
const defs = [sma, ema, bb, rsi, vwap, custom, plain];
const ids = (list: readonly IndicatorDef[]) => list.map((d) => d.id);

describe('listedDefinitions', () => {
  const allowOnly = (ids: string[]) => (type: string) => ids.includes(type);

  it('leaves out definitions the allow-list denies', () => {
    expect(ids(listedDefinitions(defs, { isAllowed: allowOnly(['sma', 'rsi']) }))).toEqual(['sma', 'rsi']);
  });

  it('keeps denied definitions when blocked ones show disabled', () => {
    expect(listedDefinitions(defs, { isAllowed: () => false, showBlocked: true })).toHaveLength(defs.length);
  });

  it('applies the host filter after the allow-list, hiding definitions whose filter throws', () => {
    const filter = (def: IndicatorDef) => {
      if (def.id === 'ema') throw new Error('boom');
      return def.id !== 'rsi';
    };
    expect(ids(listedDefinitions(defs, { isAllowed: allowOnly(['sma', 'ema', 'rsi', 'vwap']), filter }))).toEqual(['sma', 'vwap']);
  });
});

describe('categories and tabs', () => {
  it('reads categories, with Other for definitions without one', () => {
    expect(categoryOf(sma)).toBe('trend');
    expect(categoryOf(plain)).toBe('other');
    expect(categoryOf(def('x', { category: '  ' }))).toBe('other');
    expect(categoryLabel('volatility')).toBe('Volatility');
    expect(categoryLabel('flow')).toBe('Flow');
  });

  it('lists All, On chart, the present categories in a fixed order, custom ones, Other, then host groups', () => {
    const tabs = pickerTabs([plain, custom, vwap, rsi, sma], [{ id: 'mine', label: 'My indicators', includes: () => true }]);
    expect(tabs.map((t) => t.id)).toEqual([
      'all',
      'on-chart',
      'category:trend',
      'category:momentum',
      'category:volume',
      'category:flow',
      'category:other',
      'group:mine',
    ]);
    expect(tabs.at(-1)!.label).toBe('My indicators');
  });

  it('filters definitions by category and host group', () => {
    const mine = { id: 'mine', label: 'Mine', includes: (d: IndicatorDef) => d.id.startsWith('my-lib/') };
    expect(ids(definitionsInTab(defs, 'category:trend'))).toEqual(['sma', 'ema']);
    expect(ids(definitionsInTab(defs, 'category:other'))).toEqual(['plain']);
    expect(ids(definitionsInTab(defs, 'group:mine', [mine]))).toEqual(['my-lib/heat']);
    expect(definitionsInTab(defs, 'on-chart')).toEqual([]);
    const throwing = { id: 'bad', label: 'Bad', includes: () => { throw new Error('boom'); } };
    expect(definitionsInTab(defs, 'group:bad', [throwing])).toEqual([]);
  });
});

describe('search ranking', () => {
  // The ranking itself is core's (`packages/core/test/indicator-search.test.ts`); the picker re-exports it.
  it('re-exports the core matcher', () => {
    expect(matchRank).toBe(core.matchRank);
    expect(searchIndicators).toBe(core.searchIndicators);
    expect(matchRanks).toBe(core.matchTiers);
    expect(matchRank(rsi, 'rsl')).toBe(matchRanks.typo);
    expect(ids(searchIndicators(defs, 'momentum'))).toEqual(['rsi']);
  });
});

describe('recents and favourites', () => {
  it('moves the latest to the front, without duplicates, keeping eight', () => {
    let recents: string[] = [];
    for (const id of ['a', 'b', 'c', 'a']) recents = pushRecent(recents, id);
    expect(recents).toEqual(['a', 'c', 'b']);
    for (let i = 0; i < 12; i++) recents = pushRecent(recents, `x${i}`);
    expect(recents).toHaveLength(RECENT_LIMIT);
    expect(recents[0]).toBe('x11');
  });

  it('toggles favourites in the order they were starred', () => {
    let favorites = toggleFavorite([], 'rsi');
    favorites = toggleFavorite(favorites, 'sma');
    expect(favorites).toEqual(['rsi', 'sma']);
    expect(toggleFavorite(favorites, 'rsi')).toEqual(['sma']);
  });

  it('sanitizes stored lists', () => {
    expect(sanitizeMemory(null)).toEqual({ recents: [], favorites: [] });
    expect(sanitizeMemory({ recents: ['a', 1, 'a', '', 'b'], favorites: 'x' })).toEqual({ recents: ['a', 'b'], favorites: [] });
    const many = Array.from({ length: 20 }, (_, i) => `i${i}`);
    expect(sanitizeMemory({ recents: many, favorites: many }).recents).toHaveLength(RECENT_LIMIT);
    expect(sanitizeMemory({ recents: many, favorites: many }).favorites).toHaveLength(20);
  });

  describe('localStorage storage', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('round-trips through localStorage', () => {
      const store = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      });
      const storage = localIndicatorPickerStorage('test-key');
      expect(storage.load()).toBeNull();
      storage.save({ recents: ['rsi'], favorites: ['sma'] });
      expect(JSON.parse(store.get('test-key')!)).toEqual({ recents: ['rsi'], favorites: ['sma'] });
      expect(storage.load()).toEqual({ recents: ['rsi'], favorites: ['sma'] });
      store.set('test-key', '{not json');
      expect(storage.load()).toBeNull();
    });

    it('reads as empty and saves nothing when storage is blocked', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      });
      const storage = localIndicatorPickerStorage();
      expect(storage.load()).toBeNull();
      expect(() => storage.save({ recents: [], favorites: [] })).not.toThrow();
    });

    it('works without localStorage at all', () => {
      vi.stubGlobal('localStorage', undefined);
      const storage = localIndicatorPickerStorage();
      expect(storage.load()).toBeNull();
      expect(() => storage.save({ recents: ['a'], favorites: [] })).not.toThrow();
    });
  });
});

describe('sections', () => {
  const base: PickerViewInput = { defs, query: '', tab: 'all', favorites: [], recents: [], counts: new Map() };
  const shape = (input: Partial<PickerViewInput>) =>
    pickerSections({ ...base, ...input }).map((s) => [s.id, ids(s.rows.map((r) => r.def))]);

  it('lists every definition by name in the All tab', () => {
    expect(shape({})).toEqual([['all', ['bbands', 'ema', 'my-lib/heat', 'plain', 'rsi', 'sma', 'vwap']]]);
  });

  it('shows favourites, then recents not already favourites, before the full list', () => {
    expect(shape({ favorites: ['rsi', 'gone'], recents: ['vwap', 'rsi', 'sma'] })).toEqual([
      ['favorites', ['rsi']],
      ['recent', ['vwap', 'sma']],
      ['all', ['bbands', 'ema', 'my-lib/heat', 'plain', 'rsi', 'sma', 'vwap']],
    ]);
  });

  it('puts favourites first within a category tab', () => {
    expect(shape({ tab: 'category:trend', favorites: ['sma'] })).toEqual([['all', ['sma', 'ema']]]);
    expect(pickerSections({ ...base, tab: 'category:trend' })[0]!.label).toBe('Trend');
  });

  it('ranks a query within the tab, favourites first among equal matches', () => {
    expect(shape({ query: 'ma' })).toEqual([['results', ['sma', 'ema']]]);
    expect(shape({ query: 'ma', favorites: ['ema'] })).toEqual([['results', ['ema', 'sma']]]);
    expect(shape({ query: 'ma', tab: 'category:volume' })).toEqual([]);
    expect(shape({ query: 'zzz' })).toEqual([]);
  });

  it('marks rows with their on-chart count and favourite state', () => {
    const counts = countByType([{ type: 'sma' }, { type: 'sma' }, { type: 'rsi' }]);
    expect(counts.get('sma')).toBe(2);
    const rows = pickerSections({ ...base, counts, favorites: ['rsi'] }).at(-1)!.rows;
    const sma2 = rows.find((r) => r.def.id === 'sma')!;
    const rsi1 = rows.find((r) => r.def.id === 'rsi')!;
    expect([sma2.count, sma2.favorite]).toEqual([2, false]);
    expect([rsi1.count, rsi1.favorite]).toEqual([1, true]);
  });
});

describe('on-chart instances', () => {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const instances = [
    { type: 'sma', title: 'SMA 20 close' },
    { type: 'rsi', title: 'RSI 14' },
    { type: 'sma', title: 'SMA 50 close' },
    { type: 'missing/def', title: 'missing/def' },
  ];

  it('keeps every instance in order without a query', () => {
    expect(filterInstances(instances, byId, '')).toEqual(instances);
  });

  it('matches by title, by definition, or by type while pending', () => {
    expect(filterInstances(instances, byId, '50').map((i) => i.title)).toEqual(['SMA 50 close']);
    expect(filterInstances(instances, byId, 'relative').map((i) => i.title)).toEqual(['RSI 14']);
    expect(filterInstances(instances, byId, 'missing').map((i) => i.type)).toEqual(['missing/def']);
  });
});

describe('placement', () => {
  it('offers both placements only for either definitions', () => {
    expect(placementChoices(sma)).toEqual(['overlay', 'pane']);
    expect(placementChoices(rsi)).toEqual(['pane']);
    expect(placementChoices(bb)).toEqual(['overlay']);
  });

  it('uses the row choice, then the fallback, unless the definition fixes it', () => {
    expect(placementFor(sma, undefined)).toBe('overlay');
    expect(placementFor(sma, undefined, 'pane')).toBe('pane');
    expect(placementFor(sma, 'pane', 'overlay')).toBe('pane');
    expect(placementFor(rsi, 'overlay')).toBe('pane');
    expect(placementFor(bb, 'pane')).toBe('overlay');
  });
});

describe('input summary', () => {
  it('lists the defaults of number and source inputs, in order', () => {
    const withInputs = def('ma', {
      inputs: [
        { id: 'length', type: 'number', default: 14 },
        { id: 'color', type: 'color', default: '#fff' },
        { id: 'source', type: 'source', default: 'close' },
        { id: 'show', type: 'boolean', default: true },
        { id: 'mult', type: 'number', default: 2.5 },
      ],
    });
    expect(inputSummary(withInputs)).toBe('14, close, 2.5');
  });

  it('follows a custom legend title after the name', () => {
    const inputs: IndicatorDef['inputs'] = [
      { id: 'length', type: 'number', default: 20 },
      { id: 'mult', type: 'number', default: 2.5 },
      { id: 'upper', type: 'number', default: 70 },
    ];
    const titled = def('bands', { name: 'Bands', inputs, title: ({ length, mult }) => `Bands ${length} ${mult}` });
    expect(inputSummary(titled)).toBe('20, 2.5');
    expect(inputSummary({ ...titled, title: () => 'Bands' })).toBe('');
    expect(inputSummary({ ...titled, title: () => 'Something else 20' })).toBe('');
    expect(inputSummary({ ...titled, title: () => { throw new Error('bad'); } })).toBe('');
  });

  it('is empty without such inputs, or with malformed ones', () => {
    expect(inputSummary(plain)).toBe('');
    expect(inputSummary(def('bad', { inputs: undefined as never }))).toBe('');
    expect(inputSummary(def('holes', { inputs: [null, { id: 'n', type: 'number', default: 3 }] as never }))).toBe('3');
  });
});

describe('tab keys', () => {
  it('wraps arrows and jumps with Home and End', () => {
    expect(stepTab(0, 4, 'ArrowDown')).toBe(1);
    expect(stepTab(3, 4, 'ArrowRight')).toBe(0);
    expect(stepTab(0, 4, 'ArrowUp')).toBe(3);
    expect(stepTab(2, 4, 'Home')).toBe(0);
    expect(stepTab(1, 4, 'End')).toBe(3);
    expect(stepTab(1, 4, 'Enter')).toBeNull();
    expect(stepTab(0, 0, 'ArrowDown')).toBeNull();
  });
});
