/**
 * Pure toolbar list operations and overflow ordering. Kept free of DOM so the
 * rules are unit-testable; `toolbar.ts` applies the results to elements.
 */

/**
 * Top-bar groups from the placement standard (`roadmap/toolbar-layout.md`):
 * `context` (symbol, interval, chart type) on the left, `analysis`
 * (indicators, compare, layers) after it, `view` (layouts, screenshot,
 * settings) at the right edge.
 */
export type ToolbarGroup = 'context' | 'analysis' | 'view';

/** The groups in display order. */
export const toolbarGroups: readonly ToolbarGroup[] = ['context', 'analysis', 'view'];

/** Fields every toolbar item may carry that affect placement. */
export interface ToolbarLayoutItem {
  type: string;
  id?: string;
  hidden?: boolean;
  align?: 'start' | 'end';
  priority?: number;
  group?: ToolbarGroup;
}

/** Where `add` inserts an item. Omitted = after the last item of its group. */
export type ToolbarPlacement = { before: string } | { after: string };

function indexOfId(items: readonly ToolbarLayoutItem[], id: string): number {
  return items.findIndex((item) => item.id === id);
}

export function insertItem<T extends ToolbarLayoutItem>(
  items: readonly T[],
  item: T,
  placement?: ToolbarPlacement,
): T[] {
  if (item.id !== undefined && indexOfId(items, item.id) !== -1) {
    throw new Error(`Toolbar item "${item.id}" already exists`);
  }
  const next = items.slice();
  if (!placement) {
    next.push(item);
    return next;
  }
  const anchor = 'before' in placement ? placement.before : placement.after;
  const index = indexOfId(items, anchor);
  if (index === -1) throw new Error(`Toolbar item "${anchor}" not found`);
  next.splice('before' in placement ? index : index + 1, 0, item);
  return next;
}

/** Returns a new list with the item merged with `patch`, or the same list if `id` is unknown. */
export function updateItem<T extends ToolbarLayoutItem>(items: readonly T[], id: string, patch: Partial<T>): readonly T[] {
  const index = indexOfId(items, id);
  if (index === -1) return items;
  const next = items.slice();
  next[index] = { ...items[index]!, ...patch, id };
  return next;
}

/** Returns a new list without the item, or the same list if `id` is unknown. */
export function removeItem<T extends ToolbarLayoutItem>(items: readonly T[], id: string): readonly T[] {
  const index = indexOfId(items, id);
  if (index === -1) return items;
  return items.filter((_, i) => i !== index);
}

/** The item's side: its `align`, else `end` for the view group and `start` for the rest. */
export function alignOf(item: ToolbarLayoutItem): 'start' | 'end' {
  return item.align ?? (item.group === 'view' ? 'end' : 'start');
}

/**
 * Render order: `start` items with the context group first, then `end` items.
 * Within each part items keep their list order.
 */
export function displayOrder<T extends ToolbarLayoutItem>(items: readonly T[]): T[] {
  const start = items.filter((i) => alignOf(i) === 'start');
  return [
    ...start.filter((i) => i.group === 'context'),
    ...start.filter((i) => i.group !== 'context'),
    ...items.filter((i) => alignOf(i) === 'end'),
  ];
}

/**
 * Ids in the order they move into the overflow menu as space runs out.
 * The view group goes first and the context group last; ungrouped items rank
 * with the analysis group. Within a rank, lower `priority` goes first and
 * items without one go last. Ties drop from the right edge inwards. Custom
 * items go after all others, since the menu cannot list them. Hidden items,
 * separators and spacers never overflow.
 */
export function overflowOrder(items: readonly ToolbarLayoutItem[]): string[] {
  const ordered = displayOrder(items);
  return ordered
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.id !== undefined && !item.hidden && item.type !== 'separator' && item.type !== 'spacer')
    .sort(
      (a, b) =>
        rank(a.item) - rank(b.item) ||
        (a.item.priority ?? Infinity) - (b.item.priority ?? Infinity) ||
        b.index - a.index,
    )
    .map(({ item }) => item.id!);
}

/** Overflow rank: the view group goes first, ungrouped and analysis items next, context last (`toolbarGroups` reversed), custom items after them. */
function rank(item: ToolbarLayoutItem): number {
  return item.type === 'custom' ? 3 : 2 - toolbarGroups.indexOf(item.group ?? 'analysis');
}

export type ToolbarSlotKind = 'item' | 'separator' | 'spacer' | 'hidden';

/**
 * Whether each separator should show: only between two visible items, so
 * hiding or overflowing items never leaves doubled or dangling separators.
 * Non-separator slots map to `true` when visible.
 */
export function separatorVisibility(kinds: readonly ToolbarSlotKind[]): boolean[] {
  const result = kinds.map((k) => k !== 'hidden');
  let lastShown: ToolbarSlotKind | null = null;
  let pending = -1;
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i]!;
    if (kind === 'hidden') continue;
    if (kind === 'separator') {
      result[i] = false;
      if (lastShown === 'item' && pending === -1) pending = i;
      continue;
    }
    if (kind === 'item' && pending !== -1) result[pending] = true;
    pending = -1;
    lastShown = kind;
  }
  return result;
}

/**
 * Which items open a new group behind a divider: a shown start-aligned item
 * whose group (ungrouped items count as `analysis`) differs from the shown
 * start-aligned item before it, unless a shown separator or spacer already
 * sits between them. End items need none: the auto margin parts them.
 */
export function groupDividers(items: readonly ToolbarLayoutItem[], shown: readonly boolean[]): boolean[] {
  let previous: ToolbarGroup | null = null;
  return items.map((item, i) => {
    if (!shown[i] || alignOf(item) !== 'start') return false;
    if (item.type === 'separator' || item.type === 'spacer') {
      previous = null;
      return false;
    }
    const group = item.group ?? 'analysis';
    const divides = previous !== null && group !== previous;
    previous = group;
    return divides;
  });
}
