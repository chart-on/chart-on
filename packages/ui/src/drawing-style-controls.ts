import {
  contrastText,
  parseColor,
  resolveLevelColor,
  withAlpha,
  type ChartTheme,
  type Drawing,
  type DrawingLevel,
  type DrawingStyle,
  type DrawingToolDef,
  type Localizer,
} from '@chart-on/core';
import { ArrowLeftToLine, ArrowRightToLine, Bold, Droplet, Italic, Ruler, SeparatorHorizontal, Tag } from 'lucide';
import { createColorControl } from './color-control';
import { iconButton, menuButton, type MenuOption } from './controls';
import { h, markActive, type IconSource } from './dom';
import { keyOf, shellText, type Localized, type ShellMessageKey } from './messages';
import { resolveFont } from '@chart-on/core';

/** How a control changes the drawing it edits: a live preview, or a committed undo step. */
export interface StyleEdit {
  preview(style: DrawingStyle): void;
  commit(style: DrawingStyle): void;
}

/** What a control needs besides the drawing: the tool that draws it and the theme it falls back to. */
export interface StyleFieldContext {
  tool: DrawingToolDef | undefined;
  theme: ChartTheme;
  edit: StyleEdit;
  /** The language of the labels, usually `chart.localization`. */
  localization?: Localizer;
}

/** A control for one style field of the selected drawing. */
export interface StyleFieldControl {
  key: string;
  /** Accessible name, also the row label in the "more" popover. */
  label: string;
  el: HTMLElement;
  /** Show the drawing's current value. */
  sync(d: Drawing): void;
  /** Close any picker it opened, committing a pending change. */
  destroy(): void;
}

/** Line widths the toolbar and the settings dialog offer, besides the drawing's own. */
export const LINE_WIDTHS: readonly number[] = [1, 2, 3, 4];
/** Line width a tool draws with when the style sets none (most tools). */
export const DEFAULT_LINE_WIDTH = 1.5;
/**
 * Font sizes offered for drawing text: `base * 2^(k/3)` for k from -1 to 6,
 * rounded to whole px (at least 1, without repeats for a tiny base). Every third
 * step doubles the size, so each step is a clear change (about 26 %), from one
 * step below the theme's size to four times it.
 */
export const fontSizes = (base: number): number[] => [...new Set(Array.from({ length: 8 }, (_, k) => Math.max(1, Math.round(base * 2 ** ((k - 1) / 3)))))];

/** An on/off style field `key`; message `drawing<Key>` names it. */
export interface Toggle {
  icon: IconSource;
  /** Value when the style leaves the field out. */
  fallback: boolean;
}

/** On/off style fields: their label, toolbar icon and value when unset. */
export const TOGGLES: Readonly<Record<string, Toggle>> = {
  bold: { icon: Bold, fallback: false },
  italic: { icon: Italic, fallback: false },
  showLabel: { icon: Tag, fallback: true },
  showStats: { icon: Ruler, fallback: true },
  showFill: { icon: Droplet, fallback: true },
  extendLeft: { icon: ArrowLeftToLine, fallback: false },
  extendRight: { icon: ArrowRightToLine, fallback: false },
  middleLine: { icon: SeparatorHorizontal, fallback: true },
};

/** Message keys of the names of the built-in style fields that are not toggles. */
const FIELD_KEYS: Readonly<Record<string, ShellMessageKey>> = {
  color: 'seriesColor',
  textColor: 'drawingTextColor',
  fill: 'drawingFill',
  profitColor: 'drawingProfitColor',
  lossColor: 'drawingLossColor',
  lineWidth: 'indicatorPlotLineWidth',
  lineStyle: 'indicatorPlotLineStyle',
  fontSize: 'drawingFontSize',
  levels: 'drawingLevels',
  labelSide: 'drawingLabelSide',
  labelContent: 'drawingLabelContent',
};

/** The name of built-in style field `key` in the language of `chart`; undefined for a plugin's own key. */
export function fieldLabel(chart: Localized, key: string): string | undefined {
  const message = FIELD_KEYS[key] ?? (TOGGLES[key] && keyOf('drawing', key));
  return message && shellText(chart, message);
}

/** The line style choices, named in the language of `chart`. */
export const lineStyleOptions = (chart: Localized) =>
  (['solid', 'dashed', 'dotted'] as const).map((value) => ({
    value,
    label: shellText(chart, value === 'solid' ? 'lineStyleSolid' : value === 'dashed' ? 'lineStyleDashed' : 'lineStyleDotted'),
  }));

/** The color a position draws its profitable or losing side in without one of its own: the theme's up or down. */
export const positionColor = (key: 'profitColor' | 'lossColor', theme: ChartTheme): string => (key === 'profitColor' ? theme.up : theme.down);

/** The fill a tool draws without a `fill` of its own: a tint of `color` at the tool's `fillAlpha` (default 0.14). */
export const defaultFill = (color: string, tool: DrawingToolDef | undefined): string => withAlpha(color, tool?.fillAlpha ?? 0.14);

/** `#rrggbb` for a color input (alpha dropped). */
export function toHex(color: string): string {
  const [r, g, b] = parseColor(color);
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The color a drawing of `tool` draws in: its style's `color`, else the
 * tool's `themeColor`, which may depend on `drawing` (else the theme's drawing color).
 */
export function drawnColor(style: DrawingStyle, tool: DrawingToolDef | undefined, theme: ChartTheme, drawing?: Drawing): string {
  const key = typeof tool?.themeColor === 'function' ? drawing && tool.themeColor(drawing) : tool?.themeColor;
  return style.color || theme[key ?? 'drawing'] || theme.drawing;
}

/**
 * The text color a drawing of `tool` shows: its `textColor`, else for a
 * text tool its `color`, else black or white over the color it draws in, as
 * labels draw (the theme background for a color that cannot be read).
 */
export function drawnTextColor(style: DrawingStyle, tool: DrawingToolDef | undefined, theme: ChartTheme, drawing?: Drawing): string {
  if (style.textColor) return style.textColor;
  if (tool?.editableText === true) return style.color || theme.drawingSelected;
  try {
    return contrastText(drawnColor(style, tool, theme, drawing));
  } catch {
    return theme.background;
  }
}

/** A field's value as the drawing shows it, falling back to its tool's own default. */
function styleValue<K extends keyof DrawingStyle>(d: Drawing, ctx: StyleFieldContext, key: K): DrawingStyle[K] {
  return d.style[key] ?? ctx.tool?.defaultStyle?.[key];
}

/** A plugin tool's own style key, which `DrawingStyle` does not declare. */
function ownValue(d: Drawing, ctx: StyleFieldContext, key: string): unknown {
  return (d.style as Record<string, unknown>)[key] ?? (ctx.tool?.defaultStyle as Record<string, unknown> | undefined)?.[key];
}

/**
 * Color picker for `key`, the same one the fill uses. Changes while the picker
 * is open only preview; closing it after a change commits one undo step.
 */
function colorInput(key: string, label: string | undefined, read: (d: Drawing) => string, ctx: StyleFieldContext): StyleFieldControl {
  label ??= fieldLabel(ctx, key)!;
  const control = createColorControl({
    label,
    value: ctx.theme.drawing,
    onInput: (color) => ctx.edit.preview({ [key]: color }),
    onCommit: (color) => ctx.edit.commit({ [key]: color }),
    localization: ctx.localization,
  });
  return { key, label, el: control.el, sync: (d) => control.setValue(read(d)), destroy: control.destroy };
}

/** How a fill swatch shows a background that is off: fully transparent. */
const OFF = 'rgba(0, 0, 0, 0)';

function fillControl(ctx: StyleFieldContext): StyleFieldControl {
  const label = fieldLabel(ctx, 'fill')!;
  // The tint of the line color the tool fills with when the style has no fill; none while the background is off.
  const read = (d: Drawing) => (d.style.showFill === false ? OFF : (d.style.fill ?? defaultFill(d.style.color ?? ctx.theme.drawing, ctx.tool)));
  // Picking a fill while the background is off turns it back on, so the pick shows.
  let off = false;
  const patch = (fill: string): DrawingStyle => (off ? { fill, showFill: true } : { fill });
  const control = createColorControl({
    label,
    value: ctx.theme.drawing,
    onInput: (fill) => ctx.edit.preview(patch(fill)),
    onCommit: (fill) => ctx.edit.commit(patch(fill)),
    localization: ctx.localization,
  });
  const sync = (d: Drawing) => {
    off = d.style.showFill === false;
    control.setValue(read(d));
  };
  return { key: 'fill', label, el: control.el, sync, destroy: control.destroy };
}

function lineWidthControl(ctx: StyleFieldContext): StyleFieldControl {
  const label = fieldLabel(ctx, 'lineWidth')!;
  const options = LINE_WIDTHS.map(sizeOption);
  const menu = menuButton({
    label,
    options,
    onSelect: (v) => ctx.edit.commit({ lineWidth: Number(v) }),
  });
  const sync = (d: Drawing) => {
    const own = styleValue(d, ctx, 'lineWidth');
    // The width the tool draws with, as the settings dialog shows it.
    const width = typeof own === 'number' && Number.isFinite(own) && own > 0 ? own : DEFAULT_LINE_WIDTH;
    listSizes(options, LINE_WIDTHS, width);
    menu.set(String(width));
  };
  return { key: 'lineWidth', label, el: menu.el, sync, destroy() {} };
}

function lineStyleControl(ctx: StyleFieldContext): StyleFieldControl {
  const label = fieldLabel(ctx, 'lineStyle')!;
  const menu = menuButton({
    label,
    options: lineStyleOptions(ctx),
    onSelect: (v) => ctx.edit.commit({ lineStyle: v as DrawingStyle['lineStyle'] }),
  });
  return { key: 'lineStyle', label, el: menu.el, sync: (d) => menu.set(styleValue(d, ctx, 'lineStyle') ?? 'solid'), destroy() {} };
}

const sizeOption = (size: number): MenuOption => ({ value: String(size), label: `${size}px` });

/** Fill `options` (a menu's list, which it reads when it renders) with `sizes`, plus `size` when it is not one of them, so the trigger shows it instead of nothing. */
function listSizes(options: MenuOption[], sizes: readonly number[], size: number): void {
  const all = sizes.includes(size) ? sizes : [...sizes, size].sort((a, b) => a - b);
  options.splice(0, options.length, ...all.map(sizeOption));
}

function fontSizeControl(ctx: StyleFieldContext): StyleFieldControl {
  // The menu reads this list when it renders, so the theme's sizes and the drawing's own are set on sync.
  const options: MenuOption[] = [];
  const label = fieldLabel(ctx, 'fontSize')!;
  const menu = menuButton({
    label,
    options,
    onSelect: (v) => ctx.edit.commit({ fontSize: Number(v) }),
  });
  const sync = (d: Drawing) => {
    const own = styleValue(d, ctx, 'fontSize');
    const base = resolveFont(ctx.theme, 'drawings').fontSize;
    const size = typeof own === 'number' && Number.isFinite(own) && own > 0 ? own : base;
    listSizes(options, fontSizes(base), size);
    menu.set(String(size));
  };
  return { key: 'fontSize', label, el: menu.el, sync, destroy() {} };
}

function toggleControl(key: string, t: Toggle, ctx: StyleFieldContext): StyleFieldControl {
  let on = t.fallback;
  const label = shellText(ctx, keyOf('drawing', key));
  const el = iconButton({ icon: t.icon, label, variant: 'ghost', onClick: () => ctx.edit.commit({ [key]: !on }) });
  const sync = (d: Drawing) => {
    const value = (d.style as Record<string, unknown>)[key];
    on = typeof value === 'boolean' ? value : t.fallback;
    markActive(el, on);
  };
  return { key, label, el, sync, destroy() {} };
}

/** Menu for a plugin tool's `select` setting. */
function settingMenu(key: string, label: string, options: { value: string; label: string }[], ctx: StyleFieldContext): StyleFieldControl {
  const menu = menuButton({ label, options, onSelect: (v) => ctx.edit.commit({ [key]: v }) });
  const sync = (d: Drawing) => {
    const value = ownValue(d, ctx, key);
    menu.set(typeof value === 'string' ? value : (options[0]?.value ?? ''));
  };
  return { key, label, el: menu.el, sync, destroy() {} };
}

/** Control for a plugin tool's `settings` entry `key`: colors and selects; the rest only in the settings dialog. */
function settingControl(key: string, ctx: StyleFieldContext): StyleFieldControl | null {
  const setting = ctx.tool?.settings?.find((s) => s.key === key);
  if (setting?.type === 'color') {
    return colorInput(key, setting.label, (d) => {
      const value = ownValue(d, ctx, key);
      return typeof value === 'string' && value !== '' ? value : ctx.theme.drawing;
    }, ctx);
  }
  if (setting?.type === 'select') return settingMenu(key, setting.label, setting.options, ctx);
  return null;
}

/**
 * The control for style field `key`, or null for a field the toolbar has no
 * control for (levels, which get their own editor, and plugin settings other
 * than colors and selects).
 */
export function styleFieldControl(key: string, ctx: StyleFieldContext): StyleFieldControl | null {
  switch (key) {
    case 'color':
      return colorInput('color', undefined, (d) => drawnColor(d.style, ctx.tool, ctx.theme, d), ctx);
    case 'textColor':
      return colorInput('textColor', undefined, (d) => drawnTextColor(d.style, ctx.tool, ctx.theme, d), ctx);
    case 'fill':
      return fillControl(ctx);
    case 'profitColor':
    case 'lossColor':
      return colorInput(key, undefined, (d) => d.style[key] ?? positionColor(key, ctx.theme), ctx);
    case 'lineWidth':
      return lineWidthControl(ctx);
    case 'lineStyle':
      return lineStyleControl(ctx);
    case 'fontSize':
      return fontSizeControl(ctx);
  }
  const toggle = TOGGLES[key];
  return toggle ? toggleControl(key, toggle, ctx) : settingControl(key, ctx);
}

/** The levels a level-based drawing shows: its own, else its tool's defaults. */
export function drawingLevels(d: Drawing, tool: DrawingToolDef | undefined): DrawingLevel[] {
  const levels = Array.isArray(d.style.levels) ? d.style.levels : (tool?.defaultStyle?.levels ?? []);
  return levels.map((l) => ({ ...l }));
}

/** `levels` with level `index` patched. */
export function patchLevel(levels: readonly DrawingLevel[], index: number, patch: Partial<DrawingLevel>): DrawingLevel[] {
  return levels.map((l, i) => (i === index ? { ...l, ...patch } : { ...l }));
}

const formatValue = (v: number) => String(Number(v.toFixed(4)));

/** Rows editing a list of levels; see `levelsControl`. */
export interface LevelsControl {
  el: HTMLElement;
  /** Show `levels`; `color` is the color of a level without its own. */
  show(levels: readonly DrawingLevel[], color: string): void;
}

/**
 * One row per level with its visibility, value and color. `change` gets the
 * patched list: `final` false while a color picker is dragged, true for a
 * settled edit. A value that is not a number is put back. `theme` resolves a
 * level color that names a theme color, so its swatch shows the drawn color.
 */
export function levelsControl(
  change: (levels: DrawingLevel[], final: boolean) => void,
  theme: () => ChartTheme,
  chart?: Localized,
): LevelsControl {
  const el = h('div', { class: 'pc-levels', role: 'group', 'aria-label': fieldLabel(chart, 'levels')! });
  let levels: DrawingLevel[] = [];
  const rows: { visible: HTMLInputElement; value: HTMLInputElement; color: HTMLInputElement }[] = [];

  const commit = (index: number, patch: Partial<DrawingLevel>) => change(patchLevel(levels, index, patch), true);

  const row = (index: number) => {
    // `show` names the inputs after the level's value.
    const visible = h('input', { type: 'checkbox', class: 'pc-levels-visible' });
    visible.addEventListener('change', () => commit(index, { visible: visible.checked }));
    const value = h('input', { type: 'number', step: '0.001', class: 'pc-levels-value' });
    value.addEventListener('change', () => {
      const v = Number(value.value);
      if (value.value.trim() !== '' && Number.isFinite(v)) commit(index, { value: v });
      else value.value = formatValue(levels[index]!.value);
    });
    const swatch = h('input', { type: 'color', class: 'pc-color-input' });
    swatch.addEventListener('input', () => change(patchLevel(levels, index, { color: swatch.value }), false));
    swatch.addEventListener('change', () => commit(index, { color: swatch.value }));
    el.append(h('div', { class: 'pc-levels-row' }, visible, value, swatch));
    rows.push({ visible, value, color: swatch });
  };

  const show = (next: readonly DrawingLevel[], color: string) => {
    levels = next.map((l) => ({ ...l }));
    if (rows.length !== levels.length) {
      el.replaceChildren();
      rows.length = 0;
      levels.forEach((_, i) => row(i));
    }
    levels.forEach((l, i) => {
      const r = rows[i]!;
      r.visible.checked = l.visible !== false;
      // Leave a value the user is typing alone.
      if (document.activeElement !== r.value) r.value.value = formatValue(l.value);
      r.color.value = toHex(resolveLevelColor(l, theme()) ?? color);
      const params = { value: formatValue(l.value) };
      r.value.setAttribute('aria-label', shellText(chart, 'drawingLevelValue', params));
      r.visible.setAttribute('aria-label', shellText(chart, 'drawingLevelShow', params));
      r.color.setAttribute('aria-label', shellText(chart, 'drawingLevelColor', params));
    });
  };

  return { el, show };
}

/**
 * Levels editor for the selected drawing. Every change is one undo step;
 * dragging across a color picker previews.
 */
export function levelsEditor(ctx: StyleFieldContext): StyleFieldControl {
  const control = levelsControl((levels, final) => (final ? ctx.edit.commit({ levels }) : ctx.edit.preview({ levels })), () => ctx.theme, ctx);
  const sync = (d: Drawing) => control.show(drawingLevels(d, ctx.tool), d.style.color ?? ctx.theme.drawing);
  return { key: 'levels', label: fieldLabel(ctx, 'levels')!, el: control.el, sync, destroy() {} };
}
