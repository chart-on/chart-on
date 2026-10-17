import { alignOf, displayOrder, type ToolbarLayoutItem } from './toolbar-model';

/** Separators and spacers belong to the app, never the saved action list. */
export const isToolbarAction = (item: ToolbarLayoutItem): boolean => item.id !== undefined && item.type !== 'separator' && item.type !== 'spacer';
export const toolbarBucket = (item: ToolbarLayoutItem): string => `${item.group ?? 'analysis'}:${alignOf(item)}`;

/** Validate the versioned preference; malformed or newer data uses app defaults. */
export function readToolbarIds(raw: string | null): string[] | null {
  try {
    // `null` parses to null; primitives and arrays have no `version`.
    const value = JSON.parse(raw as string) as { version?: unknown; ids?: unknown } | null;
    return value?.version === 1 && Array.isArray(value.ids) && value.ids.every((id: unknown) => typeof id === 'string') ? [...new Set<string>(value.ids)] : null;
  } catch {
    return null;
  }
}

/** Resolve known ids by group/side, restoring locked defaults at their original slots. */
export function toolbarSelection<T extends ToolbarLayoutItem>(
  defaults: readonly T[], catalog: readonly T[], ids: readonly string[], locked: ReadonlySet<string>,
): T[] {
  const byId = new Map(catalog.filter(isToolbarAction).map((item) => [item.id!, item]));
  const selected = [...new Set(ids)].flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
  const buckets = [...new Set(displayOrder([...defaults, ...catalog]).filter(isToolbarAction).map(toolbarBucket))];
  return buckets.flatMap((bucket) => {
    const items = selected.filter((item) => toolbarBucket(item) === bucket && !locked.has(item.id!));
    defaults.filter((item) => isToolbarAction(item) && !item.hidden && toolbarBucket(item) === bucket).forEach((item, index) => {
      if (locked.has(item.id!)) items.splice(Math.min(index, items.length), 0, item);
    });
    return items;
  });
}

/** Refill app-owned slots, keeping separators/spacers and putting extra actions beside their group. */
export function toolbarLayout<T extends ToolbarLayoutItem>(defaults: readonly T[], selected: readonly T[]): T[] {
  const queues = new Map<string, T[]>();
  for (const item of selected) {
    const bucket = toolbarBucket(item);
    const queue = queues.get(bucket) ?? [];
    queue.push(item);
    queues.set(bucket, queue);
  }
  const last = new Map<string, number>();
  defaults.forEach((item, index) => { if (isToolbarAction(item)) last.set(toolbarBucket(item), index); });
  const result: T[] = [];
  defaults.forEach((item, index) => {
    if (!isToolbarAction(item)) return void result.push(item);
    const queue = queues.get(toolbarBucket(item));
    const next = queue?.shift();
    if (next) result.push(next);
    if (last.get(toolbarBucket(item)) === index && queue) result.push(...queue.splice(0));
  });
  for (const queue of queues.values()) result.push(...queue);
  return displayOrder(result);
}

/** Move only within one group/side and never across a locked action. */
export function moveToolbarAction<T extends ToolbarLayoutItem>(items: readonly T[], id: string, to: string, locked: ReadonlySet<string>): T[] | null {
  const from = items.findIndex((item) => item.id === id);
  const target = items.findIndex((item) => item.id === to);
  if (from < 0 || target < 0 || from === target || locked.has(id) || locked.has(to)) return null;
  if (toolbarBucket(items[from]!) !== toolbarBucket(items[target]!)) return null;
  if (items.slice(Math.min(from, target), Math.max(from, target) + 1).some((item) => locked.has(item.id!))) return null;
  const next = items.slice();
  next.splice(target, 0, next.splice(from, 1)[0]!);
  return next;
}
