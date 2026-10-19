// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, isProxy } from 'vue';
import { createMockDataSource } from '@chart-on/core';
import { useChart } from '@chart-on/vue';
import { ChartShell, useChartShell, type ChartShellExposed, type ChartShellProps } from '@chart-on/vue/shell';
import { installBrowser, type Browser } from './browser';
import { render } from './render';

let browser: Browser;
beforeEach(() => (browser = installBrowser()));
afterEach(() => browser.restore());

function shell(props: ChartShellProps = {}, children?: () => ReturnType<typeof h>) {
  return render<ChartShellProps, ChartShellExposed>(ChartShell, props, children);
}

describe('<ChartShell>', () => {
  it('creates one shell on mount and hands it and its chart to the template ref and composables', async () => {
    const seen: unknown[] = [];
    const Probe = defineComponent(() => {
      const shellRef = useChartShell();
      const chartRef = useChart();
      return () => (seen.push(shellRef.value, chartRef.value), null);
    });
    const view = shell({ theme: 'light' }, () => h(Probe));
    await view.flush();
    const exposed = view.refs.at(-1)!;
    const instance = exposed.shell!;
    expect(instance.resolvedTheme).toBe('light');
    expect(exposed.chart).toBe(instance.chart);
    expect(isProxy(instance)).toBe(false);
    expect(seen.slice(-2)).toEqual([instance, instance.chart]);
    expect(browser.created).toBe(1);
    view.unmount();
  });

  it('changes theme, palette, features and chart options in place', async () => {
    const view = shell({ theme: 'dark', features: { toolbar: true } });
    const instance = view.refs.at(-1)!.shell!;
    const chart = instance.chart;
    const setTheme = vi.spyOn(instance, 'setTheme');
    const applyFeatures = vi.spyOn(instance, 'applyFeatures');

    // Equal values apply nothing.
    view.props.theme = 'dark';
    view.props.features = { toolbar: true };
    await view.flush();
    expect(setTheme).not.toHaveBeenCalled();
    expect(applyFeatures).not.toHaveBeenCalled();

    Object.assign(view.props, { theme: 'light', palette: 'color-safe', features: { toolbar: false }, options: { barSpacing: 14 } });
    await view.flush();
    expect(setTheme).toHaveBeenCalledWith('light');
    expect(applyFeatures).toHaveBeenCalledWith({ toolbar: false });
    expect(instance.palette).toBe('color-safe');
    expect(instance.features.toolbar).toBe(false);
    expect(instance.chart).toBe(chart);
    expect(chart.options.barSpacing).toBe(14);
    expect(browser.created).toBe(1);
    view.unmount();
  });

  it('hears the chart events the first load emits while mounting', () => {
    const changed = vi.fn();
    const view = shell({ dataSource: createMockDataSource(), symbol: 'DEMO', interval: '1h', on: { 'symbol:change': changed } });
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'DEMO', previous: null }));
    view.unmount();
  });

  it('leaves the theme as it is when the prop is left out', async () => {
    const view = shell({ theme: 'light' });
    const instance = view.refs.at(-1)!.shell!;
    const setTheme = vi.spyOn(instance, 'setTheme');
    view.props.theme = undefined;
    await view.flush();
    expect(setTheme).not.toHaveBeenCalled();
    expect(instance.resolvedTheme).toBe('light');
    view.unmount();
  });

  it('forwards shell events to the newest callback', async () => {
    const first = vi.fn();
    const view = shell({ shellOn: { 'theme:change': first } });
    const second = vi.fn();
    view.props.shellOn = { 'theme:change': second };
    await view.flush();
    view.refs.at(-1)!.shell!.setTheme('light');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light', resolved: 'light' }));
    view.unmount();
  });

  it('destroys the shell on unmount and clears the template ref', () => {
    const view = shell();
    const destroy = vi.spyOn(view.refs.at(-1)!.shell!, 'destroy');
    view.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(view.refs.at(-1)).toBeNull();
    expect(browser.live).toBe(0);
  });

  // A leak shows up on every mount, so a handful of mounts finds it. Each shell builds a few
  // hundred elements, which the DOM test environment takes 70-160 ms to create, so 100 mounts
  // outran the test timeout. The fake-container lifecycle test in @chart-on/ui does the 100.
  it('leaves nothing behind after 10 mounts and unmounts', () => {
    for (let i = 0; i < 10; i++) shell().unmount();
    browser.runFrames();
    expect(browser.created).toBe(10);
    expect(browser.live).toBe(0);
    expect(browser.frames).toBe(0);
  });
});
