import { isText } from './util/records';
import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };
/**
 * Commands by id and the shortcuts that run them: `chart.actions`.
 *
 * Every built-in command (panning, zooming, drawing edits) is an action with
 * an id, a label and an enabled (and for toggles, checked) state. Apps run
 * them by id, register their own, and rebind, add or turn off shortcuts.
 */

/**
 * The message key of a built-in action's label: `action` and its id in
 * PascalCase, e.g. `'fit-content'` gives `'actionFitContent'`.
 * @internal
 */
export function actionLabelKey(id: string): string {
  return 'action' + id.replace(/(?:^|-)(\w)/g, (_, c: string) => c.toUpperCase());
}

/** A command the registry can run. */
export interface ActionDefinition {
  /** Unique id, e.g. `'zoom-in'` or `'my-app:save-layout'`. */
  id: string;
  /** Text for menus and tooltips; a function is read each time, e.g. to follow the language. */
  label: string | (() => string);
  /**
   * Default shortcuts, e.g. `['Mod+S']`. A shortcut is modifiers and a key
   * joined with `+`: `Ctrl`, `Alt`, `Shift`, `Meta` (Cmd) and `Mod` (Ctrl or
   * Cmd, whichever is pressed), then a letter, a digit, a character such as
   * `+` or `-`, or a key name such as `ArrowLeft`, `PageUp`, `Delete`, `F2`.
   */
  keys?: readonly string[];
  /** Do it. Return false when nothing happened, so a shortcut leaves the key to the page. */
  run(): boolean | void;
  /** Whether it can run now. Default: always. */
  enabled?(): boolean;
  /** For toggles: whether it is on. Leave out for plain commands. */
  checked?(): boolean;
  /**
   * Its shortcuts work only while the chart is hovered or focused, even with
   * `keyboard.scope: 'global'`. Default false.
   */
  local?: boolean;
}

/** An action as the registry reports it. */
export interface ActionState {
  id: string;
  label: string;
  enabled: boolean;
  /** On or off for toggles; null for plain commands. */
  checked: boolean | null;
  /** The shortcuts in effect, in canonical form (`'Ctrl+Shift+Z'`). */
  keys: string[];
  /** The shortcuts it was registered with. */
  defaultKeys: string[];
}

/** Two or more actions on the same shortcut. */
export interface ShortcutConflict {
  /** The shortcut, in canonical form, with `Mod` spelled out as `Ctrl` or `Meta`. */
  keys: string;
  ids: string[];
}

/** A keymap entry `setKeymap` could not use. */
export interface KeymapError {
  id: string;
  keys: unknown;
  reason: string;
}

/** The parts of a key event shortcuts read. */
export type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>;

interface Chord {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** Ctrl or Meta, whichever is pressed. */
  mod: boolean;
  key: string;
}

/** Key names by lower-cased spelling, including older and shorter ones. */
const KEY_NAMES: Record<string, string> = {};
for (const name of [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'Escape',
  'Enter',
  'Delete',
  'Backspace',
  'Tab',
  'Space',
  'Insert',
  'ContextMenu',
]) {
  KEY_NAMES[name.toLowerCase()] = name;
}
for (let i = 1; i <= 24; i++) KEY_NAMES[`f${i}`] = `F${i}`;
Object.assign(KEY_NAMES, {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  esc: 'Escape',
  del: 'Delete',
  return: 'Enter',
  plus: '+',
  minus: '-',
  ' ': 'Space',
});

const MODIFIER_NAMES: Record<string, keyof Omit<Chord, 'key'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  mod: 'mod',
};

const isLetter = (key: string) => /^[A-Z]$/.test(key);
const isDigit = (key: string) => /^[0-9]$/.test(key);

/** The canonical name of a key as written in a shortcut or reported by an event; null if it is not one. */
function keyName(raw: string): string | null {
  if (raw.length === 1) return /^[a-z]$/i.test(raw) ? raw.toUpperCase() : raw === ' ' ? 'Space' : raw;
  const known = KEY_NAMES[raw.toLowerCase()];
  if (known) return known;
  return /^[A-Za-z][A-Za-z0-9]+$/.test(raw) ? raw : null;
}

function parseChord(text: string): Chord {
  if (typeof text !== 'string' || text.trim() === '') throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid shortcut: ${String(text)}` : '');
  const trimmed = text.trim();
  // A trailing `+` after a separator (or alone) is the plus key itself.
  const plusKey = trimmed === '+' || trimmed.endsWith('++');
  const parts = (plusKey ? trimmed.slice(0, -1) : trimmed).split('+').map((p) => p.trim());
  if (plusKey) parts[parts.length - 1] = '+';
  const chord: Chord = { ctrl: false, alt: false, shift: false, meta: false, mod: false, key: '' };
  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    const modifier = MODIFIER_NAMES[part.toLowerCase()];
    if (!last) {
      if (!modifier || chord[modifier]) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid shortcut: ${text}` : '');
      chord[modifier] = true;
      return;
    }
    const key = modifier ? null : keyName(part);
    if (!key) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid shortcut: ${text}` : '');
    chord.key = key;
  });
  if (chord.mod && (chord.ctrl || chord.meta)) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid shortcut: ${text}` : '');
  return chord;
}

function chordText(c: Chord): string {
  const mods = [c.ctrl && 'Ctrl', c.mod && 'Mod', c.alt && 'Alt', c.shift && 'Shift', c.meta && 'Meta'].filter(Boolean);
  return [...mods, c.key].join('+');
}

/** The concrete shortcuts a chord stands for: `Mod` becomes Ctrl and Meta. */
function concrete(c: Chord): string[] {
  if (!c.mod) return [chordText(c)];
  return [chordText({ ...c, mod: false, ctrl: true }), chordText({ ...c, mod: false, meta: true })];
}

/**
 * The canonical form of a shortcut, e.g. `normalizeShortcut('shift+ctrl+z')`
 * is `'Ctrl+Shift+Z'`. Throws a `RangeError` for text that is not a shortcut.
 */
export function normalizeShortcut(text: string): string {
  return chordText(parseChord(text));
}

/**
 * The key names an event can stand for, best first. Letters and digits are
 * read from the character the layout typed when it is a Latin letter or a
 * digit, else from the physical key, so `Mod+Z` works on a Cyrillic layout,
 * `Alt+R` where Alt types a symbol, and `Ctrl+1` where the digit row types
 * other characters.
 */
function eventKeyNames(e: ShortcutEvent): string[] {
  const primary = keyName(typeof e.key === 'string' ? e.key : '') ?? '';
  const names = primary ? [primary] : [];
  const code = typeof e.code === 'string' ? e.code : '';
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (letter && !isLetter(primary)) names.push(letter);
  else if (digit && !isDigit(primary)) names.push(digit);
  return names;
}

/**
 * The concrete shortcuts a key event matches, best first. Shift counts only
 * when a shortcut names it, except for letters, where `Shift+X` and `X`
 * differ: Shift often just picks the character (`+`) or extends a key's reach.
 */
export function shortcutCandidates(e: ShortcutEvent): string[] {
  const out: string[] = [];
  const base = { ctrl: !!e.ctrlKey, alt: !!e.altKey, meta: !!e.metaKey, mod: false };
  for (const key of eventKeyNames(e)) {
    out.push(chordText({ ...base, shift: !!e.shiftKey, key }));
    if (e.shiftKey && !isLetter(key)) out.push(chordText({ ...base, shift: false, key }));
  }
  return out;
}

interface Entry {
  def: ActionDefinition;
  defaultKeys: string[];
  /** Registration order, so earlier actions keep their place in `list()`. */
  order: number;
}

/** Commands by id and the shortcuts bound to them. */
export class ActionRegistry {
  readonly #entries = new Map<string, Entry>();
  /** Shortcuts the app set by action id; they replace the defaults. Kept for ids not registered yet. */
  #overrides = new Map<string, string[]>();
  /** Action ids by concrete shortcut; rebuilt lazily. */
  private index: Map<string, string[]> | null = null;
  readonly #listeners = new Set<() => void>();
  #nextOrder = 0;

  /**
   * Add an action. Throws when the id is taken or a default shortcut is
   * invalid. Returns a function that removes it again.
   */
  register(def: ActionDefinition): () => void {
    if (!def || !isText(def.id)) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'An action needs an id' : '');
    if (this.#entries.has(def.id)) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Action already registered: ${def.id}` : '');
    if (typeof def.run !== 'function') throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Action ${def.id} needs a run function` : '');
    const entry: Entry = { def, defaultKeys: (def.keys ?? []).map(normalizeShortcut), order: this.#nextOrder++ };
    this.#entries.set(def.id, entry);
    this.#changed();
    return () => {
      if (this.#entries.get(def.id) !== entry) return;
      this.#entries.delete(def.id);
      this.#changed();
    };
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  /** The action's state, or null when no action has this id. */
  get(id: string): ActionState | null {
    const entry = this.#entries.get(id);
    return entry ? this.state(entry) : null;
  }

  /** Every action, in registration order. */
  list(): ActionState[] {
    return [...this.#entries.values()].sort((a, b) => a.order - b.order).map((e) => this.state(e));
  }

  /** Run an action. False when the id is unknown, the action is disabled or it changed nothing. */
  run(id: string): boolean {
    const entry = this.#entries.get(id);
    return !!entry && this.#runEntry(entry);
  }

  /**
   * Set an action's shortcuts: a list replaces its defaults, `[]` turns its
   * shortcuts off and null restores the defaults. Works for ids registered
   * later too. Throws a `RangeError` for an invalid shortcut.
   */
  setKeys(id: string, keys: readonly string[] | null): void {
    if (keys === null) {
      if (!this.#overrides.delete(id)) return;
    } else {
      const normal = [...new Set(keys.map(normalizeShortcut))];
      this.#overrides.set(id, normal);
    }
    this.#changed();
  }

  /** The shortcuts in effect for an id: the app's if set, else the defaults. */
  keys(id: string): string[] {
    return [...(this.#overrides.get(id) ?? this.#entries.get(id)?.defaultKeys ?? [])];
  }

  /** The app's shortcut changes by action id, to save and pass to `setKeymap` later. */
  get keymap(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [id, keys] of this.#overrides) out[id] = [...keys];
    return out;
  }

  /**
   * Replace every shortcut change with `map` (e.g. a saved `keymap`). Invalid
   * entries are left out and returned; the rest apply.
   */
  setKeymap(map: unknown): KeymapError[] {
    const errors: KeymapError[] = [];
    const next = new Map<string, string[]>();
    if (map === null || typeof map !== 'object' || Array.isArray(map)) {
      errors.push({ id: '', keys: map, reason: 'not an object' });
    } else {
      for (const [id, keys] of Object.entries(map as Record<string, unknown>)) {
        if (keys === null) continue;
        if (!Array.isArray(keys)) {
          errors.push({ id, keys, reason: 'not a list of shortcuts' });
          continue;
        }
        const valid: string[] = [];
        for (const k of keys) {
          try {
            valid.push(normalizeShortcut(k as string));
          } catch {
            errors.push({ id, keys: k, reason: 'invalid shortcut' });
          }
        }
        next.set(id, [...new Set(valid)]);
      }
    }
    this.#overrides = next;
    this.#changed();
    return errors;
  }

  /** Ids of the actions a shortcut runs, e.g. to warn before binding it. `Mod` checks both Ctrl and Meta. */
  actionsFor(keys: string): string[] {
    const index = this.#keyIndex();
    const ids = concrete(parseChord(keys)).flatMap((k) => index.get(k) ?? []);
    return [...new Set(ids)];
  }

  /** Shortcuts bound to more than one action. */
  conflicts(): ShortcutConflict[] {
    const out: ShortcutConflict[] = [];
    for (const [keys, ids] of this.#keyIndex()) if (ids.length > 1) out.push({ keys, ids: [...ids] });
    return out;
  }

  /** Ids of the actions a key event's shortcut is bound to, best match first, enabled or not. */
  match(e: ShortcutEvent): string[] {
    const index = this.#keyIndex();
    const ids: string[] = [];
    for (const keys of shortcutCandidates(e)) {
      for (const id of index.get(keys) ?? []) if (!ids.includes(id)) ids.push(id);
      // An exact match wins over Shift being ignored.
      if (ids.length > 0) break;
    }
    return ids;
  }

  /**
   * Run the first enabled action bound to the event's shortcut that does
   * something. `active`: the chart is hovered or focused, which `local`
   * actions need. Returns true when one ran.
   */
  handleKey(e: ShortcutEvent, active = true): boolean {
    for (const id of this.match(e)) {
      const entry = this.#entries.get(id);
      if (!entry || (entry.def.local && !active)) continue;
      if (this.#runEntry(entry)) return true;
    }
    return false;
  }

  /** Called when actions or shortcuts change. Returns an unsubscribe function. */
  on(event: 'actions:change', listener: () => void): () => void {
    if (event !== 'actions:change') return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Remove every action, shortcut change and listener. */
  clear(): void {
    this.#entries.clear();
    this.#overrides.clear();
    this.index = null;
    this.#listeners.clear();
  }

  #runEntry(entry: Entry): boolean {
    if (!isEnabled(entry.def)) return false;
    return entry.def.run() !== false;
  }

  private state(entry: Entry): ActionState {
    const { def } = entry;
    return {
      id: def.id,
      label: typeof def.label === 'function' ? def.label() : def.label,
      enabled: isEnabled(def),
      checked: def.checked ? def.checked() : null,
      keys: this.keys(def.id),
      defaultKeys: [...entry.defaultKeys],
    };
  }

  #keyIndex(): Map<string, string[]> {
    if (this.index) return this.index;
    const index = new Map<string, string[]>();
    // Shortcuts the app set come first, so they win over the defaults they shadow.
    const rebound = (e: Entry) => Number(this.#overrides.has(e.def.id));
    const entries = [...this.#entries.values()].sort((a, b) => rebound(b) - rebound(a) || a.order - b.order);
    for (const entry of entries) {
      for (const keys of this.keys(entry.def.id)) {
        for (const k of concrete(parseChord(keys))) {
          const ids = index.get(k) ?? [];
          if (!ids.includes(entry.def.id)) ids.push(entry.def.id);
          index.set(k, ids);
        }
      }
    }
    this.index = index;
    return index;
  }

  #changed(): void {
    this.index = null;
    for (const listener of [...this.#listeners]) listener();
  }
}

function isEnabled(def: ActionDefinition): boolean {
  try {
    return def.enabled ? def.enabled() !== false : true;
  } catch {
    return false;
  }
}
