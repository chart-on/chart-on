import { afterEach, describe, expect, it } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import { drawingTools, indicators } from '../src/builtins';
import { INDICATOR_CLIPBOARD_KIND, resolvePaste } from '../src/drawing/clipboard';
import type { IndicatorDef } from '../src/indicators/types';
import type { IndicatorsFeature } from '../src/registry';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 12, low: 8, close: 10 + (i % 5) }));

const line = (value: number) => (src: { close: ArrayLike<number> }) => ({ v: new Float64Array(src.close.length).fill(value) });

/** A pane indicator with one input. */
const osc: IndicatorDef = {
  id: 'test/osc',
  name: 'Osc',
  placement: 'pane',
  inputs: [{ id: 'length', type: 'number', default: 14, min: 1 }],
  plots: [{ id: 'v', type: 'line' }],
  compute: line(5),
};

/** An indicator drawn on the price pane. */
const avg: IndicatorDef = { ...osc, id: 'test/avg', name: 'Avg', placement: 'overlay', compute: line(10) };

// The indicators plugin's side of each chart, through the chart's internal hook, for the indicator copied in memory.
const features = new WeakMap<Chart, IndicatorsFeature>();
const provide = Chart.prototype.provideFeature;
Chart.prototype.provideFeature = function (this: Chart, key, feature) {
  if (key === 'indicators') features.set(this, feature as IndicatorsFeature);
  return provide.call(this, key, feature);
};
const copied = (c: Chart) => features.get(c)?.copied ?? null;

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), { plugins: [indicators(), drawingTools()], ...options });
  charts.push(c);
  c.addCandles().setData(bars);
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
  return c;
}

const press = (c: Chart, key: string) => dispatch(c.root, 'keydown', { key, code: '', ctrlKey: true });

/** A clipboard event with `text` on the clipboard; returns what listeners wrote. */
function clipboardEvent(c: Chart, type: 'copy' | 'cut' | 'paste', text = '') {
  const data = new Map<string, string>([['text/plain', text]]);
  const clipboardData = { getData: (t: string) => data.get(t) ?? '', setData: (t: string, v: string) => data.set(t, v) };
  const e = dispatch(c.root, type, { clipboardData });
  return { e, text: data.get('text/plain') ?? '' };
}

/** Copy the selection with Mod+C and return the clipboard text the copy event got. */
function copy(c: Chart, key = 'c'): string {
  press(c, key);
  return clipboardEvent(c, key === 'x' ? 'cut' : 'copy').text;
}

function paste(c: Chart, text: string) {
  press(c, 'v');
  return clipboardEvent(c, 'paste', text).e;
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('indicator copy and paste', () => {
  it('duplicates the selected indicator with its settings in a new pane', () => {
    const c = chart();
    const ind = c.indicators.add(osc, { length: 30 });
    ind.setPlotStyle('v', { lineWidth: 3 });
    c.setSelection({ kind: 'indicator', indicator: ind });
    const text = copy(c);
    expect(JSON.parse(text)).toMatchObject({ kind: INDICATOR_CLIPBOARD_KIND, set: { version: 1, indicators: [{ type: 'test/osc', pane: 1 }] } });

    expect(paste(c, text).defaultPrevented).toBe(true);
    const [, copyOf] = c.indicators.getAll();
    expect(copyOf).toBeDefined();
    expect(copyOf!.inputs).toEqual({ length: 30 });
    expect(copyOf!.serialize().plotStyles).toEqual({ v: { lineWidth: 3 } });
    expect(c.panes).toHaveLength(3);
    expect(copyOf!.pane).toBe(c.panes[2]);
    expect(c.getSelection()).toEqual({ kind: 'indicator', indicator: copyOf });
  });

  it('pastes on another chart through the clipboard, keeping an overlay on the price pane', () => {
    const a = chart();
    const ind = a.indicators.add(avg, { length: 7 });
    a.setSelection({ kind: 'indicator', indicator: ind });
    const text = copy(a);

    const b = chart();
    b.indicators.register(avg);
    expect(paste(b, text).defaultPrevented).toBe(true);
    const [pasted] = b.indicators.getAll();
    expect(pasted).toMatchObject({ type: 'test/avg', inputs: { length: 7 } });
    expect(pasted!.pane).toBe(b.panes[0]);
    expect(b.panes).toHaveLength(1);
  });

  it('reports an indicator the other chart does not know instead of throwing', () => {
    const a = chart();
    a.setSelection({ kind: 'indicator', indicator: a.indicators.add(osc) });
    const text = copy(a);

    const b = chart();
    const notes: { message: string; kind: string }[] = [];
    b.on('ui:notify', (e) => notes.push(e));
    expect(() => paste(b, text)).not.toThrow();
    expect(b.indicators.getAll()).toEqual([]);
    expect(notes).toMatchObject([{ message: 'Indicator test/osc cannot be pasted on this chart', kind: 'error' }]);
    // A set this build cannot read is reported the same way.
    expect(() => paste(b, JSON.stringify({ kind: INDICATOR_CLIPBOARD_KIND, set: { version: 9, indicators: [] } }))).not.toThrow();
    expect(notes).toHaveLength(2);
  });

  it('cuts the selected indicator and pastes it back', () => {
    const c = chart();
    const ind = c.indicators.add(osc, { length: 21 });
    c.setSelection({ kind: 'indicator', indicator: ind });
    const text = copy(c, 'x');
    expect(c.indicators.getAll()).toEqual([]);
    expect(c.getSelection()).toBeNull();
    expect(c.panes).toHaveLength(1);
    paste(c, text);
    expect(c.indicators.getAll()).toMatchObject([{ type: 'test/osc', inputs: { length: 21 } }]);
    expect(c.panes).toHaveLength(2);
  });

  it('pastes from memory when the browser fires no clipboard event', async () => {
    const c = chart();
    c.setSelection({ kind: 'indicator', indicator: c.indicators.add(osc) });
    press(c, 'c');
    await nextTask();
    press(c, 'v');
    await nextTask();
    expect(c.indicators.getAll()).toHaveLength(2);
  });

  it('pastes what was copied last, drawings or an indicator', () => {
    const c = chart();
    c.setSelection({ kind: 'indicator', indicator: c.indicators.add(osc) });
    press(c, 'c');
    const drawn = c.drawings.add({ type: 'hline', pane: 0, points: [{ time: 600, price: 10 }], style: {} });
    c.drawings.setSelection([drawn.id]);
    const text = copy(c);
    expect(copied(c)).toBeNull();
    paste(c, text);
    expect(c.drawings.getAll()).toHaveLength(2);
    expect(c.indicators.getAll()).toHaveLength(1);
    // `drawings.copy()` from the API also replaces a copied indicator.
    c.setSelection({ kind: 'indicator', indicator: c.indicators.getAll()[0]! });
    press(c, 'c');
    expect(copied(c)).not.toBeNull();
    c.drawings.copy([drawn.id]);
    expect(copied(c)).toBeNull();
  });

  it('copies and pastes in memory on a chart without drawings', () => {
    const c = chart({ plugins: [indicators()] });
    c.setSelection({ kind: 'indicator', indicator: c.indicators.add(osc) });
    expect(press(c, 'c').defaultPrevented).toBe(true);
    expect(press(c, 'v').defaultPrevented).toBe(true);
    expect(c.indicators.getAll()).toHaveLength(2);
  });

  it('shares the copy, cut and paste keys with drawings without conflicts', () => {
    const c = chart();
    expect(c.actions.get('copy')).toMatchObject({ label: 'Copy', keys: ['Mod+C'], enabled: false });
    expect(c.actions.get('cut')).toMatchObject({ label: 'Cut', keys: ['Mod+X'], enabled: false });
    expect(c.actions.get('paste')).toMatchObject({ label: 'Paste', keys: ['Mod+V'] });
    for (const id of ['copy-drawings', 'cut-drawings', 'paste-drawings']) expect(c.actions.get(id)!.keys).toEqual([]);
    expect(c.actions.conflicts()).toEqual([]);
  });

  it('reads an indicator payload as an indicator paste', () => {
    const set = { version: 1, indicators: [] };
    expect(resolvePaste(JSON.stringify({ kind: INDICATOR_CLIPBOARD_KIND, set }), null)).toEqual({ kind: 'indicator', set });
  });
});
