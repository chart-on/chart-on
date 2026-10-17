// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, StrictMode, useEffect, type ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { createMockDataSource, Chart as CoreChart, type Chart as ChartInstance } from '@charton/core';
import { Chart, useChart, type ChartProps } from '../src/index';
import { installBrowser, type Browser } from './browser';
import { render } from './render';

let browser: Browser;
beforeEach(() => (browser = installBrowser()));
afterEach(() => browser.restore());

/** A `<Chart>` whose ref writes into `refs`, so tests can see every value the ref received. */
function chart(props: ChartProps, refs: (ChartInstance | null)[] = []): ReactElement {
  return createElement(Chart, { ...props, ref: (value: ChartInstance | null) => void refs.push(value) });
}

describe('<Chart>', () => {
  it('creates one chart on mount and hands it to the ref and to useChart', async () => {
    const refs: (ChartInstance | null)[] = [];
    let seen: ChartInstance | null = null;
    function Probe() {
      seen = useChart();
      return null;
    }
    const view = await render(createElement(Chart, { ref: (c: ChartInstance | null) => void refs.push(c), style: { height: 300 } }, createElement(Probe)));
    expect(browser.created).toBe(1);
    expect(refs.at(-1)).toBeInstanceOf(CoreChart);
    expect(seen).toBe(refs.at(-1));
    // The chart's own element sits inside the component's container.
    expect(view.container.firstElementChild!.querySelector('canvas')).not.toBeNull();
    await view.unmount();
  });

  it('applies changed options in place, and skips options equal to the last ones', async () => {
    const refs: (ChartInstance | null)[] = [];
    const view = await render(chart({ options: { barSpacing: 8 } }, refs));
    const instance = refs.at(-1)!;
    expect(instance.options.barSpacing).toBe(8);
    const apply = vi.spyOn(instance, 'applyOptions');

    await view.rerender(chart({ options: { barSpacing: 8 } }, refs));
    expect(apply).not.toHaveBeenCalled();

    await view.rerender(chart({ options: { barSpacing: 12 } }, refs));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ barSpacing: 12 });
    expect(instance.options.barSpacing).toBe(12);
    expect(refs.filter(Boolean).every((c) => c === instance)).toBe(true);
    expect(browser.created).toBe(1);
    await view.unmount();
  });

  it('loads the symbol from the data source and reloads only on a change', async () => {
    const refs: (ChartInstance | null)[] = [];
    const dataSource = createMockDataSource();
    const view = await render(chart({ dataSource, symbol: 'DEMO', interval: '1h' }, refs));
    const instance = refs.at(-1)!;
    expect(instance.data?.symbol?.symbol).toBe('DEMO');
    const setSymbol = vi.spyOn(instance, 'setSymbol');
    const setDataSource = vi.spyOn(instance, 'setDataSource');

    await view.rerender(chart({ dataSource, symbol: 'DEMO', interval: '1h' }, refs));
    expect(setSymbol).not.toHaveBeenCalled();

    await view.rerender(chart({ dataSource, symbol: 'DEMO', interval: '15m' }, refs));
    expect(setSymbol).toHaveBeenCalledWith('DEMO', '15m');
    expect(setDataSource).not.toHaveBeenCalled();

    const other = createMockDataSource();
    await view.rerender(chart({ dataSource: other, symbol: 'DEMO', interval: '15m' }, refs));
    expect(setDataSource).toHaveBeenCalledWith(other);
    expect(setSymbol).toHaveBeenCalledTimes(2);
    expect(browser.created).toBe(1);
    await view.unmount();
  });

  it('warns once instead of throwing when the chart has no dataSource() plugin', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refs: (ChartInstance | null)[] = [];
    // An explicit plugin list replaces the test setup's builtins().
    const props = { options: { plugins: [] }, symbol: 'DEMO', interval: '1h' } as const;
    const view = await render(chart({ ...props, dataSource: createMockDataSource() }, refs));
    const instance = refs.at(-1)!;
    expect(instance.data).toBeNull();
    await view.rerender(chart({ ...props, dataSource: createMockDataSource() }, refs));
    const calls = warn.mock.calls.filter(([m]) => String(m).includes('[data-source-missing]'));
    expect(calls).toHaveLength(1);
    expect(String(calls[0]![0])).toContain('dataSource()');
    expect(instance.data).toBeNull();
    expect(browser.created).toBe(1);
    await view.unmount();
    warn.mockRestore();
  });

  it('still loads a new symbol from the source after the source prop is left out', async () => {
    const refs: (ChartInstance | null)[] = [];
    const dataSource = createMockDataSource();
    const view = await render(chart({ dataSource, symbol: 'DEMO', interval: '1h' }, refs));
    const instance = refs.at(-1)!;
    const setSymbol = vi.spyOn(instance, 'setSymbol');
    const setDataSource = vi.spyOn(instance, 'setDataSource');
    await view.rerender(chart({ symbol: 'DEMO', interval: '1h' }, refs));
    await view.rerender(chart({ symbol: 'OTHER', interval: '1h' }, refs));
    expect(setSymbol).toHaveBeenCalledWith('OTHER', '1h');
    expect(setDataSource).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('detaches the source once on null, not again on later changes', async () => {
    const refs: (ChartInstance | null)[] = [];
    const view = await render(chart({ dataSource: createMockDataSource() }, refs));
    const setDataSource = vi.spyOn(refs.at(-1)!, 'setDataSource');
    await view.rerender(chart({ dataSource: null }, refs));
    await view.rerender(chart({ dataSource: null, symbol: 'OTHER', options: { barSpacing: 10 } }, refs));
    expect(setDataSource).toHaveBeenCalledTimes(1);
    expect(setDataSource).toHaveBeenCalledWith(null);
    await view.unmount();
  });

  it('hears the events the first load emits while mounting', async () => {
    const changed = vi.fn();
    const view = await render(chart({ dataSource: createMockDataSource(), symbol: 'DEMO', interval: '1h', on: { 'symbol:change': changed } }));
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'DEMO', previous: null }));
    await view.unmount();
  });

  it('forwards events to the newest callback without subscribing again', async () => {
    const refs: (ChartInstance | null)[] = [];
    const first = vi.fn();
    const view = await render(chart({ on: { 'symbol:change': first } }, refs));
    const instance = refs.at(-1)!;
    const on = vi.spyOn(instance, 'on');

    const second = vi.fn();
    await view.rerender(chart({ on: { 'symbol:change': second } }, refs));
    instance.emit('symbol:change', { symbol: 'A', previous: null });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ symbol: 'A', previous: null });
    expect(on).not.toHaveBeenCalled();

    // A handler that goes away stops receiving events.
    await view.rerender(chart({}, refs));
    instance.emit('symbol:change', { symbol: 'B', previous: 'A' });
    expect(second).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('destroys the chart on unmount and clears the ref', async () => {
    const refs: (ChartInstance | null)[] = [];
    const view = await render(chart({}, refs));
    const destroy = vi.spyOn(refs.at(-1)!, 'destroy');
    await view.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(refs.at(-1)).toBeNull();
    expect(browser.live).toBe(0);
    expect(view.container.querySelector('canvas')).toBeNull();
  });

  it('leaves one chart and one WebGL context after development double mounting', async () => {
    const refs: (ChartInstance | null)[] = [];
    const view = await render(createElement(StrictMode, null, chart({ options: { barSpacing: 9 } }, refs)));
    // Mounted, unmounted and mounted again: the first chart is gone.
    expect(browser.created).toBe(2);
    expect(browser.live).toBe(1);
    // Only the second chart's element is left in the container.
    expect(view.container.firstElementChild!.children).toHaveLength(1);
    const instance = refs.at(-1)!;
    expect(instance.options.barSpacing).toBe(9);
    await view.unmount();
    expect(browser.live).toBe(0);
  });

  it('gives children the chart once it exists', async () => {
    const charts: (ChartInstance | null)[] = [];
    function AddSeries() {
      const current = useChart();
      useEffect(() => {
        charts.push(current);
        if (!current) return;
        const series = current.addLine();
        return () => current.removeSeries(series);
      }, [current]);
      return null;
    }
    const view = await render(createElement(Chart, null, createElement(AddSeries)));
    expect(charts[0]).toBeNull();
    expect(charts.at(-1)).toBeInstanceOf(CoreChart);
    await view.unmount();
    expect(browser.live).toBe(0);
  });

  it('hydrates server HTML without mismatches and creates the chart afterwards', async () => {
    const refs: (ChartInstance | null)[] = [];
    const tree = () => createElement(Chart, { className: 'chart', style: { height: 300 } }, createElement('span', null, 'legend'));
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree());
    document.body.append(container);
    expect(browser.created).toBe(0);

    const errors = vi.fn();
    const root = await act(async () =>
      hydrateRoot(container, createElement(Chart, { className: 'chart', style: { height: 300 }, ref: (c: ChartInstance | null) => void refs.push(c) }, createElement('span', null, 'legend')), {
        onRecoverableError: errors,
      }),
    );
    expect(errors).not.toHaveBeenCalled();
    expect(browser.created).toBe(1);
    expect(refs.at(-1)).toBeInstanceOf(CoreChart);
    expect(container.querySelector('span')!.textContent).toBe('legend');
    await act(async () => root.unmount());
    container.remove();
    expect(browser.live).toBe(0);
  });

  it('leaves nothing behind after 100 mounts and unmounts', async () => {
    for (let i = 0; i < 100; i++) await (await render(chart({}))).unmount();
    browser.runFrames();
    expect(browser.created).toBe(100);
    expect(browser.live).toBe(0);
    expect(browser.frames).toBe(0);
  });
});
