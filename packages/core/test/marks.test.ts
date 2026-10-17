import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { annotations, dataSource, sourceMarkers } from '../src/builtins';
import { Chart } from '../src/chart';
import { createStaticDataSource } from '../src/data/adapters';
import { MARKERS_RETRY_DELAYS, MarkersLoader, readMarker, toBarMarker, type MarkersSource } from '../src/data/marks';
import type { BarsReset, DataEvents, DataSource, RangeRequest, SourceMarker, SymbolInfo } from '../src/data/types';
import { ChartError } from '../src/errors';
import type { MarkerPointerEvent } from '../src/annotations/types';
import type { IndicatorDef } from '../src/indicators/types';
import type { Bar, Point } from '../src/types';

/** Let pending promises settle without timers, so fake timers can be used. */
const ticks = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const info: SymbolInfo = { symbol: 'ABC', name: 'ABC' };

describe('readMarker', () => {
  it('returns a frozen copy of a valid marker and drops malformed ones', () => {
    const marker = readMarker({ id: 'e1', time: 60, text: 'E', tooltip: 'Earnings\nbeat by 3%', kind: 'earnings', severity: 2, extra: 'ignored' });
    expect(marker).toEqual({ id: 'e1', time: 60, text: 'E', tooltip: 'Earnings\nbeat by 3%', kind: 'earnings', severity: 2 });
    expect(Object.isFrozen(marker)).toBe(true);
    expect(readMarker({ id: 'x', time: 60, shape: 'x-cross' })).toMatchObject({ shape: 'x-cross' });
    // Both placements: on the bar and on the time axis.
    expect(readMarker({ id: 'b', time: 60, position: 'above' })).toMatchObject({ position: 'above' });
    expect(readMarker({ id: 't', time: 60, position: 'timeAxis' })).toMatchObject({ position: 'timeAxis' });
    for (const bad of [
      null,
      'e1',
      { time: 60 },
      { id: '', time: 60 },
      { id: 'a', time: Number.NaN },
      { id: 'a', time: 60, shape: 'star' },
      { id: 'a', time: 60, position: 'atPrice' },
      // Lines are `\n` in one string now, not an array.
      { id: 'a', time: 60, tooltip: ['Earnings', 'beat'] },
      { id: 'a', time: 60, text: 5 },
      { id: 'a', time: 60, size: -1 },
      { id: 'a', time: 60, severity: 4 },
    ]) {
      expect(readMarker(bad)).toBeNull();
    }
  });

  it('draws as a circle in the bottom lane unless the marker says otherwise, one tooltip row per line', () => {
    expect(toBarMarker({ id: 'a', time: 60 })).toEqual({ id: 'a', time: 60, shape: 'circle', position: 'bottom' });
    expect(toBarMarker({ id: 'b', time: 60, shape: 'flag', position: 'above', color: '#f00', size: 2, tooltip: 'Earnings\nbeat by 3%' })).toEqual({
      id: 'b',
      time: 60,
      shape: 'flag',
      position: 'above',
      color: '#f00',
      size: 2,
      tooltip: ['Earnings', 'beat by 3%'],
    });
  });
});

describe('MarkersLoader', () => {
  afterEach(() => vi.useRealTimers());

  type Call = { interval: string; from: number; to: number; signal: AbortSignal; resolve: (marks: unknown) => void; reject: (e: unknown) => void };

  function setup() {
    const calls: Call[] = [];
    const source = {
      symbol: async () => info,
      search: async () => [],
      history: async () => ({ bars: [] }),
      markers: (_s: SymbolInfo, interval: string, { from, to, signal }: RangeRequest) =>
        // Answers are untyped: tests also send malformed markers.
        new Promise<SourceMarker[]>((resolve, reject) => calls.push({ interval, from, to, signal, resolve: (markers) => resolve(markers as SourceMarker[]), reject })),
    } as MarkersSource;
    const shown: (readonly SourceMarker[])[] = [];
    const bands: boolean[] = [];
    const events: { event: keyof DataEvents; payload: unknown }[] = [];
    const loader = new MarkersLoader(source, (markers, band) => (shown.push(markers), bands.push(band)), (event, payload) => events.push({ event, payload }));
    const changes = () => events.filter((e) => e.event === 'sourcemarkers:change').map((e) => (e.payload as DataEvents['sourcemarkers:change']).markers);
    return { calls, shown, bands, events, loader, changes };
  }

  it('asks after the current task, for the visible range padded by its width, then only for what a pan uncovers', async () => {
    const { calls, loader, shown } = setup();
    loader.setContext(info, '1m');
    // Bars 600 to 1140 visible: they end at 1200, so the view spans 600 s.
    loader.setView(600, 1140);
    // Never inside the call that moved the view (a frame).
    expect(calls).toHaveLength(0);
    await ticks();
    expect(calls.map((c) => [c.from, c.to])).toEqual([[0, 1800]]);
    // A second view change while the first request runs waits for it.
    loader.setView(0, 540);
    await ticks();
    expect(calls).toHaveLength(1);
    calls[0]!.resolve([{ id: 'a', time: 900 }]);
    await ticks();
    expect(shown.at(-1)!.map((m) => m.id)).toEqual(['a']);
    // Still inside what was fetched: nothing to ask.
    expect(calls).toHaveLength(1);
    loader.setView(-600, -60);
    await ticks();
    expect(calls.map((c) => [c.from, c.to])).toEqual([
      [0, 1800],
      [-1200, 0],
    ]);
    calls[1]!.resolve([]);
    await ticks();
    loader.setView(1800, 2340);
    await ticks();
    expect(calls.at(-1)).toMatchObject({ from: 1800, to: 3000 });
  });

  it('asks only around the view after a far jump, and lets marks far from the view go', async () => {
    const { calls, loader, changes } = setup();
    loader.setContext(info, '1m');
    loader.setView(600, 1140);
    await ticks();
    calls[0]!.resolve([{ id: 'a', time: 900 }]);
    await ticks();
    loader.setView(1_000_000, 1_000_540);
    await ticks();
    // Not the whole gap from the fetched span: the view, padded.
    expect(calls[1]).toMatchObject({ from: 1_000_000 - 600, to: 1_000_600 + 600 });
    expect(loader.markers).toEqual([]);
    expect(changes().at(-1)).toEqual([]);
    calls[1]!.resolve([{ id: 'b', time: 1_000_100 }]);
    await ticks();
    // Back to the start: the old span was let go, so it is asked for again.
    loader.setView(600, 1140);
    await ticks();
    expect(calls[2]).toMatchObject({ from: 0, to: 1800 });
    expect(loader.markers).toEqual([]);
  });

  it('merges batches by id, sorted by time, ignores marks outside the range and reports dropped ones', async () => {
    const { calls, loader, events, changes } = setup();
    loader.setContext(info, '1m');
    loader.setView(600, 1140);
    await ticks();
    calls[0]!.resolve([{ id: 'b', time: 1000 }, { id: 'a', time: 700, text: 'old' }, { id: 'bad' }]);
    await ticks();
    loader.setView(-600, -60);
    await ticks();
    calls[1]!.resolve([{ id: 'a', time: -100, text: 'new' }, { id: 'c', time: -300 }, { id: 'far', time: 5000 }]);
    await ticks();
    expect(loader.markers.map((m) => [m.id, m.text])).toEqual([
      ['c', undefined],
      ['a', 'new'],
      ['b', undefined],
    ]);
    const loaded = events.filter((e) => e.event === 'sourcemarkers:loaded').map((e) => e.payload as DataEvents['sourcemarkers:loaded']);
    expect(loaded.map((p) => [p.from, p.to, p.markers.length, p.dropped])).toEqual([
      [0, 1800, 2, 1],
      [-1200, 0, 2, 0],
    ]);
    expect(changes()).toHaveLength(2);
    // Payloads and the list cannot change the loader's state.
    expect(Object.isFrozen(loaded[0]!.markers)).toBe(true);
    expect(Object.isFrozen(loader.markers)).toBe(true);
    expect(() => {
      (loader.markers[0] as SourceMarker).text = 'X';
    }).toThrow(TypeError);
  });

  it('starts over on a new symbol or interval, ignoring the old answer', async () => {
    const { calls, loader, shown } = setup();
    loader.setContext(info, '1m');
    loader.setView(600, 1140);
    await ticks();
    calls[0]!.resolve([{ id: 'a', time: 900 }]);
    await ticks();
    loader.setView(-600, -60);
    await ticks();
    loader.setContext(info, '5m');
    expect(calls[1]!.signal.aborted).toBe(true);
    expect(shown.at(-1)).toEqual([]);
    calls[1]!.resolve([{ id: 'late', time: -300 }]);
    await ticks();
    expect(loader.markers).toEqual([]);
    loader.setView(0, 2700);
    await ticks();
    // Five-minute bars: the last one ends 300 s after its time.
    expect(calls.at(-1)).toMatchObject({ interval: '5m', from: -3000, to: 6000 });
  });

  it('reset drops the marks and asks nothing until the next context', async () => {
    const { calls, loader, changes } = setup();
    loader.setContext(info, '1m');
    loader.setView(600, 1140);
    await ticks();
    calls[0]!.resolve([{ id: 'a', time: 900 }]);
    await ticks();
    loader.setView(-600, -60);
    await ticks();
    loader.reset();
    expect(calls[1]!.signal.aborted).toBe(true);
    expect(changes().at(-1)).toEqual([]);
    loader.setView(5000, 6000);
    await ticks();
    expect(calls).toHaveLength(2);
  });

  it('refresh replaces the markers when the answer lands; turned off it drops them and asks nothing, even on a refresh or a new context', async () => {
    const { calls, loader, shown } = setup();
    loader.setContext(info, '1m');
    loader.setView(600, 1140);
    await ticks();
    calls[0]!.resolve([{ id: 'a', time: 900 }]);
    await ticks();
    loader.refresh();
    await ticks();
    expect(calls).toHaveLength(2);
    expect(loader.markers.map((m) => m.id)).toEqual(['a']);
    calls[1]!.resolve([{ id: 'b', time: 950 }]);
    await ticks();
    expect(loader.markers.map((m) => m.id)).toEqual(['b']);
    loader.setWanted(false);
    expect(shown.at(-1)).toEqual([]);
    loader.setView(-6000, -5000);
    loader.refresh();
    loader.setContext(info, '5m');
    loader.setView(-6000, -5000);
    await ticks();
    expect(calls).toHaveLength(2);
    // On again: the view is asked for.
    loader.setWanted(true);
    await ticks();
    expect(calls).toHaveLength(3);
    expect(calls[2]!.from).toBeLessThan(-6000);
  });

  it('keeps the band once a time-axis marker came, while the loader lasts', async () => {
    const { calls, bands, loader } = setup();
    loader.setContext(info, '1m');
    loader.setView(600, 1140);
    await ticks();
    calls[0]!.resolve([{ id: 'a', time: 900 }]);
    await ticks();
    expect(loader.band).toBe(false);
    loader.refresh();
    await ticks();
    calls[1]!.resolve([{ id: 't', time: 900, position: 'timeAxis' }]);
    await ticks();
    expect(loader.band).toBe(true);
    // Only the batch that brought the band says so.
    expect(bands).toEqual([false, true]);
    loader.setContext(info, '5m');
    expect(loader.band).toBe(true);
  });

  it('retries a failure with growing delays, then stops until a refresh', async () => {
    vi.useFakeTimers();
    const { calls, loader, events } = setup();
    loader.setContext(info, '1m');
    loader.setView(600, 1140);
    await ticks();
    const boom = new Error('down');
    const errors = () => events.filter((e) => e.event === 'sourcemarkers:error').map((e) => e.payload as DataEvents['sourcemarkers:error']);
    for (const [i, delay] of MARKERS_RETRY_DELAYS.entries()) {
      calls[i]!.reject(boom);
      await ticks();
      expect(errors()[i]!.retryIn).toBe(delay);
      // Waiting: a pan asks nothing.
      loader.setView(-6000, -5000);
      await ticks();
      expect(calls).toHaveLength(i + 1);
      vi.advanceTimersByTime(delay);
      await ticks();
      expect(calls).toHaveLength(i + 2);
    }
    calls.at(-1)!.reject(boom);
    await ticks();
    const last = errors().at(-1)!;
    expect(last.retryIn).toBeNull();
    expect(last.error).toBeInstanceOf(ChartError);
    expect(last.error.code).toBe('markers-failed');
    expect(last.error.cause).toBe(boom);
    expect(last).toMatchObject({ symbol: 'ABC', interval: '1m' });
    const count = calls.length;
    vi.advanceTimersByTime(60_000);
    loader.setView(600, 1140);
    await ticks();
    expect(calls).toHaveLength(count);
    loader.refresh();
    await ticks();
    expect(calls).toHaveLength(count + 1);
  });
});

describe('marks on the chart', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  const MIN = 60;
  const bars: Bar[] = Array.from({ length: 200 }, (_, i) => ({ time: i * MIN, open: 100, high: 110, low: 90, close: 100, volume: 1 }));
  const symbols = [
    { symbol: 'ABC', name: 'ABC' },
    { symbol: 'XYZ', name: 'XYZ' },
  ];

  function source(marks: SourceMarker[]) {
    const base = createStaticDataSource({ symbols, bars: () => bars });
    const fetchMarkers = vi.fn(async (_s: SymbolInfo, _i: string, { from, to }: RangeRequest) => marks.filter((m) => m.time >= from && m.time < to));
    return { source: { ...base, markers: fetchMarkers }, fetchMarkers };
  }

  async function chart(src: DataSource) {
    const c = new Chart(fakeContainer(), { timezone: 'UTC' });
    charts.push(c);
    c.setDataSource(src, { initialBars: 200 });
    await c.setSymbol('ABC', '1m');
    await flush();
    render(c);
    return c;
  }

  function render(c: Chart): void {
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
  }

  /** A plot-space point on the mark drawn on bar `index`, found by scanning up from the pane's bottom edge. */
  function onMark(c: Chart, index: number): Point {
    const pane = c.panes[0]!;
    const x = c.time.indexToX(index);
    for (let y = pane.top + pane.height; y > pane.top; y--) {
      if (c.annotations.cursor({ x, y }) === 'pointer') return { x, y };
    }
    throw new Error('no mark found');
  }

  /** A source whose `markers` answers only when the test says so. */
  function manual() {
    const base = createStaticDataSource({ symbols, bars: () => bars });
    const pending: { symbol: string; signal: AbortSignal; resolve: (m: SourceMarker[]) => void }[] = [];
    const fetchMarkers = vi.fn(
      (s: SymbolInfo, _i: string, { signal }: RangeRequest) => new Promise<SourceMarker[]>((resolve) => pending.push({ symbol: s.symbol, signal, resolve })),
    );
    return { source: { ...base, markers: fetchMarkers }, pending, fetchMarkers };
  }

  it('fetches the marks around the visible range and draws them apart from the app markers', async () => {
    const visible = { id: 'e', time: 190 * MIN, text: 'E', tooltip: 'Earnings' };
    const { source: src, fetchMarkers } = source([visible, { id: 'old', time: 0 }]);
    const c = await chart(src);
    const range = c.getVisibleRange()!;
    expect(fetchMarkers).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ABC' }), '1m', {
      from: expect.any(Number),
      to: expect.any(Number),
      signal: expect.any(AbortSignal),
    });
    const [, , { from, to }] = fetchMarkers.mock.calls[0]!;
    expect(from).toBeLessThan(range.from);
    expect(to).toBeGreaterThan(range.to);
    expect(c.sourceMarkers).toContainEqual(visible);
    expect(Object.isFrozen(c.sourceMarkers)).toBe(true);
    // The app's markers are a separate set: replacing or clearing them keeps the marks.
    c.annotations.setMarkers([{ id: 'own', time: 100 * MIN, shape: 'square' }]);
    c.annotations.clear();
    expect(c.annotations.getMarkers()).toEqual([]);
    expect('setSourceMarks' in c.annotations).toBe(false);
    const clicks = vi.fn();
    const markClicks: { markers: SourceMarker[]; point: Point }[] = [];
    c.on('marker:click', clicks);
    c.on('sourcemarkers:click', (e) => markClicks.push(e));
    const p = onMark(c, 190);
    expect(c.annotations.pointerDown(p)).toBe(true);
    c.annotations.pointerUp(p);
    expect(clicks).not.toHaveBeenCalled();
    expect(markClicks).toHaveLength(1);
    expect(markClicks[0]!.markers).toEqual([visible]);
    expect(markClicks[0]!.point).toEqual({ x: p.x + c.plotLeft, y: p.y });
    // A copy: changing it leaves the chart's mark alone.
    markClicks[0]!.markers[0]!.text = 'X';
    expect(c.sourceMarkers.find((m) => m.id === 'e')!.text).toBe('E');
  });

  it('applies the marker filter to marks too', async () => {
    const c = await chart(source([{ id: 'e', time: 190 * MIN, kind: 'earnings' }]).source);
    c.on('sourcemarkers:click', () => {});
    expect(() => onMark(c, 190)).not.toThrow();
    c.annotations.setMarkerFilter({ kinds: ['news'] });
    expect(() => onMark(c, 190)).toThrow(/no mark/);
  });

  it('hides the bar markers with the marks option, and fetches nothing while timeMarks is off too', async () => {
    const { source: src, fetchMarkers } = source([{ id: 'e', time: 190 * MIN }]);
    const c = await chart(src);
    c.on('sourcemarkers:click', () => {});
    const changes: (readonly SourceMarker[])[] = [];
    c.on('sourcemarkers:change', ({ markers }) => changes.push(markers));
    c.applyOptions({ marks: false });
    expect(() => onMark(c, 190)).toThrow(/no mark/);
    // Still fetched for the time axis: the getter keeps them.
    expect(c.sourceMarkers).toHaveLength(1);
    fetchMarkers.mockClear();
    c.applyOptions({ timeMarks: false });
    expect(c.sourceMarkers).toEqual([]);
    expect(changes).toEqual([[]]);
    // Neither a pan nor a new interval asks while both are off.
    c.scrollToTime(20 * MIN, false);
    render(c);
    await c.setSymbol('ABC', '5m');
    await flush();
    expect(fetchMarkers).not.toHaveBeenCalled();
    c.applyOptions({ marks: true });
    await flush();
    expect(fetchMarkers).toHaveBeenCalled();
  });

  it('shows no marker events for marks and takes no press without sourcemarkers:click listeners', async () => {
    const c = await chart(source([{ id: 'e', time: 190 * MIN }]).source);
    const hovers = vi.fn();
    c.on('marker:hover', hovers);
    c.on('marker:click', () => {});
    const off = c.on('sourcemarkers:click', () => {});
    const p = onMark(c, 190);
    off();
    // A marker:click listener does not make marks clickable.
    expect(c.annotations.cursor(p)).toBeNull();
    c.annotations.pointerMove(p);
    expect(hovers).not.toHaveBeenCalled();
    expect(c.annotations.pointerDown(p)).toBe(false);
  });

  it('redraws the whole scene only when the band of time-axis markers appears', async () => {
    const { source: src, pending } = manual();
    const c = await chart(src);
    const scene = vi.spyOn(c, 'invalidate');
    const overlay = vi.spyOn(c, 'redrawOverlay');
    pending.at(-1)!.resolve([{ id: 'e', time: 190 * MIN }]);
    await flush();
    // Markers on bars redraw the overlay only.
    expect(overlay).toHaveBeenCalled();
    expect(scene).not.toHaveBeenCalled();
    const next = async (markers: SourceMarker[]) => {
      const count = pending.length;
      // Turning both options off and on again fetches the view afresh.
      c.applyOptions({ marks: false, timeMarks: false });
      c.applyOptions({ marks: true, timeMarks: true });
      await flush();
      expect(pending).toHaveLength(count + 1);
      scene.mockClear();
      overlay.mockClear();
      pending.at(-1)!.resolve(markers);
      await flush();
    };
    // The first time-axis marker adds the band under the axis: the layout changes.
    await next([{ id: 't', time: 180 * MIN, position: 'timeAxis' }]);
    expect(scene).toHaveBeenCalledTimes(1);
    // The band stays, so later ones redraw the overlay only.
    await next([{ id: 'u', time: 190 * MIN, position: 'timeAxis' }]);
    expect(overlay).toHaveBeenCalled();
    expect(scene).not.toHaveBeenCalled();
  });

  it('refetches on an interval change and through the reset path, each with sourcemarkers:change', async () => {
    const markers: SourceMarker[] = [{ id: 'e', time: 190 * MIN }];
    const { source: src, fetchMarkers } = source(markers);
    let reset: ((reset: BarsReset) => void) | null = null;
    const c = await chart({
      ...src,
      onReset: (listener) => {
        reset = listener;
        return () => (reset = null);
      },
    });
    const changes: (readonly SourceMarker[])[] = [];
    c.on('sourcemarkers:change', ({ markers }) => changes.push(markers));
    expect(c.sourceMarkers.map((m) => m.id)).toEqual(['e']);
    // The source corrected its events: a reset of the shown bars refetches their markers, which replace the known ones.
    markers.splice(0, 1, { id: 'f', time: 191 * MIN });
    fetchMarkers.mockClear();
    reset!({ symbol: 'ABC', interval: '1m' });
    await flush();
    await flush();
    expect(fetchMarkers).toHaveBeenCalledTimes(1);
    expect(c.sourceMarkers.map((m) => m.id)).toEqual(['f']);
    expect(changes.at(-1)!.map((m) => m.id)).toEqual(['f']);
    // A reset of another symbol is not for this chart.
    fetchMarkers.mockClear();
    reset!({ symbol: 'XYZ' });
    await flush();
    expect(fetchMarkers).not.toHaveBeenCalled();
    await c.setSymbol('ABC', '5m');
    await flush();
    expect(fetchMarkers).toHaveBeenCalled();
    expect(fetchMarkers.mock.calls.every((call) => call[1] === '5m')).toBe(true);
  });

  it('drops the old marks when a switch starts and asks nothing for the old symbol if the new load fails', async () => {
    const { source: src, fetchMarkers } = source([{ id: 'e', time: 190 * MIN }]);
    const failing: DataSource = {
      ...src,
      history: (symbol, interval, request) => (symbol.symbol === 'XYZ' ? Promise.reject(new Error('no bars')) : src.history(symbol, interval, request)),
    };
    const c = await chart(failing);
    expect(c.sourceMarkers).toHaveLength(1);
    c.on('data:error', () => {});
    const load = c.setSymbol('XYZ', '1m');
    expect(c.sourceMarkers).toEqual([]);
    await load.catch(() => {});
    await flush();
    fetchMarkers.mockClear();
    // The old bars are still on screen; panning them asks nothing of the source.
    c.scrollToTime(20 * MIN, false);
    render(c);
    await flush();
    expect(fetchMarkers).not.toHaveBeenCalled();
    expect(c.sourceMarkers).toEqual([]);
  });

  it('ignores an answer for the old symbol after a switch, and one that lands after destroy', async () => {
    const { source: src, pending } = manual();
    const c = await chart(src);
    expect(pending.map((p) => p.symbol)).toEqual(['ABC']);
    await c.setSymbol('XYZ', '1m');
    await flush();
    expect(pending[0]!.signal.aborted).toBe(true);
    pending[0]!.resolve([{ id: 'stale', time: 190 * MIN }]);
    await flush();
    expect(c.sourceMarkers).toEqual([]);
    expect(pending.at(-1)!.symbol).toBe('XYZ');
    const changes = vi.fn();
    c.on('sourcemarkers:change', changes);
    c.destroy();
    expect(pending.at(-1)!.signal.aborted).toBe(true);
    pending.at(-1)!.resolve([{ id: 'late', time: 190 * MIN }]);
    await flush();
    expect(changes).not.toHaveBeenCalled();
  });

  it('reports marks:error and leaves the bars loaded', async () => {
    const { source: src } = source([]);
    const boom = new Error('marks down');
    const failing = { ...src, markers: vi.fn(async () => Promise.reject(boom)) };
    const c = new Chart(fakeContainer(), { timezone: 'UTC' });
    charts.push(c);
    const errors: DataEvents['sourcemarkers:error'][] = [];
    c.on('sourcemarkers:error', (e) => errors.push(e));
    c.setDataSource(failing, { initialBars: 200 });
    await c.setSymbol('ABC', '1m');
    await flush();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error.code).toBe('markers-failed');
    expect(errors[0]!.retryIn).toBe(MARKERS_RETRY_DELAYS[0]);
    expect(c.main!.data).toHaveLength(200);
  });

  it('asks nothing of a source without markers', async () => {
    const base = createStaticDataSource({ symbols, bars: () => bars });
    const c = new Chart(fakeContainer(), { timezone: 'UTC' });
    charts.push(c);
    c.setDataSource(base);
    await c.setSymbol('ABC', '1m');
    expect(c.sourceMarkers).toEqual([]);
    c.applyOptions({ marks: false, timeMarks: false });
    c.applyOptions({ marks: true });
  });

  it('asks nothing without the sourceMarkers() plugin, warns once, and fetches once it is installed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { source: src, fetchMarkers } = source([{ id: 'e', time: 190 * MIN }]);
    const c = new Chart(fakeContainer(), { timezone: 'UTC', plugins: [dataSource(), annotations()] });
    charts.push(c);
    c.setDataSource(src, { initialBars: 200 });
    c.setDataSource(src, { initialBars: 200 });
    await c.setSymbol('ABC', '1m');
    await flush();
    render(c);
    await flush();
    expect(fetchMarkers).not.toHaveBeenCalled();
    expect(c.sourceMarkers).toEqual([]);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('[source-markers-missing]'))).toHaveLength(1);
    const uninstall = c.install(sourceMarkers());
    await flush();
    expect(fetchMarkers).toHaveBeenCalled();
    expect(c.sourceMarkers).toHaveLength(1);
    const changes = vi.fn();
    c.on('sourcemarkers:change', changes);
    uninstall();
    expect(c.sourceMarkers).toEqual([]);
    expect(changes).toHaveBeenCalledWith({ markers: [] });
    warn.mockRestore();
  });

  it("routes each kind of marker to its own events, and the app's clear() leaves the chart's own sets", async () => {
    const mark = { id: 'e', time: 190 * MIN, text: 'E' };
    const split = { time: 150 * MIN, kind: 'split' as const, factor: 0.5 };
    const src: DataSource = { ...source([mark]).source, adjustments: async () => [split] };
    const c = await chart(src);
    // A shape plot: an arrow under bar 170.
    const shape: IndicatorDef = {
      id: 'test/shape',
      name: 'Shape',
      placement: 'overlay',
      inputs: [],
      plots: [{ id: 'sig', type: 'shape', shape: 'arrow-up' }],
      compute: (s) => ({ sig: Float64Array.from({ length: s.length }, (_, i) => (i === 170 ? s.close[i]! : NaN)) }),
    };
    const indicator = c.indicators.add(shape);
    c.annotations.setMarkers([{ id: 'own', time: 180 * MIN, shape: 'square', position: 'below' }]);
    render(c);
    const markerClicks: MarkerPointerEvent[] = [];
    const markClicks: { markers: SourceMarker[] }[] = [];
    const hovers: MarkerPointerEvent[] = [];
    c.on('marker:click', (e) => markerClicks.push(e));
    c.on('sourcemarkers:click', (e) => markClicks.push(e));
    c.on('marker:hover', (e) => hovers.push(e));

    /** Press and release on the first clickable spot above bar `index`, scanning up from the pane's bottom edge. */
    const press = (index: number) => {
      const pane = c.panes[0]!;
      const x = c.time.indexToX(index);
      for (let y = pane.top + pane.height; y > pane.top; y--) {
        if (c.annotations.cursor({ x, y }) !== 'pointer') continue;
        c.annotations.pointerMove({ x, y });
        expect(c.annotations.pointerDown({ x, y })).toBe(true);
        c.annotations.pointerUp({ x, y });
        c.annotations.pointerMove({ x: c.time.width + 50, y: 0 });
        return true;
      }
      return false;
    };

    expect(press(180)).toBe(true);
    expect(markerClicks.at(-1)).toMatchObject({ marker: { id: 'own' }, series: c.main });
    expect(press(170)).toBe(true);
    expect(markerClicks.at(-1)).toMatchObject({ marker: { shape: 'arrow-up' }, series: indicator.series });
    expect(press(150)).toBe(true);
    expect(markerClicks.at(-1)).toMatchObject({ marker: { kind: 'split' }, series: c.main });
    expect(markerClicks).toHaveLength(3);
    expect(markClicks).toEqual([]);
    expect(press(190)).toBe(true);
    expect(markClicks).toHaveLength(1);
    expect(markClicks[0]!.markers).toEqual([mark]);
    // Hovering the source mark fired no marker:hover; the other three did.
    expect(hovers.map((e) => e.marker.kind ?? e.marker.id ?? e.marker.shape)).toEqual(['own', 'arrow-up', 'split']);
    expect(markerClicks).toHaveLength(3);

    // The app's clear() removes only the app's markers.
    c.annotations.clear();
    render(c);
    expect(press(180)).toBe(false);
    expect(press(170)).toBe(true);
    expect(press(150)).toBe(true);
    expect(press(190)).toBe(true);
    expect(markerClicks).toHaveLength(5);
    expect(markClicks).toHaveLength(2);
  });
});
