import type { Chart, Time } from '@chart-on/core';
import { h } from './dom';
import { shellText } from './messages';
import {
  centerWindow,
  decimate,
  panWindow,
  rangeFromWindow,
  refreshLastColumn,
  resizeWindow,
  windowFromRange,
  type NavigatorOverview,
  type NavigatorPoint,
  type NavigatorWindow,
} from './navigator-model';
import { retainTips } from './tooltip';

/** Anything with time-ordered points: the main candles, a line or a histogram series. */
export interface NavigatorSeries {
  readonly data: readonly NavigatorPoint[];
}

/** Options for `createNavigator`: the strip's height and the series its overview draws. */
export interface NavigatorOptions {
  /** Strip height in css px. Default 40. */
  height?: number;
  /** Series whose closes (or values) the overview draws. Default: the chart's main series. */
  series?: NavigatorSeries;
}

/** Returned by `createNavigator`: the overview strip's element, plus `refresh` and `destroy`. */
export interface NavigatorHandle {
  el: HTMLElement;
  /** Re-read the data and the visible range and redraw now. */
  refresh(): void;
  destroy(): void;
}

/** Narrowest window the handles can make, in css px, so both stay grabbable. */
const MIN_WINDOW_PX = 12;
/** Arrow keys move the window by this share of its width. */
const PAN_STEP = 0.25;
/** Arrow keys on a handle move it by this share of the history, Page Up/Down by ten times as much. */
const EDGE_STEP = 0.01;
/** Opacity of the area under the overview line. */
const FILL_ALPHA = 0.12;

type Drag =
  | { kind: 'pan'; pointer: number; startX: number; from: NavigatorWindow }
  | { kind: 'start' | 'end'; pointer: number };

/**
 * An overview strip: a miniature line of the whole history with a window
 * over the visible part. Drag the window to pan and its edges to zoom, or
 * click the strip to centre the window there; the arrow keys do the same.
 * The chart follows through `setVisibleTimeRange(from, to, false)`, and the
 * window follows pans, zooms and data changes from anywhere else.
 */
export function createNavigator(host: HTMLElement, chart: Chart, options: NavigatorOptions = {}): NavigatorHandle {
  const height = options.height ?? 40;
  const canvas = h('canvas', { class: 'pc-navigator-line', 'aria-hidden': 'true' });
  const before = h('div', { class: 'pc-navigator-shade' });
  const after = h('div', { class: 'pc-navigator-shade' });
  const slider = (cls: string, label: string) =>
    h('div', { class: cls, role: 'slider', tabindex: '0', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100' });
  const win = slider('pc-navigator-window', 'Visible range');
  const startHandle = slider('pc-navigator-handle', 'Start of visible range');
  const endHandle = slider('pc-navigator-handle', 'End of visible range');
  startHandle.dataset.edge = 'start';
  endHandle.dataset.edge = 'end';
  const el = h('div', { class: 'pc-navigator', role: 'group' });
  const relabel = () => el.setAttribute('aria-label', shellText(chart, 'navigatorLabel'));
  relabel();
  el.style.height = `${height}px`;
  el.append(canvas, before, after, win, startHandle, endHandle);
  host.append(el);

  let overview: NavigatorOverview | null = null;
  // What the overview was built from, to tell a live tick from new data.
  let builtFrom: readonly NavigatorPoint[] | null = null;
  let builtLength = -1;
  let builtWidth = -1;
  let shown: NavigatorWindow | null = null;
  let drag: Drag | null = null;
  let applied: { from: Time; to: Time } | null = null;
  let frame = 0;

  const points = (): readonly NavigatorPoint[] => options.series?.data ?? chart.main?.data ?? [];
  const width = () => el.getBoundingClientRect().width;
  const minWidth = (n: number, w: number) => Math.max(n > 1 ? 1 / (n - 1) : 1, w > 0 ? MIN_WINDOW_PX / w : 0);

  const color = (name: string, fallback: string): string => {
    const value = typeof getComputedStyle === 'function' ? getComputedStyle(el).getPropertyValue(name).trim() : '';
    return value || fallback;
  };

  const draw = (w: number) => {
    const ctx = canvas.getContext('2d');
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${height}px`;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    const o = overview;
    if (!o || o.count < 2 || !(o.max >= o.min)) return;
    const pad = 3;
    const span = o.max - o.min || 1;
    const y = (v: number) => pad + (1 - (v - o.min) / span) * (height - pad * 2);
    const x = (c: number) => (c / (o.count - 1)) * w;
    // One path through every column: in at its first value, down and up its range, out at its last.
    ctx.beginPath();
    let started = false;
    let firstX = 0;
    let lastX = 0;
    for (let c = 0; c < o.count; c++) {
      const first = o.cols[c * 4]!;
      if (first !== first) continue;
      const cx = x(c);
      if (!started) {
        ctx.moveTo(cx, y(first));
        firstX = cx;
        started = true;
      } else ctx.lineTo(cx, y(first));
      ctx.lineTo(cx, y(o.cols[c * 4 + 1]!));
      ctx.lineTo(cx, y(o.cols[c * 4 + 2]!));
      ctx.lineTo(cx, y(o.cols[c * 4 + 3]!));
      lastX = cx;
    }
    if (!started) return;
    const line = color('--pc-navigator-line', '#8b8b99');
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.stroke();
    // A faint area under the line, in the line's own colour.
    ctx.lineTo(lastX, height);
    ctx.lineTo(firstX, height);
    ctx.closePath();
    ctx.fillStyle = line;
    ctx.globalAlpha = FILL_ALPHA;
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  const place = (w: NavigatorWindow | null) => {
    const visible = w !== null;
    for (const part of [before, after, win, startHandle, endHandle]) part.hidden = !visible;
    el.dataset.empty = String(!visible);
    if (!w) return;
    const pct = (f: number) => `${(f * 100).toFixed(3)}%`;
    before.style.left = '0';
    before.style.width = pct(w.start);
    after.style.left = pct(w.end);
    after.style.width = pct(1 - w.end);
    win.style.left = pct(w.start);
    win.style.width = pct(w.end - w.start);
    startHandle.style.left = pct(w.start);
    endHandle.style.left = pct(w.end);
    const range = rangeFromWindow(points(), w);
    const text = range ? `${chart.formatTime(range.from)} to ${chart.formatTime(range.to)}` : '';
    const now = (f: number) => String(Math.round(f * 100));
    win.setAttribute('aria-valuenow', now(w.start));
    win.setAttribute('aria-valuetext', text);
    startHandle.setAttribute('aria-valuenow', now(w.start));
    startHandle.setAttribute('aria-valuetext', range ? chart.formatTime(range.from) : '');
    endHandle.setAttribute('aria-valuenow', now(w.end));
    endHandle.setAttribute('aria-valuetext', range ? chart.formatTime(range.to) : '');
  };

  const syncFeatures = () => {
    const { scroll, zoom } = chart.features;
    el.dataset.scroll = String(scroll);
    startHandle.hidden ||= !zoom;
    endHandle.hidden ||= !zoom;
    for (const part of [win, startHandle, endHandle]) part.setAttribute('aria-disabled', String(part === win ? !scroll : !zoom));
  };

  const render = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    const data = points();
    const w = width();
    const n = data.length;
    if (data !== builtFrom || n !== builtLength || w !== builtWidth || !overview) {
      overview = decimate(data, w, overview ?? undefined);
      builtFrom = data;
      builtLength = n;
      builtWidth = w;
    } else {
      // Same series and length: a live tick changed the newest point.
      refreshLastColumn(data, overview, w);
    }
    draw(w);
    // While dragging, show the window being asked for, not the chart's rounded one.
    if (!drag) {
      const range = chart.getVisibleRange();
      shown = range ? windowFromRange(data, range) : null;
    }
    place(shown);
    syncFeatures();
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  /** Show `next` on the chart, skipping the call when the edges land on the same bars as last time. */
  const apply = (next: NavigatorWindow) => {
    shown = next;
    const range = rangeFromWindow(points(), next);
    if (!range) return;
    if (!applied || applied.from !== range.from || applied.to !== range.to) {
      applied = range;
      chart.setVisibleTimeRange(range.from, range.to, false);
    }
    place(shown);
    syncFeatures();
  };

  const fractionAt = (clientX: number): number => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !shown || drag) return;
    const { scroll, zoom } = chart.features;
    const edge = (e.target as HTMLElement).dataset?.edge as 'start' | 'end' | undefined;
    const at = fractionAt(e.clientX);
    if (edge) {
      if (!zoom) return;
      drag = { kind: edge, pointer: e.pointerId };
    } else {
      if (!scroll) return;
      // A press outside the window jumps it there first, then drags as usual.
      if (e.target !== win) apply(centerWindow(shown, at));
      drag = { kind: 'pan', pointer: e.pointerId, startX: at, from: shown };
    }
    applied = null;
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    el.dataset.dragging = drag.kind;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer || !shown) return;
    const at = fractionAt(e.clientX);
    if (drag.kind === 'pan') apply(panWindow(drag.from, at - drag.startX));
    else apply(resizeWindow(shown, drag.kind, at, minWidth(points().length, width())));
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    drag = null;
    delete el.dataset.dragging;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    // Snap to what the chart actually shows, after its limits.
    render();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!shown) return;
    const target = e.target as HTMLElement;
    const { scroll, zoom } = chart.features;
    let next: NavigatorWindow | null = null;
    if (target === win) {
      if (!scroll) return;
      const step = (shown.end - shown.start) * (e.key.startsWith('Page') ? 1 : PAN_STEP);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown') next = panWindow(shown, -step);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') next = panWindow(shown, step);
      else if (e.key === 'Home') next = panWindow(shown, -shown.start);
      else if (e.key === 'End') next = panWindow(shown, 1 - shown.end);
    } else if (target === startHandle || target === endHandle) {
      if (!zoom) return;
      const edge = target === startHandle ? 'start' : 'end';
      const n = points().length;
      const step = Math.max(n > 1 ? 1 / (n - 1) : 0, EDGE_STEP) * (e.key.startsWith('Page') ? 10 : 1);
      const at = shown[edge];
      const min = minWidth(n, width());
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown') next = resizeWindow(shown, edge, at - step, min);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') next = resizeWindow(shown, edge, at + step, min);
      else if (e.key === 'Home') next = resizeWindow(shown, edge, 0, min);
      else if (e.key === 'End') next = resizeWindow(shown, edge, 1, min);
    }
    if (!next) return;
    e.preventDefault();
    applied = null;
    apply(next);
    render();
  };

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('keydown', onKeyDown);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  resize?.observe(el);
  const offs = [
    // Also fires when the bars change, so live updates reach the overview without `data:bar`.
    chart.on('view:change', schedule),
    chart.on('data:loaded', schedule),
    chart.on('data:bar', schedule),
    chart.on('chart:resize', schedule),
    chart.on('theme:change', schedule),
    chart.on('localization:change', relabel),
  ];
  render();

  const releaseTips = retainTips();
  return {
    el,
    refresh: render,
    destroy() {
      releaseTips();
      offs.forEach((off) => off());
      resize?.disconnect();
      cancelAnimationFrame(frame);
      el.remove();
    },
  };
}
