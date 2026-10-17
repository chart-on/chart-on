---
description: "A searchable indicator catalogue with categories, favourites and recently added indicators, in the shell or on its own."
---

# Indicator picker

`@charton/ui` includes an indicator picker: a searchable catalogue of every registered indicator, grouped by category, with descriptions, favourites and recently added indicators. Picking a row adds the indicator and keeps the dialog open, so adding several, or a second moving average, takes one click each. It is built only on the public `chart.indicators` API.

## With the shell

The shell creates the picker unless `indicatorPicker: false`. Open it from the toolbar preset, from code, or by typing `/` on the focused chart:

```ts
import { createChartShell, indicatorPickerToolbarItem } from '@charton/ui';
import { builtinIndicators } from '@charton/indicators';

const shell = createChartShell(el, {
  toolbar: [indicatorPickerToolbarItem() /* , ... */],
  indicatorPicker: {
    onAdd: (indicator) => console.log('added', indicator.type),
  },
});
for (const def of builtinIndicators) shell.chart.indicators.register(def);

shell.indicatorPicker?.open();      // or open('rsi') with a query
```

## On its own

```ts
import { createIndicatorPicker } from '@charton/ui';

const picker = createIndicatorPicker(chart, { container: shellElement });
picker.open();
picker.close();
picker.toggle();
picker.isOpen;
picker.recents;                      // definition ids, latest first
picker.favorites;                    // starred definition ids
picker.toggleFavorite('rsi');
picker.commandSource;                // entries for a command palette, see below
picker.destroy();
```

Mount it in a `.pc-shell` element so it picks up the theme. By default it covers the shell around the chart, or the chart's root when there is none.

| Option | Default | |
| --- | --- | --- |
| `container` | the shell, else `chart.root` | Element the dialog covers while open |
| `filter(def)` | | Return `false` to hide a registered definition |
| `onAdd(indicator)` | | Called after the picker added an indicator |
| `onSettings(indicator)` | the shell's indicator settings | Open your settings for an indicator on the chart. When set, its rows get a settings button. The picker closes before calling it |
| `actions` | `[]` | Extra row buttons: `{ id, label, icon, onClick(def, chart), appliesTo?(def) }` |
| `groups` | `[]` | Your sections: `{ id, label, includes(def) }`, listed as tabs after the categories |
| `sourceSwitch` | `false` | Split the catalogue into Built-in and Custom (in one of your `groups`) with a switch above the categories, see below |
| `placement` | `'overlay'` | Where `placement: 'either'` definitions go until the user switches a row |
| `storage` | `settings`, else `localStorage` | Where recents and favourites are kept; `null` keeps them for the visit only |
| `settings` | | A `SettingsAdapter` that keeps recents and favourites under the key `indicator-picker`. Used when `storage` is not given |
| `favorites` | in the shell: `of('indicator')` of its favourites | A `FavoritesList` that keeps the favourites instead of `storage`; see below |
| `storageKey` | `'charton:indicator-picker'` | Key of the default storage. Charts sharing a key share their lists |
| `addOptions` | | Options for every indicator the picker adds, e.g. `{ renderer: 'canvas' }`; the row decides `placement` |
| `initialState` | | `(def) => { inputs?, plotStyles? } \| null`, or a promise of it: what an indicator added from the picker starts with, null for the definition's defaults. The picker waits for a promise, and a rejected one adds with the defaults. Inputs go to `add`, which refuses invalid ones like any add; plot styles apply right after it as their own undo step, and ones the indicator refuses are skipped. A [saved default](./ui-shell#save-as-default) is one. Indicators added from code are not affected |
| `debounce` | `80` | Milliseconds after the last keystroke before the list filters |
| `openOnSlash` | `chart.root` | Element on which typing `/` opens the picker; `false` for none. The shortcut is the `'indicator-picker'` action on `chart.actions`, so it can be rebound. In a shell with a symbol search, which keeps `/`, the default is `false`: bind another key with `chart.actions.setKeys('indicator-picker', [...])` |
| `onOpenChange(open)` | | Called when the dialog opens or closes |
| `onSearchAll(query)` | the shell's command palette | Hand the query to a wider search. When set, a footer button under the results offers **Search everything for “query”** while the search box has text; the picker closes first |

## Catalogue

The picker lists `chart.indicators.getDefinitions()`. Each row shows the definition's `name`, the default inputs a new instance's legend title shows (for example `20, close` for SMA, from the definition's `title` when it has one, else its number and source inputs) and its `description`; tabs come from its `category`:

- **All**: Favorites, then Recent (the last 8 indicators added that aren't favourites), then every indicator by name.
- **On chart**: the indicators on the chart, in the order they were added, with a remove button. Indicators waiting for their definition are listed too.
- One tab per category present: Trend, Momentum, Volatility, Volume and Profiles first, then custom categories, then Other for definitions without one.
- Your `groups`, e.g. a "My indicators" tab: `{ id: 'mine', label: 'My indicators', includes: (def) => def.id.startsWith('my-lib/') }`.

### Built-in and custom indicators

With `sourceSwitch: true` and your `groups`, a two-way switch above the categories separates **Built-in** indicators (in none of your groups) from **Custom** ones (in one of them). The picker opens on Built-in. Each side has its own All tab, categories and search; your group tabs show on the Custom side. The On chart tab lists every indicator on the chart on both sides. By default, and without groups or when every listed definition is on one side, there is no switch and All lists everything. The labels are the message keys `indicatorsBuiltIn`, `indicatorsCustom` and `indicatorsSource` (the switch's accessible name).

Give your own definitions the same metadata (see [Indicators](./indicators#picker-metadata)):

```ts
const def: IndicatorDef = {
  id: 'my-lib/vwap-bands',
  name: 'VWAP bands',
  description: 'VWAP with bands one and two deviations away.',
  category: 'volume',              // or any custom category id
  aliases: ['Anchored bands'],     // other names search should find
  // ...
};
```

## Search

Typing filters the current tab. Results are ranked: an exact name, alias or id first, then name prefixes, alias and id prefixes, acronyms (`bb` finds "Bollinger Bands", `vwap` finds "Volume Weighted Average Price"), word prefixes, substrings, all query words, a one-character typo (`rsl` finds RSI, from three characters on), the description, and finally the category (`momentum` finds RSI). Among equally good matches favourites come first. The first result is active, so Enter adds it.

This is the core ranking of [`chart.indicators.search`](./indicators#search): the [picker dialog's](./dialogs#picker-dialog) `matchScore` with typos over each definition's name, aliases, id and description, then its category, favourites first on ties. `searchIndicators(defs, query)` and `matchRank(def, query)` are exported for hosts that want the same ranking elsewhere.

## Command palette

`picker.commandSource` is a [command palette](./ui-shell#command-palette) source with the id `indicators`. It lists the definitions the picker lists, with their category, ranked by `searchIndicators`, so the palette finds the same indicators by acronym or alias. Running an entry adds the indicator the way a picker row does: with the row's placement and `addOptions`, recorded as recent, through `onAdd`, and refused like a row past the limit or the access rule. Definitions the chart refuses are listed disabled.

A shell with the `commandPalette` part adds the source to its palette and sets `onSearchAll` to open the palette with the picker's query, so the user can move from one search to the other. An app that already has a palette source with the id `indicators` keeps its own. Without the shell:

```ts
const palette = createCommandPalette(chart, shellElement);
const picker = createIndicatorPicker(chart, {
  container: shellElement,
  onSearchAll: (query) => palette.open(query),
});
palette.addSource(picker.commandSource);
```

## Adding

Click a row, or press Enter on the active one, to add the indicator with its default inputs. The active row (under the pointer, or moved to with the keyboard) also shows an **Add** button, so the action is visible. The dialog stays open and the row shows **Added**, or **Added ×2** for a second instance. Definitions with `placement: 'either'` have a placement button on the row that switches between **Price** (on the price pane) and **Pane** (a new pane); the choice is kept while the page is open. Definitions with a fixed placement always go where they say.

### Allowed indicators and the limit

The picker follows `chart.indicators.setAccess()` and `setLimit()`, and updates while open when they change. Definitions the access rule refuses are left out, or listed dimmed with the chart option `access.refused: 'disable'`, so choosing one fires `indicator:refuse` for your upgrade prompt. With a limit, the On chart tab shows how many are in use (`2/3`); adding past it fires `indicator:refuse` with reason `'limit'` and the picker announces why.

## Recents and favourites

The star on a row adds it to the favourites, which come first in the All tab and in their category. To keep both lists with the user's other preferences, pass a `SettingsAdapter`, such as the one from `createLocalStorageAdapter` or one backed by your server; the lists are stored as JSON under the key `indicator-picker`:

```ts
import { createLocalStorageAdapter } from '@charton/core';

createChartShell(el, { indicatorPicker: { settings: createLocalStorageAdapter({ prefix: 'my-app:' }).settings } });
```

For full control, both lists also go through a small storage interface:

```ts
const storage: IndicatorPickerStorage = {
  load: () => settings.get('indicatorPicker') ?? null,   // { recents: string[], favorites: string[] }
  save: (memory) => settings.set('indicatorPicker', memory),
};
createChartShell(el, { indicatorPicker: { storage } });
```

In a shell with the `favorites` part, the favourites go to the shell's [favourites](./ui-shell#favourites-of-other-kinds) instead, as their `indicator` kind, saved with the starred tools, intervals and symbols and limited like them (a star past the limit is refused, and the status says so). Favourites the picker had saved are moved there once, while that list is empty; recents stay in the picker's storage. Outside a shell, pass any `FavoritesList` as `favorites`.

What `load` returns is sanitized: anything but unique string ids is dropped, and recents are capped at 8. The picker loads again each time it opens and before each change, then saves the changed lists, so pickers sharing a storage (or a `storageKey`) keep each other's additions. When `load` or `save` throws, the picker logs the error with `console.error` and keeps the lists for this visit. The default, `localIndicatorPickerStorage(key)`, reads as empty and saves nothing when storage is unavailable or blocked.

While the dialog is open, everything else in its container is `inert`. Opening an indicator's settings from a row closes the picker first.

## Keyboard

| Key | |
| --- | --- |
| `/` on the focused chart | Open the picker |
| Arrow keys, Page Up, Page Down | Move the active row |
| Enter | Add the active indicator (On chart tab: open its settings, when `onSettings` is set) |
| Tab | Reach the active row's buttons, the source switch (one stop; Left and Right switch sides), the categories, the **Search everything** footer and Close |
| Up and Down on a row button | Move the active row and go back to the search box |
| Arrow keys, Home and End in the categories | Switch tabs |
| Any character | Types into the search box, wherever focus is in the dialog |
| Escape | Close and return focus to where it was |

A live region announces result counts and what was added, removed or starred. The dialog uses the shell's colour tokens in both themes, turns its category list into a scrolling row on narrow screens, and its animations follow `prefers-reduced-motion`.

## Indicator templates

An indicator template is an [indicator set](./indicators#indicator-sets) with a name: the user's indicators with their panes, saved once and applied to any chart in one step. The shell creates the template UI (`indicatorTemplates: false` leaves it out); `indicatorTemplatesToolbarItem()` is a toolbar menu with **Save indicator template…** and **Open template…**:

```ts
import { createChartShell, indicatorPickerToolbarItem, indicatorTemplatesToolbarItem } from '@charton/ui';

const shell = createChartShell(el, {
  toolbar: [indicatorPickerToolbarItem(), indicatorTemplatesToolbarItem() /* , ... */],
  indicatorTemplates: { storage }, // any StorageAdapter; default createLocalStorageAdapter()
});
shell.indicatorTemplates?.save(); // ask for a name, then save the chart's indicators
shell.indicatorTemplates?.open(); // the template dialog
```

Without the shell, `createIndicatorTemplates(chart, options)` returns the same handle (`open`, `save`, `close`, `isOpen`, `destroy`), and `indicatorTemplatesOf(chart)` finds it. It is destroyed with its chart; after `destroy`, work still waiting on the storage adapter does nothing.

**Save** asks for a name, refuses one already in use (names compare without case, so `Trend` and `trend` are the same template; the list is read again when the name is confirmed, so a name another tab saved meanwhile is refused too), and stores `chart.indicators.serializeSet()` through the storage adapter's template methods as kind `'indicator-set'`. The default adapter keeps them in `localStorage`, so they survive a reload; an adapter backed by your server gets the same `listTemplates`, `loadTemplate`, `saveTemplate` and `removeTemplate` calls with no other change. `storage: null` hides My templates and turns saving off. When the adapter fails, a notification says so and the dialog offers Retry; a single template that cannot be read or is not a valid set is listed as invalid (it can still be deleted) and the others load as usual.

The **dialog** reuses the picker dialog: a search box that searches every source, a category sidebar and a list of rows. Each row shows the template's name and a one-line summary of its indicators grouped by pane, such as `SMA 20, SMA 50 · DMI 14`, followed by its interval scope (`for 1m–15m`) when it has one. The categories come from three sources:

- **My templates:** the user's, from the storage adapter. Their rows have Rename and Delete buttons. Delete asks for confirmation first in a small dialog over the list, since it cannot be undone; Cancel, Escape or a press outside it keeps the template. Rename saves under the new name, then removes the old one; if removing fails, a notification says the old copy was kept. A rename that only changes letter case (`Trend` to `trend`) removes the old name only when the adapter still lists it after the save, so an adapter that matches names without case keeps its one entry.
- **Technicals:** read-only presets, `indicatorTemplatePresets` by default (trend, momentum, volatility and volume sets made of indicators from `@charton/indicators`). Pass `presets` to replace them, or `[]` for none.
- **Collections:** templates an app or a package registers for a chart, each under its own category:

```ts
const off = registerIndicatorTemplates(chart, [{ name: 'Scalping', set }], { category: 'My pack' });
off(); // remove them again
```

Registration is per chart, so two charts on a page can list different collections; registering or removing one while the dialog is open lists it again. A template that uses an indicator the chart has not registered is shown disabled, with the missing ids in place of its summary.

Clicking a row, or Enter on the active one, **applies** the template: the chart's saved indicators are replaced by the template's, with its panes (`applySet` with `replace: true`), so applying a template twice, or one after another, never stacks indicators. The row's **Add to chart** button (a plus) applies it with `replace: false` instead, adding its indicators to the ones on the chart to combine templates. Indicator changes are not in the chart's undo history, so an applied template is not undone by Undo. The dialog then closes and a [notification](./ui-shell#notifications) says what happened, naming any indicator `applySet` left out and why (not registered, not available, over the limit, already added). A template that is not a valid set is reported the same way and changes nothing. The keyboard works as in the indicator picker: arrows move the active row, Tab reaches its buttons, typing searches, Escape closes.

Template names given a `nameKey`, the menu and the dialog take their text from `defaultShellMessages` (the `templates…` keys), so they follow the chart's `localization`.
