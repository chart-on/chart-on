import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_CACHE_LIMIT, createImageTool, imageCache, isImageFile, shrinkImage, type ImageToolOptions } from '../src/drawing/image-tool';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import type { DrawingEnv, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { darkTheme } from '../src/theme';
import { Timeline } from '../src/timeline';

const env = (redraw?: () => void): DrawingEnv => ({
  width: 800,
  height: 400,
  theme: darkTheme,
  pixelRatio: 1,
  formatPrice: (p) => p.toFixed(2),
  priceToY: (price) => 400 - price,
  yToPrice: (y) => 400 - y,
  timeToX: (time) => time / 6,
  xToTime: (x) => x * 6,
  barsBetween: (a, b) => Math.round((b.time - a.time) / 60),
  bars: () => [],
  measureText: (t, size) => t.length * size * 0.6,
  redraw,
});

/** An image drawing from (300, 200) to (100, 50), so its box is 200 x 150 at (100, 50). */
function screen(text?: string, selected = false): ScreenDrawing {
  return {
    drawing: { id: 'x', type: 'image', pane: 0, points: [], style: {}, text },
    points: [
      { x: 300, y: 200 },
      { x: 100, y: 50 },
    ],
    selected,
    hovered: false,
  };
}

/** Canvas stand-in that records the calls this tool makes. */
function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get: (target, key) => (key in target ? target[key] : (...args: unknown[]) => calls.push({ name: String(key), args })),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const named = (name: string) => calls.filter((c) => c.name === name).map((c) => c.args);
  return { ctx, named, reset: () => (calls.length = 0) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const BOX = [100, 50, 200, 150];

/** Render `d` once with a fresh recorder. */
function draw(tool: ReturnType<typeof createImageTool>, d: ScreenDrawing, redraw?: () => void) {
  const r = recorder();
  tool.render(r.ctx, d, env(redraw));
  return r;
}

afterEach(() => vi.unstubAllGlobals());

describe('createImageTool', () => {
  it('shows a dashed box while loading, then draws the image over the box', async () => {
    const picture = { width: 10, height: 10 } as unknown as CanvasImageSource;
    const load = vi.fn<ImageToolOptions['load']>(() => Promise.resolve(picture));
    const redraw = vi.fn();
    const tool = createImageTool({ load });

    const loading = draw(tool, screen('logo'), redraw);
    expect(loading.named('drawImage')).toEqual([]);
    expect(loading.named('setLineDash').at(-1)).toEqual([[4, 4]]);
    expect(loading.named('strokeRect')).toEqual([BOX]);

    await settle();
    expect(redraw).toHaveBeenCalledTimes(1);
    const loaded = draw(tool, screen('logo'), redraw);
    expect(loaded.named('drawImage')).toEqual([[picture, ...BOX]]);
    expect(loaded.named('strokeRect')).toEqual([]);
    // Selected: the image with a solid outline.
    expect(draw(tool, screen('logo', true)).named('strokeRect')).toEqual([BOX]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('logo');
  });

  it('loads each reference once and redraws every chart that waited for it', async () => {
    const load = vi.fn(() => Promise.resolve({} as CanvasImageSource));
    const tool = createImageTool({ load });
    const a = vi.fn();
    const b = vi.fn();
    draw(tool, screen('logo'), a);
    draw(tool, screen('logo'), a);
    draw(tool, screen('logo'), b);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('decodes a Blob into a bitmap', async () => {
    const bitmap = { width: 4, height: 4 };
    const createImageBitmap = vi.fn(() => Promise.resolve(bitmap));
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const blob = new Blob(['x'], { type: 'image/png' });
    const tool = createImageTool({ load: () => blob });
    draw(tool, screen('file-1'));
    await settle();
    expect(createImageBitmap).toHaveBeenCalledWith(blob);
    expect(draw(tool, screen('file-1')).named('drawImage')).toEqual([[bitmap, ...BOX]]);
  });

  it('refuses a Blob whose header is over 32 megapixels without decoding it', async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const huge = new Uint8Array(24);
    huge.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(huge.buffer).setUint32(16, 50000);
    new DataView(huge.buffer).setUint32(20, 50000);
    const tool = createImageTool({ load: () => new Blob([huge]) });
    draw(tool, screen('bomb'));
    await settle();
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(draw(tool, screen('bomb')).named('lineTo')).toHaveLength(2);
  });

  it('waits for an image element to decode', async () => {
    let finish!: () => void;
    const element = { decode: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))) };
    const tool = createImageTool({ load: () => element as unknown as HTMLImageElement });
    draw(tool, screen('logo'));
    await settle();
    expect(draw(tool, screen('logo')).named('drawImage')).toEqual([]);
    finish();
    await settle();
    expect(draw(tool, screen('logo')).named('drawImage')).toEqual([[element, ...BOX]]);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('404'))],
    ['throws', () => {
      throw new Error('unknown reference');
    }],
    ['returns an image that fails to decode', () => ({ decode: () => Promise.reject(new Error('broken')) }) as unknown as HTMLImageElement],
    ['returns an image of more than 32 megapixels', () => ({ width: 8193, height: 4096 }) as unknown as HTMLCanvasElement],
  ])('shows a crossed box when the load %s, and does not retry', async (_, load: ImageToolOptions['load']) => {
    const spy = vi.fn(load);
    const tool = createImageTool({ load: spy });
    draw(tool, screen('bad'));
    await settle();
    const failed = draw(tool, screen('bad'));
    expect(failed.named('drawImage')).toEqual([]);
    expect(failed.named('strokeRect')).toEqual([BOX]);
    // Two diagonals.
    expect(failed.named('lineTo')).toEqual([
      [300, 200],
      [100, 200],
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('shows a dashed box and loads nothing without a reference', () => {
    const load = vi.fn();
    const r = draw(createImageTool({ load }), screen());
    expect(r.named('strokeRect')).toEqual([BOX]);
    expect(r.named('lineTo')).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it('hits inside its box only', () => {
    const tool = createImageTool({ load: vi.fn() });
    expect(tool.hitTest(screen(), { x: 200, y: 100 }, env())).toBe(true);
    expect(tool.hitTest(screen(), { x: 310, y: 100 }, env())).toBe(false);
  });

  it('saves only the reference, and the chart redraws once the image loads', async () => {
    const timeline = new Timeline();
    timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
    const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
    time.width = 1000;
    time.barCount = 100;
    const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
    pane.height = 500;
    pane.price.height = 500;
    pane.price.fit(0, 500);
    const requestOverlay = vi.fn();
    const host: DrawingHost = {
      theme: darkTheme,
      timeline,
      time,
      panes: [pane],
      magnetPrice: (_i, price) => price,
      formatPrice: (_p, price) => price.toFixed(2),
      requestOverlay,
      editText: (_at, _initial, done) => done(null),
      emit: () => {},
    };
    const manager = new DrawingManager(host);
    manager.register(createImageTool({ load: () => Promise.resolve({} as CanvasImageSource) }));
    const points = [
      { time: 600, price: 100 },
      { time: 1200, price: 300 },
    ];
    manager.add({ type: 'image', pane: 0, points, style: {}, text: 'chart-logo' });
    expect(manager.serialize().drawings).toEqual([{ id: expect.any(String), type: 'image', pane: 0, points, style: {}, text: 'chart-logo' }]);

    requestOverlay.mockClear();
    const ctx = recorder().ctx;
    manager.render(ctx, 0, 1000, 500);
    manager.render(ctx, 0, 1000, 500);
    await settle();
    expect(requestOverlay).toHaveBeenCalledTimes(1);
  });
});

/** File bytes: `head` (a string of byte values) then zeros up to `size`. */
const file = (head: string, size = 64, type = 'image/png') => {
  const bytes = new Uint8Array(size);
  [...head].forEach((c, i) => (bytes[i] = c.charCodeAt(0)));
  return new Blob([bytes], { type });
};
const PNG = '\x89PNG\r\n\x1a\n';

/** Decoder and canvas stand-ins: decoding gives a `width` x `height` bitmap; the canvas records its size and encoding. */
function stubImageCodec(width: number, height: number) {
  const encoded = new Blob(['webp']);
  const canvases: { width: number; height: number; type?: string }[] = [];
  const decode = vi.fn(() => Promise.resolve({ width, height, close: vi.fn() }));
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {
        canvases.push(this);
      }
      getContext = () => ({ drawImage: vi.fn() });
      convertToBlob = (o: { type: string }) => {
        canvases.at(-1)!.type = o.type;
        return Promise.resolve(encoded);
      };
      transferToImageBitmap = () => ({ width: this.width, height: this.height });
    },
  );
  return { decode, canvases, encoded };
}

describe('pasted images', () => {
  it('recognise PNG, JPEG, GIF and WebP by their first bytes only', () => {
    const head = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
    for (const sig of [PNG, '\xff\xd8\xff\xe0', 'GIF89a', 'RIFF\0\0\0\0WEBPVP8 ']) expect(isImageFile(head(sig))).toBe(true);
    for (const sig of ['', '<svg xmlns', 'RIFF\0\0\0\0WAVE', '\x89PNX', '%PDF-1.7']) expect(isImageFile(head(sig))).toBe(false);
  });

  it('reject an oversized file or one whose bytes are not an image, whatever its type, before decoding it', async () => {
    const { decode } = stubImageCodec(10, 10);
    expect(await shrinkImage(file(PNG, 2 * 1024 * 1024 + 1))).toBeNull();
    expect(await shrinkImage(file('<svg onload="x()">', 64, 'image/png'))).toBeNull();
    expect(decode).not.toHaveBeenCalled();
    expect(await shrinkImage(file(PNG, 2 * 1024 * 1024))).not.toBeNull();
  });

  it('reject an image whose header is over 32 megapixels before decoding it', async () => {
    const { decode } = stubImageCodec(10, 10);
    const huge = file(PNG);
    const head = new Uint8Array(await huge.arrayBuffer());
    new DataView(head.buffer).setUint32(16, 6000);
    new DataView(head.buffer).setUint32(20, 6000);
    await expect(shrinkImage(new Blob([head]))).rejects.toThrow(/6000 x 6000 px/);
    expect(decode).not.toHaveBeenCalled();
  });

  it('scale down to 1024 px on the longer side and re-encode', async () => {
    const { canvases, encoded } = stubImageCodec(4096, 1024);
    const shrunk = await shrinkImage(file(PNG));
    expect(canvases).toMatchObject([{ width: 1024, height: 256, type: 'image/webp' }]);
    expect(shrunk).toMatchObject({ blob: encoded, image: { width: 1024, height: 256 } });
    // A small image keeps its size.
    const small = stubImageCodec(300, 200);
    await shrinkImage(file(PNG));
    expect(small.canvases).toMatchObject([{ width: 300, height: 200, type: 'image/webp' }]);
  });

  it('go to `store`, and the drawing shows the image without loading it', async () => {
    const { encoded } = stubImageCodec(300, 200);
    const load = vi.fn();
    expect(createImageTool({ load }).pasteImage).toBeUndefined();
    const store = vi.fn(() => Promise.resolve('upload-7'));
    const tool = createImageTool({ load, store });
    expect(await tool.pasteImage!(file(PNG))).toEqual({ text: 'upload-7', width: 300, height: 200 });
    expect(store).toHaveBeenCalledWith(encoded);
    expect(draw(tool, screen('upload-7')).named('drawImage')).toEqual([[{ width: 300, height: 200 }, ...BOX]]);
    expect(load).not.toHaveBeenCalled();
    expect(await tool.pasteImage!(file('GIF'))).toBeNull();
    expect(store).toHaveBeenCalledTimes(1);
  });
});

describe('imageCache', () => {
  /** A cache whose `load` gives a Blob per reference, decoded to a bitmap that records its closing. */
  function blobCache() {
    const closed: string[] = [];
    vi.stubGlobal('createImageBitmap', async (b: Blob) => {
      const ref = await b.text();
      return { width: 1, height: 1, close: () => closed.push(ref) };
    });
    const load = vi.fn<ImageToolOptions['load']>((ref) => new Blob([ref]));
    return { image: imageCache(load), load, closed };
  }
  const refs = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `r${from + i}`);

  it('keeps at most the limit, dropping and closing the least recently used bitmap first', async () => {
    const { image, load, closed } = blobCache();
    for (const ref of refs(IMAGE_CACHE_LIMIT)) image(ref);
    await settle();
    // Using r0 again makes r1 the least recently used.
    expect(image('r0')).toBeDefined();
    image('extra');
    await settle();
    expect(closed).toEqual(['r1']);
    expect(load).toHaveBeenCalledTimes(IMAGE_CACHE_LIMIT + 1);

    // Every kept reference is drawn without loading again; the dropped one loads on its next use.
    for (const ref of ['r0', ...refs(IMAGE_CACHE_LIMIT - 2, 2), 'extra']) expect(image(ref)).toBeDefined();
    expect(load).toHaveBeenCalledTimes(IMAGE_CACHE_LIMIT + 1);
    expect(image('r1')).toBeUndefined();
    expect(load).toHaveBeenLastCalledWith('r1');
  });

  it('keeps entries still loading and never closes an image the app handed over', async () => {
    const picture = { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap;
    const load = vi.fn<ImageToolOptions['load']>(() => picture);
    const image = imageCache(load);
    const redraw = vi.fn();
    image('first', redraw);
    for (const ref of refs(IMAGE_CACHE_LIMIT)) image(ref);
    // `first` was still loading when the cache filled: kept, and its drawing is told when it is ready.
    await settle();
    expect(redraw).toHaveBeenCalledTimes(1);
    for (const ref of refs(IMAGE_CACHE_LIMIT, 1000)) image(ref);
    await settle();
    expect(picture.close).not.toHaveBeenCalled();
    expect(image('first')).toBeUndefined();
    expect(load).toHaveBeenLastCalledWith('first');
  });
});
