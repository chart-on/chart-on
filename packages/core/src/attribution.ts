/** Side of the project mark at full size, css px. */
export const ATTRIBUTION_SIZE = 48;

/**
 * Fill the project mark in `color`, `size` css px square with its top left at
 * `x`, `y`: a stepped block with a rounded shoulder at the top right, and a
 * separate square below it. Drawn on a 100-unit grid with path calls, so it
 * needs no image or `Path2D`.
 */
export function drawAttributionMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(100, 46);
  ctx.arc(54, 46, 46, 0, -Math.PI / 2, true);
  ctx.arcTo(0, 0, 0, 46, 7);
  ctx.arcTo(0, 46, 23, 46, 7);
  ctx.lineTo(23, 46);
  ctx.arcTo(23, 77, 53.5, 77, 7);
  ctx.lineTo(53.5, 77);
  ctx.arcTo(53.5, 100, 100, 100, 7);
  ctx.arcTo(100, 100, 100, 46, 7);
  ctx.closePath();
  ctx.moveTo(6.5, 79);
  ctx.arcTo(21, 79, 21, 100, 6.5);
  ctx.arcTo(21, 100, 0, 100, 6.5);
  ctx.arcTo(0, 100, 0, 79, 6.5);
  ctx.arcTo(0, 79, 21, 79, 6.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The mark's stepped block and its square, as SVG on the same 100-unit grid as `drawAttributionMark`. */
const BLOCK = 'M100 46A46 46 0 0 0 54 0H7A7 7 0 0 0 0 7V39A7 7 0 0 0 7 46H23V70A7 7 0 0 0 30 77H53.5V93A7 7 0 0 0 60.5 100H93A7 7 0 0 0 100 93Z';
const SQUARE = { x: '0', y: '79', width: '21', height: '21', rx: '6.5' };
/**
 * The block's three steps, top to bottom: the top and height of each one's
 * window. Each reaches half a unit up into the step above, never down: the
 * step above starts first, so the overlap only ever shows what it shows already.
 */
const STEPS: readonly (readonly [top: number, height: number])[] = [
  [0, 46],
  [45.5, 31.5],
  [76.5, 23.5],
];
/** One loop of the loader, ms. */
const LOADER_MS = 3000;
/** Each step's wipe and the gap between their starts, ms. */
const WIPE_MS = 750;
const WIPE_GAP_MS = 250;
/** The square grows in from `SQUARE_AT_MS` for `SQUARE_MS`. */
const SQUARE_AT_MS = 800;
const SQUARE_MS = 600;
/** The group fades in for `FADE_MS`, holds until `FADE_OUT_AT_MS`, then fades out for 540 ms. */
const FADE_MS = 360;
const FADE_OUT_AT_MS = 2400;
const FADE_OUT_MS = 540;
/** A time in the loop as a keyframe offset. */
const at = (ms: number) => ms / LOADER_MS;
const EASE_IN_OUT = 'cubic-bezier(.65,0,.35,1)';
const EASE_OUT = 'cubic-bezier(.22,1,.36,1)';
const FADE_EASE = 'cubic-bezier(.45,0,.55,1)';
/** Gives each loader's clip windows ids no other loader on the page uses. */
let loaders = 0;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, ...children: SVGElement[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  for (const child of children) el.appendChild(child);
  return el;
}

/** Keyframes that hold `from` until `start`, ease to `to` by `end` and hold it to the end of the loop. */
function step(prop: string, from: string, to: string, start: number, end: number, easing: string): Keyframe[] {
  return [
    { [prop]: from, offset: 0 },
    { [prop]: from, offset: start, easing },
    { [prop]: to, offset: end },
    { [prop]: to, offset: 1 },
  ];
}

/**
 * The loading indicator: the project mark assembling itself in `currentColor`,
 * `size` css px square. The three steps of the block wipe in from the left,
 * top to bottom, the square grows into its corner, the mark holds, then fades
 * out as one, every `LOADER_MS` (3 s). The steps never move or fade on their own:
 * only their windows grow over still geometry, a whole block covers the joins
 * once assembled and the group fades as one, so no seam shows. Offsets are in
 * the keyframes, so every loop starts from nothing. With reduced motion it is
 * the still, complete mark. Built with DOM calls and the Web Animations API,
 * so it needs no stylesheet or markup.
 */
export function createAttributionLoader(size: number, still: boolean): SVGSVGElement {
  const id = `pc-loader-${++loaders}`;
  const windows = STEPS.map(([top, height]) => svgEl('rect', { x: '0', y: String(top), width: '100', height: String(height) }));
  const defs = svgEl('defs', {}, ...windows.map((w, i) => svgEl('clipPath', { id: `${id}-${i}` }, w)));
  const steps = windows.map((_, i) => svgEl('path', { d: BLOCK, 'clip-path': `url(#${id}-${i})` }));
  const whole = svgEl('path', { d: BLOCK });
  const square = svgEl('rect', SQUARE);
  const group = svgEl('g', {}, ...steps, whole, square);
  const svg = svgEl('svg', { width: String(size), height: String(size), viewBox: '0 0 100 100', fill: 'currentColor', 'aria-hidden': 'true' }, defs, group);
  svg.style.display = 'block';
  if (still) return svg;
  const loop = { duration: LOADER_MS, iterations: Infinity };
  const assembled = (STEPS.length - 1) * WIPE_GAP_MS + WIPE_MS;
  for (const el of [...windows, square]) Object.assign(el.style, { transformBox: 'fill-box', transformOrigin: el === square ? '50% 50%' : '0 50%' });
  windows.forEach((w, i) => w.animate?.(step('transform', 'scaleX(0)', 'none', at(i * WIPE_GAP_MS), at(i * WIPE_GAP_MS + WIPE_MS), EASE_IN_OUT), loop));
  square.animate?.(step('transform', 'scale(0)', 'none', at(SQUARE_AT_MS), at(SQUARE_AT_MS + SQUARE_MS), EASE_OUT), loop);
  // On once every step is in, so the joins never show.
  whole.animate?.(step('opacity', '0', '1', at(assembled + 70), at(assembled + 100), 'linear'), loop);
  group.animate?.(
    [
      { opacity: 0, offset: 0, easing: FADE_EASE },
      { opacity: 1, offset: at(FADE_MS) },
      { opacity: 1, offset: at(FADE_OUT_AT_MS), easing: FADE_EASE },
      { opacity: 0, offset: at(FADE_OUT_AT_MS + FADE_OUT_MS) },
      { opacity: 0, offset: 1 },
    ],
    loop,
  );
  return svg;
}
