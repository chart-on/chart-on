import type { Chart, Drawing, Indicator, Pane, Series } from '@chart-on/core';
import { keyOf, shellText } from './messages';

/** What a row of the object tree stands for. */
export type ObjectTreeKind = 'pane' | 'series' | 'indicator' | 'drawing';

/** Row actions an object supports. */
export interface ObjectTreeAbilities {
  hide: boolean;
  lock: boolean;
  rename: boolean;
  remove: boolean;
  /** Reorder by dragging or with Alt+arrow keys. */
  move: boolean;
}

/** The fields every object tree node has. */
export interface ObjectTreeNodeBase {
  /** Stable while the object is on the chart, e.g. `drawing:<id>` or `pane:<id>`. */
  key: string;
  label: string;
  /** What the object is when `label` is a user name, e.g. the tool or series type. */
  detail: string;
  visible: boolean;
  locked: boolean;
  /** Index of the pane the object is in. */
  pane: number;
  can: ObjectTreeAbilities;
}

/** An object tree row for a pane, holding the rows of the objects in it. */
export interface ObjectTreePaneNode extends ObjectTreeNodeBase {
  kind: 'pane';
  target: Pane;
  /** Series, then indicators, then drawings (topmost first). */
  children: ObjectTreeNode[];
}
/** An object tree row for a series. */
export interface ObjectTreeSeriesNode extends ObjectTreeNodeBase {
  kind: 'series';
  target: Series;
}
/** An object tree row for an indicator. */
export interface ObjectTreeIndicatorNode extends ObjectTreeNodeBase {
  kind: 'indicator';
  target: Indicator;
}
/** An object tree row for a drawing. */
export interface ObjectTreeDrawingNode extends ObjectTreeNodeBase {
  kind: 'drawing';
  target: Drawing;
}

/** A row of the object tree: a pane, series, indicator or drawing, told apart by `kind`, with the object itself in `target`. */
export type ObjectTreeNode = ObjectTreePaneNode | ObjectTreeSeriesNode | ObjectTreeIndicatorNode | ObjectTreeDrawingNode;

/** Series kinds with a name of their own: message `seriesKind<Kind>`. */
const SERIES_KINDS = ['candles', 'histogram', 'line', 'heatmap', 'indicator', 'custom', 'volumeProfile', 'points'];

/** Hands out stable keys for objects without an id (series and indicators). */
export class ObjectKeys {
  readonly #keys = new WeakMap<object, string>();
  #next = 1;

  of(prefix: string, target: object): string {
    let key = this.#keys.get(target);
    if (!key) this.#keys.set(target, (key = `${prefix}:${this.#next++}`));
    return key;
  }
}

const none: ObjectTreeAbilities = { hide: false, lock: false, rename: false, remove: false, move: false };

/** One line of text: the first line, trimmed and cut to `max` characters. */
function oneLine(text: string, max = 40): string {
  const line = text.split('\n')[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * The chart's objects as a tree: one node per pane, holding its series, its
 * indicators and its drawings, topmost drawing first. Built from the public
 * chart API only.
 */
export function buildObjectTree(chart: Chart, keys = new ObjectKeys()): ObjectTreePaneNode[] {
  const indicators = chart.indicators.getAll();
  const plotted = new Set<Series>();
  for (const ind of indicators) if (ind.series) plotted.add(ind.series);
  const drawings = chart.drawings.getAll();
  return chart.panes.map((pane, index): ObjectTreePaneNode => {
    const children: ObjectTreeNode[] = [];
    for (const series of pane.series) {
      if (plotted.has(series)) continue;
      const kind = SERIES_KINDS.includes(series.kind) ? shellText(chart, keyOf('seriesKind', series.kind)) : series.kind;
      const title = (series.options as { title?: string }).title ?? '';
      const main = series === chart.main;
      children.push({
        kind: 'series',
        key: keys.of('series', series),
        target: series,
        label: title || kind,
        detail: title ? kind : '',
        visible: series.visible,
        locked: false,
        pane: index,
        can: { ...none, hide: true, rename: true, remove: !main, move: !main },
      });
    }
    for (const indicator of indicators) {
      if (indicator.pane !== pane) continue;
      const name = chart.localization.text(`indicator.${indicator.type}`, undefined, indicator.def?.name ?? indicator.type);
      children.push({
        kind: 'indicator',
        key: keys.of('indicator', indicator),
        target: indicator,
        label: indicator.series?.options.title || name,
        detail: '',
        visible: indicator.visible,
        locked: false,
        pane: index,
        can: { ...none, hide: true, remove: true },
      });
    }
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i]!;
      if (d.pane !== index) continue;
      const tool = chart.drawings.toolLabel(d.type);
      const own = d.name || (d.text ? oneLine(d.text) : '');
      children.push({
        kind: 'drawing',
        key: `drawing:${d.id}`,
        target: d,
        label: own || tool,
        detail: own ? tool : '',
        visible: !d.hidden,
        locked: !!d.locked,
        pane: index,
        can: { hide: true, lock: true, rename: true, remove: true, move: true },
      });
    }
    return {
      kind: 'pane',
      key: `pane:${pane.id}`,
      target: pane,
      label: index === 0 ? shellText(chart, 'objectTreeMainPane') : shellText(chart, 'paneNumber', { number: index + 1 }),
      detail: '',
      // A collapsed pane counts as hidden: only its header strip shows.
      visible: !pane.collapsed,
      locked: false,
      pane: index,
      can: { ...none, hide: index > 0 || chart.panes.length > 1, remove: index > 0, move: index > 0 },
      children,
    };
  });
}

/** Every node, depth first, in display order. */
export function flattenTree(panes: readonly ObjectTreePaneNode[]): ObjectTreeNode[] {
  return panes.flatMap((p) => [p, ...p.children]);
}

const isDrawing = (n: ObjectTreeNode): n is ObjectTreeDrawingNode => n.kind === 'drawing';

/** Run `fn` with the drawing changes it makes recorded as one undo step. */
function inBatch(chart: Chart, nodes: readonly ObjectTreeNode[], fn: () => void): void {
  if (nodes.some(isDrawing)) chart.drawings.batch(fn);
  else fn();
}

/** Show or hide every node that can be hidden; drawing changes are one undo step. */
export function setNodesVisible(chart: Chart, nodes: readonly ObjectTreeNode[], visible: boolean): void {
  inBatch(chart, nodes, () => {
    for (const n of nodes) {
      if (!n.can.hide) continue;
      if (n.kind === 'drawing') chart.drawings.setVisible(n.target.id, visible);
      else if (n.kind === 'series') n.target.setVisible(visible);
      else if (n.kind === 'indicator') n.target.setVisible(visible);
      else if (chart.panes.includes(n.target)) chart.setPaneCollapsed(n.target, !visible);
    }
  });
}

/** Lock or unlock every lockable node (drawings), as one undo step. */
export function setNodesLocked(chart: Chart, nodes: readonly ObjectTreeNode[], locked: boolean): void {
  inBatch(chart, nodes, () => {
    for (const n of nodes) if (n.kind === 'drawing') chart.drawings.update(n.target.id, { locked });
  });
}

/**
 * Remove every removable node. Drawings go first, as one undo step, then
 * series and indicators, then panes; the main series and main pane stay.
 */
export function removeNodes(chart: Chart, nodes: readonly ObjectTreeNode[]): void {
  const removable = nodes.filter((n) => n.can.remove);
  const drawings = removable.filter(isDrawing);
  if (drawings.length > 0) chart.drawings.batch(() => drawings.forEach((n) => chart.drawings.remove(n.target.id)));
  for (const n of removable) {
    if (n.kind === 'series' && chart.panes.some((p) => p.series.includes(n.target))) chart.removeSeries(n.target);
    else if (n.kind === 'indicator' && chart.indicators.getAll().includes(n.target)) n.target.remove();
  }
  for (const n of removable) if (n.kind === 'pane' && chart.panes.indexOf(n.target) > 0) chart.removePane(n.target);
}

/** Rename a drawing or series; an empty name returns to the default label. */
export function renameNode(chart: Chart, node: ObjectTreeNode, name: string): void {
  if (!node.can.rename) return;
  const value = name.trim();
  if (node.kind === 'drawing') chart.drawings.update(node.target.id, { name: value });
  else if (node.kind === 'series') node.target.applyOptions({ title: value } as never);
}

/**
 * Move a node `by` rows in its list (negative is up). Drawings change their
 * z-order within the pane (up is towards the top), panes their position
 * below the main pane, and series move to the pane above or below. Returns
 * whether anything moved.
 */
export function moveNode(chart: Chart, node: ObjectTreeNode, by: number): boolean {
  if (!node.can.move || by === 0) return false;
  if (node.kind === 'pane') {
    const from = chart.panes.indexOf(node.target);
    const to = Math.max(1, Math.min(chart.panes.length - 1, from + by));
    if (from < 1 || to === from) return false;
    chart.movePane(node.target, to);
    return true;
  }
  if (node.kind === 'series') {
    const dest = chart.panes[node.pane + Math.sign(by)];
    if (!dest) return false;
    chart.moveSeries(node.target, dest);
    return true;
  }
  if (node.kind === 'drawing') {
    const own = chart.drawings.getAll().filter((d) => d.pane === node.pane);
    const from = own.findIndex((d) => d.id === node.target.id);
    // Rows list the topmost drawing first, so moving up the list raises it.
    const to = Math.max(0, Math.min(own.length - 1, from - by));
    if (from < 0 || to === from) return false;
    chart.drawings.moveTo(node.target.id, to);
    return true;
  }
  return false;
}

/** Whether `dropNode(chart, node, target)` would move something. */
export function canDropNode(node: ObjectTreeNode, target: ObjectTreeNode): boolean {
  if (!node.can.move || node.key === target.key) return false;
  if (node.kind === 'drawing') return target.kind === 'drawing' && target.pane === node.pane;
  if (node.kind === 'pane') return target.kind === 'pane' && target.pane > 0;
  return node.kind === 'series' && target.pane !== node.pane;
}

/**
 * Drop `node` on `target`: a drawing takes the place of another drawing of
 * its pane, a pane the place of another pane, and a series moves into the
 * pane of the row it lands on. Returns whether anything moved.
 */
export function dropNode(chart: Chart, node: ObjectTreeNode, target: ObjectTreeNode): boolean {
  if (!canDropNode(node, target)) return false;
  if (node.kind === 'drawing' && target.kind === 'drawing') {
    const own = chart.drawings.getAll().filter((d) => d.pane === node.pane);
    const to = own.findIndex((d) => d.id === target.target.id);
    if (to < 0) return false;
    chart.drawings.moveTo(node.target.id, to);
    return true;
  }
  if (node.kind === 'pane' && target.kind === 'pane') {
    const to = chart.panes.indexOf(target.target);
    if (to < 1) return false;
    chart.movePane(node.target, to);
    return true;
  }
  if (node.kind === 'series') {
    const dest = chart.panes[target.pane];
    if (!dest) return false;
    chart.moveSeries(node.target, dest);
    return true;
  }
  return false;
}
