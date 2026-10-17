import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chart, type Bar, type CandleSeries } from '@charton/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { createChartShell } from '../src/shell';
import { createTableView, tableViewOf, tableViewToolbarItem } from '../src/table-view';

interface El {
  tagName: string;
  className: string;
  textContent: string;
  children: El[];
  parent: El | null;
  getAttribute(name: string): string | null;
  focus(): void;
}
const el = (node: unknown) => node as El;

const charts: Chart[] = [];
beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.useRealTimers();
});

/** Hourly bars closing 10, 11, … */
const hourly = (n: number): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ time: i * 3600, open: 10 + i, high: 10.5 + i, low: 9 + i, close: 10 + i, volume: 1000 }));

function setup() {
  const container = fakeContainer();
  const chart = new Chart(container, { timezone: 'UTC' });
  charts.push(chart);
  const series = chart.addCandles({ title: 'Demo' }) as CandleSeries;
  series.setData(hourly(20));
  frame(chart);
  return { chart, series };
}
const frame = (c: Chart) => {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(16);
};
const panelOf = (c: Chart) => el(c.root).children.find((n) => n.className === 'pc-table-view') ?? null;
const tableOf = (c: Chart) => panelOf(c)!.children[1]!.children[0]!;
const bodyRows = (c: Chart) => tableOf(c).children[2]!.children;

describe('table view', () => {
  it('opens a labelled panel with the visible rows and moves focus to the table', () => {
    const { chart } = setup();
    const changes: boolean[] = [];
    const view = createTableView(chart, { onOpenChange: (open) => changes.push(open) });
    view.open();

    const panel = panelOf(chart)!;
    expect(panel.getAttribute('role')).toBe('dialog');
    const heading = panel.children[0]!.children[0]!;
    expect(heading.tagName).toBe('h2');
    expect(heading.textContent).toBe('Data table');
    expect(panel.getAttribute('aria-labelledby')).toBe(heading.getAttribute('id'));

    const body = panel.children[1]!;
    expect(body.getAttribute('role')).toBe('region');
    expect(body.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(body);

    const [caption, thead] = tableOf(chart).children;
    expect(caption!.tagName).toBe('caption');
    expect(thead!.children[0]!.children.map((th) => th.textContent)).toEqual(chart.getDataTable().columns);
    expect(bodyRows(chart)).toHaveLength(chart.getDataTable().rows.length);
    expect(view.isOpen).toBe(true);
    expect(changes).toEqual([true]);
  });

  it('follows the view, replacing only the rows that changed', async () => {
    const { chart, series } = setup();
    const view = createTableView(chart);
    view.open();
    const before = [...bodyRows(chart)];

    series.update({ time: 19 * 3600, open: 29, high: 31, low: 28, close: 30.5, volume: 1000 });
    view.refresh();
    const after = bodyRows(chart);
    expect(after).toHaveLength(before.length);
    expect(after.slice(0, -1)).toEqual(before.slice(0, -1));
    expect(after.at(-1)).not.toBe(before.at(-1));
    expect(after.at(-1)!.children.map((c) => c.textContent)).toContain(series.format(30.5));

    // A pan or zoom rebuilds it, at most once per throttle window.
    chart.setVisibleTimeRange(5 * 3600, 9 * 3600, false);
    frame(chart);
    await vi.advanceTimersByTimeAsync(300);
    const range = chart.getVisibleRange()!;
    expect(bodyRows(chart).length).toBeLessThan(before.length);
    expect(bodyRows(chart)).toHaveLength(chart.getDataTable(range).rows.length);
    expect(bodyRows(chart)[0]!.children[0]!.textContent).toBe(chart.formatTime(chart.getDataTable(range).rows[0]![0]!));
  });

  it('keeps the newest maxRows rows', () => {
    const { chart } = setup();
    createTableView(chart, { maxRows: 3 }).open();
    expect(bodyRows(chart)).toHaveLength(3);
    expect(tableOf(chart).children[0]!.textContent).toContain('newest 3 of');
  });

  it('closes on Escape and on its close button, returning focus to the opener', () => {
    const { chart } = setup();
    const opener = el(document.createElement('button'));
    opener.focus();
    const view = createTableView(chart);
    view.open();
    dispatch(panelOf(chart)!.children[1], 'keydown', { key: 'Escape' });
    expect(panelOf(chart)).toBeNull();
    expect(view.isOpen).toBe(false);
    expect(document.activeElement).toBe(opener);

    opener.focus();
    view.open();
    const close = panelOf(chart)!.children[0]!.children[1]!;
    expect(close.getAttribute('aria-label')).toBe('Close');
    dispatch(close, 'click');
    expect(panelOf(chart)).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('stops following once closed', async () => {
    const { chart } = setup();
    const view = createTableView(chart);
    view.open();
    const spy = vi.spyOn(chart, 'describeTable');
    view.close();
    chart.setVisibleTimeRange(5 * 3600, 9 * 3600, false);
    frame(chart);
    await vi.advanceTimersByTimeAsync(300);
    expect(spy).not.toHaveBeenCalled();
  });

  it('is toggled by its toolbar item, which shows the open state', () => {
    const { chart } = setup();
    const item = tableViewToolbarItem();
    expect(item.type === 'button' && item.group).toBe('view');
    if (item.type !== 'button') throw new Error('expected a button');
    expect(item.isActive?.(chart)).toBe(false);
    const view = createTableView(chart);
    expect(tableViewOf(chart)).toBe(view);
    item.onClick(chart, document.createElement('button'));
    expect(item.isActive?.(chart)).toBe(true);
    item.onClick(chart, document.createElement('button'));
    expect(panelOf(chart)).toBeNull();
    view.destroy();
    expect(tableViewOf(chart)).toBeUndefined();
  });
});

describe('shell table view', () => {
  it('is on by default and can be turned off', () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    try {
      const on = createChartShell(fakeContainer(), { toolbar: [tableViewToolbarItem()], tableView: { maxRows: 2 } });
      expect(on.tableView).not.toBeNull();
      expect(tableViewOf(on.chart)).toBe(on.tableView);
      on.chart.addCandles().setData(hourly(5));
      on.tableView!.open();
      expect(bodyRows(on.chart)).toHaveLength(2);
      on.destroy();
      expect(tableViewOf(on.chart)).toBeUndefined();

      const off = createChartShell(fakeContainer(), { toolbar: [], tableView: false });
      expect(off.tableView).toBeNull();
      off.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
