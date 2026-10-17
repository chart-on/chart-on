/**
 * Internal: the frame the form and picker dialogs share (the symbol search
 * and indicator picker share its behaviour through `bindDialog`). Backdrop, panel,
 * header with a close button, focus trap, Escape, focus restore, and compact
 * mode measured on the host element. Non-modal frames dock to the host's
 * right edge instead (a bottom sheet in compact mode) and leave the rest of
 * the host usable.
 */
import { X } from 'lucide';
import { button, iconButton } from './controls';
import { fadeOutAndRemove, h, prefersReducedMotion } from './dom';

/** Extra panel classes for dialogs opened inside an element, keyed by that element (the shell's `classNames.dialog`). */
const hostClasses = new WeakMap<Node, string>();

/** Give dialogs opened in `host` or anywhere inside it the extra `classes`. */
export function setDialogClass(host: Node, classes: string): void {
  hostClasses.set(host, classes);
}

/** The extra classes for a dialog opened in `host`: its own, or its nearest ancestor's. */
export function dialogClassFor(host: Node): string {
  for (let node: Node | null = host; node; node = node.parentNode) {
    const classes = hostClasses.get(node);
    if (classes) return classes;
  }
  return '';
}

/** Below this host width in px, dialogs switch to their compact layout. */
export const DEFAULT_COMPACT_WIDTH = 600;

const FOCUSABLE_TAGS = new Set(['button', 'input', 'select', 'textarea']);

const childrenOf = (el: Element): HTMLElement[] => Array.from(el.children) as HTMLElement[];

/** Elements under `root` that Tab can reach, in document order. Walks `children` and skips hidden subtrees. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  const walk = (el: HTMLElement) => {
    for (const child of childrenOf(el)) {
      if (child.hidden) continue;
      const tag = child.tagName.toLowerCase();
      const candidate = FOCUSABLE_TAGS.has(tag) || child.getAttribute('tabindex') !== null;
      const disabled = child.getAttribute('disabled') !== null || (child as HTMLButtonElement).disabled === true;
      if (candidate && child.tabIndex >= 0 && !disabled) {
        // Elements hidden by CSS have no boxes; the test DOM has no layout to ask.
        if (typeof child.getClientRects !== 'function' || child.getClientRects().length > 0) found.push(child);
      }
      walk(child);
    }
  };
  walk(root);
  return found;
}

/** Keep Tab and Shift+Tab cycling inside the modal `panel`: from the last focusable element back to the first, and the other way. */
export function trapTab(panel: HTMLElement, e: KeyboardEvent): void {
  const focusable = focusableIn(panel);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  const edge = e.shiftKey ? first : last;
  if (document.activeElement !== edge && panel.contains(document.activeElement)) return;
  e.preventDefault();
  (e.shiftKey ? last : first).focus();
}

/** Any element under `root` matching `test`, depth first. */
export function findIn(root: HTMLElement, test: (el: HTMLElement) => boolean): HTMLElement | null {
  for (const child of childrenOf(root)) {
    if (test(child)) return child;
    const found = findIn(child, test);
    if (found) return found;
  }
  return null;
}

/** A popup (menu, color picker) is open inside `root`; it handles Escape itself. */
const popupOpen = (root: HTMLElement) =>
  findIn(root, (el) => el.getAttribute('aria-haspopup') !== null && el.getAttribute('aria-expanded') === 'true') !== null;

export interface DialogFrameOptions {
  title: string;
  /** Extra classes on the panel. */
  className: string;
  /** Escape (when no popup inside is open) and the close button. */
  onDismiss(): void;
  /** A press outside the panel; ignored when omitted. */
  onOutside?(): void;
  compactWidth?: number;
  /** Called when compact mode turns on or off (not on open). */
  onCompactChange?(compact: boolean): void;
  /**
   * Default true. False docks the panel to the host's right edge (the bottom
   * in compact mode) without a backdrop, focus trap or `aria-modal`, so the
   * rest of the host stays usable.
   */
  modal?: boolean;
  /** Controls placed in the header before the close button. */
  headerControls?: readonly HTMLElement[];
  /** Default true. False leaves out the header: the title only names the panel, and Escape or a press outside closes it. */
  header?: boolean;
  /** Accessible name of the close button. Default `'Close'`. */
  closeLabel?: string;
  /** Focused again on close. Default the element that had focus on open. */
  returnFocus?: HTMLElement | null;
}

export interface DialogFrame {
  backdrop: HTMLElement;
  panel: HTMLElement;
  header: HTMLElement;
  readonly compact: boolean;
  /** Remove the dialog and give focus back to the element that had it on open. */
  close(): void;
}

let uid = 0;
/** Open modal panels, newest last: only the newest one traps focus and sees presses outside. */
const modals: HTMLElement[] = [];

export function nextDialogId(prefix: string): string {
  return `${prefix}-${++uid}`;
}

/** What `bindDialog` wires to an open panel. */
export interface DialogBinding {
  /** Escape (when no popup inside is open). */
  onDismiss(): void;
  /** A press outside the panel; ignored when omitted. */
  onOutside?(): void;
  compactWidth?: number;
  /** Called when compact mode turns on or off (not on bind). */
  onCompactChange?(compact: boolean): void;
  /** Traps Tab, keeps focus inside and stacks over other modals. */
  modal: boolean;
  /** Where focus goes when it lands outside a modal panel without coming from it. Default the first focusable element. */
  focusTarget?: HTMLElement;
}

/** An open dialog's live state: its compact flag, and `release` to unwire it. */
export interface BoundDialog {
  readonly compact: boolean;
  release(): void;
}

/**
 * Wire the behaviour of an open dialog to `panel` in `host`: Escape, the
 * focus trap, presses outside, focus kept inside, the modal stack and
 * compact mode measured on the host. `release` undoes it all, so a dialog
 * that stays in the page while hidden can bind on show and release on hide.
 */
export function bindDialog(host: HTMLElement, panel: HTMLElement, options: DialogBinding): BoundDialog {
  const { modal } = options;
  const limit = options.compactWidth ?? DEFAULT_COMPACT_WIDTH;
  const measure = () => {
    const width = host.getBoundingClientRect().width;
    return width > 0 && width < limit;
  };
  let compact = measure();
  panel.setAttribute('data-compact', String(compact));
  if (modal) panel.setAttribute('aria-modal', 'true');

  const observer = new ResizeObserver(() => {
    const next = measure();
    if (next === compact) return;
    compact = next;
    panel.setAttribute('data-compact', String(compact));
    options.onCompactChange?.(compact);
  });
  observer.observe(host);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (e.defaultPrevented || popupOpen(panel)) return;
      e.preventDefault();
      options.onDismiss();
    } else if (e.key === 'Tab' && modal) {
      trapTab(panel, e);
    }
  };

  // A modal stacked over this one (a confirmation) owns presses and focus until it closes.
  const covered = () => modal && modals[modals.length - 1] !== panel;
  const onPointerDown = (e: PointerEvent) => {
    // Toasts sit above dialogs: pressing one (to read or close it) is not a press outside.
    const target = e.target as Element;
    if (!covered() && !panel.contains(target) && !target.closest?.('.pc-toasts')) options.onOutside?.();
  };
  const onFocusIn = (e: FocusEvent) => {
    if (covered() || panel.contains(e.target as Node)) return;
    // Focus that left the panel (a pressed toast button, say) goes back where it was.
    const from = e.relatedTarget as HTMLElement | null;
    (from && panel.contains(from) ? from : (options.focusTarget ?? focusableIn(panel)[0]))?.focus({ preventScroll: true });
  };
  // The host's own document, which differs from the global one in a popup window.
  const doc = host.ownerDocument;
  panel.addEventListener('keydown', onKeyDown);
  doc.addEventListener('pointerdown', onPointerDown, true);
  if (modal) {
    modals.push(panel);
    doc.addEventListener('focusin', onFocusIn);
  }

  let bound = true;
  return {
    get compact() {
      return compact;
    },
    release() {
      if (!bound) return;
      bound = false;
      observer.disconnect();
      panel.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('pointerdown', onPointerDown, true);
      if (!modal) return;
      doc.removeEventListener('focusin', onFocusIn);
      modals.splice(modals.indexOf(panel), 1);
      // Page and chart key handlers read it as "a modal is open".
      panel.removeAttribute('aria-modal');
    },
  };
}

export function openDialogFrame(host: HTMLElement, options: DialogFrameOptions): DialogFrame {
  const id = nextDialogId('pc-dialog');
  const titleId = `${id}-title`;
  const title = h('div', { class: 'pc-dialog-title', id: titleId }, options.title);
  const close = iconButton({
    icon: X,
    label: options.closeLabel ?? 'Close',
    variant: 'ghost',
    onClick: () => options.onDismiss(),
  });
  const modal = options.modal !== false;
  const header = h('div', { class: 'pc-dialog-header' }, title, ...(options.headerControls ?? []), close);
  const panel = h('div', {
    class: `pc-dialog${modal ? '' : ' pc-dialog--panel'} ${options.className} ${dialogClassFor(host)}`.trim(),
    role: 'dialog',
  });
  if (options.header === false) panel.setAttribute('aria-label', options.title);
  else {
    panel.setAttribute('aria-labelledby', titleId);
    panel.append(header);
  }
  const backdrop = h('div', { class: modal ? 'pc-dialog-backdrop' : 'pc-dialog-backdrop pc-dialog-backdrop--panel' }, panel);
  const current = options.returnFocus ?? (document.activeElement as HTMLElement | null);
  const opener = current && current !== document.body && typeof current.focus === 'function' ? current : null;
  const binding = bindDialog(host, panel, { ...options, modal });
  host.append(backdrop);

  let open = true;
  return {
    backdrop,
    panel,
    header,
    get compact() {
      return binding.compact;
    },
    close() {
      if (!open) return;
      open = false;
      binding.release();
      const hadFocus = panel.contains(document.activeElement);
      removeFrame(backdrop, panel, modal);
      // A panel only hands focus back when it had it; the user may be working on the chart.
      if ((modal || hadFocus) && opener?.isConnected !== false) opener?.focus({ preventScroll: true });
    },
  };
}

/** What `confirmDialog` asks, and the labels of its buttons. */
export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel?: string;
  /** Style the confirm button as destructive, e.g. for a delete. */
  destructive?: boolean;
  /** Focused again on close. Default the element that had focus on open. */
  returnFocus?: HTMLElement | null;
  /** Aborting it dismisses the dialog, e.g. when its owner is destroyed. */
  signal?: AbortSignal;
}

/**
 * Ask a yes or no question in a small modal over `host`, which may stack over
 * another dialog. Resolves true when confirmed; Cancel, Escape, the close
 * button and a press outside resolve false. Focus starts on Cancel.
 */
export function confirmDialog(host: HTMLElement, options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      frame.close();
      resolve(ok);
    };
    const frame = openDialogFrame(host, {
      title: options.title,
      className: 'pc-confirm',
      onDismiss: () => done(false),
      onOutside: () => done(false),
      closeLabel: options.closeLabel,
      returnFocus: options.returnFocus,
    });
    options.signal?.addEventListener('abort', () => done(false), { once: true });
    const messageId = nextDialogId('pc-confirm');
    frame.panel.setAttribute('role', 'alertdialog');
    frame.panel.setAttribute('aria-describedby', messageId);
    const cancel = dialogButton(options.cancelLabel, false, () => done(false));
    const ok = button({ label: options.confirmLabel, variant: 'neutral', onClick: () => done(true) });
    ok.className += options.destructive ? ' pc-btn--danger' : ' pc-btn--primary';
    frame.panel.append(
      h('p', { class: 'pc-confirm-message', id: messageId }, options.message),
      h('div', { class: 'pc-dialog-footer' }, h('div', { class: 'pc-dialog-actions' }, cancel, ok)),
    );
    cancel.focus({ preventScroll: true });
  });
}

/** Internal: a dialog footer button, named `action` in `data-action` when given; a `primary` one is the filled default action. */
export function dialogButton(label: string, primary: boolean, onClick: () => void, action?: string): HTMLButtonElement {
  const el = button({ label, variant: primary ? 'neutral' : 'ghost', onClick });
  if (action) el.setAttribute('data-action', action);
  if (primary) el.className += ' pc-btn--primary';
  return el;
}

/** Remove a closed frame; a panel slides out and a modal fades out first, unless the user prefers reduced motion. */
function removeFrame(backdrop: HTMLElement, panel: HTMLElement, modal: boolean): void {
  const reduce = typeof matchMedia !== 'function' || prefersReducedMotion();
  if (modal) return fadeOutAndRemove(backdrop);
  if (reduce) return backdrop.remove();
  panel.setAttribute('data-closing', 'true');
  const done = () => backdrop.remove();
  panel.addEventListener('animationend', done, { once: true });
  // In case no animation runs (styles missing or turned off).
  setTimeout(done, 300);
}
