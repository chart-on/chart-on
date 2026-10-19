import type { Chart } from '@chart-on/core';
import { Check, Command } from 'lucide';
import { commandScore, rankCommands, type CommandEntry, type CommandSource } from './command-palette-model';
import { h, icon } from './dom';
import { labelOf, shellText } from './messages';
import { createPickerDialog, type PickerDialog } from './picker-dialog';
import type { PickerItem, PickerPage, PickerRequest } from './picker-model';
import { bindShellShortcut, shortcutText } from './shortcuts';
import type { ToolbarItem } from './toolbar';
import { devCheck } from './options-schema';

/** The action id that opens the command palette. */
export const COMMAND_PALETTE = 'command-palette';

/** The source id of the palette's built-in `chart.actions` list. */
export const ACTIONS_SOURCE = 'actions';

/** Options for `createCommandPalette`: entry sources, which `chart.actions` to list, its shortcut and where it is heard, search debounce, and an open/close callback. */
export interface CommandPaletteOptions {
  /** More entries, e.g. symbols or indicators; add or remove them later with `addSource`. */
  sources?: readonly CommandSource[];
  /** List the commands on `chart.actions` under Actions. Default true. */
  actions?: boolean;
  /** Ids of actions to leave out of the list. The palette's own action is never listed. */
  hiddenActions?: readonly string[];
  /**
   * Default shortcuts of the `command-palette` action. Default `['Mod+K']`.
   * Users and apps rebind it like any action, with `chart.actions.setKeys` or the keymap.
   */
  keys?: readonly string[];
  /**
   * Where the shortcut is heard besides the focused chart: `'shell'`
   * (default) anywhere in `host`, `'document'` anywhere on the page.
   */
  shortcutScope?: 'shell' | 'document';
  /** Wait this long after the last keystroke before asking the sources, in ms. Default 0. */
  debounce?: number;
  /** Called after the palette opened or closed, e.g. to refresh a toolbar button's pressed state. */
  onOpenChange?(open: boolean): void;
}

/** The command palette made by `createCommandPalette`: open or close it, add entry sources, and turn it on or off. */
export interface CommandPalette {
  readonly isOpen: boolean;
  /** False while turned off (the shell's `commandPalette` feature flag): it does not open, and its shortcut is free. */
  readonly enabled: boolean;
  /** Open with `query` in the search box (empty by default); with the palette open, search for `query`. */
  open(query?: string): void;
  /** Close and give focus back to where it was before opening. */
  close(): void;
  /** Add a source of entries. Throws when its id is taken. Returns a function that removes it. */
  addSource(source: CommandSource): () => void;
  /** Turn the palette on or off; turning it off closes it. */
  setEnabled(on: boolean): void;
  destroy(): void;
}

/** A row of the palette's list: the entry with the source it came from. */
interface CommandRow extends PickerItem {
  entry: CommandEntry;
  /** Its source's category name, shown at the end of the row under All. */
  source: string;
}

/** Sorted after a matching entry of the same quality when a ranked source's entry does not match the query as text. */
const UNSCORED = 4.5;

const handles = new WeakMap<Chart, CommandPalette>();

/** The command palette created for `chart`, if any. */
export function commandPaletteOf(chart: Chart): CommandPalette | undefined {
  return handles.get(chart);
}

const isEntry = (e: unknown): e is CommandEntry => {
  const entry = e as CommandEntry | null;
  return !!entry && typeof entry.id === 'string' && typeof entry.label === 'string' && typeof entry.run === 'function';
};

/**
 * A searchable list of everything the chart can do: the commands on
 * `chart.actions` with their shortcuts and on/off state, plus entries from
 * app sources. Opened by the `command-palette` action (Mod+K by default), in
 * `host` (the shell element) so it picks up the theme.
 */
export function createCommandPalette(chart: Chart, host: HTMLElement, options: CommandPaletteOptions = {}): CommandPalette {
  const sources: CommandSource[] = [];
  const hidden = new Set([COMMAND_PALETTE, ...(options.hiddenActions ?? [])]);
  let dialog: PickerDialog | null = null;
  let enabled = true;
  /** Rows for the current query and category, kept so later pages slice them instead of asking the sources again. */
  let cache: { key: string; rows: Promise<CommandRow[]> } | null = null;

  const actionSource: CommandSource = {
    id: ACTIONS_SOURCE,
    get label() {
      return shellText(chart, 'paletteActions');
    },
    entries: () =>
      chart.actions
        .list()
        .filter((a) => !hidden.has(a.id))
        .map((a) => ({
          id: a.id,
          label: a.label,
          keywords: [a.id],
          ...(a.keys[0] ? { shortcut: a.keys[0] } : {}),
          ...(a.checked !== null ? { checked: a.checked } : {}),
          disabled: !a.enabled,
          run: () => void chart.actions.run(a.id),
        })),
  };
  const allSources = () => (options.actions === false ? [...sources] : [actionSource, ...sources]);

  /** Every source's matching entries, best first across sources: enabled before disabled, then by score. */
  async function collect(query: string, category: string | undefined, signal: AbortSignal): Promise<CommandRow[]> {
    const list = allSources().filter((s) => category === undefined || s.id === category);
    const groups = await Promise.all(
      list.map(async (source) => {
        let found: readonly CommandEntry[];
        try {
          found = await source.entries(query, signal);
        } catch {
          // One failing source leaves the others listed.
          return [];
        }
        const valid = Array.isArray(found) ? found.filter(isEntry) : [];
        const ordered = source.ranked ? valid : rankCommands(valid, query);
        // Scores never fall along a source's list, so merging the sources keeps each one's own order.
        let floor = 0;
        return ordered.map((entry) => {
          floor = Math.max(floor, commandScore(entry, query) ?? UNSCORED);
          return { source, entry, score: floor };
        });
      }),
    );
    const scored = groups.flat();
    const off = (e: CommandEntry) => (e.disabled ? 1 : 0);
    // The sort is stable: equal rows keep their order.
    if (query.trim()) scored.sort((a, b) => off(a.entry) - off(b.entry) || a.score - b.score);
    return scored.map(({ source, entry }) => ({
      id: `${source.id}:${entry.id}`,
      label: entry.label,
      ...(entry.description ? { description: entry.description } : {}),
      category: source.id,
      ...(entry.disabled ? { disabled: true } : {}),
      entry,
      source: source.label,
    }));
  }

  async function fetchPage(query: string, request: PickerRequest): Promise<PickerPage<CommandRow>> {
    const key = `${query}\n${request.category ?? ''}`;
    if (request.page === 0 || cache?.key !== key) cache = { key, rows: collect(query, request.category, request.signal) };
    const rows = await cache.rows;
    const start = request.page * request.pageSize;
    return { items: rows.slice(start, start + request.pageSize), hasMore: rows.length > start + request.pageSize };
  }

  function rowEnd(row: CommandRow): Node | null {
    const { entry } = row;
    const parts: Node[] = [];
    if (entry.checked !== undefined) {
      parts.push(
        h(
          'span',
          { class: 'pc-command-state', 'data-checked': String(entry.checked) },
          ...(entry.checked ? [icon(Check, 14)] : []),
          h('span', { class: 'pc-sr-only' }, shellText(chart, entry.checked ? 'paletteOn' : 'paletteOff')),
        ),
      );
    }
    if (entry.shortcut) parts.push(h('kbd', { class: 'pc-command-key' }, shortcutText(entry.shortcut)));
    // Under All, where rows of every source mix; the stylesheet hides it in a category.
    if (allSources().length > 1) parts.push(h('span', { class: 'pc-command-source' }, row.source));
    return parts.length > 0 ? h('span', { class: 'pc-command-end' }, ...parts) : null;
  }

  function open(query = ''): void {
    if (!enabled) return;
    if (dialog?.isOpen) {
      dialog.search(query);
      return;
    }
    cache = null;
    const list = allSources();
    const many = list.length > 1;
    dialog = createPickerDialog<CommandRow>(
      host,
      {
        title: shellText(chart, 'paletteTitle'),
        className: 'pc-command-palette',
        layout: 'palette',
        source: { fetch: fetchPage },
        // One source needs no categories.
        ...(many ? { categories: list.map((s) => ({ id: s.id, label: s.label })) } : {}),
        allLabel: many ? shellText(chart, 'paletteAll') : false,
        debounce: options.debounce ?? 0,
        placeholder: shellText(chart, 'palettePlaceholder'),
        searchLabel: shellText(chart, 'paletteSearchLabel'),
        emptyText: shellText(chart, 'paletteEmpty'),
        // Only the search box until something is typed.
        listOnQuery: true,
        rowEnd,
      },
      {
        // The picker closed and gave focus back first, so a command that moves focus keeps it.
        onSelect: ([row]) => row?.entry.run(),
        onClose: () => {
          dialog = null;
          cache = null;
          options.onOpenChange?.(false);
        },
      },
      { localization: chart.localization },
    );
    if (query) dialog.search(query);
    options.onOpenChange?.(true);
  }

  const unregister = chart.actions.has(COMMAND_PALETTE)
    ? () => {}
    : chart.actions.register({
        id: COMMAND_PALETTE,
        label: () => shellText(chart, 'actionCommandPalette'),
        keys: options.keys ?? ['Mod+K'],
        enabled: () => enabled && !dialog,
        run: () => open(),
      });
  const offKeys = bindShellShortcut(chart, options.shortcutScope === 'document' ? document : host, COMMAND_PALETTE);

  const handle: CommandPalette = {
    get isOpen() {
      return dialog?.isOpen ?? false;
    },
    get enabled() {
      return enabled;
    },
    open,
    close: () => dialog?.close(),
    addSource(source) {
      if (source.id === ACTIONS_SOURCE || sources.some((s) => s.id === source.id)) {
        throw new RangeError(`Command source already added: ${source.id}`);
      }
      sources.push(source);
      return () => {
        const at = sources.indexOf(source);
        if (at >= 0) sources.splice(at, 1);
      };
    },
    setEnabled(on) {
      enabled = on;
      if (!on) dialog?.close();
    },
    destroy() {
      dialog?.close();
      offKeys();
      unregister();
      if (handles.get(chart) === handle) handles.delete(chart);
    },
  };
  for (const source of options.sources ?? []) handle.addSource(source);
  handles.set(chart, handle);
  return handle;
}

/** Toolbar button that opens the command palette of the chart it acts on; in the `view` group. */
export function commandPaletteToolbarItem(): ToolbarItem {
  return {
    type: 'button',
    id: 'command-palette',
    group: 'view',
    ...labelOf('actionCommandPalette'),
    icon: Command,
    onClick: (chart) => commandPaletteOf(chart)?.open(),
    isActive: (chart) => commandPaletteOf(chart)?.isOpen ?? false,
    isDisabled: (chart) => !(commandPaletteOf(chart)?.enabled ?? false),
  };
}

/**
 * The shell's `commandPalette` part, made by `commandPalette(options)`. The
 * shell calls it with its chart, its element and a callback for when the
 * palette opens or closes.
 */
export type CommandPalettePart = (chart: Chart, host: HTMLElement, onOpenChange: (open: boolean) => void) => CommandPalette;

/**
 * The command palette for the shell's `commandPalette` option. It takes Mod+K
 * (the symbol search keeps `/`) and lists the indicator picker's indicators.
 * Without it `commandPaletteToolbarItem()` is disabled.
 */
export function commandPalette(options: CommandPaletteOptions = {}): CommandPalettePart {
  devCheck('commandPalette', options, 'commandPalette');
  return (chart, host, onOpenChange) =>
    createCommandPalette(chart, host, {
      ...options,
      onOpenChange: (open) => {
        onOpenChange(open);
        options.onOpenChange?.(open);
      },
    });
}
