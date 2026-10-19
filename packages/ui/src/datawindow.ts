import type { Chart, LegendEntry, Time, ValuesAt } from '@chart-on/core';
import { h } from './dom';

/** Options for `createDataWindow`: its heading. */
export interface DataWindowOptions {
  /** Heading and accessible name. Default `Data window`. */
  title?: string;
}

/** Returned by `createDataWindow`: the panel element, plus `refresh` and `destroy`. */
export interface DataWindowHandle {
  /** Hide or show it with `el.hidden`; it skips updates while hidden. */
  el: HTMLElement;
  /** Re-read values now, e.g. after data changes while the pointer is away. */
  refresh(): void;
  destroy(): void;
}

/** How often to re-read values so live ticks show up (ms). */
const REFRESH_MS = 1000;

/**
 * Panel listing every visible series value at the crosshair, or the newest
 * bar, formatted like the legend. Focus it and use the arrow keys (Home/End
 * for the ends, Escape to release) to step bar by bar; the time and values are
 * announced politely to screen readers on focus and on each step.
 * Requires `@chart-on/ui/style.css`.
 */
export function createDataWindow(host: HTMLElement, chart: Chart, options: DataWindowOptions = {}): DataWindowHandle {
  const title = options.title ?? 'Data window';
  const time = h('span', { class: 'pc-dw-time' });
  const body = h('div', { class: 'pc-dw-body' });
  // Visually hidden live region, written only on focus and steps: periodic and
  // pointer-driven refreshes of the visible panel stay silent.
  const live = h('div', { class: 'pc-dw-live', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const el = h(
    'section',
    { class: 'pc-data-window', role: 'region', 'aria-label': title, tabindex: '0' },
    h('header', { class: 'pc-dw-head' }, h('span', { class: 'pc-dw-heading' }, title), time),
    body,
    live,
  );
  /** Time of the bar chosen with the keyboard; null follows the crosshair (or the newest bar). */
  let stepped: Time | null = null;
  let lastKey = '';
  let frame = 0;
  /** Write the live region on the next render (focus or a keyboard step). */
  let announce = false;

  const render = () => {
    frame = 0;
    if (el.hidden) return;
    const data = chart.valuesAt(stepped ?? undefined);
    if (announce) {
      announce = false;
      live.textContent = data ? spoken(data) : '';
    }
    const key = JSON.stringify(data && [data.timeText, data.series.map((s) => s.series.visible && s.legend)]);
    if (key === lastKey) return;
    lastKey = key;
    time.textContent = data?.timeText ?? '';
    body.replaceChildren(...(data ? groups(data) : []));
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  const step = (index: number) => {
    const last = chart.timeline.lastIndex;
    if (last < 0) return;
    // Stored as a time, like the mirrored crosshair, so both survive history prepends and reloads.
    stepped = chart.timeline.timeFromIndex(Math.max(0, Math.min(last, index)));
    chart.setCrosshairAt(stepped);
    announce = true;
    schedule();
  };

  const release = () => {
    if (stepped === null) return;
    stepped = null;
    chart.setCrosshairAt(null);
    schedule();
  };

  el.addEventListener('keydown', (e) => {
    const current = chart.valuesAt(stepped ?? undefined)?.index ?? chart.timeline.lastIndex;
    if (e.key === 'ArrowLeft') step(current - 1);
    else if (e.key === 'ArrowRight') step(current + 1);
    else if (e.key === 'Home') step(0);
    else if (e.key === 'End') step(chart.timeline.lastIndex);
    else if (e.key === 'Escape' && stepped !== null) release();
    else return;
    e.preventDefault();
  });
  el.addEventListener('focusin', () => {
    announce = true;
    schedule();
  });
  el.addEventListener('focusout', () => {
    live.textContent = '';
    release();
  });

  const off = [
    chart.on('crosshair:move', (e) => {
      // The pointer leaving the chart (e.g. onto this panel) emits null; keep the keyboard position then.
      if (e) stepped = null;
      schedule();
    }),
    chart.on('view:change', schedule),
    // Maximizing a pane hides the others' series, as in the legend.
    chart.on('panes:change', schedule),
  ];
  // Live ticks have no event; re-read cheaply (renders only when the text changed).
  const timer = setInterval(schedule, REFRESH_MS);

  host.append(el);
  render();

  return {
    el,
    refresh: render,
    destroy() {
      release();
      off.forEach((unsubscribe) => unsubscribe());
      clearInterval(timer);
      cancelAnimationFrame(frame);
      el.remove();
    },
  };
}

/** Internal: legends of the visible series that have something to show. */
export function shownLegends(data: ValuesAt): LegendEntry[] {
  return data.series
    .filter((s) => s.series.visible && s.legend && (s.legend.title || s.legend.parts.length > 0))
    .map((s) => s.legend!);
}

/** One sentence per series, led by the time, for the live region. */
function spoken(data: ValuesAt): string {
  const lines = shownLegends(data).map((legend) => {
    const values = legend.parts.map((part) => `${part.label ?? 'Value'} ${part.text}`).join(', ');
    return [legend.title, values].filter(Boolean).join(': ');
  });
  return [data.timeText, ...lines].join('. ');
}

function groups(data: ValuesAt): HTMLElement[] {
  return shownLegends(data).map((legend) => {
    const rows = h('dl', { class: 'pc-dw-rows' });
    for (const part of legend.parts) {
      const value = h('dd', {}, part.text);
      if (part.color) value.style.color = part.color;
      rows.append(h('dt', {}, part.label ?? 'Value'), value);
    }
    return h('div', { class: 'pc-dw-group' }, h('div', { class: 'pc-dw-title' }, legend.title), rows);
  });
}
