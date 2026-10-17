import { isDev } from './dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };
/** Most pixels (width x height) an image may have: 32 megapixels, 128 MB once decoded to RGBA. */
export const MAX_IMAGE_PIXELS = 2 ** 25;

/** Width and height of a drawable image, 0 when it has none. */
export function pixelSize(image: unknown): [number, number] {
  const s = (image ?? {}) as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  return [s.naturalWidth ?? s.width ?? 0, s.naturalHeight ?? s.height ?? 0];
}

/** Throw when a `width` x `height` image is over `MAX_IMAGE_PIXELS`. */
export function checkPixels(width: number, height: number): void {
  if (width * height > MAX_IMAGE_PIXELS) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `An image of ${width} x ${height} px is over the ${MAX_IMAGE_PIXELS} px limit` : '');
}

/**
 * Width and height a PNG, GIF, WebP or JPEG file declares in its header,
 * `undefined` for other formats. Throws for one of these formats whose size
 * cannot be read.
 */
export function headerSize(b: Uint8Array): [number, number] | undefined {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const at = (i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (at(1, 'PNG')) return [v.getUint32(16), v.getUint32(20)];
  if (at(0, 'GIF8')) {
    // Decoders may grow the image to hold a first frame that reaches past the logical screen.
    let i = 13 + (b[10]! & 0x80 ? 3 << ((b[10]! & 7) + 1) : 0);
    // Step over extensions: introducer, label, then sub-blocks up to an empty one.
    while (b[i] === 0x21) {
      for (i += 2; b[i]; ) i += b[i]! + 1;
      i++;
    }
    const frame = b[i] === 0x2c ? [v.getUint16(i + 1, true) + v.getUint16(i + 5, true), v.getUint16(i + 3, true) + v.getUint16(i + 7, true)] : [0, 0];
    return [Math.max(v.getUint16(6, true), frame[0]!), Math.max(v.getUint16(8, true), frame[1]!)];
  }
  if (at(8, 'WEBP')) {
    // Extended: 24-bit sizes minus one. Lossless: 14-bit sizes minus one, packed. Lossy: 14-bit sizes.
    if (at(12, 'VP8X')) return [1 + (v.getUint32(24, true) & 0xffffff), 1 + (v.getUint32(26, true) >>> 8)];
    const bits = v.getUint32(21, true);
    if (at(12, 'VP8L')) return [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)];
    if (at(12, 'VP8 ')) return [v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff];
  } else if (b[0] === 0xff && b[1] === 0xd8) {
    // JPEG: walk the segments to a start-of-frame one, skipping stray and fill bytes as decoders do;
    // TEM and RST0-7 (and SOI, EOI) carry no length.
    for (let i = 2; i < b.length; ) {
      const m = b[i + 1] ?? 0;
      if (b[i] !== 0xff || m === 0xff || m === 0) i++;
      else if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [v.getUint16(i + 7), v.getUint16(i + 5)];
      else i += m === 1 || (m >= 0xd0 && m <= 0xd9) ? 2 : 2 + v.getUint16(i + 2);
    }
  } else return undefined;
  throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'The image size cannot be read' : '');
}

/**
 * An image file decoded to a bitmap. One over `MAX_IMAGE_PIXELS` is refused,
 * before decoding when its header gives its size (PNG, GIF, WebP, JPEG) and
 * after decoding otherwise.
 */
export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  const size = headerSize(new Uint8Array(await file.arrayBuffer()));
  if (size) checkPixels(...size);
  const bitmap = await createImageBitmap(file);
  try {
    checkPixels(bitmap.width, bitmap.height);
  } catch (e) {
    bitmap.close();
    throw e;
  }
  return bitmap;
}
