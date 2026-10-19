# Toolbar layout: where each control goes

Every control in `@chart-on/ui` and the demo belongs to exactly one surface. Controls on the top bar also belong to one group. This standard stops each new feature from being added to the top bar by default, and it gives hosts that compose their own toolbar the same layout.

End-user toolbar customisation (#39) can reorder items within this standard. It does not change which surface or group an item belongs to.

## Surfaces

| Surface | Holds | Never holds |
| --- | --- | --- |
| **Top bar, `context` group** (start) | Symbol search, interval, chart type | Anything else. These are always visible and overflow last |
| **Top bar, `analysis` group** (after context) | Indicators (picker, #248), compare, templates (#44), alerts, layers | Drawing tools, settings |
| **Top bar, `view` group** (end) | Undo/redo, layouts (#82), replay (#83), screenshot and fullscreen (#38), settings and appearance (#158), command palette (#116), the overflow menu | Data or analysis actions |
| **Rail** | Drawing tools by group (each flyout entry with a favourite star, #155), then the favourites bar toggle, magnet, lock-all, hide-all, remove-all | Chart-level actions |
| **Favourites bar** (#155) | The starred drawing tools, over the plot where the user moves it | Anything that is not a starred tool |
| **Floating drawing bar** | Properties of the selected drawing (#8, #156) and its actions: lock, clone, delete, settings | Global state |
| **Bottom bar** (off by default, #1001; without it the price scale menu sits at the toolbar's right end, in the view group) | Range presets, go-to-date, timezone and clock, trading session, the scale mode (one radio group: linear, log, percent) with the auto-fit toggle beside it (#861), navigator (#206) | Analysis tools |
| **Settings and appearance panel** (#158, #79) | Anything changed less than once a session: theme, colours, grid, typography, crosshair and legend defaults | Per-bar or per-drawing actions |
| **Legend row** (#4, #162) | Per-series actions: show/hide, settings, remove, and a "More" button opening the row's menu (duplicate, move or merge panes, intervals, fold) | Chart-level actions |
| **Context menu** (#165) | Actions tied to a point, an axis, a drawing or a legend row | Nothing is exclusive to it |

The context menu may repeat a toolbar action. The reverse is not allowed: an action that exists only in the context menu does not get a toolbar button as well.

## Top bar groups

Set `group` on each toolbar item. It controls three things:

- **Position.** `context` items render first, then `analysis` and ungrouped items, then `view` items at the right edge. A `view` item defaults to `align: 'end'`, and an explicit `align` overrides that. Within a group, items keep their list order.
- **Overflow.** When the bar is too narrow, labels drop first. Text beside an icon is hidden, and segmented controls collapse into menus. If the bar still does not fit, items move into the "more" menu: the `view` group first, then `analysis` (and ungrouped items), and `context` last. Within a group, lower `priority` overflows first, and ties drop from the right edge inwards.
- **Checks.** The demo test (`apps/demo/test/toolbar.test.ts`) asserts that every demo item has a top-bar group, and that the overflow order follows the group ranks.

Items without a `group` keep the previous behaviour, so existing toolbars are unchanged.

## Caps

- At most 3 groups on the top bar: `context`, `analysis` and `view`.
- A target of **8 primary items** on a 1280 px wide chart. Separators and spacers do not count. A new item over the cap has to replace an item, or join a menu (for example "Layers" or "View").
- Labels drop to icons before any item overflows, so every item with visible `text` also needs an `icon`.

## Placing a new control

Before adding a control, answer these questions in order. The first "yes" decides where it goes.

1. Does it act on the selected drawing? Use the floating drawing bar.
2. Does it start a drawing or act on all drawings? Use the rail.
3. Does it change the time range, timezone, session or price scale? Use the bottom bar.
4. Does a user change it less than once a session? Use the settings and appearance panel.
5. Does it change what the chart shows (symbol, interval, chart type)? Use the top bar, `context` group.
6. Does it add analysis to the chart (indicators, compare, alerts, overlays)? Use the top bar, `analysis` group.
7. Does it change the view or the workspace (layouts, screenshot, fullscreen, panels)? Use the top bar, `view` group.

Add one line per new control to the table below, with its surface and the reason. The PR template has a checklist item for this.

| Control | Surface / group | Why |
| --- | --- | --- |
| Symbol search | Top bar, `context` | Decides what is on screen |
| Symbol header (`symbolHeader`) | Top bar, `context`, first item | Shows the current symbol and exchange and opens the symbol search; it decides what is on screen |
| Interval | Top bar, `context` | Decides what is on screen |
| Chart type | Top bar, `context` | Decides how the main series is drawn |
| Indicators | Top bar, `analysis` | Adds analysis; becomes the picker in #248 |
| Indicator templates (`indicatorTemplatesToolbarItem`) | Top bar, `analysis`, next to Indicators (in the demo: the Layers menu's Templates section, the bar being at its cap) | Saves and applies sets of indicators: analysis, kept with the indicator picker |
| Compare | Top bar, `analysis` (in the demo: a Layers entry, the bar being at its cap) | Adds a second symbol |
| Layers (demo) | Top bar, `analysis`, right after Indicators | One menu for demo-only overlays that indicators cannot draw: heatmap, volume profiles, large trades, custom channel, forecast. Cumulative volume is an indicator, under Indicators. Compare and a **Templates** section (save and open indicator templates) are entries here too, the bar being at its cap |
| View (demo) | Top bar, `view` | Three sections, each of one kind, every entry in a named section (#693). **Panels**: bar replay, pointer tooltip, data window, object tree, view as table, linked second chart, price-based chart, full screen. **Display**: see the row below. **Demo**, last: the live feed, low-power mode, render statistics. Exclusive states of one setting share one entry that moves to the next state on each click and names the current one: session bands (bands, columns, off), bar grouping (off, when zoomed out, by calendar period), the live feed (live, paused, dropped) and render statistics (off, on, with bounds). This keeps the menu at 18 rows, which fits a 1280×800 window. Labels stay short; explanations live in code comments and docs. Drawing tools and hiding drawings or indicators are not repeated here: the rail has them |
| Settings cog (`settingsToolbarItem`) | Top bar, `view`, directly after the screenshot button (last on the bar in the demo) | Opens the chart settings dialog (#79): changed less than once a session. Pressed while the dialog is open; disabled outside a shell |
| Theme, high contrast, colour-safe up and down, language, direction (demo) | Settings dialog, Appearance section (app fields, after the chart's own sections); "Colors…" is a footer button that opens the appearance panel | Changed less than once a session, and shell or app state rather than chart options (#693) |
| Customize toolbar | More menu and toolbar right-click; docked panel | Edits the user's toolbar without adding a primary item; reorders only within each group and alignment |
| Symbol watermark, price reference lines, off-hours shading, session bands (one entry: bands, columns, off), hourly boxes, sketch drawings, bar grouping (one entry: off, when zoomed out, by calendar period) (demo) | View menu, Display section | Display settings changed less than once a session, not layers |
| Live feed (one entry: live, paused, dropped), low-power mode, render statistics (one entry: off, on, with bounds) (demo) | View menu, Demo section (last) | Data simulation and debugging switches, kept apart from the chart's own settings |
| Range presets | Bottom bar | Time range |
| Timezone | Bottom bar | Sits with the clock it changes |
| Trading session | Bottom bar | Changes which hours count as the session |
| Session bands chip (`sessionBands`) | Bottom bar | Open or closed state and countdowns of other markets, next to the clock and trading session |
| Scale mode (linear, log, percent) and auto-fit | Bottom bar | The modes are exclusive values of one setting, so one radio group; auto-fit is a setting of its own, so a toggle beside it |
| Price-to-bar ratio lock | Settings, Axes, Axis lines | A scale setting changed rarely, not a mode |
| Fit all data | Bottom bar | The `All` range preset does this |
| Magnet, lock-all, hide-all, remove-all | Rail | Act on all drawings |
| Favourite star | Rail, in each group flyout | Marks the tool beside it |
| Favourites bar toggle | Rail | Shows or hides the starred tools; sits with the other drawing toggles |
| Starred tools | Favourites bar | Start a drawing in one click, without opening a flyout |
| Drawing settings | Floating drawing bar, after delete | Acts on the selected drawing; opens its settings dialog |
| Bar replay (`replayToolbarItem`) | Top bar, `view` (in the demo: the View menu, the bar being at its cap) | Changes what the view shows over time; its play, step and speed controls float over the chart only while a replay runs |
| Go to date | Bottom bar | Time range |
| View as table (`tableViewToolbarItem`) | Top bar, `view` (in the demo: the View menu, the bar being at its cap) | Opens a panel that shows the view as a table; it changes no data |
| Screenshot (`screenshot`) | Top bar, `view`, before the settings cog | Exports what the view shows; it changes no data |
| Print (`print`), download data (`downloadData`) | Top bar, `view`, beside the screenshot button | Export what the view shows; they change no data |
| Command palette (`commandPaletteToolbarItem`) | Top bar, `view` (in the demo: Ctrl/Cmd+K only, the bar being at its cap) | Opens a search over every command; it changes the workspace, not the data |
| Hide menu (`hideMenu`) | Top bar, `view` (not in the demo, whose rail has hide-all) | Hides drawings, indicators or both: what the view shows, not the data. The rail keeps its own hide-all for drawings; both run the `hide-drawings` action |
| Grid layout (`gridLayout`) | Grid toolbar, `view` | Changes the workspace |

## Toolbar presets (#38)

Presets return toolbar items that already have the right `group`, and a `priority` that suits their place within it. A host that composes presets then gets this layout without extra work. For example, an interval preset returns a `context` item, and screenshot and fullscreen presets return `view` items. A host can still override `group`, `align` or `priority` on any item.

## Bottom bar options

The bottom bar holds toolbar items (#980): the rows above are where the shell puts them by default (`defaultBottomBarItems`), and each bottom bar control is a preset (`goToDate`, `timezoneMenu`, `clock`, `sessionMenu`, `sessionBandsChip`, `scaleMode`, `scaleModeInline`, `rangePresets`) an app can move to the top toolbar. Popups open away from whichever edge the bar is on.

`createBottomBar` (and `bottomBar` in the shell) accepts `timezones` and `sessions`, each as `{ options, value? }`. A timezone option's `value` is an IANA zone or `'local'`. A session option carries an optional `session` schedule; without one it means always open. Picking a session sets the chart's `session` and turns on session shading. Both menus open upwards from the bottom edge. `sessionBands` takes a session bands primitive and adds a chip listing its lanes with countdowns; its list opens upwards too. These options are shorthand for the default items.
