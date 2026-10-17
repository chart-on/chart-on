---
description: "The symbol search dialog: search box, filters, paging and keyboard control over any search source."
---

# Symbol search

`@charton/ui` includes a symbol search dialog: a search box over a list of results, with optional exchange and type filters, paging and full keyboard control. It reads from any object with a `search` method, so a data source can be passed in as is.

## With the shell

```ts
import { createChartShell, symbolHeader, symbolSearch } from '@charton/ui';

const shell = createChartShell(el, {
  toolbar: [
    symbolHeader(), // shows the current symbol and opens the dialog
    // ...
  ],
  symbolSearch: symbolSearch({
    source: dataSource,                   // or anything with search(query, request)
    onSelect: (result) => shell.chart.setSymbol(result.symbol, interval),
  }),
});
```

The dialog is an [optional part](./ui-shell#optional-parts): a shell without the `symbolSearch` option leaves its code out, and `symbolHeader()` shows the symbol but is disabled.

Typing a letter or digit on the focused chart, or anywhere else in the shell outside a text field, opens the dialog with that character in the search box and the caret after it; the rest of the typing goes on in the search box. Keys bound to an action on `chart.actions` keep running their action, and nothing opens with <kbd>Ctrl</kbd>, <kbd>Alt</kbd> or <kbd>Cmd</kbd> held, during IME composition, or while a modal dialog is open. Pass `openOnTyping: false` to turn that off, for example when the host app uses those keys.

### Favourite symbols

With the shell's [`favorites`](./ui-shell#favourites-of-other-kinds) part as well, each result has a star that adds its `symbol` to the favourites (kind `symbol`). While the search box is empty and no filter is picked, the starred symbols are listed first under Favorites, as a watchlist. Each is looked up through the source with `search(symbol, …)`, taking the result whose `symbol` matches; one the source no longer finds (a delisted symbol, say) is listed as unavailable: greyed out, not selectable, still starred, and its star removes it. Starring past the kind's limit is refused, and the status says so.

## Shortcut

<kbd>/</kbd> opens the dialog from anywhere in the shell: the chart, the toolbar, the bottom bar. Keys typed into a text field or an editable element stay there, and nothing happens while a modal dialog is open. Pass `shortcutScope: 'document'` to hear it anywhere on the page, for a page with a single chart. <kbd>Ctrl</kbd>+<kbd>K</kbd> (<kbd>Cmd</kbd>+<kbd>K</kbd> on a Mac) opens the [command palette](./ui-shell#command-palette), which lists the symbol search; a shell without the `commandPalette` option gives Mod+K to the symbol search too.

The shortcut is the `symbol-search` action on `chart.actions`, labelled with the `actionSymbolSearch` [shell message](./localization), so it is rebound or turned off like the chart's own ([actions and shortcuts](./interaction#actions-and-shortcuts)):

```ts
shell.chart.actions.setKeys('symbol-search', ['Alt+S']); // replace its default keys
shell.chart.actions.setKeys('symbol-search', []); // turn it off
```

The `symbolHeader()` preset keeps its tooltip ("Symbol search (/)") and `aria-keyshortcuts` in step with the action's keys, including later rebinding. For a header you build yourself, `showShortcut` does the same:

```ts
import { showShortcut } from '@charton/ui';

const stop = showShortcut(symbolButton, shell.chart, 'symbol-search');
```

`onSelect` runs after the dialog has closed and focus has returned to where it was. Load the picked symbol there, e.g. through the [data source](./data-sources) with `chart.setSymbol`. The `symbolHeader()` preset follows the switch on its own; see [toolbar presets](./ui-shell#presets).

## On its own

```ts
import { createSymbolSearch } from '@charton/ui';

const search = createSymbolSearch(shell.el, { source, onSelect, openOnTyping: chart.root });
search.open('AB'); // open with a query
search.close();
search.isOpen;
search.destroy();
```

Mount it in a `.pc-shell` element so it picks up the theme. It covers that element while open.

| Option | Default | |
| --- | --- | --- |
| `source` | | Where results come from (see below) |
| `onSelect(result)` | | Called with the picked result |
| `debounce` | `200` | Milliseconds to wait after the last keystroke before searching |
| `pageSize` | `50` | Results per page |
| `openOnTyping` | shell: the whole shell | Element on which typing a letter or digit opens the dialog; `false` for none |
| `favorites` | in the shell: `of('symbol')` of its favourites | A `FavoritesList` of starred symbols: a star on each result, and the starred symbols listed first while the search box is empty |
| `shortcutScope` | `'shell'` | Shell only: where the [shortcut](#shortcut) is heard, `'shell'` or `'document'` |
| `chart` | shell: its chart | Chart whose [`localization`](./localization) sets the dialog's language, read each time it opens; English without one |

## Search source

```ts
const source: SymbolSearchSource = {
  async search(query, { exchange = '', type = '', offset, limit }) {
    const params = new URLSearchParams({ q: query, exchange, type, offset: String(offset), limit: String(limit) });
    const res = await fetch(`/api/symbols?${params}`);
    const { items, total } = await res.json();
    return { items, hasMore: offset + items.length < total };
  },
  searchFilters: {
    types: [{ value: 'stock', label: 'Stocks' }, { value: 'futures', label: 'Futures' }],
    exchanges: [{ value: 'Exchange A', label: 'Exchange A' }, { value: 'Exchange B', label: 'Exchange B' }],
  },
};
```

`search(query, request)` returns either:

- an array: the whole result. The dialog shows it a page at a time as the list scrolls.
- a page, `{ items, hasMore }`: the dialog asks for the next page with `request.offset` (results received so far) when the list nears its end.

The dialog searches as soon as it opens, also for an empty query; return what suits your source (everything, popular symbols, or nothing). Responses that arrive after a newer query are ignored, so a slow request never overwrites newer results. A rejected promise shows an error with a retry button.

| Request field | |
| --- | --- |
| `exchange?` | Selected exchange filter value |
| `type?` | Selected type filter value |
| `offset` | Results already received for this query |
| `limit` | Page size |

The exchange select sits beside the search box and shows only when `exchanges` lists two or more; the type tabs sit on a row below. The filters are also applied to the returned results, so a source that ignores them still shows the right rows. Filter values are compared with each result's `exchange` and `type`.

| Result field | |
| --- | --- |
| `symbol` | Key handed to `onSelect` |
| `name` | Shown when there is no `description` and it differs from `symbol` |
| `description?` | Second column |
| `type?` | Third column, e.g. `'stock'`, `'futures'` |
| `exchange?` | Last column (hidden when the dialog is narrow) |
| `logo?` | Image URL shown before the symbol |
| `root?` | Futures root; results with the same root are listed together under it |

## Keyboard

| Key | Action |
| --- | --- |
| Letter or digit on the focused chart | Open with that character |
| <kbd>/</kbd> in the shell (and <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd> without the command palette) | Open (the `symbol-search` action) |
| <kbd>↓</kbd> / <kbd>↑</kbd> | Next / previous result (wraps once every result is loaded) |
| <kbd>Page Down</kbd> / <kbd>Page Up</kbd> | Move by a page |
| <kbd>Enter</kbd> | Pick the active result |
| <kbd>Escape</kbd> | Close (an open exchange list closes first) |
| <kbd>Tab</kbd> | Move between the search box, the active result's star (with favourites), filters and close button; focus stays in the dialog |

The search box is a combobox over a listbox, so screen readers announce the active result, and a status region announces the result count.
