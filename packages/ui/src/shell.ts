import {
  colorSafeUpDown,
  createChart,
  darkTheme,
  forcedColorsTheme,
  lightTheme,
  themeFromCss,
  mergeTypography,
  annotations,
  builtins,
  comparisons,
  dataSource,
  drawings,
  indicators,
  replay,
  sourceMarkers,
  adjustments,
  trading,
  watermark,
  layouts,
  imageCapture,
  type Chart,
  type ChartOptionsPatch,
  type ChartPlugin,
  type ChartTheme,
  type ColorPreset,
  type Indicator,
} from '@charton/core';
import { h } from './dom';
import { mountToolbar, type ToolbarHandle, type ToolbarItem, type ToolbarOptions } from './toolbar';
import { defaultRailItems, mountToolRail, type RailItem, type ToolRailHandle } from './rail';
import { defaultToolbarItems } from './default-toolbar';
import { linkToolbarCustomizations } from './toolbar-link';
import { bottomBarToolbarOptions, mountBottomBar, type BottomBarHandle, type BottomBarInput } from './bottombar';
import { createNavigator, type NavigatorHandle, type NavigatorOptions } from './navigator';
import type { SymbolSearchDialog, SymbolSearchPart } from './symbol-search';
import { createShellHost } from './plugin-host';
import type { CommandPalette, CommandPalettePart } from './command-palette';
import { bindMenuKeys, bindRegionKeys, rovingFocus, type RovingGroup } from './keyboard';
import { shellText, type ShellMessageKey } from './messages';
import { createReplayControls, replayOf, type ReplayControlsHandle, type ReplayControlsPart } from './replay';
import { createDrawingToolbar, type DrawingToolbarHandle } from './drawing-toolbar';
import { createDrawingSettings, type DrawingSettingsHandle, type DrawingSettingsOptions } from './drawing-settings';
import { createIndicatorSettings, type IndicatorSettingsHandle, type IndicatorSettingsOptions } from './indicator-settings';
import { createSeriesSettings, type SeriesSettingsHandle } from './series-settings';
import type { ClusterListHandle, ClusterListPart } from './cluster-list';
import type { DraftEditorHandle, DraftEditorPart } from './draft-editor';
import { createAppearance, themeWithOverrides, type AppearanceHandle, type AppearanceOptions } from './appearance';
import { presetShellTokens } from './color-presets';
import { createChartSettings, type ChartSettingsHandle, type ChartSettingsOptions } from './chart-settings';
import { createTableView, type TableViewHandle, type TableViewOptions } from './table-view';
import { createContextMenu, type ContextMenuHandle, type ContextMenuOptions } from './context-menu';
import { createIndicatorPicker, type IndicatorPickerHandle, type IndicatorPickerOptions } from './indicator-picker';
import { createIndicatorTemplates, type IndicatorTemplatesHandle, type IndicatorTemplatesOptions } from './indicator-templates';
import { defaultShellFeatures, resolveShellFeatures, type ShellFeatures } from './features';
import { createPointerTooltip, type PointerTooltipHandle, type PointerTooltipOptions } from './pointer-tooltip';
import { retainTips } from './tooltip';
import { createCompactLayout, defaultRailBreakpoint } from './compact-layout';
import type { FavoritesController, FavoritesPart, ShellFavorites } from './favorites';
import { devCheck } from './options-schema';
import { addClasses, createStatusSlot, renderSlot, type ShellClassNames, type ShellSlots } from './slots';
import type { ToastStackHandle, ToastsPart } from './toasts';
import { setDialogClass } from './dialog';
import { defaultShellPanels, markShellPanels, resolveShellPanels, type ShellPanels, type ShellPanelStyle } from './panels';

/** `system` follows the OS colour scheme (`prefers-color-scheme`). */
export type ShellTheme = 'dark' | 'light' | 'system';

/** Up and down colours: the theme's own, or a blue and orange pair safe for colour-vision deficiencies. */
export type ShellPalette = 'default' | 'color-safe';

/** Layout direction of the shell's chrome; `auto` follows the page (the `dir` the container inherits). */
export type ShellDirection = 'ltr' | 'rtl' | 'auto';

/** The shell's `rail` option: the tool rail's items and whether it starts shown. */
export interface RailOptions {
  /** Defaults to the built-in drawing tools. */
  items?: RailItem[];
  /** Start hidden; show later with `shell.rail.setVisible(true)`. Default `true`. */
  visible?: boolean;
}

/**
 * Options for `createChartShell`: the core chart options, which parts of the shell to create and how (toolbar, rail, bottom bar, dialogs, panels and menus),
 * plus theme, palette, feature flags, slots and class names.
 */
export interface ChartShellOptions {
  /**
   * Core chart options. A `theme` here wins over the CSS chart tokens.
   * `plugins` defaults to `builtins()`; pass a list to choose, e.g.
   * `[heatmap(), drawingTools(someTools)]`. The shell adds `dataSource()`, `indicators()`,
   * `comparisons()`, `drawings()`, `annotations()`, `replay()`, `sourceMarkers()`, `adjustments()`, `watermark()`, `layouts()` and `imageCapture()` when the
   * list leaves them out, since its parts use them, before the app's plugins,
   * so those can register indicators and drawing tools, and `trading()` after
   * them. The default rail offers the chart's drawing tools.
   */
  chart?: ChartOptionsPatch;
  /**
   * Top toolbar items, or items with options such as end-user customization
   * (`customize: toolbarCustomization()`). Default `defaultToolbarItems()`;
   * pass [] to leave the toolbar out.
   */
  toolbar?: ToolbarItem[] | ToolbarOptions;
  /**
   * Left rail. `false` does not create it; an array is shorthand for `{ items }`.
   * Defaults to the built-in drawing tools.
   */
  rail?: RailOptions | RailItem[] | false;
  /**
   * Bottom bar. It takes items as the toolbar does (`goToDate`, `clock`,
   * `timezoneMenu`, `scaleMode` and the other presets, or any toolbar item), or
   * `BottomBarOptions` as shorthand for `defaultBottomBarItems`; `true` gives
   * the default items. Off by default; `false` or an empty list leaves it out.
   */
  bottomBar?: BottomBarInput | boolean;
  /** Overview strip above the bottom bar: the whole history with a draggable window. Off by default. */
  navigator?: NavigatorOptions | boolean;
  /**
   * Favourite drawing tools, made by `favorites({ tools })`: a star beside each
   * tool in the rail's flyouts and a movable bar of the starred tools over the
   * plot. Saved to `localStorage` under `storageKey` unless `storage` replaces
   * it; saved favourites win over `tools`. Off when left out: the rail skips
   * its `favorites` item and flyouts show no stars.
   */
  favorites?: FavoritesPart;
  /**
   * Symbol search dialog, made by `symbolSearch({ source, onSelect })`. Typing
   * a letter or digit that no action is bound to on the focused chart, or
   * elsewhere in the shell outside text fields, opens it with that character
   * unless `openOnTyping` is set (`false` turns it off, an element hears typing
   * only there), and so does the `symbol-search` action on `chart.actions`
   * (`/`, and Mod+K without the command palette) anywhere in the shell. Off
   * when left out: `symbolHeader()` is disabled.
   */
  symbolSearch?: SymbolSearchPart;
  /**
   * Command palette, made by `commandPalette({ sources })`: a searchable list
   * of the commands on `chart.actions`, with their shortcuts, plus entries from
   * app `sources`. Opened by the `command-palette` action (Mod+K by default;
   * the symbol search's shortcut is then only `/`) or
   * `commandPaletteToolbarItem()`. Turn it off at runtime with the
   * `commandPalette` feature flag. Off when left out: the symbol search keeps
   * Mod+K and `commandPaletteToolbarItem()` is disabled.
   */
  commandPalette?: CommandPalettePart;
  /** Floating style toolbar for the selected drawing. Default true. */
  drawingToolbar?: boolean;
  /**
   * Settings dialog for a drawing, opened from the drawing toolbar's Settings
   * button or by double-clicking the drawing (text tools edit their text
   * instead). Default true; an object turns it on with those options, such as
   * the template menu of `@charton/ui/templates`.
   */
  drawingSettings?: boolean | DrawingSettingsOptions;
  /**
   * Settings panel for an indicator, docked to the right of the chart and
   * opened from its legend row's settings button or menu. While it is on, the
   * main series' settings button opens the chart settings, and compared
   * symbols and plain series open a style panel (`seriesSettings`). Rows with
   * nothing to set show no settings button. Default true; an object turns it
   * on with a control in the indicator panel's header, such as the template
   * menu of `@charton/ui/templates`.
   */
  indicatorSettings?: boolean | Pick<IndicatorSettingsOptions, 'headerControl'>;
  /**
   * Floating play, pause, step and speed controls while a bar replay runs
   * (see `replayToolbarItem`), made by `replayControls()`. Needs the
   * `replay()` plugin. Left out, a shell on the default toolbar (no `toolbar`
   * option), which has the replay button, shows the strip too; other shells
   * run a replay without it.
   */
  replayControls?: ReplayControlsPart;
  /**
   * List of the orders in a clicked label cluster, with cancel buttons, made
   * by `clusterList()`. Needs the `trading()` plugin. Off when left out:
   * `annotations:cluster` is left to the app.
   */
  clusterList?: ClusterListPart;
  /**
   * Quantity keypad and order type menu for order drafts, made by
   * `draftEditor({ quantityPresets, maxQuantity })`. Needs the `trading()`
   * plugin. Off when left out: `draft:edit` is left to the app.
   */
  draftEditor?: DraftEditorPart;
  /**
   * User color overrides and the Appearance panel (open it with `shell.appearance.open()`
   * or `appearanceToolbarItem()`). Overrides are saved to `localStorage` under `storageKey`
   * (give each shell on a page its own) unless `storage` replaces it; `false` turns the feature off.
   * `presets` sets the colour presets at the top of the panel: the built-in ten by
   * default, your own list, or `false` to hide them and ignore a saved preset.
   * `defaultPreset` is the preset used until the user picks one (default `'paper-ink'`,
   * null for the plain theme). A preset follows the theme into its light or dark variant.
   */
  appearance?: Pick<AppearanceOptions, 'storage' | 'storageKey' | 'presets' | 'defaultPreset'> | false;
  /**
   * The chart settings dialog (open it with `shell.settings.open()` or
   * `settingsToolbarItem()`). Changed settings are saved to `localStorage`
   * under `storageKey` unless `storage` replaces it; theme colors and grid
   * lines go to the appearance overrides. `sections` adds, hides or reorders
   * sections; `fields` and `actions` add app-defined fields and buttons.
   * `false` turns the feature off.
   */
  settings?: Pick<ChartSettingsOptions, 'sections' | 'fields' | 'actions' | 'storage' | 'storageKey'> | false;
  /**
   * The visible data as an accessible table panel; open it with `shell.tableView.open()`
   * or `tableViewToolbarItem()`. `false` turns the feature off.
   */
  tableView?: Pick<TableViewOptions, 'maxRows' | 'title'> | false;
  /** Right-click menu; `false` keeps the browser's menu. Defaults to the built-in items. */
  contextMenu?: ContextMenuOptions | false;
  /**
   * Indicator picker (open it with `shell.indicatorPicker.open()`, `indicatorPickerToolbarItem()`
   * or `/` on the focused chart; with a symbol search, which keeps `/`, no shortcut unless
   * `openOnSlash` is set or the `'indicator-picker'` action is bound). Recents and favourites are saved to `localStorage` under
   * `storageKey` unless `storage` or `settings` replaces it. With the command palette, the palette lists the
   * indicators and the picker's footer hands its query to the palette. `false` turns the feature off.
   */
  indicatorPicker?: Omit<IndicatorPickerOptions, 'container' | 'onOpenChange'> | false;
  /**
   * Indicator templates (open them with `indicatorTemplatesToolbarItem()` or
   * `shell.indicatorTemplates`). Saved templates go to `createLocalStorageAdapter()`
   * unless `storage` replaces it; `false` turns the feature off.
   */
  indicatorTemplates?: Omit<IndicatorTemplatesOptions, 'container'> | false;
  /** Initial colour scheme for both the chrome and the chart. Default `system`. */
  theme?: ShellTheme;
  /** Initial up and down colours (`data-pc-palette` on the shell). Default `default`. */
  palette?: ShellPalette;
  /**
   * `rtl` mirrors the toolbar, rail, menus, dialogs and panels, and passes on
   * to the chart's `direction` (main price axis on the left, legend and
   * buttons mirrored); the plot and time axis keep time running left to
   * right. `ltr` and `rtl` set `dir` on the shell. Default `auto`, which
   * follows the page.
   */
  direction?: ShellDirection;
  /**
   * How the toolbar, rail and bottom bar sit around the chart: one style for
   * all three, or an object for each (parts left out float). `floating` (the
   * default) makes rounded cards inset from the shell's edges, `docked` square
   * strips flush with them, `inset` unfilled parts on the shell background
   * around a rounded chart. The `--pc-panel-radius` and `--pc-panel-inset`
   * tokens set the rounding and the space at the edges.
   */
  panels?: ShellPanelStyle | Partial<ShellPanels>;
  /**
   * Show or hide shell parts. Toolbar, rail and bottom bar are on by default;
   * the pointer tooltip (`tooltip`) and the compact layout (`railSheet`) are off.
   */
  features?: Partial<ShellFeatures>;
  /** Format, delay and anchor of the pointer tooltip the `tooltip` flag shows. */
  tooltip?: PointerTooltipOptions;
  /**
   * Shell width (css px) below which the `railSheet` flag turns the rail into a
   * bottom sheet and the range presets into a menu. Measured on the shell, not
   * the window. Default 640.
   */
  railBreakpoint?: number;
  /** Extra class names for theming. */
  className?: string;
  /** Extra class names for the shell's parts, as stable hooks for app CSS. */
  classNames?: ShellClassNames;
  /**
   * App content mounted in the shell: above or below the rail, at either end
   * of the bottom bar, and over the chart for the loading and empty states.
   */
  slots?: ShellSlots;
  /**
   * Toasts, made by `toasts()`: a stack over the chart for `chart.notify`
   * messages no `ui:notify` listener prevented, and for a status that would
   * cover bars (reconnecting, stale, or loading and errors once bars are
   * shown). Off when left out: those statuses keep the chart's in-pane text.
   */
  toasts?: ToastsPart;
}

/** Events emitted by a chart shell, by name: theme, palette and color preset changes, and the rail or toolbar being shown or hidden. */
export interface ShellEvents {
  /**
   * `setTheme` changed the theme, the OS scheme changed while the theme is `system`, forced
   * colours (an OS high-contrast mode) turned on or off, or a re-read of the CSS chart tokens
   * (see `refreshTheme`) changed the chart colours.
   */
  'theme:change': { theme: ShellTheme; resolved: 'dark' | 'light' };
  /** `setPalette` switched the up and down colours. */
  'palette:change': { palette: ShellPalette };
  /**
   * The colour preset changed: picked in the appearance panel or set with
   * `setColorPreset`. `preset` is its id, null for the default theme. A theme
   * switch keeps the preset and emits `theme:change` instead.
   */
  'preset:change': { preset: string | null };
  /** The rail was shown or hidden. Read the current state from `shell.rail.visible`. */
  'rail:change': { visible: boolean };
  /** The toolbar was shown or hidden. Read the current state from `shell.toolbar.visible`. */
  'toolbar:change': { visible: boolean };
}

/**
 * A chart with its shell made by `createChartShell`: the root element, the
 * core `chart`, and handles of the toolbar, tool rail, bottom bar, dialogs and
 * panels it created (null for parts turned off).
 */
export interface ChartShell {
  el: HTMLElement;
  chart: Chart;
  toolbar: ToolbarHandle | null;
  rail: ToolRailHandle | null;
  bottomBar: BottomBarHandle | null;
  /** The overview strip; null unless the `navigator` option is set. */
  navigator: NavigatorHandle | null;
  /** Favourite drawing tools and their bar; null without the `favorites` option. */
  favorites: ShellFavorites | null;
  /** The symbol search dialog; null without the `symbolSearch` option. Open it from a toolbar item with `open()`. */
  symbolSearch: SymbolSearchDialog | null;
  /** The command palette; null without the `commandPalette` option. Add entries with `addSource`. */
  commandPalette: CommandPalette | null;
  drawingToolbar: DrawingToolbarHandle | null;
  /** Present unless `drawingSettings` is false; `open(id)` shows a drawing's settings. */
  drawingSettings: DrawingSettingsHandle | null;
  /** Present unless `indicatorSettings` is false; `open(indicator)` shows an indicator's settings. */
  indicatorSettings: IndicatorSettingsHandle | null;
  /** Present unless `indicatorSettings` is false; `open(series)` shows a compared symbol's or plain series' style panel. */
  seriesSettings: SeriesSettingsHandle | null;
  /** The bar replay strip; null without the `replayControls` option. */
  replayControls: ReplayControlsHandle | null;
  /** The order cluster list; null without the `clusterList` option. */
  clusterList: ClusterListHandle | null;
  /** The order draft keypad and type menu; null without the `draftEditor` option. */
  draftEditor: DraftEditorHandle | null;
  appearance: AppearanceHandle | null;
  /** The chart settings dialog; null with `settings: false`. */
  settings: ChartSettingsHandle | null;
  tableView: TableViewHandle | null;
  contextMenu: ContextMenuHandle | null;
  indicatorPicker: IndicatorPickerHandle | null;
  /** Indicator templates; null with `indicatorTemplates: false`. */
  indicatorTemplates: IndicatorTemplatesHandle | null;
  /** The stack showing `chart.notify` messages; null without the `toasts` option. */
  toasts: ToastStackHandle | null;
  /** Current shell flags; change them with `applyFeatures`. */
  readonly features: Readonly<ShellFeatures>;
  /** Show or hide shell parts; flags left out keep their value. */
  applyFeatures(features: Partial<ShellFeatures>): void;
  /** Current panel style of each part; change them with `setPanels`. */
  readonly panels: Readonly<ShellPanels>;
  /** Restyle every part, or the parts given; parts left out keep their style. */
  setPanels(panels: ShellPanelStyle | Partial<ShellPanels>): void;
  readonly theme: ShellTheme;
  /** The scheme in effect: `theme`, with `system` resolved through the OS setting. */
  readonly resolvedTheme: 'dark' | 'light';
  /** Switch chrome and chart colours together. */
  setTheme(theme: ShellTheme): void;
  readonly palette: ShellPalette;
  /** Switch the up and down colours of the chrome and the chart, over the current theme. */
  setPalette(palette: ShellPalette): void;
  readonly direction: ShellDirection;
  /** Lay the chrome and the chart's defaults out left to right, right to left, or as the page does (`auto`). */
  setDirection(direction: ShellDirection): void;
  /** Id of the colour preset in use; null for the default theme or without the appearance feature. */
  readonly colorPreset: string | null;
  /**
   * Restyle chrome and chart with a colour preset of the appearance panel (by id), or go
   * back to the default theme with null. The preset's variant follows the theme's
   * resolved scheme. Unknown ids do nothing.
   */
  setColorPreset(id: string | null): void;
  /** Re-read the CSS chart tokens, e.g. after changing a stylesheet. */
  refreshTheme(): void;
  /** Subscribe to shell events; returns an unsubscribe function. */
  on<K extends keyof ShellEvents>(event: K, listener: (payload: ShellEvents[K]) => void): () => void;
  destroy(): void;
}

/** What toolbar presets need from the shell around a chart. */
export interface ShellParts {
  el: HTMLElement;
  rail: ToolRailHandle | null;
  /** Set once the shell has created it; null without the `symbolSearch` option. */
  symbolSearch?: SymbolSearchDialog | null;
}

const shellParts = new WeakMap<Chart, ShellParts>();

/** Internal: the element and rail of the shell holding `chart`, once the shell has mounted them. */
export function shellPartsOf(chart: Chart): ShellParts | undefined {
  return shellParts.get(chart);
}

/**
 * Shell layout: toolbar on top, tool rail on the left, chart with a bottom bar.
 * Requires `@charton/ui/style.css`.
 *
 * @example
 * ```ts
 * import { createChartShell, intervals } from '@charton/ui';
 * import '@charton/ui/style.css';
 *
 * const { chart } = createChartShell(el, { toolbar: [intervals(['1m', '1h', '1d'])] });
 * chart.addCandles({ title: 'Price' }).setData(bars);
 * ```
 */
export function createChartShell(container: HTMLElement, options: ChartShellOptions = {}): ChartShell {
  devCheck('createChartShell', options, 'shell');
  const classNames = options.classNames ?? {};
  const slots = options.slots ?? {};
  // Slot wrappers the shell mounted, removed on destroy so app content leaves the page with it.
  const slotEls: HTMLElement[] = [];
  const mountSlot = (name: string, content: ShellSlots[keyof ShellSlots]) => {
    const slot = renderSlot(name, content, chart);
    if (slot) slotEls.push(slot);
    return slot;
  };
  const el = h('div', { class: `pc-shell ${options.className ?? ''}`.trim() });
  addClasses(el, classNames.root);
  if (classNames.dialog?.trim()) setDialogClass(el, classNames.dialog.trim());
  const top = h('div', { class: 'pc-shell-top' });
  const body = h('div', { class: 'pc-shell-body' });
  const side = h('div', { class: 'pc-shell-side' });
  const main = h('div', { class: 'pc-shell-main' });
  const stage = h('div', { class: 'pc-stage' });
  main.append(stage);
  body.append(side, main);
  el.append(top, body);
  container.append(el);

  // Keyed by event; each set only ever holds listeners for its own event's payload.
  const listeners = new Map<keyof ShellEvents, Set<(payload: never) => void>>();
  const emit = <K extends keyof ShellEvents>(event: K, payload: ShellEvents[K]) =>
    listeners.get(event)?.forEach((l) => (l as (payload: ShellEvents[K]) => void)(payload));
  // Framework wrappers may unmount twice (development double mounting); the second destroy does nothing.
  let destroyed = false;

  let theme: ShellTheme = options.theme ?? 'system';
  const systemLight = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
  const resolved = (): 'dark' | 'light' => (theme === 'system' ? (systemLight?.matches ? 'light' : 'dark') : theme);
  // No data-theme lets the stylesheet's prefers-color-scheme block apply.
  const markTheme = () => {
    if (theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
  };
  let palette: ShellPalette = options.palette ?? 'default';
  const markPalette = () => {
    if (palette === 'default') el.removeAttribute('data-pc-palette');
    else el.setAttribute('data-pc-palette', palette);
  };
  // The OS high-contrast setting (forced colours) recolours the chrome but not the canvas.
  const forcedColors = typeof matchMedia === 'function' ? matchMedia('(forced-colors: active)') : null;
  // Forced colours > user overrides > JS theme > CSS tokens > built-in theme for the resolved scheme.
  // The system palette wins, as it does for the rest of the page; it is null until the shell is attached.
  let appearance: AppearanceHandle | null = null;
  const forcedTheme = (): ChartTheme | null => (forcedColors?.matches ? forcedColorsTheme(readBaseTheme(), el) : null);
  // The high-contrast class sets the colours, so a colour preset waits until it is removed.
  const highContrast = () => el.classList.contains('pc-theme-high-contrast');
  const readTheme = (): ChartTheme =>
    forcedTheme() ??
    (appearance && (highContrast() ? themeWithOverrides(readBaseTheme(), appearance.overrides) : appearance.theme())) ??
    readBaseTheme();
  const readBaseTheme = (): ChartTheme => {
    // The palette also applies without the stylesheet's tokens.
    const css = themeFromCss(el, {
      ...(resolved() === 'light' ? lightTheme : darkTheme),
      ...(palette === 'color-safe' ? colorSafeUpDown[resolved()] : {}),
    });
    const own = options.chart?.theme;
    // A JS typography block refines the CSS one per surface instead of replacing it.
    const typography = mergeTypography(css.typography, own?.typography);
    return { ...css, ...own, ...(typography && { typography }) };
  };

  // A preset sets the chrome tokens of its variant for the resolved scheme inline; null removes them.
  // Inline tokens win over the stylesheet's, so the CSS chart tokens follow the preset too.
  let presetTokens: string[] = [];
  const usePreset = (preset: ColorPreset | null): void => {
    for (const name of presetTokens) el.style.setProperty(name, '');
    presetTokens = [];
    if (!preset || highContrast()) return;
    for (const [name, value] of Object.entries(presetShellTokens(preset, resolved()))) {
      el.style.setProperty(name, value);
      presetTokens.push(name);
    }
  };
  // A scheme switch (also through `system`) moves the preset to its other variant.
  const restylePreset = () => usePreset(appearance?.preset ?? null);

  let direction: ShellDirection = options.direction ?? 'auto';
  const markDirection = () => (direction === 'auto' ? el.removeAttribute('dir') : el.setAttribute('dir', direction));

  let panels = resolveShellPanels(defaultShellPanels, options.panels);

  markTheme();
  markPalette();
  markDirection();
  markShellPanels(el, panels);
  let current = readTheme();
  // Core makes annotations, heatmaps, volume profiles and drawings opt-in; the shell has them all unless the app picks.
  // The chart takes the shell's direction (its price axis, legend and buttons follow it) unless the app gives it one.
  const chart = mountChart(el, stage, { direction, ...options.chart, plugins: shellPlugins(options.chart?.plugins ?? builtins()), theme: current });

  // Shell flags; `toolbar` and `rail` follow their parts' visibility, whichever API changed it.
  let features: ShellFeatures = { ...defaultShellFeatures };
  // Before the toolbar, so favourites presets in it find the favourites (`favoritesOf`).
  const favorites: FavoritesController | null = options.favorites?.(chart) ?? null;

  const toolbarOptions = options.toolbar ?? defaultToolbarItems();
  const mountedToolbar = !Array.isArray(toolbarOptions) || toolbarOptions.length
    ? mountToolbar(top, chart, toolbarOptions, el) : null;
  const toolbar = mountedToolbar?.handle ?? null;
  if (mountedToolbar) {
    addClasses(mountedToolbar.handle.el, classNames.toolbar);
    // Hide the whole strip, not just the toolbar, so no empty panel is left behind.
    mountedToolbar.visibility.onChange((visible) => {
      top.hidden = !visible;
      features.toolbar = visible;
      emit('toolbar:change', { visible });
    });
  } else {
    top.remove();
  }

  const railOptions: RailOptions | false = Array.isArray(options.rail) ? { items: options.rail } : (options.rail ?? {});
  const mountedRail =
    railOptions === false ? null : mountToolRail(side, chart, railOptions.items ?? defaultRailItems(chart.drawings.getTools()), favorites);
  const rail = mountedRail?.handle ?? null;
  if (mountedRail) {
    addClasses(mountedRail.handle.el, classNames.rail);
    const railTop = mountSlot('rail-top', slots.railTop);
    const railBottom = mountSlot('rail-bottom', slots.railBottom);
    if (railTop) side.insertBefore(railTop, mountedRail.handle.el);
    if (railBottom) side.append(railBottom);
    // Stack the slots above and below the rail instead of beside it.
    if (railTop || railBottom) addClasses(side, 'pc-shell-side--slots');
    // The stage grows into the freed space through the chart's ResizeObserver.
    mountedRail.visibility.onChange((visible) => {
      side.hidden = !visible;
      features.rail = visible;
      emit('rail:change', { visible });
      // A rail toggle in the toolbar shows the new state, whichever API changed it.
      toolbar?.refresh();
    });
    if (railOptions && railOptions.visible === false) mountedRail.visibility.setVisible(false);
  } else {
    side.remove();
  }

  // Toolbar presets find the shell element and rail through the chart they act on.
  const parts: ShellParts = { el, rail };
  shellParts.set(chart, parts);
  toolbar?.refresh();

  // Plugins installed on the shell's chart can add toolbar items (see `shellOf`).
  chart.setPluginHost('shell', createShellHost(toolbar));
  const navigatorStrip = options.navigator ? createNavigator(main, chart, options.navigator === true ? {} : options.navigator) : null;
  // Off unless asked for; `true` gives the default items.
  const bottomBarInput = options.bottomBar ?? false;
  const bottomBarOptions = bottomBarInput === false ? null : bottomBarToolbarOptions(bottomBarInput === true ? {} : bottomBarInput);
  const mountedBottomBar = bottomBarOptions?.items.length ? mountBottomBar(main, chart, bottomBarOptions, el) : null;
  const bottomBar = mountedBottomBar?.handle ?? null;
  if (mountedBottomBar) {
    const { wrap } = mountedBottomBar;
    addClasses(wrap, classNames.bottomBar);
    const start = mountSlot('bottom-bar-start', slots.bottomBarStart);
    const end = mountSlot('bottom-bar-end', slots.bottomBarEnd);
    if (start) wrap.insertBefore(start, wrap.firstElementChild);
    if (end) wrap.append(end);
    mountedBottomBar.visibility.onChange((visible) => {
      features.bottomBar = visible;
      layout.refresh();
    });
    // With customization on both bars, users can move items between them.
    linkToolbarCustomizations(mountedToolbar?.customization ?? null, mountedBottomBar.customization);
  }
  // Toasts first: the status toast takes statuses over bars before the loading slot sees them.
  const toasts = options.toasts?.(stage, chart) ?? null;
  const statusSlot = createStatusSlot(stage, chart, slots);
  const commandPalette = options.commandPalette?.(chart, el, () => toolbar?.refresh()) ?? null;
  // The palette takes Mod+K; the symbol search keeps `/` and is listed in the palette.
  const symbolSearch = options.symbolSearch?.(chart, el, commandPalette ? ['/'] : ['Mod+K', '/'], favorites?.of('symbol')) ?? null;
  // The symbol header preset opens it, and is disabled without one.
  parts.symbolSearch = symbolSearch;
  toolbar?.refresh();
  const drawingSettings =
    options.drawingSettings === false
      ? null
      : createDrawingSettings(chart, el, typeof options.drawingSettings === 'object' ? options.drawingSettings : {});
  const drawingToolbar =
    options.drawingToolbar === false
      ? null
      : createDrawingToolbar(chart, drawingSettings ? { onSettings: (id) => drawingSettings.open(id) } : {});
  // The default toolbar has the replay button, so it brings the strip that drives a replay.
  const replayControls =
    options.replayControls?.(chart) ?? (options.toolbar === undefined && replayOf(chart) ? createReplayControls(chart) : null);
  const clusterList = options.clusterList?.(chart) ?? null;
  const draftEditor = options.draftEditor?.(chart) ?? null;
  if (options.appearance !== false) {
    appearance = createAppearance(chart, {
      baseTheme: readBaseTheme,
      baseGrid: options.chart?.grid ?? {},
      ...(options.appearance?.storage !== undefined ? { storage: options.appearance.storage } : {}),
      ...(options.appearance?.storageKey !== undefined ? { storageKey: options.appearance.storageKey } : {}),
      ...(options.appearance?.presets !== undefined ? { presets: options.appearance.presets } : {}),
      ...(options.appearance?.defaultPreset !== undefined ? { defaultPreset: options.appearance.defaultPreset } : {}),
      mode: resolved,
      // The panel's Light and Dark buttons switch the shell theme.
      setMode: (mode) => setTheme(mode),
      // Keep the toolbar button's pressed state in step however the panel opens or closes.
      onOpenChange: () => toolbar?.refresh(),
      onPresetChange: (preset) => {
        // While the appearance is being created, a saved preset only sets the tokens;
        // the theme is applied once below.
        if (!appearance) return usePreset(preset);
        usePreset(preset);
        applyTheme(false);
        toolbar?.refresh();
        emit('preset:change', { preset: preset?.id ?? null });
      },
    });
    // Creating it applied the saved overrides; a saved preset needs the whole theme, and in
    // forced colours the system palette goes back on top.
    const next = readTheme();
    if (forcedColors?.matches || appearance.preset) chart.applyOptions({ theme: next });
    current = next;
  }
  const settings =
    options.settings === false
      ? null
      : createChartSettings(chart, el, {
          ...options.settings,
          appearance,
          onOpenChange: () => toolbar?.refresh(),
        });
  // The bottom bar and toolbar came first; the clock and the settings cog open these settings now that they exist.
  bottomBar?.refresh();
  toolbar?.refresh();
  const tableView =
    options.tableView === false
      ? null
      : createTableView(chart, {
          ...options.tableView,
          // Keep the toolbar button's pressed state in step however the panel opens or closes.
          onOpenChange: () => toolbar?.refresh(),
        });
  const contextMenu = options.contextMenu === false ? null : createContextMenu(chart, options.contextMenu ?? {});
  const indicatorSettings = options.indicatorSettings === false ? null : createIndicatorSettings(chart, stage, typeof options.indicatorSettings === 'object' ? options.indicatorSettings : {});
  const seriesSettings = options.indicatorSettings === false ? null : createSeriesSettings(chart, stage);
  const indicatorPicker =
    options.indicatorPicker === false
      ? null
      : createIndicatorPicker(chart, {
          // The settings button on rows of indicators on the chart opens the shell's settings dialog.
          ...(indicatorSettings ? { onSettings: (indicator: Indicator) => void indicatorSettings.open(indicator) } : {}),
          // The symbol search keeps `/`: no second action on the same key, unless the app asks for it.
          ...(symbolSearch ? { openOnSlash: false as const } : {}),
          // The footer hands the query on to the command palette.
          ...(commandPalette ? { onSearchAll: (query: string) => commandPalette.open(query) } : {}),
          // Starred indicators join the other favourites in one record.
          ...(favorites ? { favorites: favorites.of('indicator') } : {}),
          ...options.indicatorPicker,
          container: el,
          onOpenChange: () => toolbar?.refresh(),
        });
  // The palette lists the picker's indicators and the settings sections too, unless the app has its own source of that id.
  for (const source of [indicatorPicker?.commandSource, settings?.commandSource]) {
    try {
      if (source) commandPalette?.addSource(source);
    } catch {}
  }
  const indicatorTemplates =
    options.indicatorTemplates === false ? null : createIndicatorTemplates(chart, { ...options.indicatorTemplates, container: el });
  // The main series' settings button opens the chart settings.
  const offMainSettings = indicatorSettings && settings ? mainSeriesSettings(chart, () => settings.open('series')) : null;
  const layout = createCompactLayout({
    shell: el,
    side,
    stage,
    chart,
    rail,
    bottomBar: () => (mountedBottomBar && !mountedBottomBar.wrap.hidden ? mountedBottomBar.wrap : null),
    breakpoint: options.railBreakpoint ?? defaultRailBreakpoint,
  });
  mountedRail?.visibility.onChange(() => layout.refresh());

  // Keyboard: one Tab stop per bar with arrow keys inside, F6 between areas, arrow keys in menus.
  const labelToolbar = () => toolbar?.el.setAttribute('aria-label', shellText(chart, 'toolbarLabel'));
  labelToolbar();
  const offLabel = chart.on('localization:change', labelToolbar);
  const groups = new Map<HTMLElement, RovingGroup>();
  for (const part of [toolbar, rail, bottomBar]) if (part) groups.set(part.el, rovingFocus(part.el));
  const groupRegion = (part: { el: HTMLElement } | null) => part && { el: part.el, focus: () => groups.get(part.el)!.focus() };
  const offRegions = bindRegionKeys(chart, el, () =>
    [
      groupRegion(toolbar),
      groupRegion(rail),
      { el: chart.root, focus: () => (chart.root.focus(), true) },
      navigatorStrip && { el: navigatorStrip.el, focus: () => focusFirst(navigatorStrip.el, '.pc-navigator-window') },
      groupRegion(bottomBar),
    ].filter((r) => r !== null),
  );
  const offMenus = bindMenuKeys(el);
  // The chart's focus ring is for keyboard navigation: it shows once Tab or F6 moves focus, and
  // hides (`data-pc-pointer`) from the start and after a pointer press. Shortcuts and Escape keep
  // it hidden, since focus a dialog hands back to the chart still counts as :focus-visible. On
  // the document, so Tab from the page shows it.
  const doc = el.ownerDocument;
  const onPointerInput = () => el.setAttribute('data-pc-pointer', '');
  const onKeyInput = (e: KeyboardEvent) => {
    if (e.key === 'Tab' || e.key === 'F6') el.removeAttribute('data-pc-pointer');
  };
  onPointerInput();
  doc.addEventListener('pointerdown', onPointerInput, true);
  doc.addEventListener('keydown', onKeyInput, true);
  const releaseTips = retainTips();
  let pointerTooltip: PointerTooltipHandle | null = null;

  // Re-read the tokens; emits when the chart colours changed, or always when `force` is set.
  const applyTheme = (force: boolean) => {
    const next = readTheme();
    // Skip no-op refreshes: a theme change rebuilds every series.
    const changed = JSON.stringify(next) !== JSON.stringify(current);
    if (changed) {
      current = next;
      chart.applyOptions({ theme: next });
    }
    if (changed || force) emit('theme:change', { theme, resolved: resolved() });
  };
  const refreshTheme = () => applyTheme(false);
  const setTheme = (next: ShellTheme): void => {
    const changed = next !== theme;
    theme = next;
    markTheme();
    restylePreset();
    applyTheme(changed);
    toolbar?.refresh();
  };

  // The settings dialog, the appearance panel and the theme as actions, so the command palette lists
  // them and users can bind keys to them.
  const shellAction = (id: string, label: ShellMessageKey, run: () => void, checked?: () => boolean) =>
    chart.actions.has(id) ? () => {} : chart.actions.register({ id, label: () => shellText(chart, label), run, ...(checked ? { checked } : {}) });
  const panel = appearance;
  const offShellActions = [
    settings ? shellAction('chart-settings', 'chartSettingsTitle', () => void settings.open()) : null,
    panel ? shellAction('appearance', 'menuAppearance', () => panel.toggle(), () => panel.isOpen) : null,
    shellAction('light-mode', 'actionLightMode', () => setTheme('light'), () => resolved() === 'light'),
    shellAction('dark-mode', 'actionDarkMode', () => setTheme('dark'), () => resolved() === 'dark'),
  ];

  // Theme classes, data-theme and inline token overrides all change what the tokens resolve to.
  let wasHighContrast = highContrast();
  const observer = new MutationObserver(() => {
    if (wasHighContrast !== highContrast()) {
      wasHighContrast = !wasHighContrast;
      restylePreset();
    }
    refreshTheme();
  });
  observer.observe(el, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-pc-palette', 'style'] });
  const onSystemChange = () => {
    if (theme !== 'system') return;
    restylePreset();
    applyTheme(true);
  };
  systemLight?.addEventListener('change', onSystemChange);
  const onForcedChange = () => applyTheme(true);
  forcedColors?.addEventListener('change', onForcedChange);
  // Computed styles are empty until the container is in the document, so read the tokens
  // again once a shell created before attaching has had a frame to be attached.
  const attachFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(refreshTheme) : 0;

  // Hide rather than remove so state and listeners survive; the chart resizes through its ResizeObserver.
  // Toolbar and rail go through their visibility controls, so `*:change` events fire and `visible` stays in sync.
  const applyFeatures = (patch: Partial<ShellFeatures> = {}) => {
    features = resolveShellFeatures(features, patch);
    if (patch.toolbar !== undefined) mountedToolbar?.visibility.setVisible(features.toolbar);
    if (patch.rail !== undefined) mountedRail?.visibility.setVisible(features.rail);
    if (patch.bottomBar !== undefined) mountedBottomBar?.visibility.setVisible(features.bottomBar);
    if (features.tooltip && !pointerTooltip) pointerTooltip = createPointerTooltip(chart, options.tooltip);
    else if (!features.tooltip && pointerTooltip) {
      pointerTooltip.destroy();
      pointerTooltip = null;
    }
    layout.setEnabled(features.railSheet);
    if (patch.commandPalette !== undefined) {
      commandPalette?.setEnabled(features.commandPalette);
      toolbar?.refresh();
    }
  };
  applyFeatures(options.features);

  return {
    el,
    chart,
    toolbar,
    rail,
    bottomBar,
    navigator: navigatorStrip,
    favorites,
    symbolSearch,
    commandPalette,
    drawingToolbar,
    drawingSettings,
    indicatorSettings,
    seriesSettings,
    replayControls,
    clusterList,
    draftEditor,
    appearance,
    settings,
    tableView,
    contextMenu,
    indicatorPicker,
    indicatorTemplates,
    toasts,
    get features() {
      return { ...features };
    },
    applyFeatures(patch) {
      devCheck('applyFeatures', patch, 'features');
      applyFeatures(patch);
    },
    get panels() {
      return { ...panels };
    },
    setPanels(next) {
      devCheck('setPanels', next, 'panels');
      panels = resolveShellPanels(panels, next);
      markShellPanels(el, panels);
    },
    get theme() {
      return theme;
    },
    get resolvedTheme() {
      return resolved();
    },
    setTheme,
    get palette() {
      return palette;
    },
    setPalette(next) {
      if (next === palette) return;
      palette = next;
      markPalette();
      applyTheme(false);
      emit('palette:change', { palette });
    },
    get direction() {
      return direction;
    },
    setDirection(next) {
      direction = next;
      markDirection();
      chart.applyOptions({ direction });
    },
    get colorPreset() {
      return appearance?.preset?.id ?? null;
    },
    setColorPreset(id) {
      appearance?.setPreset(id);
    },
    refreshTheme,
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(listener);
      return () => set.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (attachFrame) cancelAnimationFrame(attachFrame);
      observer.disconnect();
      for (const off of offShellActions) off?.();
      systemLight?.removeEventListener('change', onSystemChange);
      forcedColors?.removeEventListener('change', onForcedChange);
      toolbar?.destroy();
      rail?.destroy();
      favorites?.destroy();
      bottomBar?.destroy();
      navigatorStrip?.destroy();
      offLabel();
      groups.forEach((group) => group.destroy());
      offRegions();
      offMenus();
      doc.removeEventListener('pointerdown', onPointerInput, true);
      doc.removeEventListener('keydown', onKeyInput, true);
      releaseTips();
      symbolSearch?.destroy();
      commandPalette?.destroy();
      drawingToolbar?.destroy();
      drawingSettings?.destroy();
      indicatorSettings?.destroy();
      seriesSettings?.destroy();
      offMainSettings?.();
      replayControls?.destroy();
      clusterList?.destroy();
      draftEditor?.destroy();
      settings?.destroy();
      appearance?.destroy();
      tableView?.destroy();
      contextMenu?.destroy();
      indicatorPicker?.destroy();
      indicatorTemplates?.destroy();
      pointerTooltip?.destroy();
      statusSlot?.destroy();
      slotEls.forEach((slot) => slot.remove());
      toasts?.destroy();
      layout.destroy();
      chart.destroy();
      listeners.clear();
      el.remove();
    },
  };
}

/** Focus the first `selector` match in `root`; false when there is none. */
function focusFirst(root: HTMLElement, selector: string): boolean {
  const target = root.querySelector<HTMLElement>(selector);
  target?.focus();
  return !!target;
}

/**
 * The app's plugins, after data sources, indicators, compared symbols, drawings (without
 * built-in tools), annotations, bar replay, the watermark, saved layouts and image capture when it
 * leaves them out: the shell's rail, menus, panels, replay controls, appearance
 * panel and screenshot buttons work on them. Trading goes
 * last, since it needs annotations.
 */
function shellPlugins(plugins: readonly ChartPlugin[]): readonly ChartPlugin[] {
  const missing = (p: ChartPlugin) => !plugins.some((own) => own.name === p.name);
  const needed = [dataSource(), indicators(), comparisons(), drawings(), annotations(), replay(), sourceMarkers(), adjustments(), watermark(), layouts(), imageCapture()].filter(missing);
  const after = [trading()].filter(missing);
  return needed.length + after.length > 0 ? [...needed, ...plugins, ...after] : plugins;
}

/**
 * Create the chart. If that fails (no WebGL2, a shader error), remove the shell
 * so the container is left as it was, and rethrow for the app to show its own fallback.
 */
function mountChart(el: HTMLElement, stage: HTMLElement, options: ChartOptionsPatch): Chart {
  try {
    return createChart(stage, options);
  } catch (error) {
    el.remove();
    throw error;
  }
}

/** Open `open` from the main series' legend settings button; returns a function that stops. */
function mainSeriesSettings(chart: Chart, open: () => void): () => void {
  const offProvider = chart.provideSeriesSettings((series) => series === chart.main);
  const offSettings = chart.on('series:settings', ({ series, indicator }) => {
    if (!indicator && series === chart.main) open();
  });
  return () => {
    offProvider();
    offSettings();
  };
}
