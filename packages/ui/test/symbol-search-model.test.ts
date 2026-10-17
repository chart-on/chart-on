import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSearchController,
  groupByRoot,
  highlightParts,
  isSearchKey,
  stepActive,
  symbolDetail,
  type SymbolSearchPage,
  type SymbolSearchRequest,
  type SymbolSearchResult,
  type SymbolSearchSource,
} from '../src/symbol-search-model';

type Result = SymbolSearchResult;
type Response = Result[] | SymbolSearchPage<Result>;

const sym = (symbol: string, extra: Partial<Result> = {}): Result => ({ symbol, name: symbol, ...extra });
const symbols = (state: { items: readonly Result[] }) => state.items.map((item) => item.symbol);

/** Let pending promise callbacks run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(
  search: (query: string, request: SymbolSearchRequest) => Promise<Response>,
  { delay = 100, pageSize = 2 } = {},
) {
  const fn = vi.fn(search);
  const controller = createSearchController<Result>({ search: fn, onChange: () => {}, delay, pageSize });
  return { controller, search: fn };
}

describe('createSearchController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces queries and searches only the latest', async () => {
    const t = setup(async (query) => [sym(query.toUpperCase())]);
    t.controller.setQuery({ text: 'a' });
    vi.advanceTimersByTime(60);
    t.controller.setQuery({ text: 'ab' });
    vi.advanceTimersByTime(99);
    expect(t.search).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(t.search).toHaveBeenCalledTimes(1);
    expect(t.search).toHaveBeenCalledWith('ab', { offset: 0, limit: 2 });
    expect(t.controller.state.status).toBe('loading');
    await flush();
    expect(t.controller.state.status).toBe('ready');
    expect(symbols(t.controller.state)).toEqual(['AB']);
  });

  it('searches at once when immediate, and sends only the filters that are set', () => {
    const t = setup(async () => []);
    t.controller.setQuery({ text: 'x', exchange: 'A' }, true);
    expect(t.search).toHaveBeenLastCalledWith('x', { offset: 0, limit: 2, exchange: 'A' });
    t.controller.setQuery({ text: 'x', type: 'stock' }, true);
    expect(t.search).toHaveBeenLastCalledWith('x', { offset: 0, limit: 2, type: 'stock' });
  });

  it('ignores responses that arrive after a newer query', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
    const t = setup((query) => {
      const d = deferred<Response>();
      pending.set(query, d);
      return d.promise;
    });
    t.controller.setQuery({ text: 'a' }, true);
    t.controller.setQuery({ text: 'ab' }, true);
    pending.get('a')!.resolve([sym('OLD')]);
    await flush();
    expect(t.controller.state.status).toBe('loading');
    expect(t.controller.state.items).toEqual([]);
    pending.get('ab')!.resolve([sym('NEW')]);
    await flush();
    expect(symbols(t.controller.state)).toEqual(['NEW']);
    expect(t.controller.state.query.text).toBe('ab');
  });

  it("clears the previous query's results while the next one loads", async () => {
    const t = setup(async (query) => [sym(query.toUpperCase())]);
    t.controller.setQuery({ text: 'a' }, true);
    await flush();
    expect(symbols(t.controller.state)).toEqual(['A']);
    t.controller.setQuery({ text: 'ab' }, true);
    expect(t.controller.state.status).toBe('loading');
    expect(t.controller.state.items).toEqual([]);
    await flush();
    expect(symbols(t.controller.state)).toEqual(['AB']);
  });

  it('drops an in-flight response as soon as a newer query is typed', async () => {
    const d = deferred<Response>();
    const t = setup(() => d.promise);
    t.controller.setQuery({ text: 'a' }, true);
    t.controller.setQuery({ text: 'ab' });
    d.resolve([sym('A')]);
    await flush();
    expect(t.controller.state.items).toEqual([]);
  });

  it('reports errors, including synchronous throws and malformed results, and retries', async () => {
    let fail = true;
    const t = setup(async () => {
      if (fail) throw new Error('offline');
      return [sym('OK')];
    });
    t.controller.setQuery({ text: 'a' }, true);
    await flush();
    expect(t.controller.state.status).toBe('error');
    fail = false;
    t.controller.retry();
    expect(t.controller.state.status).toBe('loading');
    await flush();
    expect(t.controller.state.status).toBe('ready');
    expect(symbols(t.controller.state)).toEqual(['OK']);

    const sync = setup(() => {
      throw new Error('bad');
    });
    sync.controller.setQuery({ text: 'a' }, true);
    await flush();
    expect(sync.controller.state.status).toBe('error');

    const malformed = setup(async () => undefined as unknown as Response);
    malformed.controller.setQuery({ text: 'a' }, true);
    await flush();
    expect(malformed.controller.state.status).toBe('error');
  });

  it('pages through a source with offsets, one page in flight at a time', async () => {
    const all = ['A', 'B', 'C', 'D', 'E'].map((s) => sym(s));
    const t = setup(async (_query, { offset, limit }) => ({
      items: all.slice(offset, offset + limit),
      hasMore: offset + limit < all.length,
    }));
    t.controller.setQuery({ text: '' }, true);
    await flush();
    expect(symbols(t.controller.state)).toEqual(['A', 'B']);
    expect(t.controller.state.hasMore).toBe(true);

    t.controller.loadMore();
    t.controller.loadMore();
    expect(t.search).toHaveBeenCalledTimes(2);
    expect(t.search).toHaveBeenLastCalledWith('', { offset: 2, limit: 2 });
    expect(t.controller.state.more).toBe('loading');
    await flush();
    expect(symbols(t.controller.state)).toEqual(['A', 'B', 'C', 'D']);

    t.controller.loadMore();
    await flush();
    expect(symbols(t.controller.state)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(t.controller.state.hasMore).toBe(false);
    t.controller.loadMore();
    expect(t.search).toHaveBeenCalledTimes(3);
  });

  it('keeps the list when a further page fails, and retries that page', async () => {
    let fail = false;
    const t = setup(async (_query, { offset }) => {
      if (fail) throw new Error('offline');
      return { items: [sym(`P${offset}`), sym(`Q${offset}`)], hasMore: true };
    });
    t.controller.setQuery({ text: '' }, true);
    await flush();
    fail = true;
    t.controller.loadMore();
    await flush();
    expect(t.controller.state.more).toBe('error');
    expect(t.controller.state.status).toBe('ready');
    expect(symbols(t.controller.state)).toEqual(['P0', 'Q0']);
    // Scrolling does not hammer a failing source; only retry asks again.
    t.controller.loadMore();
    expect(t.search).toHaveBeenCalledTimes(2);
    fail = false;
    t.controller.retry();
    await flush();
    expect(t.search).toHaveBeenLastCalledWith('', { offset: 2, limit: 2 });
    expect(symbols(t.controller.state)).toEqual(['P0', 'Q0', 'P2', 'Q2']);
  });

  it('shows a long array a page at a time without asking the source again', async () => {
    const t = setup(async () => ['A', 'B', 'C', 'D', 'E'].map((s) => sym(s)));
    t.controller.setQuery({ text: '' }, true);
    await flush();
    expect(symbols(t.controller.state)).toEqual(['A', 'B']);
    expect(t.controller.state.hasMore).toBe(true);
    t.controller.loadMore();
    expect(symbols(t.controller.state)).toEqual(['A', 'B', 'C', 'D']);
    t.controller.loadMore();
    expect(symbols(t.controller.state)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(t.controller.state.hasMore).toBe(false);
    expect(t.search).toHaveBeenCalledTimes(1);
  });

  it('applies the filters to the results when the source ignores them', async () => {
    const t = setup(async () => [
      sym('A1', { exchange: 'A', type: 'stock' }),
      sym('B1', { exchange: 'B', type: 'stock' }),
      sym('A2', { exchange: 'A', type: 'crypto' }),
    ]);
    t.controller.setQuery({ text: '', exchange: 'A' }, true);
    await flush();
    expect(symbols(t.controller.state)).toEqual(['A1', 'A2']);
    t.controller.setQuery({ text: '', exchange: 'A', type: 'crypto' }, true);
    await flush();
    expect(symbols(t.controller.state)).toEqual(['A2']);
  });

  it('fetches on when a page is filtered down to nothing', async () => {
    const pages: Result[][] = [[sym('B1', { exchange: 'B' }), sym('B2', { exchange: 'B' })], [sym('A1', { exchange: 'A' })]];
    const t = setup(async (_query, { offset }) => ({ items: pages[offset / 2] ?? [], hasMore: offset === 0 }));
    t.controller.setQuery({ text: '', exchange: 'A' }, true);
    await flush();
    expect(t.search).toHaveBeenCalledTimes(2);
    expect(symbols(t.controller.state)).toEqual(['A1']);
    expect(t.controller.state.hasMore).toBe(false);
  });

  it('stops paging when a source reports more but returns nothing', async () => {
    const t = setup(async () => ({ items: [], hasMore: true }));
    t.controller.setQuery({ text: 'z' }, true);
    await flush();
    expect(t.controller.state.hasMore).toBe(false);
    expect(t.search).toHaveBeenCalledTimes(1);
  });

  it('reset drops pending and in-flight searches and clears the results', async () => {
    const d = deferred<Response>();
    const t = setup(async (query) => (query === 'slow' ? d.promise : [sym('A')]));
    t.controller.setQuery({ text: 'a' }, true);
    await flush();
    expect(symbols(t.controller.state)).toEqual(['A']);
    t.controller.setQuery({ text: 'slow' }, true);
    t.controller.setQuery({ text: 'later' });
    t.controller.reset();
    expect(t.controller.state.status).toBe('idle');
    expect(t.controller.state.items).toEqual([]);
    vi.advanceTimersByTime(500);
    d.resolve([sym('LATE')]);
    await flush();
    expect(t.search).toHaveBeenCalledTimes(2);
    expect(t.controller.state.items).toEqual([]);
  });

  it('notifies every state change', async () => {
    const seen: string[] = [];
    const controller = createSearchController<Result>({
      search: async () => [sym('A')],
      onChange: (state) => seen.push(state.status),
      delay: 0,
      pageSize: 10,
    });
    controller.setQuery({ text: 'a' });
    await flush();
    expect(seen).toEqual(['loading', 'ready']);
  });
});

describe('groupByRoot', () => {
  it('pulls results with the same root together at the first one', () => {
    const items = [
      sym('A'),
      sym('XFZ6', { root: 'XF' }),
      sym('B'),
      sym('XFH7', { root: 'XF' }),
      sym('XGZ6', { root: 'XG' }),
      sym('C'),
    ];
    const groups = groupByRoot(items);
    expect(groups.map((g) => [g.root, g.items.map((i) => i.symbol)])).toEqual([
      [undefined, ['A']],
      ['XF', ['XFZ6', 'XFH7']],
      [undefined, ['B']],
      ['XG', ['XGZ6']],
      [undefined, ['C']],
    ]);
  });

  it('keeps ungrouped results in one run', () => {
    expect(groupByRoot([sym('A'), sym('B')])).toEqual([{ items: [sym('A'), sym('B')] }]);
    expect(groupByRoot([])).toEqual([]);
  });
});

describe('highlightParts', () => {
  it('marks every case-insensitive occurrence', () => {
    expect(highlightParts('BTCUSD btc', 'btc')).toEqual([
      { text: 'BTC', match: true },
      { text: 'USD ', match: false },
      { text: 'btc', match: true },
    ]);
    expect(highlightParts('Gold / US Dollar', ' us ')).toEqual([
      { text: 'Gold / ', match: false },
      { text: 'US', match: true },
      { text: ' Dollar', match: false },
    ]);
  });

  it('returns the text unmarked without a query or a match', () => {
    expect(highlightParts('ABC', '')).toEqual([{ text: 'ABC', match: false }]);
    expect(highlightParts('ABC', 'z')).toEqual([{ text: 'ABC', match: false }]);
    expect(highlightParts('', 'a')).toEqual([]);
  });

  it('does not overlap matches', () => {
    expect(highlightParts('aaa', 'aa')).toEqual([
      { text: 'aa', match: true },
      { text: 'a', match: false },
    ]);
  });
});

describe('symbolDetail', () => {
  it('prefers the description, then a name that differs from the symbol', () => {
    expect(symbolDetail(sym('ABC', { name: 'Abc Corp', description: 'ABC Industries' }))).toBe('ABC Industries');
    expect(symbolDetail(sym('ABC', { name: 'Abc Corp' }))).toBe('Abc Corp');
    expect(symbolDetail(sym('ABC'))).toBe('');
  });
});

describe('stepActive', () => {
  it('moves with the arrow keys and wraps when allowed', () => {
    expect(stepActive(-1, 3, 'ArrowDown', 5, true)).toBe(0);
    expect(stepActive(0, 3, 'ArrowDown', 5, true)).toBe(1);
    expect(stepActive(2, 3, 'ArrowDown', 5, true)).toBe(0);
    expect(stepActive(0, 3, 'ArrowUp', 5, true)).toBe(2);
    expect(stepActive(-1, 3, 'ArrowUp', 5, true)).toBe(2);
    expect(stepActive(2, 3, 'ArrowUp', 5, true)).toBe(1);
  });

  it('stops at the ends while more results can load', () => {
    expect(stepActive(2, 3, 'ArrowDown', 5, false)).toBe(2);
    expect(stepActive(0, 3, 'ArrowUp', 5, false)).toBe(0);
  });

  it('jumps a page and clamps', () => {
    expect(stepActive(1, 20, 'PageDown', 5, true)).toBe(6);
    expect(stepActive(18, 20, 'PageDown', 5, true)).toBe(19);
    expect(stepActive(-1, 20, 'PageDown', 5, true)).toBe(5);
    expect(stepActive(7, 20, 'PageUp', 5, true)).toBe(2);
    expect(stepActive(3, 20, 'PageUp', 5, true)).toBe(0);
  });

  it('ignores other keys and handles an empty list', () => {
    expect(stepActive(0, 3, 'Enter', 5, true)).toBeNull();
    expect(stepActive(0, 3, 'Home', 5, true)).toBeNull();
    expect(stepActive(-1, 0, 'ArrowDown', 5, true)).toBe(-1);
  });
});

describe('isSearchKey', () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    ...mods,
  });

  it('accepts plain letters and digits in any script', () => {
    expect(isSearchKey(key('a'))).toBe(true);
    expect(isSearchKey(key('Z'))).toBe(true);
    expect(isSearchKey(key('7'))).toBe(true);
    expect(isSearchKey(key('é'))).toBe(true);
  });

  it('rejects shortcuts, named keys, symbols and composition', () => {
    expect(isSearchKey(key('z', { ctrlKey: true }))).toBe(false);
    expect(isSearchKey(key('z', { metaKey: true }))).toBe(false);
    expect(isSearchKey(key('r', { altKey: true }))).toBe(false);
    expect(isSearchKey(key('a', { isComposing: true }))).toBe(false);
    expect(isSearchKey(key('Enter'))).toBe(false);
    expect(isSearchKey(key('ArrowLeft'))).toBe(false);
    expect(isSearchKey(key('+'))).toBe(false);
    expect(isSearchKey(key('-'))).toBe(false);
    expect(isSearchKey(key(' '))).toBe(false);
  });
});
