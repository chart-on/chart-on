import { pluralText, type Chart, type ClusterClickEvent, type TradeLine } from '@chart-on/core';
import { X } from 'lucide';
import { fadeOutAndRemove, h, icon, isolateFromChart, onDismiss, placeAtOrigin } from './dom';
import { shellText, type Localized } from './messages';
import { devRequirePlugin } from './options-schema';

/** Returned by `createClusterList`: the open list of a folded order-label cluster, if any, with `close` and `destroy`. */
export interface ClusterListHandle {
  /** The open list, or null. */
  readonly el: HTMLElement | null;
  close(): void;
  destroy(): void;
}

/**
 * One order in the list: side or label, quantity and price, e.g. "Buy 2 @ 101.50".
 * The side is in the language of `options` (`clusterBuy`, `clusterSell`, `clusterLong`, `clusterShort`).
 */
export function clusterRowText(line: TradeLine, format: (price: number) => string, options?: Localized): string {
  const o = line.options;
  const buy = o.side === 'buy';
  const label = o.label ?? shellText(options, o.kind === 'position' ? (buy ? 'clusterLong' : 'clusterShort') : buy ? 'clusterBuy' : 'clusterSell');
  const qty = o.quantity !== undefined && o.quantity !== '' ? ` ${String(o.quantity)}` : '';
  return `${label}${qty} @ ${format(o.price)}`;
}

/** Whether a line in the list gets a cancel button: it handles actions and has cancel among them. */
export function canCancel(line: TradeLine): boolean {
  return Boolean(line.options.onAction) && line.options.actions.includes('cancel');
}

/**
 * The default answer to clicking a folded cluster of order labels: a list of
 * its orders next to the label, each with a cancel button. Apps that call
 * `preventDefault()` in `onClusterClick` show their own UI instead.
 */
export function createClusterList(chart: Chart): ClusterListHandle {
  let list: HTMLElement | null = null;
  let dispose: (() => void) | null = null;

  const close = () => {
    if (list) fadeOutAndRemove(list);
    list = null;
    dispose?.();
    dispose = null;
  };

  const open = (e: ClusterClickEvent) => {
    close();
    if (e.defaultPrevented) return;
    const el = h('div', { class: 'pc-popover pc-cluster-list', role: 'dialog', 'aria-label': pluralText(chart.localization, 'clusterOrders', e.lines.length, { count: e.lines.length }, shellText(chart, 'clusterOrders', { count: e.lines.length })) });
    const format = (price: number) => chart.formatPrice(0, price);
    for (const line of e.lines) {
      const row = h('div', { class: 'pc-cluster-row' }, h('span', {}, clusterRowText(line, format, chart)));
      if (canCancel(line)) {
        const cancel = h('button', { class: 'pc-cluster-cancel', 'aria-label': shellText(chart, 'clusterCancel', { name: clusterRowText(line, format, chart) }) });
        cancel.append(icon(X, 14));
        cancel.addEventListener('click', () => {
          line.options.onAction?.({ action: 'cancel', part: 'entry' });
          row.remove();
          if (!el.querySelector('.pc-cluster-row')) close();
        });
        row.append(cancel);
      }
      el.append(row);
    }
    // Presses inside must not pan the chart or start a drawing.
    isolateFromChart(el);
    placeAtOrigin(el);
    chart.root.append(el);
    // Anchor is chart-root css px; place the list left of the label, kept inside the chart.
    const w = el.offsetWidth;
    const x = Math.max(4, Math.min(chart.width - w - 4, e.anchor.x - w - 8));
    const y = Math.max(4, Math.min(chart.height - el.offsetHeight - 4, e.anchor.y - 12));
    Object.assign(el.style, { left: `${Math.round(x)}px`, top: `${Math.round(y)}px` });
    list = el;
    dispose = onDismiss(el, close);
    (el.querySelector('button') as HTMLElement | null)?.focus();
  };

  const off = chart.on('annotations:cluster', open);
  return {
    get el() {
      return list;
    },
    close,
    destroy() {
      close();
      off();
    },
  };
}

/** The shell's `clusterList` part, made by `clusterList()`: the shell calls it with its chart. */
export type ClusterListPart = (chart: Chart) => ClusterListHandle;

/**
 * The order list for the shell's `clusterList` option: clicking a folded
 * cluster of order labels lists its orders, with cancel buttons. Needs the
 * `trading()` plugin. Without it `annotations:cluster` is left to the app.
 */
export function clusterList(): ClusterListPart {
  return (chart) => {
    devRequirePlugin(chart, 'clusterList', 'trading');
    return createClusterList(chart);
  };
}
