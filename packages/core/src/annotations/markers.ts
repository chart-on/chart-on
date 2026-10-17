import type { Pane } from '../pane';
import type { Series } from '../series';
import type { ChartTheme } from '../theme';
import { lowerBound, type Timeline } from '../timeline';
import { fillText } from '../typography';
import type { Point, Time } from '../types';
import { contrastText } from '../util/color';
import { devWarn, isDev } from '../util/dev';
import { decodeImage } from '../util/image-size';
import type { BarMarker, MarkerClusterOptions, MarkerFilter, MarkerPosition, MarkerShape } from './types';
import { isText } from '../util/records';
import { clampNum } from '../util/math';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Space between the bar and the first marker. */
const BAR_GAP = 4;
/** Space between stacked markers. */
const STACK_GAP = 3;
/** Space between a shape and its text. */
const TEXT_GAP = 2;
/** Space between a side text (inside and price markers) and its shape. */
const SIDE_GAP = 4;
/** Horizontal padding of a `label` box. */
const LABEL_PAD = 4;
/** Pointer distance (css px) around a marker that still hits it. */
const HIT_SLOP = 2;
/** Members listed in a cluster's tooltip before `+N more`. */
const CLUSTER_ROWS = 8;

export interface MarkerLayoutEnv {
  timeline: Timeline;
  /** Lowest and highest price the series draws at a bar index, or null when it has no value there. */
  rangeAt(index: number): [number, number] | null;
  /** Chart-space y of a price on the series' scale. */
  priceToY(price: number): number;
  /** What an `atPrice` marker's price at `time` draws multiplied by (an adjustment mode); default 1. */
  priceFactor?(time: Time): number;
  /** Chart-space y of the pane's top and bottom edges, for the `top` and `bottom` lanes. */
  top: number;
  bottom: number;
  indexToX(index: number): number;
  barSpacing: number;
  fontSize: number;
  /** Width of `text` in the theme font. Default: an estimate from the font size. */
  measureText?(text: string): number;
}

/** A laid-out marker in chart-space css px. Boxes are pooled and reused between frames. */
export interface MarkerBox {
  marker: BarMarker;
  /** Centre of the shape. */
  x: number;
  y: number;
  /** Height of the shape; also its width, except for a `label`. */
  size: number;
  /** Width of the shape (of the box, for a `label`). */
  width: number;
  /** Text anchor and alignment; `textY` is null without separate text (a `label` draws its text inside). */
  textX: number;
  textY: number | null;
  align: 'left' | 'right' | 'center';
  /** Extent of the shape and its text: what draws and what the pointer hits. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Set by the owner of the pool: whose marker this is. */
  series: Series | null;
  pane: Pane | null;
}

/** Boxes reused from frame to frame, so laying out allocates nothing once warm. */
export class MarkerPool {
  readonly boxes: MarkerBox[] = [];
  used = 0;

  reset(): void {
    this.used = 0;
  }

  /** The next free box. */
  take(marker: BarMarker): MarkerBox {
    let b = this.boxes[this.used];
    if (!b) {
      b = { marker, x: 0, y: 0, size: 0, width: 0, textX: 0, textY: null, align: 'center', left: 0, right: 0, top: 0, bottom: 0, series: null, pane: null };
      this.boxes[this.used] = b;
    }
    b.marker = marker;
    this.used++;
    return b;
  }
}

/**
 * Index of the bar containing `time`: an exact bar time, or the last bar that
 * starts before it (the newest bar covers one interval). -1 outside the data.
 */
export function barIndexOf(timeline: Timeline, time: Time): number {
  const times = timeline.times;
  if (times.length === 0) return -1;
  const i = lowerBound(times, time);
  if (times[i] === time) return i;
  if (i === 0) return -1;
  if (i === times.length && time >= times[i - 1]! + timeline.interval) return -1;
  return i - 1;
}

export function markerPosition(m: BarMarker): MarkerPosition {
  return m.position ?? (pointsUp(m.shape) ? 'below' : 'above');
}

export function markerSize(m: BarMarker, barSpacing: number): number {
  return clampNum(barSpacing * 0.8, 8, 14) * (m.size ?? 1);
}

/** Throws for a marker the layer cannot place. */
export function checkMarker(m: BarMarker): void {
  if (!Number.isFinite(m.time)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Marker time must be a finite number' : '');
  if (m.position === 'atPrice' && !Number.isFinite(m.price)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'An atPrice marker needs a finite price' : '');
  if (m.id !== undefined && !isText(m.id)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Marker id must be a non-empty string' : '');
  if (m.severity !== undefined && m.severity !== 1 && m.severity !== 2 && m.severity !== 3) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Marker severity must be 1, 2 or 3' : '');
  const icon = m.icon as { svgPath?: unknown; image?: unknown } | undefined;
  if (icon && typeof icon.svgPath !== 'string' && !icon.image) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'A marker icon needs an svgPath or an image' : '');
}

/**
 * The markers to lay out: those passing `filter`, with each crowded group
 * (one bar, kind and position, more than `maxPerBar`) folded into one marker
 * in place of its first member. That marker copies the first member with the
 * count as its text and the members in its tooltip; `members` maps it to
 * them. Bars come from `timeline`, so a new interval regroups. `atPrice`
 * markers keep their prices and never fold.
 */
export function foldMarkers(
  markers: readonly BarMarker[],
  timeline: Timeline,
  filter: MarkerFilter,
  cluster: MarkerClusterOptions,
  members: { set(marker: BarMarker, group: BarMarker[]): unknown },
): BarMarker[] {
  const kinds = filter.kinds;
  const min = filter.minSeverity ?? 1;
  const kept = markers.filter((m) => (m.kind === undefined || !kinds || kinds.includes(m.kind)) && (m.severity ?? 3) >= min);
  if (!cluster.enabled) return kept;
  const out: BarMarker[] = [];
  const groups = new Map<string, BarMarker[]>();
  const key = (m: BarMarker) => markerPosition(m) + (m.kind === undefined ? '' : ':' + m.kind);
  for (let i = 0; i < kept.length; ) {
    const index = barIndexOf(timeline, kept[i]!.time);
    let j = i + 1;
    while (j < kept.length && barIndexOf(timeline, kept[j]!.time) === index) j++;
    groups.clear();
    for (let k = i; k < j && index >= 0; k++) {
      const m = kept[k]!;
      if (markerPosition(m) === 'atPrice') continue;
      const g = groups.get(key(m));
      if (g) g.push(m);
      else groups.set(key(m), [m]);
    }
    for (let k = i; k < j; k++) {
      const m = kept[k]!;
      const g = groups.get(key(m));
      if (!g || g.length <= cluster.maxPerBar || markerPosition(m) === 'atPrice') out.push(m);
      else if (g[0] === m) {
        const folded = clusterMarker(g);
        members.set(folded, g);
        out.push(folded);
      }
    }
    i = j;
  }
  return out;
}

function clusterMarker(group: BarMarker[]): BarMarker {
  const { id: _id, ...first } = group[0]!;
  const rows = group.slice(0, CLUSTER_ROWS).map((m) => m.text || (Array.isArray(m.tooltip) ? m.tooltip[0] : m.tooltip) || m.kind || m.shape);
  if (group.length > CLUSTER_ROWS) rows.push(`+${group.length - CLUSTER_ROWS} more`);
  return { ...first, text: String(group.length), tooltip: rows };
}

/**
 * Place markers on their bars. `markers` must be sorted by time. Markers that
 * share a bar and position stack outwards from the bar in input order, in
 * pixel space, so they never overlap whatever the price scale mode. A fresh
 * array per call: for tests and one-off use; the chart uses `placeMarkers`.
 */
export function layoutMarkers(markers: readonly BarMarker[], env: MarkerLayoutEnv): MarkerBox[] {
  const pool = new MarkerPool();
  placeMarkers(markers, 0, markers.length, env, pool);
  return pool.boxes.slice(0, pool.used);
}

/** Lay out `markers[from..to)` into `pool` after the boxes already there. */
export function placeMarkers(markers: readonly BarMarker[], from: number, to: number, env: MarkerLayoutEnv, pool: MarkerPool): void {
  let i = from;
  while (i < to) {
    const index = barIndexOf(env.timeline, markers[i]!.time);
    let j = i + 1;
    while (j < to && barIndexOf(env.timeline, markers[j]!.time) === index) j++;
    if (index >= 0) stackBar(markers, i, j, index, env, pool);
    i = j;
  }
}

/** The topmost box in `pool[start..end)` under `p`, or null. Boxes with a pane are clipped to it, as drawn. */
export function markerAt(pool: MarkerPool, p: Point, start = 0, end = pool.used): MarkerBox | null {
  for (let i = end - 1; i >= start; i--) {
    const b = pool.boxes[i]!;
    if (b.pane && (p.y < b.pane.top || p.y > b.pane.top + b.pane.height)) continue;
    if (p.x >= b.left - HIT_SLOP && p.x <= b.right + HIT_SLOP && p.y >= b.top - HIT_SLOP && p.y <= b.bottom + HIT_SLOP) return b;
  }
  return null;
}

function stackBar(markers: readonly BarMarker[], start: number, end: number, index: number, env: MarkerLayoutEnv, pool: MarkerPool): void {
  const x = env.indexToX(index);
  const fs = env.fontSize;
  const first = pool.used;
  // Price-anchored markers need no bar value; the others are placed against the bar's range.
  const range = needsRange(markers, start, end) ? env.rangeAt(index) : null;
  const yHigh = range ? env.priceToY(range[1]) : 0;
  const yLow = range ? env.priceToY(range[0]) : 0;
  let above = Math.min(yHigh, yLow) - BAR_GAP;
  let below = Math.max(yHigh, yLow) + BAR_GAP;
  // Lanes stack inwards from the pane's edges.
  let top = env.top + BAR_GAP;
  let bottom = env.bottom - BAR_GAP;
  // Inside markers form one column centred on the middle of the bar.
  let insideHeight = -STACK_GAP;
  for (let k = start; k < end; k++) {
    const m = markers[k]!;
    if (markerPosition(m) === 'inside') insideHeight += shapeHeight(m, env) + STACK_GAP;
  }
  let inside = (yHigh + yLow) / 2 - insideHeight / 2;

  for (let k = start; k < end; k++) {
    const m = markers[k]!;
    const position = markerPosition(m);
    if (!range && !freePosition(position)) continue;
    const size = shapeHeight(m, env);
    const width = shapeWidth(m, env);
    const textW = sideText(m) ? measure(env, m.text!) : 0;
    const b = pool.take(m);
    b.size = size;
    b.width = width;
    b.x = x;
    b.textY = null;
    b.align = 'center';
    const textHeight = textW > 0 ? TEXT_GAP + fs : 0;
    switch (position) {
      case 'above':
        above = stackUp(b, above, size, textHeight, fs);
        break;
      case 'bottom':
        bottom = stackUp(b, bottom, size, textHeight, fs);
        break;
      case 'below':
        below = stackDown(b, below, size, textHeight, fs);
        break;
      case 'top':
        top = stackDown(b, top, size, textHeight, fs);
        break;
      case 'inside': {
        b.y = inside + size / 2;
        // Text sits to the right of the shape, so it adds no height.
        b.top = inside;
        b.bottom = inside + size;
        inside += size + STACK_GAP;
        break;
      }
      case 'atPrice':
        b.y = env.priceToY(m.price! * (env.priceFactor?.(m.time) ?? 1));
        b.top = b.y - Math.max(size, textW > 0 ? fs : 0) / 2;
        b.bottom = b.y + Math.max(size, textW > 0 ? fs : 0) / 2;
        break;
    }
    if (position !== 'inside' && position !== 'atPrice') {
      const half = Math.max(width, textW) / 2;
      b.textX = x;
      b.left = x - half;
      b.right = x + half;
    } else {
      placeSideways(b, position === 'atPrice', textW, pool, first);
    }
  }
}

/** Shape with its text above it, its bottom at `edge`; returns the next edge up. */
function stackUp(b: MarkerBox, edge: number, size: number, textHeight: number, fs: number): number {
  b.y = edge - size / 2;
  b.top = edge - size - textHeight;
  b.bottom = edge;
  if (textHeight > 0) b.textY = edge - size - TEXT_GAP - fs / 2;
  return b.top - STACK_GAP;
}

/** Shape with its text below it, its top at `edge`; returns the next edge down. */
function stackDown(b: MarkerBox, edge: number, size: number, textHeight: number, fs: number): number {
  b.y = edge + size / 2;
  b.top = edge;
  b.bottom = edge + size + textHeight;
  if (textHeight > 0) b.textY = edge + size + TEXT_GAP + fs / 2;
  return b.bottom + STACK_GAP;
}

/** Placed without the bar's value: at a price or in a lane. */
function freePosition(p: MarkerPosition): boolean {
  return p === 'atPrice' || p === 'top' || p === 'bottom';
}

/**
 * Horizontal extent of an inside or price marker, its text on the far side
 * from the bar. Price markers on one bar keep their price and fan out
 * sideways, away from the bar, past the earlier ones they would overlap.
 */
function placeSideways(b: MarkerBox, atPrice: boolean, textW: number, pool: MarkerPool, first: number): void {
  const shape = b.marker.shape;
  // At a price, side arrows point at the bar from beside it; other shapes centre on it.
  const beside = atPrice && (shape === 'arrow-left' || shape === 'arrow-right');
  const side = atPrice ? sideOf(shape) : 1;
  const inner = beside ? b.x + (side * BAR_GAP) / 2 : b.x - b.width / 2;
  const outer = inner + side * (b.width + (textW > 0 ? SIDE_GAP + textW : 0));
  b.left = Math.min(inner, outer);
  b.right = Math.max(inner, outer);
  if (atPrice) {
    let shift = 0;
    for (let moved = true; moved; ) {
      moved = false;
      for (let i = first; i < pool.used - 1; i++) {
        const o = pool.boxes[i]!;
        if (markerPosition(o.marker) !== 'atPrice' || o.bottom <= b.top || o.top >= b.bottom) continue;
        if (b.right + shift <= o.left || b.left + shift >= o.right) continue;
        shift = side === 1 ? o.right + STACK_GAP - b.left : o.left - STACK_GAP - b.right;
        moved = true;
      }
    }
    b.left += shift;
    b.right += shift;
  }
  const shapeInner = side === 1 ? b.left : b.right;
  b.x = shapeInner + (side * b.width) / 2;
  if (textW > 0) {
    b.textX = shapeInner + side * (b.width + SIDE_GAP);
    b.align = side === 1 ? 'left' : 'right';
    b.textY = b.y;
  }
}

function needsRange(markers: readonly BarMarker[], start: number, end: number): boolean {
  for (let k = start; k < end; k++) if (!freePosition(markerPosition(markers[k]!))) return true;
  return false;
}

function pointsUp(shape: MarkerShape): boolean {
  return shape === 'arrow-up' || shape === 'triangle-up';
}

function pointsDown(shape: MarkerShape): boolean {
  return shape === 'arrow-down' || shape === 'triangle-down';
}

/** `arrow-right` sits left of its bar; everything else right of it or centred on it. */
function sideOf(shape: MarkerShape): 1 | -1 {
  return shape === 'arrow-right' ? -1 : 1;
}

/** A text-only `label` box; an icon replaces it like any shape. */
function isLabel(m: BarMarker): boolean {
  return m.shape === 'label' && !m.icon;
}

/** Text drawn beside or above the shape; a `label` draws its text inside instead. */
function sideText(m: BarMarker): boolean {
  return Boolean(m.text) && !isLabel(m);
}

function measure(env: MarkerLayoutEnv, text: string): number {
  return env.measureText ? env.measureText(text) : text.length * env.fontSize * 0.6;
}

function shapeHeight(m: BarMarker, env: MarkerLayoutEnv): number {
  return isLabel(m) ? (env.fontSize + 4) * (m.size ?? 1) : markerSize(m, env.barSpacing);
}

function shapeWidth(m: BarMarker, env: MarkerLayoutEnv): number {
  if (!isLabel(m)) return markerSize(m, env.barSpacing);
  return (m.text ? measure(env, m.text) : 0) + LABEL_PAD * 2;
}

export function markerColor(m: BarMarker, theme: ChartTheme): string {
  if (m.color) return m.color;
  if (pointsUp(m.shape)) return theme.up;
  if (pointsDown(m.shape)) return theme.down;
  return theme.line;
}

/** Parsed icon paths, per path string, least recently used first. */
const paths = new Map<string, Path2D>();
/** Most icon paths kept parsed. */
export const MAX_PATHS = 256;
/** Decoded Blob icons; null while decoding or after a failure. */
const decoded = new WeakMap<Blob, ImageBitmap | null>();
/** Redraw callbacks of every chart that drew a Blob icon while it was decoding. */
const waiting = new WeakMap<Blob, Set<() => void>>();

/**
 * Draw a marker's shape (or icon) and text. `ready` runs once a Blob icon
 * still decoding has been decoded, to redraw; each chart passes its own.
 */
export function drawMarker(ctx: CanvasRenderingContext2D, box: MarkerBox, color: string, ready?: () => void): void {
  const { x, y, size: s, marker } = box;
  ctx.fillStyle = color;
  ctx.beginPath();
  const icon = marker.icon;
  if (icon) {
    if ('svgPath' in icon) {
      const path = paths.get(icon.svgPath) ?? new Path2D(icon.svgPath);
      paths.delete(icon.svgPath);
      paths.set(icon.svgPath, path);
      if (paths.size > MAX_PATHS) paths.delete(paths.keys().next().value!);
      const k = s / (icon.viewBox ?? 24);
      ctx.save();
      ctx.translate(x - s / 2, y - s / 2);
      ctx.scale(k, k);
      ctx.fill(path);
      ctx.restore();
    } else {
      const image = typeof Blob !== 'undefined' && icon.image instanceof Blob ? decode(icon.image, ready) : (icon.image as CanvasImageSource);
      if (image) ctx.drawImage(image, x - s / 2, y - s / 2, s, s);
    }
    drawText(ctx, box);
    return;
  }
  switch (marker.shape) {
    case 'circle':
      ctx.arc(x, y, s / 2, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.rect(x - s * 0.42, y - s * 0.42, s * 0.84, s * 0.84);
      break;
    case 'diamond':
      ctx.moveTo(x, y - s / 2);
      ctx.lineTo(x + s * 0.42, y);
      ctx.lineTo(x, y + s / 2);
      ctx.lineTo(x - s * 0.42, y);
      ctx.closePath();
      break;
    case 'cross':
      cross(ctx, x, y, s, 1, 0);
      break;
    case 'x-cross':
      cross(ctx, x, y, s, Math.SQRT1_2, Math.SQRT1_2);
      break;
    case 'triangle-up':
    case 'triangle-down': {
      const dir = marker.shape === 'triangle-up' ? -1 : 1;
      ctx.moveTo(x, y + (dir * s) / 2);
      ctx.lineTo(x + s / 2, y - (dir * s) / 2);
      ctx.lineTo(x - s / 2, y - (dir * s) / 2);
      ctx.closePath();
      break;
    }
    case 'flag': {
      // A pole on the left and a pennant from its top.
      const pole = x - s * 0.35;
      const w = Math.max(1, s * 0.12);
      ctx.rect(pole - w / 2, y - s / 2, w, s);
      ctx.moveTo(pole, y - s / 2);
      ctx.lineTo(x + s * 0.45, y - s * 0.22);
      ctx.lineTo(pole, y + s * 0.06);
      ctx.closePath();
      break;
    }
    case 'label':
      ctx.roundRect(x - box.width / 2, y - s / 2, box.width, s, 2);
      ctx.fill();
      if (!marker.text) return;
      ctx.fillStyle = contrastText(color);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fillText(ctx, marker.text, x, y + 0.5);
      return;
    case 'arrow-up':
      arrow(ctx, x, y, s, 0, -1);
      break;
    case 'arrow-down':
      arrow(ctx, x, y, s, 0, 1);
      break;
    case 'arrow-left':
      arrow(ctx, x, y, s, -1, 0);
      break;
    case 'arrow-right':
      arrow(ctx, x, y, s, 1, 0);
      break;
  }
  ctx.fill();
  drawText(ctx, box);
}

function drawText(ctx: CanvasRenderingContext2D, box: MarkerBox): void {
  if (box.textY === null || !box.marker.text) return;
  ctx.textAlign = box.align;
  ctx.textBaseline = 'middle';
  fillText(ctx, box.marker.text, box.textX, box.textY + 0.5);
}

function decode(blob: Blob, ready?: () => void): ImageBitmap | null {
  const bitmap = decoded.get(blob);
  if (bitmap !== undefined) {
    if (ready) waiting.get(blob)?.add(ready);
    return bitmap;
  }
  decoded.set(blob, null);
  const waiters = new Set<() => void>(ready ? [ready] : []);
  waiting.set(blob, waiters);
  decodeImage(blob).then(
    (b) => {
      decoded.set(blob, b);
      waiting.delete(blob);
      for (const f of waiters) f();
    },
    (e: unknown) => {
      waiting.delete(blob);
      if (/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') devWarn(`A marker icon image could not be decoded (${String(e)}); the marker draws without it`, 'marker-icon');
    },
  );
  return null;
}

/** Triangular head plus a shaft, centred on (x, y), pointing along (dx, dy). */
function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, dx: number, dy: number): void {
  const tip = s / 2;
  const base = tip - s * 0.55;
  const tail = -s / 2;
  const shaft = s * 0.16;
  ctx.moveTo(x + tip * dx, y + tip * dy);
  arrowPoint(ctx, x, y, dx, dy, base, s / 2);
  arrowPoint(ctx, x, y, dx, dy, base, shaft);
  arrowPoint(ctx, x, y, dx, dy, tail, shaft);
  arrowPoint(ctx, x, y, dx, dy, tail, -shaft);
  arrowPoint(ctx, x, y, dx, dy, base, -shaft);
  arrowPoint(ctx, x, y, dx, dy, base, -s / 2);
  ctx.closePath();
}

/** A plus sign centred on (x, y), one arm along (dx, dy); each arm adds its tip and the corner after it. */
function cross(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, dx: number, dy: number): void {
  const tip = s / 2;
  const w = s * 0.13;
  for (let k = 0; k < 4; k++) {
    arrowPoint(ctx, x, y, dx, dy, tip, -w);
    arrowPoint(ctx, x, y, dx, dy, tip, w);
    arrowPoint(ctx, x, y, dx, dy, w, w);
    [dx, dy] = [-dy, dx];
  }
  ctx.closePath();
}

/** Line to a point given `a` along the arrow and `c` across it. */
function arrowPoint(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, a: number, c: number): void {
  ctx.lineTo(x + a * dx - c * dy, y + a * dy + c * dx);
}
