import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { createStaticDataSource } from '../src/data/adapters';
import { readMarker } from '../src/data/marks';
import { timeBadgeText } from '../src/annotations/manager';
import type { BarsReset, DataSource, RangeRequest, SourceMarker, SymbolInfo } from '../src/data/types';
import type { Bar, Point } from '../src/types';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('marker colours and badge text', () => {
  it('leaves out a colour the canvas cannot read', () => {
    expect(readMarker({ id: 'a', time: 60, position: 'timeAxis', color: 'not a colour' })).toEqual({ id: 'a', time: 60, position: 'timeAxis' });
    expect(readMarker({ id: 'a', time: 60, color: 'var(--x)' })).toEqual({ id: 'a', time: 60 });
    expect(readMarker({ id: 'a', time: 60, color: '#ff0000' })!.color).toBe('#ff0000');
  });

  it('shows the count of a folded badge, else two characters, and nothing in a font too small to read', () => {
    const m = (text?: string) => ({ id: 'x', time: 0, text });
    expect(timeBadgeText([m('Note')], 10)).toBe('No');
    expect(timeBadgeText([m()], 10)).toBe('');
    expect(timeBadgeText([m(), m()], 10)).toBe('2');
    expect(timeBadgeText(Array.from({ length: 12 }, () => m()), 10)).toBe('9+');
    expect(timeBadgeText([m('N')], 8)).toBe('');
  });
});

describe('time marks on the chart', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  const MIN = 60;
  const bars: Bar[] = Array.from({ length: 200 }, (_, i) => ({ time: i * MIN, open: 100, high: 110, low: 90, close: 100, volume: 1 }));
  const symbols = [
    { symbol: 'ABC', name: 'ABC' },
    { symbol: 'XYZ', name: 'XYZ' },
  ];

  /** A source of `marks`, on the time axis unless they say otherwise. */
  function source(marks: SourceMarker[]) {
    const base = createStaticDataSource({ symbols, bars: () => bars });
    const fetchMarkers = vi.fn(async (_s: SymbolInfo, _i: string, { from, to }: RangeRequest) =>
      marks.filter((m) => m.time >= from && m.time < to).map((m) => ({ position: 'timeAxis' as const, ...m })),
    );
    let reset: (reset: BarsReset) => void = () => {};
    const onReset = (listener: typeof reset) => {
      reset = listener;
      return () => {};
    };
    return { source: { ...base, markers: fetchMarkers, onReset }, fetchMarkers, reset: (r: BarsReset) => reset(r) };
  }

  function render(c: Chart): void {
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
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

  /** A point on the time axis over the badge of bar `index`, or null; needs a `sourcemarkers:click` listener. */
  function onBadge(c: Chart, index: number): Point | null {
    const pane = c.panes.at(-1)!;
    const top = pane.top + pane.height;
    const x = c.time.indexToX(index);
    for (let y = top; y < top + 60; y++) if (c.annotations.timeMarkMove({ x, y })) return { x, y };
    return null;
  }

  const badges = (c: Chart) => (c.annotations as unknown as { timeBadges: { x: number; marks: SourceMarker[] }[] }).timeBadges;

  it('fetches both placements with one method, draws each in its place and reports clicks to sourcemarkers:click', async () => {
    const mark = { id: 'n', time: 190 * MIN, position: 'timeAxis' as const, text: 'N', tooltip: 'Note\nmore' };
    const onBar = { id: 'e', time: 150 * MIN, position: 'bottom' as const, text: 'E' };
    const { source: src, fetchMarkers } = source([mark, onBar]);
    const c = await chart(src);
    expect(fetchMarkers).toHaveBeenCalledTimes(1);
    expect(fetchMarkers).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ABC' }), '1m', {
      from: expect.any(Number),
      to: expect.any(Number),
      signal: expect.any(AbortSignal),
    });
    expect(c.sourceMarkers).toEqual([onBar, mark]);
    render(c);
    // The bar marker is no badge, and the badge no bar marker.
    expect(badges(c).map((b) => b.marks.map((m) => m.id))).toEqual([['n']]);
    // Without listeners a badge takes no press, so the axis drag keeps working.
    expect(onBadge(c, 190)).toBeNull();
    const clicks: { markers: SourceMarker[]; point: Point }[] = [];
    c.on('sourcemarkers:click', (e) => clicks.push(e));
    const p = onBadge(c, 190)!;
    expect(p).not.toBeNull();
    expect(onBadge(c, 150)).toBeNull();
    // The bar marker draws in the pane's bottom lane, where it takes the pointer.
    const pane = c.panes[0]!;
    const x = c.time.indexToX(150);
    expect(Array.from({ length: pane.height }, (_, i) => c.annotations.cursor({ x, y: pane.top + pane.height - i })).includes('pointer')).toBe(true);
    expect(c.annotations.timeMarkDown(p)).toBe(true);
    c.annotations.pointerUp(p);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.markers).toEqual([mark]);
    expect(clicks[0]!.point).toEqual({ x: p.x + c.plotLeft, y: p.y });
    // A copy: changing it leaves the chart's marker alone.
    clicks[0]!.markers[0]!.tooltip = 'X';
    expect(c.sourceMarkers.find((m) => m.id === 'n')!.tooltip).toBe('Note\nmore');
    // A press that travels is no click.
    expect(c.annotations.timeMarkDown(p)).toBe(true);
    c.annotations.pointerUp({ x: p.x + 40, y: p.y });
    expect(clicks).toHaveLength(1);
  });

  it('shows a badge tooltip one line per `\\n`', async () => {
    const c = await chart(source([{ id: 'n', time: 190 * MIN, tooltip: 'Note\nmore' }]).source);
    c.on('sourcemarkers:click', () => {});
    onBadge(c, 190);
    const texts: string[] = [];
    const ctx = new Proxy({}, { get: (_t, key) => (key === 'fillText' ? (t: string) => texts.push(t) : () => {}), set: () => true }) as CanvasRenderingContext2D;
    c.annotations.renderLabels(ctx);
    expect(texts).toEqual(expect.arrayContaining(['Note', 'more']));
    expect(texts).not.toContain('Note\nmore');
  });

  it('folds marks that would overlap into one badge, clicked as a group', async () => {
    const marks = [
      { id: 'a', time: 190 * MIN },
      { id: 'b', time: 190 * MIN + 30 },
      { id: 'c', time: 191 * MIN },
    ];
    const c = await chart(source(marks).source);
    render(c);
    const clicks: string[][] = [];
    c.on('sourcemarkers:click', (e) => clicks.push(e.markers.map((m) => m.id)));
    const p = onBadge(c, 190)!;
    c.annotations.timeMarkDown(p);
    c.annotations.pointerUp(p);
    // Bars are a few px wide, so the next bar's mark folds in as well.
    expect(clicks).toEqual([['a', 'b', 'c']]);
  });

  it('clears on a symbol change and fetches the new one, each with sourcemarkers:change', async () => {
    const { source: src, fetchMarkers } = source([{ id: 'n', time: 190 * MIN }]);
    const c = await chart(src);
    const changes: number[] = [];
    c.on('sourcemarkers:change', (e) => changes.push(e.markers.length));
    const calls = fetchMarkers.mock.calls.length;
    await c.setSymbol('XYZ', '1m');
    await flush();
    expect(fetchMarkers.mock.calls.length).toBeGreaterThan(calls);
    expect(fetchMarkers.mock.calls.at(-1)![0].symbol).toBe('XYZ');
    expect(changes).toEqual([0, 1]);
  });

  /** Bottom edge of the plot: the top of the time axis. */
  const plotBottom = (c: Chart) => c.panes.at(-1)!.top + c.panes.at(-1)!.height;
  const chartHeight = (c: Chart) => (c as unknown as { height: number }).height;

  it('reserves no band for a source without markers, or one whose markers all sit on bars', async () => {
    const c = await chart(createStaticDataSource({ symbols, bars: () => bars }));
    expect(c.sourceMarkers).toEqual([]);
    expect(chartHeight(c) - plotBottom(c)).toBe(c.options.timeAxis.height);
    const d = await chart(source([{ id: 'e', time: 190 * MIN, position: 'bottom' }]).source);
    expect(d.sourceMarkers).toHaveLength(1);
    expect(chartHeight(d) - plotBottom(d)).toBe(d.options.timeAxis.height);
  });

  it('draws the badges in a band of their own under the time labels, so no label is covered', async () => {
    const c = await chart(source([{ id: 'n', time: 190 * MIN }]).source);
    render(c);
    const label = c.options.timeAxis.height;
    // The axis grows by the band once the source sent a time-axis marker; the plot gives up the room.
    const band = chartHeight(c) - plotBottom(c) - label;
    expect(band).toBeGreaterThanOrEqual(16);
    c.on('sourcemarkers:click', () => {});
    const p = onBadge(c, 190)!;
    // The first point on the badge is below the label row.
    expect(p.y).toBeGreaterThanOrEqual(plotBottom(c) + label);
    expect(p.y).toBeLessThan(chartHeight(c));
    // Over the label row the pointer finds no badge, so it drags the axis as usual.
    const x = c.time.indexToX(190);
    expect(c.annotations.timeMarkMove({ x, y: plotBottom(c) + label / 2 })).toBe(false);
    expect(c.annotations.timeMarkDown({ x, y: plotBottom(c) + label / 2 })).toBe(false);
    // A hidden time axis takes the band with it.
    c.applyOptions({ timeAxis: { visible: false } });
    render(c);
    expect(chartHeight(c) - plotBottom(c)).toBe(0);
    expect(onBadge(c, 190)).toBeNull();
  });

  it('hides the badges and their band with the timeMarks option, still knowing the markers', async () => {
    const c = await chart(source([{ id: 'n', time: 190 * MIN }]).source);
    c.on('sourcemarkers:click', () => {});
    c.applyOptions({ timeMarks: false });
    render(c);
    expect(chartHeight(c) - plotBottom(c)).toBe(c.options.timeAxis.height);
    expect(onBadge(c, 190)).toBeNull();
    expect(c.sourceMarkers).toHaveLength(1);
    c.applyOptions({ timeMarks: true });
    render(c);
    expect(chartHeight(c) - plotBottom(c)).toBeGreaterThan(c.options.timeAxis.height);
    expect(onBadge(c, 190)).not.toBeNull();
  });

  /** Pointer events on the chart root at plot-space `p`. */
  const press = (c: Chart, p: Point, to: Point = p) => {
    dispatch(c.root, 'pointerdown', { clientX: p.x + c.plotLeft, clientY: p.y });
    if (to !== p) dispatch(c.root, 'pointermove', { clientX: to.x + c.plotLeft, clientY: to.y });
    dispatch(c.root, 'pointerup', { clientX: to.x + c.plotLeft, clientY: to.y });
  };
  const hovered = (c: Chart) => (c.annotations as unknown as { timeHover: { marks: SourceMarker[] } | null }).timeHover;

  it('clicks a badge on release without travel, and drags the time axis from it past the slop', async () => {
    const c = await chart(source([{ id: 'n', time: 190 * MIN }]).source);
    const clicks = vi.fn();
    c.on('sourcemarkers:click', clicks);
    const p = onBadge(c, 190)!;
    press(c, p);
    expect(clicks).toHaveBeenCalledTimes(1);
    const spacing = c.time.barSpacing;
    press(c, p, { x: p.x + 60, y: p.y });
    expect(clicks).toHaveBeenCalledTimes(1);
    // The drag zoomed the axis like one started anywhere else on it.
    expect(c.time.barSpacing).not.toBe(spacing);
  });

  it('shows no badge hover or pointer cursor while a drawing tool is active', async () => {
    const c = await chart(source([{ id: 'n', time: 190 * MIN, tooltip: 'Note' }]).source);
    c.on('sourcemarkers:click', () => {});
    const p = onBadge(c, 190)!;
    c.annotations.timeMarkMove(null);
    c.drawings.setTool('hline');
    dispatch(c.root, 'pointermove', { clientX: p.x + c.plotLeft, clientY: p.y });
    expect(hovered(c)).toBeNull();
    expect(c.root.style.cursor).not.toBe('pointer');
    c.drawings.setTool(null);
    dispatch(c.root, 'pointermove', { clientX: p.x + c.plotLeft, clientY: p.y });
    expect(hovered(c)).not.toBeNull();
    expect(c.root.style.cursor).toBe('pointer');
  });

  it('takes the pointer within a 24 px target around each badge', async () => {
    const c = await chart(source([{ id: 'n', time: 190 * MIN }]).source);
    c.on('sourcemarkers:click', () => {});
    const b = badges(c)[0]!;
    const y = chartHeight(c) - 10;
    expect(c.annotations.timeMarkMove({ x: b.x + 11, y })).toBe(true);
    expect(c.annotations.timeMarkMove({ x: b.x - 11, y })).toBe(true);
    expect(c.annotations.timeMarkMove({ x: b.x + 14, y })).toBe(false);
  });

  it('draws a mark after the last bar on the projected axis', async () => {
    const c = await chart(source([{ id: 'f', time: 203 * MIN }]).source);
    // The default right offset shows a few bars of future.
    expect(c.sourceMarkers).toHaveLength(1);
    expect(badges(c).map((b) => b.marks[0]!.id)).toEqual(['f']);
    expect(badges(c)[0]!.x).toBeCloseTo(c.time.indexToX(203));
  });

  it('lays the badges out again when the view pans, so hit-testing follows them, and culls those out of view', async () => {
    const marks = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, time: (5 + i * 5) * MIN }));
    const c = await chart(source(marks).source);
    c.on('sourcemarkers:click', () => {});
    const before = onBadge(c, 190)!;
    // Only badges in view (and a radius past either edge) are laid out.
    for (const b of badges(c)) expect(b.x).toBeGreaterThan(-20);
    for (const b of badges(c)) expect(b.x).toBeLessThan(c.time.width + 20);
    expect(badges(c).length).toBeLessThan(marks.length);
    // Not a multiple of the 5-bar mark spacing, so no other badge lands where this one was.
    c.time.pan(110);
    (c as unknown as { render(t: number): void }).render(16);
    const after = onBadge(c, 190)!;
    expect(after.x).toBeCloseTo(before.x + 110);
    expect(c.annotations.timeMarkMove(before)).toBe(false);
  });

  it('keeps the hover on the badge under the pointer when the badges regroup', async () => {
    const marks = [
      { id: 'a', time: 189 * MIN },
      { id: 'b', time: 190 * MIN },
    ];
    const { source: src, reset } = source(marks);
    const c = await chart(src);
    c.on('sourcemarkers:click', () => {});
    const center = badges(c)[0] as unknown as Point;
    const p = { x: center.x, y: center.y };
    expect(c.annotations.timeMarkMove(p)).toBe(true);
    expect(hovered(c)!.marks.map((m) => m.id)).toEqual(['a', 'b']);
    // The folded badge's first mark goes: the badge left under the pointer is hovered, not dropped.
    marks.shift();
    // Refetched through the reset path, as a source that corrected its events would.
    reset({ symbol: 'ABC' });
    await flush();
    await flush();
    render(c);
    expect(c.sourceMarkers.map((m) => m.id)).toEqual(['b']);
    expect(hovered(c)!.marks.map((m) => m.id)).toEqual(['b']);
    expect(c.annotations.timeMarkMove(p)).toBe(true);
  });

  it('gives the room back when the source changes to one without time marks', async () => {
    const c = await chart(source([{ id: 'n', time: 190 * MIN }]).source);
    expect(chartHeight(c) - plotBottom(c)).toBeGreaterThan(c.options.timeAxis.height);
    c.setDataSource(createStaticDataSource({ symbols, bars: () => bars }), { initialBars: 200 });
    await c.setSymbol('ABC', '1m');
    await flush();
    render(c);
    expect(chartHeight(c) - plotBottom(c)).toBe(c.options.timeAxis.height);
  });
});
