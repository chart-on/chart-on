---
description: "Keep layouts, per-symbol drawings and user settings in the browser or on your server: the storage adapter, autosave and the settings store."
---

# Storage and autosave

The chart never stores anything by itself. [`serializeLayout` and `loadLayout`](./layouts) turn what the user arranged into JSON and back; they need the `layouts()` plugin, and so do `autosave` and `loadLastLayout`, which call them. This page covers where that JSON goes and when it is saved:

- a **storage adapter**: one small async interface for layouts, drawings and templates, with a built-in `localStorage` version;
- the **`state:change`** event and the **`autosave`** helper, which save after changes but never after a load;
- **per-symbol drawings**, which follow the symbol the user is looking at;
- a **settings store** for UI preferences, with synchronous reads.

```ts
import { autosave, builtins, createChart, createLocalStorageAdapter, layoutEntry, loadLastLayout, perSymbolDrawings } from '@chart-on/core';

// builtins() brings layouts() for saving and loading, and the drawings that perSymbolDrawings keeps.
const chart = createChart(el, { plugins: builtins() });
const storage = createLocalStorageAdapter({ prefix: 'my-app:' });

perSymbolDrawings(chart, storage);
const saver = autosave(chart, {
  serialize: { drawings: false },  // drawings are kept per symbol instead
  save: (layout) => storage.saveLayout(layoutEntry(layout, 'Main', 'main')).then(() => {}),
});

const last = await loadLastLayout(chart, storage);
if (!last) chart.setSymbol('ABC', '1d');
```

## Storage adapter

```ts
interface StorageAdapter {
  loadDrawings?(key: string): Promise<SerializedDrawings | null>;
  saveDrawings?(key: string, drawings: SerializedDrawings, delta?: DrawingsDelta): Promise<void>;
  removeDrawings?(key: string): Promise<void>;
  listLayouts?(): Promise<LayoutSummary[]>;   // { id, name, savedAt, preview?: { symbol?, interval? } }
  loadLayout?(id: string): Promise<ChartLayout | null>;
  saveLayout?(entry: LayoutEntry): Promise<string>;   // { id?, summary, layout }
  removeLayout?(id: string): Promise<void>;
  listTemplates?(kind: TemplateKind, scope?: string): Promise<string[]>;
  loadTemplate?(kind: TemplateKind, name: string, scope?: string): Promise<unknown>;
  saveTemplate?(kind: TemplateKind, name: string, content: unknown, scope?: string): Promise<void>;
  removeTemplate?(kind: TemplateKind, name: string, scope?: string): Promise<void>;
}
```

Every method is async, so a server backend fits, and every method is optional: implement what your app uses. The helpers check that a method exists before they call it. `saveLayout` resolves with the layout's id, a new one when you leave `id` out. Return `null` for anything missing or unreadable; the chart validates what it loads, so an adapter does not need to.

`saveDrawings` gets all the drawings under the key, plus a `delta` of the ids `changed` and `removed` since the last save under that key when the helper knows them. A server can use the delta to update rows one by one and ignore the full list; the built-in adapter ignores the delta.

Templates are named styles a user saves once and reuses. `kind` is `'drawing'` (with the tool type as `scope`), `'indicator'` (with the indicator id as `scope`), `'chart'` (no scope), `'indicator-set'` (a group of indicators with their panes from [`chart.indicators.serializeSet()`](./indicators#indicator-sets), no scope) or `'indicator-default'` (the inputs and plot styles new indicators of an id start with, the indicator id as `scope`, one entry named `'default'`; the built-in adapter keeps them under `<prefix>templates:indicator-default`, apart from named templates). Names are unique within a kind and scope: saving under a taken name replaces that template. The built-in adapter compares names exactly, so `Trend` and `trend` are two templates. An adapter may instead match names without case, as the [indicator template dialog](./indicator-picker#indicator-templates) does; `listTemplates` should then return the name given to the latest save. `listTemplates` returns the names in the order they were first saved; `loadTemplate` returns the content as saved, or `null`. The content is any JSON value and the adapter does not check it, so validate it before applying it. The [templates add-on](./ui-shell#drawing-templates) of `@chart-on/ui` saves and applies `'drawing'` and `'indicator'` templates, and [`'indicator-default'`](./ui-shell#save-as-default) ones.

```ts
await storage.saveTemplate('drawing', 'Thick blue', { color: '#2f6bff', width: 3 }, 'trend-line');
const names = await storage.listTemplates('drawing', 'trend-line'); // ['Thick blue']
const style = await storage.loadTemplate('drawing', 'Thick blue', 'trend-line');
```

A server adapter is a thin wrapper around `fetch`:

```ts
const storage: StorageAdapter = {
  loadDrawings: async (symbol) => (await fetch(`/api/drawings/${encodeURIComponent(symbol)}`)).json(),
  saveDrawings: async (symbol, drawings, delta) => {
    await fetch(`/api/drawings/${encodeURIComponent(symbol)}`, { method: 'PUT', body: JSON.stringify({ drawings, delta }) });
  },
};
```

### localStorage

`createLocalStorageAdapter` implements every method on `localStorage`:

```ts
const storage = createLocalStorageAdapter({
  prefix: 'my-app:',          // default 'charton:'
  storage: sessionStorage,    // default localStorage; anything with getItem/setItem/removeItem
  onError: (error, key) => console.warn('Storage failed', key, error),
});
```

| Key | Content |
| --- | --- |
| `<prefix>drawings:<key>` | the drawings saved under `key` |
| `<prefix>layouts` | the layout index (`{ version, layouts }`) |
| `<prefix>layout:<id>` | one layout |
| `<prefix>templates:<kind>` | every template of the kind (`{ version, templates }`), names and scopes kept exactly |
| `<prefix>settings:<key>` | one setting (see [settings](#settings)) |

Keys are sanitized with `storageKeyPart`: lower case, and every character outside `a-z`, `0-9`, `_` and `-` becomes `_`. So `BTC/USD` is stored as `btc_usd`; give symbols that differ only in case or punctuation keys of your own.

Storage failures never throw. Blocked storage (private mode, a sandboxed frame) reads as empty, and a full quota leaves the value unsaved. Both are reported to `onError` when you pass one. An entry that is not valid JSON, or not a versioned payload of the right shape, reads as `null` and is removed.

### Layout summaries

`listLayouts` returns a `LayoutSummary` per saved layout: what a layout picker shows without loading the layout. A row needs a name to read, when it was saved to sort and date it (`savedAt`, unix seconds), and what the chart shows to tell similar names apart (`preview`, with the symbol id and the interval when the layout has them). Nothing else, so adapters keep it small.

Build what `saveLayout` takes with `layoutEntry(layout, name, id?)`. It returns `{ id?, summary, layout }`, with `savedAt` set to the time of the call, so call it when saving. A layout loaded and saved again then sorts as the newest, even though its `meta.updatedAt` is still the old time. An adapter stores `summary` as it is, with the id, and returns it from `listLayouts`; it never reads fields out of the layout. A server can keep the summary in a table and the layout as an opaque blob.

```ts
await storage.saveLayout(layoutEntry(chart.serializeLayout(), 'Swing'));
const rows = (await storage.listLayouts()).sort((a, b) => b.savedAt - a.savedAt);
```

## state:change

The chart fires `state:change` with a `reason` when something worth saving changes:

| `reason` | What changed |
| --- | --- |
| `drawings` | a drawing was created, edited or removed |
| `indicators` | an indicator was added, removed, or its inputs or visibility changed |
| `series` | the main series' chart type or style (the options a layout keeps) |
| `panes` | panes (added, removed, moved, resized, collapsed, maximized) or a price scale's settings |
| `symbol` | another symbol or interval finished loading |
| `options` | the theme or the grid (`appearance:change`) |
| `viewport` | the visible time range; this fires on every pan and zoom |

Loads are quiet. `drawings.load`, `indicators.load` and `loadLayout` fire no `state:change`, so restoring saved state never saves it again. A layout with a symbol stays quiet until its `ready` settles: until then the layout is only partly applied (the old visible range, say), and saving it would store the wrong thing. `chart.layoutLoading` is true meanwhile. Edits the user makes while the symbol loads are not lost: they are reported once it has loaded.

## Autosave

`autosave` listens to `state:change`, waits for the changes to settle, and hands you the layout to store:

```ts
const chart = createChart(el, { plugins: [layouts()] });
const saver = autosave(chart, {
  delayMs: 1000,                                  // debounce; default 1000
  include: [...DEFAULT_AUTOSAVE_REASONS, 'viewport'],  // default: every reason but 'viewport'
  serialize: { visibleRange: true },              // passed to serializeLayout
  save: (layout, reasons) => storage.saveLayout(layoutEntry(layout, name, id)).then(() => {}),
  onError: (error) => showToast('Could not save'),
});

saver.pending;       // a change is waiting for the delay
await saver.flush(); // save it now
saver.cancel();      // drop it
saver.stop();        // stop listening
```

Many changes in a row produce one save, with every `reason` since the last save. On `pagehide` a pending change is saved at once, so the last edit is not lost when the tab closes. Pass `flushTarget: null` to turn that off, or another `EventTarget` to listen on. A `save` that throws or rejects goes to `onError`; by default it is logged. On a chart without `layouts()`, every save fails there with a [`not-registered`](./errors#not-registered) error and keeps its changes, so the first save after `chart.install(layouts())` stores them.

Before loading a different layout into the chart, `await saver.flush()`, so pending changes go to the layout they were made in.

## Drawings per symbol

Apps commonly keep drawings per symbol rather than per layout. `perSymbolDrawings` does that through a storage adapter:

```ts
const drawings = perSymbolDrawings(chart, storage, {
  key: (symbol) => `${layoutId}:${symbol}`,  // default: the symbol id
  delayMs: 500,
});
drawings.key;           // the key of the drawings on the chart now
await drawings.flush();
drawings.stop();
```

When the chart starts loading another symbol, the old symbol's drawings are saved, the chart is cleared, and the new symbol's drawings load. Edits save debounced, with the changed and removed ids as `delta`. Loading never saves. Switching only the interval keeps the drawings. Drawings the user makes while the saved ones load are kept on top of them.

The binding stops automatically when the chart is destroyed. Pending edits are dropped and in-flight loads no longer change the chart. To keep the final edits, `await drawings.flush()` before `chart.destroy()`. Calling `stop()` also drops pending edits.

Save layouts with `serializeLayout({ drawings: false })` (with `autosave`, `serialize: { drawings: false }`), so the drawings are not stored twice. Clearing on a switch removes drawings added with `persist: false` too; add yours again on `data:loaded`.

## Load the last layout

```ts
const last = await loadLastLayout(chart, storage);   // options as for loadLayout
if (last) {
  console.log('Restored', last.id, last.result.errors);
  await last.result.ready;
}
```

It loads the most recently saved layout from `listLayouts` (by `savedAt`), skipping entries that are missing or not layouts. It resolves `null` when there is none, so you can load a default symbol instead. On a chart without `layouts()` it rejects with a [`not-registered`](./errors#not-registered) error when a saved layout exists, rather than resolving `null` as if nothing were saved.

## Settings

UI preferences (the colour scheme, favourites, the last interval, whether a panel is open) are not part of a layout. Keep them in a settings store, which reads synchronously so the UI can start with the right values:

```ts
import { createSettingsStore } from '@chart-on/core';

const settings = createSettingsStore({
  adapter: storage.settings,                   // any { get, set, remove } with string values
  snapshot: await fetchUserSettings(),         // optional: loaded ahead of time, wins over the adapter
  locked: { theme: 'dark' },                   // optional: values the app fixes
  version: 2,
  migrate: (store, fromVersion) => {
    if (fromVersion < 2) store.set('favourites', store.get('favs') ?? '[]');
  },
});

settings.get('theme');                         // string | null
settings.set('lastInterval', '15m');
settings.getJSON('favourites', [] as string[]);
settings.setJSON('favourites', ['ABC']);
settings.values();                             // everything set or read so far, e.g. to send to a server
```

A value comes from, in order: the app's `locked` values (reads return them, writes are ignored, `isLocked(key)` tells you), then what the user set, then your fallback. For a server-backed store, fetch the user's settings before creating the chart, pass them as `snapshot`, and write changes back through your own `adapter` (or `values()`). `migrate` runs once, when the stored version is older than `version` (`0` when none was stored); the new version is saved after it. Adapter failures never throw.

The built-in adapter's `settings` keeps values under `<prefix>settings:<key>`.

## Which source wins

When several sources set the same thing, the later layer in this list wins over the earlier ones:

1. Built-in defaults.
2. CSS tokens (`--pc-*`, see [theming](./theming)).
3. Options passed when creating the chart or series.
4. User settings: the settings store, and the user's choices the UI package keeps, such as its appearance overrides.
5. A loaded layout: chart type, panes, price scales, indicators, drawings, symbol and interval.
6. Runtime calls (`applyOptions`, `series.applyOptions`, `setSymbol`...) made after the layout loaded.

**Theme:** a layout never holds the theme, so loading one leaves the colour scheme and colours alone. The theme is a user setting. In the UI package, the user's appearance overrides win over the app's `chart.theme` option and the CSS tokens. A runtime `applyOptions({ theme })` changes it until the next one. Keep the colour scheme (dark, light, system) in the settings store, as the demo does, and pass it to `createChartShell({ theme })` at start.
