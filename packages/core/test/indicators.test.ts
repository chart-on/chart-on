import { describe, expect, it, vi } from 'vitest';
import { IndicatorRunner, resolveInputs, sourceAt, sourceOf, syncRunners, type RunnerListener } from '../src/indicators/runner';
import { indicatorTitle, validateIndicatorDef } from '../src/indicators/indicator';
import type { BarArrays, IndicatorDef, IndicatorOutputs } from '../src/indicators/types';
import type { Bar } from '../src/types';

function bars(closes: number[]): Bar[] {
  return closes.map((close, i) => ({ time: i * 60, open: close - 1, high: close + 2, low: close - 2, close, volume: 10 }));
}

function smaAt(close: Float64Array, length: number, i: number): number {
  if (i < length - 1) return NaN;
  let sum = 0;
  for (let j = i - length + 1; j <= i; j++) sum += close[j]!;
  return sum / length;
}

type SmaInputs = { length: number };

function smaDef(withUpdate = true): IndicatorDef<SmaInputs> {
  return {
    id: 'sma',
    name: 'SMA',
    placement: 'overlay',
    inputs: [{ id: 'length', type: 'number', default: 3, min: 1 }],
    plots: [{ id: 'sma', type: 'line' }],
    compute: vi.fn((src: BarArrays, { length }: SmaInputs) => {
      const out = new Float64Array(src.length);
      for (let i = 0; i < src.length; i++) out[i] = smaAt(src.close, length, i);
      return { sma: out };
    }),
    ...(withUpdate
      ? {
          update: vi.fn((src: BarArrays, { length }: SmaInputs, i: number, out: IndicatorOutputs) => {
            out.sma![i] = smaAt(src.close, length, i);
          }),
        }
      : {}),
  };
}

function listener(): RunnerListener & { changes: number[]; errors: unknown[] } {
  const changes: number[] = [];
  const errors: unknown[] = [];
  return { changes, errors, change: (from) => changes.push(from), error: (e) => errors.push(e) };
}

function runner(def: IndicatorDef<SmaInputs>, l: RunnerListener = listener(), inputs = {}) {
  return new IndicatorRunner(def as unknown as IndicatorDef, resolveInputs(def.inputs, inputs), l);
}

const values = (r: IndicatorRunner, id = 'sma') => Array.from(r.out[id]!);

describe('resolveInputs', () => {
  const defs = smaDef().inputs.concat([
    { id: 'src', type: 'source', default: 'close' },
    { id: 'color', type: 'color', default: '#fff' },
    { id: 'show', type: 'boolean', default: true },
  ]);

  it('fills defaults and keeps given values', () => {
    expect(resolveInputs(defs, { length: 9 })).toEqual({ length: 9, src: 'close', color: '#fff', show: true });
  });

  it('rejects unknown inputs and invalid values', () => {
    expect(() => resolveInputs(defs, { nope: 1 })).toThrow(/Unknown/);
    expect(() => resolveInputs(defs, { length: 0 })).toThrow(/length/);
    expect(() => resolveInputs(defs, { length: NaN })).toThrow(/length/);
    expect(() => resolveInputs(defs, { src: 'median' })).toThrow(/src/);
    expect(() => resolveInputs(defs, { show: 'yes' })).toThrow(/show/);
  });
});

describe('sources', () => {
  it('derives averages', () => {
    const r = runner(smaDef());
    r.setBars([{ time: 0, open: 1, high: 4, low: 0, close: 3 }]);
    expect(Array.from(sourceOf(r.src, 'hl2'))).toEqual([2]);
    expect(sourceAt(r.src, 'ohlc4', 0)).toBe(2);
    expect(sourceOf(r.src, 'close')).toBe(r.src.close);
    expect(Number.isNaN(r.src.volume[0]!)).toBe(true);
  });
});

describe('IndicatorRunner', () => {
  it('computes all bars on new data and skips compute when empty', () => {
    const def = smaDef();
    const l = listener();
    const r = runner(def, l);
    r.setBars([]);
    expect(def.compute).not.toHaveBeenCalled();
    r.setBars(bars([1, 2, 3, 4]));
    expect(def.compute).toHaveBeenCalledTimes(1);
    expect(values(r)).toEqual([NaN, NaN, 2, 3]);
    expect(l.changes).toEqual([0, 0]);
  });

  it('updates only the last bar on a live tick', () => {
    const def = smaDef();
    const l = listener();
    const r = runner(def, l);
    r.setBars(bars([1, 2, 3, 4]));
    r.updateLast(bars([1, 2, 3, 10])[3]!, false);
    expect(def.compute).toHaveBeenCalledTimes(1);
    expect(def.update).toHaveBeenCalledTimes(1);
    expect(def.update).toHaveBeenLastCalledWith(r.src, r.inputs, 3, r.out, {}, {});
    expect(values(r)).toEqual([NaN, NaN, 2, 5]);
    expect(l.changes.at(-1)).toBe(3);
  });

  it('extends outputs when a bar is appended, matching a full compute', () => {
    const def = smaDef();
    const r = runner(def);
    r.setBars(bars([1, 2, 3, 4]));
    // Push past the initial capacity so storage has to grow.
    const all = [1, 2, 3, 4];
    for (let i = 0; i < 40; i++) {
      all.push(5 + i);
      r.updateLast(bars(all)[all.length - 1]!, true);
    }
    expect(def.compute).toHaveBeenCalledTimes(1);
    const full = runner(smaDef());
    full.setBars(bars(all));
    expect(values(r)).toEqual(values(full));
    expect(r.length).toBe(all.length);
  });

  it('recomputes on ticks when the definition has no update', () => {
    const def = smaDef(false);
    const r = runner(def);
    r.setBars(bars([1, 2, 3]));
    r.updateLast(bars([1, 2, 6])[2]!, false);
    expect(def.compute).toHaveBeenCalledTimes(2);
    expect(values(r)).toEqual([NaN, NaN, 3]);
  });

  it('recomputes with new inputs', () => {
    const def = smaDef();
    const r = runner(def);
    r.setBars(bars([1, 2, 3, 4]));
    r.setInputs(resolveInputs(def.inputs, { length: 2 }));
    expect(values(r)).toEqual([NaN, 1.5, 2.5, 3.5]);
  });

  it('keeps extra output arrays as state for update', () => {
    const def: IndicatorDef = {
      id: 'cum',
      name: 'Cumulative',
      placement: 'pane',
      inputs: [],
      plots: [{ id: 'avg', type: 'line' }],
      compute(src) {
        const sum = new Float64Array(src.length);
        const avg = new Float64Array(src.length);
        for (let i = 0; i < src.length; i++) {
          sum[i] = (sum[i - 1] ?? 0) + src.close[i]!;
          avg[i] = sum[i]! / (i + 1);
        }
        return { avg, sum };
      },
      update(src, _inputs, i, out) {
        out.sum![i] = (out.sum![i - 1] ?? 0) + src.close[i]!;
        out.avg![i] = out.sum![i]! / (i + 1);
      },
    };
    const r = new IndicatorRunner(def, {}, listener());
    r.setBars(bars([2, 4]));
    r.updateLast(bars([2, 4, 6])[2]!, true);
    r.updateLast(bars([2, 4, 9])[2]!, false);
    expect(Array.from(r.out.avg!)).toEqual([2, 3, 5]);
  });

  it('reports malformed results and leaves outputs empty', () => {
    const def = { ...smaDef(), compute: () => ({ sma: new Float64Array(1) }) };
    const l = listener();
    const r = runner(def, l);
    r.setBars(bars([1, 2, 3]));
    expect(l.errors).toHaveLength(1);
    expect(values(r)).toEqual([NaN, NaN, NaN]);
  });

  it('reports errors thrown by compute', () => {
    const def = {
      ...smaDef(),
      compute: () => {
        throw new Error('boom');
      },
    };
    const l = listener();
    runner(def, l).setBars(bars([1, 2]));
    expect((l.errors[0] as Error).message).toBe('boom');
  });

  it('reports a missing result instead of throwing', () => {
    for (const result of [undefined, null]) {
      const def = { ...smaDef(), compute: () => result as unknown as IndicatorOutputs };
      const l = listener();
      const r = runner(def, l);
      expect(() => r.setBars(bars([1, 2, 3]))).not.toThrow();
      expect(l.errors).toHaveLength(1);
      expect(values(r)).toEqual([NaN, NaN, NaN]);
    }
  });

  it('reports state arrays that are not per-bar Float64Arrays', () => {
    const states = [[1, 2, 3], new Float64Array(2), new Float32Array(3)];
    for (const state of states) {
      const def = {
        ...smaDef(),
        compute: (src: BarArrays) => ({ sma: new Float64Array(src.length), state }) as unknown as IndicatorOutputs,
      };
      const l = listener();
      const r = runner(def, l);
      expect(() => r.setBars(bars([1, 2, 3]))).not.toThrow();
      expect((l.errors[0] as Error).message).toMatch(/"state"/);
      expect(values(r)).toEqual([NaN, NaN, NaN]);
      expect(r.out.state).toBeUndefined();
    }
  });

  describe('after a failure', () => {
    /** Running sum kept in an extra output; compute throws while `fail.compute` is set. */
    function statefulDef(fail: { compute: boolean }) {
      const def: IndicatorDef = {
        id: 'cum',
        name: 'Cumulative',
        placement: 'pane',
        inputs: [],
        plots: [{ id: 'avg', type: 'line' }],
        compute: vi.fn((src: BarArrays) => {
          if (fail.compute) throw new Error('compute failed');
          const sum = new Float64Array(src.length);
          const avg = new Float64Array(src.length);
          for (let i = 0; i < src.length; i++) {
            sum[i] = (sum[i - 1] ?? 0) + src.close[i]!;
            avg[i] = sum[i]! / (i + 1);
          }
          return { avg, sum };
        }),
        // Throws when the `sum` state is missing, like a real stateful indicator.
        update: vi.fn((src: BarArrays, _inputs: unknown, i: number, out: IndicatorOutputs) => {
          out.sum![i] = (out.sum![i - 1] ?? 0) + src.close[i]!;
          out.avg![i] = out.sum![i]! / (i + 1);
        }),
      };
      return def;
    }

    const allNaN = (arr: Float64Array | undefined) => Array.from(arr!).every(Number.isNaN);

    it('skips live ticks, reports the error once and draws nothing', () => {
      const fail = { compute: true };
      const def = statefulDef(fail);
      const l = listener();
      const r = new IndicatorRunner(def, {}, l);
      const closes = [1, 2, 3];
      r.setBars(bars(closes));
      for (let t = 0; t < 10; t++) {
        const appended = t % 3 === 0;
        if (appended) closes.push(10 + t);
        else closes[closes.length - 1] = 20 + t;
        r.updateLast(bars(closes)[closes.length - 1]!, appended);
      }
      expect(l.errors).toHaveLength(1);
      expect(def.update).not.toHaveBeenCalled();
      expect(r.out.avg).toHaveLength(closes.length);
      expect(allNaN(r.out.avg)).toBe(true);
    });

    it('does not draw a lone last value for an indicator without state', () => {
      const def = { ...smaDef(), compute: () => ({ sma: new Float64Array(1) }) };
      const l = listener();
      const r = runner(def, l);
      r.setBars(bars([1, 2, 3, 4]));
      r.updateLast(bars([1, 2, 3, 4, 5])[4]!, true);
      r.updateLast(bars([1, 2, 3, 4, 6])[4]!, false);
      expect(l.errors).toHaveLength(1);
      expect(def.update).not.toHaveBeenCalled();
      expect(values(r)).toEqual([NaN, NaN, NaN, NaN, NaN]);
    });

    it('stops after an update throws until the next recompute', () => {
      const def = smaDef();
      const l = listener();
      const r = runner(def, l);
      r.setBars(bars([1, 2, 3, 4]));
      vi.mocked(def.update!).mockImplementationOnce(() => {
        throw new Error('update failed');
      });
      r.updateLast(bars([1, 2, 3, 5])[3]!, false);
      r.updateLast(bars([1, 2, 3, 6])[3]!, false);
      r.updateLast(bars([1, 2, 3, 6, 7])[4]!, true);
      expect(l.errors).toHaveLength(1);
      expect(def.update).toHaveBeenCalledTimes(1);
      expect(values(r)).toEqual([NaN, NaN, NaN, NaN, NaN]);
    });

    it('resumes live updates after a successful recompute', () => {
      const fail = { compute: true };
      const def = statefulDef(fail);
      const l = listener();
      const r = new IndicatorRunner(def, {}, l);
      r.setBars(bars([2, 4]));
      r.updateLast(bars([2, 4, 6])[2]!, true);
      expect(l.errors).toHaveLength(1);

      fail.compute = false;
      r.setInputs({});
      expect(Array.from(r.out.avg!)).toEqual([2, 3, 4]);
      r.updateLast(bars([2, 4, 9])[2]!, false);
      r.updateLast(bars([2, 4, 9, 13])[3]!, true);
      expect(def.update).toHaveBeenCalledTimes(2);
      expect(Array.from(r.out.avg!)).toEqual([2, 3, 5, 7]);
      expect(l.errors).toHaveLength(1);

      // A new failure is reported again, once.
      fail.compute = true;
      r.setInputs({});
      r.updateLast(bars([2, 4, 9, 14])[3]!, false);
      expect(l.errors).toHaveLength(2);
      expect(def.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('async compute', () => {
    function deferredDef() {
      const pending: { src: BarArrays; inputs: SmaInputs; resolve: (out: IndicatorOutputs) => void }[] = [];
      const base = smaDef();
      const def: IndicatorDef<SmaInputs> = {
        ...base,
        compute: (src, inputs) =>
          new Promise<IndicatorOutputs>((resolve) => {
            // Snapshot like a worker would; the live arrays keep changing.
            pending.push({ src: { ...src, close: src.close.slice() }, inputs, resolve });
          }),
      };
      const settle = (i: number) => {
        const p = pending[i]!;
        p.resolve(base.compute(p.src, p.inputs, {}, {}) as IndicatorOutputs);
      };
      return { def, pending, settle };
    }

    it('drops results overtaken by newer inputs', async () => {
      const { def, settle } = deferredDef();
      const r = runner(def);
      r.setBars(bars([1, 2, 3, 4]));
      r.setInputs(resolveInputs(def.inputs, { length: 2 }));
      settle(1);
      await Promise.resolve();
      expect(values(r)).toEqual([NaN, 1.5, 2.5, 3.5]);
      settle(0);
      await Promise.resolve();
      expect(values(r)).toEqual([NaN, 1.5, 2.5, 3.5]);
    });

    it('applies ticks that arrived while computing', async () => {
      const { def, settle } = deferredDef();
      const r = runner(def);
      r.setBars(bars([1, 2, 3, 4]));
      r.updateLast(bars([1, 2, 3, 7])[3]!, false);
      r.updateLast(bars([1, 2, 3, 7, 8])[4]!, true);
      expect(def.update).not.toHaveBeenCalled();
      settle(0);
      await Promise.resolve();
      expect(values(r)).toEqual([NaN, NaN, 2, 4, 6]);
    });

    it('reports a promise that resolves to nothing', async () => {
      const def = { ...smaDef(), compute: () => Promise.resolve(undefined as unknown as IndicatorOutputs) };
      const l = listener();
      const r = runner(def, l);
      r.setBars(bars([1, 2, 3]));
      await Promise.resolve();
      expect(l.errors).toHaveLength(1);
      expect(values(r)).toEqual([NaN, NaN, NaN]);
    });
  });
});

describe('syncRunners', () => {
  /** Runners over one shared list; the first one's compute throws. */
  function setup(onError: (list: IndicatorRunner[]) => void) {
    const list: IndicatorRunner[] = [];
    const failing = {
      ...smaDef(),
      compute: () => {
        throw new Error('boom');
      },
    };
    const healthy = [smaDef(), smaDef()];
    list.push(runner(failing, { change: () => {}, error: () => onError(list) }));
    for (const def of healthy) list.push(runner(def));
    return { list, healthy };
  }

  const removeAt = (list: IndicatorRunner[], i: number) => list.splice(i, 1)[0]!.dispose();

  it('reaches every runner when an error handler removes the failing one', () => {
    const { list, healthy } = setup((l) => removeAt(l, 0));
    syncRunners(list, bars([1, 2, 3]), 'reset');
    expect(list).toHaveLength(2);
    for (const def of healthy) expect(def.compute).toHaveBeenCalledTimes(1);
  });

  it('skips a runner removed by an earlier error handler', () => {
    const { list, healthy } = setup((l) => removeAt(l, 1));
    syncRunners(list, bars([1, 2, 3]), 'reset');
    expect(healthy[0]!.compute).not.toHaveBeenCalled();
    expect(healthy[1]!.compute).toHaveBeenCalledTimes(1);
  });

  it('does not visit runners added by an error handler', () => {
    const added = smaDef();
    const { list } = setup((l) => {
      if (l.length === 3) l.push(runner(added));
    });
    syncRunners(list, bars([1, 2, 3]), 'reset');
    expect(list).toHaveLength(4);
    expect(added.compute).not.toHaveBeenCalled();
  });

  it('passes the last bar on ticks and appends', () => {
    const def = smaDef();
    const list = [runner(def)];
    syncRunners(list, bars([1, 2, 3]), 'reset');
    syncRunners(list, bars([1, 2, 6]), 'tick');
    syncRunners(list, bars([1, 2, 6, 7]), 'append');
    expect(def.compute).toHaveBeenCalledTimes(1);
    expect(def.update).toHaveBeenCalledTimes(2);
    expect(values(list[0]!)).toEqual([NaN, NaN, 3, 5]);
  });
});

describe('definition helpers', () => {
  it('builds the legend title from number and source inputs', () => {
    const def = { ...smaDef(), inputs: [...smaDef().inputs, { id: 'src', type: 'source', default: 'close' } as const] };
    expect(indicatorTitle(def as unknown as IndicatorDef, { length: 20, src: 'hl2' })).toBe('SMA 20 hl2');
  });

  it('uses the definition title when it has one', () => {
    const def = { ...smaDef(), title: ({ length }: { length: number }) => `Average ${length}` };
    expect(indicatorTitle(def as unknown as IndicatorDef, { length: 20 })).toBe('Average 20');
  });

  it('validates plots and fills', () => {
    const def = smaDef() as unknown as IndicatorDef;
    expect(() => validateIndicatorDef(def)).not.toThrow();
    expect(() => validateIndicatorDef({ ...def, fills: [{ between: ['sma', 'nope'], color: '#fff' }] })).toThrow(/nope/);
    expect(() => validateIndicatorDef({ ...def, plots: [...def.plots, ...def.plots] })).toThrow(/twice/);
    expect(() => validateIndicatorDef({ ...def, plots: [{ id: 'x', type: 'line', colorInput: 'c' }] })).toThrow(/color input/);
  });
});
