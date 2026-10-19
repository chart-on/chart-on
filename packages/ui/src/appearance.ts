import {
  builtInColorPresets,
  contrastText,
  isColor,
  presetTheme,
  type Chart,
  type ChartOptionsPatch,
  type ChartTheme,
  type ColorPreset,
  type GridLineOptions,
  type GridLineStyle,
  type GridOptionsPatch,
} from '@chart-on/core';
import { Check, Palette, RotateCcw, X } from 'lucide';
import { createColorControl, type ColorControl } from './color-control';
import { lineStyleOptions } from './drawing-style-controls';
import { usablePresets } from './color-presets';
import { button, iconButton, segmentedTabs } from './controls';
import { dialogClassFor } from './dialog';
import { localJson } from './local-json';
import { gridKeys, h, holdPanelInput, icon } from './dom';
import { createListbox } from './listbox';
import { builtinText, labelOf, shellText, type ShellMessageKey } from './messages';
import type { ToolbarItem } from './toolbar';

/** User color choices layered over the theme. An `undefined` value removes that override. */
export interface AppearancePatch {
  theme?: Partial<ChartTheme>;
  grid?: GridOptionsPatch;
  /** Line above the symbol in the chart's watermark (`chart.watermark` option `author`), e.g. the user's name. */
  watermarkText?: string;
  /** Show the project logo badge (the chart's `features.attributionLogo`); unset keeps what the app set. */
  logo?: boolean;
  /** Font sizes of the watermark lines in css px: the name, the symbol and the interval. */
  watermarkSizes?: WatermarkSizes;
}

/** Font sizes of the watermark's name, symbol and interval lines, in css px; a missing one keeps the watermark's own. */
export interface WatermarkSizes {
  author?: number;
  symbol?: number;
  interval?: number;
}

const WATERMARK_SIZE_KEYS = ['author', 'symbol', 'interval'] as const;
/** Bounds of a watermark line size the panel takes, css px. */
const WATERMARK_SIZE_RANGE = { min: 8, max: 200 };

/** Theme keys the appearance panel edits; all of them hold one color. */
export type AppearanceColorKey =
  | 'up'
  | 'down'
  | 'upWick'
  | 'downWick'
  | 'upBorder'
  | 'downBorder'
  | 'background'
  | 'backgroundBottom'
  | 'text'
  | 'textMuted'
  | 'separator'
  | 'labelBackground'
  | 'labelText'
  | 'crosshair'
  | 'watermark';

/** Id of a section of the appearance panel; `reset` takes one to drop that section's overrides. */
export type AppearanceSectionId = 'candles' | 'background' | 'grid' | 'scales' | 'crosshair' | 'watermark';

/** A section of the appearance panel: its id, heading and the theme colors it edits, each with a label. */
export interface AppearanceSection {
  id: AppearanceSectionId;
  label: string;
  colors: { key: AppearanceColorKey; label: string }[];
}

/** The appearance panel's sections in display order. The grid section lists no theme colors; the panel adds its line controls itself. */
export const appearanceSections: readonly AppearanceSection[] = [
  {
    id: 'candles',
    label: 'Candles',
    colors: [
      { key: 'up', label: 'Rising body' },
      { key: 'down', label: 'Falling body' },
      { key: 'upWick', label: 'Rising wick' },
      { key: 'downWick', label: 'Falling wick' },
      { key: 'upBorder', label: 'Rising border' },
      { key: 'downBorder', label: 'Falling border' },
    ],
  },
  {
    id: 'background',
    label: 'Background',
    colors: [
      { key: 'background', label: 'Background' },
      { key: 'backgroundBottom', label: 'Gradient bottom' },
    ],
  },
  // Grid lines are grid options, not theme keys; the panel adds them per direction.
  { id: 'grid', label: 'Grid', colors: [] },
  {
    id: 'scales',
    label: 'Scales and text',
    colors: [
      { key: 'text', label: 'Text' },
      { key: 'textMuted', label: 'Muted text' },
      { key: 'separator', label: 'Separators' },
      { key: 'labelBackground', label: 'Label background' },
      { key: 'labelText', label: 'Label text' },
    ],
  },
  { id: 'crosshair', label: 'Crosshair', colors: [{ key: 'crosshair', label: 'Crosshair' }] },
  { id: 'watermark', label: 'Watermark', colors: [{ key: 'watermark', label: 'Watermark' }] },
];

const GRID_DIRECTIONS = [
  { key: 'horizontal', label: 'Horizontal lines' },
  { key: 'vertical', label: 'Vertical lines' },
] as const;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
/** Internal: the theme keys the panel's colour rows edit. */
export const COLOR_KEYS = new Set<string>(appearanceSections.flatMap((s) => s.colors.map((c) => c.key)));
/** Optional theme keys: without an override they must be cleared, not left at an old value. */
const OPTIONAL_KEYS = ['upWick', 'downWick', 'upBorder', 'downBorder', 'backgroundBottom'] as const;

/** `patch` merged into `base` at every depth; `undefined` values drop overrides, empty groups are removed. */
export function mergePatch(base: AppearancePatch, patch: AppearancePatch): AppearancePatch {
  return (mergeDeep(base, patch) ?? {}) as AppearancePatch;
}

function mergeDeep(a: unknown, b: unknown): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = isRecord(a) ? { ...a } : {};
  for (const [k, v] of Object.entries(isRecord(b) ? b : {})) {
    const merged = isRecord(v) && !Array.isArray(v) ? mergeDeep(out[k], v) : v;
    if (merged === undefined) delete out[k];
    else out[k] = merged;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `patch` without the overrides of one section. */
export function resetSection(patch: AppearancePatch, id: AppearanceSectionId): AppearancePatch {
  if (id === 'grid') return mergePatch({}, { ...patch, grid: undefined });
  const section = appearanceSections.find((s) => s.id === id);
  const theme = Object.fromEntries((section?.colors ?? []).map((c) => [c.key, undefined]));
  return mergePatch(patch, { theme, ...(id === 'watermark' && { watermarkText: undefined, watermarkSizes: undefined }), ...(id === 'background' && { logo: undefined }) });
}

/** Theme to give the chart: `base` with the overrides on top. */
export function themeWithOverrides(base: ChartTheme, patch: AppearancePatch): ChartTheme {
  const cleared = Object.fromEntries(OPTIONAL_KEYS.map((k) => [k, undefined]));
  return { ...cleared, ...base, ...patch.theme };
}

const GRID_LINE_DEFAULT: Partial<GridLineOptions> = { visible: true, lineStyle: 'solid', color: undefined };
const GRID_FIELDS = ['visible', 'lineStyle', 'color'] as const;

/**
 * Chart options that take the chart from overrides `prev` to `next`: only the
 * keys that changed, so changes made through the chart API to other keys are
 * kept. A removed override falls back to its value in `base` / `baseGrid`
 * (an explicit `undefined` for unset optional colors, which clears them).
 */
export function overridesDiff(prev: AppearancePatch, next: AppearancePatch, base: ChartTheme, baseGrid: GridOptionsPatch): ChartOptionsPatch {
  const out: ChartOptionsPatch = {};
  const theme: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(prev.theme ?? {}), ...Object.keys(next.theme ?? {})]) as Set<keyof ChartTheme>) {
    const value = next.theme?.[key];
    if (value !== prev.theme?.[key]) theme[key] = value ?? base[key];
  }
  if (Object.keys(theme).length > 0) out.theme = theme as Partial<ChartTheme>;
  const grid: GridOptionsPatch = {};
  for (const { key: dir } of GRID_DIRECTIONS) {
    const line: Record<string, unknown> = {};
    for (const field of GRID_FIELDS) {
      const value = next.grid?.[dir]?.[field];
      if (value !== prev.grid?.[dir]?.[field]) line[field] = value ?? baseGrid[dir]?.[field] ?? GRID_LINE_DEFAULT[field];
    }
    if (Object.keys(line).length > 0) grid[dir] = line as Partial<GridLineOptions>;
  }
  if (Object.keys(grid).length > 0) out.grid = grid;
  return out;
}

/** Keep only known keys with usable values, e.g. from storage. */
export function sanitizePatch(data: unknown): AppearancePatch {
  if (!isRecord(data)) return {};
  const theme: Record<string, string> = {};
  if (isRecord(data.theme)) {
    for (const [k, v] of Object.entries(data.theme)) if (COLOR_KEYS.has(k) && validColor(v)) theme[k] = v;
  }
  const grid: GridOptionsPatch = {};
  for (const { key } of GRID_DIRECTIONS) {
    const raw = isRecord(data.grid) ? data.grid[key] : undefined;
    if (!isRecord(raw)) continue;
    const line: Partial<GridLineOptions> = {};
    if (typeof raw.visible === 'boolean') line.visible = raw.visible;
    if (validColor(raw.color)) line.color = raw.color;
    if (raw.lineStyle === 'solid' || raw.lineStyle === 'dashed' || raw.lineStyle === 'dotted') line.lineStyle = raw.lineStyle as GridLineStyle;
    grid[key] = line;
  }
  const text = data.watermarkText;
  const sizes: WatermarkSizes = {};
  const rawSizes = isRecord(data.watermarkSizes) ? data.watermarkSizes : {};
  for (const key of WATERMARK_SIZE_KEYS) if (validSize(rawSizes[key])) sizes[key] = rawSizes[key];
  return mergePatch(
    {},
    {
      theme,
      grid,
      ...(typeof text === 'string' && text.trim() && { watermarkText: text }),
      ...(typeof data.logo === 'boolean' && { logo: data.logo }),
      watermarkSizes: sizes,
    },
  );
}

/** A watermark line size the panel accepts: a whole number of css px in `WATERMARK_SIZE_RANGE`. */
function validSize(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= WATERMARK_SIZE_RANGE.min && v <= WATERMARK_SIZE_RANGE.max;
}

/** Dark when white text reads better on `background`. */
function schemeOf(background: string): 'light' | 'dark' {
  return contrastText(background) === '#ffffff' ? 'dark' : 'light';
}

function validColor(v: unknown): v is string {
  return typeof v === 'string' && isColor(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * What appearance storage keeps: the overrides and the id of the colour
 * preset under them; null when the user chose the default theme, missing
 * when nothing was chosen yet (the default preset then applies).
 */
export interface SavedAppearance extends AppearancePatch {
  preset?: string | null;
}

/** `sanitizePatch` plus the preset id when it is a non-empty string or null. */
export function sanitizeSaved(data: unknown): SavedAppearance {
  const raw = isRecord(data) ? data.preset : undefined;
  const preset = raw === null || (typeof raw === 'string' && raw !== '') ? raw : undefined;
  return { ...sanitizePatch(data), ...(preset !== undefined && { preset }) };
}

/** Where appearance overrides and the chosen colour preset are kept between visits. */
export interface AppearanceStorage {
  load(): SavedAppearance | null;
  save(state: SavedAppearance): void;
}

/** `localStorage` storage; unavailable or blocked storage reads as empty and saves nothing. */
export function localAppearanceStorage(key = 'charton:appearance'): AppearanceStorage {
  return localJson(key, sanitizeSaved);
}

/** Options for `createAppearance`: the base theme and grid, where overrides are saved, the color presets offered, and open/close and preset callbacks. */
export interface AppearanceOptions {
  /** Theme under the overrides; read again on every apply, so a dark/light switch keeps them. */
  baseTheme?: () => ChartTheme;
  /** Grid under the overrides. Default: the chart's grid when the appearance is created. */
  baseGrid?: GridOptionsPatch;
  /** Where to keep overrides; `null` keeps them for this visit only. Default `localStorage`. */
  storage?: AppearanceStorage | null;
  /**
   * `localStorage` key of the default storage. Default `'charton:appearance'`.
   * Give each chart on a page its own key, or they share (and overwrite) one set of choices.
   */
  storageKey?: string;
  /** Called when the panel opens or closes, e.g. to refresh a toolbar button's pressed state. */
  onOpenChange?(open: boolean): void;
  /**
   * Colour presets offered at the top of the panel. Default `builtInColorPresets`;
   * an array replaces the list; `false` hides the section and ignores a saved preset.
   */
  presets?: readonly ColorPreset[] | false;
  /**
   * Id of the preset used until the user picks one; null starts from the base theme.
   * Default `'paper-ink'`. A saved choice, the default theme included, wins.
   */
  defaultPreset?: string | null;
  /**
   * Light or dark: which variant of each preset applies. Default: what the base
   * theme's background reads as, then what the panel's Light and Dark buttons chose.
   */
  mode?: () => 'light' | 'dark';
  /**
   * Switch the mode from the panel's Light and Dark buttons, then restyle. Replaces
   * the default, which only switches the preset's variant (the base theme stays);
   * the shell switches its theme here.
   */
  setMode?(mode: 'light' | 'dark'): void;
  /**
   * Restyle after the preset or its mode changed. Replaces the default, which applies
   * `theme()` to the chart; the shell also restyles its chrome here.
   */
  onPresetChange?(preset: ColorPreset | null): void;
  /** Element the panel opens in. Default the chart's root. */
  container?: HTMLElement;
}

/** Returned by `createAppearance`: reads and changes the saved color overrides and preset, and opens or closes the appearance panel. */
export interface AppearanceHandle {
  /** The user's overrides. */
  readonly overrides: AppearancePatch;
  /** Merge overrides (`undefined` removes one), apply and save them. */
  set(patch: AppearancePatch): void;
  /** Drop the overrides of one section, or all of them. */
  reset(section?: AppearanceSectionId): void;
  /** The chart theme: base theme, then the colour preset, then the overrides. */
  theme(): ChartTheme;
  /** The presets the panel offers; empty with `presets: false`. */
  readonly presets: readonly ColorPreset[];
  /** The chosen colour preset; null for the base theme. */
  readonly preset: ColorPreset | null;
  /** Choose a preset by id, or go back to the base theme with null. Unknown ids do nothing. Saved with the overrides. */
  setPreset(id: string | null): void;
  /** Light or dark: which variant of the preset applies. */
  readonly mode: 'light' | 'dark';
  /** Switch the mode, e.g. to try the other variant of a preset. */
  setMode(mode: 'light' | 'dark'): void;
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
  destroy(): void;
}

const handles = new WeakMap<Chart, AppearanceHandle>();

/** The appearance handle created for `chart`, if any. */
export function appearanceOf(chart: Chart): AppearanceHandle | undefined {
  return handles.get(chart);
}

/** Toolbar button that opens the appearance panel of the chart it acts on. */
export function appearanceToolbarItem(): ToolbarItem {
  return {
    type: 'button',
    id: 'appearance',
    ...labelOf('menuAppearance'),
    icon: Palette,
    onClick: (chart) => appearanceOf(chart)?.toggle(),
    isActive: (chart) => appearanceOf(chart)?.isOpen ?? false,
  };
}

/**
 * Chart colors the user can change: candles, background, grid, scales and
 * text, crosshair and watermark, each with opacity. Choices are overrides on
 * top of the theme, applied live and saved through `storage`.
 */
export function createAppearance(chart: Chart, options: AppearanceOptions = {}): AppearanceHandle {
  const initial = chart.appearance();
  const baseTheme = options.baseTheme ?? (() => initial.theme);
  const baseGrid = options.baseGrid ?? chart.options.grid;
  const storage = options.storage === undefined ? localAppearanceStorage(options.storageKey) : options.storage;
  const presets = options.presets === false ? [] : usablePresets(options.presets ?? builtInColorPresets);
  // Sanitized here too, so a custom storage cannot hand the chart unknown keys or unusable colors.
  const saved = sanitizeSaved(storage?.load() ?? null);
  let overrides: AppearancePatch = sanitizePatch(saved);
  // Nothing saved yet: the default preset. An unknown or removed id falls back to the base theme.
  const presetId = saved.preset !== undefined ? saved.preset : options.defaultPreset !== undefined ? options.defaultPreset : 'paper-ink';
  let preset: ColorPreset | null = presets.find((p) => p.id === presetId) ?? null;
  // Until the user picks a preset none is saved, so a later `defaultPreset` still applies.
  let presetChosen = saved.preset !== undefined;
  let ownMode = schemeOf(baseTheme().background);
  const mode = () => options.mode?.() ?? ownMode;
  let panel: Panel | null = null;
  // The watermark comes with the `watermark()` plugin; a chart without it has no text to set.
  const watermark = () => (chart.installedPlugins.includes('@chart-on/core/watermark') ? chart.watermark : null);
  // What the app set, which an unset or reset choice goes back to.
  const baseLogo = chart.features.attributionLogo;

  // The theme under the overrides: the base, restyled by the preset.
  const presetBase = () => (preset ? presetTheme(preset, mode(), baseTheme()) : baseTheme());
  // Without presets there is no choice to keep, so a list added later still starts from its default.
  const save = () => storage?.save({ ...overrides, ...(presetChosen && presets.length > 0 && { preset: preset?.id ?? null }) });
  // Only changed keys go to the chart, so other theme and grid changes made through the API are kept.
  const apply = (prev: AppearancePatch) => {
    const patch = overridesDiff(prev, overrides, presetBase(), baseGrid);
    if (patch.theme || patch.grid) chart.applyOptions(patch);
    if (overrides.watermarkText !== prev.watermarkText) {
      watermark()?.applyOptions({ author: overrides.watermarkText ?? '' });
      panel?.refresh();
    }
    if (overrides.logo !== prev.logo) {
      chart.applyOptions({ features: { attributionLogo: overrides.logo ?? baseLogo } });
      panel?.refresh();
    }
    const sizes = overrides.watermarkSizes ?? {};
    if (JSON.stringify(sizes) !== JSON.stringify(prev.watermarkSizes ?? {})) {
      watermark()?.applyOptions({ authorSize: sizes.author ?? null, lineSizes: [sizes.symbol ?? null, sizes.interval ?? null] });
      panel?.refresh();
    }
  };
  const commit = (next: AppearancePatch) => {
    const prev = overrides;
    overrides = next;
    save();
    apply(prev);
  };
  const restyle = () => {
    if (options.onPresetChange) options.onPresetChange(preset);
    else chart.applyOptions({ theme: handle.theme() });
  };

  const handle: AppearanceHandle = {
    get overrides() {
      return mergePatch({}, overrides);
    },
    set: (patch) => commit(mergePatch(overrides, patch)),
    reset: (section) => commit(section ? resetSection(overrides, section) : {}),
    theme: () => themeWithOverrides(presetBase(), overrides),
    presets,
    get preset() {
      return preset;
    },
    setPreset(id) {
      const next = id === null ? null : presets.find((p) => p.id === id);
      if (next === undefined || next === preset) return;
      preset = next;
      presetChosen = true;
      save();
      restyle();
      panel?.refresh();
    },
    get mode() {
      return mode();
    },
    setMode(next) {
      if (next === mode()) return;
      if (options.setMode) return options.setMode(next);
      ownMode = next;
      restyle();
      panel?.refresh();
    },
    open() {
      if (panel) return;
      panel = createPanel(chart, handle, baseTheme, options.container ?? chart.root, () => {
        panel = null;
        options.onOpenChange?.(false);
      });
      options.onOpenChange?.(true);
    },
    close() {
      panel?.close();
    },
    toggle() {
      if (panel) panel.close();
      else handle.open();
    },
    get isOpen() {
      return panel !== null;
    },
    destroy() {
      panel?.close();
      handles.delete(chart);
    },
  };
  handles.set(chart, handle);
  apply({});
  // A saved preset restyles the whole theme, not only the overridden keys.
  if (preset) restyle();
  return handle;
}

interface Panel {
  close(): void;
  /** Mark the chosen preset again. */
  refresh(): void;
}

/** Swatch grid columns; the arrow keys move up and down by one row. */
const PRESET_COLUMNS = 6;

interface PresetGrid {
  el: HTMLElement;
  /** Mark the chosen preset and redraw the default swatch, which follows the base theme. */
  refresh(): void;
  /** Focus the chosen swatch. */
  focus(): void;
}

/**
 * The preset swatches: a "Default" entry for the base theme, then one per
 * preset (its background with a primary dot, in the current mode). One Tab
 * stop; the arrow keys, Home and End move between swatches, Enter or Space applies.
 */
function createPresetGrid(chart: Chart, handle: AppearanceHandle, base: () => ChartTheme): PresetGrid {
  const grid = h('div', { class: 'pc-presets' });
  const swatch = (id: string | null, label: string) => {
    const dot = h('span', { class: 'pc-preset-dot' }, icon(Check, 12));
    const el = h('button', { class: 'pc-preset', 'aria-label': label, 'data-tip': label, 'aria-pressed': 'false' }, dot);
    el.addEventListener('click', () => handle.setPreset(id));
    grid.append(el);
    return { id, el };
  };
  const paint = (el: HTMLElement, background: string, primary: string) => {
    const mark = el.firstElementChild as HTMLElement;
    mark.style.background = primary;
    mark.style.color = contrastText(primary);
    el.style.background = background;
  };
  const fallback = swatch(null, shellText(chart, 'appearanceDefault'));
  const swatches = [fallback];
  for (const p of handle.presets) {
    // A built-in preset under its own name, in the chart's language: message `preset.<id>`.
    swatches.push(swatch(p.id, builtinText(chart, `preset.${p.id}`, p.label, builtInColorPresets.find((b) => b.id === p.id)?.label)));
  }
  const chosen = () => swatches.find((s) => s.id === (handle.preset?.id ?? null)) ?? fallback;
  const refresh = () => {
    const theme = base();
    paint(fallback.el, theme.background, theme.line);
    handle.presets.forEach((p, i) => paint(swatches[i + 1]!.el, p[handle.mode].background, p[handle.mode].primary));
    const current = chosen();
    for (const s of swatches) {
      s.el.setAttribute('aria-pressed', String(s === current));
      s.el.tabIndex = s === current ? 0 : -1;
    }
  };
  gridKeys(grid, () => swatches.map((s) => s.el), PRESET_COLUMNS);
  refresh();
  return { el: grid, refresh, focus: () => chosen().el.focus() };
}

function createPanel(chart: Chart, handle: AppearanceHandle, base: () => ChartTheme, container: HTMLElement, onClose: () => void): Panel {
  const t = (key: ShellMessageKey, params?: Record<string, string>) => shellText(chart, key, params);
  /**
   * A section or color name in the chart's language: `appearance.section.<id>` or `appearance.<key>`.
   * `appearanceSections` is fixed built-in data, so its labels are always the English defaults.
   */
  const name = (key: string, english: string) => builtinText(chart, `appearance.${key}`, english);
  const el = h('div', { class: `pc-appearance ${dialogClassFor(container)}`.trim(), role: 'dialog', 'aria-label': t('menuAppearance') });
  const controls: { control: ColorControl; read: () => string }[] = [];
  const color = (label: string, read: () => string, write: (value: string) => void) => {
    const control = createColorControl({ label, value: read(), onInput: write, localization: chart.localization });
    controls.push({ control, read });
    return h('div', { class: 'pc-appearance-row' }, h('span', {}, label), control.el);
  };
  const theme = () => chart.appearance().theme;
  // Unset wicks are drawn in the body color, an unset gradient bottom in the background color; unset borders are not drawn at all.
  const unsetColor = (key: AppearanceColorKey) => {
    if (key === 'upWick') return theme().up;
    if (key === 'downWick') return theme().down;
    if (key === 'backgroundBottom') return theme().background;
    return TRANSPARENT;
  };
  const grid = () => chart.appearance().grid;
  // Where focus returns on close, e.g. the toolbar toggle.
  const previous = document.activeElement as HTMLElement | null;

  const close = () => {
    const hadFocus = el.contains(document.activeElement);
    controls.forEach((c) => c.control.destroy());
    modes?.destroy();
    off();
    el.remove();
    onClose();
    if (hadFocus) (previous && previous.isConnected !== false ? previous : chart.root).focus();
  };

  const header = h('div', { class: 'pc-appearance-head' }, h('h2', {}, t('menuAppearance')));
  header.append(
    button({ label: t('appearanceResetAll'), icon: RotateCcw, variant: 'ghost', onClick: () => handle.reset() }),
    iconButton({ icon: X, label: t('dialogClose'), variant: 'ghost', onClick: close }),
  );
  el.append(header);

  const body = h('div', { class: 'pc-appearance-body' });
  const presets = handle.presets.length > 0 ? createPresetGrid(chart, handle, base) : null;
  // Light and Dark under the swatches, to try both variants of a preset.
  const modes = presets
    ? segmentedTabs(
        [
          { value: 'light', label: t('appearanceLight') },
          { value: 'dark', label: t('appearanceDark') },
        ],
        handle.mode,
        (value) => handle.setMode(value as 'light' | 'dark'),
        t('appearanceMode'),
      )
    : null;
  if (presets && modes) {
    const head = h('div', { class: 'pc-appearance-section-head' }, h('h3', {}, t('appearancePresets')));
    const modeRow = h('div', { class: 'pc-appearance-modes' }, modes.el);
    body.append(h('section', { class: 'pc-appearance-section', 'aria-label': t('appearancePresets') }, head, presets.el, modeRow));
  }
  // `{name}` is the name as written, `{lower}` in lower case, which the English text uses.
  const named = (text: string) => ({ name: text, lower: text.toLowerCase() });
  for (const section of appearanceSections) {
    const title = name(`section.${section.id}`, section.label);
    const head = h('div', { class: 'pc-appearance-section-head' }, h('h3', {}, title));
    head.append(button({ label: t('dialogReset'), variant: 'ghost', title: t('appearanceResetSection', named(title)), onClick: () => handle.reset(section.id) }));
    const block = h('section', { class: 'pc-appearance-section', 'aria-label': title }, head);
    for (const { key, label } of section.colors) {
      const read = () => theme()[key] ?? unsetColor(key);
      block.append(color(name(key, label), read, (value) => handle.set({ theme: { [key]: value } })));
    }
    // The logo badge is the chart's own (`features.attributionLogo`), not part of the watermark.
    if (section.id === 'background') {
      const label = shellText(chart, 'appearanceLogo');
      const show = h('input', { type: 'checkbox', 'aria-label': t('appearanceShow', named(label)) });
      const read = () => String(chart.features.attributionLogo);
      show.checked = chart.features.attributionLogo;
      show.addEventListener('change', () => handle.set({ logo: show.checked }));
      controls.push({ control: { el: show, setValue: (v) => (show.checked = v === 'true'), destroy() {} }, read });
      block.append(h('div', { class: 'pc-appearance-row' }, h('label', { class: 'pc-appearance-check' }, show, h('span', {}, label))));
    }
    // The name row needs the `watermark()` plugin's watermark.
    const mark = section.id === 'watermark' && chart.installedPlugins.includes('@chart-on/core/watermark') ? chart.watermark : null;
    if (mark) {
      const label = shellText(chart, 'appearanceWatermarkText');
      // No maxlength: the watermark cuts the line to 40 characters itself.
      const text = h('input', { type: 'text', class: 'pc-input', 'aria-label': label });
      const read = () => mark.options.author;
      text.value = read();
      text.addEventListener('input', () => handle.set({ watermarkText: text.value.trim() ? text.value : undefined }));
      controls.push({ control: { el: text, setValue: (v) => v !== text.value && (text.value = v), destroy() {} }, read });
      block.append(h('label', { class: 'pc-appearance-row' }, h('span', {}, label), text));
      // Sizes as drawn: the user's choice, else the watermark's own.
      const own = (i: number) => {
        const line = mark.options.lines[i];
        return mark.options.lineSizes[i] ?? (typeof line === 'object' ? line.size : undefined) ?? mark.options.fontSize;
      };
      const drawn = { author: () => mark.options.authorSize ?? mark.options.fontSize / 2, symbol: () => own(0), interval: () => own(1) };
      const sizeLabels = { author: 'appearanceNameSize', symbol: 'appearanceSymbolSize', interval: 'appearanceIntervalSize' } as const;
      for (const key of WATERMARK_SIZE_KEYS) {
        const label = shellText(chart, sizeLabels[key]);
        const { min, max } = WATERMARK_SIZE_RANGE;
        const input = h('input', { type: 'number', min: String(min), max: String(max), step: '1', class: 'pc-input pc-appearance-size', 'aria-label': label });
        const read = () => String(Math.round(drawn[key]()));
        input.value = read();
        // Empty goes back to the watermark's own size; out of range waits for a usable number.
        input.addEventListener('input', () => {
          const value = input.value.trim() === '' ? undefined : Number(input.value);
          if (value === undefined || validSize(value)) handle.set({ watermarkSizes: { [key]: value } });
        });
        controls.push({ control: { el: input, setValue: (v) => document.activeElement !== input && (input.value = v), destroy() {} }, read });
        block.append(h('label', { class: 'pc-appearance-row' }, h('span', {}, label), input));
      }
    }
    if (section.id === 'grid') {
      for (const { key: dir, label: english } of GRID_DIRECTIONS) {
        const label = name(dir, english);
        const show = h('input', { type: 'checkbox', 'aria-label': t('appearanceShow', named(label)) });
        show.checked = grid()[dir].visible;
        show.addEventListener('change', () => handle.set({ grid: { [dir]: { visible: show.checked } } }));
        controls.push({ control: { el: show, setValue: (v) => (show.checked = v === 'true'), destroy() {} }, read: () => String(grid()[dir].visible) });
        const style = createListbox({
          options: lineStyleOptions(chart),
          value: grid()[dir].lineStyle,
          label: t('appearanceStyle', named(label)),
          localization: chart.localization,
          set: (value) => handle.set({ grid: { [dir]: { lineStyle: value as GridLineStyle } } }),
        });
        controls.push({ control: style, read: () => grid()[dir].lineStyle });
        const picker = createColorControl({
          label: t('appearanceColor', named(label)),
          value: grid()[dir].color,
          onInput: (value) => handle.set({ grid: { [dir]: { color: value } } }),
          localization: chart.localization,
        });
        controls.push({ control: picker, read: () => grid()[dir].color });
        block.append(h('div', { class: 'pc-appearance-row' }, h('label', { class: 'pc-appearance-check' }, show, h('span', {}, label)), h('span', { class: 'pc-appearance-pair' }, style.el, picker.el)));
      }
    }
    body.append(block);
  }
  el.append(body);
  // The panel stays open while the user pans the chart to judge a color; Escape closes an
  // open color picker first, then the panel.
  holdPanelInput(el, () => {
    if (el.querySelector('.pc-color-popover')) controls.forEach((c) => c.control.destroy());
    else close();
  });
  container.append(el);

  // Reflect changes made through the API, a theme switch, a preset or a reset.
  const refresh = () => {
    presets?.refresh();
    modes?.set(handle.mode);
    controls.forEach((c) => c.control.setValue(c.read()));
  };
  const off = chart.on('appearance:change', refresh);
  // Focus the chosen preset or the first color, not Reset all, so an early Enter cannot wipe the overrides.
  if (presets) presets.focus();
  else (el.querySelector('.pc-color-trigger') as HTMLElement | null)?.focus();
  return { close, refresh };
}
