import { settlePage } from './picker-model';

/** Symbol fields the search dialog shows. A data source's symbol info fits as is. */
export interface SymbolSearchResult {
  /** Key handed back on selection, e.g. for loading the symbol. */
  symbol: string;
  name: string;
  description?: string;
  /** Free-form kind such as 'crypto', 'stock' or 'futures'; matched by the type filter. */
  type?: string;
  /** Matched by the exchange filter. */
  exchange?: string;
  /** Image URL shown before the symbol. */
  logo?: string;
  /** Root shared by the months of a futures contract; results with the same root are listed together. */
  root?: string;
}

/** What `search` is asked for besides the query: the selected exchange and type filters, and the page as an offset and limit. */
export interface SymbolSearchRequest {
  /** Selected exchange filter value; omitted for all exchanges. */
  exchange?: string;
  /** Selected type filter value; omitted for all types. */
  type?: string;
  /** Results already received for this query; return the ones after them. */
  offset: number;
  /** Results wanted per page. */
  limit: number;
}

/** One page of results. With `hasMore`, the dialog asks for the next page as the list scrolls. */
export interface SymbolSearchPage<T> {
  items: T[];
  hasMore: boolean;
}

/** One choice of the symbol search's exchange or type filter: the value results are matched on and its label. */
export interface SymbolSearchFilterOption {
  /** Compared with a result's `exchange` or `type`. */
  value: string;
  label: string;
}

/** The exchange and type filters a symbol search source offers. */
export interface SymbolSearchFilters {
  exchanges?: SymbolSearchFilterOption[];
  types?: SymbolSearchFilterOption[];
}

/** Where results come from. A data source with `search(query)` fits as is. */
export interface SymbolSearchSource<T extends SymbolSearchResult = SymbolSearchResult> {
  /**
   * Results for `query`: an array for the whole result, or a page to load the
   * rest on demand from `request.offset`.
   */
  search(query: string, request: SymbolSearchRequest): Promise<T[] | SymbolSearchPage<T>>;
  /** Exchange and type filters the dialog offers; none when omitted. */
  searchFilters?: SymbolSearchFilters;
}

export interface SearchQuery {
  text: string;
  exchange?: string;
  type?: string;
}

export interface SearchState<T> {
  /** Query of the latest request. */
  query: SearchQuery;
  /** Results to show, in source order. */
  items: readonly T[];
  /** First page of the query: `loading` while in flight, `error` when it failed. */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Further pages: `loading` while one is in flight, `error` when the last one failed. */
  more: 'idle' | 'loading' | 'error';
  /** `loadMore()` would show more results. */
  hasMore: boolean;
}

export interface SearchController<T> {
  readonly state: SearchState<T>;
  /** Search after the debounce delay, or now with `immediate`. Newer queries win. */
  setQuery(query: SearchQuery, immediate?: boolean): void;
  /** Show the next page: buffered results first, then the source's next page. */
  loadMore(): void;
  /** Repeat the request that failed. */
  retry(): void;
  /** Drop pending and in-flight requests (late responses are ignored) and clear the results. */
  reset(): void;
}

export interface SearchControllerOptions<T extends SymbolSearchResult> {
  search: SymbolSearchSource<T>['search'];
  onChange: (state: SearchState<T>) => void;
  /** Debounce for `setQuery`, in ms. */
  delay: number;
  pageSize: number;
}

/**
 * Debounced, paged symbol search. Every request carries a generation number,
 * so responses that arrive after a newer query (or `cancel`) are dropped.
 */
export function createSearchController<T extends SymbolSearchResult>(
  options: SearchControllerOptions<T>,
): SearchController<T> {
  const { search, onChange, delay, pageSize } = options;
  const idle = (query: SearchQuery): SearchState<T> => ({ query, items: [], status: 'idle', more: 'idle', hasMore: false });
  let state = idle({ text: '' });
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Matching results received but not shown yet. */
  let buffer: T[] = [];
  /** Results received from the source for this query: the next page's offset. */
  let received = 0;
  /** The source reported more pages. */
  let remoteMore = false;

  const update = (patch: Partial<SearchState<T>>) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  const send = (offset: number, done: (page: SymbolSearchPage<T>) => void, failed: () => void) => {
    const id = generation;
    const { text, exchange, type } = state.query;
    const request: SymbolSearchRequest = { offset, limit: pageSize };
    if (exchange) request.exchange = exchange;
    if (type) request.type = type;
    settlePage(() => search(text, request), () => id === generation, done, failed);
  };

  /** Keep the page's matching results (sources may ignore filters) and show up to one page more. */
  const take = (page: SymbolSearchPage<T>, append: boolean) => {
    received += page.items.length;
    // An empty page cannot advance the offset; stop instead of asking forever.
    remoteMore = page.hasMore && page.items.length > 0;
    buffer.push(...page.items.filter((item) => matchesFilters(item, state.query)));
    const shown = buffer.splice(0, pageSize);
    update({
      items: append ? [...state.items, ...shown] : shown,
      status: 'ready',
      more: 'idle',
      hasMore: buffer.length > 0 || remoteMore,
    });
    // Everything on this page was filtered out: fetch on, or the list stalls.
    if (shown.length === 0 && remoteMore) loadMore();
  };

  const start = () => {
    generation++;
    buffer = [];
    received = 0;
    remoteMore = false;
    // Drop the previous query's rows so nothing stale can be picked while loading.
    update({ items: [], status: 'loading', more: 'idle', hasMore: false });
    send(
      0,
      (page) => take(page, false),
      () => update({ items: [], status: 'error' }),
    );
  };

  function loadMore(): void {
    if (state.status !== 'ready' || state.more !== 'idle') return;
    if (buffer.length > 0) {
      const shown = buffer.splice(0, pageSize);
      update({ items: [...state.items, ...shown], hasMore: buffer.length > 0 || remoteMore });
      return;
    }
    if (!remoteMore) return;
    update({ more: 'loading' });
    send(
      received,
      (page) => take(page, true),
      () => update({ more: 'error' }),
    );
  }

  return {
    get state() {
      return state;
    },
    setQuery(query, immediate = false) {
      clearTimeout(timer);
      generation++;
      const begin = () => {
        state = { ...state, query: { ...query } };
        start();
      };
      if (immediate || delay <= 0) begin();
      else timer = setTimeout(begin, delay);
    },
    loadMore,
    retry() {
      if (state.status === 'error') start();
      else if (state.more === 'error') {
        update({ more: 'idle' });
        loadMore();
      }
    },
    reset() {
      clearTimeout(timer);
      generation++;
      buffer = [];
      received = 0;
      remoteMore = false;
      state = idle(state.query);
      onChange(state);
    },
  };
}

export function matchesFilters(item: SymbolSearchResult, query: SearchQuery): boolean {
  return (!query.exchange || item.exchange === query.exchange) && (!query.type || item.type === query.type);
}

export interface ResultGroup<T> {
  /** Futures root shared by the group; undefined for results listed on their own. */
  root?: string;
  items: T[];
}

/** Pull results that share a `root` together, at the first one's position; the rest keep their order. */
export function groupByRoot<T extends { root?: string }>(items: readonly T[]): ResultGroup<T>[] {
  const groups: ResultGroup<T>[] = [];
  const byRoot = new Map<string, ResultGroup<T>>();
  for (const item of items) {
    if (!item.root) {
      const last = groups[groups.length - 1];
      if (last && last.root === undefined) last.items.push(item);
      else groups.push({ items: [item] });
      continue;
    }
    let group = byRoot.get(item.root);
    if (!group) {
      group = { root: item.root, items: [] };
      byRoot.set(item.root, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export interface TextPart {
  text: string;
  match: boolean;
}

/** Split `text` into runs, marking case-insensitive occurrences of `query`. */
export function highlightParts(text: string, query: string): TextPart[] {
  const needle = query.trim();
  if (!text) return [];
  if (!needle) return [{ text, match: false }];
  const lower = needle.toLowerCase();
  const parts: TextPart[] = [];
  let plain = 0;
  let i = 0;
  while (i + needle.length <= text.length) {
    if (text.slice(i, i + needle.length).toLowerCase() !== lower) {
      i++;
      continue;
    }
    if (i > plain) parts.push({ text: text.slice(plain, i), match: false });
    parts.push({ text: text.slice(i, i + needle.length), match: true });
    i += needle.length;
    plain = i;
  }
  if (plain < text.length) parts.push({ text: text.slice(plain), match: false });
  return parts;
}

/** Secondary text of a result: its description, else its name when that differs from the symbol. */
export function symbolDetail(item: SymbolSearchResult): string {
  return item.description ?? (item.name !== item.symbol ? item.name : '');
}

const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp']);

/**
 * Active option index after a navigation key, or null when the key does not
 * navigate. `wrap` loops past the ends; turn it off while more results can load.
 */
export function stepActive(current: number, count: number, key: string, page: number, wrap: boolean): number | null {
  if (!NAV_KEYS.has(key)) return null;
  if (count === 0) return -1;
  switch (key) {
    case 'ArrowDown':
      if (current < count - 1) return current + 1;
      return wrap ? 0 : count - 1;
    case 'ArrowUp':
      if (current > 0) return current - 1;
      return wrap || current < 0 ? count - 1 : 0;
    case 'PageDown':
      return Math.min(count - 1, Math.max(current, 0) + page);
    default:
      return Math.max(0, current - page);
  }
}

/** A plain letter or digit without modifiers: typed on the chart, it starts a symbol search. */
export function isSearchKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing && /^[\p{L}\p{N}]$/u.test(e.key);
}
