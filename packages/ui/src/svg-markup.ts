/**
 * Builds an icon from SVG markup with DOM calls, so string icons need no
 * markup parser (and no Trusted Types policy). Only drawing elements are
 * kept: scripts, links, external references, event handlers and inline
 * styles are dropped, along with anything else outside the lists below.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect',
  'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop',
]);

/** Event handlers, links, inline styles (blocked by strict policies) and anything outside the SVG namespace. */
const BLOCKED_ATTRIBUTE = /^(on|style$|href$|xlink:|xmlns:|xml:)/i;
/**
 * `url(...)` other than a reference to an element in the same icon (`url(#id)`), and any CSS
 * escape, which could spell `url(` without matching it here.
 */
const EXTERNAL_URL = /url\((?!\s*['"]?#)|\\/i;

const TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ATTRIBUTE = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/gi;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(value: string): string {
  return value.replace(ENTITY, (_, dec?: string, hex?: string, name?: string) =>
    name ? NAMED[name.toLowerCase()]! : String.fromCodePoint(dec ? Number(dec) : parseInt(hex!, 16)),
  );
}

/**
 * The `<svg>` element described by `markup`. Throws when the markup does not
 * start with an `<svg>` element, so a bad icon fails where it is defined.
 */
export function svgFromMarkup(markup: string): SVGSVGElement {
  const source = markup.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/gi, '');
  const stack: Element[] = [];
  let root: SVGSVGElement | null = null;
  /** Depth inside an element that is dropped with everything in it. */
  let skipped = 0;
  for (const [, closing, tag, attributes, selfClosing] of source.matchAll(TAG)) {
    if (closing) {
      if (skipped > 0) skipped--;
      else stack.pop();
      if (stack.length === 0 && root) break;
      continue;
    }
    if (skipped > 0 || !ELEMENTS.has(tag!) || (root === null) !== (tag === 'svg')) {
      if (!selfClosing) skipped++;
      if (root === null) break;
      continue;
    }
    const el = document.createElementNS(SVG_NS, tag!);
    for (const [, name, double, single] of attributes!.matchAll(ATTRIBUTE)) {
      const value = decode(double ?? single ?? '');
      if (name === 'xmlns' || BLOCKED_ATTRIBUTE.test(name!) || EXTERNAL_URL.test(value)) continue;
      el.setAttribute(name!, value);
    }
    if (root === null) {
      root = el as SVGSVGElement;
      if (selfClosing) break;
    } else stack[stack.length - 1]!.append(el);
    if (!selfClosing) stack.push(el);
  }
  if (!root) throw new TypeError('An icon string must be SVG markup starting with <svg>.');
  return root;
}
