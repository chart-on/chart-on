import { describe, expect, it } from 'vitest';
import { DrawingManager, type DrawingEvents, type DrawingHost } from '../src/drawing/manager';
import { anchoredNote, arrowDown, arrowLeft, arrowMarker, arrowRight, arrowUp, balloon, callout, comment, flag, note, priceLabel, priceNote, signpost } from '../src/drawing/marker-tools';
import { anchoredText, builtinTools, text } from '../src/drawing/tools';
import type { DrawingEnv, DrawingStyle, DrawingTextStyle, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { darkTheme, lightTheme } from '../src/theme';
import { Timeline } from '../src/timeline';
import { contrastText } from '../src/util/color';
import type { Point } from '../src/types';
import { installFakeDom } from './fake-dom';
import { withBuiltinTools } from './builtin-tools';

// The manager measures text on a canvas.
installFakeDom();

const measureText = (t: string, size: number, style?: DrawingTextStyle) => t.length * size * 0.6 * (style?.bold ? 1.2 : 1);

const env: DrawingEnv = {
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
  measureText,
};

/** Screen drawing whose data points sit under `points` in `env`'s projection. */
function screen(type: string, points: Point[], style: DrawingStyle = {}, text?: string): ScreenDrawing {
  return {
    drawing: { id: 'x', type, pane: 0, points: points.map((p) => ({ time: p.x * 6, price: 400 - p.y })), style, text },
    points,
    selected: false,
    hovered: false,
  };
}

interface Drawn {
  text: string;
  x: number;
  y: number;
  font: unknown;
  color: unknown;
}

/** Canvas stand-in that records text and fill colors. */
function recorder() {
  const texts: Drawn[] = [];
  const fills: unknown[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get: (target, key) => {
      if (key === 'fillText') return (t: string, x: number, y: number) => texts.push({ text: t, x, y, font: target.font, color: target.fillStyle });
      if (key === 'fill') return () => fills.push(target.fillStyle);
      return key in target ? target[key] : () => {};
    },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, fills };
}

describe('callout', () => {
  // 'Hello' at 14 px measures 42 px: a 58 x 30.2 box centered on (300, 100).
  const d = (style: DrawingStyle = { fontSize: 14 }, text = 'Hello') => screen('callout', [{ x: 100, y: 300 }, { x: 300, y: 100 }], style, text);

  it('centers its box on the second point', () => {
    const box = callout.bounds!(d(), env)!;
    expect([box.x, box.width]).toEqual([271, 58]);
    expect(box.y).toBeCloseTo(84.9);
    expect(box.height).toBeCloseTo(30.2);
  });

  it('hits the box and the pointer line, not the space around them', () => {
    expect(callout.hitTest(d(), { x: 320, y: 110 }, env)).toBe(true);
    expect(callout.hitTest(d(), { x: 200, y: 200 }, env)).toBe(true);
    expect(callout.hitTest(d(), { x: 200, y: 260 }, env)).toBe(false);
    expect(callout.hitTest(d(), { x: 340, y: 100 }, env)).toBe(false);
  });

  it('grows with bold text and extra lines', () => {
    const plain = callout.bounds!(d(), env)!;
    const bold = callout.bounds!(d({ fontSize: 14, bold: true }), env)!;
    const two = callout.bounds!(d({ fontSize: 14 }, 'Hello\nworld'), env)!;
    expect(bold.width).toBeGreaterThan(plain.width);
    expect(two.height).toBeCloseTo(plain.height + 14 * 1.3);
  });

  it('draws each line in the drawing font, over an opaque box', () => {
    const { ctx, texts, fills } = recorder();
    callout.render(ctx, d({ fontSize: 16, italic: true, textColor: '#123456' }, 'a\nb'), env);
    expect(texts.map((t) => [t.text, t.font, t.color])).toEqual([
      ['a', `italic 16px ${darkTheme.fontFamily}`, '#123456'],
      ['b', `italic 16px ${darkTheme.fontFamily}`, '#123456'],
    ]);
    expect(texts[1]!.y - texts[0]!.y).toBeCloseTo(16 * 1.3);
    // The theme background first, so the tint never lets the series show through.
    expect(fills[0]).toBe(darkTheme.background);
  });

  it('colors its text like the text tool in either theme', () => {
    for (const theme of [darkTheme, lightTheme]) {
      const { ctx, texts } = recorder();
      callout.render(ctx, d({}), { ...env, theme });
      expect(texts[0]!.color).toBe(theme.drawingSelected);
      expect(texts[0]!.font).toBe(`14px ${theme.fontFamily}`);
    }
    const { ctx, texts } = recorder();
    callout.render(ctx, d({ color: '#ff0000' }), env);
    expect(texts[0]!.color).toBe('#ff0000');
  });

  it('keeps a usable box before it has text', () => {
    const box = callout.bounds!(d({ fontSize: 14 }, ''), env)!;
    expect(box.width).toBeGreaterThanOrEqual(14 * 3);
  });
});

describe('comment and balloon', () => {
  // 'Hello' at 14 px measures 42 px; a line box is 30.2 px high, its tail 10 px.
  const d = (type: string, style: DrawingStyle = { fontSize: 14 }, text = 'Hello') => screen(type, [{ x: 100, y: 200 }], style, text);

  it('sit above their point, the tail reaching down to it', () => {
    const c = comment.bounds!(d('comment'), env)!;
    expect([c.x, c.width]).toEqual([92, 58]);
    expect(c.y).toBeCloseTo(159.8);
    expect(c.y + c.height).toBeCloseTo(200);
    // A rounded bubble is centered on the point and pads its text by its radius.
    const b = balloon.bounds!(d('balloon'), env)!;
    expect(b.width).toBeCloseTo(42 + 30.2);
    expect(b.x + b.width / 2).toBeCloseTo(100);
    expect(b.y + b.height).toBeCloseTo(200);
  });

  it('hit the bubble and the tail, not the space beside the tail', () => {
    for (const tool of [comment, balloon]) {
      expect(tool.hitTest(d(tool.type), { x: 120, y: 175 }, env), tool.type).toBe(true);
      expect(tool.hitTest(d(tool.type), { x: 101, y: 197 }, env), tool.type).toBe(true);
      expect(tool.hitTest(d(tool.type), { x: 140, y: 197 }, env), tool.type).toBe(false);
      expect(tool.hitTest(d(tool.type), { x: 100, y: 210 }, env), tool.type).toBe(false);
    }
  });

  it('grow with their text and keep room for the tail without it', () => {
    const one = comment.bounds!(d('comment'), env)!;
    const two = comment.bounds!(d('comment', { fontSize: 14 }, 'Hello\nworld'), env)!;
    expect(two.height).toBeCloseTo(one.height + 14 * 1.3);
    expect(two.y + two.height).toBeCloseTo(200);
    expect(comment.bounds!(d('comment', { fontSize: 14 }, ''), env)!.width).toBeGreaterThanOrEqual(14 * 3);
    expect(balloon.bounds!(d('balloon', { fontSize: 14 }, ''), env)!.width).toBeGreaterThanOrEqual(30.2 + 10);
  });

  it('write each line over an opaque bubble in either theme', () => {
    for (const theme of [darkTheme, lightTheme]) {
      for (const tool of [comment, balloon]) {
        const { ctx, texts, fills } = recorder();
        tool.render(ctx, d(tool.type, { fontSize: 14 }, 'a\nb'), { ...env, theme });
        expect(fills[0], tool.type).toBe(theme.background);
        expect(texts.map((t) => [t.text, t.color, t.font])).toEqual([
          ['a', theme.drawingSelected, `14px ${theme.fontFamily}`],
          ['b', theme.drawingSelected, `14px ${theme.fontFamily}`],
        ]);
      }
    }
    const { ctx, texts } = recorder();
    balloon.render(ctx, d('balloon', { fontSize: 14, color: '#ff0000', bold: true }), env);
    expect([texts[0]!.color, texts[0]!.font]).toEqual(['#ff0000', `bold 14px ${darkTheme.fontFamily}`]);
  });
});

describe('price note', () => {
  // Anchor at (100, 300), price 100.00; the note centered on (300, 100).
  const d = (text?: string, style: DrawingStyle = { fontSize: 14 }) => screen('price-note', [{ x: 100, y: 300 }, { x: 300, y: 100 }], style, text);

  it("shows the anchor's price above its optional text", () => {
    const plain = recorder();
    priceNote.render(plain.ctx, d(), env);
    expect(plain.texts.map((t) => t.text)).toEqual(['100.00']);
    const noted = recorder();
    priceNote.render(noted.ctx, d('Support\nheld twice'), env);
    expect(noted.texts.map((t) => t.text)).toEqual(['100.00', 'Support', 'held twice']);
    expect(priceNote.bounds!(d('Support'), env)!.height).toBeCloseTo(priceNote.bounds!(d(), env)!.height + 14 * 1.3);
  });

  it('centers its note on the second point and hits the note and the connector', () => {
    const box = priceNote.bounds!(d(), env)!;
    expect(box.x + box.width / 2).toBeCloseTo(300);
    expect(box.y + box.height / 2).toBeCloseTo(100);
    expect(priceNote.hitTest(d(), { x: 300, y: 100 }, env)).toBe(true);
    expect(priceNote.hitTest(d(), { x: 200, y: 200 }, env)).toBe(true);
    expect(priceNote.hitTest(d(), { x: 200, y: 260 }, env)).toBe(false);
  });

  it('marks its anchor with a dot of the drawing color, under an opaque note', () => {
    const { ctx, fills } = recorder();
    priceNote.render(ctx, d(undefined, { color: '#abcdef' }), env);
    expect(fills.slice(0, 2)).toEqual(['#abcdef', darkTheme.background]);
  });
});

describe('price label', () => {
  const d = (style: DrawingStyle = {}) => screen('price-label', [{ x: 100, y: 150 }], style);

  it('shows the price of its anchor in the label style', () => {
    const { ctx, texts, fills } = recorder();
    priceLabel.render(ctx, d({ bold: true }), env);
    expect(texts).toEqual([expect.objectContaining({ text: '250.00', font: `bold ${darkTheme.fontSize}px ${darkTheme.fontFamily}`, color: contrastText(darkTheme.drawing) })]);
    expect(fills).toEqual([darkTheme.drawing]);
    const styled = recorder();
    priceLabel.render(styled.ctx, d({ color: '#00ff00', textColor: '#000000', fontSize: 16 }), env);
    expect(styled.texts[0]).toMatchObject({ font: `16px ${darkTheme.fontFamily}`, color: '#000000' });
    expect(styled.fills).toEqual(['#00ff00']);
  });

  it('points its tip at the anchor with the tag to the right', () => {
    // '250.00' at 12 px: 43.2 + 10 wide, 20 high, after a 10 px tip.
    const box = priceLabel.bounds!(d(), env)!;
    expect([box.x, box.y, box.height]).toEqual([100, 140, 20]);
    expect(box.width).toBeCloseTo(63.2);
    expect(priceLabel.hitTest(d(), { x: 102, y: 150 }, env)).toBe(true);
    expect(priceLabel.hitTest(d(), { x: 160, y: 145 }, env)).toBe(true);
    expect(priceLabel.hitTest(d(), { x: 90, y: 150 }, env)).toBe(false);
    expect(priceLabel.hitTest(d(), { x: 130, y: 170 }, env)).toBe(false);
  });
});

describe('arrows', () => {
  it('arrow marker hits along its length only', () => {
    const d = screen('arrow-marker', [{ x: 100, y: 100 }, { x: 200, y: 100 }]);
    expect(arrowMarker.hitTest(d, { x: 150, y: 106 }, env)).toBe(true);
    expect(arrowMarker.hitTest(d, { x: 198, y: 92 }, env)).toBe(true);
    expect(arrowMarker.hitTest(d, { x: 150, y: 115 }, env)).toBe(false);
    expect(arrowMarker.hitTest(d, { x: 220, y: 100 }, env)).toBe(false);
  });

  it('arrow marker bounds cover its head', () => {
    const d = screen('arrow-marker', [{ x: 200, y: 100 }, { x: 100, y: 100 }]);
    expect(arrowMarker.bounds!(d, env)).toEqual({ x: 91, y: 91, width: 118, height: 18 });
  });

  it('one-point arrows sit behind their tip', () => {
    const at = { x: 100, y: 100 };
    expect(arrowUp.bounds!(screen('arrow-up', [at]), env)).toEqual({ x: 91, y: 100, width: 18, height: 24 });
    expect(arrowDown.bounds!(screen('arrow-down', [at]), env)).toEqual({ x: 91, y: 76, width: 18, height: 24 });
    expect(arrowLeft.bounds!(screen('arrow-left', [at]), env)).toEqual({ x: 100, y: 91, width: 24, height: 18 });
    expect(arrowRight.bounds!(screen('arrow-right', [at]), env)).toEqual({ x: 76, y: 91, width: 24, height: 18 });
    expect(arrowUp.hitTest(screen('arrow-up', [at]), { x: 100, y: 120 }, env)).toBe(true);
    expect(arrowUp.hitTest(screen('arrow-up', [at]), { x: 100, y: 80 }, env)).toBe(false);
  });

  it('fill with the drawing color', () => {
    for (const tool of [arrowMarker, arrowUp, arrowLeft]) {
      const { ctx, fills } = recorder();
      tool.render(ctx, screen(tool.type, [{ x: 100, y: 100 }, { x: 200, y: 50 }], { color: '#abcdef' }), env);
      expect(fills, tool.type).toEqual(['#abcdef']);
    }
    const { ctx, fills } = recorder();
    arrowRight.render(ctx, screen('arrow-right', [{ x: 100, y: 100 }]), env);
    expect(fills).toEqual([darkTheme.drawing]);
  });

  it("up and down arrows default to the theme's rising and falling colors", () => {
    expect([arrowUp.themeColor, arrowDown.themeColor, arrowLeft.themeColor]).toEqual(['up', 'down', undefined]);
    for (const theme of [darkTheme, lightTheme]) {
      for (const [tool, color] of [[arrowUp, theme.up], [arrowDown, theme.down]] as const) {
        const { ctx, fills } = recorder();
        tool.render(ctx, screen(tool.type, [{ x: 100, y: 100 }]), { ...env, theme });
        expect(fills, tool.type).toEqual([color]);
      }
    }
    // An arrow saved with a color of its own keeps it.
    const { ctx, fills } = recorder();
    arrowUp.render(ctx, screen('arrow-up', [{ x: 100, y: 100 }], { color: '#16a07a' }), env);
    expect(fills).toEqual(['#16a07a']);
  });
});

describe('flag', () => {
  const d = (style: DrawingStyle = {}, text?: string) => screen('flag', [{ x: 100, y: 150 }], style, text);

  it('stands on its point, with a cloth sized to its text', () => {
    // A 12 px label: 20 px high; a 20 px square plus the 5 px notch without text.
    expect(flag.bounds!(d(), env)).toEqual({ x: 100, y: 120, width: 25, height: 30 });
    // 'Earnings' at 12 px measures 57.6 px, plus 10 px of padding.
    expect(flag.bounds!(d({}, 'Earnings'), env)!.width).toBeCloseTo(72.6);
  });

  it('hits the pole and the cloth, not the space beside them', () => {
    expect(flag.hitTest(d(), { x: 101, y: 145 }, env)).toBe(true);
    expect(flag.hitTest(d(), { x: 120, y: 125 }, env)).toBe(true);
    expect(flag.hitTest(d(), { x: 120, y: 148 }, env)).toBe(false);
    expect(flag.hitTest(d(), { x: 90, y: 135 }, env)).toBe(false);
    expect(flag.hitTest(d(), { x: 100, y: 160 }, env)).toBe(false);
  });

  it('writes its text on a cloth of the drawing color in either theme', () => {
    for (const theme of [darkTheme, lightTheme]) {
      const { ctx, texts, fills } = recorder();
      flag.render(ctx, d({}, 'Earnings'), { ...env, theme });
      expect(fills).toEqual([theme.drawing]);
      expect(texts).toEqual([expect.objectContaining({ text: 'Earnings', color: contrastText(theme.drawing), y: 130.5 })]);
    }
    const { ctx, texts, fills } = recorder();
    flag.render(ctx, d({ color: '#abcdef', textColor: '#000000', bold: true }, 'Q3'), env);
    expect(fills).toEqual(['#abcdef']);
    expect(texts[0]).toMatchObject({ color: '#000000', font: `bold ${darkTheme.fontSize}px ${darkTheme.fontFamily}` });
    const plain = recorder();
    flag.render(plain.ctx, d(), env);
    expect(plain.texts).toEqual([]);
  });
});

describe('signpost', () => {
  const d = (style: DrawingStyle = {}, text?: string) => screen('signpost', [{ x: 100, y: 150 }], style, text);

  it('stands on its point, with a sign centered on top of the post', () => {
    // A 12 px label: a 20 px knob without text, its middle 36 px above the point, and the 2.5 px foot below it.
    expect(signpost.bounds!(d(), env)).toEqual({ x: 90, y: 104, width: 20, height: 48.5 });
    // 'Earnings' at 12 px measures 57.6 px, plus 10 px of padding.
    const box = signpost.bounds!(d({}, 'Earnings'), env)!;
    expect(box.width).toBeCloseTo(67.6);
    expect(box.x + box.width / 2).toBeCloseTo(100);
  });

  it('hits the post and the sign, not the space beside them', () => {
    expect(signpost.hitTest(d(), { x: 101, y: 135 }, env)).toBe(true);
    expect(signpost.hitTest(d(), { x: 100, y: 110 }, env)).toBe(true);
    expect(signpost.hitTest(d({}, 'Earnings'), { x: 130, y: 114 }, env)).toBe(true);
    expect(signpost.hitTest(d(), { x: 130, y: 114 }, env)).toBe(false);
    expect(signpost.hitTest(d(), { x: 115, y: 140 }, env)).toBe(false);
    expect(signpost.hitTest(d(), { x: 100, y: 160 }, env)).toBe(false);
  });

  it('writes its text centered on a sign of the drawing color in either theme', () => {
    for (const theme of [darkTheme, lightTheme]) {
      const { ctx, texts, fills } = recorder();
      signpost.render(ctx, d({}, 'Exit'), { ...env, theme });
      expect(fills).toEqual([theme.drawing]);
      expect(texts).toEqual([expect.objectContaining({ text: 'Exit', x: 100, y: 114.5, color: contrastText(theme.drawing) })]);
    }
    const { ctx, texts, fills } = recorder();
    signpost.render(ctx, d({ color: '#abcdef', textColor: '#000000', italic: true }, 'Q3'), env);
    expect(fills).toEqual(['#abcdef']);
    expect(texts[0]).toMatchObject({ color: '#000000', font: `italic ${darkTheme.fontSize}px ${darkTheme.fontFamily}` });
    const plain = recorder();
    signpost.render(plain.ctx, d(), env);
    expect(plain.texts).toEqual([]);
  });
});

describe('notes', () => {
  it('puts the box top-left corner on the point, one line per line of text', () => {
    for (const tool of [note, anchoredNote]) {
      const d = screen(tool.type, [{ x: 100, y: 50 }], { fontSize: 10 }, 'Hello\nworld');
      // Two lines of 13 px plus 6 px padding above and below; 'Hello' is 30 px wide plus 8 px each side.
      expect(tool.bounds!(d, env)).toEqual({ x: 100, y: 50, width: 46, height: 38 });
      expect(tool.hitTest(d, { x: 140, y: 80 }, env)).toBe(true);
      expect(tool.hitTest(d, { x: 160, y: 80 }, env)).toBe(false);
    }
  });

  it('pins the anchored tools to the pane and the others to time and price', () => {
    expect([note, anchoredNote, text, anchoredText].map((t) => t.anchoring)).toEqual(['data', 'screen', 'data', 'screen']);
  });

  it('draws an opaque tinted box with the text inside', () => {
    const { ctx, texts, fills } = recorder();
    note.render(ctx, screen('note', [{ x: 100, y: 50 }], { fontSize: 10, fill: '#112233' }, 'Hi'), env);
    expect(fills).toEqual([darkTheme.background, '#112233']);
    expect(texts.map((t) => t.text)).toEqual(['Hi']);
  });
});

describe('registration', () => {
  it('ships the tools in the annotate group', () => {
    const groupOf = (type: string) => builtinTools.find((t) => t.type === type)?.group;
    expect(['anchored-text', 'note', 'anchored-note'].map(groupOf)).toEqual(Array(3).fill('annotate'));
    expect(['callout', 'comment', 'balloon', 'price-label', 'price-note'].map(groupOf)).toEqual(Array(5).fill('annotate'));
    expect(['arrow-marker', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'flag', 'signpost'].map(groupOf)).toEqual(Array(7).fill('annotate'));
  });
});

// x = (index - 99) * 10 + 1000, time = index * 60, price = 500 - y (see drawing.test.ts).
function setup(text: string | null = 'Note', events: { name: keyof DrawingEvents; payload: unknown }[] = []) {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = 100;
  const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  pane.height = 500;
  pane.price.height = 500;
  pane.price.fit(0, 500);
  const edits: Point[] = [];
  const host: DrawingHost = {
    theme: darkTheme,
    timeline,
    time,
    panes: [pane],
    magnetPrice: (_i, price) => price,
    formatPrice: (_p, price) => price.toFixed(2),
    requestOverlay: () => {},
    editText: (at, _initial, done) => {
      edits.push(at);
      done(text);
    },
    emit: (name, payload) => events.push({ name, payload }),
  };
  return { m: withBuiltinTools(new DrawingManager(host)), edits, time };
}

function place(m: DrawingManager, type: string, ...points: Point[]) {
  m.setTool(type);
  for (const p of points) {
    m.pointerDown(0, p);
    m.pointerUp(p);
  }
}

describe('marker tools in the manager', () => {
  it('places a callout and edits its text at the box', () => {
    const { m, edits } = setup('Breakout');
    place(m, 'callout', { x: 200, y: 300 }, { x: 300, y: 200 });
    const [c] = m.getAll();
    expect(c).toMatchObject({ type: 'callout', text: 'Breakout', points: [{ time: 1140, price: 200 }, { time: 1740, price: 300 }] });
    expect(edits).toEqual([{ x: 300, y: 200 }]);
  });

  it('drops a callout left without text', () => {
    const { m } = setup(null);
    place(m, 'callout', { x: 200, y: 300 }, { x: 300, y: 200 });
    expect(m.getAll()).toEqual([]);
  });

  it('pins a flag and a signpost to the nearest bar in one click and asks for their text', () => {
    const { m, edits } = setup('Exit');
    place(m, 'flag', { x: 203, y: 300 });
    place(m, 'signpost', { x: 297, y: 250 });
    expect(m.getAll()).toEqual([
      expect.objectContaining({ type: 'flag', points: [{ time: 1140, price: 200 }], text: 'Exit' }),
      expect.objectContaining({ type: 'signpost', points: [{ time: 1740, price: 250 }], text: 'Exit' }),
    ]);
    expect(edits).toEqual([
      { x: 200, y: 300 },
      { x: 300, y: 250 },
    ]);
  });

  it('keeps a new flag or signpost left without text, as one undo step', () => {
    for (const text of [null, '', '  ']) {
      const { m } = setup(text);
      place(m, 'signpost', { x: 200, y: 300 });
      place(m, 'flag', { x: 300, y: 300 });
      expect(m.getAll().map((d) => [d.type, d.text])).toEqual([
        ['signpost', undefined],
        ['flag', undefined],
      ]);
      m.undo();
      expect(m.getAll().map((d) => d.type)).toEqual(['signpost']);
    }
  });

  it('edits a signpost text on double click; an empty entry clears it and a cancel keeps it', () => {
    const add = (m: DrawingManager, text?: string) => m.add({ type: 'signpost', pane: 0, points: [{ time: 1140, price: 200 }], style: {}, ...(text ? { text } : {}) });
    // The sign's middle sits 36 px above the point at (200, 300).
    const sign = { x: 200, y: 264 };
    const renamed = setup('Target');
    add(renamed.m, 'Exit');
    expect(renamed.m.doubleClick(sign)).toBe(true);
    expect(renamed.m.getAll()[0]!.text).toBe('Target');

    const cleared = setup(' ');
    add(cleared.m, 'Exit');
    cleared.m.doubleClick(sign);
    expect(cleared.m.getAll()[0]!.text).toBe('');
    cleared.m.undo();
    expect(cleared.m.getAll()[0]!.text).toBe('Exit');

    const events: { name: keyof DrawingEvents; payload: unknown }[] = [];
    const cancelled = setup(null, events);
    add(cancelled.m, 'Exit');
    const blank = setup('', events);
    add(blank.m);
    events.length = 0;
    cancelled.m.doubleClick(sign);
    blank.m.doubleClick(sign);
    expect(cancelled.m.getAll()[0]!.text).toBe('Exit');
    expect(events.filter((e) => e.name === 'drawing:update')).toEqual([]);
  });

  it('places one-point tools in one click and two-point arrows in two', () => {
    const { m } = setup();
    place(m, 'price-label', { x: 100, y: 250 });
    place(m, 'arrow-up', { x: 200, y: 300 });
    place(m, 'arrow-marker', { x: 300, y: 300 }, { x: 400, y: 200 });
    expect(m.getAll().map((d) => [d.type, d.points.length])).toEqual([
      ['price-label', 1],
      ['arrow-up', 1],
      ['arrow-marker', 2],
    ]);
    // The arrow keeps no color of its own, so it follows the theme.
    expect(m.getAll()[1]!.style.color).toBeUndefined();
  });

  it('drags a price label by its tag', () => {
    const { m } = setup();
    m.add({ type: 'price-label', pane: 0, points: [{ time: 540, price: 250 }], style: {} });
    // Anchor at (100, 250); grab the tag right of it and drag 20 px up.
    m.pointerDown(0, { x: 130, y: 250 });
    m.pointerMove({ x: 130, y: 230 });
    m.pointerUp({ x: 130, y: 230 });
    expect(m.getAll()[0]!.points[0]!.price).toBeCloseTo(270);
  });

  it('selects a callout by its box', () => {
    const { m } = setup();
    const d = m.add({ type: 'callout', pane: 0, points: [{ time: 1140, price: 200 }, { time: 1740, price: 300 }], style: {}, text: 'Hi' });
    m.pointerDown(0, { x: 310, y: 205 });
    m.pointerUp({ x: 310, y: 205 });
    expect(m.selected?.id).toBe(d.id);
  });

  it('places a comment or balloon in one click and edits its text', () => {
    for (const type of ['comment', 'balloon']) {
      const { m, edits } = setup('Watch this');
      place(m, type, { x: 200, y: 300 });
      expect(m.getAll(), type).toEqual([expect.objectContaining({ type, text: 'Watch this', points: [{ time: 1140, price: 200 }] })]);
      expect(edits).toEqual([{ x: 200, y: 300 }]);
      const dropped = setup(null);
      place(dropped.m, type, { x: 200, y: 300 });
      expect(dropped.m.getAll(), type).toEqual([]);
    }
  });

  it('places notes and anchored text in one click; the anchored ones stay put while the chart scrolls', () => {
    const { m, edits, time } = setup('Read me');
    const at = { x: 200, y: 300 };
    place(m, 'note', at);
    place(m, 'anchored-note', at);
    place(m, 'anchored-text', at);
    expect(edits).toEqual([at, at, at]);
    expect(m.getAll()).toEqual([
      expect.objectContaining({ type: 'note', text: 'Read me', points: [{ time: 1140, price: 200 }] }),
      // Pane fractions: x 200 of 1000, y 300 of 500.
      expect.objectContaining({ type: 'anchored-note', text: 'Read me', points: [{ time: 0.2, price: 0.6 }] }),
      expect.objectContaining({ type: 'anchored-text', text: 'Read me', points: [{ time: 0.2, price: 0.6 }] }),
    ]);
    const click = (p: Point) => {
      m.pointerDown(0, p);
      m.pointerUp(p);
      return m.selected?.type;
    };
    m.remove(m.getAll()[2]!.id);
    m.remove(m.getAll()[1]!.id);
    expect(click({ x: 205, y: 305 })).toBe('note');
    m.undo();
    time.pan(200);
    // Inside both notes before the pan; only the pinned one is still there after it.
    expect(click({ x: 205, y: 305 })).toBe('anchored-note');
    m.remove(m.getAll()[1]!.id);
    expect(click({ x: 205, y: 305 })).toBeUndefined();
  });

  it('stops an anchored note dragged past the right or bottom edge with its whole box on the pane', () => {
    const { m } = setup();
    m.add({ type: 'anchored-note', pane: 0, points: [{ time: 0.5, price: 0.5 }], style: {}, text: 'Pinned' });
    m.select(m.getAll()[0]!.id);
    m.pointerDown(0, { x: 530, y: 265 });
    m.pointerMove({ x: 1400, y: 900 });
    m.pointerUp({ x: 1400, y: 900 });
    const { time, price } = m.getAll()[0]!.points[0]!;
    // The box is at least 3 font sizes plus padding wide (58 px) and one line plus padding tall (30.2 px).
    expect(time * 1000).toBeLessThanOrEqual(1000 - 58);
    expect(price * 500).toBeCloseTo(500 - 14 * 1.3 - 12);
  });

  it('stops an anchored text dragged past the right or bottom edge with its whole box on the pane', () => {
    const { m } = setup();
    m.add({ type: 'anchored-text', pane: 0, points: [{ time: 0.5, price: 0.5 }], style: {}, text: 'Pinned' });
    m.select(m.getAll()[0]!.id);
    m.pointerDown(0, { x: 530, y: 260 });
    m.pointerMove({ x: 1400, y: 900 });
    m.pointerUp({ x: 1400, y: 900 });
    const { time, price } = m.getAll()[0]!.points[0]!;
    // The box runs 3 px past the text on each side; the test canvas measures 6 px a letter, and the font is 14 px.
    expect(time * 1000).toBeCloseTo(1000 - 6 * 6 - 3);
    expect(price * 500).toBeCloseTo(500 - 14 - 3);
  });

  it('keeps a price note left without text, and its price follows the anchor', () => {
    const { m, edits } = setup(null);
    place(m, 'price-note', { x: 200, y: 300 }, { x: 300, y: 200 });
    expect(m.getAll()).toEqual([expect.objectContaining({ type: 'price-note', points: [{ time: 1140, price: 200 }, { time: 1740, price: 300 }] })]);
    expect(m.getAll()[0]!.text).toBeUndefined();
    expect(edits).toEqual([{ x: 300, y: 200 }]);
    // Drag the anchor 20 px up: its price, which the note shows, moves with it.
    m.select(m.getAll()[0]!.id);
    m.pointerDown(0, { x: 200, y: 300 });
    m.pointerMove({ x: 200, y: 280 });
    m.pointerUp({ x: 200, y: 280 });
    expect(m.getAll()[0]!.points[0]!.price).toBeCloseTo(220);
    expect(m.undo()).toBe(true);
    expect(m.getAll()[0]!.points[0]!.price).toBeCloseTo(200);
  });

  it('round-trips every new tool through serialize and load', () => {
    const { m } = setup();
    const two = [{ time: 1140, price: 200 }, { time: 1740, price: 300 }];
    m.add({ type: 'callout', pane: 0, points: two, style: { fill: '#112233', bold: true }, text: 'Line 1\nLine 2' });
    m.add({ type: 'price-label', pane: 0, points: [two[0]!], style: { textColor: '#ffffff' } });
    m.add({ type: 'arrow-marker', pane: 0, points: two, style: { color: '#445566' } });
    for (const type of ['arrow-up', 'arrow-down', 'arrow-left', 'arrow-right']) m.add({ type, pane: 0, points: [two[1]!], style: {} });
    m.add({ type: 'flag', pane: 0, points: [two[0]!], style: { color: '#778899' }, text: 'Earnings' });
    m.add({ type: 'signpost', pane: 0, points: [two[1]!], style: { bold: true }, text: 'Exit' });
    m.add({ type: 'signpost', pane: 0, points: [two[0]!], style: {} });
    m.add({ type: 'comment', pane: 0, points: [two[0]!], style: { fill: '#223344' }, text: 'Look' });
    m.add({ type: 'balloon', pane: 0, points: [two[1]!], style: { italic: true }, text: 'Up\nand away' });
    m.add({ type: 'price-note', pane: 0, points: two, style: { color: '#556677' }, text: 'Support' });
    m.add({ type: 'price-note', pane: 0, points: two, style: {} });
    m.add({ type: 'note', pane: 0, points: [two[0]!], style: { fill: '#334455' }, text: 'Plan\nB' });
    m.add({ type: 'anchored-note', pane: 0, points: [{ time: 0.1, price: 0.2 }], style: { bold: true }, text: 'Pinned' });
    m.add({ type: 'anchored-text', pane: 0, points: [{ time: 0.9, price: 0.8 }], style: {}, text: 'Corner' });
    const saved = JSON.parse(JSON.stringify(m.serialize()));
    const copy = setup().m;
    expect(copy.load(saved).errors).toEqual([]);
    expect(copy.getAll()).toEqual(m.getAll());
    expect(copy.serialize()).toEqual(m.serialize());
  });
});
