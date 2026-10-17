import type { ToolbarItem } from './toolbar';

/**
 * Internal: what a bar's customization asks of the other bar's once the shell
 * links them, so users can move items between the toolbar and the bottom bar.
 * Kept apart from the customization code, so a shell without it stays small.
 */
export interface ToolbarPeer {
  /** Whether this bar's saved layout shows the item. */
  holds(id: string): boolean;
  /** This bar's own actions: its defaults and registered actions. */
  entries(): ToolbarItem[];
  /** Show `item` in this bar, beside its group. */
  receive(item: ToolbarItem): void;
  /** Stop showing the item in this bar. */
  release(id: string): void;
  /** The other bar changed: show what this bar still has. */
  refresh(): void;
}

/** A customization's side of a link: its peer hooks, and how it takes the other bar's. */
export interface ToolbarLinkEnd {
  self: ToolbarPeer;
  /** Link to `peer`; `toBottom` says whether items move down to the bottom bar or up to the toolbar. */
  link(peer: ToolbarPeer, toBottom: boolean): void;
}

/** Link ends by customization controller. */
export const linkEnds = new WeakMap<object, ToolbarLinkEnd>();

/** Let users move items between the toolbar's customization (`top`) and the bottom bar's. */
export function linkToolbarCustomizations(top: object | null, bottom: object | null): void {
  const a = top && linkEnds.get(top);
  const b = bottom && linkEnds.get(bottom);
  if (!a || !b) return;
  a.link(b.self, true);
  b.link(a.self, false);
}
