import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { adjustments, dataSource, drawingTools } from '../src/builtins';
import { Chart } from '../src/chart';
import { createLinkGroup } from '../src/link-group';
import { adjustBar, adjustBars, adjustmentMarkers, mergeAdjustments, priceFactor, type Adjustment } from '../src/data/adjust';
import { createLocalizer } from '../src/util/locale';
import type { MarkerPointerEvent } from '../src/annotations/types';
import type { TradePointerEvent } from '../src/annotations/trades';
import { createStaticDataSource } from '../src/data/adapters';
import type { DataSource, RangeRequest } from '../src/data/types';
import type { Bar } from '../src/types';

const DAY = 86400;
const bar = (day: number, price: number): Bar => ({ time: day * DAY, open: price, high: price + 1, low: price - 1, close: price, volume: 100 });
/** Twenty days at a flat price of 80; the 4-for-1 split on day 10 is already in the prices from then on. */
const raw = Array.from({ length: 20 }, (_, d) => bar(d, d < 10 ? 80 : 20));
const split: Adjustment = { time: 10 * DAY, kind: 'split', factor: 0.25, label: '4:1 split' };
const dividend: Adjustment = { time: 15 * DAY, kind: 'dividend', factor: 0.98 };

describe('adjustBars', () => {
  it('scales prices before a split by its factor and their volume by its inverse', () => {
    const out = adjustBars(raw, [split], 'splits');
    expect(out[9]).toEqual({ time: 9 * DAY, open: 20, high: 20.25, low: 19.75, close: 20, volume: 400 });
    // From the split on, bars are as sent (the same objects).
    expect(out[10]).toBe(raw[10]);
    expect(out.map((b) => b.close)).toEqual(Array(20).fill(20));
  });

  it('multiplies the factors of every later adjustment', () => {
    const bars = Array.from({ length: 6 }, (_, d) => bar(d, 100));
    const out = adjustBars(bars, [{ time: 2 * DAY, kind: 'split', factor: 0.5 }, { time: 4 * DAY, kind: 'split', factor: 0.25 }], 'splits');
    expect(out.map((b) => b.close)).toEqual([12.5, 12.5, 25, 25, 100, 100]);
    expect(out.map((b) => b.volume)).toEqual([800, 800, 400, 400, 100, 100]);
  });

  it('applies dividends only in the all mode, and leaves their volume alone', () => {
    const splitsOnly = adjustBars(raw, [split, dividend], 'splits');
    expect(splitsOnly[14]).toBe(raw[14]);
    const all = adjustBars(raw, [split, dividend], 'all');
    expect(all[14]!.close).toBeCloseTo(19.6);
    expect(all[14]!.volume).toBe(100);
    expect(all[9]!.close).toBeCloseTo(80 * 0.25 * 0.98);
    expect(all[9]!.volume).toBe(400);
    expect(all[15]).toBe(raw[15]);
  });

  it('returns the bars themselves when nothing applies', () => {
    expect(adjustBars(raw, [split], 'none')).toBe(raw);
    expect(adjustBars(raw, [], 'all')).toBe(raw);
    expect(adjustBars(raw, [{ ...split, time: 0 }], 'all')).toBe(raw);
    // Unusable factors and times are ignored.
    expect(adjustBars(raw, [{ ...split, factor: 0 }, { ...split, factor: NaN }, { ...split, time: NaN }], 'all')).toBe(raw);
  });

  it('adjusts a single bar the same way', () => {
    const all = adjustBars(raw, [split, dividend], 'all');
    for (const i of [0, 9, 12, 15, 19]) expect(adjustBar(raw[i]!, [split, dividend], 'all')).toEqual(all[i]);
  });

  it('gives the factor a bar at a time is scaled by', () => {
    const all = adjustBars(raw, [split, dividend], 'all');
    for (const i of [0, 9, 12, 15, 19]) expect(raw[i]!.close * priceFactor(raw[i]!.time, [split, dividend], 'all')).toBe(all[i]!.close);
    expect(priceFactor(0, [split, dividend], 'splits')).toBe(0.25);
    expect(priceFactor(0, [split, dividend], 'none')).toBe(1);
  });

  it('merges lists by time without repeats', () => {
    expect(mergeAdjustments([dividend], [split, { ...dividend }])).toEqual([split, dividend]);
  });
});

describe('chart adjustment option', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  function source(adjustments?: Adjustment[]) {
    const base = createStaticDataSource({ symbols: [{ symbol: 'ABC', name: 'ABC' }], bars: () => raw });
    const history = vi.fn(base.history);
    const fetchAdjustments = vi.fn(async (_s: unknown, { from, to }: RangeRequest) => (adjustments ?? []).filter((a) => a.time >= from && a.time < to));
    const out: DataSource = { ...base, history, ...(adjustments ? { adjustments: fetchAdjustments } : {}) };
    return { source: out, history, fetchAdjustments };
  }

  async function chart(src: DataSource, adjustment: 'none' | 'splits' | 'all' = 'none') {
    const c = new Chart(fakeContainer(), { adjustment, timezone: 'UTC' });
    charts.push(c);
    c.setDataSource(src, { initialBars: 100 });
    await c.setSymbol('ABC', '1d');
    return c;
  }
  const closes = (c: Chart) => c.main!.data.map((b) => b.close);

  it('shows the bars as sent until asked to adjust, then toggles without refetching or moving the view', async () => {
    const { source: src, history, fetchAdjustments } = source([split, dividend]);
    const c = await chart(src);
    expect(fetchAdjustments).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ABC' }), { from: 0, to: 19 * DAY + 1, signal: expect.anything() });
    expect(closes(c)).toEqual(raw.map((b) => b.close));
    const range = c.getVisibleRange();

    c.applyOptions({ adjustment: 'splits' });
    expect(closes(c)).toEqual(Array(20).fill(20));
    c.applyOptions({ adjustment: 'all' });
    expect(c.main!.data[9]!.close).toBeCloseTo(19.6);
    c.applyOptions({ adjustment: 'none' });
    expect(closes(c)).toEqual(raw.map((b) => b.close));
    expect(c.getVisibleRange()).toEqual(range);
    expect(history).toHaveBeenCalledOnce();
  });

  it('loads the adjustments of each history page and adjusts the whole series', async () => {
    const { source: src, fetchAdjustments } = source([split]);
    const c = new Chart(fakeContainer(), { adjustment: 'splits', timezone: 'UTC' });
    charts.push(c);
    c.setDataSource(src, { initialBars: 8, pageBars: 8 });
    await c.setSymbol('ABC', '1d');
    // Days 12 to 19: the split is not in their span.
    expect(fetchAdjustments).toHaveBeenLastCalledWith(expect.anything(), { from: 12 * DAY, to: 19 * DAY + 1, signal: expect.anything() });
    expect(closes(c)).toEqual(Array(8).fill(20));
    await c.data!.loadMore();
    // Days 4 to 11 hold the split, which now scales days 4 to 9.
    expect(fetchAdjustments).toHaveBeenLastCalledWith(expect.anything(), { from: 4 * DAY, to: 12 * DAY, signal: expect.anything() });
    expect(closes(c)).toEqual(Array(16).fill(20));
  });

  it('adjusts from the first load when the option is set', async () => {
    const c = await chart(source([split]).source, 'splits');
    expect(closes(c)).toEqual(Array(20).fill(20));
  });

  it('leaves sources without adjustments as they are', async () => {
    const c = await chart(source().source, 'all');
    expect(closes(c)).toEqual(raw.map((b) => b.close));
  });

  it('passes live bars after every adjustment through as sent', async () => {
    let onBar: ((bar: Bar) => void) | undefined;
    const live: DataSource = {
      ...source([split]).source,
      stream: (_symbol, _interval, listener) => {
        onBar = listener;
        return () => {};
      },
    };
    const c = await chart(live, 'splits');
    onBar!(bar(20, 21));
    expect(c.main!.data[20]).toEqual(bar(20, 21));
  });
});

describe('failing adjustments', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  function setup(fetchAdjustments: DataSource['adjustments'], adjustment: 'none' | 'splits' = 'splits') {
    const base = createStaticDataSource({ symbols: [{ symbol: 'ABC', name: 'ABC' }, { symbol: 'XYZ', name: 'XYZ' }], bars: () => raw });
    const history = vi.fn(base.history);
    const c = new Chart(fakeContainer(), { adjustment, timezone: 'UTC' });
    charts.push(c);
    const warnings: { kind: string; code: string; cause: unknown }[] = [];
    const errors = vi.fn();
    const notes: { message: string; kind: string }[] = [];
    c.on('data:warning', (e) => warnings.push({ kind: e.kind, code: e.error.code, cause: e.error.cause }));
    c.on('data:error', errors);
    c.on('ui:notify', (e) => notes.push({ message: e.message, kind: e.kind }));
    return { c, history, warnings, errors, notes, source: { ...base, history, adjustments: fetchAdjustments } as DataSource };
  }

  it('loads the bars unadjusted and reports a warning instead of failing the load', async () => {
    const boom = new Error('down');
    const { c, source: src, warnings, errors, notes } = setup(() => Promise.reject(boom));
    c.setDataSource(src, { initialBars: 100 });
    await c.setSymbol('ABC', '1d');
    expect(c.main!.data.map((b) => b.close)).toEqual(raw.map((b) => b.close));
    expect(warnings).toEqual([{ kind: 'initial', code: 'adjustments-failed', cause: boom }]);
    expect(errors).not.toHaveBeenCalled();
    expect(c.getStatus()).toBeNull();
    expect(notes).toEqual([{ message: expect.stringContaining('unadjusted'), kind: 'error' }]);
  });

  it('notifies nobody while no adjustment is shown', async () => {
    const { c, source: src, warnings, notes } = setup(() => Promise.reject(new Error('down')), 'none');
    c.setDataSource(src, { initialBars: 100 });
    await c.setSymbol('ABC', '1d');
    expect(warnings).toHaveLength(1);
    expect(notes).toEqual([]);
  });

  it('keeps a history page whose adjustments failed', async () => {
    const fetchAdjustments = vi.fn(async () => [] as Adjustment[]);
    const { c, source: src, warnings, errors } = setup(fetchAdjustments);
    c.setDataSource(src, { initialBars: 8, pageBars: 8 });
    await c.setSymbol('ABC', '1d');
    fetchAdjustments.mockRejectedValueOnce(new Error('down'));
    expect(await c.data!.loadMore()).toBe(true);
    expect(c.main!.data).toHaveLength(16);
    expect(warnings.map((w) => w.kind)).toEqual(['history']);
    expect(errors).not.toHaveBeenCalled();
  });

  it('asks again on the next load of the symbol instead of reusing the unadjusted bars', async () => {
    const fetchAdjustments = vi.fn(async (_s: unknown, { from, to }: RangeRequest) => [split].filter((a) => a.time >= from && a.time < to));
    fetchAdjustments.mockRejectedValueOnce(new Error('down'));
    const { c, source: src, history } = setup(fetchAdjustments);
    c.setDataSource(src, { initialBars: 100 });
    await c.setSymbol('ABC', '1d');
    expect(c.main!.data[0]!.close).toBe(80);
    await c.setSymbol('XYZ', '1d');
    await c.setSymbol('ABC', '1d');
    expect(history).toHaveBeenCalledTimes(3);
    expect(c.main!.data[0]!.close).toBe(20);
  });
});

describe('drawings under an adjustment', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  async function chart(options: { adjustment?: 'none' | 'splits' | 'all'; initialBars?: number } = {}) {
    const base = createStaticDataSource({ symbols: [{ symbol: 'ABC', name: 'ABC' }], bars: () => raw });
    const src: DataSource = {
      ...base,
      adjustments: async (_s, { from, to }) => [split, dividend].filter((a) => a.time >= from && a.time < to),
    };
    const c = new Chart(fakeContainer(), { adjustment: options.adjustment ?? 'none', timezone: 'UTC' });
    charts.push(c);
    c.setDataSource(src, { initialBars: options.initialBars ?? 100, pageBars: 8 });
    await c.setSymbol('ABC', '1d');
    return c;
  }
  const prices = (c: Chart, id: string) => c.drawings.getById(id)!.points.map((p) => p.price);
  const line = (c: Chart, from: number, to: number, pane = 0) =>
    c.drawings.add({ type: 'trendline', pane, points: [{ time: 5 * DAY, price: from }, { time: 17 * DAY, price: to }], style: {} });

  it('shows the bars as sent without the adjustments() plugin, warns once, and adjusts them and the drawings once it is installed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const base = createStaticDataSource({ symbols: [{ symbol: 'ABC', name: 'ABC' }], bars: () => raw });
    const src: DataSource = { ...base, adjustments: async (_s, { from, to }) => [split, dividend].filter((a) => a.time >= from && a.time < to) };
    const c = new Chart(fakeContainer(), { adjustment: 'splits', timezone: 'UTC', plugins: [dataSource(), drawingTools()] });
    charts.push(c);
    c.setDataSource(src, { initialBars: 100 });
    await c.setSymbol('ABC', '1d');
    expect(c.main!.data.map((b) => b.close)).toEqual(raw.map((b) => b.close));
    expect(warn.mock.calls.filter(([m]) => String(m).includes('[adjustments-missing]'))).toHaveLength(1);
    const d = line(c, 80, 20);
    const uninstall = c.install(adjustments());
    expect(c.main!.data.map((b) => b.close)).toEqual(Array(20).fill(20));
    // The drawing stays on the same bars.
    expect(prices(c, d.id)).toEqual([20, 20]);
    uninstall();
    expect(c.main!.data.map((b) => b.close)).toEqual(raw.map((b) => b.close));
    expect(prices(c, d.id)).toEqual([80, 20]);
    warn.mockRestore();
  });

  it('keeps a drawing placed before a split on the same bars when the adjustment toggles', async () => {
    const c = await chart();
    // From the close of day 5 to the close of day 17, as sent.
    const d = line(c, 80, 20);
    c.applyOptions({ adjustment: 'splits' });
    expect(prices(c, d.id)).toEqual([c.main!.data[5]!.close, 20]);
    expect(prices(c, d.id)).toEqual([20, 20]);
    c.applyOptions({ adjustment: 'all' });
    expect(prices(c, d.id)[0]).toBeCloseTo(c.main!.data[5]!.close);
    c.applyOptions({ adjustment: 'none' });
    expect(prices(c, d.id)[0]).toBeCloseTo(80);
    expect(prices(c, d.id)[1]).toBe(20);
  });

  it('saves the prices as sent and loads them onto the adjusted bars', async () => {
    const c = await chart({ adjustment: 'splits' });
    const d = line(c, 20, 20);
    const saved = c.drawings.serialize();
    expect(saved.drawings[0]!.points.map((p) => p.price)).toEqual([80, 20]);
    c.drawings.clear();
    c.drawings.load(saved);
    expect(prices(c, d.id)).toEqual([20, 20]);
  });

  it('re-prices the undo history with the drawings', async () => {
    const c = await chart();
    const d = line(c, 80, 20);
    c.drawings.update(d.id, { points: [{ time: 5 * DAY, price: 60 }, { time: 17 * DAY, price: 20 }] });
    c.applyOptions({ adjustment: 'splits' });
    expect(prices(c, d.id)).toEqual([15, 20]);
    c.drawings.undo();
    expect(prices(c, d.id)).toEqual([20, 20]);
    c.drawings.redo();
    expect(prices(c, d.id)).toEqual([15, 20]);
  });

  it('follows a split that an older history page brings', async () => {
    const c = await chart({ adjustment: 'splits', initialBars: 8 });
    const d = line(c, 80, 20);
    await c.data!.loadMore();
    expect(prices(c, d.id)).toEqual([20, 20]);
  });

  it('mirrors drawings between linked charts onto the same bars, whatever their adjustment', async () => {
    const a = await chart({ adjustment: 'splits' });
    const b = await chart();
    const group = createLinkGroup([a, b], { drawings: true });
    // On a: 20 is day 5's close adjusted for the split; b shows it as sent, 80.
    const d = line(a, 20, 20);
    expect(prices(b, d.id)).toEqual([80, 20]);
    // Each chart re-prices its own copy; neither passes the move on to the other.
    b.applyOptions({ adjustment: 'splits' });
    expect(prices(a, d.id)).toEqual([20, 20]);
    expect(prices(b, d.id)).toEqual([20, 20]);
    const updates = vi.fn();
    b.on('drawing:update', updates);
    a.applyOptions({ adjustment: 'none' });
    expect(prices(a, d.id)).toEqual([80, 20]);
    expect(prices(b, d.id)).toEqual([20, 20]);
    expect(updates).not.toHaveBeenCalled();
    group.destroy();
  });

  it('leaves drawings on other panes alone', async () => {
    const c = await chart();
    c.addPane();
    const d = line(c, 80, 20, 1);
    const changes = vi.fn();
    c.on('drawings:change', changes);
    c.applyOptions({ adjustment: 'splits' });
    expect(prices(c, d.id)).toEqual([80, 20]);
    expect(changes).not.toHaveBeenCalled();
  });
});

describe('adjustmentMarkers', () => {
  it('labels each usable adjustment in the bottom lane, oldest first, with its kind and factor', () => {
    const other: Adjustment = { time: 12 * DAY, kind: 'other', factor: 0.5 };
    const markers = adjustmentMarkers([dividend, split, other, { ...split, factor: 0 }], createLocalizer({}));
    expect(markers).toEqual([
      {
        id: `adjustment:split:${10 * DAY}`,
        time: 10 * DAY,
        shape: 'label',
        position: 'bottom',
        text: 'S',
        tooltip: ['4:1 split', 'Earlier prices × 0.25'],
        kind: 'split',
      },
      expect.objectContaining({ time: 12 * DAY, text: 'C', tooltip: ['Corporate action', 'Earlier prices × 0.5'], kind: 'other' }),
      expect.objectContaining({ time: 15 * DAY, text: 'D', tooltip: ['Dividend', 'Earlier prices × 0.98'], kind: 'dividend' }),
    ]);
  });

  it('follows the localization', () => {
    const localizer = createLocalizer({ decimalSeparator: ',', messages: { adjustmentDividendShort: 'Div' } });
    expect(adjustmentMarkers([dividend], localizer)[0]).toMatchObject({ text: 'Div', tooltip: ['Dividend', 'Earlier prices × 0,98'] });
  });
});

describe('adjustment markers on the chart', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  async function chart(options: { adjustmentMarkers?: boolean } = {}, adjustments: Adjustment[] | null = [split, dividend]) {
    const base = createStaticDataSource({ symbols: [{ symbol: 'ABC', name: 'ABC' }], bars: () => raw });
    const src: DataSource = adjustments ? { ...base, adjustments: async () => adjustments } : base;
    const c = new Chart(fakeContainer(), { timezone: 'UTC', ...options });
    charts.push(c);
    c.setDataSource(src, { initialBars: 100 });
    await c.setSymbol('ABC', '1d');
    c.fitContent(false);
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
    return c;
  }

  /** The marker hovered on bar `day`, in the bottom lane of the main pane. */
  function hovering(c: Chart, day: number): MarkerPointerEvent | null {
    const hovers: MarkerPointerEvent[] = [];
    const off = c.on('marker:hover', (e) => hovers.push(e));
    const pane = c.panes[0]!;
    for (let dy = 2; dy < 40 && hovers.length === 0; dy += 2) {
      c.annotations.pointerMove({ x: c.time.indexToX(day), y: pane.top + pane.height - dy });
    }
    c.annotations.pointerMove({ x: c.time.width + 50, y: 0 });
    off();
    return hovers[0] ?? null;
  }

  it("marks the source's splits and dividends on the main series, apart from the app's markers", async () => {
    const c = await chart();
    expect(hovering(c, 10)?.marker).toMatchObject({ kind: 'split', text: 'S', tooltip: ['4:1 split', 'Earlier prices × 0.25'] });
    expect(hovering(c, 10)?.series).toBe(c.main);
    expect(hovering(c, 15)?.marker).toMatchObject({ kind: 'dividend', text: 'D' });
    expect(hovering(c, 12)).toBeNull();
    expect(c.annotations.getMarkers()).toEqual([]);
    // The app's own markers and clearing them leave the events alone.
    c.annotations.setMarkers([{ time: 3 * DAY, shape: 'circle' }]);
    c.annotations.clear();
    expect(hovering(c, 10)?.marker.kind).toBe('split');
  });

  it('marks them whatever the adjustment, and selects them with the marker filter', async () => {
    const c = await chart();
    c.applyOptions({ adjustment: 'splits' });
    expect(hovering(c, 15)?.marker.kind).toBe('dividend');
    c.annotations.setMarkerFilter({ kinds: ['split'] });
    expect(hovering(c, 15)).toBeNull();
    expect(hovering(c, 10)?.marker.kind).toBe('split');
  });

  it('hides them with the adjustmentMarkers option', async () => {
    const c = await chart({ adjustmentMarkers: false });
    expect(hovering(c, 10)).toBeNull();
    c.applyOptions({ adjustmentMarkers: true });
    expect(hovering(c, 10)?.marker.kind).toBe('split');
    c.applyOptions({ adjustmentMarkers: false });
    expect(hovering(c, 10)).toBeNull();
  });

  it('drops them with the data source, and marks nothing for sources without adjustments', async () => {
    const c = await chart();
    c.setDataSource(null);
    expect(hovering(c, 10)).toBeNull();
    const plain = await chart({}, null);
    expect(hovering(plain, 10)).toBeNull();
  });

  it('relabels them when the localization changes', async () => {
    const c = await chart();
    c.applyOptions({ localization: { messages: { adjustmentSplitShort: 'Sp' } } });
    expect(hovering(c, 10)?.marker.text).toBe('Sp');
  });
});

describe('annotations under an adjustment', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  async function chart() {
    const base = createStaticDataSource({ symbols: [{ symbol: 'ABC', name: 'ABC' }], bars: () => raw });
    const src: DataSource = { ...base, adjustments: async () => [split] };
    const c = new Chart(fakeContainer(), { timezone: 'UTC', adjustmentMarkers: false });
    charts.push(c);
    c.setDataSource(src, { initialBars: 100 });
    await c.setSymbol('ABC', '1d');
    c.fitContent(false);
    return c;
  }
  const frame = (c: Chart) => {
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
  };
  /** Chart-root point of bar `day` at `price` on the main scale, after a frame. */
  const at = (c: Chart, day: number, price: number) => {
    frame(c);
    return { x: c.time.indexToX(day), y: c.panes[0]!.top + c.panes[0]!.primary.priceToY(price) };
  };
  function markerAt(c: Chart, day: number, price: number): string | null {
    const hovers: MarkerPointerEvent[] = [];
    const off = c.on('marker:hover', (e) => hovers.push(e));
    c.annotations.pointerMove(at(c, day, price));
    c.annotations.pointerMove({ x: c.time.width + 50, y: 0 });
    off();
    return hovers[0]?.marker.id ?? null;
  }

  it('draws atPrice markers at the adjusted price of their bar, keeping the prices the app set', async () => {
    const c = await chart();
    c.annotations.setMarkers([
      { id: 'before', time: 5 * DAY, shape: 'circle', position: 'atPrice', price: 80 },
      { id: 'after', time: 15 * DAY, shape: 'circle', position: 'atPrice', price: 22 },
    ]);
    expect(markerAt(c, 5, 80)).toBe('before');
    c.applyOptions({ adjustment: 'splits' });
    expect(markerAt(c, 5, 80 * 0.25)).toBe('before');
    expect(markerAt(c, 15, 22)).toBe('after');
    expect(c.annotations.getMarkers().map((m) => m.price)).toEqual([80, 22]);
    c.applyOptions({ adjustment: 'none' });
    expect(markerAt(c, 5, 80)).toBe('before');
  });

  it('leaves shape plot markers alone: they sit on values computed from the adjusted bars', async () => {
    const c = await chart();
    c.applyOptions({ adjustment: 'splits' });
    c.annotations.setPlotMarkers(c.main!, [{ id: 'plot', time: 5 * DAY, shape: 'circle', position: 'atPrice', price: 20 }]);
    expect(markerAt(c, 5, 20)).toBe('plot');
  });

  it('draws fills at the adjusted price of their bar, with the traded price in the event', async () => {
    const c = await chart();
    c.annotations.setTrades([{ id: 'f', time: 5 * DAY, side: 'buy', price: 80, quantity: 1 }]);
    c.applyOptions({ adjustment: 'splits' });
    const hovers: TradePointerEvent[] = [];
    c.on('trade:hover', (e) => hovers.push(e));
    c.annotations.pointerMove(at(c, 5, 20));
    expect(hovers).toHaveLength(1);
    expect(hovers[0]!.group.price).toBe(80);
    expect(c.annotations.getTrades()[0]!.price).toBe(80);
  });

  it('leaves alert lines at their price: they are levels of the live price, which adjustment never moves', async () => {
    const c = await chart();
    const alert = c.annotations.addAlertLine({ price: 21 });
    c.applyOptions({ adjustment: 'splits' });
    expect(alert.options.price).toBe(21);
    expect(c.annotations.alertsCrossed(20, 22).map((a) => a.line)).toEqual([alert]);
  });
});
