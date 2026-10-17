import type { Point, Rect } from '../types';
import { withAlpha } from '../util/color';
import { line } from './draw';
import type { Drawing, DrawingEnv, DrawingStyle, DrawingToolDef, ScreenDrawing } from './types';

/** The range the size handle keeps a glyph's size to, in css px. */
const MIN_SIZE = 8;
const MAX_SIZE = 512;
/** Padding of the box around the glyph, and how far above the box the rotation handle stands, in css px. */
const PAD = 3;
const STEM = 18;

/** Width and height of a drawing's glyph per px of its size. */
export type GlyphExtent = (drawing: Drawing, env: DrawingEnv) => readonly [number, number];

/** The glyph's box around its centre `c`: half width and height (padding included) and its rotation. */
interface Frame {
  c: Point;
  w: number;
  h: number;
  rad: number;
  cos: number;
  sin: number;
}

function frame(drawing: Drawing, c: Point, env: DrawingEnv, extent: GlyphExtent, size: number): Frame {
  const { fontSize = size, angle = 0 } = drawing.style;
  const [ex, ey] = extent(drawing, env);
  const rad = (angle * Math.PI) / 180;
  return { c, w: (fontSize * ex) / 2 + PAD, h: (fontSize * ey) / 2 + PAD, rad, cos: Math.cos(rad), sin: Math.sin(rad) };
}

/** The pane point at `(x, y)` in the box's rotated coordinates, from its centre. */
const turn = (f: Frame, x: number, y: number): Point => ({ x: f.c.x + x * f.cos - y * f.sin, y: f.c.y + x * f.sin + y * f.cos });

/**
 * A one-point tool drawing a glyph centred on its point at a fixed size in
 * css px (`fontSize`, default `size`) and angle (`angle`, degrees
 * clockwise), so it reads the same at any zoom. While selected, a corner
 * handle sets the size and a handle above the glyph the angle. `draw` paints
 * the glyph centred on the origin of the turned context, `w` and `h` px to
 * each side. The drawing's `text` is its payload, prompted after placing.
 */
export function glyphTool(
  type: string,
  label: string,
  size: number,
  styleFields: readonly string[],
  extent: GlyphExtent,
  draw: (ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, w: number, h: number) => void,
): DrawingToolDef {
  const at = (d: ScreenDrawing, env: DrawingEnv) => frame(d.drawing, d.points[0]!, env, extent, size);
  return {
    type,
    label,
    group: 'annotate',
    points: 1,
    editableText: true,
    defaultStyle: { fontSize: size },
    styleFields,
    settings: [{ key: 'angle', label: 'Angle', type: 'number', min: -180, max: 180, step: 1 }],
    render(ctx, d, env) {
      const f = at(d, env);
      ctx.save();
      ctx.translate(f.c.x, f.c.y);
      ctx.rotate(f.rad);
      draw(ctx, d, env, f.w - PAD, f.h - PAD);
      if (d.selected || d.hovered) {
        ctx.strokeStyle = withAlpha(env.theme.drawing, 0.6);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(-f.w, -f.h, f.w * 2, f.h * 2);
        if (d.selected) line(ctx, { x: 0, y: -f.h }, { x: 0, y: -f.h - STEM });
      }
      ctx.restore();
    },
    hitTest(d, p, env) {
      const f = at(d, env);
      const dx = p.x - f.c.x;
      const dy = p.y - f.c.y;
      return Math.abs(dx * f.cos + dy * f.sin) <= f.w && Math.abs(dy * f.cos - dx * f.sin) <= f.h;
    },
    bounds(d, env): Rect {
      const f = at(d, env);
      const x = Math.abs(f.cos) * f.w + Math.abs(f.sin) * f.h;
      const y = Math.abs(f.sin) * f.w + Math.abs(f.cos) * f.h;
      return { x: f.c.x - x, y: f.c.y - y, width: x * 2, height: y * 2 };
    },
    // The size handle on the lower right corner, the rotation handle above the top edge.
    handles: (d, env) => {
      const f = at(d, env);
      return [turn(f, f.w, f.h), turn(f, 0, -f.h - STEM)];
    },
    // The handles follow the pointer itself (`at`), not a point snapped to bars.
    moveHandle(drawing, index, _to, p, env) {
      const a = drawing.points[0]!;
      const f = frame(drawing, { x: env.timeToX(a.time), y: env.priceToY(a.price) }, env, extent, size);
      const dx = p.x - f.c.x;
      const dy = p.y - f.c.y;
      const style: DrawingStyle = drawing.style;
      if (index) {
        // Up from the centre is no rotation; round to whole degrees in -180..179.
        style.angle = ((Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90) + 540) % 360) - 180;
      } else {
        // The size that puts the box's corner nearest the pointer along the line the corner moves on as the size changes.
        const [ex, ey] = extent(drawing, env);
        const x = dx * f.cos + dy * f.sin - PAD;
        const y = dy * f.cos - dx * f.sin - PAD;
        const fit = (2 * (x * ex + y * ey)) / (ex * ex + ey * ey);
        style.fontSize = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, fit)));
      }
      return { style };
    },
    cursor: (_d, part) => (part.kind === 'handle' ? (part.index ? 'grab' : 'nwse-resize') : undefined),
  };
}
