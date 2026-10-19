---
description: "Colour the chart canvas and set its fonts with a theme object, or from CSS variables shared with the UI shell."
---

# Theming

Chart canvas colors come from a `ChartTheme` object. With the UI shell, that object is read from CSS variables, so one stylesheet colors both the chrome and the canvas.

To try colors without writing code, use the [theme builder](../theme-builder): it edits every token below in a dark and a light shell, checks text contrast, and exports a theme object and a CSS block.

## Built-in themes

| Export | Look |
| --- | --- |
| `darkTheme` | Default dark |
| `lightTheme` | Light |
| `neutralTheme` | Neutral graphite |
| `highContrastDarkTheme` | Black canvas, white text, stronger lines (see [Accessibility presets](#accessibility-presets)) |
| `highContrastLightTheme` | White canvas, black text, stronger lines |

```ts
import { createChart, lightTheme } from '@chart-on/core';

const chart = createChart(el, { theme: lightTheme });
```

With the UI shell, use `theme: 'light'` or `shell.setTheme('light')` (see [Light, dark and system](#light-dark-and-system)).

## Default palette

The dark and light themes share one palette: neutral greys with a faint violet tint, a violet accent, and mint and coral for rising and falling bars.

| Role | Dark | Light |
| --- | --- | --- |
| Canvas | `#121217` | `#ffffff` |
| Text | `#babac6` | `#15151b` |
| Muted text | `#8b8b99` | `#696977` |
| Accent, line series, drawings | `#8b75ff` | `#5f43e6` |
| Up | `#3cc4a0` | `#0f8268` |
| Down | `#e8574a` | `#c9412f` |

Text, muted text, the accent and the up and down colors all reach at least 4.5:1 contrast on the canvas (WCAG AA). Up and down also differ in lightness and in their blue component, so they stay apart for red-green color blindness. The light theme uses darker up and down shades to keep that contrast on white.

### Heatmap ramp

The heatmap color ramp (`heatmap`, `--pc-heatmap`) runs from low to high intensity:

| Theme | Low → high |
| --- | --- |
| Dark | `#211e36`, `#493088`, `#6656d7`, `#2ea4dc`, `#48dcc1`, `#fced95` |
| Light | `#f3f2fe`, `#abe6e9`, `#51cbbd`, `#2c90d7`, `#5f3ed8`, `#541b81` |

The lowest stop is a faint violet tint of the canvas, so sparse cells fade into the background instead of showing as a colored block. From there each stop moves further from the canvas in lightness: brighter on the dark theme, darker on the light one. Intensity therefore still reads in greyscale and with color blindness. The hues pass through the accent and the mint of the up color, and avoid the coral of the down color, so the ramp doesn't read as falling prices. `neutralTheme` keeps its original ramp.

If you supply your own ramp, follow the same rules: start close to your canvas color and change lightness in one direction.

## Chart colors

Pass any subset of `ChartTheme`. Missing keys fall back to `darkTheme`; `applyOptions({ theme })` changes only the keys it is given.

<!-- example: custom-theme -->

| Key | CSS token | Used for |
| --- | --- | --- |
| `background` | `--pc-chart-bg` | Chart background |
| `backgroundBottom` | `--pc-chart-bg-bottom` | Bottom of a vertical background gradient from `background`; optional, solid background when unset. Screenshots include it |
| `grid` | `--pc-chart-grid` | Grid lines |
| `gridHorizontal`, `gridVertical` | `--pc-chart-grid-h`, `--pc-chart-grid-v` | Per-direction grid colors; optional, default to `grid` |
| `separator` | `--pc-chart-separator` | Pane separators |
| `text` | `--pc-chart-text` | Axis labels, legend |
| `textMuted` | `--pc-chart-text-muted` | Secondary axis and legend text |
| `fontFamily` | `--pc-chart-font` | Font of all chart text, unless [`typography`](#typography) overrides it |
| `fontSize` | `--pc-chart-font-size` | Size of chart text in px, unless `typography` overrides it |
| `typography` | `--pc-chart-font-weight`, `--pc-chart-numerals` | Weight, numerals and per-surface fonts; see [Typography](#typography) |
| `crosshair` | `--pc-chart-crosshair` | Crosshair lines |
| `labelBackground` | `--pc-chart-label-bg` | Crosshair and last-value labels |
| `labelText` | `--pc-chart-label-text` | Text on those labels |
| `up`, `down` | `--pc-up`, `--pc-down` | Candle colors |
| `upWick`, `downWick` | `--pc-up-wick`, `--pc-down-wick` | Candle wicks; optional, default to `up` / `down` |
| `upBorder`, `downBorder` | `--pc-up-border`, `--pc-down-border` | Candle body outlines; optional, none when unset |
| `line` | `--pc-line-series` | Default line and histogram color |
| `drawing` | `--pc-drawing` | Drawing tools |
| `drawingSelected` | `--pc-drawing-selected` | Default color of text drawings |
| `drawingFill` | `--pc-drawing-fill` | Drawing fills |
| `referenceLine` | `--pc-chart-reference-line` | Previous close, visible high, low and average [reference lines](./reference-lines) |
| `bid`, `ask` | `--pc-bid`, `--pc-ask` | Bid and ask lines |
| `depthBid`, `depthAsk` | `--pc-depth-bid`, `--pc-depth-ask` | [Depth lane](./depth-lane) bars; optional, default to `bid` and `ask` |
| `extendedHours` | `--pc-extended-hours` | Pre and post session price label |
| `alert` | `--pc-alert` | [Alert lines](./annotations#alert-lines) |
| `timeMark` | `--pc-time-mark` | Badges of the data source's [time-axis markers](./data-sources#markers); optional, defaults to `line` |
| `annotationFill` | `--pc-annotation-fill` | Default fill of [time bands and price zones](./annotations#time-bands-and-price-zones); keep it translucent |
| `heatmap` | `--pc-heatmap` | Heatmap color ramp, low to high, as a comma-separated list |
| `watermark` | `--pc-chart-watermark` | [Watermark](./watermark) text; keep it faint with a low alpha |
| `levelNeutral`, `levelRed`, `levelOrange`, `levelGreen`, `levelBlue`, `levelPurple` | `--pc-level-neutral`, `--pc-level-red`, `--pc-level-orange`, `--pc-level-green`, `--pc-level-blue`, `--pc-level-purple` | Named [level](./drawings#level-colours) colors a level can pick (`{ value: 0.5, color: 'levelBlue' }`), kept so saved levels that name one keep their color. The default levels use the shared level rule instead. Optional: a level falls back to the drawing color when its token is unset, and without `levelNeutral` the rule's levels do too |

Colors accept hex (`#rgb`, `#rrggbb`, `#rrggbbaa`), `rgb()`/`rgba()` and named CSS colors. The same formats work in the CSS tokens. `chartThemeTokens` maps each key to its token in code.

Opacity is honored everywhere a color is used: candle bodies, wicks and borders, lines, areas and histograms on the GPU layer, and grid, crosshair, labels and drawings on the canvas layers. A translucent `background` lets the page show through the chart.

A candle series' own color options (`upColor`, `upWickColor`, `upBorderColor` and the `down` ones) win over the theme for that series.

## Typography

`fontFamily` and `fontSize` set one font for all chart text. For a branded embed, the optional `typography` key adds a weight and a numeral style, and lets each text surface use its own font:

```ts
chart.applyOptions({
  theme: {
    typography: {
      fontFamily: '"Brand Sans", system-ui, sans-serif',
      fontWeight: 450,
      numerals: 'tabular',
      axis: { fontFamily: '"Brand Mono", ui-monospace, monospace' },
      legend: { fontSize: 14, fontWeight: 500 },
      watermark: { fontWeight: 800 },
    },
  },
});
```

The baseline (`fontFamily`, `fontSize`, `fontWeight`, `numerals`) applies to every surface. Each surface block takes the same four fields, and a field it leaves out falls through to the baseline. A baseline field left out falls through to the theme's `fontFamily` and `fontSize`, a regular weight (`400`) and tabular numerals.

| Surface | Text |
| --- | --- |
| `axis` | Price and time axis ticks, and the price, crosshair and countdown labels on the axes |
| `legend` | Legend rows and the heatmap inspector |
| `labels` | Labels inside the plot: price lines, alerts, orders, trade badges, tooltips and indicator messages |
| `drawings` | Drawing labels, and the default font of text drawings |
| `watermark` | [Watermark](./watermark) family and weight; sizes come from the watermark options |
| `markers` | Text of bar markers (`chart.annotations.setMarkers`) |

Some surfaces differ from the baseline by default, to keep the look they always had. The legend is 1 px larger than the baseline size unless its block sets `fontSize`, and the watermark is weight `600` unless its block sets `fontWeight`. Drawing styles (`fontSize`, `bold`, `italic`) still win over the theme for a single drawing.

Typography merges per surface: `applyOptions({ theme: { typography: { axis: { fontSize: 13 } } } })` keeps the other blocks. `resolveFont(theme, surface)` returns the font a surface draws with, and `fontCss(font)` turns it into a CSS `font` string, which is useful for custom series and drawing tools.

### Numerals

`numerals: 'tabular'` (the default) gives every digit the same width, so a live price does not shift sideways as it ticks. `'proportional'` uses the font's natural digit widths. The DOM legend uses `font-variant-numeric`. Canvas text has no such setting, so on the axes and in the canvas legend (screenshots) the chart places each digit in a fixed-width cell when the font's digits differ in width. Fonts whose digits are already tabular draw exactly as before. Other canvas surfaces use the font's own digits.

### Loading fonts

The chart does not load fonts. Canvas text does not start a web font download, and text drawn before the font arrives uses a fallback. Load the font first, then apply it:

```ts
await Promise.all([document.fonts.load('12px "Brand Sans"'), document.fonts.load('500 14px "Brand Sans"')]);
chart.applyOptions({ theme: { typography: { fontFamily: '"Brand Sans", system-ui, sans-serif' } } });
```

Load each weight you use. To swap a font that finishes loading later, listen for `document.fonts.onloadingdone` and call `chart.invalidate()`.

### Typography tokens

`--pc-chart-font` and `--pc-chart-font-size` set the baseline family and size. `--pc-chart-font-weight` (a number, `normal` or `bold`) and `--pc-chart-numerals` (`tabular` or `proportional`) set the baseline weight and numerals; `chartTypographyTokens` names them in code. Surface blocks have no tokens; set them in JS. In the [UI shell](#ui-shell), a `typography` block in `chart.theme` refines the one read from the tokens instead of replacing it.

## Grid

```ts
chart.applyOptions({ grid: { vertical: { visible: false }, horizontal: { lineStyle: 'dotted', color: 'rgba(128, 128, 140, 0.25)' } } });
```

Each direction, `horizontal` (price lines) and `vertical` (time lines), takes:

| Field | Default | Notes |
| --- | --- | --- |
| `visible` | `true` | Draw this direction's lines |
| `color` | theme | The theme's `gridHorizontal` / `gridVertical` (tokens `--pc-chart-grid-h` / `--pc-chart-grid-v`), else `grid` |
| `lineStyle` | `'solid'` | `'solid'`, `'dashed'` or `'dotted'` |

`createChart` and `applyOptions` accept a partial grid at any depth and merge it into the current one; `color: undefined` goes back to the theme color. Screenshots include the grid as shown.

## Reading and persisting colors

`chart.appearance()` returns the resolved colors: `{ theme, grid }`, with each grid direction's color filled in. The `appearance:change` event fires with the same object whenever `applyOptions` changes the theme or the grid, so an app can show the current values and save them.

```ts
chart.on('appearance:change', ({ theme, grid }) => save({ up: theme.up, grid }));
```

## Chart colors from CSS

`themeFromCss(el)` builds a `ChartTheme` from the tokens on an element. It reads them through computed style, so inherited values and `var()` references work.

```ts
import { createChart, themeFromCss } from '@chart-on/core';

const chart = createChart(el, { theme: themeFromCss(el) });
// After changing the variables:
chart.applyOptions({ theme: themeFromCss(el) });
```

```css
#my-chart {
  --pc-chart-bg: #0f172a;
  --pc-up: #22c55e;
  --pc-down: #ef4444;
  --pc-heatmap: #1e1b4b, #6d28d9, #22d3ee, #facc15;
}
```

A token that is missing, or not a color the renderer can use, keeps the value from the fallback theme. The fallback is the second argument and defaults to `darkTheme`: `themeFromCss(el, lightTheme)`. The first argument can also be any object with `getPropertyValue`, such as a `CSSStyleDeclaration`.

The UI shell does this for you (see below).

## UI shell

Every UI color, radius, spacing and font is a `--pc-*` CSS variable on `.pc-shell`, next to the chart tokens above. Override them on the shell element, for example through a class:

```css
.my-theme.pc-shell {
  --pc-accent: #0ea5e9;  /* --pc-focus, --pc-line-series and --pc-drawing follow */
  --pc-accent-soft: rgba(14, 165, 233, 0.16);
  --pc-up: #22c55e;     /* the canvas follows too */
  --pc-down: #ef4444;
}
```

```ts
createChartShell(el, { className: 'my-theme' });
```

The shell reads the chart tokens with `themeFromCss` when it is created, and once more on the next animation frame, so a shell created before its container is attached still picks them up. It reads them again when the shell element's `class`, `data-theme` or inline `style` changes, and when the OS scheme changes in `system` mode. So `shell.el.style.setProperty('--pc-up', '#22c55e')` recolors the canvas straight away. For changes the shell cannot see, such as a new stylesheet or a class on an ancestor, call `shell.refreshTheme()`.

A `theme` in the chart options wins over the CSS, and the user's appearance overrides (below) win over both: user > JS > CSS > built-in theme.

```ts
createChartShell(el, { chart: { theme: { up: '#22c55e' } } }); // --pc-up is ignored
```

## Appearance panel

The shell lets users change chart colors, each with its own opacity, in an Appearance panel: Candles (body, wick and border for rising and falling bars), Background, Grid (each direction's visibility, line style and color), Scales and text, Crosshair and Watermark. Changes preview live; each section has a Reset, and Reset all drops every override. Open it from a toolbar button or from code:

```ts
import { appearanceToolbarItem, createChartShell } from '@chart-on/ui';

const shell = createChartShell(el, { toolbar: [/* ... */ appearanceToolbarItem()] });
shell.appearance?.open();
```

The choices are overrides on top of the theme, so switching between dark, light and system keeps them and updates every other color. They are saved to `localStorage` (`charton:appearance`) and restored on the next visit. With several charts on one page, give each its own `storageKey`, or they share one set of choices and overwrite each other. Pass your own storage, or `null` to keep them for the current visit only; `appearance: false` turns the feature off:

```ts
createChartShell(left, { appearance: { storageKey: 'my-app:appearance:left' } });
createChartShell(el, {
  appearance: { storage: { load: () => loadFromServer(), save: (patch) => saveToServer(patch) } },
});
```

Saved choices are checked when they are loaded, from any storage: unknown keys and values that are not usable colors are dropped.

`shell.appearance` also sets overrides from code: `set({ theme: { up: '#22c55e' }, grid: { vertical: { visible: false } } })` merges them (an `undefined` value removes one), `reset('candles')` or `reset()` drops them, and `overrides` reads them. Colors changed through `chart.applyOptions` show up in an open panel straight away, and a later change in the panel only touches the keys it overrides, so it does not undo them.

The swatch-and-opacity picker is `createColorControl({ label, value, onInput, onCommit })`, for use in your own settings UI: `onInput` fires on every change for a live preview, `onCommit` once when the picker closes after a change. Without `swatches`, it offers `defaultSwatches`: a neutral row, then rows of ten hues from light to dark, one hue per column. The grid is one Tab stop; the arrow keys move by swatch and by row, Home and End jump to the ends. Outside the shell, `createAppearance(chart, { baseTheme, storage, storageKey, presets, onOpenChange })` adds overrides, presets and the panel to any chart; `onOpenChange(open)` reports when the panel opens or closes, e.g. to update a toolbar button. `isColor(value)` from `@chart-on/core` checks a color before you store or apply it.

| Variable | Role |
| --- | --- |
| `--pc-shell` | Outer frame behind the panels |
| `--pc-canvas`, `--pc-panel` | Chart card, toolbar, rail and bottom bar panels |
| `--pc-surface`, `--pc-popover` | Controls, menus, flyouts |
| `--pc-hover`, `--pc-active` | Hover and selected backgrounds |
| `--pc-line`, `--pc-line-strong` | Borders |
| `--pc-ink` | Primary text |
| `--pc-muted-strong`, `--pc-muted`, `--pc-faint` | Secondary text |
| `--pc-accent`, `--pc-accent-ink`, `--pc-accent-soft` | Active tool, selected options |
| `--pc-focus` | Focus outline |
| `--pc-shadow` | Menu and flyout shadow |
| `--pc-tip-bg`, `--pc-tip-ink`, `--pc-tip-shadow` | Tooltips |
| `--pc-font`, `--pc-font-mono` | Fonts; default to the platform UI font (`system-ui`) and monospace font (`ui-monospace`) |
| `--pc-font-size-xs`, `--pc-font-size-sm`, `--pc-font-size`, `--pc-font-size-lg`, `--pc-font-size-xl` | Font sizes: 11, 12, 13, 14 and 15px |
| `--pc-radius-xs`, `--pc-radius-sm`, `--pc-radius-md`, `--pc-radius-lg` | Corner radii |
| `--pc-space-1` … `--pc-space-6` | Spacing scale: 2, 4, 6, 8, 12 and 16px |
| `--pc-rail-button` | Rail button size |
| `--pc-gap` | Spacing between panels |
| `--pc-panel-radius` | Corner radius of floating parts and the chart (see [Panel styles](./ui-shell#panel-styles)); default `--pc-radius-lg` |
| `--pc-panel-inset` | Space between floating parts and the shell's edges; default 4px |
| `--pc-ease` | Easing for transitions |

Defaults for both schemes are in `packages/ui/src/style.css`. `--pc-chart-bg` defaults to `var(--pc-canvas)`, so the card and the chart stay the same color.

### Colour presets

The top of the Appearance panel has a Presets section: one click restyles the chart and the shell chrome together. Each preset has a light and a dark variant, each a background and a primary colour; everything else is derived from those two. The built-in ten:

| Preset | Light background | Light primary | Dark background | Dark primary |
| --- | --- | --- | --- | --- |
| Paper & Ink | `#F5F1E8` | `#242424` | `#242424` | `#F5F1E8` |
| Matcha Cream | `#F7F3E8` | `#526B47` | `#161B14` | `#A9C79A` |
| Lavender Mist | `#EDE8FF` | `#403578` | `#1A1726` | `#C9BBFF` |
| Butter Cobalt | `#FFF2C6` | `#2849C7` | `#10162E` | `#FFE38A` |
| Peach Espresso | `#FFE5D5` | `#382923` | `#231915` | `#FFC7A6` |
| Terminal Lime | `#F3F7EA` | `#3F6B12` | `#151A16` | `#CBF567` |
| Midnight Violet | `#F1EEFB` | `#5A3FC0` | `#171426` | `#B6A2FF` |
| Obsidian Gold | `#F6F3EC` | `#8A6416` | `#181818` | `#E8BD69` |
| Deep Ocean | `#EAF4F7` | `#0B6E86` | `#101F2B` | `#62D6E8` |
| Carbon Coral | `#F6F2F3` | `#C2463A` | `#1E1B20` | `#FF8D82` |

Paper & Ink is the default until the user picks something else. The variant follows the shell's resolved theme: switching light and dark, or the OS switching under `system`, keeps the preset and shows its other variant. The Light and Dark buttons under the swatches switch the shell theme, so a user can try both. Surfaces, borders, grid, text, crosshair, labels, watermark and the heatmap ramp are mixed from the background, so text keeps at least 7:1 and muted text 5:1 contrast; line series, drawings and the accent come from the primary. Up and down keep the current palette, so the colour-safe pair stays on. The Default entry goes back to the built-in theme. While the shell has the `pc-theme-high-contrast` class, the preset stands aside so the high-contrast colours show; it comes back when the class goes. Colours the user changes afterwards layer over the preset as usual, and a section's Reset restores the preset's value. The chosen preset, Default included, is saved with the other appearance choices; an id that is no longer offered falls back to the default theme.

`appearance.presets` replaces the list or turns it off, and `appearance.defaultPreset` picks the starting preset (null for the plain theme). Mix the exported built-ins with your own; a variant's `overrides` fixes chart colours and `tokens` shell variables the derivation gets wrong:

```ts
import { builtInColorPresets, type ColorPreset } from '@chart-on/core';

const brand: ColorPreset = {
  id: 'brand',
  label: 'Brand',
  light: { background: '#fbf7ef', primary: '#a25d00' },
  dark: {
    background: '#0f1720',
    primary: '#f5a524',
    overrides: { crosshair: '#f5a524' },
    tokens: { '--pc-shell': '#0a0f15' },
  },
};
createChartShell(el, { appearance: { presets: [brand, ...builtInColorPresets], defaultPreset: 'brand' } });
createChartShell(other, { appearance: { presets: false } }); // no section, saved preset ignored
```

From code, `shell.setColorPreset('deep-ocean')` applies one and `setColorPreset(null)` goes back to the default theme; `shell.colorPreset` is the current id, and the shell emits `preset:change` with it. Without the shell, `presetTheme(preset, mode)` from `@chart-on/core` gives the full chart theme of one variant (pass a third argument to start from your own base theme, such as one with `colorSafeUpDown`), and `presetShellTokens(preset, mode)` from `@chart-on/ui` the matching `--pc-*` variables:

```ts
import { builtInColorPresets, presetTheme } from '@chart-on/core';

chart.applyOptions({ theme: presetTheme(builtInColorPresets[0], 'dark') });
```

### Scrollbars

Every scrolling area in the shell (menus, dialogs, lists, panels) draws its scrollbar from these tokens. The thumb colours default to the border and text colours above, so they follow the dark, light and high-contrast themes on their own.

| Variable | Default | Role |
| --- | --- | --- |
| `--pc-scrollbar-size` | `10px` | Track thickness |
| `--pc-scrollbar-radius` | `var(--pc-scrollbar-size)` | Thumb corner radius (fully rounded) |
| `--pc-scrollbar-track` | `transparent` | Track color |
| `--pc-scrollbar-thumb` | `var(--pc-line-strong)` | Thumb at rest; `var(--pc-muted)` in high contrast |
| `--pc-scrollbar-thumb-hover` | `var(--pc-faint)` | Thumb under the pointer; `var(--pc-ink)` in high contrast |
| `--pc-scrollbar-thumb-active` | `var(--pc-muted)` | Thumb while dragged; `var(--pc-ink)` in high contrast |

```css
.my-theme.pc-shell {
  --pc-scrollbar-size: 6px;
  --pc-scrollbar-thumb: rgba(14, 165, 233, 0.4);
}
```

Browsers that style scrollbars through pseudo-elements use all six tokens; the thumb sits 2px inside the track. Browsers with only the standard `scrollbar-width` and `scrollbar-color` properties draw their own thin scrollbar in the track and thumb colours, and use the hover colour while the pointer is over the scrolling area. Lists whose content changes while open (search results, the object tree, dialog bodies, the table view) reserve the scrollbar's space, so their width does not jump when a scrollbar appears.

To keep the platform's own scrollbars, add the `pc-native-scrollbars` class to the shell (`createChartShell(el, { className: 'pc-native-scrollbars' })`). In forced-colours mode the shell always uses the platform's scrollbars.

## Accessibility presets

Two presets for users who need more than the default palette.

**High contrast.** `highContrastDarkTheme` and `highContrastLightTheme` are complete themes: text and muted text reach at least 7:1 on the canvas (WCAG AAA), price labels at least 4.5:1, and every series, line and grid separator at least 3:1. Their heatmap ramps keep the same lightness ordering as the default ones, with bigger steps.

To check your own colors, `contrastRatio(foreground, background)` from `@chart-on/core` returns the WCAG ratio (1 to 21), blending a translucent foreground over the background first. Normal-size text needs 4.5 for AA, 7 for AAA. The [theme builder](../theme-builder) shows these ratios as you edit.

**Colour-safe up and down.** `colorSafeUpDown.dark` and `colorSafeUpDown.light` replace the rising and falling colours (and the ask line, which follows the down colour) with a blue and orange pair that also differs in lightness. It stays clearly apart for protanopia, deuteranopia and tritanopia, where the default mint and coral get closer. Merge the one matching your canvas into any theme, including the high-contrast ones:

```ts
import { colorSafeUpDown, highContrastDarkTheme } from '@chart-on/core';

chart.applyOptions({ theme: colorSafeUpDown.dark });
chart.applyOptions({ theme: { ...highContrastDarkTheme, ...colorSafeUpDown.dark } });
```

| Pair | Up | Down |
| --- | --- | --- |
| `colorSafeUpDown.dark` | `#4ba3ff` | `#ff9a1f` |
| `colorSafeUpDown.light` | `#1a62c9` | `#c25a00` |

Colour is not the only cue: the `hollow` candle style (see [chart types](./series#chart-types)) draws rising candles as outlines and falling ones filled, which reads with any palette and in greyscale.

With the UI shell, the same presets are token sets in the stylesheet:

```ts
const shell = createChartShell(el, { className: 'pc-theme-high-contrast', palette: 'color-safe' });
shell.palette; // 'color-safe'
shell.on('palette:change', ({ palette }) => savePreference(palette));
shell.setPalette('default');
```

- The `pc-theme-high-contrast` class switches the chrome and the chart to high contrast. It follows `data-theme` (and the OS setting in `system` mode) for dark or light. Add or remove the class at any time; the shell notices and recolours the chart.
- `palette: 'color-safe'` (or `setPalette`) sets `data-pc-palette="color-safe"` on the shell, which swaps the up, down and ask tokens for the pair matching the current scheme, over any theme. `palette:change` fires when `setPalette` changes it.

The demo has both switches under View → Accessibility.

**Forced colours.** When the operating system's high-contrast mode is on (`forced-colors: active`), browsers recolour the page with a small system palette, but not canvas content. `forcedColorsTheme(base, container?)` builds a theme from those system colours, resolved to values the chart can draw: `Canvas` background, `CanvasText` text, scales and falling bars, `LinkText` rising bars and lines, `Highlight` labels and selection, and the grid, watermark and heatmap as `CanvasText` at lower opacity. Rising and falling bars take the one pair every high-contrast palette keeps apart; add `hollowDown: true` to the candles so direction also reads from shape. It returns null when the colours cannot be read (no DOM).

The UI shell applies it on its own while the mode is on, over the app's theme and the user's colour overrides, and switches back when it turns off (`theme:change` fires both ways). Its stylesheet turns focus rings and panel edges, drawn with shadows elsewhere, into outlines, and marks pressed and selected controls with `Highlight`. Without the shell, follow the media query yourself:

```ts
import { darkTheme, forcedColorsTheme } from '@chart-on/core';

const forced = matchMedia('(forced-colors: active)');
const applyForced = () => chart.applyOptions({ theme: (forced.matches && forcedColorsTheme(darkTheme)) || darkTheme });
forced.addEventListener('change', applyForced);
applyForced();
```

To check it, emulate `forced-colors: active` in the browser's developer tools (rendering settings).

## Light, dark and system

The shell selects the scheme with a `data-theme` attribute on `.pc-shell`:

| `theme` option / `setTheme` | Attribute | Result |
| --- | --- | --- |
| `'dark'` | `data-theme="dark"` | Dark tokens |
| `'light'` | `data-theme="light"` | Light tokens |
| `'system'` (default) | none | Light or dark from `prefers-color-scheme`, live |

```ts
const shell = createChartShell(el, { theme: 'system' });
shell.theme;          // 'system'
shell.resolvedTheme;  // 'light' or 'dark', what is on screen
shell.on('theme:change', ({ theme, resolved }) => savePreference(theme));
shell.setTheme('dark');
```

`theme:change` fires when `setTheme` changes the theme, when the OS scheme changes while the theme is `system`, and when re-reading the CSS tokens (see above) changes the chart colors. Use it to rebuild anything derived from the theme, such as per-point colors.

To restyle one scheme, override its tokens in a stylesheet loaded after `@chart-on/ui/style.css`. Cover `system` mode too, which has no attribute:

```css
.pc-shell[data-theme='light'] {
  --pc-canvas: #fafafa;
}
@media (prefers-color-scheme: light) {
  .pc-shell:not([data-theme]) {
    --pc-canvas: #fafafa;
  }
}
```

The older `.pc-light` class still selects the light tokens, but the shell no longer adds it. Use `data-theme` in new code.
