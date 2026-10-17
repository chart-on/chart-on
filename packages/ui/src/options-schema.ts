/**
 * What `createChartShell` and `createChartGrid` options accept, for development-build warnings.
 * Each `OptionShape` names every field of its interface, so a new option
 * without a rule fails to compile. Built on first use behind a `NODE_ENV`
 * test that bundlers fold, so production bundles drop it.
 */
import { ChartError, checkOptions, either, int, num, oneOf, shape, type Chart, type LinkGroupOptions, type OptionShape } from '@charton/core';
import type { AppearanceOptions } from './appearance';
import type { BottomBarOptions } from './bottombar';
import type { ChartSettingsOptions } from './chart-settings';
import type { CommandPaletteOptions } from './command-palette';
import type { ContextMenuOptions } from './context-menu';
import type { DraftEditorOptions } from './draft-editor';
import type { DrawingSettingsOptions } from './drawing-settings';
import type { IndicatorSettingsOptions } from './indicator-settings';
import type { IndicatorTemplatesOptions } from './indicator-templates';
import type { IndicatorPickerOptions } from './indicator-picker';
import type { FavoritesOptions } from './favorites';
import type { NavigatorOptions } from './navigator';
import type { ShellFeatures } from './features';
import type { ChartGridLayout, ChartGridOptions } from './grid';
import type { ShellPanels, ShellPanelStyle } from './panels';
import type { PointerTooltipOptions } from './pointer-tooltip';
import type { ChartShellOptions, RailOptions, ShellDirection, ShellPalette, ShellTheme } from './shell';
import type { ShellClassNames, ShellSlots } from './slots';
import type { SymbolSearchOptions } from './symbol-search';
import type { TableViewOptions } from './table-view';
import type { ToolbarOptions } from './toolbar';
import type { ToolbarCustomizationOptions } from './toolbar-customization';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

function buildRules() {
  const features = shape<ShellFeatures>({
    toolbar: 'boolean',
    rail: 'boolean',
    bottomBar: 'boolean',
    tooltip: 'boolean',
    railSheet: 'boolean',
    commandPalette: 'boolean',
  });
  // An element or a function that builds one.
  const slot = either('object', 'function');
  const menu = shape<{ options: unknown; value?: string }>({ options: 'array', value: 'string' });
  const toolbarFields = { items: 'array', customize: 'function', settings: 'object', dividers: 'boolean', storageKey: 'string' } as const;
  const toolbar = either('array', shape<ToolbarOptions>(toolbarFields));
  const panelStyle = oneOf<ShellPanelStyle>({ floating: 0, docked: 0, inset: 0 });
  const panels = either(panelStyle, shape<ShellPanels>({ toolbar: panelStyle, rail: panelStyle, bottomBar: panelStyle }));
  const shell: OptionShape<ChartShellOptions> = {
    // `createChart` checks these itself.
    chart: 'object',
    toolbar,
    rail: either('array', 'boolean', shape<RailOptions>({ items: 'array', visible: 'boolean' })),
    // Items as for the toolbar, or the shorthand for the default items.
    bottomBar: either(
      'boolean',
      'array',
      shape<BottomBarOptions & ToolbarOptions>({
        ...toolbarFields,
        ranges: 'array',
        onRange: 'function',
        clock: 'boolean',
        goToDate: 'boolean',
        scaleToggles: either('boolean', oneOf<'menu' | 'inline'>({ menu: 0, inline: 0 })),
        timezones: menu,
        sessions: menu,
        sessionBands: 'object',
      }),
    ),
    navigator: either('boolean', shape<NavigatorOptions>({ height: num(1), series: 'object' })),
    // Parts made by their factories (`favorites()` and the others), which check their own options.
    favorites: 'function',
    symbolSearch: 'function',
    commandPalette: 'function',
    drawingToolbar: 'boolean',
    drawingSettings: either('boolean', shape<DrawingSettingsOptions>({ headerControl: 'function' })),
    indicatorSettings: either('boolean', shape<Pick<IndicatorSettingsOptions, 'headerControl'>>({ headerControl: 'function' })),
    replayControls: 'function',
    clusterList: 'function',
    draftEditor: 'function',
    appearance: either(
      'boolean',
      shape<Pick<AppearanceOptions, 'storage' | 'storageKey' | 'presets'>>({ storage: 'object', storageKey: 'string', presets: either('boolean', 'array') }),
    ),
    settings: either(
      'boolean',
      shape<Pick<ChartSettingsOptions, 'sections' | 'storage' | 'storageKey'>>({ sections: 'function', storage: 'object', storageKey: 'string' }),
    ),
    tableView: either('boolean', shape<Pick<TableViewOptions, 'maxRows' | 'title'>>({ maxRows: int(0), title: 'string' })),
    contextMenu: either('boolean', shape<ContextMenuOptions>({ items: 'function', onError: 'function' })),
    indicatorPicker: either(
      'boolean',
      shape<Omit<IndicatorPickerOptions, 'container' | 'onOpenChange'>>({
        filter: 'function',
        onAdd: 'function',
        initialState: 'function',
        onSettings: 'function',
        actions: 'array',
        groups: 'array',
        sourceSwitch: 'boolean',
        favorites: 'object',
        placement: oneOf<'overlay' | 'pane'>({ overlay: 0, pane: 0 }),
        storage: 'object',
        settings: 'object',
        storageKey: 'string',
        addOptions: 'object',
        debounce: num(0),
        openOnSlash: either('boolean', 'object'),
        onSearchAll: 'function',
      }),
    ),
    indicatorTemplates: either('boolean', shape<Omit<IndicatorTemplatesOptions, 'container'>>({ storage: 'object', presets: 'array' })),
    theme: oneOf<ShellTheme>({ dark: 0, light: 0, system: 0 }),
    palette: oneOf<ShellPalette>({ default: 0, 'color-safe': 0 }),
    direction: oneOf<ShellDirection>({ ltr: 0, rtl: 0, auto: 0 }),
    panels,
    features,
    tooltip: shape<PointerTooltipOptions>({
      format: 'function',
      delay: num(0),
      anchor: oneOf<NonNullable<PointerTooltipOptions['anchor']>>({ pointer: 0, top: 0 }),
    }),
    railBreakpoint: num(0),
    className: 'string',
    classNames: shape<ShellClassNames>({ root: 'string', toolbar: 'string', rail: 'string', bottomBar: 'string', dialog: 'string' }),
    slots: shape<ShellSlots>({
      railTop: slot,
      railBottom: slot,
      bottomBarStart: slot,
      bottomBarEnd: slot,
      loading: slot,
      empty: slot,
    }),
    toasts: 'function',
  };
  const grid: OptionShape<ChartGridOptions> = {
    layout: oneOf<ChartGridLayout>({ '1x1': 0, '2x1': 0, '1x2': 0, '3x1': 0, '1x3': 0, '2x2': 0, '3x2': 0, '4x2': 0 }),
    // Each cell's shell checks its own options.
    cell: either('object', 'function'),
    setup: 'function',
    toolbar,
    link: either(
      'boolean',
      shape<LinkGroupOptions>({
        crosshair: 'boolean',
        visibleRange: 'boolean',
        symbol: 'boolean',
        interval: 'boolean',
        timezone: 'boolean',
        drawings: 'boolean',
      }),
    ),
    theme: oneOf<ShellTheme>({ dark: 0, light: 0, system: 0 }),
    className: 'string',
  };
  const favorites = shape<FavoritesOptions>({
    tools: 'array',
    bar: 'boolean',
    orientation: oneOf<NonNullable<FavoritesOptions['orientation']>>({ horizontal: 0, vertical: 0 }),
    storage: 'object',
    settings: 'object',
    storageKey: 'string',
    kinds: 'array',
  });
  const symbolSearch = shape<SymbolSearchOptions>({
    source: 'any',
    onSelect: 'function',
    debounce: num(0),
    pageSize: int(1),
    openOnTyping: either('boolean', 'object'),
    shortcutScope: oneOf<NonNullable<SymbolSearchOptions['shortcutScope']>>({ shell: 0, document: 0 }),
    chart: 'object',
    favorites: 'object',
  });
  const commandPalette = shape<CommandPaletteOptions>({
    sources: 'array',
    actions: 'boolean',
    hiddenActions: 'array',
    keys: 'array',
    shortcutScope: oneOf<NonNullable<CommandPaletteOptions['shortcutScope']>>({ shell: 0, document: 0 }),
    debounce: num(0),
    onOpenChange: 'function',
  });
  const toolbarCustomization = shape<ToolbarCustomizationOptions>({ locked: 'array' });
  const draftEditor = shape<DraftEditorOptions>({ quantityPresets: 'array', maxQuantity: 'function' });
  return { shell: shape(shell), features, panels, grid: shape(grid), favorites, symbolSearch, commandPalette, toolbarCustomization, draftEditor };
}

let rules: ReturnType<typeof buildRules> | undefined;

/** Warn about mistakes in shell options in development builds; production builds reduce this to nothing. */
export function devCheck(where: string, value: unknown, name: keyof ReturnType<typeof buildRules>): void {
  // Written so bundlers fold it: with NODE_ENV replaced by 'production' the
  // whole block is dead and the rules go with it. Without a bundler, `process`
  // (or its `env`) may be missing; that read throws and the checks stay off.
  let checking = false;
  try {
    if (process.env.NODE_ENV !== 'production') {
      checking = true;
      checkOptions(where, value, (rules ??= buildRules())[name]);
    }
  } catch (error) {
    if (checking) throw error;
  }
}

/**
 * In development builds, throw a `not-registered` error when the shell part `part` is given a chart
 * without the core plugin `plugin` it works on (e.g. `'trading'`); production builds reduce this to nothing.
 */
export function devRequirePlugin(chart: Chart, part: string, plugin: string): void {
  // Folded like `devCheck` above.
  let checking = false;
  try {
    if (process.env.NODE_ENV !== 'production') {
      checking = true;
      if (!chart.installedPlugins.includes(`@charton/core/${plugin}`)) {
        throw new ChartError(
          'not-registered',
          `${part}() needs the ${plugin}() plugin: create the chart with it in its plugins (or builtins()), or call chart.install(${plugin}())`,
          { context: { call: `${part}()`, plugin: `${plugin}()` } },
        );
      }
    }
  } catch (error) {
    if (checking) throw error;
  }
}
