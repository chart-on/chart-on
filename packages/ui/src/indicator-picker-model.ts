import { matchRank, type IndicatorDef } from '@charton/core';
import { localJson } from './local-json';
import { normalize, rankBy } from './picker-model';

export { matchRank, searchIndicators } from '@charton/core';

/** Where an indicator draws: on the price pane or in a pane of its own. */
export type IndicatorPlacement = 'overlay' | 'pane';

/** Built-in category ids in the order the picker lists them. Custom categories follow. */
export const knownCategories = ['trend', 'momentum', 'volatility', 'volume', 'profiles'] as const;

/** Category id of a definition; `'other'` when it declares none. */
export function categoryOf(def: IndicatorDef): string {
  const category = typeof def.category === 'string' ? def.category.trim() : '';
  return category || 'other';
}

/** Display label of a category id: the id with its first letter capitalised (`'trend'` reads Trend). */
export function categoryLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** A host-defined section of the picker, e.g. "My indicators". */
export interface IndicatorPickerGroup {
  /** Unique among the groups. */
  id: string;
  label: string;
  /** Definitions listed in the group. */
  includes(def: IndicatorDef): boolean;
}

export interface PickerTab {
  /** `'all'`, `'on-chart'`, `'category:<id>'` or `'group:<id>'`. */
  id: string;
  label: string;
}

/** Tabs: All, On chart, the categories present (built-ins first, then custom, then Other), then host groups. */
export function pickerTabs(defs: readonly IndicatorDef[], groups: readonly IndicatorPickerGroup[] = []): PickerTab[] {
  const present = new Set(defs.map(categoryOf));
  const custom = [...present].filter((id) => id !== 'other' && !(knownCategories as readonly string[]).includes(id));
  const order = [...knownCategories.filter((id) => present.has(id)), ...custom, ...(present.has('other') ? ['other'] : [])];
  return [
    { id: 'all', label: 'All' },
    { id: 'on-chart', label: 'On chart' },
    ...order.map((id) => ({ id: `category:${id}`, label: categoryLabel(id) })),
    ...groups.map((group) => ({ id: `group:${group.id}`, label: group.label })),
  ];
}

/** Definitions a tab lists, in the given order. `on-chart` lists instances instead, so it returns none. */
export function definitionsInTab(
  defs: readonly IndicatorDef[],
  tab: string,
  groups: readonly IndicatorPickerGroup[] = [],
): IndicatorDef[] {
  if (tab === 'all') return [...defs];
  if (tab.startsWith('category:')) {
    const id = tab.slice('category:'.length);
    return defs.filter((def) => categoryOf(def) === id);
  }
  if (tab.startsWith('group:')) {
    const group = groups.find((g) => `group:${g.id}` === tab);
    return group ? defs.filter((def) => safeIncludes(group, def)) : [];
  }
  return [];
}

/** A host group includes `def`: it is on the host side of the picker's source switch. */
export const inGroup = (def: IndicatorDef, groups: readonly IndicatorPickerGroup[]) => groups.some((group) => safeIncludes(group, def));

function safeIncludes(group: IndicatorPickerGroup, def: IndicatorDef): boolean {
  try {
    return group.includes(def);
  } catch {
    return false;
  }
}

/**
 * The default inputs a new indicator's legend title shows, e.g. `"14, close"`:
 * what its `title` gives for the defaults after the name, else the defaults of
 * its number and source inputs. Empty when there are none, or when the title
 * does not start with the name.
 */
export function inputSummary(def: IndicatorDef): string {
  const inputs = (Array.isArray(def.inputs) ? def.inputs : []).filter(Boolean);
  if (typeof def.title === 'function') {
    try {
      const title = String(def.title(Object.fromEntries(inputs.map((input) => [input.id, input.default]))));
      return title.startsWith(`${def.name} `) ? title.slice(def.name.length).trim().split(/\s+/).join(', ') : '';
    } catch {
      return '';
    }
  }
  return inputs
    .filter((input) => input.type === 'number' || input.type === 'source')
    .map((input) => String(input.default))
    .join(', ');
}

/** How many recently added indicators the picker remembers. */
export const RECENT_LIMIT = 8;

/** `id` moved to the front of `recents`, keeping at most `limit` ids. */
export function pushRecent(recents: readonly string[], id: string, limit = RECENT_LIMIT): string[] {
  return [id, ...recents.filter((r) => r !== id)].slice(0, Math.max(0, limit));
}

/** `favorites` with `id` added at the end, or removed when present. */
export function toggleFavorite(favorites: readonly string[], id: string): string[] {
  return favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
}

/** What the picker remembers between visits. */
export interface IndicatorPickerMemory {
  /** Definition ids, most recently added first. */
  recents: string[];
  /** Definition ids, in the order they were starred. */
  favorites: string[];
}

/** Where recents and favourites are kept, e.g. an app's settings store. */
export interface IndicatorPickerStorage {
  load(): IndicatorPickerMemory | null;
  save(memory: IndicatorPickerMemory): void;
}

/** Recents and favourites from untrusted data: unique string ids only, recents capped. */
export function sanitizeMemory(raw: unknown): IndicatorPickerMemory {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const ids = (value: unknown) =>
    Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && v !== ''))] : [];
  return { recents: ids(record.recents).slice(0, RECENT_LIMIT), favorites: ids(record.favorites) };
}

/** `localStorage` storage; unavailable or blocked storage reads as empty and saves nothing. */
export function localIndicatorPickerStorage(key = 'charton:indicator-picker'): IndicatorPickerStorage {
  return localJson(key, sanitizeMemory);
}

/**
 * Definitions a picker lists: those the chart's access rule refuses left out
 * (kept with `showBlocked`, so choosing one fires `indicator:refuse`), then
 * the host `filter`; a filter that throws hides the definition.
 */
export function listedDefinitions(
  defs: readonly IndicatorDef[],
  rules: { isAllowed(type: string): boolean; showBlocked?: boolean; filter?: (def: IndicatorDef) => boolean },
): IndicatorDef[] {
  return defs.filter((def) => {
    if (!rules.showBlocked && !rules.isAllowed(def.id)) return false;
    if (!rules.filter) return true;
    try {
      return rules.filter(def);
    } catch {
      return false;
    }
  });
}

/** Indicators on the chart per definition id. */
export function countByType(instances: readonly { type: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { type } of instances) counts.set(type, (counts.get(type) ?? 0) + 1);
  return counts;
}

export interface PickerRow {
  def: IndicatorDef;
  favorite: boolean;
  /** Instances of this definition on the chart. */
  count: number;
}

export interface PickerSection {
  /** `'favorites'`, `'recent'`, `'all'` or `'results'`. */
  id: string;
  label: string;
  rows: PickerRow[];
}

export interface PickerViewInput {
  /** Definitions the picker may list (the host filter already applied), in registration order. */
  defs: readonly IndicatorDef[];
  query: string;
  tab: string;
  favorites: readonly string[];
  recents: readonly string[];
  counts: ReadonlyMap<string, number>;
  groups?: readonly IndicatorPickerGroup[];
  /** The name shown for a definition, e.g. in the chart's language; default its `name`. Search and sorting use it. */
  nameOf?: (def: IndicatorDef) => string;
}

/** Options for `filterInstances`; core `searchIndicators` takes the same `nameOf`. */
export interface IndicatorNameOptions {
  /** The name shown for a definition, e.g. in the chart's language; default its `name`. */
  nameOf?: (def: IndicatorDef) => string;
}

/**
 * Sections of definition rows for a tab. With a query: one ranked list,
 * favourites first among equally good matches. Without: in the All tab
 * Favourites, then Recent, then every definition by name; in a category or
 * group tab its definitions by name, favourites first.
 */
export function pickerSections(input: PickerViewInput): PickerSection[] {
  const { query, tab, favorites, recents, counts, groups = [], nameOf = (def) => def.name } = input;
  const byName = (a: IndicatorDef, b: IndicatorDef) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' });
  const listed = definitionsInTab(input.defs, tab, groups);
  const isFavorite = (def: IndicatorDef) => favorites.includes(def.id);
  const row = (def: IndicatorDef): PickerRow => ({ def, favorite: isFavorite(def), count: counts.get(def.id) ?? 0 });

  if (query.trim()) {
    // Core `matchRank` by the names shown, favourites first among equally good matches.
    const results = rankBy(listed, (def) => matchRank(def, query, { name: nameOf(def) }), undefined, (def) => (isFavorite(def) ? 0 : 1));
    return results.length ? [{ id: 'results', label: 'Results', rows: results.map(row) }] : [];
  }

  const byId = new Map(listed.map((def) => [def.id, def]));
  const sections: PickerSection[] = [];
  if (tab === 'all') {
    const favoriteDefs = favorites.flatMap((id) => byId.get(id) ?? []);
    if (favoriteDefs.length) sections.push({ id: 'favorites', label: 'Favorites', rows: favoriteDefs.map(row) });
    const recentDefs = recents.filter((id) => !favorites.includes(id)).flatMap((id) => byId.get(id) ?? []);
    if (recentDefs.length) sections.push({ id: 'recent', label: 'Recent', rows: recentDefs.map(row) });
    if (listed.length) sections.push({ id: 'all', label: 'All indicators', rows: [...listed].sort(byName).map(row) });
    return sections;
  }
  const sorted = [...listed].sort((a, b) => Number(isFavorite(b)) - Number(isFavorite(a)) || byName(a, b));
  return sorted.length ? [{ id: 'all', label: tabLabel(tab, groups), rows: sorted.map(row) }] : [];
}

function tabLabel(tab: string, groups: readonly IndicatorPickerGroup[]): string {
  if (tab.startsWith('category:')) return categoryLabel(tab.slice('category:'.length));
  return groups.find((g) => `group:${g.id}` === tab)?.label ?? '';
}

/** An indicator on the chart as the On chart tab sees it. */
export interface PickerInstance {
  type: string;
  /** Legend title, e.g. "SMA 20 close". */
  title: string;
}

/** On-chart indicators whose title or definition matches `query`, in the order they were added. */
export function filterInstances<T extends PickerInstance>(
  instances: readonly T[],
  defs: ReadonlyMap<string, IndicatorDef>,
  query: string,
  options: IndicatorNameOptions = {},
): T[] {
  const q = normalize(query);
  if (!q) return [...instances];
  return instances.filter((instance) => {
    if (normalize(instance.title).includes(q)) return true;
    const def = defs.get(instance.type);
    return def ? matchRank(def, q, { name: options.nameOf?.(def) }) !== null : instance.type.toLowerCase().includes(q);
  });
}

/** Placements a definition can be added with; two only for `placement: 'either'`. */
export function placementChoices(def: IndicatorDef): IndicatorPlacement[] {
  if (def.placement === 'either') return ['overlay', 'pane'];
  return [def.placement === 'pane' ? 'pane' : 'overlay'];
}

/** Placement used when adding `def`: fixed by the definition, else the row's choice, else `fallback`. */
export function placementFor(
  def: IndicatorDef,
  chosen: IndicatorPlacement | undefined,
  fallback: IndicatorPlacement = 'overlay',
): IndicatorPlacement {
  const choices = placementChoices(def);
  if (choices.length === 1) return choices[0]!;
  return chosen ?? fallback;
}

/**
 * Next index in a roving list of `count` after `key`, wrapping, or null when the key does not
 * move. Up and Down move a `vertical` list, Left and Right a horizontal one (`vertical` false),
 * and all four when `vertical` is left out; Home and End go to the ends.
 */
export function stepTab(current: number, count: number, key: string, vertical?: boolean): number | null {
  if (count === 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const v = vertical !== false;
  const h = !vertical;
  const by = (v && key === 'ArrowDown') || (h && key === 'ArrowRight') ? 1 : (v && key === 'ArrowUp') || (h && key === 'ArrowLeft') ? -1 : 0;
  return by ? (current + by + count) % count : null;
}
