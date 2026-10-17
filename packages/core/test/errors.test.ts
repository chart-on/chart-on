import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { ChartError, toChartError, type ChartErrorCode } from '../src/errors';
import { Emitter } from '../src/util/emitter';
import { intervalSeconds } from '../src/data/util';
import { parseSerialized } from '../src/drawing/manager';
import type { BarsReset, DataEvents, DataSource, SymbolInfo } from '../src/data/types';
import type { Bar } from '../src/types';

const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0, close: 1 });

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 50 }, (_, i) => bar(i * 60)));
  return c;
}

const frame = (c: Chart) => {
  c.invalidate();
  (c as any).render(0);
};

/** A source that fails where told: resolving the symbol, its first bars or older pages. */
function failing(stage: 'resolve' | 'bars' | 'history') {
  const offline = new Error('offline');
  const source: DataSource = {
    symbol: async (symbol) => {
      if (stage === 'resolve') throw offline;
      return { symbol, name: symbol } as SymbolInfo;
    },
    search: async () => [],
    history: async (_symbol, _interval, req) => {
      if (stage === 'bars' || (stage === 'history' && req.kind !== 'initial')) throw offline;
      return { bars: Array.from({ length: 50 }, (_, i) => bar((i + 100) * 60)) };
    },
  };
  return { source, offline };
}

describe('Emitter', () => {
  it('runs every listener when one throws and reports the error with the event name', () => {
    const onError = vi.fn();
    const emitter = new Emitter<{ tick: number }>(onError);
    const after = vi.fn();
    const boom = new Error('boom');
    emitter.on('tick', () => {
      throw boom;
    });
    emitter.on('tick', after);
    expect(() => emitter.emit('tick', 1)).not.toThrow();
    expect(after).toHaveBeenCalledWith(1);
    expect(onError).toHaveBeenCalledWith(boom, 'tick');
  });

});

describe('chart listener errors', () => {
  it('a throwing view:change listener neither stops later listeners nor breaks the next frame', () => {
    const c = chart();
    const later = vi.fn();
    const errors = vi.fn();
    c.on('view:change', () => {
      throw new Error('app bug');
    });
    c.on('view:change', later);
    c.on('chart:error', errors);
    frame(c);
    expect(later).toHaveBeenCalledTimes(1);
    expect((c as any).sceneDirty).toBe(false);
    const { error } = errors.mock.calls[0]![0] as { error: ChartError };
    expect(error).toBeInstanceOf(ChartError);
    expect(error.code).toBe('listener-failed');
    expect(error.context).toEqual({ event: 'view:change' });
    expect((error.cause as Error).message).toBe('app bug');
    c.setVisibleTimeRange(600, 1200, false);
    frame(c);
    expect(later).toHaveBeenCalledTimes(2);
  });

  it('logs a listener error when nobody listens to chart:error, and when a chart:error listener throws', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = chart();
    c.on('view:change', () => {
      throw new Error('app bug');
    });
    frame(c);
    expect(log).toHaveBeenCalledTimes(1);
    c.on('chart:error', () => {
      throw new Error('error handler bug');
    });
    c.setVisibleTimeRange(600, 1200, false);
    frame(c);
    // The view:change error goes to the error listener, whose own failure is logged, once.
    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe('data errors', () => {
  const cases: [Parameters<typeof failing>[0], ChartErrorCode][] = [
    ['resolve', 'unknown-symbol'],
    ['bars', 'load-failed'],
  ];

  it.each(cases)('a failure to %s reports %s with the source error as cause', async (stage, code) => {
    const c = chart();
    const { source, offline } = failing(stage);
    const events: DataEvents['data:error'][] = [];
    c.on('data:error', (e) => events.push(e));
    c.setDataSource(source);
    const error = await c.setSymbol('A', '1m').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChartError);
    expect((error as ChartError).code).toBe(code);
    expect((error as ChartError).cause).toBe(offline);
    expect((error as ChartError).context).toEqual({ symbol: 'A', interval: '1m' });
    expect(events[0]!.error).toBe(error);
  });

  it('reports history-failed for a page of older bars', async () => {
    const c = chart();
    const { source, offline } = failing('history');
    const events: DataEvents['data:error'][] = [];
    c.on('data:error', (e) => events.push(e));
    c.setDataSource(source);
    await c.setSymbol('A', '1m');
    await (c as any).dataController.loadMore();
    expect(events[0]!.kind).toBe('history');
    expect(events[0]!.error.code).toBe('history-failed');
    expect(events[0]!.error.cause).toBe(offline);
  });

  it('reports reset-failed when refetching after onReset fails', async () => {
    const c = chart();
    const offline = new Error('offline');
    let onReset: ((reset: BarsReset) => void) | undefined;
    const source: DataSource = {
      symbol: async (symbol) => ({ symbol, name: symbol }) as SymbolInfo,
      search: async () => [],
      history: async (_symbol, _interval, req) => {
        if (req.kind !== 'initial') throw offline;
        return { bars: Array.from({ length: 50 }, (_, i) => bar((i + 100) * 60)) };
      },
      onReset: (listener) => {
        onReset = listener;
        return () => {};
      },
    };
    const events: DataEvents['data:error'][] = [];
    c.on('data:error', (e) => events.push(e));
    c.setDataSource(source);
    await c.setSymbol('A', '1m');
    onReset!({ symbol: 'A' });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]!.kind).toBe('reset');
    expect(events[0]!.error).toBeInstanceOf(ChartError);
    expect(events[0]!.error.code).toBe('reset-failed');
    expect(events[0]!.error.cause).toBe(offline);
    expect(events[0]!.error.context).toEqual({ symbol: 'A', interval: '1m' });
  });

  it('a throwing data:loaded listener does not fail the load', async () => {
    const c = chart();
    const bug = new Error('app bug');
    const errors: ChartError[] = [];
    const dataErrors = vi.fn();
    c.on('data:loaded', () => {
      throw bug;
    });
    c.on('chart:error', ({ error }) => errors.push(error));
    c.on('data:error', dataErrors);
    c.setDataSource(failing('history').source);
    await expect(c.setSymbol('A', '1m')).resolves.toBeUndefined();
    expect(dataErrors).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('listener-failed');
    expect(errors[0]!.cause).toBe(bug);
    expect(errors[0]!.context).toEqual({ event: 'data:loaded' });
  });

  it('marks a failed setSymbol handled when data:error has a listener, and still rejects', async () => {
    const unhandled = vi.fn();
    const proc = (globalThis as unknown as { process: { on(e: string, f: () => void): void; off(e: string, f: () => void): void } }).process;
    proc.on('unhandledRejection', unhandled);
    try {
      const c = chart();
      const reported = new Promise((resolve) => c.on('data:error', resolve));
      c.setDataSource(failing('bars').source);
      // The app ignores the promise and relies on the event.
      void c.setSymbol('A', '1m');
      await reported;
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).not.toHaveBeenCalled();
      // Code that awaits still sees the failure.
      await expect(c.setSymbol('B', '1m')).rejects.toBeInstanceOf(ChartError);
    } finally {
      proc.off('unhandledRejection', unhandled);
    }
  });

  it('reports compare failures as ChartError', async () => {
    const c = chart();
    const ok: DataSource = {
      symbol: async (symbol) => {
        if (symbol === 'B') throw new Error('no such symbol');
        return { symbol, name: symbol } as SymbolInfo;
      },
      search: async () => [],
      history: async () => ({ bars: [bar(0)] }),
    };
    const errors: { symbol: string; error: ChartError }[] = [];
    c.on('compare:error', (e) => errors.push(e));
    c.setDataSource(ok);
    await c.setSymbol('A', '1m');
    await c.compare('B').ready;
    expect(errors[0]!.error.code).toBe('unknown-symbol');
  });
});

describe('error codes at throw sites', () => {
  it('invalid intervals and drawings carry their codes', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as ChartError).code;
      }
      return null;
    };
    expect(code(() => intervalSeconds('1x'))).toBe('invalid-interval');
    expect(code(() => parseSerialized({ version: 1 }))).toBe('invalid-drawings');
    expect(code(() => parseSerialized({ version: 1, drawings: [{}] }))).toBe('invalid-drawings');
  });

  it('toChartError keeps a ChartError and wraps anything else', () => {
    const own = new ChartError('load-failed', 'x');
    expect(toChartError(own, 'history-failed', 'y')).toBe(own);
    const wrapped = toChartError('down', 'history-failed', 'Could not load', { symbol: 'A' });
    expect(wrapped.message).toBe('Could not load: down');
    expect(wrapped.cause).toBe('down');
    expect(wrapped.context).toEqual({ symbol: 'A' });
  });

  it('a ChartError without a message, as production builds throw it, reads as its code', () => {
    const error = new ChartError('not-registered', '', { context: { call: 'replay' } });
    expect(error.message).toBe('not-registered');
    expect(error.code).toBe('not-registered');
    expect(error.context).toEqual({ call: 'replay' });
  });
});
