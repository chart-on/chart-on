import { describe, expect, it } from 'vitest';
import css from '../src/style.css?raw';

const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
const scope = ':where(.pc-shell:not(.pc-native-scrollbars))';

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = code.match(new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

/** The body of an at-rule, up to its matching closing brace. */
function atRule(prelude: string): string {
  const start = code.indexOf(`${prelude} {`);
  if (start < 0) return '';
  let depth = 0;
  for (let i = code.indexOf('{', start); i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return code.slice(code.indexOf('{', start) + 1, i);
  }
  return '';
}

describe('scrollbar style', () => {
  it('defines the scrollbar tokens on the shell, from the theme colours', () => {
    const shell = block('.pc-shell');
    for (const token of ['size', 'radius', 'track', 'thumb', 'thumb-hover', 'thumb-active']) {
      expect(shell).toMatch(new RegExp(`--pc-scrollbar-${token}: `));
    }
    expect(shell).toMatch(/--pc-scrollbar-track: transparent;/);
    expect(shell).toMatch(/--pc-scrollbar-thumb: var\(--pc-[a-z-]+\);/);
  });

  it('gives high contrast a stronger thumb', () => {
    const contrast = block('.pc-shell.pc-theme-high-contrast');
    expect(contrast).toMatch(/--pc-scrollbar-thumb: var\(--pc-muted\);/);
    expect(contrast).toMatch(/--pc-scrollbar-thumb-hover: var\(--pc-ink\);/);
  });

  it('styles every scrolling area through one zero-specificity scope, outside forced colours', () => {
    const styled = atRule('@media (forced-colors: none)');
    expect(styled).not.toBe('');
    // Every scrollbar rule in the stylesheet sits in this block and uses the shared scope.
    const outside = code.replace(styled, '');
    expect(outside).not.toMatch(/::-webkit-scrollbar|scrollbar-color/);
    for (const selector of styled.match(/[^{};]+(?=\{)/g) ?? []) {
      const s = selector.trim();
      if (s.startsWith('@')) continue;
      expect(s.startsWith(scope)).toBe(true);
    }
  });

  it('uses the pseudo-elements where they exist and the standard properties elsewhere', () => {
    const pseudo = atRule('@supports selector(::-webkit-scrollbar)');
    expect(block(`${scope} ::-webkit-scrollbar`)).toMatch(/width: var\(--pc-scrollbar-size\);/);
    expect(block(`${scope} ::-webkit-scrollbar`)).toMatch(/height: var\(--pc-scrollbar-size\);/);
    expect(block(`${scope} ::-webkit-scrollbar-thumb`)).toMatch(/border-radius: var\(--pc-scrollbar-radius\);/);
    expect(block(`${scope} ::-webkit-scrollbar-thumb:hover`)).toMatch(/var\(--pc-scrollbar-thumb-hover\)/);
    expect(block(`${scope} ::-webkit-scrollbar-thumb:active`)).toMatch(/var\(--pc-scrollbar-thumb-active\)/);
    expect(pseudo).toMatch(/scrollbar-color: auto;/);

    const standard = atRule('@supports not selector(::-webkit-scrollbar)');
    expect(standard).toMatch(/scrollbar-width: thin;/);
    expect(standard).toMatch(/scrollbar-color: var\(--pc-scrollbar-thumb\) var\(--pc-scrollbar-track\);/);
    expect(standard).not.toMatch(/::-webkit-scrollbar/);
  });

  it('keeps hidden scrollbars hidden in both styling paths', () => {
    for (const selector of ['.pc-bottombar-ranges', '.pc-symbol-search-filters .pc-seg']) {
      const body = block(selector);
      expect(body).toMatch(/scrollbar-width: none;/);
      expect(body).toMatch(/--pc-scrollbar-size: 0px;/);
    }
  });

  it('reserves the scrollbar gutter on lists whose content changes', () => {
    expect(code).toMatch(/\.pc-symbol-search-results,[^{]*\{\s*scrollbar-gutter: stable;\s*\}/);
  });
});
