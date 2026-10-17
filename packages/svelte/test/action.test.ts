// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDataSource, Chart as CoreChart, type Chart } from '@charton/core';
import type { ChartActionParameters } from '@charton/svelte';
import { installBrowser, type Browser } from './browser';
import { render } from './render.svelte';
import ActionHost from './fixtures/ActionHost.svelte';

let browser: Browser;
beforeEach(() => (browser = installBrowser()));
afterEach(() => browser.restore());

function action(parameters: ChartActionParameters) {
  const refs: (Chart | null)[] = [];
  const view = render(ActionHost, { parameters: { ref: (chart: Chart | null) => void refs.push(chart), ...parameters }, shown: true });
  return { ...view, refs };
}

describe('use:chart', () => {
  it('creates the chart in the element, hearing the first load, and hands it to ref', () => {
    const changed = vi.fn();
    const view = action({ options: { barSpacing: 8 }, dataSource: createMockDataSource(), symbol: 'DEMO', interval: '1h', on: { 'symbol:change': changed } });
    const instance = view.refs.at(-1)!;
    expect(instance).toBeInstanceOf(CoreChart);
    expect(instance.options.barSpacing).toBe(8);
    expect(view.container.querySelector('.plain canvas')).not.toBeNull();
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'DEMO', previous: null }));
    view.unmount();
  });

  it('applies changed parameters in place and skips equal ones', () => {
    const ref = (chart: Chart | null) => void refs.push(chart);
    const refs: (Chart | null)[] = [];
    const view = render(ActionHost, { parameters: { ref, options: { barSpacing: 8 } } as ChartActionParameters, shown: true });
    const instance = refs.at(-1)!;
    const apply = vi.spyOn(instance, 'applyOptions');
    view.props.parameters = { ref, options: { barSpacing: 8 } };
    view.flush();
    expect(apply).not.toHaveBeenCalled();
    view.props.parameters = { ref, options: { barSpacing: 12 } };
    view.flush();
    expect(apply).toHaveBeenCalledWith({ barSpacing: 12 });
    expect(refs).toEqual([instance]);
    expect(browser.created).toBe(1);
    view.unmount();
  });

  it('moves the chart to a new ref, and tells only the current one when it is destroyed', () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(ActionHost, { parameters: { ref: first } as ChartActionParameters, shown: true });
    const instance = first.mock.calls[0]![0] as Chart;
    view.props.parameters = { ref: second };
    view.flush();
    expect(first).toHaveBeenLastCalledWith(null);
    expect(second).toHaveBeenLastCalledWith(instance);
    view.props.shown = false;
    view.flush();
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenLastCalledWith(null);
    view.unmount();
  });

  it('destroys the chart when the element goes away and tells ref', () => {
    const view = action({});
    const instance = view.refs.at(-1)!;
    const destroy = vi.spyOn(instance, 'destroy');
    view.props.shown = false;
    view.flush();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(view.refs.at(-1)).toBeNull();
    expect(browser.live).toBe(0);
    view.unmount();
  });
});
