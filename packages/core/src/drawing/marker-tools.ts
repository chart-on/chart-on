import type { Point, Rect } from '../types';
import { withAlpha } from '../util/color';
import { fillLine, fillText } from '../typography';
import { drawingFont, drawingWeight, HIT, labelSize, labelText, line, pillHeight, pillWidth, stroke, TEXT_FIELDS, two } from './draw';
import { distToSegment } from './geometry';
import type { DrawingEnv, DrawingToolDef, ScreenDrawing } from './types';

const inRect = (p: Point, r: Rect, pad = 0): boolean =>
  p.x >= r.x - pad && p.x <= r.x + r.width + pad && p.y >= r.y - pad && p.y <= r.y + r.height + pad;

/* ---------------- Callout and notes ---------------- */

/** Font size of a callout or note without one, as for text drawings. */
const CALLOUT_SIZE = 14;
const CALLOUT_PAD_X = 8;
const CALLOUT_PAD_Y = 6;
/** Line height as a multiple of the font size. */
const CALLOUT_LEADING = 1.3;
/** `styleFields` of the boxed text tools. Text color falls back to `color` as for the text tool, so a recolored box reads as one. */
const BOX_FIELDS: NonNullable<DrawingToolDef['styleFields']> = ['color', 'fill', ...TEXT_FIELDS, 'lineWidth', 'lineStyle'];

/** `lines` of text set in the drawing's font: the font size, line height and the size of the text block. */
interface TextBlock {
  lines: string[];
  size: number;
  lineHeight: number;
  width: number;
  height: number;
}

function textBlock(d: ScreenDrawing, env: DrawingEnv, lines: string[]): TextBlock {
  const s = d.drawing.style;
  const size = s.fontSize ?? CALLOUT_SIZE;
  const lineHeight = size * CALLOUT_LEADING;
  // An empty box (while placing, before the text is typed) keeps a usable size.
  const width = Math.max(size * 3, ...lines.map((t) => env.measureText(t, size, s)));
  return { lines, size, lineHeight, width, height: lines.length * lineHeight + 2 * CALLOUT_PAD_Y };
}

/** The drawing's text, one entry per line. */
const textLines = (d: ScreenDrawing): string[] => (d.drawing.text ?? '').split('\n');

/**
 * Fill the current path opaque (so the text stays readable over the series)
 * and tinted, stroke it, then write the block's lines between `left` and
 * `right` (see `fillLine`), the first line's box starting at `top`.
 */
function paintBox(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, b: TextBlock, left: number, right: number, top: number): void {
  const s = d.drawing.style;
  ctx.fillStyle = env.theme.background;
  ctx.fill();
  ctx.fillStyle = s.fill ?? withAlpha(s.color ?? env.theme.drawing, 0.14);
  ctx.fill();
  ctx.stroke();
  ctx.font = drawingFont(b.size, env.theme.fontFamily, s, drawingWeight(env));
  ctx.fillStyle = s.textColor ?? s.color ?? env.theme.drawingSelected;
  ctx.textBaseline = 'middle';
  b.lines.forEach((t, i) => fillLine(ctx, t, left, right, top + b.lineHeight * (i + 0.5)));
}

/** A text block's box, centered on the drawing's second point. */
function centeredBox(d: ScreenDrawing, b: TextBlock): Rect {
  const width = b.width + 2 * CALLOUT_PAD_X;
  const c = d.points[1] ?? d.points[0]!;
  return { x: c.x - width / 2, y: c.y - b.height / 2, width, height: b.height };
}

const centerOf = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** Radius of the dot marking a price note's anchor. */
const DOT = 2.5;

/** Two-point tools whose box of `lines` sits on the second point, joined to the anchor at the first by a line. */
function boxedText(
  type: string,
  label: string,
  editableText: DrawingToolDef['editableText'],
  lines: (d: ScreenDrawing, env: DrawingEnv) => string[],
  dot = false,
): DrawingToolDef {
  const layout = (d: ScreenDrawing, env: DrawingEnv) => {
    const b = textBlock(d, env, lines(d, env));
    return { b, box: centeredBox(d, b) };
  };
  // No spread of a parameter here: bundlers would then keep these tools in apps that never register them.
  return {
    type,
    label,
    editableText,
    group: 'annotate',
    points: 2,
    defaultStyle: { fontSize: CALLOUT_SIZE },
    styleFields: BOX_FIELDS,
    bounds: (d, env) => layout(d, env).box,
    render(ctx, d, env) {
      const { b, box } = layout(d, env);
      const a = d.points[0]!;
      stroke(ctx, d, env);
      line(ctx, a, centerOf(box));
      if (dot) {
        ctx.beginPath();
        ctx.arc(a.x, a.y, DOT, 0, 2 * Math.PI);
        ctx.fillStyle = d.drawing.style.color ?? env.theme.drawing;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.width, box.height, 4);
      paintBox(ctx, d, env, b, box.x + CALLOUT_PAD_X, box.x + box.width - CALLOUT_PAD_X, box.y + CALLOUT_PAD_Y);
    },
    hitTest(d, p, env) {
      const { box } = layout(d, env);
      return inRect(p, box, HIT / 2) || distToSegment(p, d.points[0]!, centerOf(box)) <= HIT;
    },
  };
}

/**
 * Text in a box joined to an anchor: the first point is the anchor, the
 * second the center of the box. The box is opaque so the text stays
 * readable over the series; `\n` in the text starts a new line.
 */
export const callout: DrawingToolDef = boxedText('callout', 'Callout', true, textLines);

/**
 * A note on a price level: the first point is the anchor, marked with a dot,
 * the second the center of the note. The note shows the anchor's price, which
 * follows it when dragged, above the drawing's optional text.
 */
export const priceNote: DrawingToolDef = boxedText(
  'price-note',
  'Price note',
  'optional',
  (d, env) => [env.formatPrice(d.drawing.points[0]!.price), ...(d.drawing.text ? textLines(d) : [])],
  true,
);

/** One-point tools: editable text in a box whose top-left corner is the point. */
function noteTool(type: string, label: string, anchoring: DrawingToolDef['anchoring']): DrawingToolDef {
  const layout = (d: ScreenDrawing, env: DrawingEnv) => {
    const b = textBlock(d, env, textLines(d));
    const a = d.points[0]!;
    return { b, box: { x: a.x, y: a.y, width: b.width + 2 * CALLOUT_PAD_X, height: b.height } };
  };
  return {
    type,
    label,
    group: 'annotate',
    points: 1,
    editableText: true,
    anchoring,
    defaultStyle: { fontSize: CALLOUT_SIZE },
    styleFields: BOX_FIELDS,
    bounds: (d, env) => layout(d, env).box,
    render(ctx, d, env) {
      const { b, box } = layout(d, env);
      stroke(ctx, d, env);
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.width, box.height, 4);
      paintBox(ctx, d, env, b, box.x + CALLOUT_PAD_X, box.x + box.width - CALLOUT_PAD_X, box.y + CALLOUT_PAD_Y);
    },
    hitTest: (d, p, env) => inRect(p, layout(d, env).box, HIT / 2),
  };
}

/** Editable text in a box at a time and price. */
export const note = noteTool('note', 'Note', 'data');
/** A note pinned to the pane: it stays put while the chart scrolls and zooms. */
export const anchoredNote = noteTool('anchored-note', 'Anchored note', 'screen');

/** Height of a bubble's tail, from its point to the bubble, and the width where it joins the bubble, in css px. */
const TAIL = 10;
const TAIL_BASE = 10;

/**
 * A speech bubble above its point, its tail touching the point. A rounded
 * bubble is centered on the point; a square one starts just left of it, its
 * tail rising straight up from the point.
 */
function bubble(d: ScreenDrawing, env: DrawingEnv, round: boolean): { b: TextBlock; box: Rect; radius: number; tail: [number, number]; padX: number } {
  const a = d.points[0]!;
  const b = textBlock(d, env, textLines(d));
  // A rounded bubble keeps its text and its tail on the straight part of its edges.
  const radius = round ? b.height / 2 : 4;
  const padX = round ? radius : CALLOUT_PAD_X;
  const width = Math.max(b.width + 2 * padX, 2 * radius + TAIL_BASE + 4);
  const x = round ? a.x - width / 2 : a.x - CALLOUT_PAD_X;
  const tail: [number, number] = round ? [a.x - TAIL_BASE / 2, a.x + TAIL_BASE / 2] : [a.x, a.x + TAIL_BASE];
  return { b, box: { x, y: a.y - TAIL - b.height, width, height: b.height }, radius, tail, padX };
}

/** One-point bubble tools: editable text in a bubble pointing down at the point. */
function bubbleTool(type: string, label: string, round: boolean): DrawingToolDef {
  return {
    type,
    label,
    group: 'annotate',
    points: 1,
    editableText: true,
    defaultStyle: { fontSize: CALLOUT_SIZE },
    styleFields: BOX_FIELDS,
    bounds(d, env) {
      const { box } = bubble(d, env, round);
      return { ...box, height: box.height + TAIL };
    },
    render(ctx, d, env) {
      const a = d.points[0]!;
      const { b, box, radius: r, tail, padX } = bubble(d, env, round);
      const right = box.x + box.width;
      const bottom = box.y + box.height;
      stroke(ctx, d, env);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(box.x + r, box.y);
      ctx.arcTo(right, box.y, right, bottom, r);
      ctx.arcTo(right, bottom, box.x, bottom, r);
      ctx.lineTo(tail[1], bottom);
      ctx.lineTo(a.x, a.y);
      ctx.lineTo(tail[0], bottom);
      ctx.arcTo(box.x, bottom, box.x, box.y, r);
      ctx.arcTo(box.x, box.y, right, box.y, r);
      ctx.closePath();
      paintBox(ctx, d, env, b, box.x + padX, right - padX, box.y + CALLOUT_PAD_Y);
    },
    hitTest(d, p, env) {
      const a = d.points[0]!;
      const { box, tail } = bubble(d, env, round);
      return inRect(p, box, HIT / 2) || distToSegment(p, a, { x: (tail[0] + tail[1]) / 2, y: box.y + box.height }) <= HIT / 2;
    },
  };
}

/** Editable text in a square speech bubble above its point. */
export const comment = bubbleTool('comment', 'Comment', false);
/** Editable text in a rounded speech bubble centered above its point. */
export const balloon = bubbleTool('balloon', 'Balloon', true);

/* ---------------- Price label ---------------- */

/** The price label's tag: the tip at the anchor, the body to its right. */
function priceTag(d: ScreenDrawing, env: DrawingEnv): { text: string; tip: number; box: Rect } {
  const a = d.points[0]!;
  const s = d.drawing.style;
  const text = env.formatPrice(d.drawing.points[0]!.price);
  const height = pillHeight(env, s);
  const tip = height / 2;
  return { text, tip, box: { x: a.x + tip, y: a.y - height / 2, width: pillWidth(env, text, s), height } };
}

/** The price at its anchor, in a tag that points at it. The price follows the anchor when dragged. */
export const priceLabel: DrawingToolDef = {
  type: 'price-label',
  label: 'Price label',
  group: 'annotate',
  points: 1,
  styleFields: ['color', ...TEXT_FIELDS],
  bounds(d, env) {
    const { tip, box } = priceTag(d, env);
    return { ...box, x: box.x - tip, width: box.width + tip };
  },
  render(ctx, d, env) {
    const a = d.points[0]!;
    const s = d.drawing.style;
    const { text, box } = priceTag(d, env);
    ctx.setLineDash([]);
    ctx.fillStyle = s.color ?? env.theme.drawing;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(box.x, box.y);
    ctx.lineTo(box.x + box.width - 3, box.y);
    ctx.arcTo(box.x + box.width, box.y, box.x + box.width, box.y + 3, 3);
    ctx.lineTo(box.x + box.width, box.y + box.height - 3);
    ctx.arcTo(box.x + box.width, box.y + box.height, box.x + box.width - 3, box.y + box.height, 3);
    ctx.lineTo(box.x, box.y + box.height);
    ctx.closePath();
    ctx.fill();
    ctx.font = drawingFont(labelSize(env, s), env.theme.fontFamily, s, drawingWeight(env));
    ctx.fillStyle = s.textColor ?? labelText(s.color ?? env.theme.drawing, env);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    fillText(ctx, text, box.x + 5, a.y + 0.5);
  },
  hitTest(d, p, env) {
    const { tip, box } = priceTag(d, env);
    return inRect(p, { ...box, x: box.x - tip, width: box.width + tip }, HIT / 2);
  },
};

/* ---------------- Arrows ---------------- */

/** Half widths of an arrow's head and shaft, and the head length, in css px. */
const HEAD_HALF = 9;
const SHAFT_HALF = 3.5;
const HEAD = 16;
/** Length of a one-point arrow, tip to tail. */
const GLYPH = 24;

/**
 * Fill a block arrow pointing along the unit vector `u`, its tip at `tip` and
 * its tail `length` px behind. A short arrow is all head.
 */
function blockArrow(ctx: CanvasRenderingContext2D, tip: Point, u: Point, length: number): void {
  const head = Math.min(HEAD, length);
  const n = { x: -u.y, y: u.x };
  const at = (along: number, side: number) => ({ x: tip.x - u.x * along + n.x * side, y: tip.y - u.y * along + n.y * side });
  const outline = [
    at(0, 0),
    at(head, HEAD_HALF),
    at(head, SHAFT_HALF),
    at(length, SHAFT_HALF),
    at(length, -SHAFT_HALF),
    at(head, -SHAFT_HALF),
    at(head, -HEAD_HALF),
  ];
  ctx.beginPath();
  ctx.moveTo(outline[0]!.x, outline[0]!.y);
  for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i]!.x, outline[i]!.y);
  ctx.closePath();
  ctx.fill();
}

/** Arrow from the first point to the second, filled with the drawing color. */
export const arrowMarker: DrawingToolDef = {
  type: 'arrow-marker',
  label: 'Arrow marker',
  group: 'annotate',
  points: 2,
  styleFields: ['color'],
  // The head is wider than the segment between the anchors.
  bounds(d) {
    const a = d.points[0]!;
    const b = d.points[1] ?? a;
    const x = Math.min(a.x, b.x) - HEAD_HALF;
    const y = Math.min(a.y, b.y) - HEAD_HALF;
    return { x, y, width: Math.abs(b.x - a.x) + 2 * HEAD_HALF, height: Math.abs(b.y - a.y) + 2 * HEAD_HALF };
  },
  render(ctx, d, env) {
    const a = d.points[0]!;
    const b = d.points[1] ?? a;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1) return;
    ctx.fillStyle = d.drawing.style.color ?? env.theme.drawing;
    blockArrow(ctx, b, { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, length);
  },
  hitTest: (d, p) => distToSegment(p, ...two(d)) <= HEAD_HALF,
};

/**
 * A fixed-size arrow whose tip touches its point, pointing along `u` (screen y
 * grows down). Up and down arrows take the theme's up and down colors
 * (`themeColor`), so they read as rising and falling in any theme.
 */
function glyphArrow(type: string, label: string, u: Point, themeColor?: 'up' | 'down'): DrawingToolDef {
  // The box the arrow covers: it lies behind the tip, `GLYPH` long and `2 * HEAD_HALF` wide.
  const box = (a: Point): Rect => {
    const x0 = a.x - u.x * GLYPH;
    const y0 = a.y - u.y * GLYPH;
    const across = { x: Math.abs(u.y) * HEAD_HALF, y: Math.abs(u.x) * HEAD_HALF };
    const left = Math.min(a.x, x0) - across.x;
    const top = Math.min(a.y, y0) - across.y;
    return { x: left, y: top, width: Math.abs(x0 - a.x) + 2 * across.x, height: Math.abs(y0 - a.y) + 2 * across.y };
  };
  return {
    type,
    label,
    group: 'annotate',
    points: 1,
    themeColor,
    styleFields: ['color'],
    bounds: (d) => box(d.points[0]!),
    render(ctx, d, env) {
      ctx.fillStyle = d.drawing.style.color ?? env.theme[themeColor ?? 'drawing'];
      blockArrow(ctx, d.points[0]!, u, GLYPH);
    },
    hitTest: (d, p) => inRect(p, box(d.points[0]!), HIT / 2),
  };
}

export const arrowUp = /* @__PURE__ */ glyphArrow('arrow-up', 'Arrow up', { x: 0, y: -1 }, 'up');
export const arrowDown = /* @__PURE__ */ glyphArrow('arrow-down', 'Arrow down', { x: 0, y: 1 }, 'down');
export const arrowLeft = /* @__PURE__ */ glyphArrow('arrow-left', 'Arrow left', { x: -1, y: 0 });
export const arrowRight = /* @__PURE__ */ glyphArrow('arrow-right', 'Arrow right', { x: 1, y: 0 });

/* ---------------- Flag ---------------- */

/** Height of the flag's pole and depth of the notch in its cloth, in css px. */
const POLE = 30;
const NOTCH = 5;

/** The flag's cloth, hung from the top of the pole: as wide as its text, a small square without. */
function flagCloth(d: ScreenDrawing, env: DrawingEnv): Rect {
  const a = d.points[0]!;
  const s = d.drawing.style;
  const text = d.drawing.text;
  const height = pillHeight(env, s);
  return { x: a.x, y: a.y - POLE, width: (text ? pillWidth(env, text, s) : height) + NOTCH, height };
}

/**
 * A flag on a pole standing on its point, which snaps to a bar like the other
 * markers. The drawing's optional `text`, asked for after placing and on
 * double click, is written on the cloth.
 */
export const flag: DrawingToolDef = {
  type: 'flag',
  label: 'Flag',
  group: 'annotate',
  points: 1,
  editableText: 'optional',
  styleFields: ['color', ...TEXT_FIELDS],
  bounds: (d, env) => ({ ...flagCloth(d, env), height: POLE }),
  render(ctx, d, env) {
    const a = d.points[0]!;
    const s = d.drawing.style;
    const box = flagCloth(d, env);
    const right = box.x + box.width;
    const mid = box.y + box.height / 2;
    ctx.setLineDash([]);
    ctx.strokeStyle = ctx.fillStyle = s.color ?? env.theme.drawing;
    ctx.lineWidth = 2;
    line(ctx, a, box);
    ctx.beginPath();
    ctx.moveTo(box.x, box.y);
    ctx.lineTo(right, box.y);
    ctx.lineTo(right - NOTCH, mid);
    ctx.lineTo(right, box.y + box.height);
    ctx.lineTo(box.x, box.y + box.height);
    ctx.fill();
    if (!d.drawing.text) return;
    ctx.font = drawingFont(labelSize(env, s), env.theme.fontFamily, s, drawingWeight(env));
    ctx.fillStyle = s.textColor ?? labelText(s.color ?? env.theme.drawing, env);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    fillText(ctx, d.drawing.text, box.x + 5, mid + 0.5);
  },
  hitTest(d, p, env) {
    const a = d.points[0]!;
    return inRect(p, flagCloth(d, env), HIT / 2) || distToSegment(p, a, { x: a.x, y: a.y - POLE }) <= HIT / 2;
  },
};

/* ---------------- Signpost ---------------- */

/** Height of the signpost's post, from its point to the middle of the sign, and the radius of its foot, in css px. */
const POST = 36;
const FOOT = 2.5;

/** The sign on top of the post, centered on it: a rounded pill around the text, a round knob without. */
function signBox(d: ScreenDrawing, env: DrawingEnv): Rect {
  const a = d.points[0]!;
  const s = d.drawing.style;
  const text = d.drawing.text;
  const height = pillHeight(env, s);
  const width = text ? pillWidth(env, text, s) : height;
  return { x: a.x - width / 2, y: a.y - POST - height / 2, width, height };
}

/**
 * A sign on a post standing on its point, with a dot at its foot; the point
 * snaps to a bar like the other markers. The drawing's optional `text`, asked
 * for after placing and on double click, is written on the sign.
 */
export const signpost: DrawingToolDef = {
  type: 'signpost',
  label: 'Signpost',
  group: 'annotate',
  points: 1,
  editableText: 'optional',
  styleFields: ['color', ...TEXT_FIELDS],
  bounds(d, env) {
    const box = signBox(d, env);
    return { ...box, height: POST + box.height / 2 + FOOT };
  },
  render(ctx, d, env) {
    const a = d.points[0]!;
    const s = d.drawing.style;
    const box = signBox(d, env);
    ctx.setLineDash([]);
    ctx.strokeStyle = ctx.fillStyle = s.color ?? env.theme.drawing;
    ctx.lineWidth = 2;
    line(ctx, a, { x: a.x, y: box.y + box.height });
    ctx.beginPath();
    ctx.arc(a.x, a.y, FOOT, 0, 2 * Math.PI);
    ctx.roundRect(box.x, box.y, box.width, box.height, box.height / 2);
    ctx.fill();
    if (!d.drawing.text) return;
    ctx.font = drawingFont(labelSize(env, s), env.theme.fontFamily, s, drawingWeight(env));
    ctx.fillStyle = s.textColor ?? labelText(s.color ?? env.theme.drawing, env);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    fillText(ctx, d.drawing.text, a.x, box.y + box.height / 2 + 0.5);
  },
  hitTest(d, p, env) {
    const a = d.points[0]!;
    const box = signBox(d, env);
    return inRect(p, box, HIT / 2) || distToSegment(p, a, { x: a.x, y: box.y + box.height }) <= HIT / 2;
  },
};
