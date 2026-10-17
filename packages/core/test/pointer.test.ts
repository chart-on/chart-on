import { describe, expect, it } from 'vitest';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { HOVER_TOLERANCE, chartPointAt, hitsValue, pointFor, snapPrice } from '../src/pointer';
import { CandleSeries, type CandleSeriesOptions, type SeriesHost } from '../src/series';
import { darkTheme } from '../src/theme';

function setup() {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = 100;
  const top = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  top.height = 400;
  top.price.height = 400;
  top.price.fit(0, 400);
  const bottom = new Pane(1, { stretch: 1, marginTop: 0, marginBottom: 0 });
  bottom.top = 400;
  bottom.height = 100;
  bottom.price.height = 100;
  bottom.price.fit(0, 100);
  return { timeline, time, panes: [top, bottom] };
}

describe('chartPointAt', () => {
  it('snaps to the nearest bar and reads the price in the pane', () => {
    const { timeline, time, panes } = setup();
    const x = time.indexToX(42) + 3;
    const at = chartPointAt(x, 100, 0, panes, time, timeline)!;
    expect(at.index).toBe(42);
    expect(at.time).toBe(42 * 60);
    expect(at.pane).toBe(0);
    expect(at.price).toBeCloseTo(panes[0]!.price.yToPrice(100));
  });

  it('measures y from the top of lower panes', () => {
    const { timeline, time, panes } = setup();
    const at = chartPointAt(time.indexToX(10), 450, 1, panes, time, timeline)!;
    expect(at.price).toBeCloseTo(panes[1]!.price.yToPrice(50));
  });

  it('returns null without data or for an unknown pane', () => {
    const { time, panes, timeline } = setup();
    expect(chartPointAt(10, 10, 0, panes, time, new Timeline())).toBeNull();
    expect(chartPointAt(10, 10, 5, panes, time, timeline)).toBeNull();
  });
});

describe('pointFor', () => {
  it('is the inverse of chartPointAt', () => {
    const { timeline, time, panes } = setup();
    const p = pointFor(30 * 60, 123, panes[1]!, time, timeline);
    expect(p.x).toBeCloseTo(time.indexToX(30));
    const back = chartPointAt(p.x, p.y, 1, panes, time, timeline)!;
    expect(back.time).toBe(30 * 60);
    expect(back.price).toBeCloseTo(123);
  });

  it('gives NaN y without a price', () => {
    const { timeline, time, panes } = setup();
    expect(pointFor(60, null, panes[0]!, time, timeline).y).toBeNaN();
  });
});

describe('snapPrice', () => {
  const bar = { open: 100, high: 120, low: 90, close: 110 };

  it('free and hidden keep the pointer price', () => {
    expect(snapPrice('free', 104, bar)).toBe(104);
    expect(snapPrice('hidden', 104, bar)).toBe(104);
  });

  it('close always snaps to the close', () => {
    expect(snapPrice('close', 91, bar)).toBe(110);
    expect(snapPrice('close', 200, bar)).toBe(110);
  });

  it('ohlc snaps to the nearest of open, high, low and close', () => {
    expect(snapPrice('ohlc', 118, bar)).toBe(120);
    expect(snapPrice('ohlc', 92, bar)).toBe(90);
    expect(snapPrice('ohlc', 101, bar)).toBe(100);
    expect(snapPrice('ohlc', 108, bar)).toBe(110);
  });

  it('prefers the close on a tie', () => {
    expect(snapPrice('ohlc', 105, bar)).toBe(110);
  });

  it('keeps the price when there is no bar', () => {
    expect(snapPrice('close', 104, undefined)).toBe(104);
    expect(snapPrice('ohlc', 104, undefined)).toBe(104);
  });
});

describe('hitsValue', () => {
  // 1 price unit = 1 px, y grows downwards.
  const toY = (price: number) => 200 - price;

  it('covers a candle from high to low with tolerance', () => {
    const bar = { open: 100, high: 120, low: 90, close: 110 };
    expect(hitsValue({ kind: 'candles', bar }, toY(105), toY)).toBe(true);
    expect(hitsValue({ kind: 'candles', bar }, toY(120) - HOVER_TOLERANCE, toY)).toBe(true);
    expect(hitsValue({ kind: 'candles', bar }, toY(130), toY)).toBe(false);
  });

  it('covers a histogram bar from base to value, either sign', () => {
    expect(hitsValue({ kind: 'histogram', value: 50, base: 0 }, toY(25), toY)).toBe(true);
    expect(hitsValue({ kind: 'histogram', value: -50, base: 0 }, toY(-25), toY)).toBe(true);
    expect(hitsValue({ kind: 'histogram', value: 50, base: 0 }, toY(80), toY)).toBe(false);
  });

  it('covers a band around a line value', () => {
    expect(hitsValue({ kind: 'line', value: 70 }, toY(70) + HOVER_TOLERANCE, toY)).toBe(true);
    expect(hitsValue({ kind: 'line', value: 70 }, toY(70) + HOVER_TOLERANCE + 1, toY)).toBe(false);
  });
});

describe('snapPrice with a projection', () => {
  it('measures nearest in projected space', () => {
    const bar = { open: 10, high: 100, low: 1, close: 50 };
    // 72 is nearer the close (50) in price units, but nearer the high (100) on a log scale.
    expect(snapPrice('ohlc', 72, bar)).toBe(50);
    expect(snapPrice('ohlc', 72, bar, Math.log10)).toBe(100);
  });
});

describe('CandleSeries.displayedBarAt', () => {
  const bars = [
    { time: 60, open: 10, high: 14, low: 8, close: 12 },
    // Gap up: the Heikin Ashi open stays near the previous bar, far below the raw low.
    { time: 120, open: 30, high: 32, low: 29, close: 31 },
  ];

  function candles(style: CandleSeriesOptions['style'], timeline: number[]) {
    const tl = new Timeline();
    tl.set(timeline);
    const host: SeriesHost = {
      timeline: tl,
      theme: darkTheme,
      maxTextureSize: 4096,
      mainDataChanged: () => {},
      mainLastBarChanged: () => {},
      requestRender: () => {},
    };
    const options: CandleSeriesOptions = {
      title: 'test', style, bodyRatio: 0.8, lineWidth: 1, lastValueLabel: false, animate: false,
    };
    const s = new CandleSeries(host, new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 }), options);
    s.setData(bars);
    return s;
  }

  it('returns the raw bar for plain candles', () => {
    const s = candles('candles', [60, 120]);
    expect(s.displayedBarAt(1)).toEqual(bars[1]);
  });

  it('returns the Heikin Ashi bar, so hit-testing and snapping follow the drawn candle', () => {
    const s = candles('heikinAshi', [60, 120]);
    const ha = s.displayedBarAt(1)!;
    expect(ha.low).toBeCloseTo(11);
    const toY = (price: number) => 200 - price;
    // Price 20 lies on the drawn candle but outside the raw bar.
    expect(hitsValue({ kind: 'candles', bar: ha }, toY(20), toY)).toBe(true);
    expect(hitsValue({ kind: 'candles', bar: bars[1]! }, toY(20), toY)).toBe(false);
    expect(snapPrice('close', 20, ha)).toBeCloseTo(ha.close);
    expect(ha.close).not.toBe(bars[1]!.close);
  });

  it('keeps only the prices each style draws', () => {
    const { open, high, low, close } = bars[1]!;
    expect(candles('volumeCandles', [60, 120]).drawnBarAt(1)).toEqual({ open, high, low, close });
    expect(candles('hlcBars', [60, 120]).drawnBarAt(1)).toEqual({ high, low, close });
    expect(candles('rangeBand', [60, 120]).drawnBarAt(1)).toEqual({ high, low, close });
    expect(candles('line', [60, 120]).drawnBarAt(1)).toEqual({ close });
    expect(candles('line', [60, 120]).drawnBarAt(5)).toBeUndefined();
  });

  it('snaps and hit-tests HLC and line styles on what is drawn', () => {
    const toY = (price: number) => 200 - price;
    const hlc = candles('hlcBars', [60, 120]).drawnBarAt(1)!;
    // HLC bars draw no open (30), so the low (29) is the nearest drawn price.
    expect(snapPrice('ohlc', 29.8, bars[1])).toBe(30);
    expect(snapPrice('ohlc', 29.8, hlc)).toBe(29);
    const line = candles('line', [60, 120]).drawnBarAt(1)!;
    expect(snapPrice('ohlc', 29, line)).toBe(31);
    // A line covers a band around the close, not the bar's full range.
    expect(hitsValue({ kind: 'candles', bar: line }, toY(31), toY)).toBe(true);
    expect(hitsValue({ kind: 'candles', bar: line }, toY(31) + HOVER_TOLERANCE + 1, toY)).toBe(false);
  });

  it('maps timeline indices for a non-main series and is undefined where it has no bar', () => {
    const s = candles('heikinAshi', [0, 60, 90, 120]);
    expect(s.displayedBarAt(1)!.time).toBe(60);
    expect(s.displayedBarAt(3)!.time).toBe(120);
    expect(s.displayedBarAt(2)).toBeUndefined();
    expect(s.displayedBarAt(9)).toBeUndefined();
  });
});
