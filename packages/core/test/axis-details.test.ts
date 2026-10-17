import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import { formatCrosshairTime, formatTickLabel, TickWeight } from '../src/util/format';
import { createLocalizer } from '../src/util/locale';
import { resetOptionWarnings } from '../src/util/options-check';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

// The fake DOM is 800 x 600 css px and measures every character as 6 px.
const CHAR = 6;

const bars = (count: number, step: number, price = 100): Bar[] =>
  Array.from({ length: count }, (_, i) => ({ time: i * step, open: price, high: price + 10, low: price - 10, close: price + 1 }));

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A chart whose top layer records text, segments and rounded boxes; `frame()` draws one frame. */
function recorded(options: ChartOptionsPatch = {}, step = 3600) {
  const c = new Chart(fakeContainer(), { timezone: 'UTC', ...options });
  charts.push(c);
  c.addCandles({ animate: false }).setData(bars(50, step));
  const texts: { text: string; font: unknown; x: number }[] = [];
  const segments: Segment[] = [];
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  const state: Record<string, unknown> = {};
  let at = { x: 0, y: 0 };
  const ctx = new Proxy(state, {
    get: (_t, key) => {
      if (key === 'measureText') return (text: string) => ({ width: text.length * CHAR });
      if (key === 'fillText') return (text: string, x: number) => texts.push({ text, font: state.font, x });
      if (key === 'moveTo') return (x: number, y: number) => (at = { x, y });
      if (key === 'lineTo') {
        return (x: number, y: number) => {
          segments.push({ x1: at.x, y1: at.y, x2: x, y2: y });
          at = { x, y };
        };
      }
      if (key === 'roundRect') return (x: number, y: number, w: number, h: number) => boxes.push({ x, y, w, h });
      if (typeof key === 'string' && key in state) return state[key];
      return () => ({ addColorStop() {} });
    },
    set: (_t, key, value) => {
      state[key as string] = value;
      return true;
    },
  });
  type Layer = { getContext(): unknown };
  const internals = c as unknown as { top: Layer; cursorLayer: Layer | null; render(t: number): void };
  internals.top.getContext = () => ctx;
  // The crosshair has a layer of its own.
  if (internals.cursorLayer) internals.cursorLayer.getContext = () => ctx;
  const frame = () => {
    texts.length = 0;
    segments.length = 0;
    boxes.length = 0;
    c.invalidate();
    internals.render(0);
  };
  return { c, texts, segments, boxes, frame };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1;

describe('time axis options', () => {
  it('merges a partial timeAxis', () => {
    const c = new Chart(fakeContainer(), { timeAxis: { height: 40 } });
    charts.push(c);
    expect(c.options.timeAxis).toMatchObject({ visible: true, height: 40, ticks: false, border: true, showTime: true, showSeconds: false });
    c.applyOptions({ timeAxis: { ticks: true } });
    expect(c.options.timeAxis).toMatchObject({ height: 40, ticks: true });
  });

  it('never draws a tick label cut off by the plot edge', () => {
    const { c, texts, frame } = recorded();
    // Enough bars to fill the plot, so ticks reach its left edge.
    c.main!.setData(bars(500, 3600));
    const edges = { left: 0, right: 0 };
    // Scroll a tick across each edge, one pixel at a time.
    for (let shift = 0; shift < 200; shift++) {
      c.time.rightOffset = 5 + shift / c.time.barSpacing;
      frame();
      // Times of day and day numbers; price labels have decimals.
      for (const t of texts.filter((t) => /^\d\d(:\d\d)?$/.test(t.text))) {
        const half = (t.text.length * CHAR) / 2;
        expect(t.x - half, t.text).toBeGreaterThanOrEqual(0);
        expect(t.x + half, t.text).toBeLessThanOrEqual(c.plotWidth);
        if (t.x - half < 20) edges.left++;
        if (t.x + half > c.plotWidth - 20) edges.right++;
      }
    }
    // Labels still come close to both edges: only the ones that would be cut are dropped.
    expect(edges.left).toBeGreaterThan(0);
    expect(edges.right).toBeGreaterThan(0);
  });

  it('gives a hidden time axis to the plot and drops its labels', () => {
    const { c, texts, frame } = recorded();
    frame();
    expect(c.plotHeight).toBe(600 - 28);
    const tickLabels = () => texts.filter((t) => /^\d\d:\d\d$/.test(t.text));
    expect(tickLabels().length).toBeGreaterThan(0);
    c.applyOptions({ timeAxis: { visible: false } });
    frame();
    expect(c.plotHeight).toBe(600);
    expect(tickLabels()).toEqual([]);
    expect(c.regionAt(100, 599)).toMatchObject({ kind: 'plot' });
  });

  it('draws the crosshair time label at the top of the plot only while the time axis is hidden', () => {
    const { c, texts, boxes, frame } = recorded({ timeAxis: { visible: false } });
    // Size the price axis first, so the crosshair x stays on the same bar.
    frame();
    const time = c.formatTime(25 * 3600);
    c.setCrosshair({ x: c.timeToX(25 * 3600)!, y: 100, pane: 0 });
    frame();
    expect(texts.some((t) => t.text === time)).toBe(false);
    c.applyOptions({ crosshair: { timeLabelPosition: 'top' } });
    frame();
    expect(texts.some((t) => t.text === time)).toBe(true);
    // The label keeps the axis height, less its margins.
    expect(boxes.some((b) => b.y === 3 && b.h === 28 - 6)).toBe(true);
  });

  it('draws the border and tick marks as asked', () => {
    const { c, segments, frame } = recorded();
    frame();
    const y = Math.floor(c.plotHeight) + 0.5;
    const border = () => segments.filter((s) => s.y1 === y && s.y2 === y && s.x2 - s.x1 >= c.plotWidth);
    const ticks = () => segments.filter((s) => s.x1 === s.x2 && s.y1 === c.plotHeight && s.y2 === c.plotHeight + 4);
    expect(border()).toHaveLength(1);
    expect(ticks()).toEqual([]);
    c.applyOptions({ timeAxis: { border: false, ticks: true } });
    frame();
    expect(border()).toEqual([]);
    expect(ticks().length).toBeGreaterThan(0);
    expect(ticks().every((s) => s.x1 >= 0 && s.x1 <= c.plotWidth)).toBe(true);
  });

  it('shows seconds in tick and crosshair labels with showSeconds', () => {
    const { c, texts, frame } = recorded({ timeAxis: { showSeconds: true } }, 5);
    frame();
    expect(texts.some((t) => /^\d\d:\d\d:\d\d$/.test(t.text))).toBe(true);
    expect(c.formatTime(65)).toMatch(/ 00:01:05$/);
    c.applyOptions({ timeAxis: { showSeconds: false } });
    frame();
    expect(texts.some((t) => /^\d\d:\d\d:\d\d$/.test(t.text))).toBe(false);
    expect(c.formatTime(65)).toMatch(/ 00:01$/);
  });

  it('leaves the time of day out of the crosshair label with showTime off', () => {
    const c = new Chart(fakeContainer(), { timezone: 'UTC', timeAxis: { showTime: false } });
    charts.push(c);
    c.addCandles({ animate: false }).setData(bars(10, 3600));
    expect(c.formatTime(3600)).toBe(formatCrosshairTime(3600, 86400));
  });

  it('draws time labels in timeAxis.fontSize', () => {
    const { texts, frame } = recorded({ timeAxis: { fontSize: 15 } });
    frame();
    const times = texts.filter((t) => /^\d\d:\d\d$/.test(t.text));
    expect(times.length).toBeGreaterThan(0);
    expect(times.every((t) => String(t.font).includes('15px'))).toBe(true);
  });
});

describe('time formatting helpers', () => {
  it('formats times of day with and without seconds', () => {
    expect(formatTickLabel(3725, TickWeight.Minute)).toBe('01:02');
    expect(formatTickLabel(3725, TickWeight.Minute, undefined, null, undefined, true)).toBe('01:02:05');
    // Date boundaries are unchanged.
    expect(formatTickLabel(86400 * 31, TickWeight.Month, undefined, null, undefined, true)).toBe('Feb');
    expect(formatCrosshairTime(3725, 60, undefined, undefined, { seconds: true })).toMatch(/ 01:02:05$/);
    expect(formatCrosshairTime(3725, 60, undefined, undefined, { time: false })).toBe(formatCrosshairTime(3725, 86400));
  });

  it('adds seconds to localized times too', () => {
    const de = createLocalizer({ locale: 'de-DE' });
    expect(formatTickLabel(3725, TickWeight.Minute, undefined, null, de, true)).toBe('01:02:05');
    expect(formatCrosshairTime(3725, 60, undefined, de, { seconds: true })).toMatch(/ 01:02:05$/);
    expect(formatCrosshairTime(3725, 60, undefined, de, { time: false })).toBe(formatCrosshairTime(3725, 86400, undefined, de));
  });
});

describe('price axis options', () => {
  it('draws the border and tick marks as asked', () => {
    const { c, segments, frame } = recorded();
    frame();
    const x = Math.floor(c.plotWidth) + 0.5;
    const border = () => segments.filter((s) => s.x1 === x && s.x2 === x && s.y1 === 0);
    const ticks = () => segments.filter((s) => s.y1 === s.y2 && s.x1 === c.plotWidth && s.x2 === c.plotWidth + 4);
    expect(border()).toHaveLength(1);
    expect(ticks()).toEqual([]);
    c.applyOptions({ priceAxis: { border: false, ticks: true } });
    frame();
    expect(border()).toEqual([]);
    expect(ticks().length).toBeGreaterThan(0);
  });

  it('draws price labels and pills in priceAxis.fontSize, and the theme font elsewhere', () => {
    const { c, texts, boxes, frame } = recorded({ priceAxis: { fontSize: 16 }, features: { countdown: false } });
    frame();
    const last = c.main!.lastValues()[0]!;
    const label = texts.find((t) => t.text === c.formatAxis(0, last.value));
    expect(String(label?.font)).toContain('16px');
    // The pill is the font size plus labelPaddingY (4) on each side.
    expect(boxes.some((b) => b.h === 16 + 8)).toBe(true);
    const time = texts.find((t) => /^\d\d:\d\d$/.test(t.text));
    expect(String(time?.font)).toContain('12px');
  });

  it('sizes filled labels by labelPaddingY and labelMode', () => {
    const { c, boxes, frame } = recorded({ priceAxisWidth: 90, features: { countdown: false } });
    frame();
    const text = c.formatAxis(0, c.main!.lastValues()[0]!.value);
    const pill = () => boxes.find((b) => b.x >= c.plotWidth)!;
    expect(pill()).toMatchObject({ x: c.plotWidth + 1, w: 88, h: 12 + 8 });
    c.applyOptions({ priceAxis: { labelMode: 'content', labelPaddingY: 6 } });
    frame();
    expect(pill()).toMatchObject({ x: c.plotWidth + 1, w: text.length * CHAR + 14, h: 12 + 12 });
  });

  it('points filled labels at their price with labelPointer, on either side', () => {
    const { c, segments, frame } = recorded({ priceAxisWidth: 90, priceAxis: { labelPointer: true }, features: { countdown: false } });
    frame();
    const last = c.main!.lastValues()[0]!;
    const y = c.panes[0]!.top + c.main!.scale.priceToY(last.value);
    const tip = (x: number) => segments.filter((s) => s.x2 === x && near(s.y2, y));
    // The point's tip at the column's plot edge, the body after it.
    expect(tip(c.plotWidth + 1)).toHaveLength(1);
    expect(segments.some((s) => s.x1 === c.plotWidth + 1 + 5 && s.x2 === c.plotWidth + 1)).toBe(true);

    // On a left axis the point is on the right; plot x of that column's right edge is 0.
    c.main!.applyOptions({ priceScale: 'left' });
    frame();
    const yl = c.panes[0]!.top + c.main!.scale.priceToY(last.value);
    expect(segments.filter((s) => s.x2 === -1 && near(s.y2, yl))).toHaveLength(1);
    expect(segments.some((s) => s.x1 === -1 && s.x2 === -1 - 5)).toBe(true);
  });

  it('widens an auto axis for the label point', () => {
    const plain = recorded({ priceAxisWidth: 'auto', features: { countdown: false } });
    const pointed = recorded({ priceAxisWidth: 'auto', priceAxis: { labelPointer: true }, features: { countdown: false } });
    plain.frame();
    pointed.frame();
    expect(pointed.c.priceAxisSpace('right')).toBe(plain.c.priceAxisSpace('right') + 5);
  });

  it('measures an auto axis in priceAxis.fontSize', () => {
    const small = recorded({ priceAxisWidth: 'auto', priceAxis: { minWidth: 0 }, features: { countdown: false } });
    small.frame();
    const before = small.c.priceAxisSpace('right');
    // The fake canvas measures by characters, so a bigger font changes the pills, not the width; the cache keys on the font.
    small.c.applyOptions({ priceAxis: { fontSize: 20 } });
    small.frame();
    expect(small.c.priceAxisSpace('right')).toBe(before);
    const font = (small.c as unknown as { textWidthFont: string }).textWidthFont;
    expect(font).toContain('20px');
  });
});

describe('axis option checks', () => {
  beforeEach(() => resetOptionWarnings());

  it('warns about invalid axis options', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = new Chart(fakeContainer(), {
      priceAxis: { labelMode: 'wide' as 'fill', labelPaddingY: -1 },
      timeAxis: { visible: 'no' as unknown as boolean },
    });
    charts.push(c);
    const text = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(text).toContain('priceAxis.labelMode');
    expect(text).toContain('priceAxis.labelPaddingY');
    expect(text).toContain('timeAxis.visible');
  });
});
