import { describe, expect, it } from 'vitest';
import css from '../src/style.css?raw';

const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = code.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

describe('symbol search dialog style', () => {
  it('caps the height at the dialog height and lets short lists stay compact', () => {
    const body = rule('.pc-symbol-search');
    expect(body).toMatch(/max-height: min\(var\(--pc-dialog-height\), 100%\);/);
    expect(body).toMatch(/max-height: min\(var\(--pc-dialog-height\), \d+dvh, 100%\);/);
    expect(body).not.toMatch(/(^|[^-])height:/);
  });

  it('keeps the search row at full height, with the exchange select fitting in it', () => {
    expect(rule('.pc-symbol-search-bar')).toMatch(/flex-shrink: 0;/);
    expect(rule('.pc-symbol-search-filters')).toMatch(/flex-shrink: 0;/);
    const row = Number(rule('.pc-picker-field,\n.pc-symbol-search-field').match(/(?:^|[^-])height: (\d+)px;/)?.[1]);
    const select = Number(rule('.pc-dialog .pc-symbol-search-bar .pc-select.pc-form-combo').match(/height: (\d+)px;/)?.[1]);
    expect(select).toBeGreaterThan(0);
    expect(select).toBeLessThanOrEqual(row);
  });

  it('draws the search box of every search dialog as a flat row across the dialog (#1014)', () => {
    const row = rule('.pc-picker-field,\n.pc-symbol-search-field');
    expect(row).toContain('padding: 0 var(--pc-dialog-padding);');
    expect(row).not.toMatch(/margin|border-radius|box-shadow/);
    expect(rule('.pc-symbol-search-bar')).not.toMatch(/margin/);
    // The picker's list draws the divider under the row; the symbol search's results draw their own.
    expect(rule('.pc-picker-main')).toContain('border-top: 1px solid var(--pc-line);');
    expect(rule('.pc-symbol-search-results')).toContain('border-top: 1px solid var(--pc-line);');
  });

  it('leaves the search row as much room below as above in every search dialog', () => {
    // The row sits between two dividers; whatever comes right under it starts at the second one.
    for (const below of ['.pc-picker-main', '.pc-indicator-picker-body', '.pc-symbol-search-results']) {
      expect(rule(below), below).not.toMatch(/margin(-top)?:/);
    }
    // Filter rows between the search row and the list keep their own room on both sides.
    for (const filters of ['.pc-symbol-search-filters', '.pc-indicator-picker-sources']) {
      expect(rule(filters), filters).toContain('padding: var(--pc-space-4) var(--pc-space-5);');
    }
  });

  it('keeps the scrolling results inside the rounded corners with room after the last row', () => {
    const body = rule('.pc-symbol-search-results');
    expect(body).toMatch(/overflow-y: auto;/);
    expect(body).toMatch(/border-radius: 0 0 var\(--pc-dialog-radius\) var\(--pc-dialog-radius\);/);
    expect(body).toMatch(/padding: \S+ 0 var\(--pc-space-\d\);/);
  });
});

describe('toast layer', () => {
  const z = (selector: string) => Number(rule(selector).match(/z-index: (\d+);/)?.[1]);

  it('puts toasts above modal dialogs and bottom sheets, and below tooltips', () => {
    const toasts = z('.pc-toasts');
    expect(toasts).toBeGreaterThan(z('.pc-dialog-backdrop'));
    expect(toasts).toBeGreaterThan(z('.pc-dialog-backdrop--panel'));
    expect(toasts).toBeGreaterThan(z(".pc-shell-side[data-sheet]"));
    expect(toasts).toBeLessThan(z('.pc-tip'));
  });

  it('moves toasts to the top while a bottom sheet is open', () => {
    const sheet = code.match(/\.pc-shell:has\(([^{]*)\)[^{]*>\s*\.pc-toasts\s*\{([^}]*)\}/);
    expect(sheet?.[1]).toContain(".pc-dialog--panel[data-compact='true']");
    expect(sheet?.[1]).toContain(".pc-shell-side[data-sheet='open']");
    expect(sheet?.[2]).toMatch(/top: max\(var\(--pc-space-\d\), var\(--pc-favorites-top, 0px\)\);\s*bottom: auto;/);
  });

  it('keeps toasts clear of the room the favourites bar takes', () => {
    expect(rule('.pc-toasts')).toMatch(/bottom: max\(40px, var\(--pc-favorites-bottom, 0px\)\);/);
  });
});

describe('dialog chrome', () => {
  it('divides the header from the body like the footer, without doubling a body divider', () => {
    expect(rule('.pc-dialog-header')).toMatch(/border-bottom: 1px solid var\(--pc-line\);/);
    expect(rule('.pc-dialog-footer')).toMatch(/border-top: 1px solid var\(--pc-line\);/);
    expect(rule('.pc-dialog-header + *')).toMatch(/border-top: 0;/);
  });

  it('gives footer text buttons a minimum width and leaves icon buttons square', () => {
    const body = rule('.pc-dialog-footer .pc-btn');
    expect(body).toMatch(/min-width: var\(--pc-dialog-btn-min-width\);/);
    expect(body).toMatch(/justify-content: center;/);
    expect(code).toMatch(/--pc-dialog-btn-min-width: \d+px;/);
    expect(code).not.toMatch(/\.pc-icon-btn[^{]*\{[^}]*min-width: var\(--pc-dialog-btn-min-width\)/);
  });

  it('lets the indicator switcher fill the panel header and wraps a narrow panel footer (#954)', () => {
    expect(rule('.pc-dialog--panel .pc-dialog-footer')).toMatch(/flex-wrap: wrap;/);
    expect(rule('.pc-form-combo-wrap.pc-indicator-switch')).toMatch(/flex: 1;/);
    expect(rule('.pc-form-combo-wrap.pc-indicator-switch')).not.toMatch(/max-width/);
    expect(code).toMatch(/\.pc-dialog \.pc-indicator-switch \.pc-select\.pc-form-combo \{\s*width: 100%;/);
  });
});
