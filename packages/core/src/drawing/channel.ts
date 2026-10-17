import type { Point } from '../types';
import { withAlpha } from '../util/color';
import { fillBetween, fillOf, HIT, line, stroke } from './draw';
import { distToSegment } from './geometry';
import { timeSpanBounds } from './model-bounds';
import type { DrawingEnv, DrawingStyle, DrawingToolDef, ScreenDrawing } from './types';

type Segment = [Point, Point];

/**
 * The line through c over the bars of a→b, with the slope of a→b times `k`: 1 for its parallel,
 * 0 for a flat line, -1 for the mirrored slope. Over a vertical a→b it is the vertical through c.
 */
export function sideLine(a: Point, b: Point, c: Point, k: number): Segment {
  const dx = b.x - a.x;
  if (dx === 0) return [{ x: c.x, y: a.y }, { x: c.x, y: b.y }];
  const m = (k * (b.y - a.y)) / dx;
  return [{ x: a.x, y: c.y + m * (a.x - c.x) }, { x: b.x, y: c.y + m * (b.x - c.x) }];
}

/**
 * Offset from the base line a→b to its parallel through c. It is vertical so both lines span the
 * same bars, or horizontal when the base line is vertical.
 */
export function parallelOffset(a: Point, b: Point, c: Point): Point {
  const [p] = sideLine(a, b, c, 1);
  return { x: p.x - a.x, y: p.y - a.y };
}

/**
 * The segment p→q, left end first, carried along its slope to x 0 and
 * `width` on the sides `style` extends. A vertical segment stays as it is.
 */
export function extendSegment(p: Point, q: Point, style: DrawingStyle, width: number): Segment {
  const [l, r] = p.x <= q.x ? [p, q] : [q, p];
  if (l.x === r.x) return [l, r];
  const at = (x: number): Point => ({ x, y: l.y + ((x - l.x) * (r.y - l.y)) / (r.x - l.x) });
  return [style.extendLeft ? at(Math.min(0, l.x)) : l, style.extendRight ? at(Math.max(width, r.x)) : r];
}

/** Opacity of a channel's fill without a `fill` of its own. */
const CHANNEL_ALPHA = 0.12;

const mid = (p: Point, q: Point): Point => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

/** Base line, the side line through the third anchor, and the line halfway between them, extended as the style says. */
function channelLines(d: ScreenDrawing, env: DrawingEnv, k: number): Segment[] {
  const a = d.points[0]!;
  const b = d.points[1] ?? a;
  const side = sideLine(a, b, d.points[2] ?? b, k);
  const lines: Segment[] = [[a, b], side, [mid(a, side[0]), mid(b, side[1])]];
  return lines.map(([p, q]) => extendSegment(p, q, d.drawing.style, env.width));
}

/**
 * A 3-point channel: the line between the first two anchors, a second line through the third
 * anchor over the same bars with the slope scaled by `k` (see `sideLine`), and a fill between.
 * Only the parallel channel (k = 1) has the dashed middle line.
 */
function channel(type: string, label: string, k: number): DrawingToolDef {
  const middle = (d: ScreenDrawing) => k === 1 && d.drawing.style.middleLine !== false;
  return {
    type,
    styleFields: ['color', 'fill', 'lineWidth', 'lineStyle', ...(k === 1 ? ['middleLine'] : []), 'extendLeft', 'extendRight', 'showFill'],
    fillAlpha: CHANNEL_ALPHA,
    label,
    group: 'parallels',
    points: 3,
    // The second line passes the third point, so it may leave the anchors' prices.
    modelBounds: timeSpanBounds,
    render(ctx, d, env) {
      const [base, side, centre] = channelLines(d, env, k);
      const s = d.drawing.style;
      fillBetween(ctx, base!, side!, fillOf(s, withAlpha(s.color ?? env.theme.drawing, CHANNEL_ALPHA)));
      stroke(ctx, d, env);
      line(ctx, ...base!);
      line(ctx, ...side!);
      if (middle(d)) {
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        line(ctx, ...centre!);
      }
    },
    hitTest(d, p, env) {
      const lines = channelLines(d, env, k);
      if (!middle(d)) lines.pop();
      return lines.some(([a, b]) => distToSegment(p, a, b) <= HIT);
    },
  };
}

export const parallelChannel = channel('parallel-channel', 'Parallel channel', 1);

/** A trend line and a flat line at the third anchor's price over the same bars, for flat tops or bottoms. */
export const flatTopBottom = channel('flat-top-bottom', 'Flat top/bottom', 0);

/** A trend line and a line through the third anchor with the mirrored slope, so the channel widens or narrows. */
export const disjointChannel = channel('disjoint-channel', 'Disjoint channel', -1);
