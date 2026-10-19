// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDataSource, type Chart } from '@chart-on/core';
import type { ChartShell as ShellInstance } from '@chart-on/ui';
import type { ChartShellProps } from '@chart-on/svelte/shell';
import { installBrowser, type Browser } from './browser';
import { render } from './render.svelte';
import Probe from './fixtures/Probe.svelte';
import ShellHost from './fixtures/ShellHost.svelte';

let browser: Browser;
beforeEach(() => (browser = installBrowser()));
afterEach(() => browser.restore());

/** Mount `<ChartShell>` inside a host that records every value `bind:shell` and `bind:chart` take. */
function shell(props: ChartShellProps & Record<string, unknown> = {}) {
  const refs: { shell: ShellInstance | null; chart: Chart | null }[] = [];
  // Every prop a test assigns later must exist from the start.
  const unset = { options: undefined, theme: undefined, palette: undefined, features: undefined, shellOn: undefined };
  const view = render(ShellHost, { ...unset, record: (s: ShellInstance | null, c: Chart | null) => void refs.push({ shell: s, chart: c }), ...props });
  return { ...view, refs, current: () => refs.at(-1)!.shell! };
}

describe('<ChartShell>', () => {
  it('creates one shell on mount and hands it and its chart to the bindings and context helpers', () => {
    const seen: unknown[] = [];
    const view = shell({ theme: 'light', Child: Probe, childProps: { shell: true, record: (...values: unknown[]) => void seen.push(values) } });
    const instance = view.current();
    expect(instance.resolvedTheme).toBe('light');
    expect(view.refs.at(-1)!.chart).toBe(instance.chart);
    expect(seen[0]).toEqual([null, null]);
    expect(seen.at(-1)).toEqual([instance, instance.chart]);
    expect(browser.created).toBe(1);
    view.unmount();
  });

  it('changes theme, palette, features and chart options in place', () => {
    const view = shell({ theme: 'dark', features: { toolbar: true } });
    const instance = view.current();
    const chart = instance.chart;
    const setTheme = vi.spyOn(instance, 'setTheme');
    const applyFeatures = vi.spyOn(instance, 'applyFeatures');

    // Equal values apply nothing, and neither does the first run after mounting.
    view.props.theme = 'dark';
    view.props.features = { toolbar: true };
    view.flush();
    expect(setTheme).not.toHaveBeenCalled();
    expect(applyFeatures).not.toHaveBeenCalled();

    Object.assign(view.props, { theme: 'light', palette: 'color-safe', features: { toolbar: false }, options: { barSpacing: 14 } });
    view.flush();
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

  it('leaves the theme as it is when the prop is left out, and applies it again when set again', () => {
    const view = shell({ theme: 'light' });
    const instance = view.current();
    const setTheme = vi.spyOn(instance, 'setTheme');
    view.props.theme = undefined;
    view.flush();
    expect(setTheme).not.toHaveBeenCalled();
    expect(instance.resolvedTheme).toBe('light');
    // Meanwhile the user picks another theme in the shell; setting the prop again wins.
    instance.setTheme('dark');
    view.props.theme = 'light';
    view.flush();
    expect(setTheme).toHaveBeenLastCalledWith('light');
    expect(instance.resolvedTheme).toBe('light');
    view.unmount();
  });

  it('forwards shell events to the newest callback', () => {
    const first = vi.fn();
    const view = shell({ shellOn: { 'theme:change': first } });
    const second = vi.fn();
    view.props.shellOn = { 'theme:change': second };
    view.flush();
    view.current().setTheme('light');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light', resolved: 'light' }));
    view.unmount();
  });

  it('destroys the shell on unmount', () => {
    const view = shell();
    const destroy = vi.spyOn(view.current(), 'destroy');
    view.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
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
