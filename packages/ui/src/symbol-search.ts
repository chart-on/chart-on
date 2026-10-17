import type { Chart, MessageParams } from '@charton/core';
import { Star } from 'lucide';
import { button, iconButton, segmentedTabs } from './controls';
import type { FavoritesList } from './favorites';
import { createListbox, type Listbox } from './listbox';
import { dialogClassFor } from './dialog';
import { h } from './dom';
import { resultsText, shellText, type ShellMessageKey } from './messages';
import {
  createSearchController,
  groupByRoot,
  isSearchKey,
  stepActive,
  symbolDetail,
  type SearchState,
  type SymbolSearchResult,
  type SymbolSearchSource,
} from './symbol-search-model';
import { marked, nearEnd, onPointerMove, pageRows, searchModal } from './search-modal';
import { bindSymbolSearchKeys } from './shortcuts';
import { devCheck } from './options-schema';

/** Options for `createSymbolSearch`: the result source, the pick callback, search debounce and page size, type-to-open, and where its shortcut is heard. */
export interface SymbolSearchOptions<T extends SymbolSearchResult = SymbolSearchResult> {
  /** Where results come from, e.g. a data source. */
  source: SymbolSearchSource<T>;
  /** Called with the picked result after the dialog has closed. */
  onSelect: (result: T) => void;
  /** Wait this long after the last keystroke before searching, in ms. Default 200. */
  debounce?: number;
  /** Results per page. Default 50. */
  pageSize?: number;
  /**
   * Typing a letter or digit while this element has focus opens the dialog
   * with that character. In a shell, by default, typing on the chart or
   * elsewhere in the shell outside text fields does, except keys bound to an
   * action; `false` turns this off.
   */
  openOnTyping?: HTMLElement | false;
  /**
   * In a shell: where the `symbol-search` shortcut (Mod+K, `/`) is heard.
   * `'shell'` (default) anywhere in the shell, `'document'` anywhere on the page.
   */
  shortcutScope?: 'shell' | 'document';
  /**
   * The chart whose `localization` option sets the dialog's language, read
   * each time it opens. The shell passes its chart. Default: built-in English.
   */
  chart?: Pick<Chart, 'localization'>;
  /**
   * Starred symbols (by `symbol`), e.g. the shell's `favorites.of('symbol')`,
   * which the shell passes when it has the `favorites` part. Each result gets
   * a star, and with an empty search box and no filters the starred symbols
   * are listed first. Each is looked up through `source`; one it no longer
   * finds shows as unavailable and stays starred.
   */
  favorites?: FavoritesList | null;
}

/** The symbol search dialog made by `createSymbolSearch`: open or close it, and `destroy`. */
export interface SymbolSearchDialog {
  /** Backdrop that holds the dialog; hidden while closed. */
  el: HTMLElement;
  readonly isOpen: boolean;
  /** Open with `query` in the search box (empty by default) and search right away. */
  open(query?: string): void;
  /** Close and return focus to where it was before opening. */
  close(): void;
  destroy(): void;
}

let uid = 0;

/**
 * Modal symbol search: a search box over a list of results. Mount it in a
 * `.pc-shell` element so it picks up the theme; it covers that element while open.
 */
export function createSymbolSearch<T extends SymbolSearchResult>(
  host: HTMLElement,
  options: SymbolSearchOptions<T>,
): SymbolSearchDialog {
  const id = `pc-symbol-search-${++uid}`;
  const typingTarget = options.openOnTyping || null;
  let exchange = '';
  let type = '';
  let isOpen = false;
  /** Options in display order (grouped results pulled together). */
  let shown: T[] = [];
  let optionEls = new Map<T, HTMLElement>();
  let active: T | null = null;
  let lastStatus: SearchState<T>['status'] = 'idle';
  const starred = options.favorites ?? null;
  /**
   * Starred symbols looked up while the dialog is open: the result, null when
   * the source has none, or `'failed'` when the search failed (tried again on the next open).
   */
  const resolved = new Map<string, T | null | 'failed'>();
  /** Star buttons by result, so only the active row's is a Tab stop. */
  let stars = new Map<T, HTMLElement>();
  /** Lookups of starred symbols in flight. */
  let lookingUp: Promise<unknown> | null = null;
  /** Counts opens, so a lookup started before the dialog closed is ignored after it opens again. */
  let opened = 0;
  // A star changed elsewhere (another chart, the API): list it at once.
  const offStarred = starred?.on('change', () => isOpen && render(controller.state)) ?? (() => {});

  /** Text in the chart's language. */
  const t = (key: ShellMessageKey, params?: MessageParams) => shellText(options.chart, key, params);
  const modal = searchModal(host, id, `pc-symbol-search ${dialogClassFor(host)}`.trim(), close);
  const { el, panel, field, input } = modal;
  const list = h('div', { class: 'pc-symbol-search-list', role: 'listbox', id: `${id}-list` });
  const message = h('div', { class: 'pc-symbol-search-message' });
  const footer = h('div', { class: 'pc-symbol-search-footer' });
  message.hidden = footer.hidden = true;
  const results = h('div', { class: 'pc-symbol-search-results' }, list, message, footer);
  const status = h('div', { class: 'pc-sr-only', role: 'status' });
  const bar = h('div', { class: 'pc-symbol-search-bar' }, field);
  panel.append(bar);
  let relabelFilters = () => {};
  let exchangeBox: Listbox | null = null;
  createFilters();
  /** Set the fixed text in the chart's current language. */
  const relabel = () => {
    modal.label(t('actionSymbolSearch'), t('dialogClose'), t('symbolSearchInput'), t('symbolSearchPlaceholder'));
    list.setAttribute('aria-label', t('symbolSearchList'));
    relabelFilters();
  };
  relabel();
  panel.append(results, status);

  const controller = createSearchController<T>({
    search: (query, request) => options.source.search(query, request),
    onChange: render,
    delay: options.debounce ?? 200,
    pageSize: options.pageSize ?? 50,
  });

  /** Exchange select beside the search box (two or more exchanges), type tabs on a row below. */
  function createFilters(): void {
    const { types, exchanges } = options.source.searchFilters ?? {};
    const typeOptions = () => [{ value: '', label: t('symbolSearchAllTypes') }, ...(types ?? [])];
    const exchangeOptions = () => [{ value: '', label: t('symbolSearchAllExchanges') }, ...(exchanges ?? [])];
    const tabs = types?.length
      ? segmentedTabs(typeOptions(), '', (value) => {
          type = value;
          search(true);
        }, t('symbolSearchType'))
      : null;
    if (tabs) panel.append(h('div', { class: 'pc-symbol-search-filters' }, tabs.el));
    relabelFilters = () => {
      tabs?.relabel(t('symbolSearchType'), typeOptions());
      // A single exchange leaves nothing to filter. The list is rebuilt in the current language.
      if (!exchanges || exchanges.length < 2) return;
      exchangeBox?.destroy();
      exchangeBox = createListbox({
        options: exchangeOptions(),
        value: exchange,
        label: t('symbolSearchExchange'),
        localization: options.chart?.localization,
        set: (value) => {
          exchange = String(value);
          search(true);
        },
      });
      bar.replaceChildren(field, exchangeBox.el);
    };
  }

  function search(immediate: boolean): void {
    controller.setQuery({ text: input.value.trim(), exchange: exchange || undefined, type: type || undefined }, immediate);
  }

  function render(state: SearchState<T>): void {
    // Fresh results start at the top; appended pages keep the active option.
    const fresh = state.status !== lastStatus && (state.status === 'ready' || state.status === 'error');
    lastStatus = state.status;
    const watch = watchlist(state);
    // A starred symbol listed first is not listed again among the results.
    const watched = new Set(watch.flatMap((item) => (item && item !== 'failed' ? [item.symbol] : [])));
    const groups = groupByRoot(watched.size ? state.items.filter((item) => !watched.has(item.symbol)) : state.items);
    shown = [...watch.flatMap((item) => (item && item !== 'failed' ? [item] : [])), ...groups.flatMap((group) => group.items)];
    if (fresh || !active || !shown.includes(active)) active = shown[0] ?? null;

    const query = state.query.text;
    const logos = shown.some((item) => item.logo);
    list.classList.toggle('has-logos', logos);
    list.classList.toggle('has-stars', !!starred);
    optionEls = new Map();
    stars = new Map();
    let index = 0;
    const rows = groups.map((group, g) => {
      const items = group.items.map((item) => option(item, index++, query, logos));
      if (group.root === undefined) return items;
      const label = h('div', { class: 'pc-symbol-search-group-label', id: `${id}-group-${g}`, 'aria-hidden': 'true' }, group.root);
      return [h('div', { class: 'pc-symbol-search-group', role: 'group', 'aria-labelledby': label.id }, label, ...items)];
    });
    if (watch.length > 0) {
      const label = h('div', { class: 'pc-symbol-search-group-label', id: `${id}-favorites`, 'aria-hidden': 'true' }, t('indicatorsFavorites'));
      const refs = starred!.get();
      const items = watch.map((item, i) => (item && item !== 'failed' ? option(item, index++, '', logos) : unavailable(refs[i]!, logos, item === 'failed')));
      rows.unshift([h('div', { class: 'pc-symbol-search-group', role: 'group', 'aria-labelledby': label.id }, label, ...items)]);
    }
    list.replaceChildren(...rows.flat());
    list.setAttribute('aria-busy', String(state.status === 'loading'));
    setActive(active, false);
    if (fresh) results.scrollTop = 0;

    fill(message, messageFor(state));
    fill(footer, footerFor(state));
    if (fresh) status.textContent = announce(state);
    // A short list cannot be scrolled to its end, so load on until it fills.
    if (state.hasMore) queueMicrotask(loadIfNearEnd);
  }

  /**
   * The starred symbols to list first, in order: a result, or null or `'failed'`
   * for one the source no longer finds or could not look up. Only for an empty search box with no filters, once
   * every star has been looked up; starts the lookups the first time.
   */
  function watchlist(state: SearchState<T>): (T | null | 'failed')[] {
    const { text, exchange, type } = state.query;
    const refs = starred?.get() ?? [];
    // Closing resets the search, which redraws: no lookups then.
    if (!isOpen || text || exchange || type || refs.length === 0) return [];
    const missing = refs.filter((ref) => !resolved.has(ref));
    if (missing.length === 0) return refs.map((ref) => resolved.get(ref) ?? null);
    const session = opened;
    lookingUp ??= Promise.all(missing.map((ref) => lookUp(ref, session))).then(() => {
      if (session !== opened || !isOpen) return;
      lookingUp = null;
      render(controller.state);
    });
    return [];
  }

  /** Find `ref` through the source: the result whose `symbol` it is, null when there is none, `'failed'` when the search fails. */
  async function lookUp(ref: string, session: number): Promise<void> {
    let found: T | null | 'failed';
    try {
      const page = await options.source.search(ref, { offset: 0, limit: options.pageSize ?? 50 });
      found = (Array.isArray(page) ? page : page.items).find((item) => item.symbol === ref) ?? null;
    } catch {
      found = 'failed';
    }
    if (session === opened && isOpen) resolved.set(ref, found);
  }

  /**
   * A starred symbol the source no longer finds (or could not look up, `failed`):
   * shown greyed, not selectable, with its star to remove it.
   */
  function unavailable(ref: string, logos: boolean, failed: boolean): HTMLElement {
    const row = h('div', { class: 'pc-symbol-search-option is-unavailable', role: 'option', 'aria-disabled': 'true', 'aria-selected': 'false' });
    if (logos) row.append(h('span', { class: 'pc-symbol-search-logo' }));
    row.append(
      h('span', { class: 'pc-symbol-search-symbol' }, ref),
      h('span', { class: 'pc-symbol-search-detail' }, t(failed ? 'symbolSearchLoadFailed' : 'symbolSearchUnavailable')),
      h('span', { class: 'pc-symbol-search-type' }),
      h('span', { class: 'pc-symbol-search-exchange' }),
    );
    row.addEventListener('mousedown', (e) => e.preventDefault());
    return withStar(row, ref);
  }

  /** `row` with a star toggle for `ref` after it, when there are favourites. */
  function withStar(row: HTMLElement, ref: string, item?: T): HTMLElement {
    if (!starred) return row;
    const on = starred.has(ref);
    const star = iconButton({ icon: Star, label: t(on ? 'indicatorsFavoriteRemove' : 'indicatorsFavoriteAdd', { name: ref }), variant: 'ghost' });
    star.className += ' pc-symbol-search-star';
    star.setAttribute('aria-pressed', String(on));
    // Tab reaches the active row's star, and those of unavailable rows, which cannot be active.
    star.tabIndex = !item || item === active ? 0 : -1;
    star.addEventListener('mousedown', (e) => e.preventDefault());
    star.addEventListener('click', () => toggleStar(ref, item));
    if (item) stars.set(item, star);
    return h('div', { class: 'pc-symbol-search-row', role: 'none' }, row, star);
  }

  function toggleStar(ref: string, item?: T): void {
    if (!starred) return;
    const name = { name: ref };
    // Read before the change: the list's change listener redraws, replacing the focused star.
    const focused = document.activeElement?.classList.contains('pc-symbol-search-star');
    if (starred.has(ref)) starred.remove(ref);
    else {
      // Known before the redraw, so starring a result does not look it up again.
      const known = resolved.has(ref);
      if (item && !known) resolved.set(ref, item);
      if (!starred.add(ref)) {
        if (item && !known) resolved.delete(ref);
        status.textContent = t('favoritesFull', { ...name, limit: starred.limit });
        return;
      }
    }
    status.textContent = t(starred.has(ref) ? 'indicatorsFavoriteAdded' : 'indicatorsFavoriteRemoved', name);
    render(controller.state);
    // Redrawing replaced the star: keep focus on the active row's, or go back to the search box.
    if (focused) (stars.get(active!) ?? input).focus();
  }

  function option(item: T, index: number, query: string, logos: boolean): HTMLElement {
    const row = h('div', { class: 'pc-symbol-search-option', role: 'option', id: `${id}-option-${index}`, 'aria-selected': 'false' });
    if (logos) row.append(logo(item));
    row.append(
      h('span', { class: 'pc-symbol-search-symbol' }, ...marked(item.symbol, query)),
      h('span', { class: 'pc-symbol-search-detail' }, ...marked(symbolDetail(item), query)),
      h('span', { class: 'pc-symbol-search-type' }, item.type ?? ''),
      h('span', { class: 'pc-symbol-search-exchange' }, item.exchange ?? ''),
    );
    // Keep focus in the search box so the keyboard keeps working after a click.
    row.addEventListener('mousedown', (e) => e.preventDefault());
    onPointerMove(row, () => active !== item && setActive(item, false));
    row.addEventListener('click', () => select(item));
    optionEls.set(item, row);
    return withStar(row, item.symbol, item);
  }

  function logo(item: T): HTMLElement {
    const cell = h('span', { class: 'pc-symbol-search-logo' });
    if (item.logo) {
      const img = h('img', { src: item.logo, alt: '', loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', () => img.remove());
      cell.append(img);
    }
    return cell;
  }

  function setActive(item: T | null, scroll: boolean): void {
    if (active) optionEls.get(active)?.setAttribute('aria-selected', 'false');
    // Tab from the search box reaches the active row's star only.
    if (active) stars.get(active)?.setAttribute('tabindex', '-1');
    if (item) stars.get(item)?.setAttribute('tabindex', '0');
    active = item;
    const row = item ? optionEls.get(item) : undefined;
    if (!row) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    row.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', row.id);
    if (scroll) row.scrollIntoView({ block: 'nearest' });
  }

  function messageFor(state: SearchState<T>): (Node | string)[] {
    if (state.status === 'error') return [t('symbolSearchLoadFailed'), retryButton()];
    if (state.items.length > 0 || state.hasMore) return [];
    if (state.status === 'loading') return [t('symbolSearchSearching')];
    if (state.status !== 'ready') return [];
    const { text, exchange, type } = state.query;
    if (text) return [t('symbolSearchNoMatch', { text })];
    return [t(exchange || type ? 'symbolSearchNoFilterMatch' : 'symbolSearchPrompt')];
  }

  function footerFor(state: SearchState<T>): (Node | string)[] {
    if (state.more === 'loading') return [t('symbolSearchLoadingMore')];
    if (state.more === 'error') return [t('symbolSearchMoreFailed'), retryButton()];
    return [];
  }

  function announce(state: SearchState<T>): string {
    if (state.status === 'error') return t('symbolSearchFailed');
    return resultsText(options.chart, shown.length, state.hasMore);
  }

  const retryButton = () =>
    button({
      label: t('symbolSearchRetry'),
      variant: 'surface',
      onClick: () => {
        // The button is replaced on the next render; keep focus in the dialog.
        input.focus();
        controller.retry();
      },
    });

  const fill = (target: HTMLElement, content: (Node | string)[]) => {
    target.replaceChildren(...content);
    target.hidden = content.length === 0;
  };

  function loadIfNearEnd(): void {
    if (isOpen && nearEnd(results)) controller.loadMore();
  }

  input.addEventListener('input', () => search(false));
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const current = active ? shown.indexOf(active) : -1;
    const next = stepActive(current, shown.length, e.key, pageRows(results, list.querySelector<HTMLElement>('[role="option"]')), !controller.state.hasMore);
    if (next !== null) {
      e.preventDefault();
      setActive(shown[next] ?? null, true);
      if (next >= shown.length - 3) controller.loadMore();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active) select(active);
    }
  });
  results.addEventListener('scroll', loadIfNearEnd);

  const onTyping = (e: KeyboardEvent) => {
    // Only when the element itself has focus, not an editor or button inside it.
    if (isOpen || e.defaultPrevented || e.target !== e.currentTarget || !isSearchKey(e)) return;
    // Keep the key from also landing in the search box once it has focus.
    e.preventDefault();
    open(e.key);
  };
  typingTarget?.addEventListener('keydown', onTyping);

  function open(query = ''): void {
    if (!isOpen) {
      isOpen = true;
      relabel();
      modal.show();
    }
    modal.type(query);
    search(true);
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    opened++;
    resolved.clear();
    lookingUp = null;
    exchangeBox?.destroy();
    controller.reset();
    modal.hide();
  }

  function select(item: T): void {
    close();
    options.onSelect(item);
  }

  return {
    el,
    get isOpen() {
      return isOpen;
    },
    open,
    close,
    destroy() {
      close();
      controller.reset();
      typingTarget?.removeEventListener('keydown', onTyping);
      offStarred();
      el.remove();
    },
  };
}

/**
 * The shell's `symbolSearch` part, made by `symbolSearch(options)`. The shell
 * calls it with its chart, its element and the keys of the `symbol-search`
 * action (`/`, plus Mod+K without a command palette).
 */
export type SymbolSearchPart = (chart: Chart, host: HTMLElement, keys: readonly string[], favorites?: FavoritesList | null) => SymbolSearchDialog;

/**
 * The symbol search dialog for the shell's `symbolSearch` option, opened by
 * the `symbol-search` action and, unless `openOnTyping` says otherwise, by
 * typing in the shell. Without it the `symbolHeader()` toolbar item is disabled.
 */
export function symbolSearch<T extends SymbolSearchResult>(options: SymbolSearchOptions<T>): SymbolSearchPart {
  devCheck('symbolSearch', options, 'symbolSearch');
  return (chart, host, keys, favorites) => {
    // By default the shell hears typing (bindSymbolSearchKeys); an element or `false` replaces that.
    const dialog = createSymbolSearch(host, { chart, favorites, ...options, openOnTyping: options.openOnTyping ?? false });
    const offKeys = bindSymbolSearchKeys(chart, host, dialog, options.shortcutScope, keys, options.openOnTyping === undefined);
    const destroy = dialog.destroy;
    dialog.destroy = () => {
      offKeys();
      destroy();
    };
    return dialog;
  };
}
