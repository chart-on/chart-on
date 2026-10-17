import { describe, expect, it } from 'vitest';
import {
  alignOf,
  displayOrder,
  groupDividers,
  insertItem,
  overflowOrder,
  removeItem,
  separatorVisibility,
  updateItem,
  type ToolbarLayoutItem,
} from '../src/toolbar-model';

const ids = (items: readonly ToolbarLayoutItem[]) => items.map((i) => i.id ?? i.type);

const base: ToolbarLayoutItem[] = [
  { type: 'custom', id: 'symbol' },
  { type: 'separator' },
  { type: 'segmented', id: 'interval' },
  { type: 'button', id: 'fit' },
  { type: 'button', id: 'theme', align: 'end' },
];

describe('insertItem', () => {
  it('appends without a placement', () => {
    expect(ids(insertItem(base, { type: 'button', id: 'x' }))).toEqual([
      'symbol',
      'separator',
      'interval',
      'fit',
      'theme',
      'x',
    ]);
  });

  it('inserts before or after an anchor', () => {
    expect(ids(insertItem(base, { type: 'button', id: 'x' }, { before: 'interval' })).slice(0, 4)).toEqual([
      'symbol',
      'separator',
      'x',
      'interval',
    ]);
    expect(ids(insertItem(base, { type: 'button', id: 'x' }, { after: 'interval' })).slice(2, 5)).toEqual([
      'interval',
      'x',
      'fit',
    ]);
  });

  it('does not mutate the input', () => {
    insertItem(base, { type: 'button', id: 'x' });
    expect(base).toHaveLength(5);
  });

  it('rejects duplicate ids and unknown anchors', () => {
    expect(() => insertItem(base, { type: 'button', id: 'fit' })).toThrow(/already exists/);
    expect(() => insertItem(base, { type: 'button', id: 'x' }, { after: 'nope' })).toThrow(/not found/);
  });

  it('allows several items without ids', () => {
    expect(insertItem(base, { type: 'separator' })).toHaveLength(6);
  });
});

describe('updateItem', () => {
  it('merges the patch into a new item and keeps the id', () => {
    const next = updateItem(base, 'fit', { hidden: true, id: 'other' });
    expect(next[3]).toEqual({ type: 'button', id: 'fit', hidden: true });
    expect(next[3]).not.toBe(base[3]);
    expect(next[2]).toBe(base[2]);
  });

  it('returns the same list for an unknown id', () => {
    expect(updateItem(base, 'nope', { hidden: true })).toBe(base);
  });
});

describe('removeItem', () => {
  it('removes by id', () => {
    expect(ids(removeItem(base, 'interval'))).toEqual(['symbol', 'separator', 'fit', 'theme']);
  });

  it('returns the same list for an unknown id', () => {
    expect(removeItem(base, 'nope')).toBe(base);
  });
});

describe('displayOrder', () => {
  it('puts end-aligned items after start items, each in list order', () => {
    const items: ToolbarLayoutItem[] = [
      { type: 'button', id: 'a', align: 'end' },
      { type: 'button', id: 'b' },
      { type: 'button', id: 'c', align: 'end' },
      { type: 'button', id: 'd', align: 'start' },
    ];
    expect(ids(displayOrder(items))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('puts the context group first and the view group at the end', () => {
    const items: ToolbarLayoutItem[] = [
      { type: 'button', id: 'settings', group: 'view' },
      { type: 'button', id: 'compare', group: 'analysis' },
      { type: 'button', id: 'loose' },
      { type: 'menu', id: 'style', group: 'context' },
      { type: 'custom', id: 'symbol', group: 'context' },
    ];
    expect(ids(displayOrder(items))).toEqual(['style', 'symbol', 'compare', 'loose', 'settings']);
  });
});

describe('alignOf', () => {
  it('defaults the view group to the end and lets align override it', () => {
    expect(alignOf({ type: 'button', group: 'view' })).toBe('end');
    expect(alignOf({ type: 'button', group: 'view', align: 'start' })).toBe('start');
    expect(alignOf({ type: 'button', group: 'context' })).toBe('start');
    expect(alignOf({ type: 'button' })).toBe('start');
  });
});

describe('overflowOrder', () => {
  it('drops lower priority first, unprioritised items last', () => {
    const items: ToolbarLayoutItem[] = [
      { type: 'button', id: 'a' },
      { type: 'button', id: 'b', priority: 5 },
      { type: 'menu', id: 'c', priority: 1 },
      { type: 'segmented', id: 'd', priority: 3 },
    ];
    expect(overflowOrder(items)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('breaks ties from the right edge inwards, using display order', () => {
    const items: ToolbarLayoutItem[] = [
      { type: 'button', id: 'end', align: 'end' },
      { type: 'button', id: 'a' },
      { type: 'button', id: 'b' },
    ];
    expect(overflowOrder(items)).toEqual(['end', 'b', 'a']);
  });

  it('moves custom items after every other item', () => {
    const items: ToolbarLayoutItem[] = [
      { type: 'custom', id: 'symbol', group: 'context', priority: 0 },
      { type: 'button', id: 'interval', group: 'context' },
      { type: 'button', id: 'settings', group: 'view' },
    ];
    expect(overflowOrder(items)).toEqual(['settings', 'interval', 'symbol']);
  });

  it('skips hidden, separator and spacer items', () => {
    const items: ToolbarLayoutItem[] = [
      { type: 'custom', id: 'symbol', hidden: true },
      { type: 'separator', id: 'sep' },
      { type: 'spacer', id: 'gap' },
      { type: 'button', id: 'hidden', hidden: true, priority: 0 },
      { type: 'button', id: 'shown' },
    ];
    expect(overflowOrder(items)).toEqual(['shown']);
  });

  it('moves the view group first and the context group last, whatever the priority', () => {
    const items: ToolbarLayoutItem[] = [
      { type: 'segmented', id: 'interval', group: 'context', priority: 0 },
      { type: 'menu', id: 'style', group: 'context' },
      { type: 'menu', id: 'indicators', group: 'analysis', priority: 9 },
      { type: 'button', id: 'loose', priority: 1 },
      { type: 'button', id: 'screenshot', group: 'view', priority: 9 },
      { type: 'button', id: 'settings', group: 'view' },
    ];
    expect(overflowOrder(items)).toEqual(['screenshot', 'settings', 'loose', 'indicators', 'interval', 'style']);
  });
});

describe('separatorVisibility', () => {
  it('shows separators only between two visible items', () => {
    expect(separatorVisibility(['item', 'separator', 'item'])).toEqual([true, true, true]);
    expect(separatorVisibility(['separator', 'item', 'separator'])).toEqual([false, true, false]);
  });

  it('collapses separators around hidden items', () => {
    expect(separatorVisibility(['item', 'separator', 'hidden', 'separator', 'item'])).toEqual([
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  it('hides separators next to a spacer', () => {
    expect(separatorVisibility(['item', 'separator', 'spacer', 'item'])).toEqual([true, false, true, true]);
  });
});

describe('groupDividers', () => {
  const items: ToolbarLayoutItem[] = [
    { type: 'custom', id: 'symbol', group: 'context' },
    { type: 'segmented', id: 'interval', group: 'context' },
    { type: 'button', id: 'indicators', group: 'analysis' },
    { type: 'button', id: 'compare' },
    { type: 'button', id: 'shot', group: 'view' },
  ];
  const all = items.map(() => true);

  it('opens each new group of start items with a divider, ungrouped items ranking with analysis', () => {
    expect(groupDividers(items, all)).toEqual([false, false, true, false, false]);
  });

  it('skips hidden items when finding the neighbour', () => {
    expect(groupDividers(items, [true, false, false, true, true])).toEqual([false, false, false, true, false]);
  });

  it('leaves a shown separator or spacer to part the groups', () => {
    const parted: ToolbarLayoutItem[] = [items[0]!, { type: 'separator' }, items[2]!];
    expect(groupDividers(parted, [true, true, true])).toEqual([false, false, false]);
    // A hidden separator parts nothing.
    expect(groupDividers(parted, [true, false, true])).toEqual([false, false, true]);
  });

  it('gives end items none', () => {
    const end: ToolbarLayoutItem[] = [items[0]!, { type: 'button', id: 'theme', group: 'analysis', align: 'end' }];
    expect(groupDividers(end, [true, true])).toEqual([false, false]);
  });
});
