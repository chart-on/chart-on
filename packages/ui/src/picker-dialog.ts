import { englishLocalizer, pluralText, type Localizer } from '@chart-on/core';
import { Check, Search } from 'lucide';
import { button, iconButton } from './controls';
import { dialogButton, focusableIn, nextDialogId, openDialogFrame } from './dialog';
import { stepTab } from './indicator-picker-model';
import { buttonsIn, h, icon, inlineKey, type IconSource } from './dom';
import { createListbox } from './listbox';
import {
  createPickerController,
  type PickerCategory,
  type PickerItem,
  type PickerSource,
  type PickerState,
} from './picker-model';
import { resultsText, shellText } from './messages';
import { marked, nearEnd, onPointerMove, pageRows } from './search-modal';
import { stepActive } from './symbol-search-model';

/** A button at the end of each row, e.g. a star or a settings button. */
export interface PickerRowAction<T extends PickerItem> {
  id: string;
  /** Accessible name and tooltip. */
  label: string;
  icon: IconSource;
  /** For toggles: whether it is on for `item` (sets `aria-pressed`). */
  pressed?(item: T): boolean;
  /** Rows to show the button on; all of them when omitted. */
  appliesTo?(item: T): boolean;
}

/** What a picker dialog lists and how: its title, item source, categories, single or multiple selection, row actions, paging and search settings. */
export interface PickerSchema<T extends PickerItem> {
  title: string;
  source: PickerSource<T>;
  /** Shown as a list beside the results (a select in compact mode), or as chips under the search box with `layout: 'palette'`. */
  categories?: PickerCategory[];
  /** Label of the first category, which lists everything; `false` for none. Default `paletteAll` ("All"). */
  allLabel?: string | false;
  /** Pick several items, confirmed with Done. Default single. */
  multiple?: boolean;
  /** Ids picked when the dialog opens (`multiple`). With a `fetch` source, Done reports only those that were listed. */
  selected?: readonly string[];
  /** Single select: close after a pick. Default `true`; `false` keeps it open to add several in a row. */
  closeOnSelect?: boolean;
  rowActions?: PickerRowAction<T>[];
  /** Items per page. Default 50. */
  pageSize?: number;
  /** Wait this long after the last keystroke before searching, in ms. Default 0 for `items`, 200 for `fetch`. */
  debounce?: number;
  placeholder?: string;
  /** Accessible name of the search box. Default `dialogSearch` ("Search"). */
  searchLabel?: string;
  /** Message when there is nothing to list and no query. */
  emptyText?: string;
  /**
   * List nothing until a query is typed or a category picked: until then the
   * dialog shows its search box with the categories as a row of chips under
   * it. Default false.
   */
  listOnQuery?: boolean;
  /** Below this width of the host in px, the category list becomes a select. Default 600. */
  compactWidth?: number;
  /** Extra classes on the dialog panel. */
  className?: string;
  /**
   * `'palette'`: the search box first, with no title bar or close button
   * (Escape or a press outside closes it), and the categories as a row of
   * chips under it. Default `'dialog'`.
   */
  layout?: 'dialog' | 'palette';
  /** Accessible name of the close button. Default `dialogClose` ("Close"). */
  closeLabel?: string;
  /** Extra content at the end of an item's row, inside the option, e.g. a shortcut. */
  rowEnd?(item: T): Node | null;
}

/** Options of `createPickerDialog`. */
export interface PickerDialogOptions {
  /**
   * The language of the dialog's own text (the schema's defaults, Done,
   * Cancel, messages and counts), usually `chart.localization`. Default English.
   */
  localization?: Localizer;
}

/** Callbacks of a picker dialog: an item was picked, a row action was used, or the dialog closed. */
export interface PickerHandlers<T extends PickerItem> {
  /** The picked item (single), or every picked item when Done is pressed (`multiple`). */
  onSelect(items: T[]): void;
  /** A row action was used. Call `dialog.refresh()` after changing what `pressed` reads. */
  onAction?(actionId: string, item: T, dialog: PickerDialog): void;
  /** The dialog closed, for any reason. */
  onClose?(): void;
}

/** An open picker dialog made by `createPickerDialog`: its picked items, plus `search`, `refresh` and `close`. */
export interface PickerDialog {
  /** Backdrop that holds the dialog. */
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  /** Ids of the picked items (`multiple`). */
  readonly selected: string[];
  /** Put `query` in the search box and search now. */
  search(query: string): void;
  /** Redraw the rows, e.g. after a row action changed what `pressed` reads. */
  refresh(): void;
  close(): void;
}

/** Internal: a row of a `pickerList`, built by its owner. */
export interface ListRow {
  /** The same across redraws, so the active row and a focused row button survive them. */
  key: string;
  /** The presentational row: the option and the row's buttons. */
  el: HTMLElement;
  /** The text-only option in `el`. */
  option: HTMLElement;
  /** The item shown, when it can show in several rows (a favourite): a row of the same item takes over when this row's key is gone. Default `key`. */
  item?: string;
}

/** Internal: what `pickerList` wires up: the elements, whether the active row is the selected one, and what choosing does. */
export interface PickerListOptions {
  /** Prefix of the option ids. */
  id: string;
  input: HTMLInputElement;
  list: HTMLElement;
  /** The scrolling element around `list`. */
  results: HTMLElement;
  /** The active option is the selected one (`aria-selected`); false when the owner marks picks. */
  selectActive: boolean;
  /** The arrows wrap around the ends. */
  wrap(): boolean;
  /** A click on row `index`, or Enter in the search box on the active row (-1 for none). */
  choose(index: number): void;
  /** The keyboard made row `index` active. */
  moved?(index: number): void;
}

/** Internal: a picker's list, made by `pickerList`. */
export interface PickerList {
  readonly rows: readonly ListRow[];
  /** Index of the active row, -1 for none. */
  readonly active: number;
  /**
   * Show `nodes`, which hold `rows`. The active row keeps its key unless
   * `fresh`, else row `first` becomes active; a focused row button keeps focus.
   */
  show(rows: ListRow[], nodes: Node[], fresh: boolean, first?: number): void;
  setActive(index: number, scroll: boolean): void;
}

/** The event comes from a button in `row`. */
function fromButton(e: Event, row: HTMLElement): boolean {
  for (let el = e.target as HTMLElement | null; el && el !== row; el = el.parentElement) if (el.tagName.toLowerCase() === 'button') return true;
  return false;
}

/**
 * Internal: the list of a picker, shared by `createPickerDialog` and the
 * indicator picker. The search box keeps focus and points at the active row;
 * the arrows, Page Up/Down, Home and End move it, Enter and a click choose,
 * the pointer makes a row active, and Tab reaches only the active row's
 * buttons. Arrows on a row button go back to the list.
 */
export function pickerList(options: PickerListOptions): PickerList {
  const { input, list } = options;
  let rows: ListRow[] = [];
  let active = -1;

  function setActive(index: number, scroll: boolean): void {
    active = index;
    rows.forEach((row, i) => {
      const on = i === index;
      row.el.setAttribute('data-active', String(on));
      if (options.selectActive) row.option.setAttribute('aria-selected', String(on));
      for (const b of buttonsIn(row.el)) b.tabIndex = on ? 0 : -1;
    });
    const row = rows[index];
    if (!row) return input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-activedescendant', row.option.getAttribute('id')!);
    if (scroll) row.el.scrollIntoView?.({ block: 'nearest' });
  }

  function move(key: string): boolean {
    const next = stepActive(active, rows.length, key, pageRows(options.results, rows[0]?.el), options.wrap());
    if (next === null) return false;
    setActive(next, true);
    options.moved?.(next);
    return true;
  }

  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.defaultPrevented) return;
    if (move(e.key)) e.preventDefault();
    else if (e.key === 'Enter') {
      e.preventDefault();
      options.choose(active);
    }
  });
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    input.focus({ preventScroll: true });
    move(e.key);
  });

  return {
    get rows() {
      return rows;
    },
    get active() {
      return active;
    },
    show(next, nodes, fresh, first = 0) {
      // Redrawing drops focus from a row button: put it back on the same button
      // of the same row (e.g. after starring with the keyboard), or of another row
      // of the same item (unstarring removes its Favorites row), else in the search box.
      const focused = document.activeElement as HTMLElement | null;
      const from = rows.find((row) => row.el.contains(focused));
      const button = from ? buttonsIn(from.el).indexOf(focused!) : -1;
      const itemOf = (row: ListRow) => row.item ?? row.key;
      const key = fresh ? undefined : rows[active]?.key;
      rows = next;
      list.replaceChildren(...nodes);
      next.forEach((row, i) => {
        row.option.setAttribute('role', 'option');
        row.option.setAttribute('id', `${options.id}-option-${i}`);
        // Keep focus in the search box so the keyboard keeps working after a click.
        row.el.addEventListener('mousedown', (e) => fromButton(e, row.el) || e.preventDefault());
        onPointerMove(row.el, () => active !== i && setActive(i, false));
        row.el.addEventListener('click', (e) => fromButton(e, row.el) || options.choose(i));
      });
      if (from) input.focus({ preventScroll: true });
      let kept = next.findIndex((row) => row.key === key);
      let target = -1;
      if (button >= 0 && from!.key === key) {
        target = kept >= 0 ? kept : next.findIndex((row) => itemOf(row) === itemOf(from!));
        if (target >= 0) kept = target;
      }
      setActive(kept >= 0 ? kept : first, target >= 0);
      if (target >= 0) buttonsIn(rows[target]!.el)[button]?.focus({ preventScroll: true });
      if (fresh) options.results.scrollTop = 0;
    },
    setActive,
  };
}

/** Internal: a tab of a `tabList`, with optional content after its label (a count). */
export interface ListTab {
  id?: string;
  label: string;
  end?: Node | null;
}

/**
 * Internal: a vertical tab list whose tabs are rebuilt by `set`. A click, the
 * arrows, Home and End call `pick` with a tab's index; focus follows a tab
 * picked with the keyboard, and stays on the selected tab across rebuilds.
 */
export function tabList(className: string, tabClass: string, controls: string, pick: (index: number) => void) {
  const el = h('div', { class: className, role: 'tablist', 'aria-orientation': 'vertical' });
  let count = 0;
  let selected = 0;
  const focusSelected = () => (el.children[selected] as HTMLElement | undefined)?.focus({ preventScroll: true });
  return {
    el,
    set(tabs: readonly ListTab[], index: number): void {
      const focused = el.contains(document.activeElement);
      count = tabs.length;
      selected = index;
      el.replaceChildren(
        ...tabs.map((tab, i) => {
          const b = h(
            'button',
            { class: tabClass, role: 'tab', 'aria-selected': String(i === index), 'aria-controls': controls, 'data-tab': tab.id ?? '' },
            tab.label,
          );
          if (tab.end) b.append(tab.end);
          b.tabIndex = i === index ? 0 : -1;
          // A click or key rebuilds the tabs: focus moves to the new selected one, not to the page.
          b.addEventListener('click', () => {
            pick(i);
            focusSelected();
          });
          b.addEventListener('keydown', (e) => {
            const next = stepTab(i, count, inlineKey(e));
            if (next === null) return;
            e.preventDefault();
            pick(next);
            focusSelected();
          });
          return b;
        }),
      );
      if (focused) focusSelected();
    },
  };
}


/**
 * A modal list with search, categories, single or multiple selection, paging
 * and row actions. It opens at once in `host` (the shell element) and is
 * removed when closed.
 */
export function createPickerDialog<T extends PickerItem>(
  host: HTMLElement,
  schema: PickerSchema<T>,
  handlers: PickerHandlers<T>,
  options: PickerDialogOptions = {},
): PickerDialog {
  const id = nextDialogId('pc-picker');
  const multiple = schema.multiple === true;
  const t = (key: Parameters<typeof shellText>[1], params?: Record<string, string>) => shellText(options, key, params);
  const allLabel = schema.allLabel === undefined ? t('paletteAll') : schema.allLabel;
  const tabs: { id: string | undefined; label: string }[] = [
    ...(allLabel === false ? [] : [{ id: undefined, label: allLabel }]),
    ...(schema.categories ?? []),
  ];
  let category = tabs[0]?.id;
  const palette = schema.layout === 'palette';
  let isOpen = true;
  let shown: readonly T[] = [];
  let lastKey = '';
  /** Picked items by id, kept across searches (`multiple`); null until a pick from `selected` is listed. */
  const known = 'items' in schema.source ? schema.source.items : [];
  const picked = new Map<string, T | null>((schema.selected ?? []).map((s) => [s, known.find((item) => item.id === s) ?? null]));

  const frame = openDialogFrame(host, {
    title: schema.title,
    className: `pc-picker${palette ? ' pc-picker--palette' : ''} ${schema.className ?? ''}`.trim(),
    header: !palette,
    onDismiss: close,
    onOutside: close,
    compactWidth: schema.compactWidth,
    onCompactChange: renderNav,
    closeLabel: schema.closeLabel ?? t('dialogClose'),
  });
  const { panel } = frame;

  const input = h('input', {
    type: 'text',
    class: 'pc-picker-input',
    role: 'combobox',
    'aria-label': schema.searchLabel ?? t('dialogSearch'),
    'aria-expanded': 'true',
    'aria-controls': `${id}-list`,
    'aria-autocomplete': 'list',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: schema.placeholder ?? t('dialogSearch'),
  });
  const list = h('div', {
    class: 'pc-picker-list',
    role: 'listbox',
    id: `${id}-list`,
    'aria-label': schema.title,
  });
  if (multiple) list.setAttribute('aria-multiselectable', 'true');
  const message = h('div', { class: 'pc-picker-message' });
  const more = h('div', { class: 'pc-picker-message pc-picker-more' });
  const results = h('div', { class: 'pc-picker-results' }, list, message, more);
  const nav = h('div', { class: 'pc-picker-nav' });
  const status = h('div', { class: 'pc-sr-only', role: 'status' });
  const tablist = tabList('pc-picker-tabs', 'pc-picker-tab', `${id}-list`, pickCategory);
  tablist.el.setAttribute('aria-label', t('dialogCategories'));
  // Before the list's own keys: Ctrl+Enter confirms the picks.
  input.addEventListener('keydown', (e) => {
    if (multiple && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      confirm();
    }
  });
  const rows = pickerList({
    id,
    input,
    list,
    results,
    selectActive: !multiple,
    wrap: () => !controller.state.hasMore,
    choose,
    moved: (index) => index >= shown.length - 3 && controller.loadMore(),
  });
  panel.append(
    h('div', { class: 'pc-picker-field' }, icon(Search, 16), input),
    ...(palette ? [nav, h('div', { class: 'pc-picker-main' }, results)] : [h('div', { class: 'pc-picker-main' }, nav, results)]),
  );
  const count = h('span', { class: 'pc-picker-count' });
  if (multiple) {
    const done = dialogButton(t('dialogDone'), true, () => confirm(), 'done');
    const cancel = dialogButton(t('dialogCancel'), false, close);
    panel.append(h('div', { class: 'pc-dialog-footer' }, count, h('div', { class: 'pc-dialog-actions' }, cancel, done)));
  }
  panel.append(status);

  const controller = createPickerController<T>({
    source: schema.source,
    pageSize: schema.pageSize ?? 50,
    delay: schema.debounce ?? ('fetch' in schema.source ? 200 : 0),
    onChange: render,
  });

  const handle: PickerDialog = {
    get el() {
      return frame.backdrop;
    },
    get isOpen() {
      return isOpen;
    },
    get selected() {
      return [...picked.keys()];
    },
    search(query) {
      input.value = query;
      controller.search(query, category, true);
    },
    refresh: () => render(controller.state),
    close,
  };

  function renderNav(): void {
    nav.hidden = tabs.length <= 1;
    if (nav.hidden) return;
    if (frame.compact && !palette) {
      const select = createListbox({
        options: tabs.map((tab, i) => ({ value: i, label: tab.label })),
        value: tabs.findIndex((tab) => tab.id === category),
        label: t('dialogCategory'),
        className: 'pc-picker-nav-select',
        localization: options.localization,
        set: (value) => {
          pickCategory(value as number);
          // The nav was rebuilt: keep focus on the new select.
          focusableIn(nav)[0]?.focus();
        },
      });
      nav.replaceChildren(select.el);
      return;
    }
    tablist.set(tabs, tabs.findIndex((tab) => tab.id === category));
    nav.replaceChildren(tablist.el);
  }

  function pickCategory(index: number): void {
    const tab = tabs[index];
    if (!tab || tab.id === category) return;
    category = tab.id;
    renderNav();
    controller.search(input.value.trim(), category, true);
  }

  function render(state: PickerState<T>): void {
    // A new search starts at its first row; appended pages and redraws keep the active one.
    const key = `${state.query}\n${state.category ?? ''}\n${state.status}`;
    const fresh = key !== lastKey;
    lastKey = key;
    // With `listOnQuery` an empty box on the first category hides the list, so nothing can be picked from it either.
    const idle = schema.listOnQuery === true && !state.query && state.category === tabs[0]?.id;
    if (idle) panel.setAttribute('data-idle', '');
    else panel.removeAttribute('data-idle');
    if (state.category === undefined) panel.setAttribute('data-all', '');
    else panel.removeAttribute('data-all');
    input.setAttribute('aria-expanded', String(!idle));
    tablist.el.setAttribute('aria-orientation', idle || palette ? 'horizontal' : 'vertical');
    shown = idle ? [] : state.items;
    for (const item of shown) if (picked.has(item.id)) picked.set(item.id, item);
    const built = shown.map((item) => row(item, state.query));
    rows.show(
      built,
      built.map((r) => r.el),
      fresh,
      shown.findIndex((item) => !item.disabled),
    );
    list.setAttribute('aria-busy', String(state.status === 'loading'));
    fill(message, messageFor(state));
    fill(more, moreFor(state));
    if (state.status !== 'loading') status.textContent = idle ? '' : announce(state);
    if (state.hasMore) queueMicrotask(loadIfNearEnd);
  }

  function row(item: T, query: string): ListRow {
    const on = multiple && picked.has(item.id);
    const option = h('div', {
      class: 'pc-picker-option',
      'aria-selected': String(on),
      'data-id': item.id,
    });
    if (item.disabled) option.setAttribute('aria-disabled', 'true');
    if (multiple) {
      const box = h('span', {
        class: 'pc-picker-check',
        'aria-hidden': 'true',
      });
      if (on) box.append(icon(Check, 13));
      option.append(box);
    }
    const text = h('span', { class: 'pc-picker-text' }, h('span', { class: 'pc-picker-label' }, ...marked(item.label, query)));
    if (item.description) text.append(h('span', { class: 'pc-picker-description' }, item.description));
    option.append(text);
    const end = schema.rowEnd?.(item);
    if (end) option.append(end);
    const el = h('div', { class: 'pc-picker-row', role: 'none' }, option);
    if (schema.rowActions?.length) {
      const actions = h('div', { class: 'pc-picker-actions' });
      for (const action of schema.rowActions) {
        if (action.appliesTo?.(item) === false) continue;
        const b = iconButton({
          icon: action.icon,
          label: action.label,
          variant: 'ghost',
          onClick: () => handlers.onAction?.(action.id, item, handle),
        });
        b.setAttribute('data-action', action.id);
        if (action.pressed) b.setAttribute('aria-pressed', String(action.pressed(item)));
        actions.append(b);
      }
      el.append(actions);
    }
    return { key: item.id, el, option };
  }

  function choose(index: number): void {
    const item = shown[index];
    if (!item || item.disabled) return;
    if (multiple) {
      if (picked.has(item.id)) picked.delete(item.id);
      else picked.set(item.id, item);
      updateCount();
      status.textContent = `${item.label} ${picked.has(item.id) ? 'selected' : 'deselected'}`;
      render(controller.state);
      return;
    }
    if (schema.closeOnSelect === false) {
      status.textContent = `${item.label} picked`;
      handlers.onSelect([item]);
      return;
    }
    close();
    handlers.onSelect([item]);
  }

  function updateCount(): void {
    const n = picked.size;
    count.textContent = pluralText(options.localization ?? englishLocalizer, 'pickerSelected', n, { count: n }, t('pickerSelected', { count: String(n) }));
  }

  function confirm(): void {
    // A `fetch` source's picks from `selected` that were never listed have no item to report; `dialog.selected` has their ids.
    const items = [...picked.values()].filter((item): item is T => item !== null);
    close();
    handlers.onSelect(items);
  }

  function messageFor(state: PickerState<T>): (Node | string)[] {
    if (state.status === 'error') return [t('pickerLoadFailed'), retryButton()];
    if (state.items.length > 0) return [];
    if (state.status === 'loading') return [t('pickerLoading')];
    if (state.query) return [t('pickerNoMatch', { text: state.query })];
    return [schema.emptyText ?? t('pickerEmpty')];
  }

  function moreFor(state: PickerState<T>): (Node | string)[] {
    if (state.more === 'loading') return [t('symbolSearchLoadingMore')];
    if (state.more === 'error') return [t('pickerMoreFailed'), retryButton()];
    return [];
  }

  function announce(state: PickerState<T>): string {
    return state.status === 'error' ? t('pickerFailed') : resultsText(options, state.items.length, state.hasMore);
  }

  const retryButton = () =>
    button({
      label: t('symbolSearchRetry'),
      variant: 'surface',
      onClick: () => {
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


  input.addEventListener('input', () => controller.search(input.value.trim(), category));
  results.addEventListener('scroll', loadIfNearEnd);

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    controller.dispose();
    frame.close();
    handlers.onClose?.();
  }

  renderNav();
  updateCount();
  input.value = '';
  input.focus({ preventScroll: true });
  controller.search('', category, true);
  return handle;
}
