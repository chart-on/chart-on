import type { Rect } from '../types';
import { checkPixels, decodeImage, pixelSize } from '../util/image-size';
import { line, stroke, two } from './draw';
import { normalizedRect, pointInRect } from './geometry';
import type { DrawingEnv, DrawingToolDef, ScreenDrawing } from './types';

/** What `ImageToolOptions.load` may hand back: anything a canvas draws, or a `Blob` to decode. */
export type ImageToolSource = CanvasImageSource | Blob;

/** Options of `createImageTool`. */
export interface ImageToolOptions {
  /**
   * Turn a drawing's reference (its `text`: a URL, a file name, an id the app
   * keys its own files by) into an image, a canvas, a bitmap or a `Blob`, or a
   * promise of one. Called once per reference while its image is cached;
   * the chart itself fetches nothing. A rejection, an image that fails to decode, or one of more than
   * 32 megapixels marks the reference as failed: its drawings show a crossed
   * box. A `Blob` over that size is refused before it is decoded.
   */
  load(ref: string): ImageToolSource | Promise<ImageToolSource>;
  /**
   * Keep an image pasted from the system clipboard and return the reference
   * `load` will know it by. The image arrives checked (a PNG, JPEG, GIF or
   * WebP file of at most 2 MB and 32 megapixels), scaled down to at most 1024 px on its longer
   * side and re-encoded. Without it the tool takes no pastes.
   */
  store?(image: Blob): string | Promise<string>;
}

/** Largest pasted image file taken, in bytes. */
const MAX_BYTES = 2 * 1024 * 1024;
/** Longest side, in pixels, a pasted image is scaled down to. */
const MAX_SIDE = 1024;

/** First bytes of the image formats a paste takes, at their offsets. */
const SIGNATURES: readonly (readonly [number, string])[][] = [
  [[0, '\x89PNG\r\n\x1a\n']],
  [[0, '\xff\xd8\xff']],
  [[0, 'GIF8']],
  [
    [0, 'RIFF'],
    [8, 'WEBP'],
  ],
];

/** Whether a file's first bytes are those of a PNG, JPEG, GIF or WebP image, whatever its declared type. */
export function isImageFile(head: Uint8Array): boolean {
  return SIGNATURES.some((sig) => sig.every(([at, bytes]) => [...bytes].every((c, i) => head[at + i] === c.charCodeAt(0))));
}

/**
 * A pasted image file, checked, scaled down and re-encoded: at most 2 MB of
 * PNG, JPEG, GIF or WebP, by its first bytes, of at most 32 megapixels by its
 * header, checked before decoding; scaled to at most 1024 px on
 * its longer side and written as WebP (PNG where the browser cannot encode
 * WebP), which also drops metadata and all but a GIF's first frame. Null for
 * anything else.
 */
export async function shrinkImage(file: Blob): Promise<{ blob: Blob; image: ImageBitmap } | null> {
  if (file.size > MAX_BYTES || !isImageFile(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) return null;
  const decoded = await decodeImage(file);
  const k = Math.min(1, MAX_SIDE / Math.max(decoded.width, decoded.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(decoded.width * k)), Math.max(1, Math.round(decoded.height * k)));
  canvas.getContext('2d')!.drawImage(decoded, 0, 0, canvas.width, canvas.height);
  decoded.close();
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  return { blob, image: canvas.transferToImageBitmap() };
}

/** A reference's image while it loads (`undefined`), once loaded, or `null` when it failed; `own` when the cache made it. */
interface Entry {
  image?: CanvasImageSource | null;
  own?: boolean;
  waiting: Set<() => void>;
}

/** Most references an image cache keeps. */
export const IMAGE_CACHE_LIMIT = 256;

/**
 * The image of a reference, loaded with `load` on first use and cached:
 * `undefined` while it loads (`redraw` runs once it settles), `null` when it
 * failed. A `seed` given on first use is taken as the reference's image
 * without calling `load`. Past `IMAGE_CACHE_LIMIT` references the least
 * recently used one that has settled is dropped, closing a bitmap the cache
 * decoded or was seeded with, and loads again on its next use.
 */
export function imageCache(
  load: ImageToolOptions['load'],
): (ref: string, redraw?: () => void, seed?: CanvasImageSource) => CanvasImageSource | null | undefined {
  // In insertion order, least recently used first.
  const cache = new Map<string, Entry>();

  async function fill(ref: string, entry: Entry): Promise<void> {
    try {
      const source = await load(ref);
      if (source instanceof Blob) {
        entry.image = await decodeImage(source);
        entry.own = true;
      } else {
        // An image element may still be loading; `decode` waits for it and rejects on a broken one.
        await (source as Partial<HTMLImageElement>).decode?.();
        checkPixels(...pixelSize(source));
        entry.image = source;
      }
    } catch {
      entry.image = null;
    }
    for (const redraw of entry.waiting) redraw();
    entry.waiting.clear();
  }

  return (ref, redraw, seed) => {
    let entry = cache.get(ref);
    cache.delete(ref);
    if (!entry) {
      entry = { image: seed, own: !!seed, waiting: new Set() };
      if (!seed) void fill(ref, entry);
    }
    cache.set(ref, entry);
    // Drop the least recently used settled entries; one still loading keeps its waiters.
    for (const [key, old] of cache) {
      if (cache.size <= IMAGE_CACHE_LIMIT || key === ref) break;
      if (old.image === undefined) continue;
      cache.delete(key);
      if (old.own) (old.image as ImageBitmap).close();
    }
    if (entry.image === undefined && redraw) entry.waiting.add(redraw);
    return entry.image;
  };
}

/** The box `r` of an image that is still loading (dashed) or failed (dashed and crossed); `shown` is the image or its state. */
export function imageFrame(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv, r: Rect, shown: CanvasImageSource | null | undefined): void {
  stroke(ctx, d, env, 1);
  if (!shown) ctx.setLineDash([4, 4]);
  ctx.strokeRect(r.x, r.y, r.width, r.height);
  if (shown !== null) return;
  line(ctx, { x: r.x, y: r.y }, { x: r.x + r.width, y: r.y + r.height });
  line(ctx, { x: r.x + r.width, y: r.y }, { x: r.x, y: r.y + r.height });
}

/**
 * The `image` drawing tool: an image stretched over the box between two
 * points. A drawing keeps only the app's reference to its image, in `text`,
 * so saved drawings and the clipboard never carry image bytes. Until the
 * image loads the box shows a dashed outline, and a failed load a crossed
 * box. Images of the 256 most recently drawn references are cached. With
 * `store`, an image pasted on the chart becomes a drawing too.
 *
 * @example
 * ```ts
 * chart.drawings.register(createImageTool({ load: (ref) => fetch(ref).then((r) => r.blob()) }));
 * chart.drawings.add({ type: 'image', pane: 0, points: [a, b], style: {}, text: '/logo.png' });
 * ```
 */
export function createImageTool(options: ImageToolOptions): DrawingToolDef {
  const image = imageCache(options.load);

  async function pasteImage(file: Blob) {
    const shrunk = await shrinkImage(file).catch(() => null);
    if (!shrunk) return null;
    const text = await options.store!(shrunk.blob);
    // The image is at hand, so the drawing need not wait for `load`.
    image(text, undefined, shrunk.image);
    return { text, width: shrunk.image.width, height: shrunk.image.height };
  }

  return {
    ...(options.store && { pasteImage }),
    type: 'image',
    label: 'Image',
    group: 'annotate',
    points: 2,
    styleFields: ['color'],
    render(ctx, d, env) {
      const [a, b] = two(d);
      const r = normalizedRect(a, b);
      const ref = d.drawing.text;
      const shown = ref ? image(ref, env.redraw) : undefined;
      if (shown) ctx.drawImage(shown, r.x, r.y, r.width, r.height);
      // An outline marks a loaded image only under the pointer or while selected.
      if (shown && !d.hovered && !d.selected) return;
      imageFrame(ctx, d, env, r, shown);
    },
    hitTest: (d, p) => pointInRect(p, ...two(d)),
  };
}
