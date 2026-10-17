import type { DataEvents, Interval, SymbolInfo } from './data/types';
import type { Primitive, PrimitiveEnv, PrimitiveHost } from './primitives';
import { parseColor } from './util/color';
import { fillText, resolveFont } from './typography';
import { clampLow } from './util/math';
import { ATTRIBUTION_SIZE, drawAttributionMark } from './attribution';

/**
 * Watermark: large, faint text and/or an image behind the series. It is an
 * ordinary primitive written only against the public primitives API, so it
 * also serves as a reference for writing your own.
 */

/** Where the watermark sits in the plot area. */
export type WatermarkAnchor =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

/** One line of watermark text. A plain string uses the watermark's `fontSize`. */
export interface WatermarkLine {
  text: string;
  /** Font size in css px; defaults to the watermark's `fontSize`. */
  size?: number;
  /** CSS font weight, e.g. 400 or 'bold'. Defaults to 600. */
  weight?: number | string;
}

/** Options for a watermark: its text lines and image, position and margin, colour, opacity and font. */
export interface WatermarkOptions {
  visible: boolean;
  /** Text lines, top to bottom. */
  lines: (string | WatermarkLine)[];
  /**
   * A line above the others, e.g. the user's name, so it stays while `follow`
   * replaces `lines`. Plain text, trimmed and cut to 40 characters; empty adds no line.
   */
  author: string;
  /**
   * Size of the `author` line in css px; null: half of `fontSize`.
   */
  authorSize: number | null;
  /**
   * Sizes of `lines` by position, in css px, over each line's own size; a
   * missing or null entry keeps it. They outlast `follow` replacing the lines,
   * so `[40, 18]` sizes the symbol and interval lines of `symbolWatermarkLines`.
   */
  lineSizes: (number | null)[];
  /**
   * Draw the project mark above the image and text, in the text colour. The
   * chart sets it on the `watermark()` plugin's watermark from `features.attributionLogo`.
   */
  logo: boolean;
  /** Image drawn above the text (a logo, say). Loading images are drawn once loaded. */
  image: CanvasImageSource | null;
  /** Image size in css px; defaults to its natural size. */
  imageSize: { width: number; height: number } | null;
  anchor: WatermarkAnchor;
  /** Distance from the plot edges in css px (for anchors other than `center`). */
  margin: number;
  /** Text color; defaults to the theme's `watermark` token. */
  color: string | null;
  /** Multiplies the color's own alpha. Images use it times the color's alpha. */
  opacity: number;
  /** Default font size of the lines, in css px. */
  fontSize: number;
  /** Defaults to the theme's font. */
  fontFamily: string | null;
}

/** Default values for `WatermarkOptions`: no lines, image or mark, centred, 48 px text in the theme's watermark colour. */
export const defaultWatermarkOptions: WatermarkOptions = {
  visible: true,
  lines: [],
  author: '',
  authorSize: null,
  lineSizes: [],
  logo: false,
  image: null,
  imageSize: null,
  anchor: 'center',
  margin: 16,
  color: null,
  opacity: 1,
  fontSize: 48,
  fontFamily: null,
};

/** A watermark primitive; attach it with `chart.attachPrimitive`. */
export interface Watermark extends Primitive {
  readonly options: Readonly<WatermarkOptions>;
  /** Merge new options and redraw. */
  applyOptions(options: Partial<WatermarkOptions>): void;
  /**
   * Keep the lines in step with the symbol and interval a chart loads (its
   * `data:loaded` events). Returns an unsubscribe function.
   */
  follow(source: WatermarkSource, format?: WatermarkFormat): () => void;
}

/** Anything that emits `data:loaded`, such as a `Chart`. */
export interface WatermarkSource {
  on(event: 'data:loaded', listener: (payload: DataEvents['data:loaded']) => void): () => void;
}

/** Turns a symbol and interval into watermark lines. */
export type WatermarkFormat = (symbol: SymbolInfo, interval: Interval) => (string | WatermarkLine)[];

/** Default lines: the symbol large, then the interval and the symbol's name. */
export const symbolWatermarkLines: WatermarkFormat = (symbol, interval) => {
  const name = symbol.name && symbol.name !== symbol.symbol ? ` · ${symbol.name}` : '';
  return [
    { text: symbol.symbol, size: 64, weight: 700 },
    { text: `${interval}${name}`, size: 22, weight: 500 },
  ];
};

const LINE_HEIGHT = 1.2;
/** Gap between the parts of the block (mark, image, text), as a fraction of the first line's size. */
const IMAGE_GAP = 0.3;
/** Text smaller than this after fitting is not drawn. */
const MIN_FONT = 4;
/** Longest author line, in characters. */
const AUTHOR_MAX = 40;

/**
 * Create a watermark: large, faint text and an optional image behind the
 * series. Attach it with `chart.attachPrimitive`; `follow` keeps its lines on
 * the symbol and interval the chart loads.
 */
export function createWatermark(options: Partial<WatermarkOptions> = {}): Watermark {
  let opts: WatermarkOptions = { ...defaultWatermarkOptions, ...options };
  let host: PrimitiveHost | null = null;
  let pendingImage: CanvasImageSource | null = null;

  /** Redraw once an image that is still loading arrives. */
  const watchImage = (): void => {
    const img = opts.image;
    if (!isLoadingImage(img) || pendingImage === img) return;
    pendingImage = img;
    img.addEventListener(
      'load',
      () => {
        if (pendingImage === img) pendingImage = null;
        if (opts.image === img) host?.requestRedraw();
      },
      { once: true },
    );
  };

  const watermark: Watermark = {
    layer: 'below',
    get options() {
      return opts;
    },
    attached(h) {
      host = h;
      watchImage();
    },
    detached() {
      host = null;
    },
    applyOptions(next) {
      opts = { ...opts, ...next };
      watchImage();
      host?.requestRedraw();
    },
    follow(source, format = symbolWatermarkLines) {
      return source.on('data:loaded', (e) => {
        if (e.kind === 'initial') watermark.applyOptions({ lines: format(e.symbol, e.interval) });
      });
    },
    drawPlot(ctx, env) {
      if (opts.visible) drawWatermark(ctx, env, opts);
    },
  };
  return watermark;
}

/** A usable font size, or null for none. */
function validSize(size: number | null | undefined): number | null {
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : null;
}

function isLoadingImage(img: CanvasImageSource | null): img is HTMLImageElement {
  return typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement && !img.complete;
}

/** Natural size in css px of a drawable image, or null while it isn't ready. */
function imageSizeOf(img: CanvasImageSource, size: WatermarkOptions['imageSize']): { width: number; height: number } | null {
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement && (!img.complete || img.naturalWidth === 0)) {
    return null;
  }
  if (size) return size.width > 0 && size.height > 0 ? size : null;
  const any = img as { naturalWidth?: number; naturalHeight?: number; width?: unknown; height?: unknown };
  const width = any.naturalWidth || (typeof any.width === 'number' ? any.width : 0);
  const height = any.naturalHeight || (typeof any.height === 'number' ? any.height : 0);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Snap a css px coordinate to whole device pixels. */
function snap(value: number, pixelRatio: number): number {
  return Math.round(value * pixelRatio) / pixelRatio;
}

/** Alpha of a color in 0…1; colors the canvas cannot read count as opaque. */
function alphaOf(color: string): number {
  try {
    return parseColor(color)[3] / 255;
  } catch {
    return 1;
  }
}

/** The block's layout: everything scaled to fit inside the plot minus margins. */
export interface WatermarkLayout {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
  align: CanvasTextAlign;
  image: { x: number; y: number; width: number; height: number } | null;
  /** The project mark (`logo`): top left and side, css px. */
  logo: { x: number; y: number; size: number } | null;
  lines: { text: string; font: string; size: number; x: number; baseline: number }[];
}

/**
 * Lay out the watermark in an area `env.width` × `env.height`; null when there
 * is nothing to draw. `origin` is where the area starts on the canvas, in css
 * px, so text and image land on whole device pixels of the canvas.
 */
export function layoutWatermark(
  ctx: CanvasRenderingContext2D,
  env: Pick<PrimitiveEnv, 'width' | 'height' | 'pixelRatio' | 'theme'>,
  opts: WatermarkOptions,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): WatermarkLayout | null {
  // The theme's watermark font gives the family and weight; sizes stay the watermark's own.
  const themeFont = resolveFont(env.theme, 'watermark');
  const family = opts.fontFamily ?? themeFont.fontFamily;
  const author = [...(opts.author || '').trim()];
  const authorText = author.length > AUTHOR_MAX ? `${author.slice(0, AUTHOR_MAX - 1).join('')}…` : author.join('');
  const sized = opts.lines.map((l, i) => {
    const line = typeof l === 'string' ? { text: l } : l;
    const size = validSize(opts.lineSizes[i]);
    return size === null ? line : { ...line, size };
  });
  let lines = [{ text: authorText, size: validSize(opts.authorSize) ?? opts.fontSize / 2, weight: 500 }, ...sized]
    .filter((l) => l.text.length > 0)
    .map((l) => ({ text: l.text, size: l.size ?? opts.fontSize, weight: l.weight ?? themeFont.fontWeight }));
  const imgSize = opts.image ? imageSizeOf(opts.image, opts.imageSize) : null;
  // Stacked top to bottom above the text: the mark, then the image.
  const marks = [opts.logo ? { width: ATTRIBUTION_SIZE, height: ATTRIBUTION_SIZE } : null, imgSize].filter((m) => m !== null);
  if (lines.length === 0 && marks.length === 0) return null;

  const fontOf = (l: (typeof lines)[number], scale: number) => `${l.weight} ${l.size * scale}px ${family}`;
  const margin = opts.anchor === 'center' ? Math.min(opts.margin, env.width / 10) : opts.margin;
  const availW = env.width - 2 * margin;
  const availH = env.height - 2 * margin;
  if (availW <= 0 || availH <= 0) return null;

  let fit = fitBlock(ctx, lines, marks, fontOf, availW, availH);
  if (!fit) return null;
  // Drop the lines too small to read, then refit the rest: with fewer lines
  // the scale only grows, so every kept line stays readable.
  const fitted = fit.scale;
  const readable = lines.filter((l) => l.size * fitted >= MIN_FONT);
  if (readable.length < lines.length) {
    lines = readable;
    if (lines.length === 0 && marks.length === 0) return null;
    fit = fitBlock(ctx, lines, marks, fontOf, availW, availH);
    if (!fit) return null;
  }
  const { scale, naturalW, naturalH, gap } = fit;

  const w = naturalW * scale;
  const h = naturalH * scale;
  const [vert, horiz] = anchorParts(opts.anchor);
  const x = horiz === 'left' ? margin : horiz === 'right' ? env.width - margin - w : (env.width - w) / 2;
  const y = vert === 'top' ? margin : vert === 'bottom' ? env.height - margin - h : (env.height - h) / 2;
  const align: CanvasTextAlign = horiz === 'left' ? 'left' : horiz === 'right' ? 'right' : 'center';
  const textX = horiz === 'left' ? x : horiz === 'right' ? x + w : x + w / 2;
  const pr = env.pixelRatio;
  // Snap in canvas space: the area itself may start at a fractional device pixel.
  const snapX = (v: number) => snap(origin.x + v, pr) - origin.x;
  const snapY = (v: number) => snap(origin.y + v, pr) - origin.y;

  let cursor = y;
  // Each mark centred (or aligned) in the block, on whole device pixels on every edge so it stays sharp.
  const place = (m: { width: number; height: number }) => {
    const mw = m.width * scale;
    const mh = m.height * scale;
    const mx = horiz === 'left' ? x : horiz === 'right' ? x + w - mw : x + (w - mw) / 2;
    const left = snapX(mx);
    const top = snapY(cursor);
    cursor += mh + gap * scale;
    return { x: left, y: top, width: snapX(mx + mw) - left, height: snapY(cursor - gap * scale) - top };
  };
  const placedLogo = opts.logo ? place(marks[0]!) : null;
  const logo = placedLogo && { x: placedLogo.x, y: placedLogo.y, size: Math.min(placedLogo.width, placedLogo.height) };
  const image = imgSize ? place(imgSize) : null;
  const placed = lines.map((l) => {
    const size = l.size * scale;
    const lineH = size * LINE_HEIGHT;
    // Alphabetic baseline at ~80% of the font size, centred in the line box.
    const baseline = snapY(cursor + (lineH - size) / 2 + size * 0.8);
    cursor += lineH;
    return { text: l.text, font: fontOf(l, scale), size, x: snapX(textX), baseline };
  });
  return { scale, x, y, width: w, height: h, align, image, logo, lines: placed };
}

type FittedLine = { text: string; size: number; weight: number | string };

/** Natural size of the marks (mark, image) and lines stacked, and the scale that fits it into availW × availH. */
function fitBlock(
  ctx: CanvasRenderingContext2D,
  lines: readonly FittedLine[],
  marks: readonly { width: number; height: number }[],
  fontOf: (l: FittedLine, scale: number) => string,
  availW: number,
  availH: number,
): { scale: number; naturalW: number; naturalH: number; gap: number } | null {
  // Measure at full size; text width scales linearly with the font size.
  const widths = lines.map((l) => {
    ctx.font = fontOf(l, 1);
    return ctx.measureText(l.text).width;
  });
  // One gap between each two parts: every mark, and the text as a whole.
  const parts = marks.length + (lines.length > 0 ? 1 : 0);
  const gap = parts > 1 ? (lines[0]?.size ?? marks[0]!.height) * IMAGE_GAP : 0;
  const naturalW = Math.max(0, ...marks.map((m) => m.width), ...widths);
  const naturalH = marks.reduce((h, m) => h + m.height, 0) + gap * (parts - 1) + lines.reduce((h, l) => h + l.size * LINE_HEIGHT, 0);
  if (naturalW <= 0 || naturalH <= 0) return null;
  return { scale: Math.min(1, availW / naturalW, availH / naturalH), naturalW, naturalH, gap };
}

function anchorParts(anchor: WatermarkAnchor): ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right'] {
  const vert = anchor.startsWith('top') ? 'top' : anchor.startsWith('bottom') ? 'bottom' : 'middle';
  const horiz = anchor.endsWith('left') ? 'left' : anchor.endsWith('right') ? 'right' : 'center';
  return [vert, horiz];
}

function drawWatermark(ctx: CanvasRenderingContext2D, env: PrimitiveEnv, opts: WatermarkOptions): void {
  // The chart translates the context to the plot area; snap against the canvas.
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const origin = t && t.a > 0 && t.d > 0 ? { x: t.e / t.a, y: t.f / t.d } : undefined;
  const layout = layoutWatermark(ctx, env, opts, origin);
  if (!layout) return;
  const color = opts.color ?? env.theme.watermark;
  const opacity = clampLow(opts.opacity, 0, 1);
  if (layout.image && opts.image) {
    ctx.globalAlpha = opacity * alphaOf(color);
    ctx.drawImage(opts.image, layout.image.x, layout.image.y, layout.image.width, layout.image.height);
  }
  ctx.globalAlpha = opacity;
  if (layout.logo) drawAttributionMark(ctx, layout.logo.x, layout.logo.y, layout.logo.size, color);
  ctx.fillStyle = color;
  ctx.textAlign = layout.align;
  ctx.textBaseline = 'alphabetic';
  for (const line of layout.lines) {
    ctx.font = line.font;
    fillText(ctx, line.text, line.x, line.baseline);
  }
}
