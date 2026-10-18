import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer, installFakeDom } from '../../core/test/fake-dom';
import type { FavoritesList } from '../src/favorites';
import { createSymbolSearch } from '../src/symbol-search';
import type { SymbolSearchResult } from '../src/symbol-search-model';

installFakeDom();

type Node = HTMLElement & { children: Node[] };
const all = (root: Node): Node[] => root.children.flatMap((c) => [c, ...all(c)]);
const byClass = (root: HTMLElement, cls: string) => all(root as Node).filter((n) => n.className.split(/\s+/).includes(cls));

/** A favourites list kept in an array, with the given limit. */
function memoryList(initial: string[] = [], limit = 30): FavoritesList & { refs: string[] } {
  const listeners = new Set<(payload: { items: string[] }) => void>();
  const list = {
    kind: 'symbol',
    limit,
    refs: [...initial],
    get: () => [...list.refs],
    set(refs: readonly string[]) {
      list.refs = [...refs];
      listeners.forEach((l) => l({ items: list.get() }));
    },
    add(ref: string) {
      if (list.refs.includes(ref) || list.refs.length >= limit) return false;
      list.set([...list.refs, ref]);
      return true;
    },
    remove: (ref: string) => list.set(list.refs.filter((r) => r !== ref)),
    has: (ref: string) => list.refs.includes(ref),
    move() {},
    clear: () => list.set([]),
    isAvailable: () => true,
    activate: () => false,
    on(_event: 'change', listener: (payload: { items: string[] }) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return list;
}

const listed: SymbolSearchResult[] = [
  { symbol: 'AAA', name: 'Alpha' },
  { symbol: 'BBB', name: 'Beta' },
  { symbol: 'CCC', name: 'Gamma' },
];

const cleanups: (() => void)[] = [];
beforeEach(() => vi.stubGlobal('HTMLElement', class {}));
afterEach(() => {
  cleanups.splice(0).forEach((done) => done());
  vi.unstubAllGlobals();
});

function open(favorites: FavoritesList | null, onSelect = vi.fn(), all: SymbolSearchResult[] = []) {
  const search = vi.fn(async (query: string) => (query ? listed.filter((r) => r.symbol.startsWith(query)) : all));
  const dialog = createSymbolSearch(fakeContainer(), { source: { search }, onSelect, openOnTyping: false, debounce: 0, favorites });
  cleanups.push(() => dialog.destroy());
  const panel = dialog.el.children[0] as HTMLElement;
  Object.assign(byClass(panel, 'pc-symbol-search-input')[0]!, { setSelectionRange() {} });
  dialog.open();
  return { dialog, panel, search, onSelect };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const options = (panel: HTMLElement) => all(panel as Node).filter((n) => n.getAttribute('role') === 'option');
const stars = (panel: HTMLElement) => byClass(panel, 'pc-symbol-search-star');

describe('symbol search favourites', () => {
  it('lists starred symbols first while the box is empty, looked up through the source', async () => {
    const list = memoryList(['BBB', 'AAA']);
    const { panel, search, onSelect, dialog } = open(list);
    await settle();
    await settle();
    expect(search).toHaveBeenCalledWith('BBB', expect.objectContaining({ offset: 0 }));
    const rows = options(panel);
    expect(rows.map((r) => r.className.includes('is-unavailable'))).toEqual([false, false]);
    expect(stars(panel).map((s) => s.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
    dispatch(rows[0]!, 'click');
    expect(onSelect).toHaveBeenCalledWith(listed[1]);
    expect(dialog.isOpen).toBe(false);
  });

  it('shows a symbol the source no longer finds as unavailable, keeps it starred, and lets it be removed', async () => {
    const list = memoryList(['AAA', 'GONE']);
    const { panel, onSelect } = open(list);
    await settle();
    await settle();
    const rows = options(panel);
    expect(rows).toHaveLength(2);
    const gone = rows[1]!;
    expect(gone.className).toContain('is-unavailable');
    expect(gone.getAttribute('aria-disabled')).toBe('true');
    dispatch(gone, 'click');
    expect(onSelect).not.toHaveBeenCalled();
    expect(list.get()).toEqual(['AAA', 'GONE']);
    dispatch(stars(panel)[1]!, 'click');
    expect(list.get()).toEqual(['AAA']);
    expect(options(panel)).toHaveLength(1);
  });

  it('stars and unstars a search result', async () => {
    const list = memoryList();
    const { panel, dialog } = open(list);
    dialog.open('B');
    await settle();
    await settle();
    const star = stars(panel)[0]!;
    expect(star.getAttribute('aria-pressed')).toBe('false');
    expect(star.getAttribute('aria-label')).toBe('Add BBB to favorites');
    dispatch(star, 'click');
    expect(list.get()).toEqual(['BBB']);
    expect(stars(panel)[0]!.getAttribute('aria-pressed')).toBe('true');
    dispatch(stars(panel)[0]!, 'click');
    expect(list.get()).toEqual([]);
  });

  it('makes a row active when the pointer moves over its star', async () => {
    const { panel } = open(memoryList(), vi.fn(), listed);
    await settle();
    await settle();
    const selected = () => options(panel).map((r) => r.getAttribute('aria-selected'));
    dispatch(stars(panel)[2]!, 'mousemove', { screenX: 7, screenY: 7 });
    expect(selected()).toEqual(['false', 'false', 'true']);
    dispatch(stars(panel)[1]!, 'mousemove', { screenX: 8, screenY: 8 });
    expect(selected()).toEqual(['false', 'true', 'false']);
  });

  it('refuses a star past the limit', async () => {
    const list = memoryList(['AAA'], 1);
    const { panel, dialog } = open(list);
    dialog.open('B');
    await settle();
    await settle();
    dispatch(stars(panel)[0]!, 'click');
    expect(list.get()).toEqual(['AAA']);
  });

  it('makes only the active row star a Tab stop', async () => {
    const { panel, dialog } = open(memoryList());
    dialog.open('');
    dialog.open('A');
    await settle();
    await settle();
    expect(stars(panel).map((s) => s.tabIndex)).toEqual([0]);
  });

  it('does not list a starred symbol again among the results', async () => {
    const { panel } = open(memoryList(['BBB']), vi.fn(), listed);
    await settle();
    await settle();
    expect(options(panel)).toHaveLength(3);
  });

  it('looks a symbol up again on the next open when the search failed', async () => {
    const list = memoryList(['AAA']);
    let fail = true;
    const search = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return listed;
    });
    const dialog = createSymbolSearch(fakeContainer(), { source: { search }, onSelect: vi.fn(), openOnTyping: false, debounce: 0, favorites: list });
    cleanups.push(() => dialog.destroy());
    const panel = dialog.el.children[0] as HTMLElement;
    Object.assign(byClass(panel, 'pc-symbol-search-input')[0]!, { setSelectionRange() {} });
    dialog.open();
    await settle();
    await settle();
    expect(options(panel)[0]!.className).toContain('is-unavailable');
    dialog.close();
    fail = false;
    dialog.open();
    for (let i = 0; i < 4; i++) await settle();
    expect(options(panel)[0]!.className).not.toContain('is-unavailable');
    expect(list.get()).toEqual(['AAA']);
  });

  it('shows no stars without favourites', async () => {
    const { panel, dialog } = open(null);
    dialog.open('A');
    await settle();
    await settle();
    expect(options(panel)).toHaveLength(1);
    expect(stars(panel)).toHaveLength(0);
  });
});
