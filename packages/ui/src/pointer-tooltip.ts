import type { Chart, CrosshairEvent, ValuesAt } from '@chart-on/core';
import { shownLegends } from './datawindow';
import { h } from './dom';

/** Options for `createPointerTooltip`: its content, how long to wait before showing, and whether it follows the crosshair or sits at the top. */
export interface PointerTooltipOptions {
  /**
   * Content for the bar under the crosshair: text, an element, or null to
   * show nothing there. Default: the time, then each visible series' values
   * as the legend formats them.
   */
  format?: (values: ValuesAt) => string | Node | null;
  /** Wait this long (ms) after the crosshair appears before showing. Default 0. */
  delay?: number;
  /** `pointer` sits level with the crosshair; `top` pins it to the top of the plot. Default `pointer`. */
  anchor?: 'pointer' | 'top';
}

/** Returned by `createPointerTooltip`: the tooltip's element, plus `refresh` and `destroy`. */
export interface PointerTooltipHandle {
  el: HTMLElement;
  /** Re-read values and placement now. */
  refresh(): void;
  destroy(): void;
}

/** Space between the hovered bar's slot and the tooltip (css px). */
const GAP = 12;
/** Space kept between the tooltip and the plot edges (css px). */
const INSET = 4;
/** How often to re-read values while shown, so live ticks show up (ms). */
const REFRESH_MS = 1000;

/**
 * Where to put a tooltip of `size` beside the hovered bar inside `area` (plot
 * css px). It goes right of the bar's slot, or left when only that side has
 * room, so it never covers the bar; vertically it is centred on `y`, or at
 * the top when `y` is null, and kept inside the area. Only when neither side
 * has room does it take the roomier side, clamped into the area.
 */
export function placePointerTooltip(
  bar: { x: number; halfWidth: number },
  y: number | null,
  size: { width: number; height: number },
  area: { width: number; height: number },
): { x: number; y: number } {
  const clamp = (v: number, max: number) => Math.round(Math.max(INSET, Math.min(max - INSET, v)));
  const right = bar.x + bar.halfWidth + GAP;
  const left = bar.x - bar.halfWidth - GAP - size.width;
  const fitsRight = right + size.width <= area.width - INSET;
  const fitsLeft = left >= INSET;
  const roomRight = area.width - right;
  const roomLeft = bar.x - bar.halfWidth - GAP;
  const x = fitsRight || (!fitsLeft && roomRight >= roomLeft) ? right : left;
  return {
    x: clamp(x, area.width - size.width),
    y: y === null ? INSET : clamp(y - size.height / 2, area.height - size.height),
  };
}

/** Default content: the time, then one line per visible series with its legend values. */
export function pointerTooltipContent(data: ValuesAt): HTMLElement {
  const box = h('div', {}, h('div', { class: 'pc-ptip-time' }, data.timeText));
  for (const legend of shownLegends(data)) {
    const row = h('div', { class: 'pc-ptip-row' });
    if (legend.title) row.append(h('span', { class: 'pc-ptip-title' }, legend.title));
    for (const part of legend.parts) {
      const value = h('span', { class: 'pc-ptip-value' }, part.text);
      if (part.color) value.style.color = part.color;
      const pair = h('span', { class: 'pc-ptip-part' });
      if (part.label) pair.append(h('span', { class: 'pc-ptip-label' }, part.label));
      pair.append(value);
      row.append(pair);
    }
    box.append(row);
  }
  return box;
}

/**
 * Small box beside the pointer with the values of the bar under the
 * crosshair, for embeds that turn the legend off. It sits beside the bar, so
 * it never covers it, and stays inside the plot. On touch it shows only while
 * a long-press inspects (see the chart's `touchInspect` option) or the
 * crosshair is locked, so a plain pan does not flash it. The legend and the
 * data window carry the same values for assistive technology, so it is
 * hidden from it. Requires `@chart-on/ui/style.css` (`--pc-tip-*` tokens).
 */
export function createPointerTooltip(chart: Chart, options: PointerTooltipOptions = {}): PointerTooltipHandle {
  const format = options.format ?? pointerTooltipContent;
  const delay = Math.max(0, options.delay ?? 0);
  const el = h('div', { class: 'pc-pointer-tip', 'aria-hidden': 'true' });
  el.hidden = true;

  let event: CrosshairEvent | null = null;
  /** The last pointer was a finger. */
  let touch = false;
  /** The delay has passed for the crosshair now showing. */
  let ready = false;
  let wait: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;

  const wanted = () => event !== null && (event.locked || !touch || chart.inspecting);

  const hide = () => {
    el.hidden = true;
  };

  const render = () => {
    frame = 0;
    if (!event || !ready || !wanted()) return hide();
    const data = chart.valuesAt();
    const content = data && format(data);
    const x = data && chart.indexToX(data.index);
    if (!data || !content || x === null) return hide();
    if (typeof content === 'string') el.textContent = content;
    else el.replaceChildren(content);
    el.hidden = false;
    const y = options.anchor === 'top' || !Number.isFinite(event.price) ? null : chart.priceToY(event.price, event.pane);
    const at = placePointerTooltip(
      { x: x - chart.plotLeft, halfWidth: chart.barSpacing / 2 },
      y,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: chart.plotWidth, height: chart.plotHeight },
    );
    // The placement is in plot coordinates; left price axes push the plot right.
    el.style.transform = `translate(${at.x + chart.plotLeft}px, ${at.y}px)`;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  const onCrosshair = (e: CrosshairEvent | null) => {
    event = e;
    if (!wanted()) {
      // The delay starts over the next time it appears.
      clearTimeout(wait);
      wait = undefined;
      ready = false;
    } else if (!ready && wait === undefined) {
      if (delay === 0) ready = true;
      else
        wait = setTimeout(() => {
          wait = undefined;
          ready = true;
          schedule();
        }, delay);
    }
    schedule();
  };

  // Capture, so the pointer type is known before the chart's own handlers move the crosshair.
  const onPointer = (e: PointerEvent) => {
    touch = e.pointerType === 'touch';
  };
  chart.root.addEventListener('pointerdown', onPointer, true);
  chart.root.addEventListener('pointermove', onPointer, true);

  const offs = [
    chart.on('crosshair:move', onCrosshair),
    // Pan, zoom and resize move the bar under a locked crosshair.
    chart.on('view:change', schedule),
    chart.on('panes:change', schedule),
  ];
  const timer = setInterval(() => {
    if (!el.hidden) schedule();
  }, REFRESH_MS);
  chart.root.append(el);

  return {
    el,
    refresh: render,
    destroy() {
      offs.forEach((off) => off());
      chart.root.removeEventListener('pointerdown', onPointer, true);
      chart.root.removeEventListener('pointermove', onPointer, true);
      clearTimeout(wait);
      clearInterval(timer);
      cancelAnimationFrame(frame);
      el.remove();
    },
  };
}
