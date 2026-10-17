import { describe, expect, it } from 'vitest';
import { labelPill } from '../src/drawing/draw';
import { fibRetracement } from '../src/drawing/fibonacci';
import { infoLine, trendAngle } from '../src/drawing/line-tools';
import { barsText, priceRangeLabel } from '../src/drawing/measure-tools';
import { horizontalLine, measure } from '../src/drawing/tools';
import type { Drawing, DrawingEnv, DrawingStyle, ScreenDrawing } from '../src/drawing/types';
import { darkTheme, lightTheme } from '../src/theme';
import type { Point } from '../src/types';
import { contrastRatio } from '../src/util/color';
import { createLocalizer } from '../src/util/locale';

function env(overrides: Partial<DrawingEnv> = {}): DrawingEnv {
  return {
    width: 1000,
    height: 500,
    theme: darkTheme,
    pixelRatio: 1,
    formatPrice: (price) => price.toFixed(2),
    priceToY: (price) => 250 - price,
    yToPrice: (y) => 250 - y,
    timeToX: (time) => time,
    xToTime: (x) => x,
    barsBetween: () => 3,
    bars: () => [],
    measureText: (text, fontSize) => text.length * fontSize * 0.6,
    ...overrides,
  };
}

/** Screen drawing whose anchors sit at `points` (price = 250 - y, as in `env()`). */
function screen(type: string, points: Point[], style: DrawingStyle = {}): ScreenDrawing {
  const drawing: Drawing = { id: 'x', type, pane: 0, points: points.map((p) => ({ time: p.x, price: 250 - p.y })), style };
  return { drawing, points, selected: false, hovered: false };
}

/** Canvas stand-in that records each text with the fill it was written in. */
function recorder() {
  const texts: { text: string; color: unknown }[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get: (target, key) => {
      if (key === 'fillText') return (text: string) => texts.push({ text, color: target.fillStyle });
      return key in target ? target[key] : () => {};
    },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

// Picked for their luminance alone: a pale level color, where text in the light
// theme's white background would vanish, and a deep one, where the dark theme's would.
const PALE = '#f2e394';
const DEEP = '#1d3a6b';

describe('label pill text', () => {
  const cases = [
    ['a light level color in the light theme', PALE, lightTheme],
    ['a dark level color in the dark theme', DEEP, darkTheme],
  ] as const;

  it.each(cases)('contrasts with %s', (_name, color, theme) => {
    const e = env({ theme });
    const fib = recorder();
    fibRetracement.render(fib.ctx, screen('fib-retracement', [{ x: 100, y: 200 }, { x: 300, y: 50 }], { levels: [{ value: 0.5, color }] }), e);
    const line = recorder();
    horizontalLine.render(line.ctx, screen('hline', [{ x: 100, y: 120 }], { color }), e);
    const info = recorder();
    infoLine.render(info.ctx, screen('info-line', [{ x: 100, y: 200 }, { x: 300, y: 100 }], { color }), e);
    const angle = recorder();
    trendAngle.render(angle.ctx, screen('trend-angle', [{ x: 100, y: 200 }, { x: 300, y: 100 }], { color }), e);
    const plain = recorder();
    labelPill(plain.ctx, e, 'note', 10, 10, { background: color });
    const labels = [...fib.texts, ...line.texts, ...info.texts, ...angle.texts, ...plain.texts];
    expect(labels).toHaveLength(5);
    for (const t of labels) expect(contrastRatio(t.color as string, color), t.text).toBeGreaterThanOrEqual(4.5);
  });

  it('fall back to the theme background on a color that cannot be read', () => {
    // Outside a browser no canvas parses named colors, so contrastText cannot read 'red'.
    const { ctx, texts } = recorder();
    horizontalLine.render(ctx, screen('hline', [{ x: 100, y: 120 }], { color: 'red' }), env({ theme: lightTheme }));
    expect(texts).toEqual([{ text: '130.00', color: lightTheme.background }]);
  });
});

describe('measure', () => {
  const d = (from: number, to: number) => screen('measure', [{ x: 100, y: 250 - from }, { x: 200, y: 250 - to }]);

  it('writes its label in the locale, with the locale minus sign', () => {
    const swedish = createLocalizer({ locale: 'sv-SE' });
    const { ctx, texts } = recorder();
    measure.render(ctx, d(100, 90), env({ localization: swedish }));
    const format = (p: number) => p.toFixed(2);
    expect(texts.map((t) => t.text)).toEqual([`${priceRangeLabel(100, 90, format, swedish)} · ${barsText(3, swedish)}`]);
    expect(texts[0]!.text.startsWith(`${swedish.minusSign}10.00`)).toBe(true);
  });

  it('signs its percent by the move, also on negative prices', () => {
    const { ctx, texts } = recorder();
    // From -100 up to -90: a rise of 10, which is 10% of the price's size.
    measure.render(ctx, d(-100, -90), env());
    expect(texts[0]!.text).toBe('+10.00 (+10.00%) · 3 bars');
  });

  it('writes its label in black or white, whichever reads on its color', () => {
    for (const theme of [darkTheme, lightTheme]) {
      for (const [from, to, color] of [[100, 110, theme.up], [110, 100, theme.down]] as const) {
        const { ctx, texts } = recorder();
        measure.render(ctx, d(from, to), env({ theme }));
        expect(contrastRatio(texts[0]!.color as string, color)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
