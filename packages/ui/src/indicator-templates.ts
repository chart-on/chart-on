import {
  createLocalStorageAdapter,
  INDICATOR_SET_VERSION,
  isInterval,
  type Chart,
  type IndicatorSet,
  type IndicatorSetSkip,
  type IntervalRange,
  type NotificationKind,
  type StorageAdapter,
} from '@chart-on/core';
import { LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide';
import { confirmDialog, findIn } from './dialog';
import type { FormDialog } from './form-dialog';
import { keyedText, keyOf, labelOf, shellText, type ShellMessageKey } from './messages';
import { createPickerDialog, type PickerDialog } from './picker-dialog';
import { inCategory, rankItems, type PickerItem } from './picker-model';
import { askTemplateName, templateNameTaken } from './template-name';
import type { ToolbarItem } from './toolbar';

/** A named indicator set: a built-in preset or one of a registered collection. */
export interface IndicatorTemplate {
  name: string;
  /** Message key for `name`, so it follows the chart's language (see `ToolbarItem.labelKey`). */
  nameKey?: ShellMessageKey | (string & {});
  /** What `chart.indicators.serializeSet()` returns; validated when applied. */
  set: IndicatorSet;
}

/** Options for `registerIndicatorTemplates`. */
export interface IndicatorTemplateCollectionOptions {
  /** Sidebar category the templates are listed under, e.g. the collection's name. */
  category: string;
}

/** Options for `createIndicatorTemplates`, and the shell's `indicatorTemplates` option. */
export interface IndicatorTemplatesOptions {
  /**
   * Where "My templates" are kept: the `'indicator-set'` templates of a storage
   * adapter. Default `createLocalStorageAdapter()`; `null` lists none and turns
   * saving off.
   */
  storage?: StorageAdapter | null;
  /** Read-only templates listed under Technicals. Default `indicatorTemplatePresets`. */
  presets?: readonly IndicatorTemplate[];
  /** Element the dialogs cover. Default the shell around the chart, else the chart's root. */
  container?: HTMLElement;
}

/** Saves the chart's indicators as a template and opens the template dialog. */
export interface IndicatorTemplatesHandle {
  /** Whether the template dialog is open. */
  readonly isOpen: boolean;
  /** Open the template dialog. */
  open(): void;
  /** Ask for a name, then save the chart's indicators under it. */
  save(): void;
  close(): void;
  destroy(): void;
}

/** A preset: its name (message key `templates<name>`) and its indicators as type, pane and inputs. */
const preset = (name: string, indicators: [type: string, pane: number, inputs?: Record<string, number>][]): IndicatorTemplate => ({
  name,
  nameKey: `templates${name}`,
  set: {
    version: INDICATOR_SET_VERSION,
    indicators: indicators.map(([type, pane, inputs = {}]) => ({ type, inputs, pane, visible: true })),
  },
});

/** The built-in presets, made of indicators from `@chart-on/indicators`. */
export const indicatorTemplatePresets: readonly IndicatorTemplate[] = [
  preset('Trend', [['sma', 0, { length: 20 }], ['sma', 0, { length: 50 }], ['dmi', 1]]),
  preset('Momentum', [['rsi', 1], ['macd', 2]]),
  preset('Volatility', [['bbands', 0], ['atr', 1]]),
  preset('Volume', [['volume-ma', 1], ['obv', 2]]),
];

/** Message key of a skip reason: `templatesSkipUnknown` for `unknown`, and so on. */
const skipKey = (reason: IndicatorSetSkip) => keyOf('templatesSkip', reason);

const KIND = 'indicator-set';
const collections = new WeakMap<Chart, { templates: readonly IndicatorTemplate[]; category: string }[]>();
/** Each chart's handle, with `reload` to list its collections again when they change. */
const handles = new WeakMap<Chart, { handle: IndicatorTemplatesHandle; reload(): void }>();

/**
 * List a collection of templates in the template dialogs of `chart`, under
 * their own sidebar category. Returns a function that removes them again.
 */
export function registerIndicatorTemplates(
  chart: Chart,
  templates: readonly IndicatorTemplate[],
  options: IndicatorTemplateCollectionOptions,
): () => void {
  const entry = { templates, category: options.category };
  const list = collections.get(chart) ?? [];
  collections.set(chart, [...list, entry]);
  handles.get(chart)?.reload();
  return () => {
    collections.set(chart, (collections.get(chart) ?? []).filter((e) => e !== entry));
    handles.get(chart)?.reload();
  };
}

/** The template handle created for `chart`, if any. */
export function indicatorTemplatesOf(chart: Chart): IndicatorTemplatesHandle | undefined {
  return handles.get(chart)?.handle;
}

/** Toolbar menu with Save indicator template… and Open template…, for the chart it acts on. */
export function indicatorTemplatesToolbarItem(): Extract<ToolbarItem, { type: 'menu' }> {
  const option = (value: string, labelKey: ShellMessageKey) => ({ value, ...labelOf(labelKey) });
  return {
    type: 'menu',
    id: 'indicator-templates',
    group: 'analysis',
    ...labelOf('templatesMenu'),
    icon: LayoutTemplate,
    options: [option('save', 'templatesSave'), option('open', 'templatesOpen')],
    onSelect: (value, chart) => {
      const handle = indicatorTemplatesOf(chart);
      if (value === 'save') handle?.save();
      else handle?.open();
    },
  };
}

interface TemplateItem extends PickerItem {
  name: string;
  set: unknown;
  /** Saved by the user: can be renamed and deleted. */
  mine: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Indicator templates: save the chart's indicators under a name, and a dialog
 * that lists the user's templates, the built-in presets and registered
 * collections. Built on `chart.indicators.serializeSet` and `applySet`.
 */
export function createIndicatorTemplates(chart: Chart, options: IndicatorTemplatesOptions = {}): IndicatorTemplatesHandle {
  const storage = options.storage === undefined ? createLocalStorageAdapter() : options.storage;
  const presets = options.presets ?? indicatorTemplatePresets;
  const host = () => options.container ?? chart.root.closest<HTMLElement>('.pc-shell') ?? chart.root;
  const text = (key: ShellMessageKey, params?: Record<string, string>) => shellText(chart, key, params);
  const notify = (message: string, kind: NotificationKind = 'info') => !destroyed && chart.notify({ message, kind });
  let dialog: PickerDialog | null = null;
  let prompt: FormDialog | null = null;
  /** Templates listed by the open dialog; reloaded after a change. */
  let loaded: Promise<TemplateItem[]> | null = null;
  let destroyed = false;
  /** Dismisses an open delete confirmation when the handle is destroyed. */
  const teardown = new AbortController();

  const failed = (error: unknown) => {
    console.error('Indicator templates:', error);
    notify(text('templatesFailed'), 'error');
  };

  async function savedNames(): Promise<string[]> {
    return (await storage?.listTemplates?.(KIND)) ?? [];
  }

  async function collect(): Promise<TemplateItem[]> {
    const names = await savedNames();
    // One unreadable template is listed as invalid; the others still load.
    const saved = await Promise.all(names.map((name) => storage!.loadTemplate!(KIND, name).catch(() => null)));
    const items = names.map((name, i) => item(name, saved[i], 'mine'));
    presets.forEach((t) => items.push(item(keyedText(chart, t.nameKey, t.name), t.set, 'builtin')));
    for (const { templates, category } of collections.get(chart) ?? []) {
      for (const t of templates) items.push(item(keyedText(chart, t.nameKey, t.name), t.set, `c:${category}`));
    }
    // Ids by position: names may repeat across sources.
    items.forEach((t, i) => (t.id = String(i)));
    return items;
  }

  function item(name: string, content: unknown, category: string): TemplateItem {
    const base = { id: '', label: name, name, set: content, category, mine: category === 'mine' };
    if (!isRecord(content) || !Array.isArray(content.indicators)) return { ...base, description: text('templatesInvalid'), disabled: true };
    const defs = new Map(chart.indicators.getDefinitions().map((d) => [d.id, d]));
    const panes = new Map<number, string[]>();
    const missing = new Set<string>();
    for (const entry of content.indicators as unknown[]) {
      if (!isRecord(entry) || typeof entry.type !== 'string') continue;
      const def = defs.get(entry.type);
      if (!def) missing.add(entry.type);
      const inputs = isRecord(entry.inputs) ? entry.inputs : {};
      // "SMA 20": the name and the first number input, saved (when a finite number) or default.
      const first = def?.inputs.find((i) => i.type === 'number');
      const value = first && inputs[first.id];
      const numbers = first ? [typeof value === 'number' && Number.isFinite(value) ? value : first.default] : [];
      const pane = Number.isInteger(entry.pane) ? (entry.pane as number) : 0;
      panes.set(pane, [...(panes.get(pane) ?? []), [chart.localization.text(`indicator.${entry.type}`, undefined, def?.name ?? entry.type), ...numbers].join(' ')]);
    }
    if (missing.size) return { ...base, description: text('templatesMissing', { ids: [...missing].join(', ') }), disabled: true };
    const summary = [...panes].sort((a, b) => a[0] - b[0]).map(([, names]) => names.join(', '));
    // Untrusted: only ranges of two valid intervals are shown.
    const scope = (Array.isArray(content.appliesOn) ? (content.appliesOn as unknown[]) : []).filter(
      (r): r is IntervalRange => isRecord(r) && isInterval(r.from) && isInterval(r.to),
    );
    if (scope.length) summary.push(text('templatesScope', { intervals: scope.map((r) => `${r.from}–${r.to}`).join(', ') }));
    return { ...base, description: summary.join(' · ') };
  }

  function apply(template: TemplateItem, replace: boolean): void {
    try {
      const { skipped } = chart.indicators.applySet(template.set, { replace });
      const list = skipped.map((s) => `${s.type || '?'} (${text(skipKey(s.reason))})`).join(', ');
      notify(list ? text('templatesSkipped', { name: template.name, list }) : text('templatesApplied', { name: template.name }), list ? 'info' : 'success');
    } catch (error) {
      console.error(error);
      notify(text('templatesInvalid'), 'error');
    }
  }

  /** Close the dialog and open it again on fresh data, e.g. after a collection was registered. */
  function reload(): void {
    if (!dialog?.isOpen) return;
    dialog.close();
    open();
  }

  function open(): void {
    if (destroyed || dialog?.isOpen) return;
    loaded = null;
    const categories = [
      ...(storage?.listTemplates ? [{ id: 'mine', label: text('templatesMine') }] : []),
      ...(presets.length ? [{ id: 'builtin', label: text('templatesBuiltin') }] : []),
      ...[...new Set((collections.get(chart) ?? []).map((c) => c.category))].map((c) => ({ id: `c:${c}`, label: c })),
    ];
    const mine = (t: TemplateItem) => t.mine && Boolean(storage?.saveTemplate && storage.removeTemplate);
    dialog = createPickerDialog<TemplateItem>(
      host(),
      {
        title: text('templatesMenu'),
        source: {
          fetch: async (query, request) => {
            // A failed load is not kept, so Retry reads the storage again.
            const all = await (loaded ??= collect().catch((error) => {
              loaded = null;
              failed(error);
              throw error;
            }));
            if (request.signal.aborted) return [];
            return rankItems(all.filter((t) => inCategory(t, request.category)), query);
          },
        },
        categories,
        allLabel: text('rangeAll'),
        placeholder: text('templatesSearch'),
        searchLabel: text('templatesSearch'),
        emptyText: text('templatesEmpty'),
        debounce: 0,
        rowActions: [
          { id: 'add', label: text('templatesAdd'), icon: Plus, appliesTo: (t) => !t.disabled },
          { id: 'rename', label: text('templatesRename'), icon: Pencil, appliesTo: (t) => mine(t) && !t.disabled },
          { id: 'delete', label: text('drawingDelete'), icon: Trash2, appliesTo: mine },
        ],
      },
      {
        // Picking makes the chart's indicators match the template; adding to them is the row's button.
        onSelect: ([template]) => template && apply(template, true),
        onAction: (action, template, picker) => {
          if (action === 'add') {
            picker.close();
            apply(template, false);
          } else if (action === 'rename') {
            picker.close();
            askName(template.name, async (name) => {
              await storage!.saveTemplate!(KIND, name, template.set);
              // A case-only rename is one entry in a store that matches names without case: removing would delete it.
              if (name.toLowerCase() === template.name.toLowerCase() && !(await savedNames()).includes(template.name)) return;
              await storage!.removeTemplate!(KIND, template.name).catch(() => notify(text('templatesKept', { name }), 'error'));
            });
          } else {
            void remove(template, picker);
          }
        },
        onClose: () => (dialog = null),
      },
      { localization: chart.localization },
    );
  }

  /** Deleting cannot be undone, so ask first; the list reloads after it. */
  async function remove(template: TemplateItem, picker: PickerDialog): Promise<void> {
    // The row's Delete button, focused again when the question is dismissed.
    const trash = findIn(picker.el, (el) => el.getAttribute('data-action') === 'delete' && el.parentElement?.previousElementSibling?.getAttribute('data-id') === template.id);
    const sure = await confirmDialog(host(), {
      title: text('templatesDeleteTitle'),
      message: text('templatesDeleteMessage', { name: template.name }),
      confirmLabel: text('drawingDelete'),
      cancelLabel: text('templatesCancel'),
      closeLabel: text('dialogClose'),
      destructive: true,
      returnFocus: trash,
      signal: teardown.signal,
    });
    if (!sure || destroyed) return;
    storage!.removeTemplate!(KIND, template.name).then(() => {
      notify(text('templatesDeleted', { name: template.name }));
      reload();
    }, failed);
  }

  /**
   * Ask for a template name (`current` when renaming), check it against the
   * stored names, then hand it to `done`. A rename returns to the list.
   */
  function askName(current: string, done: (name: string) => Promise<void>): void {
    const back = () => {
      if (current) open();
    };
    prompt?.close();
    prompt = askTemplateName(host(), chart, text(current ? 'templatesRename' : 'templatesSave'), current, (name) => {
      prompt = null;
      if (name === null || name === current) return back();
      // Checked against the names stored now, so one another tab saved meanwhile is refused too.
      savedNames()
        .then((fresh) => {
          if (destroyed) return;
          if (templateNameTaken(fresh, name, current)) return notify(text('templatesNameTaken'), 'error');
          return done(name);
        })
        .catch(failed)
        .finally(() => !destroyed && back());
    });
  }

  function save(): void {
    if (destroyed || !storage?.saveTemplate) return;
    const content = chart.indicators.serializeSet();
    if (content.indicators.length === 0) return void notify(text('templatesNothing'));
    askName('', async (name) => {
      await storage.saveTemplate!(KIND, name, content);
      notify(text('templatesSaved', { name }), 'success');
    });
  }

  const offDestroy = chart.on('chart:destroy', () => handle.destroy());
  const handle: IndicatorTemplatesHandle = {
    get isOpen() {
      return dialog?.isOpen ?? false;
    },
    open,
    save,
    close: () => dialog?.close(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offDestroy();
      teardown.abort();
      dialog?.close();
      prompt?.close();
      prompt = null;
      if (handles.get(chart)?.handle === handle) handles.delete(chart);
    },
  };
  handles.set(chart, { handle, reload });
  return handle;
}
