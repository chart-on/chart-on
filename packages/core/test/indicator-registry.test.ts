import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptions } from '../src/chart';
import { restoreInputs } from '../src/indicators/manager';
import { parseIndicatorStates } from '../src/indicators/state';
import type { DataSource } from '../src/data/types';
import type { IndicatorDef, IndicatorState, InputValue } from '../src/indicators/types';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
});

const bars = (n: number): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ time: i * 60, open: i, high: i + 1, low: i - 1, close: i }));

function chart(options: Partial<ChartOptions> = {}, n = 50) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  c.addCandles().setData(bars(n));
  return c;
}

type BandInputs = { length: number; width: number };

/** Namespaced custom indicator: the close shifted by `width`, in its own pane. */
function bandsDef(overrides: Partial<IndicatorDef<BandInputs>> = {}): IndicatorDef<BandInputs> {
  return {
    id: 'my-lib/close-bands',
    name: 'Close bands',
    placement: 'pane',
    inputs: [
      { id: 'length', type: 'number', default: 10, min: 1 },
      { id: 'width', type: 'number', default: 1, min: 0 },
    ],
    plots: [{ id: 'upper', type: 'line' }],
    compute: (src, { width }) => ({ upper: src.close.map((v) => v + width) }),
    lookback: ({ length }) => length - 1,
    ...overrides,
  };
}

function events(c: Chart) {
  const log: string[] = [];
  const errors: unknown[] = [];
  c.on('indicator:add', ({ indicator }) => log.push(`add ${indicator.type}${indicator.pending ? ' (pending)' : ''}`));
  c.on('indicator:remove', ({ indicator }) => log.push(`remove ${indicator.type}`));
  c.on('indicator:change', ({ indicator }) => log.push(`change ${indicator.type}${indicator.pending ? ' (pending)' : ''}`));
  c.on('indicator:error', ({ error }) => errors.push(error));
  return { log, errors };
}

describe('indicator registry', () => {
  it('registers definitions and lists them in order', () => {
    const c = chart();
    const a = bandsDef();
    const b = bandsDef({ id: 'my-lib/other' });
    c.indicators.register(a);
    c.indicators.register(b);
    expect(c.indicators.getDefinitions()).toEqual([a, b]);
  });

  it('searches the current registry without adding indicators or applying access rules', () => {
    const c = chart();
    const a = bandsDef({ category: 'volatility', aliases: ['Envelope'] });
    const b = bandsDef({ id: 'band-strength', name: 'Band strength' });
    c.indicators.register(a);
    c.indicators.register(b);
    expect(c.indicators.search('band')).toEqual([b, a]);
    expect(c.indicators.search('envelope')).toEqual([a]);
    expect(c.indicators.search('cb')).toEqual([a]);
    expect(c.indicators.search('volatility')).toEqual([a]);
    const all = c.indicators.search('');
    all.pop();
    expect(c.indicators.search('')).toEqual([a, b]);
    c.indicators.setAccess(({ id }) => id !== a.id);
    expect(c.indicators.search('envelope')).toEqual([a]);
    expect(c.indicators.getAll()).toEqual([]);
    c.indicators.unregister(a.id);
    expect(c.indicators.search('envelope')).toEqual([]);
    expect(c.indicators.search('')).toEqual([b]);
  });

  it('rejects a taken id unless it is the same definition', () => {
    const c = chart();
    const def = bandsDef();
    c.indicators.register(def);
    expect(() => c.indicators.register(def)).not.toThrow();
    expect(() => c.indicators.register(bandsDef())).toThrow(/already registered/);
    expect(() => c.indicators.add(bandsDef())).toThrow(/already registered/);
  });

  it('validates definitions on register', () => {
    const c = chart();
    expect(() => c.indicators.register(bandsDef({ id: '' }))).toThrow(/id/);
    expect(() => c.indicators.register(bandsDef({ version: 0 }))).toThrow(/version/);
    expect(() => c.indicators.register(bandsDef({ version: 1.5 }))).toThrow(/version/);
    expect(c.indicators.getDefinitions()).toEqual([]);
  });

  it('adds by id or by definition, registering a new definition', () => {
    const c = chart();
    expect(() => c.indicators.add('my-lib/close-bands')).toThrow(/Unknown indicator/);
    const def = bandsDef();
    const first = c.indicators.add(def, { width: 2 });
    expect(c.indicators.getDefinitions()).toEqual([def]);
    const second = c.indicators.add('my-lib/close-bands', { width: 3 });
    expect(second.def).toBe(def);
    expect(c.indicators.getAll()).toEqual([first, second]);
    expect(first.values.upper![10]).toBe(12);
    expect(second.values.upper![10]).toBe(13);
    expect(() => c.indicators.add('my-lib/close-bands', { nope: 1 } as never)).toThrow(/Unknown indicator input/);
  });

  it('adds, serializes, removes and restores a namespaced indicator', () => {
    const c = chart();
    const { log } = events(c);
    c.indicators.register(bandsDef());
    const ind = c.indicators.add('my-lib/close-bands', { length: 5, width: 2 });
    ind.setVisible(false);
    const saved = c.indicators.serialize();
    expect(saved).toEqual([{ id: 'ind-1', type: 'my-lib/close-bands', version: 1, inputs: { length: 5, width: 2 }, pane: 1, visible: false }]);
    expect(c.panes).toHaveLength(2);

    c.indicators.remove(ind);
    expect(c.indicators.getAll()).toEqual([]);
    expect(c.panes).toHaveLength(1);

    c.indicators.load(JSON.parse(JSON.stringify(saved)));
    const [restored] = c.indicators.getAll();
    expect(restored!.pending).toBe(false);
    expect(restored!.inputs).toEqual({ length: 5, width: 2 });
    expect(restored!.visible).toBe(false);
    expect(restored!.values.upper![10]).toBe(12);
    expect(c.indicators.serialize()).toEqual(saved);
    expect(log).toEqual([
      'add my-lib/close-bands',
      'change my-lib/close-bands',
      'remove my-lib/close-bands',
      'add my-lib/close-bands',
    ]);
  });

  it('load replaces the indicators on the chart', () => {
    const c = chart();
    const old = c.indicators.add(bandsDef());
    c.indicators.load([{ type: 'my-lib/close-bands', inputs: { width: 4 }, pane: 1, visible: true }]);
    expect(c.indicators.getAll()).toHaveLength(1);
    expect(c.indicators.getAll()).not.toContain(old);
    expect(c.panes).toHaveLength(2);
  });

  it('rejects a malformed payload without changing anything', () => {
    const c = chart();
    const ind = c.indicators.add(bandsDef());
    expect(() => c.indicators.load({})).toThrow(/expected an array/);
    expect(() => c.indicators.load([{ type: 'x', inputs: {} }, { inputs: {} }])).toThrow(/index 1/);
    expect(() => c.indicators.load([{ type: 'x', version: -1 }])).toThrow(/index 0/);
    expect(c.indicators.getAll()).toEqual([ind]);
  });

  it('a removed series takes its indicator with it', () => {
    const c = chart();
    const { log } = events(c);
    const ind = c.indicators.add(bandsDef());
    ind.applyInputs({ width: 3 });
    c.removePane(ind.pane!);
    expect(c.indicators.getAll()).toEqual([]);
    expect(ind.pending).toBe(false);
    expect(ind.serialize()).toEqual({ id: 'ind-1', type: 'my-lib/close-bands', version: 1, inputs: { length: 10, width: 3 }, pane: 1, visible: true });
    expect(log).toEqual(['add my-lib/close-bands', 'change my-lib/close-bands', 'remove my-lib/close-bands']);
  });

  it('a removed handle keeps its last state and no longer emits changes', () => {
    const c = chart();
    const ind = c.indicators.add(bandsDef(), { width: 2 });
    ind.setVisible(false);
    const before = ind.serialize();
    ind.remove();
    const { log } = events(c);
    expect(ind.pending).toBe(false);
    expect(ind.serialize()).toEqual(before);
    expect(ind.inputs).toEqual({ length: 10, width: 2 });
    expect(ind.visible).toBe(false);
    ind.applyInputs({ width: 5 });
    ind.setVisible(true);
    expect(ind.inputs).toEqual({ length: 10, width: 5 });
    expect(ind.visible).toBe(true);
    expect(log).toEqual([]);
    expect(c.indicators.getAll()).toEqual([]);
  });

  it('a removed pending handle no longer emits changes', () => {
    const c = chart();
    c.indicators.load([{ type: 'my-lib/close-bands', inputs: {}, pane: 0, visible: true }]);
    const [ind] = c.indicators.getAll();
    ind!.remove();
    const { log } = events(c);
    expect(ind!.pending).toBe(false);
    ind!.applyInputs({ width: 5 });
    ind!.setVisible(false);
    c.indicators.register(bandsDef());
    expect(log).toEqual([]);
    expect(ind!.series).toBeNull();
  });
});

describe('pending placeholders', () => {
  const saved: IndicatorState = { id: 'ind-1', type: 'my-lib/close-bands', version: 1, inputs: { length: 5, width: 2 }, pane: 1, visible: true };

  it('round-trip unchanged and draw nothing until registered', () => {
    const c = chart();
    const { log } = events(c);
    c.indicators.load([saved]);
    const [placeholder] = c.indicators.getAll();
    expect(placeholder!.pending).toBe(true);
    expect(placeholder!.def).toBeNull();
    expect(placeholder!.series).toBeNull();
    expect(placeholder!.values).toEqual({});
    expect(c.panes).toHaveLength(1);
    expect(c.indicators.serialize()).toEqual([saved]);
    expect(log).toEqual(['add my-lib/close-bands (pending)']);

    c.indicators.register(bandsDef());
    expect(c.indicators.getAll()).toEqual([placeholder]);
    expect(placeholder!.pending).toBe(false);
    expect(placeholder!.inputs).toEqual({ length: 5, width: 2 });
    expect(placeholder!.values.upper![10]).toBe(12);
    expect(c.panes).toHaveLength(2);
    expect(c.indicators.serialize()).toEqual([saved]);
    expect(log).toEqual(['add my-lib/close-bands (pending)', 'change my-lib/close-bands']);
  });

  it('keep a missing version missing', () => {
    const c = chart();
    const legacy = { type: 'my-lib/close-bands', inputs: { width: 2 }, pane: 0, visible: true };
    c.indicators.load([legacy]);
    // A state saved before ids gets one.
    expect(c.indicators.serialize()).toEqual([{ id: 'ind-1', ...legacy }]);
  });

  it('reject input values no input type accepts while pending', () => {
    const c = chart();
    c.indicators.load([saved]);
    const [placeholder] = c.indicators.getAll();
    expect(() => placeholder!.applyInputs({ width: NaN })).toThrow(/width/);
    expect(() => placeholder!.applyInputs({ width: null as unknown as number })).toThrow(/width/);
    expect(placeholder!.inputs).toEqual(saved.inputs);
  });

  it('validate pending inputs when the definition registers, reporting what was replaced', () => {
    const c = chart();
    const { errors } = events(c);
    c.indicators.load([{ ...saved, inputs: { length: 5, width: null } }]);
    const [placeholder] = c.indicators.getAll();
    placeholder!.applyInputs({ length: -1 });
    c.indicators.register(bandsDef());
    expect(placeholder!.inputs).toEqual({ length: 10, width: 1 });
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/length/);
    expect(String(errors[0])).toMatch(/width/);
  });

  it('can be removed, hidden and given inputs while pending', () => {
    const c = chart();
    c.indicators.load([saved, { ...saved, inputs: {} }]);
    const [a, b] = c.indicators.getAll();
    a!.setVisible(false);
    a!.applyInputs({ width: 7 });
    b!.remove();
    expect(c.indicators.serialize()).toEqual([{ ...saved, inputs: { length: 5, width: 7 }, visible: false }]);
    c.indicators.register(bandsDef());
    expect(a!.visible).toBe(false);
    expect(a!.series!.visible).toBe(false);
    expect(a!.values.upper![10]).toBe(17);
  });

  it('come back when a definition is unregistered, and live again when re-registered', () => {
    const c = chart();
    const { log } = events(c);
    const def = bandsDef();
    const ind = c.indicators.add(def, { width: 3 });
    expect(c.panes).toHaveLength(2);
    c.indicators.unregister(def.id);
    expect(c.indicators.getDefinitions()).toEqual([]);
    expect(ind.pending).toBe(true);
    expect(c.indicators.getAll()).toEqual([ind]);
    expect(c.panes).toHaveLength(1);
    expect(ind.serialize()).toEqual({ id: 'ind-1', type: def.id, version: 1, inputs: { length: 10, width: 3 }, pane: 1, visible: true });
    c.indicators.register(def);
    expect(ind.pending).toBe(false);
    expect(ind.values.upper![10]).toBe(13);
    expect(log).toEqual(['add my-lib/close-bands', 'change my-lib/close-bands (pending)', 'change my-lib/close-bands']);
  });
});

describe('versioning', () => {
  type V2 = { period: number; width: number };
  const v2: IndicatorDef<V2> = {
    id: 'my-lib/close-bands',
    name: 'Close bands',
    version: 2,
    placement: 'overlay',
    inputs: [
      { id: 'period', type: 'number', default: 10, min: 1 },
      { id: 'width', type: 'number', default: 1, min: 0 },
    ],
    plots: [{ id: 'upper', type: 'line' }],
    compute: (src, { width }) => ({ upper: src.close.map((v) => v + width) }),
    // Version 1 called `period` `length`.
    migrate: (inputs, from) => {
      if (from >= 2) return inputs;
      const { length, ...rest } = inputs;
      return { ...rest, period: length as InputValue };
    },
  };

  it('migrates version 1 state into a version 2 definition with renamed inputs', () => {
    const c = chart();
    const { errors } = events(c);
    c.indicators.register(v2);
    c.indicators.load([{ type: v2.id, version: 1, inputs: { length: 21, width: 2 }, pane: 0, visible: true }]);
    const [ind] = c.indicators.getAll();
    expect(ind!.inputs).toEqual({ period: 21, width: 2 });
    expect(ind!.serialize()).toEqual({ id: 'ind-1', type: v2.id, version: 2, inputs: { period: 21, width: 2 }, pane: 0, visible: true });
    expect(errors).toEqual([]);
  });

  it('migrates a placeholder when its definition is registered later', () => {
    const c = chart();
    c.indicators.load([{ type: v2.id, inputs: { length: 21, width: 2 }, pane: 0, visible: true }]);
    c.indicators.register(v2);
    expect(c.indicators.getAll()[0]!.inputs).toEqual({ period: 21, width: 2 });
  });

  it('falls back to defaults for invalid inputs, keeps the indicator and reports it', () => {
    const c = chart();
    const { errors } = events(c);
    c.indicators.register(v2);
    c.indicators.load([{ type: v2.id, version: 2, inputs: { period: -5, width: 3, gone: true }, pane: 0, visible: true }]);
    const [ind] = c.indicators.getAll();
    expect(ind!.pending).toBe(false);
    expect(ind!.inputs).toEqual({ period: 10, width: 3 });
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/period/);
    expect(String(errors[0])).toMatch(/gone/);
  });

  it('reports a migrate that throws and keeps what still fits', () => {
    const def = { ...v2, migrate: () => { throw new Error('boom'); } } as IndicatorDef;
    const { inputs, problems } = restoreInputs(def, { type: def.id, version: 1, inputs: { length: 21, width: 2 }, pane: 0, visible: true });
    expect(inputs).toEqual({ period: 10, width: 2 });
    expect(problems.join()).toMatch(/boom/);
  });

  it('reports state saved by a newer version', () => {
    const { problems } = restoreInputs(v2 as unknown as IndicatorDef, { type: v2.id, version: 3, inputs: { period: 5 }, pane: 0, visible: true });
    expect(problems.join()).toMatch(/newer/);
  });

  it('parses saved states leniently where it can', () => {
    expect(parseIndicatorStates([{ type: 'a' }])).toEqual([{ type: 'a', inputs: {}, pane: 0, visible: true }]);
    expect(parseIndicatorStates([{ type: 'a', version: 2, inputs: { x: 1 }, pane: 3, visible: false }])).toEqual([
      { type: 'a', version: 2, inputs: { x: 1 }, pane: 3, visible: false },
    ]);
  });
});

describe('lookback', () => {
  it('is the largest declared lookback of the live indicators', () => {
    const c = chart();
    expect(c.indicators.lookback).toBe(0);
    const ind = c.indicators.add(bandsDef(), { length: 20 });
    expect(ind.lookback).toBe(19);
    c.indicators.add(bandsDef({ id: 'b', lookback: () => 4.2 }));
    c.indicators.add(bandsDef({ id: 'c', lookback: () => { throw new Error('x'); } }));
    c.indicators.add(bandsDef({ id: 'd', lookback: () => NaN }));
    expect(c.indicators.lookback).toBe(19);
    ind.applyInputs({ length: 3 });
    expect(c.indicators.lookback).toBe(5);
    c.indicators.load([{ type: 'unknown', inputs: {}, pane: 0, visible: true }]);
    expect(c.indicators.lookback).toBe(0);
  });

  it('adds to the bars requested on the first load', async () => {
    const history = vi.fn(async () => ({ bars: bars(10) }));
    const source: DataSource = {
      symbol: async (symbol) => ({ symbol, name: symbol }),
      search: async () => [],
      history,
    };
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.indicators.add(bandsDef(), { length: 51 });
    c.setDataSource(source, { initialBars: 100 });
    await c.setSymbol('X', '1m');
    expect(history).toHaveBeenCalledWith(expect.anything(), '1m', expect.objectContaining({ limit: 150 }));
  });

  it('asks for older history while warm-up bars would scroll into view', () => {
    const c = chart({}, 1000);
    const left = Math.floor(c.time.xToIndex(0));
    expect(left).toBeGreaterThan(10);
    c.applyOptions({ historyThreshold: left - 5 });
    const requests: unknown[] = [];
    c.on('history:request', (e) => requests.push(e));
    const emitRange = () => (c as unknown as { emitRangeEvents(): void }).emitRangeEvents();
    emitRange();
    expect(requests).toHaveLength(0);
    c.indicators.add(bandsDef(), { length: 21 });
    emitRange();
    expect(requests).toEqual([{ before: 0 }]);
  });
});
