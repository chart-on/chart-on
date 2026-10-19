# Drawing tools

## Today

Built-in (`packages/core/src/drawing/tools.ts`, in catalogue order): `cross-line`, `hline`, `horizontal-ray`, `vline`, `extended-line`, `ray`, `trend-angle`, `trendline`, `info-line`, `anchored-note`, `anchored-text`, `arrow-down`, `arrow-left`, `arrow-right`, `arrow-up`, `balloon`, `comment`, `flag`, `note`, `price-label`, `signpost`, `text`, `arrow`, `arrow-marker`, `callout`, `circle`, `ellipse`, `price-note`, `rectangle`, `arc`, `curve`, `double-curve`, `rotated-rectangle`, `triangle`, `brush`, `highlighter`, `path`, `polyline`, `regression-trend`, `disjoint-channel`, `fib-channel`, `flat-top-bottom`, `inside-pitchfork`, `modified-schiff-pitchfork`, `parallel-channel`, `pitchfan`, `pitchfork`, `schiff-pitchfork`, `fib-arcs`, `fib-circles`, `fib-retracement`, `fib-speed-fan`, `fib-spiral`, `gann-box`, `gann-fan`, `gann-square`, `gann-square-fixed`, `fib-wedge`, `fib-extension`, `cyclic-lines`, `fib-time-zone`, `sine-line`, `time-cycles`, `fib-time`, `elliott-correction`, `elliott-double-combo`, `abcd`, `triangle-pattern`, `cypher`, `elliott-triangle`, `elliott-triple-combo`, `xabcd`, `elliott-impulse`, `head-shoulders`, `three-drives`, `anchored-vwap`, `date-price-range`, `date-range`, `fixed-range-volume-profile`, `forecast`, `measure`, `price-range`, `projection`, `bars-pattern`, `long-position`, `short-position`, `eraser`, `zoom-box`.

Manager (`packages/core/src/drawing/manager.ts`): `register`, `getTools`, `setTool`, `tool`, `selected`, `getAll`, `add`, `update`, `remove`, `clear`, `serialize`, `load`, `setHidden`, `setLocked`, `setMagnet`, `stayInDrawingMode`.

Events: `tool:change`, `drawing:select`, `drawings:change`.

Plugin contract (`DrawingToolDef`): fixed `points` count, `render(ctx, screenDrawing, env)`, `hitTest(...)`, optional `editableText`, `defaultStyle`.

## Full catalog

Ids are ours (kebab-case). Points = anchors the user places (`n` = variable, `free` = freehand stroke). ✅ = exists.

### Order rule

The catalogue has seven groups, named for the job the tools do. `builtinTools`, `patternTools`, the rail flyouts, the icon map (`packages/ui/src/icons.ts`) and this page all follow one rule, and `packages/core/test/tool-catalogue.test.ts` asserts it:

1. **Groups go from simple to complex**, by what a drawing adds to the anchors the user places: nothing beyond the line (Lines), a shape or text (Annotate), lines parallel to the anchors (Parallels), price levels at ratios of the move (Ratios), times projected from it (Time), several labelled legs (Patterns), values computed from the bars (Measure).
2. **Within a group, fewer anchors first.** `n` and `free` come after every fixed count.
3. **Then by English label**, so a new tool has exactly one place.

The eraser and zoom box have no group and come last. A group's rail button starts on its face, the group's most general tool (`groupFaces` in `packages/ui/src/rail.ts`). Fewer groups mean fewer flyouts: seven instead of the thirteen before #862.

### Cursors

| Id | What changes for the user | Status |
| --- | --- | --- |
| `crosshair.cursor: 'cross'` | Crosshair lines follow the pointer | ✅ |
| `crosshair.cursor: 'pointer'` | No lines; the platform's own pointer, axis labels kept | ✅ |

The lines are the only thing a cursor choice changes, so there are two choices. A dot in place of the pointer showed the same position as the pointer, hid the platform pointer (and with it the user's pointer size and contrast settings) and needed its own drawing code, so it was removed in #862.

### Lines
Single reference lines.

| Id | Points | Status |
| --- | --- | --- |
| `cross-line` | 1 | ✅ |
| `hline` | 1 | ✅ |
| `horizontal-ray` | 1 | ✅ |
| `vline` | 1 | ✅ |
| `extended-line` (both directions) | 2 | ✅ |
| `info-line` (trend line with stats) | 2 | ✅ |
| `ray` | 2 | ✅ |
| `trend-angle` | 2 | ✅ |
| `trendline` | 2 | ✅ |

### Annotate
Shapes, text, arrows and icons.

| Id | Points | Status |
| --- | --- | --- |
| `anchored-note` | 1 | ✅ |
| `anchored-text` (screen-pinned, % of pane) | 1 | ✅ |
| `arrow-down`, `arrow-left`, `arrow-right`, `arrow-up` | 1 | ✅ |
| `balloon`, `comment` | 1 | ✅ |
| `flag` | 1 | ✅ |
| `note` | 1 | ✅ |
| `price-label` | 1 | ✅ |
| `signpost` | 1 | ✅ |
| `text` | 1 | ✅ |
| `arrow`, `arrow-marker` | 2 | ✅ |
| `callout` | 2 | ✅ |
| `circle`, `ellipse` | 2 | ✅ |
| `price-note` | 2 | ✅ |
| `rectangle` | 2 | ✅ |
| `arc`, `curve`, `double-curve` | 3 | ✅ |
| `rotated-rectangle` | 3 | ✅ |
| `triangle` | 3 | ✅ |
| `brush`, `highlighter` | free | ✅ |
| `path`, `polyline` | n | ✅ |

Opt-in plugin tools in this group: `icon` / `sticker` (1, inline SVG from the app / an image the app loads from a reference, at a fixed size and angle set by handles: `iconTool`, `createStickerTool`), `emoji` (1, the glyph in the drawing's text: `emojiTool`) and `image` (2, the app loads the image from a reference it stores in the drawing's text: `createImageTool`). ✅

### Parallels
Channels (the Fib channel among them: its levels are lines parallel to the base line), pitchforks, pitchfan and regression.

| Id | Points | Status |
| --- | --- | --- |
| `regression-trend` (uses bar data) | 2 | ✅ |
| `disjoint-channel` | 3 | ✅ |
| `fib-channel` (levels are lines parallel to the base line) | 3 | ✅ |
| `flat-top-bottom` | 3 | ✅ |
| `inside-pitchfork`, `modified-schiff-pitchfork` | 3 | ✅ |
| `parallel-channel` | 3 | ✅ |
| `pitchfan`, `pitchfork`, `schiff-pitchfork` | 3 | ✅ |

Pitchforks (`pitchfork.ts`) take levels and band fills through `style.levels` and `style.fill`.

### Ratios
Fibonacci and Gann price grids, fans and arcs: levels at ratios of the move.

| Id | Points | Status |
| --- | --- | --- |
| `fib-arcs`, `fib-circles` | 2 | ✅ |
| `fib-retracement` | 2 | ✅ |
| `fib-speed-fan` | 2 | ✅ |
| `fib-spiral` | 2 | ✅ |
| `gann-box`, `gann-fan`, `gann-square`, `gann-square-fixed` | 2 | ✅ (`gann.ts`; levels and bands through `style.levels` and `style.fill`) |
| `fib-wedge` | 3 | ✅ |
| `fib-extension` (trend-based) | 3 | ✅ |

### Time
Time zones, trend-based time, cycles and sine.

| Id | Points | Status |
| --- | --- | --- |
| `cyclic-lines` | 2 | ✅ |
| `fib-time-zone` | 2 | ✅ |
| `sine-line` | 2 | ✅ |
| `time-cycles` | 2 | ✅ |
| `fib-time` (trend-based) | 3 | ✅ |

### Patterns
Harmonic patterns, chart patterns and waves. All share the labelled-polyline renderer with per-tool labels.

| Id | Points | Status |
| --- | --- | --- |
| `elliott-correction` | 3 | ✅ |
| `elliott-double-combo` | 3 | ✅ |
| `abcd` | 4 | ✅ |
| `triangle-pattern` | 4 | ✅ |
| `cypher` | 5 | ✅ |
| `elliott-triangle` | 5 | ✅ |
| `elliott-triple-combo` | 5 | ✅ |
| `xabcd` | 5 | ✅ |
| `elliott-impulse` | 6 (origin + 5) | ✅ |
| `head-shoulders` | 7 | ✅ |
| `three-drives` | 7 | ✅ |

### Measure
Ranges, positions, forecast, bars pattern, projection, anchored VWAP and volume profile. Each shows values computed from the bars between its anchors: the change, percent and bar count (`forecast`), the copied bars (`bars-pattern`) or the replayed closes (`projection`).

| Id | Points | Status |
| --- | --- | --- |
| `anchored-vwap` (uses bar data) | 1 | ✅ |
| `date-price-range`, `date-range` | 2 | ✅ |
| `fixed-range-volume-profile` (uses bar data) | 2 | ✅ |
| `forecast` | 2 | ✅ |
| `measure` (the quick, temporary measure) | 2 | ✅ |
| `price-range` | 2 | ✅ |
| `projection` | 2 | ✅ |
| `bars-pattern` (copy bar shape) | 3 | ✅ |
| `long-position`, `short-position` | 3 | ✅ |

### Utility
`eraser` (click a drawing to delete it) and `zoom-box` (drag a box to zoom to it). ✅

## Plugin contract changes

Most of the catalog cannot be expressed with today's `DrawingToolDef`. Proposed additions (all optional, backward compatible):

```ts
interface DrawingToolDef {
  type: string;
  label: string;
  /** Rail group id: 'lines' | 'annotate' | 'parallels' | 'ratios' | 'time' | 'patterns' | 'measure' | your own */
  group?: string;
  /** Number of anchors, 'n' = click until double-click/Enter, 'free' = freehand stroke. */
  points: number | 'n' | 'free';
  /** Anchors placed in pane % instead of time/price (anchored text/note). */
  anchoring?: 'data' | 'screen';
  editableText?: boolean;
  defaultStyle?: DrawingStyle;
  /** Extra style fields the settings UI should render (levels, extend, labels...). */
  settings?: DrawingSettingDef[];
  /** Called while dragging anchor `i`; return adjusted points (e.g. keep channel parallel). */
  constrain?(points: DrawingPoint[], anchor: number): DrawingPoint[];
  /** Extra handles that are not anchors (position tool target/stop). */
  handles?(d: ScreenDrawing, env: DrawingEnv): Point[];
  render(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv): void;
  hitTest(d: ScreenDrawing, p: Point, env: DrawingEnv): boolean;
}

interface DrawingStyle {
  color?: string;
  lineWidth?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  fill?: string;
  fontSize?: number;
  // new
  extendLeft?: boolean;
  extendRight?: boolean;
  showLabel?: boolean;
  showStats?: boolean;          // angle, distance, % change, bars
  bold?: boolean;
  italic?: boolean;
  textColor?: string;
  levels?: { value: number; color?: string; visible?: boolean }[]; // fib/gann
}
```

`DrawingEnv` additions: `bars(fromTime, toTime)` for data-aware tools, `timeToX`/`priceToY` and inverse for tools that compute extra geometry, `pixelRatio`.

Shared render helpers to export from core so plugins stay short: `strokeLine`, `labelPill`, `labelledPolyline`, `levelLines` (fib), `fillBetween`.

## Manager API additions (shipped)

```ts
chart.drawings.getById(id): Drawing | undefined
chart.drawings.select(id | null)     // ignores hidden and unselectable drawings
chart.drawings.clone(id): Drawing | null
chart.drawings.bringToFront(id) / sendToBack(id) / bringForward(id) / sendBackward(id)
chart.drawings.setVisible(id, visible)
chart.drawings.setAccess(AccessRule | null)   // ({ kind, id }) => boolean   // filters rail + setTool
chart.drawings.undo() / redo()       // T2, see persistence.md
```

Existing `add()` already covers programmatic creation (single- and multi-point drawings alike). Per-drawing flags on `Drawing`: `selectable?`, `persist?` (exclude from `serialize`), `zIndex?`, `hidden?`, `group?`; `add()` and `update()` validate their types.

## Events (shipped)

Keep `drawings:change` (aggregate, persist on this). Granular events for apps that sync to a server:

```ts
'drawing:create'  { drawing }
'drawing:update'  { drawing, change, changes }   // 'points' | 'style' | 'text' | 'lock' | 'visibility' | 'order' | 'pane' | 'flags'
'drawing:remove'  { id }
'drawing:click'   { id }
'drawing:dblclick'{ id }
'access:change'   { allow }
'history:change'  { canUndo, canRedo }
```

`load()` fires only `drawings:change`; listeners re-sync from its payload.

## UI pieces (in `@chart-on/ui`)

- Rail groups generated from `group` field: `defaultRailItems()` builds one flyout per group.
- Favorites strip: user pins tools; persisted via settings adapter.
- Floating drawing toolbar on selection: color, width, line style, lock, delete, clone, settings.
- Settings dialog driven by `settings` defs.
- Drawing templates: save style per tool type (see persistence.md).
