---
description: "Write a drawing tool as a plain object, register it and activate it like a built-in one."
---

# Custom drawing tools

A drawing tool is a plain object. Register it, then activate it like a built-in tool. The chart needs drawings: create it with `drawings()` (only your tools) or `drawingTools()` (the built-in ones too) in its [`plugins`](./features#opt-in-features).

<!-- example: custom-drawing-tool -->

## Contract

| Field | Required | Notes |
| --- | --- | --- |
| `type` | yes | Unique id, stored in saved drawings |
| `label` | yes | Shown in UI, in English; a `tool.<type>` [message](./localization#drawing-tool-names) translates it |
| `points` | yes | Anchors to place: a count (`1` = single click), `'n'` (click until double-click or Enter) or `'free'` (press, drag, release) |
| `action` | no | `'erase'` or `'zoom'` makes a tool act like the built-in `eraser` or `zoom-box` instead of placing a drawing; `points`, `render` and `hitTest` then go unused |
| `group` | no | Rail group: one of the built-in `'lines'`, `'annotate'`, `'parallels'`, `'ratios'`, `'time'`, `'patterns'` and `'measure'` (see [the catalogue](./drawings#tool-catalogue)), or your own; tools of a group share a flyout |
| `anchoring` | no | `'data'` (default) pins anchors to time and price; `'screen'` pins them to the pane |
| `snap` | no | `'ohlc'` puts anchor prices on the bar's nearest open, high, low or close whatever the magnet; `'time'` snaps only the time to the bar and ignores the magnet. Default: time to the bar, and the price too while the magnet is on (main pane only) |
| `simplify` | no | For `'free'` tools: drop stroke points within this many css px when the stroke ends (`true` = 1 px) |
| `editableText` | no | Prompt for text after placing and on double-click. `true`: the text is required, and a new drawing left without it is removed. `'optional'`: the drawing stays without text, and an empty entry clears it |
| `styleFields` | no | The `DrawingStyle` fields (and your own style keys) `render` honours, most important first. Style editors such as the floating drawing toolbar offer only these; the first four plain-valued ones are the toolbar's quick fields. Without it, editors offer `color`, `lineWidth`, `lineStyle` and the `settings` keys |
| `fillAlpha` | no | Opacity of the tint of the drawing's color your tool fills with when the style has no `fill` (default 0.14), so the settings dialog's fill swatch shows what the tool draws |
| `defaultStyle` | no | `DrawingStyle` new drawings start with; `drawings.setToolDefaults()` and remembered edits go over it (see [tool defaults](./drawings#tool-defaults)) |
| `themeColor` | no | Theme color key `render` draws in while the style sets no `color` (default `'drawing'`), or a function of the drawing for a tool whose color depends on its points, so style editors show that color. Unlike a `defaultStyle` color it is not saved with the drawing and follows the theme |
| `settings` | no | Style fields for a settings UI: `{ key, label, type }` with `type` `color`, `number`, `boolean`, `text`, `select` or `levels`. The shell's [drawing settings](./ui-shell#drawing-settings) dialog shows them all; the floating toolbar shows `color` and `select` ones inline. They also feed `drawings.quickFields()`; `drawings.registerToolQuickFields(type, keys)` picks the toolbar fields instead |
| `constrain(points, anchor)` | no | Adjust points while anchor `anchor` is placed or dragged; return the full list |
| `handles(d, env)` | no | Extra draggable handles (pane-local px) that are not anchors |
| `moveHandle(drawing, index, to, at, env)` | no | The drawing after handle `index` is dragged: `to` is the pointer in time and price, snapped like an anchor, and `at` the pointer itself in pane-local px (project the drawing's points with `env` to compare). Return the new points, or `{ points, style }` with either left out to keep it, e.g. a size or angle the handle sets (the built-in `emojiTool` does). `drawing` is a copy. Needed for handles to be draggable |
| `bounds(d, env)` | no | Pane-local box `{ x, y, width, height }` of a drawing that reaches beyond its anchors (a circle around its centre); the selection bounds, and so the drawing toolbar, keep clear of it |
| `modelBounds(drawing)` | no | Time and price box `{ from, to, low, high }` the drawing covers, when its points do not describe it (it reaches the pane edge, or levels go past the anchors); infinite values leave a side open. See [drawings out of view](#drawings-out-of-view) |
| `axisMarks(drawing)` | no | `{ prices?, times? }` to label on the axes while the drawing is selected or being placed, with the range between the outermost ones highlighted; `null` labels nothing. Default: every anchor's price and time (a freehand stroke's extremes, nothing for `'screen'` tools) |
| `cursor(d, part, p, env)` | no | CSS cursor while the pointer is over `part` of the drawing: `{ kind: 'anchor', index }`, `{ kind: 'handle', index }` (anchors and handles only while selected) or `{ kind: 'body' }`; `p` is pane-local. Return nothing for the default: `'move'` on anchors and handles, `'pointer'` on the drawing. Not asked while locked or during a drag. The built-in horizontal and vertical lines return `'ns-resize'` and `'ew-resize'` |
| `render(ctx, d, env)` | yes | Draw on a 2D canvas already translated to the pane |
| `hitTest(d, p, env)` | yes | Return `true` when point `p` is on the drawing |

`d` is a `ScreenDrawing`:

- `d.points`: anchors projected to pane-local pixels.
- `d.drawing`: the stored drawing (`points` in time/price, `style`, `text`).
- `d.selected`, `d.hovered`: draw handles or highlights.

`env` gives:

| Member | Notes |
| --- | --- |
| `width`, `height`, `theme`, `pixelRatio` | Pane size in css px, colors, device pixel ratio |
| `priceToY(price)`, `yToPrice(y)` | Follow the pane's log or percent mode, so use them for derived prices |
| `timeToX(time)`, `xToTime(x)` | Interpolate between bars and extrapolate past the data |
| `barsBetween(a, b)` | Signed bar count between two drawing points |
| `bars(from, to)` | Main series bars in `[from, to]` |
| `formatPrice(price)`, `formatTime(time)`, `measureText(text, fontSize, style?)` | Labels; `formatTime` gives the time axis's crosshair label (optional, so check it on hosts made by hand); pass the drawing's style to measure bold or italic text as it is drawn |
| `localization` | The chart's [language](./localization): `env.localization?.text(key, params, fallback)` for readout text, `number` and `percent` for figures; missing on hand-made hosts, so fall back to English |

Selection handles, dragging, magnet snapping, locking and serialization are handled for you.

### Placement modes

- **Fixed count**: each click places the next anchor; press-drag-release also works.
- **`'n'`**: each click adds an anchor and a preview follows the pointer. Double-click or Enter finishes; fewer than two anchors cancels. A double click adds one anchor, where its first press landed.
- **`'free'`**: the stroke is recorded while the button is held, at exact (not bar-snapped) times. Freehand drawings move as a whole and show no anchor handles. With `simplify` set, points that change the line by less than the tolerance are dropped when the stroke ends, so strokes save compactly. The tolerance is measured at the zoom level where the stroke ended: zooming in afterwards magnifies the difference, zooming out shrinks it. `simplifyPolyline(points, tolerance)` is exported if you need the same simplification elsewhere.
- **`anchoring: 'screen'`**: `time` and `price` of each point hold x and y as fractions (0 to 1) of the pane, so the drawing stays put while the chart scrolls and zooms. Placing, dragging and moving keep it on the pane.

### Keeping shapes valid

```ts
const horizontalSegment: DrawingToolDef = {
  type: 'horizontal-segment',
  label: 'Horizontal segment',
  points: 2,
  // Whichever anchor moves, both keep its price.
  constrain: (points, anchor) => points.map((p) => ({ ...p, price: points[anchor]!.price })),
  render: (ctx, d, env) => strokeLine(ctx, d, env, d.points[0]!, d.points[1]!),
  hitTest: (d, p) => distToSegment(p, d.points[0]!, d.points[1]!) < 6,
};
```

## Drawings out of view

To stay fast with hundreds of drawings, the chart neither renders nor hit-tests a drawing whose box lies well outside the pane (more than 160 css px, which leaves room for line widths and labels). The selected and hovered drawings, the one being edited and `'screen'`-anchored tools always draw.

The box is the time and price extent of the drawing's points, open on the sides `extendLeft` and `extendRight` extend. A tool that reaches further declares `modelBounds`: a horizontal line is open in time, a level tool whose levels can pass its anchors is open in price, and a tool whose extent only makes sense in pixels can return all sides open. A tool with `bounds` and no `modelBounds` is checked by its projected anchors and `bounds`.

```ts
const horizontalZone: DrawingToolDef = {
  // ...
  // A band between two prices across the whole time axis.
  modelBounds: ({ points: [a, b] }) => ({
    from: -Infinity,
    to: Infinity,
    low: Math.min(a!.price, b!.price),
    high: Math.max(a!.price, b!.price),
  }),
};
```

## Style fields

Beyond `color`, `lineWidth`, `lineStyle`, `fill` and `fontSize`, `DrawingStyle` has `extendLeft`, `extendRight`, `showLabel`, `showStats`, `showFill`, `bold`, `italic`, `textColor` and `levels` (for level-based tools). Tools decide which ones they honour, and list them in `styleFields` so editors offer only those. `fillOf(style, tint)` returns the color to fill a background with: the style's `fill`, else your `tint`, and `'transparent'` when `showFill` is false.

Draw text with `drawingFont(size, env.theme.fontFamily, style)` and measure it with `env.measureText(text, size, style)`: both read `bold` and `italic` the same way, so hit boxes match the text.

```ts
import { drawingFont, pointInRect, type DrawingToolDef } from '@chart-on/core';

const note: DrawingToolDef = {
  type: 'note',
  label: 'Note',
  points: 1,
  editableText: true,
  styleFields: ['textColor', 'fontSize', 'bold', 'italic'],
  render(ctx, d, env) {
    const s = d.drawing.style;
    ctx.font = drawingFont(s.fontSize ?? 14, env.theme.fontFamily, s);
    ctx.fillStyle = s.textColor ?? env.theme.drawing;
    ctx.textBaseline = 'top';
    ctx.fillText(d.drawing.text ?? '', d.points[0]!.x, d.points[0]!.y);
  },
  hitTest(d, p, env) {
    const s = d.drawing.style;
    const size = s.fontSize ?? 14;
    const a = d.points[0]!;
    return pointInRect(p, a, { x: a.x + env.measureText(d.drawing.text ?? '', size, s), y: a.y + size });
  },
};
```

## Helpers

`@chart-on/core` exports geometry helpers for hit testing: `distToSegment`, `rayEnd`, `pointInRect`, `normalizedRect`.

```ts
import { distToSegment } from '@chart-on/core';

hitTest(d, p) {
  const [a, b] = d.points;
  return !!a && !!b && distToSegment(p, a, b) < 6;
}
```

And render helpers that apply the drawing's style:

| Helper | Draws |
| --- | --- |
| `strokeLine(ctx, d, env, a, b)` | A line in the drawing's style, extended to the pane edges when `extendLeft` / `extendRight` are set |
| `labelPill(ctx, env, text, x, y, options)` | A rounded label; `align` is `'left'`, `'center'` or `'right'`; `textStyle` (usually the drawing's style) sets its size, bold, italic and text color. The text defaults to black or white, whichever contrasts more with the fill (`contrastText`). Returns its width |
| `labelledPolyline(ctx, d, env, labels)` | A polyline through the anchors with labels above peaks and below troughs (patterns, waves) |
| `levelLines(ctx, env, levels, left, right, textStyle?)` | Horizontal levels with non-overlapping labels (Fibonacci-style tools) |
| `fillBetween(ctx, upper, lower, color)` | The area between two polylines |

## Add it to the rail

Give the tool a `group` and `toolRailItems` / `defaultRailItems` put it in that group's flyout:

```ts
import { builtinTools } from '@chart-on/core';
import { defaultRailItems } from '@chart-on/ui';

createChartShell(el, { rail: defaultRailItems([...builtinTools, priceBand]) });
```

Or place it yourself:

```ts
import { drawingIcons } from '@chart-on/ui';

createChartShell(el, {
  rail: [{ type: 'cursor' }, { type: 'tool', tool: 'price-band', icon: drawingIcons['price-range'] }],
});
```

Without an `icon`, a tool with a `group` shows that group's icon, so a fib tool looks like the other fib tools.
