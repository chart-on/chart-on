import type { Chart } from '@chart-on/core';
import { shellText } from './messages';
import type { SymbolSearchDialog } from './symbol-search';
import { isSearchKey } from './symbol-search-model';

/** The action id of the symbol search shortcut. */
const SYMBOL_SEARCH = 'symbol-search';

/** Internal: an Apple device, where `Mod` is Cmd. */
export const apple = () => typeof navigator === 'object' && /Mac|iP(hone|ad|od)/.test(navigator.platform ?? '');

/** A shortcut as people read it: `Mod` becomes Ctrl, or Cmd on Apple devices. */
export const shortcutText = (keys: string) => (apple() ? keys.replace(/\b(Mod|Meta)\b/, 'Cmd') : keys.replace(/\bMod\b/, 'Ctrl'));

/** A shortcut in `aria-keyshortcuts` form, e.g. `Control+K`. */
export const ariaShortcut = (keys: string) => keys.replace(/\bMod\b/, apple() ? 'Meta' : 'Control').replace(/\bCtrl\b/, 'Control');

/**
 * Keep a control's tooltip (the action's label and its first shortcut) and
 * `aria-keyshortcuts` in step with an action on `chart.actions`, e.g. a
 * symbol header button with `'symbol-search'`. Returns a function that stops.
 */
export function showShortcut(target: HTMLElement, chart: Chart, id: string): () => void {
  const sync = () => {
    const action = chart.actions.get(id);
    if (!action) return;
    const [first] = action.keys;
    target.setAttribute('data-tip', first ? `${action.label} (${shortcutText(first)})` : action.label);
    if (first) target.setAttribute('aria-keyshortcuts', action.keys.map(ariaShortcut).join(' '));
    else target.removeAttribute('aria-keyshortcuts');
  };
  sync();
  return chart.actions.on('actions:change', sync);
}

/** Keys typed into a field belong to it. */
const inField = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (/^(input|textarea|select)$/i.test(el.tagName ?? '') || el.isContentEditable === true);
};

/** A modal dialog (ours or the page's) is open: shortcuts outside it wait. */
export const modalOpen = () => document.querySelectorAll('[aria-modal="true"], dialog[open]').length > 0;

/**
 * The `symbol-search` action (`keys`, by default Mod+K and `/`), also heard
 * while focus is elsewhere in the shell, or anywhere on the page with
 * `scope: 'document'`. With `typing`, a letter or digit typed in the shell
 * that no action is bound to opens the dialog with it. Keys typed into fields
 * and keys while a modal dialog is open are left alone.
 */
export function bindSymbolSearchKeys(
  chart: Chart,
  shell: HTMLElement,
  dialog: SymbolSearchDialog,
  scope?: 'shell' | 'document',
  keys: readonly string[] = ['Mod+K', '/'],
  typing = false,
): () => void {
  const actions = chart.actions;
  const unregister = actions.has(SYMBOL_SEARCH)
    ? () => {}
    : actions.register({
        id: SYMBOL_SEARCH,
        label: () => shellText(chart, 'actionSymbolSearch'),
        keys,
        enabled: () => !dialog.isOpen,
        run: () => dialog.open(),
      });
  const offKeys = bindShellShortcut(chart, scope === 'document' ? document : shell, SYMBOL_SEARCH);
  const onType = (e: KeyboardEvent) => {
    if (dialog.isOpen || e.defaultPrevented || !isSearchKey(e) || inField(e.target) || actions.match(e)[0] || modalOpen()) return;
    // Keep the key from also landing in the search box once it has focus.
    e.preventDefault();
    dialog.open(e.key);
  };
  if (typing) shell.addEventListener('keydown', onType);
  return () => {
    offKeys();
    shell.removeEventListener('keydown', onType);
    unregister();
  };
}

/** Per chart, the actions heard outside the chart through `bindShellShortcut`, with how many listeners each has. */
const shellBound = new WeakMap<Chart, Map<string, number>>();

/**
 * Run action `id` when its shortcut is pressed in `target` (the shell or the
 * document), outside the chart too. When several of these shell-wide actions
 * share the shortcut, the first enabled one in `chart.actions.match` order
 * runs, whichever listener hears the key first; chart actions that are only
 * heard on the chart do not take the key from them. Keys typed into fields
 * and keys while a modal dialog is open are left alone. Returns a function
 * that stops.
 */
export function bindShellShortcut(chart: Chart, target: EventTarget, id: string): () => void {
  const actions = chart.actions;
  let bound = shellBound.get(chart);
  if (!bound) shellBound.set(chart, (bound = new Map()));
  bound.set(id, (bound.get(id) ?? 0) + 1);
  const onKey = (e: Event) => {
    const key = e as KeyboardEvent;
    // A focused chart has already run it (and taken the key).
    if (key.defaultPrevented || !chart.features.keyboard || inField(key.target)) return;
    if (modalOpen()) return;
    const first = actions.match(key).find((m) => bound.has(m) && actions.get(m)?.enabled);
    if (first === id && actions.run(id)) key.preventDefault();
  };
  target.addEventListener('keydown', onKey);
  return () => {
    target.removeEventListener('keydown', onKey);
    const left = (bound.get(id) ?? 1) - 1;
    if (left > 0) bound.set(id, left);
    else bound.delete(id);
  };
}
