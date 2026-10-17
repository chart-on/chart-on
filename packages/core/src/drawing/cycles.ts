import { fillOf, HIT, line, LINE_FIELDS, NO_FILL, stroke, two } from './draw';
import { distToSegment } from './geometry';
import type { Drawing, DrawingModelBounds, DrawingToolDef, ScreenDrawing } from './types';
import { sharp } from '../util/math';

/**
 * Pane-local x of every cycle start within `lo..hi`: `from`, then whole
 * `period`s on from it in the period's direction. Bars are evenly spaced on
 * the time axis, so the starts fall a whole number of bars apart, past the
 * last bar too. A period under a pixel gives just `from`.
 */
export function cycleStarts(from: number, period: number, lo: number, hi: number): number[] {
  if (Math.abs(period) < 1) return [from];
  const [p, q] = [(lo - from) / period, (hi - from) / period];
  const xs: number[] = [];
  for (let k = Math.max(0, Math.ceil(Math.min(p, q))); k <= Math.max(p, q); k++) xs.push(from + k * period);
  return xs;
}

/** From the first anchor towards the second in time, between `low` and `high` in price. */
function forward(d: Drawing, low = -Infinity, high = Infinity): DrawingModelBounds {
  const [a, b] = two(d);
  const dir = b.time - a.time;
  return { from: dir < 0 ? -Infinity : a.time, to: dir > 0 ? Infinity : a.time, low, high };
}

/** Between the two anchors' prices. */
const priceSpan = (d: Drawing): [number, number] => {
  const [a, b] = two(d);
  return [Math.min(a.price, b.price), Math.max(a.price, b.price)];
};

function cycleLines(d: ScreenDrawing, width: number): number[] {
  const [a, b] = two(d);
  return cycleStarts(a.x, b.x - a.x, 0, width);
}

/** Full-height lines repeating at the bar distance between the anchors. */
export const cyclicLines: DrawingToolDef = {
  type: 'cyclic-lines',
  label: 'Cyclic lines',
  group: 'time',
  points: 2,
  // Only the anchors' times matter.
  snap: 'time',
  styleFields: [...LINE_FIELDS],
  modelBounds: (d) => forward(d),
  axisMarks: (d) => ({ times: d.points.map((p) => p.time) }),
  cursor: () => 'ew-resize',
  render(ctx, d, env) {
    stroke(ctx, d, env, 1);
    for (const x of cycleLines(d, env.width)) {
      const px = sharp(x);
      line(ctx, { x: px, y: 0 }, { x: px, y: env.height });
    }
  },
  hitTest: (d, p, env) => cycleLines(d, env.width).some((x) => Math.abs(p.x - x) <= HIT),
};

interface CycleArcs {
  /** Left end of each arc, the baseline's y, half the arc width and its height (negative points down). */
  xs: number[];
  y: number;
  rx: number;
  h: number;
}

/** Half ellipses one cycle wide on the first anchor's y, as high as the second anchor. */
function cycleArcs(d: ScreenDrawing, width: number): CycleArcs {
  const [a, b] = two(d);
  const period = b.x - a.x;
  const rx = Math.abs(period) / 2;
  const xs = cycleStarts(a.x, period, -2 * rx, width + 2 * rx).map((x) => Math.min(x, x + period));
  return { xs, y: a.y, rx, h: a.y - b.y };
}

/** Half ellipses, each one cycle wide, repeating along a baseline at the bar distance between the anchors. */
export const timeCycles: DrawingToolDef = {
  type: 'time-cycles',
  label: 'Time cycles',
  group: 'time',
  points: 2,
  styleFields: [...LINE_FIELDS, 'fill'],
  modelBounds: (d) => forward(d, ...priceSpan(d)),
  render(ctx, d, env) {
    const { xs, y, rx, h } = cycleArcs(d, env.width);
    stroke(ctx, d, env);
    ctx.beginPath();
    for (const x of xs) {
      ctx.moveTo(x, y);
      // Over the top when the second anchor is above the first, else underneath.
      ctx.ellipse(x + rx, y, rx, Math.abs(h), 0, Math.PI, 0, h < 0);
    }
    const fill = fillOf(d.drawing.style, NO_FILL);
    if (fill !== NO_FILL) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.stroke();
  },
  hitTest(d, p, env) {
    const { xs, y, rx, h } = cycleArcs(d, env.width);
    const ry = Math.max(Math.abs(h), 1);
    const dy = p.y - y;
    // Only the arcs' side of the baseline.
    if (dy * h > HIT * Math.abs(h)) return false;
    return xs.some((x) => {
      const dx = p.x - x - rx;
      // Distance to the ellipse, to first order: its implicit function over its gradient.
      const f = (dx / rx) ** 2 + (dy / ry) ** 2 - 1;
      return Math.abs(f) <= 2 * HIT * Math.hypot(dx / rx ** 2, dy / ry ** 2);
    });
  },
};

/** Sine wave with a crest (or trough) at the first anchor and the next trough (or crest) at the second, across the pane. */
export const sineLine: DrawingToolDef = {
  type: 'sine-line',
  label: 'Sine line',
  group: 'time',
  points: 2,
  styleFields: [...LINE_FIELDS],
  modelBounds(d) {
    const [low, high] = priceSpan(d);
    return { from: -Infinity, to: Infinity, low, high };
  },
  render(ctx, d, env) {
    const [a, b] = two(d);
    const half = b.x - a.x;
    stroke(ctx, d, env);
    if (Math.abs(half) < 1) return line(ctx, a, b);
    const step = Math.min(2, Math.abs(half) / 4);
    ctx.beginPath();
    for (let x = 0; x < env.width + step; x += step) {
      const y = (a.y + b.y) / 2 + ((a.y - b.y) / 2) * Math.cos((Math.PI * (x - a.x)) / half);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  },
  hitTest(d, p) {
    const [a, b] = two(d);
    const half = b.x - a.x;
    if (Math.abs(half) < 1) return distToSegment(p, a, b) <= HIT;
    const k = Math.PI / half;
    const amp = (a.y - b.y) / 2;
    const t = k * (p.x - a.x);
    // Vertical distance over the curve's slope: the distance to its tangent.
    return Math.abs(p.y - (a.y + b.y) / 2 - amp * Math.cos(t)) <= HIT * Math.hypot(1, amp * k * Math.sin(t));
  },
};
