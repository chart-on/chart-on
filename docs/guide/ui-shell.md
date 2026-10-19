---
description: "The optional UI shell: top toolbar, drawing-tool rail and bottom bar around a core chart."
---

# Shell, toolbar and rail

`@chart-on/ui` wraps a core chart with a top toolbar, a left drawing-tool rail and an optional bottom bar. Toolbar and rail are plain config arrays. With no options the shell is minimal: a small toolbar (`defaultToolbarItems()`), the rail, and no bottom bar. For several linked shells side by side, see [Chart grid](./chart-grid).

```ts
import { clusterList, commandPalette, createChartShell, draftEditor, favorites, replayControls, symbolSearch, toasts, toolbarCustomization } from '@chart-on/ui';
import '@chart-on/ui/style.css';

const shell = createChartShell(el, {
  chart: { barSpacing: 10 },  // core ChartOptions
  toolbar: [...],             // default defaultToolbarItems(); [] to hide; { items, customize: toolbarCustomization() } lets users edit it
  rail: { items, visible },   // or an items array; false to leave it out; defaults to built-in tools
  bottomBar: { ... },         // off by default; true for the default items, items, or the shorthand options
  favorites: favorites({ tools, storage }), // favourite drawing tools and their bar, see Optional parts
  symbolSearch: symbolSearch({ source, onSelect }), // symbol search dialog, see Symbol search
  commandPalette: commandPalette({ sources }), // Mod+K command palette, see Command palette
  drawingToolbar: true,       // floating style toolbar for the selected drawing
  drawingSettings: true,      // settings dialog from the toolbar's Settings button or a double click; { headerControl } adds to its header
  indicatorSettings: true,    // settings panels from legend rows (indicators, compared symbols, plain series); { headerControl } adds to an indicator panel's header
  contextMenu: { items, onError }, // right-click menu; false keeps the browser's menu
  draftEditor: draftEditor({ quantityPresets, maxQuantity }), // keypad and type menu for order drafts, see Optional parts
  clusterList: clusterList(),  // list of the orders in a clicked label cluster, see Optional parts
  replayControls: replayControls(), // play, pause, step and speed while a bar replay runs, see Bar replay
  indicatorPicker: { onAdd }, // indicator catalogue, see Indicator picker; false to leave it out
  indicatorTemplates: { storage }, // saved indicator sets, see Indicator templates; false to leave it out
  theme: 'dark',              // 'dark' | 'light' | 'system'
  panels: 'floating',         // 'floating' | 'docked' | 'inset', or one per part, see Panel styles
  features: { rail: true },   // show or hide parts at runtime, see Feature flags
  tooltip: { anchor: 'top' }, // pointer tooltip options, shown with features.tooltip
  railBreakpoint: 640,        // compact layout below this shell width, with features.railSheet
  className: 'my-theme',      // extra class for theming
  classNames: { toolbar: 'app-toolbar' }, // class hooks on the parts, see Class names
  slots: { railTop, loading },  // your own content in the shell, see Slots
  toasts: toasts(),           // toasts for chart.notify, see Notifications
});

shell.chart;    // the core Chart
shell.toolbar;  // ToolbarHandle | null
shell.rail;     // ToolRailHandle | null
shell.bottomBar; // ToolbarHandle | null, see Bottom bar
shell.favorites; // ShellFavorites | null, see Favourite tools
shell.symbolSearch; // SymbolSearchDialog | null; open() from a toolbar item
shell.commandPalette; // CommandPalette | null; open() it, addSource() more entries
shell.drawingToolbar; // DrawingToolbarHandle | null
shell.drawingSettings; // DrawingSettingsHandle | null; open(id) shows a drawing's settings
shell.indicatorSettings; // IndicatorSettingsHandle | null; open(indicator) shows an indicator's settings
shell.seriesSettings; // SeriesSettingsHandle | null; open(series) shows a compared symbol's or plain series' style panel
shell.contextMenu;    // ContextMenuHandle | null
shell.draftEditor;    // DraftEditorHandle | null
shell.clusterList;    // ClusterListHandle | null
shell.replayControls; // ReplayControlsHandle | null
shell.indicatorPicker; // IndicatorPickerHandle | null; open() it, or `/` on the focused chart
shell.indicatorTemplates; // IndicatorTemplatesHandle | null; open() the dialog or save() the indicators
shell.toasts;         // ToastStackHandle | null, see Notifications
shell.setTheme('system'); // switch chrome and chart colors together; 'system' follows the OS
shell.resolvedTheme;      // 'dark' | 'light', with 'system' resolved
shell.refreshTheme();     // re-read the CSS color tokens after a stylesheet change
shell.on('theme:change', ({ theme, resolved }) => {}); // returns an unsubscribe function
shell.on('rail:change', ({ visible }) => save('rail', visible)); // also 'toolbar:change'
shell.destroy();
```

The canvas colors come from the `--pc-*` CSS variables on the shell. See [Theming](./theming.md).

## Optional parts

The symbol search, the command palette, favourite tools, toasts, toolbar customization, and the trading and replay parts (the order draft editor, the order cluster list and the replay strip) are parts an app opts into. Each option takes what its factory returns, and importing the factory is what brings the part's code into the app's bundle; a shell without the option ships none of it.

| Option | Factory | Without it |
| --- | --- | --- |
| `symbolSearch` | `symbolSearch({ source, onSelect })` | `symbolHeader()` is disabled; no `/` or typing shortcut |
| `commandPalette` | `commandPalette({ sources })` | `commandPaletteToolbarItem()` is disabled; the symbol search keeps Mod+K |
| `favorites` | `favorites({ tools })` | No stars in the rail's flyouts, no favourites bar, no rail button for it |
| `toasts` | `toasts()` | `chart.notify` messages are only emitted as `ui:notify`; statuses keep the in-pane text |
| `toolbar.customize` | `toolbarCustomization({ locked })` | No Customize entry; `openCustomization()` does nothing, `registerAction()` throws |
| `draftEditor` | `draftEditor({ quantityPresets, maxQuantity })` | Clicking a draft's quantity or type only emits `draft:edit` for your own UI |
| `clusterList` | `clusterList()` | Clicking a folded order-label cluster only emits `annotations:cluster` for your own UI |
| `replayControls` | `replayControls()` | On the default toolbar, the strip is there anyway; with an own `toolbar`, a replay runs without it, so drive it from your own controls |

```ts
import { commandPalette, createChartShell, favorites, symbolSearch, toasts, toolbarCustomization } from '@chart-on/ui';

const shell = createChartShell(el, {
  toolbar: { items, customize: toolbarCustomization({ locked: ['symbol'] }) },
  symbolSearch: symbolSearch({ source, onSelect }),
  commandPalette: commandPalette(),
  favorites: favorites({ tools: ['trendline'] }),
  toasts: toasts(),
});
```

The handles (`shell.symbolSearch`, `shell.commandPalette`, `shell.favorites`, `shell.toasts`, `shell.draftEditor`, `shell.clusterList`, `shell.replayControls`) are null for parts left out. The shell connects the parts it has: the palette takes Mod+K from the symbol search and lists the [indicator picker](./indicator-picker#command-palette)'s indicators. A part is a plain value, so one part can go to every cell of a [chart grid](./chart-grid) (`cell: { toasts: toasts() }`). The [shortcut editor](#keyboard-shortcuts) and the [depth ladder](#depth-ladder) are opt-in already: the app creates them with `createShortcutSettings` and `createDepthLadder`.

The trading and replay parts work on a core plugin: the draft editor and the cluster list on `trading()`, the replay strip on `replay()`. `builtins()` has both, and the shell adds them when your own plugin list leaves them out. Called on a chart without its plugin, a part throws a [`not-registered`](./errors#not-registered) error naming it in development builds.

```ts
import { clusterList, createChartShell, draftEditor, replayControls, replayToolbarItem } from '@chart-on/ui';

const shell = createChartShell(el, {
  toolbar: [/* your items, */ replayToolbarItem()],
  draftEditor: draftEditor({ quantityPresets: [1, 10, 'max'], maxQuantity: () => buyingPower() }),
  clusterList: clusterList(),
  replayControls: replayControls(),
});
```

## Showing and hiding

Toolbar, rail and bottom bar can be hidden and shown at runtime. Hiding sets the `hidden` attribute, so state and listeners survive, and the chart grows into the freed space on the same frame.

```ts
shell.rail?.setVisible(false);
shell.rail?.toggle();
shell.rail?.visible;      // boolean
shell.toolbar?.toggle();

// Each change emits an event with the new state
shell.on('rail:change', ({ visible }) => save('rail', visible));
shell.on('toolbar:change', ({ visible }) => save('toolbar', visible));

// Start with the rail hidden
createChartShell(el, { rail: { visible: false } });

// Only the top toolbar, or only the bottom bar
shell.applyFeatures({ bottomBar: false });
shell.applyFeatures({ toolbar: false });
```

To leave a bar out from the start, pass `toolbar: []`; the bottom bar is out unless you pass `bottomBar`.

## Panel styles

`panels` sets how the toolbar, rail and bottom bar sit around the chart:

| Style | Look |
| --- | --- |
| `floating` | Default. Rounded cards inset from the shell's edges, around a rounded chart |
| `docked` | Square strips flush with the shell's edges, a thin gap between them |
| `inset` | No fill: the parts sit on the shell background, and the chart is the rounded card between them |

One value styles every part; an object styles them one by one, and parts left out float. Change them at runtime with `setPanels`, which keeps the parts you leave out:

```ts
const shell = createChartShell(el, { panels: { rail: 'inset', bottomBar: 'inset' } });
shell.panels;               // { toolbar: 'floating', rail: 'inset', bottomBar: 'inset' }
shell.setPanels('docked');  // every part
shell.setPanels({ toolbar: 'inset' });
```

The `--pc-panel-radius` token rounds floating parts and the chart (default `--pc-radius-lg`, 8px; `0` for square cards) and `--pc-panel-inset` sets the space they keep from the shell's edges (default 4px). When every part is docked the shell has no edge space and square corners, as before. The cells of a [chart grid](./chart-grid) stay docked unless their cell options set `panels`. The shell sets `data-pc-toolbar`, `data-pc-rail` and `data-pc-bottom-bar` to each part's style, and `data-pc-panels` to the shared style (or `mixed`), as hooks for your own CSS.

## Toolbar

Without a `toolbar` option the shell shows `defaultToolbarItems()`: the symbol, the interval menu (`defaultIntervals`: 1m 5m 15m 1h 4h 1d 1w, each 3 to 7 times the one before) and indicators on the left, and indicator templates (save and open), bar replay, fullscreen and chart settings on the right. The left side is what the chart shows; the right side keeps, replays and frames that view, with settings last. Everything else, chart style and the price scale menu included, is opt-in. Since the list has the replay button, a shell on it also shows the [replay strip](#bar-replay). Spread the list to add your own items, or pass your own list:

```ts
createChartShell(el, { toolbar: [...defaultToolbarItems(), screenshot()] });
```

The interval menu reloads the data source's symbol at the picked interval, so it does nothing on a chart fed with `setData`; give such charts their own `intervals(list, { onChange })`.

```ts
import { Camera } from 'lucide';

const toolbar: ToolbarItem[] = [
  {
    type: 'segmented', id: 'interval', label: 'Interval', value: '1h',
    options: ['1m', '5m', '1h', '1d'].map((v) => ({ value: v, label: v })),
    onChange: (interval) => loadData(interval),
  },
  { type: 'separator' },
  {
    type: 'menu', id: 'style', label: 'Chart style', text: 'Candles', value: 'candles',
    options: [{ value: 'candles', label: 'Candles' }, { value: 'line', label: 'Line' }],
    onSelect: (style) => candles.applyOptions({ style: style as 'candles' | 'line' }),
  },
  {
    type: 'button', id: 'snap', label: 'Screenshot', icon: Camera, align: 'end',
    onClick: (chart) => snapshot(chart),
  },
];
```

| Item | Fields |
| --- | --- |
| `segmented` | `id`, `label`, `options`, `value`, `onChange(value, chart)`, `collapseBelow?`, `currentValue?(chart)`, `isOptionHidden?(value, chart)`, `watch?` |
| `button` | `id`, `label`, `icon?`, `text?`, `content?(chart)`, `popup?`, `onClick(chart, el)`, `isActive?(chart)`, `isDisabled?(chart)`, `watch?` |
| `menu` | `id`, `label`, `icon?`, `text?`, `options`, `value?`, `onSelect(value, chart)`, `isChecked?(value, chart)`, `isOptionHidden?(value, chart)`, `currentValue?(chart)`, `watch?` |
| `separator` | Thin divider, `id?`. Shown only between two visible items. Groups get one on their own, see below |
| `spacer` | Pushes the following items to the right, `id?` |
| `custom` | `id`, `render(host, chart)`; may return a cleanup function |

Every item also accepts:

| Field | Notes |
| --- | --- |
| `hidden` | Keep the item in the list without showing it |
| `group` | `'context'`, `'analysis'` or `'view'`; see [Where controls go](#where-controls-go) |
| `align` | `'end'` pushes the item to the right edge. Default `'end'` for the `view` group, else `'start'` |
| `priority` | When the toolbar is too narrow, lower values move into the "more" menu first, within the item's group; items without one go last. Ties drop from the right edge inwards. Custom items go after every other item and are hidden rather than listed, since the menu has no label for them |

`label` is the accessible name and tooltip. `text` shows visible text next to the icon. Segmented controls turn into a menu when the toolbar is narrower than `collapseBelow` (default `640` px).

`segmented`, `button` and `menu` items, and menu and segmented options, also take a `labelKey`: a [message key](./localization#messages) whose text replaces `label` in the chart's language, with `label` as the fallback. The presets set one from `defaultShellMessages`, and on `localization:change` (or when a [chart grid](./chart-grid)'s active chart changes) the toolbar rewrites its text in place, so focus, values and custom items stay as they are. A built-in key only replaces its own English text: a preset given your own label keeps it in every language (`{ ...screenshot(), label: 'Snapshot' }`). `labelParams` fills the key's `{name}` placeholders, e.g. `{ labelKey: 'toolbarToggleVisibility', labelParams: { name: 'Volume' } }`. Keys of your own work too, through the `messages` or `translate` of the `localization` option.

A button whose text changes with the chart, such as a symbol header, returns it from `content(chart)`: `{ text, detail?, label?, tip?, keys? }`. `detail` is smaller, muted text after `text`; `label` and `tip` replace the item's `label` as the accessible name and the tooltip (start `label` with the visible text, so voice control finds the button by what it shows); `keys` sets `aria-keyshortcuts`. It is read like `isActive`, so give the item a `watch`; the toolbar refits when the text changes. Unlike `text`, a content button's text stays when the toolbar is narrow, cut short with an ellipsis when long; only its `detail` drops. In the "more" menu the entry shows `text` and `detail`, named by `label`. `popup: 'dialog'` (or `'menu'`) sets `aria-haspopup` on a button that opens one.

A menu option can carry a `section`, shown as a heading above the option when it differs from the previous one; `sectionKey` gives the heading in the chart's language, as `labelKey` does for `label`. `isOptionHidden(value, chart)` leaves an option out for now: a segmented row hides its button on mount and on every refresh, and a menu leaves the option (and a heading with nothing under it) out each time it opens. With `isChecked`, a menu's options become independent toggles: each shows its own on or off state, and the trigger keeps its own icon.

`isActive`, `isDisabled` and `currentValue` are read when the item mounts and on every `toolbar.refresh()`. To keep them right when the state changes elsewhere, give the item a `watch(chart, refresh)` that subscribes to the change and returns the unsubscribe function. The toolbar calls it on mount, again when the chart it acts on changes (the active cell of a [chart grid](./chart-grid)), and unsubscribes when the item is removed or replaced:

```ts
{
  type: 'button', id: 'undo', label: 'Undo', icon: Undo2,
  onClick: (chart) => chart.history.undo(),
  isDisabled: (chart) => !chart.history.canUndo,
  watch: (chart, refresh) => chart.on('history:change', refresh),
}
```

### Presets

Ready-made items for common controls. Each returns a plain item, so spread it to change any field:

```ts
import { chartStyle, compare, fullscreen, hideMenu, intervals, screenshot, settingsToolbarItem, symbolHeader, toggleRail, toggleVisibility, undoRedo } from '@chart-on/ui';

const toolbar: ToolbarItem[] = [
  symbolHeader(),
  intervals(['1m', '5m', '1h', '1d']),
  chartStyle(),
  compare(() => prompt('Symbol to compare')),
  ...undoRedo(),
  { ...screenshot({ scale: 2 }), priority: 1 },
  settingsToolbarItem(), // the settings cog, beside the screenshot button
  fullscreen(),
  toggleRail(),
  hideMenu(),
  toggleVisibility(volumeSeries, { id: 'volume', text: 'Volume' }),
];
```

| Preset | Item |
| --- | --- |
| `symbolHeader(options?)` | `button` in the `context` group, meant to go first: a search icon, the symbol's `name` (or `format(info)`) and its `exchange` (or `detail(info)`), with "Choose a symbol" before the first load. Opens the shell's [symbol search](./symbol-search) and is disabled in a shell without one. Shows the key of a symbol being loaded as soon as `symbol:change` fires, then the symbol the data source resolved, including one it fell back to. When the load fails it goes back to what is on screen: the symbol loaded before, or the placeholder. Its tooltip and `aria-keyshortcuts` follow the `symbol-search` action's keys; its accessible name is its visible text followed by "symbol search". Text comes from the `symbolHeaderEmpty`, `symbolHeaderLabel` and `actionSymbolSearch` [shell messages](./localization) |
| `intervals(list, options?)` | `segmented` (or a `menu` with `display: 'menu'`) in the `context` group. Reloads the data source's current symbol at the picked interval and follows `interval:change`, including a fallback to the nearest supported interval. Charts fed with `setData` pass `onChange(interval, chart)`. [Trade and volume intervals](./data-sources#trade-and-volume-intervals) read "100 trades" and "5K volume" (the `intervalTrade`, `intervalTrades` and `intervalVolumeOf` [shell messages](./localization), unless `format` gives your own text) and sit under "Ticks" and "Volume" headings in the menu. On a chart with a data source they show only while the current symbol lists them in its `intervals` |
| `chartStyle(styles?)` | `menu` of chart types in the `context` group; default `chartStyles`, the built-in candle styles for time bars. `chartStyles` groups them by what they show, under headings (`section` and `sectionKey` on each entry): **Open, high, low, close**, **Range** and **Close**. Within a section, candles come first as the default, then the style that shows the most values of a bar, and styles that show as many by English label. Applies `{ style }`, or the entry's own `options` for variants, to the main series and follows style changes made elsewhere. The price-built `kagi` and `pointFigure` styles are not in the default list; an entry of your own can use their names in the chart's language: `{ value: 'kagi', label: defaultShellMessages.chartStyleKagi, labelKey: 'chartStyleKagi', icon: chartTypeIcons.kagi }`. Those two styles draw only on a chart with the `priceStyles()` plugin: the shell's default `builtins()` has it, but a `chart.plugins` list of the app's own must include it, or the series draws nothing (development builds warn once, [`price-styles-missing`](./errors#price-styles-missing)) |
| `favoriteIntervals(list, options?)`, `favoriteChartStyles(styles?)` | `custom` items in the `context` group: buttons for the starred intervals or chart styles beside a menu of all of them with a star each; see [favourites of other kinds](#favourites-of-other-kinds) |
| `screenshot(options?)` | `button` in the `view` group that downloads `chart.captureImage(options)`. `filename` is a string or `(chart) => string`; default `chart.png`. A chart that cannot be captured shows a notification. Needs the `imageCapture()` plugin, which the shell adds; a standalone toolbar on a chart without it shows an error notification instead. |
| `print(options?)` | `button` in the `view` group that calls [`printChart(chart, options)`](./events#screenshot-and-data-export): a light, captioned image by default. Shows a notification when printing fails. Needs the `imageCapture()` plugin, which the shell adds; a standalone toolbar on a chart without it shows an error notification instead. |
| `downloadData(options?)` | `button` in the `view` group that downloads `chart.getDataTable(range)` as CSV, with `toCSV` times in the chart timezone (`time: 'iso'` by default; `'unix'` or a function also work). `filename` is a string or `(chart) => string`; default `chart.csv`. Shows a notification when there are no rows |
| `fullscreen(options?)` | `button` in the `view` group: the shell element full screen, or out of it. Pressed while full screen; disabled where the browser does not allow it. `target(chart)` picks another element |
| `toggleRail()` | `button` in the `view` group that shows or hides the shell's rail; pressed while it shows |
| `undoRedo()` | Two `button`s, `undo` and `redo`, in the `view` group, bound to `chart.history` (drawings and indicators) and disabled when there is nothing to undo or redo |
| `toggleVisibility(target, options?)` | `button` that shows or hides a series, an indicator, a pane (not the main one), one drawing (its id) or every drawing (`'drawings'`). Pressed while the target shows; follows `series:visibility`, `indicator:change`, `panes:change`, `drawings:change` and `drawings:visibility`, so a legend's eye button or the rail's hide-all button updates it too. Give it an `id` to find it later. Its default name ("Show or hide …") follows the chart's language through `labelKey` and `labelParams` |
| `hideMenu()` | `menu` in the `view` group with checked entries `drawings` (the `hide-drawings` [action](./interaction#actions-and-shortcuts), shared with the rail's hide-all button), `indicators` and `all` (both). Showing indicators again restores only the ones the menu hid; when it hid none, it shows them all |
| `compare(pick, options?)` | `button` in the `analysis` group. `pick(chart)` returns the symbol or pair to compare (or a promise of one, say from a symbol search); null does nothing. Calls [`chart.compare`](./data-sources#compare-symbols) with `mode` and `style` from `options`. Pressed while any symbol is compared; a symbol already compared, or a chart without a data source, shows a notification |
| `gridLayout(layouts?)` | `menu` in the `view` group for a [chart grid](./chart-grid)'s toolbar: switches the grid's preset and follows `layout:change`. Default every preset in `chartGridLayouts`. Does nothing outside a grid |
| `settingsToolbarItem()` | Cog `button` in the `view` group that opens the [chart settings](#chart-settings) dialog; place it right after `screenshot()`. Pressed while the dialog is open; pressing it again closes the dialog, as Cancel does. Disabled on a chart without settings: outside a shell or with `settings: false`. Its label is the `toolbarSettings` [shell message](./localization) |
| `replayToolbarItem()` | `button` in the `view` group that starts [bar replay](#bar-replay) from a picked bar, or stops it |

Presets that need the shell (`symbolHeader`, `fullscreen`'s default target, `toggleRail`) or the grid (`gridLayout`) find it through the chart they act on. Go to date sits in the bottom bar by default; the [bottom bar presets](#bottom-bar) (`goToDate`, `timezoneMenu`, `clock`, `scaleMode` and the others) work in the toolbar too, and `chart.actions.run('go-to-date')` opens the form from elsewhere.

### Where controls go

The [toolbar layout standard](https://github.com/chart-on/charton/blob/main/roadmap/toolbar-layout.md) assigns every control to one surface. In short:

| Surface | Holds |
| --- | --- |
| Top bar, `context` | Symbol search, interval, chart type. Always visible, overflow last |
| Top bar, `analysis` | Indicators, compare, templates, alerts, layers |
| Top bar, `view` | Undo/redo, layouts, replay, screenshot, fullscreen, settings, command palette. Overflow first |
| Rail | Drawing tools, then magnet, lock-all, hide-all, remove-all |
| Floating drawing bar | Properties and actions of the selected drawing |
| Bottom bar | Range presets, timezone and clock, trading session, scale mode and auto-fit |
| Settings panel | Anything changed less than once a session: theme, colors, grid |
| Context menu | Actions tied to a point, an axis or a drawing |

A divider parts the `context` items from the `analysis` items (ungrouped items count as `analysis`) wherever no visible `separator` item already does; hidden and overflowed items do not count, and the `view` group at the right edge needs none. Pass `dividers: false` in the toolbar options to leave them out.

When the top bar runs out of room, text beside icons drops first and segmented controls collapse into menus. Then items move into the "more" menu: the `view` group first, the `context` group next and custom items last. The "more" button itself always stays in view, and the toolbar never clips or scrolls. It refits when it resizes, when an item changes size (new text, a font that loads late, the compact layout), when items are added or removed and when the language changes. Aim for at most 8 items on a 1280 px wide chart.

```ts
const toolbar: ToolbarItem[] = [
  { type: 'custom', id: 'symbol', group: 'context', render: renderSymbol },
  { type: 'segmented', id: 'interval', group: 'context', /* ... */ },
  { type: 'menu', id: 'indicators', group: 'analysis', icon: Activity, text: 'Indicators', /* ... */ },
  { type: 'button', id: 'screenshot', group: 'view', icon: Camera, /* ... */ }, // right edge
];
```

### Changing the toolbar at runtime

```ts
const toolbar = shell.toolbar!;
toolbar.setValue('interval', '5m');           // change value without firing onChange
toolbar.refresh();                            // re-read isActive, isDisabled, currentValue
toolbar.update('snap', { hidden: true });     // merge a patch; only that item re-renders
toolbar.add(item, { after: 'interval' });     // or { before }; default: end of its group
toolbar.remove('snap');
toolbar.get('style')?.el;                     // escape hatch for custom DOM
toolbar.setItems(items);                      // replace everything
toolbar.items;                                // current list
```

Ids must be unique: `add`, `setItems` and the initial list throw on duplicates, and `add` throws on an unknown anchor. `update` cannot change an item's `type` or `id`; remove it and add a new one instead. Placement is a position in the list, so an item still renders inside its own `align` group.

### End-user customization

Pass an options object instead of the fixed item array, with the `toolbarCustomization` part, to let users choose toolbar actions. It works the same on `createToolbar` and on a [chart grid](./chart-grid)'s toolbar:

```ts
import { createChartShell, toolbarCustomization } from '@chart-on/ui';
import { createLocalStorageAdapter } from '@chart-on/core';

const settings = createLocalStorageAdapter({ prefix: 'my-chart:' }).settings;
const shell = createChartShell(el, {
  toolbar: { items, customize: toolbarCustomization({ locked: ['symbol', 'interval'] }), settings },
});

const unregister = shell.toolbar!.registerAction({
  id: 'alerts', label: 'Alerts', group: 'analysis', icon: alertIcon,
  onClick: () => openAlerts(),
});
shell.toolbar!.on('change', ({ ids }) => console.log(ids));
shell.toolbar!.openCustomization();
// unregister() removes the action from the catalog and toolbar.
```

**Customize toolbar** stays at the end of the **More** menu even when every item fits. The **More** button sits at the bar's right edge, after any right-aligned items. Right-clicking the toolbar opens the same docked panel. Check an action to add it, uncheck it or use its remove button to remove it. Drag its handle to reorder, with a mouse, pen or touch: the other rows make room as it moves, the order is saved on release, and Escape cancels the drag. From the keyboard, focus the handle and use Up/Down, or Tab to the move buttons and press Enter or Space. Moves stay within the action's placement group and alignment and cannot cross a locked item. Locked defaults stay in their original slots. Separators and spacers remain app-owned.

The catalog includes the app's default items, screenshot, fullscreen, undo/redo, drawing-tool rail, drawings visibility and reset view. Series, indicators and panes are not listed: each legend row has its own show or hide button, and the catalog stays short. Saved ids that no longer resolve are skipped. Give host actions stable ids to preserve them across reloads.

The preference is `{ version: 1, ids: [...] }` under the settings key `toolbar`. A valid empty list hides every unlocked item. Invalid or unsupported versions fall back to app defaults. Unknown ids are skipped; a host action registered after loading can resolve its saved id. Storage errors keep the current layout usable and emit an error notification. **Reset to default** removes the preference and restores the app's initial list. `settings` defaults to the local storage adapter; pass `null` for page-only preferences, or an adapter with a distinct prefix per toolbar.

`toolbar.setItems(items)` replaces the defaults and clears the user preference. `add`, `remove` and `update` still let app code change items; only user edits and resets emit `toolbar.on('change', { ids })`. An item array, or options without `customize`, keeps the toolbar fixed: `openCustomization()` does nothing and `registerAction()` throws. The demo enables customization and uses its existing settings store, so choices survive reloads.

#### Moving items between the toolbar and the bottom bar

When a shell's toolbar and bottom bar both have `customize`, users can move items between them. Each shown row in a bar's panel has a button that moves the item to the other bar ("Move Screenshot to the bottom bar", or "to the toolbar"). The item joins the other bar beside its placement group. Each bar's catalog also lists the other bar's actions, and checking one there moves it over, since an item shows in one bar at a time. Locked items stay in their bar. Each bar saves its own list (`toolbar` and `bottomBar`), and a move saves both. **Reset to default** in a bar restores its defaults, apart from items the other bar's saved layout holds.

```ts
const customize = toolbarCustomization({ locked: ['symbol'] });
createChartShell(el, {
  toolbar: { items, customize, settings },
  bottomBar: { items: defaultBottomBarItems(), customize, settings },
});
```

Favourite drawing tools remain in their separate [favourites bar](#favourite-tools).

## Rail

A rail too short for its buttons ends in a "more" button instead of clipping them: the last buttons (whole groups, with their flyouts) move into its popover, last first, and come back in order when the rail grows. The popover holds the buttons themselves, so they keep their state, tooltips and shortcuts, and the "more" button shows as active while one of them is (the drawing tool in use, say). Opened from the keyboard, the popover takes focus; the arrow keys move inside it and `Escape` returns to the button. The horizontal rail of the [compact layout](#narrow-screens) wraps into rows instead.

Default rail: cursor (with a flyout of the crosshair and the plain pointer, `crosshair.cursor`), the drawing tools in seven flyouts by their `group` (Lines, Annotate, Parallels, Ratios, Time, Patterns and Measure, in the [catalogue order](./drawings#tool-catalogue)), the eraser and zoom box, magnet / lock / hide toggles, undo / redo and "remove all". Each flyout's button starts on its group's face, the group's most general tool (Trend line, Text, Parallel channel, Fib retracement, Cyclic lines, ABCD pattern, Measure), and then shows the one last picked. `defaultRailItems(tools)` and `toolRailItems(tools)` build the tool entries from any tool list, one flyout per group in order of first appearance.

Build your own:

```ts
import { defaultRailItems } from '@chart-on/ui';
import { Magnet } from 'lucide';

createChartShell(el, {
  rail: [
    { type: 'cursor' },
    { type: 'group', label: 'Lines', tools: [{ tool: 'trendline' }, { tool: 'hline' }] },
    { type: 'tool', tool: 'measure' },
    { type: 'spacer' },
    {
      type: 'toggle', id: 'magnet', label: 'Magnet', icon: Magnet,
      get: (c) => c.drawings.magnet,
      set: (c, v) => c.drawings.setMagnet(v),
    },
  ],
});

// or extend the defaults
createChartShell(el, { rail: [...defaultRailItems(), { type: 'tool', tool: 'price-band', icon: MyIcon }] });
```

| Item | Fields |
| --- | --- |
| `cursor` | `label?`, `labelKey?`, `icon?` (of the crosshair entry); its flyout picks the crosshair or the plain pointer (`crosshair.cursor`) |
| `tool` | `tool`, `label?`, `icon?` |
| `group` | `label`, `labelKey?`, `tools` (flyout of tools) |
| `toggle` | `id`, `label`, `labelKey?`, `icon`, `iconOn?`, `get(chart)`, `set(chart, value)` |
| `action` | `id`, `label`, `labelKey?`, `icon`, `onClick(chart)` |
| `favorites` | `label?`, `labelKey?`, `icon?`: shows or hides the [favourites bar](#favourite-tools); left out without favourites |
| `separator`, `spacer` | Layout |

Built-in tools get icons from `toolIcons`. It also has icons for the tools on the roadmap, so they show up with an icon once they ship. A tool without its own `icon` or a `toolIcons` entry uses its group's icon from `groupIcons`, then the generic `drawingIcon`. The icon sets (`drawingIcons`, `groupIcons`, `drawingIcon`, `crosshairIcon`) are exported for reuse in your own controls, along with `chartTypeIcons`: one icon per candle style (keyed by `CandleStyle`, e.g. `chartTypeIcons.heikinAshi`), for building a chart type menu.

Replace the rail at runtime, for example when tool access changes: `shell.rail?.setItems(items)`.

The rail's text follows the chart's [language](./localization) and switches on `localization:change`, keeping focus on the button that had it. `labelKey` works as on toolbar items; the default items carry keys from `defaultShellMessages`, and a group labelled with its built-in English name (`groupLabels`) shows that name in the chart's language without one. Tool names come from `chart.drawings.toolLabel(type)`: a `tool.<type>` [message](./localization#drawing-tool-names) in the chart's language, else the tool's own `label`.

A click on a tool arms it for one drawing; a double-click, a double-tap or Shift+Enter keeps it active for repeated drawings (`drawings.setTool(type, { keep: true })`, see [Drawings](./drawings#activate-a-tool)) until Escape, the cursor, another tool or a click on the same tool. The kept tool shows a ring and a dot and is described as "Stays active". In a flyout, the menu stays open for a moment after a click, so the second click of a double-click lands on the same entry. Tool tooltips mention the gesture through the `toolKeepHint` message, and the description is `toolKept` (both in `defaultShellMessages`). Tool tooltips also show the tool's shortcut, the first key of its `draw-<tool>` [action](./interaction#actions-and-shortcuts) (none by default; for example `F9` once the app binds `draw-trendline` to it), with the buttons' `aria-keyshortcuts`, and follow rebinding.

### Favourite tools

With the `favorites` part, each tool in a rail flyout has a star. Starred tools appear in a favourites bar over the plot, so a tool is one click away; clicking one arms it like the rail does (a double-click keeps it), and the armed tool is highlighted. The bar shows while it has tools and the user has not hidden it with the rail's "Favourites bar" button.

- The bar starts centred at the bottom of the plot, or at the top when the [legend](./options#legend) sits at the bottom, so it does not cover the legend.
- Drag the grip to move the bar. It stays inside the plot, clear of both axes, and keeps its relative place when the chart resizes. With the grip focused, the arrow keys move it (Shift for larger steps).
- The button at the end switches between a row and a column. Below the [narrow-screen](#narrow-screens) breakpoint the bar is always a row.
- Drag a tool along the bar to reorder it, or press Alt with an arrow key on a focused tool.
- Tools the access rule refuses drop out of the bar but stay starred, and so do saved tools the chart does not register.

```ts
import { createChartShell, favorites } from '@chart-on/ui';

const shell = createChartShell(el, {
  favorites: favorites({
    tools: ['trendline', 'hline'], // starred until the user changes them
    bar: true,                     // show the bar while it has tools
    orientation: 'horizontal',     // or 'vertical'
    storageKey: 'my-app:favorites', // one key per shell on a page
  }),
});

shell.favorites?.get();             // ['trendline', 'hline'], in bar order
shell.favorites?.set(['ray', 'trendline']); // repeats and unknown tool types not starred already are skipped
shell.favorites?.add('fib-retracement');
shell.favorites?.remove('ray');
shell.favorites?.on('change', ({ types }) => {}); // returns an unsubscribe function
shell.favorites?.bar.setVisible(false);
shell.favorites?.bar.setOrientation('vertical');
```

Favourites, their order, and the bar's place, layout and visibility are saved to `localStorage` under `storageKey` (default `'charton:favorites'`). Saved favourites win over `tools`. Pass `settings` (a `SettingsAdapter`, such as the `settings` of `createLocalStorageAdapter`) to keep them under its key `favorites`, `storage: { load, save }` to keep them elsewhere, or `storage: null` to keep them for the visit only. `load()` may return anything: the shell keeps what it can use from it. If `load()` or `save()` throws, the shell logs a warning and carries on with the defaults (or the unsaved change). The saved record keeps favourites per kind (`items.tool` for the tools). Without the `favorites` option there are no stars, no bar and no rail button, and `shell.favorites` is null.

### Favourites of other kinds

`shell.favorites.of(kind)` returns the starred references of any kind, such as intervals, chart styles or symbols, kept in the same saved record as the tools. Each kind is an ordered list of non-empty strings, each once; what a reference means is up to the app. `of('tool')` is the tool list above, so it skips unknown tool types and its changes redraw the bar.

```ts
const intervals = shell.favorites!.of('interval');
intervals.set(['1h', '1D']);   // repeats and empty strings are skipped
intervals.add('5m');
intervals.move(2, 0);          // ['5m', '1h', '1D']
intervals.has('1h');           // true
intervals.remove('1h');
intervals.clear();
intervals.on('change', ({ items }) => {}); // this kind only; returns an unsubscribe function
```

The shell's own surfaces use these kinds:

| Kind | Where it is starred | Where the starred entries show |
| --- | --- | --- |
| `tool` | Rail flyouts | The favourites bar |
| `interval` | The menu of the `favoriteIntervals(list)` toolbar preset | Buttons beside that menu |
| `chart-style` | The menu of the `favoriteChartStyles()` toolbar preset | Icon buttons beside that menu |
| `indicator` | Rows of the [indicator picker](./indicator-picker#recents-and-favourites) | First in its All tab and categories |
| `symbol` | Results of the [symbol search](#symbol-search) | A Favourites group at the top while the search box is empty |

`favoriteIntervals` takes the options of `intervals` except `display`, and `favoriteChartStyles` the styles of `chartStyle`; use them in place of those presets. Their buttons follow the order the entries were starred in. Without the `favorites` part they show every entry as a button and no menu. Each starred symbol is looked up through the search source (`search(symbol)`, taking the result whose `symbol` matches). One the source no longer finds is listed as unavailable: greyed out, not selectable, still starred, and its star removes it. With the `favorites` part, the indicator picker keeps its favourites in `of('indicator')` instead of its own storage, and moves the ones it had saved there once.

```ts
import { createChartShell, favoriteChartStyles, favoriteIntervals, favorites } from '@chart-on/ui';

const shell = createChartShell(el, {
  toolbar: [favoriteIntervals(['1m', '5m', '15m', '1h', '4h', '1d', '1w']), favoriteChartStyles()],
  favorites: favorites({ kinds: [{ id: 'symbol', limit: 100 }] }),
});
```

#### Limits

Each kind holds at most 30 references unless its `limit` says otherwise. Starring past it is refused, never by dropping an older one: `add` returns false, `set` keeps the first `limit` entries, and a `limit` event fires. The shell's surfaces say so in their status text or a toast (`favoritesFull`).

```ts
shell.favorites?.on('limit', ({ kind, ref, limit }) => {});
shell.favorites?.on('list:change', ({ kind, items }) => {}); // any kind, tools included
```

#### Kinds of your own

`kinds` (an option of `favorites()`) and `shell.favorites.registerKind(kind)` set a kind's limit and say which references can be used now and how to use one. Give a built-in kind's id to change its limit. A kind's lists keep references that cannot be used now; `isAvailable` only lets surfaces grey them out.

```ts
const off = shell.favorites!.registerKind({
  id: 'watchlist',
  limit: 50,
  isAvailable: (ref) => listed.has(ref), // default: every reference can be used
  activate: (ref) => openWatchlist(ref),
});
const lists = shell.favorites!.of('watchlist');
lists.isAvailable('mine'); // through the kind's isAvailable
lists.activate('mine');    // runs activate; false when it has none or `isAvailable` says no
off();                     // back to the defaults
```

`of('tool')` uses a built-in kind: a tool is available while the chart registers it, and `activate` arms it.

#### Export and import

`export()` returns every kind's favourites and the bar's place with a format version, to save elsewhere or move to another browser; `import(data)` replaces them with such a record and saves it. Kinds and references the chart does not know are kept. Data of another version or shape is refused (`import` returns false and changes nothing).

```ts
const saved = JSON.stringify(shell.favorites!.export()); // { version: 1, items: { tool: [...], interval: [...] }, bar: {...} }
shell.favorites!.import(JSON.parse(saved));
```

## Command palette

<kbd>Ctrl</kbd>+<kbd>K</kbd> (<kbd>Cmd</kbd>+<kbd>K</kbd> on a Mac) opens the command palette: one search box over everything the chart can do. It lists every command on [`chart.actions`](./interaction#actions-and-shortcuts) with its shortcut and, for toggles such as auto scale, whether it is on. Commands that cannot run now (undo with nothing to undo) stay listed, after the ones that can, and cannot be picked. Picking a command closes the palette, gives focus back to where it was, then runs it. The palette opens with its search box and, under it, its categories as chips: typing lists matches from every category, and picking a chip lists that category. Under All, each row ends with the name of the category it came from.

The shell registers its own dialogs, panels and settings as actions, so the palette finds them too, and users can [bind keys](#keyboard-shortcuts) to them: `chart-settings` opens the chart settings, `appearance` toggles the appearance panel, and `light-mode` and `dark-mode` switch the theme (checked for the scheme in effect). The first two are left out when the shell has no settings dialog or no appearance panel. The chart settings' sections are a category of their own (`settings.commandSource`, id `settings`): "Axes" opens the dialog at its Axes section.

The search is fuzzy: `fc` finds "Fit content" by its initials and `lkdr` finds "Lock drawings" by its letters in order. Whole-label matches rank first, then label starts, word starts, initials, substrings and scattered letters; keywords and descriptions count less than the label.

Pass the `commandPalette` part to get it in the shell. `shell.commandPalette` is its handle, null without the part:

```ts
import { commandPalette, createChartShell } from '@chart-on/ui';

const shell = createChartShell(el, { commandPalette: commandPalette() });
shell.commandPalette?.open(); // or open('zoom') with a query
shell.commandPalette?.isOpen; // boolean
shell.applyFeatures({ commandPalette: false }); // turn it and its shortcut off at runtime
```

### Sources

With the [indicator picker](./indicator-picker#command-palette) on, the shell adds its **Indicators** source, which adds the picked indicator, and the picker's **Search everything** footer opens the palette with the picker's query; an app source with the id `indicators` replaces it. Apps add their own entries, such as symbols, as sources. Each source is a category beside **Actions**. A source returns entries for the query: a list the palette filters and ranks, or a promise for a server-side search (set `ranked: true` to keep the source's order). The `signal` aborts when the query changes or the palette closes. A source that fails is skipped; the others stay listed.

```ts
import type { CommandSource } from '@chart-on/ui';

const symbols: CommandSource = {
  id: 'symbols',
  label: 'Symbols',
  entries: (query) =>
    feed.search(query).then((found) =>
      found.map((s) => ({
        id: s.symbol,
        label: s.symbol,
        description: s.description,
        // Keep the interval on screen.
        run: () => chart.setSymbol(s.symbol, chart.data?.interval ?? '1d'),
      })),
    ),
  ranked: true,
};

createChartShell(el, { commandPalette: commandPalette({ sources: [symbols] }) });
const remove = shell.commandPalette!.addSource(indicatorSource); // later; remove() takes it out again
```

An entry has an `id`, a `label` and a `run` function, and optionally a `description`, `keywords`, a `shortcut` to show, `checked` for toggles and `disabled`. `hiddenActions` leaves actions out of the list, and `actions: false` lists only the sources.

### Palette shortcut

The shortcut is the `command-palette` action, labelled with the `actionCommandPalette` [shell message](./localization). Rebind it like any action, or set its default with `commandPalette.keys`:

```ts
shell.chart.actions.setKeys('command-palette', ['Mod+Shift+P']);
```

With the palette, the [symbol search](./symbol-search#shortcut) keeps <kbd>/</kbd> and is listed in the palette; without it (no `commandPalette` option) the symbol search also has Mod+K. `shortcutScope: 'document'` hears the shortcut anywhere on the page. `commandPaletteToolbarItem()` is a toolbar button for it, in the `view` group.

### Palette keys

| Key | Action |
| --- | --- |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd> | Open (the `command-palette` action) |
| <kbd>↓</kbd> / <kbd>↑</kbd>, <kbd>Page Down</kbd> / <kbd>Page Up</kbd> | Move through the entries |
| <kbd>Enter</kbd> | Run the active entry |
| <kbd>Tab</kbd> | Move to the categories and the close button; focus stays in the palette |
| <kbd>Escape</kbd> | Close and give focus back |

The search box is a combobox controlling a listbox, with the active entry as its `aria-activedescendant`. Each entry's accessible name includes its shortcut and its on or off state, and the result count is announced.

## Bottom bar

The bottom bar is off by default. `bottomBar: true` shows its default items (go to date, clock and the price scale menu); a list of items or the shorthand options below choose others.

The bottom bar holds items as the [toolbar](#toolbar) does: the same item types, `align`, `group`, `priority` and `hidden` fields, the same "more" menu when it runs out of room, and the same handle (`shell.bottomBar` is a `ToolbarHandle`, so `add`, `update`, `remove` and `setItems` work on it). Its controls are presets that work in either bar, and any toolbar item works in the bottom bar. Menus, forms and tooltips open downwards in the top toolbar and upwards in the bottom bar.

```ts
import { clock, goToDate, scaleMode, screenshot, timezoneMenu } from '@chart-on/ui';

// Go to date, the timezone and the price scale in the top toolbar, and no bottom bar.
createChartShell(el, {
  toolbar: [...myToolbarItems, goToDate(), timezoneMenu({ options: zones }), scaleMode()],
  bottomBar: false,
});

// A bottom bar of your own: a top toolbar preset next to the clock.
createChartShell(el, { bottomBar: [goToDate(), clock(), screenshot()] });
```

| Preset | Item id | Notes |
| --- | --- | --- |
| `rangePresets(list?, { onRange? })` | `ranges` | Range preset chips (default list `defaultRanges`), one menu in the compact layout |
| `goToDate()` | `go-to-date` | The go-to-date chip and form. It registers the `go-to-date` action wherever it is mounted |
| `timezoneMenu({ options, value? })` | `timezone` | Timezone menu |
| `clock()` | `clock` | Clock in the chart's timezone; opens the chart settings, or else the shell's `timezone` menu |
| `sessionMenu({ options, value? })` | `session` | Trading-session menu |
| `sessionBandsChip(bands)` | `session-bands` | Session bands chip |
| `scaleMode()` | `scale-mode` | Price scale menu |
| `scaleModeInline()` | `scale-mode`, `scale-auto` | The scale modes as a radio group and the auto-fit toggle: two items, spread them into the list |

The presets other than `rangePresets` and `goToDate` are end-aligned. `rangePresets`, `goToDate`, `clock` and `sessionBandsChip` are custom items: when a bar is too narrow they are hidden rather than listed in its "more" menu. If both bars use customization (`customize`), the bottom bar saves its layout under `bottomBar` (the `storageKey` option), apart from the toolbar's, and users can [move items between the bars](#moving-items-between-the-toolbar-and-the-bottom-bar).

### Default items

Without a list, the bar shows `defaultBottomBarItems(options)`: a go-to-date control on the left, after optional range presets. On the right: an optional timezone menu, a clock in the chart's timezone, an optional trading-session menu, and the main pane's price scale controls. By default those are one "Price scale" menu: its button shows the scale mode (`linear`, `log` or `%`, plus `auto` while auto-fit is on), and its list has the three modes and the auto-fit toggle by their full names ("Linear scale", "Logarithmic scale", "Percent scale", "Auto-fit the price scale"). With `scaleToggles: 'inline'` they are a radio group of the three modes with the auto-fit toggle beside it, named in full as tooltips; the group is one Tab stop, the arrow keys move between its choices (inside the shell, between every control of the bar, as on the toolbar) and Space or Enter picks one. Either way an indexed scale checks the percent choice, since both measure from a base. The price-to-bar ratio lock is in the [chart settings](#chart-settings), under **Axes**, **Axis lines**. When the bar is too narrow, its items move into a "more" menu, as on the toolbar.

The options below are shorthand for those default items; `bottomBar: defaultBottomBarItems({ ... })` gives the same bar as a list you can add to.

```ts
createChartShell(el, {
  bottomBar: {
    ranges: [
      { label: '1D', span: 86400 },
      { label: '1M', span: 30 * 86400, title: '1 month' },
      { label: 'YTD', span: 'ytd' },
      { label: 'All', span: 'all' },
    ],
    // Runs before the range is applied, e.g. to switch interval and reload data.
    onRange: (range, chart) => loadIntervalFor(range),
    clock: true,
    scaleToggles: 'menu',
    timezones: { value: 'local', options: [{ value: 'local', label: 'Local' }, { value: 'UTC', label: 'UTC' }] },
    sessions: {
      value: 'always',
      options: [
        { value: 'always', label: 'Always open' },
        { value: 'regular', label: 'Regular hours', session: regularHours }, // a SessionSchedule
      ],
    },
  },
});
```

| Option | Default | Notes |
| --- | --- | --- |
| `ranges` | none | Range presets. The toolbar's interval control already sets how much history shows, so the bar has none unless you pass some: `defaultRanges` gives `1D 5D 1M 3M 6M YTD 1Y 5Y All`. `span` is seconds ending at the newest bar, `'ytd'` or `'all'`. `labelKey` and `titleKey` name [messages](./localization#messages) for `label` and `title`; the defaults carry them |
| `onRange` | none | Called before the view changes |
| `clock` | `true` | Clock in the chart's `timezone`, with its UTC offset. Clicking it (or Enter or Space) opens the [chart settings](#chart-settings) on their **Time** section; with `settings: false` it opens the `timezones` menu instead, and without that menu it is plain text. Settings or a menu made after the clock are found within a second |
| `goToDate` | `true` | "Go to" chip: a date and an optional time in the chart's `timezone`; Enter goes there with `chart.goToTime`, paging in history as needed. The `go-to-date` action on `chart.actions` opens it too; it has no default key, so bind one with `setKeys`. Escape closes it |
| `scaleToggles` | `'menu'` | The main pane's scale mode (linear, log, percent) and auto-fit: one menu (`'menu'`, or `true`), a radio group with the auto-fit toggle beside it (`'inline'`), or none (`false`) |
| `timezones` | none | `{ options, value? }`. Picking an option sets the chart's `timezone` to its value (an IANA zone or `'local'`). The menu follows timezone changes made elsewhere, such as in the chart settings. `timezoneChoices()` from `@chart-on/core` lists every zone with its offset, if you want a longer menu |
| `sessions` | none | `{ options, value? }`. Picking an option sets the chart's `session` to its `session` schedule and shades time outside it. An option without `session` means always open, with no shading |
| `sessionBands` | none | A [session bands](./session-bands) primitive. Adds a chip with a dot per lane, solid while that lane is open, which opens a list with countdowns to each lane's next open or close. It follows lanes added, removed or recoloured at runtime. Attach the bands to the chart yourself to draw them |

The bar's own text follows the chart's [language](./localization) and switches on `localization:change`. Without the shell: `createBottomBar(host, chart, items)`, with a list of items, toolbar options or the shorthand options above; it returns a `ToolbarHandle`. To apply a range yourself: `applyRange(chart, range)`. `wallTime(date, time, timezone)` turns the form's `YYYY-MM-DD` and `HH:MM` into a time, as the control does.

## Navigator

An overview strip above the bottom bar: a miniature close line of the whole history, with a window over the part the chart shows. It is off by default.

```ts
const shell = createChartShell(el, { navigator: true });
// Or with options:
createChartShell(el, { navigator: { height: 48, series: shell.chart.main! } });
```

- **Drag the window** to pan and **drag its edges** to zoom. A press on the strip outside the window centres the window there, and the drag goes on from there.
- **Keyboard:** the window and both edges are focusable sliders. On the window, the arrow keys pan by a quarter of its width, Page Up and Page Down by a whole width, and Home and End jump to the oldest or newest bars. On an edge, the arrow keys move it by 1% of the history, Page Up and Page Down by 10%, and Home and End to the start or end.
- The chart follows through `setVisibleTimeRange(from, to, false)`, so it never animates behind the pointer. The window follows every other pan, zoom and data change (`view:change`, `data:loaded`, `data:bar`) and never writes back to the chart in response, so the two cannot loop.
- With `features.scroll` off the window cannot be moved; with `features.zoom` off the edges are hidden.
- The line is decimated per pixel: each column keeps the first, lowest, highest and last value of its bars, so a million bars redraw in a few milliseconds and spikes stay visible. A live tick only recomputes the newest column.

| Option | Default | Notes |
| --- | --- | --- |
| `height` | `40` | Strip height in css px |
| `series` | main series | Any series with `data` points that have `close` or `value`, e.g. a line series |

Colours come from the theme variables `--pc-navigator-line`, `--pc-navigator-window`, `--pc-navigator-border` and `--pc-navigator-shade`, which follow the dark and light themes. Without the shell: `createNavigator(host, chart, options)` appends the strip to `host` and returns `{ el, refresh(), destroy() }`.

## Bar replay

`replayToolbarItem()` is a `view`-group button for [bar replay](./replay): press it, then click the bar to start from; press it again to stop (or, while picking, to cancel). While a replay runs, a shell with the `replayControls: replayControls()` [part](#optional-parts), or on the default toolbar, shows a floating strip at the top of the chart with back one bar, play or pause, next bar, speed (1, 2, 5 or 10 bars per second), random bar and exit. Random bar restarts at another random bar with at least 100 bars before it and 50 after (disabled on shorter series). While picking the starting bar, the strip shows only random bar and exit, so a replay can start at a random bar without clicking one. While the replay is paused or has reached its last bar, a click on a bar restarts it from there, still paused and at the same speed; a drag still pans.

```ts
import { createChartShell, replayControls, replayToolbarItem } from '@chart-on/ui';

createChartShell(el, { toolbar: [/* your items, */ replayToolbarItem()], replayControls: replayControls() });
```

Without the shell: `createReplayControls(chart)`. `toggleReplay(chart)` and `isReplaying(chart)` drive your own button or menu entry, as the demo's View menu does.

## Data window

A panel listing every visible series value at the crosshair, or the newest bar, formatted like the legend. It is not positioned, so place it yourself, for example over the chart stage:

```ts
import { createDataWindow } from '@chart-on/ui';

const stage = shell.chart.root.parentElement!; // not chart.root: its pointer handlers would pan underneath
const dataWindow = createDataWindow(stage, shell.chart, { title: 'Data window' });
dataWindow.el.style.cssText = 'position:absolute; top:8px; right:84px; z-index:3';

dataWindow.el.hidden = true;  // it skips updates while hidden
dataWindow.refresh();         // re-read now
dataWindow.destroy();
```

The panel is a labelled region and can take focus. With focus, `←` / `→` step bar by bar (the crosshair follows), `Home` / `End` jump to the ends, and `Escape` or moving focus away releases. The time and values are announced politely to screen readers when it takes focus and on each step; pointer moves and the periodic refresh stay silent. It follows the crosshair and re-reads values every second so live ticks show up. Call `destroy()` before destroying the chart.

## Chart settings

A settings dialog with the options users change less than once a session, in six sections, one per thing the user adjusts and ordered from the data to the chrome around it: **Series** (rising and falling body colors, wicks, borders, hollow falling bodies, body width, coloring by the previous close, the split and dividend [adjustment](./data-sources#splits-and-dividends)), **Readout** (what shows values under the pointer: the legend's on/off, values, position, change, arrows, idle values, row buttons and market status, and the crosshair's mode, color, lines and axis labels), **Axes** (last value labels, time left in bar, axis lines and tick marks, label width, text and label colors), **Time** (the timezone: Local and UTC, then every zone the browser knows with its current UTC offset, in a searchable list; seconds in times, trading day dividers, session shading, and the data source's [markers](./data-sources#markers) on the time axis with their color; the bottom bar clock opens this section), **Background** (background, each grid direction, watermark) and **Markers** (the split and dividend markers and the data source's [markers](./data-sources#markers) on bars, last since only some data sources supply them). Edits apply as the user makes them; Ok keeps them, Cancel or Escape puts the chart back, and **Reset to defaults** returns to your app's options. The shell creates it; open it with `settingsToolbarItem()`, a `view`-group cog that goes beside the screenshot button, or from code:

```ts
import { createChartShell, settingsToolbarItem } from '@chart-on/ui';

const shell = createChartShell(el, { toolbar: [/* your items, */ settingsToolbarItem()] });
shell.settings?.open('readout'); // optionally at a section
```

The dialog is generated from `chartSettingsSchema`, plain data exported by `@chart-on/core`: sections of groups of fields, each naming the option it edits by a dotted path (`legend.mode`, `crosshair.vertical.visible`, `theme.up`, `features.watermark`, or `series.wicks` for the main series) with its kind (`boolean`, `select`, `number`, `slider` or `color`), label and choices (a `select` with more than 20 gets a search box). `readChartSetting(chart, field)` and `applyChartSettings(chart, { [path]: value })` read and write those paths through `applyOptions`, so a field needs no code of its own. Pass `sections` to hide, reorder or add sections; any chart option path works as a field:

```ts
createChartShell(el, {
  settings: {
    sections: (defaults) => [
      ...defaults.filter((s) => s.id !== 'markers'),
      {
        id: 'motion',
        title: 'Motion',
        groups: [{ id: 'zoom', fields: [{ path: 'smoothZoom', label: 'Smooth zoom', kind: 'boolean' }] }],
      },
    ],
  },
});
```

Fields the chart has no value for are left out, such as the main series' fields before data is loaded. Theme colors and grid lines are saved as [appearance overrides](./theming#appearance-panel), so they survive a dark/light switch. The other changed settings are saved to `localStorage` (`charton:settings`) when the user presses Ok, and applied again on the next visit; the main series' settings are applied whenever a main series is added. Give each chart on a page its own `storageKey`, pass your own `storage` (`{ load, save }` of a path-to-value record), or `null` to keep them for the visit only; `settings: false` turns the dialog off. Without the shell: `createChartSettings(chart, host, options)`, where `host` is the element the dialog opens in.

Settings that are not chart options, such as your app's theme or language, go in `fields`: sections after the option sections, whose fields have an `id` and their own `get(chart)` and `set(chart, value)` instead of a path. They take the same kinds, apply as the user edits them, and Cancel sets them back to the value read when the dialog opened. They are not saved to settings storage and **Reset to defaults** leaves them alone; keeping them is up to your app. `actions` adds buttons. They sit under the section list, for example one that opens another dialog; `placement: 'footer'` puts one at the footer start instead, for a button that acts on the dialog itself. **Reset to defaults** sits in the header and the footer keeps Cancel and Ok:

```ts
createChartShell(el, {
  settings: {
    fields: [
      {
        id: 'app',
        title: 'App',
        groups: [
          {
            id: 'look',
            fields: [
              {
                id: 'appTheme',
                label: 'Theme',
                kind: 'select',
                choices: [
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ],
                get: () => app.theme,
                set: (_chart, value) => app.setTheme(value as 'dark' | 'light'),
              },
            ],
          },
        ],
      },
    ],
    actions: [{ id: 'colors', label: 'Colors…', onClick: () => openColors() }],
  },
});
```

### Keyboard shortcuts

`createShortcutSettings(chart, host, options)` lets users change the chart's [shortcuts](./interaction#actions-and-shortcuts). It is opt-in, so apps that do not call it do not ship it; while it exists, the chart settings dialog has a **Keyboard shortcuts…** button that opens it:

```ts
import { createChartShell, createShortcutSettings } from '@chart-on/ui';

const shell = createChartShell(el, { /* ... */ });
const shortcuts = createShortcutSettings(shell.chart, shell.el);
shortcuts.open(); // or from the chart settings
```

The dialog lists every action on `chart.actions`, grouped (Navigation, Editing, Drawing, General for your own actions), with its shortcuts in the platform's spelling (Cmd on Apple, Ctrl elsewhere). Users press a shortcut to change it, add another with **+**, remove one, reset an action or **Reset all**; changes apply at once, and tooltips made with `showShortcut` follow. While recording, `Escape` cancels and Tab moves on; a bare modifier waits for a key, and combinations the browser or system keep (`Mod+W`, `Mod+T`, `Mod+N`, `Mod+Q`, `Mod+L`, `Mod+Tab`, `Alt+Tab`, `Alt+F4` …) are refused with a message. A shortcut another action has asks first: **Reassign** moves it, **Cancel** keeps both as they were, so `actions.conflicts()` stays empty. A screen reader hears each recorded or refused combination.

The user's changes, on top of your app's keymap when it is created, are saved to `localStorage` (`charton:shortcuts`) and applied again on the next visit; saved keys that now clash with your app's keymap are dropped. As with the chart settings, pass `storageKey`, your own `storage`, or `null` to keep them for the visit only. `destroy()` closes the dialog and removes the button; the shortcuts stay as they are.

## Table view

The shell can show the visible data as an accessible table: a panel over the chart holding [`chart.describeTable`](./interaction#data-table), with a caption, column and row headers, and every value in its series' format. `tableViewToolbarItem()` is a `view`-group button that opens and closes it; `shell.tableView` does the same from code.

```ts
import { createChartShell, tableViewToolbarItem } from '@chart-on/ui';

const shell = createChartShell(el, {
  toolbar: [/* your items, */ tableViewToolbarItem()],
  tableView: { maxRows: 200, title: 'Data table' }, // `false` turns it off
});
shell.tableView?.open();
```

Opening it moves focus to the table, which scrolls with the arrow keys; `Escape` or the close button closes it and gives focus back. It follows the view as it pans and zooms and as bars arrive, at most four times a second, and changes only the rows that differ, so a screen reader keeps its place during live updates. `maxRows` (default 500) keeps the newest rows, and the caption says how many were left out. Call `refresh()` after data changes the chart emits no event for. Without the shell, `createTableView(chart, options)` gives the same panel.

## Depth ladder

`createDepthLadder(host, lane, options)` lists a [depth lane](./depth-lane#ladder-panel)'s levels as a price ladder, asks above bids, each row shaded by its size. Like the data window, it is not positioned.

## Object tree

A panel listing the panes and, in each, its series, indicators and drawings (topmost drawing first). Each row shows, hides, locks, renames, removes and reorders its object through the public chart API, so drawing edits are undo steps (bulk actions on a multi-selection are one step) and everything saves with [layouts](./layouts) like edits made on the chart. Selecting drawing rows selects those drawings on the chart (several at once with a multi-selection), and selecting drawings on the chart selects their rows. Focusing a selected indicator row selects that indicator on the chart instead (see [Selecting](./indicators#selecting)). Like the data window it is not positioned:

```ts
import { createObjectTree } from '@chart-on/ui';

const tree = createObjectTree(stage, shell.chart, { title: 'Object tree' });
tree.el.style.cssText = 'position:absolute; top:8px; left:8px; bottom:8px; z-index:3';

tree.el.hidden = true;           // it skips rebuilding while hidden
tree.refresh();                  // rebuild now, e.g. after showing it again
tree.selection;                  // selected rows: { kind, key, label, target, ... }
tree.select([`drawing:${id}`]);  // select rows by key
tree.destroy();
```

What each kind of row offers:

| Row | Show/hide | Lock | Rename | Remove | Reorder |
| --- | --- | --- | --- | --- | --- |
| Pane | collapses or expands it | | | not the main pane | among the panes below the main one |
| Series | `setVisible` | | its `title` | not the main series | into another pane |
| Indicator | `setVisible` | | | yes | |
| Drawing | `setVisible` | yes | its `name` | yes | z-order within its pane |

Reorder by dragging a row onto another, or with `Alt+↑` / `Alt+↓`. The panel is an ARIA tree with one tab stop: `↑` / `↓`, `Home` / `End` move and select (`Shift` extends the selection, `Ctrl`/`Cmd` moves focus only), `←` / `→` fold and unfold panes or jump to the parent, `Space` toggles a row's selection, `Ctrl`/`Cmd+A` selects all, `Enter` or `F2` renames (`Enter` saves, `Escape` cancels, an empty name restores the default label), `Delete` removes, `H` shows or hides, `L` locks or unlocks, and `Ctrl`/`Cmd+Z` / `Ctrl+Y` undo and redo drawing changes. The row buttons are for the pointer and stay out of the tab order; the header buttons act on the selection.

The tree model is exported too, for a panel of your own: `buildObjectTree(chart)` returns the panes with their children, and `setNodesVisible`, `setNodesLocked`, `removeNodes`, `renameNode`, `moveNode` and `dropNode` apply the same actions. Its colours come from the shell tokens (`--pc-panel`, `--pc-hover`, `--pc-accent-soft`, `--pc-focus` and friends), so it follows the dark and light themes.

## Pointer tooltip

A small box beside the pointer with the hovered bar's time and every visible series' values, as the legend formats them. It suits minimal or mobile embeds that turn the legend off. Turn it on with the `tooltip` flag:

```ts
const shell = createChartShell(el, {
  features: { tooltip: true },
  chart: { features: { legend: false } },
  tooltip: {
    anchor: 'pointer',   // level with the crosshair; 'top' pins it to the top of the plot
    delay: 150,          // ms after the crosshair appears; moves after that show at once
    format: (v) => `${v.timeText}  ${v.series[0]?.values?.close ?? ''}`, // text, an element, or null for none
  },
});
shell.applyFeatures({ tooltip: false });
```

It sits right of the hovered bar, or left of it near the right edge, so it never covers the bar, and it stays inside the plot. On touch it shows only while a long-press [inspects](./interaction) or the crosshair is locked, so a plain pan does not flash it. Its colors are the `--pc-tip-bg`, `--pc-tip-ink` and `--pc-tip-shadow` tokens, the same as the button tooltips. It is hidden from screen readers, which get the same values from the legend and the data window.

Without the shell: `createPointerTooltip(chart, options)` returns `{ el, refresh, destroy }`. `pointerTooltipContent(values)` builds the default content, for wrapping it in your own. `placePointerTooltip(bar, y, size, area)` is the placement it uses.

## Narrow screens

With the `railSheet` flag, a shell narrower than `railBreakpoint` (640 px by default, measured on the shell rather than the window, so an embed in a narrow column gets it too) switches to a compact layout:

- The rail leaves its column, so the chart takes the full width. A "Drawing tools" button at the start of the bottom bar (or floating over the chart's lower-left corner without one) opens it as a bottom sheet. The tools wrap into rows and group menus open upwards. Picking a tool, `Escape` or a press outside closes the sheet.
- The bottom bar's range presets collapse into a "Range" menu.
- The [favourites bar](#favourite-tools) stays a single row, and its row/column button is hidden.

```ts
const shell = createChartShell(el, { features: { railSheet: true }, railBreakpoint: 560 });
```

The shell marks the compact layout with `data-pc-layout="compact"`, for your own CSS. Without the flag, a narrow shell only gets thinner chrome: smaller rail buttons and gaps, and no clock in the bottom bar. That rule is a CSS container query on the shell, so it also follows the shell's width rather than the window's.

## Icons

Every `icon` in the toolbar, rail, menus and buttons takes any of these:

| Form | Example | Notes |
| --- | --- | --- |
| SVG markup | `'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 12h16"/></svg>'` | Built with DOM calls, no markup parser. Only drawing elements are kept (`svg`, `g`, `path`, shapes, gradients, masks); scripts, links, event handlers, `style` attributes and external `url()` references are dropped |
| `SVGElement` | `document.querySelector('#my-icon svg')` | Copied for each control that shows it |
| `IconNode` | `[['path', { d: 'M4 12h16' }]]` | `[tag, attrs]` pairs on a 24-unit grid, stroked with `currentColor`: the form of the built-in icons. Icon objects of the open-source icon set the shell's icons come from have this form too; the package bundles only the icons it uses, so install the set yourself for more (as the examples above do) |
| Function | `() => myImage()` | Called whenever a control shows the icon, so return a new element each time; it is used as is |

Markup and elements are sized to the control (a `width` and `height` without a `viewBox` become one, so they scale) and get `aria-hidden`, since the control carries the label. Use `currentColor` for strokes and fills to follow the theme. So a toolbar can use your own icons with nothing else installed:

```ts
const snapIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="4"/></svg>';
const toolbar: ToolbarItem[] = [
  { type: 'button', id: 'snap', label: 'Screenshot', icon: snapIcon, align: 'end', onClick: (chart) => snapshot(chart) },
];
```

## Fitting into the page's CSS

- **Class names.** Every class the UI package adds starts with `pc-` (`pc-shell`, `pc-toolbar`, `pc-btn`…), and so does every custom property (`--pc-*`). Treat the prefix as reserved: these names are a stable contract you can target from your CSS. The only other classes are state modifiers (`is-active`, `has-logos`), which always sit next to a `pc-` class and are only styled together with one, so your own `.is-active` rules do not leak in.
- **Element resets stay out.** The stylesheet styles controls through `pc-` classes, which outrank element selectors, so a page reset such as `button { padding: 0 }` loses wherever the stylesheet sets the property, whatever the load order. To restyle a control, override the `--pc-*` tokens (see [Theming](./theming#ui-shell)), or use a selector at least as specific as the stylesheet's in a stylesheet loaded after it.
- **A cascade layer, if you use layers.** To make any of your rules win regardless of specificity, import the stylesheet into a layer and declare the order before it loads. Rules outside layers then always win over the shell's:

  ```css
  @layer reset, charton;
  @import '@chart-on/ui/style.css' layer(charton);
  ```

  Inside a layer, the shell no longer outranks your element resets by specificity, so keep resets in a layer listed before `charton`, as above.
- **Width.** The shell is a CSS size container in the inline direction, so its width must come from its parent (it is `width: 100%`), never from its content. Do not put it in a shrink-to-fit box such as an inline-block or an auto-width float.

The chart root inside the stage is styled by core: see [the container](./embedding#the-container).

## Without the shell

Toolbar and rail work on their own with any core chart. Indicators, compared symbols, drawings, annotations and the built-in drawing tools are [opt-in](./features#opt-in-features) in core, so give the chart the plugins, as the shell does. So is image capture: the `screenshot()` and `print()` presets need `imageCapture()` (in `builtins()`). The rail offers the tools the chart has:

```ts
import { builtins, createChart } from '@chart-on/core';
import { createToolbar, createToolRail } from '@chart-on/ui';

const chart = createChart(chartEl, { plugins: builtins() });
createToolbar(topEl, chart, items);
createToolRail(sideEl, chart); // defaults to built-in tools
```

The rail, the drawing toolbar and settings, the object tree, the context menu and the order draft editor read `chart.drawings` and `chart.annotations`, so the chart needs drawings (`drawingTools()` or `drawings()`) and `annotations()`, and the order draft editor and cluster list also `trading()`; the indicator picker, indicator settings, indicator templates, the legend row menu, the series settings, the object tree, the toolbar catalog and the toolbar presets read `chart.indicators`, which needs `indicators()`, the `compare` toolbar item calls `chart.compare`, which needs `comparisons()`, and the replay toolbar item and controls use `chart.replay`, which needs `replay()`. `builtins()` has them all. On a chart without them these parts throw a [`not-registered`](./errors#not-registered) error.

## Drawing toolbar

Selecting a drawing shows a small floating toolbar with the drawing's style controls, then lock, clone, delete and **Settings**. It shows only controls the drawing's tool honours (its `styleFields`, see [toolbar fields](./drawings#toolbar-fields)): the first four inline (`chart.drawings.quickFields`), such as color, fill, line width and line style; the rest (text color, font size, bold, italic, label and extend toggles) are in the settings dialog. The font size menus offer the theme's drawing font size times `2^(k/3)` for k from -1 to 6, rounded, so every third step doubles the size (10, 12, 15, 19, 24, 30, 38 and 48 px at the default 12 px), plus the drawing's own size when it is not one of them. A custom tool's `color` and `select` settings get inline controls too. Fibonacci tools add a **Levels** editor with each level's visibility, value and color. It sits above the drawing, or below, right or left of it when there is no room, so it stays off the drawing's anchors. It follows the drawing while panning and hides on deselect, Escape or when the drawing scrolls out of view. Changes go through `chart.drawings.update`, so they are undoable and fire `drawings:change`; dragging across a color picker (or the fill's opacity) previews live and records a single undo step. Arrow and `+`/`-` keys stay in the toolbar, while Escape, Delete and undo/redo shortcuts still reach the chart.

With several drawings selected, the toolbar shows the fields of the drawing selected last, and an edit applies to every selected drawing whose tool offers that field, as one undo step; lock, clone and delete act on all of them. **Group** groups the selection and **Ungroup** dissolves its groups (see [groups](./drawings#groups)); the drawing context menu has the same two items. Their labels are the `drawingGroup` and `drawingUngroup` keys of `defaultShellMessages`.

Outside the shell, mount it with `createDrawingToolbar(chart, { onSettings })`; `placeToolbar(rect, size, area)` is the placement rule if you build your own (an optional `area.top` keeps a band at the top of the plot clear, as the built-in toolbar does for the replay controls). Without `onSettings` there is no Settings button, and the fields that are not inline go under a **More style** button instead.

### Drawing settings

The Settings button, or a double click on a drawing, opens a settings dialog with every field the drawing's tool honours, plus its `settings` (see [custom drawing tools](./custom-drawing-tools)): line and text fields on a **Style** tab, a custom tool's own settings under **Options**, and a Fibonacci tool's levels on a **Levels** tab. A **Visibility** tab sets the intervals the drawing shows on ([`visibleOn`](./drawings#show-on-some-intervals-only)): per unit, seconds (1–59), minutes (1–59), hours (1–23), days (1–6), weeks (1–4) and months (1–12, where 12 also covers years and longer), a toggle and the counts from and to. These spans match the legend's interval groups, so the rows never overlap by length; a 10 day chart counts as weeks. Every unit on in full means every interval, and at least one unit must stay on. Ranges set from code that the rows cannot show exactly are shown on the rows they cover and kept unless the tab is edited. The tab is there for every drawing, so the dialog also opens for a tool with no style fields. Text tools keep editing their text on double click, and nothing opens while all drawings are locked. Edits preview live on the chart. **Ok** commits the fields that changed, style and intervals, with one `chart.drawings.update`, so the whole dialog is one undo step and, with `rememberStyle` on, the style fields become the tool's defaults ([tool defaults](./drawings#tool-defaults)). **Cancel**, Escape or closing put the drawing back without an undo step. **Reset** fills in the tool's own `defaultStyle` (and the theme for the rest). The dialog closes if the drawing is removed. `drawingSettings: false` turns it off.

`drawingSettings: { headerControl }` turns it on with a control in the dialog's header: a function that gets the dialog of a drawing with style fields (`chart`, `host`, the tool `type`, `style()` with the style fields as shown, and `setStyle(values)`, which fills them in as a preview, leaves out fields the form would refuse, such as a number out of range or an unknown choice, and returns whether it filled any in) and returns `{ el, destroy }`, or null for none. `destroy` runs when the dialog closes. `createDrawingSettings` and `openDrawingSettings` take the same options as their last argument.

Outside the shell:

```ts
import { createDrawingSettings, createDrawingToolbar, openDrawingSettings } from '@chart-on/ui';

const settings = createDrawingSettings(chart, hostEl); // opens on double click
createDrawingToolbar(chart, { onSettings: (id) => settings.open(id) });
openDrawingSettings(chart, hostEl, id); // one dialog, returns a FormDialog or null
```

#### Drawing templates

Style templates are an opt-in add-on in their own entry, `@chart-on/ui/templates`, so apps that leave them out do not ship them. `drawingTemplates()` is a header control that adds a **Template** menu to the drawing settings dialog, and `indicatorTemplates()` adds the same menu to the [indicator settings](#indicator-settings) panel:

```ts
import { createChartShell } from '@chart-on/ui';
import { drawingTemplates, indicatorTemplates } from '@chart-on/ui/templates';

createChartShell(el, {
  drawingSettings: { headerControl: drawingTemplates({ storage }) },
  indicatorSettings: { headerControl: indicatorTemplates({ storage }) },
});
```

**Save as template…** asks for a name and saves the Style and Levels fields as shown; names compare without case, and a taken name is refused. Picking a saved name fills those fields in as a preview, so **Ok** commits it as one undo step and **Cancel** drops it; only fields the dialog shows, with a value it accepts (a level list needs a finite value per level, a number within its bounds, a choice among its options), are taken from a template. The names are listed again under **Delete**, which asks first. Templates are the `'drawing'` [templates of a storage adapter](./storage#storage-adapter), scoped to the tool type; `storage` defaults to `createLocalStorageAdapter()`, and an adapter without the template methods shows no menu. The name prompt and the delete question close with the dialog. The menu's own text has the message keys `drawingTemplate` ("Template"), `templatesSaveAs` ("Save as template…") and `templatesApply` ("Apply template"); the rest is shared with the [indicator templates](./indicator-picker#indicator-templates). The script-tag build includes it.

In the indicator panel the menu saves the indicator's inputs, colours and plot styles (not whether it is shown or the intervals it shows on) as `'indicator'` templates scoped to the indicator id. A saved name applies live, like an edit: **Ok** keeps it as one undo step and **Cancel** puts the indicator back. Values the panel would refuse are left out, and a template with nothing left is refused.

##### Save as default

The same menu can make a tool's or an indicator's settings the default for new ones. For drawings, `drawingTemplates({ defaults: true })` adds **Save as default** and **Reset default**: they call [`chart.drawings.setToolDefaults`](./drawings) with the Style and Levels fields as shown, or with `null`. Those defaults are kept in the layout, not in `storage`, and work with `rememberStyle` off. The dialog's own **Reset to defaults** still goes to the tool's `defaultStyle`, and **Ok** or **Cancel** decide about the open drawing as before.

For indicators, `indicatorDefaults({ storage })` keeps one default per indicator id: its inputs and plot styles, with the definition's `version`. Pass it to `indicatorTemplates({ defaults })` for the menu items, and its `initialState` to the [indicator picker](./indicator-picker#on-its-own), so indicators added from the picker or the command palette start from the saved default:

```ts
import { drawingTemplates, indicatorDefaults, indicatorTemplates } from '@chart-on/ui/templates';

const defaults = indicatorDefaults({ storage }); // storage defaults to createLocalStorageAdapter()
createChartShell(el, {
  drawingSettings: { headerControl: drawingTemplates({ storage, defaults: true }) },
  indicatorSettings: { headerControl: indicatorTemplates({ storage, defaults }) },
  indicatorPicker: { initialState: defaults.initialState },
});
```

**Save as default** stores what the panel applies live, `indicator.serialize()`'s inputs and plot styles, as the `'indicator-default'` [template](./storage#storage-adapter) named `'default'` of the indicator id; **Reset default** removes it. Indicators added from code start from the definition's defaults as before. A default saved for another definition `version`, or with inputs the definition refuses, is not used and logs a warning; plot styles the indicator refuses, such as one of a plot it no longer has, are skipped. An adapter without `loadTemplate`, `saveTemplate` and `removeTemplate` gives no `save` or `reset` (the items are hidden) and an `initialState` that resolves null. Plot styles apply right after the add, so they are their own undo step. The panel's **Reset to defaults** still goes to the definition's defaults. The menu's own text has the message keys `templatesSaveDefault` ("Save as default"), `templatesResetDefault` ("Reset default"), `templatesDefaultSaved` ("Saved as default") and `templatesDefaultReset` ("Default reset").

## Indicator settings

An indicator's legend row settings button, **Settings…** in the row's menu, and double-clicking one of its plots open its settings in a panel that slides in from the right of the chart, so the chart stays in view and updates while you edit. On a narrow chart it is a bottom sheet. The tabs come from the indicator's definition:

- **Inputs**: every input but colours (numbers, sources including volume, selects, text and switches), in its `group`, with the input's `visible`, `disabled` and `validate` rules ([input schema](./indicators#inputs)). The chart's own checks run on every edit, so the panel rejects exactly what `applyInputs` would.
- **Style**: the colour inputs, paired up/down colours together; per plot, whether it is shown, and for lines their width and line style ([plot styles](./indicators#plot-styles)); and whether the indicator is visible. A colour input left empty (the built-ins' default) follows the theme: it shows the colour drawn and stays empty, so it keeps following theme changes, until you pick one. **Reset to defaults** empties it again.
- **Visibility**: the interval groups it shows on, the same groups as **Show on** in the row's menu.

Edits apply live while every field is valid. **Ok** keeps them; **Cancel**, Escape, the close button or `close()` put the inputs, plot styles, visibility and intervals back. **Reset to defaults**, at the start of the footer as in a drawing's panel, fills in the definition's defaults. With more than one indicator on the chart, a switcher takes the title's place in the header and moves to another one, keeping the edits made so far. The panel closes if the indicator is removed, and nothing opens for an indicator whose definition is not registered. What the panel changes is what `indicator.serialize()` saves, so it round-trips through saved layouts.

`indicatorSettings: { headerControl }` turns it on with a control in an indicator panel's header, such as the [template menu](#drawing-templates): a function that gets the panel (`chart`, `host`, the `indicator`, its definition id as `type`, `style()` with the inputs and plot styles as shown, and `setStyle(values)`, which applies them live, leaves out what the panel would refuse and returns whether it applied any) and returns `{ el, destroy }`, or null for none. `destroy` runs when the panel closes. `createIndicatorSettings` and `openIndicatorSettings` take it in their options.

While `indicatorSettings` is on, every legend row that has settings shows a settings button, and its menu a Settings… item:

- An indicator opens the panel above (only while its definition is registered).
- The main series opens the [chart settings](#chart-settings) at its Series section.
- A compared symbol opens a style panel: its colour, line width and line style (for a line), whether it is shown, and its price scale (the main scale in percent, its own scale, or its own pane). Changing the price scale moves it with [`setMode`](./data-sources#compare-symbols), so it keeps its bars, legend row and handle, and **Cancel** puts it back where it was. Line width and style are not part of `CompareState`, so saved layouts keep only the colour and the price scale.
- Any other line, histogram or candle series opens the same style panel with the options its type has: a colour (above and below colours for a baseline line, positive and negative colours where those are set, rising and falling colours for candles), line width and style for lines, and whether it is shown.

Rows with nothing to set show no settings button: a histogram coloured point by point (such as volume), heatmaps and custom series. Edits apply live; **Ok** keeps them, and **Cancel**, Escape or the close button put them back. The shell declares the rows it handles with `chart.provideSeriesSettings`, so an app can cover the other rows with a `series:settings` listener and a provider of its own. `indicatorSettings: false` turns it all off and leaves `series:settings` to you.

Outside the shell:

```ts
import { createIndicatorSettings, createSeriesSettings, indicatorSettingsForm, openIndicatorSettings, openSeriesStyleSettings, seriesSettingsForm } from '@chart-on/ui';

const settings = createIndicatorSettings(chart, stageEl); // opens on series:settings for indicators
settings.open(indicator);
openIndicatorSettings(chart, stageEl, indicator); // one panel, returns a FormDialog or null
indicatorSettingsForm(def, indicator.serialize(), chart); // the schema and values, for a form of your own (chart: label language, and the theme colours shown for empty colour inputs)

const styles = createSeriesSettings(chart, stageEl); // opens on series:settings for compared symbols and plain series
styles.open(series);
openSeriesStyleSettings(chart, stageEl, series); // one panel, returns a FormDialog or null
seriesSettingsForm(series, chart); // the schema and values; hasSeriesStyleSettings(chart, series) tells whether there is anything to edit
```

## Context menu

Right-clicking the chart opens a menu for what is under the pointer:

| Target | Default items |
| --- | --- |
| Plot | Reset view, copy price, add a horizontal line at the price and a vertical line at the bar's time (when a bar is under the pointer; both undoable), auto / log / percent scale, and Appearance when the shell has the [appearance panel](./theming#appearance-panel) |
| Price axis | Copy price, auto / log / percent scale, invert scale |
| Time axis | Reset view, scroll to newest |
| Drawing | Lock or unlock, clone, delete (the drawing is selected first) |
| Legend row | A heading with the row's title (an indicator's name and parameters), then Settings… (on rows with settings, see `chart.hasSeriesSettings`), Duplicate, Move up / Move down, Move to price pane / Move to new pane, Merge into pane ▸, Scale ▸ (right, left, or own scale with no axis), Show on ▸ (interval groups), Fold legend and Remove, each only when it applies |

A legend row's menu opens from its "More" button, a right click on the row, or a long press on it on touch screens. The actions are the chart's own API (`chart.indicators.duplicate`, `chart.moveSeries`, `Indicator.setPriceScale`, `Indicator.setVisibleOn`, `chart.setLegendFolded`, `indicator.remove()`), so they fire the usual events, and an indicator's fold is saved with it. `legendMenuItems(chart, series)` returns these defaults and `INTERVAL_GROUPS` the groups "Show on" offers.

With the chart focused, the `Menu` key or `Shift`+`F10` opens the menu from the keyboard. Focus moves to the first item; arrow keys, `Home` and `End` move between items, `Enter` or `Space` picks one, `Arrow Right` opens a submenu and `Arrow Left` closes it, and `Escape` (in a submenu: closes only the submenu), `Tab` or a press outside closes the menu and returns focus to the chart.

On touch screens a long press on the plot opens it when the chart's `touchInspect` option is `'off'`; otherwise a long press inspects values. A long press on an axis or a drawing does not open it yet.

`items(event, defaults, chart)` adds, removes or reorders items. `event` is the chart's [`chart:contextmenu` event](./events), so you can branch on `event.target`, `event.price` or `event.drawing`. Return `[]` for no menu there; the browser's menu stays suppressed too, so the right click does nothing. To keep the browser's menu everywhere, pass `contextMenu: false`:

```ts
createChartShell(el, {
  contextMenu: {
    items: (event, defaults, chart) =>
      event.target === 'plot' && event.price !== null
        ? [...defaults, { type: 'separator' }, { type: 'action', id: 'alert', label: 'Add alert', onSelect: () => addAlert(event.price!) }]
        : defaults,
  },
});
```

An item is `{ type: 'action', id, label, icon?, disabled?, danger?, onSelect }` (`danger` styles a destructive action), `{ type: 'check', id, label, checked, onSelect }`, `{ type: 'submenu', id, label, icon?, items }`, `{ type: 'label', label }` (a heading; the first one also names the menu) or `{ type: 'separator' }`. Separators at the ends, after a heading or next to each other are dropped, and so are empty submenus. Outside the shell, mount it with `createContextMenu(chart, options)`; `defaultContextMenuItems(chart, event)` returns the defaults.

`onSelect` may return a promise. When it throws or the promise rejects, for example when the browser refuses "Copy price" clipboard access, the menu passes the error and the item id to `onError(error, itemId)`, or logs it with `console.error` when there is no `onError`:

```ts
createChartShell(el, {
  contextMenu: { onError: (error, id) => showToast(`${id} failed`) },
});
```

## Slots, class names and notifications

### Slots

`slots` mounts your own content in the shell. Each slot takes an element, or a function that builds one from the shell's chart; it is rendered once when the shell is created and removed by `shell.destroy()`.

```ts
const shell = createChartShell(el, {
  slots: {
    railTop: logo,                                   // above the rail's buttons
    railBottom: (chart) => helpButton(chart),        // below them
    bottomBarStart: connectionDot,                   // before the range presets
    bottomBarEnd: (chart) => latencyLabel(chart),    // after the scale toggles
    loading: spinner,                                // over the chart while the status is 'loading'
    empty: (chart) => emptyState(chart),             // over the chart while the status is 'no-data'
  },
});
```

| Slot | Where | Notes |
| --- | --- | --- |
| `railTop`, `railBottom` | Above and below the rail's buttons | Needs the rail; hidden with it |
| `bottomBarStart`, `bottomBarEnd` | At either end of the bottom bar | Needs the bottom bar |
| `loading` | Centred over the chart | Replaces the chart's loading indicator (the assembling mark) |
| `empty` | Centred over the chart | Replaces the chart's "No data" text |

The `loading` and `empty` slots follow the chart's [in-pane status](./data-sources): the shell listens to `status:change`, shows the slot and calls `preventDefault()` so the chart hides its own text. Other statuses, such as a failed load with nothing on screen, keep the chart's text; a status the [status toast](#notifications) takes, such as a reconnect or a load over bars, shows no slot. Each slot sits in a wrapper with the classes `pc-slot pc-slot--<name>` (`pc-slot--rail-top`, `pc-slot--bottom-bar-end` and so on); the status slots sit in `.pc-status-slot`, whose content takes presses while the rest lets them through to the chart.

For toolbar controls, use a [`custom` toolbar item](#toolbar) instead.

### Class names

`classNames` adds your classes next to the built-in ones, as stable hooks for your CSS:

```ts
createChartShell(el, {
  classNames: { root: 'app-chart', toolbar: 'app-toolbar', rail: 'app-rail', bottomBar: 'app-status', dialog: 'app-dialog' },
});
```

`root` goes on the `.pc-shell` element after `className`. `dialog` goes on the dialogs and panels the shell opens inside itself: symbol search, the Appearance panel, and [form and picker dialogs](./dialogs) opened on the shell element or anything inside it.

### Notifications

`chart.notify({ message, kind, durationMs })` tells the user something short, such as "Image too large" or "Interval unavailable". `kind` is `'info'` (default), `'success'` or `'error'`; `durationMs` is how long it stays (default 5000; 0 keeps it until dismissed). The chart emits `ui:notify`, and a shell with the `toasts` part shows a toast over the chart unless a listener calls `preventDefault()`:

```ts
createChartShell(el, { toasts: toasts() });
chart.notify({ message: 'Layout saved', kind: 'success' });

// Show messages your own way instead of the shell's toasts.
chart.on('ui:notify', (e) => {
  e.preventDefault();
  myToaster.show(e.message, e.kind);
});
```

The shell decides after every listener has run, so a listener added after the shell can still prevent the toast. Toasts stack at the bottom of the chart, at most four at a time (a fifth pushes the oldest out). Each has a dismiss button, and its timer pauses while it is hovered or focused. Error toasts use `role="alert"`, the others `role="status"`. `shell.toasts.dismissAll()` clears them; without the `toasts` option there is no stack and `shell.toasts` is null. Outside the shell, mount it with `createToastStack(host, chart)`. Without the UI package nothing is shown: listen to `ui:notify` yourself.

The stack also shows a chart status that would cover bars as one status toast instead of the in-pane text: `reconnecting` and `stale` always, and `loading` and `error` once the main series has bars. It shows the same localized text (or `status.message`), with a spinner while loading or reconnecting (not turning under reduced motion), the error style for errors (`role="alert"`) and the info style otherwise (`role="status"`). It changes in place as the status changes, has no dismiss button and goes when the status clears; `dismissAll()` leaves it. Statuses that fill an empty pane (`no-data`, `unknown-symbol`, `expired`, and a first `loading` or `error` with no bars) keep the chart's text and the `loading` and `empty` slots. Without the `toasts` part every status keeps the in-pane text.
