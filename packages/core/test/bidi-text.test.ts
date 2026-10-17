import { describe, expect, it } from 'vitest';
import { Chart } from '../src/chart';
import { fillLine, fillNumerals, fillText, measureNumerals, textDirection } from '../src/typography';
import { fakeContainer } from './fake-dom';

interface Drawn {
  text: string;
  x: number;
  maxWidth?: number;
  direction: unknown;
  align: unknown;
}

/** A 2D context that records each `fillText` with the direction and alignment it was drawn in. */
function recordingContext(widths: (text: string) => number = (text) => text.length * 6) {
  const drawn: Drawn[] = [];
  const state: Record<string, unknown> = { textAlign: 'left' };
  const ctx = new Proxy(state, {
    get: (_t, key) => {
      if (key === 'measureText') return (text: string) => ({ width: widths(text) });
      if (key === 'fillText')
        return (text: string, x: number, _y: number, ...rest: number[]) =>
          drawn.push({ text, x, ...(rest.length ? { maxWidth: rest[0] } : {}), direction: state.direction, align: state.textAlign });
      if (typeof key === 'string' && key in state) return state[key];
      return () => ({ addColorStop() {} });
    },
    set: (_t, key, value) => {
      state[key as string] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
}

describe('textDirection', () => {
  it('follows the first letter, like dir="auto"', () => {
    expect(textDirection('سعر BTC')).toBe('rtl');
    expect(textDirection('BTC سعر')).toBe('ltr');
    expect(textDirection('(שלום) 12')).toBe('rtl');
    expect(textDirection('12 בינו׳')).toBe('rtl');
    expect(textDirection('Δ 5%')).toBe('ltr');
  });

  it('reads digits and signs alone left to right', () => {
    expect(textDirection('')).toBe('ltr');
    expect(textDirection('-1.25')).toBe('ltr');
    expect(textDirection('١٢٫٥٪')).toBe('ltr');
    expect(textDirection('۱۲۳٬۴')).toBe('ltr');
  });
});

describe('canvas text helpers', () => {
  it('fillText draws in the text’s own direction and passes maxWidth only when given', () => {
    const { ctx, drawn } = recordingContext();
    ctx.direction = 'rtl';
    fillText(ctx, '-1.25', 10, 0);
    fillText(ctx, 'מחיר', 10, 0, 40);
    expect(drawn).toEqual([
      { text: '-1.25', x: 10, direction: 'ltr', align: 'left' },
      { text: 'מחיר', x: 10, maxWidth: 40, direction: 'rtl', align: 'left' },
    ]);
  });

  it('fillLine starts right-to-left lines at the right edge of the box', () => {
    const { ctx, drawn } = recordingContext();
    fillLine(ctx, 'Support', 10, 90, 0);
    fillLine(ctx, 'دعم قوي', 10, 90, 0);
    expect(drawn.map(({ x, direction, align }) => ({ x, direction, align }))).toEqual([
      { x: 10, direction: 'ltr', align: 'left' },
      { x: 90, direction: 'rtl', align: 'right' },
    ]);
  });

  it('fillNumerals lays out tabular digits only in left-to-right text', () => {
    // '1' narrower than the other digits, so tabular layout kicks in.
    const { ctx, drawn } = recordingContext((text) => [...text].reduce((w, ch) => w + (ch === '1' ? 4 : 6), 0));
    ctx.font = 'test-font-bidi';
    fillNumerals(ctx, '12 בינו׳', 0, 0, 'tabular');
    expect(drawn).toEqual([{ text: '12 בינו׳', x: 0, direction: 'rtl', align: 'left' }]);
    // Measured as drawn, so label boxes fit the text.
    expect(measureNumerals(ctx, '12 בינו׳', 'tabular')).toBe(ctx.measureText('12 בינו׳').width);
    expect(measureNumerals(ctx, '12 Jan', 'tabular')).toBe(6 + 6 + ctx.measureText(' Jan').width);

    drawn.length = 0;
    ctx.direction = 'rtl';
    fillNumerals(ctx, '12 Jan', 0, 0, 'tabular');
    expect(drawn.map((d) => d.text)).toEqual(['1', '2', ' Jan']);
    expect(drawn.every((d) => d.direction === 'ltr')).toBe(true);
  });
});

describe('chart text direction', () => {
  function recorded() {
    const c = new Chart(fakeContainer(), { timezone: 'UTC' });
    c.addCandles().setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 3600, open: 10, high: 20, low: 0, close: 10 })));
    const { ctx, drawn } = recordingContext();
    (c as unknown as { ctx(): unknown }).ctx = () => ctx;
    const frame = () => {
      drawn.length = 0;
      c.invalidate();
      (c as unknown as { render(t: number): void }).render(0);
    };
    return { c, drawn, frame };
  }

  it('keeps axis labels left to right and gives drawing text its own direction', () => {
    const { c, drawn, frame } = recorded();
    c.drawings.add({ type: 'text', pane: 0, points: [{ time: 3600 * 10, price: 12 }], text: 'دعم BTC', style: {} });
    c.drawings.add({ type: 'text', pane: 0, points: [{ time: 3600 * 20, price: 12 }], text: 'Resistance', style: {} });
    frame();
    const byText = (text: string) => drawn.find((d) => d.text === text);
    expect(byText('دعم BTC')?.direction).toBe('rtl');
    expect(byText('Resistance')?.direction).toBe('ltr');
    const prices = drawn.filter((d) => /^-?\d+(\.\d+)?$/.test(d.text));
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every((d) => d.direction === 'ltr')).toBe(true);
  });

  it('aligns each callout line by its own direction', () => {
    const { c, drawn, frame } = recorded();
    c.drawings.add({
      type: 'callout',
      pane: 0,
      points: [
        { time: 3600 * 10, price: 5 },
        { time: 3600 * 20, price: 15 },
      ],
      text: 'Breakout\nاختراق',
      style: {},
    });
    frame();
    const latin = drawn.find((d) => d.text === 'Breakout')!;
    const arabic = drawn.find((d) => d.text === 'اختراق')!;
    expect(latin).toMatchObject({ direction: 'ltr', align: 'left' });
    expect(arabic).toMatchObject({ direction: 'rtl', align: 'right' });
    // Both lines sit inside the same box: the left edge plus padding, and the right edge minus padding.
    expect(arabic.x).toBeGreaterThan(latin.x);
  });
});
