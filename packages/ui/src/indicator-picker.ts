import type { Chart, Indicator, IndicatorAddOptions, IndicatorDef, IndicatorState, SettingsAdapter } from '@charton/core';
import { Activity, ChartCandlestick, PanelBottom, Plus, Settings, Star, Trash2 } from 'lucide';
import type { CommandSource } from './command-palette-model';
import type { FavoritesList } from './favorites';
import { segmentedTabs } from './controls';
import { builtinText, keyOf, labelOf, resultsText, shellText, type ShellMessageKey } from './messages';
import { h, icon, type IconSource } from './dom';
import {
  categoryLabel,
  categoryOf,
  countByType,
  filterInstances,
  inGroup,
  inputSummary,
  listedDefinitions,
  localIndicatorPickerStorage,
  pickerSections,
  pickerTabs,
  placementChoices,
  placementFor,
  pushRecent,
  sanitizeMemory,
  searchIndicators,
  toggleFavorite,
  type IndicatorPickerGroup,
  type IndicatorPickerMemory,
  type IndicatorPickerStorage,
  type IndicatorPlacement,
  type PickerTab,
} from './indicator-picker-model';
import { printable } from './listbox';
import { pickerList, tabList as createTabList, type ListRow } from './picker-dialog';
import { marked as markedParts, searchModal } from './search-modal';
import type { ToolbarItem } from './toolbar';
import { retainTips } from './tooltip';

/** A host button shown on every definition row it applies to. */
export interface IndicatorPickerAction {
  id: string;
  /** Accessible name and tooltip. */
  label: string;
  icon: IconSource;
  onClick(def: IndicatorDef, chart: Chart): void;
  /** Rows to show the button on; all of them when omitted. */
  appliesTo?(def: IndicatorDef): boolean;
}

/** The inputs and plot styles an indicator added from the picker starts with (see `IndicatorPickerOptions.initialState`). */
export type IndicatorInitialState = Partial<Pick<IndicatorState, 'inputs' | 'plotStyles'>>;

/** Options of `createIndicatorPicker`, and of the shell's `indicatorPicker` option. */
export interface IndicatorPickerOptions {
  /** Element the dialog covers while open. Default the shell around the chart, else the chart's root. */
  container?: HTMLElement;
  /** Return false to hide a registered definition from the picker. */
  filter?(def: IndicatorDef): boolean;
  /** Called after the picker added an indicator. */
  onAdd?(indicator: Indicator): void;
  /**
   * Open the settings of an indicator on the chart. When set, rows of
   * indicators on the chart get a settings button.
   */
  onSettings?(indicator: Indicator): void;
  /** Extra buttons on definition rows. */
  actions?: IndicatorPickerAction[];
  /** Host sections listed as tabs after the categories, e.g. "My indicators". */
  groups?: IndicatorPickerGroup[];
  /**
   * Show a Built-in / Custom switch above the categories: Built-in lists the
   * definitions in none of the `groups`, Custom those in one, with the group
   * tabs. The picker opens on Built-in. Default `false`: every definition in All.
   */
  sourceSwitch?: boolean;
  /** Placement of `placement: 'either'` definitions until the user switches a row. Default `'overlay'`. */
  placement?: IndicatorPlacement;
  /** Where recents and favourites are kept; `null` keeps them for this visit only. Default `settings`, else `localStorage`. */
  storage?: IndicatorPickerStorage | null;
  /**
   * Preference store for recents and favourites, under key `indicator-picker`,
   * e.g. the `settings` of `createLocalStorageAdapter` or an app's own store.
   * Used when `storage` is not given.
   */
  settings?: SettingsAdapter;
  /**
   * Keep the favourites in this list instead of `storage`, e.g. the shell's
   * `favorites.of('indicator')`, which the shell passes when it has the
   * `favorites` part. Favourites `storage` held are moved into it once, while
   * it is empty. Recents stay in `storage`.
   */
  favorites?: FavoritesList | null;
  /**
   * `localStorage` key of the default storage. Default `'charton:indicator-picker'`.
   * Charts sharing a key share their recents and favourites.
   */
  storageKey?: string;
  /** Options for every indicator the picker adds, e.g. `{ renderer: 'canvas' }`; the row decides `placement`. */
  addOptions?: Omit<IndicatorAddOptions, 'placement'>;
  /**
   * The inputs and plot styles an indicator added from the picker starts
   * with, or null for its definition's defaults, e.g. a saved default from
   * `indicatorDefaults()` of `@charton/ui/templates`. The picker waits for a
   * promise, and a rejected one adds with the definition's defaults. Inputs
   * go to `add`, which refuses invalid ones like any add. Plot styles apply
   * right after it, as their own undo step; ones the indicator refuses are
   * skipped. Indicators added from code are not affected.
   */
  initialState?(def: IndicatorDef): IndicatorInitialState | null | Promise<IndicatorInitialState | null>;
  /** Wait this long after the last keystroke before filtering, in ms. Default 80. */
  debounce?: number;
  /**
   * Typing `/` while this element has focus opens the picker. Default the
   * chart's root; `false` turns it off. The shortcut is the
   * `'indicator-picker'` action on `chart.actions`, so it can be rebound.
   */
  openOnSlash?: HTMLElement | false;
  /** Called when the dialog opens or closes, e.g. to refresh a toolbar button's pressed state. */
  onOpenChange?(open: boolean): void;
  /**
   * Hand the query to a wider search, e.g. `(query) => palette.open(query)`.
   * When set, a footer button under the results offers it while the search box
   * has text; the picker closes first. The shell sets it to its command palette.
   */
  onSearchAll?(query: string): void;
}

/** The indicator picker dialog: open and close it, read and change the recents and favourites. */
export interface IndicatorPickerHandle {
  /** Backdrop that holds the dialog; hidden while closed. */
  el: HTMLElement;
  readonly isOpen: boolean;
  /** Open on the All tab with `query` in the search box (empty by default). */
  open(query?: string): void;
  /** Close and return focus to where it was before opening. */
  close(): void;
  toggle(): void;
  /** Definition ids, most recently added first. */
  readonly recents: readonly string[];
  /** Starred definition ids. */
  readonly favorites: readonly string[];
  /** Star or unstar a definition. */
  toggleFavorite(id: string): void;
  /**
   * Command palette source (id `indicators`) listing the picker's catalogue;
   * running an entry adds the indicator as a picker row does.
   * The shell adds it to its palette: `palette.addSource(picker.commandSource)`.
   */
  readonly commandSource: CommandSource;
  destroy(): void;
}

/**
 * One selectable row: a definition to add, or an indicator on the chart.
 * `el` is the presentational row; `option` the text-only option inside it,
 * with the row's buttons beside it (options cannot hold controls).
 */
type Row = ListRow & ({ def: IndicatorDef; indicator?: undefined } | { def?: undefined; indicator: Indicator });

const handles = new WeakMap<Chart, IndicatorPickerHandle>();

/** The action id of the indicator picker shortcut (`/`). */
const INDICATOR_PICKER ='indicator-picker';

/** The indicator picker created for `chart`, if any. */
export function indicatorPickerOf(chart: Chart): IndicatorPickerHandle | undefined {
  return handles.get(chart);
}

/**
 * Toolbar button that opens the indicator picker of the chart it acts on.
 * Spread it to adjust, e.g. `{ ...indicatorPickerToolbarItem(), text: 'Indicators' }`.
 */
export function indicatorPickerToolbarItem(): Extract<ToolbarItem, { type: 'button' }> {
  return {
    type: 'button',
    id: 'indicators',
    group: 'analysis',
    ...labelOf('actionIndicatorPicker'),
    icon: Activity,
    onClick: (chart) => indicatorPickerOf(chart)?.toggle(),
    isActive: (chart) => indicatorPickerOf(chart)?.isOpen ?? false,
  };
}

let uid = 0;

/**
 * Modal indicator catalogue: search, category tabs, favourites and recents.
 * Picking a row adds the indicator and leaves the dialog open, so several can
 * be added in a row. Built on the public `chart.indicators` API.
 */
export function createIndicatorPicker(chart: Chart, options: IndicatorPickerOptions = {}): IndicatorPickerHandle {
  const id = `pc-indicator-picker-${++uid}`;
  const container = options.container ?? chart.root.closest<HTMLElement>('.pc-shell') ?? chart.root;
  const settings = options.settings;
  const storage =
    options.storage !== undefined
      ? options.storage
      : settings
        ? { load: () => JSON.parse(settings.get(INDICATOR_PICKER) ?? 'null'), save: (m: IndicatorPickerMemory) => settings.set(INDICATOR_PICKER, JSON.stringify(m)) }
        : localIndicatorPickerStorage(options.storageKey);
  const groups = options.groups ?? [];
  const slashTarget = options.openOnSlash === undefined ? chart.root : options.openOnSlash || null;
  const shared = options.favorites ?? null;
  let memory: IndicatorPickerMemory = sanitizeMemory(load());
  // The picker's own saved favourites move to an empty shared list once; ones past its limit stay saved here.
  if (shared && shared.get().length === 0 && memory.favorites.length > 0) {
    memory = { ...memory, favorites: memory.favorites.filter((defId) => !shared.add(defId)) };
    save();
  }
  const offShared = shared?.on('change', () => render()) ?? (() => {});
  /** Starred definition ids, from the shared list when there is one. */
  const favoriteIds = (): string[] => (shared ? shared.get() : memory.favorites);
  /** Placement picked per definition id for `either` definitions, for this visit. */
  const chosen = new Map<string, IndicatorPlacement>();
  let isOpen = false;
  let tab = 'all';
  /** Side of the source switch: definitions in no host group, or those in one. */
  let source: 'built-in' | 'host' = 'built-in';
  let query = '';
  let tabs: PickerTab[] = [];
  let rows: Row[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe: (() => void)[] = [];
  /** Undoes `inert` on the dialog's siblings while it is open. */
  let restoreSiblings: (() => void) | null = null;

  const t = (key: ShellMessageKey, params?: Record<string, string | number>) => shellText(chart, key, params);
  /** A category's name in the chart's language: message `category.<id>`. */
  const categoryText = (category: string) => chart.localization.text(`category.${category}`, undefined, categoryLabel(category));
  const modal = searchModal(container, id, 'pc-indicator-picker', close);
  const { el, panel, input } = modal;
  const tabList = createTabList('pc-indicator-picker-tabs', 'pc-indicator-picker-tab', `${id}-panel`, (i) => selectTab(tabs[i]!.id));
  const sourceOptions = () => [
    { value: 'built-in', label: t('indicatorsBuiltIn') },
    { value: 'host', label: t('indicatorsCustom') },
  ];
  const sources = segmentedTabs(sourceOptions(), source, (value) => {
    source = value as typeof source;
    selectTab('all');
  });
  const sourceBar = h('div', { class: 'pc-indicator-picker-sources' }, sources.el);
  const list = h('div', { class: 'pc-indicator-picker-list', role: 'listbox', id: `${id}-list` });
  const message = h('div', { class: 'pc-symbol-search-message' });
  const searchAll = h('button', { class: 'pc-btn pc-btn--ghost' });
  const footer = h('div', { class: 'pc-symbol-search-footer' }, searchAll);
  message.hidden = footer.hidden = true;
  searchAll.addEventListener('click', () => {
    const text = query;
    close();
    options.onSearchAll?.(text);
  });
  const results = h('div', { class: 'pc-indicator-picker-results', role: 'tabpanel', id: `${id}-panel` }, list, message, footer);
  const status = h('div', { class: 'pc-sr-only', role: 'status' });
  panel.append(modal.field, sourceBar, h('div', { class: 'pc-indicator-picker-body' }, tabList.el, results), status);
  const listing = pickerList({ id, input, list, results, selectActive: true, wrap: () => true, choose: activate });

  /** A definition's name and description in the chart's language (`indicator.<id>`, `indicator.<id>.description`). */
  const nameOf = (def: IndicatorDef) => builtinText(chart, `indicator.${def.id}`, def.name);
  const describe = (def: IndicatorDef, text: string) => builtinText(chart, `indicator.${def.id}.description`, text);

  /** Definitions the picker lists: see `listedDefinitions`. */
  const definitions = () =>
    listedDefinitions(chart.indicators.getDefinitions(), {
      isAllowed: (type) => chart.indicators.isAllowed(type),
      showBlocked: chart.options.access.refused === 'disable',
      filter: options.filter,
    });

  // A host store may throw: the lists then still apply for this visit.
  function load(): unknown {
    try {
      return storage?.load() ?? null;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  function save(): void {
    try {
      storage?.save({ recents: [...memory.recents], favorites: [...memory.favorites] });
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Pick up what other pickers on the same storage saved since, so a change
   * made here is applied to (and saved over) the latest lists, not a stale copy.
   */
  function reload(): void {
    const stored = load();
    if (stored) memory = sanitizeMemory(stored);
  }

  /** Apply `change` to the latest stored lists and save the result. */
  function update(change: (memory: IndicatorPickerMemory) => IndicatorPickerMemory): void {
    reload();
    memory = change(memory);
    save();
  }

  // ------------------------------------------------------------- render

  /** Rebuild tabs and rows; `fresh` moves the active row back to the first one. */
  function render(fresh = false): void {
    if (!isOpen) return;
    const all = definitions();
    // The source switch (opt-in) shows only when both sides have definitions; group tabs belong to the host side.
    const split = options.sourceSwitch === true && all.some((def) => inGroup(def, groups)) && all.some((def) => !inGroup(def, groups));
    sourceBar.hidden = !split;
    const defs = split ? all.filter((def) => inGroup(def, groups) === (source === 'host')) : all;
    const tabGroups = split && source === 'built-in' ? [] : groups;
    renderTabs(defs, tabGroups);
    rows = [];
    const content = tab === 'on-chart' ? instanceRows() : definitionRows(defs, tabGroups);
    list.setAttribute('aria-label', tabs.find((t) => t.id === tab)?.label ?? t('actionIndicatorPicker'));
    listing.show(rows, content, fresh);
    fill(messageFor(all.length));
    footer.hidden = !options.onSearchAll || !query;
    searchAll.textContent = t('indicatorsSearchAll', { text: query });
  }

  function renderTabs(defs: IndicatorDef[], tabGroups: IndicatorPickerGroup[]): void {
    tabs = pickerTabs(defs, tabGroups).map((entry) => ({
      id: entry.id,
      label:
        entry.id === 'all'
          ? t('paletteAll')
          : entry.id === 'on-chart'
            ? t('indicatorsOnChart')
            : entry.id.startsWith('category:')
              ? categoryText(entry.id.slice(9))
              : entry.label,
    }));
    if (!tabs.some((t) => t.id === tab)) tab = 'all';
    const count = chart.indicators.getAll().length;
    const limit = chart.indicators.limit;
    // With a limit, how many of the allowed indicators are in use, e.g. "2/3".
    const badge =
      count > 0 || limit !== null
        ? h(
            'span',
            { class: 'pc-indicator-picker-count', title: limit === null ? t('indicatorsCount', { count }) : t('indicatorsCountOf', { count, limit }) },
            limit === null ? String(count) : `${count}/${limit}`,
          )
        : null;
    tabList.set(
      tabs.map((entry) => ({ ...entry, end: entry.id === 'on-chart' ? badge : null })),
      tabs.findIndex((entry) => entry.id === tab),
    );
  }

  function definitionRows(defs: IndicatorDef[], tabGroups: IndicatorPickerGroup[]): HTMLElement[] {
    const counts = countByType(chart.indicators.getAll());
    const sections = pickerSections({ defs, query, tab, favorites: favoriteIds(), recents: memory.recents, counts, groups: tabGroups, nameOf });
    // Category labels help only where several categories mix.
    const showCategory = tab === 'all' || tab.startsWith('group:');
    return sections.map((section, s) => {
      // A category or group tab has one section, named like the tab.
      const name = tab === 'all' || section.id !== 'all' ? t(keyOf('indicators', section.id)) : tabs.find((entry) => entry.id === tab)?.label;
      const label = h('div', { class: 'pc-symbol-search-group-label', id: `${id}-section-${s}`, 'aria-hidden': 'true' }, name ?? section.label);
      const items = section.rows.map((row) => {
        const built = definitionRow(row.def, row.count, row.favorite, showCategory);
        rows.push({ key: `${section.id}:${row.def.id}`, item: row.def.id, def: row.def, ...built });
        return built.el;
      });
      return h('div', { class: 'pc-indicator-picker-section', role: 'group', 'aria-labelledby': label.id }, label, ...items);
    });
  }

  function definitionRow(
    def: IndicatorDef,
    count: number,
    favorite: boolean,
    showCategory: boolean,
  ): { el: HTMLElement; option: HTMLElement } {
    const { row, item } = option();
    const star = rowButton(Star, t(favorite ? 'indicatorsFavoriteRemove' : 'indicatorsFavoriteAdd', { name: nameOf(def) }), () =>
      setFavorite(def.id),
    );
    star.classList.add('pc-indicator-picker-star');
    star.setAttribute('aria-pressed', String(favorite));
    const name = h('span', { class: 'pc-indicator-picker-name' }, ...marked(nameOf(def)));
    const inputs = inputSummary(def);
    if (inputs) name.append(h('span', { class: 'pc-indicator-picker-inputs' }, inputs));
    const text = h('span', { class: 'pc-indicator-picker-text' }, name);
    if (def.description) text.append(h('span', { class: 'pc-indicator-picker-description' }, describe(def, def.description)));
    item.append(text);
    if (showCategory) item.append(h('span', { class: 'pc-indicator-picker-category' }, categoryText(categoryOf(def))));
    if (count > 0) {
      item.append(
        h('span', { class: 'pc-indicator-picker-badge', title: t('indicatorsCount', { count }) }, count > 1 ? t('indicatorsAddedTimes', { count }) : t('indicatorsAdded')),
      );
    }
    const tools = h('span', { class: 'pc-indicator-picker-tools' });
    if (placementChoices(def).length > 1) tools.append(placementButton(def));
    for (const action of options.actions ?? []) {
      if (action.appliesTo && !safely(() => action.appliesTo!(def), false)) continue;
      tools.append(rowButton(action.icon, `${action.label}: ${nameOf(def)}`, () => action.onClick(def, chart)));
    }
    const latest = count > 0 && options.onSettings ? lastInstanceOf(def.id) : null;
    if (latest) tools.append(rowButton(Settings, t('indicatorsSettingsOf', { name: nameOf(def) }), () => openSettings(latest)));
    // Shown on the active row only (see style.css), so adding is visible where the pointer or keyboard is.
    const addButton = rowButton(Plus, t('indicatorsAddName', { name: nameOf(def) }), () => add(def));
    addButton.classList.add('pc-indicator-picker-add');
    addButton.append(h('span', {}, t('indicatorsAdd')));
    tools.append(addButton);
    row.append(star, item, tools);
    item.setAttribute('aria-label', rowLabel(def, count, inputs));
    if (!chart.indicators.isAllowed(def.id)) item.setAttribute('aria-disabled', 'true');
    return { el: row, option: item };
  }

  function placementButton(def: IndicatorDef): HTMLButtonElement {
    const current = placementFor(def, chosen.get(def.id), options.placement);
    const next: IndicatorPlacement = current === 'overlay' ? 'pane' : 'overlay';
    const where = (p: IndicatorPlacement) => t(p === 'overlay' ? 'indicatorsOnPricePane' : 'indicatorsInNewPane');
    const b = rowButton(
      current === 'overlay' ? ChartCandlestick : PanelBottom,
      t('indicatorsPlacement', { name: nameOf(def), where: where(current), next: where(next) }),
      () => {
        chosen.set(def.id, next);
        render();
        status.textContent = t('indicatorsWillAdd', { name: nameOf(def), where: where(next) });
      },
    );
    b.classList.add('pc-indicator-picker-placement');
    b.append(h('span', {}, t(current === 'overlay' ? 'seriesPrice' : 'indicatorsPane')));
    return b;
  }

  /** Every indicator on the chart, including pending ones and those the host filter hides from the catalogue. */
  function instanceRows(): HTMLElement[] {
    const byId = new Map(chart.indicators.getDefinitions().map((def) => [def.id, def]));
    const all = chart.indicators.getAll();
    const entries = all.map((indicator) => ({ type: indicator.type, title: instanceTitle(indicator), indicator }));
    return filterInstances(entries, byId, query, { nameOf }).map(({ indicator, title: text }) => {
      const { row, item } = option();
      const def = byId.get(indicator.type);
      const label = h('span', { class: 'pc-indicator-picker-text' }, h('span', { class: 'pc-indicator-picker-name' }, ...marked(text)));
      if (indicator.pending || !indicator.visible) {
        label.append(h('span', { class: 'pc-indicator-picker-description' }, t(indicator.pending ? 'indicatorsPending' : 'indicatorsHidden')));
      }
      item.append(label);
      if (def) item.append(h('span', { class: 'pc-indicator-picker-category' }, categoryText(categoryOf(def))));
      const tools = h('span', { class: 'pc-indicator-picker-tools' });
      if (options.onSettings && !indicator.pending) {
        tools.append(rowButton(Settings, t('indicatorsSettingsOf', { name: text }), () => openSettings(indicator)));
      }
      const removeButton = rowButton(Trash2, t('indicatorsRemove', { name: text }), () => remove(indicator));
      removeButton.classList.add('pc-danger');
      tools.append(removeButton);
      row.append(item, tools);
      item.setAttribute('aria-label', text);
      rows.push({ key: `instance:${all.indexOf(indicator)}:${indicator.type}`, indicator, el: row, option: item });
      return row;
    });
  }

  /** A presentational row holding the text-only option; the caller adds the row's buttons beside it. */
  function option(): { row: HTMLElement; item: HTMLElement } {
    const item = h('div', { class: 'pc-indicator-picker-option' });
    return { row: h('div', { class: 'pc-indicator-picker-row', role: 'presentation' }, item), item };
  }

  /** Small button inside a row; reached with Tab on the active row only. */
  function rowButton(source: IconSource, label: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', { class: 'pc-indicator-picker-tool', 'aria-label': label, 'data-tip': label, tabindex: '-1' });
    b.append(icon(source, 15));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  const marked = (text: string) => markedParts(text, query);

  /** `listed`: how many definitions the picker lists on both sides of the source switch. */
  function messageFor(listed: number): string {
    if (rows.length > 0) return '';
    const text = { text: query };
    if (tab === 'on-chart') return t(query ? 'indicatorsNoneOnChartMatch' : 'indicatorsNoneOnChart', text);
    return t(listed === 0 ? 'indicatorsNoneRegistered' : query ? 'indicatorsNoMatch' : 'indicatorsNoneInCategory', text);
  }

  function fill(text: string): void {
    message.textContent = text;
    message.hidden = text === '';
  }

  // ------------------------------------------------------------- actions

  /** Add an indicator of `def`, starting from `initial`; asks `options.initialState` first when it is undefined. */
  function add(def: IndicatorDef, initial?: IndicatorInitialState | null): void {
    const pending = initial === undefined && options.initialState?.(def);
    if (pending) return void Promise.resolve(pending).then((state) => add(def, state || null), () => add(def, null));
    const placement = placementFor(def, chosen.get(def.id), options.placement);
    let indicator: Indicator;
    try {
      indicator = chart.indicators.add(def, initial?.inputs, { ...options.addOptions, placement });
    } catch (error) {
      // A refusal already fired `indicator:refuse` for the app to explain; only say why here.
      const refusal = chart.indicators.refusal(def.id);
      const params = { name: nameOf(def), limit: chart.indicators.limit ?? '' };
      if (refusal === 'limit') status.textContent = t('indicatorsLimit', params);
      else if (refusal === 'blocked') status.textContent = t('indicatorsBlocked', params);
      else {
        status.textContent = t('indicatorsAddFailed', params);
        console.error(error);
      }
      return;
    }
    // Plot styles the indicator refuses (an unknown plot, an invalid value) are skipped.
    for (const [id, style] of Object.entries(initial?.plotStyles ?? {})) {
      try {
        indicator.setPlotStyle(id, style);
      } catch {}
    }
    update((m) => ({ ...m, recents: pushRecent(m.recents, def.id) }));
    const count = countByType(chart.indicators.getAll()).get(def.id) ?? 1;
    status.textContent = t(count > 1 ? 'indicatorsAddedCount' : 'indicatorsAddedName', { name: nameOf(def), count });
    render();
    options.onAdd?.(indicator);
  }

  function remove(indicator: Indicator): void {
    const text = instanceTitle(indicator);
    indicator.remove();
    status.textContent = t('indicatorsRemoved', { name: text });
    render();
  }

  /**
   * Hand over to the host's settings dialog: close first, so the picker's
   * focus trap and inert siblings do not hold the dialog it opens.
   */
  function openSettings(indicator: Indicator): void {
    close();
    options.onSettings?.(indicator);
  }

  function setFavorite(defId: string): void {
    const name = chart.indicators.getDefinitions().find((d) => d.id === defId)?.name ?? defId;
    if (!shared) update((m) => ({ ...m, favorites: toggleFavorite(m.favorites, defId) }));
    else if (shared.has(defId)) shared.remove(defId);
    else if (!shared.add(defId)) {
      status.textContent = t('favoritesFull', { name, limit: shared.limit });
      return;
    }
    status.textContent = t(favoriteIds().includes(defId) ? 'indicatorsFavoriteAdded' : 'indicatorsFavoriteRemoved', { name });
    render();
  }

  function selectTab(next: string): void {
    tab = next;
    render(true);
    announce();
  }

  function announce(): void {
    status.textContent = resultsText(chart, rows.length);
  }

  function lastInstanceOf(type: string): Indicator | null {
    const all = chart.indicators.getAll().filter((i) => i.type === type);
    return all[all.length - 1] ?? null;
  }

  function rowLabel(def: IndicatorDef, count: number, inputs: string): string {
    const parts = [nameOf(def)];
    if (inputs) parts.push(inputs);
    if (def.description) parts.push(describe(def, def.description));
    if (count > 0) parts.push(count > 1 ? t('indicatorsCount', { count }) : t('indicatorsOnChartLower'));
    return parts.join(', ');
  }

  // ------------------------------------------------------------- keyboard

  /** A click on a row, or Enter: add a definition, or open an indicator's settings. No Delete key: a press (or key repeat) must not remove indicators; the row's remove button does. */
  function activate(index: number): void {
    const row = rows[index];
    if (row?.def) add(row.def);
    else if (row && options.onSettings && !row.indicator.pending) openSettings(row.indicator);
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const run = () => {
      query = input.value.trim();
      render(true);
      announce();
    };
    const delay = options.debounce ?? 80;
    if (delay <= 0) run();
    else timer = setTimeout(run, delay);
  });

  panel.addEventListener('keydown', (e) => {
    // The frame handled Escape and Tab, the list the arrows on a row button.
    if (e.target === input || e.defaultPrevented || e.key === 'Tab') return;
    // Typing anywhere in the dialog searches.
    if (printable(e) && e.key !== ' ') {
      e.preventDefault();
      input.focus({ preventScroll: true });
      input.setRangeText(e.key, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, 'end');
      input.dispatchEvent(new Event('input'));
    }
  });

  // The shortcut is an action, so apps can rebind or turn it off like the chart's own.
  // When another action also takes `/`, the one registered first wins (the shell leaves `/` to its symbol search).
  const actions = chart.actions;
  const unregister = actions.has(INDICATOR_PICKER)
    ? () => {}
    : actions.register({
        id: INDICATOR_PICKER,
        label: () => shellText(chart, 'actionIndicatorPicker'),
        keys: slashTarget ? ['/'] : [],
        local: true,
        enabled: () => !isOpen,
        run: () => handle.open(),
      });
  // The chart runs actions for its own root; another element hears the same shortcut here.
  const onSlash = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.target !== e.currentTarget || !chart.features.keyboard) return;
    if (actions.match(e).includes(INDICATOR_PICKER) && actions.run(INDICATOR_PICKER)) e.preventDefault();
  };
  const slashListener = slashTarget && slashTarget !== chart.root ? slashTarget : null;
  slashListener?.addEventListener('keydown', onSlash);

  // ------------------------------------------------------------- lifecycle

  function open(text = ''): void {
    if (!isOpen) {
      isOpen = true;
      modal.show();
      // In the chart's language at the time it opens.
      modal.label(t('actionIndicatorPicker'), t('dialogClose'), t('indicatorsSearch'), t('indicatorsSearchPlaceholder'));
      tabList.el.setAttribute('aria-label', t('dialogCategories'));
      sources.relabel(t('indicatorsSource'), sourceOptions());
      restoreSiblings = inertSiblings(el);
      const refresh = () => render();
      unsubscribe.push(
        chart.on('indicator:add', refresh),
        chart.on('indicator:remove', refresh),
        chart.on('indicator:change', refresh),
        chart.on('indicators:access-change', refresh),
      );
      tab = 'all';
      source = 'built-in';
      sources.set(source);
      options.onOpenChange?.(true);
    }
    clearTimeout(timer);
    reload();
    modal.type(text);
    query = text.trim();
    render(true);
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    clearTimeout(timer);
    unsubscribe.splice(0).forEach((off) => off());
    // Siblings first, so the opener can take focus back.
    restoreSiblings?.();
    restoreSiblings = null;
    rows = [];
    listing.show(rows, [], true);
    modal.hide();
    options.onOpenChange?.(false);
  }

  const releaseTips = retainTips();
  const handle: IndicatorPickerHandle = {
    el,
    get isOpen() {
      return isOpen;
    },
    open,
    close,
    toggle: () => (isOpen ? close() : open()),
    get recents() {
      reload();
      return [...memory.recents];
    },
    get favorites() {
      reload();
      return [...favoriteIds()];
    },
    toggleFavorite: setFavorite,
    commandSource: {
      id: 'indicators',
      get label() {
        return t('actionIndicatorPicker');
      },
      // Ranked like the picker's search, so both find the same indicators first.
      ranked: true,
      entries: (text) =>
        searchIndicators(definitions(), text.trim(), { nameOf }).map((def) => ({
          id: def.id,
          label: nameOf(def),
          description: categoryText(categoryOf(def)),
          disabled: !chart.indicators.isAllowed(def.id),
          run: () => add(def),
        })),
    },
    destroy() {
      releaseTips();
      close();
      sources.destroy();
      slashListener?.removeEventListener('keydown', onSlash);
      offShared();
      unregister();
      el.remove();
      if (handles.get(chart) === handle) handles.delete(chart);
    },
  };
  handles.set(chart, handle);
  return handle;
}

/**
 * Make the siblings of the modal `el` inert, so neither pointer, keyboard nor
 * assistive tech reaches what the dialog covers. Returns a function that undoes
 * it, leaving siblings that were inert already as they were.
 */
function inertSiblings(el: HTMLElement): () => void {
  const changed: Element[] = [];
  for (const sibling of el.parentElement?.children ?? []) {
    if (sibling === el || sibling.hasAttribute('inert')) continue;
    sibling.setAttribute('inert', '');
    changed.push(sibling);
  }
  return () => changed.forEach((sibling) => sibling.removeAttribute('inert'));
}

/** Legend title of an indicator on the chart, or its type while pending. */
function instanceTitle(indicator: Indicator): string {
  return indicator.series?.options.title ?? indicator.type;
}

function safely<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}
