// Makes the package build emit `dist/style.css`. Apps must still import `@charton/ui/style.css`
// themselves: `sideEffects` marks this module side-effect free, so a production bundler that
// only uses its re-exports skips this import (#446). Only the dev server applies it regardless.
import './style.css';

export { createChartShell } from './shell';
export type { ChartShell, ChartShellOptions, ShellDirection, ShellEvents, ShellPalette, ShellTheme, RailOptions } from './shell';
export type { ShellClassNames, ShellSlotContent, ShellSlots } from './slots';
export { createToastStack, toasts } from './toasts';
export type { ToastStackHandle, ToastsPart } from './toasts';
export { chartGridLayouts, createChartGrid } from './grid';
export type {
  ChartGrid,
  ChartGridEvents,
  ChartGridLayout,
  ChartGridLoadResult,
  ChartGridOptions,
  ChartGridSizes,
  ChartGridState,
} from './grid';
export {
  createBottomBar,
  applyRange,
  clock,
  defaultBottomBarItems,
  defaultRanges,
  goToDate,
  rangePresets,
  scaleMode,
  scaleModeInline,
  sessionBandsChip,
  sessionMenu,
  sessionPatch,
  timezoneMenu,
  wallTime,
} from './bottombar';
export { createReplayControls, isReplaying, replayControls, replayToolbarItem, toggleReplay } from './replay';
export type { ReplayControlsHandle, ReplayControlsPart } from './replay';
export { canCopyImage, copyChartImage } from './clipboard';
export type { ClipboardImageOptions } from './clipboard';
export { printChart } from './print';
export type { PrintOptions } from './print';
export type { BottomBarInput, BottomBarOptions, BottomBarHandle, RangeOption, SessionOption } from './bottombar';
export { createNavigator } from './navigator';
export type { NavigatorHandle, NavigatorOptions, NavigatorSeries } from './navigator';
export type { NavigatorPoint } from './navigator-model';
export { createSessionChip, sessionChipLabel, sessionStatusText } from './session-chip';
export type { SessionChipOptions } from './session-chip';
export { createSymbolSearch, symbolSearch } from './symbol-search';
export { showShortcut } from './shortcuts';
export type { SymbolSearchOptions, SymbolSearchDialog, SymbolSearchPart } from './symbol-search';
export type {
  SymbolSearchResult,
  SymbolSearchRequest,
  SymbolSearchPage,
  SymbolSearchSource,
  SymbolSearchFilters,
  SymbolSearchFilterOption,
} from './symbol-search-model';
export { commandPalette, commandPaletteOf, commandPaletteToolbarItem, createCommandPalette } from './command-palette';
export type { CommandPalette, CommandPaletteOptions, CommandPalettePart } from './command-palette';
export { commandScore, fuzzyScore, rankCommands } from './command-palette-model';
export type { CommandEntry, CommandSource } from './command-palette-model';
export { defaultShellFeatures } from './features';
export type { ShellFeatures } from './features';
export type { ShellPanels, ShellPanelStyle } from './panels';
export { createToolbar } from './toolbar';
export { defaultIntervals, defaultToolbarItems } from './default-toolbar';
export { toolbarCustomization } from './toolbar-customization';
export type { ToolbarCustomizationOptions, ToolbarCustomizationPart } from './toolbar-customization';
export type {
  ToolbarItem,
  ToolbarButtonContent,
  ToolbarItemLayout,
  ToolbarItemWatch,
  ToolbarItemText,
  ToolbarHandle,
  ToolbarEntry,
  ToolbarItemPatch,
  ToolbarPlacement,
  ToolbarGroup,
  ToolbarAction,
  ToolbarOptions,
} from './toolbar';
export { alignOf, displayOrder, overflowOrder, toolbarGroups } from './toolbar-model';
export type { ToolbarLayoutItem } from './toolbar-model';
export {
  chartStyle,
  chartStyles,
  compare,
  downloadData,
  fullscreen,
  gridLayout,
  hideMenu,
  intervals,
  print,
  screenshot,
  symbolHeader,
  toggleRail,
  toggleVisibility,
  undoRedo,
} from './toolbar-presets';
export type {
  ChartStyleOption,
  ComparePick,
  ComparePresetOptions,
  DownloadDataPresetOptions,
  FullscreenPresetOptions,
  IntervalsPresetOptions,
  PrintPresetOptions,
  ScreenshotPresetOptions,
  SymbolHeaderPresetOptions,
  ToggleVisibilityOptions,
  ToolbarButtonItem,
  ToolbarCustomItem,
  ToolbarMenuItem,
  ToolbarSegmentedItem,
  VisibilityTarget,
} from './toolbar-presets';
export { createToolRail, defaultRailItems, groupLabels, toolIcons, toolRailItems } from './rail';
export {
  defaultFavoritesBar,
  favoritesBarFraction,
  localFavoritesStorage,
  placeFavoritesBar,
  sanitizeFavorites,
} from './favorites-model';
export type {
  BarRect,
  FavoritesBarOrientation,
  FavoritesBarState,
  FavoritesRecord,
  FavoritesStorage,
} from './favorites-model';
export { favorites } from './favorites';
export type {
  FavoritesBarHandle,
  FavoritesEnvelope,
  FavoritesEvents,
  FavoritesKind,
  FavoritesList,
  FavoritesOptions,
  FavoritesPart,
  ShellFavorites,
} from './favorites';
export { favoriteChartStyles, favoriteIntervals } from './favorites-toolbar';
export { chartTypeIcons, crosshairIcon, drawingIcon, drawingIcons, groupIcons } from './icons';
export type { RailItem, RailItemText, RailTool, ToolRailHandle } from './rail';
export { iconButton, button, segmentedTabs, menuButton } from './controls';
export type { IconButtonProps, ButtonProps, SegmentOption, SegmentedTabs, MenuOption, MenuButton } from './controls';
export { icon, placePopover, popoverPlacement } from './dom';
export type { IconNode, IconSource, PopoverPlacement, Visibility } from './dom';
export { createDrawingToolbar, placeToolbar } from './drawing-toolbar';
export type { DrawingToolbarHandle, DrawingToolbarOptions } from './drawing-toolbar';
export { createDrawingSettings, openDrawingSettings } from './drawing-settings';
export type { DrawingSettingsContext, DrawingSettingsHandle, DrawingSettingsOptions } from './drawing-settings';
export { createIndicatorSettings, indicatorSettingsForm, openIndicatorSettings } from './indicator-settings';
export type { IndicatorSettingsContext, IndicatorSettingsForm, IndicatorSettingsHandle, IndicatorSettingsOptions, IndicatorSettingsState } from './indicator-settings';
export { createSeriesSettings, hasSeriesStyleSettings, openSeriesStyleSettings, seriesSettingsForm } from './series-settings';
export type { SeriesSettingsChart, SeriesSettingsForm, SeriesSettingsHandle } from './series-settings';
export { canCancel, clusterList, clusterRowText, createClusterList } from './cluster-list';
export type { ClusterListHandle, ClusterListPart } from './cluster-list';
export { createDraftEditor, draftEditor, presetLabel, presetQuantity } from './draft-editor';
export type { DraftEditorHandle, DraftEditorOptions, DraftEditorPart, QuantityPreset } from './draft-editor';
export {
  appearanceOf,
  appearanceSections,
  appearanceToolbarItem,
  createAppearance,
  localAppearanceStorage,
  mergePatch,
  resetSection,
  sanitizePatch,
  sanitizeSaved,
  themeWithOverrides,
} from './appearance';
export { presetShellTokens } from './color-presets';
export type {
  AppearanceColorKey,
  AppearanceHandle,
  AppearanceOptions,
  AppearancePatch,
  AppearanceSection,
  AppearanceSectionId,
  AppearanceStorage,
  SavedAppearance,
  WatermarkSizes,
} from './appearance';
export { createChartSettings, localSettingsStorage, settingInput, settingsOf, settingsToolbarItem } from './chart-settings';
export type { AppSettingField, AppSettingSection, ChartSettingsAction, ChartSettingsHandle, ChartSettingsOptions, ChartSettingsStorage } from './chart-settings';
export { createShortcutSettings } from './shortcut-settings';
export type { ShortcutSettingsHandle, ShortcutSettingsOptions } from './shortcut-settings';
export { createColorControl, defaultSwatches, joinColor, splitColor } from './color-control';
export type { ColorControl, ColorControlOptions, ColorParts } from './color-control';
export { createContextMenu, defaultContextMenuItems } from './context-menu';
export { INTERVAL_GROUPS, legendMenuItems } from './legend-menu';
export { defaultShellMessages, shellText } from './messages';
export type { Localized, ShellMessageKey } from './messages';
export type { IntervalGroup } from './legend-menu';
export type { ContextMenuHandle, ContextMenuItem, ContextMenuOptions, ContextMenuSelectHandler } from './context-menu';
export { createIndicatorPicker, indicatorPickerOf, indicatorPickerToolbarItem } from './indicator-picker';
export type { IndicatorInitialState, IndicatorPickerAction, IndicatorPickerHandle, IndicatorPickerOptions } from './indicator-picker';
export {
  createIndicatorTemplates,
  indicatorTemplatePresets,
  indicatorTemplatesOf,
  indicatorTemplatesToolbarItem,
  registerIndicatorTemplates,
} from './indicator-templates';
export type {
  IndicatorTemplate,
  IndicatorTemplateCollectionOptions,
  IndicatorTemplatesHandle,
  IndicatorTemplatesOptions,
} from './indicator-templates';
export {
  categoryLabel,
  categoryOf,
  knownCategories,
  localIndicatorPickerStorage,
  matchRank,
  searchIndicators,
} from './indicator-picker-model';
export type {
  IndicatorNameOptions,
  IndicatorPickerGroup,
  IndicatorPickerMemory,
  IndicatorPickerStorage,
  IndicatorPlacement,
} from './indicator-picker-model';
export { createTableView, tableViewOf, tableViewToolbarItem } from './table-view';
export type { TableViewHandle, TableViewOptions } from './table-view';
export { createDataWindow } from './datawindow';
export { createDepthLadder, depthLadderRows } from './depth-ladder';
export type { DepthLadderHandle, DepthLadderOptions, DepthLadderRow } from './depth-ladder';
export type { DataWindowOptions, DataWindowHandle } from './datawindow';
export { createObjectTree } from './object-tree';
export type { ObjectTreeOptions, ObjectTreeHandle } from './object-tree';
export {
  buildObjectTree,
  canDropNode,
  dropNode,
  flattenTree,
  moveNode,
  ObjectKeys,
  removeNodes,
  renameNode,
  setNodesLocked,
  setNodesVisible,
} from './object-tree-model';
export type {
  ObjectTreeAbilities,
  ObjectTreeDrawingNode,
  ObjectTreeIndicatorNode,
  ObjectTreeKind,
  ObjectTreeNode,
  ObjectTreeNodeBase,
  ObjectTreePaneNode,
  ObjectTreeSeriesNode,
} from './object-tree-model';
export { createPointerTooltip, placePointerTooltip, pointerTooltipContent } from './pointer-tooltip';
export type { PointerTooltipOptions, PointerTooltipHandle } from './pointer-tooltip';
export { shellOf } from './plugin-host';
export type { ShellPluginHost } from './plugin-host';
export { createFormDialog } from './form-dialog';
export type { FormDialog, FormDialogOptions } from './form-dialog';
export { confirmDialog } from './dialog';
export type { ConfirmOptions } from './dialog';
export { askTemplateName, templateNameTaken } from './template-name';
export { registerInput } from './form-inputs';
export type { InputContext, InputControl, InputRenderer } from './form-inputs';
export {
  conditionHolds,
  defaultFormActions,
  defaultSources,
  defaultValues,
  formErrors,
  inputError,
  validateFormSchema,
} from './form-model';
export type {
  BooleanInputDef,
  BuiltinInputDef,
  ColorInputDef,
  FormAction,
  FormCondition,
  FormGroup,
  FormInputBase,
  FormInputDef,
  FormInputKinds,
  FormOption,
  FormSchema,
  FormSection,
  FormValues,
  MultiSelectInputDef,
  NumberInputDef,
  RangeInputDef,
  SelectInputDef,
  SliderInputDef,
  SourceInputDef,
  TextInputDef,
} from './form-model';
export { createPickerDialog } from './picker-dialog';
export type { PickerDialog, PickerDialogOptions, PickerHandlers, PickerRowAction, PickerSchema } from './picker-dialog';
export { matchScore, rankItems } from './picker-model';
export type { PickerCategory, PickerItem, PickerPage, PickerRequest, PickerSource, RankOptions } from './picker-model';
