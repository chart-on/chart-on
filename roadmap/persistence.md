# Persistence: save/load callbacks

## Today

- `chart.drawings.serialize(): { version: 1, drawings }` and `chart.drawings.load(data)` (validated by `parseSerialized`).
- `chart.indicators.serialize()` / `load()` with placeholders for unregistered ids (#125).
- `chart.serializeLayout(opts)` / `chart.loadLayout(data, { migrate })` (#14): symbol id and interval, main series style, panes (heights, collapsed, maximized, price scales), indicators in their panes, drawings, opt-in visible range and app `meta`. Versioned (`LAYOUT_VERSION`, `migrateLayout`), tolerant (invalid parts reported in `errors`, unknown fields kept), `persist: false` for app-added indicators and drawings. Opt-in through the `layouts()` plugin (part of #807). See `docs/guide/layouts.md`.
- `drawings:change` fires on every create/update/remove.
- `state:change { reason }` (#43): `drawings`, `indicators`, `series`, `panes`, `symbol`, `options`, `viewport`. Loads are quiet (`loadLayout` until `ready` settles, `drawings.load`, `indicators.load`); edits made while a layout's symbol loads are reported after. `chart.layoutLoading`.
- Storage (#43, `packages/core/src/storage/`): `StorageAdapter` (async, all optional; drawings by key with a `{ changed, removed }` delta, layouts list/load/save/remove), `SettingsAdapter`, `createLocalStorageAdapter({ prefix })`, `createSettingsStore` (snapshot, locked keys, versioned `migrate`), `autosave`, `perSymbolDrawings`, `loadLastLayout`. See `docs/guide/storage.md`, which also documents precedence and where the theme lives.
- Demo (`apps/demo/src/main.ts`) uses the localStorage adapter, `autosave` (layout without drawings, with the visible range), `perSymbolDrawings`, and keeps the colour scheme in the settings store.

Templates: the adapter methods and their localStorage version have landed (#44); the template UI has not. Chart options (theme, timezone...) and compared symbols are not part of the layout yet. The UI package's appearance, chart settings and favourites stores keep their own storage interfaces; they could take a `SettingsAdapter`.

## Requirements

- **Autosave signal:** one event after any undoable user change, throttled by a configurable delay. The app reads the full state and stores it wherever it likes.
- **Restore:** pass saved state at construction, or load it later.
- **Storage adapter** with four families:
  - chart layouts (list, save, load, remove);
  - indicator templates;
  - drawing templates (per tool);
  - chart templates (style only).
  Drawings can optionally be stored separately, keyed by layout + symbol.
- **Settings adapter:** a tiny key/value interface for UI preferences (favourites, last interval, rail visibility). The default writes to localStorage; apps can supply their own.
- **Programmatic content is not saved:** apps commonly keep drawings per symbol. Indicators and annotations added by the app itself must be excluded from saved state, so they are not frozen into a user's layout.

## Proposed design

### 1. Chart state

Landed as `ChartLayout` with `chart.serializeLayout()` / `chart.loadLayout()` (#14); see `docs/guide/layouts.md` for the shape. The sketch below is the original proposal; `options` and per-series state are not saved yet.

```ts
interface ChartState {
  version: 1;
  symbol?: string;
  resolution?: string;
  options: Partial<ChartOptions>;          // theme overrides, spacing, legend...
  panes: { stretch: number; series: SeriesState[] }[];
  indicators: IndicatorState[];             // chart.indicators.serialize(): type + version + inputs, not computed values
  drawings: Drawing[];
  viewport?: { from: Time; to: Time };
}

chart.save(opts?: { drawings?: boolean; viewport?: boolean }): ChartState
chart.load(state: unknown): void            // validates, ignores unknown fields, migrates by version
```

Data (bars) is never saved. Indicators save config only and recompute after data loads.

### 2. Autosave callback

```ts
chart.on('state:change', ({ reason }) => ...)  // reason: 'drawings' | 'indicators' | 'options' | 'panes' | 'viewport'

const stop = autosave(chart, {
  delayMs: 1000,                      // debounce
  include: ['drawings', 'indicators', 'options', 'panes'],  // viewport changes are noisy; opt in
  save: (state) => adapter.saveLayout(key(), state),
});
```

`autosave` is a small helper in core (debounce + `chart.save()`); apps can ignore it and listen to `state:change` themselves. Flush on `pagehide` so the last edit is not lost.

### 3. Storage adapter

All methods async so a server backend fits. Apps implement only what they use; helpers check for presence.

```ts
interface StorageAdapter {
  // drawings, keyed by symbol (or any app key)
  loadDrawings?(key: string): Promise<SerializedDrawings | null>;
  saveDrawings?(key: string, data: SerializedDrawings): Promise<void>;

  // full layouts
  listLayouts?(): Promise<LayoutSummary[]>;   // { id, name, savedAt, preview?: { symbol?, interval? } }
  loadLayout?(id: string): Promise<ChartState | null>;
  saveLayout?(entry: { id?: string; summary: Omit<LayoutSummary, 'id'>; layout: ChartLayout }): Promise<string>;
  removeLayout?(id: string): Promise<void>;

  // templates
  listTemplates?(kind: 'drawing' | 'indicator' | 'chart' | 'indicator-set', scope?: string): Promise<string[]>;
  loadTemplate?(kind, name, scope?): Promise<unknown>;
  saveTemplate?(kind, name, content, scope?): Promise<void>;
  removeTemplate?(kind, name, scope?): Promise<void>;
}

interface SettingsAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}
```

`scope` = tool type for drawing templates.

### 4. Built-in localStorage adapter

```ts
const storage = createLocalStorageAdapter({ prefix: 'charton:' });
```

Keys:

| Key | Content |
| --- | --- |
| `charton:drawings:<symbol>` | `SerializedDrawings` |
| `charton:layouts` | layout index array |
| `charton:layout:<id>` | `ChartState` |
| `charton:templates:<kind>` | every template of the kind, with exact names and scopes |
| `charton:settings:<key>` | settings values |

Rules:
- Sanitize symbol for keys (lowercase, `[a-z0-9_-]`).
- Every read/write in try/catch; private mode or quota errors must not break the chart. Return `null` on read failure.
- Validate on read (`parseSerialized`, `parseChartState`); drop corrupt entries.
- Store a `version` and migrate forward.

### 5. Per-symbol drawings flow

```ts
async function switchSymbol(symbol: string) {
  await flushAutosave();
  chart.drawings.clear();
  await chart.setSymbol(symbol);                         // see datafeed.md
  chart.drawings.load(await storage.loadDrawings(symbol) ?? { version: 1, drawings: [] });
}
chart.on('drawings:change', debounce(() => storage.saveDrawings(currentSymbol, chart.drawings.serialize()), 500));
```

Load drawings must not fire `drawings:change` (or must carry `reason: 'load'`) so a load does not trigger a save loop.

### 6. Undo/redo (T2)

Command stack in `DrawingManager` (create/update/remove with before/after snapshots), later extended to indicators and options. Emits `history:change { canUndo, canRedo }` for toolbar buttons. Keyboard: Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z.

## Tests to add

- `serialize` → `load` round trip, unknown fields ignored, bad versions rejected.
- Adapter: quota error swallowed, corrupt JSON returns `null`.
- Autosave debounce: N rapid changes produce one save; `pagehide` flushes.
- Load does not emit a save-triggering change.
