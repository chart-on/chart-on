import { describe, expect, it } from 'vitest';
import { popoverPlacement } from '../src/dom';

const viewport = { width: 1000, height: 800 };
const trigger = (left: number, width = 32, top = 8) => ({ left, right: left + width, top, bottom: top + 32 });

describe('popoverPlacement', () => {
  it('keeps a list that fits left-aligned and uncapped', () => {
    expect(popoverPlacement(trigger(100), { width: 240, height: 300 }, viewport)).toEqual({ alignEnd: false, maxHeight: null });
  });

  it('flips to the right edge when the list would leave the viewport', () => {
    expect(popoverPlacement(trigger(900), { width: 240, height: 300 }, viewport).alignEnd).toBe(true);
  });

  it('stays left-aligned when flipping would overflow more', () => {
    // 600px list on a trigger at x=300: left-aligned overflows by 0, right-aligned by 276.
    expect(popoverPlacement(trigger(300), { width: 600, height: 100 }, viewport).alignEnd).toBe(false);
  });

  it('honours an explicit side', () => {
    expect(popoverPlacement(trigger(100), { width: 240, height: 100 }, viewport, { alignEnd: true }).alignEnd).toBe(true);
    expect(popoverPlacement(trigger(900), { width: 240, height: 100 }, viewport, { alignEnd: false }).alignEnd).toBe(false);
  });

  it('caps a tall list to the room below the trigger', () => {
    // Below the trigger: 800 - 8 margin - 40 bottom - 4 gap = 748.
    expect(popoverPlacement(trigger(100), { width: 240, height: 900 }, viewport).maxHeight).toBe(748);
  });

  it('caps an upward list to the room above the trigger', () => {
    // Above a trigger at y=700: 700 - 4 gap - 8 margin = 688.
    expect(popoverPlacement(trigger(100, 32, 700), { width: 240, height: 900 }, viewport, { up: true }).maxHeight).toBe(688);
  });

  it('never caps below a few rows', () => {
    expect(popoverPlacement(trigger(100, 32, 760), { width: 240, height: 900 }, viewport).maxHeight).toBe(120);
  });
});
