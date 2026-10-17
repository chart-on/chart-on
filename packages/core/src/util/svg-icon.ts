const SVG_NS = 'http://www.w3.org/2000/svg';

/** One shape of an icon: its SVG tag and attributes, e.g. `['path', { d: 'M18 6 6 18' }]`. */
export type IconShape = readonly [tag: 'path' | 'circle' | 'rect', attrs: Readonly<Record<string, string>>];

/**
 * A stroked 24 × 24 icon drawn in `currentColor`, built with DOM calls rather
 * than markup, so pages with a strict content security policy and Trusted
 * Types enforced can use it.
 */
export function svgIcon(shapes: readonly IconShape[], size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs: Record<string, string> = {
    width: String(size),
    height: String(size),
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  };
  for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, value);
  for (const [tag, shapeAttrs] of shapes) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(shapeAttrs)) el.setAttribute(key, value);
    svg.appendChild(el);
  }
  return svg;
}
