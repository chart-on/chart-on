import { describe, expect, it } from 'vitest';
import { drawingFont, labelPill, levelLines } from '../src/drawing/draw';
import { fibExtension, fibRetracement } from '../src/drawing/fibonacci';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import { datePriceRange, dateRange, longPosition } from '../src/drawing/measure-tools';
import { builtinTools, horizontalLine, text } from '../src/drawing/tools';
import type { DrawingEnv, DrawingStyle, DrawingTextStyle, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { darkTheme } from '../src/theme';
import { Timeline } from '../src/timeline';
import { withBuiltinTools } from './builtin-tools';

/** Bold text measures 20% wider, so a hit box built from the regular width falls short. */
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

interface DrawnText {
  text: string;
  font: unknown;
  color: unknown;
}

/** Canvas stand-in that records text draws with the font and color they used. */
function recorder() {
  const texts: DrawnText[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get: (target, key) => {
      if (key !== 'fillText') return key in target ? target[key] : () => {};
      return (t: string) => texts.push({ text: t, font: target.font, color: target.fillStyle });
    },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

function screen(type: string, style: DrawingStyle, points = [{ time: 600, price: 200 }, { time: 1800, price: 300 }], t?: string): ScreenDrawing {
  return {
    drawing: { id: 'x', type, pane: 0, points, style, text: t },
    points: points.map((p) => ({ x: p.time / 6, y: 400 - p.price })),
    selected: false,
    hovered: false,
  };
}

describe('drawingFont', () => {
  it('builds one CSS font from size, family, weight and slant', () => {
    expect(drawingFont(12, 'sans-serif')).toBe('12px sans-serif');
    expect(drawingFont(14, 'serif', { bold: true })).toBe('bold 14px serif');
    expect(drawingFont(14, 'serif', { italic: true })).toBe('italic 14px serif');
    expect(drawingFont(20, 'a, b', { bold: true, italic: true })).toBe('italic bold 20px a, b');
    expect(drawingFont(12, 'x', { bold: false, italic: false })).toBe('12px x');
  });
});

describe('text tool', () => {
  const draw = (style: DrawingStyle) => {
    const { ctx, texts } = recorder();
    text.render(ctx, screen('text', style, [{ time: 600, price: 200 }], 'Hello'), env);
    return texts[0]!;
  };

  it('draws bold, italic, its size and text color', () => {
    const t = draw({ fontSize: 20, bold: true, italic: true, textColor: '#123456', color: '#ff0000' });
    expect(t.font).toBe(`italic bold 20px ${darkTheme.fontFamily}`);
    expect(t.color).toBe('#123456');
  });

  it('falls back to color, then the theme, for older drawings', () => {
    expect(draw({ color: '#ff0000' }).color).toBe('#ff0000');
    expect(draw({}).color).toBe(darkTheme.drawingSelected);
    expect(draw({}).font).toBe(`14px ${darkTheme.fontFamily}`);
  });

  it('hit tests the width of the text as drawn', () => {
    const regular = screen('text', { fontSize: 20 }, [{ time: 600, price: 200 }], 'Hello');
    const bold = screen('text', { fontSize: 20, bold: true }, [{ time: 600, price: 200 }], 'Hello');
    // 'Hello' at 20px: 60px regular, 72px bold, from x = 100.
    const past = { x: 100 + 66, y: 210 };
    expect(text.hitTest(regular, past, env)).toBe(false);
    expect(text.hitTest(bold, past, env)).toBe(true);
  });
});

describe('labels', () => {
  it('honor the drawing text style on a horizontal line', () => {
    const { ctx, texts } = recorder();
    horizontalLine.render(ctx, screen('hline', { textColor: '#abcdef', fontSize: 16, bold: true }, [{ time: 600, price: 200 }]), env);
    expect(texts).toEqual([{ text: '200.00', font: `bold 16px ${darkTheme.fontFamily}`, color: '#abcdef' }]);
  });

  it('hide when showLabel is off', () => {
    const { ctx, texts } = recorder();
    horizontalLine.render(ctx, screen('hline', { showLabel: false }, [{ time: 600, price: 200 }]), env);
    expect(texts).toEqual([]);
    const fib = recorder();
    fibRetracement.render(fib.ctx, screen('fib-retracement', { showLabel: false }), env);
    expect(fib.texts).toEqual([]);
  });

  it('honor the text style on Fibonacci levels, measure and position tools', () => {
    const style: DrawingStyle = { italic: true, textColor: '#010203' };
    const font = `italic ${darkTheme.fontSize}px ${darkTheme.fontFamily}`;
    for (const [tool, points] of [
      [fibRetracement, undefined],
      [dateRange, undefined],
      [datePriceRange, undefined],
      [longPosition, [{ time: 600, price: 200 }, { time: 1800, price: 300 }, { time: 1800, price: 150 }]],
    ] as const) {
      const { ctx, texts } = recorder();
      tool.render(ctx, screen(tool.type, style, points ? [...points] : undefined), env);
      expect(texts.length, tool.type).toBeGreaterThan(0);
      for (const t of texts) expect([t.font, t.color], tool.type).toEqual([font, '#010203']);
    }
  });

  it('labelPill and levelLines take a text style for plugin tools', () => {
    const { ctx, texts } = recorder();
    const w = labelPill(ctx, env, 'abc', 0, 50, { color: '#fff', textStyle: { bold: true, fontSize: 10 } });
    expect(w).toBe(measureText('abc', 10, { bold: true }) + 10);
    levelLines(ctx, env, [{ y: 100, color: '#f00', label: 'L' }], 100, 300, { textColor: '#0f0' });
    expect(texts).toEqual([
      { text: 'abc', font: `bold 10px ${darkTheme.fontFamily}`, color: '#fff' },
      { text: 'L', font: `${darkTheme.fontSize}px ${darkTheme.fontFamily}`, color: '#0f0' },
    ]);
  });
});

describe('styleFields', () => {
  it('is declared by every built-in tool, with known fields only', () => {
    const known = new Set<string>([
      'color',
      'lineWidth',
      'lineStyle',
      'fill',
      'fontSize',
      'levels',
      'extendLeft',
      'extendRight',
      'showLabel',
      'labelSide',
      'labelContent',
      'showStats',
      'profitColor',
      'lossColor',
      'showFill',
      'bold',
      'italic',
      'textColor',
      'middleLine',
      'deviation',
      'rows',
      'valueArea',
      'profileWidth',
    ] satisfies (keyof DrawingStyle)[]);
    // The eraser and zoom box place nothing, so they have nothing to style.
    for (const tool of builtinTools.filter((t) => !t.action)) {
      expect(tool.styleFields?.length, tool.type).toBeGreaterThan(0);
      expect(tool.styleFields!.filter((f) => !known.has(f)), tool.type).toEqual([]);
    }
  });

  it('lists the text fields for every tool that draws text', () => {
    const { ctx, texts } = recorder();
    for (const tool of builtinTools) {
      texts.length = 0;
      const three = [{ time: 600, price: 200 }, { time: 1800, price: 300 }, { time: 1800, price: 150 }];
      tool.render(ctx, screen(tool.type, {}, tool.points === 1 ? [three[0]!] : three, 'T'), env);
      if (texts.length > 0) expect(tool.styleFields, tool.type).toEqual(expect.arrayContaining(['textColor', 'fontSize', 'bold', 'italic']));
    }
  });
});

describe('style fields round trip', () => {
  function manager() {
    const timeline = new Timeline();
    timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
    const host: DrawingHost = {
      theme: darkTheme,
      timeline,
      time: new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 }),
      panes: [new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 })],
      magnetPrice: (_i, price) => price,
      formatPrice: (_p, price) => String(price),
      requestOverlay: () => {},
      editText: (_at, _initial, done) => done(null),
      emit: () => {},
    };
    return withBuiltinTools(new DrawingManager(host));
  }

  it('keeps fill, font and level styles through serialize and load', () => {
    const style: DrawingStyle = {
      color: '#111111',
      fill: 'rgba(1, 2, 3, 0.5)',
      textColor: '#222222',
      fontSize: 18,
      bold: true,
      italic: true,
      showLabel: false,
      labelContent: 'percent',
      levels: [
        { value: 0, color: '#333333' },
        { value: 0.5, visible: false },
        { value: 1.618, color: '#444444', visible: true },
      ],
    };
    const a = manager();
    a.add({ type: 'fib-retracement', pane: 0, points: [{ time: 0, price: 1 }, { time: 600, price: 2 }], style });
    const saved = JSON.parse(JSON.stringify(a.serialize()));
    const b = manager();
    expect(b.load(saved).errors).toEqual([]);
    expect(b.getAll()[0]!.style).toEqual(style);
  });

  it('starts Fibonacci drawings from editable default levels', () => {
    const m = manager();
    const d = m.add({ type: 'fib-retracement', pane: 0, points: [{ time: 0, price: 1 }, { time: 600, price: 2 }], style: {} });
    expect(d.style.levels?.map((l) => l.value)).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
    // A copy: editing one drawing's levels leaves the next drawing alone.
    d.style.levels![0]!.color = '#ff0000';
    const next = m.add({ type: 'fib-retracement', pane: 0, points: [{ time: 0, price: 1 }, { time: 600, price: 2 }], style: {} });
    expect(next.style.levels![0]!.color).toBe('auto');
  });

  it('keeps labelSide through serialize and load, and rejects other values', () => {
    const points = [{ time: 0, price: 1 }, { time: 600, price: 2 }];
    const a = manager();
    a.add({ type: 'fib-retracement', pane: 0, points, style: { labelSide: 'right' } });
    const saved = JSON.parse(JSON.stringify(a.serialize()));
    const b = manager();
    expect(b.load(saved).errors).toEqual([]);
    expect(b.getAll()[0]!.style.labelSide).toBe('right');
    expect(() => a.add({ type: 'fib-retracement', pane: 0, points, style: { labelSide: 'top' as never } })).toThrow('Drawing "style.labelSide" must be "left" or "right"');
    saved.drawings[0].style.labelSide = 'top';
    const c = manager();
    expect(c.load(saved).errors).toEqual([{ index: 0, field: 'style.labelSide', reason: 'must be "left" or "right"' }]);
    expect(c.getAll()[0]!.style.labelSide).toBeUndefined();
  });

  it('keeps labelContent through serialize and load, and rejects other values', () => {
    const points = [{ time: 0, price: 1 }, { time: 600, price: 2 }];
    const a = manager();
    expect(a.add({ type: 'fib-retracement', pane: 0, points, style: {} }).style.labelContent).toBe('both');
    a.add({ type: 'gann-box', pane: 0, points, style: { labelContent: 'percent' } });
    const saved = JSON.parse(JSON.stringify(a.serialize()));
    const b = manager();
    expect(b.load(saved).errors).toEqual([]);
    expect(b.getAll().map((d) => d.style.labelContent)).toEqual(['both', 'percent']);
    const reason = 'must be "level", "price", "both" or "percent"';
    expect(() => a.add({ type: 'gann-box', pane: 0, points, style: { labelContent: 'ratio' as never } })).toThrow(`Drawing "style.labelContent" ${reason}`);
    saved.drawings[1].style.labelContent = 'ratio';
    const c = manager();
    expect(c.load(saved).errors).toEqual([{ index: 1, field: 'style.labelContent', reason }]);
    expect(c.getAll()[1]!.style.labelContent).toBeUndefined();
  });

  it('keeps unknown style keys named like Object members', () => {
    const style = JSON.parse('{"constructor": 1, "toString": "x", "hasOwnProperty": true}');
    const d = manager().add({ type: 'gann-box', pane: 0, points: [{ time: 0, price: 1 }, { time: 600, price: 2 }], style });
    expect(d.style).toMatchObject({ constructor: 1, toString: 'x', hasOwnProperty: true });
  });
});

describe('fib retracement label side', () => {
  /** x of every drawn label, in draw order. */
  function labelXs(style: DrawingStyle): number[] {
    const xs: number[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) => (key === 'fillText' ? (_t: string, x: number) => xs.push(x) : key in target ? target[key] : () => {}),
      set: (target, key, value) => ((target[key] = value), true),
    }) as unknown as CanvasRenderingContext2D;
    // Anchors at x 100 and 300.
    fibRetracement.render(ctx, screen('fib-retracement', style), env);
    return xs;
  }

  it('puts labels left of the drawing by default and right of it with labelSide right', () => {
    const left = labelXs({});
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((x) => x < 100)).toBe(true);
    expect(labelXs({ labelSide: 'left' })).toEqual(left);
    const right = labelXs({ labelSide: 'right' });
    expect(right).toHaveLength(left.length);
    expect(right.every((x) => x > 300)).toBe(true);
  });

  it('keeps right labels inside the pane when the levels extend to its edge', () => {
    const xs = labelXs({ labelSide: 'right', extendRight: true });
    expect(xs.length).toBeGreaterThan(0);
    expect(xs.every((x) => x > 300 && x < env.width)).toBe(true);
  });

  it('lists labelSide in the retracement and extension settings', () => {
    expect(fibRetracement.styleFields).toContain('labelSide');
    expect(fibExtension.styleFields).toContain('labelSide');
  });

  it('puts extension labels right of the drawing with labelSide right', () => {
    const xs: number[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) => (key === 'fillText' ? (_t: string, x: number) => xs.push(x) : key in target ? target[key] : () => {}),
      set: (target, key, value) => ((target[key] = value), true),
    }) as unknown as CanvasRenderingContext2D;
    const three = [{ time: 600, price: 200 }, { time: 1200, price: 300 }, { time: 1800, price: 250 }];
    fibExtension.render(ctx, screen('fib-extension', { labelSide: 'right' }, three), env);
    expect(xs.length).toBeGreaterThan(0);
    expect(xs.every((x) => x > 300)).toBe(true);
  });

  it('levelLines keeps right labels inside the pane when the right end is near its edge', () => {
    // Pill boxes as [x, width].
    const boxes: [number, number][] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) =>
        key === 'roundRect' ? (x: number, _y: number, w: number) => boxes.push([x, w]) : key in target ? target[key] : () => {},
      set: (target, key, value) => ((target[key] = value), true),
    }) as unknown as CanvasRenderingContext2D;
    // Short lines ending 100 px before the edge, less than the label is wide: the label moves left past them.
    levelLines(ctx, env, [{ y: 100, color: '#f00', label: 'A long level label' }], 690, 700, {}, 'right');
    const [x, w] = boxes[0]!;
    expect(w).toBeGreaterThan(100);
    expect(x).toBeLessThan(690);
    expect(x + w).toBeLessThanOrEqual(env.width);
  });

  it('levelLines keeps right labels over the lines when the pane has no room past them', () => {
    const xs: number[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) => (key === 'fillText' ? (_t: string, x: number) => xs.push(x) : key in target ? target[key] : () => {}),
      set: (target, key, value) => ((target[key] = value), true),
    }) as unknown as CanvasRenderingContext2D;
    levelLines(ctx, env, [{ y: 100, color: '#f00', label: 'Level' }], 600, env.width, {}, 'right');
    expect(xs[0]).toBeGreaterThan(600);
    expect(xs[0]).toBeLessThan(env.width);
  });
});
