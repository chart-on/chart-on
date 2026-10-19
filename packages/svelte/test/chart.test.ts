// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDataSource, Chart as CoreChart, type Chart as ChartInstance } from '@chart-on/core';
import { Chart, type ChartProps } from '@chart-on/svelte';
import { plainCopy, sameValue } from '../src/sync';
import { installBrowser, type Browser } from './browser';
import { deep, render } from './render.svelte';
import AddSeries from './fixtures/AddSeries.svelte';
import Host from './fixtures/Host.svelte';
import Probe from './fixtures/Probe.svelte';

let browser: Browser;
beforeEach(() => (browser = installBrowser()));
afterEach(() => browser.restore());

type HostProps = ChartProps & Record<string, unknown>;

/** Mount `<Chart>` inside a host that records every value `bind:chart` takes. */
function chart(props: HostProps = {}) {
  const refs: (ChartInstance | null)[] = [];
  // Every prop a test assigns later must exist from the start.
  const unset = { options: undefined, dataSource: undefined, symbol: undefined, interval: undefined, on: undefined };
  const view = render(Host, { ...unset, record: (value: ChartInstance | null) => void refs.push(value), ...props });
  return { ...view, refs };
}

describe('<Chart>', () => {
  it('creates one chart on mount and hands it to bind:chart and to useChart', () => {
    const seen: unknown[] = [];
    const view = chart({ style: 'height: 300px', class: 'price', Child: Probe, childProps: { record: (value: unknown) => void seen.push(value) } });
    expect(browser.created).toBe(1);
    const instance = view.refs.at(-1)!;
    expect(instance).toBeInstanceOf(CoreChart);
    expect(seen[0]).toBeNull();
    expect(seen.at(-1)).toBe(instance);
    // Attributes go to the container, and the chart's own element sits inside it.
    const root = view.container.firstElementChild as HTMLElement;
    expect(root.className).toBe('price');
    expect(root.style.height).toBe('300px');
    expect(root.querySelector('canvas')).not.toBeNull();
    expect(root.querySelector('span')!.textContent).toBe('legend');
    view.unmount();
  });

  it('applies changed options in place, and skips options equal to the last ones', () => {
    const view = chart({ options: { barSpacing: 8 } });
    const instance = view.refs.at(-1)!;
    expect(instance.options.barSpacing).toBe(8);
    const apply = vi.spyOn(instance, 'applyOptions');

    view.props.options = { barSpacing: 8 };
    view.flush();
    expect(apply).not.toHaveBeenCalled();

    view.props.options = { barSpacing: 12 };
    view.flush();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ barSpacing: 12 });
    expect(instance.options.barSpacing).toBe(12);

    // A change inside a deep state object applies too, as a plain object.
    const options = deep({ barSpacing: 14 });
    view.props.options = options;
    view.flush();
    options.barSpacing = 16;
    view.flush();
    expect(apply).toHaveBeenCalledTimes(3);
    expect(apply.mock.calls[2]![0]).toEqual({ barSpacing: 16 });
    expect(apply.mock.calls[2]![0]).not.toBe(options);
    expect(instance.options.barSpacing).toBe(16);

    expect(view.refs.every((r) => r === instance)).toBe(true);
    expect(browser.created).toBe(1);
    view.unmount();
  });

  it('loads the symbol from the data source and reloads only on a change', async () => {
    const dataSource = createMockDataSource();
    const attach = vi.spyOn(CoreChart.prototype, 'setDataSource');
    const view = chart({ dataSource, symbol: 'DEMO', interval: '1h' });
    const instance = view.refs.at(-1)!;
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0]![0]).toBe(dataSource);
    attach.mockRestore();
    await vi.waitFor(() => expect(instance.data?.symbol?.symbol).toBe('DEMO'));
    const setSymbol = vi.spyOn(instance, 'setSymbol');
    const setDataSource = vi.spyOn(instance, 'setDataSource');

    view.props.symbol = 'DEMO';
    view.flush();
    expect(setSymbol).not.toHaveBeenCalled();

    view.props.interval = '15m';
    view.flush();
    expect(setSymbol).toHaveBeenCalledWith('DEMO', '15m');
    expect(setDataSource).not.toHaveBeenCalled();

    const other = createMockDataSource();
    view.props.dataSource = other;
    view.flush();
    expect(setDataSource).toHaveBeenCalledWith(other);
    expect(setSymbol).toHaveBeenCalledTimes(2);
    expect(browser.created).toBe(1);
    view.unmount();
  });

  it('warns once instead of throwing when the chart has no dataSource() plugin', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // An explicit plugin list replaces the test setup's builtins().
    const view = chart({ options: { plugins: [] }, dataSource: createMockDataSource(), symbol: 'DEMO', interval: '1h' });
    const instance = view.refs.at(-1)!;
    expect(instance.data).toBeNull();
    view.props.dataSource = createMockDataSource();
    view.flush();
    const calls = warn.mock.calls.filter(([m]) => String(m).includes('[data-source-missing]'));
    expect(calls).toHaveLength(1);
    expect(String(calls[0]![0])).toContain('dataSource()');
    expect(instance.data).toBeNull();
    expect(browser.created).toBe(1);
    view.unmount();
    warn.mockRestore();
  });

  it('hears the events the first load emits while mounting', () => {
    const changed = vi.fn();
    const view = chart({ dataSource: createMockDataSource(), symbol: 'DEMO', interval: '1h', on: { 'symbol:change': changed } });
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'DEMO', previous: null }));
    view.unmount();
  });

  it('copies the options only when something inside them changed', () => {
    let reads = 0;
    // No prototype, so state never wraps it and every copy runs the getter.
    const options = Object.create(null, {
      barSpacing: {
        enumerable: true,
        get() {
          reads++;
          return 8;
        },
      },
    });
    const view = chart({ options, symbol: 'A' });
    const before = reads;
    view.props.symbol = 'B';
    view.props.interval = '1h';
    view.flush();
    expect(reads).toBe(before);
    view.unmount();
  });

  it('keeps the data source when the prop is left out, and detaches it on null', () => {
    const view = chart({ dataSource: createMockDataSource() });
    const setDataSource = vi.spyOn(view.refs.at(-1)!, 'setDataSource');
    view.props.dataSource = undefined;
    view.flush();
    expect(setDataSource).not.toHaveBeenCalled();
    view.props.dataSource = null;
    view.flush();
    expect(setDataSource).toHaveBeenCalledWith(null);
    // Detached stays detached: other changes do not detach it again.
    view.props.symbol = 'OTHER';
    view.props.options = { barSpacing: 10 };
    view.flush();
    expect(setDataSource).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('still loads a new symbol from the source after the source prop is left out', () => {
    const dataSource = createMockDataSource();
    const view = chart({ dataSource, symbol: 'DEMO', interval: '1h' });
    const setSymbol = vi.spyOn(view.refs.at(-1)!, 'setSymbol');
    view.props.dataSource = undefined;
    view.flush();
    view.props.symbol = 'OTHER';
    view.flush();
    expect(setSymbol).toHaveBeenCalledWith('OTHER', '1h');
    view.unmount();
  });

  it('loads from a source the app keeps in deep state, through its proxy', async () => {
    const view = chart({ dataSource: deep(createMockDataSource()), symbol: 'DEMO', interval: '1h' });
    const instance = view.refs.at(-1)!;
    await vi.waitFor(() => expect(instance.data?.symbol?.symbol).toBe('DEMO'));
    view.unmount();
  });

  it('forwards events to the newest callback without subscribing again', () => {
    const first = vi.fn();
    const view = chart({ on: { 'symbol:change': first } });
    const instance = view.refs.at(-1)!;
    const on = vi.spyOn(instance, 'on');

    const second = vi.fn();
    view.props.on = { 'symbol:change': second };
    view.flush();
    instance.emit('symbol:change', { symbol: 'A', previous: null });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ symbol: 'A', previous: null });
    expect(on).not.toHaveBeenCalled();

    // A handler that goes away stops receiving events.
    const handlers = deep<ChartProps['on'] & object>({});
    view.props.on = handlers;
    view.flush();
    instance.emit('symbol:change', { symbol: 'B', previous: 'A' });
    expect(second).toHaveBeenCalledTimes(1);

    // One added to a deep state object later is subscribed.
    const third = vi.fn();
    handlers['symbol:change'] = third;
    view.flush();
    instance.emit('symbol:change', { symbol: 'C', previous: 'B' });
    expect(third).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('destroys the chart on unmount', () => {
    const view = chart();
    const destroy = vi.spyOn(view.refs.at(-1)!, 'destroy');
    view.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(browser.live).toBe(0);
    expect(view.container.querySelector('canvas')).toBeNull();
  });

  it('gives children the chart once it exists, and a live chart to clean up with', () => {
    const charts: (ChartInstance | null)[] = [];
    const order: string[] = [];
    const view = chart({ Child: AddSeries, childProps: { charts, order } });
    expect(charts[0]).toBeNull();
    expect(charts.at(-1)).toBeInstanceOf(CoreChart);
    vi.spyOn(charts.at(-1)!, 'destroy').mockImplementation(function (this: ChartInstance) {
      order.push('destroy');
      return CoreChart.prototype.destroy.call(this);
    });
    view.unmount();
    expect(order).toEqual(['clean-up', 'destroy']);
    expect(browser.live).toBe(0);
  });

  it('mounts without a host component, straight from the package', () => {
    const view = render(Chart, { class: 'bare', options: { barSpacing: 9 } });
    expect(browser.created).toBe(1);
    expect((view.container.firstElementChild as HTMLElement).className).toBe('bare');
    view.unmount();
    expect(browser.live).toBe(0);
  });

  it('leaves nothing behind after 100 mounts and unmounts', () => {
    for (let i = 0; i < 100; i++) chart().unmount();
    browser.runFrames();
    expect(browser.created).toBe(100);
    expect(browser.live).toBe(0);
    expect(browser.frames).toBe(0);
  });
});

describe('plain copies and comparison', () => {
  it('keep cycles inside the copy, and compare them by shape', () => {
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    const copy = plainCopy({ loop });
    expect(copy.loop).not.toBe(loop);
    // The cycle points at the copy, never back into the original (which may be a state proxy).
    expect(copy.loop.self).toBe(copy.loop);
    expect(sameValue(copy, plainCopy({ loop }))).toBe(true);
    const other: Record<string, unknown> = { a: 1 };
    other.self = other;
    expect(sameValue(loop, other)).toBe(true);
    const different: Record<string, unknown> = { a: 2 };
    different.self = different;
    expect(sameValue(loop, different)).toBe(false);
    // A cycle on one side only is not equal to a chain that ends.
    expect(sameValue(loop, { a: 1, self: { a: 1, self: null } })).toBe(false);
  });
});
