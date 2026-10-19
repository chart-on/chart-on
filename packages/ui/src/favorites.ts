import type { Chart, Rect, SettingsAdapter } from '@chart-on/core';
import { Grip, RectangleHorizontal, RectangleVertical } from 'lucide';
import { iconButton } from './controls';
import { h, markActive, icon, isolateFromChart, type Visibility } from './dom';
import { shellText } from './messages';
import {
  defaultFavoritesBar,
  DRAG_THRESHOLD,
  dropIndex,
  FAVORITES_VERSION,
  favoritesBarFraction,
  favoritesBarRoom,
  fillShown,
  isFavoritesKind,
  localFavoritesStorage,
  moveItem,
  placeFavoritesBar,
  sanitizeFavorites,
  type FavoritesBarOrientation,
  type FavoritesBarState,
  type FavoritesRecord,
  type FavoritesStorage,
} from './favorites-model';
import { doublePress, markBlocked, markKept, onToolPress, pressTool, showToolTip, toolIconOf, toolLabelOf } from './rail';
import { devCheck } from './options-schema';

/** The shell's `favorites` option: the starting favourite drawing tools, bar visibility and layout, and where they are saved. */
export interface FavoritesOptions {
  /** Starred tool types when storage holds none yet. Unknown types are skipped. Default none. */
  tools?: string[];
  /** Show the favourites bar while it has tools; when storage holds none yet. Default `true`. */
  bar?: boolean;
  /** Layout of the bar when storage holds none yet. Default `horizontal`. */
  orientation?: FavoritesBarOrientation;
  /** Where to keep favourites and the bar's place; `null` keeps them for this visit only. Default `localStorage`. */
  storage?: FavoritesStorage | null;
  /**
   * Preference store, under key `favorites`, e.g. the `settings` of
   * `createLocalStorageAdapter` or an app's own store. Used when `storage` is not given.
   */
  settings?: SettingsAdapter | null;
  /**
   * `localStorage` key of the default storage. Default `'charton:favorites'`.
   * Give each shell on a page its own key, or they share (and overwrite) one set.
   */
  storageKey?: string;
  /** Limits and behaviour of kinds, built-in or the app's own; `shell.favorites.registerKind` adds more later. */
  kinds?: FavoritesKind[];
}

/**
 * A kind of favourites (see `ShellFavorites.of`): how many it keeps, which
 * starred references can be used now, and how to use one. Built-in kinds are
 * `tool`, `interval`, `chart-style`, `indicator` and `symbol`; give one of
 * those ids to change its limit.
 */
export interface FavoritesKind {
  /** A non-empty string other than `__proto__`, `constructor` or `prototype`. */
  id: string;
  /** Most references the list holds; starring past it is refused (`limit` event), nothing is evicted. Default 30. */
  limit?: number;
  /**
   * Whether a starred reference can be used now, e.g. a symbol that is still
   * listed. Surfaces grey out or skip the others, and keep them starred.
   * Default: every reference can.
   */
  isAvailable?(ref: string): boolean;
  /** Use a starred reference, e.g. switch to it; see `FavoritesList.activate`. */
  activate?(ref: string): void;
}

/** Events emitted by the favourites, by name. */
export interface FavoritesEvents {
  /** The favourite tools or their order changed. */
  change: { types: string[] };
  /** The list of `kind` (any kind, tools included) or its order changed. */
  'list:change': { kind: string; items: string[] };
  /** Starring `ref` was refused: the list of `kind` already holds `limit` references. */
  limit: { kind: string; ref: string; limit: number };
}

/** What `ShellFavorites.export` returns and `import` reads: the stored record with its format version. */
export interface FavoritesEnvelope extends FavoritesRecord {
  /** Format version; `import` refuses other versions. */
  version: number;
}

/**
 * Starred references of one kind (e.g. `'interval'`, `'symbol'`), from
 * `ShellFavorites.of(kind)`. Every kind shares the favourites' stored record;
 * `of('tool')` is the same list the tool methods edit.
 */
export interface FavoritesList {
  readonly kind: string;
  /** Most references the list holds (`FavoritesKind.limit`). */
  readonly limit: number;
  /**
   * The starred references, in order, including ones that cannot be used now
   * (e.g. a tool this chart does not register): those stay starred.
   */
  get(): string[];
  /**
   * Replace the list; empty strings and repeats are skipped (and, for `'tool'`,
   * unknown tool types that are not starred already). Past the limit the rest is skipped and `limit` fires.
   */
  set(refs: readonly string[]): void;
  /**
   * Append a reference. Returns false, changing nothing, when it is already
   * starred, unknown (tools) or the list is full (`limit` fires then).
   */
  add(ref: string): boolean;
  remove(ref: string): void;
  has(ref: string): boolean;
  /** Whether a starred reference can be used now; see `FavoritesKind.isAvailable`. */
  isAvailable(ref: string): boolean;
  /** Use a reference through its kind's `activate`; returns false when the kind has none or the reference cannot be used. */
  activate(ref: string): boolean;
  /** Move the entry at index `from` to index `to` (clamped). */
  move(from: number, to: number): void;
  clear(): void;
  /** Subscribe to changes of this kind's list or order; returns an unsubscribe function. */
  on(event: 'change', listener: (payload: { items: string[] }) => void): () => void;
}

/** The floating bar of favourite tools. `visible` is the user's choice: it shows while it also has tools to show. */
export interface FavoritesBarHandle extends Visibility {
  el: HTMLElement;
  readonly orientation: FavoritesBarOrientation;
  setOrientation(orientation: FavoritesBarOrientation): void;
}

/** Starred drawing tools, shown in the favourites bar and starred in the rail's flyouts. */
export interface ShellFavorites {
  /** Favourite tool types, in bar order. */
  get(): string[];
  /** Replace the favourites; repeats and unknown tool types not starred already are skipped. */
  set(types: readonly string[]): void;
  /** Append a tool; returns false, changing nothing, for an unknown type, one already starred or a full list. */
  add(type: string): boolean;
  remove(type: string): void;
  has(type: string): boolean;
  /** The favourites of any kind, kept in the same record; `kind` is a non-empty string other than `__proto__`, `constructor` or `prototype`. */
  of(kind: string): FavoritesList;
  /** Set a kind's limit and behaviour, replacing an earlier definition with its id; returns a function that removes it again. */
  registerKind(kind: FavoritesKind): () => void;
  /** Every kind's favourites and the bar's place, to save elsewhere or move to another browser. */
  export(): FavoritesEnvelope;
  /**
   * Replace the favourites and the bar's place with an `export()` result.
   * Kinds and references this chart does not know are kept. Returns false,
   * changing nothing, for data of another version or shape.
   */
  import(data: unknown): boolean;
  readonly bar: FavoritesBarHandle;
  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof FavoritesEvents>(event: K, listener: (payload: FavoritesEvents[K]) => void): () => void;
}

/** Internal: also notifies of bar changes, for the rail's toggle, and can be torn down. */
export interface FavoritesController extends ShellFavorites {
  /** Called after any change to the favourites or the bar. */
  onUpdate(listener: () => void): () => void;
  destroy(): void;
}

/** Bar movement per arrow key press on the handle (css px); Shift moves further. */
const KEY_STEP = 8;
const KEY_STEP_LARGE = 32;

/** The shell's `favorites` part, made by `favorites(options)`: the shell calls it with its chart and hands the result to the rail. */
export type FavoritesPart = (chart: Chart) => FavoritesController;

/**
 * Favourite drawing tools for the shell's `favorites` option: a star beside
 * each tool in the rail's flyouts and a movable bar of the starred tools over
 * the plot. Without it the rail's `favorites` item is skipped and flyouts show no stars.
 */
export function favorites(options: FavoritesOptions = {}): FavoritesPart {
  devCheck('favorites', options, 'favorites');
  return (chart) => createFavorites(chart, options);
}

/** Most references a kind's list holds unless its `FavoritesKind.limit` says otherwise. */
const DEFAULT_LIMIT = 30;

const controllers = new WeakMap<Chart, FavoritesController>();

/** Internal: the favourites of the shell holding `chart`, for toolbar presets; undefined without the `favorites` part. */
export function favoritesOf(chart: Chart): ShellFavorites | undefined {
  return controllers.get(chart);
}

export function createFavorites(chart: Chart, options: FavoritesOptions = {}): FavoritesController {
  const storage = storageOf(options);
  const saved = sanitizeFavorites(loadSaved(storage));
  const items: Record<string, string[]> = saved?.items ?? {};
  const bar: FavoritesBarState = saved?.bar ?? {
    ...defaultFavoritesBar,
    // On the plot edge the legend does not use, so the bar covers none of its rows.
    y: chart.legendSettings.position.startsWith('bottom') ? 0 : defaultFavoritesBar.y,
    visible: options.bar ?? defaultFavoritesBar.visible,
    orientation: options.orientation ?? defaultFavoritesBar.orientation,
  };
  const known = (types: readonly unknown[]): string[] => {
    const registered = new Set(chart.drawings.getTools().map((t) => t.type));
    return [...new Set(types.filter((t): t is string => typeof t === 'string' && registered.has(t)))];
  };
  // Saved tools stay starred even when this chart does not register them; only the `tools` option is checked.
  if (!saved) items.tool = known(options.tools ?? []);
  const listOf = (kind: string): string[] => (Object.hasOwn(items, kind) ? items[kind]! : []);
  /**
   * Usable references for `kind`: strings once each; for `'tool'`, registered
   * tools and ones already starred (a saved tool this chart does not register
   * survives a get, change and set).
   */
  const clean = (kind: string, refs: readonly unknown[]): string[] => {
    const strings = [...new Set(refs.filter((r): r is string => typeof r === 'string' && r !== ''))];
    if (kind !== 'tool') return strings;
    const starred = listOf('tool');
    return strings.filter((type) => starred.includes(type) || known([type]).length > 0);
  };

  const kinds = new Map<string, FavoritesKind>();
  const registerKind = (kind: FavoritesKind): (() => void) => {
    if (!isFavoritesKind(kind?.id)) throw new Error(`Favourites kind id must be a non-empty string other than __proto__, constructor or prototype`);
    if (kind.limit !== undefined && !(kind.limit >= 0)) throw new Error(`Favourites limit of '${kind.id}' must be a number of 0 or more`);
    kinds.set(kind.id, kind);
    return () => {
      if (kinds.get(kind.id) === kind) kinds.delete(kind.id);
    };
  };
  options.kinds?.forEach(registerKind);
  /** Tools are available while registered, and activating one arms it; a registered `tool` kind can change that. */
  const toolKind: Omit<FavoritesKind, 'id'> = {
    isAvailable: (type) => known([type]).length > 0,
    activate: (type) => chart.drawings.tool === type || pressTool(chart, type, false),
  };
  const kindOf = (kind: string): Omit<FavoritesKind, 'id'> => ({ ...(kind === 'tool' ? toolKind : {}), ...kinds.get(kind) });
  const limitOf = (kind: string) => kindOf(kind).limit ?? DEFAULT_LIMIT;

  const listeners = new Map<keyof FavoritesEvents, Set<(payload: never) => void>>();
  const emit = <K extends keyof FavoritesEvents>(event: K, payload: FavoritesEvents[K]) =>
    listeners.get(event)?.forEach((l) => (l as (payload: FavoritesEvents[K]) => void)(payload));
  const kindListeners = new Map<string, Set<(payload: { items: string[] }) => void>>();
  const updateListeners = new Set<() => void>();
  const save = () => {
    const record: FavoritesRecord = { items: { ...items }, bar: { ...bar } };
    try {
      storage?.save(record);
    } catch (error) {
      // A failing custom storage must not break the bar; the change still applies for this visit.
      console.warn('Favourites storage failed to save:', error);
    }
  };
  /** Persist, redraw the bar, and tell listeners of the `changed` kinds. */
  const commit = (...changed: string[]) => {
    save();
    if (changed.includes('tool')) build();
    else apply();
    if (changed.includes('tool')) emit('change', { types: [...listOf('tool')] });
    for (const kind of changed) {
      kindListeners.get(kind)?.forEach((l) => l({ items: [...listOf(kind)] }));
      emit('list:change', { kind, items: [...listOf(kind)] });
    }
    updateListeners.forEach((l) => l());
  };
  const setList = (kind: string, next: string[]) => {
    if (sameList(next, listOf(kind))) return;
    items[kind] = next;
    commit(kind);
  };
  /** `next` cut to the kind's limit; past it `limit` fires for the first reference left out. */
  const capped = (kind: string, next: string[]): string[] => {
    const limit = limitOf(kind);
    if (next.length <= limit) return next;
    emit('limit', { kind, ref: next[limit]!, limit });
    return next.slice(0, limit);
  };
  const setTools = (next: string[]) => setList('tool', next);

  // ---- the bar ----
  const el = h('div', { class: 'pc-favorites-bar', role: 'toolbar', 'aria-label': shellText(chart, 'favoritesLabel') });
  // Keep chart gestures (pan, drawing hit tests, wheel zoom) off the bar.
  isolateFromChart(el);
  const handle = iconButton({ icon: Grip, label: shellText(chart, 'favoritesMove'), variant: 'ghost' });
  handle.classList.add('pc-favorites-handle');
  const list = h('div', { class: 'pc-favorites-tools' });
  const flip = iconButton({
    icon: RectangleVertical,
    label: shellText(chart, 'favoritesVertical'),
    variant: 'ghost',
    onClick: () => setOrientation(otherOrientation()),
  });
  flip.classList.add('pc-favorites-flip');
  el.append(handle, list, flip);
  chart.root.append(el);

  const otherOrientation = (): FavoritesBarOrientation => (bar.orientation === 'horizontal' ? 'vertical' : 'horizontal');
  const setOrientation = (next: FavoritesBarOrientation) => {
    if (next !== 'horizontal' && next !== 'vertical') throw new Error(`Favourites bar orientation must be 'horizontal' or 'vertical'`);
    if (next === bar.orientation) return;
    bar.orientation = next;
    commit();
  };
  const setVisible = (visible: boolean) => {
    if (Boolean(visible) === bar.visible) return;
    bar.visible = Boolean(visible);
    commit();
  };

  /** Favourites the bar shows: registered ones `setAccess` allows, or all registered ones with `access.refused: 'disable'`. */
  const shown = () =>
    known(listOf('tool')).filter((t) => chart.options.access.refused === 'disable' || chart.drawings.isToolAllowed(t));
  const buttons = new Map<string, HTMLButtonElement>();
  let suppressClick = false;
  const paired = doublePress();

  const build = () => {
    const focused = [...buttons].find(([, b]) => b === document.activeElement)?.[0];
    buttons.clear();
    list.replaceChildren();
    for (const type of shown()) {
      const label = toolLabelOf(chart, type);
      const b = iconButton({ icon: toolIconOf(chart, type), label, variant: 'ghost', size: 'md' });
      showToolTip(chart, b, label, type);
      b.dataset.tool = type;
      markBlocked(b, !chart.drawings.isToolAllowed(type));
      onToolPress(
        b,
        (keep) => {
          if (suppressClick) {
            suppressClick = false;
            return;
          }
          // A tool unregistered since it was starred cannot be armed.
          if (known([type]).length === 0) return;
          pressTool(chart, type, keep);
        },
        (e) => paired(type, e),
      );
      b.addEventListener('keydown', (e) => onToolKey(e, type));
      bindReorder(b, type);
      buttons.set(type, b);
      list.append(b);
    }
    if (focused) buttons.get(focused)?.focus();
    apply();
  };

  const apply = () => {
    el.dataset.orientation = bar.orientation;
    el.setAttribute('aria-orientation', bar.orientation);
    const next = otherOrientation();
    const label = shellText(chart, next === 'vertical' ? 'favoritesVertical' : 'favoritesHorizontal');
    flip.replaceChildren(icon(next === 'vertical' ? RectangleVertical : RectangleHorizontal, 16));
    flip.setAttribute('aria-label', label);
    flip.setAttribute('data-tip', label);
    for (const [type, b] of buttons) {
      const on = chart.drawings.tool === type;
      markActive(b, on);
      markKept(chart, b, on && chart.drawings.toolKept);
    }
    const show = bar.visible && buttons.size > 0;
    if (!show && el.contains(document.activeElement)) chart.root.focus({ preventScroll: true });
    el.hidden = !show;
    placed = null;
    place();
  };

  // ---- placement ----
  /** Last placement: plot rect and corner, to skip work when nothing moved. */
  let placed: { key: string; corner: { x: number; y: number }; size: { width: number; height: number } } | null = null;
  const plot = (): Rect => chart.plotRect;
  /**
   * Tell the toast stack, through custom properties on the chart's container
   * (the shell's stage), how much room to keep for the bar; null: none.
   */
  const keepRoom = (room: { top: number; bottom: number } | null) => {
    const host = chart.root.parentElement;
    host?.style.setProperty('--pc-favorites-top', room?.top ? `${room.top}px` : '');
    host?.style.setProperty('--pc-favorites-bottom', room?.bottom ? `${room.bottom}px` : '');
  };
  const place = () => {
    if (el.hidden) return keepRoom(null);
    const area = plot();
    if (area.width <= 0 || area.height <= 0) return;
    const key = `${area.x},${area.y},${area.width},${area.height}`;
    if (placed?.key === key) return;
    // Never larger than the plot, so it cannot cover an axis; tools wrap instead.
    el.style.maxWidth = `${Math.max(0, area.width - 12)}px`;
    el.style.maxHeight = `${Math.max(0, area.height - 12)}px`;
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const corner = placeFavoritesBar(bar, size, area);
    el.style.transform = `translate(${corner.x}px, ${corner.y}px)`;
    keepRoom(favoritesBarRoom(corner, size, chart.height));
    placed = { key, corner, size };
  };
  /** Move the bar so its corner is at `corner`, clamped into the plot. */
  const moveTo = (corner: { x: number; y: number }) => {
    if (!placed) return;
    const at = favoritesBarFraction(corner, placed.size, plot());
    bar.x = at.x;
    bar.y = at.y;
    placed = null;
    place();
  };

  // Drag the handle to move the bar; arrow keys on it move it too.
  let move: { id: number; x: number; y: number; corner: { x: number; y: number } } | null = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !placed) return;
    move = { id: e.pointerId, x: e.clientX, y: e.clientY, corner: placed.corner };
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (move?.id !== e.pointerId) return;
    moveTo({ x: move.corner.x + e.clientX - move.x, y: move.corner.y + e.clientY - move.y });
  });
  const endMove = (e: PointerEvent) => {
    if (move?.id !== e.pointerId) return;
    move = null;
    commit();
  };
  handle.addEventListener('pointerup', endMove);
  handle.addEventListener('pointercancel', endMove);
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (!d || !placed) return;
    e.preventDefault();
    moveTo({ x: placed.corner.x + d[0], y: placed.corner.y + d[1] });
    commit();
  });

  // Alt + arrow keys move the focused tool one place earlier or later.
  const onToolKey = (e: KeyboardEvent, type: string) => {
    if (!e.altKey) return;
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const order = shown();
    const from = order.indexOf(type);
    setTools(fillShown(listOf('tool'), moveItem(order, from, from + step)));
    buttons.get(type)?.focus();
  };

  // Drag a tool along the bar to reorder; a press that does not travel is a click.
  const bindReorder = (b: HTMLButtonElement, type: string) => {
    let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      b.setPointerCapture(e.pointerId);
    });
    b.addEventListener('pointermove', (e) => {
      if (drag?.id !== e.pointerId) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_THRESHOLD) return;
      drag.moved = true;
      b.classList.add('is-dragging');
      const vertical = bar.orientation === 'vertical';
      const others = [...buttons.values()].filter((o) => o !== b);
      const centers = others.map((o) => {
        const r = o.getBoundingClientRect();
        return vertical ? r.top + r.height / 2 : r.left + r.width / 2;
      });
      const at = dropIndex(centers, vertical ? e.clientY : e.clientX);
      list.insertBefore(b, others[at] ?? null);
    });
    const end = (e: PointerEvent) => {
      if (drag?.id !== e.pointerId) return;
      const moved = drag.moved;
      drag = null;
      b.classList.remove('is-dragging');
      if (!moved) return;
      // The click that follows the release must not arm the tool.
      if (e.type === 'pointerup') {
        suppressClick = true;
        // Cleared once the click (if the browser sends one) has been seen.
        setTimeout(() => (suppressClick = false));
      }
      const order = [...list.children].map((c) => (c as HTMLElement).dataset.tool ?? '');
      setTools(fillShown(listOf('tool'), order));
      buttons.get(type)?.focus();
    };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
  };

  const offs = [
    chart.on('tool:change', apply),
    chart.on('access:change', build),
    chart.on('localization:change', () => {
      el.setAttribute('aria-label', shellText(chart, 'favoritesLabel'));
      const move = shellText(chart, 'favoritesMove');
      handle.setAttribute('aria-label', move);
      handle.setAttribute('data-tip', move);
      build();
    }),
    // Tooltips show the tools' shortcuts.
    chart.actions.on('actions:change', build),
    chart.on('view:change', place),
    chart.on('chart:resize', () => {
      placed = null;
      place();
    }),
  ];
  build();

  const barHandle: FavoritesBarHandle = {
    el,
    get visible() {
      return bar.visible;
    },
    setVisible,
    toggle: () => setVisible(!bar.visible),
    get orientation() {
      return bar.orientation;
    },
    setOrientation,
  };

  const of = (kind: string): FavoritesList => {
    if (!isFavoritesKind(kind)) throw new Error(`Favourites kind must be a non-empty string other than __proto__, constructor or prototype`);
    const isAvailable = (ref: string) => kindOf(kind).isAvailable?.(ref) ?? true;
    return {
      kind,
      get limit() {
        return limitOf(kind);
      },
      get: () => [...listOf(kind)],
      set(refs) {
        if (!Array.isArray(refs)) throw new Error('Favourites must be an array of strings');
        setList(kind, capped(kind, clean(kind, refs)));
      },
      add(ref) {
        const now = listOf(kind);
        if (now.includes(ref) || clean(kind, [ref]).length === 0) return false;
        if (now.length >= limitOf(kind)) {
          emit('limit', { kind, ref, limit: limitOf(kind) });
          return false;
        }
        setList(kind, [...now, ref]);
        return true;
      },
      remove: (ref) => setList(kind, listOf(kind).filter((r) => r !== ref)),
      has: (ref) => listOf(kind).includes(ref),
      isAvailable,
      activate(ref) {
        const use = kindOf(kind).activate;
        if (!use || !isAvailable(ref)) return false;
        use(ref);
        return true;
      },
      move: (from, to) => setList(kind, moveItem(listOf(kind), from, to)),
      clear: () => setList(kind, []),
      on(event, listener) {
        if (event !== 'change') return () => {};
        const set = kindListeners.get(kind) ?? new Set();
        kindListeners.set(kind, set.add(listener));
        return () => set.delete(listener);
      },
    };
  };
  const tool = of('tool');

  const controller: FavoritesController = {
    get: tool.get,
    set(types) {
      if (!Array.isArray(types)) throw new Error('Favourite tools must be an array of tool types');
      tool.set(types);
    },
    add: tool.add,
    remove: tool.remove,
    has: tool.has,
    of,
    registerKind,
    export: () => ({ version: FAVORITES_VERSION, items: structuredClone(items), bar: { ...bar } }),
    import(data) {
      const record = sanitizeFavorites(data);
      if (!record) return false;
      const before = { ...items };
      for (const kind of Object.keys(items)) delete items[kind];
      Object.assign(items, record.items);
      Object.assign(bar, record.bar);
      const kindsOf = new Set([...Object.keys(before), ...Object.keys(items)]);
      commit(...[...kindsOf].filter((kind) => !sameList(before[kind] ?? [], listOf(kind))));
      return true;
    },
    bar: barHandle,
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set.add(listener as (payload: never) => void));
      return () => set.delete(listener as (payload: never) => void);
    },
    onUpdate(listener) {
      updateListeners.add(listener);
      return () => updateListeners.delete(listener);
    },
    destroy() {
      offs.forEach((off) => off());
      listeners.clear();
      kindListeners.clear();
      updateListeners.clear();
      keepRoom(null);
      el.remove();
      if (controllers.get(chart) === controller) controllers.delete(chart);
    },
  };
  controllers.set(chart, controller);
  return controller;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((ref, i) => ref === b[i]);
}

/** Where favourites are kept: `storage`, else `settings` under key `favorites`, else `localStorage`. */
function storageOf(options: FavoritesOptions): FavoritesStorage | null {
  if (options.storage !== undefined) return options.storage;
  const settings = options.settings;
  if (settings === undefined) return localFavoritesStorage(options.storageKey);
  if (settings === null) return null;
  return {
    load: () => JSON.parse(settings.get('favorites') ?? 'null'),
    save: (record) => settings.set('favorites', JSON.stringify({ version: FAVORITES_VERSION, ...record })),
  };
}

/** Saved favourites from `storage`; a custom storage that throws reads as none. */
function loadSaved(storage: FavoritesStorage | null): unknown {
  try {
    return storage?.load() ?? null;
  } catch (error) {
    console.warn('Favourites storage failed to load:', error);
    return null;
  }
}
