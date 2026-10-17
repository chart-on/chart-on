import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chart, type Bar, type DataSource, type IndicatorDef, type SymbolInfo } from '@charton/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { createChartGrid } from '../src/grid';
import { createChartShell } from '../src/shell';
import { symbolSearch } from '../src/symbol-search';
import { mountToolbar, type ToolbarHandle, type ToolbarItem } from '../src/toolbar';
import {
  chartStyle,
  chartStyles,
  compare,
  downloadData,
  fullscreen,
  hideMenu,
  intervals,
  print,
  screenshot,
  symbolHeader,
  toggleRail,
  toggleVisibility,
  undoRedo,
} from '../src/toolbar-presets';

interface El {
  disabled?: boolean;
  getAttribute(name: string): string | null;
  dispatch(type: string): void;
}

const charts: Chart[] = [];
const toolbars: ToolbarHandle[] = [];

beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', paddingRight: '0' }));
});
afterEach(() => {
  toolbars.splice(0).forEach((t) => t.destroy());
  charts.splice(0).forEach((c) => c.destroy());
  vi.unstubAllGlobals();
});

function chart(): Chart {
  const c = new Chart(fakeContainer());
  charts.push(c);
  return c;
}

function toolbar(target: Chart | (() => Chart), items: ToolbarItem[]): ToolbarHandle {
  const handle = mountToolbar(fakeContainer(), target, items).handle;
  toolbars.push(handle);
  return handle;
}

const elOf = (t: ToolbarHandle, id: string) => t.get(id)!.el as unknown as El;
const pressed = (t: ToolbarHandle, id: string) => elOf(t, id).getAttribute('aria-pressed');
const click = (t: ToolbarHandle, id: string) => elOf(t, id).dispatch('click');

const bars: Bar[] = Array.from({ length: 10 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 }));

const oscDef: IndicatorDef = {
  id: 'test/presets-osc',
  name: 'Osc',
  placement: 'pane',
  inputs: [],
  plots: [{ id: 'v', type: 'line' }],
  compute: (src) => ({ v: Float64Array.from(src.close) }),
};

describe('toggleVisibility', () => {
  it('follows a series hidden from code and toggles it on click', () => {
    const c = chart();
    const series = c.addLine({ title: 'CVD' });
    const t = toolbar(c, [toggleVisibility(series, { id: 'cvd' })]);
    expect(t.get('cvd')!.item).toMatchObject({ type: 'button', label: 'Show or hide CVD' });
    expect(pressed(t, 'cvd')).toBe('true');
    series.setVisible(false);
    expect(pressed(t, 'cvd')).toBe('false');
    click(t, 'cvd');
    expect(series.visible).toBe(true);
    expect(pressed(t, 'cvd')).toBe('true');
  });

  it('follows an indicator shown or hidden elsewhere', () => {
    const c = chart();
    c.addCandles().setData(bars);
    const indicator = c.indicators.add(oscDef);
    const t = toolbar(c, [toggleVisibility(indicator, { id: 'osc' })]);
    expect(t.get('osc')!.item.type === 'button' && t.get('osc')!.item).toMatchObject({ label: 'Show or hide Osc' });
    expect(pressed(t, 'osc')).toBe('true');
    indicator.setVisible(false);
    expect(pressed(t, 'osc')).toBe('false');
    click(t, 'osc');
    expect(indicator.visible).toBe(true);
  });

  it('follows a pane hidden from code and toggles it on click', () => {
    const c = chart();
    const pane = c.addPane();
    const t = toolbar(c, [toggleVisibility(pane, { id: 'pane' })]);
    expect(pressed(t, 'pane')).toBe('true');
    c.setPaneHidden(pane, true);
    expect(pressed(t, 'pane')).toBe('false');
    click(t, 'pane');
    expect(pane.hidden).toBe(false);
    expect(pressed(t, 'pane')).toBe('true');
  });

  it("switches every drawing with 'drawings' and one drawing by id", () => {
    const c = chart();
    const drawing = c.drawings.add({ type: 'hline', pane: 0, points: [{ time: 0, price: 1 }], style: {} });
    const t = toolbar(c, [toggleVisibility('drawings'), toggleVisibility(drawing.id, { id: 'one' })]);
    expect(pressed(t, 'drawings-visibility')).toBe('true');
    c.drawings.setHidden(true);
    expect(pressed(t, 'drawings-visibility')).toBe('false');
    click(t, 'drawings-visibility');
    expect(c.drawings.hidden).toBe(false);

    expect(pressed(t, 'one')).toBe('true');
    c.drawings.setVisible(drawing.id, false);
    expect(pressed(t, 'one')).toBe('false');
    click(t, 'one');
    expect(c.drawings.getAll()[0]!.hidden).toBeFalsy();
    c.drawings.remove(drawing.id);
    expect(pressed(t, 'one')).toBe('false');
    click(t, 'one'); // a removed drawing is not brought back
    expect(c.drawings.getAll()).toHaveLength(0);
  });

  it('stops listening when the item is removed', () => {
    const c = chart();
    const series = c.addLine();
    const t = toolbar(c, [toggleVisibility(series, { id: 'line' })]);
    const el = elOf(t, 'line');
    t.remove('line');
    series.setVisible(false);
    expect(el.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('watch', () => {
  it('subscribes to the chart the toolbar acts on, again when it changes', () => {
    const a = chart();
    const b = chart();
    let active = a;
    const seen: Chart[] = [];
    const off = vi.fn();
    const t = toolbar(() => active, [
      { type: 'button', id: 'x', label: 'X', onClick() {}, watch: (c) => (seen.push(c), off) },
    ]);
    expect(seen).toEqual([a]);
    t.refresh();
    expect(seen).toEqual([a]);
    active = b;
    t.refresh();
    expect(seen).toEqual([a, b]);
    expect(off).toHaveBeenCalledTimes(1);
    t.remove('x');
    expect(off).toHaveBeenCalledTimes(2);
  });
});

describe('undoRedo', () => {
  it('disables each button until there is something to undo or redo', () => {
    const c = chart();
    const t = toolbar(c, undoRedo());
    expect(elOf(t, 'undo').disabled).toBe(true);
    expect(elOf(t, 'redo').disabled).toBe(true);
    c.drawings.add({ type: 'hline', pane: 0, points: [{ time: 0, price: 1 }], style: {} });
    expect(elOf(t, 'undo').disabled).toBe(false);
    click(t, 'undo');
    expect(c.drawings.getAll()).toHaveLength(0);
    expect(elOf(t, 'undo').disabled).toBe(true);
    expect(elOf(t, 'redo').disabled).toBe(false);
  });

  it('follows indicator steps too', () => {
    const c = chart();
    const t = toolbar(c, undoRedo());
    c.indicators.add({ id: 'test/flat', name: 'Flat', placement: 'overlay', inputs: [], plots: [{ id: 'v', type: 'line' }], compute: (src) => ({ v: Float64Array.from(src.close) }) });
    expect(elOf(t, 'undo').disabled).toBe(false);
    click(t, 'undo');
    expect(c.indicators.getAll()).toEqual([]);
    expect(elOf(t, 'redo').disabled).toBe(false);
  });
});

describe('intervals', () => {
  const source: DataSource = {
    symbol: async (symbol) => ({ symbol, name: symbol, precision: 2 }) as SymbolInfo,
    search: async () => [],
    history: async () => ({ bars, atStart: true }),
  };

  it('reloads the current symbol at the picked interval and follows switches made elsewhere', async () => {
    const c = chart();
    c.setDataSource(source);
    const t = toolbar(c, [intervals(['1m', '5m', '1h'])]);
    const value = () => (t.get('interval')!.item as { value?: string }).value;
    expect(t.get('interval')!.item).toMatchObject({ type: 'segmented', group: 'context', value: '1m' });
    await c.setSymbol('A', '5m');
    expect(value()).toBe('5m');
    const load = vi.spyOn(c, 'setSymbol');
    const item = t.get('interval')!.item;
    if (item.type !== 'segmented') throw new Error('expected a segmented control');
    item.onChange('1h', c);
    expect(load).toHaveBeenCalledWith('A', '1h');
  });

  it('labels trade and volume intervals and groups them under their own headings', () => {
    const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n);
    const item = intervals(['1m', '1T', '100T', '5000V'], { display: 'menu' });
    expect(item.options).toEqual([
      { value: '1m', label: '1m' },
      expect.objectContaining({ value: '1T', label: '1 trade', labelKey: 'intervalTrade', section: 'Ticks', sectionKey: 'intervalTicks' }),
      expect.objectContaining({ value: '100T', label: '100 trades', labelKey: 'intervalTrades', section: 'Ticks' }),
      expect.objectContaining({ value: '5000V', label: `${compact(5000)} volume`, labelKey: 'intervalVolumeOf', section: 'Volume', sectionKey: 'intervalVolume' }),
    ]);
    // An app's own text replaces the built-in one; the headings stay.
    const own = intervals(['100T'], { format: (interval) => `[${interval}]` });
    expect(own.options[0]).toMatchObject({ label: '[100T]', labelKey: undefined, section: 'Ticks' });
  });

  it('shows trade and volume intervals only while the symbol lists them', async () => {
    const listed: DataSource = { ...source, symbol: async (symbol) => ({ symbol, name: symbol, precision: 2, intervals: ['1m', '100T'] }) as SymbolInfo };
    const c = chart();
    const item = intervals(['1m', '100T', '5000V']);
    const hidden = (value: string) => item.isOptionHidden!(value, c);
    // Without a data source the app's list shows as given.
    expect(['1m', '100T', '5000V'].map(hidden)).toEqual([false, false, false]);
    c.setDataSource(listed);
    const t = toolbar(c, [item]);
    await c.setSymbol('A', '1m');
    expect(['1m', '100T', '5000V'].map(hidden)).toEqual([false, false, true]);
    const [seg] = (t.get('interval')!.el as unknown as { children: { children: { hidden: boolean; getAttribute(n: string): string | null }[] }[] }).children;
    const buttons = seg!.children.filter((b) => b.getAttribute('data-value') !== null);
    expect(buttons.map((b) => [b.getAttribute('data-value'), b.hidden])).toEqual([
      ['1m', false],
      ['100T', false],
      ['5000V', true],
    ]);
  });

  it('can be a menu and take its own handler', () => {
    const c = chart();
    const onChange = vi.fn();
    const item = intervals(['1d', '1w'], { display: 'menu', id: 'tf', onChange });
    expect(item).toMatchObject({ type: 'menu', id: 'tf', value: '1d' });
    if (item.type === 'menu') item.onSelect('1w', c);
    expect(onChange).toHaveBeenCalledWith('1w', c);
  });
});

describe('chartStyle', () => {
  it('applies the picked style to the main series and follows changes made elsewhere', () => {
    const c = chart();
    const main = c.addCandles();
    const outlined = { value: 'outlined', label: 'Outlined candles', options: { style: 'candles' as const, borders: true } };
    const t = toolbar(c, [chartStyle([...chartStyles, outlined])]);
    const value = () => (t.get('style')!.item as { value?: string }).value;
    expect(value()).toBe('candles');
    main.applyOptions({ style: 'line' });
    expect(value()).toBe('line');
    const item = t.get('style')!.item;
    if (item.type !== 'menu') throw new Error('expected a menu');
    item.onSelect('outlined', c);
    expect(main.options.style).toBe('candles');
    expect(value()).toBe('outlined');
    item.onSelect('area', c);
    expect(main.options.style).toBe('area');
  });
});

describe('chartStyles order', () => {
  /** What each section holds, as #861 lists it. */
  const sections = {
    'Open, high, low, close': ['bars', 'candles', 'heikinAshi', 'hollow', 'volumeCandles'],
    Range: ['highLow', 'hlcBars', 'rangeBand'],
    Close: ['area', 'baseline', 'columns', 'line', 'lineMarkers', 'step'],
  };

  it('groups the styles by what they show, in that order, under headings', () => {
    const headings = [...new Set(chartStyles.map((s) => s.section))];
    expect(headings).toEqual(Object.keys(sections));
    for (const [heading, ids] of Object.entries(sections)) {
      const entries = chartStyles.filter((s) => s.section === heading);
      expect(entries.map((s) => s.value).sort(), heading).toEqual(ids);
      expect(new Set(entries.map((s) => s.sectionKey)).size).toBe(1);
    }
    // A section's entries are next to each other.
    expect(chartStyles.map((s) => s.section)).toEqual(Object.entries(sections).flatMap(([h, ids]) => ids.map(() => h)));
  });

  it('puts candles first, then the style that shows the most, then by English label', () => {
    expect(chartStyles[0]!.value).toBe('candles');
    // How many values of a bar each style shows, as `chartStyles` defines the count: the open, high, low,
    // close and volume it draws, plus the price its colour compares the close with when it does not draw it.
    const shows = new Map(
      Object.entries({
        candles: 4, // open, high, low, close
        hollow: 5, // and the previous close, which its colour compares with
        volumeCandles: 5, // and the volume, as the body width
        bars: 4,
        heikinAshi: 0, // averages, none of the bar's own values
        hlcBars: 4, // high, low, close, and the open its colour compares with
        rangeBand: 3,
        highLow: 2,
        baseline: 2, // the close and the base level
        columns: 2, // the close and the previous close
        area: 1,
        line: 1,
        lineMarkers: 1,
        step: 1,
      }),
    );
    expect([...shows.keys()].sort()).toEqual(chartStyles.map((s) => s.value).sort());
    for (let i = 1; i < chartStyles.length; i++) {
      const [a, b] = [chartStyles[i - 1]!, chartStyles[i]!];
      if (a.section !== b.section || a.value === 'candles') continue;
      const [sa, sb] = [shows.get(a.value)!, shows.get(b.value)!];
      expect(sa > sb || (sa === sb && a.label < b.label), `${a.value} before ${b.value}`).toBe(true);
    }
  });
});

describe('screenshot', () => {
  it('downloads the image, or says the chart could not be captured', async () => {
    const c = chart();
    const link = { href: '', download: '', click: vi.fn() };
    const create = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'a' ? link : ({}) as HTMLElement) as typeof document.createElement);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
    const shot = vi.spyOn(c, 'captureImage').mockResolvedValue(new Blob());
    const item = screenshot({ type: 'image/jpeg', scale: 2 });
    if (item.type !== 'button') throw new Error('expected a button');
    item.onClick(c, null as never);
    await Promise.resolve();
    await Promise.resolve();
    expect(shot).toHaveBeenCalledWith({ type: 'image/jpeg', scale: 2 });
    expect(link).toMatchObject({ href: 'blob:x', download: 'chart.jpg' });
    expect(link.click).toHaveBeenCalled();
    create.mockRestore();

    shot.mockResolvedValue(null);
    const notes: string[] = [];
    c.on('ui:notify', (e) => notes.push(e.message));
    item.onClick(c, null as never);
    await Promise.resolve();
    await Promise.resolve();
    expect(notes).toEqual(['The chart could not be captured']);
  });
});

describe('downloadData', () => {
  it('downloads CSV with ISO times in the chart timezone, or says there is no data', async () => {
    const c = new Chart(fakeContainer(), { timezone: 'America/New_York' });
    charts.push(c);
    const t = Date.UTC(2024, 0, 2, 15, 0) / 1000;
    c.addCandles({ animate: false }).setData([{ time: t, open: 1, high: 2, low: 0.5, close: 1.5 }]);
    const link = { href: '', download: '', click: vi.fn() };
    const blobs: Blob[] = [];
    const create = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'a' ? link : ({}) as HTMLElement)) as typeof document.createElement);
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => (blobs.push(blob), 'blob:csv'),
      revokeObjectURL: vi.fn(),
    });
    const item = downloadData({ range: { from: t, to: t }, filename: (chart) => `${chart.zone.name}.csv` });
    if (item.type !== 'button') throw new Error('expected a button');
    item.onClick(c, null as never);
    expect(link).toMatchObject({ href: 'blob:csv', download: 'America/New_York.csv' });
    expect(blobs[0]!.type).toBe('text/csv');
    expect(await blobs[0]!.text()).toBe('time,open,high,low,close\n2024-01-02 10:00:00,1,2,0.5,1.5');

    const unix = downloadData({ range: { from: t, to: t }, time: 'unix' });
    if (unix.type !== 'button') throw new Error('expected a button');
    unix.onClick(c, null as never);
    expect(await blobs[1]!.text()).toBe(`time,open,high,low,close\n${t},1,2,0.5,1.5`);

    const notes: string[] = [];
    c.on('ui:notify', (e) => notes.push(e.message));
    const empty = downloadData({ range: { from: 0, to: 10 } });
    if (empty.type !== 'button') throw new Error('expected a button');
    empty.onClick(c, null as never);
    expect(notes).toEqual(['There is no data to download']);
    expect(blobs.length).toBe(2);
    create.mockRestore();
  });
});

describe('print', () => {
  it('is a view button that tells the user when printing fails', async () => {
    const c = chart();
    vi.spyOn(c, 'captureImage').mockResolvedValue(null);
    const item = print();
    if (item.type !== 'button') throw new Error('expected a button');
    expect(item).toMatchObject({ id: 'print', group: 'view', label: 'Print' });
    const notes: string[] = [];
    c.on('ui:notify', (e) => notes.push(e.message));
    item.onClick(c, null as never);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(notes).toEqual(['The chart could not be printed']);
  });
});

describe('shell presets', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
  });

  it('toggleRail follows the rail however it is shown or hidden', () => {
    const shell = createChartShell(fakeContainer(), { appearance: false, toolbar: [toggleRail()] });
    const t = shell.toolbar!;
    expect(pressed(t, 'toggle-rail')).toBe('true');
    shell.rail!.setVisible(false);
    expect(pressed(t, 'toggle-rail')).toBe('false');
    click(t, 'toggle-rail');
    expect(shell.rail!.visible).toBe(true);
    shell.destroy();
  });

  it('fullscreen targets the shell element and follows fullscreenchange', () => {
    const shell = createChartShell(fakeContainer(), { appearance: false, toolbar: [fullscreen()] });
    const t = shell.toolbar!;
    const doc = document as unknown as { fullscreenElement: unknown; fullscreenEnabled: boolean; exitFullscreen: () => Promise<void> };
    doc.fullscreenEnabled = true;
    const request = vi.fn(async () => {
      doc.fullscreenElement = shell.el;
    });
    (shell.el as unknown as { requestFullscreen: typeof request }).requestFullscreen = request;
    t.refresh();
    expect(elOf(t, 'fullscreen').disabled).toBe(false);
    click(t, 'fullscreen');
    expect(request).toHaveBeenCalled();
    dispatch(document, 'fullscreenchange');
    expect(pressed(t, 'fullscreen')).toBe('true');
    doc.exitFullscreen = vi.fn(async () => {
      doc.fullscreenElement = null;
    });
    click(t, 'fullscreen');
    expect(doc.exitFullscreen).toHaveBeenCalled();
    dispatch(document, 'fullscreenchange');
    expect(pressed(t, 'fullscreen')).toBe('false');
    shell.destroy();
    delete (doc as Partial<typeof doc>).fullscreenElement;
    delete (doc as Partial<typeof doc>).fullscreenEnabled;
  });
});

describe('compare', () => {
  const source: DataSource = {
    symbol: async (symbol) => ({ symbol, name: symbol, precision: 2 }) as SymbolInfo,
    search: async () => [],
    history: async () => ({ bars, atStart: true }),
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('compares the picked symbol, is pressed while one is compared, and follows removals', async () => {
    const c = chart();
    c.setDataSource(source);
    await c.setSymbol('A', '1m');
    let picked: string | null = 'B';
    const t = toolbar(c, [compare(async () => picked, { mode: 'pane' })]);
    expect(t.get('compare')!.item).toMatchObject({ type: 'button', group: 'analysis' });
    expect(pressed(t, 'compare')).toBe('false');
    click(t, 'compare');
    await settle();
    expect(c.compared.map((s) => [s.symbol, s.mode])).toEqual([['B', 'pane']]);
    expect(pressed(t, 'compare')).toBe('true');
    picked = null; // cancelled: nothing happens
    click(t, 'compare');
    await settle();
    expect(c.compared).toHaveLength(1);
    c.compared[0]!.remove();
    await settle();
    expect(pressed(t, 'compare')).toBe('false');
  });

  it('tells the user when the symbol cannot be compared', async () => {
    const c = chart();
    const notify = vi.spyOn(c, 'notify');
    const t = toolbar(c, [compare(() => 'B')]);
    click(t, 'compare'); // no data source
    await settle();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
  });
});

describe('hideMenu', () => {
  function setup() {
    const c = chart();
    c.addCandles().setData(bars);
    const a = c.indicators.add(oscDef);
    const b = c.indicators.add(oscDef);
    const item = hideMenu();
    if (item.type !== 'menu') throw new Error('expected a menu');
    const checked = (value: string) => item.isChecked!(value, c);
    return { c, a, b, item, checked, pick: (value: string) => item.onSelect(value, c) };
  }

  it('hides every drawing through the shared action and follows the rail', () => {
    const { c, item, checked, pick } = setup();
    expect(item).toMatchObject({ id: 'hide', group: 'view' });
    expect(item.options.map((o) => o.value)).toEqual(['drawings', 'indicators', 'all']);
    const run = vi.spyOn(c.actions, 'run');
    pick('drawings');
    expect(run).toHaveBeenCalledWith('hide-drawings');
    expect(c.drawings.hidden).toBe(true);
    expect(checked('drawings')).toBe(true);
    c.drawings.setHidden(false); // e.g. the rail's hide-all button
    expect(checked('drawings')).toBe(false);
  });

  it('shows again only the indicators it hid', () => {
    const { a, b, checked, pick } = setup();
    b.setVisible(false);
    expect(checked('indicators')).toBe(false);
    pick('indicators');
    expect([a.visible, b.visible]).toEqual([false, false]);
    expect(checked('indicators')).toBe(true);
    pick('indicators');
    expect([a.visible, b.visible]).toEqual([true, false]);
  });

  it('shows every indicator when they were hidden elsewhere', () => {
    const { a, b, checked, pick } = setup();
    a.setVisible(false);
    b.setVisible(false);
    expect(checked('indicators')).toBe(true);
    pick('indicators');
    expect([a.visible, b.visible]).toEqual([true, true]);
  });

  it('hides and shows drawings and indicators together with all', () => {
    const { c, a, b, checked, pick } = setup();
    c.drawings.setHidden(true);
    expect(checked('all')).toBe(false);
    pick('all');
    expect([c.drawings.hidden, a.visible, b.visible]).toEqual([true, false, false]);
    expect(checked('all')).toBe(true);
    pick('all');
    expect([c.drawings.hidden, a.visible, b.visible]).toEqual([false, true, true]);
  });

  it('still hides drawings when the app removed the action', () => {
    const { c, pick } = setup();
    c.actions.clear();
    pick('drawings');
    expect(c.drawings.hidden).toBe(true);
  });
});

describe('symbolHeader', () => {
  interface Node extends El {
    tagName: string;
    textContent: string;
    hidden: boolean;
    children: Node[];
  }
  const info: Record<string, SymbolInfo> = {
    A: { symbol: 'A', name: 'Alpha', exchange: 'Exchange A' },
    B: { symbol: 'B', name: 'Beta' },
  };
  const source: DataSource = {
    // An unknown key falls back to A, as some sources do; BAD fails.
    symbol: async (symbol) => {
      if (symbol === 'BAD') throw new Error('no such symbol');
      return info[symbol] ?? info.A!;
    },
    search: async () => [],
    history: async () => ({ bars, atStart: true }),
  };
  const search = symbolSearch({ source: { search: async () => [] }, onSelect: () => {} });
  const header = (t: ToolbarHandle, id = 'symbol') => elOf(t, id) as unknown as Node;
  const text = (t: ToolbarHandle, id?: string) => header(t, id).children.find((n) => n.tagName === 'span')!.textContent;
  const detail = (t: ToolbarHandle, id?: string) => {
    const small = header(t, id).children.find((n) => n.tagName === 'small')!;
    return small.hidden ? null : small.textContent;
  };
  /** A chart loaded with `symbol` from `source`. */
  async function loaded(c: Chart, symbol: string): Promise<Chart> {
    c.setDataSource(source);
    await c.setSymbol(symbol, '1m');
    return c;
  }

  beforeEach(() => {
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    vi.stubGlobal('navigator', { platform: 'Win32' });
  });

  it('shows a placeholder, then the loaded symbol and exchange, and follows switches and fallbacks', async () => {
    const shell = createChartShell(fakeContainer(), { appearance: false, toolbar: [symbolHeader()], symbolSearch: search });
    const t = shell.toolbar!;
    expect(t.get('symbol')!.item).toMatchObject({ type: 'button', group: 'context', label: 'Symbol search' });
    expect(header(t).getAttribute('aria-haspopup')).toBe('dialog');
    expect(text(t)).toBe('Choose a symbol');
    expect(detail(t)).toBeNull();
    // The accessible name starts with the visible text.
    expect(header(t).getAttribute('aria-label')).toBe('Choose a symbol, symbol search');

    await loaded(shell.chart, 'A');
    expect([text(t), detail(t)]).toEqual(['Alpha', 'Exchange A']);
    expect(header(t).getAttribute('aria-label')).toBe('Alpha Exchange A, symbol search');

    const switching = shell.chart.setSymbol('B', '1m');
    expect([text(t), detail(t)]).toEqual(['B', null]); // the key, until the source answers
    await switching;
    expect([text(t), detail(t)]).toEqual(['Beta', null]);

    await shell.chart.setSymbol('ZZZ', '1m');
    expect([text(t), detail(t)]).toEqual(['Alpha', 'Exchange A']);
    shell.destroy();
  });

  it('opens the symbol search and shows its shortcut in the tooltip', () => {
    const shell = createChartShell(fakeContainer(), {
      appearance: false,
      toolbar: [symbolHeader({ format: (s) => s.symbol, detail: () => undefined })],
      symbolSearch: search,
    });
    const t = shell.toolbar!;
    const open = vi.spyOn(shell.symbolSearch!, 'open').mockImplementation(() => {});
    expect(elOf(t, 'symbol').disabled).toBe(false);
    expect(header(t).getAttribute('data-tip')).toBe('Symbol search (Ctrl+K)');
    expect(header(t).getAttribute('aria-keyshortcuts')).toBe('Control+K /');
    shell.chart.actions.setKeys('symbol-search', ['/']);
    expect(header(t).getAttribute('data-tip')).toBe('Symbol search (/)');
    click(t, 'symbol');
    expect(open).toHaveBeenCalledTimes(1);
    shell.destroy();
  });

  it('is disabled without a symbol search dialog, and outside a shell', () => {
    const shell = createChartShell(fakeContainer(), { appearance: false, toolbar: [symbolHeader()] });
    expect(shell.symbolSearch).toBeNull();
    expect(elOf(shell.toolbar!, 'symbol').disabled).toBe(true);
    shell.destroy();
    const t = toolbar(chart(), [symbolHeader({ id: 'sym' })]);
    expect(elOf(t, 'sym').disabled).toBe(true);
    expect(header(t, 'sym').getAttribute('data-tip')).toBe('Symbol search');
    click(t, 'sym'); // nothing to open, and no error
  });

  it('goes back to the symbol on screen when a switch fails', async () => {
    const c = chart();
    c.on('data:error', () => {}); // the chart reports the failure; the promise rejects too
    const t = toolbar(c, [symbolHeader()]);
    await loaded(c, 'A');
    const failing = c.setSymbol('BAD', '1m');
    expect(text(t)).toBe('BAD');
    await expect(failing).rejects.toThrow();
    expect([text(t), detail(t)]).toEqual(['Alpha', 'Exchange A']);

    // A failed first load goes back to the placeholder.
    const fresh = chart();
    fresh.on('data:error', () => {});
    const u = toolbar(fresh, [symbolHeader()]);
    fresh.setDataSource(source);
    await expect(fresh.setSymbol('BAD', '1m')).rejects.toThrow();
    expect(text(u)).toBe('Choose a symbol');
  });

  it('stops following the chart once removed or destroyed', async () => {
    const c = await loaded(chart(), 'A');
    const t = toolbar(c, [symbolHeader()]);
    const el = header(t);
    t.remove('symbol');
    await c.setSymbol('B', '1m');
    expect(el.children.find((n) => n.tagName === 'span')!.textContent).toBe('Alpha');

    const u = toolbar(c, [symbolHeader()]);
    expect(text(u)).toBe('Beta');
    const kept = header(u);
    u.destroy();
    await c.setSymbol('A', '1m');
    expect(kept.children.find((n) => n.tagName === 'span')!.textContent).toBe('Beta');
  });

  it("follows a chart grid's active chart", async () => {
    const g = createChartGrid(fakeContainer(), {
      layout: '2x1',
      cell: { rail: false, bottomBar: false, appearance: false },
      toolbar: [symbolHeader()],
    });
    const [first, second] = g.charts as [Chart, Chart];
    await loaded(first, 'A');
    await loaded(second, 'B');
    const t = g.toolbar!;
    t.refresh();
    expect(text(t)).toBe('Alpha');
    g.setActive(1);
    expect(text(t)).toBe('Beta');
    await first.setSymbol('B', '1m'); // the inactive chart no longer drives the header
    await second.setSymbol('A', '1m');
    expect(text(t)).toBe('Alpha');
    g.destroy();
  });

  it('shows its text and detail in the overflow menu, named by its label', async () => {
    // The menu places itself inside the viewport.
    vi.stubGlobal('document', Object.assign(Object.create(document), { documentElement: { clientWidth: 800, clientHeight: 600 } }));
    const c = await loaded(chart(), 'A');
    const t = toolbar(c, [symbolHeader()]);
    // Too narrow for anything: every item moves into the "more" menu.
    const bar = t.el as unknown as { clientWidth: number; children: Node[]; getBoundingClientRect(): { right: number } };
    Object.defineProperty(bar, 'clientWidth', { value: 50 });
    bar.getBoundingClientRect = () => ({ right: 50 });
    for (const child of bar.children) (child as unknown as { getBoundingClientRect(): { right: number } }).getBoundingClientRect = () => ({ right: 100 });
    // New text refits the toolbar.
    await c.setSymbol('B', '1m');
    const more = bar.children[bar.children.length - 1]!;
    expect(more.hidden).toBe(false);
    more.children[0]!.dispatch('click');
    const panel = more.children[1]!;
    const entry = panel.children[0]!;
    expect(entry.children.find((n) => n.tagName === 'span')!.textContent).toBe('Beta');
    expect(entry.getAttribute('aria-label')).toBe('Beta, symbol search');
    expect(entry.getAttribute('aria-haspopup')).toBe('dialog');

    // With a detail, the entry shows both.
    more.children[0]!.dispatch('click'); // close
    await c.setSymbol('A', '1m');
    more.children[0]!.dispatch('click');
    const again = more.children[1]!.children[0]!;
    expect(again.children.find((n) => n.tagName === 'span')!.textContent).toBe('Alpha Exchange A');
  });
});
