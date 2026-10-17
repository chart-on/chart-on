/**
 * The DOM-free parts of the picker dialog: item types, search ranking and the
 * debounced, paged, abortable search controller.
 */
import { matchScore } from '@charton/core';

export { matchScore, matchTiers } from '@charton/core';

/** A row of the picker. */
export interface PickerItem {
  /** Unique within the picker; reported in the selection. */
  id: string;
  label: string;
  /** Secondary text; also searched. */
  description?: string;
  /** Category id(s) the item is listed under. */
  category?: string | readonly string[];
  /** Other words that find the item, e.g. abbreviations. */
  keywords?: readonly string[];
  /** Shown but cannot be picked. */
  disabled?: boolean;
}

/** A category of a picker's items, listed beside the results to narrow them. */
export interface PickerCategory {
  id: string;
  label: string;
}

/** What a `fetch` source is asked for besides the query: the page, page size, selected category and an abort signal. */
export interface PickerRequest {
  /** Zero-based page number. */
  page: number;
  pageSize: number;
  /** Selected category id; omitted for all. */
  category?: string;
  /** Aborted when a newer search replaces this one or the dialog closes. */
  signal: AbortSignal;
}

/** One page of results; with `hasMore` the picker asks for the next one as the list scrolls. */
export interface PickerPage<T> {
  items: T[];
  hasMore?: boolean;
}

/**
 * Internal: call a source and hand `done` the page it returns (a plain array is one page with no
 * more), or call `failed` when it throws, rejects or returns something else. Nothing happens
 * once `live()` turns false, so a newer request wins.
 */
export function settlePage<P extends PickerPage<unknown>>(
  call: () => P['items'] | P | Promise<P['items'] | P>,
  live: () => boolean,
  done: (page: P) => void,
  failed: () => void,
): void {
  // The executor turns a synchronous throw into a rejection.
  new Promise<P['items'] | P>((resolve) => resolve(call())).then(
    (result) => {
      if (!live()) return;
      const page = (Array.isArray(result) ? { items: result, hasMore: false } : result) as P;
      if (Array.isArray(page?.items)) done(page);
      else failed();
    },
    () => {
      if (live()) failed();
    },
  );
}

/**
 * Where items come from: a fixed list that the picker filters and ranks
 * itself, or a search function for server-side search.
 */
export type PickerSource<T extends PickerItem> =
  | { items: readonly T[] }
  | {
      fetch(query: string, request: PickerRequest): Promise<T[] | PickerPage<T>>;
    };

/** Internal: the words of `text`, split at anything but letters and digits. */
export const words = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Internal: lower case with runs of white space as one space, trimmed. */
export const normalize =(text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Internal: the items `score` gives a number (lower is better), best first, after sorting by
 * `first` when given, and by `then` among equal scores; equal items keep their order, as the sort is stable.
 */
export function rankBy<T>(
  items: readonly T[],
  score: (item: T) => number | null,
  first: (item: T) => number = () => 0,
  then: (item: T) => number = () => 0,
): T[] {
  return items
    .map((item) => ({ item, score: score(item) }))
    .filter((s): s is { item: T; score: number } => s.score !== null)
    .sort((a, b) => first(a.item) - first(b.item) || a.score - b.score || then(a.item) - then(b.item))
    .map((s) => s.item);
}

/** Options of `rankItems`: typo tolerance and favourites. */
export interface RankOptions {
  /** Also match a query of three or more characters one typo away from a label, a keyword or one of their words, ranked just above description matches. */
  typos?: boolean;
  /** Ids of items that come first among equally good matches. */
  favorites?: readonly string[];
}

/** Items matching `query`, best first; equal matches keep their order, favourites first. An empty query keeps every item. */
export function rankItems<T extends PickerItem>(items: readonly T[], query: string, options: RankOptions = {}): T[] {
  const favorites = options.favorites ?? [];
  return rankBy(
    items,
    (item) => matchScore(item, query, options),
    undefined,
    (item) => (favorites.includes(item.id) ? 0 : 1),
  );
}

/** The item is listed under `category` (every item is, without one). */
export function inCategory(item: PickerItem, category: string | undefined): boolean {
  if (category === undefined) return true;
  const own = item.category;
  return Array.isArray(own) ? own.includes(category) : own === category;
}

export interface PickerState<T> {
  query: string;
  category?: string;
  items: readonly T[];
  /** First page: `loading` while in flight, `error` when it failed. */
  status: 'loading' | 'ready' | 'error';
  /** Further pages. */
  more: 'idle' | 'loading' | 'error';
  hasMore: boolean;
}

export interface PickerController<T> {
  readonly state: PickerState<T>;
  /** Search after the debounce delay, or now with `immediate`. Newer searches win. */
  search(query: string, category: string | undefined, immediate?: boolean): void;
  loadMore(): void;
  /** Repeat the request that failed. */
  retry(): void;
  /** Cancel pending and in-flight work; later responses are dropped. */
  dispose(): void;
}

export interface PickerControllerOptions<T extends PickerItem> {
  source: PickerSource<T>;
  pageSize: number;
  /** Debounce for `search`, in ms. */
  delay: number;
  onChange(state: PickerState<T>): void;
}

export function createPickerController<T extends PickerItem>(options: PickerControllerOptions<T>): PickerController<T> {
  const { source, pageSize, delay, onChange } = options;
  let state: PickerState<T> = {
    query: '',
    items: [],
    status: 'loading',
    more: 'idle',
    hasMore: false,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborter: AbortController | null = null;
  let page = 0;
  /** Client source: every match for the current query, of which `state.items` is a prefix. */
  let ranked: T[] = [];
  let disposed = false;

  const update = (patch: Partial<PickerState<T>>) => {
    state = { ...state, ...patch };
    if (!disposed) onChange(state);
  };

  const request = (pageNumber: number, done: (page: PickerPage<T>) => void, failed: () => void) => {
    aborter?.abort();
    const controller = new AbortController();
    aborter = controller;
    if (!('fetch' in source)) return;
    const req: PickerRequest = {
      page: pageNumber,
      pageSize,
      signal: controller.signal,
    };
    if (state.category !== undefined) req.category = state.category;
    settlePage(() => source.fetch(state.query, req), () => !controller.signal.aborted && !disposed, done, failed);
  };

  const start = () => {
    page = 0;
    if (!('fetch' in source)) {
      ranked = rankItems(
        source.items.filter((item) => inCategory(item, state.category)),
        state.query,
      );
      update({
        items: ranked.slice(0, pageSize),
        status: 'ready',
        more: 'idle',
        hasMore: ranked.length > pageSize,
      });
      return;
    }
    update({ items: [], status: 'loading', more: 'idle', hasMore: false });
    request(
      0,
      (result) =>
        update({
          items: result.items,
          status: 'ready',
          hasMore: Boolean(result.hasMore) && result.items.length > 0,
        }),
      () => update({ status: 'error' }),
    );
  };

  function loadMore(): void {
    if (state.status !== 'ready' || state.more !== 'idle' || !state.hasMore) return;
    page++;
    if (!('fetch' in source)) {
      const items = ranked.slice(0, (page + 1) * pageSize);
      update({ items, hasMore: ranked.length > items.length });
      return;
    }
    update({ more: 'loading' });
    request(
      page,
      (result) =>
        update({
          items: [...state.items, ...result.items],
          more: 'idle',
          hasMore: Boolean(result.hasMore) && result.items.length > 0,
        }),
      () => {
        page--;
        update({ more: 'error' });
      },
    );
  }

  return {
    get state() {
      return state;
    },
    search(query, category, immediate = false) {
      clearTimeout(timer);
      aborter?.abort();
      const begin = () => {
        state = { ...state, query, category };
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
    dispose() {
      disposed = true;
      clearTimeout(timer);
      aborter?.abort();
    },
  };
}
