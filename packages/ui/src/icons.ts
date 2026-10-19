import type { CandleStyle } from '@chart-on/core';
import type { IconNode } from './dom';

// Original icons on a 24-unit grid, stroked with currentColor like the rest of
// the UI. Filled dots mark the anchor points a tool asks for.

type Child = IconNode[number];

const path = (d: string): Child => ['path', { d }];
const dashed = (d: string): Child => ['path', { d, 'stroke-dasharray': '2 2.5' }];
const rect = (x: number, y: number, width: number, height: number, rx?: number, extra?: Child[1]): Child => ['rect', { x, y, width, height, rx, ...extra }];
const dot = (cx: number, cy: number): Child => ['circle', { cx, cy, r: 1.25, fill: 'currentColor' }];
/** Dots at each `x, y` pair. */
const dots = (...xy: number[]): Child[] => xy.flatMap((v, i) => (i % 2 ? [] : [dot(v, xy[i + 1]!)]));

/** Default rail cursor: crosshair arms around a centre dot. */
export const crosshairIcon: IconNode = [path('M12 3v5M12 16v5M3 12h5M16 12h5'), dot(12, 12)];

/** Rail cursor without crosshair lines: a pointer arrow. */
export const pointerCursorIcon: IconNode = [path('M6 3v15l4-4 3 6.5 2.5-1.2-3-6.3H18z')];

/** Last-resort icon for a tool with neither its own icon nor a group icon. */
export const drawingIcon: IconNode = [path('M4 20l1-4L16 5l3 3L8 19zM14 7l3 3')];

/**
 * Icons keyed by drawing tool type. Besides the built-in tools this covers the
 * tools planned in `roadmap/drawing-tools.md`, so each one arrives with its
 * icon. A new tool only needs an entry here under its type. The built-in
 * tools come in the catalogue's order (see `builtinTools`), the rest by type.
 */
export const drawingIcons: Record<string, IconNode> = {
  'cross-line': [path('M2 12h20M12 2v20'), dot(12, 12)],
  hline: [path('M2 12h20'), dot(12, 12)],
  'horizontal-ray': [path('M5 12h16M18 9l3 3-3 3'), dot(5, 12)],
  vline: [path('M12 2v20'), dot(12, 12)],
  'extended-line': [path('M2 20 22 4'), dot(8, 15.2), dot(16, 8.8)],
  ray: [path('M5 18 21 4.3'), dot(5, 18), dot(12, 12)],
  'trend-angle': [path('M4 18 19 6M4 18h16M10 18a6 6 0 0 0-1.3-3.75'), ...dots(4, 18, 19, 6)],
  trendline: [path('M5 19 19 5'), dot(5, 19), dot(19, 5)],
  'info-line': [path('M4 20 13 11'), dot(4, 20), dot(13, 11), rect(14, 3, 7, 5, 1.5)],
  'anchored-note': [path('M5 8h14v12H5zM12 3v5M8 12h8M8 16h5'), dot(12, 3)],
  'anchored-text': [dashed('M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z'), path('M8 8h8M12 8v8')],
  'arrow-down': [path('M12 21l7-8h-4V4H9v9H5z')],
  'arrow-left': [path('M3 12l8-7v4h9v6h-9v4z')],
  'arrow-right': [path('M21 12l-8-7v4H4v6h9v4z')],
  'arrow-up': [path('M12 3l7 8h-4v9H9v-9H5z')],
  balloon: [path('M12 4c5 0 9 3 9 7s-4 7-9 7c-1 0-2-.1-3-.4L5 20l.7-3.6C4 15 3 13 3 11c0-4 4-7 9-7z')],
  comment: [path('M4 5h16v11h-9l-4 4v-4H4z')],
  flag: [path('M6 21V4h11l-2 4 2 4H6')],
  note: [path('M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h5')],
  'price-label': [path('M3 12l5-6h13v12H8z'), dot(8, 12)],
  signpost: [path('M12 3v18M5 6h11l3 3-3 3H5zM9 21h6')],
  text: [path('M5 5h14M12 5v14M9.5 19h5')],
  arrow: [path('M5 19 19 5M11 5h8v8')],
  'arrow-marker': [path('M5 19l9-9-3-3h9v9l-3-3-9 9z')],
  callout: [rect(8, 3, 13, 9, 1.5), path('M8 12 3 20M11 7.5h7'), dot(3, 20)],
  circle: [['circle', { cx: 12, cy: 12, r: 8 }], dot(12, 12), dot(20, 12)],
  ellipse: [['ellipse', { cx: 12, cy: 12, rx: 9, ry: 6 }], dot(12, 6), dot(21, 12)],
  'price-note': [path('M3 18l7-7M10 11l3-4h8v8h-8z'), dot(3, 18)],
  rectangle: [rect(4, 6, 16, 12, 1), dot(4, 6), dot(20, 18)],
  arc: [path('M3 18a9 9 0 0 1 18 0'), ...dots(3, 18, 12, 9, 21, 18)],
  curve: [path('M3 18Q12 0 21 18'), ...dots(3, 18, 21, 18)],
  'double-curve': [path('M3 18C9 2 15 22 21 6'), ...dots(3, 18, 21, 6)],
  'rotated-rectangle': [path('M3 13l7-9 11 7-7 9z'), ...dots(3, 13, 10, 4, 21, 11)],
  triangle: [path('M4 19 12 5l8 14z'), ...dots(4, 19, 12, 5, 20, 19)],
  brush: [path('M3 17c2-4 4-6 6-3s3 4 5 0 3-7 6-6')],
  highlighter: [['path', { d: 'M4 16c4-6 8-6 16-8', 'stroke-width': 5, 'stroke-opacity': 0.4 }]],
  path: [path('M3 18 8 8l6 7 6-9M16 6h4v4'), ...dots(3, 18, 8, 8, 14, 15)],
  polyline: [path('M3 18 8 8l6 7 7-10'), ...dots(3, 18, 8, 8, 14, 15, 21, 5)],
  'regression-trend': [path('M3 16 21 8'), dashed('M3 12 21 4M3 20l18-8'), ...dots(3, 16, 21, 8)],
  'disjoint-channel': [path('M3 5l18 5M3 19l18-6'), ...dots(3, 5, 21, 10, 3, 19)],
  'fib-channel': [path('M3 10 21 3M3 15l18-7M3 21l18-7'), ...dots(3, 10, 21, 3, 3, 21)],
  'flat-top-bottom': [path('M3 5h18M3 19l18-7'), ...dots(3, 19, 21, 12, 21, 5)],
  'inside-pitchfork': [path('M3 20 20 3M9 8l6 6M10.5 9.5l5-5M13.5 12.5l5-5'), ...dots(3, 20, 9, 8, 15, 14)],
  'modified-schiff-pitchfork': [path('M6 17 20 3M9 8l5-5M15 14l5-5M9 8l6 6'), dashed('M3 20l3-3'), ...dots(3, 20, 9, 8, 15, 14)],
  'parallel-channel': [path('M3 12 21 4M3 20l18-8'), dot(3, 12), dot(21, 4), dot(3, 20)],
  pitchfan: [path('M3 20 11 3M3 20 21 3M3 20l18-6'), dashed('M8.6 8.1 15.6 15.8'), ...dots(3, 20, 8.6, 8.1, 15.6, 15.8)],
  pitchfork: [path('M3 20 20 3M9 8l5-5M15 14l5-5M9 8l6 6'), ...dots(3, 20, 9, 8, 15, 14)],
  'schiff-pitchfork': [path('M6 14 20 7M9 8l10-5M15 14l6-3M9 8l6 6'), dashed('M3 20l3-6'), ...dots(3, 20, 9, 8, 15, 14)],
  'fib-arcs': [path('M8 20a4 4 0 0 1 8 0M5 20a7 7 0 0 1 14 0M2 20a10 10 0 0 1 20 0'), dot(12, 20)],
  'fib-circles': [
    ['circle', { cx: 12, cy: 12, r: 3 }],
    ['circle', { cx: 12, cy: 12, r: 6 }],
    ['circle', { cx: 12, cy: 12, r: 9 }],
  ],
  'fib-retracement': [
    path('M3 4h18M3 10h18M3 14h18M3 20h18'),
    ['path', { d: 'M4 20 20 4', 'stroke-dasharray': '1.5 3' }],
    dot(4, 20),
    dot(20, 4),
  ],
  'fib-speed-fan': [path('M3 21 21 3M3 21l18-12M3 21l18-7M3 21 10 3M3 21 14 3'), dashed('M21 3v18'), dot(3, 21)],
  'fib-spiral': [path('M14 10a1 1 0 0 1-1 1 2 2 0 0 1-2-2 3 3 0 0 1 3-3 5 5 0 0 1 5 5 8 8 0 0 1-8 8')],
  'gann-box': [rect(3, 4, 18, 16, 1), path('M9 4v16M15 4v16M3 10h18M3 14h18')],
  'gann-fan': [path('M3 21 21 3M3 21l18-6M3 21l18-12M3 21 9 3M3 21 15 3'), dot(3, 21)],
  'gann-square': [rect(4, 4, 16, 16, 1), path('M4 20 20 4M12 4v16M4 12h16')],
  'gann-square-fixed': [rect(4, 4, 16, 16, 1), path('M4 20 20 4M4 4l16 16'), dot(12, 12)],
  'fib-wedge': [path('M3 12 21 4M3 12l18 8M10.3 8.75a8 8 0 0 1 0 6.5M14.9 6.7a13 13 0 0 1 0 10.6'), dot(3, 12)],
  'fib-extension': [path('M3 20 8 9l4 6M15 4h6M15 9.5h6M15 15h6M15 20h6'), dot(3, 20), dot(8, 9), dot(12, 15)],
  'cyclic-lines': [path('M4 4v16M9 4v16M14 4v16M19 4v16'), ...dots(4, 20, 9, 20)],
  'fib-time-zone': [path('M3 4v16M5 4v16M8 4v16M13 4v16M21 4v16')],
  'sine-line': [path('M2 12c1.7-5.3 3.3-8 5-8s3.3 2.7 5 8 3.3 8 5 8 3.3-2.7 5-8'), ...dots(7, 4, 17, 20)],
  'time-cycles': [path('M2 18h20M3 18a3 3 0 0 1 6 0 3 3 0 0 1 6 0 3 3 0 0 1 6 0')],
  'fib-time': [path('M3 20 7 11l4 5M13 4v16M16 4v16M21 4v16'), ...dots(3, 20, 7, 11, 11, 16)],
  'elliott-correction': [path('M3 4l7 12 4-6 7 10'), ...dots(10, 16, 14, 10, 21, 20)],
  'elliott-double-combo': [path('M3 7l7 10 4-6 7 6'), ...dots(10, 17, 14, 11, 21, 17)],
  abcd: [path('M3 5l6 11 5-7 7 11')],
  'triangle-pattern': [path('M3 4l5 14 4-10 4 7 5-4'), dashed('M3 4l18 7M8 18l13-7')],
  cypher: [path('M3 20 7 8l4 6 5-10 5 11'), dashed('M3 20l8-6 10 1')],
  'elliott-triangle': [path('M3 4l4 14 4-11 4 8 3-5 3 2'), ...dots(7, 18, 11, 7, 15, 15)],
  'elliott-triple-combo': [path('M3 5l4 7 3-3 4 7 3-3 4 7'), ...dots(7, 12, 14, 16, 21, 20)],
  xabcd: [path('M3 18 8 5l4 8 4-5 5 11'), dashed('M3 18l9-5 9 6')],
  'elliott-impulse': [path('M3 20l4-7 3 3 5-11 3 5 3-7'), ...dots(7, 13, 15, 5, 21, 3)],
  'head-shoulders': [path('M2 19l3-7 3 4 4-12 4 12 3-4 3 7'), dashed('M4 16h16')],
  'three-drives': [path('M2 20l3-7 3 3 4-7 3 3 4-8 3 3')],
  'anchored-vwap': [path('M4 18c4-1 6-6 9-7s5-1 7-5M4 14v8'), dot(4, 18)],
  'date-price-range': [dashed('M4 4h16v16H4z'), path('M8 16l8-8M11 8h5v5')],
  'date-range': [path('M4 6v12M20 6v12M7 12h10M9.5 9 7 12l2.5 3M14.5 9l2.5 3-2.5 3')],
  'fixed-range-volume-profile': [path('M4 3v18M20 3v18M4 6h5M4 9.5h10M4 13h13M4 16.5h7')],
  forecast: [path('M3 17 10 10'), dashed('M10 10l11-5'), ...dots(3, 17, 10, 10, 21, 5)],
  measure: [rect(3, 8, 18, 8, 1.5), path('M7 8v3M11 8v4.5M15 8v3')],
  'price-range': [path('M6 4h12M6 20h12M12 7v10M9 9.5 12 7l3 2.5M9 14.5l3 2.5 3-2.5')],
  projection: [path('M4 18l6-8 10 4'), dashed('M10 10V4h10v10'), ...dots(4, 18, 10, 10, 20, 14)],
  'bars-pattern': [path('M6 6v12M4 9h2M6 15h2M12 4v12M10 13h2M12 7h2M18 8v12M16 11h2M18 17h2')],
  'long-position': [rect(4, 3, 16, 18, 1.5), path('M4 14h16M12 11V6M9.5 8.5 12 6l2.5 2.5')],
  'short-position': [rect(4, 3, 16, 18, 1.5), path('M4 10h16M12 13v5M9.5 15.5 12 18l2.5-2.5')],
  eraser: [path('M8 19 4 15 13 6l6 6-7 7zM9 10l6 6M12 19h8')],
  'zoom-box': [dashed('M3 3h10v10H3z'), path('M19 15a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM18 18l3 3')],

  // Tools outside `builtinTools` (plugin and planned tools), by type.
  emoji: [['circle', { cx: 12, cy: 12, r: 9 }], path('M8.5 14.5c2 2 5 2 7 0'), ...dots(9, 10, 15, 10)],
  icon: [path('M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7z')],
  image: [rect(3, 4, 18, 16, 1.5), path('M3 17l5-5 4 4 3-3 6 6'), ['circle', { cx: 15.5, cy: 8.5, r: 1.5 }]],
  sticker: [path('M4 4h16v10l-6 6H4zM14 20v-6h6')],
  zoom: [['circle', { cx: 10, cy: 10, r: 6 }], path('M14.5 14.5 20 20M7.5 10h5M10 7.5v5')],
};

/**
 * The built-in tool groups, in the catalogue's order (see `builtinTools`), each
 * with its face: the tool its rail button shows until another is picked. A face
 * is the group's most general tool, the one that assumes least about what is
 * drawn: any line, any text, any channel, the plain retracement, any period,
 * the plain zigzag, any measure. `groupIcons` uses the faces' icons. Internal (the rail reads it).
 */
export const groupFaces: Record<string, string> = {
  lines: 'trendline',
  annotate: 'text',
  parallels: 'parallel-channel',
  ratios: 'fib-retracement',
  time: 'cyclic-lines',
  patterns: 'abcd',
  measure: 'measure',
};
/**
 * Fallback icon per tool group, for a tool without an icon of its own (a
 * plugin tool, or a new built-in one), so it still looks like its family:
 * the icon of the group's face.
 */
export const groupIcons: Record<string, IconNode> = Object.fromEntries(Object.entries(groupFaces).map(([group, tool]) => [group, drawingIcons[tool]!]));

const fill = { fill: 'currentColor' };
const tint = { fill: 'currentColor', 'fill-opacity': 0.25, stroke: 'none' };

/** A candle at `x`: wick from `top` to `bottom`, body from `open` to `close`. */
function candle(x: number, top: number, open: number, close: number, bottom: number, body: Record<string, string | number> = fill, w = 5): Child[] {
  return [
    path(`M${x} ${top}V${open}M${x} ${close}V${bottom}`),
    rect(x - w / 2, open, w, close - open, 0.5, body),
  ];
}

const X = (x: number, y: number): Child => path(`M${x - 1.5} ${y - 1.5}l3 3M${x + 1.5} ${y - 1.5}l-3 3`);

const builtinChartTypes: Record<CandleStyle, IconNode> = {
  candles: [...candle(8, 3, 7, 15, 20), ...candle(16, 5, 9, 17, 21)],
  hollow: [...candle(8, 3, 7, 15, 20, {}), ...candle(16, 5, 9, 17, 21, {})],
  volumeCandles: [...candle(7, 4, 8, 15, 20, fill, 3), ...candle(16, 3, 7, 17, 21, fill, 7)],
  heikinAshi: [...candle(5, 11, 13, 20, 22, fill, 4), ...candle(12, 6, 8, 15, 17, fill, 4), ...candle(19, 2, 3, 10, 12, fill, 4)],
  bars: [path('M8 4v16M5 8h3M8 16h3M16 3v14M13 13h3M16 6h3')],
  hlcBars: [path('M8 4v16M8 16h3M16 3v14M16 6h3')],
  highLow: [rect(6, 4, 4, 13, 2), rect(14, 8, 4, 12, 2)],
  columns: [
    path('M3 21h18'),
    rect(5, 12, 3, 9, 0.5),
    rect(10.5, 6, 3, 15, 0.5),
    rect(16, 9, 3, 12, 0.5),
  ],
  line: [path('M3 17l5-6 4 3 4-7 5 4')],
  lineMarkers: [path('M3 17l5-6 4 3 4-7 5 4'), ...dots(3, 17, 8, 11, 12, 14, 16, 7, 21, 11)],
  step: [path('M3 17h4v-6h5v3h4V7h5')],
  area: [['path', { d: 'M3 17l5-6 4 3 4-7 5 4v10H3z', ...tint }], path('M3 17l5-6 4 3 4-7 5 4')],
  rangeBand: [
    ['path', { d: 'M3 12l5-6 4 2 4-5 5 3v10l-5-3-4 5-4-3-5 4z', ...tint }],
    path('M3 12l5-6 4 2 4-5 5 3M3 19l5-4 4 3 4-5 5 3'),
  ],
  baseline: [dashed('M2 12h20'), path('M3 15l4-6 4 7 4-9 3 10 3-5')],
  kagi: [path('M4 18V8h4v6h4V4h4v10h4V8')],
  pointFigure: [X(6, 8), X(6, 14), ['circle', { cx: 12, cy: 11, r: 1.75 }], ['circle', { cx: 12, cy: 17, r: 1.75 }], X(18, 5), X(18, 11)],
};

/**
 * Icons keyed by chart type: every `CandleStyle`, two candle variants (outlined,
 * and bodies without outlines or wicks), and the planned price-based and
 * order-flow types. The planned keys are provisional until those types ship.
 */
export const chartTypeIcons: Record<string, IconNode> = {
  ...builtinChartTypes,
  outlined: [...candle(8, 3, 7, 15, 20, { fill: 'currentColor', 'fill-opacity': 0.35 }), ...candle(16, 5, 9, 17, 21, { fill: 'currentColor', 'fill-opacity': 0.35 })],
  bodies: [
    rect(5.5, 7, 5, 8, 0.5, fill),
    rect(13.5, 9, 5, 8, 0.5, fill),
  ],

  // Planned chart types.
  renko: [
    rect(2, 16, 4, 4),
    rect(6, 12, 4, 4),
    rect(10, 8, 4, 4),
    rect(14, 12, 4, 4, undefined, fill),
    rect(18, 16, 4, 4, undefined, fill),
  ],
  lineBreak: [
    rect(3, 13, 4, 6),
    rect(7, 8, 4, 5),
    rect(11, 4, 4, 4),
    rect(15, 4, 4, 9, undefined, fill),
  ],
  rangeBars: [path('M6 4v10M4 6h2M6 12h2M12 8v10M10 10h2M12 16h2M18 6v10M16 14h2M18 8h2')],
  footprint: [rect(4, 3, 16, 18, 1.5), path('M12 3v18M4 7.5h16M4 12h16M4 16.5h16')],
  tpo: [['path', { d: 'M4 6h6M4 10h12M4 14h16M4 18h9', 'stroke-width': 2.5, 'stroke-dasharray': '3 1.5', 'stroke-linecap': 'butt' }]],
};
