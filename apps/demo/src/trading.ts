import { button, iconButton } from '@charton/ui';
import type { BarMarker, BracketPart, CandleSeries, Chart, OrderCreateEvent, OrderSide, TradeLine, TradeLinePart } from '@charton/core';
import { HandCoins, X } from 'lucide';

const PART_NAMES: Record<TradeLinePart, string> = { entry: 'entry', takeProfit: 'take profit', stopLoss: 'stop loss' };
const MAX_LOG = 6;

/** How long the pretend server takes to accept a bracket. */
const SERVER_MS = 250;
/** Event glyphs in a 24 × 24 box: a page with two lines (holes wound the other way), and three bars. */
const NEWS_GLYPH = 'M5 3h10l4 4v14H5z M8 10v2h8v-2z M8 14v2h8v-2z';
const EARNINGS_GLYPH = 'M4 20V10h4v10z M10 20V4h4v16z M16 20v-7h4v7z';

/**
 * A collapsible panel that places, drags and cancels orders (trade lines) and
 * price alerts (alert lines), plus sample execution markers and a position.
 * Orders can also start as drafts on the chart. Nothing is sent anywhere: the
 * callbacks only log, and "cancel" or "remove" removes the line as a server
 * would after confirming.
 */
export function createTradingExample(chart: Chart, series: CandleSeries): void {
  const stage = chart.root.parentElement ?? chart.root;
  const toggle = button({ label: 'Trade', icon: HandCoins, variant: 'neutral', title: 'Open the trading example' });
  toggle.classList.add('demo-trade-toggle');
  const panel = document.createElement('section');
  panel.className = 'demo-trade';
  panel.setAttribute('aria-label', 'Trading example');
  panel.hidden = true;

  const title = document.createElement('strong');
  title.textContent = 'Trading example';
  const close = iconButton({ icon: X, label: 'Close the trading example', variant: 'ghost', onClick: () => setOpen(false) });
  const header = row(title, close);
  header.classList.add('demo-trade-header');

  const qty = document.createElement('input');
  qty.type = 'number';
  qty.min = '0.01';
  qty.step = '0.01';
  qty.value = '0.5';
  qty.setAttribute('aria-label', 'Quantity');
  const qtyLabel = labelled('Qty', qty);

  const brackets = document.createElement('input');
  brackets.type = 'checkbox';
  brackets.checked = true;
  const bracketsLabel = labelled('Take profit / stop loss', brackets);

  const buy = button({ label: 'Buy limit', variant: 'surface', onClick: () => placeOrder('buy') });
  const sell = button({ label: 'Sell limit', variant: 'surface', onClick: () => placeOrder('sell') });
  buy.classList.add('demo-trade-buy');
  sell.classList.add('demo-trade-sell');
  const draftBuy = button({ label: 'Draft buy', variant: 'surface', onClick: () => startDraft('buy') });
  const draftSell = button({ label: 'Draft sell', variant: 'surface', onClick: () => startDraft('sell') });
  const alertAbove = button({ label: 'Alert above', variant: 'surface', onClick: () => addAlert(1.005) });
  const alertBelow = button({ label: 'Alert below', variant: 'surface', onClick: () => addAlert(0.995) });

  const status = document.createElement('p');
  status.className = 'demo-trade-status';
  const hint = 'Place an order, a draft or an alert. Moving an order asks to confirm; drag ↕ out of an entry for a stop.';
  status.textContent = hint;
  const log = document.createElement('ol');
  log.className = 'demo-trade-log';
  log.setAttribute('aria-live', 'polite');

  panel.append(header, row(qtyLabel, bracketsLabel), row(buy, sell), row(draftBuy, draftSell), row(alertAbove, alertBelow), status, log);
  stage.append(toggle, panel);
  toggle.addEventListener('click', () => setOpen(true));

  const fmt = (price: number) => series.format(price);
  const lastClose = () => series.data[series.data.length - 1]?.close ?? 0;
  const tick = () => 10 ** -(series.options.precision ?? 2);
  const round = (price: number) => Math.round(price / tick()) * tick();

  function note(text: string): void {
    const item = document.createElement('li');
    item.textContent = text;
    log.prepend(item);
    while (log.children.length > MAX_LOG) log.lastElementChild?.remove();
  }

  function placeOrder(side: OrderSide): void {
    const last = lastClose();
    if (!last) return;
    const dir = side === 'buy' ? 1 : -1;
    const quantity = Math.max(0.01, Number(qty.value) || 0.5);
    const price = round(last * (1 - dir * 0.015));
    addOrder({
      side,
      type: 'limit',
      price,
      quantity,
      ...(brackets.checked ? { takeProfit: round(price * (1 + dir * 0.03)), stopLoss: round(price * (1 - dir * 0.015)) } : {}),
    });
  }

  /** A draft at `price`, or a little away from the last close; the user sets it up on the chart and places it. */
  function startDraft(side: OrderSide, price?: number): void {
    const last = lastClose();
    if (!last) return;
    for (const draft of chart.annotations.draftLines) draft.discard();
    const quantity = Math.max(0.01, Number(qty.value) || 0.5);
    chart.annotations.startOrderDraft({ side, price: price ?? round(last * (1 - (side === 'buy' ? 1 : -1) * 0.01)), quantity });
    status.textContent = 'Drag the draft, click its quantity or type, then ✓ to place it.';
  }

  // A placed draft becomes a working order, as if the server accepted it.
  chart.on('order:create', (order) => addOrder(order));

  function addOrder(order: OrderCreateEvent): void {
    const { side, price } = order;
    const name = `${side === 'buy' ? 'Buy' : 'Sell'} ${order.quantity ?? ''}`.trim();
    const line: TradeLine = chart.annotations.addTradeLine({
      kind: 'order',
      price,
      side,
      quantity: order.quantity,
      label: order.type === 'limit' ? undefined : `${side === 'buy' ? 'Buy' : 'Sell'} ${order.type}`,
      takeProfit: order.takeProfit ?? null,
      stopLoss: order.stopLoss ?? null,
      onDrag: ({ part, price: p }) => (status.textContent = `${name}: ${PART_NAMES[part]} → ${fmt(p)}`),
      // Orders confirm a move before onChange fires.
      onChange: ({ part, price: p, from }) => note(`${name}: ${PART_NAMES[part]} ${fmt(from)} → ${fmt(p)}`),
      onBracketCreate: ({ part, price: p }) => acceptBracket(line, name, part, p),
      // Orders only offer cancel, on the entry and on each bracket.
      onAction: ({ part }) => {
        if (part === 'entry') line.remove();
        else line.applyOptions(part === 'takeProfit' ? { takeProfit: null } : { stopLoss: null });
        note(`${name}: ${part === 'entry' ? 'order' : PART_NAMES[part]} cancelled`);
      },
    });
    note(`${name} ${order.type} @ ${fmt(price)} placed`);
  }

  /** The pretend server takes a bracket pulled out of a line after a moment. */
  function acceptBracket(line: TradeLine, name: string, part: BracketPart, price: number): void {
    status.textContent = `${name}: adding ${PART_NAMES[part]} at ${fmt(price)}…`;
    setTimeout(() => {
      line.applyOptions(part === 'takeProfit' ? { takeProfit: price } : { stopLoss: price });
      note(`${name}: ${PART_NAMES[part]} ${fmt(price)} added`);
    }, SERVER_MS);
  }

  function addSamples(): void {
    const bars = series.data;
    const at = (back: number) => bars[Math.max(0, bars.length - 1 - back)]!;
    const entryBar = at(40);
    // Signals stay bar markers; the account's fills go through setTrades.
    const signalBar = at(32);
    // Filled low in the bar, so the marker stays clear of the position line drawn at the entry close.
    const signalPrice = round(signalBar.low + (signalBar.high - signalBar.low) * 0.15);
    const markers: BarMarker[] = [
      { time: at(24).time, shape: 'circle', position: 'above', color: '#f59e0b' },
      { time: at(12).time, shape: 'square', position: 'inside', color: '#a855f7', text: 'News' },
      // A clickable execution at its price; without a colour it follows the theme.
      {
        id: 'signal-exec',
        time: signalBar.time,
        shape: 'arrow-right',
        position: 'atPrice',
        price: signalPrice,
        text: 'Exec',
        tooltip: [`Signal execution @ ${fmt(signalPrice)}`, 'Click for details'],
      },
    ];
    // An events lane along the bottom edge, with the app's own glyphs. On a longer interval
    // (e.g. weekly) events of one kind on one bar fold into one marker with a count.
    const event = (back: number, kind: 'news' | 'earnings', tooltip: string, severity: 1 | 2 | 3 = 2): BarMarker => ({
      time: at(back).time,
      shape: 'circle',
      position: 'bottom',
      kind,
      severity,
      color: kind === 'news' ? '#0ea5e9' : '#22c55e',
      icon: { svgPath: kind === 'news' ? NEWS_GLYPH : EARNINGS_GLYPH },
      tooltip,
    });
    markers.push(
      event(20, 'news', 'Rate decision', 3),
      event(19, 'news', 'Inflation report'),
      event(19, 'news', 'Jobs report', 1),
      event(9, 'earnings', 'Quarterly results'),
      event(5, 'news', 'Product launch', 1),
    );
    // Order labels that overlap fold into one; a click on it lists the orders with cancel buttons.
    chart.annotations.applyOptions({ markerCluster: { enabled: true }, overlap: 'cluster' });
    chart.annotations.setMarkers(markers);
    // Fills from the mock account: several on one bar fold into one marker at their average price.
    const exitBar = at(24);
    chart.annotations.setTrades([
      { id: 'f1', time: entryBar.time, side: 'buy', price: round(entryBar.low + (entryBar.close - entryBar.low) / 2), quantity: 0.1 },
      { id: 'f2', time: entryBar.time + 1, side: 'buy', price: round(entryBar.close), quantity: 0.15 },
      { id: 'f3', time: exitBar.time, side: 'sell', price: round(exitBar.close), quantity: 0.05, tooltip: 'Partial take profit' },
    ]);

    const entry = round(entryBar.close);
    const position = chart.annotations.addTradeLine({
      kind: 'position',
      price: entry,
      side: 'buy',
      quantity: 0.25,
      onChange: ({ part, price, from }) => note(`Position ${PART_NAMES[part]} ${fmt(from)} → ${fmt(price)}`),
      onBracketCreate: ({ part, price }) => acceptBracket(position, 'Position', part, price),
      onAction: ({ action, part }) => {
        if (part !== 'entry') {
          position.applyOptions(part === 'takeProfit' ? { takeProfit: null } : { stopLoss: null });
          note(`Position ${PART_NAMES[part]} removed`);
        } else if (action === 'reverse') {
          const side = position.options.side === 'buy' ? 'sell' : 'buy';
          position.applyOptions({ side });
          note(`Position reversed to ${side === 'buy' ? 'long' : 'short'}`);
        } else {
          position.remove();
          note('Position closed');
        }
      },
    });
    addAlert(1.04);
  }

  let alerts = 0;
  /** An alert at `factor` × the last close that can be dragged and removed. */
  function addAlert(factor: number): void {
    const last = lastClose();
    if (!last) return;
    const name = `Alert #${++alerts}`;
    const line = chart.annotations.addAlertLine({
      price: round(last * factor),
      title: `#${alerts}`,
      onDrag: ({ price }) => (status.textContent = `${name} → ${fmt(price)}`),
      onChange: ({ price, from }) => note(`${name} moved ${fmt(from)} → ${fmt(price)}`),
      // A real app would delete the alert on its server first.
      onRemove: () => {
        line.remove();
        note(`${name} removed`);
      },
    });
    note(`${name} @ ${fmt(line.options.price)} set`);
  }

  // Bar markers report clicks with their id, e.g. to open the execution in the app's own UI;
  // a folded event marker lists its members.
  chart.on('marker:click', ({ marker, members }) => {
    if (members) note(`${members.length} events: ${members.map((m) => m.tooltip).join(', ')}`);
    else if (marker.id) note(`Marker ${marker.id} clicked${marker.price !== undefined ? ` @ ${fmt(marker.price)}` : ''}`);
  });

  // Hovering a fill marker shows its tooltip; the event carries the fills for the app's own UI.
  chart.on('trade:hover', ({ group }) => (status.textContent = `${group.count} fill(s) · ${group.quantity} @ ${fmt(group.price)}`));

  // Triggering is the app's job: check the alerts on every live update.
  let previous: number | undefined;
  chart.on('data:bar', ({ bar }) => {
    if (previous !== undefined) {
      for (const { line, direction } of chart.annotations.alertsCrossed(previous, bar.close)) {
        note(`Alert ${line.options.title ?? ''} crossed ${direction} at ${fmt(line.options.price)}`);
      }
    }
    previous = bar.close;
  });
  // A new symbol or interval is a fresh price history, not a move.
  chart.on('data:loaded', () => (previous = undefined));

  // The axis "+" button shows while the panel listens: it starts a buy draft below the last close, a sell above.
  let offPlus: (() => void) | null = null;

  function setOpen(open: boolean): void {
    panel.hidden = !open;
    toggle.hidden = open;
    if (open) {
      addSamples();
      offPlus = chart.on('plus:click', ({ price }) => startDraft(price <= lastClose() ? 'buy' : 'sell', price));
      buy.focus({ preventScroll: true });
    } else {
      offPlus?.();
      offPlus = null;
      chart.annotations.clear();
      log.replaceChildren();
      status.textContent = hint;
      toggle.focus({ preventScroll: true });
    }
  }

  injectStyle(chart.options.timeAxis.height + 8);
  // The data source's time marks add a band under the time axis; sit above both, once laid out.
  const place = () => stage.style.setProperty('--demo-trade-bottom', `${chart.height - chart.plotRect.height + 8}px`);
  chart.on('data:loaded', () => requestAnimationFrame(place));
}

function row(...children: HTMLElement[]): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'demo-trade-row';
  el.append(...children);
  return el;
}

function labelled(text: string, input: HTMLInputElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.append(input.type === 'checkbox' ? input : text, input.type === 'checkbox' ? text : input);
  return label;
}

/**
 * Bottom-left of the plot, clear of the legend and of the line labels at the right edge.
 * Narrow shells show the toggle's icon only, so it stays clear of a favourites bar at bottom centre.
 */
function injectStyle(bottom: number): void {
  const style = document.createElement('style');
  style.textContent = `
    .pc-stage > .demo-trade-toggle, .pc-stage > .demo-trade { position: absolute; left: 8px; bottom: var(--demo-trade-bottom, ${bottom}px); z-index: 4; }
    .demo-trade-toggle[hidden], .demo-trade[hidden] { display: none; }
    @container pc-shell (max-width: 640px) { .demo-trade-toggle > span { display: none; } }
    .demo-trade {
      display: grid; gap: 8px; width: 260px; padding: 8px 10px 10px;
      background: var(--pc-popover); color: var(--pc-ink); box-shadow: var(--pc-shadow), inset 0 0 0 1px var(--pc-line);
      border-radius: var(--pc-radius-lg); font-size: 12px;
    }
    .demo-trade-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .demo-trade-header strong { font-size: 13px; font-weight: 600; }
    .demo-trade label { display: flex; align-items: center; gap: 6px; color: var(--pc-muted-strong); }
    .demo-trade input[type='number'] {
      width: 64px; height: 26px; padding: 0 6px; border: 0; border-radius: var(--pc-radius-sm);
      background: var(--pc-hover); color: var(--pc-ink); font: inherit; box-shadow: inset 0 0 0 1px var(--pc-line);
    }
    .demo-trade .pc-btn { flex: 1; justify-content: center; font-weight: 600; }
    .demo-trade-buy { color: var(--pc-up) !important; }
    .demo-trade-sell { color: var(--pc-down) !important; }
    .demo-trade-status { margin: 0; color: var(--pc-muted); min-height: 2.6em; }
    .demo-trade-log { margin: 0; padding-left: 18px; color: var(--pc-muted-strong); display: grid; gap: 2px; }
    .demo-trade-log:empty { display: none; }
  `;
  document.head.append(style);
}
