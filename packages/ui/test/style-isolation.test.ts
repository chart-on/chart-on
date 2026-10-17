import { describe, expect, it } from 'vitest';
import css from '../src/style.css?raw';

const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('style.css isolation', () => {
  it('sizes the narrow chrome by the shell, not the viewport', () => {
    expect(code).not.toMatch(/@media[^{]*\b(min|max)-width\b/);
    expect(code).toMatch(/\.pc-shell \{[^}]*container: pc-shell \/ inline-size;/);
    expect(code).toMatch(/@container pc-shell \(max-width: 640px\)/);
  });
});
