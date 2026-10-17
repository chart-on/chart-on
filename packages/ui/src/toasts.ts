import type { Chart, ChartStatus, NotifyEvent } from '@charton/core';
import { LoaderCircle, X } from 'lucide';
import { iconButton } from './controls';
import { fadeOutAndRemove, h, icon } from './dom';
import { keyOf, shellText } from './messages';

/** Returned by `createToastStack`: the stack's element and the toasts on screen, plus `dismissAll` and `destroy`. */
export interface ToastStackHandle {
  /** The stack over the chart (`.pc-toasts`). */
  readonly el: HTMLElement;
  /** Toasts on screen, oldest first. */
  readonly toasts: readonly HTMLElement[];
  /** Remove every toast. */
  dismissAll(): void;
  destroy(): void;
}

/** More toasts than this push the oldest one out. */
const MAX_TOASTS = 4;

/** The message key of a status the status toast can show (`status<Kind>`); the others fill an empty pane and stay there. */
const statusKey = (s: ChartStatus | null) => (s && ['loading', 'error', 'reconnecting', 'stale'].includes(s.kind) ? keyOf('status', s.kind) : undefined);

/**
 * The default answer to `chart.notify`: a stack of toasts over the chart. Each
 * dismisses itself after its `durationMs` (paused while hovered or focused)
 * or from its close button. Apps that call `preventDefault()` on `ui:notify`
 * show the message their own way instead.
 *
 * The stack also shows the chart status that would cover bars (reconnecting,
 * stale, and loading or error once bars are on screen) as one status toast in
 * place of the in-pane text, until the status clears.
 */
export function createToastStack(host: HTMLElement, chart: Chart): ToastStackHandle {
  const el = h('div', { class: 'pc-toasts' });
  host.append(el);
  const live: { el: HTMLElement; dismiss: () => void }[] = [];
  let destroyed = false;

  const show = (e: NotifyEvent) => {
    const toast = h('div', { class: `pc-toast pc-toast--${e.kind}`, role: e.kind === 'error' ? 'alert' : 'status' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remaining = e.durationMs;
    let startedAt = 0;
    const dismiss = () => {
      clearTimeout(timer);
      timer = undefined;
      fadeOutAndRemove(toast);
      const at = live.findIndex((t) => t.el === toast);
      if (at >= 0) live.splice(at, 1);
    };
    const start = () => {
      if (timer !== undefined || e.durationMs <= 0 || remaining <= 0) return;
      startedAt = Date.now();
      timer = setTimeout(dismiss, remaining);
    };
    const pause = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };
    // Reading a message must not race its timer.
    toast.addEventListener('pointerenter', pause);
    toast.addEventListener('focusin', pause);
    toast.addEventListener('pointerleave', start);
    toast.addEventListener('focusout', start);
    const close = iconButton({ icon: X, label: shellText(chart, 'toastDismiss'), variant: 'ghost', onClick: dismiss });
    close.setAttribute('data-tip-side', 'top');
    toast.append(h('span', { class: 'pc-toast-message' }, e.message), close);
    el.append(toast);
    live.push({ el: toast, dismiss });
    while (live.length > MAX_TOASTS) live[0]!.dismiss();
    start();
  };

  const off = chart.on('ui:notify', (e) => {
    // Decide after every listener ran, so one added after the shell can still prevent it.
    queueMicrotask(() => {
      if (!destroyed && !e.defaultPrevented) show(e);
    });
  });

  // One status toast, updated in place. Its content changes only with the status, so it is announced once.
  let status: HTMLElement | null = null;
  let shown = '';
  const offStatus = chart.on('status:change', (e) => {
    const s = e.status;
    const key = statusKey(s);
    // Loading and errors with no bars yet keep the pane's own text.
    if (!s || !key || (s.kind !== 'reconnecting' && s.kind !== 'stale' && chart.mainBars.length === 0)) {
      status?.remove();
      status = null;
      shown = '';
      return;
    }
    e.preventDefault();
    showStatus(s, key);
  });
  function showStatus(s: ChartStatus, key: string): void {
    const text = s.message ?? chart.localization.text(key);
    if (shown === s.kind + text) return;
    shown = s.kind + text;
    const error = s.kind === 'error';
    status ??= el.insertBefore(h('div'), el.firstElementChild);
    status.className = `pc-toast pc-toast--${error ? 'error' : 'info'} pc-toast--status`;
    status.setAttribute('role', error ? 'alert' : 'status');
    const busy = s.kind === 'loading' || s.kind === 'reconnecting';
    status.replaceChildren(...(busy ? [icon(LoaderCircle)] : []), h('span', { class: 'pc-toast-message' }, text));
  }
  // A language change rewrites the status toast's built-in text.
  const offLanguage = chart.on('localization:change', () => {
    const s = chart.getStatus();
    const key = statusKey(s);
    if (status && s && key) showStatus(s, key);
  });
  // The chart may already show a status (a data source set at creation): emit it again so the toast takes over.
  const current = chart.getStatus();
  if (current) chart.setStatus(current);

  const dismissAll = () => [...live].forEach((t) => t.dismiss());
  return {
    el,
    get toasts() {
      return live.map((t) => t.el);
    },
    dismissAll,
    destroy() {
      destroyed = true;
      off();
      offStatus();
      offLanguage();
      dismissAll();
      el.remove();
    },
  };
}

/** The shell's `toasts` part, made by `toasts()`: the shell calls it with the stage over the chart. */
export type ToastsPart = (host: HTMLElement, chart: Chart) => ToastStackHandle;

/**
 * Toasts for the shell's `toasts` option: `chart.notify` messages, and statuses
 * that would cover bars, as a stack over the chart. Left out, statuses keep the
 * chart's in-pane text and messages are only emitted as `ui:notify`.
 */
export function toasts(): ToastsPart {
  return createToastStack;
}
