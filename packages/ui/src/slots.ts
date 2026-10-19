import type { Chart, ChartStatus } from '@chart-on/core';
import { h } from './dom';

/** App content for a shell slot: an element, or a function that builds one from the shell's chart. */
export type ShellSlotContent = Element | ((chart: Chart) => Element);

/**
 * Places in the shell where apps mount their own content. Each is rendered
 * once when the shell is created and removed by `destroy()`.
 */
export interface ShellSlots {
  /** Above the tool rail's buttons. Needs the rail; hides with it. */
  railTop?: ShellSlotContent;
  /** Below the tool rail's buttons. Needs the rail; hides with it. */
  railBottom?: ShellSlotContent;
  /** Before the range presets in the bottom bar. Needs the bottom bar. */
  bottomBarStart?: ShellSlotContent;
  /** After the scale toggles in the bottom bar. Needs the bottom bar. */
  bottomBarEnd?: ShellSlotContent;
  /** Shown over the chart instead of the chart's "Loading…" text while the status is `loading`. */
  loading?: ShellSlotContent;
  /** Shown over the chart instead of the chart's "No data" text while the status is `no-data`. */
  empty?: ShellSlotContent;
}

/** Extra class names for the shell's parts, added next to the built-in ones. */
export interface ShellClassNames {
  /** The `.pc-shell` element; added after `className`. */
  root?: string;
  toolbar?: string;
  rail?: string;
  bottomBar?: string;
  /** Dialogs and panels the shell opens inside itself: symbol search, Appearance, form and picker dialogs. */
  dialog?: string;
}

/** Add space-separated `classes` to `el`; nothing when empty. */
export function addClasses(el: Element, classes: string | undefined): void {
  const extra = classes?.trim();
  if (extra) el.className = `${el.className} ${extra}`.trim();
}

/**
 * The slot's wrapper (`.pc-slot.pc-slot--<name>`) holding the app's content,
 * or null when the slot is not set.
 */
export function renderSlot(name: string, content: ShellSlotContent | undefined, chart: Chart): HTMLElement | null {
  if (!content) return null;
  const el = h('div', { class: `pc-slot pc-slot--${name}` });
  el.append(typeof content === 'function' ? content(chart) : content);
  return el;
}

export interface StatusSlotHandle {
  /** The overlay over the chart; hidden while no slot content is shown. */
  readonly el: HTMLElement;
  /** Which slot is on screen, or null. */
  readonly showing: 'loading' | 'empty' | null;
  destroy(): void;
}

/** The slot that stands in for a status, if the app gave one. */
function slotFor(status: ChartStatus | null, slots: { loading: HTMLElement | null; empty: HTMLElement | null }) {
  if (status?.kind === 'loading' && slots.loading) return { name: 'loading' as const, el: slots.loading };
  if (status?.kind === 'no-data' && slots.empty) return { name: 'empty' as const, el: slots.empty };
  return null;
}

/**
 * Show the `loading` and `empty` slots over the chart in place of its own
 * status text; other statuses (errors, reconnecting) keep the chart's text,
 * and a status an earlier listener prevented is left to it. Null when neither
 * slot is set.
 */
export function createStatusSlot(host: HTMLElement, chart: Chart, slots: ShellSlots): StatusSlotHandle | null {
  const loading = renderSlot('loading', slots.loading, chart);
  const empty = renderSlot('empty', slots.empty, chart);
  if (!loading && !empty) return null;
  const el = h('div', { class: 'pc-status-slot', role: 'status' });
  el.hidden = true;
  host.append(el);
  let showing: StatusSlotHandle['showing'] = null;

  const off = chart.on('status:change', (e) => {
    // A status the toast stack already took (loading over bars) is not the empty pane's.
    const slot = e.defaultPrevented ? null : slotFor(e.status, { loading, empty });
    if (slot) e.preventDefault();
    if (slot?.name === showing) return;
    showing = slot?.name ?? null;
    el.replaceChildren(...(slot ? [slot.el] : []));
    el.hidden = !slot;
  });
  // The chart may already show a status (a data source set at creation): emit it again so the slot takes over.
  const current = chart.getStatus();
  if (current) chart.setStatus(current);

  return {
    el,
    get showing() {
      return showing;
    },
    destroy() {
      off();
      el.remove();
    },
  };
}
