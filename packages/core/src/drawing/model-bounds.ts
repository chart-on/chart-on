import type { Drawing, DrawingModelBounds } from './types';

/** Covers everything: the drawing is never skipped. */
export const OPEN_BOUNDS: DrawingModelBounds = { from: -Infinity, to: Infinity, low: -Infinity, high: Infinity };

/**
 * The box of a drawing's points, open on the sides its `extendLeft` and
 * `extendRight` style extends; the default `modelBounds`.
 */
export function pointBounds(d: Drawing): DrawingModelBounds {
  let from = Infinity;
  let to = -Infinity;
  let low = Infinity;
  let high = -Infinity;
  for (const p of d.points) {
    if (p.time < from) from = p.time;
    if (p.time > to) to = p.time;
    if (p.price < low) low = p.price;
    if (p.price > high) high = p.price;
  }
  if (d.style.extendLeft) from = -Infinity;
  if (d.style.extendRight) to = Infinity;
  return { from, to, low, high };
}

/** `pointBounds` of a line through the first two points, open in price too once a sloped line is extended. */
export function lineBounds(d: Drawing): DrawingModelBounds {
  const box = pointBounds(d);
  const sloped = (d.style.extendLeft || d.style.extendRight) && box.low !== box.high;
  return sloped ? { ...box, low: -Infinity, high: Infinity } : box;
}

/** The points' time span (with extensions) at any price: for tools whose levels or slopes leave the anchors' prices. */
export function timeSpanBounds(d: Drawing): DrawingModelBounds {
  const { from, to } = pointBounds(d);
  return { from, to, low: -Infinity, high: Infinity };
}
