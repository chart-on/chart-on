import { seededRandom } from '@charton/core/internal';

/**
 * The hero illustration: an isometric stack of the library's layers (the
 * WebGL2 renderer, the core engine, series and drawings, then the opt-in
 * packages) on a ruled floor, with data feeds running in from the
 * left and a chart running out to the right. Plain SVG markup, so the server
 * render ships it; the moving parts are SMIL motion and CSS keyframes, which
 * site.css and landing.ts switch off for reduced motion. The lower layers
 * float on a loop; a top tile rises while the pointer is over it.
 */

/** Isometric axes: x runs down-right, y down-left, z up. */
const C = Math.cos(Math.PI / 6);
const S = 0.5;
/** Where the scene's origin (the stack's back corner on the floor) sits in the view box. */
const OX = 400;
const OY = 250;

type P3 = [x: number, y: number, z?: number];

const r1 = (v: number) => Math.round(v * 10) / 10;
const at = ([x, y, z = 0]: P3): [number, number] => [r1(OX + (x - y) * C), r1(OY + (x + y) * S - z)];
const pts = (...points: P3[]) => points.map((p) => at(p).join(',')).join(' ');

/** SVG matrices that lay flat text on a plane: the left face (along x), the right face (along -y) and the top. */
const onLeft = (p: P3) => `matrix(${r1(C)} ${S} 0 1 ${at(p).join(' ')})`;
const onRight = (p: P3) => `matrix(${r1(C)} ${-S} 0 1 ${at(p).join(' ')})`;
const onTop = (p: P3) => `matrix(${r1(C)} ${S} ${-r1(C)} ${S} ${at(p).join(' ')})`;

/** A box from (x, y, z), w along x, d along y, h up: its three visible faces. */
function box(cls: string, [x, y, z = 0]: P3, w: number, d: number, h: number): string {
  const top = pts([x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]);
  const left = pts([x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]);
  const right = pts([x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]);
  return `<g class="${cls}"><polygon class="hx-top" points="${top}"/><polygon class="hx-sheen" points="${top}"/><polygon class="hx-left" points="${left}"/><polygon class="hx-right" points="${right}"/></g>`;
}

/** The stack's footprint and layer heights. */
const SIZE = 180;
const BASE = { z: 0, h: 34 };
const CORE = { z: 42, h: 72 };
const MID = { z: 122, h: 22 };
const TILES = { z: 154, h: 30, size: 80, inset: 7 };
/** How far a hovered top tile rises (keep in step with .hx-tile:hover in site.css). */
const TILE_RISE = 14;

/** A floor path through `points`, corners rounded by `r`. */
function floorPath(points: P3[], r = 22): string {
  let d = `M${at(points[0]!).join(' ')}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [a, b, c] = [points[i - 1]!, points[i]!, points[i + 1]!];
    const toward = (from: P3, to: P3, len: number): P3 => {
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const k = len / Math.hypot(dx, dy);
      return [from[0] + dx * k, from[1] + dy * k];
    };
    d += `L${at(toward(b, a, r)).join(' ')}Q${at(b).join(' ')} ${at(toward(b, c, r)).join(' ')}`;
  }
  return `${d}L${at(points[points.length - 1]!).join(' ')}`;
}

/** Feeds into the stack: each runs along x, turns, and ends at the stack's left face. */
const FEEDS = [
  { label: 'REST', x: 40, y: 240 },
  { label: 'WebSocket', x: 90, y: 290 },
  { label: 'CSV', x: 140, y: 340 },
].map((f) => ({ ...f, path: floorPath([[-560, f.y], [f.x, f.y], [f.x, SIZE]]) }));
// The output runs past the view box, out to the window's edge.
const OUT = { label: 'your app', path: floorPath([[SIZE, 90], [1400, 90]]) };

/** A label pill lying on the floor, its text along x. */
const pill = (label: string, p: P3, width: number) =>
  `<g transform="${onTop(p)}"><rect class="hx-pill" x="${-width / 2}" y="-12" width="${width}" height="24" rx="12"/>` +
  `<text class="hx-pill-text" text-anchor="middle" dominant-baseline="central">${label}</text></g>`;

/** Packets riding a path: `count` dots, evenly staggered. */
const packets = (path: string, dur: number, count: number, cls = 'hx-dot') =>
  Array.from(
    { length: count },
    (_, i) =>
      `<circle class="${cls}" r="3.5" filter="url(#hx-glow)"><animateMotion dur="${dur}s" begin="${r1((-dur * i) / count)}s" repeatCount="indefinite" path="${path}"/></circle>`,
  ).join('');

/** The floor grid: lines along both axes, faded towards the edges by a mask. */
function grid(): string {
  const lines: string[] = [];
  for (let v = -480; v <= 720; v += 40) {
    lines.push(`<path d="M${at([-600, v]).join(' ')}L${at([800, v]).join(' ')}"/>`);
    lines.push(`<path d="M${at([v, -600]).join(' ')}L${at([v, 800]).join(' ')}"/>`);
  }
  return `<g class="hx-grid" mask="url(#hx-fade)">${lines.join('')}</g>`;
}

/** Candles in the scrolling strip on the core's right face, and their spacing. */
const STRIP = { count: 26, step: 11, body: 6 };

/**
 * A candle chart on the core's right face (local x along the face, y down),
 * with a moving average. The strip holds two copies of one loop and slides
 * left by one copy, so it scrolls forever without a jump.
 */
function coreChart(): string {
  const random = seededRandom(11);
  const { count, step, body } = STRIP;
  const closes = [0];
  for (let i = 0; i < count; i++) closes.push(closes[i]! + (random() - 0.48) * 9);
  // Pulled back to the first close, so the loop's end meets its start.
  const drift = closes[count]! - closes[0]!;
  const close = closes.map((c, i) => c - (drift * i) / count);
  const bars = Array.from({ length: count }, (_, i) => {
    const open = close[i]!;
    const shut = close[i + 1]!;
    return { open, close: shut, high: Math.max(open, shut) + random() * 3.5, low: Math.min(open, shut) - random() * 3.5 };
  });
  const lo = Math.min(...bars.map((b) => b.low));
  const hi = Math.max(...bars.map((b) => b.high));
  // Prices to local y: the face is CORE.h tall, local y runs down from its bottom edge.
  const y = (v: number) => r1(-12 - ((v - lo) / (hi - lo)) * (CORE.h - 24));
  const candlesOnce = bars
    .map((b, i) => {
      const x = 14 + i * step;
      const up = b.close >= b.open;
      const top = y(Math.max(b.open, b.close));
      const height = Math.max(1.5, r1(y(Math.min(b.open, b.close)) - top));
      return (
        `<g class="hx-candle ${up ? 'is-up' : 'is-down'}"><path d="M${x} ${y(b.high)}V${y(b.low)}"/>` +
        `<rect x="${x - body / 2}" y="${top}" width="${body}" height="${height}" rx="1"/></g>`
      );
    })
    .join('');
  const average = close.slice(1).map((_, i) => {
    const recent = close.slice(Math.max(0, i - 4), i + 2);
    return recent.reduce((sum, v) => sum + v, 0) / recent.length;
  });
  const line = (offset: number) =>
    average.map((v, i) => `${i ? 'L' : 'M'}${offset + 14 + i * step} ${y(v)}`).join('');
  const span = count * step;
  return `<g transform="${onRight([SIZE, SIZE, CORE.z])}">
    <clipPath id="hx-chart-clip"><rect x="6" y="${-CORE.h + 4}" width="${SIZE - 12}" height="${CORE.h - 8}"/></clipPath>
    <g clip-path="url(#hx-chart-clip)"><g class="hx-scroll" style="--span:${span}px">
      ${candlesOnce}<g transform="translate(${span} 0)">${candlesOnce}</g>
      <path class="hx-average" d="${line(0)}${line(span).replace('M', 'L')}"/>
    </g></g></g>`;
}

/** The opt-in packages on top, back to front, each with a small animated glyph on its face. */
const TILE_GLYPHS: [name: string, glyph: string][] = [
  [
    'ui',
    '<rect x="18" y="14" width="44" height="9" rx="2"/><rect x="18" y="27" width="44" height="22" rx="2"/>' +
      '<path class="hx-glyph-fill" d="M21 17h4v3h-4zM28 17h4v3h-4zM35 17h4v3h-4z"/><path class="hx-glyph-draw" d="M22 44l7-6 6 4 8-9 8 5 6-4"/>',
  ],
  ['ta', '<path class="hx-glyph-draw" d="M16 46l9-8 7 5 9-14 8 6 9-15 6 4"/><path d="M16 50h48" opacity=".4"/>'],
  [
    'theming',
    '<circle class="hx-swatch is-accent" cx="26" cy="32" r="7"/><circle class="hx-swatch is-paper" cx="40" cy="32" r="7"/>' +
      '<circle class="hx-swatch is-ink" cx="54" cy="32" r="7"/><circle class="hx-swatch-ring" cx="26" cy="32" r="10.5"/>',
  ],
  ['indicators', '<path class="hx-glyph-flow" d="M14 32q6-12 12 0t12 0 12 0 12 0 12 0"/><path class="hx-glyph-flow is-slow" d="M14 40q6 8 12 0t12 0 12 0 12 0 12 0"/>'],
];

function tiles(): string {
  const { size, inset, z, h } = TILES;
  const far = SIZE - inset - size;
  // Back to front, so nearer tiles paint over farther ones.
  const spots: P3[] = [
    [inset, inset],
    [far, inset],
    [inset, far],
    [far, far],
  ];
  return spots
    .map(([x, y], i) => {
      const [name, glyph] = TILE_GLYPHS[i]!;
      // The hover area stays put and covers the tile both at rest and raised,
      // so a rising tile never slips out from under the pointer.
      const top = z + h + TILE_RISE;
      const hit = pts([x, y, top], [x + size, y, top], [x + size, y, z], [x + size, y + size, z], [x, y + size, z], [x, y + size, top]);
      return (
        `<g class="hx-tile" style="--i:${i}"><polygon class="hx-hit" points="${hit}"/>` +
        `<g class="hx-tile-body">${box(i === 3 ? 'hx-box hx-accent-soft' : 'hx-box', [x, y, z], size, size, h)}` +
        `<g class="hx-glyph" transform="${onTop([x, y, z + h])}">${glyph}` +
        `<text class="hx-tile-text" x="40" y="64" text-anchor="middle" dominant-baseline="central">${name}</text></g></g></g>`
      );
    })
    .join('');
}

/** The hero illustration's SVG markup. */
export function heroArt(): string {
  const shadow = pts([-14, -14], [SIZE + 26, -14], [SIZE + 26, SIZE + 26], [-14, SIZE + 26]);
  const footprint = pts([0, 0], [SIZE, 0], [SIZE, SIZE], [0, SIZE]);
  return `<svg class="lp-hero-art" viewBox="-120 0 880 560" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Data feeds flowing into the charton stack: renderer, core engine, series and drawings, and the opt-in packages">
  <defs>
    <radialGradient id="hx-fade-g" cx="60%" cy="58%" r="52%"><stop offset="0.35" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <mask id="hx-fade"><rect x="-120" width="880" height="560" fill="url(#hx-fade-g)"/></mask>
    <linearGradient id="hx-in-g" x2="0.45"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
    <filter id="hx-glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <linearGradient id="hx-sheen-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="hx-in"><rect x="-120" width="880" height="560" fill="url(#hx-in-g)"/></mask>
  </defs>
  ${grid()}
  <polygon class="hx-shadow" points="${shadow}"/>
  ${[0, 1].map((i) => `<polygon class="hx-pulse" style="--i:${i}" points="${footprint}"/>`).join('')}
  <g mask="url(#hx-in)">${FEEDS.map((f) => `<path class="hx-wire" d="${f.path}"/>`).join('')}${FEEDS.map((f) => packets(f.path, 3.6, 2)).join('')}</g>
  <path class="hx-wire hx-wire-out" d="${OUT.path}"/>
  ${packets(OUT.path, 6, 5, 'hx-dot hx-dot-out')}
  ${FEEDS.map((f) => pill(f.label, [f.x - 120, f.y], f.label.length * 8 + 28)).join('')}
  ${pill(OUT.label, [300, 90], 92)}
  <g class="hx-layer" style="--i:0">${box('hx-box hx-base', [0, 0, BASE.z], SIZE, SIZE, BASE.h)}
  <text class="hx-face-text" transform="${onLeft([14, SIZE, BASE.z + BASE.h / 2])}" dominant-baseline="central">WebGL2 renderer</text></g>
  <g class="hx-layer" style="--i:1">${box('hx-box hx-core', [0, 0, CORE.z], SIZE, SIZE, CORE.h)}
  <text class="hx-face-title" transform="${onLeft([16, SIZE, CORE.z + CORE.h / 2])}" dominant-baseline="central">@charton/core</text>
  ${coreChart()}</g>
  <g class="hx-layer" style="--i:2">${box('hx-box hx-mid', [0, 0, MID.z], SIZE, SIZE, MID.h)}
  <text class="hx-face-text" transform="${onLeft([14, SIZE, MID.z + MID.h / 2])}" dominant-baseline="central">series · drawings</text></g>
  <g>${tiles()}</g>
</svg>`;
}
