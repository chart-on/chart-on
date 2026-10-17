import { describe, expect, it } from 'vitest';
import { moveToolbarAction, readToolbarIds, toolbarLayout, toolbarSelection } from '../src/toolbar-customization-model';
import type { ToolbarLayoutItem } from '../src/toolbar-model';

const defaults: ToolbarLayoutItem[] = [
  { type: 'button', id: 'symbol', group: 'context' },
  { type: 'button', id: 'interval', group: 'context' },
  { type: 'separator' },
  { type: 'button', id: 'a', group: 'analysis' },
  { type: 'button', id: 'fixed', group: 'analysis' },
  { type: 'button', id: 'b', group: 'analysis' },
  { type: 'spacer' },
  { type: 'button', id: 'view', group: 'view' },
];
const locked = new Set(['symbol', 'fixed']);
const ids = (items: readonly ToolbarLayoutItem[]) => items.map((item) => item.id ?? item.type);

describe('toolbar preferences', () => {
  it('validates the envelope and deduplicates ids', () => {
    expect(readToolbarIds('{"version":1,"ids":["a","a","unknown"]}')).toEqual(['a', 'unknown']);
    expect(readToolbarIds('{"version":1,"ids":[]}')).toEqual([]);
    for (const raw of [null, '', 'null', '{"version":2,"ids":[]}', '{"version":1,"ids":[1]}']) expect(readToolbarIds(raw)).toBeNull();
  });

  it('skips unknown and structural ids, groups items, and restores locked slots', () => {
    const catalog = [...defaults, { type: 'button', id: 'extra', group: 'view' as const }];
    const chosen = toolbarSelection(defaults, catalog, ['unknown', 'view', 'b', 'a', 'symbol', 'extra'], locked);
    expect(ids(chosen)).toEqual(['symbol', 'b', 'fixed', 'a', 'view', 'extra']);
    expect(ids(toolbarLayout(defaults, chosen))).toEqual(['symbol', 'separator', 'b', 'fixed', 'a', 'spacer', 'view', 'extra']);
    expect(defaults).toHaveLength(8);
  });

  it('keeps alignment and blocks moving through a locked slot', () => {
    expect(moveToolbarAction(defaults.filter((item) => item.id), 'a', 'b', locked)).toBeNull();
    expect(moveToolbarAction(defaults, 'view', 'a', locked)).toBeNull();
    expect(moveToolbarAction(defaults, 'symbol', 'interval', locked)).toBeNull();
    const items = [defaults[3]!, defaults[5]!, { type: 'button', id: 'end', group: 'analysis' as const, align: 'end' as const }];
    expect(ids(moveToolbarAction(items, 'a', 'b', locked)!)).toEqual(['b', 'a', 'end']);
    expect(moveToolbarAction(items, 'a', 'end', locked)).toBeNull();
  });

  it('keeps an app-hidden locked action unavailable', () => {
    const hidden = [{ type: 'button', id: 'fixed', hidden: true }];
    expect(toolbarSelection(hidden, hidden, ['fixed'], locked)).toEqual([]);
  });
});
