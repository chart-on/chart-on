import { describe, expect, it } from 'vitest';
import { CandleSeries, LineSeries, defaultFormat, scaleFormat, type CandleSeriesOptions, type LineSeriesOptions, type SeriesHost } from '../src/series';
import { Pane } from '../src/pane';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { priceTicks } from '../src/util/format';
import { createPriceFormat } from '../src/util/price-format';

const host: SeriesHost = {
  timeline: new Timeline(),
  theme: darkTheme,
  maxTextureSize: 4096,
  mainDataChanged: () => {},
  mainLastBarChanged: () => {},
  requestRender: () => {},
};

const pane = () => new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });

function candles(options: Partial<CandleSeriesOptions> = {}, p = pane()) {
  const series = new CandleSeries(host, p, {
    title: '',
    style: 'candles',
    bodyRatio: 0.8,
    lineWidth: 1,
    lastValueLabel: true,
    animate: false,
    ...options,
  });
  series.data = [{ time: 0, open: 1.5, high: 2, low: 1, close: 1.23456 }];
  return series;
}

function line(options: Partial<LineSeriesOptions> = {}, p = pane()) {
  return new LineSeries(host, p, {
    title: '',
    lineWidth: 1,
    area: false,
    format: (v) => `v${v}`,
    lastValueLabel: true,
    ...options,
  });
}

describe('series price format', () => {
  it('candles use priceFormat, then precision, then detected decimals', () => {
    expect(candles().format(1.23456)).toBe('1.2346');
    expect(candles({ precision: 2 }).format(1.23456)).toBe('1.23');
    const fraction = candles({ precision: 2, priceFormat: { type: 'fraction', denominator: 32 } });
    expect(fraction.format(101.5)).toBe("101'16");
    expect(fraction.formatModel.tickSize(101)).toBe(1 / 32);
  });

  it('follows priceFormat changes', () => {
    const s = candles({ priceFormat: { type: 'decimal', tickSize: 0.5 } });
    expect(s.format(1.3)).toBe('1.5');
    expect(s.priceFormat?.tickSize(1)).toBe(0.5);
    s.options = { ...s.options, priceFormat: { type: 'decimal', precision: 3 } };
    expect(s.format(1.3)).toBe('1.300');
  });

  it('line and histogram labels prefer priceFormat over format', () => {
    expect(line().formatValue(2)).toBe('v2');
    expect(line({ priceFormat: { type: 'percent' } }).formatValue(2)).toBe('2.00%');
  });
});

describe('series on a formatted pane', () => {
  it('lines and histograms without their own format follow the pane scale', () => {
    const p = pane();
    const c = candles({ priceFormat: { type: 'fraction', denominator: 32 } }, p);
    const l = line({ format: defaultFormat }, p);
    p.series.push(c, l);
    expect(l.formatValue(101.5)).toBe("101'16");
  });

  it('keep an explicit format, and overlays keep compact', () => {
    const p = pane();
    const c = candles({ priceFormat: { type: 'fraction', denominator: 32 } }, p);
    const custom = line({ format: (v) => `v${v}` }, p);
    const overlay = line({ format: defaultFormat, overlay: { top: 0.8, bottom: 0 } }, p);
    p.series.push(c, custom, overlay);
    expect(custom.formatValue(101.5)).toBe('v101.5');
    expect(overlay.formatValue(12_500)).toBe('12.5K');
  });

  it('fall back to compact without a pane format', () => {
    const l = line({ format: defaultFormat });
    l.pane.series.push(l);
    expect(l.formatValue(12_500)).toBe('12.5K');
  });

  it('reject an invalid priceFormat before changing anything', () => {
    const s = candles({ precision: 2 });
    expect(() => s.applyOptions({ priceFormat: { type: 'decimal', tickSize: 0 } })).toThrow(RangeError);
    expect(s.options.priceFormat).toBeUndefined();
    expect(() => candles({ priceFormat: { type: 'fraction', denominator: 1 } })).toThrow(RangeError);
  });
});

describe('scaleFormat', () => {
  it('takes the first candle series on the pane scale', () => {
    const p = pane();
    const l = line({ priceFormat: { type: 'percent' } }, p);
    const c = candles({ priceFormat: { type: 'decimal', tickSize: 0.25 } }, p);
    expect(scaleFormat([l, c])?.format(1.1)).toBe('1.00');
  });

  it('falls back to a series with a priceFormat, skipping overlays', () => {
    const p = pane();
    const overlay = candles({ overlay: { top: 0.8, bottom: 0 }, priceFormat: { type: 'volume' } }, p);
    const plain = line({}, p);
    const formatted = line({ priceFormat: { type: 'decimal', precision: 1 } }, p);
    expect(scaleFormat([overlay, plain, formatted])?.format(1.26)).toBe('1.3');
    expect(scaleFormat([overlay, plain])).toBeNull();
  });
});

describe('price axis ticks', () => {
  it('land on the format ticks', () => {
    const f = createPriceFormat({ type: 'fraction', denominator: 32 });
    const t = priceTicks(100, 100.5, 400, 40, (step) => f.axisStep(step, 100));
    expect(t.values.length).toBeGreaterThan(1);
    for (const v of t.values) expect(f.round(v)).toBeCloseTo(v, 12);
    expect(new Set(t.values.map((v) => f.format(v))).size).toBe(t.values.length);
  });
});
