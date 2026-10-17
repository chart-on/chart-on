import { glyphTool } from './glyph';
import { imageCache, imageFrame, type ImageToolOptions } from './image-tool';
import type { Drawing, DrawingEnv, DrawingToolDef } from './types';
import { pixelSize } from '../util/image-size';

/** A drawing's image: loaded, `undefined` while it loads (`redraw` runs once it settles) or `null` when it failed. */
type Picture = (drawing: Drawing, env: DrawingEnv, redraw?: () => void) => CanvasImageSource | null | undefined;

/** Width over height of a loaded image; 1 while it loads, when it failed or has no size. */
function aspect(image: CanvasImageSource | null | undefined): number {
  const [w, h] = pixelSize(image);
  return w > 0 && h > 0 ? w / h : 1;
}

/** A glyph tool drawing `picture`'s image fitted into a square of the drawing's size, or its dashed box until it loads. */
function pictureTool(type: string, label: string, size: number, styleFields: readonly string[], picture: Picture): DrawingToolDef {
  return glyphTool(
    type,
    label,
    size,
    styleFields,
    (drawing, env) => {
      const a = aspect(picture(drawing, env));
      return a > 1 ? [1, 1 / a] : [a, 1];
    },
    (ctx, d, env, w, h) => {
      const shown = picture(d.drawing, env, env.redraw);
      if (shown) ctx.drawImage(shown, -w, -h, w * 2, h * 2);
      else imageFrame(ctx, d, env, { x: -w, y: -h, width: w * 2, height: h * 2 }, shown);
    },
  );
}

/**
 * An image of inline SVG markup. As an image the SVG runs no scripts and
 * loads nothing it references, and a data URL needs no request.
 */
function svgImage(svg: string): HTMLImageElement {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return image;
}

let icons: ReturnType<typeof imageCache> | undefined;

/**
 * The `icon` drawing tool: inline SVG markup from the app (the drawing's
 * `text`) drawn centred on its point, fitted into a square of `fontSize` css
 * px at `angle` degrees clockwise, so it reads the same at any zoom.
 * `currentColor` in the markup takes the text color. The SVG is drawn as an
 * image, never inserted into the page: scripts in it do not run and it loads
 * nothing it references. A strict content security policy needs `data:` in
 * `img-src`. While selected, a corner handle sets the size and a handle
 * above it the angle. Not one of the built-in tools: register it to offer it.
 *
 * @example
 * ```ts
 * const chart = createChart(el, { plugins: [drawingTools([...builtinTools, iconTool])] });
 * const star = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l3 7h7l-6 4 2 8-6-5-6 5 2-8-6-4h7z"/></svg>';
 * chart.drawings.add({ type: 'icon', pane: 0, points: [point], style: { fontSize: 24, textColor: '#e0a030' }, text: star });
 * ```
 */
export const iconTool = /* @__PURE__ */ pictureTool('icon', 'Icon', 32, ['fontSize', 'angle', 'textColor'], (drawing, env, redraw) => {
  const s = drawing.style;
  const svg = drawing.text?.replace(/currentColor/g, s.textColor ?? s.color ?? env.theme.drawingSelected);
  return svg ? (icons ??= imageCache(svgImage))(svg, redraw) : undefined;
});

/**
 * The `sticker` drawing tool: an image from the app centred on its point,
 * fitted into a square of `fontSize` css px at `angle` degrees clockwise, so
 * it reads the same at any zoom. Like `createImageTool`, a drawing keeps only
 * the app's reference to its image (its `text`), which `options.load` turns
 * into an image; the chart fetches nothing and saved drawings carry no image
 * bytes. Images are cached per reference for the life of the tool. While
 * selected, a corner handle sets the size and a handle above it the angle.
 * Not one of the built-in tools: register it to offer it.
 *
 * @example
 * ```ts
 * chart.drawings.register(createStickerTool({ load: (ref) => fetch(ref).then((r) => r.blob()) }));
 * chart.drawings.add({ type: 'sticker', pane: 0, points: [point], style: { fontSize: 96 }, text: '/stickers/rocket.png' });
 * ```
 */
export function createStickerTool(options: ImageToolOptions): DrawingToolDef {
  const image = imageCache(options.load);
  return pictureTool('sticker', 'Sticker', 64, ['fontSize', 'angle'], (drawing, _env, redraw) => (drawing.text ? image(drawing.text, redraw) : undefined));
}
