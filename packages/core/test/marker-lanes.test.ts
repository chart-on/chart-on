import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { drawMarker, foldMarkers, layoutMarkers, type MarkerBox, type MarkerLayoutEnv, type MarkerPool } from '../src/annotations/markers';
import type { BarMarker, MarkerPointerEvent } from '../src/annotations/types';
import type { CandleSeries } from '../src/series';
import { Timeline } from '../src/timeline';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.unstubAllGlobals();
});

function timeline(count = 10, interval = 60): Timeline {
  const tl = new Timeline();
  tl.set(Array.from({ length: count }, (_, i) => i * interval));
  return tl;
}

/** Pane from y 100 to 500 showing prices 0..400; every bar spans 90..110; text 7 px per character. */
function env(overrides: Partial<MarkerLayoutEnv> = {}): MarkerLayoutEnv {
  return {
    timeline: timeline(),
    rangeAt: () => [90, 110],
    priceToY: (price) => 500 - price,
    top: 100,
    bottom: 500,
    indexToX: (index) => index * 10,
    barSpacing: 10,
    fontSize: 12,
    measureText: (text) => text.length * 7,
    ...overrides,
  };
}

describe('edge lanes', () => {
  it('stack inwards from the pane edges, text on the inner side', () => {
    const [t1, t2, b1, b2] = layoutMarkers(
      [
        { time: 60, shape: 'circle', position: 'top', text: 'CPI' },
        { time: 60, shape: 'circle', position: 'top' },
        { time: 60, shape: 'flag', position: 'bottom' },
        { time: 60, shape: 'flag', position: 'bottom', text: 'Fed' },
      ],
      env(),
    );
    expect(t1!.top).toBe(104);
    expect(t1!.textY).toBeGreaterThan(t1!.y);
    expect(t2!.top).toBe(t1!.bottom + 3);
    expect(b1!.bottom).toBe(496);
    expect(b2!.bottom).toBe(b1!.top - 3);
    expect(b2!.textY).toBeLessThan(b2!.y);
  });

  it('ignore the price scale and need no bar value', () => {
    const markers: BarMarker[] = [
      { time: 60, shape: 'circle', position: 'top' },
      { time: 60, shape: 'circle', position: 'above' },
    ];
    const a = layoutMarkers(markers, env());
    const panned = layoutMarkers(markers, env({ priceToY: (price) => 300 - price }));
    expect(panned[0]!.y).toBe(a[0]!.y);
    expect(panned[1]!.y).not.toBe(a[1]!.y);
    const empty = layoutMarkers(markers, env({ rangeAt: () => null }));
    expect(empty.map((b) => b.marker.position)).toEqual(['top']);
  });

  it('keep lanes and bar stacks apart', () => {
    const [lane, bar] = layoutMarkers(
      [
        { time: 60, shape: 'circle', position: 'bottom' },
        { time: 60, shape: 'circle', position: 'below' },
      ],
      env(),
    );
    // The bar's low (90) is at y 410; its markers start below it, the lane at the edge.
    expect(bar!.top).toBe(414);
    expect(lane!.bottom).toBe(496);
  });
});

describe('folding and filters', () => {
  const news = (time: number, text: string, extra: Partial<BarMarker> = {}): BarMarker => ({ time, shape: 'circle', position: 'bottom', kind: 'news', text, ...extra });
  const off = { enabled: false, maxPerBar: 1 };

  it('filters by kind and severity, passing markers without them', () => {
    const markers: BarMarker[] = [
      news(0, 'a', { severity: 1 }),
      news(60, 'b', { severity: 3 }),
      { time: 60, shape: 'circle', kind: 'earnings', text: 'c' },
      { time: 120, shape: 'circle', text: 'd' },
    ];
    const texts = (filter: Parameters<typeof foldMarkers>[2]) => foldMarkers(markers, timeline(), filter, off, new Map()).map((m) => m.text);
    expect(texts({})).toEqual(['a', 'b', 'c', 'd']);
    expect(texts({ kinds: ['earnings'] })).toEqual(['c', 'd']);
    expect(texts({ minSeverity: 2 })).toEqual(['b', 'c', 'd']);
    expect(texts({ kinds: [], minSeverity: 3 })).toEqual(['d']);
  });

  it('folds a kind on a bar past maxPerBar into one marker with the count and members', () => {
    const markers: BarMarker[] = [
      news(60, 'a', { id: 'n1', tooltip: ['ignored'] }),
      { time: 60, shape: 'circle', position: 'bottom', kind: 'earnings', text: 'E' },
      news(70, '', { tooltip: ['Headline b', 'body'] }),
      news(80, 'c'),
      news(120, 'd'),
      { time: 60, shape: 'circle', position: 'atPrice', price: 100, kind: 'news' },
    ];
    const members = new Map<BarMarker, BarMarker[]>();
    const shown = foldMarkers(markers, timeline(), {}, { enabled: true, maxPerBar: 2 }, members);
    expect(shown.map((m) => m.text)).toEqual(['3', 'E', 'd', undefined]);
    const folded = shown[0]!;
    expect(folded.id).toBeUndefined();
    expect(folded.tooltip).toEqual(['a', 'Headline b', 'c']);
    expect(members.get(folded)).toEqual([markers[0], markers[2], markers[3]]);
    // At the threshold nothing folds.
    expect(foldMarkers(markers, timeline(), {}, { enabled: true, maxPerBar: 3 }, new Map())).toHaveLength(markers.length);
  });

  it('regroups when the interval changes', () => {
    const markers = [news(0, 'a'), news(60, 'b'), news(120, 'c'), news(300, 'd')];
    const cluster = { enabled: true, maxPerBar: 1 };
    expect(foldMarkers(markers, timeline(10, 60), {}, cluster, new Map()).map((m) => m.text)).toEqual(['a', 'b', 'c', 'd']);
    // Five-minute bars: the first three share bar 0.
    expect(foldMarkers(markers, timeline(10, 300), {}, cluster, new Map()).map((m) => m.text)).toEqual(['3', 'd']);
  });

  it('lists at most eight members in the tooltip', () => {
    const markers = Array.from({ length: 11 }, (_, i) => news(60, `n${i}`));
    const [folded] = foldMarkers(markers, timeline(), {}, { enabled: true, maxPerBar: 1 }, new Map());
    expect(folded!.text).toBe('11');
    expect(folded!.tooltip).toHaveLength(9);
    expect((folded!.tooltip as string[])[8]).toBe('+3 more');
  });
});

describe('marker icons', () => {
  function recorder() {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, key) => (...args: unknown[]) => calls.push(`${String(key)}${key === 'drawImage' ? ':' + args.slice(1).join(',') : ''}`),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  }
  const box = (marker: BarMarker): MarkerBox => layoutMarkers([marker], env())[0]!;

  it('fills an svg path scaled to the marker size, and keeps the text', () => {
    const made: string[] = [];
    vi.stubGlobal(
      'Path2D',
      class {
        constructor(d: string) {
          made.push(d);
        }
      },
    );
    const { ctx, calls } = recorder();
    const marker: BarMarker = { time: 60, shape: 'label', text: 'Fed', position: 'top', icon: { svgPath: 'M0 0L24 24', viewBox: 24 } };
    const b = box(marker);
    // An icon replaces the label box: square, text beside it.
    expect(b.width).toBe(b.size);
    expect(b.textY).not.toBeNull();
    drawMarker(ctx, b, '#123456');
    drawMarker(ctx, b, '#123456');
    expect(made).toEqual(['M0 0L24 24']);
    expect(calls).toContain('scale');
    expect(calls).toContain('fill');
    expect(calls).toContain('fillText');
  });

  it('draws an image, decoding a Blob once and redrawing when ready', async () => {
    const bitmap = { width: 1 } as unknown as ImageBitmap;
    const decode = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', decode);
    const blob = new Blob(['x']);
    const b = box({ time: 60, shape: 'circle', position: 'top', icon: { image: blob } });
    const ready = vi.fn();
    const { ctx, calls } = recorder();
    drawMarker(ctx, b, '#000', ready);
    drawMarker(ctx, b, '#000', ready);
    expect(calls.some((c) => c.startsWith('drawImage'))).toBe(false);
    // Decoding reads the file's header first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(decode).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
    drawMarker(ctx, b, '#000', ready);
    expect(calls.filter((c) => c.startsWith('drawImage'))).toEqual([`drawImage:${b.x - b.size / 2},${b.y - b.size / 2},${b.size},${b.size}`]);
  });

  it('draws without a Blob icon whose header is over 32 megapixels, never decoding it', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    const head = new Uint8Array(24);
    head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(head.buffer).setUint32(16, 40000);
    new DataView(head.buffer).setUint32(20, 40000);
    const b = box({ time: 60, shape: 'circle', position: 'top', icon: { image: new Blob([head]) } });
    const ready = vi.fn();
    const { ctx, calls } = recorder();
    drawMarker(ctx, b, '#000', ready);
    await new Promise((resolve) => setTimeout(resolve, 0));
    drawMarker(ctx, b, '#000', ready);
    expect(decode).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    expect(calls.some((c) => c.startsWith('drawImage'))).toBe(false);
  });

  it('redraws every chart that drew a Blob icon while it decoded', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1 }) as unknown as ImageBitmap));
    const b = box({ time: 60, shape: 'circle', position: 'top', icon: { image: new Blob(['y']) } });
    const first = vi.fn();
    const second = vi.fn();
    const { ctx } = recorder();
    drawMarker(ctx, b, '#000', first);
    drawMarker(ctx, b, '#000', second);
    // Decoding reads the file's header first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

/** One-minute bars, enough for the markers to sit in view. */
const minuteBars: Bar[] = Array.from({ length: 250 }, (_, i) => ({ time: i * 60, open: 100, high: 110, low: 90, close: 100 }));
const fiveMinuteBars: Bar[] = Array.from({ length: 50 }, (_, i) => ({ time: i * 300, open: 100, high: 110, low: 90, close: 100 }));

function chart(bars: Bar[]) {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(bars);
  render(c);
  return c;
}

function render(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
}

const boxes = (c: Chart): MarkerBox[] => {
  const pool = (c.annotations as unknown as { markerPool: MarkerPool }).markerPool;
  return pool.boxes.slice(0, pool.used);
};

describe('lanes, folding and filters on the chart', () => {
  const events: BarMarker[] = [
    { id: 'a', time: 12000, shape: 'circle', position: 'bottom', kind: 'news', text: 'A', severity: 1 },
    { id: 'b', time: 12060, shape: 'circle', position: 'bottom', kind: 'news', text: 'B', severity: 3 },
    { id: 'c', time: 12120, shape: 'circle', position: 'bottom', kind: 'news', text: 'C' },
  ];

  it('validates severity and icons', () => {
    const c = chart(fiveMinuteBars);
    expect(() => c.annotations.setMarkers([{ time: 0, shape: 'circle', severity: 4 as 1 }])).toThrow(/severity/);
    expect(() => c.annotations.setMarkers([{ time: 0, shape: 'circle', icon: {} as { svgPath: string } }])).toThrow(/icon/);
  });

  it('pins a lane to the pane edge', () => {
    const c = chart(fiveMinuteBars);
    c.annotations.setMarkers([{ time: 12000, shape: 'circle', position: 'bottom' }]);
    render(c);
    const pane = c.panes[0]!;
    expect(boxes(c).map((b) => b.bottom)).toEqual([pane.top + pane.height - 4]);
  });

  it('folds on a coarser interval and reports the members on click', () => {
    const c = chart(minuteBars);
    c.annotations.applyOptions({ markerCluster: { enabled: true } });
    c.annotations.setMarkers(events);
    render(c);
    expect(boxes(c).map((b) => b.marker.text)).toEqual(['A', 'B', 'C']);
    (c.panes[0]!.series[0] as CandleSeries).setData(fiveMinuteBars);
    render(c);
    const [folded] = boxes(c);
    expect(boxes(c)).toHaveLength(1);
    expect(folded!.marker.text).toBe('3');
    const clicks: MarkerPointerEvent[] = [];
    c.on('marker:click', (e) => clicks.push(e));
    const p = { x: folded!.x, y: folded!.y };
    expect(c.annotations.pointerDown(p)).toBe(true);
    c.annotations.pointerUp(p);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.members!.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    // Copies: the set is untouched.
    clicks[0]!.members![0]!.text = 'changed';
    expect(c.annotations.getMarkers()[0]!.text).toBe('A');
    // Raising the threshold unfolds.
    c.annotations.applyOptions({ markerCluster: { maxPerBar: 3 } });
    render(c);
    expect(boxes(c)).toHaveLength(3);
  });

  it('filters without resending, and ends a hover on a hidden marker', () => {
    const c = chart(fiveMinuteBars);
    c.annotations.setMarkers(events);
    render(c);
    const target = boxes(c)[0]!;
    const ends = vi.fn();
    c.on('marker:hover', () => {});
    c.on('marker:hover-end', ends);
    c.annotations.pointerMove({ x: target.x, y: target.y });
    expect(c.annotations.isHovering).toBe(true);
    c.annotations.setMarkerFilter({ minSeverity: 2 });
    expect(ends).toHaveBeenCalledTimes(1);
    render(c);
    expect(boxes(c).map((b) => b.marker.id)).toEqual(['b', 'c']);
    expect(c.annotations.getMarkers()).toHaveLength(3);
    expect(c.annotations.markerFilter).toEqual({ minSeverity: 2, kinds: undefined });
    c.annotations.setMarkerFilter(null);
    render(c);
    expect(boxes(c)).toHaveLength(3);
  });
});
