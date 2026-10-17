import { formatCompact, type DepthBook, type DepthLane, type Localizer } from '@charton/core';
import { h } from './dom';
import { shellText } from './messages';

/** Options for `createDepthLadder`: its heading, the levels listed per side, and how prices and sizes are formatted. */
export interface DepthLadderOptions {
  /** Heading and accessible name. Default `Order book` in the `localization` language (message `ladderTitle`). */
  title?: string;
  /** Levels listed per side. Default 10. */
  depth?: number;
  /** Price text; defaults to the number as is. Pass `chart.formatPrice` bound to a pane to match the axis. */
  formatPrice?: (price: number) => string;
  /** Size text; defaults to a compact number (1.2K). */
  formatSize?: (size: number) => string;
  /** Language of the built-in text (title and column headings), e.g. `chart.localization`; read when the ladder is made. */
  localization?: Localizer;
}

/** Returned by `createDepthLadder`: the panel element, plus `refresh` and `destroy`. */
export interface DepthLadderHandle {
  /** Hide or show it with `el.hidden`; it skips updates while hidden. */
  el: HTMLElement;
  /** Re-read the lane's levels now. */
  refresh(): void;
  destroy(): void;
}

/** One ladder row: `fill` is the size relative to the largest listed, 0…1. */
export interface DepthLadderRow {
  side: 'bid' | 'ask';
  price: number;
  size: number;
  fill: number;
  best: boolean;
}

/**
 * Rows of the ladder, top to bottom: the `depth` asks nearest the spread
 * with the highest price first, then the `depth` best bids, highest first.
 * So the best ask sits right above the best bid.
 */
export function depthLadderRows(book: DepthBook, depth: number): DepthLadderRow[] {
  const n = Math.max(0, Math.floor(depth));
  const asks = book.asks.slice(0, n);
  const bids = book.bids.slice(0, n);
  const max = Math.max(0, ...asks.map((l) => l.size), ...bids.map((l) => l.size));
  const row = (side: DepthLadderRow['side'], l: { price: number; size: number }, best: boolean): DepthLadderRow => ({
    side,
    price: l.price,
    size: l.size,
    fill: max > 0 ? l.size / max : 0,
    best,
  });
  return [
    ...asks.map((l, i) => row('ask', l, i === 0)).reverse(),
    ...bids.map((l, i) => row('bid', l, i === 0)),
  ];
}

/**
 * Panel listing a depth lane's levels as a price ladder, asks above bids,
 * each row shaded by its size. Built only on the lane's public handle, so it
 * works with any lane the app feeds. Updates at most once per animation frame.
 * Requires `@charton/ui/style.css`.
 */
export function createDepthLadder(host: HTMLElement, lane: DepthLane, options: DepthLadderOptions = {}): DepthLadderHandle {
  const title = options.title ?? shellText(options, 'ladderTitle');
  const depth = options.depth ?? 10;
  const price = options.formatPrice ?? ((p: number) => String(p));
  const size = options.formatSize ?? formatCompact;
  const body = h('div', { class: 'pc-ladder-rows', role: 'table', 'aria-label': title });
  const el = h(
    'section',
    { class: 'pc-depth-ladder', role: 'region', 'aria-label': title },
    h('header', { class: 'pc-ladder-head' }, h('span', {}, shellText(options, 'seriesPrice')), h('span', {}, shellText(options, 'ladderSize'))),
    body,
  );
  let frame = 0;

  const render = () => {
    frame = 0;
    if (el.hidden) return;
    body.replaceChildren(
      ...depthLadderRows(lane.levels, depth).map((r) => {
        return h(
          'div',
          {
            class: `pc-ladder-row pc-ladder-${r.side}${r.best ? ' pc-ladder-best' : ''}`,
            role: 'row',
            style: `--pc-ladder-fill: ${Math.round(r.fill * 100)}%`,
          },
          h('span', { role: 'cell' }, price(r.price)),
          h('span', { role: 'cell' }, size(r.size)),
        );
      }),
    );
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };
  const off = lane.on('levels:change', schedule);

  host.append(el);
  render();

  return {
    el,
    refresh: render,
    destroy() {
      off();
      cancelAnimationFrame(frame);
      el.remove();
    },
  };
}
