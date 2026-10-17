import { describe, expect, it } from 'vitest';
import { installFakeDom } from '../../core/test/fake-dom';
import { icon } from '../src/dom';
import { svgFromMarkup } from '../src/svg-markup';

installFakeDom();

/** The fake DOM's element shape. */
interface Node {
  tagName: string;
  attributes: Map<string, string>;
  children: Node[];
}

const tree = (el: unknown): unknown => {
  const n = el as Node;
  return [n.tagName, Object.fromEntries(n.attributes), ...n.children.map(tree)];
};

describe('svgFromMarkup', () => {
  it('builds the elements and attributes of an icon', () => {
    const svg = svgFromMarkup(
      '<?xml version="1.0"?><!-- an icon --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">' +
        '<g stroke="currentColor"><path d="M4 12h16"/><circle cx="12" cy=\'12\' r="3" /></g></svg>',
    );
    expect(tree(svg)).toEqual([
      'svg',
      { viewBox: '0 0 24 24', fill: 'none' },
      ['g', { stroke: 'currentColor' }, ['path', { d: 'M4 12h16' }], ['circle', { cx: '12', cy: '12', r: '3' }]],
    ]);
  });

  it('decodes entities in attribute values', () => {
    expect(tree(svgFromMarkup('<svg aria-label="a &amp; b &#60;&#x3e;"/>'))).toEqual(['svg', { 'aria-label': 'a & b <>' }]);
  });

  it('drops scripts, links, handlers, inline styles and external references', () => {
    const svg = svgFromMarkup(
      '<svg onload="steal()" style="color: red" viewBox="0 0 8 8">' +
        '<script>steal()</script><a href="https://example.com"><path d="M0 0"/></a>' +
        '<foreignObject><div><p>x</p></div></foreignObject>' +
        '<use href="https://example.com/sprite.svg#i"/>' +
        '<rect width="8" height="8" fill="url(https://example.com/x.svg#p)" xlink:href="#x" onclick="x()"/>' +
        '<path d="M1 1" fill="url(#local)"/></svg>',
    );
    expect(tree(svg)).toEqual(['svg', { viewBox: '0 0 8 8' }, ['rect', { width: '8', height: '8' }], ['path', { d: 'M1 1', fill: 'url(#local)' }]]);
  });

  it('drops values with CSS escapes, which could spell an external url()', () => {
    const svg = svgFromMarkup('<svg><path d="M0 0" fill="\\75rl(https://example.com/x.svg#p)" stroke="url( \'#a\')"/></svg>');
    expect(tree(svg)).toEqual(['svg', {}, ['path', { d: 'M0 0', stroke: "url( '#a')" }]]);
  });

  it('rejects markup that is not an SVG', () => {
    expect(() => svgFromMarkup('<div></div>')).toThrow(TypeError);
    expect(() => svgFromMarkup('no markup')).toThrow(TypeError);
  });
});

describe('icon sources', () => {
  it('sizes SVG markup to the control and hides it from assistive technology', () => {
    const el = icon('<svg width="24" height="24"><path d="M0 0"/></svg>', 16) as unknown as Node;
    expect(Object.fromEntries(el.attributes)).toEqual({ width: '16', height: '16', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  });

  it('copies an SVG element for each control', () => {
    const original = svgFromMarkup('<svg viewBox="0 0 10 10"/>');
    const copies: unknown[] = [];
    Object.assign(original, {
      cloneNode: () => {
        const copy = svgFromMarkup('<svg viewBox="0 0 10 10"/>');
        copies.push(copy);
        return copy;
      },
    });
    const a = icon(original, 18);
    const b = icon(original, 18);
    expect(copies).toEqual([a, b]);
    expect(a).not.toBe(b);
    expect((a as unknown as Node).attributes.get('width')).toBe('18');
  });

  it('builds an icon node as a stroked SVG sized to the control', () => {
    const el = icon([['path', { d: 'M4 12h16' }], ['circle', { cx: 12, cy: 12, r: 3, fill: undefined }]], 20);
    expect(tree(el)).toEqual([
      'svg',
      {
        width: '20',
        height: '20',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.75',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      },
      ['path', { d: 'M4 12h16' }],
      ['circle', { cx: '12', cy: '12', r: '3' }],
    ]);
  });

  it('uses a function source as is', () => {
    const el = svgFromMarkup('<svg/>');
    expect(icon(() => el, 16)).toBe(el);
    expect((el as unknown as Node).attributes.size).toBe(0);
  });
});
