import { parseColor, type Localizer } from '@chart-on/core';
import { followTrigger, gridKeys, h, placeFixed, popoverToggle } from './dom';
import { shellText } from './messages';

/** Columns of the swatch grid (`.pc-swatches` in the stylesheet): one per hue of the defaults. */
const SWATCH_COLUMNS = 10;

/**
 * Default swatches, read row by row in a grid of `SWATCH_COLUMNS`.
 *
 * Rule: the first row is neutral, OKLCH lightness 1 − 0.08·i for i = 0…8,
 * then black. Each later row is one lightness, 0.92 − 0.08·r for r = 0…6
 * (lightest first), across ten hues 36° apart from 25°, so each column is
 * one hue. Chroma is 0.2, reduced only as far as needed to stay inside sRGB.
 * Values are rounded to `#rrggbb`.
 */
export const defaultSwatches: readonly string[] = [
  '#ffffff', '#e4e4e4', '#cacaca', '#b1b1b1', '#989898', '#808080', '#696969', '#525252', '#3d3d3d', '#000000',
  '#ffdbd7', '#ffddc2', '#ffe56e', '#b1ff70', '#8affd7', '#a0f5ff', '#cce9ff', '#dde3ff', '#f1dbff', '#ffd8ea',
  '#ffb5ae', '#ffba7f', '#ebc900', '#95e54c', '#00edb8', '#00e5f7', '#96d2ff', '#bdc6ff', '#e4b5ff', '#ffaed5',
  '#ff8a82', '#ff9201', '#cdb000', '#7cca29', '#00cfa0', '#00c8d8', '#55bbff', '#9da9ff', '#d78cff', '#ff7ec2',
  '#fc5855', '#dc7d00', '#b19700', '#66af00', '#00b28a', '#00acba', '#00a2f0', '#808aff', '#c26bee', '#ec59ac',
  '#de3b3d', '#ba6900', '#957f00', '#559400', '#009774', '#00919d', '#0088cb', '#676cf4', '#a952d3', '#d03d93',
  '#c21725', '#995500', '#7b6800', '#457900', '#007c5e', '#007781', '#0070a7', '#5252d8', '#9037b8', '#b41d7b',
  '#9e0017', '#7a4300', '#615200', '#356000', '#00624a', '#005e66', '#005885', '#3f37bd', '#77189e', '#940062',
];

/** A color as an opaque `#rrggbb` plus opacity 0..1. */
export interface ColorParts {
  hex: string;
  alpha: number;
}

/** Split any color `parseColor` reads into `#rrggbb` and opacity. */
export function splitColor(color: string): ColorParts {
  const [r, g, b, a] = parseColor(color);
  const hex = `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
  return { hex, alpha: Math.round((a / 255) * 100) / 100 };
}

/** `#rrggbb` when opaque, else `rgba(...)` with the opacity rounded to two decimals. */
export function joinColor({ hex, alpha }: ColorParts): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 100) / 100;
  if (a >= 1) return hex.toLowerCase();
  const [r, g, b] = parseColor(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Options for `createColorControl`: its accessible name, the starting color, swatches, and the live-change and commit callbacks. */
export interface ColorControlOptions {
  /** Accessible name, e.g. "Rising candle body". */
  label: string;
  value: string;
  /** Called on every change while the user picks, for a live preview. */
  onInput(color: string): void;
  /** Called once when the picker closes after a change, e.g. to record one undo step. */
  onCommit?(color: string): void;
  swatches?: readonly string[];
  /** The language of the picker's own text, usually `chart.localization`. Default English. */
  localization?: Localizer;
}

/** A color control made by `createColorControl`: its element, plus `setValue` and `destroy`. */
export interface ColorControl {
  el: HTMLElement;
  /** Show a new value without calling `onInput`, e.g. after an API change. */
  setValue(color: string): void;
  destroy(): void;
}

/**
 * A swatch button that opens a picker with a swatch palette, a custom color
 * input and an opacity slider (0 to 100%). The opacity is kept when a swatch
 * or custom color is picked, unless it is 0, which becomes 100%.
 */
export function createColorControl(options: ColorControlOptions): ColorControl {
  let parts = splitColor(options.value);
  const wrap = h('div', { class: 'pc-color-control' });
  const chip = h('span', { class: 'pc-color-chip' });
  const trigger = h('button', {
    class: 'pc-color-trigger',
    'aria-label': options.label,
    'aria-haspopup': 'dialog',
  });
  trigger.append(chip);
  wrap.append(trigger);

  let custom: HTMLInputElement | null = null;
  let slider: HTMLInputElement | null = null;
  let percent: HTMLElement | null = null;
  /** Changed since the picker opened, so closing it commits. */
  let changed = false;

  const paint = () => {
    const color = joinColor(parts);
    chip.style.background = color;
    trigger.setAttribute('data-tip', `${options.label}: ${color}`);
    if (custom) custom.value = parts.hex;
    if (slider) slider.value = String(Math.round(parts.alpha * 100));
    if (percent) percent.textContent = `${Math.round(parts.alpha * 100)}%`;
  };
  const change = (next: Partial<ColorParts>) => {
    // Picking a color while fully transparent (e.g. an unset border) makes it visible.
    if (next.hex !== undefined && next.alpha === undefined && parts.alpha === 0) next = { ...next, alpha: 1 };
    parts = { ...parts, ...next };
    changed = true;
    paint();
    options.onInput(joinColor(parts));
  };

  /** Stops the open picker following its trigger; set on each open, before any close. */
  let unfollow: () => void;
  // Closing hands focus back to the trigger when it was in the picker (Escape, panel close), not after a click elsewhere.
  const { close } = popoverToggle(wrap, trigger, () => {
    const panel = h('div', { class: 'pc-popover pc-color-popover', role: 'dialog', 'aria-label': options.label });
    const grid = h('div', { class: 'pc-swatches', role: 'group', 'aria-label': shellText(options, 'colorSwatches') });
    const buttons = (options.swatches ?? defaultSwatches).map((swatch, i) => {
      const b = h('button', { class: 'pc-swatch', 'aria-label': swatch, 'data-tip': swatch });
      b.tabIndex = i ? -1 : 0;
      b.style.background = swatch;
      b.addEventListener('click', () => change({ hex: splitColor(swatch).hex }));
      grid.append(b);
      return b;
    });
    gridKeys(grid, () => buttons, SWATCH_COLUMNS);
    custom = h('input', { type: 'color', class: 'pc-color-input', 'aria-label': shellText(options, 'colorCustom') });
    custom.addEventListener('input', () => change({ hex: custom!.value }));
    slider = h('input', { type: 'range', min: '0', max: '100', step: '1', class: 'pc-opacity' });
    slider.addEventListener('input', () => change({ alpha: Number(slider!.value) / 100 }));
    percent = h('span', { class: 'pc-opacity-value' });
    const opacityText = shellText(options, 'colorOpacity');
    slider.setAttribute('aria-label', opacityText);
    const opacity = h('label', { class: 'pc-opacity-row' }, h('span', {}, opacityText), slider, percent);
    panel.append(grid, h('div', { class: 'pc-color-custom' }, h('span', {}, shellText(options, 'colorCustomShort')), custom), opacity);
    wrap.append(panel);
    // Fixed to the viewport, so a scrolling dialog body neither clips it nor grows around it.
    const place = () => placeFixed(panel, trigger);
    place();
    unfollow = followTrigger(panel, trigger, place, close);
    paint();
    (grid.firstElementChild as HTMLElement | null)?.focus();
    return panel;
  }, () => {
    unfollow();
    custom = slider = percent = null;
    if (changed) {
      changed = false;
      options.onCommit?.(joinColor(parts));
    }
  }, true);
  paint();

  return {
    el: wrap,
    setValue(color) {
      parts = splitColor(color);
      paint();
    },
    destroy: close,
  };
}
