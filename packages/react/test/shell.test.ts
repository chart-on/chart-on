// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, StrictMode, type ReactElement } from 'react';
import { createMockDataSource } from '@charton/core';
import type { ChartShell as ShellInstance } from '@charton/ui';
import { useChart } from '@charton/react';
import { ChartShell, useChartShell, type ChartShellProps } from '@charton/react/shell';
import { installBrowser, type Browser } from './browser';
import { render } from './render';

let browser: Browser;
beforeEach(() => (browser = installBrowser()));
afterEach(() => browser.restore());

function shell(props: ChartShellProps, refs: (ShellInstance | null)[] = []): ReactElement {
  return createElement(ChartShell, { ...props, ref: (value: ShellInstance | null) => void refs.push(value) });
}

describe('<ChartShell>', () => {
  it('creates one shell on mount and hands it and its chart to the ref and hooks', async () => {
    const refs: (ShellInstance | null)[] = [];
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useChartShell(), useChart());
      return null;
    }
    const view = await render(
      createElement(ChartShell, { ref: (s: ShellInstance | null) => void refs.push(s), theme: 'light' }, createElement(Probe)),
    );
    const instance = refs.at(-1)!;
    expect(instance.resolvedTheme).toBe('light');
    expect(seen.slice(-2)).toEqual([instance, instance.chart]);
    expect(browser.created).toBe(1);
    await view.unmount();
  });

  it('changes theme, palette, features and chart options in place', async () => {
    const refs: (ShellInstance | null)[] = [];
    const view = await render(shell({ theme: 'dark', features: { toolbar: true } }, refs));
    const instance = refs.at(-1)!;
    const chart = instance.chart;
    const setTheme = vi.spyOn(instance, 'setTheme');
    const applyFeatures = vi.spyOn(instance, 'applyFeatures');

    // Equal values apply nothing.
    await view.rerender(shell({ theme: 'dark', features: { toolbar: true } }, refs));
    expect(setTheme).not.toHaveBeenCalled();
    expect(applyFeatures).not.toHaveBeenCalled();

    await view.rerender(shell({ theme: 'light', palette: 'color-safe', features: { toolbar: false }, options: { barSpacing: 14 } }, refs));
    expect(setTheme).toHaveBeenCalledWith('light');
    expect(applyFeatures).toHaveBeenCalledWith({ toolbar: false });
    expect(instance.palette).toBe('color-safe');
    expect(instance.features.toolbar).toBe(false);
    expect(instance.chart).toBe(chart);
    expect(chart.options.barSpacing).toBe(14);
    expect(browser.created).toBe(1);
    await view.unmount();
  });

  it('hears the chart events the first load emits while mounting', async () => {
    const changed = vi.fn();
    const view = await render(shell({ dataSource: createMockDataSource(), symbol: 'DEMO', interval: '1h', on: { 'symbol:change': changed } }));
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'DEMO', previous: null }));
    await view.unmount();
  });

  it('forwards shell events to the newest callback', async () => {
    const refs: (ShellInstance | null)[] = [];
    const first = vi.fn();
    const view = await render(shell({ shellOn: { 'theme:change': first } }, refs));
    const second = vi.fn();
    await view.rerender(shell({ shellOn: { 'theme:change': second } }, refs));
    refs.at(-1)!.setTheme('light');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light', resolved: 'light' }));
    await view.unmount();
  });

  it('destroys the shell on unmount and after development double mounting', async () => {
    const refs: (ShellInstance | null)[] = [];
    const view = await render(createElement(StrictMode, null, shell({}, refs)));
    expect(browser.created).toBe(2);
    expect(browser.live).toBe(1);
    const destroy = vi.spyOn(refs.at(-1)!, 'destroy');
    await view.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(refs.at(-1)).toBeNull();
    expect(browser.live).toBe(0);
  });
});
