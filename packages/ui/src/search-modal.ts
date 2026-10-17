/**
 * Internal: the modal frame the symbol search and the indicator picker share. A hidden backdrop
 * with a panel holding a title, a close button and a search box (callers append the rest). While
 * shown it behaves like the other dialogs (`bindDialog`): Escape, the focus trap, presses outside
 * closing it, focus kept in the search box, compact mode. Focus goes back to the opener on hide.
 */
import { Search, X } from 'lucide';
import { iconButton } from './controls';
import { bindDialog, type BoundDialog } from './dialog';
import { h, icon, nameButton } from './dom';
import { highlightParts } from './symbol-search-model';

/** `text` with the parts that match `query` in `<mark>` elements. */
export const marked = (text: string, query: string) => highlightParts(text, query).map((part) => (part.match ? h('mark', {}, part.text) : part.text));

let lastPointer = '';

/** Run `fn` when the pointer really moves over the option `el`: scrolling fires mousemove without movement, and only a real move takes over from the keyboard. */
export function onPointerMove(el: HTMLElement, fn: () => void): void {
  el.addEventListener('mousemove', (e) => {
    const at = `${e.screenX},${e.screenY}`;
    if (at === lastPointer) return;
    lastPointer = at;
    fn();
  });
}

/** Options of `row`'s height that fit in `results`, for Page Up / Page Down; 8 before there is a layout to measure. */
export const pageRows = (results: HTMLElement, row: HTMLElement | null | undefined) =>
  !row?.offsetHeight || !results.clientHeight ? 8 : Math.max(1, Math.floor(results.clientHeight / row.offsetHeight) - 1);

/** `results` is scrolled to within 120 px of its end, so the next page should load. A hidden list says nothing: it would load every page. */
export const nearEnd = (results: HTMLElement) => results.clientHeight > 0 && results.scrollTop + results.clientHeight >= results.scrollHeight - 120;

export interface SearchModal {
  el: HTMLElement;
  panel: HTMLElement;
  field: HTMLElement;
  input: HTMLInputElement;
  /** Set the title and the accessible names in the current language. */
  label(title: string, close: string, input: string, placeholder: string): void;
  /** Put `text` in the search box and focus it, caret at the end. */
  type(text: string): void;
  /** Show it, remembering the element that had focus. */
  show(): void;
  /** Hide it and give focus back to that element. */
  hide(): void;
}

/** `id` prefixes the element ids; `className` goes on the panel; `close` runs on Escape, the close button and a press outside. */
export function searchModal(host: HTMLElement, id: string, className: string, close: () => void): SearchModal {
  const title = h('div', { class: 'pc-dialog-title', id: `${id}-title` });
  const closeButton = iconButton({ icon: X, label: '', variant: 'ghost', onClick: close });
  const input = h('input', {
    type: 'text',
    class: 'pc-symbol-search-input',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': `${id}-list`,
    'aria-autocomplete': 'list',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const panel = h('div', { class: `pc-dialog ${className}`, role: 'dialog', 'aria-labelledby': title.id }, h('div', { class: 'pc-dialog-header' }, title, closeButton));
  const el = h('div', { class: 'pc-dialog-backdrop' }, panel);
  el.hidden = true;
  host.append(el);
  let opener: HTMLElement | null = null;
  let binding: BoundDialog | null = null;

  return {
    el,
    panel,
    field: h('div', { class: 'pc-symbol-search-field' }, icon(Search, 16), input),
    input,
    label(text, closeLabel, inputLabel, placeholder) {
      title.textContent = text;
      nameButton(closeButton, closeLabel);
      input.setAttribute('aria-label', inputLabel);
      input.placeholder = placeholder;
    },
    type(text) {
      input.value = text;
      input.focus({ preventScroll: true });
      input.setSelectionRange(text.length, text.length);
    },
    show() {
      const current = document.activeElement;
      opener = current instanceof HTMLElement && current !== document.body ? current : null;
      el.hidden = false;
      // Bound only while shown: `aria-modal` tells page and chart key handlers a modal is open.
      binding ??= bindDialog(host, panel, { onDismiss: close, onOutside: close, modal: true, focusTarget: input });
    },
    hide() {
      binding?.release();
      binding = null;
      el.hidden = true;
      const target = opener;
      opener = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
    },
  };
}
