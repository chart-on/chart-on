import { normalizeShortcut, type ActionState, type Chart } from '@chart-on/core';
import { Plus, RotateCcw, X } from 'lucide';
import { linkShortcutSettings, loadStored, localSettingsStorage, same, saveStored, type ChartSettingsStorage } from './chart-settings';
import { iconButton } from './controls';
import { confirmDialog, dialogButton, findIn, openDialogFrame, type DialogFrame } from './dialog';
import { h } from './dom';
import { shellText, type ShellMessageKey } from './messages';
import { apple, shortcutText } from './shortcuts';

/** Options for `createShortcutSettings`: where the user's shortcuts are saved, and an open/close callback. */
export interface ShortcutSettingsOptions {
  /** Where the user's shortcut changes are kept; `null` keeps them for this visit only. Default `localStorage`. */
  storage?: ChartSettingsStorage | null;
  /** `localStorage` key of the default storage. Default `'charton:shortcuts'`; give each chart on a page its own. */
  storageKey?: string;
  /** Called when the dialog opens or closes. */
  onOpenChange?(open: boolean): void;
}

/** Returned by `createShortcutSettings`: opens or closes the keyboard shortcuts dialog. */
export interface ShortcutSettingsHandle {
  /** Open the dialog; does nothing while it is open. */
  open(): void;
  /** Close the dialog; changes made in it stay. */
  close(): void;
  /** Whether the dialog is open. */
  readonly isOpen: boolean;
  /** Close the dialog and remove the button from the chart settings; the shortcuts stay as they are. */
  destroy(): void;
}

/** Combinations the browser or system keep, in `Mod` form where Ctrl and Cmd both count. */
const RESERVED = ['Mod+W', 'Mod+T', 'Mod+N', 'Mod+Q', 'Mod+L', 'Mod+Tab', 'Mod+Shift+W', 'Mod+Shift+T', 'Mod+Shift+N', 'Mod+Shift+Tab', 'Alt+Tab', 'Alt+F4'];

/** Key values that are not a key of their own: modifiers and composition. */
const NOT_A_KEY = /^(Shift|Control|Alt|AltGraph|Meta|OS|CapsLock|Fn|Dead|Process|Unidentified)$/;

/** The concrete combinations a shortcut stands for: `Mod` is both Ctrl and Meta. */
const concrete = (keys: string) =>
  keys.includes('Mod') ? [normalizeShortcut(keys.replace('Mod', 'Ctrl')), normalizeShortcut(keys.replace('Mod', 'Meta'))] : [keys];

const overlaps = (a: string, b: string) => concrete(a).some((k) => concrete(b).includes(k));

/** Whether the browser or system keep a shortcut, so recording it is refused. */
export function isReservedShortcut(keys: string): boolean {
  return RESERVED.some((r) => overlaps(normalizeShortcut(r), keys));
}

/**
 * The shortcut a key press records, in canonical form, with Cmd (Apple) or
 * Ctrl (elsewhere) written as `Mod`; null for a bare modifier, which waits
 * for a key. With Ctrl, Alt or Cmd held, letters and digits come from the
 * physical key, so Alt+R on a layout where Alt types a symbol records Alt+R.
 * Shift is kept for letters and named keys only: for other characters the
 * character already says it (`?`, not `Shift+/`).
 */
export function recordedShortcut(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>, mac = apple()): string | null {
  if (typeof e.key !== 'string' || e.key === '' || NOT_A_KEY.test(e.key)) return null;
  const physical = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code ?? '');
  const key = physical && (e.ctrlKey || e.altKey || e.metaKey) ? (physical[1] ?? physical[2]!) : e.key === ' ' ? 'Space' : e.key;
  const shift = e.shiftKey && (key.length > 1 || /^[a-z]$/i.test(key));
  const mod = mac ? e.metaKey : e.ctrlKey;
  const parts = [mod && 'Mod', !mac && e.metaKey && 'Meta', mac && e.ctrlKey && 'Ctrl', e.altKey && 'Alt', shift && 'Shift', key];
  try {
    return normalizeShortcut(parts.filter(Boolean).join('+'));
  } catch {
    return null;
  }
}

type Group = 'Navigation' | 'Edit' | 'Drawing' | 'General';

/** The section an action is listed in, by id; the app's own actions go to General. */
function groupOf(id: string): Group {
  if (/^(scroll|page|zoom|crosshair)-|^(oldest|newest)-bar$|^(reset-view|fit-content|auto-scale|go-to-date)$/.test(id)) return 'Navigation';
  if (/^(undo|redo|copy|cut|paste|remove-selected|(delete|copy|cut|paste)-drawings)$/.test(id)) return 'Edit';
  if (/^draw-|-drawings$/.test(id)) return 'Drawing';
  return 'General';
}

const GROUPS: readonly Group[] = ['Navigation', 'Edit', 'Drawing', 'General'];

/**
 * The keyboard shortcuts dialog: every action on `chart.actions` with its
 * shortcuts, which the user records, adds, removes and resets. Changes apply
 * at once. Recording a shortcut another action has asks to move it there, and
 * the browser's and system's own combinations are refused, so the saved
 * keymap never conflicts. The user's changes (on top of the app's keymap when
 * this is created) are saved to `storage` and restored here. While it exists,
 * the chart settings dialog has a "Keyboard shortcuts" button that opens it.
 */
export function createShortcutSettings(chart: Chart, host: HTMLElement, options: ShortcutSettingsOptions = {}): ShortcutSettingsHandle {
  const actions = chart.actions;
  const storage = options.storage === undefined ? localSettingsStorage(options.storageKey ?? 'charton:shortcuts') : options.storage;
  const t = (key: ShellMessageKey, params?: Record<string, string>) => shellText(chart, key, params);
  /** The app's keymap: what resetting goes back to. */
  const base = actions.keymap;
  const stored = loadStored(storage);
  if (Object.keys(stored).length > 0) {
    const before = actions.conflicts().length;
    actions.setKeymap({ ...base, ...stored });
    // Saved keys a newer default now clashes with: keep the app's keymap.
    if (actions.conflicts().length > before) actions.setKeymap(base);
  }

  const save = () => {
    if (actions.conflicts().length > 0) return;
    const map = actions.keymap;
    const out: Record<string, string[] | null> = {};
    for (const id of new Set([...Object.keys(map), ...Object.keys(base)])) if (!same(map[id], base[id])) out[id] = map[id] ?? null;
    saveStored(storage, out);
  };

  let frame: DialogFrame | null = null;
  let list: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  /** The shortcut being recorded: its action and position, or null for a new one. */
  let recording: { id: string; index: number | null } | null = null;
  /** A reassign question is open: re-renders wait until it is answered. */
  let asking = false;
  /** The list is being replaced: the recorder losing focus then does not stop recording. */
  let rendering = false;
  /** Focused on the next render instead of what had focus, by `data-key`. */
  let focusKey: string | null = null;

  const label = (id: string) => actions.get(id)?.label ?? id;
  const announce = (text: string) => {
    if (status) status.textContent = text;
  };

  /**
   * Bind `next` to `id` (null: the app's keys), first asking to take any of
   * them from other actions. Resolves whether it changed.
   */
  const assign = async (id: string, next: string[] | null): Promise<boolean> => {
    const keys = next ?? base[id] ?? actions.get(id)?.defaultKeys ?? [];
    const clashes = keys.flatMap((k) => actions.actionsFor(k).flatMap((other) => (other === id ? [] : [{ other, k }])));
    if (clashes.length > 0) {
      const { other, k } = clashes[0]!;
      asking = true;
      const ok = await confirmDialog(host, {
        title: t('shortcutsInUseTitle'),
        message: t('shortcutsInUse', { keys: shortcutText(k), other: label(other), action: label(id) }),
        confirmLabel: t('shortcutsReassign'),
        cancelLabel: t('dialogCancel'),
        closeLabel: t('dialogClose'),
      });
      asking = false;
      if (!ok || !frame) {
        announce(t('shortcutsCancelled'));
        render();
        return false;
      }
      for (const { other, k } of clashes) actions.setKeys(other, actions.keys(other).filter((x) => !overlaps(x, k)));
    }
    actions.setKeys(id, next ?? base[id] ?? null);
    save();
    return true;
  };

  const record = async (e: KeyboardEvent) => {
    // Tab and Shift+Tab still move focus, which stops recording.
    if (!recording || (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey)) return;
    // Every other key goes to the recorder, Escape included.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      recording = null;
      announce(t('shortcutsCancelled'));
      return render();
    }
    const keys = recordedShortcut(e);
    if (!keys) return;
    if (isReservedShortcut(keys)) return announce(t('shortcutsReserved', { keys: shortcutText(keys) }));
    const { id, index } = recording;
    recording = null;
    const current = actions.keys(id);
    if (index === null) current.push(keys);
    else current[index] = keys;
    // Focus goes to the recorded shortcut, or back to where recording started.
    focusKey = index === null ? `${id}:add` : `${id}:${index}`;
    if (!(await assign(id, current))) return;
    if (list) findIn(list, (el) => el.getAttribute('data-key') === `${id}:${actions.keys(id).indexOf(keys)}`)?.focus({ preventScroll: true });
    announce(t('shortcutsRecorded', { action: label(id), keys: shortcutText(keys) }));
  };

  const startRecording = (id: string, index: number | null) => {
    recording = { id, index };
    announce(t('shortcutsRecordHint', { action: label(id) }));
    render();
  };

  const keyChip = (action: ActionState, keys: string, index: number) => {
    const text = shortcutText(keys);
    const chip = h('button', { class: 'pc-shortcut-chip', 'data-key': `${action.id}:${index}` }, h('kbd', {}, text));
    chip.setAttribute('aria-label', t('shortcutsChange', { keys: text, action: action.label }));
    chip.addEventListener('click', () => startRecording(action.id, index));
    const remove = iconButton({
      icon: X,
      label: t('shortcutsRemove', { keys: text, action: action.label }),
      variant: 'ghost',
      onClick: () => {
        focusKey = `${action.id}:add`;
        actions.setKeys(action.id, actions.keys(action.id).filter((_, i) => i !== index));
        save();
        announce(t('shortcutsRemoved', { keys: text, action: action.label }));
      },
    });
    remove.setAttribute('data-key', `${action.id}:${index}:remove`);
    return h('span', { class: 'pc-shortcut-key' }, chip, remove);
  };

  const recorder = () => {
    const el = h('button', { class: 'pc-shortcut-chip pc-shortcut-chip--recording', 'data-key': 'recording' }, t('shortcutsRecording'));
    el.setAttribute('aria-describedby', status!.id);
    el.addEventListener('keydown', (e) => void record(e));
    // Leaving the recorder (a click elsewhere) stops recording.
    el.addEventListener('blur', () => {
      if (!recording || rendering) return;
      recording = null;
      render();
    });
    return el;
  };

  const row = (action: ActionState) => {
    const keys = h('span', { class: 'pc-shortcut-keys' });
    action.keys.forEach((k, i) => keys.append(recording?.id === action.id && recording.index === i ? recorder() : keyChip(action, k, i)));
    if (recording?.id === action.id && recording.index === null) keys.append(recorder());
    if (action.keys.length === 0 && !recording) keys.append(h('span', { class: 'pc-shortcut-none' }, t('shortcutsNone')));
    const add = iconButton({ icon: Plus, label: t('shortcutsAdd', { action: action.label }), variant: 'ghost', onClick: () => startRecording(action.id, null) });
    add.setAttribute('data-key', `${action.id}:add`);
    const reset = iconButton({
      icon: RotateCcw,
      label: t('shortcutsReset', { action: action.label }),
      variant: 'ghost',
      onClick: () => {
        focusKey = `${action.id}:add`;
        void assign(action.id, null);
      },
    });
    reset.setAttribute('data-key', `${action.id}:reset`);
    reset.disabled = same(action.keys, base[action.id] ?? action.defaultKeys);
    return h('div', { class: 'pc-shortcut-row', role: 'group', 'aria-label': action.label }, h('span', { class: 'pc-shortcut-label' }, action.label), keys, add, reset);
  };

  function render(): void {
    if (!frame || !list || asking) return;
    const focused = (document.activeElement as HTMLElement | null)?.getAttribute?.('data-key') ?? null;
    const all = actions.list();
    const sections = GROUPS.flatMap((group) => {
      const rows = all.filter((a) => groupOf(a.id) === group);
      if (rows.length === 0) return [];
      return [h('section', { class: 'pc-shortcut-group' }, h('h3', { class: 'pc-shortcut-heading' }, t(`shortcutsGroup${group}`)), ...rows.map(row))];
    });
    rendering = true;
    list.replaceChildren(...sections);
    rendering = false;
    const target = recording ? 'recording' : (focusKey ?? focused);
    focusKey = null;
    if (target) findIn(list, (el) => el.getAttribute('data-key') === target)?.focus({ preventScroll: true });
  }

  let offChange = () => {};
  const close = () => {
    if (!frame) return;
    recording = null;
    offChange();
    frame.close();
    frame = list = status = null;
    options.onOpenChange?.(false);
  };

  const open = () => {
    if (frame) return;
    frame = openDialogFrame(host, { title: t('shortcutsTitle'), className: 'pc-shortcuts', onDismiss: close, closeLabel: t('dialogClose') });
    // Before the frame's own Escape: while recording, Escape only stops recording.
    frame.panel.addEventListener(
      'keydown',
      (e) => {
        if (recording && e.key === 'Escape') void record(e);
      },
      true,
    );
    list = h('div', { class: 'pc-shortcuts-list' });
    status = h('div', { class: 'pc-sr-only', role: 'status', 'aria-live': 'polite', id: `${frame.panel.getAttribute('aria-labelledby')}-status` });
    const resetAll = dialogButton(t('shortcutsResetAll'), false, () => {
      recording = null;
      actions.setKeymap(base);
      save();
      announce(t('shortcutsResetAll'));
    });
    const done = dialogButton(t('dialogDone'), true, close);
    frame.panel.append(
      list,
      status,
      h('div', { class: 'pc-dialog-footer' }, h('div', { class: 'pc-dialog-actions pc-dialog-actions--start' }, resetAll), h('div', { class: 'pc-dialog-actions' }, done)),
    );
    offChange = actions.on('actions:change', render);
    render();
    findIn(list, (el) => el.tagName === 'BUTTON' && !(el as HTMLButtonElement).disabled)?.focus({ preventScroll: true });
    options.onOpenChange?.(true);
  };

  linkShortcutSettings(chart, open);
  return {
    open,
    close,
    get isOpen() {
      return frame !== null;
    },
    destroy() {
      close();
      linkShortcutSettings(chart, null);
    },
  };
}
