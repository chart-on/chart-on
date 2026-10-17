import { resolveThemeColor, type ChartTheme } from '../theme';
import { mixColors } from '../util/color';
import type { DrawingLevel } from './types';

/** ln(1/φ), φ the golden ratio: log_φ(1/x) is ln x divided by it. */
const LN_INV_PHI = -0.48121182505960347;
/** Golden steps from the key ratio (one step) to the faintest level, an eighth, Gann's finest division: log_φ 8 − 1. */
const FADE_STEPS = 3.32126;
/** Share of the way to the canvas that the farthest level fades. */
const FADE = 0.8;
/** Each whole move past the first keeps this share of a level's distance from the canvas. */
const REPEAT_KEEP = 0.82;

/**
 * Color of a drawing level with value `value` in `theme`: the shared rule
 * behind every built-in level tool's default levels. It depends only on the
 * value and the theme, so a ratio has the same color in every tool, and it
 * changes lightness, not only hue, from level to level:
 *
 * - A whole multiple (0, 1, 2 …: the move's own ends and its repeats) is
 *   neutral, the theme's `text`.
 * - Any other value takes its fraction f of a whole move and counts the golden
 *   steps from the move's end, log_φ(1/f). One step is the golden section
 *   (0.618, and 1.618 and 2.618 past the move): the key ratio of the
 *   Fibonacci tools, drawn in the pure accent (`drawing`). Fewer steps (0.786,
 *   0.75) lie between the accent and the neutral; more steps (0.5, 0.382 …
 *   down to an eighth) fade from the accent towards the canvas (`background`).
 *   The fade runs along the square root of the steps beyond the key, so the
 *   key's close neighbours, such as 0.5, still differ clearly in lightness.
 * - Each whole move past the first fades the level a further 18% of its way
 *   towards the canvas, so 1.618 and 2.618, or 2, 3 and 4, stay apart.
 *
 * Negative values mirror positive ones. Returns `undefined` for a theme
 * without level colors (`levelNeutral` unset, as `forcedColorsTheme` makes
 * it), so the level takes the drawing's color.
 */
export function levelColor(value: number, theme: ChartTheme): string | undefined {
  const { text, drawing, background, levelNeutral } = theme;
  if (levelNeutral === undefined) return undefined;
  const r = Math.abs(value);
  const fraction = r % 1;
  let color = text;
  if (fraction > 0) {
    // Rounded to hundredths, so ratios written to three decimals (0.618) land exactly on a golden step.
    const steps = +(Math.log(fraction) / LN_INV_PHI).toFixed(2);
    color =
      steps <= 1
        ? mixColors(text, drawing, steps)
        : mixColors(drawing, background, Math.min((steps - 1) / FADE_STEPS, 1) ** 0.5 * FADE);
  }
  // Whole moves past the first; below 1 the share is negative, which mixColors clamps to none.
  return mixColors(color, background, 1 - REPEAT_KEEP ** (Math.ceil(r) - 1));
}

/**
 * The color `level` is drawn in: the shared rule's for `'auto'`, else its own
 * CSS color or theme color name (see `resolveThemeColor`). `undefined` when it
 * has none, so callers fall back to the drawing's color with `??`.
 */
export function resolveLevelColor(level: DrawingLevel, theme: ChartTheme): string | undefined {
  return level.color === 'auto' ? levelColor(level.value, theme) : resolveThemeColor(level.color, theme);
}

/**
 * Default levels with colors from the shared rule, in the order of `values`.
 * Levels that fail `shown` are listed but hidden until the user turns them on.
 */
export function ruleLevels(values: readonly number[], shown?: (value: number) => boolean): DrawingLevel[] {
  return values.map((value) => ({ value, color: 'auto', ...(shown?.(value) === false && { visible: false }) }));
}
