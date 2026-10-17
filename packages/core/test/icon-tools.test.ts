import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStickerTool, iconTool } from '../src/drawing/icon-tools';
import { IMAGE_CACHE_LIMIT, type ImageToolOptions } from '../src/drawing/image-tool';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import type { Drawing, DrawingEnv, DrawingToolDef, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { darkTheme } from '../src/theme';
import { Timeline } from '../src/timeline';

/** Data coordinates are pane pixels. */
const env = (redraw?: () => void): DrawingEnv => ({
  width: 800,
  height: 400,
  theme: darkTheme,
  pixelRatio: 1,
  formatPrice: (p) => p.toFixed(2),
  priceToY: (price) => price,
  yToPrice: (y) => y,
  timeToX: (time) => time,
  xToTime: (x) => x,
  barsBetween: () => 0,
  bars: () => [],
  measureText: (_t, size) => size,
  redraw,
});

const C = { x: 200, y: 100 };

const drawing = (type: string, text: string, style: Drawing['style'] = {}): Drawing => ({
  id: 'g',
  type,
  pane: 0,
  points: [{ time: C.x, price: C.y }],
  style,
  text,
});

const screen = (d: Drawing): ScreenDrawing => ({ drawing: d, points: [C], selected: true, hovered: false });

/** Canvas stand-in that records the calls the tools make. */
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
  return { ctx, named: (name: string) => calls.filter((c) => c.name === name).map((c) => c.args) };
}

function render(tool: DrawingToolDef, d: Drawing, redraw?: () => void) {
  const r = recorder();
  tool.render(r.ctx, screen(d), env(redraw));
  return r;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Image elements the icon tool creates: 48 x 24 px, and failing to decode when their source says `broken`. */
const images: FakeImage[] = [];
class FakeImage {
  src = '';
  naturalWidth = 48;
  naturalHeight = 24;
  constructor() {
    images.push(this);
  }
  decode = () => (decodeURIComponent(this.src).includes('broken') ? Promise.reject(new Error('broken')) : Promise.resolve());
}

beforeEach(() => {
  images.length = 0;
  vi.stubGlobal('Image', FakeImage);
});
afterEach(() => vi.unstubAllGlobals());

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24">${body}</svg>`;

describe('icon tool', () => {
  it('draws the markup as an image of a data URL, with currentColor in the text color', async () => {
    const markup = svg('<path fill="currentColor" d="M0 0h48v24z"/><script>alert(1)</script>');
    const redraw = vi.fn();
    const loading = render(iconTool, drawing('icon', markup, { fontSize: 32, textColor: '#123456' }), redraw);
    expect(loading.named('drawImage')).toEqual([]);
    // A dashed square box while the image loads.
    expect(loading.named('strokeRect')[0]).toEqual([-16, -16, 32, 32]);

    expect(images).toHaveLength(1);
    const { src } = images[0]!;
    expect(src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(src.slice(src.indexOf(',') + 1))).toBe(markup.replace('currentColor', '#123456'));

    await settle();
    expect(redraw).toHaveBeenCalledTimes(1);
    // Fitted into a 32 px square: 32 x 16, centred on the point.
    const loaded = render(iconTool, drawing('icon', markup, { fontSize: 32, textColor: '#123456' }));
    expect(loaded.named('translate')).toEqual([[200, 100]]);
    expect(loaded.named('drawImage')).toEqual([[images[0], -16, -8, 32, 16]]);
    expect(images).toHaveLength(1);
  });

  it('makes one image per color and falls back to the theme color', async () => {
    const markup = svg('<circle fill="currentColor" r="4"/>');
    render(iconTool, drawing('icon', markup, { textColor: '#abcdef' }));
    render(iconTool, drawing('icon', markup, { textColor: '#abcdef' }));
    render(iconTool, drawing('icon', markup));
    expect(images.map((i) => decodeURIComponent(i.src))).toEqual([
      expect.stringContaining('fill="#abcdef"'),
      expect.stringContaining(`fill="${darkTheme.drawingSelected}"`),
    ]);
  });

  it('keeps a bounded number of icon images when the color changes on every frame', async () => {
    const markup = svg('<circle fill="currentColor" r="2"/>');
    const color = (i: number) => `#${i.toString(16).padStart(6, '0')}`;
    for (let i = 0; i < IMAGE_CACHE_LIMIT + 50; i++) {
      render(iconTool, drawing('icon', markup, { textColor: color(i) }));
      await settle();
    }
    expect(images).toHaveLength(IMAGE_CACHE_LIMIT + 50);
    // The latest colors are still cached; the first one was dropped and loads again.
    for (let i = 50; i < IMAGE_CACHE_LIMIT + 50; i++) render(iconTool, drawing('icon', markup, { textColor: color(i) }));
    expect(images).toHaveLength(IMAGE_CACHE_LIMIT + 50);
    render(iconTool, drawing('icon', markup, { textColor: color(0) }));
    expect(images).toHaveLength(IMAGE_CACHE_LIMIT + 51);
  });

  it('shows a crossed box when the markup does not decode', async () => {
    const markup = svg('<g id="broken"/>');
    render(iconTool, drawing('icon', markup));
    await settle();
    const failed = render(iconTool, drawing('icon', markup));
    expect(failed.named('drawImage')).toEqual([]);
    expect(failed.named('strokeRect')[0]).toEqual([-16, -16, 32, 32]);
    expect(failed.named('lineTo').length).toBeGreaterThanOrEqual(2);
  });

  it('puts the handles on the fitted box and sizes it from the corner', async () => {
    const markup = svg('<rect width="48" height="24"/>');
    render(iconTool, drawing('icon', markup));
    await settle();
    // 32 x 16 glyph: the box reaches 16 + 3 px to the side and 8 + 3 px down; the rotation handle 18 px above it.
    expect(iconTool.handles!(screen(drawing('icon', markup)), env())).toEqual([
      { x: 219, y: 111 },
      { x: 200, y: 71 },
    ]);
    for (const fontSize of [12, 40, 300]) {
      const [corner] = iconTool.handles!(screen(drawing('icon', markup, { fontSize, angle: 25 })), env());
      const moved = iconTool.moveHandle!(drawing('icon', markup, { angle: 25 }), 0, { time: 0, price: 0 }, corner!, env());
      expect((moved as { style: Drawing['style'] }).style).toEqual({ fontSize, angle: 25 });
    }
    expect(iconTool.hitTest(screen(drawing('icon', markup)), { x: 218, y: 100 }, env())).toBe(true);
    expect(iconTool.hitTest(screen(drawing('icon', markup)), { x: 200, y: 113 }, env())).toBe(false);
  });
});

describe('createStickerTool', () => {
  it('loads each reference once through the app and fits the image into its size', async () => {
    const tall = { width: 50, height: 100 } as unknown as CanvasImageSource;
    const load = vi.fn<ImageToolOptions['load']>(() => Promise.resolve(tall));
    const tool = createStickerTool({ load });
    expect(tool).toMatchObject({ type: 'sticker', group: 'annotate', points: 1, defaultStyle: { fontSize: 64 } });

    render(tool, drawing('sticker', '/rocket.png'));
    render(tool, drawing('sticker', '/rocket.png'));
    expect(load.mock.calls).toEqual([['/rocket.png']]);
    await settle();
    // 64 px tall, half as wide.
    expect(render(tool, drawing('sticker', '/rocket.png')).named('drawImage')).toEqual([[tall, -16, -32, 32, 64]]);
    expect(images).toEqual([]);
  });
});

describe('sticker tool in a chart', () => {
  function setup(ref: string) {
    const timeline = new Timeline();
    timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
    const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
    time.width = 1000;
    time.barCount = 100;
    const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
    pane.height = 500;
    pane.price.height = 500;
    pane.price.fit(0, 500);
    const host: DrawingHost = {
      theme: darkTheme,
      timeline,
      time,
      panes: [pane],
      magnetPrice: (_i, price) => price,
      formatPrice: (_p, price) => price.toFixed(2),
      requestOverlay: () => {},
      editText: (_at, _initial, done) => done(ref),
      emit: () => {},
      barSpan: () => ({ bars: [], start: 0, end: 0 }),
    };
    const manager = new DrawingManager(host);
    manager.register(createStickerTool({ load: () => ({ width: 10, height: 10 }) as unknown as CanvasImageSource }));
    return manager;
  }

  it('places with the prompted reference, resizes by its handle in one undo step and saves only the reference', () => {
    const manager = setup('sticker-7');
    manager.setTool('sticker');
    manager.pointerMove({ x: 510, y: 250 });
    manager.pointerDown(0, { x: 510, y: 250 });
    manager.pointerUp({ x: 510, y: 250 });
    const placed = manager.getAll()[0]!;
    expect(placed).toMatchObject({ type: 'sticker', text: 'sticker-7', style: { fontSize: 64 } });
    manager.select(placed.id);

    // Until the image loads the box is square: its corner sits 32 + 3 px right and down.
    manager.pointerMove({ x: 545, y: 285 });
    expect(manager.pointerDown(0, { x: 545, y: 285 })).toBe(true);
    manager.pointerMove({ x: 565, y: 305 });
    manager.pointerUp({ x: 565, y: 305 });
    expect(manager.getAll()[0]!.style).toEqual({ fontSize: 104 });
    expect(manager.getAll()[0]!.points).toEqual(placed.points);
    manager.undo();
    expect(manager.getAll()[0]!.style).toEqual({ fontSize: 64 });

    const saved = JSON.stringify(manager.serialize());
    expect(saved).toContain('"text":"sticker-7"');
    const other = setup('');
    other.load(JSON.parse(saved));
    expect(other.getAll()).toEqual(manager.getAll());
  });
});
