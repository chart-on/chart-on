# Roadmap docs

Working notes for turning `@chart-on/core` + `@chart-on/ui` into a fully customizable trading chart. Each doc lists what exists today, what is missing, and a proposed API that fits the current code.

| Doc | Covers |
| --- | --- |
| [design-principles.md](design-principles.md) | API conventions every new feature follows, and the original-implementation rule |
| [drawing-tools.md](drawing-tools.md) | Full drawing-tool catalog, priorities, plugin contract changes, drawing API and events |
| [persistence.md](persistence.md) | Save/load callbacks, autosave, storage adapter (drawings per symbol, layouts, templates, settings) |
| [datafeed.md](datafeed.md) | OHLCV history, realtime over WebSocket, symbol/interval model, merge rules |
| [custom-series.md](custom-series.md) | Chart styles, custom series plugins |
| [indicators.md](indicators.md) | Built-in and custom indicators (TypeScript only), std library, indicator packages |
| [toolbar-layout.md](toolbar-layout.md) | Where each control goes: top-bar groups, rail, floating drawing bar, bottom bar, settings panel; caps and overflow order |
| [off-main-thread-and-webgpu.md](off-main-thread-and-webgpu.md) | Investigation: renderer in a worker (`OffscreenCanvas`) and a WebGPU backend; measurements, API impact, recommendation |
| [customization.md](customization.md) | Show/hide left rail, top toolbar config, user-added toolbar buttons (show/hide lines), feature flags, events, vanilla CSS theming |

## Current state (short)

- Engine: WebGL2 candles/histograms/heatmap, Canvas2D lines/axes/drawings, multi-pane, pan/zoom inertia, `requestHistory` for infinite scroll back.
- Series: `candles` (styles `candles | line | area`), `histogram`, `line` (area + baseline), `heatmap`.
- Drawings: 8 built-in tools, plugin registry (`chart.drawings.register`), magnet, lock, hide, `serialize()`/`load()`, `drawings:change` event.
- UI: config-driven toolbar (`segmented | button | menu | separator | spacer | custom`), config-driven rail (`cursor | tool | group | toggle | action`), rail can be disabled at creation (`rail: false`), styling via `--pc-*` CSS variables.
- Data: push model only (`setData`, `update`). No data source contract, no symbol/interval model, no WebSocket helper.

## Suggested order

1. **Data source contract + WebSocket adapter** ([datafeed.md](datafeed.md)): everything else (per-symbol drawings, indicators, interval switch) depends on a symbol/interval model.
2. **Customization pass** ([customization.md](customization.md)): runtime rail toggle, toolbar `setItems`/`update`/`add`, `toggleVisibility` preset, user toolbar customization, CSS-driven chart theme, light theme. Small, unblocks consumers.
3. **Persistence** ([persistence.md](persistence.md)): storage adapter, per-symbol drawings, full chart state save/load.
4. **Drawing tools tier 1** ([drawing-tools.md](drawing-tools.md)): extend plugin contract, add channels, fib retracement/extension, long/short position, price/date range, brush, more text tools.
5. **Indicators** ([indicators.md](indicators.md)): registry, `@chart-on/ta` std library, built-in set, then custom indicator packages.
6. **More chart styles + custom series plugin** ([custom-series.md](custom-series.md)).
7. Drawing tools tier 2/3, templates, undo/redo.

## Conventions

- Time is unix **seconds** everywhere in our API (bars, drawing points, ranges). Never mix in milliseconds.
- New APIs follow [design-principles.md](design-principles.md).
- Plugins (drawing tools, series, indicators) are plain objects registered on the chart. No class inheritance required from consumers.
- Every listener returns an unsubscribe function (`chart.on` already does).
- Styling is vanilla CSS. No Tailwind, no CSS-in-JS. Canvas colors come from `ChartTheme`, which can be read from CSS variables.
- Vendor-neutral names in code, docs and commits: other products and companies are described by their role.
