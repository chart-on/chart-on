import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { DataSource, SymbolInfo } from '../src/data/types';
import { ALWAYS_OPEN } from '../src/util/session';
import { hours, WEEKDAYS } from './sessions';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = Array.from({ length: 10 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 }));

function source(info: Partial<SymbolInfo>, result: () => Promise<{ bars: typeof bars }>): DataSource {
  return {
    symbol: async (symbol) => ({ symbol, name: symbol, ...info }),
    search: async () => [],
    history: result,
  };
}

function chart(options = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  return c;
}

const utc = (iso: string) => Date.parse(`${iso}Z`) / 1000;

describe('market status on the chart', () => {
  it('reports the phase from the session options and the delay from the symbol', async () => {
    const c = chart({ timezone: 'UTC', session: hours([['09:30', '16:00']], WEEKDAYS), extendedSession: hours([['04:00', '20:00']], WEEKDAYS) });
    expect(c.marketStatus(utc('2024-03-06T08:00:00'))).toMatchObject({ phase: 'pre', delay: 0 });
    c.setDataSource(source({ delay: 15 }, async () => ({ bars })));
    await c.setSymbol('A', '1m');
    expect(c.marketStatus(utc('2024-03-06T10:00:00'))).toMatchObject({ phase: 'open', delay: 15 });
    // The legend badge names the phase now and the delay.
    expect((c as unknown as { badge: string }).badge).toMatch(/^(Pre-market|Market open|After hours|Market closed) · 15 min delayed$/);
  });

  it('is always open without a session', () => {
    expect(chart().marketStatus()).toEqual({ phase: 'open', next: null, delay: 0 });
  });

  it('matches the guide example in the chart timezone', () => {
    const c = chart({
      timezone: 'America/New_York',
      session: hours([['09:30', '16:00']], WEEKDAYS),
      extendedSession: hours([['04:00', '20:00']], WEEKDAYS),
    });
    expect(c.marketStatus(utc('2024-03-06T13:30:00'))).toEqual({ phase: 'pre', next: { phase: 'open', time: 1709735400 }, delay: 0 });
  });

  it('keeps an always-open extended session distinct from none', () => {
    const c = chart({ timezone: 'UTC', session: hours([['09:30', '16:00']], WEEKDAYS), extendedSession: ALWAYS_OPEN });
    expect(c.marketStatus(utc('2024-03-06T17:00:00')).phase).toBe('post');
    c.applyOptions({ extendedSession: undefined });
    expect(c.marketStatus(utc('2024-03-06T17:00:00')).phase).toBe('closed');
  });

  it("drops the old symbol's delay when a switch starts or fails", async () => {
    const c = chart();
    let fail = false;
    c.setDataSource(source({ delay: 15 }, async () => (fail ? Promise.reject(new Error('down')) : { bars })));
    await c.setSymbol('A', '1m');
    expect(c.marketStatus().delay).toBe(15);
    fail = true;
    await c.setSymbol('B', '1m').catch(() => {});
    expect(c.getStatus()?.kind).toBe('error');
    expect(c.marketStatus().delay).toBe(0);
    expect((c as unknown as { badge: string }).badge).toBe('');
  });
});

describe('in-pane status', () => {
  it('follows loading, empty and failed loads', async () => {
    const c = chart();
    let finish!: (r: { bars: typeof bars }) => void;
    c.setDataSource(source({}, () => new Promise((resolve) => (finish = resolve))));
    const loading = c.setSymbol('A', '1m');
    await Promise.resolve();
    await Promise.resolve();
    expect(c.getStatus()).toEqual({ kind: 'loading' });
    finish({ bars: [] });
    await loading;
    expect(c.getStatus()).toEqual({ kind: 'no-data' });

    c.setDataSource(source({}, async () => ({ bars })));
    await c.setSymbol('B', '1m');
    expect(c.getStatus()).toBeNull();

    c.setDataSource(source({}, async () => Promise.reject(new Error('server down'))));
    await c.setSymbol('C', '1m').catch(() => {});
    // Generic text in the pane; the raw error stays available.
    expect(c.getStatus()).toEqual({ kind: 'error', detail: 'server down' });
  });

  it('clears the loading message when the data source is replaced mid-load', async () => {
    const c = chart();
    c.setDataSource(source({}, () => new Promise(() => {})));
    void c.setSymbol('A', '1m');
    await Promise.resolve();
    await Promise.resolve();
    expect(c.getStatus()).toEqual({ kind: 'loading' });
    c.setDataSource(null);
    expect(c.getStatus()).toBeNull();
  });

  it('reports an expired contract even without bars', async () => {
    const c = chart();
    c.setDataSource(source({ expired: true }, async () => ({ bars: [] })));
    await c.setSymbol('ZZ', '1m');
    expect(c.getStatus()).toEqual({ kind: 'expired' });
  });

  it('centres the message on the plot area when another pane is maximized or the main pane collapsed', () => {
    const c = chart();
    c.resize();
    const other = c.addPane();
    c.setStatus({ kind: 'no-data' });
    const place = () => {
      (c as unknown as { placeStatus(): void }).placeStatus();
      return (c as unknown as { statusEl: { style: Record<string, string> } }).statusEl.style.top;
    };
    const middle = `${c.plotHeight / 2}px`;
    c.maximizePane(other);
    expect(place()).toBe(middle);
    c.maximizePane(null);
    c.setPaneCollapsed(c.panes[0]!, true);
    expect(place()).toBe(middle);
  });

  it('marks expired contracts and takes app-set states', async () => {
    const c = chart();
    c.setDataSource(source({ expired: true }, async () => ({ bars })));
    await c.setSymbol('ZZ', '1m');
    expect(c.getStatus()).toEqual({ kind: 'expired' });
    c.setStatus({ kind: 'unknown-symbol' });
    expect(c.getStatus()).toEqual({ kind: 'unknown-symbol' });
    c.setStatus(null);
    expect(c.getStatus()).toBeNull();
  });
});
