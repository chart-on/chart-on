import { fillText } from '../typography';
import { drawingFont, drawingWeight } from './draw';
import { glyphTool } from './glyph';

/**
 * The `emoji` drawing tool: a glyph (the drawing's `text`, usually one emoji)
 * centred on its point, at a fixed size in css px (`fontSize`) and angle
 * (`angle`, degrees clockwise), so it reads the same at any zoom. While
 * selected, a corner handle sets the size and a handle above it the angle.
 * Not one of the built-in tools: register it to offer it.
 *
 * @example
 * ```ts
 * const chart = createChart(el, { plugins: [drawingTools([...builtinTools, emojiTool])] });
 * chart.drawings.add({ type: 'emoji', pane: 0, points: [point], style: { fontSize: 40, angle: -15 }, text: '🚀' });
 * ```
 */
export const emojiTool = /* @__PURE__ */ glyphTool(
  'emoji',
  'Emoji',
  32,
  ['fontSize', 'angle', 'textColor'],
  // Never narrower than tall.
  (drawing, env) => [Math.max(1, env.measureText(drawing.text ?? '', 100) / 100), 1],
  (ctx, d, env, _w, h) => {
    const s = d.drawing.style;
    ctx.font = drawingFont(h * 2, env.theme.fontFamily, {}, drawingWeight(env));
    // Color glyphs keep their own colors; plain characters take the text color.
    ctx.fillStyle = s.textColor ?? s.color ?? env.theme.drawingSelected;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fillText(ctx, d.drawing.text ?? '', 0, 0);
  },
);
