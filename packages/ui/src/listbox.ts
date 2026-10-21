/**
 * The themed dropdown every select in the shell uses: a closed trigger that
 * opens a listbox popover, with a search box over it for long lists.
 */
import type { Localizer } from '@chart-on/core';
import { ChevronDown } from 'lucide';
import { fadeOutAndRemove, followTrigger, h, icon, onDismiss, placeFixed } from './dom';
import type { FormOption } from './form-model';
import { shellText } from './messages';

/** What `createListbox` needs. */
export interface ListboxOptions {
  readonly options: readonly FormOption[];
  readonly value: unknown;
  /** Name of the field: labels the list and the search box, and the trigger without `labelId`. */
  readonly label: string;
  /** Id for the trigger, and the prefix of the list's ids; default a fresh one. */
  readonly id?: string;
  /** Id of the field's visible label. */
  readonly labelId?: string;
  /** Show a search box over the list (long lists). */
  readonly search?: boolean;
  /** Extra class for the wrapper. */
  readonly className?: string;
  readonly localization?: Localizer;
  /** The user picked another option. */
  set(value: unknown): void;
}

/** A rendered listbox. */
export interface Listbox {
  el: HTMLElement;
  focusTarget: HTMLElement;
  /** Show a value set from outside, without reporting it. */
  setValue(value: unknown): void;
  setDisabled(disabled: boolean): void;
  destroy(): void;
}

/** Rows Page Up and Page Down move in the list. */
const PAGE_ROWS = 8;
/** Below this much room under the trigger, the popover opens above it when there is more room there. */
const POPOVER_MIN_ROOM = 240;
/** Tallest the popover grows, in px. */
const POPOVER_MAX_HEIGHT = 360;
/** Pause after which type-ahead starts a new word, in ms. */
const TYPE_AHEAD_MS = 700;

let ids = 0;

/** Indexes of the options whose label or value contains `query`, ignoring case. */
function filterOptions(options: readonly FormOption[], query: string): number[] {
  const q = query.trim().toLowerCase();
  const out: number[] = [];
  options.forEach((o, i) => {
    if (!q || o.label.toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q)) out.push(i);
  });
  return out;
}

/**
 * A closed control showing the chosen option, which opens a popover over a
 * listbox of the options; with `search`, a search box (a combobox) above it
 * filters them, otherwise focus moves into the list and typing jumps to the
 * option starting with the typed text. Arrow, Page, and (without search) Home
 * and End keys move the active option, Enter or a click picks it and closes
 * the list, Escape or a press outside closes it without a change; focus goes
 * back to the trigger. Typing on the closed trigger opens it with that text.
 * The popover is fixed to the viewport, so a scrolling dialog body does not
 * clip it; it follows the trigger when the page scrolls or resizes (an
 * on-screen keyboard opening, say) and closes once the trigger is out of view.
 * Option rows are made once and reused while filtering, with one click
 * listener on the list.
 */
export function createListbox(o: ListboxOptions): Listbox {
  const options = o.options;
  const id = o.id ?? `pc-listbox-${++ids}`;
  const valueId = `${id}-value`;
  const listId = `${id}-list`;
  const face = h('span', { class: 'pc-form-combo-value', id: valueId });
  const trigger = h('button', {
    class: 'pc-select pc-form-combo',
    id,
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    // Without a visible label the trigger names itself (its `aria-label`), then the value.
    'aria-labelledby': `${o.labelId ?? id} ${valueId}`,
  });
  if (!o.labelId) trigger.setAttribute('aria-label', o.label);
  trigger.append(face, icon(ChevronDown, 14));
  const wrap = h('div', { class: `pc-form-combo-wrap${o.className ? ` ${o.className}` : ''}` }, trigger);

  let current = o.value;
  let popover: HTMLElement | null = null;
  let search: HTMLInputElement | null = null;
  let list: HTMLElement | null = null;
  /** Indexes into `options` of the rows shown, in order. */
  let shown: number[] = [];
  /** Position in `shown` of the active row. */
  let active = -1;
  /** One row per option, made on first open and reused. */
  let rows: HTMLElement[] | null = null;
  let dispose: (() => void) | null = null;
  let typed = '';
  let typedAt = -Infinity;
  const empty = h('div', { class: 'pc-form-combo-empty', role: 'status' }, shellText(o, 'dialogNoMatches'));

  const showValue = () => {
    const option = options.find((x) => x.value === current);
    const text = option ? option.label : current === undefined || current === null ? '' : String(current);
    face.textContent = text;
    trigger.setAttribute('title', text);
  };

  /** Keep row `i` inside the list's scrolled area; `center` puts it in the middle (on open). */
  const reveal = (i: number, center = false) => {
    const row = list?.children[i] as HTMLElement | undefined;
    if (!list || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (center) list.scrollTop = Math.max(0, top - (list.clientHeight - row.offsetHeight) / 2);
    else if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  };

  const setActive = (i: number, center = false) => {
    const owner = search ?? list;
    if (!owner || !rows) return;
    rows[shown[active] ?? -1]?.classList.remove('is-focus');
    active = shown.length === 0 ? -1 : Math.max(0, Math.min(shown.length - 1, i));
    const row = rows[shown[active] ?? -1];
    if (row) {
      row.classList.add('is-focus');
      owner.setAttribute('aria-activedescendant', row.getAttribute('id')!);
      reveal(active, center);
    } else owner.removeAttribute('aria-activedescendant');
  };

  /** Make the next option whose label starts with the typed text active. */
  const typeAhead = (key: string, at: number) => {
    // Repeating one letter cycles through the options starting with it.
    typed = at - typedAt > TYPE_AHEAD_MS || typed === key ? key : typed + key;
    typedAt = at;
    const q = typed.toLowerCase();
    const from = typed.length === 1 ? active + 1 : active;
    for (let k = 0; k < shown.length; k++) {
      const j = (from + k + shown.length) % shown.length;
      if (options[shown[j]!]!.label.toLowerCase().startsWith(q)) return setActive(j);
    }
  };

  const makeRows = () =>
    options.map((x, i) =>
      h(
        'div',
        {
          class: 'pc-popover-item pc-form-combo-option',
          role: 'option',
          id: `${listId}-${i}`,
          'data-index': String(i),
          // Long labels are cut off with an ellipsis; the tooltip shows them whole.
          title: x.label,
        },
        x.label,
      ),
    );

  const render = () => {
    if (!list) return;
    rows ??= makeRows();
    if (active >= 0) rows[shown[active] ?? -1]?.classList.remove('is-focus');
    shown = filterOptions(options, search?.value ?? '');
    const chosen = options.findIndex((x) => x.value === current);
    list.replaceChildren(
      ...shown.map((i) => {
        const row = rows![i]!;
        row.className = `pc-popover-item pc-form-combo-option${i === chosen ? ' is-active' : ''}`;
        row.setAttribute('aria-selected', String(i === chosen));
        return row;
      }),
    );
    empty.hidden = shown.length > 0;
    active = -1;
    place();
    const at = shown.indexOf(chosen);
    setActive(at >= 0 ? at : 0, true);
  };

  /** The option a click inside the list landed on. */
  const onListClick = (e: Event) => {
    for (let n = e.target as HTMLElement | null; n && n !== list; n = n.parentElement) {
      const index = n.getAttribute?.('data-index');
      if (index !== null && index !== undefined) return pick(options[Number(index)]);
    }
  };

  /** Fix the popover under the trigger (or above it when there is more room there), inside the viewport. */
  const place = () => {
    popover!.style.width = `${Math.max(trigger.getBoundingClientRect().width, search ? 220 : 160)}px`;
    placeFixed(popover!, trigger, POPOVER_MIN_ROOM, POPOVER_MAX_HEIGHT);
  };

  /** Close the list; with `refocus`, give focus back to the trigger. */
  const close = (refocus: boolean) => {
    if (!popover) return;
    const hadFocus = popover.contains(document.activeElement);
    fadeOutAndRemove(popover);
    popover = search = list = null;
    active = -1;
    dispose?.();
    dispose = null;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-controls');
    // Without scrolling: the list may have closed because the trigger scrolled out of view.
    if (refocus || hadFocus) trigger.focus({ preventScroll: true });
  };

  const pick = (option: FormOption | undefined) => {
    if (!option) return;
    const changed = option.value !== current;
    current = option.value;
    showValue();
    close(true);
    if (changed) o.set(option.value);
  };

  const open = (query = '') => {
    if (popover || trigger.disabled) return;
    list = h('div', { class: 'pc-form-combo-list', role: 'listbox', id: listId, 'aria-label': o.label });
    if (o.search) {
      search = h('input', {
        type: 'text',
        class: 'pc-input pc-form-combo-search',
        placeholder: shellText(o, 'dialogSearch'),
        autocomplete: 'off',
        spellcheck: 'false',
        role: 'combobox',
        'aria-expanded': 'true',
        'aria-autocomplete': 'list',
        'aria-controls': listId,
        'aria-label': shellText(o, 'dialogSearchField', { name: o.label }),
      });
      search.value = query;
      search.addEventListener('input', render);
      popover = h('div', { class: 'pc-popover pc-form-combo-popover' }, search, list, empty);
    } else {
      list.tabIndex = -1;
      popover = h('div', { class: 'pc-popover pc-form-combo-popover' }, list);
    }
    const focusEl = search ?? list;
    focusEl.addEventListener('keydown', onKey);
    list.addEventListener('click', onListClick);
    wrap.append(popover);
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', listId);
    render();
    focusEl.focus({ preventScroll: true });
    // Focusing the search box may scroll the page or bring up an on-screen keyboard: follow the trigger.
    const dismiss = onDismiss(wrap, () => close(false));
    const unfollow = followTrigger(popover, trigger, place, () => close(false));
    dispose = () => {
      dismiss();
      unfollow();
    };
  };

  const onKey = (e: KeyboardEvent) => {
    const key = e.key;
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'PageDown' || key === 'PageUp') {
      e.preventDefault();
      const step = key.startsWith('Page') ? PAGE_ROWS : 1;
      setActive(active + (key === 'ArrowDown' || key === 'PageDown' ? step : -step));
    } else if (!search && (key === 'Home' || key === 'End')) {
      e.preventDefault();
      setActive(key === 'Home' ? 0 : shown.length - 1);
    } else if (key === 'Enter' || (!search && key === ' ' && e.timeStamp - typedAt > TYPE_AHEAD_MS)) {
      // Never submits the form: Enter picks the active option, or does nothing without one.
      e.preventDefault();
      pick(options[shown[active] ?? -1]);
    } else if (key === 'Escape') {
      // Handled here, so the dialog (or a compact sheet around it) stays open.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (key === 'Tab') {
      // Leave from the trigger, so Tab moves on from this field.
      close(true);
    } else if (!search && printable(e)) {
      e.preventDefault();
      typeAhead(key, e.timeStamp);
    }
  };

  trigger.addEventListener('click', () => (popover ? close(true) : open()));
  trigger.addEventListener('keydown', (e) => {
    if (popover) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open();
    } else if (e.key !== ' ' && printable(e)) {
      e.preventDefault();
      open(e.key);
      if (!search) typeAhead(e.key, e.timeStamp);
    }
  });

  showValue();
  return {
    el: wrap,
    focusTarget: trigger,
    setValue: (value) => {
      current = value;
      showValue();
      if (popover) render();
    },
    setDisabled: (disabled) => {
      if (disabled) close(false);
      trigger.disabled = disabled;
    },
    destroy: () => close(false),
  };
}

/** A key that types a character, without a modifier that makes it a shortcut. */
export const printable = (e: KeyboardEvent) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
