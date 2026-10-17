import { describe, expect, it } from 'vitest';
import { fibArcs, fibChannel, fibCircles, fibExtension, fibRetracement, fibSpeedFan, fibTime, fibTimeZone, fibWedge } from '../src/drawing/fibonacci';
import { gannBox, gannFan, gannSquare, gannSquareFixed } from '../src/drawing/gann';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import { insidePitchfork, modifiedSchiffPitchfork, pitchfan, pitchfork, schiffPitchfork } from '../src/drawing/pitchfork';
import { deriveQuickFields } from '../src/drawing/quick-fields';
import type { DrawingEnv, DrawingStyle, DrawingToolDef, ScreenDrawing } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { darkTheme } from '../src/theme';
import { Timeline } from '../src/timeline';
import { withBuiltinTools } from './builtin-tools';

/** x = time / 6, y = 400 - price, in an 800 × 400 pane. */
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
  barsBetween: () => 0,
  bars: () => [],
  measureText: (t, size) => t.length * size * 0.6,
};

/** Anchors at x 200, 400 and 300 (prices 150, 250, 200), or `xs`. */
function screen(type: string, style: DrawingStyle, xs = [200, 400, 300]): ScreenDrawing {
  const prices = [150, 250, 200];
  const points = xs.map((x, i) => ({ time: x * 6, price: prices[i]! }));
  return {
    drawing: { id: 'x', type, pane: 0, points, style },
    points: points.map((p) => ({ x: p.time / 6, y: 400 - p.price })),
    selected: false,
    hovered: false,
  };
}

/** Left edges of the label pills a tool draws (each pill's text starts 5 px in). */
function pills(tool: DrawingToolDef, style: DrawingStyle, xs?: number[]): { text: string; x: number }[] {
  const out: { text: string; x: number }[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => (key === 'fillText' ? (text: string, x: number) => out.push({ text, x: x - 5 }) : key in target ? target[key] : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  tool.render(ctx, screen(tool.type, style, xs), env);
  return out;
}

const sided = [fibChannel, gannBox, gannSquare, gannSquareFixed, fibSpeedFan, fibTimeZone, fibTime];
const forks = [pitchfork, schiffPitchfork, modifiedSchiffPitchfork, insidePitchfork, pitchfan];

describe('label side on the level tools', () => {
  it('is offered after the fields the toolbar shows first', () => {
    for (const tool of sided) {
      expect(tool.styleFields, tool.type).toContain('labelSide');
      expect(deriveQuickFields({}, tool), tool.type).not.toContain('labelSide');
    }
    // Its ratio labels mark where the rays leave the box, so the Gann fan has no side.
    expect(gannFan.styleFields).not.toContain('labelSide');
  });

  it('starts new box, fan and time drawings on the right, and leaves the channel on the left', () => {
    for (const tool of [gannBox, gannSquare, gannSquareFixed, fibSpeedFan, fibTimeZone, fibTime]) expect(tool.defaultStyle?.labelSide, tool.type).toBe('right');
    expect(fibChannel.defaultStyle?.labelSide).toBeUndefined();
  });

  it('moves the Fib channel labels to the right end of its lines', () => {
    const left = pills(fibChannel, {});
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((p) => p.x < 200)).toBe(true);
    expect(pills(fibChannel, { labelSide: 'left' })).toEqual(left);
    const right = pills(fibChannel, { labelSide: 'right' });
    expect(right.map((p) => p.text)).toEqual(left.map((p) => p.text));
    expect(right.every((p) => p.x > 400)).toBe(true);
    // Extended to the pane edge, the labels stay inside it.
    expect(pills(fibChannel, { labelSide: 'right', extendRight: true }).every((p) => p.x > 400 && p.x < 800)).toBe(true);
  });

  it("puts the box tools' price labels beside the chosen edge, the right one when unset, whichever way they were drawn", () => {
    for (const tool of [gannBox, gannSquare, gannSquareFixed, fibSpeedFan]) {
      // Drawn backwards in time, from x 400 to x 200, with an empty (saved) style.
      const backwards = [400, 200];
      const unset = pills(tool, {}, backwards);
      const right = pills(tool, { labelSide: 'right' }, backwards);
      const left = pills(tool, { labelSide: 'left' }, backwards);
      expect(unset, tool.type).toEqual(right);
      // The price labels sit past the right edge, or before the left one; time labels stay along the price edge.
      expect(right.filter((p) => p.x > 400).length, tool.type).toBeGreaterThanOrEqual(3);
      expect(left.filter((p) => p.x > 400).length, tool.type).toBe(0);
      expect(left.filter((p) => p.x < 200).length, tool.type).toBeGreaterThanOrEqual(3);
    }
  });

  it('puts time labels left or right of their lines', () => {
    for (const tool of [fibTimeZone, fibTime]) {
      const right = pills(tool, {});
      expect(pills(tool, { labelSide: 'right' }), tool.type).toEqual(right);
      const left = pills(tool, { labelSide: 'left' });
      expect(left.map((p) => p.text), tool.type).toEqual(right.map((p) => p.text));
      left.forEach((p, i) => expect(p.x, tool.type).toBeLessThan(right[i]!.x - 8));
    }
  });
});

describe('pitchfork labels', () => {
  it('are listed with the text fields and off by default', () => {
    for (const tool of forks) {
      expect(tool.styleFields, tool.type).toEqual(expect.arrayContaining(['showLabel', 'textColor', 'fontSize', 'bold', 'italic']));
      expect(tool.defaultStyle?.showLabel, tool.type).toBe(false);
      expect(pills(tool, {}), tool.type).toEqual([]);
      expect(pills(tool, { showLabel: false }), tool.type).toEqual([]);
    }
  });

  it("show each visible level's value on both sides with showLabel true", () => {
    for (const tool of forks) {
      // The default levels show only the tines (1).
      expect(pills(tool, { showLabel: true }).map((p) => p.text), tool.type).toEqual(['1', '1']);
      const levels = [{ value: 0.5 }, { value: 1 }, { value: 2, visible: false }];
      // Four lines; labels that would overlap one already drawn are skipped, as on the other level tools.
      const drawn = pills(tool, { showLabel: true, levels });
      expect(drawn.length, tool.type).toBeGreaterThanOrEqual(2);
      expect(drawn.length, tool.type).toBeLessThanOrEqual(4);
      expect(drawn.every((p) => p.text === '0.5' || p.text === '1'), tool.type).toBe(true);
      expect(drawn.some((p) => p.text === '0.5') && drawn.some((p) => p.text === '1'), tool.type).toBe(true);
    }
  });
});

describe('label options in the manager', () => {
  it('give new drawings their defaults and save the fields', () => {
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
    const make = () => withBuiltinTools(new DrawingManager(host));
    const a = make();
    const points = [{ time: 0, price: 1 }, { time: 600, price: 2 }, { time: 300, price: 3 }];
    expect(a.add({ type: 'gann-box', pane: 0, points: points.slice(0, 2), style: {} }).style.labelSide).toBe('right');
    expect(a.add({ type: 'pitchfork', pane: 0, points, style: {} }).style.showLabel).toBe(false);
    a.add({ type: 'fib-channel', pane: 0, points, style: { labelSide: 'right' } });
    a.add({ type: 'schiff-pitchfork', pane: 0, points, style: { showLabel: true } });
    const b = make();
    expect(b.load(JSON.parse(JSON.stringify(a.serialize()))).errors).toEqual([]);
    expect(b.getAll().map((d) => [d.type, d.style.labelSide, d.style.showLabel])).toEqual([
      ['gann-box', 'right', undefined],
      ['pitchfork', undefined, false],
      ['fib-channel', 'right', undefined],
      ['schiff-pitchfork', undefined, true],
    ]);
  });
});

describe('label content on the level tools', () => {
  const levelTools = [fibRetracement, fibExtension, ...sided, ...forks, fibArcs, fibCircles, fibWedge];
  const texts = (tool: DrawingToolDef, style: DrawingStyle, xs?: number[]) => pills(tool, { showLabel: true, ...style }, xs).map((p) => p.text);

  it('is offered on every level tool but the Gann fan, after the fields the toolbar shows first', () => {
    for (const tool of levelTools) {
      expect(tool.styleFields, tool.type).toContain('labelContent');
      expect(deriveQuickFields({}, tool), tool.type).not.toContain('labelContent');
    }
    // Its labels name the rays' ratios.
    expect(gannFan.styleFields).not.toContain('labelContent');
  });

  it('keeps what each tool drew before: level and price on the retracement and extension, the level elsewhere', () => {
    for (const tool of [fibRetracement, fibExtension]) {
      expect(tool.defaultStyle?.labelContent, tool.type).toBe('both');
      // A saved drawing without the field.
      expect(texts(tool, {}), tool.type).toEqual(texts(tool, { labelContent: 'both' }));
    }
    expect(texts(fibRetracement, {})).toContain('0.5 (200.00)');
    for (const tool of levelTools.slice(2)) {
      expect(tool.defaultStyle?.labelContent, tool.type).toBeUndefined();
      expect(texts(tool, {}), tool.type).toEqual(texts(tool, { labelContent: 'level' }));
    }
  });

  it('shows the level, its price, both, or the level in percent', () => {
    expect(texts(fibRetracement, { labelContent: 'level' })).toContain('0.5');
    expect(texts(fibRetracement, { labelContent: 'price' })).toContain('200.00');
    // Labels too close to the one before are skipped, as for every content.
    expect(texts(fibRetracement, { labelContent: 'percent' })).toEqual(expect.arrayContaining(['0%', '23.6%', '50%', '78.6%', '100%']));
    for (const tool of levelTools) {
      const percent = texts(tool, { labelContent: 'percent' });
      expect(percent.length, tool.type).toBeGreaterThan(0);
      expect(percent.every((t) => t.endsWith('%')), tool.type).toBe(true);
    }
    // Price labels show the price where they sit (formatted with two decimals here).
    for (const tool of [fibChannel, gannBox, gannSquare, gannSquareFixed, fibSpeedFan, ...forks]) {
      expect(texts(tool, { labelContent: 'price' }).some((t) => /^\d+\.\d\d$/.test(t)), tool.type).toBe(true);
      expect(texts(tool, { labelContent: 'both' }).some((t) => /^[\d.]+ \(\d+\.\d\d\)$/.test(t)), tool.type).toBe(true);
    }
  });

  it('shows the level for the price choices where a label marks a time or a radius', () => {
    for (const tool of [fibTimeZone, fibTime, fibArcs, fibCircles, fibWedge]) {
      const level = texts(tool, { labelContent: 'level' });
      expect(texts(tool, { labelContent: 'price' }), tool.type).toEqual(level);
      expect(texts(tool, { labelContent: 'both' }), tool.type).toEqual(level);
    }
    // The Gann box labels its price levels with prices and its time levels with the level.
    const box = texts(gannBox, { labelContent: 'price' });
    expect(box).toEqual(expect.arrayContaining(['150.00', '250.00', '0.5']));
  });
});
