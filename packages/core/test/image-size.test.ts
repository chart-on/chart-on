import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_PIXELS, decodeImage, headerSize } from '../src/util/image-size';

/** Bytes from a mix of strings (one byte per character) and byte values. */
const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const be16 = (n: number) => [n >> 8, n & 255];
const be32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, n >> 8];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, n >> 16];

const png = (w: number, h: number) => bytes('\x89PNG\r\n\x1a\n', be32(13), 'IHDR', be32(w), be32(h), [8, 6, 0, 0, 0]);
const gif = (w: number, h: number) => bytes('GIF89a', le16(w), le16(h), [0, 0, 0]);
const webp = (chunk: string, body: number[]) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk, [0, 0, 0, 0], body, new Array(8).fill(0));
/** A JPEG with an APP0 segment and stray bytes before its start-of-frame segment. */
const jpeg = (w: number, h: number, sof = 0xc2) => bytes([0xff, 0xd8, 0xff, 0xe0], be16(6), 'JFIF', [0, 0, 0xff, 0xff, sof], be16(11), [8], be16(h), be16(w), [3]);

describe('headerSize', () => {
  it('reads the size of PNG, GIF, WebP and JPEG files', () => {
    expect(headerSize(png(640, 480))).toEqual([640, 480]);
    expect(headerSize(gif(320, 200))).toEqual([320, 200]);
    // Lossy: frame tag, start code, then 14-bit sizes.
    expect(headerSize(webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(1000), ...le16(700)]))).toEqual([1000, 700]);
    // Lossless: signature byte, then sizes minus one packed in 14 bits each.
    const packed = (1000 - 1) | ((700 - 1) << 14);
    expect(headerSize(webp('VP8L', [0x2f, packed & 255, (packed >> 8) & 255, (packed >> 16) & 255, packed >>> 24]))).toEqual([1000, 700]);
    // Extended: flags, then 24-bit sizes minus one.
    expect(headerSize(webp('VP8X', [0, 0, 0, 0, ...le24(40000 - 1), ...le24(30000 - 1)]))).toEqual([40000, 30000]);
    expect(headerSize(jpeg(4000, 3000))).toEqual([4000, 3000]);
    expect(headerSize(jpeg(64, 48, 0xc0))).toEqual([64, 48]);
  });

  it('sizes a GIF by its first frame when it reaches past the logical screen', () => {
    // 1 x 1 screen with a 2-colour global table, a graphic control extension, then a 50000 x 40000 frame at (10, 20).
    const file = bytes('GIF89a', le16(1), le16(1), [0x80, 0, 0], [0, 0, 0, 255, 255, 255], [0x21, 0xf9, 4, 0, 0, 0, 0, 0], [0x2c], le16(10), le16(20), le16(50000), le16(40000), [0]);
    expect(headerSize(file)).toEqual([50010, 40020]);
  });

  it('steps over JPEG markers without a length and stuffed bytes before the start-of-frame', () => {
    // RST0 and TEM have no length, and FF 00 is not a marker: read as segments, they would derail the walk.
    const fake = [0xff, 0xc0, ...be16(11), 8, ...be16(1), ...be16(1), 3];
    const file = bytes([0xff, 0xd8, 0xff, 0xd0, 0xff, 0x01, 0xff, 0x00], [0xff, 0xc0], be16(11), [8], be16(30000), be16(40000), [3], fake);
    expect(headerSize(file)).toEqual([40000, 30000]);
  });

  it('gives no size for other formats and throws for a known format it cannot size', () => {
    expect(headerSize(bytes('BM', new Array(30).fill(0)))).toBeUndefined();
    expect(headerSize(bytes('<svg'))).toBeUndefined();
    expect(() => headerSize(bytes([0xff, 0xd8, 0xff, 0xe0], be16(2), [0, 0, 0]))).toThrow();
    expect(() => headerSize(png(1, 1).slice(0, 20))).toThrow();
    expect(() => headerSize(webp('ALPH', []))).toThrow();
  });
});

describe('decodeImage', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stub = (width: number, height: number) => {
    const close = vi.fn();
    const decode = vi.fn(async () => ({ width, height, close }) as unknown as ImageBitmap);
    vi.stubGlobal('createImageBitmap', decode);
    return { decode, close };
  };

  it('refuses a file whose header is over the pixel cap without decoding it', async () => {
    const { decode } = stub(1, 1);
    for (const file of [png(8193, 4096), gif(65535, 65535), jpeg(60000, 60000)]) {
      await expect(decodeImage(new Blob([file]))).rejects.toThrow(/over the 33554432 px limit/);
    }
    expect(decode).not.toHaveBeenCalled();
  });

  it('decodes a file within the cap', async () => {
    const { decode } = stub(8192, 4096);
    const file = new Blob([png(8192, 4096)]);
    expect(8192 * 4096).toBe(MAX_IMAGE_PIXELS);
    await expect(decodeImage(file)).resolves.toMatchObject({ width: 8192, height: 4096 });
    expect(decode).toHaveBeenCalledWith(file);
  });

  it('checks a format without a readable header after decoding, closing a bitmap over the cap', async () => {
    const { close } = stub(10000, 10000);
    await expect(decodeImage(new Blob(['BM']))).rejects.toThrow(/10000 x 10000 px/);
    expect(close).toHaveBeenCalled();
  });
});
