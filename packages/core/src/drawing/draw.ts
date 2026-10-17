import type { Point } from '../types';
import { distToSegment, rayEnd } from './geometry';
import type { DrawingEnv, DrawingStyle, DrawingTextStyle, ScreenDrawing } from './types';
import { fillText, resolveFont, type FontWeight } from '../typography';
import { clampLow, sharp } from '../util/math';
import { contrastText } from '../util/color';

/** Hit-test tolerance in css px, shared by the built-in tools. */
export const HIT = 6;

/** `styleFields` of a tool drawn with the drawing's line style. */
export const LINE_FIELDS = ['color', 'lineWidth', 'lineStyle'] as const;
/** `styleFields` of a two-point line that can run on past its anchors to the pane edges. */
export const EXTEND_LINE_FIELDS = [...LINE_FIELDS, 'extendLeft', 'extendRight'] as const;
/** `styleFields` of a tool that draws text or labels. */
export const TEXT_FIELDS = ['textColor', 'fontSize', 'bold', 'italic'] as const;
/** `styleFields` of the reference lines (horizontal, vertical, ray and cross): line style, the label switch and its text. */
export const REFERENCE_FIELDS = [...LINE_FIELDS, 'showLabel', ...TEXT_FIELDS] as const;
/**
 * `defaultStyle` of reference lines whose label came later: they draw it only
 * when `showLabel` is true, so saved drawings keep their look, and new ones
 * start without it for the same reason.
 */
export const LABEL_OFF = { showLabel: false } as const;

/** Opacity of the stronger of the alternating bands level tools fill between their levels; the other band takes half. */
export const BAND_ALPHA = 0.12;

/** What `fillOf` returns for no fill. */
export const NO_FILL = 'transparent';

/**
 * The color a tool fills its background with: the style's `fill`, else the
 * tool's own `tint`, and `'transparent'` when `showFill` is false. A tool whose
 * fill is opt-in passes `'transparent'` as its tint and skips filling when it
 * gets it back.
 */
export const fillOf = (s: DrawingStyle, tint: string): string => (s.showFill === false ? NO_FILL : (s.fill ?? tint));

/** The first two points; the first twice while only one is placed. */
export const two = <P>({ points }: { readonly points: readonly P[] }): [P, P] => [points[0]!, points[1] ?? points[0]!];

/** Apply the drawing's line style; `width` is the default when the style sets none. */
export function stroke(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, width = 1.5): void {
  const s = d.drawing.style;
  ctx.strokeStyle = s.color ?? env.theme.drawing;
  ctx.lineWidth = (s.lineWidth ?? width) + (d.hovered && !d.selected ? 0.5 : 0);
  ctx.setLineDash(dash(s));
  ctx.lineCap = 'round';
}

export function dash(s: DrawingStyle): number[] {
  if (s.lineStyle === 'dashed') return [6, 4];
  if (s.lineStyle === 'dotted') return [1.5, 3];
  return [];
}

export function line(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** Length of an arrow head's legs, in css px. */
const ARROW = 10;
/** Angle of each leg off the shaft, in radians. */
const ARROW_SPREAD = 0.45;

/**
 * Open arrow head at `b`, pointing from `a`, drawn solid in the current stroke
 * style; the dash is restored afterwards. Every built-in tool that ends a line
 * with an arrow head uses it, so their heads match (the filled arrow markers
 * and glyphs size themselves). Legs of 10 px at 0.45 rad reach 10 * sin(0.45),
 * about 4.4 px, off the line, so the head stays inside the line's hit band
 * (`HIT`). The legs are kept to half the shaft, so a short arrow still shows a
 * shaft, and a shaft without length, which has no direction, gets no head.
 */
export function arrowHead(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  const size = Math.min(ARROW, Math.hypot(b.x - a.x, b.y - a.y) / 2);
  if (size < 0.5) return;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const pattern = ctx.getLineDash();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(b.x - size * Math.cos(angle - ARROW_SPREAD), b.y - size * Math.sin(angle - ARROW_SPREAD));
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(b.x - size * Math.cos(angle + ARROW_SPREAD), b.y - size * Math.sin(angle + ARROW_SPREAD));
  ctx.stroke();
  ctx.setLineDash(pattern);
}

/**
 * CSS font for drawing text: italic and bold as `style` sets them, `size` px,
 * in `family`, at `weight` when not bold (see `drawingWeight`). Tools draw and
 * measure text through it (`env.measureText` does), so a hit box matches the
 * text it covers.
 */
export function drawingFont(size: number, family: string, style: DrawingTextStyle = {}, weight: FontWeight = 400): string {
  const w = style.bold === true ? 'bold ' : weight === 400 || weight === 'normal' ? '' : `${weight} `;
  return `${style.italic === true ? 'italic ' : ''}${w}${size}px ${family}`;
}

/** Weight of drawing text that is not bold: the theme's drawings font weight. */
export function drawingWeight(env: Pick<DrawingEnv, 'theme'>): FontWeight {
  return resolveFont(env.theme, 'drawings').fontWeight;
}

/** Font size of a label: the style's `fontSize`, else the theme's. */
export function labelSize(env: DrawingEnv, style: DrawingTextStyle = {}): number {
  return style.fontSize ?? env.theme.fontSize;
}

/**
 * Text color for a label on `bg`: black or white, whichever contrasts more
 * (`contrastText`). A color that cannot be read, which only happens outside
 * a browser where no canvas parses it, gets the theme background, so a
 * render never throws over a style color.
 */
export function labelText(bg: string, env: Pick<DrawingEnv, 'theme'>): string {
  try {
    return contrastText(bg);
  } catch {
    return env.theme.background;
  }
}

/** Width of a label pill around `text`. */
export function pillWidth(env: DrawingEnv, text: string, style: DrawingTextStyle = {}): number {
  return env.measureText(text, labelSize(env, style), style) + 10;
}

/** Height of a label pill. */
export function pillHeight(env: DrawingEnv, style: DrawingTextStyle = {}): number {
  return labelSize(env, style) + 8;
}

/**
 * Label pill with its left edge at `x`, centered on `y`. `style` sets the
 * label's size, weight, slant and text color (over `fg`).
 */
export function pill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bg: string,
  fg: string,
  env: DrawingEnv,
  style: DrawingTextStyle = {},
) {
  const w = pillWidth(env, text, style);
  const h = pillHeight(env, style);
  ctx.setLineDash([]);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y - h / 2, w, h, 4);
  ctx.fill();
  ctx.font = drawingFont(labelSize(env, style), env.theme.fontFamily, style, drawingWeight(env));
  ctx.fillStyle = style.textColor ?? fg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  fillText(ctx, text, x + 5, y + 0.5);
}

/**
 * The price of the drawing's first point in a pill at the pane's right edge,
 * centred on `y`: the label of the horizontal reference lines. Returns the
 * pill's left edge.
 */
export function priceEdgeLabel(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, y: number): number {
  const style = d.drawing.style;
  const text = env.formatPrice(d.drawing.points[0]!.price);
  const x = env.width - pillWidth(env, text, style) - 4;
  const color = style.color ?? env.theme.drawing;
  pill(ctx, text, x, y, color, labelText(color, env), env, style);
  return x;
}

/**
 * The time of the drawing's first point in a pill along the pane's bottom
 * edge, centred on `x` and kept between the pane's left edge and `right`
 * (default its right edge): the label of the vertical reference lines.
 * Nothing on a host without `formatTime`.
 */
export function timeEdgeLabel(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, x: number, right = env.width): void {
  const text = env.formatTime?.(d.drawing.points[0]!.time);
  if (!text) return;
  const style = d.drawing.style;
  const w = pillWidth(env, text, style);
  const y = env.height - pillHeight(env, style) / 2 - 4;
  const color = style.color ?? env.theme.drawing;
  pill(ctx, text, clampLow(x - w / 2, 2, right - w - 2), y, color, labelText(color, env), env, style);
}

/* ---------------- Public render helpers for drawing tool plugins ---------------- */

/**
 * Stroke a→b with the drawing's line style, extended past the left and/or right
 * anchor to the pane edge when the style sets `extendLeft` / `extendRight`.
 */
export function strokeLine(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, a: Point, b: Point): void {
  stroke(ctx, d, env);
  line(ctx, ...lineEnds(d, env, a, b));
}

/**
 * The ends of a→b, left one first, moved to the pane edge on the sides the
 * style extends; what `strokeLine` draws. A vertical segment has no left or
 * right side, so it stays as placed (the vertical line tool spans the pane).
 */
export function lineEnds(d: ScreenDrawing, env: DrawingEnv, a: Point, b: Point): [Point, Point] {
  if (a.x === b.x) return [a, b];
  const [l, r] = a.x < b.x ? [a, b] : [b, a];
  const s = d.drawing.style;
  return [s.extendLeft ? rayEnd(r, l, env.width, env.height) : l, s.extendRight ? rayEnd(l, r, env.width, env.height) : r];
}

/** Whether `p` is within `HIT` of the drawing's first two points' line as `lineEnds` extends it. */
export const hitLine = (d: ScreenDrawing, p: Point, env: DrawingEnv): boolean => distToSegment(p, ...lineEnds(d, env, ...two(d))) <= HIT;

/** Options for `labelPill`: fill and text colors, which side of the pill `x` marks, and the text style. */
export interface LabelPillOptions {
  /** Pill fill; defaults to the theme drawing color. */
  background?: string;
  /** Text color; defaults to black or white, whichever contrasts more with the fill (`contrastText`). */
  color?: string;
  /** Which side of the pill `x` refers to (default 'left'). */
  align?: 'left' | 'center' | 'right';
  /** Size, weight and slant of the text, and a text color over `color`; usually the drawing's style. */
  textStyle?: DrawingTextStyle;
}

/** Rounded label with its text vertically centered on `y`. Returns the pill width. */
export function labelPill(
  ctx: CanvasRenderingContext2D,
  env: DrawingEnv,
  text: string,
  x: number,
  y: number,
  options: LabelPillOptions = {},
): number {
  const w = pillWidth(env, text, options.textStyle);
  const left = options.align === 'center' ? x - w / 2 : options.align === 'right' ? x - w : x;
  const bg = options.background ?? env.theme.drawing;
  pill(ctx, text, left, y, bg, options.color ?? labelText(bg, env), env, options.textStyle);
  return w;
}

/**
 * Polyline through the drawing's points with an optional label at each point,
 * placed above peaks and below troughs (chart patterns, wave counts).
 */
export function labelledPolyline(
  ctx: CanvasRenderingContext2D,
  d: ScreenDrawing,
  env: DrawingEnv,
  labels: readonly string[] = [],
): void {
  const pts = d.points;
  if (pts.length === 0) return;
  stroke(ctx, d, env);
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.stroke();
  const style = d.drawing.style;
  const color = style.color ?? env.theme.drawing;
  const offset = labelSize(env, style) + 2;
  pts.forEach((p, i) => {
    const text = labels[i];
    if (!text) return;
    const neighbours = [pts[i - 1], pts[i + 1]].filter((q): q is Point => q !== undefined);
    const avg = neighbours.reduce((sum, q) => sum + q.y, 0) / Math.max(1, neighbours.length);
    const above = neighbours.length === 0 || p.y <= avg;
    labelPill(ctx, env, text, p.x, p.y + (above ? -offset : offset), { background: color, align: 'center', textStyle: style });
  });
}

/** One horizontal line drawn by `levelLines`: its pane-local y, color and optional label. */
export interface LevelLine {
  /** Pane-local y. */
  y: number;
  color: string;
  label?: string;
}

/**
 * Horizontal level lines from `left` to `right` with labels on `side` of them
 * (left of `left` by default, or right of `right`), kept on screen and over
 * the lines when there is no room outside. Labels that would overlap the
 * previous one are skipped. Levels should be sorted by `y`. `textStyle` sets
 * the labels' size, weight, slant and text color.
 */
export function levelLines(
  ctx: CanvasRenderingContext2D,
  env: DrawingEnv,
  levels: readonly LevelLine[],
  left: number,
  right: number,
  textStyle: DrawingTextStyle = {},
  side: DrawingStyle['labelSide'] = 'left',
): void {
  for (const l of levels) {
    const y = sharp(l.y);
    ctx.strokeStyle = l.color;
    line(ctx, { x: left, y }, { x: right, y });
  }
  const gap = labelSize(env, textStyle) + 4;
  let last = -Infinity;
  for (const l of levels) {
    if (!l.label || Math.abs(l.y - last) < gap) continue;
    last = l.y;
    const w = pillWidth(env, l.label, textStyle);
    const x = side === 'right' ? Math.max(2, Math.min(right + 6, env.width - w - 2)) : Math.min(Math.max(2, left - w - 6), right - w);
    pill(ctx, l.label, x, l.y, l.color, labelText(l.color, env), env, textStyle);
  }
}

/** Fill the area between two polylines (e.g. a channel or band). */
export function fillBetween(ctx: CanvasRenderingContext2D, upper: readonly Point[], lower: readonly Point[], color: string): void {
  if (upper.length === 0 || lower.length === 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(upper[0]!.x, upper[0]!.y);
  for (let i = 1; i < upper.length; i++) ctx.lineTo(upper[i]!.x, upper[i]!.y);
  for (let i = lower.length - 1; i >= 0; i--) ctx.lineTo(lower[i]!.x, lower[i]!.y);
  ctx.closePath();
  ctx.fill();
}
