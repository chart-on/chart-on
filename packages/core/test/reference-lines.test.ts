import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { DataController } from '../src/data/controller';
import type { DataSource, SymbolInfo } from '../src/data/types';
import { defaultReferenceLinesOptions, type ReferenceLabel } from '../src/reference-lines';

import { darkTheme } from '../src/theme';
import type { Bar } from '../src/types';
import type { IndicatorDef } from '../src/indicators/types';
import { hours, WEEKDAYS } from './sessions';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const H = 3600;
const DAY = 86400;

function bar(time: number, close: number, spread = 1): Bar {
  return { time, open: close, high: close + spread, low: close - spread, close };
}

/** 50 one-minute bars, close 100 + i. */
function minuteBars(): Bar[] {
  return Array.from({ length: 50 }, (_, i) => bar(i * 60, 100 + i));
}

function chart(bars: Bar[] = minuteBars(), options: ConstructorParameters<typeof Chart>[1] = {}): Chart {
  // The sessions here are in UTC; the default timezone is the machine's.
  const c = new Chart(fakeContainer(), { timezone: 'UTC', ...options });
  charts.push(c);
  c.addCandles({ precision: 2 }).setData(bars);
  return c;
}

/** Run one frame's scene work; frames never run on their own under the fake DOM. */
function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

function labels(c: Chart, pane = c.panes[0]!): ReferenceLabel[] {
  const out: ReferenceLabel[] = [];
  c.referenceLines.labels(pane, (_scale, label) => out.push(label));
  return out;
}

const allOn = {
  previousClose: { visible: true },
  high: { visible: true },
  low: { visible: true },
  average: { visible: true },
  bid: { visible: true },
  ask: { visible: true },
  extendedHours: { visible: true },
};

describe('reference line options', () => {
  it('are all off by default and merge per line', () => {
    const c = chart();
    expect(c.referenceLines.options).toEqual(defaultReferenceLinesOptions);
    c.applyOptions({ referenceLines: { high: { visible: true, color: '#123456' } } });
    expect(c.referenceLines.options.high).toMatchObject({ visible: true, color: '#123456', title: 'High', lineStyle: 'dotted' });
    expect(c.referenceLines.options.low.visible).toBe(false);
    c.referenceLines.applyOptions({ high: { lineStyle: 'solid' } });
    expect(c.referenceLines.options.high).toMatchObject({ visible: true, color: '#123456', lineStyle: 'solid' });
    // An explicit undefined colour returns to the theme.
    c.referenceLines.applyOptions({ high: { color: undefined } });
    expect(c.referenceLines.options.high.color).toBeUndefined();
  });

  it('accepts options at construction', () => {
    const c = chart(minuteBars(), { referenceLines: { average: { visible: true } } });
    expect(c.referenceLines.options.average.visible).toBe(true);
  });

  it('accept an undefined referenceLines option at construction', () => {
    const c = chart(minuteBars(), { referenceLines: undefined });
    expect(c.referenceLines.options).toEqual(defaultReferenceLinesOptions);
  });

  it('keep the resolved options in chart.options across patches', () => {
    const c = chart();
    c.applyOptions({ referenceLines: { high: { visible: true } } });
    c.applyOptions({ referenceLines: { low: { visible: true } } });
    c.referenceLines.applyOptions({ average: { visible: true } });
    expect(c.options.referenceLines).toEqual(c.referenceLines.options);
    expect(c.options.referenceLines).toMatchObject({ high: { visible: true }, low: { visible: true }, average: { visible: true } });
  });

  it('rejects unknown lines and styles without changing anything', () => {
    const c = chart();
    expect(() => c.referenceLines.applyOptions({ nope: { visible: true } } as never)).toThrow(/Unknown reference line/);
    expect(() => c.referenceLines.applyOptions({ high: { visible: true, lineStyle: 'wavy' as never } })).toThrow(/line style/);
    expect(c.referenceLines.options.high.visible).toBe(false);
  });

  it('draws nothing while every line is off', () => {
    const c = chart();
    frame(c);
    expect(labels(c)).toEqual([]);
  });
});

describe('visible range lines', () => {
  it('follow the visible high, low and average close', () => {
    const c = chart();
    c.applyOptions({ referenceLines: allOn });
    frame(c);
    // All 50 bars are in view.
    expect(c.referenceLines.value('high')).toBe(150);
    expect(c.referenceLines.value('low')).toBe(99);
    expect(c.referenceLines.value('average')).toBeCloseTo(124.5);
    // Zoom in on the newest bars.
    c.time.barSpacing = 80;
    c.time.rightOffset = 0;
    const from = Math.max(0, Math.floor(c.time.xToIndex(0)));
    frame(c);
    expect(c.referenceLines.value('low')).toBe(100 + from - 1);
    expect(c.referenceLines.value('high')).toBe(150);
  });

  it('update when a live bar arrives', () => {
    const c = chart();
    c.applyOptions({ referenceLines: { high: { visible: true } } });
    frame(c);
    expect(c.referenceLines.value('high')).toBe(150);
    c.main!.update(bar(49 * 60, 200));
    expect(c.referenceLines.value('high')).toBe(201);
    c.main!.update(bar(50 * 60, 300));
    expect(c.referenceLines.value('high')).toBe(301);
  });

  it('recompute only when the range or the bars change, and reuse labels and text', () => {
    const c = chart();
    c.applyOptions({ referenceLines: { high: { visible: true }, low: { visible: true } } });
    const refs = c.referenceLines as unknown as { rangeValues: () => void };
    const range = vi.spyOn(refs, 'rangeValues');
    const format = vi.spyOn(c as unknown as { formatAxis: (pane: number, price: number) => string }, 'formatAxis');
    // The main last-value label formats every frame; count the reference prices only.
    const ours = () => format.mock.calls.filter(([, price]) => price === 150 || price === 99).length;
    frame(c);
    const first = labels(c);
    const calls = range.mock.calls.length;
    const formats = ours();
    expect(calls).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) frame(c);
    const again = labels(c);
    expect(range.mock.calls.length).toBe(calls);
    expect(ours()).toBe(formats);
    // The same label objects every frame.
    expect(again[0]).toBe(first[0]);
    expect(again[1]).toBe(first[1]);
    c.time.barSpacing = 40;
    frame(c);
    expect(range.mock.calls.length).toBe(calls + 1);
  });

  it('reformat their labels when the series price format changes', () => {
    const c = chart();
    c.applyOptions({ referenceLines: { high: { visible: true } } });
    expect(labels(c)[0]!.text).toBe('150.00');
    c.main!.applyOptions({ priceFormat: { type: 'decimal', precision: 4 } });
    expect(labels(c)[0]!.text).toBe('150.0000');
  });

  it('label in the theme colour with a title tag', () => {
    const c = chart();
    c.applyOptions({ referenceLines: { high: { visible: true } } });
    frame(c);
    const [high] = labels(c);
    expect(high).toMatchObject({ text: '150.00', bg: darkTheme.referenceLine, title: 'High' });
    expect(high!.y).toBeCloseTo(c.panes[0]!.top + c.main!.scale.priceToY(150));
    c.applyOptions({ theme: { referenceLine: '#ffffff' } });
    expect(labels(c)[0]).toMatchObject({ bg: '#ffffff', fg: '#000000' });
    c.referenceLines.applyOptions({ high: { axisLabel: false } });
    expect(labels(c)).toEqual([]);
  });

  it('hide with the main series', () => {
    const c = chart();
    c.applyOptions({ referenceLines: allOn });
    c.main!.setVisible(false);
    expect(labels(c)).toEqual([]);
  });

  it('draw lines without allocating dash arrays', () => {
    const c = chart();
    c.applyOptions({ referenceLines: { high: { visible: true }, low: { visible: true, lineStyle: 'dashed' } } });
    frame(c);
    const dashes: number[][] = [];
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      setLineDash(d: number[]) {
        dashes.push(d);
      },
    } as unknown as CanvasRenderingContext2D;
    const pane = c.panes[0]!;
    c.referenceLines.drawLines(ctx, pane, c.plotWidth);
    c.referenceLines.drawLines(ctx, pane, c.plotWidth);
    expect(dashes).toHaveLength(4);
    expect(dashes[0]).toBe(dashes[2]);
    expect(dashes[1]).toBe(dashes[3]);
    expect(dashes[1]).toEqual([6, 4]);
  });
});

describe('previous close', () => {
  it('is the last close of the previous trading day on intraday bars', () => {
    const bars = [bar(0, 10), bar(H, 11), bar(DAY - H, 12), bar(DAY, 20), bar(DAY + H, 21)];
    const c = chart(bars);
    expect(c.referenceLines.value('previousClose')).toBe(12);
  });

  it('is the previous bar on daily bars', () => {
    const bars = [bar(0, 10), bar(DAY, 11), bar(2 * DAY, 12)];
    const c = chart(bars);
    expect(c.referenceLines.value('previousClose')).toBe(11);
  });

  it('is null without an earlier day', () => {
    const c = chart();
    expect(c.referenceLines.value('previousClose')).toBeNull();
  });

  it('skips bars outside the session', () => {
    // Session 09:30-16:00 UTC; day 0 has a post-session bar at 18:00.
    const bars = [bar(10 * H, 10), bar(15 * H, 11), bar(18 * H, 99), bar(DAY + 10 * H, 20)];
    const c = chart(bars, { session: hours([['09:30', '16:00']]) });
    expect(c.referenceLines.value('previousClose')).toBe(11);
  });
});

describe('bid and ask', () => {
  it('come from setQuote and clear with null', () => {
    const c = chart();
    c.applyOptions({ referenceLines: { bid: { visible: true }, ask: { visible: true } } });
    expect(labels(c)).toEqual([]);
    c.referenceLines.setQuote({ bid: 120, ask: 121 });
    expect(c.referenceLines.quote).toEqual({ bid: 120, ask: 121 });
    expect(labels(c).map((l) => [l.text, l.bg, l.title])).toEqual([
      ['120.00', darkTheme.bid, 'Bid'],
      ['121.00', darkTheme.ask, 'Ask'],
    ]);
    // A missing or non-finite side hides its line.
    c.referenceLines.setQuote({ bid: Number.NaN, ask: 122 });
    expect(labels(c).map((l) => l.text)).toEqual(['122.00']);
    c.referenceLines.setQuote(null);
    expect(c.referenceLines.quote).toBeNull();
    expect(labels(c)).toEqual([]);
  });

  it('stream from a data source that offers quotes', async () => {
    const info: SymbolInfo = { symbol: 'AAA', name: 'AAA' };
    let push: ((q: { bid?: number; ask?: number }) => void) | null = null;
    const unsubscribe = vi.fn();
    const source: DataSource = {
      symbol: async () => info,
      search: async () => [],
      history: async () => ({ bars: minuteBars() }),
      quotes: (_symbol, onQuote) => {
        push = onQuote;
        return unsubscribe;
      },
    };
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.setDataSource(source);
    await c.setSymbol('AAA', '1m');
    expect(c.data).toBeInstanceOf(DataController);
    push!({ bid: 1, ask: 2 });
    expect(c.referenceLines.quote).toEqual({ bid: 1, ask: 2 });
    // Switching symbols drops the old quote and its stream.
    void c.setSymbol('BBB', '1m');
    expect(unsubscribe).toHaveBeenCalled();
    expect(c.referenceLines.quote).toBeNull();
  });

  async function quoteChart(): Promise<{ c: Chart; unsubscribe: ReturnType<typeof vi.fn> }> {
    const unsubscribe = vi.fn();
    const source: DataSource = {
      symbol: async () => ({ symbol: 'AAA', name: 'AAA' }),
      search: async () => [],
      history: async () => ({ bars: minuteBars() }),
      quotes: (_symbol, onQuote) => {
        onQuote({ bid: 1, ask: 2 });
        return unsubscribe;
      },
    };
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.setDataSource(source);
    await c.setSymbol('AAA', '1m');
    expect(c.referenceLines.quote).toEqual({ bid: 1, ask: 2 });
    return { c, unsubscribe };
  }

  it('stop streaming when the data source is detached', async () => {
    const { c, unsubscribe } = await quoteChart();
    c.setDataSource(null);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(c.referenceLines.quote).toBeNull();
  });

  it('stop streaming when the chart is destroyed', async () => {
    const { c, unsubscribe } = await quoteChart();
    c.destroy();
    charts.splice(charts.indexOf(c), 1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('extended hours', () => {
  const session = hours([['09:30', '16:00']], WEEKDAYS);
  // Day 1 (a Friday in 1970) regular bars, then a post-session bar.
  const regular = [bar(DAY + 10 * H, 50), bar(DAY + 15 * H, 55)];

  it('is open inside the session and without one', () => {
    expect(chart(regular, { session }).referenceLines.sessionPhase).toBe('open');
    expect(chart([...regular, bar(DAY + 18 * H, 60)]).referenceLines.sessionPhase).toBe('open');
  });

  it('labels a post-session price and puts the regular close on the main label', () => {
    const c = chart([...regular, bar(DAY + 18 * H, 60)], { session });
    c.applyOptions({ referenceLines: { extendedHours: { visible: true } } });
    expect(c.referenceLines.sessionPhase).toBe('post');
    expect(c.referenceLines.value('extendedHours')).toBe(60);
    expect(labels(c)).toEqual([expect.objectContaining({ text: '60.00', title: 'Post', bg: darkTheme.extendedHours })]);
    const last = c.referenceLines.mainLast(c.main!.lastValue()!);
    expect(last).toMatchObject({ value: 55, text: '55.00', color: darkTheme.up });
  });

  it('labels a pre-session price with the pre title', () => {
    // Next trading day (Monday, day 4) before the open.
    const c = chart([...regular, bar(4 * DAY + 8 * H, 52)], { session });
    c.applyOptions({ referenceLines: { extendedHours: { visible: true, title: 'Pre-market' } } });
    expect(c.referenceLines.sessionPhase).toBe('pre');
    expect(labels(c)).toEqual([expect.objectContaining({ text: '52.00', title: 'Pre-market' })]);
  });

  it('is post after the close even when no regular bar of that day is loaded', () => {
    // The loaded window starts after day 1's close.
    const c = chart([bar(DAY + 17 * H, 58), bar(DAY + 18 * H, 60)], { session });
    c.applyOptions({ referenceLines: { extendedHours: { visible: true } } });
    expect(c.referenceLines.sessionPhase).toBe('post');
    expect(labels(c)).toEqual([expect.objectContaining({ title: 'Post' })]);
    // No regular close to show: the main label stays as it is.
    const value = c.main!.lastValue()!;
    expect(c.referenceLines.mainLast(value)).toBe(value);
  });

  it('puts the displayed (Heikin Ashi) regular close on the main label', () => {
    const close = { time: DAY + 15 * H, open: 50, high: 56, low: 49, close: 55 };
    const c = chart([regular[0]!, close, bar(DAY + 18 * H, 60)], { session });
    c.main!.applyOptions({ style: 'heikinAshi' });
    c.applyOptions({ referenceLines: { extendedHours: { visible: true } } });
    const shown = c.main!.displayedBarAt(1)!;
    expect(shown.close).not.toBe(55);
    const last = c.referenceLines.mainLast(c.main!.lastValue()!);
    expect(last.value).toBe(shown.close);
  });

  it('leaves the main label alone while the line is off or inside the session', () => {
    const c = chart([...regular, bar(DAY + 18 * H, 60)], { session });
    const value = c.main!.lastValue()!;
    expect(c.referenceLines.mainLast(value)).toBe(value);
    c.applyOptions({ referenceLines: { extendedHours: { visible: true } } });
    c.main!.update(bar(2 * DAY + 10 * H, 61));
    // Day 2 is a Saturday: closed, so still outside the session.
    expect(c.referenceLines.sessionPhase).toBe('pre');
    c.main!.update(bar(4 * DAY + 10 * H, 62));
    expect(c.referenceLines.sessionPhase).toBe('open');
    const now = c.main!.lastValue()!;
    expect(c.referenceLines.mainLast(now)).toBe(now);
    expect(c.referenceLines.value('extendedHours')).toBeNull();
  });
});

describe('series axis titles', () => {
  it('tag a series label with its title when asked', () => {
    const c = chart();
    const line = c.addLine({ title: 'BBB' });
    line.setData([{ time: 49 * 60, value: 10 }]);
    expect(line.lastValues()[0]!.title).toBeUndefined();
    line.applyOptions({ axisTitle: true });
    expect(line.lastValues()[0]!.title).toBe('BBB');
    line.applyOptions({ lastValueLabel: false });
    expect(line.lastValues()).toEqual([]);
  });

  it('toggle per indicator: last-value labels and title tags', () => {
    const c = chart();
    const def: IndicatorDef = {
      id: 'bands',
      name: 'Bands',
      placement: 'pane',
      inputs: [],
      plots: [
        { id: 'up', type: 'line', title: 'Upper' },
        { id: 'dn', type: 'line', title: 'Lower' },
      ],
      compute: (src) => ({ up: Float64Array.from(src.close, (v) => v + 1), dn: Float64Array.from(src.close, (v) => v - 1) }),
    };
    const ind = c.indicators.add(def);
    expect(ind.labelOptions).toEqual({ lastValueLabel: true, axisTitle: false });
    expect(ind.series!.lastValues().map((l) => l.title)).toEqual([undefined, undefined]);
    ind.applyLabelOptions({ axisTitle: true });
    expect(ind.series!.lastValues().map((l) => l.title)).toEqual(['Upper', 'Lower']);
    ind.applyLabelOptions({ lastValueLabel: false });
    expect(ind.labelOptions).toEqual({ lastValueLabel: false, axisTitle: true });
    expect(ind.series!.lastValues()).toEqual([]);
    // The switches survive the indicator going pending and coming back.
    c.indicators.unregister('bands');
    expect(ind.pending).toBe(true);
    ind.applyLabelOptions({ lastValueLabel: true });
    c.indicators.register(def);
    expect(ind.labelOptions).toEqual({ lastValueLabel: true, axisTitle: true });
    expect(ind.series!.lastValues().map((l) => l.title)).toEqual(['Upper', 'Lower']);
  });
});
