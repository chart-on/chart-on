import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { CLIPBOARD_KIND, encodeClipboard, parseClipboard, placeDrawings, resolvePaste, type ClipboardSource } from '../src/drawing/clipboard';
import { createImageTool } from '../src/drawing/image-tool';
import type { Drawing } from '../src/drawing/types';

const source: ClipboardSource = { symbol: 'AAA', interval: '1m', visibleRange: { from: 0, to: 600 } };
const line: Drawing = { id: 'a', type: 'trendline', pane: 0, points: [{ time: 60, price: 5 }, { time: 600, price: 15 }], style: { color: '#123456' } };

describe('clipboard payload', () => {
  it('round-trips drawings and their source', () => {
    const text = encodeClipboard([line], source);
    expect(JSON.parse(text)).toMatchObject({ kind: CLIPBOARD_KIND, version: 1, items: [line], source });
    expect(parseClipboard(text)).toEqual({ kind: CLIPBOARD_KIND, version: 1, items: [line], source });
  });

  it('leaves out malformed drawings and ill-typed source fields', () => {
    const text = JSON.stringify({ kind: CLIPBOARD_KIND, version: 1, items: [line, { id: 'b', type: 'trendline' }, 'x'], source: { symbol: 3, visibleRange: { from: 'a' } } });
    expect(parseClipboard(text)).toEqual({
      kind: CLIPBOARD_KIND,
      version: 1,
      items: [line],
      source: { symbol: null, interval: null, visibleRange: null },
    });
  });

  it('reads the price ranges of the source panes, if any', () => {
    const priceRanges = [{ min: 1, max: 9, log: true }, 'x', { min: 1 }, { min: 0, max: 4 }];
    const text = JSON.stringify({ kind: CLIPBOARD_KIND, version: 1, items: [], source: { ...source, priceRanges } });
    expect(parseClipboard(text)?.source.priceRanges).toEqual([{ min: 1, max: 9, log: true }, null, null, { min: 0, max: 4, log: false }]);
  });

  it('reads nothing from other text', () => {
    for (const text of ['', 'hello', '{', '{"kind":"other","version":1,"items":[]}', '[1]', JSON.stringify({ kind: CLIPBOARD_KIND, version: 2, items: [] })]) {
      expect(parseClipboard(text)).toBeNull();
    }
  });
});

describe('paste resolution', () => {
  const payload = encodeClipboard([line], source);

  it('prefers the in-memory copies while the clipboard holds what this chart wrote or no text', () => {
    expect(resolvePaste(null, null)).toEqual({ kind: 'memory' });
    expect(resolvePaste('', payload)).toEqual({ kind: 'memory' });
    expect(resolvePaste(payload, payload)).toEqual({ kind: 'memory' });
  });

  it('then a payload another chart wrote', () => {
    expect(resolvePaste(payload, null)).toMatchObject({ kind: 'payload', payload: { items: [line], source } });
    expect(resolvePaste(payload, encodeClipboard([], source))).toMatchObject({ kind: 'payload' });
  });

  it('then plain text as a one-line note', () => {
    expect(resolvePaste('  Support\n\tholds  ', null)).toEqual({ kind: 'text', text: 'Support holds' });
    expect(resolvePaste('{"kind":"other"}', null)).toEqual({ kind: 'text', text: '{"kind":"other"}' });
    expect(resolvePaste('x'.repeat(2000), null)).toEqual({ kind: 'text', text: 'x'.repeat(1000) });
  });

  it('takes an image after a payload and before text', () => {
    const image = new Blob(['png']);
    expect(resolvePaste(null, null, image)).toEqual({ kind: 'image', file: image });
    expect(resolvePaste('', null, image)).toEqual({ kind: 'image', file: image });
    expect(resolvePaste('screenshot.png', null, image)).toEqual({ kind: 'image', file: image });
    expect(resolvePaste(payload, null, image)).toMatchObject({ kind: 'payload' });
    expect(resolvePaste(payload, payload, image)).toEqual({ kind: 'memory' });
  });

  it('adds nothing for blank text or a payload version it cannot read', () => {
    expect(resolvePaste(' \n ', null)).toBeNull();
    expect(resolvePaste(JSON.stringify({ kind: CLIPBOARD_KIND, version: 2, items: [line] }), null)).toBeNull();
  });
});

describe('paste placement', () => {
  const from: ClipboardSource = { ...source, priceRanges: [{ min: 0, max: 100, log: false }, { min: 0, max: 10, log: false }] };
  const to: ClipboardSource = { ...source, visibleRange: { from: 1000, to: 2200 }, priceRanges: [{ min: 50, max: 250, log: false }, { min: 0, max: 20, log: false }] };
  const place = (scaling: 'scaled' | 'framed', at: { pane: number; time: number; price: number } | null = null, a = from, b = to, list = [line]) => {
    const copies = list.map((d) => ({ ...d, points: d.points.map((p) => ({ ...p })) }));
    placeDrawings(copies, a, b, at, scaling);
    return copies.map((d) => d.points);
  };

  it('framed keeps where the points were in the source window', () => {
    // Times 10% and 100% into the window, prices 5% and 15% up the pane.
    expect(place('framed')).toEqual([
      [
        { time: 1120, price: 60 },
        { time: 2200, price: 80 },
      ],
    ]);
    // The crosshair does not move framed drawings.
    expect(place('framed', { pane: 0, time: 1500, price: 200 })).toEqual(place('framed'));
  });

  it('scaled keeps the framed size and centres it on the crosshair, or the window without one', () => {
    expect(place('scaled', { pane: 0, time: 1500, price: 200 })).toEqual([
      [
        { time: 960, price: 190 },
        { time: 2040, price: 210 },
      ],
    ]);
    expect(place('scaled')).toEqual([
      [
        { time: 1060, price: 140 },
        { time: 2140, price: 160 },
      ],
    ]);
  });

  it('centres only the crosshair pane; other panes keep their framed prices', () => {
    const lower = { ...line, pane: 1, points: [{ time: 60, price: 5 }] };
    const [, points] = place('scaled', { pane: 0, time: 1500, price: 200 }, from, to, [line, lower]);
    expect(points).toEqual([{ time: 960, price: 10 }]);
  });

  it('maps log scales in log coordinates', () => {
    const a = { ...from, priceRanges: [{ min: 1, max: 100, log: true }] };
    const b = { ...to, priceRanges: [{ min: 10, max: 1000, log: true }] };
    const [p0, p1] = place('framed', null, a, b)[0]!;
    expect(p0!.price).toBeCloseTo(10 * 5);
    expect(p1!.price).toBeCloseTo(10 * 15);
  });

  it('offsets an axis to the crosshair where the scale modes differ or a window is missing', () => {
    const b = { ...to, priceRanges: [{ min: 10, max: 1000, log: true }] };
    const [p0, p1] = place('framed', { pane: 0, time: 1500, price: 100 }, from, b)[0]!;
    // Log destination: prices keep their ratio, their geometric middle on the crosshair; time is still framed.
    expect(p1!.price / p0!.price).toBeCloseTo(3);
    expect(Math.sqrt(p0!.price * p1!.price)).toBeCloseTo(100);
    expect([p0!.time, p1!.time]).toEqual([1120, 2200]);
    // An older payload without price ranges, and a source without a visible range.
    const old = { ...source, visibleRange: null };
    expect(place('framed', { pane: 0, time: 1500, price: 100 }, old)).toEqual([
      [
        { time: 1230, price: 95 },
        { time: 1770, price: 105 },
      ],
    ]);
  });
});

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart() {
  const c = new Chart(fakeContainer(), { smoothZoom: false });
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 1000 }, (_, i) => ({ time: i * 60, open: 10, high: 20, low: 0, close: 10 })));
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
  return c;
}

const press = (c: Chart, key: string, extra: Record<string, unknown> = {}) => dispatch(c.root, 'keydown', { key, code: '', ctrlKey: true, ...extra });

/** A clipboard event with `text` on the clipboard; `data` records what listeners write. */
function clipboardEvent(c: Chart, type: 'copy' | 'cut' | 'paste', text = '', files: Blob[] = []) {
  const data = new Map<string, string>([['text/plain', text]]);
  const clipboardData = { getData: (t: string) => data.get(t) ?? '', setData: (t: string, v: string) => data.set(t, v), files };
  const e = dispatch(c.root, type, { clipboardData });
  return { e, text: data.get('text/plain') ?? '' };
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('chart clipboard shortcuts', () => {
  it('copies the selection to the clipboard and pastes it on another chart', () => {
    const a = chart();
    const drawn = a.drawings.add({ type: 'trendline', pane: 0, points: line.points, style: {} });
    a.drawings.setSelection([drawn.id]);
    expect(press(a, 'c').defaultPrevented).toBe(false);
    const copied = clipboardEvent(a, 'copy');
    expect(copied.e.defaultPrevented).toBe(true);
    expect(parseClipboard(copied.text)?.items).toEqual([{ ...drawn, style: drawn.style }]);

    const b = chart();
    expect(press(b, 'v').defaultPrevented).toBe(false);
    expect(clipboardEvent(b, 'paste', copied.text).e.defaultPrevented).toBe(true);
    const [pasted] = b.drawings.getAll();
    expect(pasted).toMatchObject({ type: 'trendline', points: line.points });
    expect(pasted!.id).not.toBe(drawn.id);
    expect(b.drawings.selection).toEqual([pasted!.id]);
    b.drawings.undo();
    expect(b.drawings.getAll()).toEqual([]);
  });

  it('cuts the selection to the clipboard as one undo step', () => {
    const a = chart();
    const drawn = a.drawings.add({ type: 'trendline', pane: 0, points: line.points, style: {} });
    a.drawings.setSelection([drawn.id]);
    expect(press(a, 'x').defaultPrevented).toBe(false);
    expect(a.drawings.getAll()).toEqual([]);
    const cut = clipboardEvent(a, 'cut');
    expect(cut.e.defaultPrevented).toBe(true);
    expect(parseClipboard(cut.text)?.items).toEqual([drawn]);

    const b = chart();
    press(b, 'v');
    clipboardEvent(b, 'paste', cut.text);
    expect(b.drawings.getAll()).toMatchObject([{ type: 'trendline', points: line.points }]);

    a.drawings.undo();
    expect(a.drawings.getAll()).toEqual([drawn]);
    // The cut drawings stay in memory for this chart's own paste.
    expect(a.drawings.paste()).toHaveLength(1);
  });

  it('leaves the cut key to the page with nothing selected or drawings locked', () => {
    const c = chart();
    const drawn = c.drawings.add({ type: 'trendline', pane: 0, points: line.points, style: {} });
    press(c, 'x');
    expect(clipboardEvent(c, 'cut').e.defaultPrevented).toBe(false);
    c.drawings.setSelection([drawn.id]);
    c.drawings.setLocked(true);
    press(c, 'x');
    expect(clipboardEvent(c, 'cut').e.defaultPrevented).toBe(false);
    expect(c.drawings.getAll()).toEqual([drawn]);
  });

  it('places drawings from another chart in its window as pasteScaling says', () => {
    const c = chart();
    c.drawings.pasteScaling = 'framed';
    const view = c.getVisibleRange()!;
    const [range] = c.drawings.priceRanges();
    const text = encodeClipboard([line], { ...source, priceRanges: [{ min: 0, max: 100, log: false }] });
    press(c, 'v');
    clipboardEvent(c, 'paste', text);
    const [pasted] = c.drawings.getAll();
    const span = view.to - view.from;
    expect(pasted!.points[0]!.time).toBeCloseTo(view.from + span * 0.1);
    expect(pasted!.points[1]!.time).toBeCloseTo(view.to);
    expect(pasted!.points[0]!.price).toBeCloseTo(range!.min + (range!.max - range!.min) * 0.05);
    // The in-memory paste on the same chart stays in place.
    c.drawings.copy([pasted!.id]);
    expect(c.drawings.paste()[0]!.points).toEqual(pasted!.points);
  });

  it('pastes the in-memory copies when the clipboard still holds its own payload', () => {
    const c = chart();
    const drawn = c.drawings.add({ type: 'trendline', pane: 0, points: line.points, style: {} });
    c.drawings.setSelection([drawn.id]);
    press(c, 'c');
    const { text } = clipboardEvent(c, 'copy');
    press(c, 'v');
    clipboardEvent(c, 'paste', text);
    expect(c.drawings.getAll().map((d) => d.points)).toEqual([line.points, line.points]);
  });

  it('pastes plain text as a selected text note at the crosshair', () => {
    const c = chart();
    c.setCrosshair({ x: 200, y: 100, pane: 0 });
    press(c, 'v');
    clipboardEvent(c, 'paste', 'Breakout\nlevel');
    const [note] = c.drawings.getAll();
    expect(note).toMatchObject({ type: 'text', text: 'Breakout level', pane: 0 });
    expect(c.drawings.selection).toEqual([note!.id]);
  });

  it('pastes an image file through the tool that takes it, centred on the crosshair', async () => {
    const c = chart();
    const png = new Blob(['png'], { type: 'image/png' });
    const pasteImage = vi.fn(() => Promise.resolve({ text: 'upload-1', width: 200, height: 100 }));
    c.drawings.register({ ...createImageTool({ load: vi.fn() }), pasteImage });
    c.setCrosshair({ x: 300, y: 150, pane: 0 });
    press(c, 'v');
    clipboardEvent(c, 'paste', '', [new Blob(['notes'], { type: 'text/plain' }), png]);
    expect(pasteImage).toHaveBeenCalledWith(png);
    await nextTask();
    const [image] = c.drawings.getAll();
    expect(image).toMatchObject({ type: 'image', text: 'upload-1', pane: 0 });
    expect(c.drawings.selection).toEqual([image!.id]);
    const xs = image!.points.map((p) => c.timeToX(p.time)!);
    const ys = image!.points.map((p) => c.priceToY(p.price)!);
    // Times land on bars, so x is as close as the bar spacing.
    const bar = c.timeToX(60)! - c.timeToX(0)!;
    expect(Math.abs((xs[0]! + xs[1]!) / 2 - 300)).toBeLessThanOrEqual(bar);
    expect((ys[0]! + ys[1]!) / 2).toBeCloseTo(150, 0);
    // The image's 2:1 shape, within half the pane.
    expect(Math.abs(xs[1]! - xs[0]! - 2 * (ys[1]! - ys[0]!))).toBeLessThanOrEqual(2 * bar);
    expect(ys[1]! - ys[0]!).toBeGreaterThan(0);
    expect(ys[1]! - ys[0]!).toBeLessThanOrEqual(100);
    // A declined file adds nothing, and its text is not pasted as a note.
    pasteImage.mockResolvedValueOnce(null as never);
    press(c, 'v');
    clipboardEvent(c, 'paste', 'shot.png', [png]);
    await nextTask();
    expect(c.drawings.getAll()).toHaveLength(1);
  });

  it('ignores image files without a tool that takes them', () => {
    const c = chart();
    c.drawings.register(createImageTool({ load: vi.fn() }));
    c.setCrosshair({ x: 300, y: 150, pane: 0 });
    press(c, 'v');
    clipboardEvent(c, 'paste', 'caption', [new Blob(['png'], { type: 'image/png' })]);
    expect(c.drawings.getAll()).toMatchObject([{ type: 'text', text: 'caption' }]);
  });

  it('falls back to the in-memory copies when the browser fires no clipboard event', async () => {
    const c = chart();
    const drawn = c.drawings.add({ type: 'trendline', pane: 0, points: line.points, style: {} });
    c.drawings.setSelection([drawn.id]);
    press(c, 'c');
    await nextTask();
    press(c, 'v');
    expect(c.drawings.getAll()).toHaveLength(1);
    await nextTask();
    expect(c.drawings.getAll()).toHaveLength(2);
    // A late event finds nothing armed.
    clipboardEvent(c, 'paste', 'note');
    expect(c.drawings.getAll()).toHaveLength(2);
  });

  it('leaves clipboard events it did not arm, and keys its actions would not run, to the page', () => {
    const c = chart();
    expect(clipboardEvent(c, 'copy').e.defaultPrevented).toBe(false);
    expect(clipboardEvent(c, 'paste', 'note').e.defaultPrevented).toBe(false);
    // Nothing selected: copy is disabled, so the key is not the chart's.
    expect(press(c, 'c').defaultPrevented).toBe(false);
    expect(clipboardEvent(c, 'copy').e.defaultPrevented).toBe(false);
    c.drawings.setLocked(true);
    press(c, 'v');
    expect(clipboardEvent(c, 'paste', 'note').e.defaultPrevented).toBe(false);
    expect(c.drawings.getAll()).toEqual([]);
  });

  it('keeps rebound copy and paste shortcuts in memory', () => {
    const c = chart();
    c.actions.setKeys('copy', ['Mod+Shift+C']);
    const drawn = c.drawings.add({ type: 'trendline', pane: 0, points: line.points, style: {} });
    c.drawings.setSelection([drawn.id]);
    expect(press(c, 'C', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(clipboardEvent(c, 'copy').e.defaultPrevented).toBe(false);
    expect(c.drawings.paste()).toHaveLength(1);
  });
});
