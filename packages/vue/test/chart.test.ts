// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h, isProxy, KeepAlive, nextTick, onWatcherCleanup, shallowRef, watch } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMockDataSource, Chart as CoreChart, type Chart as ChartInstance } from '@charton/core';
import { Chart, useChart, type ChartExposed, type ChartProps } from '../src/index';
import { plainCopy, sameValue } from '../src/sync';
import { installBrowser, type Browser } from './browser';
import { render } from './render';

let browser: Browser;
beforeEach(() => (browser = installBrowser()));
afterEach(() => browser.restore());

/** Mount a `<Chart>` with reactive props. */
function chart(props: ChartProps & Record<string, unknown> = {}, children?: () => ReturnType<typeof h>) {
  return render<ChartProps & Record<string, unknown>, ChartExposed>(Chart, props, children);
}

/** The chart the template ref reaches now. */
function current(refs: (ChartExposed | null)[]): ChartInstance {
  return refs.at(-1)!.chart!;
}

describe('<Chart>', () => {
  it('creates one chart on mount and hands it to the template ref and to useChart', async () => {
    let seen: ChartInstance | null = null;
    const Probe = defineComponent(() => {
      const shared = useChart();
      return () => ((seen = shared.value), null);
    });
    const view = chart({ style: { height: '300px' }, class: 'price' }, () => h(Probe));
    await view.flush();
    expect(browser.created).toBe(1);
    const instance = current(view.refs);
    expect(instance).toBeInstanceOf(CoreChart);
    expect(isProxy(instance)).toBe(false);
    expect(seen).toBe(instance);
    // Attributes go to the container, and the chart's own element sits inside it.
    const root = view.container.firstElementChild as HTMLElement;
    expect(root.className).toBe('price');
    expect(root.style.height).toBe('300px');
    expect(root.querySelector('canvas')).not.toBeNull();
    view.unmount();
  });

  it('applies changed options in place, and skips options equal to the last ones', async () => {
    const view = chart({ options: { barSpacing: 8 } });
    const instance = current(view.refs);
    expect(instance.options.barSpacing).toBe(8);
    const apply = vi.spyOn(instance, 'applyOptions');

    view.props.options = { barSpacing: 8 };
    await view.flush();
    expect(apply).not.toHaveBeenCalled();

    view.props.options = { barSpacing: 12 };
    await view.flush();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ barSpacing: 12 });
    expect(instance.options.barSpacing).toBe(12);

    // A change inside the reactive options object applies too, as a plain object.
    view.props.options!.barSpacing = 16;
    await view.flush();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(isProxy(apply.mock.calls[1]![0])).toBe(false);
    expect(instance.options.barSpacing).toBe(16);

    expect(view.refs.filter(Boolean).every((r) => r!.chart === instance)).toBe(true);
    expect(browser.created).toBe(1);
    view.unmount();
  });

  it('loads the symbol from the data source and reloads only on a change', async () => {
    const dataSource = createMockDataSource();
    const attach = vi.spyOn(CoreChart.prototype, 'setDataSource');
    const view = chart({ dataSource, symbol: 'DEMO', interval: '1h' });
    const instance = current(view.refs);
    // The source reaches the chart unwrapped, although the props hold it in a reactive object.
    expect(attach).toHaveBeenCalledWith(dataSource);
    attach.mockRestore();
    await vi.waitFor(() => expect(instance.data?.symbol?.symbol).toBe('DEMO'));
    const setSymbol = vi.spyOn(instance, 'setSymbol');
    const setDataSource = vi.spyOn(instance, 'setDataSource');

    view.props.symbol = 'DEMO';
    await view.flush();
    expect(setSymbol).not.toHaveBeenCalled();

    view.props.interval = '15m';
    await view.flush();
    expect(setSymbol).toHaveBeenCalledWith('DEMO', '15m');
    expect(setDataSource).not.toHaveBeenCalled();

    const other = createMockDataSource();
    view.props.dataSource = other;
    await view.flush();
    expect(setDataSource).toHaveBeenCalledWith(other);
    expect(setSymbol).toHaveBeenCalledTimes(2);
    expect(browser.created).toBe(1);
    view.unmount();
  });

  it('warns once instead of throwing when the chart has no dataSource() plugin', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // An explicit plugin list replaces the test setup's builtins().
    const view = chart({ options: { plugins: [] }, dataSource: createMockDataSource(), symbol: 'DEMO', interval: '1h' });
    const instance = current(view.refs);
    expect(instance.data).toBeNull();
    view.props.dataSource = createMockDataSource();
    await view.flush();
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

  it('copies the options only when something inside them changed', async () => {
    let reads = 0;
    const view = chart({
      options: {
        get barSpacing() {
          reads++;
          return 8;
        },
      },
      symbol: 'A',
    });
    const before = reads;
    view.props.symbol = 'B';
    view.props.interval = '1h';
    await view.flush();
    expect(reads).toBe(before);
    view.unmount();
  });

  it('keeps the data source when the prop is left out, and detaches it on null', async () => {
    const view = chart({ dataSource: createMockDataSource() });
    const setDataSource = vi.spyOn(current(view.refs), 'setDataSource');
    view.props.dataSource = undefined;
    await view.flush();
    expect(setDataSource).not.toHaveBeenCalled();
    view.props.dataSource = null;
    await view.flush();
    expect(setDataSource).toHaveBeenCalledWith(null);
    // Detached stays detached: other changes do not detach it again.
    view.props.symbol = 'OTHER';
    view.props.options = { barSpacing: 10 };
    await view.flush();
    expect(setDataSource).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('still loads a new symbol from the source after the source prop is left out', async () => {
    const view = chart({ dataSource: createMockDataSource(), symbol: 'DEMO', interval: '1h' });
    const setSymbol = vi.spyOn(current(view.refs), 'setSymbol');
    view.props.dataSource = undefined;
    await view.flush();
    view.props.symbol = 'OTHER';
    await view.flush();
    expect(setSymbol).toHaveBeenCalledWith('OTHER', '1h');
    view.unmount();
  });

  it('measures again when a kept-alive branch is shown, and draws nothing while it is hidden', async () => {
    // The container has a size only while it is in the page, as in a browser.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const size = this.isConnected ? { width: 400, height: 300 } : { width: 0, height: 0 };
      return { ...size, x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height, toJSON() {} } as DOMRect;
    });
    const shown = shallowRef(true);
    const refs: (ChartExposed | null)[] = [];
    const Other = defineComponent(() => () => h('p', 'other'));
    const view = render<object, never>(
      defineComponent(() => () => h(KeepAlive, null, [shown.value ? h(Chart, { options: { renderStats: true }, ref: (r: unknown) => void refs.push(r as ChartExposed | null) }) : h(Other)])),
      {},
    );
    const instance = current(refs);
    instance.resize();
    const sizes: string[] = [];
    instance.on('chart:resize', ({ width, height }) => void sizes.push(`${width}x${height}`));
    const drawn = vi.fn();
    instance.on('frame:render', drawn);

    shown.value = false;
    await view.flush();
    instance.invalidate();
    browser.runFrames();
    expect(drawn).not.toHaveBeenCalled();

    shown.value = true;
    await view.flush();
    expect(current(refs)).toBe(instance);
    expect(sizes).toEqual(['0x0', '400x300']);
    instance.invalidate();
    browser.runFrames();
    expect(drawn).toHaveBeenCalled();
    view.unmount();
    expect(browser.live).toBe(0);
  });

  it('forwards events to the newest callback without subscribing again', async () => {
    const first = vi.fn();
    const view = chart({ on: { 'symbol:change': first } });
    const instance = current(view.refs);
    const on = vi.spyOn(instance, 'on');

    const second = vi.fn();
    view.props.on = { 'symbol:change': second };
    await view.flush();
    instance.emit('symbol:change', { symbol: 'A', previous: null });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ symbol: 'A', previous: null });
    expect(on).not.toHaveBeenCalled();

    // A handler that goes away stops receiving events.
    view.props.on = {};
    await view.flush();
    instance.emit('symbol:change', { symbol: 'B', previous: 'A' });
    expect(second).toHaveBeenCalledTimes(1);

    // One added to the reactive object later is subscribed.
    const third = vi.fn();
    view.props.on!['symbol:change'] = third;
    await view.flush();
    instance.emit('symbol:change', { symbol: 'C', previous: 'B' });
    expect(third).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('destroys the chart on unmount and clears the template ref', async () => {
    const view = chart();
    const destroy = vi.spyOn(current(view.refs), 'destroy');
    view.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(view.refs.at(-1)).toBeNull();
    expect(browser.live).toBe(0);
    expect(view.container.querySelector('canvas')).toBeNull();
  });

  it('gives slot content the chart once it exists, and a live chart to clean up with', async () => {
    const charts: (ChartInstance | null)[] = [];
    const order: string[] = [];
    const AddSeries = defineComponent(() => {
      const shared = useChart();
      watch(
        shared,
        (value) => {
          charts.push(value);
          if (!value) return;
          const series = value.addLine();
          onWatcherCleanup(() => {
            order.push('clean-up');
            value.removeSeries(series);
          });
        },
        { immediate: true },
      );
      return () => null;
    });
    const view = chart({}, () => h(AddSeries));
    await nextTick();
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

  it('hydrates server HTML without mismatches and creates the chart afterwards', async () => {
    const tree = (refs: (ChartExposed | null)[]) =>
      defineComponent(() => () => h(Chart, { class: 'chart', style: { height: '300px' }, ref: (r: unknown) => void refs.push(r as ChartExposed | null) }, { default: () => h('span', 'legend') }));
    const html = await renderToString(createSSRApp(tree([])));
    expect(browser.created).toBe(0);

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const refs: (ChartExposed | null)[] = [];
    const app = createSSRApp(tree(refs));
    const warnings = vi.fn();
    app.config.warnHandler = warnings;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    app.mount(container);
    expect(warnings).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(browser.created).toBe(1);
    expect(current(refs)).toBeInstanceOf(CoreChart);
    expect(container.querySelector('span')!.textContent).toBe('legend');
    app.unmount();
    container.remove();
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
    // The cycle points at the copy, never back into the original.
    expect(copy.loop.self).toBe(copy.loop);
    expect(sameValue(copy, plainCopy({ loop }))).toBe(true);
    const other: Record<string, unknown> = { a: 1 };
    other.self = other;
    expect(sameValue(loop, other)).toBe(true);
    const different: Record<string, unknown> = { a: 2 };
    different.self = different;
    expect(sameValue(loop, different)).toBe(false);
    expect(sameValue(loop, { a: 1, self: { a: 1, self: null } })).toBe(false);
  });
});
