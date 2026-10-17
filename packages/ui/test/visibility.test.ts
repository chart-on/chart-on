import { describe, expect, expectTypeOf, it } from 'vitest';
import { visibilityOf } from '../src/dom';
import type { ShellEvents, ShellPalette, ShellTheme, ToolbarHandle, ToolRailHandle } from '../src/index';

// `visibilityOf` only touches `hidden`, so a plain object stands in for the element.
const element = () => ({ hidden: false }) as HTMLElement;

describe('visibilityOf', () => {
  it('toggles the hidden attribute', () => {
    const el = element();
    const visibility = visibilityOf(el);
    expect(visibility.visible).toBe(true);
    visibility.setVisible(false);
    expect(el.hidden).toBe(true);
    expect(visibility.visible).toBe(false);
    visibility.toggle();
    expect(el.hidden).toBe(false);
  });

  it('notifies once per actual change until unsubscribed', () => {
    const visibility = visibilityOf(element());
    const seen: boolean[] = [];
    const off = visibility.onChange((visible) => seen.push(visible));
    visibility.setVisible(true); // no change
    visibility.setVisible(false);
    visibility.setVisible(false); // no change
    visibility.toggle();
    off();
    visibility.toggle();
    expect(seen).toEqual([false, true]);
  });
});

describe('public visibility API', () => {
  it('uses noun:change shell events with the new state', () => {
    expectTypeOf<ShellEvents>().toEqualTypeOf<{
      'theme:change': { theme: ShellTheme; resolved: 'dark' | 'light' };
      'palette:change': { palette: ShellPalette };
      'preset:change': { preset: string | null };
      'rail:change': { visible: boolean };
      'toolbar:change': { visible: boolean };
    }>();
  });

  it('exposes no second subscription path on the handles', () => {
    expectTypeOf<ToolbarHandle>().not.toHaveProperty('onChange');
    expectTypeOf<ToolbarHandle>().not.toHaveProperty('onVisibilityChange');
    expectTypeOf<ToolRailHandle>().not.toHaveProperty('onChange');
    expectTypeOf<ToolRailHandle>().not.toHaveProperty('onVisibilityChange');
  });
});
