import type { Chart, MessageParams } from '@charton/core';
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide';
import { h, icon, inlineKey } from './dom';
import { keyOf, shellText, type ShellMessageKey } from './messages';
import {
  buildObjectTree,
  canDropNode,
  dropNode,
  moveNode,
  ObjectKeys,
  removeNodes,
  renameNode,
  setNodesLocked,
  setNodesVisible,
  type ObjectTreeNode,
  type ObjectTreePaneNode,
} from './object-tree-model';

/** Options for `createObjectTree`: its heading. */
export interface ObjectTreeOptions {
  /** Heading and accessible name. Default `Object tree`. */
  title?: string;
}

/** Returned by `createObjectTree`: the panel element, the selected rows, and `select`, `refresh` and `destroy`. */
export interface ObjectTreeHandle {
  /** Hide or show it with `el.hidden`, then call `refresh()`; it skips updates while hidden. */
  el: HTMLElement;
  /** The selected rows, in display order. */
  readonly selection: readonly ObjectTreeNode[];
  /** Select rows by key (unknown keys are skipped); the drawings among them are selected on the chart too. */
  select(keys: readonly string[]): void;
  /** Rebuild the rows now. */
  refresh(): void;
  destroy(): void;
}

/** Does `e` carry the platform's command modifier? */
const command = (e: { ctrlKey?: boolean; metaKey?: boolean }) => !!(e.ctrlKey || e.metaKey);

/** A row's kind in the chart's language: message `objectTreeKind<Kind>`. */
const kindKey = (node: ObjectTreeNode) => keyOf('objectTreeKind', node.kind);

/**
 * Panel listing the chart's panes and, in each, its series, indicators and
 * drawings (topmost drawing first). Rows show, hide, lock, rename, remove
 * and reorder their object through the public chart API, so drawing edits
 * are undo steps and everything saves with the layout like edits made on
 * the chart. Selecting drawing rows selects them on the chart, and the other
 * way round; focusing a selected indicator row selects the indicator.
 *
 * It follows the tree pattern for assistive technology: one tab stop,
 * arrow keys to move (Shift extends the selection, Ctrl/Cmd moves focus
 * only), Left/Right to collapse and expand panes, Space to toggle a row's
 * selection, Ctrl/Cmd+A for all, Enter or F2 to rename, Delete to remove,
 * H to show or hide, L to lock, Alt+Up/Down to reorder, Ctrl/Cmd+Z and
 * Ctrl/Cmd+Y (or Shift+Z) for undo and redo.
 * Requires `@charton/ui/style.css`.
 */
export function createObjectTree(host: HTMLElement, chart: Chart, options: ObjectTreeOptions = {}): ObjectTreeHandle {
  const msg = (key: ShellMessageKey, params?: MessageParams) => shellText(chart, key, params);
  const title = options.title ?? msg('objectTreeTitle');
  const keys = new ObjectKeys();
  let panes: ObjectTreePaneNode[] = [];
  /** Rows on screen: every pane, plus the children of expanded ones. */
  let rows: ObjectTreeNode[] = [];
  const folded = new Set<string>();
  let selected = new Set<string>();
  let focusKey: string | null = null;
  /** Where a Shift range starts. */
  let anchorKey: string | null = null;
  let editing: string | null = null;
  let dragKey: string | null = null;
  /** Set while the panel changes the chart's drawing selection, to ignore the echo. */
  let syncing = false;
  /** The drawings selected on the chart, as the last `drawing:select` said. */
  let chartSelected: string[] = chart.drawings.selection;
  /** A change arrived while hidden; rebuild on `refresh()`. */
  let stale = false;
  const rowEls = new Map<string, HTMLElement>();

  const tree = h('div', { class: 'pc-ot-tree', role: 'tree', 'aria-label': title, 'aria-multiselectable': 'true' });
  const bulkButton = (label: string, glyph: Parameters<typeof icon>[0], keyshortcut: string, run: () => void) => {
    const b = h('button', {
      class: 'pc-icon-btn pc-icon-btn--sm pc-icon-btn--ghost',
      'aria-label': label,
      'data-tip': label,
      'aria-keyshortcuts': keyshortcut,
    });
    b.append(icon(glyph, 15));
    b.addEventListener('click', run);
    return b;
  };
  const hideAll = bulkButton(msg('objectTreeToggleSelected'), Eye, 'H', () => toggleVisible(selectedNodes()));
  const lockAll = bulkButton(msg('objectTreeLockSelected'), Lock, 'L', () => toggleLocked(selectedNodes()));
  const removeAll = bulkButton(msg('objectTreeRemoveSelected'), Trash2, 'Delete', () => remove(selectedNodes()));
  removeAll.classList.add('pc-danger');
  const count = h('span', { class: 'pc-ot-count', 'aria-live': 'polite' });
  const el = h(
    'section',
    { class: 'pc-object-tree', role: 'region', 'aria-label': title },
    h(
      'header',
      { class: 'pc-ot-head' },
      h('span', { class: 'pc-ot-heading' }, title),
      count,
      h('span', { class: 'pc-ot-bulk', role: 'toolbar', 'aria-label': msg('objectTreeSelectedObjects') }, hideAll, lockAll, removeAll),
    ),
    tree,
  );

  const nodeOf = (key: string | null) => (key === null ? undefined : rows.find((n) => n.key === key));
  const allNodes = () => panes.flatMap((p) => [p, ...p.children]);
  const selectedNodes = () => allNodes().filter((n) => selected.has(n.key));
  const treeHasFocus = () => tree.contains(document.activeElement);

  /**
   * Select the drawings of the selected rows on the chart, the focused one
   * last so it is `selected`; with none, the focused indicator row's indicator.
   */
  const syncChart = () => {
    const ids = selectedNodes().flatMap((n) => (n.kind === 'drawing' && n.key !== focusKey ? [n.target.id] : []));
    const focused = nodeOf(focusKey);
    if (focused?.kind === 'drawing' && selected.has(focused.key)) ids.push(focused.target.id);
    const indicator = ids.length === 0 && focused?.kind === 'indicator' && selected.has(focused.key) ? focused.target : null;
    syncing = true;
    try {
      chart.setSelection(indicator ? { kind: 'indicator', indicator } : { kind: 'drawings', ids });
    } finally {
      syncing = false;
    }
  };

  /** Could the chart still select drawing `id`? False once it is removed, hidden or unselectable. */
  const selectable = (id: string) => {
    const d = chart.drawings.getById(id);
    return !!d && !d.hidden && d.selectable !== false && !chart.drawings.hiddenByInterval(id);
  };

  const render = () => {
    if (el.hidden) {
      stale = true;
      return;
    }
    stale = false;
    const hadFocus = treeHasFocus();
    panes = buildObjectTree(chart, keys);
    const known = new Set(allNodes().map((n) => n.key));
    for (const key of [...folded]) if (!known.has(key)) folded.delete(key);
    selected = new Set([...selected].filter((k) => known.has(k)));
    if (editing !== null && !known.has(editing)) editing = null;
    rows = panes.flatMap((p) => (folded.has(p.key) ? [p] : [p, ...p.children]));
    if (!rows.some((n) => n.key === focusKey)) focusKey = rows[0]?.key ?? null;
    rowEls.clear();
    tree.replaceChildren(...rows.map(rowFor));
    const n = selected.size;
    count.textContent = n > 0 ? msg('objectTreeSelectedCount', { count: n }) : '';
    const chosen = selectedNodes();
    hideAll.disabled = !chosen.some((x) => x.can.hide);
    lockAll.disabled = !chosen.some((x) => x.can.lock);
    removeAll.disabled = !chosen.some((x) => x.can.remove);
    if (hadFocus && editing === null) focusRow();
  };

  const focusRow = () => {
    const row = focusKey === null ? undefined : rowEls.get(focusKey);
    if (!row) return;
    row.focus();
    (row as { scrollIntoView?: (o: object) => void }).scrollIntoView?.({ block: 'nearest' });
  };

  const rowFor = (node: ObjectTreeNode): HTMLElement => {
    const pane = node.kind === 'pane';
    const isSelected = selected.has(node.key);
    const state = [
      !node.visible ? msg(pane ? 'objectTreeCollapsed' : 'objectTreeHidden') : '',
      node.locked ? msg('objectTreeLocked') : '',
    ].filter(Boolean);
    const name = [node.label, node.detail, ...state].filter(Boolean).join(', ');
    const row = h('div', {
      class: `pc-ot-row pc-ot-row--${node.kind}`,
      role: 'treeitem',
      'aria-level': pane ? '1' : '2',
      'aria-selected': String(isSelected),
      'aria-label': name,
      tabindex: node.key === focusKey ? '0' : '-1',
      'data-key': node.key,
      'data-selected': String(isSelected),
      'data-visible': String(node.visible),
      draggable: node.can.move ? 'true' : 'false',
    });
    if (pane) row.setAttribute('aria-expanded', String(!folded.has(node.key)));
    rowEls.set(node.key, row);

    const twisty = h('span', { class: 'pc-ot-twisty', 'aria-hidden': 'true' });
    if (pane && node.children.length > 0) {
      twisty.append(icon(folded.has(node.key) ? ChevronRight : ChevronDown, 14));
      twisty.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFold(node.key);
      });
    }
    const text =
      editing === node.key
        ? renameInput(node)
        : h(
            'span',
            { class: 'pc-ot-text' },
            h('span', { class: 'pc-ot-label' }, node.label),
            ...(node.detail ? [h('span', { class: 'pc-ot-detail' }, node.detail)] : []),
          );
    const actions = h('span', { class: 'pc-ot-actions' });
    const what = { kind: msg(kindKey(node)), name: node.label };
    if (node.can.hide) {
      const label = msg(pane ? (node.visible ? 'objectTreeCollapse' : 'objectTreeExpand') : node.visible ? 'objectTreeHide' : 'objectTreeShow', what);
      actions.append(rowButton(label, node.visible ? Eye : EyeOff, !node.visible, () => toggleVisible([node])));
    }
    if (node.can.lock) {
      actions.append(rowButton(msg(node.locked ? 'objectTreeUnlock' : 'objectTreeLock', what), node.locked ? Lock : LockOpen, node.locked, () => toggleLocked([node])));
    }
    if (node.can.remove) {
      const b = rowButton(msg('objectTreeRemove', what), Trash2, false, () => remove([node]));
      b.classList.add('pc-danger');
      actions.append(b);
    }
    row.append(twisty, text, actions);

    row.addEventListener('click', (e) => {
      if (editing === node.key) return;
      if (e.shiftKey) selectRange(node.key);
      else if (command(e)) toggleSelected(node.key);
      else selectOnly(node.key);
      focusKey = node.key;
      syncChart();
      render();
      focusRow();
    });
    row.addEventListener('dblclick', () => {
      if (pane && !node.can.rename) toggleFold(node.key);
      else startRename(node);
    });
    row.addEventListener('dragstart', (e) => {
      if (!node.can.move) return;
      dragKey = node.key;
      const dt = (e as DragEvent).dataTransfer;
      if (dt) {
        dt.effectAllowed = 'move';
        dt.setData('text/plain', node.label);
      }
    });
    row.addEventListener('dragover', (e) => {
      const dragged = nodeOf(dragKey);
      if (!dragged || !canDropNode(dragged, node)) return;
      e.preventDefault();
      row.setAttribute('data-drop', 'true');
    });
    row.addEventListener('dragleave', () => row.removeAttribute('data-drop'));
    row.addEventListener('drop', (e) => {
      const dragged = nodeOf(dragKey);
      dragKey = null;
      row.removeAttribute('data-drop');
      if (!dragged) return;
      e.preventDefault();
      focusKey = dragged.key;
      dropNode(chart, dragged, node);
      render();
    });
    row.addEventListener('dragend', () => {
      dragKey = null;
      render();
    });
    return row;
  };

  const rowButton = (label: string, glyph: Parameters<typeof icon>[0], pressed: boolean, run: () => void) => {
    // Out of the tab order: the tree is one tab stop and its keys do the same.
    const b = h('button', { class: 'pc-ot-action', tabindex: '-1', 'aria-label': label, 'data-tip': label, 'data-on': String(pressed) });
    b.append(icon(glyph, 14));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      run();
    });
    return b;
  };

  const renameInput = (node: ObjectTreeNode): HTMLInputElement => {
    const input = h('input', { class: 'pc-ot-input', type: 'text', 'aria-label': msg('objectTreeRename', { kind: msg(kindKey(node)), name: node.label }) });
    input.value = node.detail ? node.label : '';
    input.placeholder = node.label;
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      editing = null;
      if (commit) renameNode(chart, node, input.value);
      render();
      focusRow();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      else return;
      e.preventDefault();
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    return input;
  };

  const startRename = (node: ObjectTreeNode | undefined) => {
    if (!node?.can.rename) return;
    editing = node.key;
    focusKey = node.key;
    render();
    const input = rowEls.get(node.key)?.querySelector('.pc-ot-input') as HTMLInputElement | null;
    input?.focus();
    input?.select?.();
  };

  const toggleFold = (key: string) => {
    if (folded.has(key)) folded.delete(key);
    else folded.add(key);
    render();
  };

  const selectOnly = (key: string) => {
    selected = new Set([key]);
    anchorKey = key;
  };
  const toggleSelected = (key: string) => {
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    anchorKey = key;
  };
  const selectRange = (key: string) => {
    const from = rows.findIndex((n) => n.key === (anchorKey ?? focusKey));
    const to = rows.findIndex((n) => n.key === key);
    if (from < 0 || to < 0) return selectOnly(key);
    const [a, b] = from < to ? [from, to] : [to, from];
    selected = new Set(rows.slice(a, b + 1).map((n) => n.key));
  };

  /** Show the nodes when any is hidden, else hide them all. */
  const toggleVisible = (nodes: ObjectTreeNode[]) => {
    const list = nodes.filter((n) => n.can.hide);
    if (list.length > 0) setNodesVisible(chart, list, list.some((n) => !n.visible));
    render();
  };
  const toggleLocked = (nodes: ObjectTreeNode[]) => {
    const list = nodes.filter((n) => n.can.lock);
    if (list.length > 0) setNodesLocked(chart, list, list.some((n) => !n.locked));
    render();
  };
  const remove = (nodes: ObjectTreeNode[]) => {
    const list = nodes.filter((n) => n.can.remove);
    if (list.length === 0) return;
    // Keep focus near where it was: on the closest row that stays.
    const gone = new Set(list.map((n) => n.key));
    const at = rows.findIndex((n) => n.key === focusKey);
    const after = rows.slice(at + 1).find((n) => !gone.has(n.key)) ?? rows.slice(0, Math.max(0, at)).reverse().find((n) => !gone.has(n.key));
    removeNodes(chart, list);
    if (focusKey !== null && gone.has(focusKey)) focusKey = after?.key ?? null;
    render();
  };

  tree.addEventListener('keydown', (e) => {
    if (editing !== null) return;
    const at = rows.findIndex((n) => n.key === focusKey);
    const node = rows[at];
    const go = (index: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, index))];
      if (!target) return;
      if (e.shiftKey) selectRange(target.key);
      else if (!command(e)) selectOnly(target.key);
      focusKey = target.key;
      if (!command(e)) syncChart();
      render();
      focusRow();
    };
    const key = e.key.length === 1 ? e.key.toLowerCase() : inlineKey(e);
    if (e.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      if (node) moveNode(chart, node, key === 'ArrowUp' ? -1 : 1);
      render();
    } else if (key === 'ArrowDown') go(at + 1);
    else if (key === 'ArrowUp') go(at - 1);
    else if (key === 'Home') go(0);
    else if (key === 'End') go(rows.length - 1);
    else if (key === 'ArrowRight') {
      if (node?.kind !== 'pane' || node.children.length === 0) return;
      if (folded.has(node.key)) toggleFold(node.key);
      else go(at + 1);
    } else if (key === 'ArrowLeft') {
      if (node?.kind === 'pane') {
        if (!folded.has(node.key) && node.children.length > 0) toggleFold(node.key);
      } else if (node) {
        const parent = rows.findIndex((n) => n.kind === 'pane' && n.pane === node.pane);
        go(parent);
      }
    } else if (key === ' ') {
      if (!node) return;
      toggleSelected(node.key);
      syncChart();
      render();
    } else if (key === 'a' && command(e)) {
      selected = new Set(rows.map((n) => n.key));
      syncChart();
      render();
    } else if (key === 'z' && command(e)) {
      if (e.shiftKey) chart.history.redo();
      else chart.history.undo();
    } else if (key === 'y' && command(e)) chart.history.redo();
    else if (key === 'Enter' || key === 'F2') startRename(node);
    else if (key === 'Delete' || key === 'Backspace') remove(targets(node));
    else if (key === 'h' && !command(e)) toggleVisible(targets(node));
    else if (key === 'l' && !command(e)) toggleLocked(targets(node));
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  /** The selection, or the focused row when nothing is selected. */
  const targets = (node: ObjectTreeNode | undefined): ObjectTreeNode[] => {
    const chosen = selectedNodes();
    return chosen.length > 0 ? chosen : node ? [node] : [];
  };

  const offs = [
    chart.on('drawings:change', render),
    chart.on('drawing:select', ({ id, ids }) => {
      const previous = chartSelected;
      chartSelected = ids;
      if (syncing) return;
      if (ids.some((x) => !previous.includes(x))) {
        // Drawings were picked on the chart: their rows become the selection.
        selected = new Set(ids.map((x) => `drawing:${x}`));
        anchorKey = id === null ? null : `drawing:${id}`;
        focusKey = anchorKey;
        for (const x of ids) {
          const pane = chart.drawings.getById(x)?.pane;
          const paneId = pane === undefined ? undefined : chart.panes[pane]?.id;
          if (paneId !== undefined) folded.delete(`pane:${paneId}`);
        }
      } else {
        // Drawings left the chart's selection. Hiding or removing them does
        // that too; keep their rows selected then, so bulk edits can go on.
        const dropped = new Set(previous.filter((x) => !ids.includes(x) && selectable(x)).map((x) => `drawing:${x}`));
        selected = new Set([...selected].filter((k) => !dropped.has(k)));
      }
      render();
    }),
    chart.on('series:add', render),
    chart.on('series:remove', render),
    chart.on('series:visibility', render),
    chart.on('series:options', render),
    chart.on('indicator:add', render),
    chart.on('indicator:remove', render),
    chart.on('indicator:change', render),
    chart.on('panes:change', render),
  ];

  host.append(el);
  render();

  return {
    el,
    get selection() {
      return selectedNodes();
    },
    select(list) {
      const known = new Set(allNodes().map((n) => n.key));
      const keep = list.filter((k) => known.has(k));
      selected = new Set(keep);
      anchorKey = keep[0] ?? null;
      const drawing = keep.find((k) => k.startsWith('drawing:'));
      if (keep[0] !== undefined) focusKey = drawing ?? keep[0];
      syncChart();
      render();
    },
    refresh: render,
    destroy() {
      offs.forEach((off) => off());
      el.remove();
    },
  };
}
