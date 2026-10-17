import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { drawings } from '../src/builtins';
import { drawingHost } from '../src/drawing/chart-host';
import type { ChartInternals } from '../src/registry';
import { ChartError } from '../src/errors';
import type { DataSource, SymbolInfo } from '../src/data/types';
import type { Bar } from '../src/types';

const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0, close: 1 });

afterEach(() => vi.unstubAllGlobals());

/** A chart with bars, and a counted requestAnimationFrame installed after construction. */
function chart() {
  const c = new Chart(fakeContainer());
  c.addCandles().setData([0, 60, 120].map(bar));
  const raf = vi.fn(() => 1);
  vi.stubGlobal('requestAnimationFrame', raf);
  return { c, raf };
}

/** A source whose bars for `late` (a symbol or an interval) resolve only when the test says so. */
function source(late: string, atStart = true) {
  let release: (() => void) | null = null;
  const history = vi.fn(async (symbol: SymbolInfo, interval: string) => {
    if (symbol.symbol === late || interval === late) await new Promise<void>((resolve) => (release = resolve));
    return { bars: [0, 60, 120].map(bar), atStart };
  });
  const stream = vi.fn(() => () => {});
  const s: DataSource = {
    symbol: async (symbol) => ({ symbol, name: symbol, precision: 2 }) as SymbolInfo,
    search: async () => [],
    history,
    stream,
  };
  return { source: s, release: () => release?.(), history, stream };
}

describe('destroy', () => {
  it('schedules no frame for redraws or data updates afterwards', () => {
    const { c, raf } = chart();
    const line = c.addLine();
    c.destroy();
    c.invalidate();
    c.invalidateOverlay();
    c.requestRender();
    c.main!.update(bar(180));
    line.setData([{ time: 0, value: 1 }]);
    c.resize();
    expect(raf).not.toHaveBeenCalled();
  });

  it('is idempotent', () => {
    const { c } = chart();
    const dispose = vi.spyOn(c.main!, 'dispose');
    c.destroy();
    expect(() => c.destroy()).not.toThrow();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('drops a compared symbol whose bars arrive after destroy', async () => {
    const { c } = chart();
    const { source: s, release } = source('B');
    c.setDataSource(s);
    await c.setSymbol('A', '1m');
    const compared = c.compare('B');
    const setData = vi.spyOn(compared.series, 'setData');
    c.destroy();
    release();
    await compared.ready;
    expect(setData).not.toHaveBeenCalled();
  });

  it('rejects or ignores calls that would load data', async () => {
    const { c } = chart();
    const { source: s } = source('');
    c.destroy();
    c.setDataSource(s);
    await expect(c.setSymbol('A', '1m')).rejects.toThrow(ChartError);
    expect(() => c.compare('B')).toThrow(ChartError);
    await expect(c.captureImage()).resolves.toBeNull();
  });

  it('ignores the text editor losing focus on destroy', () => {
    const { c } = chart();
    // The internals the drawings plugin gets, whose host opens the editor.
    const make = c.internals.bind(c);
    let internals!: ChartInternals;
    c.internals = () => (internals = make());
    const plugin = drawings();
    c.uninstall(plugin.name);
    c.install(plugin);
    const done = vi.fn();
    drawingHost(c, internals).editText({ x: 0, y: 0 }, 'note', done);
    const input = internals.textEditor!;
    expect(input).not.toBeNull();
    c.destroy();
    dispatch(input, 'blur');
    expect(done).not.toHaveBeenCalled();
  });

  it('drops the data controller, so nothing can subscribe through it', async () => {
    const { c } = chart();
    const { source: s, stream } = source('');
    c.setDataSource(s);
    c.destroy();
    expect(c.data).toBeNull();
    await c.data?.setSymbol('A', '1m');
    expect(stream).not.toHaveBeenCalled();
  });

  it('does not dispose a series again when it is removed afterwards', async () => {
    const { c } = chart();
    const { source: s } = source('');
    c.setDataSource(s);
    await c.setSymbol('A', '1m');
    const line = c.addLine();
    const compared = c.compare('B', { mode: 'pane' });
    await compared.ready;
    const disposeLine = vi.spyOn(line, 'dispose');
    const disposeCompared = vi.spyOn(compared.series, 'dispose');
    c.destroy();
    c.removeSeries(line);
    compared.remove();
    expect(disposeLine).toHaveBeenCalledTimes(1);
    expect(disposeCompared).toHaveBeenCalledTimes(1);
  });

  it('rejects a setSymbol in flight at destroy and pages in no history for it', async () => {
    const { c } = chart();
    c.applyOptions({ keepRangeOnIntervalChange: true });
    const { source: s, release, history } = source('5m', false);
    c.setDataSource(s);
    await c.setSymbol('A', '1m');
    const load = c.setSymbol('A', '5m');
    const settled = load.catch((error: unknown) => error);
    await vi.waitFor(() => expect(history).toHaveBeenCalledTimes(2));
    c.destroy();
    release();
    const error = await settled;
    expect(error).toBeInstanceOf(ChartError);
    expect((error as ChartError).code).toBe('destroyed');
    expect(history).toHaveBeenCalledTimes(2);
  });

  it('ignores view changes and options', () => {
    const { c, raf } = chart();
    const before = c.getVisibleRange();
    const spacing = c.options.barSpacing;
    c.destroy();
    c.scrollToRealtime();
    expect(c.fitContent()).toBe(false);
    expect(c.setVisibleTimeRange(0, 60)).toBe(false);
    c.resetView();
    c.applyOptions({ barSpacing: spacing + 5 });
    expect(c.options.barSpacing).toBe(spacing);
    expect(c.getVisibleRange()).toEqual(before);
    expect(raf).not.toHaveBeenCalled();
  });
});
