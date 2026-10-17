---
description: "Built-in pointer, wheel, touch and keyboard input, and how to turn each path off."
---

# Interaction

Built in, no setup needed. Each input path can be turned off with [feature flags](./features).

## Pointer

| Gesture | Where | Effect |
| --- | --- | --- |
| Drag | Plot | Pan (with momentum when `inertia` is on); with `plotDragScale`, moving up or down also scales prices |
| Wheel / scroll | Plot | Zoom time axis around the pointer (see `wheel` and `zoomAnchor` below) |
| Horizontal scroll (also with `Cmd`), `Shift` + wheel | Plot | Pan |
| `Ctrl`/`Cmd` + wheel | Plot | Zoom |
| Pinch | Plot (touch or trackpad) | Zoom |
| Long-press, then drag | Plot (touch) | Inspect: the crosshair and legend follow the finger and the chart does not pan |
| Drag | Price axis | Scale prices (turns off autoscale for that pane) |
| Double-click | Price axis | Restore autoscale |
| Drag | Time axis | Zoom time axis around the plot's right edge (see `zoomAnchor` below) |
| Double-click | Time axis | Jump to the newest bar |
| Drag | Pane separator | Resize panes |
| `Alt` + click | Plot | Lock the crosshair on that bar, or release it (see [locking the crosshair](./options#locking-the-crosshair)) |
| `Shift` + click | Drawing | Add it to the drawing selection, or take it out (see [selecting several drawings](./drawings#selecting-several-drawings)) |
| `Shift` + drag | Plot, on a pane with drawings | Selection box: select the drawings inside it |

When the newest bar is out of view, a floating button scrolls back to it (`scrollButton` option).

On touch, a press that stays still for about half a second starts inspecting. The `touchInspect` option sets how it ends: `'release'` (default) when the finger lifts, `'tap'` keeps the crosshair until the next tap, and `'off'` turns the long-press off so the press pans as usual. Moving before the long-press is a normal pan. While the crosshair is [locked](./options#locking-the-crosshair), a hold is a normal pan too, and a tap on the plot releases the lock. With the `sketch` feature flag, a long-press held still for another half second [becomes a sketch](./drawings#sketch-a-drawing).

A plain touch moves the crosshair too while it pans. `chart.inspecting` tells the two apart: it is `true` while a long-press drives the crosshair, and while `'tap'` keeps it afterwards. `crosshair:move` fires when inspecting starts, so read it there; the UI's [pointer tooltip](./ui-shell#pointer-tooltip) does.

### Wheel and plot drag options

The `wheel` option sets what the plain wheel does: `'zoom'` (default) zooms the time axis, `'pan'` scrolls it (down moves to newer bars), and `'page'` leaves it to the page, which suits charts inside a scrolling page. `Ctrl`/`Cmd` + wheel zooms and `Shift` + wheel pans in every mode, so a chart in `'page'` mode stays usable. `Shift` + wheel pans along whichever axis the wheel moved most.

With `plotDragScale: true`, the vertical part of a plot drag scales the pane's main price scale and turns its autoscale off, as dragging the price axis does; the horizontal part still pans. A press that stays within the click distance does not scale, and on touch the chart keeps vertical swipes from scrolling the page. It needs the `axisDragScale` feature, and the cursor shows `ns-resize` while it scales. Double-click the price axis to restore autoscale.

```ts
chart.applyOptions({ wheel: 'page', plotDragScale: true });
```

### Zoom anchor

The `zoomAnchor` option sets the point a time zoom keeps fixed on screen:

| Anchor | Keeps fixed |
| --- | --- |
| `'pointer'` | The bar under the pointer, or under the middle of the two fingers for a pinch. A time-axis drag uses the point where it was pressed. The `+` / `-` keys have no pointer, so they use the plot's right edge |
| `'newest'` | The newest bar, while it is on screen, so live prices never slide away. When it is off screen, the zoom falls back to `'pointer'` |
| `'right-edge'` | The plot's right edge |

It has one value per input: `plot` for the wheel, pinch (touch or trackpad) and the `+` / `-` keys, and `timeAxis` for dragging the time axis. The default is `{ plot: 'pointer', timeAxis: 'right-edge' }`. A single string sets both, and `applyOptions` merges a partial object. A view limit such as `fixRightEdge` still wins over the anchor.

```ts
// Keep the newest bar pinned for every zoom input.
chart.applyOptions({ zoomAnchor: 'newest' });
// Only change the time-axis drag.
chart.applyOptions({ zoomAnchor: { timeAxis: 'pointer' } });
```

`chart.setBarSpacing(px, anchorX)` zooms from code around any point, whatever this option says.

## Keyboard

The chart is focusable. The `keyboard.scope` option sets when it takes keys: `'focus'` (default) while it has focus, `'hover'` also while the pointer is over it, and `'global'` anywhere on the page. The drawing keys (`Escape`, `Delete`, the arrows while drawings are selected, copy, paste, undo and redo) always need the chart focused or hovered, so a `'global'` chart does not take the page's own.

Keys are always left alone when they are typed into an input, a text area, a select or an editable element, or inside a dialog or a widget with an interactive role (a list box, tabs, a slider, a menu, a grid, a text box or a combo box), and while a modal dialog without the chart is open. So are keys the page already handled (`preventDefault`), browser shortcuts with `Cmd`, or with `Ctrl` on anything but the arrows, and a key a focused chart used, which `'hover'` and `'global'` charts do not use again.

Page-scroll keys (arrows, `PageUp`/`PageDown`, `Home`/`End`) are taken only when they move the view: at the oldest or newest edge they scroll the page as usual.

```ts
chart.applyOptions({ keyboard: { scope: 'hover' } });
```

These are the default keys; [actions and shortcuts](#actions-and-shortcuts) rebinds them.

| Key | Effect |
| --- | --- |
| `←` / `→` | Pan |
| `PageUp` / `PageDown` | Move one screen to older / newer bars |
| `Home` / `End` | Jump to the oldest / newest bar |
| `Ctrl` + `←` / `→` | Move the crosshair one bar (it starts on the newest visible bar and scrolls into view) |
| `+` / `=` | Zoom in (around the right edge by default; see [zoom anchor](#zoom-anchor)) |
| `-` | Zoom out |
| `Alt` + `R` | Reset view |
| `Escape` | Cancel drawing, exit drawing tool, deselect, or release a locked crosshair |
| `Delete` / `Backspace` | Remove the selected drawings |
| `←` / `→` / `↑` / `↓` with drawings selected | Move them one bar or one pixel (ten with `Shift`) instead of panning; see [nudge](./drawings#nudge-with-the-arrow-keys) |
| `Ctrl`/`Cmd` + `C` / `V` | Copy the selected drawings / paste them |
| `Ctrl`/`Cmd` + `Z` | Undo the last drawing or indicator change |
| `Ctrl`/`Cmd` + `Shift` + `Z`, `Ctrl` + `Y` | Redo |

All keys need the `keyboard` feature. Beyond that:

| Keys | Also need |
| --- | --- |
| `←` / `→`, `PageUp` / `PageDown`, `Home` / `End` | `scroll` |
| `+` / `=`, `-` | `zoom` |
| `Shift` + `End` | `scroll` and `zoom` |
| `Ctrl` + `←` / `→` | Nothing; the view follows the crosshair only when `scroll` is on |
| Drawing keys | Nothing |

Any input stops running momentum, eased zoom and view animations.

To move the view from code, see [View and price scale](./view-and-scale).

## Actions and shortcuts

Every built-in command is an action on `chart.actions`, with an id, a label (from the `localization` messages, keys `action…`), an enabled state and, for toggles, a checked state. Run one by id, for example from your own toolbar or menu; `run` returns false when the action is disabled or changed nothing.

```ts
chart.actions.run('zoom-in');
const undo = chart.actions.get('undo'); // { id, label, enabled, checked: null, keys: ['Mod+Z'], defaultKeys }
for (const action of chart.actions.list()) addMenuItem(action);
```

| Id | Default keys | |
| --- | --- | --- |
| `scroll-older`, `scroll-newer` | `ArrowLeft`, `ArrowRight` | Pan |
| `page-older`, `page-newer` | `PageUp`, `PageDown` | One screen |
| `oldest-bar`, `newest-bar` | `Home`, `End` | Jump to an end |
| `zoom-in`, `zoom-out` | `+` and `=`, `-` | Zoom |
| `reset-view` | `Shift+End` | Reset view |
| `crosshair-prev`, `crosshair-next` | `Ctrl+ArrowLeft`, `Ctrl+ArrowRight` | Step the crosshair |
| `fit-content` | | Fit all bars |
| `auto-scale` | | Toggle the main price scale's auto scale (checked) |
| `remove-selected` | `Delete`, `Backspace` | Remove the selected drawings or the [selected indicator](./indicators#selecting) |
| `delete-drawings` | | Remove the selected drawings |
| `copy`, `cut`, `paste` | `Mod+C`, `Mod+X`, `Mod+V` | Copy, cut and paste the selected drawings or the [selected indicator](./indicators#copy-and-paste) |
| `copy-drawings`, `cut-drawings`, `paste-drawings` | | Copy, cut and paste drawings |
| `undo`, `redo` | `Mod+Z`; `Mod+Shift+Z`, `Ctrl+Y` | The chart's undo history (`chart.history`), drawings and indicators |
| `lock-drawings`, `hide-drawings` | | Toggle lock all and hide all (checked) |
| `group-drawings`, `ungroup-drawings` | `Mod+G`, `Mod+Shift+G` | [Group](./drawings#groups) the selected drawings, dissolve their groups |
| `draw-<tool>` | | Pick a drawing tool, or go back to the cursor when it is active (checked while active); one per tool the chart has, built-in or registered, e.g. `draw-rectangle` |

`remove-selected`, `copy`, `cut`, `paste`, `undo` and `redo` come with the drawings or indicators plugin (`drawingTools()`, `drawings()`, `indicators()` or `builtins()`), the drawing commands with a drawings plugin. Without them the chart has nothing to select, so it leaves those keys to the page.

The UI shell adds `go-to-date` (no default key), `focus-next-region` and `focus-previous-region` (`F6`, `Shift+F6`; see the [key map](./accessibility)), with a [command palette](./ui-shell#command-palette), `command-palette` (`Mod+K`), `indicator-picker` (`/`, see [Indicator picker](./indicator-picker)) and, with a [symbol search](./symbol-search#shortcut), `symbol-search` (`/`, plus `Mod+K` without the palette), which then keeps `/` and leaves `indicator-picker` without a key. `Escape` and `Enter` stay gesture keys: they finish or cancel what is in progress and cannot be rebound.

How the defaults are chosen: none uses Alt, because Alt (Option) with a letter types a character on Apple and several other layouts, and on Windows it reaches the browser menu. None is a letter or digit either, because a symbol can start with any of them: typing on a focused chart goes to the [symbol search](./symbol-search). That leaves the named keys (arrows, Page Up and Down, Home, End), `+`, `-` and `=`, alone or with Shift or Ctrl, and the view uses them: `Shift+End` resets the view, since End goes to the newest bar and Shift also brings back the default zoom and autoscale. Drawing tools and go-to-date have no default keys, since no such key is left that says what they do; bind the ones you want with `chart.actions.setKeys('draw-trendline', ['F9'])` (a function key keeps the letters for the search), the [shortcuts dialog](./ui-shell#keyboard-shortcuts) or the command palette.

The view keys act where `keyboard.scope` lets the chart take keys: while it has focus with the default `'focus'`, also while hovered with `'hover'`, and anywhere on the page with `'global'`, which is that scope's purpose. Actions marked `local` (the drawing keys, and `go-to-date` once bound) need the chart focused or hovered even then.

### Writing shortcuts

A shortcut is modifiers and a key joined with `+`: `Ctrl`, `Alt`, `Shift`, `Meta` (Cmd on a Mac) or `Mod` (Ctrl or Cmd, whichever is pressed), then a letter, a digit, a character such as `+`, or a key name such as `ArrowLeft`, `PageUp`, `Delete` or `F2`. Case and order do not matter; `normalizeShortcut('shift+ctrl+z')` returns the canonical `'Ctrl+Shift+Z'`.

Shortcuts match the same way on any keyboard layout. A letter or digit is taken from the character typed when it is a Latin letter or a digit, else from the physical key, so `Mod+Z` works on a Cyrillic layout, `Alt+R` where Alt types a symbol, and `Ctrl+1` where the digit row types other characters. Modifiers must match exactly, except that Shift is ignored when no shortcut names it for that key (so `+` works whether or not your layout needs Shift for it); for letters, `Shift+X` and `X` are always different.

### Rebinding

```ts
chart.actions.setKeys('zoom-in', ['Shift+ArrowUp']); // replace the defaults
chart.actions.setKeys('reset-view', []); // turn its shortcut off
chart.actions.setKeys('zoom-in', null); // back to the defaults

localStorage.keymap = JSON.stringify(chart.actions.keymap); // only the changes
const errors = chart.actions.setKeymap(JSON.parse(localStorage.keymap)); // invalid entries are left out and returned
```

A keymap may name actions registered later, such as your own. To let users rebind shortcuts themselves, `@charton/ui` has a [keyboard shortcuts dialog](./ui-shell#keyboard-shortcuts).

### Your own actions

```ts
const unregister = chart.actions.register({
  id: 'app:save-layout',
  label: 'Save layout',
  keys: ['Mod+S'],
  local: true, // only while this chart is hovered or focused, whatever `keyboard.scope` says
  enabled: () => hasChanges(),
  run: () => saveLayout(),
});
```

`run` returning `false` leaves the key to the page. Your shortcuts follow `keyboard.scope` and the `keyboard` feature like the built-in ones.

### Conflicts

When several actions share a shortcut, the first enabled one that does something runs, with shortcuts set by `setKeys` ahead of defaults. `conflicts()` lists every shared shortcut, and `actionsFor(keys)` the actions on one, for example to warn before binding it:

```ts
chart.actions.actionsFor('Mod+K'); // ['app:search']; Mod checks both Ctrl and Cmd
chart.actions.conflicts(); // [{ keys: 'Ctrl+K', ids: ['app:search', 'app:link'] }]
chart.actions.on('actions:change', refreshMenus); // actions or shortcuts changed
```

Typing a letter or digit on a focused chart opens the UI shell's [symbol search](./symbol-search).

## Screen readers

The chart root is an `application` with the role description "chart", so screen readers announce it as a chart and pass the keys above through to it. Its accessible name is `'<symbol name> chart'` (or `'Chart'`), and its description is a summary of what is in view, read when the chart gets focus:

> ABC Corp, 1h. 50 bars from 2024-05-06 09:00 to 2024-05-08 10:00. Close 110.00 to 159.00, up 49.00 (44.55%). High 159.50, low 109.00.

`chart.describe()` returns the same text for your own UI. The summary follows panning, zooming and new data, rebuilt at most once per `throttleMs` (default 1000).

With `crosshairReadout: true`, a polite live region also reads the values under the crosshair as it moves (the time, then each series as in the legend), at the same rate.

```ts
chart.applyOptions({ accessibility: { crosshairReadout: true, label: 'Price chart' } });
```

| Option | Default | Effect |
| --- | --- | --- |
| `summary` | `true` | The description above |
| `crosshairReadout` | `false` | Read the crosshair values as they change |
| `label` | symbol name | The accessible name |
| `throttleMs` | `1000` | Shortest time between updates of the summary and the readout |
| `announceBars` | `false` | Announce each new bar of the main series |
| `announceIntervalMs` | `5000` | Shortest time between two announcements |

`applyOptions({ accessibility })` merges into the current settings. The built-in themes meet WCAG AA contrast for text and the up and down colours (see [theming](./theming#default-palette)).

### Announcements

With `announceBars: true`, a second polite live region reads each new bar of the main series, with the close and change of the bar it completed:

> New bar 2024-05-09 11:00. Previous close 159.00, +1.00 (+0.63%).

Updates of the forming bar, a new symbol or interval, and history pages are not announced. Call `chart.announce(text)` to read your own messages in the same region, for example when `chart.annotations.alertsCrossed()` reports a crossed alert. At most one announcement is read per `announceIntervalMs`: your messages go first, in order, and only the newest three wait their turn; bars that arrive faster (a fast replay) are skipped for the newest one.

```ts
chart.applyOptions({ accessibility: { announceBars: true, announceIntervalMs: 10_000 } });
for (const { line, direction } of chart.annotations.alertsCrossed(prevClose, close)) chart.announce(`Alert at ${line.options.price} crossed ${direction}`);
```

### Data table

`chart.describeTable({ from?, to?, maxRows? })` returns the rows of [`getDataTable`](./events#screenshot-and-data-export) as a `<table>`: a caption with the name and time span, a header row, then one row per time with the time (in the chart timezone and `formatTime`) as its row header and every value in its series' own format. It defaults to the visible range; `maxRows` keeps the newest rows and the caption says how many were left out. The table is not attached, so place and style it yourself, and build a new one when the view changes.

```ts
panel.replaceChildren(chart.describeTable({ maxRows: 200 }));
```

The UI shell has a ready-made panel for it that follows the view: see [table view](./ui-shell#table-view).

### Cues beyond colour

Up and down need not rest on colour alone: the candle option `hollowDown: true` draws falling bodies as outlines (in `candles`, `heikinAshi` and `volumeCandles`), the `hollow` style does the same for rising bodies, and the legend option `changeArrows: true` puts ▲ or ▼ before each change value.

