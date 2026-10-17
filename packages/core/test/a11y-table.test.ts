import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.useRealTimers();
});

interface El {
  tagName: string;
  textContent: string;
  children: El[];
  dataset: Record<string, string>;
  getAttribute(name: string): string | null;
}
const el = (node: unknown) => node as El;
const announcements = (c: Chart) => el(c.root).children.find((n) => n.dataset.role === 'announcements')!;

/** Hourly bars closing 10, 11, …, with volume on every bar. */
const hourly = (n: number, from = 0): Bar[] =>
  Array.from({ length: n }, (_, k) => {
    const i = from + k;
    return { time: i * 3600, open: 10 + i, high: 10.5 + i, low: 9 + i, close: 10 + i, volume: 1000 * (i + 1) };
  });

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), { timezone: 'UTC', ...options });
  charts.push(c);
  return c;
}
const frame = (c: Chart) => {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(16);
};

describe('chart.describeTable', () => {
  it('holds the getDataTable rows, with times in the chart timezone and values in each series format', () => {
    const c = chart({ timezone: 'America/New_York' });
    c.addCandles({ title: 'Demo', priceFormat: { type: 'decimal', precision: 2 } }).setData(hourly(10));
    const line = c.addLine({ title: 'Avg', priceFormat: { type: 'decimal', precision: 3 } });
    line.setData(hourly(10).filter((_, i) => i % 2 === 0).map((b) => ({ time: b.time, value: b.close / 2 })));
    const range = { from: 2 * 3600, to: 6 * 3600 };

    const table = el(c.describeTable(range));
    const data = c.getDataTable(range);
    expect(table.tagName).toBe('table');
    const [caption, thead, tbody] = table.children;
    expect(caption!.tagName).toBe('caption');
    expect(caption!.textContent).toBe(`Demo, ${c.formatTime(2 * 3600)} to ${c.formatTime(6 * 3600)}`);
    expect(thead!.children[0]!.children.map((th) => th.textContent)).toEqual(data.columns);
    expect(thead!.children[0]!.children.every((th) => th.getAttribute('scope') === 'col')).toBe(true);

    const rows = tbody!.children;
    expect(rows).toHaveLength(data.rows.length);
    rows.forEach((tr, r) => {
      const [time, ...cells] = tr.children;
      expect(time!.tagName).toBe('th');
      expect(time!.getAttribute('scope')).toBe('row');
      expect(time!.textContent).toBe(c.formatTime(data.rows[r]![0]!));
    });
    // 02:00 UTC is 21:00 the day before in New York.
    expect(rows[0]!.children[0]!.textContent).toBe('1969-12-31 21:00');
    // open, high, low, close, volume, Avg: two-decimal prices, compact volume, the line's own three decimals.
    expect(rows[0]!.children.slice(1).map((td) => td.textContent)).toEqual(['12.00', '12.50', '11.00', '12.00', '3K', '6.000']);
    // The line has no point at 03:00: an empty cell.
    expect(rows[1]!.children[6]!.textContent).toBe('');
  });

  it('defaults to the visible range and keeps the newest rows with maxRows', () => {
    const c = chart();
    c.addCandles({ title: 'Demo' }).setData(hourly(40));
    c.setVisibleTimeRange(10 * 3600, 29 * 3600, false);
    const all = el(c.describeTable());
    expect(all.children[2]!.children).toHaveLength(c.getDataTable().rows.length);

    const some = el(c.describeTable({ maxRows: 5 }));
    const rows = some.children[2]!.children;
    expect(rows).toHaveLength(5);
    const times = c.getDataTable().rows.slice(-5).map((row) => c.formatTime(row[0]!));
    expect(rows.map((tr) => tr.children[0]!.textContent)).toEqual(times);
    expect(some.children[0]!.textContent).toMatch(new RegExp(`, newest 5 of ${c.getDataTable().rows.length} rows$`));
  });

  it('is an empty table with a caption that says so without data', () => {
    const table = el(chart().describeTable());
    expect(table.children[0]!.textContent).toBe('Chart, no data');
    expect(table.children[2]!.children).toHaveLength(0);
  });
});

describe('legend changeArrows', () => {
  it('puts an arrow before the change only when asked to', () => {
    const c = chart();
    c.addCandles({ title: 'Demo', priceFormat: { type: 'decimal', precision: 2 } }).setData([
      ...hourly(3),
      { time: 3 * 3600, open: 12, high: 13, low: 11, close: 11 },
      { time: 4 * 3600, open: 11, high: 12, low: 10, close: 11 },
    ]);
    const change = (time: number) => c.valuesAt(time)!.series[0]!.legend!.parts.at(-1)!.text;
    expect(change(2 * 3600)).toBe('+1.00 (+9.09%)');
    c.applyOptions({ legend: { changeArrows: true } });
    expect(change(2 * 3600)).toBe('▲ +1.00 (+9.09%)');
    expect(change(3 * 3600)).toBe('▼ -1.00 (-8.33%)');
    expect(change(4 * 3600)).toBe('+0.00 (+0.00%)');
  });
});

describe('announcements', () => {
  function live(options: ChartOptionsPatch['accessibility'] = {}) {
    const c = chart({ accessibility: { announceBars: true, ...options } });
    const main = c.addCandles({ title: 'Demo', animate: false, priceFormat: { type: 'decimal', precision: 2 } });
    main.setData(hourly(10));
    frame(c);
    return { c, main };
  }

  it('reads a new bar with the close and change of the bar it completed', () => {
    const { c, main } = live();
    expect(announcements(c).textContent).toBe('');
    main.update({ ...hourly(1, 10)[0]!, close: 21 });
    frame(c);
    expect(announcements(c).textContent).toBe('New bar 1970-01-01 10:00. Previous close 19.00, +1.00 (+5.56%).');
  });

  it('stays quiet when announceBars is off, for updates of the forming bar, new data and history', () => {
    const quiet = chart();
    quiet.addCandles({ title: 'Demo' }).setData(hourly(10));
    frame(quiet);
    quiet.main!.update(hourly(1, 10)[0]!);
    frame(quiet);
    expect(announcements(quiet).textContent).toBe('');

    const { c, main } = live();
    main.update({ ...hourly(1, 9)[0]!, close: 18 });
    frame(c);
    main.setData(hourly(10, 50));
    frame(c);
    main.setData([...hourly(5, 45), ...hourly(10, 50)]);
    frame(c);
    expect(announcements(c).textContent).toBe('');
  });

  it('never reads more often than announceIntervalMs during a fast replay, and ends on the newest bar', () => {
    const { c } = live({ announceIntervalMs: 2000 });
    // Record when the region's text is written.
    const region = announcements(c);
    let value = region.textContent;
    const writes: number[] = [];
    Object.defineProperty(region, 'textContent', {
      get: () => value,
      set: (text: string) => {
        value = text;
        writes.push(Date.now());
      },
    });
    c.replay.start(0);
    frame(c);
    for (let i = 0; i < 9; i++) {
      c.replay.step();
      frame(c);
      vi.advanceTimersByTime(250);
    }
    vi.advanceTimersByTime(2000);
    expect(writes.length).toBeGreaterThan(1);
    for (let i = 1; i < writes.length; i++) expect(writes[i]! - writes[i - 1]!).toBeGreaterThanOrEqual(2000);
    expect(writes.length).toBeLessThanOrEqual(3);
    expect(announcements(c).textContent).toMatch(/^New bar 1970-01-01 09:00\./);
  });

  it('reads app messages in turn ahead of bar text, keeping the newest few', () => {
    const { c, main } = live({ announceBars: true, announceIntervalMs: 1000 });
    c.announce('Alert one');
    expect(announcements(c).textContent).toBe('Alert one');
    for (const n of ['two', 'three', 'four', 'five']) c.announce(`Alert ${n}`);
    main.update(hourly(1, 10)[0]!);
    frame(c);
    const heard: string[] = [];
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(1000);
      heard.push(announcements(c).textContent);
    }
    expect(heard.slice(0, 4)).toEqual(['Alert three', 'Alert four', 'Alert five', expect.stringMatching(/^New bar /)]);
    // The same words again still change the region, so they are read again.
    c.announce(heard[3]!);
    vi.advanceTimersByTime(1000);
    expect(announcements(c).textContent).not.toBe(heard[3]);
    expect(announcements(c).textContent.trim()).toBe(heard[3]);
  });
});
