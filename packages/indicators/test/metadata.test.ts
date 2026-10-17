import { describe, expect, it } from 'vitest';
import { bollingerIndicator, builtinIndicators, smaIndicator } from '../src/index';

// The picker's well-known categories, and `cycles` for moon phases.
const KNOWN = ['trend', 'momentum', 'volatility', 'volume', 'profiles', 'cycles'];

describe('picker metadata', () => {
  it.each(builtinIndicators.map((def) => ({ def, name: def.name })))('$name has a description, a known category and aliases', ({ def }) => {
    expect(def.description).toMatch(/\.$/);
    expect(KNOWN).toContain(def.category);
    expect(def.aliases?.length).toBeGreaterThan(0);
  });

  it('names the full form of acronyms', () => {
    expect(bollingerIndicator.aliases).toContain('Bollinger Bands');
    expect(smaIndicator.aliases).toContain('Simple Moving Average');
  });

  it('lets moving averages go on the price pane or in their own pane', () => {
    expect(smaIndicator.placement).toBe('either');
  });
});
