import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultFavoritesBar,
  dropIndex,
  favoritesBarFraction,
  favoritesBarRoom,
  fillShown,
  localFavoritesStorage,
  moveItem,
  placeFavoritesBar,
  sanitizeFavorites,
} from '../src/favorites-model';

afterEach(() => vi.unstubAllGlobals());

describe('sanitizeFavorites', () => {
  it('rejects data that is not a record with items', () => {
    for (const data of [null, undefined, 'x', 3, [], {}, { items: [] }, { items: 'tool' }]) {
      expect(sanitizeFavorites(data), JSON.stringify(data)).toBeNull();
    }
  });

  it('ignores records of another version', () => {
    expect(sanitizeFavorites({ version: 2, items: { tool: ['a'] } })).toBeNull();
    expect(sanitizeFavorites({ version: 1, items: { tool: ['a'] } })?.items).toEqual({ tool: ['a'] });
  });

  it('keeps each string once, in order, and every kind', () => {
    const record = sanitizeFavorites({ items: { tool: ['b', 'a', 7, '', 'b', null], interval: ['1D'], junk: 'x' } });
    expect(record?.items).toEqual({ tool: ['b', 'a'], interval: ['1D'] });
  });

  it('defaults missing or ill-typed bar fields and clamps the position', () => {
    expect(sanitizeFavorites({ items: {} })?.bar).toEqual(defaultFavoritesBar);
    expect(sanitizeFavorites({ items: {}, bar: { visible: 'yes', orientation: 'diagonal', x: 'left', y: Infinity } })?.bar).toEqual(
      defaultFavoritesBar,
    );
    expect(sanitizeFavorites({ items: {}, bar: { visible: false, orientation: 'vertical', x: 2, y: -1 } })?.bar).toEqual({
      visible: false,
      orientation: 'vertical',
      x: 1,
      y: 0,
    });
  });
});

describe('localFavoritesStorage', () => {
  it('round-trips a record with its version', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    });
    const storage = localFavoritesStorage('k');
    expect(storage.load()).toBeNull();
    storage.save({ items: { tool: ['a'] }, bar: { ...defaultFavoritesBar, x: 0.25 } });
    expect(JSON.parse(data.get('k')!)).toMatchObject({ version: 1, items: { tool: ['a'] } });
    expect(sanitizeFavorites(storage.load())).toEqual({ items: { tool: ['a'] }, bar: { ...defaultFavoritesBar, x: 0.25 } });
  });

  it('reads blocked storage or bad JSON as empty and swallows failed saves', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('quota');
      },
    });
    const storage = localFavoritesStorage();
    expect(storage.load()).toBeNull();
    expect(() => storage.save({ items: {}, bar: { ...defaultFavoritesBar } })).not.toThrow();
    vi.unstubAllGlobals();
    // No localStorage at all (Node).
    expect(localFavoritesStorage().load()).toBeNull();
  });
});

describe('reordering', () => {
  it('moves an entry, clamping the target', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });

  it('puts a reordered subset back into its own slots', () => {
    expect(fillShown(['a', 'x', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'x', 'a', 'b']);
    expect(fillShown(['a', 'b'], ['b', 'a'])).toEqual(['b', 'a']);
  });

  it('drops before the first centre past the pointer', () => {
    expect(dropIndex([10, 30, 50], 0)).toBe(0);
    expect(dropIndex([10, 30, 50], 31)).toBe(2);
    expect(dropIndex([10, 30, 50], 99)).toBe(3);
    expect(dropIndex([], 5)).toBe(0);
  });
});

describe('favourites bar placement', () => {
  const area = { x: 60, y: 0, width: 500, height: 300 };
  const size = { width: 100, height: 40 };

  it('keeps the bar inside the plot at every fraction', () => {
    expect(placeFavoritesBar({ x: 0, y: 0 }, size, area)).toEqual({ x: 66, y: 6 });
    expect(placeFavoritesBar({ x: 1, y: 1 }, size, area)).toEqual({ x: 454, y: 254 });
    expect(placeFavoritesBar({ x: 5, y: -3 }, size, area)).toEqual({ x: 454, y: 6 });
  });

  it('keeps room for toasts on the side of the plot the bar is on', () => {
    const bar = { width: 100, height: 40 };
    // Lower half: room from the bottom edge to the bar's top, plus a gap.
    expect(favoritesBarRoom({ x: 0, y: 500 }, bar, 600)).toEqual({ top: 0, bottom: 108 });
    // Upper half: room from the top edge to the bar's bottom, plus a gap.
    expect(favoritesBarRoom({ x: 0, y: 20 }, bar, 600)).toEqual({ top: 68, bottom: 0 });
  });

  it('keeps its relative place when the plot resizes', () => {
    const at = { x: 0.5, y: 0.5 };
    const small = placeFavoritesBar(at, size, { ...area, width: 300 });
    expect(small.x + size.width).toBeLessThanOrEqual(area.x + 300);
    expect(small.x - area.x - 6).toBe(Math.round((300 - 100 - 12) / 2));
  });

  it('inverts placement, clamped to the plot', () => {
    const corner = placeFavoritesBar({ x: 0.25, y: 0.75 }, size, area);
    const back = favoritesBarFraction(corner, size, area);
    expect(back.x).toBeCloseTo(0.25, 2);
    expect(back.y).toBeCloseTo(0.75, 2);
    expect(favoritesBarFraction({ x: -100, y: 9999 }, size, area)).toEqual({ x: 0, y: 1 });
  });

  it('pins a bar larger than the plot to its top-left inset', () => {
    expect(placeFavoritesBar({ x: 1, y: 1 }, { width: 900, height: 900 }, area)).toEqual({ x: 66, y: 6 });
    expect(favoritesBarFraction({ x: 300, y: 300 }, { width: 900, height: 900 }, area)).toEqual({ x: 0, y: 0 });
  });
});
