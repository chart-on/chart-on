import type { Point, Rect } from '../types';
import { withAlpha } from '../util/color';
import { fillText } from '../typography';
import { disjointChannel, flatTopBottom, parallelChannel } from './channel';
import { arrowHead, drawingFont, drawingWeight, EXTEND_LINE_FIELDS, fillOf, HIT, hitLine, LABEL_OFF, labelSize, labelText, line, LINE_FIELDS, pill, pillWidth, priceEdgeLabel, REFERENCE_FIELDS, stroke, strokeLine, TEXT_FIELDS, timeEdgeLabel, two } from './draw';
import { anchoredVwap, barsPattern, fixedRangeVolumeProfile, projection, regressionTrend } from './data-tools';
import { cyclicLines, sineLine, timeCycles } from './cycles';
import { fibArcs, fibChannel, fibCircles, fibExtension, fibRetracement, fibSpeedFan, fibSpiral, fibTime, fibTimeZone, fibWedge } from './fibonacci';
import { gannBox, gannFan, gannSquare, gannSquareFixed } from './gann';
import { distToSegment, normalizedRect, pointInRect, rayEnd } from './geometry';
import { barsText, datePriceRange, dateRange, FIGURE_FIELDS, forecast, longPosition, priceRange, priceRangeLabel, shortPosition } from './measure-tools';
import { crossLine, extendedLine, horizontalRay, infoLine, trendAngle } from './line-tools';
import { anchoredNote, arrowDown, arrowLeft, arrowMarker, arrowRight, arrowUp, balloon, callout, comment, flag, note, priceLabel, priceNote, signpost } from './marker-tools';
import { insidePitchfork, modifiedSchiffPitchfork, pitchfan, pitchfork, schiffPitchfork } from './pitchfork';
import { patternTools } from './pattern-tools';
import { arc, brush, circle, curve, doubleCurve, ellipse, highlighter, path, polyline, rotatedRectangle, triangle } from './shape-tools';
import { lineBounds, OPEN_BOUNDS } from './model-bounds';
import type { Drawing, DrawingEnv, DrawingToolDef, ScreenDrawing } from './types';
import { sharp } from '../util/math';


/** Font size of a text drawing without one. */
const TEXT_SIZE = 14;

export const trendLine: DrawingToolDef = {
  type: 'trendline',
  styleFields: EXTEND_LINE_FIELDS,
  label: 'Trend line',
  group: 'lines',
  points: 2,
  modelBounds: lineBounds,
  render: (ctx, d, env) => strokeLine(ctx, d, env, ...two(d)),
  hitTest: hitLine,
};

export const ray: DrawingToolDef = {
  type: 'ray',
  styleFields: LINE_FIELDS,
  label: 'Ray',
  group: 'lines',
  points: 2,
  render(ctx, d, env) {
    const [a, b] = two(d);
    stroke(ctx, d, env);
    line(ctx, a, rayEnd(a, b, env.width, env.height));
  },
  // Open towards the second point and, unless level, in price.
  modelBounds(d) {
    const a = d.points[0]!;
    const b = d.points[1] ?? a;
    const right = b.time >= a.time;
    const level = a.price === b.price;
    return {
      from: right ? a.time : -Infinity,
      to: right ? Infinity : a.time,
      low: level ? a.price : -Infinity,
      high: level ? a.price : Infinity,
    };
  },
  hitTest(d, p, env) {
    const [a, b] = two(d);
    return distToSegment(p, a, rayEnd(a, b, env.width, env.height)) <= HIT;
  },
};

export const arrow: DrawingToolDef = {
  type: 'arrow',
  styleFields: EXTEND_LINE_FIELDS,
  label: 'Arrow',
  group: 'annotate',
  points: 2,
  modelBounds: lineBounds,
  render(ctx, d, env) {
    const [a, b] = two(d);
    strokeLine(ctx, d, env, a, b);
    // The head stays on the second point, so an extended arrow still shows which way it points.
    arrowHead(ctx, a, b);
  },
  hitTest: hitLine,
};

export const horizontalLine: DrawingToolDef = {
  type: 'hline',
  styleFields: REFERENCE_FIELDS,
  label: 'Horizontal line',
  group: 'lines',
  points: 1,
  render(ctx, d, env) {
    const y = sharp(d.points[0]!.y);
    stroke(ctx, d, env);
    line(ctx, { x: 0, y }, { x: env.width, y });
    if (d.drawing.style.showLabel !== false) priceEdgeLabel(ctx, d, env, y);
  },
  modelBounds: (d) => ({ from: -Infinity, to: Infinity, low: d.points[0]!.price, high: d.points[0]!.price }),
  // Its time only says where it was placed.
  axisMarks: (d) => ({ prices: [d.points[0]!.price] }),
  // Dragging it only shows a move up or down.
  cursor: () => 'ns-resize',
  hitTest: (d, p) => Math.abs(p.y - d.points[0]!.y) <= HIT,
};

export const verticalLine: DrawingToolDef = {
  type: 'vline',
  styleFields: REFERENCE_FIELDS,
  defaultStyle: LABEL_OFF,
  label: 'Vertical line',
  group: 'lines',
  points: 1,
  // Its price only says where it was placed.
  snap: 'time',
  render(ctx, d, env) {
    const x = sharp(d.points[0]!.x);
    stroke(ctx, d, env);
    line(ctx, { x, y: 0 }, { x, y: env.height });
    if (d.drawing.style.showLabel === true) timeEdgeLabel(ctx, d, env, x);
  },
  modelBounds: (d) => ({ from: d.points[0]!.time, to: d.points[0]!.time, low: -Infinity, high: Infinity }),
  axisMarks: (d) => ({ times: [d.points[0]!.time] }),
  cursor: () => 'ew-resize',
  hitTest: (d, p) => Math.abs(p.x - d.points[0]!.x) <= HIT,
};

export const rectangle: DrawingToolDef = {
  type: 'rectangle',
  // Extended, a rectangle marks a price zone across the pane.
  styleFields: ['color', 'fill', 'lineWidth', 'lineStyle', 'extendLeft', 'extendRight', 'showFill'],
  label: 'Rectangle',
  group: 'annotate',
  points: 2,
  render(ctx, d, env) {
    const r = rectangleBox(d, env);
    const color = d.drawing.style.color ?? env.theme.drawing;
    ctx.fillStyle = fillOf(d.drawing.style, withAlpha(color, 0.14));
    ctx.fillRect(r.x, r.y, r.width, r.height);
    stroke(ctx, d, env);
    ctx.strokeRect(r.x, r.y, r.width, r.height);
  },
  hitTest(d, p, env) {
    const r = rectangleBox(d, env);
    return pointInRect(p, r, { x: r.x + r.width, y: r.y + r.height }, HIT / 2);
  },
};

/** The rectangle between the anchors, reaching the pane edge on each side the style extends. */
function rectangleBox(d: ScreenDrawing, env: DrawingEnv): Rect {
  const r = normalizedRect(...two(d));
  const s = d.drawing.style;
  const left = s.extendLeft ? Math.min(0, r.x) : r.x;
  const right = s.extendRight ? Math.max(env.width, r.x + r.width) : r.x + r.width;
  return { ...r, x: left, width: right - left };
}

/** Text running right and down from its point, pinned to time and price or, with `anchoring: 'screen'`, to the pane. */
const textTool = (type: string, label: string, anchoring: DrawingToolDef['anchoring']): DrawingToolDef => ({
  type,
  label,
  group: 'annotate',
  points: 1,
  editableText: true,
  anchoring,
  defaultStyle: { fontSize: TEXT_SIZE },
  // `color` is the text color of drawings made before `textColor` existed.
  styleFields: TEXT_FIELDS,
  // The text runs right and down from its anchor by its rendered width.
  modelBounds: () => OPEN_BOUNDS,
  render(ctx, d, env) {
    const p = d.points[0]!;
    const s = d.drawing.style;
    const size = s.fontSize ?? TEXT_SIZE;
    ctx.font = drawingFont(size, env.theme.fontFamily, s, drawingWeight(env));
    ctx.fillStyle = s.textColor ?? s.color ?? env.theme.drawingSelected;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    fillText(ctx, d.drawing.text ?? '', p.x, p.y);
    if (d.selected || d.hovered) {
      ctx.strokeStyle = withAlpha(env.theme.drawing, 0.6);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      const b = textBox(d, env);
      ctx.strokeRect(b.x, b.y, b.width, b.height);
    }
  },
  hitTest(d, p, env) {
    const b = textBox(d, env);
    return pointInRect(p, b, { x: b.x + b.width, y: b.y + b.height });
  },
  // Lets a pane-anchored text keep its whole box on the pane when moved.
  bounds: textBox,
});

/** The text's box with a 3 px pad: its hit area, outline and bounds. */
function textBox(d: ScreenDrawing, env: DrawingEnv): Rect {
  const a = d.points[0]!;
  const s = d.drawing.style;
  const size = s.fontSize ?? TEXT_SIZE;
  return { x: a.x - 3, y: a.y - 3, width: env.measureText(d.drawing.text ?? '', size, s) + 6, height: size + 6 };
}

export const text = textTool('text', 'Text', 'data');
/** Text pinned to the pane: it stays put while the chart scrolls and zooms. */
export const anchoredText = textTool('anchored-text', 'Anchored text', 'screen');

/** The measure's theme color: up for a rise or no move, down for a fall. */
const measureColor = (d: Drawing) => {
  const [a, b] = two(d);
  return b.price >= a.price ? 'up' : 'down';
};

export const measure: DrawingToolDef = {
  type: 'measure',
  label: 'Measure',
  group: 'measure',
  points: 2,
  // Colored by direction; only the label is styleable, and can be hidden.
  styleFields: [...TEXT_FIELDS, ...FIGURE_FIELDS],
  themeColor: measureColor,
  render(ctx, d, env) {
    const [a, b] = two(d);
    const [pa, pb] = two(d.drawing);
    const delta = pb.price - pa.price;
    const color = env.theme[measureColor(d.drawing)];
    const r = normalizedRect(a, b);
    ctx.fillStyle = withAlpha(color, 0.16);
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    line(ctx, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y });
    line(ctx, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 });
    if (d.drawing.style.showStats === false) return;
    const label = `${priceRangeLabel(pa.price, pb.price, env.formatPrice, env.localization)} · ${barsText(env.barsBetween(pa, pb), env.localization)}`;
    const style = d.drawing.style;
    const w = pillWidth(env, label, style);
    const offset = labelSize(env, style) / 2 + 8;
    const y = delta >= 0 ? r.y - offset : r.y + r.height + offset;
    pill(ctx, label, r.x + r.width / 2 - w / 2, y, color, labelText(color, env), env, style);
  },
  hitTest: (d, p) => pointInRect(p, ...two(d), HIT / 2),
};

const none = () => false;

/** Removes the drawings a click or drag hits instead of placing one; see `DrawingToolDef.action`. */
export const eraser: DrawingToolDef = { type: 'eraser', label: 'Eraser', points: 'free', action: 'erase', render: none, hitTest: none };

/** Zooms the view to a dragged box instead of placing a drawing; see `DrawingToolDef.action`. */
export const zoomBox: DrawingToolDef = { type: 'zoom-box', label: 'Zoom box', points: 2, action: 'zoom', render: none, hitTest: none };

/**
 * The drawingTools plugin's catalog, in seven groups by the job a tool does,
 * then the eraser and zoom box. The rail shows the groups in this order.
 *
 * Groups go from simple to complex, by what a drawing adds to the anchors the
 * user places: `lines` (single reference lines, nothing added), `annotate`
 * (shapes, text, arrows and icons), `parallels` (channels, the Fib channel
 * among them, pitchforks, pitchfan and regression: lines parallel to the
 * anchors), `ratios` (Fibonacci and Gann price grids, fans and arcs: levels at
 * ratios of the move), `time` (time zones, trend-based time, cycles and sine:
 * times projected from it), `patterns` (harmonic and chart patterns and waves:
 * several labelled legs) and `measure` (ranges, positions, forecast, bars
 * pattern, projection, anchored VWAP and volume profile: values computed from
 * the bars, such as the change, the copied bars or the replayed closes). Within a group, tools with fewer anchors come first
 * (any number or a free drag last), then by English label. The list is kept in
 * that order by hand, so the rule costs no code; `tool-catalogue.test.ts`
 * asserts it.
 */
export const builtinTools: DrawingToolDef[] = /* @__PURE__ */ [
  crossLine,
  horizontalLine,
  horizontalRay,
  verticalLine,
  extendedLine,
  ray,
  trendAngle,
  trendLine,
  infoLine,
  anchoredNote,
  anchoredText,
  arrowDown,
  arrowLeft,
  arrowRight,
  arrowUp,
  balloon,
  comment,
  flag,
  note,
  priceLabel,
  signpost,
  text,
  arrow,
  arrowMarker,
  callout,
  circle,
  ellipse,
  priceNote,
  rectangle,
  arc,
  curve,
  doubleCurve,
  rotatedRectangle,
  triangle,
  brush,
  highlighter,
  path,
  polyline,
  regressionTrend,
  disjointChannel,
  fibChannel,
  flatTopBottom,
  insidePitchfork,
  modifiedSchiffPitchfork,
  parallelChannel,
  pitchfan,
  pitchfork,
  schiffPitchfork,
  fibArcs,
  fibCircles,
  fibRetracement,
  fibSpeedFan,
  fibSpiral,
  gannBox,
  gannFan,
  gannSquare,
  gannSquareFixed,
  fibWedge,
  fibExtension,
  cyclicLines,
  fibTimeZone,
  sineLine,
  timeCycles,
  fibTime,
  patternTools,
  anchoredVwap,
  datePriceRange,
  dateRange,
  fixedRangeVolumeProfile,
  forecast,
  measure,
  priceRange,
  projection,
  barsPattern,
  longPosition,
  shortPosition,
  eraser,
  zoomBox,
].flat();
