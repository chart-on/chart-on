# Customization: toolbars, feature flags, events, vanilla CSS

## Today

- `createChartShell(el, { chart, toolbar, rail, className })`.
- Top toolbar: `ToolbarItem[]` of `segmented | button | menu | separator | spacer | custom`. Handle has `refresh`, `setValue(id, value)`, `destroy`. Empty/omitted array removes the toolbar.
- Left rail: `RailItem[]` of `cursor | tool | group | toggle | action | separator | spacer`. `rail: false` removes it **at creation only**.
- Styling: `--pc-*` variables on `.pc-shell` (`packages/ui/src/style.css`); chart canvas colors from `ChartTheme` (`packages/core/src/theme.ts`), set via JS only.

Gaps: no runtime show/hide of rail or toolbar, no item-level updates, no left/right toolbar alignment groups, canvas theme does not follow CSS, single dark theme, no feature flags for engine UI (legend, crosshair labels, context menu), no context menu.

## 1. Left rail: show / hide

Required behaviour: the left toolbar can be disabled entirely, or be present but hidden by default. A toggle action flips it at runtime, and an event reports visibility.

Proposed:

```ts
createChartShell(el, {
  rail: { items: defaultRailItems(), visible: true },   // or false (not created) / RailItem[] (shorthand)
});

shell.rail?.setVisible(false);
shell.rail?.toggle();
shell.rail?.visible;                 // boolean
shell.on('rail:visibility', ({ visible }) => settings.set('rail', String(visible)));
```

- Hidden rail = `hidden` attribute on `.pc-shell-side` (not removed), so state and listeners survive. CSS: `.pc-shell-side[hidden] { display: none; }`. Chart stage resizes via the existing `ResizeObserver`.
- Optional collapse handle at the stage's left edge (`.pc-rail-handle`), feature-flagged.
- Persist via `SettingsAdapter` (see persistence.md).
- `shell.rail.setItems(items)` rebuilds the rail (tool access changes, favorites).

## 2. Top toolbar: customize

Proposed item additions (all optional):

```ts
type ToolbarItemBase = {
  id: string;
  hidden?: boolean;
  align?: 'start' | 'end';        // end = pushed right; replaces manual spacer for common cases
  /** Drop into overflow menu first when narrow (lower = earlier). */
  priority?: number;
};
```

Handle additions:

```ts
toolbar.setItems(items);                     // full rebuild
toolbar.update(id, patch);                   // e.g. { hidden: true }, { options }, { value }
toolbar.setVisible(false); toolbar.toggle();
toolbar.get(id)?.el;                         // escape hatch for custom DOM
shell.on('toolbar:visibility', ...)
```

Built-in item presets so apps compose instead of rewriting (each returns a `ToolbarItem`, all overridable):

| Preset | Does |
| --- | --- |
| `symbolSearch(feed)` | input + dropdown from `Datafeed.search` |
| `intervals(list)` | segmented or menu, calls `chart.setResolution` |
| `chartStyle(styles)` | menu of styles from custom-series.md |
| `indicatorsMenu()` | opens indicator dialog |
| `undoRedo()` | two buttons bound to `history:change` |
| `screenshot()` | `chart.captureImage()` → PNG download |
| `fullscreen()` | Fullscreen API on `shell.el` |
| `toggleRail()` | shows/hides left rail |
| `layouts(storage)` | save / load / rename layouts |
| `settings()` | opens chart settings dialog |

Responsive: `ResizeObserver` on toolbar; items with lowest `priority` move into a "more" menu when they overflow. Segmented intervals collapse to a menu below a width threshold.

### Adding buttons (developer)

```ts
toolbar.add(item, { after: 'interval' });   // or { before }, default = before end group
toolbar.remove(id);

// Show/hide anything with one preset; button state follows the target automatically.
toolbar.add(toggleVisibility(cvdSeries, { icon: Eye, label: 'CVD' }));
toolbar.add(toggleVisibility(rsiIndicator));
toolbar.add(toggleVisibility('drawings'));          // all drawings
toolbar.add(toggleVisibility(chart.panes[1]!));     // whole pane
```

`toggleVisibility(target)` accepts a series, indicator, pane, drawing id, or `'drawings'`. It calls `setVisible` on click and listens to `series:visibility` / `indicator:change` / `drawings:change` so the active state stays right even when visibility changes elsewhere (legend eye button, settings dialog). Needs a new core event: `chart.on('series:visibility', { series, visible })`.

### Customizing the toolbar (end user)

Users can add, remove and reorder toolbar buttons themselves, without app code changes.

- Entry point: "Customize toolbar" item at the end of the overflow menu, and right-click on the toolbar.
- Opens a small panel listing the **action catalog**:
  - built-in actions (screenshot, fullscreen, undo/redo, toggle rail, fit content, reset scale...),
  - one "Show/hide …" action per series, indicator and pane currently on the chart (catalog updates when indicators are added/removed),
  - "Show/hide drawings",
  - actions the app registers.
- User checks actions to add them, drags to reorder, removes with an × button. "Reset to default" restores the app's initial list.
- Layout saved as a list of action ids through `SettingsAdapter` (key `toolbar`), so it survives reloads. Ids that no longer exist (removed indicator) are skipped silently.

```ts
// App registers extra actions users may add
toolbar.registerAction({ id: 'alerts', label: 'Alerts', icon: Bell, onClick: openAlerts });

createChartShell(el, {
  toolbar: {
    items: [...],                 // app default layout
    customize: toolbarCustomization({ locked: ['symbol', 'interval'] }), // enables the panel; locked items users cannot remove or move
    settings,                     // SettingsAdapter for persistence
  },
});
toolbar.on('change', ({ ids }) => ...);   // user edited the layout
```

Same mechanism can later apply to the left rail (favorite drawing tools).

Optional bottom bar (`timeframes` range presets like 1D/5D/1M/YTD/All, timezone, % / log scale toggles) as a second toolbar slot: `createChartShell(el, { bottomBar: [...] })`.

## 3. Feature flags

One flat object, not a long string list. Defaults = current behaviour.

```ts
createChart(el, {
  features: {
    legend: true,
    legendButtons: true,        // eye / settings / remove per row
    lastValueLabels: true,
    contextMenu: true,
    pricescaleMenu: false,
    scroll: true,               // drag pan
    zoom: true,                 // wheel/pinch
    axisDragScale: true,
    keyboard: true,             // arrows, +/-, Esc, Delete
    countdown: false,           // time to bar close on price axis
    watermark: false,
  },
});
chart.applyOptions({ features: { legend: false } });
```

Shell flags: `toolbar`, `rail`, `railHandle`, `bottomBar`, `fullscreenButton`.

Status: implemented in `packages/core/src/features.ts` (`chart.features`, `defaultChartFeatures`) and `packages/ui/src/features.ts` (`shell.applyFeatures`), documented in `docs/guide/features.md`. Differences from the sketch above: `countdown` defaults to `true` (today's behaviour), `touchScroll` and `touchZoom` were added, and `pricescaleMenu`, `railHandle` and `fullscreenButton` wait for their features. `legendButtons`, `watermark` and `contextMenu` have since landed.

## 4. Context menu

```ts
chart.onContextMenu((ctx) => [                // ctx: { time, price, pane, drawing?, series? }
  ...ctx.defaults,                            // built-in items (reset scale, remove drawings...)
  '-',
  { label: 'Add alert here', onClick: () => addAlert(ctx.price) },
]);
```

Renderer lives in `@chart-on/ui` (same popover component as menus). Core only emits `contextmenu` with ctx; UI renders. Without UI package, apps render their own.

## 5. Events to expose

Existing: `crosshair`, `visibleRange`, `requestHistory`, `tool:change`, `drawing:select`, `drawings:change`.

Add (grouped):

| Group | Events |
| --- | --- |
| Data | `symbol:change`, `resolution:change`, `data:loading`, `data:loaded`, `data:error`, `bar` (each realtime bar) |
| Pointer | `click { time, price, pane }`, `dblclick`, `contextmenu`, `sourcemarkers:click` |
| Drawings | `drawing:create`, `drawing:update`, `drawing:remove`, `drawing:click` |
| Indicators | `indicator:add`, `indicator:remove`, `indicator:change` |
| Layout | `pane:add`, `pane:remove`, `pane:resize`, `rail:visibility`, `toolbar:visibility`, `theme:change` |
| State | `state:change`, `history:change` |

Chart methods worth adding: `setVisibleRange({ from, to })`, `captureImage(opts): Promise<Blob | null>` (composite the 3 canvases + legend text, then encode), `getDataTable({ from, to }): rows` (CSV), `resetScales()`, `setCrosshair(time, price)` for sync between charts.

## 6. Styling with vanilla CSS

Goal: one place (CSS) controls both UI and canvas colors. No build-time CSS tooling required, no Tailwind, no CSS-in-JS.

### Token layers

1. **UI tokens** (exist): `--pc-shell`, `--pc-canvas`, `--pc-surface`, `--pc-popover`, `--pc-hover`, `--pc-active`, `--pc-line*`, `--pc-ink`, `--pc-muted*`, `--pc-faint`, `--pc-focus`, `--pc-font*`, `--pc-radius-*`, `--pc-rail-button`, `--pc-gap`.
2. **Chart tokens** (new), mapping 1:1 to `ChartTheme`:

```css
.pc-shell {
  --pc-chart-bg: var(--pc-canvas);
  --pc-chart-grid: rgba(255, 255, 255, 0.05);
  --pc-chart-separator: var(--pc-line-subtle);
  --pc-chart-text: var(--pc-muted-strong);
  --pc-chart-text-muted: var(--pc-faint);
  --pc-chart-crosshair: rgba(255, 255, 255, 0.32);
  --pc-chart-label-bg: var(--pc-active);
  --pc-chart-label-text: var(--pc-ink);
  --pc-up: #10b981;
  --pc-down: #f43f5e;
  --pc-line-series: #38bdf8;
  --pc-drawing: #38bdf8;
  --pc-drawing-selected: var(--pc-ink);
  --pc-heatmap: #1e1b4b, #6d28d9, #0891b2, #22d3ee, #a3e635, #facc15;
}
```

3. **Component classes** (exist, keep stable, document as public): `.pc-toolbar`, `.pc-rail`, `.pc-rail-group`, `.pc-icon-btn--{flat,ghost,surface}`, `.pc-btn`, `.pc-seg`, `.pc-menu`, `.pc-popover`, `.pc-popover-item`, `.is-active`, `[data-tip]`. Add `.pc-legend`, `.pc-legend-row`, `.pc-inspector`, `.pc-context-menu`, `.pc-dialog` once those exist.

### Canvas reads CSS

```ts
import { themeFromCss } from '@chart-on/core';
chart.applyOptions({ theme: themeFromCss(shell.el) });   // getComputedStyle → ChartTheme
```

Shell does this automatically on create and whenever the theme class changes (`MutationObserver` on `class` / `data-theme`, plus `matchMedia('(prefers-color-scheme: dark)')`). Explicit `theme` in options still wins (JS > CSS > default). Canvas needs resolved colors, so `themeFromCss` resolves `var()` via computed style and parses with existing `parseColor`.

### Themes

```css
/* light */
.pc-shell[data-theme="light"] {
  --pc-shell: #f4f4f5; --pc-canvas: #ffffff; --pc-surface: #f4f4f5;
  --pc-popover: #ffffff; --pc-hover: #e4e4e7; --pc-active: #d4d4d8;
  --pc-line: #d4d4d8; --pc-line-strong: #a1a1aa; --pc-line-subtle: #e4e4e7;
  --pc-ink: #18181b; --pc-muted-strong: #3f3f46; --pc-muted: #71717a; --pc-faint: #a1a1aa;
  --pc-focus: #18181b;
  --pc-chart-grid: rgba(0, 0, 0, 0.06); --pc-chart-crosshair: rgba(0, 0, 0, 0.35);
}

/* follow OS unless app forces a theme */
@media (prefers-color-scheme: light) {
  .pc-shell:not([data-theme]) { /* same light tokens */ }
}
```

```ts
shell.setTheme('light' | 'dark' | 'system');   // sets data-theme, re-reads tokens, emits theme:change
```

### Rules

- Every color, radius, spacing, font in `style.css` goes through a `--pc-*` variable. No hard-coded colors below the token block.
- Shell does not set inline styles except layout geometry. Move the inline `background` on `.pc-chart` root to CSS (`background: var(--pc-chart-bg)`).
- Respect `prefers-reduced-motion` (segmented indicator, inertia, smooth zoom off).
- Focus outlines visible on all interactive elements (`:focus-visible`).
- Layout works at phone width: rail collapses to a bottom sheet or is hidden by default below 640px (flag `railBreakpoint`).
- Keep CSS scoped under `.pc-shell` so it never leaks into the host page.

## 7. Example: fully customized shell

```ts
const shell = createChartShell(el, {
  theme: 'system',
  rail: { items: defaultRailItems({ groups: ['lines', 'fib', 'shapes', 'text'] }), visible: settings.get('rail') !== 'false' },
  toolbar: [
    symbolSearch(feed),
    intervals(['1', '5', '15', '60', '1D']),
    chartStyle(['candles', 'hollow', 'bars', 'line', 'area', 'heikin-ashi']),
    indicatorsMenu(),
    { type: 'button', id: 'alerts', label: 'Alerts', icon: Bell, align: 'end', onClick: openAlerts },
    undoRedo(),
    toggleRail(),
    screenshot(),
    fullscreen(),
  ],
  chart: { features: { countdown: true, contextMenu: true } },
});
```
