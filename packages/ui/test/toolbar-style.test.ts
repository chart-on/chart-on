import { describe, expect, it } from 'vitest';
import css from '../src/style.css?raw';
import controls from '../src/controls.ts?raw';

const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('toolbar style', () => {
  it('draws menu icons at the size of the md icon buttons beside them', () => {
    const md = controls.match(/size === 'md' \? (\d+)/)?.[1];
    const body = code.match(/(?:^|})\s*\.pc-toolbar \.pc-menu-face > svg\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(md).toBeDefined();
    expect(body).toMatch(new RegExp(`width: ${md}px;`));
    expect(body).toMatch(new RegExp(`height: ${md}px;`));
  });
});
