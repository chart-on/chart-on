/**
 * Favourite drawing tools: the saved record, its storage, and the pure maths
 * behind the favourites bar (placement inside the plot, reordering). No DOM.
 */
import { localJson } from './local-json';

/** Which way the favourites bar runs. */
export type FavoritesBarOrientation = 'horizontal' | 'vertical';

/** Where the favourites bar sits and whether the user wants it shown. */
export interface FavoritesBarState {
  /** The user's choice; the bar only shows while it also has tools to show. */
  visible: boolean;
  orientation: FavoritesBarOrientation;
  /**
   * Position as fractions (0 to 1) of the room the bar has to move in inside
   * the plot: 0 is the left (top) edge, 1 the right (bottom) edge. Fractions
   * keep the bar in the same spot, and inside the plot, when the chart resizes.
   */
  x: number;
  y: number;
}

/** What favourites storage keeps between visits. */
export interface FavoritesRecord {
  /**
   * Starred references per kind, in order. The shell uses `tool` (drawing
   * tool types); other kinds are kept as saved, so later kinds round-trip.
   */
  items: Record<string, string[]>;
  bar: FavoritesBarState;
}

/** Where favourites are kept between visits. */
export interface FavoritesStorage {
  /** The saved record, or null when there is none. Run through `sanitizeFavorites` either way. */
  load(): unknown;
  save(record: FavoritesRecord): void;
}

/** Version written with each saved record; records of another version are ignored. */
export const FAVORITES_VERSION = 1;

/**
 * The default favourites bar: shown, horizontal, centred at the bottom of the
 * plot, clear of a legend in its usual top corner. The shell starts it at the
 * top instead when the legend sits at the bottom.
 */
export const defaultFavoritesBar: Readonly<FavoritesBarState> = {
  visible: true,
  orientation: 'horizontal',
  x: 0.5,
  y: 1,
};

/**
 * A usable record from saved data, or null when there is nothing usable.
 * Unknown fields are dropped; each kind keeps its strings once, in order;
 * bar fields that are missing or ill-typed take their defaults.
 */
export function sanitizeFavorites(data: unknown): FavoritesRecord | null {
  if (!isRecord(data) || !isRecord(data.items)) return null;
  if (data.version !== undefined && data.version !== FAVORITES_VERSION) return null;
  const items: Record<string, string[]> = {};
  for (const [kind, refs] of Object.entries(data.items)) {
    if (isFavoritesKind(kind) && Array.isArray(refs)) items[kind] = unique(refs.filter((r): r is string => typeof r === 'string' && r !== ''));
  }
  const raw = isRecord(data.bar) ? data.bar : {};
  const bar: FavoritesBarState = {
    visible: typeof raw.visible === 'boolean' ? raw.visible : defaultFavoritesBar.visible,
    orientation: raw.orientation === 'vertical' || raw.orientation === 'horizontal' ? raw.orientation : defaultFavoritesBar.orientation,
    x: fraction(raw.x, defaultFavoritesBar.x),
    y: fraction(raw.y, defaultFavoritesBar.y),
  };
  return { items, bar };
}

/**
 * Whether `kind` can name a list of favourites: a non-empty string that is not
 * a key with special meaning on objects (`__proto__`, `constructor`, `prototype`).
 */
export function isFavoritesKind(kind: unknown): kind is string {
  return typeof kind === 'string' && kind !== '' && kind !== '__proto__' && kind !== 'constructor' && kind !== 'prototype';
}

/** `localStorage` storage; unavailable or blocked storage reads as empty and saves nothing. */
export function localFavoritesStorage(key = 'charton:favorites'): FavoritesStorage {
  return localJson(key, (data) => data, (record: FavoritesRecord) => ({ version: FAVORITES_VERSION, ...record }));
}

/** `list` with the entry at `from` moved to index `to` (clamped); a copy. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item!);
  return out;
}

/**
 * `full` with the entries in `order` put back into the slots those entries
 * held, so reordering the tools a bar shows keeps hidden ones (e.g. tools
 * `setAccess` denies) where they were. `order` must hold the same entries.
 */
export function fillShown(full: readonly string[], order: readonly string[]): string[] {
  const shown = new Set(order);
  let i = 0;
  return full.map((t) => (shown.has(t) ? order[i++]! : t));
}

/** Pointer travel (css px) before a press starts a drag reorder instead of a click. */
export const DRAG_THRESHOLD = 4;

/**
 * Index a dragged entry lands on: the number of the other entries whose
 * centre lies before the pointer. `centers` are the other entries' centres
 * along the bar, in order.
 */
export function dropIndex(centers: readonly number[], pointer: number): number {
  let index = 0;
  while (index < centers.length && centers[index]! < pointer) index++;
  return index;
}

/** A rectangle in css px. */
export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Gap kept between the bar and the plot's edges (css px). */
export const FAVORITES_BAR_INSET = 6;

/**
 * Top-left corner (css px) of a bar of `size` at fractional position `at`
 * inside `area`, kept `inset` px clear of its edges. A bar larger than the
 * area sits at its top-left inset.
 */
export function placeFavoritesBar(
  at: { x: number; y: number },
  size: { width: number; height: number },
  area: BarRect,
  inset = FAVORITES_BAR_INSET,
): { x: number; y: number } {
  const roomX = Math.max(0, area.width - size.width - 2 * inset);
  const roomY = Math.max(0, area.height - size.height - 2 * inset);
  return {
    x: Math.round(area.x + inset + clamp01(at.x) * roomX),
    y: Math.round(area.y + inset + clamp01(at.y) * roomY),
  };
}

/** The inverse of `placeFavoritesBar`: fractions for a bar whose top-left corner is at `corner`. */
export function favoritesBarFraction(
  corner: { x: number; y: number },
  size: { width: number; height: number },
  area: BarRect,
  inset = FAVORITES_BAR_INSET,
): { x: number; y: number } {
  const roomX = area.width - size.width - 2 * inset;
  const roomY = area.height - size.height - 2 * inset;
  return {
    x: roomX > 0 ? clamp01((corner.x - area.x - inset) / roomX) : 0,
    y: roomY > 0 ? clamp01((corner.y - area.y - inset) / roomY) : 0,
  };
}

/** Gap between the bar and toasts stacked clear of it (css px). */
const TOAST_GAP = 8;

/**
 * Room toasts keep for a bar at `corner` of `size` in a chart `height` tall,
 * from the chart edge nearer the bar's middle: `bottom` for a bar in the lower
 * half, `top` for one in the upper half; the other is 0.
 */
export function favoritesBarRoom(corner: { x: number; y: number }, size: { width: number; height: number }, height: number): { top: number; bottom: number } {
  return corner.y + size.height / 2 > height / 2
    ? { top: 0, bottom: Math.max(0, height - corner.y + TOAST_GAP) }
    : { top: corner.y + size.height + TOAST_GAP, bottom: 0 };
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

function fraction(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fallback;
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
