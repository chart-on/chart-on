import type { DrawingStyle, DrawingToolDef } from './types';

/** Fields the floating toolbar shows for a drawing at most. */
const MAX_QUICK_FIELDS = 4;
/** Fields every tool offers when its style carries too few: color, line width, line style. */
const BASE_FIELDS = ['color', 'lineWidth', 'lineStyle'];
const COLOR_FIELDS = new Set(['color', 'fill', 'textColor']);
/**
 * Fields a derived toolbar leaves to a full settings surface: levels need an
 * editor of their own, and the extend flags come as a pair that the four slots
 * would split.
 */
const DIALOG_FIELDS = new Set(['levels', 'extendLeft', 'extendRight']);

/**
 * The style fields `tool` honors: its `styleFields`, or else the base fields
 * and the keys its `settings` declare.
 */
export function toolStyleFields(tool: DrawingToolDef | undefined): string[] {
  if (tool?.styleFields) return [...new Set(tool.styleFields)];
  return [...new Set([...BASE_FIELDS, ...(tool?.settings ?? []).map((s) => s.key)])];
}

/**
 * The style fields a toolbar should offer for a drawing of `tool` with
 * `style`, at most four. `registered` (from `registerToolQuickFields`) wins.
 * Then the first plain-valued fields of the tool's `styleFields`, in the
 * tool's order, without levels and the extend flags. Otherwise: the fields
 * the style carries and the tool's `settings` declare, colours first, then
 * the base fields to fill up. Levels and other structured values are left to
 * a full settings surface.
 */
export function deriveQuickFields(
  style: DrawingStyle,
  tool: DrawingToolDef | undefined,
  registered?: readonly string[],
): string[] {
  if (registered) return registered.slice(0, MAX_QUICK_FIELDS);
  const levelKeys = new Set(DIALOG_FIELDS);
  for (const setting of tool?.settings ?? []) if (setting.type === 'levels') levelKeys.add(setting.key);
  if (tool?.styleFields) {
    return toolStyleFields(tool)
      .filter((key) => !levelKeys.has(key))
      .slice(0, MAX_QUICK_FIELDS);
  }
  const colors = new Set(COLOR_FIELDS);
  const carried: string[] = [];
  for (const [key, value] of Object.entries(style)) {
    if (value !== undefined && typeof value !== 'object') carried.push(key);
  }
  for (const setting of tool?.settings ?? []) {
    if (setting.type === 'levels') continue;
    carried.push(setting.key);
    if (setting.type === 'color') colors.add(setting.key);
  }
  const fields = [...new Set([...carried, ...BASE_FIELDS])];
  // Stable: colours first, each group in the order above.
  const isColor = (key: string) => (colors.has(key) ? 0 : 1);
  return fields.sort((a, b) => isColor(a) - isColor(b)).slice(0, MAX_QUICK_FIELDS);
}
