import { PriceScale } from './scales';
import type { Series } from './series';

/**
 * Layout of a new pane: its height weight among the panes, and the empty
 * margins above and below the data as fractions of its height. A margin left
 * out is sized by the chart to fit what sits at that edge (see `addPane`).
 */
export interface PaneOptions {
  /** Relative height weight among panes. */
  stretch: number;
  marginTop?: number;
  marginBottom?: number;
}

/** One horizontal pane of the chart: its series, its price scales and its place in the layout. Create one with `chart.addPane`. */
export class Pane {
  /** The main scale (id `'right'`); its axis is on the right, or the left in a right-to-left chart. */
  readonly price: PriceScale;
  /** Other scales by id, created on first use. */
  readonly #extra = new Map<string, PriceScale>();
  /** Ids of scales made for one series, dropped by `pruneScales` once no series uses them. */
  readonly #transient = new Set<string>();
  readonly series: Series[] = [];
  stretch: number;
  /** Layout in css px, relative to the chart plot area. */
  top = 0;
  height = 0;
  /** Shrunk to a thin header showing only its legend. */
  collapsed = false;
  #hidden = false;

  constructor(
    readonly id: number,
    options: PaneOptions,
  ) {
    this.stretch = options.stretch;
    this.price = new PriceScale({ marginTop: options.marginTop, marginBottom: options.marginBottom });
  }

  /** Hidden with `chart.setPaneHidden`: no height, no separator; its series and drawings stay. */
  get hidden(): boolean {
    return this.#hidden;
  }

  /** @internal Set by `chart.setPaneHidden`, which lays the panes out again. */
  setHidden(hidden: boolean): void {
    this.#hidden = hidden;
  }

  /**
   * The scale `id`, created on first use: `'right'` is `price`, `'left'` gets
   * a left axis, and any other id starts as an overlay with no axis.
   */
  scale(id: string): PriceScale {
    if (id === 'right') return this.price;
    let s = this.#extra.get(id);
    if (!s) {
      s = new PriceScale({
        marginTop: this.price.marginTop,
        marginBottom: this.price.marginBottom,
        id,
        side: id === 'left' ? 'left' : 'none',
      });
      this.#extra.set(id, s);
    }
    return s;
  }

  /**
   * The scale drawings, the crosshair event and pointer events read prices
   * on: the right scale while it shows, else the first scale with an axis.
   */
  get primary(): PriceScale {
    const axes = visibleAxes(this);
    return axes.includes(this.price) ? this.price : (axes[0] ?? this.price);
  }

  /** Forget the scale `id` (not the right one), e.g. when its last series goes. */
  removeScale(id: string): void {
    this.#extra.delete(id);
    this.#transient.delete(id);
  }

  /**
   * @internal Mark scale `id` as made for a series, unless the pane has it already
   * (the right and left scales, or one the app set up): `pruneScales` then
   * drops it once no series uses it.
   */
  claimScale(id: string): void {
    if (id !== 'right' && id !== 'left' && !this.#extra.has(id)) this.#transient.add(id);
  }

  /** @internal Whether scale `id` was made for a series (see `claimScale`). */
  isClaimed(id: string): boolean {
    return this.#transient.has(id);
  }

  /** @internal Drop the claimed scales no series on the pane uses any more. */
  pruneScales(): void {
    if (this.#transient.size === 0) return;
    const used = new Set(this.series.map((s) => s.scale));
    for (const id of this.#transient) {
      const scale = this.#extra.get(id);
      if (!scale || !used.has(scale)) this.removeScale(id);
    }
  }

  /** Every named scale, `price` first, then in creation order. */
  get scales(): PriceScale[] {
    return [this.price, ...this.#extra.values()];
  }
}

/**
 * Scales of a pane whose axis shows, left ones first, each side nearest the
 * plot first. A scale with a side shows while a visible series uses it; the
 * default right scale also shows when no other scale on the pane has an axis.
 */
export function visibleAxes(pane: Pane): PriceScale[] {
  const used = new Set(pane.series.filter((s) => s.visible).map((s) => s.scale));
  const shown = pane.scales.filter((s) => s.side !== 'none' && used.has(s));
  if (shown.length === 0 && pane.price.side !== 'none') shown.push(pane.price);
  return [...shown.filter((s) => s.side === 'left'), ...shown.filter((s) => s.side !== 'left')];
}

/** Axis columns each side needs: the most axes any pane shows there, and at least one on the `keep` side. */
export function axisColumns(panes: readonly Pane[], keep: 'left' | 'right' = 'right'): { left: number; right: number } {
  let left = keep === 'left' ? 1 : 0;
  let right = keep === 'right' ? 1 : 0;
  for (const pane of panes) {
    const axes = visibleAxes(pane);
    left = Math.max(left, axes.filter((s) => s.side === 'left').length);
    right = Math.max(right, axes.filter((s) => s.side === 'right').length);
  }
  return { left, right };
}

/** Height of a collapsed pane: enough for its legend row. */
export const COLLAPSED_PANE_HEIGHT = 24;

/**
 * Pane tops and heights (css px) for `plotHeight`. A maximized pane (index,
 * or -1 for none) takes everything and the others get zero height, as hidden
 * panes always do. Collapsed
 * panes get `collapsedHeight`; the rest share what is left by `stretch`, the
 * last of them absorbing rounding.
 */
export function layoutPanes(
  panes: readonly { stretch: number; collapsed: boolean; hidden?: boolean }[],
  plotHeight: number,
  maximized = -1,
  collapsedHeight = COLLAPSED_PANE_HEIGHT,
): { top: number; height: number }[] {
  const shown = panes.map((p, i) => !p.hidden && (maximized < 0 || i === maximized));
  let flexible = panes.map((p, i) => shown[i]! && (!p.collapsed || i === maximized));
  // With everything collapsed, the last shown pane still fills the space.
  if (!flexible.some(Boolean)) flexible = shown.map((s, i) => s && i === shown.lastIndexOf(true));
  const fixed = panes.reduce((sum, _, i) => sum + (shown[i] && !flexible[i] ? collapsedHeight : 0), 0);
  const available = Math.max(0, plotHeight - fixed);
  const total = panes.reduce((sum, p, i) => sum + (flexible[i] ? p.stretch : 0), 0) || 1;
  const lastFlexible = flexible.lastIndexOf(true);
  let used = 0;
  const heights = panes.map((p, i) => {
    if (!shown[i]) return 0;
    if (!flexible[i]) return Math.min(collapsedHeight, plotHeight);
    if (i === lastFlexible) return 0; // filled in below
    const h = Math.round((p.stretch / total) * available);
    used += h;
    return h;
  });
  heights[lastFlexible] = Math.max(0, available - used);
  let top = 0;
  return heights.map((height) => {
    const slot = { top, height };
    top += height;
    return slot;
  });
}

/**
 * Move `list[from]` to `to` in place. Returns `map[oldIndex] = newIndex` for
 * everything that indexes into the list (e.g. drawings' pane indices).
 */
export function reorder<T>(list: T[], from: number, to: number): number[] {
  const before = [...list];
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
  return before.map((x) => list.indexOf(x));
}

/** `map[oldIndex] = newIndex` after removing index `removed` from `length` items; -1 for the removed one. */
export function removalMap(length: number, removed: number): number[] {
  return Array.from({ length }, (_, old) => (old === removed ? -1 : old > removed ? old - 1 : old));
}
