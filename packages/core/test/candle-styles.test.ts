import { describe, expect, it } from 'vitest';
import {
  CandleSeries,
  VOLUME_MIN_WIDTH,
  hlcBandColumns,
  volumeBodyWidth,
  volumeWidthFactor,
  type CandleSeriesOptions,
  type SeriesHost,
} from '../src/series';
import { Pane } from '../src/pane';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { RECT_STRIDE, RectKind } from '../src/gl/rect-batch';
import type { Bar } from '../src/types';

const BARS: Bar[] = [
  { time: 60, open: 10, high: 12, low: 9, close: 11, volume: 100 },
  { time: 120, open: 11, high: 15, low: 10, close: 14, volume: 400 },
  // Falls from its open but closes above the previous close.
  { time: 180, open: 16, high: 17, low: 13, close: 15 },
];

/** A standalone (non-main) candle series on a timeline that already holds the bar times. */
function series(options: Partial<CandleSeriesOptions>, bars: Bar[] = BARS): CandleSeries {
  const timeline = new Timeline();
  timeline.set(bars.map((b) => b.time));
  const host = {
    timeline,
    theme: darkTheme,
    maxTextureSize: 4096,
    mainDataChanged() {},
    mainLastBarChanged() {},
    requestRender() {},
  } as SeriesHost;
  const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  const s = new CandleSeries(host, pane, {
    title: '',
    style: 'candles',
    bodyRatio: 0.7,
    lineWidth: 2,
    lastValueLabel: true,
    animate: false,
    ...options,
  });
  s.setData(bars);
  return s;
}

/** Decoded rect instances of a series' batch. */
function rects(s: CandleSeries) {
  const { bytes, count } = s.batch;
  const f32 = new Float32Array(bytes.buffer, 0, (count * RECT_STRIDE) / 4);
  return Array.from({ length: count }, (_, i) => {
    const f = (i * RECT_STRIDE) / 4;
    const c = i * RECT_STRIDE + 20;
    return {
      index: f32[f]!,
      p0: f32[f + 1]! + s.batch.base,
      p1: f32[f + 2]! + s.batch.base,
      kind: f32[f + 3]!,
      weight: f32[f + 4]!,
      color: [bytes[c], bytes[c + 1], bytes[c + 2], bytes[c + 3]],
    };
  });
}

const rgba = (hex: string) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
  255,
];

describe('volumeWidthFactor', () => {
  it('scales linearly with volume relative to the largest visible volume', () => {
    expect(volumeWidthFactor(500, 1000)).toBeCloseTo(0.5);
    expect(volumeWidthFactor(1000, 1000)).toBe(1);
  });

  it('keeps a minimum width and never exceeds a normal body', () => {
    expect(volumeWidthFactor(1, 1000)).toBe(VOLUME_MIN_WIDTH);
    expect(volumeWidthFactor(0, 1000)).toBe(VOLUME_MIN_WIDTH);
    expect(volumeWidthFactor(2000, 1000)).toBe(1);
  });

  it('falls back to the normal width without usable volume', () => {
    expect(volumeWidthFactor(undefined, 1000)).toBe(1);
    expect(volumeWidthFactor(Number.NaN, 1000)).toBe(1);
    expect(volumeWidthFactor(-5, 1000)).toBe(1);
    expect(volumeWidthFactor(500, 0)).toBe(1);
  });
});

describe('volumeBodyWidth', () => {
  it('scales a wide body and keeps it three wicks wide', () => {
    expect(volumeBodyWidth(21, 1, 1)).toBe(21);
    expect(volumeBodyWidth(21, 1, 0.5)).toBe(9);
    expect(volumeBodyWidth(8, 1, VOLUME_MIN_WIDTH)).toBe(3);
  });

  it('still follows volume when the body is narrower than three wicks', () => {
    expect(volumeBodyWidth(5, 2, 1)).toBe(4);
    expect(volumeBodyWidth(5, 2, 0.5)).toBe(2);
    expect(volumeBodyWidth(5, 2, VOLUME_MIN_WIDTH)).toBe(2);
    expect(volumeBodyWidth(8, 3, 1)).toBe(7);
    expect(volumeBodyWidth(8, 3, 0.5)).toBe(3);
  });

  it('never exceeds the normal body width', () => {
    for (let w = 1; w <= 12; w++) {
      for (const wick of [1, 2, 3]) {
        const normal = Math.max(wick, w);
        expect(volumeBodyWidth(normal, wick, VOLUME_MIN_WIDTH)).toBeLessThanOrEqual(normal);
      }
    }
  });
});

describe('hlcBandColumns', () => {
  const xs = [0, 0.3, 10, 20];
  const highs = [50, 40, 30, 20];
  const closes = [60, 55, 45, 35];
  const lows = [70, 80, 60, 50];
  const band = (a: number, b: number) =>
    hlcBandColumns(a, b, (k) => xs[k]!, (k) => highs[k]!, (k) => closes[k]!, (k) => lows[k]!);

  it('emits one entry per bar when bars are a pixel apart or more', () => {
    const out = band(2, 4);
    expect(out.x).toEqual([10, 20]);
    expect(out.high).toEqual([30, 20]);
    expect(out.close).toEqual([45, 35]);
    expect(out.low).toEqual([60, 50]);
  });

  it('merges bars sharing a pixel column into the outer envelope and the last close', () => {
    const out = band(0, 4);
    expect(out.x).toEqual([0, 10, 20]);
    expect(out.high[0]).toBe(40);
    expect(out.low[0]).toBe(80);
    expect(out.close[0]).toBe(55);
  });

  it('is empty for an empty range', () => {
    expect(band(2, 2).x).toEqual([]);
  });
});

describe('CandleSeries styles', () => {
  it('autoscales range band on high/low and line on closes', () => {
    expect(series({ style: 'rangeBand' }).priceRange(0, 2)).toEqual([9, 17]);
    expect(series({ style: 'line' }).priceRange(0, 2)).toEqual([11, 15]);
    expect(series({ style: 'volumeCandles' }).priceRange(0, 2)).toEqual([9, 17]);
  });

  it('draws range band in 2D only', () => {
    expect(series({ style: 'rangeBand' }).batch.count).toBe(0);
  });

  it('writes volume as the body width weight for volume candles', () => {
    const r = rects(series({ style: 'volumeCandles' }));
    expect(r).toHaveLength(9);
    expect(r.map((x) => x.kind)).toEqual([
      RectKind.Wick, RectKind.Body, RectKind.HollowBody,
      RectKind.Wick, RectKind.Body, RectKind.HollowBody,
      RectKind.Wick, RectKind.Body, RectKind.HollowBody,
    ]);
    expect([r[1]!.weight, r[4]!.weight, r[7]!.weight]).toEqual([100, 400, -1]);
    expect(r[2]!.weight).toBe(100);
  });

  it('draws HLC bars as a high-low stroke plus a close tick', () => {
    const r = rects(series({ style: 'hlcBars' }));
    expect(r).toHaveLength(6);
    expect(r[0]).toMatchObject({ kind: RectKind.Wick, p0: 9, p1: 12 });
    expect(r[1]).toMatchObject({ kind: RectKind.TickRight, p0: 11, p1: 11 });
  });

  it('colours by the open, or by the previous close when asked', () => {
    const up = rgba(darkTheme.up);
    const down = rgba(darkTheme.down);
    expect(rects(series({ style: 'bars' }))[6]!.color).toEqual(down);
    expect(rects(series({ style: 'bars', colorByPreviousClose: true }))[6]!.color).toEqual(up);
    const s = series({ style: 'candles', colorByPreviousClose: true });
    expect(s.legend(2)!.parts[0]!.color).toBe(darkTheme.up);
  });

  it('uses body colours for wicks and no outline by default', () => {
    const r = rects(series({ style: 'candles' }));
    expect(r[0]!.color).toEqual(rgba(darkTheme.up));
    expect(r[2]!.color).toEqual([0, 0, 0, 0]);
  });

  it('applies wick and border colours', () => {
    const r = rects(
      series({
        style: 'candles',
        upWickColor: '#111111',
        downWickColor: '#222222',
        upBorderColor: '#333333',
        downBorderColor: '#444444',
      }),
    );
    expect(r[0]!.color).toEqual(rgba('#111111'));
    expect(r[2]!.color).toEqual(rgba('#333333'));
    expect(r[6]!.color).toEqual(rgba('#222222'));
    expect(r[8]!.color).toEqual(rgba('#444444'));
    expect(r[7]!.color).toEqual(rgba(darkTheme.down));
  });

  it('keeps hollow candles outlined when no border colour is set', () => {
    const r = rects(series({ style: 'hollow' }));
    expect(r).toHaveLength(12);
    // Rising first bar: no fill, outline in the body colour.
    expect(r[2]!.color).toEqual([0, 0, 0, 0]);
    expect(r[3]!.color).toEqual(rgba(darkTheme.up));
  });

  it('outlines falling bodies with hollowDown and splits their wick', () => {
    const r = rects(series({ style: 'candles', hollowDown: true }));
    expect(r).toHaveLength(12);
    // Rising first bar: filled, full wick, the spare wick paints nothing.
    expect(r[1]!.color).toEqual(rgba(darkTheme.up));
    expect([r[0]!.p0, r[0]!.p1]).toEqual([9, 12]);
    expect(r[3]!.color).toEqual([0, 0, 0, 0]);
    // Falling third bar (16 to 15): no fill, a down-coloured outline, wick below and above the body.
    expect(r[9]!.color).toEqual([0, 0, 0, 0]);
    expect(r[10]!.color).toEqual(rgba(darkTheme.down));
    expect([r[8]!.p0, r[8]!.p1]).toEqual([13, 15]);
    expect([r[11]!.p0, r[11]!.p1]).toEqual([16, 17]);
    expect(r[11]!.kind).toBe(RectKind.Wick);
    expect(r[11]!.color).toEqual(r[8]!.color);
  });

  it('leaves styles other than candles, Heikin-Ashi and volume candles alone with hollowDown', () => {
    expect(rects(series({ style: 'bars', hollowDown: true }))).toHaveLength(9);
    expect(rects(series({ style: 'hollow', hollowDown: true }))).toHaveLength(12);
  });

  it('eases the live bar volume along with its prices', () => {
    const s = series({ style: 'volumeCandles', animate: true });
    s.update({ ...BARS[2]!, close: 16, volume: 1000 });
    expect(s.step(16)).toBe(true);
    const mid = rects(s)[7]!.weight;
    // Missing volume snaps to the new value on the first step.
    expect(mid).toBe(1000);
    s.update({ ...BARS[2]!, close: 16, volume: 2000 });
    s.step(16);
    const eased = rects(s)[7]!.weight;
    expect(eased).toBeGreaterThan(1000);
    expect(eased).toBeLessThan(2000);
    for (let i = 0; i < 200 && s.step(16); i++);
    expect(rects(s)[7]!.weight).toBe(2000);
  });

  it('settles when the live bar volume eases to zero', () => {
    const s = series({ style: 'volumeCandles', animate: true });
    s.update({ ...BARS[2]!, close: 16, volume: 1000 });
    s.step(16);
    s.update({ ...BARS[2]!, close: 16, volume: 0 });
    let steps = 0;
    while (s.step(16) && steps < 1000) steps++;
    expect(steps).toBeLessThan(1000);
    expect(rects(s)[7]!.weight).toBe(0);
  });
});
