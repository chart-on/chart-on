---
description: "Markers, lines and highlights your application adds from code: executions, signals, orders, positions, alerts, time bands, price zones and text labels."
---

# Annotations

Annotations are markers, lines and highlights that your application adds from code: executions, signals, reference prices, orders, positions, price alerts, event windows, price zones and notes. They live on `chart.annotations`, which needs the [opt-in](./features#opt-in-features) `annotations()` plugin (or `builtins()`):

```ts
import { annotations, createChart } from '@chart-on/core';

const chart = createChart(el, { plugins: [annotations()] });
```

Without it, `chart.annotations` throws a [`not-registered`](./errors#not-registered) `ChartError`, and the data source's marks and indicator shape plots do not show. Annotations are separate from [drawings](./drawings):

- They are not part of `chart.drawings.serialize()` and never go on the drawing undo stack.
- They do not appear in the drawing tools or the rail, and users cannot select or edit them. The only exceptions are dragging a trade or alert line and pressing its buttons, and only when you allow it.
- They follow the price scale, so they stay in place in log and percent mode.

## Bar markers

Pin small shapes to bars, for example fills from your order history. Events your data source serves, such as earnings or news, can come as [source markers](./data-sources#markers) instead, drawn the same way:

```ts
chart.annotations.setMarkers([
  { time: 1767225600, shape: 'arrow-up', text: 'B' },              // below the bar by default
  { time: 1767225600, shape: 'arrow-up', text: 'B' },              // same bar: stacks below the first
  { time: 1767312000, shape: 'arrow-down', text: 'S' },            // above the bar by default
  { time: 1767398400, shape: 'circle', position: 'inside', color: '#f59e0b' },
]);

chart.annotations.getMarkers();   // copies, sorted by time
chart.annotations.setMarkers([]); // remove them
```

| Field | Values | Default |
| --- | --- | --- |
| `time` | Bar time in unix seconds | required |
| `shape` | `'arrow-up' \| 'arrow-down' \| 'arrow-left' \| 'arrow-right' \| 'triangle-up' \| 'triangle-down' \| 'circle' \| 'square' \| 'diamond' \| 'cross' \| 'x-cross' \| 'flag' \| 'label'` | required |
| `position` | `'above' \| 'below' \| 'inside' \| 'atPrice' \| 'top' \| 'bottom'` | `below` for `arrow-up` and `triangle-up`, `above` otherwise |
| `price` | Price of an `atPrice` marker | required for `atPrice` |
| `color` | Any CSS colour | up colour for `arrow-up` and `triangle-up`, down for `arrow-down` and `triangle-down`, line colour otherwise |
| `text` | Short label next to the shape; the content of a `label` | none |
| `size` | Size multiplier | `1` |
| `id` | Identifies the marker in events, `updateMarker` and `removeMarker`; unique per series | none |
| `tooltip` | Text shown while hovering; an array is several lines | none |
| `icon` | `{ svgPath, viewBox? }` or `{ image }`, drawn instead of the shape | none |
| `kind` | Event category, e.g. `'news'`, for folding and filters | none |
| `severity` | `1 \| 2 \| 3`, for filters | none |

Markers that land on the same bar stack outwards from it in the order you pass them, so they never overlap. `inside` markers form a column centred on the bar, with their text to the right. A `label` is only its text, in a box filled with the marker colour; the text colour is picked for contrast.

`setMarkers` throws, changing nothing, on a marker without a finite `time`, an `atPrice` marker without a finite `price`, an `id` used twice, a `severity` other than 1, 2 or 3, or an `icon` with neither `svgPath` nor `image`.

### Markers at a price

`position: 'atPrice'` puts the shape at `price` on the series' scale instead of next to the bar, for example an execution at its fill price. It follows the price scale in log and percent mode, and needs no value on its bar.

```ts
chart.annotations.setMarkers([
  { id: 'x1', time: 1767225600, shape: 'arrow-right', position: 'atPrice', price: 101.25, text: 'B 2', tooltip: 'Bought 2 @ 101.25' },
  { id: 'x2', time: 1767225600, shape: 'diamond', position: 'atPrice', price: 101.25 },
]);
```

- `arrow-right` sits left of its bar and points at it, `arrow-left` sits right of it; every other shape centres on the bar. Text goes on the side away from the bar.
- Markers at one price on one bar keep their price and fan out sideways, away from the bar, in the order you pass them, so they never overlap. A marker at a different price stays on its bar.
- Markers placed against the bar (`above`, `below`, `inside`) do not move for price markers, and the reverse.

### Event lanes and icons

`position: 'top'` and `'bottom'` are lanes along the pane's edges, for events that have no price, such as news, earnings or deposits. They stay at the edge while the price scale pans or zooms, need no value on their bar, and stack inwards from the edge, with their text on the inner side.

An `icon` replaces the shape with your own glyph, in a square of the marker's size:

```ts
chart.annotations.setMarkers([
  // Path data of a 24 × 24 glyph, filled with the marker colour.
  { time: t1, shape: 'circle', position: 'bottom', kind: 'news', icon: { svgPath: newsGlyph }, text: 'CPI' },
  // An image you loaded: an ImageBitmap, image or canvas element, or a Blob.
  { time: t2, shape: 'circle', position: 'bottom', kind: 'earnings', icon: { image: logoBitmap } },
]);
```

`viewBox` sets the side of the square the path is drawn in (default 24). The chart never fetches an icon: you pass the image itself. A Blob is decoded once and the marker shows once it is ready; one the browser cannot decode logs the [`marker-icon`](./errors#marker-icon) warning and draws without the icon. The shape still sets the marker's default position and colour.

### Folding crowded bars

Zoomed out to a longer interval, many events can land on one bar. Turn on folding and the markers of one `kind` and position on one bar fold into one once there are more than `maxPerBar`:

```ts
chart.annotations.applyOptions({ markerCluster: { enabled: true, maxPerBar: 1 } });

chart.on('marker:click', ({ marker, members }) => {
  if (members) openEventList(members); // a folded marker: copies of its markers
  else openEvent(marker.id);
});
```

The folded marker looks like the first of its markers, with the count as its text, and its tooltip lists the members' texts (up to eight, then `+N more`). Markers without a `kind` fold with each other; `atPrice` markers never fold. Folding follows the bars, so changing the interval regroups them. `marker:hover` and `marker:click` on a folded marker carry `members`; it has no `id`.

### Filtering

Hide some markers without resending them:

```ts
chart.annotations.setMarkerFilter({ kinds: ['earnings', 'news'], minSeverity: 2 });
chart.annotations.setMarkerFilter(null); // draw all again
```

The filter applies to every series' set and only to drawing: `getMarkers` still returns every marker. Markers without a `kind` pass the `kinds` check, and markers without a `severity` pass `minSeverity`. Changing the filter ends a hover on a marker.

### Changing one marker

Give markers an `id` to change or remove one without resending the set:

```ts
chart.annotations.updateMarker('x1', { text: 'B 3', tooltip: 'Bought 3 @ 101.25' }); // true when found
chart.annotations.updateMarker('x1', { tooltip: undefined });                       // clears the field
chart.annotations.removeMarker('x2');                                               // true when found
```

Both take the series as a last argument, like `setMarkers`, and return `false` for an unknown id. `updateMarker` throws, changing nothing, when the result is invalid. A marker whose `time` changes moves to its new bar; within a bar, the stacking order follows the set's order.

### Hover and click

```ts
chart.on('marker:hover', ({ marker, series, point }) => showDetails(marker.id, point));
chart.on('marker:hover-end', ({ marker }) => hideDetails(marker.id));
chart.on('marker:click', ({ marker }) => openExecution(marker.id));
```

- `marker:hover` fires once when the pointer enters a marker's shape or text, `marker:hover-end` once when it leaves. A marker with a `tooltip` shows it next to the pointer, in the theme's label colours (`labelBackground`, `labelText`).
- `marker:click` fires on a press and release that moved at most 4 px (8 px on touch). A tap on touch also counts as the hover.
- Markers take a press only while `marker:click` has listeners. Then a press on a marker never pans the chart or starts a drawing. Without listeners, presses pan as usual, and hover never blocks panning.
- An active drawing tool wins: while a tool is selected, markers ignore the pointer. Lines and fill markers sit above bar markers and take the pointer first.
- `marker` is a copy, and `point` is in chart-root css px, like `chart.pointAt` takes. `series` is the series whose set holds the marker. Resending a set keeps a hover on a marker whose `id` is still there.
- Markers stay non-selectable and are never serialized.

A time between two bars lands on the bar that contains it, so an execution at 10:03:27 on a 1-minute chart sits on the 10:03 bar, and on a 1-hour chart on the 10:00 bar. Times before the first bar, or one interval or more after the last, are not drawn.

Markers belong to the main series unless you pass another one. Each series has its own set:

```ts
chart.annotations.setMarkers(signals, rsiLine);
```

## Account fills

Bar markers are generic signals. For an account's executions use the fill layer: fills on one bar and side fold into one marker at their volume-weighted price, with a count. Fills are a trading add-on, like [trade lines](#trade-lines), [order drafts](#order-drafts) and [alert lines](#alert-lines): they need the `trading()` plugin after `annotations()` (`builtins()` and the UI shell include it). Without it, the fill and line calls (`setTrades`, `addTrade`, `clearTrades`, `getTrades`, `tradeGroups`, `applyTradeOptions`, `tradeOptions`, `addTradeLine`, `addAlertLine`, `startOrderDraft` and `syncTrades`) throw a [`not-registered`](./errors#not-registered) `ChartError` naming `trading()`, while `tradeLines`, `alertLines`, `draftLines` and `alertsCrossed` answer empty.

```ts
import { annotations, createChart, trading } from '@chart-on/core';

const chart = createChart(el, { plugins: [annotations(), trading()] });
```

```ts
chart.annotations.setTrades([
  { id: 'e1', time: 1767225600, side: 'buy', price: 101.2, quantity: 2 },
  { id: 'e2', time: 1767225630, side: 'buy', price: 101.6, quantity: 1, tooltip: 'Filled by algo' },
]);
chart.annotations.addTrade({ id: 'e3', time: 1767229200, side: 'sell', price: 104, quantity: 3 }); // regroups only its bar
chart.annotations.setTrades(hostFills, { source: 'host' }); // named sources write independently
chart.annotations.clearTrades('host');                       // or clearTrades() for all
chart.annotations.getTrades();                               // copies of the fills
chart.annotations.tradeGroups;                               // { index, time, side, price, quantity, count, trades }[]
```

A `Trade` is `{ id, time, side, price, quantity, label?, color?, tooltip? }`. `addTrade` with a known id (in its source) replaces that fill; `setTrades` and `syncTrades` throw on an id that appears twice in one call, and on a fill without a finite time and price or a positive quantity, leaving the current fills as they were. Fills follow the main series' price scale (log and percent too), are never serialized and cannot be selected. `getTrades()`, `tradeGroups` and the event payloads are copies; changing them changes nothing on the chart.

A fill sits on the bar at or before its time, as long as it is within one bar interval of that bar. Fills before the first bar, after the end of the last bar's interval, or in a gap between bars (a weekend, a halt) have no bar and are not drawn; they stay in `getTrades()` and appear once a bar covers them, for example a live bar appended after a fill that came in first. With a single bar loaded the interval is taken from the data source when one is set, otherwise every later fill goes on that bar. The price axis does not scale to fit fills, so a fill outside the visible price range is not drawn until you scroll or zoom to it.

```ts
chart.annotations.applyTradeOptions({
  variant: 'badge',        // 'chevron' (default), 'dot', 'count', 'badge'
  markerScale: 1.2,
  maxPerColumn: 4,         // markers drawn per bar; markers on one bar stack without overlap
  countDisplay: 'both',    // 'count' (default), 'quantity', 'both'
  formatQuantity: (q) => q.toFixed(2),
  labelFormatter: (group) => `${group.side === 'buy' ? 'B' : 'S'} ${group.count}`,
});
```

Hovering a marker shows a tooltip (the fills' own `tooltip` rows, else side, quantity and price) and emits `trade:hover { trades, group, point }` once per marker, then `trade:hover-end`. `trade:click` fires on a click, or a tap on touch, which also counts as the hover. A press counts as a click if the pointer moves at most 4 px (8 px on touch) before release. While nothing listens for `trade:click`, presses on markers pan the chart as usual. Changing fills keeps the hover while the hovered bar and side still have fills; the tooltip then shows the new totals.

`syncTrades({ trades, source, orders, positions })` applies fills and replaces every order line and position line in one go, for example from a socket snapshot after a reconnect, and returns the new lines. Each part left out is kept. Everything is checked before anything changes: an invalid fill or line throws and leaves the chart as it was.

## Price lines

A horizontal line with a label on the price axis and an optional title:

```ts
const alert = chart.annotations.addPriceLine({
  price: 68250,
  title: 'Alert',
  color: '#f59e0b',
  lineStyle: 'dashed',  // 'solid' | 'dashed' | 'dotted'
  lineWidth: 1,
  axisLabel: true,
});

alert.applyOptions({ price: 68500 });
alert.setVisible(false); // hide; options are kept
alert.remove();
```

Lines follow the price scale and pane of the main series. Pass `series` to attach one to another series, for example an indicator in its own pane or a series with an overlay scale.

## Trade lines

A trade line shows an order or a position. It is a horizontal line with a label block, an axis label and, optionally, linked take-profit and stop-loss lines. Trade lines, order drafts and alert lines come with the `trading()` plugin, like [account fills](#account-fills). `kind` picks which:

| `kind` | Label block | Entry | Default buttons |
| --- | --- | --- | --- |
| `'order'` (default) | side, quantity, price | draggable | `cancel` |
| `'position'` | side, quantity, entry price, P&L | fixed | `reverse`, `close` |

```ts
const line = chart.annotations.addTradeLine({
  kind: 'order',
  price: 64000,
  side: 'buy',
  quantity: 0.5,
  takeProfit: 66000,
  stopLoss: 63000,
  onDrag: ({ part, price }) => ticket.preview(part, price),
  onChange: async ({ part, price, from }) => {
    const ok = await api.modifyOrder(order.id, part, price);
    if (ok) return;
    // Rejected: put the part back.
    if (part === 'entry') line.applyOptions({ price: from });
    else if (part === 'takeProfit') line.applyOptions({ takeProfit: from });
    else line.applyOptions({ stopLoss: from });
  },
  onAction: ({ action, part }) => {
    if (action === 'cancel') api.cancelOrder(order.id, part);
  },
});
```

Interaction is opt-in. A line can only be dragged when it has `onDrag` or `onChange`, and buttons only appear when it has `onAction`. Each button shows a tooltip on hover.

| Callback | When |
| --- | --- |
| `onDrag({ part, price })` | While dragging, each time the price changes |
| `onChange({ part, price, from })` | The drag ended at a new price, confirmed when `confirmChanges` is on (see below) |
| `onAction({ action, part })` | A button was pressed: `'cancel'`, `'close'` or `'reverse'` |
| `onBracketCreate({ part, price })` | A take-profit or stop-loss was pulled out of the entry (see [bracket handles](#bracket-handles)) |

`part` is `'entry'`, `'takeProfit'` or `'stopLoss'`. The take-profit and stop-loss lines drag on their own; moving the entry does not move them.

Choose the buttons with `actions` (entry block, left to right) and `bracketActions` (take-profit and stop-loss blocks). Pass `[]` to show none.

```ts
chart.annotations.addTradeLine({
  kind: 'position',
  price: 63500,
  side: 'buy',
  quantity: 0.25,
  stopLoss: 62000,
  actions: ['close'],    // no reverse button
  formatPnl: (pnl) => `${pnl >= 0 ? '+' : ''}${(pnl * contractSize).toFixed(2)} USD`,
  onChange: ({ part, price }) => api.setBracket(part, price), // the stop-loss drags
  onAction: ({ action, part }) => (part === 'entry' ? api.closePosition() : api.removeBracket(part)),
});
```

- **Prices** come from the price scale, so they are correct in log mode, and snap to `tickSize`. It defaults to one unit of the series precision, e.g. `0.01` for two decimals.
- **After a drag** the line keeps the new price (once confirmed, for orders). If the change is rejected, put it back with `applyOptions`.
- **Escape** during a drag puts the line back. `onDrag` fires once more with the original price, and `onChange` does not fire.
- **Buttons** don't remove anything by themselves. Remove the line (or set `takeProfit` / `stopLoss` to `null`) once the exchange confirms.
- **P&L** of a position is `(last price - entry) × quantity`, negated for sells, with quantity 1 when it is not a number. Use `formatPnl` to apply a contract multiplier or a currency, or `pnl: false` to hide it.
- **Pointer priority:** pressing a draggable trade line drags it instead of panning the chart, and never creates or selects a drawing. While a drawing tool is active, the drawing tool wins.

| Option | Default |
| --- | --- |
| `price`, `side` (`'buy' \| 'sell'`) | required |
| `kind` | `'order'` |
| `quantity` | none |
| `label` | `Buy` / `Sell` for orders, `Long` / `Short` for positions |
| `color` | up colour for buys, down colour for sells |
| `lineStyle`, `lineWidth` | `'dashed'` for orders, `'solid'` for positions; `1` |
| `takeProfit`, `stopLoss` | none (`null` hides them) |
| `actions` | `['cancel']` for orders, `['reverse', 'close']` for positions |
| `bracketActions` | `['cancel']` |
| `confirmChanges` | `true` for orders, `false` for positions |
| `readOnly`, `dragReadOnly`, `bracketReadOnly`, `actionsReadOnly` | `false` |
| `pnl`, `formatPnl` | `true` (positions only), signed price format |
| `tickSize` | one unit of the series precision |
| `series` | the main series |

### Confirming changes

A mouse slip should never amend a live order, so an order released at a new price does not commit at once. Its block shows the new price with a confirm (✓) and a discard (✕) button, and a faint line marks the price it had. `onChange` fires only on confirm, with `from` the price before the change. Confirming commits the new price first: the line shows it as soon as `onChange` runs, before your request settles, so a rejected change must be put back with `applyOptions` as in the example above. Discard, or Escape, puts the line back; `onDrag` fires once more with the original price. Dragging the pending price again keeps `from`, and moving that part from code with `applyOptions` drops the pending change.

Positions commit at once by default; pass `confirmChanges: true` to confirm their take-profit and stop-loss moves too, or `confirmChanges: false` for orders that should commit on release.

### Bracket handles

With `onBracketCreate`, an entry block shows a ↕ handle while its take-profit or stop-loss is unset. Dragging the handle away from the entry proposes one: above a buy entry is a take-profit and below it a stop-loss, the other way round for a sell. The price comes from the price scale (log mode included) and snaps to `tickSize`. Releasing calls `onBracketCreate({ part, price })` and keeps showing the proposed line until an `applyOptions` on that line sets that part: its price accepts the proposal, `null` rejects it. Other changes, such as a new quantity, leave the proposal showing.

```ts
const line = chart.annotations.addTradeLine({
  price: 64000,
  side: 'buy',
  onBracketCreate: async ({ part, price }) => {
    const ok = await api.addBracket(order.id, part, price);
    // Either answer ends the preview.
    if (part === 'takeProfit') line.applyOptions({ takeProfit: ok ? price : null });
    else line.applyOptions({ stopLoss: ok ? price : null });
  },
});
```

### Read-only controls

`readOnly: true` turns off dragging, the buttons and the bracket handle; `dragReadOnly`, `actionsReadOnly` and `bracketReadOnly` turn off one of them. A change waiting for confirmation loses its confirm and discard buttons while `readOnly` or `dragReadOnly` is set; Escape still discards it. Hover, click and tooltips keep working.

## Order drafts

A draft is an order the user composes on the chart before it is sent. Start one at a price, for example from your order ticket or a price-axis click:

```ts
const draft = chart.annotations.startOrderDraft({ price: 64000, side: 'buy', quantity: 1 });

chart.on('order:create', async (order) => {
  // { side, type, price, quantity?, takeProfit?, stopLoss? }
  const placed = await api.placeOrder(order);
  chart.annotations.addTradeLine({ ...placed, onChange, onAction }); // show the working order
});
```

The draft draws in its own style, with an outlined label: side, quantity, order type, price, a bracket handle and place (✓) and discard (✕) buttons. Its price, take-profit and stop-loss drag freely and commit at once, since nothing has been sent yet; the handle sets the draft's own take-profit or stop-loss, and a bracket's ✕ removes it. Clicking the quantity or the type emits `draft:edit` `{ draft, segment, anchor, preventDefault }`; a UI shell with the `draftEditor: draftEditor()` [part](./ui-shell#optional-parts) answers with a keypad (with quantity presets) or a type menu next to the segment unless you call `preventDefault()` (in any `draft:edit` listener, synchronously; the default is decided after all of them ran). The keypad or menu closes when its draft is placed, discarded, hidden or cleared, and on a symbol change. Outside the shell, mount them with `createDraftEditor(chart, { quantityPresets, maxQuantity })`; presets are numbers, `'max'` and shares such as `'25%'`, the last two only when `maxQuantity({ draft })` is given.

The place button or `draft.commit()` emits `order:create` and removes the draft; the discard button or `draft.discard()` removes it without an event.

| Option | Default |
| --- | --- |
| `price`, `side` | required |
| `quantity` | none (shows `Qty`) |
| `type` | `'limit'` (`'limit' \| 'stop' \| 'market'`) |
| `takeProfit`, `stopLoss` | none |
| `color`, `lineStyle`, `lineWidth` | side colour, `'dashed'`, `1` |
| `labelAnchor`, `priceAxisLabel`, `tickSize`, `series` | as for trade lines |

## Plus button

Listen for `plus:click` and a "+" button appears next to the crosshair price label, inside the plot by the pane's main price axis. Pressing it hands you the price there, for example to start an order draft or create an alert:

```ts
chart.on('plus:click', ({ price, pane, scale, x, y }) => {
  chart.annotations.startOrderDraft({ price, side: price < lastPrice ? 'buy' : 'sell' });
});
```

- `price` is read through the pane's main scale (log mode included) and snapped to the tick size, like a dragged trade line; `x`, `y` are the button's centre in chart-root css px for anchoring a menu.
- The button shows only while something listens, `features.plusButton` is on, and the crosshair follows the pointer (not one from `setCrosshairAt`, and not with `crosshair` mode `'hidden'`). Hovering shows the price in a tooltip; a press on it never pans or starts a drawing, and a press that travels away is no click.
- On touch it appears with the inspection crosshair. With `touchInspect: 'tap'`, tapping it while the crosshair is kept fires the event instead of ending the inspection.

## Alert lines

An alert line marks a price your application watches, for example a user's price alert. It is a horizontal line with a label block (`Alert`, an optional title and the price) and an axis label, drawn in the theme's `alert` colour (`--pc-alert`) with a dotted line so it reads differently from orders and positions.

```ts
const alert = chart.annotations.addAlertLine({
  price: 68250,
  title: 'Breakout',
  onChange: async ({ price, from }) => {
    if (!(await api.moveAlert(id, price))) alert.applyOptions({ price: from }); // rejected: put it back
  },
  onRemove: async () => {
    await api.deleteAlert(id);
    alert.remove();
  },
});
```

The same opt-in rule as trade lines applies: the line can be dragged only with `onDrag` or `onChange`, and the remove button (with a "Remove alert" tooltip) only appears with `onRemove`. Pressing it calls `onRemove` and nothing else, so remove the line yourself once the alert is deleted. Dragged prices come from the price scale, snap to `tickSize` and are correct in log mode. Escape during a drag puts the line back.

| Callback | When |
| --- | --- |
| `onDrag({ price })` | While dragging, each time the price changes |
| `onChange({ price, from })` | The drag ended at a new price |
| `onRemove()` | The remove button was pressed |

| Option | Default |
| --- | --- |
| `price` | required |
| `label` | `'Alert'` |
| `title` | none |
| `color` | the theme's `alert` colour |
| `lineStyle`, `lineWidth` | `'dotted'`, `1` |
| `tickSize` | one unit of the series precision |
| `series` | the main series |

### Triggering alerts

The chart shows and edits alerts but never triggers them: your app owns the data feed, so it decides when an alert fires. `alertsCrossed(from, to)` helps: pass the previous and the new last price, and it returns the alert lines that price passed, with the direction.

```ts
let last = series.data.at(-1)?.close;
feed.onBar((bar) => {
  series.update(bar);
  if (last !== undefined) {
    for (const { line, direction } of chart.annotations.alertsCrossed(last, bar.close)) {
      notify(`${line.options.title ?? 'Alert'} crossed ${direction} at ${line.options.price}`);
    }
  }
  last = bar.close;
});
```

Reaching a level counts as crossing it and starting on it does not, so a price that touches a level and stays there is reported once. Hidden lines are included. Pass a series as the third argument to check the alert lines attached to it. `crossDirection(level, from, to)` is the same test for a single price.

### Built on primitives

Each alert line draws through a [plot primitive](./primitives) on the top layer, attached to its series (or the main pane). The annotations layer handles the hit testing, dragging and button for it, so the primitive itself only draws. Primitives sit below trade lines, so a trade line at the same price takes the pointer.

## Time bands and price zones

Shade an area from code, for example an earnings window or a supply zone your app found. Both draw below the series, so candles stay on top:

```ts
const earnings = chart.annotations.addTimeBand({
  from: 1767225600,          // first bar
  to: 1767247200,            // last bar; leave it out to shade one bar
  label: 'Earnings',         // at the top of the band
});

const zone = chart.annotations.addPriceZone({
  from: 64200,
  to: 64850,                 // either edge may be the higher one
  fromTime: 1767225600,      // optional: start at this bar instead of the left edge
  color: 'rgba(60, 196, 160, 0.14)',
  label: 'Demand',           // in the top-left corner
  axisLabel: true,           // both edge prices on the price axis
});

zone.applyOptions({ to: 65000 });
earnings.setVisible(false);
```

<!-- example: annotation-zones -->

A band covers whole bars: from the left edge of the bar that contains `from` to the right edge of the bar that contains `to`, whatever their order. A time between two bars (a weekend, a halt) lands on the earlier bar, and times past either end of the data are placed one bar interval apart, so a band can mark a window that has not traded yet. A band shades the full height of its pane.

A zone spans the pane from left to right unless `fromTime` or `toTime` sets one of its ends, using the same bar edges as a band. Its prices go through the price scale, so it stays in place in log and percent mode. Neither bands nor zones change autoscaling: a zone outside the visible prices is not drawn until you scroll to it. Parts outside the view are clipped, and labels stay inside the visible part.

| Option | Band | Zone | Default |
| --- | --- | --- | --- |
| `from`, `to` | times (`to` optional) | prices | required |
| `fromTime`, `toTime` | | limit the zone to bars | the pane edges |
| `color` | ✓ | ✓ | the theme's `annotationFill` (`--pc-annotation-fill`) |
| `label`, `labelColor` | ✓ | ✓ | none, the theme's muted text colour |
| `axisLabel` | | ✓ | `false`; labels use the zone colour made opaque |
| `series` | ✓ | ✓ | the main series (its pane, and for zones its price scale) |

Bands are one-off windows. Recurring trading sessions, and reference levels such as the previous close ([reference lines](./reference-lines)), are separate features.

## Text labels

Pin a note to a time and a price. Labels draw above the series and drawings:

```ts
const note = chart.annotations.addTextLabel({
  time: 1767247200,
  price: 65120,
  text: 'Local high',
  pointerLength: 24,         // box 24 px above the anchor, with a line down to it
  align: 'center',           // 'left': box starts at the anchor, 'right': box ends there
});

note.applyOptions({ text: 'Rejected twice' });
```

The anchor is the centre of the bar that contains `time`, at `price` on the series' scale. A negative `pointerLength` puts the box below the anchor, and `0` (the default) centres the box on it without a line.

| Option | Default |
| --- | --- |
| `time`, `price`, `text` | required |
| `color`, `background` | the theme's `labelText` and `labelBackground` |
| `fontSize` | the theme's font size |
| `align` | `'center'` |
| `pointerLength` | `0` |
| `series` | the main series |

### Not drawings

Bands, zones and labels are never serialized, never go on the undo stack, do not appear in the rail and cannot be selected. They are not hit-tested at all, so pressing on them pans the chart as usual. For a shape users may edit, add a [drawing](./drawings) instead.

They draw through [plot primitives](./primitives): one primitive per series and layer (`below` for bands and zones, `top` for labels), however many annotations there are. Drawing them reuses the same geometry objects and caches fonts and text widths, so panning and zooming allocate nothing per annotation.

## Split and dividend adjustment

Give annotations the prices your data source sends. When the chart back-adjusts the history for [splits and dividends](./data-sources#splits-and-dividends), annotations pinned to a bar on the main pane draw at the adjusted price of that bar: `atPrice` markers, fills, text labels and price zones with a `toTime`. What you passed is unchanged (`getMarkers()`, `getTrades()`, handle options, trade events and tooltips), so a fill still reports the price it traded at. Price, trade, alert and draft lines, and zones reaching the latest bar, stay at their price: they are levels of the live price, which no adjustment changes.

## Hover, click and tooltips

Price, trade and alert lines take `onHover`, `onHoverEnd`, `onClick` and `tooltip`, so an app can show its own details or open an order ticket:

```ts
const order = chart.annotations.addTradeLine({
  price: 101.5,
  side: 'buy',
  quantity: 2,
  tooltip: ['Limit order', 'Margin 1,200'],      // text drawn next to the pointer while hovering
  onHover: ({ line, part, price, point }) => showDetails(line, part),
  onHoverEnd: () => hideDetails(),
  onClick: ({ line }) => openTicket(line),
});
```

- `onHover` fires once when the pointer enters the line or its label block, `onHoverEnd` once when it leaves. Moving between a block's buttons does not fire them again.
- `onClick` fires on a press and release that did not move the line. A drag never clicks, so a line can have both `onChange` and `onClick`.
- `part` is `entry`, `takeProfit` or `stopLoss` (always `entry` for price and alert lines), `point` is in chart-root css px, the same space as `chart.pointAt` and the `chart:contextmenu` event.
- A price line takes the pointer only when it has one of these callbacks or a `tooltip`; plain price lines never block panning. A trade or alert line without them behaves as before.
- On touch, a press on a line with `onClick` (or a draggable one) takes the press, so it does not pan, and `onHover` and `onHoverEnd` bracket it. A finger may travel 8 px and still click, against 4 px for a mouse. Lines with only a `tooltip` or hover callbacks let presses through to panning; their tooltip and hover need a mouse or pen.

## Label placement and dense ladders

| Option | Default | Lines | Does |
| --- | --- | --- | --- |
| `labelAnchor` | `'right'` | trade, alert | Label block at the `left`, `center` or `right` of the plot. Take-profit and stop-loss blocks follow their order |
| `priceAxisLabel` | `true` | trade, alert | The price label on the axis |
| `lineOnly` | `false` | price, trade, alert | Only the line: no label block, no hit testing, no layout cost. For ladders with hundreds of orders |

## Label clustering

Orders at nearby prices draw their label blocks on top of each other, so only the top one can be pressed. Turn on clustering to fold overlapping order and position labels into one summary label:

```ts
chart.annotations.applyOptions({
  overlap: 'cluster',
  cluster: { mergeGapPx: 0, splitGapPx: 6, minLines: 2 },
  onClusterClick: ({ lines, anchor, preventDefault }) => {
    // Show your own list, or leave it to the UI package's default.
  },
});
```

Labels whose blocks overlap (closer than `mergeGapPx`) fold together; a folded cluster splits only once its blocks are `splitGapPx` apart, so it does not flicker while a price moves. Labels at different `labelAnchor` positions that do not overlap across the plot never fold together. Clusters need `minLines` lines. The lines themselves stay drawn and draggable; only the lowest line keeps its axis label, and the summary label (e.g. "3 orders") sits at its level. Inside the summary label, a press that moves drags the draggable line under the pointer, and a press that does not move is the summary's click.

Clicking the summary calls `onClusterClick` (its `anchor` is the label's centre in chart-root css px) and then emits the chart's `annotations:cluster` event. A UI shell with the `clusterList: clusterList()` [part](./ui-shell#optional-parts) answers it with a list of the orders next to the label, each with a cancel button for lines that handle `cancel` through `onAction`; call `preventDefault()` to show your own UI instead. Outside the shell, mount the list with `createClusterList(chart)`.

## Handles

`addPriceLine`, `addTradeLine`, `addAlertLine`, `startOrderDraft`, `addTimeBand`, `addPriceZone` and `addTextLabel` return handles:

| Member | Does |
| --- | --- |
| `options` | Current options (read-only) |
| `applyOptions(patch)` | Merge new options and redraw; throws on invalid prices |
| `visible`, `setVisible(visible)` | Hide or show the line; options are kept |
| `remove()` | Remove the line |
| `commit()`, `discard()` | Drafts only: place it (emits `order:create`) or throw it away |

`chart.annotations.priceLines`, `chart.annotations.tradeLines`, `chart.annotations.alertLines` and `chart.annotations.draftLines` list the current lines, and `timeBands`, `priceZones` and `textLabels` the rest. `chart.annotations.clear()` removes all markers, lines, fills (of every source), bands, zones and labels, for example on a symbol change; the data source's [marks](./data-sources#marks) stay.

## Limits

- The buttons, hover and click are pointer-only, since lines are drawn on the canvas. Offer the same actions in your own order ticket or position list.
- Button tooltips and the `TP` / `SL` labels are in English. The entry label can be changed with `label`.
