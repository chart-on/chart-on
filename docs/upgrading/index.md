---
description: "Deprecated APIs with their replacements, and what changed in each release."
---

# Upgrading

How the public API changes between releases, and what to do about it. The rules behind this page are in [the contributing guide](https://github.com/chart-on/charton/blob/main/CONTRIBUTING.md#deprecations-and-breaking-changes).

- A deprecated API keeps working until the removal release named in its entry. Development builds log one `charton [deprecated]` warning per API per page load, linking to its entry below; production builds log nothing.
- Each entry shows the old and the new code.
- Each release that changes the public API gets a section under [Releases](#releases).

## Deprecated APIs

None yet.

## Releases

### Unreleased

### 0.1.0

The first release on npm. These entries are for code built from the repository before it; an app starting on 0.1.0 needs none of them.

- **Default toolbar items** (#1014). `defaultToolbarItems()` is now the symbol, interval and indicators on the left and indicator templates, bar replay, fullscreen and chart settings on the right; chart style and the price scale menu left the list. To keep them, add them back: `toolbar: [...defaultToolbarItems(), chartStyle(), { ...scaleMode(), group: 'view' }]`. A shell with no `toolbar` option now also mounts the replay strip, and its picker-style search boxes are flat rows across the dialog. The command palette opens with its search box and category chips, lists nothing until something is typed or a chip picked, and finds the new `chart-settings`, `appearance`, `light-mode` and `dark-mode` actions and the chart settings' sections (`ChartSettingsHandle.commandSource`, id `settings`; an app source with that id keeps its place).
- **Minimal shell defaults: a default toolbar, no bottom bar** (#1001). A shell given no `toolbar` now shows `defaultToolbarItems()` (interval, chart style, indicators, price scale, settings, fullscreen); pass `toolbar: []` to keep the old empty top. A shell given no `bottomBar` now has none; pass `bottomBar: true` (or `{}`) for the bar it showed before. Shorthand options and item lists are unchanged. Chart grid cells keep no toolbar of their own: the grid's toolbar acts on the active cell.

- **The bottom bar is a toolbar of items** (#980). `bottomBar` and `createBottomBar` take a list of items (or toolbar options) as the toolbar does, and the old options stay as shorthand for `defaultBottomBarItems(options)`, so a shell that passed them shows the same controls. What changed: `BottomBarHandle` is now `ToolbarHandle`, whose `el` is the toolbar (`role="toolbar"`) inside the `.pc-bottombar` strip; slots and `classNames.bottomBar` go on the strip, as before. The strip has no `role`, so tests or styles that read the bar's role or children from `.pc-bottombar` look one level down (`.pc-bottombar > .pc-toolbar`). The `.pc-bottombar-menu` class is gone (`.pc-bottombar .pc-menu-trigger` styles the bar's menus), and `refresh()` no longer turns the clock into a button: it looks again for settings made after it on its own. In `scaleToggles: 'inline'`, the auto-fit toggle is a toolbar button rather than a chip. When the bar is narrow, the go-to-date, range, clock and session-bands items are hidden instead of moving into the "more" menu.

- **Drawing labels pick their text color by contrast** (#904). `labelPill` without a `color` option used to write its text in the theme background; it now writes black or white, whichever contrasts more with the pill's `background` (`contrastText`). Built-in level, price and pattern labels follow the same rule. A plugin tool that wants the old look passes the color itself:

  ```ts
  labelPill(ctx, env, text, x, y, { background, color: env.theme.background }); // the text color before #904
  ```

- **Primitive lanes need the `depthLane()` plugin** (#912). The code that lays out and draws the lanes primitives reserve with `lane()` and `drawLane()` moved from the chart into the `depthLane()` plugin, which `builtins()` and the UI shell include, so apps that pass `builtins()`, use the shell or already use depth lanes see no change. An app that picks its own plugins and attaches a primitive with `lane()` (its own, or `createDepthLane()` through `attachPrimitive`) adds the plugin: `createChart(el, { plugins: [depthLane()] })`. Without it, such a primitive gets no space and its lane is not drawn; development builds warn once ([`lanes-missing`](../guide/errors#lanes-missing)).
- **The flat crosshair and time axis options are gone** (#914). Use the nested fields, which were already the same settings. Saved layouts and stored chart settings need nothing: they never held the flat names.

  ```ts
  chart.applyOptions({ crosshair: { mode: 'close', labels: { price: false, time: false } } }); // was crosshairMode, crosshairPriceLabel, crosshairTimeLabel
  chart.applyOptions({ timeAxis: { height: 32 } }); // was timeAxisHeight: 32
  const height = chart.options.timeAxis.height; // was chart.options.timeAxisHeight
  ```

- **The selection and its edit commands come with the drawings and indicators plugins** (#909). `remove-selected`, `copy`, `cut`, `paste`, `undo` and `redo` are registered by `drawingTools()`, `drawings()` and `indicators()` (all in `builtins()`), so apps that pass `builtins()` or use the shell see no change. On a chart with none of them, `chart.actions` lacks those commands, `Delete`, `Backspace` and `Mod+C`/`X`/`V`/`Z` stay with the page, `getSelection()` returns null and `setSelection` does nothing.
- **The `hlcArea` chart style is `rangeBand`** (#861). The style draws a close line with a band to the high and the low, and is named for that. Replace `style: 'hlcArea'` with `style: 'rangeBand'`, `chartTypeIcons.hlcArea` with `chartTypeIcons.rangeBand`, and the shell message `chartStyleHlcArea` with `chartStyleRangeBand` in your own translations. A saved layout or layout template that still has `hlcArea` loads with the main series as `candles`, lists `mainSeries.style` in its `errors` and logs an [`option-range`](../guide/errors#option-range) warning in development builds; save it again to store the new name. A starred `hlcArea` in the shell's chart style favourites shows as candles, with the same warning; star `rangeBand` instead. The shell's style menu (`chartStyles`) is in a new order, grouped under headings: entries take `section` and `sectionKey`, and the new messages `chartStyleSectionOhlc`, `chartStyleSectionRange` and `chartStyleSectionClose` name them. `chartStyleVolumeCandles` reads "Volume-width candles" and `chartStyleLineMarkers` "Line with dots".
- **One scale mode control in the bottom bar** (#861). The `%` and `log` toggles are one radio group, linear, log or percent, named by the `seriesPlacement` message ("Price scale"), with the new `scaleLinear` message for its first choice; an indexed scale checks the percent choice. The `auto` toggle stays. The ratio lock left the bar for the chart settings (**Axes**, **Axis lines**), where the field's path is `priceScale.lockPriceToBarRatio`: `readChartSetting` and `applyChartSettings` read and write `priceScale.` paths on the main pane's price scale. `scaleLogTitle` and `scalePercentTitle` now name the `log` and `%` radios. The messages `scaleLock` and `scaleLockTitle` are gone; drop them from your translations, and translate `setting.priceScale.lockPriceToBarRatio` instead. Tests or styles that looked for the bar's `lock` chip, or for `aria-pressed` on `%` and `log`, look for the radios' `aria-checked` now.
- **`minVisibleBars` is now `minBarCoverage`.** The pan limit is a share of the plot width that bars keep covering at either end (0 to 1, default 0.5), so it behaves the same at every zoom. Replace a bar count with a share: `minVisibleBars: 10` on a plot about 100 bars wide is `minBarCoverage: 0.1`. Other defaults changed with it (#857): `barSpacing` 10, `maxBarSpacing` 63, `rightOffset` 5; pass the old values to keep the old view.

  Pane margins left unset are now sized to the legend and the price labels. Pass `marginTop` and `marginBottom` to `addPane` or `setPriceScaleOptions` to fix them, and `null` to give them back. `getPriceScaleOptions` leaves automatic margins out. Layouts saved before this change stored every margin (0.1 and 0.08 on the main pane, 0.1 and 0.1 on others), so they load as fixed margins; delete `marginTop` and `marginBottom` from their `scales` entries, or call `setPriceScaleOptions({ marginTop: null, marginBottom: null }, pane)` after loading, to use the new rule.

  Volume profiles without `rows` size their rows by pixels: the series (was 40 rows) and the fixed-range drawing (was 24) one row per 10 px of height, session profiles and `computeVolumeProfile` by the Rice rule from the bar count. The longest row now reaches the middle: series `width` 0.5 (was 0.3 for the visible range, 0.7 for sessions), drawing `profileWidth` 50 (was 30). Pass `rows`/`width` (series) or `style.rows`/`style.profileWidth` (drawing) to keep a fixed layout. Fixed-range profiles drawn before this change stored `rows: 24` and `profileWidth: 30` in their style, so they keep them; set `rows` to 0 ("auto" in the settings dialog) and `profileWidth` to 50 to adopt the new defaults.

  ```ts
  createChart(el, { minBarCoverage: 0.1 }); // was minVisibleBars: 10
  ```

- **Default shortcuts, settings sections and the crosshair date changed.** None of these needs code to keep working, but apps that name them do:

  - No default shortcut uses Alt, or a letter or digit, which type-to-search keeps. `reset-view` is `Shift+End` (was `Alt+R`), and the shell's `go-to-date` (was `Alt+G`) and the `draw-<tool>` actions (`draw-trendline`, `draw-hline`, `draw-vline` and `draw-fib-retracement` had `Alt+T`, `Alt+H`, `Alt+V`, `Alt+F`) have no default keys. Saved keymaps keep working, since they are keyed by action id. To keep an old key, bind it per action, which leaves other overrides alone:

    ```ts
    chart.actions.setKeys('reset-view', ['Alt+R']);
    chart.actions.setKeys('draw-trendline', ['Alt+T']);
    ```

  - The chart settings sections are `series`, `readout`, `axes`, `time`, `background` and `markers` (were `symbol`, `legend`, `scales`, `canvas`, `events` and `time`). Update `settings.open(id)` calls, `sections` callbacks that pick sections by id, and messages keyed `settings.<section>` or `settings.<section>.<group>`. Field keys (`setting.<path>`) are unchanged. The crosshair group moved to `readout`, the session and time-axis mark fields to `time`, and `timeAxis.showSeconds` to `time`.
  - Four labels changed: "Time left in bar" (was "Countdown to bar close"), "Trading day dividers" ("Session breaks"), "Keep line angles when zooming" (the bottom bar's ratio lock) and "Trend line with stats" (the `info-line` tool). Tests that look them up by text need the new text.
  - The full date is `{ day: 'numeric', month: 'short', year: 'numeric' }` through `Intl` (`Oct 16, 2026 14:30`, `16. Okt. 2026`, `2026年10月16日`), and ISO 8601 (`2026-10-16 14:30`) when dates do not go through `Intl`, instead of `Wed 16 Oct '26`. Besides the crosshair label, this text appears in `chart.describe()` and the chart's description, the new-bar announcement, the data table's time column (`chart.describeTable()`) and the default caption. Tests and screen-reader scripts that match those strings need the new form. Pass `localization.dateFormat` for another date.
- **Image capture is an opt-in plugin.** `chart.captureImage` (compositing every layer into one image, with its caption, padding, background and theme options) moved into the new `imageCapture()` plugin, so a chart that never takes a screenshot leaves that code out. `builtins()` includes it, and the UI shell adds it when the app's own `chart.plugins` list leaves it out, since its screenshot and copy-image buttons use it. Otherwise add it:

  ```ts
  import { createChart, imageCapture } from '@charton/core';

  const chart = createChart(el, { plugins: [imageCapture()] });
  const blob = await chart.captureImage();
  ```

  Without it `captureImage` throws a [`not-registered`](../guide/errors#not-registered) `ChartError` at the call, with `context` `{ call: 'captureImage', plugin: 'imageCapture()' }`. A destroyed chart still resolves to `null`. Data export (`getDataTable`, `toCSV`) needs no plugin.

- **Access rules are one predicate.** The `access` option is `{ allow, limits, refused }`. Write the old lists as a function of `{ kind, id }`, where `kind` is `'drawing'` or `'indicator'`; `maxIndicators` moves to `limits.indicators`, and `blocked` is renamed `refused`. `drawings.setAccess()` and `indicators.setAccess()` take the same rule (`AccessRule`, `({ kind, id }) => boolean`), or `null`; the `access:change` and `indicators:access-change` payloads carry `allow` instead of `access`. `chart.options.access` holds what the app set, so read a manager's rule from `drawings.access` or `indicators.access`.

  ```ts
  // Before: access: { drawingTools: ['trendline', 'hline'], indicators: { mode: 'deny', indicators: ['vwap'] }, maxIndicators: 3, blocked: 'disable' }
  const tools = new Set(['trendline', 'hline']);
  createChart(el, {
    access: {
      allow: ({ kind, id }) => (kind === 'drawing' ? tools.has(id) : id !== 'vwap'),
      limits: { indicators: 3 },
      refused: 'disable',
    },
  });
  ```
- **Storage adapters store a layout summary.** `listLayouts` returns `LayoutSummary` (`{ id, name, savedAt, preview?: { symbol?, interval? } }`) instead of `LayoutInfo`, and `saveLayout` takes `{ id?, summary, layout }`. Build it with `layoutEntry(layout, name, id?)`: `storage.saveLayout(layoutEntry(layout, 'Main', 'main'))` replaces `storage.saveLayout({ id: 'main', name: 'Main', layout })`. A custom adapter stores `summary` with the id and returns it from `listLayouts`, without reading the layout. The local adapter converts its index from the old shape once, on the first read, so saved layouts stay listed.
- **`parseSessionString` is removed.** Write the schedule as an object: `'0930-1600:12345'` becomes `{ weekly: { mon: day, tue: day, wed: day, thu: day, fri: day } }` with `const day = [{ start: '09:30', end: '16:00' }]`, and `'24x7'` becomes `ALWAYS_OPEN`.
- **Drawing tools sit in seven groups, and the cursor choices are two.** Tool ids are unchanged, so saved drawings, favourites and shortcut bindings keep working. The `group` ids changed, so a custom tool that joined a built-in flyout needs the new id, and the rail's message keys follow:

  | Before | Now |
  | --- | --- |
  | `group: 'lines'` | `group: 'lines'` |
  | the `arrow` tool: `'lines'` | `'annotate'` |
  | `'shapes'`, `'text'`, `'markers'` | `'annotate'` |
  | `'channels'`, `'pitchforks'`, and `fib-channel` | `'parallels'` |
  | `'fib'` (except `fib-channel` and the time tools), `'gann'` | `'ratios'` |
  | `'cycles'`, and `fib-time-zone` and `fib-time` | `'time'` |
  | `'positions'`, `'volume'` | `'measure'` |
  | `crosshair: { cursor: 'arrow' }` | `crosshair: { cursor: 'pointer' }` (a stored `'arrow'` still loads as `'pointer'`) |
  | `crosshair: { cursor: 'dot' }` | `'cross'` or `'pointer'` (a stored `'dot'` loads as `'cross'`) |
  | messages `railGroupChannels`, `railGroupPitchforks`, `railGroupGann`, `railGroupFib`, `railGroupCycles`, `railGroupShapes`, `railGroupText`, `railGroupMarkers`, `railGroupPositions`, `railGroupVolume` | `railGroupAnnotate`, `railGroupParallels`, `railGroupRatios`, `railGroupTime` (`railGroupLines`, `railGroupPatterns` and `railGroupMeasure` stay) |
  | messages `railCursorDot`, `railCursorArrow` | `railCursorPointer` |

  `builtinTools` and `patternTools` are in the [catalogue order](../guide/drawings#tool-catalogue), so code that picked tools by index should pick them by `type`. Each rail flyout starts on its group's most general tool (Trend line for Lines, Text for Annotate, and so on).

- **Picking a bar is a standalone function.** `chart.pickBar()` and `chart.cancelPickBar()` are now the `@charton/core` exports `pickBar(chart)` and `cancelPickBar(chart)`, so apps that do not pick bars leave the code out. They behave as before:

  ```ts
  import { cancelPickBar, pickBar } from '@charton/core';

  const picked = await pickBar(chart); // was chart.pickBar()
  cancelPickBar(chart);                // was chart.cancelPickBar()
  ```

- **Viewport bounds are an opt-in plugin.** `chart.setViewportBounds` moved into the new `viewportBounds()` plugin, so a chart without it leaves that code out. `builtins()` includes it, so apps that pass `builtins()`, or use the UI shell with its default plugins, need no change. Otherwise add it:

  ```ts
  import { createChart, viewportBounds } from '@charton/core';

  const chart = createChart(el, { plugins: [viewportBounds()] });
  ```

  Without it, `setViewportBounds` throws a [`not-registered`](../guide/errors#not-registered) `ChartError` and `chart.viewportBounds` is null. An app that gives the UI shell its own `chart.plugins` list adds `viewportBounds()` to that list. Uninstalling the plugin removes the bounds.

- **Point series are an opt-in plugin.** `chart.addPoints` moved into the new `points()` plugin, so a chart without it leaves the point series code out. `builtins()` includes it, so apps that pass `builtins()`, or use the UI shell with its default plugins, need no change. Otherwise add it:

  ```ts
  import { createChart, points } from '@charton/core';

  const chart = createChart(el, { plugins: [points()] });
  ```

  Without it, `addPoints` throws a [`not-registered`](../guide/errors#not-registered) `ChartError`. An app that gives the UI shell its own `chart.plugins` list adds `points()` to that list.

- **The bar-close countdown is an opt-in plugin.** The time left in the newest bar, which the `countdown` feature flag shows under the last price label, moved into the new `countdown()` plugin, so a chart without it leaves that code out. `builtins()` includes it, so apps that pass `builtins()`, or use the UI shell with its default plugins, need no change. Otherwise add it:

  ```ts
  import { countdown, createChart } from '@charton/core';

  const chart = createChart(el, { plugins: [countdown()] });
  ```

  Without it the `countdown` flag is kept and stays on by default, but shows nothing. Development builds warn once when the flag is set to `true` explicitly ([`countdown-missing`](../guide/errors#countdown-missing)). Nothing throws. The UI shell does not add the plugin itself: an app that gives the shell its own `chart.plugins` list adds `countdown()` to that list. Without it the shell's settings dialog leaves out the countdown switch.

- **Drawing level defaults and colours changed.** The built-in level tools take their default levels from each method: the Fib speed fan uses the retracement's Fibonacci levels, the Gann box Gann's range divisions (quarters shown, odd eighths and thirds hidden), the trend-based Fib time 0 and the powers of the golden ratio from φ⁻² to φ², and the pitchforks the tines (1) with the halfway lines (0.5) and the warning lines at 2 and 3 hidden. Every default level now carries `color: 'auto'`, the shared [level colour rule](../guide/drawings#level-colours), instead of a named theme level colour. Saved drawings keep their own levels and colours, so they draw as before; only new drawings and drawings without `style.levels` change. Code that shows a level's colour, such as a custom levels editor, resolves `'auto'` with the new `resolveLevelColor`:

  ```ts
  import { resolveLevelColor } from '@charton/core';

  // Before: resolveThemeColor(level.color, chart.theme) ?? drawingColor
  const color = resolveLevelColor(level, chart.theme) ?? drawingColor;
  ```

  To keep the previous look for new drawings, set your own levels with `chart.drawings.setToolDefaults(type, { levels })`. The named theme level colours (`levelNeutral`, `levelRed` …) still resolve.

- **Data source requests and resets are renamed and reshaped.** A data source written for an earlier version needs these changes:

  | Before | Now | Why |
  | --- | --- | --- |
  | `request.countBack` | `request.limit` | An upper bound on the bars returned |
  | `request.first` | `request.kind === 'initial'` | It duplicated `kind` |
  | `{ bars, noData }` | `{ bars, atStart }` | The bars reach the start of the history |
  | `stream(symbol, interval, onBar, onReset)` | `stream(symbol, interval, onBar)` plus `onReset(listener)` | Sources without a stream can report corrections too |
  | `createPollingDataSource({ countBack })` | `createPollingDataSource({ limit })` | The same name as the request field |
  | `testDataSource(source, { countBack })` | `testDataSource(source, { limit })` | The same name as the request field |
  | `request.countBack` in an indicator's `fetch` | `request.barCount` | An expected size, not a cap |
  | `request.getBars(symbol)` in an indicator's `fetch` | `request.barsOf(symbol)` | No `get` prefix |

  A reset is now reported through a subscription on the source, and names the symbol, and the interval unless every interval changed:

  ```ts
  // Before
  stream(symbol, interval, onBar, onReset) {
    feed.on('corrected', ({ from, to }) => onReset?.({ from, to }));
    /* ... */
  }

  // Now
  const resets = new Set<(reset: BarsReset) => void>();
  feed.on('corrected', ({ symbol, interval, from, to }) => {
    for (const listener of resets) listener({ symbol, interval, range: { from, to } });
  });
  const source: DataSource = {
    /* symbol, search, history, stream(symbol, interval, onBar) */
    onReset(listener) {
      resets.add(listener);
      return () => resets.delete(listener);
    },
  };
  ```

  `createPollingDataSource` no longer sends the previous bar again when a new one opens unless it changed. Code that counted on that extra update, for example to mark a bar as closed, should watch for the next bar instead.

- **Data source marks are one method, `markers`.** `getMarks` and `getTimeMarks` are one optional `markers` method that takes a request object, and each item says where it goes. `getAdjustments` is `adjustments`, with the same request object. A data source and an app written for an earlier version need these changes:

  | Before | Now | Why |
  | --- | --- | --- |
  | `getMarks(symbol, interval, from, to, signal)` | `markers(symbol, interval, { from, to, signal })` | A noun like the other source methods, with a request object like `history`; named after the annotation markers that draw them |
  | `getTimeMarks(symbol, interval, from, to, signal)` | `markers(…)` returning items with `position: 'timeAxis'` | One method for both placements |
  | `getAdjustments(symbol, from, to, signal)` | `adjustments(symbol, { from, to, signal })` | The same naming and request shape |
  | `Mark`, `TimeMark`, `MarkPosition` | `SourceMarker`, `SourceMarkerPosition` | One item type, with a bar marker's field names |
  | `tooltip: ['Earnings', 'beat']` | `tooltip: 'Earnings\nbeat'` | Plain text with `\n` line breaks, like the other text fields; an array is now dropped as invalid |
  | `chart.marks`, `chart.timeMarks` | `chart.sourceMarkers` | One getter for both placements |
  | `marks:loaded`, `marks:error`, `marks:change` and the `timemarks:*` ones | `sourcemarkers:loaded`, `sourcemarkers:error`, `sourcemarkers:change` | One event family, named after the getter; payloads carry `markers` |
  | `mark:click`, `timemark:click` | `sourcemarkers:click` with `{ markers, point }` | Its listeners make both bar markers and badges take presses |
  | `chart.refreshMarks()` | Report a reset from the source (`onReset`) | One refetch path for bars and their markers |
  | `chart.clearMarks()` | `chart.applyOptions({ marks: false, timeMarks: false })` | With both options off nothing is fetched |
  | `sourceMarks()` plugin, `@charton/core/source-marks` | `sourceMarkers()`, `@charton/core/source-markers` | Named after what it fetches |
  | error code `marks-failed`, warning `source-marks-missing` | `markers-failed`, `source-markers-missing` | The same |

  ```ts
  // Before
  const source: DataSource = {
    /* symbol, search, history */
    getMarks: async (symbol, interval, from, to, signal) => [{ id: 'e1', time, text: 'E', tooltip: ['Earnings', 'beat'] }],
    getTimeMarks: async (symbol, interval, from, to, signal) => [{ id: 'n1', time, text: 'N' }],
  };
  chart.on('mark:click', ({ marks }) => open(marks[0]!.id));
  chart.refreshMarks();

  // Now
  const source: DataSource = {
    /* symbol, search, history, onReset */
    markers: async (symbol, interval, { from, to, signal }) => [
      { id: 'e1', time, text: 'E', tooltip: 'Earnings\nbeat' },
      { id: 'n1', time, position: 'timeAxis', text: 'N' },
    ],
  };
  chart.on('sourcemarkers:click', ({ markers }) => open(markers[0]!.id));
  // In the source, when its events change:
  for (const listener of resets) listener({ symbol: 'ABC' });
  ```

  Ids are now unique across both placements, since they share one list. The time-axis band appears once the source has sent a `timeAxis` marker, rather than whenever it had `getTimeMarks`. With only one of `marks` and `timeMarks` off, markers are still fetched, as before; with both off, none are, and `chart.sourceMarkers` is empty.

- **`History` is an interface.** The undo stack behind `chart.history` now comes with the drawings and indicators plugins, the only ones that make undo steps, so a chart without them leaves it out. The exported `History` type, which was a class, is now an interface with its public members: `canUndo`, `canRedo`, `undo()`, `redo()` and `clear()`. It was only exported as a type, so no app could construct it or test `instanceof History`, and calls on `chart.history` work as before. Code that declared its own class `implements History`, or reached the internal members (`record`, `begin`, `commit`, `cancel`, `mute`, `drop`, `last`, `interrupt`) through a cast, needs changing: an implementation needs only the five public members, and the internal ones are no longer reachable. On a chart without drawings or indicators, `chart.history` has nothing to undo: `undo()` and `redo()` return false and `history:change` never fires.
- **Localization is an opt-in plugin.** Applying the `localization` option (`createLocalizer`: `Intl` numbers, digits and grouping, compact amounts, dates and hour cycles, `messages` and `translate`) moved into the new `localization()` plugin, so a chart that stays in English leaves the `Intl` code out. `builtins()` includes it, so apps that pass `builtins()`, or use the UI shell with its default plugins, need no change. An app that picks its own plugins, or passes none, and sets `localization` (including the `@charton/locales` packs) adds it:

  ```ts
  import { createChart, localization } from '@charton/core';
  import { deDE } from '@charton/locales/de-DE';

  const chart = createChart(el, { plugins: [localization()], localization: deDE });
  ```

  Without it the chart keeps the built-in English (`chart.localization` is `englishLocalizer`), the option is kept and still checked at the call, and development builds warn once ([`localization-missing`](../guide/errors#localization-missing)). `createLocalizer` and `englishLocalizer` stay public exports, and `englishLocalizer` is unchanged in what it returns.
- **The last-point pulse is an opt-in plugin.** The ring the `lastPointPulse` series option draws moved into the new `lastPointPulse()` plugin, so a chart that never pulses leaves that code out. `builtins()` includes it, so apps that pass `builtins()`, or use the UI shell with its default plugins, need no change. An app that picks its own plugins, or passes none, and sets `lastPointPulse` adds it:

  ```ts
  import { createChart, lastPointPulse } from '@charton/core';

  const chart = createChart(el, { plugins: [lastPointPulse()] });
  chart.addLine({ lastPointPulse: 'on-update' });
  ```

  Without it the option is kept and checked as before but draws nothing, and development builds warn once ([`pulse-missing`](../guide/errors#pulse-missing)). Nothing throws.

- **Bar grouping is an opt-in plugin.** The bucketing behind the `grouping` option (pixel and calendar buckets, the coarser levels series draw buckets from, `chart.grouping` and `grouping:change`) moved into the new `grouping()` plugin, so a chart that never groups bars leaves that code out. `builtins()` includes it, so apps that pass `builtins()`, or use the UI shell with its default plugins, need no change. An app that picks its own plugins, or passes none, and sets `grouping` adds it:

  ```ts
  import { createChart, grouping } from '@charton/core';

  const chart = createChart(el, { plugins: [grouping()], grouping: { mode: 'pixel' } });
  ```

  Without it the option is kept and checked as before, but bars draw singly, zooming stops at `minBarSpacing`, `chart.grouping` is null, `grouping:change` never fires, and development builds warn once ([`grouping-missing`](../guide/errors#grouping-missing)). Installed later, the view groups bars on the next frame.
- **The kagi and point & figure styles are an opt-in plugin.** Drawing a candle series in the `kagi` or `pointFigure` style moved into the new `priceStyles()` plugin, so a chart that never shows them leaves that code out. `builtins()` includes it, so apps that pass `builtins()`, or use the UI shell with its default plugins, need no change. An app that picks its own plugins, or passes none, and shows either style adds it:

  ```ts
  import { createChart, priceStyles } from '@charton/core';

  const chart = createChart(el, { plugins: [priceStyles()] });
  chart.addCandles({ style: 'kagi' });
  ```

  Without it a series in either style draws nothing, and development builds warn once ([`price-styles-missing`](../guide/errors#price-styles-missing)). `priceBars`, `PriceBarBuilder` and the other price-based bar types (`renko`, `lineBreak`, `range`) need no plugin.
- **Reference lines are an opt-in plugin.** `chart.referenceLines` and the lines the `referenceLines` option turns on (previous close, visible high, low and average, bid, ask and extended hours) moved into the new `referenceLines()` plugin, so a chart that never shows them leaves that code out. `builtins()` includes it, so apps that pass `builtins()`, or use the UI shell with its default plugins, need no change. An app that picks its own plugins, or passes none, and shows reference lines adds it:

  ```ts
  import { createChart, referenceLines } from '@charton/core';

  const chart = createChart(el, {
    plugins: [referenceLines()],
    referenceLines: { previousClose: { visible: true } },
  });
  ```

  Without it, no line draws, the last-price label always shows the newest close, and reading `chart.referenceLines` throws a [`not-registered`](../guide/errors#not-registered) `ChartError`. The `referenceLines` option is kept, merged per line, and applied when the plugin is installed later (an unknown line or line style still throws at the call); development builds warn once ([`reference-lines-missing`](../guide/errors#reference-lines-missing)) when it turns a line on. `ReferenceLines` and `defaultReferenceLinesOptions` stay public exports.
- **Saving and loading layouts is an opt-in plugin.** `chart.serializeLayout` and `chart.loadLayout` moved into the new `layouts()` plugin, so a chart that never saves what the user arranged leaves that code out. `builtins()` includes it and the UI shell and chart grid add it, so apps that pass `builtins()` or use the shell need no change. An app that picks its own plugins, or passes none, and saves or restores layouts adds it:

  ```ts
  import { createChart, layouts } from '@charton/core';

  const chart = createChart(el, { plugins: [layouts()] });
  const saved = chart.serializeLayout();
  ```

  Without it, `serializeLayout` and `loadLayout` throw a [`not-registered`](../guide/errors#not-registered) `ChartError`, so `autosave` reports each save through its `onError` and `loadLastLayout` rejects. `state:change` and `layoutLoading` need no plugin. `LAYOUT_VERSION`, `migrateLayout` and the layout types stay public exports.

- **Loading through a data source is an opt-in plugin.** The data controller behind `chart.setDataSource` (symbol and interval loads, history paging, live bars and the snapshot cache) moved into the new `dataSource()` plugin, so a chart that only gets bars through `setData` leaves that code out. `builtins()` includes it and the UI shell and chart grid add it, so apps that pass `builtins()` or use the shell need no change. An app that picks its own plugins, or passes none, and attaches a source adds it:

  ```ts
  import { createChart, dataSource } from '@charton/core';

  const chart = createChart(el, { plugins: [dataSource()] });
  chart.setDataSource(source);
  ```

  Without it, `setDataSource(source)` throws a [`not-registered`](../guide/errors#not-registered) `ChartError` and `chart.data` stays null; `setDataSource(null)` still works. The framework wrappers' `dataSource` prop needs it too: pass `plugins: [dataSource()]` (or `builtins()`) in `options`, created once. Without it the component does not attach the source and development builds warn once ([`data-source-missing`](../guide/errors#data-source-missing)) instead of throwing. Uninstalling the plugin detaches the source and keeps the bars it loaded. `DataController` stays a public export.

- **The shell's order draft editor, order cluster list and bar replay strip are opt-in parts.** They were on by default; like the [other optional parts](../guide/ui-shell#optional-parts), each shell option now takes what its factory from `@charton/ui` returns, so a shell without the option leaves the part's code out. Pass them to keep them:

  ```ts
  import { clusterList, createChartShell, draftEditor, replayControls } from '@charton/ui';

  createChartShell(el, {
    // was: on by default, or draftEditor: { quantityPresets, maxQuantity }
    draftEditor: draftEditor({ quantityPresets, maxQuantity }),
    // was: on by default
    clusterList: clusterList(),
    // was: on by default
    replayControls: replayControls(),
  });
  ```

  Where you passed `draftEditor: false`, `clusterList: false` or `replayControls: false`, drop the option. Without a part, its handle (`shell.draftEditor`, `shell.clusterList`, `shell.replayControls`) is null, `draft:edit` and `annotations:cluster` are left to your own listeners, and a replay runs without the floating strip. The draft editor and the cluster list need the `trading()` plugin and the strip needs `replay()`; the shell still adds both when your plugin list leaves them out. Development builds warn when an option still holds the old object or boolean. `createDraftEditor`, `createClusterList` and `createReplayControls` are unchanged for use without the shell.

- **The shell's symbol search, command palette, favourites, toasts and toolbar customization are opt-in parts.** Each shell option takes what its factory from `@charton/ui` returns, so a shell without the option leaves the part's code out. Favourites, the command palette and toasts were on by default; pass them to keep them. One line per part:

  ```ts
  import { commandPalette, createChartShell, favorites, symbolSearch, toasts, toolbarCustomization } from '@charton/ui';

  createChartShell(el, {
    // was: toolbar: { items, customizable: true, locked: ['symbol'], settings }
    toolbar: { items, customize: toolbarCustomization({ locked: ['symbol'] }), settings },
    // was: symbolSearch: { source, onSelect }
    symbolSearch: symbolSearch({ source, onSelect }),
    // was: on by default, or commandPalette: { sources }
    commandPalette: commandPalette({ sources }),
    // was: on by default, or favorites: { tools }
    favorites: favorites({ tools }),
    // was: on by default (toasts: true)
    toasts: toasts(),
  });
  ```

  Where you passed `favorites: false`, `commandPalette: false` or `toasts: false`, drop the option. `toolbarCustomization()` also goes on `createToolbar` and on a chart grid's `toolbar`. Without a part, its handle (`shell.symbolSearch`, `shell.commandPalette`, `shell.favorites`, `shell.toasts`) is null, `symbolHeader()` and `commandPaletteToolbarItem()` are disabled, `toolbar.openCustomization()` does nothing and `toolbar.registerAction()` throws. Development builds warn when an option still holds the old object or boolean. See [optional parts](../guide/ui-shell#optional-parts).

- **The built-in watermark is an opt-in plugin.** `chart.watermark` and the `watermark` feature flag moved into the new `watermark()` plugin, so a minimal chart leaves the watermark code out. `builtins()` includes it and the UI shell adds it, so apps that use either need no change. An app that picks its own plugins and shows the watermark adds it:

  ```ts
  import { createChart, watermark } from '@charton/core';

  const chart = createChart(el, { plugins: [watermark()], features: { watermark: true } });
  ```

  Without it, `features.watermark` draws nothing and reading `chart.watermark` throws a `not-registered` `ChartError`. Development builds warn once when the flag is set to true ([`watermark-missing`](../guide/errors#watermark-missing)). `createWatermark` stays a plain export, so a watermark attached by hand with `chart.attachPrimitive` keeps working.

- **Corporate action adjustments are an opt-in plugin.** Back-adjusting bars under the `adjustment` option and marking corporate actions (`adjustmentMarkers`) moved into the new `adjustments()` plugin, so a minimal chart leaves that code out. `builtins()` includes it and the UI shell adds it, so apps that pass `builtins()` or use the shell need no change. An app that picks its own plugins and whose source has `adjustments` adds it (with `annotations()` for the markers):

  ```ts
  import { adjustments, createChart } from '@charton/core';

  const chart = createChart(el, { plugins: [adjustments()], adjustment: 'splits' });
  ```

  Without it, the chart still fetches the source's corporate actions but shows the bars as sent whatever `adjustment` says, and marks no action. Development builds warn once ([`adjustments-missing`](../guide/errors#adjustments-missing)). `adjustBars` and `adjustBar` stay plain exports for bars you push yourself.

- **Data source markers are an opt-in plugin.** Fetching the data source's markers (`markers`, see the entry on markers above) moved into the new `sourceMarkers()` plugin, so a minimal chart leaves that code out. `builtins()` includes it and the UI shell adds it, so apps that pass `builtins()` or use the shell need no change. An app that picks its own plugins and serves markers adds it, with `annotations()` to draw them:

  ```ts
  import { annotations, createChart, sourceMarkers } from '@charton/core';

  const chart = createChart(el, { plugins: [annotations(), sourceMarkers()] });
  ```

  Without it, the chart never calls `markers`, `chart.sourceMarkers` stays empty, and no time-axis band is added under the time axis. Development builds warn once ([`source-markers-missing`](../guide/errors#source-markers-missing)).

- **The shared WebGL context is an opt-in plugin** (#911). `gl: 'shared'` draws through the context the new `sharedContext()` plugin brings, so a chart without it leaves the shared context code out. `builtins()` includes it, and `createChartGrid` adds it to each cell, so apps that pass `builtins()` or use the UI shell or grid need no change. An app that sets `gl: 'shared'` with its own plugin list adds it there:

  ```ts
  import { createChart, sharedContext } from '@charton/core';

  const chart = createChart(el, { gl: 'shared', plugins: [sharedContext()] });
  ```

  The context is chosen at creation, so `chart.install(sharedContext())` later changes nothing. Without the plugin, a `gl: 'shared'` chart gets its own context, `chart.options.gl` reads `'own'`, and development builds warn once ([`shared-context-missing`](../guide/errors#shared-context-missing)).

- **The render statistics are an opt-in plugin** (#910). Frame measuring (`renderStats`, `chart.frameStats`, `frame:render`), the `renderStatsOverlay` panel and GPU frame timing moved into the new `statsOverlay()` plugin, so a minimal chart leaves their code out. `builtins()` includes it, and so does the UI shell's default plugin list, so apps that pass `builtins()` or use the shell's defaults need no change. An app that picks its own plugins and uses `renderStats`, `renderStatsOverlay`, `chart.frameStats` or `frame:render` adds it:

  ```ts
  import { createChart, statsOverlay } from '@charton/core';

  const chart = createChart(el, { plugins: [statsOverlay()], renderStatsOverlay: true });
  ```

  Without it, both options are kept but measure nothing: `chart.frameStats` stays `null`, `frame:render` never fires and the panel is not drawn (development builds warn once, [`stats-overlay-missing`](../guide/errors#stats-overlay-missing)). `chart.gpuMemory()` needs no plugin. Plugins get the frame hook the statistics are built on, [`ctx.onFrame`](../guide/plugins#frame-observers).

- **Trade fills and trading lines are an opt-in plugin.** The fill markers and the order, position, alert and draft lines moved out of `annotations()` into the new `trading()` plugin, so an app that only uses markers, price lines, zones, bands and text labels leaves their code out. `builtins()` includes it and the UI shell adds it, so apps that pass `builtins()` or use the shell need no change. An app that passes `annotations()` and calls `setTrades`, `addTrade`, `clearTrades`, `getTrades`, `tradeGroups`, `applyTradeOptions`, `tradeOptions`, `addTradeLine`, `addAlertLine`, `startOrderDraft` or `syncTrades` adds `trading()` after it:

  ```ts
  import { annotations, createChart, trading } from '@charton/core';

  const chart = createChart(el, { plugins: [annotations(), trading()] });
  ```

  Without it, those calls throw a [`not-registered`](../guide/errors#not-registered) `ChartError` naming `trading()`. Reading `tradeLines`, `alertLines`, `draftLines` or `alertsCrossed` does not throw: without the plugin there are no such lines, so they answer empty. Annotations are never saved in layouts, so a layout loads the same with or without the plugin.

- **Engine internals moved to `@charton/core/internal`.** The `Pane` and `Timeline` classes, `layoutPanes` and `COLLAPSED_PANE_HEIGHT` are no longer exported from `@charton/core`. `Pane` and `Timeline` stay there as types, so code that names `chart.panes` or `chart.timeline` keeps compiling; only constructing them or `instanceof` needs the new entry. The series draw routines `drawPolyline` and `drawBaseline`, `resolveBaseLevel`, and the volume profile binning steps `binVolume` and `profileLayout` moved there too; for a volume profile, `computeVolumeProfile` on the main entry does both binning steps and reuses an `out` profile. The new entry has no stability promise: what is in it can change in any release.

  ```ts
  // Before
  import { Pane, Timeline, binVolume, drawPolyline } from '@charton/core';
  // After
  import { Pane, Timeline, binVolume, drawPolyline } from '@charton/core/internal';
  ```

- **Depth lanes are an opt-in plugin.** `chart.addDepthLane` needs the new `depthLane()` plugin, so a plain `createChart` bundle leaves the depth lane out. `builtins()` includes it, and the UI shell passes `builtins()` unless you set `chart.plugins`, so apps that use either need no change. Otherwise add it:

  ```ts
  import { createChart, depthLane } from '@charton/core';

  const chart = createChart(el, { plugins: [depthLane()] });
  ```

  Without it, `chart.addDepthLane` throws a [`not-registered`](../guide/errors#not-registered) `ChartError` naming the plugin. `createDepthLane` with `chart.attachPrimitive` keeps working without the plugin.

- **Lines draw on the GPU by default.** Line series, the line-drawn candle styles (`line`, `lineMarkers`, `step`, `area`, `baseline`, `hlcArea`) and indicator lines and fills now default to `renderer: 'gpu'`. They draw below every series drawn on the 2D canvas, so a `zIndex` that put such a line above or below a canvas series (a curved line, a line with per-point colours, a custom series) no longer does. To keep the old drawing, opt out per series or indicator:

  ```ts
  chart.addLine({ renderer: 'canvas' });
  chart.addCandles({ style: 'area', renderer: 'canvas' });
  chart.indicators.add('bbands', {}, { renderer: 'canvas' });
  ```

- **Bar replay is an opt-in plugin.** `chart.replay` needs the new `replay()` plugin. A plain `createChart` bundle leaves the replay code out. `builtins()` includes it, and the UI shell adds it, so apps that pass `builtins()` or use the shell need no change. Otherwise add it:

  ```ts
  import { createChart, replay } from '@charton/core';

  const chart = createChart(el, { plugins: [replay()] });
  ```

  Without it, `chart.replay` throws a [`not-registered`](../guide/errors#not-registered) `ChartError` naming the plugin. Data loading works as before. Uninstalling it ends a replay in progress and shows every bar again.

- **Indicators and compared symbols are opt-in plugins too.** `chart.indicators` needs the new `indicators()` plugin, and `chart.compare()` the new `comparisons()` plugin. A plain `createChart` bundle leaves out the indicator manager, its runners and series, and the compare loaders, about 15% of it. `builtins()` includes both, and the UI shell adds them, so apps that pass `builtins()` or use the shell need no change. Otherwise add what the chart uses:

  ```ts
  import { comparisons, createChart, indicators } from '@charton/core';

  const chart = createChart(el, { plugins: [indicators(), comparisons()] });
  ```

  Without them, `chart.indicators` and `chart.compare()` throw a [`not-registered`](../guide/errors#not-registered) `ChartError` naming the plugin, and so does a plugin's `ctx.registerIndicator`; `chart.compared` is empty. Put `indicators()` before plugins that register indicator definitions, such as `higherIntervalBars()`. A chart without indicators keeps the indicators of a layout it loads, reports them in `errors`, and writes them back unchanged when it saves; installing indicators later loads them. Its `access.indicators` and `access.maxIndicators` options are kept and apply once indicators are installed.

- **Annotations and drawings are opt-in plugins too.** `chart.annotations` needs the new `annotations()` plugin, and `chart.drawings` needs drawings: `drawingTools()` as before, or the new `drawings()` for the manager with only your own tools. A plain `createChart` bundle leaves out the annotation layers, the drawing manager, its clipboard and commands, about a fifth of it. `builtins()` includes both, and the UI shell adds them, so apps that pass `builtins()` or use the shell need no change. Otherwise add what the chart uses:

  ```ts
  import { annotations, createChart, drawingTools } from '@charton/core';

  const chart = createChart(el, { plugins: [annotations(), drawingTools()] });
  ```

  Without them, `chart.annotations` and `chart.drawings` throw a [`not-registered`](../guide/errors#not-registered) `ChartError` naming the plugin, and so do a plugin's `ctx.registerDrawingTool` and `perSymbolDrawings`. Marks and time marks from the data source, corporate action markers and indicator shape plots draw through annotations: without the plugin they do not show (development builds warn once, [`annotations-missing`](../guide/errors#annotations-missing)). A chart without drawings keeps the drawings and tool defaults of a layout it loads, reports them in `errors`, and writes them back unchanged when it saves; installing drawings later loads them. The drawing commands (`undo`, `redo`, `delete-drawings` and the others) and `draw-<type>` come with drawings. The drawings plugins are named `@charton/core/drawings` (`installedPlugins`, `uninstall`), and a chart takes one of `drawings()` and `drawingTools()`.

- **Heatmaps, volume profiles and the built-in drawing tools are opt-in plugins.** A chart from `createChart` no longer includes them, so bundles that do not use them leave their code out. Pass what a chart uses in its `plugins` option; `builtins()` restores the previous behaviour:

  ```ts
  import { builtins, createChart } from '@charton/core';

  const chart = createChart(el, { plugins: builtins() }); // or some of heatmap(), volumeProfile(), drawingTools(tools)
  ```

  Without them, `addHeatmap`, `addVolumeProfile`, and `drawings.setTool` or `drawings.add` with a built-in tool throw a [`not-registered`](../guide/errors#not-registered) `ChartError` that names the plugin to add. Saved drawings still load: those of a tool the chart does not have stay in the data and appear once it has it. The UI shell (`createChartShell`, `createChartGrid` and the React and Vue `ChartShell`) passes `builtins()` unless you set `chart.plugins`, so apps built on it need no change. The React and Vue `Chart` components are plain core charts: add `plugins` to their `options` prop. See [Opt-in features](../guide/features#opt-in-features).

- **Legend settings buttons.** `createIndicatorSettings` (and the UI shell) now declares the rows it opens with `chart.provideSeriesSettings`: indicators whose definition is registered. Once any provider is declared, the legend's settings button and the row menu's Settings… item show only on rows a provider covers. If your app also listens to `series:settings` for other rows, declare them too, or their buttons disappear:

  ```ts
  chart.on('series:settings', ({ series, indicator }) => { if (!indicator) openMySeriesPanel(series); });
  chart.provideSeriesSettings((series, indicator) => indicator === null);
  ```

  Without any provider, every row still shows the button while something listens, as before. `chart.openSeriesSettings(series)` returns false for rows no provider covers.

- **The tool rail is a toolbar, not a navigation landmark.** The shell's drawing tool rail was a `<nav class="pc-rail">`; it is now a `<div class="pc-rail" role="toolbar" aria-orientation="vertical">` with the same label, since its buttons arm tools and take arrow keys rather than lead to other pages. Its look and behaviour do not change. Styles, scripts or tests that find it by its tag or its old role select it by class or by the toolbar role:

  ```ts
  // was: el.querySelector('nav.pc-rail'), or getByRole('navigation', { name: 'Drawing tools' })
  el.querySelector('.pc-rail'); // or getByRole('toolbar', { name: 'Drawing tools' })
  ```

  CSS rules on `nav.pc-rail` become `.pc-rail`. The page no longer has a navigation landmark for the rail.

- **Market status is an opt-in plugin.** `chart.marketStatus()` and the legend badge of the `marketStatus` option (the market phase from the `session` and `extendedSession` options, and the data delay) moved into the new `marketStatus()` plugin, so a chart that shows neither leaves that code out. `builtins()` includes it, so apps that pass `builtins()`, or use the UI shell with its default plugins, need no change. Otherwise add it:

  ```ts
  import { createChart, marketStatus } from '@charton/core';

  const chart = createChart(el, { plugins: [marketStatus()] });
  chart.marketStatus(); // { phase, next, delay }
  ```

  Without it `chart.marketStatus()` throws a [`not-registered`](../guide/errors#not-registered) `ChartError` at the call, with `context` `{ call: 'marketStatus', plugin: 'marketStatus()' }`, and the `marketStatus` option is kept, stays on by default and shows no badge. Development builds warn once when the option is set to `true` explicitly ([`market-status-missing`](../guide/errors#market-status-missing)). `marketPhase(regular, extended, zone, now)` stays a standalone export that needs no plugin. The UI shell does not add the plugin itself: an app that gives the shell its own `chart.plugins` list adds `marketStatus()` to that list. Without it the shell's settings dialog leaves out the market status switch.
