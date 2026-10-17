import type { Chart } from '@charton/core';
import { Table, X } from 'lucide';
import { iconButton } from './controls';
import { h, holdPanelInput } from './dom';
import { labelOf, shellText } from './messages';
import type { ToolbarItem } from './toolbar';

/** Options for `createTableView`: the most rows shown, the panel's heading and container, and an open/close callback. */
export interface TableViewOptions {
  /** Newest rows shown; the table caption says how many were left out. Default 500. */
  maxRows?: number;
  /** Heading and accessible name of the panel. Default `Data table`. */
  title?: string;
  /** Element the panel opens in. Default the chart's root. */
  container?: HTMLElement;
  /** Called when the panel opens or closes, e.g. to refresh a toolbar button's pressed state. */
  onOpenChange?(open: boolean): void;
}

/** Returned by `createTableView`: opens, closes or toggles the data table panel, and rebuilds it with `refresh`. */
export interface TableViewHandle {
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
  /** Rebuild the table now, e.g. after a data change the chart emits no event for. */
  refresh(): void;
  destroy(): void;
}

const DEFAULT_MAX_ROWS = 500;
/** Shortest time between two rebuilds while the view pans or bars stream in, ms. */
const REBUILD_MS = 250;
/** Chart events after which the visible rows may differ. */
const FOLLOW = ['view:change', 'data:loaded', 'data:bar', 'series:add', 'series:options', 'timezone:change'] as const;

const handles = new WeakMap<Chart, TableViewHandle>();

/** The table view created for `chart`, if any. */
export function tableViewOf(chart: Chart): TableViewHandle | undefined {
  return handles.get(chart);
}

/**
 * The top-bar button that shows the visible data as a table (`view` group,
 * see `roadmap/toolbar-layout.md`). It acts on the table view of its chart;
 * the shell creates one unless `tableView: false`.
 */
export function tableViewToolbarItem(): ToolbarItem {
  return {
    type: 'button',
    id: 'table-view',
    ...labelOf('toolbarTableView'),
    icon: Table,
    group: 'view',
    priority: 2,
    onClick: (chart) => tableViewOf(chart)?.toggle(),
    isActive: (chart) => tableViewOf(chart)?.isOpen ?? false,
  };
}

/**
 * A panel with the chart's visible data as a semantic table
 * (`chart.describeTable`): a caption, column and row headers, values in each
 * series' own format. It follows the view as it pans, zooms and gets new bars,
 * and changes only the rows that differ, so a screen reader keeps its place.
 * Opening it moves focus to the table; Escape or the close button closes it
 * and returns focus. Requires `@charton/ui/style.css`.
 */
export function createTableView(chart: Chart, options: TableViewOptions = {}): TableViewHandle {
  let panel: Panel | null = null;
  const handle: TableViewHandle = {
    open() {
      if (panel) return;
      panel = createPanel(chart, options, () => {
        panel = null;
        options.onOpenChange?.(false);
      });
      options.onOpenChange?.(true);
    },
    close() {
      panel?.close();
    },
    toggle() {
      if (panel) panel.close();
      else handle.open();
    },
    get isOpen() {
      return panel !== null;
    },
    refresh() {
      panel?.rebuild();
    },
    destroy() {
      panel?.close();
      handles.delete(chart);
    },
  };
  handles.set(chart, handle);
  return handle;
}

interface Panel {
  rebuild(): void;
  close(): void;
}

let nextId = 0;

function createPanel(chart: Chart, options: TableViewOptions, onClose: () => void): Panel {
  const title = options.title ?? 'Data table';
  const headingId = `pc-table-view-${++nextId}`;
  const table = h('table', { class: 'pc-table-view-table' });
  // Focusable, so keyboard users can scroll it; named by the heading for screen readers.
  const body = h('div', { class: 'pc-table-view-body', role: 'region', 'aria-labelledby': headingId, tabindex: '0' }, table);
  const el = h('div', { class: 'pc-table-view', role: 'dialog', 'aria-labelledby': headingId });
  const previous = document.activeElement as HTMLElement | null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const rebuild = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    syncTable(table, chart.describeTable({ maxRows: options.maxRows ?? DEFAULT_MAX_ROWS }));
  };
  const schedule = () => {
    timer ??= setTimeout(rebuild, REBUILD_MS);
  };
  const offs = FOLLOW.map((event) => chart.on(event, schedule));

  const close = () => {
    const hadFocus = el.contains(document.activeElement);
    if (timer) clearTimeout(timer);
    offs.forEach((off) => off());
    el.remove();
    onClose();
    if (hadFocus) (previous && previous.isConnected !== false ? previous : chart.root).focus();
  };

  el.append(
    h('div', { class: 'pc-table-view-head' }, h('h2', { id: headingId }, title), iconButton({ icon: X, label: shellText(chart, 'dialogClose'), variant: 'ghost', onClick: close })),
    body,
  );
  holdPanelInput(el, (e) => {
    e.preventDefault();
    close();
  });
  rebuild();
  (options.container ?? chart.root).append(el);
  body.focus();
  return { rebuild, close };
}

const cellsOf = (el: Element): Element[] => Array.from(el.children);
/** A row's cells as one string, for comparing rows without reading layout. */
const rowText = (row: Element) => cellsOf(row).map((cell) => cell.textContent).join('\t');

/**
 * Make `table` show what `next` shows, replacing only the caption, header and
 * rows that changed: a live tick changes one row, not the whole table.
 */
function syncTable(table: HTMLTableElement, next: HTMLTableElement): void {
  const [caption, head, rows] = cellsOf(next) as [HTMLElement, HTMLElement, HTMLElement];
  const current = cellsOf(table) as HTMLElement[];
  if (current.length !== 3) {
    table.replaceChildren(caption, head, rows);
    return;
  }
  const [oldCaption, oldHead, oldRows] = current as [HTMLElement, HTMLElement, HTMLElement];
  if (oldCaption.textContent !== caption.textContent) oldCaption.textContent = caption.textContent;
  const headRow = cellsOf(head)[0];
  const oldHeadRow = cellsOf(oldHead)[0];
  if (!headRow || !oldHeadRow || rowText(headRow) !== rowText(oldHeadRow)) {
    table.insertBefore(head, oldHead);
    oldHead.remove();
  }
  const fresh = cellsOf(rows);
  const old = cellsOf(oldRows);
  fresh.forEach((row, i) => {
    const prev = old[i];
    if (!prev) oldRows.append(row);
    else if (rowText(prev) !== rowText(row)) {
      oldRows.insertBefore(row, prev);
      prev.remove();
    }
  });
  old.slice(fresh.length).forEach((row) => row.remove());
}
