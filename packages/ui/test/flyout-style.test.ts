import { describe, expect, it } from 'vitest';
import css from '../src/style.css?raw';

const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Bodies of every top-level rule whose selector list is exactly `selector`. */
function rules(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...code.matchAll(new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1] ?? '');
}

describe('rail flyout row style', () => {
  it('draws the hover and active highlight on the whole row, star included', () => {
    expect(rules('.pc-popover-row:hover').join('')).toMatch(/background: var\(--pc-hover\);/);
    expect(rules('.pc-popover-row:has(> .pc-popover-item.is-active)').join('')).toMatch(
      /background: var\(--pc-accent-soft\);/,
    );
    expect(rules('.pc-popover-row > .pc-popover-item').join('')).toMatch(/background: transparent;/);
  });

  it('keeps the star icon-only: colour on hover, no box, focus outline kept', () => {
    const hover = rules('.pc-favorite-star:hover').join('');
    expect(hover).toMatch(/color: var\(--pc-ink\);/);
    expect(hover).not.toMatch(/background/);
    // The symbol search's star is the same element, pressed rather than checked.
    expect(rules(".pc-favorite-star[aria-checked='true'],\n.pc-favorite-star[aria-pressed='true']").join('')).toMatch(
      /color: var\(--pc-favorite\);/,
    );
    expect(rules('.pc-favorite-star:focus-visible').join('')).toMatch(/outline: 2px solid var\(--pc-focus\);/);
    expect(code).toMatch(/@media \(hover: none\) \{\s*\.pc-favorite-star \{\s*opacity: 1;/);
  });

  it('runs the active symbol search row highlight through its star', () => {
    expect(
      rules(".pc-symbol-search-option[aria-selected='true'],\n.pc-symbol-search-option[aria-selected='true'] + .pc-symbol-search-star").join(''),
    ).toMatch(/background: var\(--pc-hover\);/);
    expect(rules('.pc-symbol-search-list .pc-symbol-search-star').join('')).toMatch(/align-self: stretch;/);
  });

  it('stretches the rows of a sectioned flyout across the menu width', () => {
    // A bare button in a block box shrinks to its content; a grid stretches it.
    const section = rules('.pc-rail-section').join('');
    expect(section).toMatch(/display: grid;/);
    expect(section).not.toMatch(/justify-items/);
  });

  it('leaves the shared menu item highlight unchanged', () => {
    expect(rules('.pc-popover-item:hover').join('')).toMatch(/background: var\(--pc-hover\);/);
    expect(rules('.pc-popover-item.is-active').join('')).toMatch(/background: var\(--pc-accent-soft\);/);
  });
});
