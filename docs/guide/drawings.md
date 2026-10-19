---
description: "The built-in drawing tools, drawing modes, editing drawings from code, undo and redo, and saving them."
---

# Drawing tools

Drawings live on `chart.drawings`. Points are stored as time and price, so drawings stay in place when data reloads.

Drawings are [opt-in](./features#opt-in-features): `chart.drawings` needs the `drawingTools()` plugin (or `builtins()`), or `drawings()` for drawings with only your own tools. Without one, it throws a [`not-registered`](./errors#not-registered) `ChartError`.

## Built-in tools

The built-in tools are [opt-in](./features#opt-in-features): create the chart with the `drawingTools()` plugin (or `builtins()`), or `drawingTools(tools)` with only the tools you offer. The UI shell adds all of them unless you pass your own plugins. Each tool a chart has, built-in or your own, gets a `draw-<type>` [action](./interaction#actions-and-shortcuts).

### Tool catalogue

`builtinTools`, this table and the [rail](./ui-shell#rail) list the tools in seven groups named for the job they do, each a `group` id and a rail flyout: `lines` (single reference lines), `annotate` (shapes, text, arrows and icons), `parallels` (channels, the Fib channel among them, pitchforks, pitchfan and regression), `ratios` (Fibonacci and Gann price grids, fans and arcs), `time` (time zones, trend-based time, cycles and sine), `patterns` (harmonic patterns, chart patterns and waves) and `measure` (ranges, positions, forecast, bars pattern, projection, anchored VWAP and volume profile: each shows values computed from the bars, such as the change and bar count of a `forecast`, the bars a `bars-pattern` copies or the closes a `projection` replays). The order follows one rule:

- Groups go from simple to complex, by what a drawing adds to the anchors you place: nothing beyond the line, a shape or text, parallel lines, price levels at ratios of the move, times projected from it, several labelled legs, and values computed from the bars.
- Within a group, tools with fewer anchors come first (`n` and `free` last), then the rest by English label.
- The eraser and zoom box have no group and come last.

A name in code font at the end of a row is a style field of that tool beyond the common ones: `color`, `lineWidth`, `lineStyle`, `fill` and the text fields (`textColor`, `fontSize`, `bold`, `italic`). `styleFields(id)` lists every field a drawing's tool honours (see [toolbar fields](#toolbar-fields)).

| Type | Points | Description |
| --- | --- | --- |
| **Lines** | | |
| `cross-line` | 1 | Horizontal and vertical line through a point, optionally labelled with its price and time (`showLabel`) |
| `hline` | 1 | Horizontal line at a price, labelled with it (`showLabel`) |
| `horizontal-ray` | 1 | Horizontal line from a point to the right edge, optionally labelled with its price (`showLabel`) |
| `vline` | 1 | Vertical line at a time, optionally labelled with it (`showLabel`) |
| `extended-line` | 2 | Line through both points, extended to both edges |
| `ray` | 2 | Line from the first point through the second, extended to the pane edge in that direction |
| `trend-angle` | 2 | Segment with an arc from the horizontal through the first point, labelled with its screen angle in degrees, up is positive (`showLabel`) |
| `trendline` | 2 | Line segment (`extendLeft`, `extendRight`) |
| `info-line` | 2 | Trend line with stats: a segment labelled with price change, percent, bar count and angle (`showStats`, `extendLeft`, `extendRight`) |
| **Annotate** | | |
| `anchored-note` | 1 | Editable text in a box pinned to the pane: it stays put while the chart scrolls and zooms |
| `anchored-text` | 1 | Editable text pinned to the pane: it stays put while the chart scrolls and zooms |
| `arrow-down`, `arrow-left`, `arrow-right`, `arrow-up` | 1 | Fixed-size filled arrow with its tip on the point |
| `balloon` | 1 | Editable text in a rounded speech bubble centred above the point, its tail reaching down to it |
| `comment` | 1 | Editable text in a square speech bubble above the point, its tail reaching down to it |
| `flag` | 1 | Flag on a pole standing on a bar; asks for optional text, written on the cloth |
| `note` | 1 | Editable text in a box whose top-left corner is the point |
| `price-label` | 1 | Tag pointing at a point, showing its price |
| `signpost` | 1 | Sign on a post standing on a bar; asks for optional text, written on the sign, which sizes to it |
| `text` | 1 | Editable text label |
| `arrow` | 2 | Segment with an arrowhead (`extendLeft`, `extendRight`) |
| `arrow-marker` | 2 | Filled arrow from the first point to the second |
| `callout` | 2 | Editable text in a box, joined to the first point; the box is centred on the second |
| `circle` | 2 | Circle around the first point through the second (`showFill`) |
| `ellipse` | 2 | Ellipse inside the box between two corners (`showFill`) |
| `price-note` | 2 | Note on the first point's price level, centred on the second and joined to the anchor; shows the price above optional text |
| `rectangle` | 2 | Box between two corners (`extendLeft`, `extendRight`, `showFill`) |
| `arc` | 3 | Circular arc from the first point to the second through the third |
| `curve` | 3 | Curve between the first two points, through the third halfway along |
| `double-curve` | 3 | S-curve between the first two points: its first half passes through the third point, its second half mirrors it |
| `rotated-rectangle` | 3 | Rectangle at any angle: the first two points are the ends of one side, the third sets how far the opposite side lies (`showFill`) |
| `triangle` | 3 | Triangle through three points (`showFill`) |
| `brush` | free | Freehand stroke (press, drag, release) |
| `highlighter` | free | Wide, translucent freehand stroke (12 px by default) |
| `path` | n | Polyline with an arrow head at its last point |
| `polyline` | n | Line through points placed one click at a time; double-click or Enter ends it |
| **Parallels** | | |
| `regression-trend` | 2 | Least-squares line through the closes of the bars between the points, with lines a number of standard deviations above and below (`deviation`, `middleLine`, `extendLeft`, `extendRight`, `showStats`, `showFill`) |
| `disjoint-channel` | 3 | Line between the first two points and a line through the third point with the mirrored slope over the same bars, with fill (`extendLeft`, `extendRight`, `showFill`) |
| `fib-channel` | 3 | Level lines parallel to the base line through the first two points, at fractions of the distance to the third point (levels 0 to 1 and 1.618; `levels`, `extendLeft`, `extendRight`, `showLabel`, `labelSide`, `labelContent`, `showFill`) |
| `flat-top-bottom` | 3 | Line between the first two points and a flat line at the third point's price over the same bars, with fill (`extendLeft`, `extendRight`, `showFill`) |
| `inside-pitchfork` | 3 | Pitchfork whose median starts halfway between the first and third points (`levels`, `showLabel`, `labelContent`, `showFill`) |
| `modified-schiff-pitchfork` | 3 | Pitchfork whose median starts halfway between the first and second points (`levels`, `showLabel`, `labelContent`, `showFill`) |
| `parallel-channel` | 3 | Base line, a parallel line through the third point, a dashed middle line and fill (`middleLine`, `extendLeft`, `extendRight`, `showFill`) |
| `pitchfan` | 3 | Rays from the first point through the second, the third and the midpoint between them (`levels`, `showLabel`, `labelContent`, `showFill`) |
| `pitchfork` | 3 | Median line from the first point through the midpoint of the other two, with parallel tines through them (`levels`, `showLabel`, `labelContent`, `showFill`) |
| `schiff-pitchfork` | 3 | Pitchfork whose median starts at the first point's time, halfway to the second point in price (`levels`, `showLabel`, `labelContent`, `showFill`) |
| **Ratios** | | |
| `fib-arcs` | 2 | Half circles around the end of the move, on the start's side, at fractions of its length (levels 0.236 to 1 and 1.618; `levels`, `showLabel`, `labelContent`, `showFill`) |
| `fib-circles` | 2 | Concentric circles around the first point, level 1 through the second (levels 0.236 to 1 and 1.618; `levels`, `showLabel`, `labelContent`, `showFill`) |
| `fib-retracement` | 2 | Retracement levels with prices between the start and end of a move (levels 0 to 1; `levels`, `extendLeft`, `extendRight`, `showLabel`, `labelSide`, `labelContent`, `showFill`) |
| `fib-speed-fan` | 2 | Speed resistance fan: rays from the first point through each level's point on the far edges of the box up to the second point, in price and in time (levels 0 to 1; `levels`, `showLabel`, `labelSide`, `labelContent`) |
| `fib-spiral` | 2 | Golden spiral around the first point through the second: its radius grows by the golden ratio every quarter turn, turning anticlockwise as it grows, out past the pane |
| `gann-box` | 2 | The box between the points, cut in price and in time at Gann's range divisions: the quarters (0, 0.25, 0.5, 0.75, 1) show, the odd eighths and the thirds are listed but hidden; bands between the price levels (`levels`, `showLabel`, `labelContent`, `showFill`, `labelSide`) |
| `gann-fan` | 2 | Rays from the first point at price to time ratios 1x8, 1x4, 1x3, 1x2, 1x1, 2x1, 3x1, 4x1 and 8x1, the 1x1 ray through the second point, with bands between them (`levels`, `showLabel`, `showFill`) |
| `gann-square` | 2 | The box between the points cut at quarter levels, with both diagonals and lines from the first point to each level on the far edges (`levels`, `showLabel`, `labelContent`, `showFill`, `labelSide`) |
| `gann-square-fixed` | 2 | A Gann square kept square on screen: the second point sets its width and whether it grows up or down (`levels`, `showLabel`, `labelContent`, `showFill`, `labelSide`) |
| `fib-wedge` | 3 | Arcs around the first point between its edges through the second and third points, level 1 through the second (levels 0.236 to 1 and 1.618; `levels`, `showLabel`, `labelContent`, `showFill`) |
| `fib-extension` | 3 | Trend-based extension: the move from the first to the second point, projected from the third; its levels start at the third point and run to the rightmost point, and at least the move's width past the third (levels 0, 0.618, 1, 1.618, 2.618, 3.618, 4.236; `levels`, `extendLeft`, `extendRight`, `showLabel`, `labelSide`, `labelContent`, `showFill`) |
| **Time** | | |
| `cyclic-lines` | 2 | Full-height lines repeating at the bar distance between the points, from the first point on in the second's direction |
| `fib-time-zone` | 2 | Full-height lines at Fibonacci multiples (0, 1, 2, 3, 5, 8, 13, …, 89) of the bar distance between the points (`levels`, `showLabel`, `labelSide`, `labelContent`) |
| `sine-line` | 2 | Sine wave across the pane with a crest or trough at the first point and the next trough or crest at the second |
| `time-cycles` | 2 | Half ellipses one cycle (the bar distance between the points) wide, repeating along the first point's price, as high as the second point; `fill` fills them |
| `fib-time` | 3 | Trend-based time: full-height lines at fractions of the move's duration from the first to the second point, counted from the third (levels 0 and the powers of the golden ratio from φ⁻² to φ²: 0.382, 0.618, 1, 1.618, 2.618; `levels`, `showLabel`, `labelSide`, `labelContent`) |
| **Patterns** | | |
| `elliott-correction` | 3 | Wave count joining A, B and C (`showLabel`) |
| `elliott-double-combo` | 3 | Wave count joining W, X and Y (`showLabel`) |
| `abcd` | 4 | Pattern joining A, B, C and D (`showLabel`) |
| `triangle-pattern` | 4 | Pattern joining A, B, C and D (`showLabel`) |
| `cypher` | 5 | Pattern joining X, A, B, C and D (`showLabel`) |
| `elliott-triangle` | 5 | Wave count joining A through E (`showLabel`) |
| `elliott-triple-combo` | 5 | Wave count joining W, X, Y, X and Z (`showLabel`) |
| `xabcd` | 5 | Pattern joining X, A, B, C and D (`showLabel`) |
| `elliott-impulse` | 6 | Wave count joining origin 0 and waves 1 through 5 (`showLabel`) |
| `head-shoulders` | 7 | Seven-point pattern; the second, fourth and sixth points label the left shoulder, head and right shoulder (`showLabel`) |
| `three-drives` | 7 | Pattern joining 0, 1, A, 2, B, 3 and C (`showLabel`) |
| **Measure** | | |
| `anchored-vwap` | 1 | Volume-weighted average price from the bar at the point onward, with optional deviation bands (`deviation`, `showLabel`, `showFill`) |
| `date-price-range` | 2 | Price change, percent, bar count and elapsed time in one box (`showStats`, `showFill`) |
| `date-range` | 2 | Bar count and elapsed time between two bars (`showStats`, `showFill`) |
| `fixed-range-volume-profile` | 2 | Volume by price for the bars between the points, with point of control and value area (`rows`, `valueArea`, `profileWidth`, `showLabel`) |
| `forecast` | 2 | Dashed arrow from the start of an expected move to its target, with the change, percent and bar count (`showStats`) |
| `measure` | 2 | Price change, percent and bar count (`showStats`) |
| `price-range` | 2 | Price change and percent between two prices (`showStats`, `showFill`) |
| `projection` | 2 | Replays the closes of the bars between the points as a line starting on the newest bar's close, keeping their spacing; it moves on as new bars arrive |
| `bars-pattern` | 3 | Copies the bars between the first two points as ghost candles starting at the third, moved so the first copied bar opens at its price |
| `long-position` | 3 | Entry, target and stop zones of a long position with P/L and risk/reward (`showStats`, `profitColor`, `lossColor`) |
| `short-position` | 3 | Entry, target and stop zones of a short position with P/L and risk/reward (`showStats`, `profitColor`, `lossColor`) |
| **No group** | | |
| `eraser` | click or drag | Places nothing: a click removes the drawing under the pointer, a drag every drawing its stroke crosses, as one undo step. Locked drawings stay |
| `zoom-box` | drag | Places nothing: zooms the view to the dragged box's time range and its pane's price range (autoscale off). A click or a flat drag does nothing, and `Escape` drops the box |

`rectangle`, `rotated-rectangle`, `triangle`, `circle` and `ellipse` fill with a faint tint of their line color; set `style.fill` to another color, or `'transparent'` for an outline only.

`style.extendLeft` and `style.extendRight` (**Extend left** and **Extend right** in the settings dialog) carry a drawing past its anchors to the pane edge on that side. The trend line, trend line with stats and arrow keep their slope (the arrow head stays on the second point; a vertical one has no left or right side and stays as placed); the parallel channel, flat top/bottom, disjoint channel and Fib channel extend every line and the fill between them; the rectangle widens into a price zone across the pane; the Fib retracement and extension start or end their level lines at the edge; and the regression trend extends its fitted lines. All default to off.

`style.showFill: false` (**Background** in the settings dialog) turns a tool's background off in one step, whatever its fill: the tint of the rectangle and shapes, the zones of the range tools, the fill of the channels, regression trend and anchored VWAP bands, and the bands of the Fibonacci, Gann and pitchfork tools. Without a fill, the settings dialog's fill swatch shows the drawing's color at the opacity the tool tints with (0.14 for shapes and ranges, 0.12 for channels and level bands, which alternate with half of it, 0.1 for pitchforks and the regression trend, 0.08 for the VWAP bands). Level bands take each level's own color, so for the level tools the swatch matches their opacity, not their hue. While the background is off, the dialog greys the fill out and the toolbar's swatch shows none; picking a fill there turns the background back on. The Fib speed resistance fan, Fib time zone and trend-based Fib time take a `fill` too: unset they draw no bands, as before; set, the fan fills between neighbouring rays and the time tools between neighbouring lines, in that color, every other band at half its opacity so neighbouring bands stay apart, as on the level tools.

Patterns and wave counts live in the **Patterns** rail flyout. Click each anchor in order; the last click finishes the drawing. They connect the points you place without enforcing ratios or recognizing a pattern. Labels sit above peaks and below troughs. Set `style.showLabel: false` to hide them; line color, width and style, and text color, size, bold and italic are configurable. Drag any selected anchor to edit it, or drag a segment to move the whole drawing. Points follow normal, log and percent scales and save as time and price like other drawings.

Note, callout, comment, balloon and price note boxes are opaque, so their text stays readable over the chart; `style.fill` tints them, and `\n` in their text starts a new line. A price note asks for its text after placing but stays without it, and its price follows the anchor when dragged. Anchored text and anchored notes save their point as fractions of the pane (see [custom tools](./custom-drawing-tools.md)), so they keep their place on the pane rather than on a bar. Notes, callouts, comments, balloons, price notes, price labels and the one-point arrows keep their size in pixels at any zoom. `arrow-up` and `arrow-down` default to the theme's `up` and `down` colors and follow theme changes until given a color of their own. Labels drawn on a colored pill, tag, flag or sign (level labels, price labels, the measure readout) write their text in black or white, whichever contrasts more with the color under it, unless `style.textColor` sets one.

The reference lines share their fields: line color, width and style, `showLabel`, and the label's text color, size, bold and italic. A `hline` labels its price at the right edge unless `showLabel` is false. A `horizontal-ray` labels its price at the right edge too, a `vline` its time along the bottom of the pane (as the time axis writes it under the crosshair), and a `cross-line` both (near the bottom-right corner its time pill ends before the price pill instead of covering it); these three start with `showLabel: false` and draw a label only when it is `true`, so lines saved before the option keep their look. While selected, each marks its price, its time or both on the axes, as its anchor says: a horizontal line only its price and a vertical line only its time, since the other coordinate only records where it was placed.

### Pitchforks

Place the pivot first (A), then the two reaction points (B and C). Every pitchfork aims its median line at the midpoint of B and C and draws the B–C line; the variants differ only in where the median starts:

| Type | Median starts at |
| --- | --- |
| `pitchfork` | A |
| `schiff-pitchfork` | A's time, halfway between A and B in price |
| `modified-schiff-pitchfork` | Halfway between A and B |
| `inside-pitchfork` | Halfway between A and C, so the median runs parallel to A→B |

When the median does not start at A, a faint dashed guide joins A to its start. The tines run parallel to the median, and all lines reach the edge of the pane.

`style.levels` adds more lines, as fractions of the distance from the median to the tines: 0.5 is halfway to a tine, 2 is as far again beyond it. Each level draws a line on both sides, starting on the (extended) B–C line. The defaults follow the method's own geometry: level 1, the tines, is visible; the halfway lines (0.5) and the warning lines at two and three times the tine distance (2 and 3) are listed but hidden, ready to switch on in the settings dialog. With `style.showLabel: true` each level line shows its value where it crosses the B–C line; labels are off by default, so pitchforks look as before. The bands between the lines fill with a faint tint of each level's color; set `style.fill` to one color, or `'transparent'` to leave them empty.

A `pitchfan` uses the same levels, but as rays from A through each level's point on the B–C line.

The median-line geometry is available as a pure helper. It works on pixels as well as on time (x) and price (y):

```ts
import { pitchforkMedian } from '@chart-on/core';

const a = { x: 100, y: 400 }, b = { x: 200, y: 200 }, c = { x: 300, y: 300 };
pitchforkMedian('standard', a, b, c);        // { origin: { x: 100, y: 400 }, mid: { x: 250, y: 250 } }
pitchforkMedian('schiff', a, b, c).origin;   // { x: 100, y: 300 }
pitchforkMedian('modified-schiff', a, b, c).origin; // { x: 150, y: 300 }
pitchforkMedian('inside', a, b, c).origin;   // { x: 200, y: 350 }
```

### Tools that read the bars

`regression-trend`, `anchored-vwap` and `fixed-range-volume-profile` are calculated from the main series bars, so only the times of their points matter. They update as live bars arrive and when history loads, and they work on any pane, always reading the main series.

- **Regression trend.** Fits a straight line to the closes of the bars between the two points, by least squares over the bar number (so gaps in time do not bend it). `style.deviation` (default 2) places the outer lines that many standard deviations of the closes around the line above and below it; 0 draws the line alone. `style.middleLine: false` hides the centre line, `style.extendLeft` and `style.extendRight` carry the lines to the left and right edges, and `style.showStats` labels the correlation `r` and the standard deviation. On a log scale the lines bend, because the fit is in price.
- **Anchored VWAP.** From the bar at the point to the newest bar: the running average of each bar's typical price (high + low + close) / 3, weighted by its volume. Bars without volume leave it unchanged. `style.deviation` above 0 adds bands that many volume-weighted standard deviations away. The newest value is labelled unless `style.showLabel` is false.
- **Fixed range volume profile.** Spreads each bar's volume evenly over its low–high range into `style.rows` rows, the same binning as the volume profile series. Unset (or 0, "auto" in the settings dialog), rows follow the range's height on screen, one per 10 px, by the same rule as the series. The longest row is `style.profileWidth` percent of the range's width, by default 50, so it ends at the middle and the bars stay readable on the other half; rows inside the value area (`style.valueArea`, default 70%) are stronger, and the point of control is a line across the range, labelled unless `style.showLabel` is false. Bars with buy volume split each row into buy and sell parts.

Results are cached per drawing. A redraw reuses them, and a live bar that updates or appends adds only that bar. A volume profile lays its rows out again when the live bar makes a new high or low of the range, and new data or prepended history computes everything once. Custom tools can do the same with `env.barSpan(from, to)`, which gives the main series' own bar array and the indices of the bars in the range without copying; the array stays the same object until the data is replaced.

The regression fit is also available as a pure helper:

```ts
import { regressionChannel } from '@chart-on/core';

regressionChannel(bars);       // { count, intercept, slope, deviation, r } over all bars
regressionChannel(bars, 10, 50); // bars 10 to 49; intercept is the fitted price at bar 10
```

### Positions

Place the entry, then the target, then the stop. Each zone spans from the entry to its own anchor, and every anchor can be dragged on its own afterwards. Labels show the P/L at the target and the stop in price and percent, and the risk/reward ratio.

The zone on the profitable side takes the theme's `up` color and the losing side its `down` color; `style.profitColor` and `style.lossColor` (**Profit color** and **Loss color** in the settings dialog) replace them. They name the outcome, not the anchor, so a target placed at a loss still shows in the loss color. `style.showStats: false` (**Stats**) drops the figures from the labels, the P/L in price and percent and the risk/reward ratio, and keeps the entry, target and stop prices and the zones. The same switch hides the figure labels of the price range, date range, date and price range, forecast and measure tools; unset, they show as before.

The figures are available as pure helpers:

```ts
import { formatDuration, positionStats, priceChange } from '@chart-on/core';

positionStats('long', 100, 110, 95); // { targetPnl: 10, targetPercent: 10, stopPnl: -5, stopPercent: -5, riskReward: 2 }
priceChange(200, 150);               // { change: -50, percent: -25 }
formatDuration(90061);               // '1d 1h'
```

### Images

The `image` tool stretches an image over the box between its two points. It is not one of the built-in tools, because the chart never fetches anything itself: `createImageTool({ load })` makes it, and `load` turns a drawing's reference into an image. The reference is the drawing's `text`, a string the app chooses (a URL, a file name, an id it keys its own files by), and it is all that `serialize()`, the clipboard and linked charts carry; image bytes never go into saved drawings.

```ts
import { createImageTool } from '@chart-on/core';

const files = new Map<string, Blob>(); // the app's own uploads, by id

chart.drawings.register(createImageTool({
  // Return an image, canvas, bitmap or Blob, or a promise of one.
  load: (ref) => files.get(ref) ?? fetch(ref).then((r) => r.blob()),
}));

chart.drawings.add({ type: 'image', pane: 0, points: [from, to], style: {}, text: 'upload-1' });
```

`load` runs once per reference, and the result is kept while the reference is among the 256 most recently drawn; an older one is dropped (a bitmap the chart decoded is closed) and loaded again when next drawn. Until it resolves the box shows a dashed outline in the drawing's color; if it rejects, throws, or gives an image that fails to decode or has more than 32 megapixels, the box is crossed out and the drawing stays selectable. A `Blob` is checked before it is decoded: a PNG, JPEG, GIF or WebP file whose header declares more than 32 megapixels is refused unread, so a small file that would decode to gigabytes cannot stall the page. To change the image, update the drawing's `text`.

A drawing placed with the tool starts without a reference. To let users pick one, listen for it and set it:

```ts
chart.on('drawing:create', async ({ drawing }) => {
  if (drawing.type !== 'image' || drawing.text) return;
  const ref = await pickImage(); // the app's file picker; null when cancelled
  if (ref) chart.drawings.update(drawing.id, { text: ref });
  else chart.drawings.remove(drawing.id);
});
```

To let users paste images, such as screenshots, give the tool a `store` as well. It keeps a pasted image and returns the reference `load` will know it by; the bytes are the app's to keep, so saved drawings still hold only references:

```ts
chart.drawings.register(createImageTool({
  load: (ref) => files.get(ref)!,
  store: (image) => {
    const ref = `upload-${files.size + 1}`;
    files.set(ref, image);
    return ref; // or a promise, e.g. of an upload's URL
  },
}));
```

Ctrl/Cmd+V on the chart then adds the image as a selected `image` drawing, centred on the crosshair (or in the middle of the main pane) at its size in pixels, shrunk to fit half the pane. The chart checks the file before `store` sees it: it must start with the bytes of a PNG, JPEG, GIF or WebP image, whatever type the clipboard claims, and be at most 2 MB and 32 megapixels by its header, or nothing is added. It is then scaled down to at most 1024 px on its longer side and re-encoded as WebP (PNG in browsers that cannot write WebP), which also drops its metadata and all but the first frame of an animated GIF. Decoding uses `createImageBitmap` and an `OffscreenCanvas`, so a strict content security policy needs nothing extra. A custom tool can take pastes too, with `pasteImage` on its definition.

### Emoji

The `emoji` tool draws a glyph, usually one emoji, centred on its point. The glyph is the drawing's `text`, asked for after placing like the text tool's. It keeps a fixed size in css px (`style.fontSize`, 32 by default) and angle (`style.angle`, in degrees clockwise), so it reads the same at any zoom. While it is selected, the square handle at its lower right corner sets the size (8 to 512 px) and the one above it the angle, in whole degrees. Colour glyphs keep their own colours; a plain character takes `textColor`.

It is not one of the built-in tools. Add it to the tools a chart offers, and the shell's rail shows it with the markers:

```ts
import { builtinTools, createChart, drawingTools, emojiTool } from '@chart-on/core';

const chart = createChart(el, { plugins: [drawingTools([...builtinTools, emojiTool])] });
chart.drawings.add({ type: 'emoji', pane: 0, points: [point], style: { fontSize: 40, angle: -15 }, text: '🚀' });
```

### Icons and stickers

The `icon` and `sticker` tools work like `emoji`: one point, a fixed size in css px (`style.fontSize`) and angle (`style.angle`), the same size and rotation handles, and a payload in the drawing's `text`, asked for after placing. The picture is fitted into a square of the size, keeping its aspect ratio.

- `iconTool` draws inline SVG markup the app supplies (32 px by default). `currentColor` in the markup takes the drawing's `textColor`, so one icon follows the theme or any colour. Give the SVG a `viewBox`; its `width` and `height`, if set, give its aspect ratio.
- `createStickerTool({ load })` draws an image the app supplies (64 px by default). Like the [image tool](#images), the drawing keeps only the app's reference, and `load` turns it into an image, canvas, bitmap or `Blob`, once per reference.

```ts
import { builtinTools, createChart, createStickerTool, drawingTools, iconTool } from '@chart-on/core';

const stickers = createStickerTool({ load: (ref) => fetch(`/stickers/${ref}.png`).then((r) => r.blob()) });
const chart = createChart(el, { plugins: [drawingTools([...builtinTools, iconTool, stickers])] });

const star = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l3 7h7l-6 4 2 8-6-5-6 5 2-8-6-4h7z"/></svg>';
chart.drawings.add({ type: 'icon', pane: 0, points: [point], style: { fontSize: 24, textColor: '#e0a030' }, text: star });
chart.drawings.add({ type: 'sticker', pane: 0, points: [point], style: { fontSize: 96, angle: 10 }, text: 'rocket' });
```

Saved drawings and the clipboard carry only the markup or the reference, never image bytes, and the chart ships no icon set and fetches nothing itself. The markup is drawn as an image of a `data:` URL, never inserted into the page: scripts in it do not run and it loads nothing it references. Under a strict [content security policy](./security) that needs `data:` in `img-src`. Until a picture loads its box shows a dashed outline, and one that fails to load or decode a crossed box. An app with its own icon or sticker picker can add the drawings itself with `chart.drawings.add`.

### Recognise a freehand stroke

`recognizeSketch(points, options?)` reads a stroke, in plot pixels, as built-in drawings and returns the candidates best first, each with a `tool`, a `score` from 0 to 1 and the tool's anchor `points` in plot pixels. A straight stroke becomes a `hline` or `vline` when within 10° of either, a `ray` when it ends at a side of the plot (pass `plotWidth`) or else a `trendline`; a straight shaft with a hook that turns back becomes an `arrow`; a closed loop becomes a `rectangle` or an `ellipse` by how much of its bounding box it fills; and a zig-zag moving one way in time becomes a `fib-retracement` between its lowest and highest points. Taps and strokes that fit nothing give an empty list.

```ts
import { builtinSketchRecognizers, recognizeSketch, type SketchRecognizer } from '@chart-on/core';

recognizeSketch(stroke, { plotWidth: 800 })[0]; // { tool: 'trendline', score: 0.85, points: [a, b] }

// A recogniser of your own, asked alongside the built-in ones.
const tick: SketchRecognizer = (s) => (s.corners.length === 3 ? [{ tool: 'my-tick', score: 0.8, points: [s.points[0]!] }] : []);
recognizeSketch(stroke, { recognizers: [...builtinSketchRecognizers, tick], minScore: 0.6 });
```

Recognisers receive the stroke's points without repeats, its `bounds`, its `corners` (the points a simplification within a few percent of its size keeps) and its `length` along those corners, which leaves out hand jitter.

### Sketch a drawing

With the `sketch` feature flag on, users can draw without picking a tool: press the plot with a mouse or pen, hold still for half a second, then draw one stroke. On release, `recognizeSketch` reads the stroke and the best candidate among the registered tools the [access rule](#tool-access) allows is placed like a drawing made with that tool: it is selected, takes the tool's default style, snaps with the magnet, and is one undo step. A stroke that fits no tool places nothing, and `Escape` drops the stroke. A drag that moves before the hold ends still pans.

On touch, a long-press shows the [crosshair](./interaction#pointer) as usual; keep the finger still for another half second and the press becomes a sketch, so the next stroke draws instead of moving the crosshair. A finger that moves before then keeps inspecting. With `touchInspect: 'off'`, a long-press that opens no menu turns into a sketch the same way.

A label next to the new drawing names its tool (in the chart's language, like `toolLabel`) and, when the stroke fits several allowed tools, which fit it is, e.g. `Horizontal line · 1/2 · Tab`. While the label shows, `Tab` swaps the drawing for the next fit and `Shift+Tab` for the previous one, all in the undo step that placed it, and `Escape` takes the drawing back like undo. The next press, edit or undo hides the label, and `Tab` moves focus again.

To erase, scribble over drawings: a stroke that doubles back on itself four or more times removes every unlocked drawing it crosses, as one undo step. A scribble that crosses no drawing is read like any other stroke, and nothing is erased while all drawings are [locked](#modes).

The `sketch.holdMs` option sets the hold in milliseconds (default `500`): for a mouse or pen press, and on touch for the extra hold after the long-press. A change applies from the next press.

```ts
chart.applyOptions({ features: { sketch: true }, sketch: { holdMs: 350 } });
```

## Activate a tool

```ts
chart.drawings.setTool('trendline'); // user clicks to place points
chart.drawings.setTool(null);        // back to cursor
```

The [UI rail](./ui-shell#rail) does this for you.

After one drawing the tool goes back to the cursor. To draw several of the same kind in a row, keep the tool:

```ts
chart.drawings.setTool('trendline', { keep: true });
chart.drawings.toolKept; // true until the user leaves the tool
```

A kept tool stays active after each drawing until Escape (outside a drawing being placed, where Escape only cancels that drawing), or until `setTool()` picks another tool, the cursor, or the same tool again without `keep`. Keeping applies to that one activation: `stayInDrawingMode` (below) is left as it is. `setTool()` throws for a tool `setAccess()` refuses, so a refused tool is never kept, and when access later denies the kept tool the cursor takes over. `tool:change` carries `kept`, so a UI can show the state.

In the [UI shell](./ui-shell#rail), a double-click or double-tap on a tool in the rail, a rail flyout or the favourites bar keeps it, and so does Shift+Enter on a focused tool. A single click arms the tool for one drawing as before, and clicking the kept tool again goes back to the cursor. A kept tool's button has a ring and a dot, and is described as "Stays active" to assistive technology.

## Modes

```ts
chart.drawings.setMagnet(true);   // snap points to bar open/high/low/close
chart.drawings.setMagnetMode('weak'); // 'off', 'weak' or 'strong'; fires magnet:change
chart.drawings.setLocked(true);   // prevent moving or editing
chart.drawings.setHidden(true);   // hide all drawings; fires drawings:visibility
chart.drawings.stayInDrawingMode = true; // keep the tool active after each drawing
chart.drawings.setAxisLabels(false); // no axis labels for the selected drawing
```

The magnet snaps the price of each point placed or anchor dragged in the main pane to the bar's open, high, low or close. `'strong'` always snaps; `'weak'` snaps only when the pointer is within a few pixels of one of them, so points placed away from the bars stay where they are. `setMagnet(true)` turns the magnet back on in the mode it last had (`'strong'` the first time), and `drawings.magnet` says whether it is on at all. Holding Ctrl (Cmd on macOS) while placing or dragging snaps as `'strong'` whatever the mode, for a quick snap with the magnet off. Moving a whole drawing never snaps, so it keeps its shape.

Holding Shift while placing the next point or dragging an anchor keeps it horizontal, vertical or at 45° on screen from the previous point (from the next one for the first anchor); horizontal keeps that point's price exactly and vertical its time. Holding Shift while dragging a whole drawing moves it along one of those directions only. The constraint wins over the magnet. Shift on the press itself still adds to the selection, so press first and then hold Shift.

While a drawing is selected or being placed, its prices are labelled on the price axis and its times on the time axis, in the drawing's colour, and the range between them is highlighted. A horizontal line labels only its price and a vertical line only its time; tools choose theirs with [`axisMarks`](./custom-drawing-tools#contract).

## Add, update, remove from code

```ts
const line = chart.drawings.add({
  type: 'hline',
  pane: 0,
  points: [{ time: 1767225600, price: 104 }],
  style: { color: '#f59e0b', lineStyle: 'dashed' },
});

chart.drawings.update(line.id, { text: 'Resistance', locked: true });
chart.drawings.remove(line.id);
chart.drawings.clear();
chart.drawings.getAll();         // bottom to top
chart.drawings.getById(line.id); // a copy, or undefined
chart.drawings.select(line.id);  // or null to clear; chart.drawings.selected is the current one
chart.drawings.clone(line.id);   // unlocked copy, selected unless hidden or unselectable
chart.drawings.setVisible(line.id, false);
```

### Selecting several drawings

Shift+click adds a drawing to the selection or takes it out again. Shift+drag on an empty part of a pane draws a selection box and adds every drawing of that pane whose anchors all lie inside it (on a pane without selectable drawings, Shift+drag pans as usual). A plain click on one of several selected drawings leaves only it selected, and a click on empty space clears the selection.

Dragging any selected drawing moves all of them together: by the same number of bars, and by the same height on each drawing's own pane scale, so shapes hold on log scales too. Locked drawings stay where they are. Dragging an anchor still edits only its own drawing. The move is one undo step, and so is `Delete`, which removes every selected drawing.

```ts
chart.drawings.setSelection([a.id, b.id]); // [] clears; unknown, hidden and unselectable ids are left out
chart.drawings.selection;                   // ids in the order they were selected
chart.drawings.selected;                    // the last one selected
chart.on('drawing:select', ({ id, ids }) => showToolbar(id, ids.length));
```

### Nudge with the arrow keys

On a focused chart, the arrow keys move the selected drawings: `←` and `→` by one bar, `↑` and `↓` by one pixel on each drawing's own pane scale (so shapes hold on log scales). With Shift they move ten bars or pixels. Locked drawings stay put. Each press is one undo step; holding a key down makes one step for the whole hold, so one undo puts the drawings back where the key was first pressed. While nothing that can move is selected (or drawings are locked), the arrows pan the chart as usual, and `Ctrl` + `←` / `→` always moves the crosshair.

### Groups

Drawings that share a `group` name form a group. A click on any of them selects the whole group (Shift+click adds or removes the whole group, and the selection box adds the groups of the drawings it catches), so a group moves, nudges, copies and deletes as one. Dragging an anchor still edits only its own drawing, and `select()` and `setSelection()` from code select exactly what you pass.

```ts
chart.drawings.group();                  // the selection, under a new name such as 'Group 3'
chart.drawings.group([a.id, b.id], 'Levels'); // returns the name; null when no id is known
chart.drawings.groups;                   // [{ name: 'Levels', ids: [a.id, b.id] }], bottom to top
chart.drawings.renameGroup('Levels', 'Weekly levels'); // into an existing name, the two merge
chart.drawings.ungroup([a.id]);          // dissolves a's whole group; returns how many left a group
chart.drawings.update(a.id, { group: '' }); // takes out only a
```

Each of these is one undo step and fires `drawing:update` with the change `'flags'`. Grouping takes drawings out of the groups they were in; a name must be a non-empty string. New names come from the `drawingGroupName` message (`'Group {n}'`) of the [`localization`](./localization) option. On a focused chart `Mod+G` groups the selection and `Mod+Shift+G` ungroups it (the `group-drawings` and `ungroup-drawings` [actions](./interaction#actions-and-shortcuts)).

`paste()` and `duplicate()` put the copies of each group into a new group of their own, and a `clone()` leaves its group.

### Copy and paste

`copy()` keeps copies of the selected drawings (or of the ids you pass) and returns how many; `paste()` adds unlocked copies of them in place, on top, and selects them, as one undo step. Copies are taken when `copy()` runs, so later edits to the originals do not reach them, and each `paste()` makes new copies. On a focused chart Ctrl/Cmd+C and Ctrl/Cmd+V do the same, and also use the system clipboard, so drawings copied on one chart paste on another one, in another tab, or after a reload. Ctrl/Cmd+X cuts: it copies the selected drawings the same way and removes them, as one undo step (not while drawings are locked). The shortcuts run on the browser's own copy, cut and paste events, so no permission prompt appears. Ctrl/Cmd+V pastes:

1. the drawings this chart copied, while the clipboard still holds what it wrote there (or the browser gives it nothing);
2. drawings another chart copied, placed as `pasteScaling` says (default: at the same times and prices);
3. an image, such as a screenshot, as an `image` drawing centred on the crosshair, when an image tool takes pastes ([images](#images));
4. plain text, as a text drawing at the crosshair (or in the middle of the main pane), on one line and at most 1,000 characters.

`chart.drawings.pasteScaling` sets where drawings from another chart land, since its symbol or interval may differ:

- `null` (default): at the same times and prices.
- `'framed'`: where they were in the other chart's view. Each point keeps its share of the visible time range, and of its pane's visible price range (in log terms on a log scale), in this chart's view.
- `'scaled'`: the `'framed'` size, centred on the crosshair, or on the middle of the view without one. Drawings in other panes than the crosshair's keep their `'framed'` prices.

Where a range is missing on either side, or one pane has a log scale and the other not, that axis keeps the drawings' own times or prices and only moves them so they centre on the crosshair. The in-memory paste on the same chart always stays in place.

On the clipboard, copied drawings are JSON text: `{ kind: 'charton-drawings', version: 1, items, source: { symbol, interval, visibleRange, priceRanges } }`, where `items` are drawings with their prices as the data source sent the bars, like `serialize()`, and `priceRanges` holds the visible `{ min, max, log }` of each pane's main scale. Malformed items and drawings of tools the chart lacks are left out. Rebound copy, cut and paste shortcuts, and the `copy-drawings`, `cut-drawings` and `paste-drawings` actions run from a menu, stay inside the chart. The keys run the chart's `copy`, `cut` and `paste` actions, which also [copy a selected indicator](./indicators#copy-and-paste); paste adds what was copied last.

```ts
chart.drawings.copy([a.id]); // 1
chart.drawings.paste();      // the new drawings
chart.drawings.duplicate();  // copies the selection in place, leaving what copy() kept alone
```

### Stacking order

Later drawings draw on top. `bringToFront(id)` and `sendToBack(id)` move a drawing above or below all others; `bringForward(id)` and `sendBackward(id)` move it one step past the next drawing of the same pane. `moveTo(id, index)` puts it at a position among the drawings of its pane, counted from the bottom (0) and clamped to the ends. Each is one undo step. The `zIndex` flag sets a layer: higher layers always draw above lower ones, and a reordered drawing takes the layer of the drawing it passes. Drawings with `below` draw under the series, so they stack under all the others; `zIndex` orders them among themselves.

### Per-drawing flags

| Flag | Default | Effect |
| --- | --- | --- |
| `selectable` | `true` | `false` keeps the drawing out of hit testing: it cannot be selected, dragged or clicked, and the chart pans through it |
| `persist` | `true` | `false` leaves it out of `serialize()`, for drawings the app regenerates |
| `history` | `true` | `false` keeps its changes out of [undo and redo](#undo-and-redo), for drawings the app moves itself |
| `autoscale` | `false` | `true` keeps the drawing's prices in view: its pane's autoscale fits them while its time span overlaps the visible bars. Open price sides (vertical lines) add nothing, and hidden drawings nothing. While the user drags a drawing the scale holds still and refits on release |
| `below` | `false` | `true` draws the drawing under the series (over the grid and indicator backgrounds), e.g. a zone the candles stay readable over. Its selection handles stay on top, and it is hit-tested after the other drawings. While a drawing is below, every drawing redraw repaints the scene |
| `zIndex` | `0` | Stacking layer, see above |
| `hidden` | `false` | Not drawn or hit-tested; also set with `setVisible(id, visible)` |
| `group` | none | Name of the drawing's [group](#groups) |
| `name` | none | Name the user gave the drawing, for lists such as the [object tree](./ui-shell#object-tree); not drawn |
| `indicator` | none | Id of the indicator the drawing belongs to, see [below](#tie-to-an-indicator) |

Set them in `add()` or `update()`:

```ts
chart.drawings.add({ ...line, selectable: false, persist: false, group: 'signals' });
chart.drawings.update(line.id, { zIndex: 10 });
chart.drawings.add({ type: 'hline', pane: 0, points: [{ time, price: target }], style: {}, autoscale: true }); // target stays in view
chart.drawings.update(line.id, { below: true }); // under the candles
```

`add()` and `update()` throw when a flag has the wrong type (`zIndex` must be a finite number, `group`, `name` and `indicator` strings, the others booleans). Setting a flag to its default removes it from the drawing, and setting it to the value it already has is no change: no undo step and no events. `select()` ignores hidden and unselectable drawings.

### Show on some intervals only

A drawing can be limited to bar intervals, e.g. levels marked on minute charts that clutter a daily one:

```ts
chart.drawings.setVisibleOn(line.id, [{ from: '1m', to: '15m' }]); // 1 to 15 minute charts only
chart.drawings.setVisibleOn(line.id, [{ from: '1d', to: '1d' }, { from: '1w', to: '1w' }]); // daily and weekly
chart.drawings.setVisibleOn(line.id, null); // every interval again (so does [])
chart.drawings.hiddenByInterval(line.id); // true while the current interval is not in its ranges
```

- Each range includes both ends and compares intervals by length, as for [indicators](./indicators): `{ from: '1m', to: '59m' }` covers every minute interval, and months, quarters and years count as 30, 90 and 365 days.
- The ranges are stored in the drawing's `visibleOn` field, so they can also be set in `add()` and `update()` (`null` or `[]` clears them) and are saved with the drawing.
- On other intervals the drawing stays in `getAll()` and in `serialize()`, but it is not drawn or hit-tested, `select()` ignores it, and the chart pans through it, like a `hidden` drawing. A selected drawing is deselected when an interval change hides it.
- The interval is the data source's (`setSymbol`), or the spacing of the bars when the app sets them itself. While the chart has no interval yet, every drawing shows.
- `setVisibleOn` is one undo step and fires `drawing:update` with the change `'visibility'`. An invalid interval, or a range whose `from` is longer than its `to`, throws and changes nothing.
- In `@chart-on/ui`, the drawing settings dialog edits the ranges on its **Visibility** tab ([drawing settings](./ui-shell#drawing-settings)).

### Tie to an indicator

A drawing can belong to an indicator, e.g. levels drawn on an oscillator: its `indicator` flag holds the indicator's [`id`](./indicators#saving-and-restoring).

```ts
const rsi = chart.indicators.add('rsi');
chart.drawings.add({ type: 'hline', pane: 1, points: [{ time, price: 70 }], style: {}, indicator: rsi.id });
chart.drawings.update(line.id, { indicator: '' }); // untie it
```

- A drawing tool started in an indicator's own pane (not the price pane) ties the drawing to the first visible indicator there on the pane's main price scale, else to the first visible one on another scale of the pane. Drawings added from code tie only when `indicator` is set.
- A tied drawing shows only while its indicator shows: not while it is hidden, off its [intervals](./indicators#copies-and-intervals), pending, or not on the chart (for example before the indicators of a layout are loaded). Meanwhile it is kept and saved, but not drawn or hit-tested, like a `hidden` drawing, and a selected one is deselected.
- It is on its indicator's pane: `add()` and `update()` put it there, and it follows the indicator to another pane (`chart.moveSeries`, a legend row's menu, undo).
- Removing the indicator removes its drawings in the same undo step, so undo brings both back. Loading indicators (`indicators.load()` or a layout) keeps them: the indicators keep their ids.
- Copies of a tied drawing stay tied while the indicator is on the chart; pasted where it is not, they are plain drawings.
- The prices are on the indicator's price scale, also when that is not the pane's main one (an indicator added with its own `priceScale`, e.g. `'left'` or an overlay scale). Drawing, hit testing, dragging, the axis labels of a selected drawing and `autoscale` all use that scale. The magnet only snaps drawings on the price pane's main scale.
- Setting or clearing it fires `drawing:update` with the change `'flags'`.

### Tool access

```ts
const allowed = new Set(['trendline', 'hline']);
chart.drawings.setAccess(({ id }) => allowed.has(id)); // a deny list is `!denied.has(id)`
chart.drawings.isToolAllowed('rectangle'); // false
chart.drawings.setAccess(null);            // every tool again
```

Refused tools disappear from the tool rail, or show disabled with `access.refused: 'disable'`. `setTool` throws for them, after firing `tool:refuse` `{ tool }`, so a press on a disabled rail button reaches the app (for example to show an upgrade prompt). `setAccess` takes the same rule as the chart's `access.allow` option (`({ kind, id }) => boolean`, asked with `kind: 'drawing'`), or `null`, and throws for anything else; an active tool that becomes refused is dropped. Drawings added from code with `add()` are not restricted. `access:change` `{ allow }` fires on every call. The chart's [`access.allow` option](./features#access-rules) sets the rule for drawing tools and indicators together.

For live feedback while the user is still choosing, such as dragging across a color picker, `preview()` takes the same patch as `update()` but records nothing: no undo step and no `drawings:change`. Finish with one `update()` and the whole interaction becomes a single undo step. An `undo()` before that discards the preview, and so does `cancelPreview()`, which adds no undo step (for a Cancel button); it returns false when nothing was being previewed.

```ts
picker.addEventListener('input', () => chart.drawings.preview(id, { style: { color: picker.value } }));
picker.addEventListener('change', () => chart.drawings.update(id, { style: { color: picker.value } }));
```

`style` accepts `color`, `lineWidth`, `lineStyle` (`'solid' | 'dashed' | 'dotted'`), `fill`, and for text `textColor`, `fontSize`, `bold` and `italic`. The text tool draws its text with them; tools with their own labels (horizontal line, trend line with stats, Fibonacci levels, measure, position and range tools) draw their labels with them, at the theme font size unless `fontSize` is set. `showLabel: false` hides the labels of the tools that list it in the [catalogue](#tool-catalogue). Some tools read extra fields:

```ts
// Fib retracement: own levels (fractions of the move), optional per-level color, extend to the right edge.
chart.drawings.update(fib.id, {
  style: {
    levels: [{ value: 0 }, { value: 0.382 }, { value: 0.5 }, { value: 0.618, color: '#f59e0b' }, { value: 1 }, { value: 1.618 }],
    extendRight: true,
  },
});

// Fib retracement or extension: labels on the right of the drawing instead of the left.
chart.drawings.update(fib.id, { style: { labelSide: 'right' } });

// Any level tool: label each level in percent of the move (61.8% instead of 0.618).
chart.drawings.update(fib.id, { style: { labelContent: 'percent' } });

// Parallel channel: hide the dashed middle line.
chart.drawings.update(channel.id, { style: { middleLine: false } });
```

Fib level 0 sits at the second point (the end of the move) and 1 at the first, so 0.618 is the 61.8% retracement. Levels default to 0, 0.236, 0.382, 0.5, 0.618, 0.786 and 1 (the extension to 0, 0.618, 1, 1.618, 2.618, 3.618 and 4.236), and new Fibonacci drawings carry them in `style.levels`, ready to edit; hide one with `visible: false`.

The Fib retracement and extension draw each level's label left of the drawing's left end, so the labels stay clear of the price action after the move. `labelSide: 'right'` (**Label side** in the settings dialog) moves them past the right end instead, which keeps the bars before the move clear. Labels stay inside the pane: with `extendRight` they sit at its right edge, over the lines.

The other level tools take the same field. The Fib channel labels the left end of each line by default and the right end with `'right'`, each moved along its line to stay on screen. The Gann box and squares and the Fib speed resistance fan put their price labels beside the box's left or right edge; the Fib time zone and trend-based Fib time put each label left or right of its line. They label the right side when the field is unset, which is also what the settings dialog shows: where the time tools always had their labels and where a box drawn forward in time had its price labels. A box or speed fan drawn backwards in time used to label its left (far) edge; it now labels its right edge unless `labelSide` is `'left'`. The Gann fan's ratio labels mark where its rays leave the box, so they have no side.

`labelContent` (**Label content**) sets what the labels say, the same way on every level tool: `'level'` (0.618), `'price'` (the level's price), `'both'` (0.618 (1,234.50)) or `'percent'` (61.8%, the level as a share of the move). Each tool keeps the content it drew before the field existed, so saved drawings look the same: the Fib retracement and extension show `'both'`, the other level tools `'level'`. The channel, pitchforks, Gann box and squares and speed fan show the price where each label sits; labels that mark a time (the time tools, and the time levels along a box's price edge) or a radius (the arcs, circles and wedge) have no price and show the level for `'price'` and `'both'`. The Gann fan's labels name its rays' ratios, so it has no content choice.

`fibLevels(start, end, [0.382, 0.618])` from `@chart-on/core` computes the same prices without a chart.

### Level colours

Every built-in level tool (Fibonacci, Gann and pitchfork tools) colours its default levels with one shared rule, so a ratio has the same colour in every tool. The defaults carry `color: 'auto'`, and `levelColor(value, theme)` from `@chart-on/core` gives the colour:

- **Whole multiples** (0, 1, 2 …: the move's own ends and its repeats) are neutral, the theme's `text`.
- **Any other value** takes its fraction of a whole move and counts the golden steps from the move's end (log base φ of one over the fraction). One step is the golden section, 0.618: the key ratio of the Fibonacci tools, drawn in the theme's accent (`drawing`). Fewer steps (0.786, 0.75) sit between the accent and the neutral; more steps (0.5, 0.382 … down to an eighth) fade from the accent towards the canvas (`background`).
- **Each whole move past the first** fades the level a further 18% of its way towards the canvas, so 1.618 and 2.618, or the Gann fan's 2x1, 3x1 and 4x1 rays, stay apart.

The colours come from theme tokens, so they follow the theme, and neighbouring levels differ in lightness, not only in hue, which keeps them apart for colour-vision deficiencies too. In a theme without level colours (`levelNeutral` unset, as in [forced-colours mode](./theming)), `'auto'` levels use the drawing's colour. The Fibonacci time zones are bar counts, not ratios, so their lines keep the drawing's colour.

A level's `color` also takes a CSS colour or any theme colour name, such as the named level colours `levelGreen` or `levelBlue` (see [theming](./theming)); a level without one uses the drawing's `color`, which also draws the dashed guide. Saved drawings keep the levels and colours they were saved with. `resolveLevelColor(level, theme)` returns the colour a level draws in, for an editor's swatch.

## Tool defaults

Each tool has a default style that new drawings of it start with, whether the user draws them or `add()` creates them. Set it from code, for example with your brand colours:

```ts
chart.drawings.setToolDefaults('trendline', { color: '#3366cc', lineWidth: 2 });
chart.drawings.toolDefaults('trendline'); // { color: '#3366cc', lineWidth: 2 }, over the tool's own defaultStyle
chart.drawings.setToolDefaults('trendline', null); // back to the tool's own
```

A new drawing's style is the `add()` style over the tool defaults; whatever neither sets comes from the theme. `setToolDefaults` replaces that tool's defaults, leaves existing drawings as they are, and throws on an ill-typed field. It accepts tools that are not registered yet.

With `rememberStyle` on (the default), a style edit committed with `update()`, such as a colour picked in the floating toolbar, also becomes the default of that drawing's tool for the fields it changed, so the next drawing looks the same. `preview()` is not remembered, and undo does not revert remembered defaults. Turn it off when your app restyles drawings from code:

```ts
chart.drawings.rememberStyle = false;
```

With it off, users can still set a default explicitly: the [templates add-on](./ui-shell#save-as-default)'s **Save as default** menu item calls `setToolDefaults` with the style shown in the settings dialog.

`tool:defaults-change` fires with `{ tool, defaults }` whenever a tool's defaults change. Layouts save them (`toolDefaults`, see [layouts](./layouts)); to store them yourself, use `serializeToolDefaults()` and `loadToolDefaults(saved)`. Loading replaces every tool's defaults, drops ill-typed fields and returns them as `{ tool, field, reason }`, and throws, changing nothing, when the payload is not an object.

### Toolbar fields

`styleFields(id)` lists every style field a drawing's tool honours, from the tool's `styleFields`: a trend line has `color`, `lineWidth`, `lineStyle`, `extendLeft` and `extendRight`, a rectangle adds `fill`, the text tool has `textColor`, `fontSize`, `bold` and `italic`, and Fibonacci tools add `levels`. A tool without `styleFields` gets `color`, `lineWidth`, `lineStyle` and its `settings` keys.

`quickFields(id)` lists up to four of them a toolbar should show first: the first four plain-valued `styleFields`, in the tool's order. Levels are left to a full editor, and so are `extendLeft` and `extendRight`, which only make sense as a pair. For a tool without `styleFields`, they are the fields its style carries and its `settings` declare, colours first, topped up with `color`, `lineWidth` and `lineStyle`. A tool can name its own:

```ts
chart.drawings.registerToolQuickFields('my-zone', ['fill', 'color', 'showLabel']); // null to derive again
```

## Undo and redo

Creating, moving, editing text, changing style or lock, deleting and `clear()` are all undoable. A drag or a multi-click creation is a single step. Drawings share the chart's undo history, `chart.history`, with [indicators](./indicators#undo-and-redo): it keeps the last 100 steps of both, and undo takes them back in the order they were made. `load()` drops the drawings' steps. The steps come with the drawings and indicators plugins: on a chart without either, `chart.history` has nothing to undo, `undo()` and `redo()` return false and `history:change` never fires.

Changes to drawings with `history: false`, including adding and removing them and switching the flag, are no step. Undo and redo leave such drawings as they are.

```ts
chart.history.undo();      // false when there is nothing to undo
chart.history.redo();
chart.history.canUndo;     // also canRedo
// chart.drawings.undo(), redo(), canUndo and canRedo are the same history.
chart.on('history:change', ({ canUndo, canRedo }) => updateButtons(canUndo, canRedo));
```

Group several changes into one step with `batch()`, for example a bulk action on a selection. Nested batches join the outer one, and `drawings:change` and the granular events fire once, when it ends:

```ts
chart.drawings.batch(() => {
  for (const id of ids) chart.drawings.setVisible(id, false);
});
chart.history.undo(); // shows them all again
```

On a focused chart, Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. The default rail has Undo and Redo buttons.

## Save and restore

The chart never stores anything on its own. Save on `drawings:change`, load on startup, or let [`perSymbolDrawings`](./storage#drawings-per-symbol) keep them per symbol through a storage adapter. Drawings are also part of a saved [layout](./layouts), unless you save it with `drawings: false` to keep them separately as below.

```ts
const key = `drawings:${symbol}`;

chart.drawings.load(JSON.parse(localStorage.getItem(key) ?? 'null') ?? { version: 1, drawings: [] });

chart.on('drawings:change', () => {
  localStorage.setItem(key, JSON.stringify(chart.drawings.serialize()));
});
```

`load()` validates its input, so it is safe to feed it saved JSON. One bad record never costs the rest: malformed drawings (a missing id, a pane that is not a non-negative integer, a non-finite point, fewer points than the tool needs, a duplicate id) are skipped, and the result lists them by index. Optional fields of the wrong type (`locked: 'true'`, a non-finite `zIndex`), invalid `visibleOn` ranges and known `style` fields of the wrong type (a numeric colour, a negative or non-finite width, an unknown `lineStyle`, `levels` that are not an array, a level without a finite `value`) are dropped so the default applies; the drawing still loads, and each dropped field is listed too, with its `field`. Style keys the chart does not know, top-level or on a level, are kept for plugin tools. Every problem is also reported through `drawings:invalid`. Only a payload that is not `{ version, drawings: [] }` at all throws, and then nothing changes.

```ts
const { loaded, errors } = chart.drawings.load(saved);
for (const { index, field, reason } of errors) {
  console.warn(field ? `drawing ${index}: dropped ${field} (${reason})` : `drawing ${index} skipped: ${reason}`);
}
```

`add()` and `update()` apply the same rules but throw instead, so `update(id, { style: { lineWidth: -1 } })` changes nothing.

A drawing whose tool is not registered yet (a plugin loaded later) stays in the list: it is not drawn or hit-tested, round-trips through `serialize()` unchanged, and appears once `register()` adds its tool.

### Versions and migration

`serialize()` writes `version: DRAWINGS_VERSION` (currently `1`). When the format changes, `load()` upgrades older payloads step by step. For anything else, such as your app's own older storage format, set a migration hook. It gets the raw payload and its `version`, and returns a payload of the current version (or an older one the built-in steps continue from). It runs at most once per load; a version nothing upgrades throws. A payload already at the current version is read as it is and never reaches `migrate`, so the hook cannot rewrite current-format data; transform that before calling `load()`.

```ts
chart.drawings.migrate = (data, fromVersion) =>
  fromVersion === undefined ? { version: DRAWINGS_VERSION, drawings: data.list } : data;
```

## Events

- `tool:change` `{ tool, kept }` — active tool changed (`null` = cursor); `kept` is `drawings.toolKept`.
- `magnet:change` `{ mode }` — the magnet mode changed (`'off'`, `'weak'` or `'strong'`).
- `drawing:select` `{ id, ids }` — selection changed: `ids` in the order they were selected, `id` the last of them (`null` when nothing is).
- `drawing:bounds` — the selected drawing's on-screen box changed (`rect` in plot css px, `null` when out of view). Use it to position UI next to the selection.
- `drawings:change` — anything created, updated or removed. Persist on this. A drawing still being placed, or a new text drawing whose text is still being typed, is left out until it is finished.
- `drawing:create` `{ drawing }`, `drawing:update` `{ drawing, change, changes }` and `drawing:remove` `{ id }` — one drawing at a time, for syncing to a server. They fire for user edits, code, undo and redo, and when a pane removal drops drawings; `load()` fires none of them, only `drawings:change` (and `drawings:invalid` when it found problems), so after a load re-sync from its `drawings` payload rather than waiting for granular events. `changes` lists every kind of change (`'points'`, `'style'`, `'text'`, `'lock'`, `'visibility'`, `'order'`, `'pane'`, `'flags'`, `'name'`) and `change` is the first. Reordering reports `'order'` for each drawing whose position changed.
- `drawing:click` and `drawing:dblclick` `{ id }` — a press and release without dragging (a press the browser cancels is no click), or a double click, on a drawing (locked ones included).
- `drawings:invalid` `{ errors }` — the load-specific event: `load()` skipped malformed drawings or dropped ill-typed fields. Each error has the `index` in the payload, a `reason`, and the `field` when only that field was dropped.
- `drawings:visibility` `{ hidden }` — `setHidden()` hid or showed every drawing. Read the state from `drawings.hidden`.
- `access:change` `{ allow }` — `setAccess()` was called; `allow` is the rule now in force (`AccessRule | null`).
- `tool:refuse` `{ tool }` — `setTool()` refused a tool the access rule refuses.
- `history:change` — undo/redo availability changed.

See [Events](./events).
