import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import { createStaticDataSource } from '../src/data/adapters';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.useRealTimers();
});

interface El {
  id: string;
  textContent: string;
  children: El[];
  getAttribute(name: string): string | null;
}
const root = (c: Chart) => c.root as unknown as El;
const byId = (c: Chart, id: string | null) => root(c).children.find((el) => el.id === id);
const summary = (c: Chart) => byId(c, root(c).getAttribute('aria-describedby'))?.textContent;
const live = (c: Chart) => root(c).children.find((el) => el.getAttribute('aria-live') === 'polite')!;

/** Ten hourly bars closing 10, 11, … 19 (UTC). */
const hourly = (n: number): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ time: i * 3600, open: 10 + i, high: 10.5 + i, low: 9 + i, close: 10 + i }));
const bars = hourly(10);

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), { timezone: 'UTC', ...options });
  charts.push(c);
  return c;
}
const frame = (c: Chart) => {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(16);
};

describe('chart accessibility', () => {
  it('is a labelled application with a chart role description', () => {
    const c = chart();
    expect(root(c).getAttribute('role')).toBe('application');
    expect(root(c).getAttribute('aria-roledescription')).toBe('chart');
    expect(root(c).getAttribute('aria-label')).toBe('Chart');
    expect(chart({ accessibility: { label: 'Price history' } }).root.getAttribute('aria-label')).toBe('Price history');
  });

  it('names the chart after the loaded symbol', async () => {
    const c = chart();
    c.setDataSource(createStaticDataSource({ symbols: [{ symbol: 'ABC', name: 'ABC Corp' }], bars: () => bars }));
    await c.setSymbol('ABC', '1h');
    frame(c);
    expect(root(c).getAttribute('aria-label')).toBe('ABC Corp chart');
    expect(c.describe()).toMatch(/^ABC Corp, 1h\. /);
  });

  it('describes the bars in view', () => {
    const c = chart();
    c.addCandles({ title: 'Demo', priceFormat: { type: 'decimal', precision: 2 } }).setData(bars);
    c.fitContent(false);
    expect(c.describe()).toBe(
      "Demo. 10 bars from 1970-01-01 00:00 to 1970-01-01 09:00. Close 10.00 to 19.00, up 9.00 (90.00%). High 19.50, low 9.00.",
    );
    c.main!.setData(hourly(200));
    c.setVisibleTimeRange(100 * 3600, 149 * 3600, false);
    expect(c.describe()).toMatch(/^Demo\. 50 bars .* Close 110\.00 to 159\.00, up 49\.00 \(44\.55%\)\. High 159\.50, low 109\.00\.$/);
    expect(chart().describe()).toBe('Chart. No data in view.');
  });

  it('keeps the summary current, rebuilding it at most once per throttle period', () => {
    const c = chart();
    const main = c.addCandles({ title: 'Demo', priceFormat: { type: 'decimal', precision: 2 } });
    main.setData(bars);
    frame(c);
    // The chart drew its first, empty summary when it was created; this one waits for the period to end.
    vi.advanceTimersByTime(1000);
    expect(summary(c)).toBe(c.describe());
    const describe = vi.spyOn(c, 'describe');
    main.update({ ...bars[9]!, close: 18 });
    frame(c);
    main.update({ ...bars[9]!, close: 17 });
    frame(c);
    expect(describe).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(describe).toHaveBeenCalledOnce();
    expect(summary(c)).toMatch(/Close 10\.00 to 17\.00/);
  });

  it('reads the crosshair values only when asked to', () => {
    const c = chart();
    c.addCandles({ title: 'Demo', priceFormat: { type: 'decimal', precision: 2 } }).setData(bars);
    frame(c);
    const pointAt = () => ({ x: c.timeToX(5 * 3600)!, y: 50, pane: 0 });
    c.setCrosshair(pointAt());
    expect(live(c).textContent).toBe('');

    c.applyOptions({ accessibility: { crosshairReadout: true } });
    expect(c.options.accessibility).toMatchObject({ summary: true, crosshairReadout: true });
    c.setCrosshair(pointAt());
    expect(live(c).textContent).toMatch(/^1970-01-01 05:00\. Demo O 15\.00 .*C 15\.00/);

    c.applyOptions({ accessibility: { summary: false } });
    vi.advanceTimersByTime(1000);
    expect(summary(c)).toBe('');
  });
});
