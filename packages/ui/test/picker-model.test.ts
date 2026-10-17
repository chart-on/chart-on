import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPickerController,
  inCategory,
  matchScore,
  matchTiers,
  rankItems,
  type PickerItem,
  type PickerRequest,
} from '../src/picker-model';

const item = (id: string, label: string, extra: Partial<PickerItem> = {}): PickerItem => ({ id, label, ...extra });
const labels = (items: readonly PickerItem[]) => items.map((i) => i.label);

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

afterEach(() => vi.useRealTimers());

describe('search ranking', () => {
  const items = [
    item('obv', 'On Balance Volume', {
      description: 'Cumulative volume by direction',
    }),
    item('rsi', 'Relative Strength Index', { keywords: ['oscillator'] }),
    item('vol', 'Volume'),
    item('vwap', 'Volume Weighted Average Price'),
    item('sma', 'Moving Average', { keywords: ['ma'] }),
    item('ema', 'Exponential Moving Average'),
  ];

  it('orders exact, prefix, word prefix, acronym, keyword, substring and description matches', () => {
    expect(labels(rankItems(items, 'volume'))).toEqual(['Volume', 'Volume Weighted Average Price', 'On Balance Volume']);
    expect(labels(rankItems(items, 'rsi'))).toEqual(['Relative Strength Index']);
    expect(labels(rankItems(items, 'vwap'))).toEqual(['Volume Weighted Average Price']);
    expect(labels(rankItems(items, 'osc'))).toEqual(['Relative Strength Index']);
    expect(labels(rankItems(items, 'cumulative'))).toEqual(['On Balance Volume']);
    expect(labels(rankItems(items, 'ma'))).toEqual(['Moving Average']);
    expect(labels(rankItems(items, 'mov'))).toEqual(['Moving Average', 'Exponential Moving Average']);
  });

  it('matches several words anywhere', () => {
    expect(labels(rankItems(items, 'average expo'))).toEqual(['Exponential Moving Average']);
  });

  it('keeps the source order for equal matches and for an empty query', () => {
    expect(labels(rankItems(items, ''))).toEqual(labels(items));
    expect(labels(rankItems(items, 'average'))).toEqual([
      'Volume Weighted Average Price',
      'Moving Average',
      'Exponential Moving Average',
    ]);
  });

  it('tolerates one typo with the typos option, ranked just above description matches', () => {
    expect(rankItems(items, 'volme')).toEqual([]);
    // Equal typo matches keep their order.
    expect(labels(rankItems(items, 'volme', { typos: true }))).toEqual(['On Balance Volume', 'Volume', 'Volume Weighted Average Price']);
    // A swap of neighbours, and a keyword.
    expect(labels(rankItems(items, 'oscillaotr', { typos: true }))).toEqual(['Relative Strength Index']);
    // Short queries would match too much.
    expect(rankItems(items, 'mx', { typos: true })).toEqual([]);
    const typo = item('t', 'Volume', { description: 'directional volume' });
    expect(matchScore(typo, 'volme', { typos: true })).toBeLessThan(matchScore(item('d', 'Other', { description: 'volme' }), 'volme', { typos: true })!);
  });

  it('puts favourites first among equal matches only', () => {
    const favorites = ['ema', 'vol'];
    expect(labels(rankItems(items, 'average', { favorites }))).toEqual([
      'Exponential Moving Average',
      'Volume Weighted Average Price',
      'Moving Average',
    ]);
    // An exact match still beats a favourite prefix match.
    expect(labels(rankItems(items, 'volume', { favorites: ['vwap'] }))).toEqual(['Volume', 'Volume Weighted Average Price', 'On Balance Volume']);
    expect(labels(rankItems(items, '', { favorites }))).toEqual(['Volume', 'Exponential Moving Average', 'On Balance Volume', 'Relative Strength Index', 'Volume Weighted Average Price', 'Moving Average']);
  });

  it('matches descriptions from one character on', () => {
    expect(matchScore(item('a', 'Alpha', { description: 'zeta' }), 'z')).toBe(matchTiers.description);
  });

  it('scores no match as null', () => {
    expect(matchScore(item('a', 'Alpha'), 'zeta')).toBeNull();
    expect(matchScore(item('a', 'Alpha'), 'ALPHA')).toBe(0);
  });

  it('filters by category', () => {
    expect(inCategory(item('a', 'A', { category: ['x', 'y'] }), 'y')).toBe(true);
    expect(inCategory(item('a', 'A', { category: 'x' }), 'y')).toBe(false);
    expect(inCategory(item('a', 'A'), undefined)).toBe(true);
  });
});

describe('picker controller', () => {
  it('ranks and pages a fixed list', () => {
    const items = Array.from({ length: 5 }, (_, i) => item(`i${i}`, `Item ${i}`, { category: i % 2 ? 'odd' : 'even' }));
    const changes = vi.fn();
    const c = createPickerController({
      source: { items },
      pageSize: 2,
      delay: 0,
      onChange: changes,
    });
    c.search('', undefined);
    expect(labels(c.state.items)).toEqual(['Item 0', 'Item 1']);
    expect(c.state.hasMore).toBe(true);
    c.loadMore();
    c.loadMore();
    expect(c.state.items).toHaveLength(5);
    expect(c.state.hasMore).toBe(false);
    c.search('', 'odd');
    expect(labels(c.state.items)).toEqual(['Item 1', 'Item 3']);
    c.search('item 4', undefined);
    expect(labels(c.state.items)).toEqual(['Item 4']);
  });

  it('debounces, aborts older requests and pages a fetch source', async () => {
    vi.useFakeTimers();
    const requests: { query: string; request: PickerRequest }[] = [];
    const fetch = vi.fn(async (query: string, request: PickerRequest) => {
      requests.push({ query, request });
      return {
        items: [item(`${query}-${request.page}`, `${query} ${request.page}`)],
        hasMore: request.page < 1,
      };
    });
    const c = createPickerController({
      source: { fetch },
      pageSize: 1,
      delay: 100,
      onChange: () => {},
    });
    c.search('a', 'cat');
    c.search('ab', 'cat');
    expect(fetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requests[0]!.query).toBe('ab');
    expect(requests[0]!.request).toMatchObject({
      page: 0,
      pageSize: 1,
      category: 'cat',
    });
    await flush();
    expect(labels(c.state.items)).toEqual(['ab 0']);
    c.loadMore();
    await flush();
    expect(labels(c.state.items)).toEqual(['ab 0', 'ab 1']);
    expect(c.state.hasMore).toBe(false);

    c.search('x', undefined, true);
    const signal = requests[requests.length - 1]!.request.signal;
    c.search('y', undefined, true);
    expect(signal.aborted).toBe(true);
    await flush();
    expect(labels(c.state.items)).toEqual(['y 0']);
  });

  it('reports errors and retries', async () => {
    let fail = true;
    const fetch = vi.fn(async () => {
      if (fail) throw new Error('down');
      return [item('a', 'A')];
    });
    const c = createPickerController({
      source: { fetch },
      pageSize: 10,
      delay: 0,
      onChange: () => {},
    });
    c.search('', undefined);
    await flush();
    expect(c.state.status).toBe('error');
    fail = false;
    c.retry();
    await flush();
    expect(c.state.status).toBe('ready');
    expect(labels(c.state.items)).toEqual(['A']);
  });

  it('drops responses after dispose', async () => {
    const onChange = vi.fn();
    const c = createPickerController({
      source: { fetch: async () => [item('a', 'A')] },
      pageSize: 10,
      delay: 0,
      onChange,
    });
    c.search('', undefined);
    c.dispose();
    await flush();
    expect(onChange.mock.calls.every(([s]) => s.status === 'loading')).toBe(true);
  });
});
