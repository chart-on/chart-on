import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import { drawLegend, legendEntryFor, legendHeight, resolveLegendSettings } from '../src/legend';
import { changeText } from '../src/series';
import type { IndicatorDef } from '../src/indicators/types';
import type { Bar } from '../src/types';
import { withAlpha } from '../src/util/color';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars: Bar[] = [
  { time: 0, open: 100, high: 105, low: 95, close: 100 },
  { time: 60, open: 100, high: 112, low: 99, close: 110 },
];

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  c.addCandles({ title: 'ABC', precision: 2 }).setData(bars);
  return c;
}

const mainRow = (c: Chart) => c.valuesAt()!.series[0]!.legend;
const texts = (c: Chart) => mainRow(c)?.parts.map((p) => (p.label ?? '') + p.text);

interface El {
  className: string;
  children: El[];
  style: Record<string, string>;
}
const block = (c: Chart) => (c.root as unknown as El).children.find((e) => e.className === 'pc-legend')!;
const frame = (c: Chart) => {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
};

describe('changeText', () => {
  it('formats the change and percent from the previous close', () => {
    const f = (v: number) => v.toFixed(2);
    expect(changeText(110, 100, f)).toBe('+10.00 (+10.00%)');
    expect(changeText(90, 100, f)).toBe('-10.00 (-10.00%)');
    expect(changeText(5, 0, f)).toBe('+5.00 (+0.00%)');
  });
});

describe('legend options', () => {
  it('shows OHLC and the change in full mode by default', () => {
    expect(texts(chart())).toEqual(['O100.00', 'H112.00', 'L99.00', 'C110.00', '+10.00 (+10.00%)']);
  });

  it('shows only the close in compact mode, and drops the change with showChange off', () => {
    const c = chart({ legend: { mode: 'compact' } });
    expect(texts(c)).toEqual(['110.00', '+10.00 (+10.00%)']);
    c.applyOptions({ legend: { showChange: false } });
    expect(texts(c)).toEqual(['110.00']);
    expect(c.legendSettings).toMatchObject({ mode: 'compact', showChange: false });
  });

  it('shows titles only in title mode, or when idle with whenIdle hidden', () => {
    expect(mainRow(chart({ legend: { mode: 'title' } }))).toEqual({ title: 'ABC', parts: [] });
    const idle = chart({ legend: { whenIdle: 'hidden' } });
    expect(mainRow(idle)?.parts).toEqual([]);
    idle.setCrosshairAt(60);
    expect(mainRow(idle)?.parts.length).toBeGreaterThan(0);
  });

  it('runs the formatter on every row', () => {
    const c = chart({ legend: { formatter: (entry, series) => ({ ...entry, title: `${entry.title} [${series.kind}]` }) } });
    expect(mainRow(c)?.title).toBe('ABC [candles]');
    c.applyOptions({ legend: { formatter: undefined } });
    expect(mainRow(c)?.title).toBe('ABC');
  });

  it('leaves out a series with legend: false', () => {
    const c = chart();
    const line = c.addLine({ title: 'Hidden', legend: false });
    line.setData([{ time: 60, value: 1 }]);
    expect(c.valuesAt()!.series.find((v) => v.series === line)?.legend).toBeNull();
    frame(c);
    expect(block(c).children.filter((e) => e.className === 'pc-legend-row')).toHaveLength(1);
  });

  it('keeps hidden series as dimmed rows by default, and leaves them out with hiddenSeries: omit', () => {
    const c = chart();
    const line = c.addLine({ title: 'Optional' });
    line.setData([{ time: 60, value: 1 }]);
    line.setVisible(false);
    const rows = () => {
      frame(c);
      return block(c).children.filter((e) => e.className === 'pc-legend-row' && e.style.display !== 'none');
    };
    const pane = c.panes[0]!;
    const height = () => legendHeight(pane, c.theme, c.legendSettings);
    const lineRow = () => c.valuesAt()!.series.find((v) => v.series === line)!;

    expect(c.legendSettings.hiddenSeries).toBe('dimmed');
    expect(rows()).toHaveLength(2);
    expect(lineRow().legend?.title).toBe('Optional');
    const dimmedHeight = height();

    c.applyOptions({ legend: { hiddenSeries: 'omit' } });
    expect(rows()).toHaveLength(1);
    expect(lineRow().legend).toBeNull();
    expect(lineRow().values).not.toBeNull();
    expect(height()).toBeLessThan(dimmedHeight);

    line.setVisible(true);
    expect(rows()).toHaveLength(2);
    expect(lineRow().legend?.title).toBe('Optional');
    expect(height()).toBe(dimmedHeight);
  });

  it('switches the feature flag through `visible`, and mirrors the settings', () => {
    const c = chart({ legend: { position: 'top-right' } });
    expect(c.features.legend).toBe(true);
    expect(c.options.legend).toMatchObject({ visible: true, position: 'top-right' });
    c.applyOptions({ legend: { visible: false } });
    expect(c.features.legend).toBe(false);
    expect(c.options.legend).toMatchObject({ visible: false, position: 'top-right' });
    expect(c.legendSettings.position).toBe('top-right');
  });

  it('places the legend in the chosen corner of each pane', () => {
    const c = chart({ legend: { position: 'bottom-right' }, scrollButton: false });
    frame(c);
    const style = block(c).style;
    expect(style.top).toBe('');
    expect(style.left).toBe('');
    expect(style.right).toBe(`${c.width - c.plotLeft - c.plotWidth + 10}px`);
    expect(style.bottom).toBe(`${c.height - c.panes[0]!.top - c.panes[0]!.height + 6}px`);
    c.applyOptions({ legend: { position: 'top-left' } });
    frame(c);
    expect(block(c).style).toMatchObject({ top: `${c.panes[0]!.top + 6}px`, left: `${c.plotLeft + 10}px`, right: '', bottom: '' });
  });

  it('keeps each block a flex column while its pane shows, and hides it with the pane', () => {
    const c = chart();
    const lower = c.addPane();
    c.addLine({ title: 'Line' }, lower).setData(bars.map((b) => ({ time: b.time, value: b.close })));
    frame(c);
    const blocks = () => (c.root as unknown as El).children.filter((e) => e.className === 'pc-legend');
    expect(blocks().map((b) => b.style.display)).toEqual(['flex', 'flex']);
    expect(blocks()[0]!.style).toMatchObject({ flexDirection: 'column', alignItems: 'flex-start', gap: '2px' });
    c.maximizePane(lower);
    frame(c);
    expect(blocks().map((b) => b.style.display)).toEqual(['none', 'flex']);
    c.maximizePane(null);
    frame(c);
    expect(blocks().map((b) => b.style.display)).toEqual(['flex', 'flex']);
  });

  it('caps the legend at the plot width, so long rows wrap instead of reaching the price axis', () => {
    for (const position of ['top-left', 'bottom-right'] as const) {
      const c = chart({ legend: { position }, scrollButton: false });
      frame(c);
      expect(block(c).style.maxWidth).toBe(`${c.plotWidth - 20}px`);
    }
  });

  it('puts a backdrop behind the rows of panes with a heatmap, or every pane with background: true', () => {
    const c = chart();
    frame(c);
    expect(c.legendSettings.background).toBe('auto');
    expect(block(c).style.background).toBe('');
    c.addHeatmap().setData({ times: [0, 60], priceStart: 95, priceStep: 1, rows: 4, values: new Float32Array(8) });
    frame(c);
    const fill = withAlpha(c.theme.background, 0.75);
    expect(block(c).style).toMatchObject({ background: fill, boxShadow: `0 0 0 4px ${fill}` });
    // A hidden heatmap leaves the pane plain.
    const map = c.panes[0]!.series.find((s) => s.kind === 'heatmap')!;
    map.setVisible(false);
    frame(c);
    expect(block(c).style.background).toBe('');
    map.setVisible(true);
    c.applyOptions({ legend: { background: false } });
    frame(c);
    expect(block(c).style).toMatchObject({ background: '', boxShadow: '' });

    const plain = chart({ legend: { background: true } });
    frame(plain);
    expect(block(plain).style.background).toBe(withAlpha(plain.theme.background, 0.75));
  });

  it('draws the backdrop behind screenshot rows too', () => {
    const c = chart({ legend: { background: true } });
    const boxes: number[][] = [];
    let filled = 0;
    const ctx = {
      font: '',
      fillStyle: '',
      save() {},
      restore() {},
      beginPath() {},
      roundRect: (...box: number[]) => boxes.push(box),
      fill: () => filled++,
      measureText: (text: string) => ({ width: text.length * 6 }),
      fillText() {},
    } as unknown as CanvasRenderingContext2D;
    const settings = c.legendSettings;
    const draw = () =>
      drawLegend(ctx, { panes: c.panes, index: 1, idle: true, theme: c.theme, plotLeft: c.plotLeft, plotRight: c.plotLeft + c.plotWidth, width: c.width, height: c.height, settings });
    draw();
    expect(filled).toBe(1);
    // From 4 px before the rows' start edge.
    expect(boxes[0]![0]).toBe(c.plotLeft + 10 - 4);
    settings.background = 'auto';
    draw();
    expect(filled).toBe(1);
  });

  it('right-aligns screenshot rows to the same edge as the DOM legend', () => {
    const c = chart({ legend: { position: 'top-right' } });
    const calls: { text: string; x: number }[] = [];
    const ctx = {
      font: '',
      fillStyle: '',
      save() {},
      restore() {},
      measureText: (text: string) => ({ width: text.length * 6 }),
      fillText: (text: string, x: number) => calls.push({ text, x }),
    } as unknown as CanvasRenderingContext2D;
    const plotRight = c.plotLeft + c.plotWidth;
    drawLegend(ctx, {
      panes: c.panes,
      index: 1,
      idle: true,
      theme: c.theme,
      plotLeft: c.plotLeft,
      plotRight,
      width: c.width,
      height: c.height,
      settings: c.legendSettings,
    });
    const last = calls[calls.length - 1]!;
    expect(last.x + last.text.length * 6).toBe(plotRight - 10);
  });

  it('falls back to the unformatted row when the formatter throws, reporting it once', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const formatter = () => {
        throw new Error('bad formatter');
      };
      const c = chart({ legend: { formatter } });
      expect(mainRow(c)?.title).toBe('ABC');
      expect(texts(c)).toContain('C110.00');
      expect(() => frame(c)).not.toThrow();
      expect(block(c).children.filter((e) => e.className === 'pc-legend-row')).toHaveLength(1);
      mainRow(c);
      frame(c);
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });

  it('leaves out indicators and volume profiles with legend: false', () => {
    const c = chart();
    const def: IndicatorDef = {
      id: 'close',
      name: 'Close',
      placement: 'overlay',
      inputs: [],
      plots: [{ id: 'v', type: 'line' }],
      compute: (src) => ({ v: Float64Array.from(src.close) }),
    };
    const indicator = c.indicators.add(def, {}, { legend: false });
    const profile = c.addVolumeProfile({ legend: false });
    const settings = resolveLegendSettings(c.legendSettings, {});
    expect(legendEntryFor(indicator.series!, 1, settings)).toBeNull();
    expect(legendEntryFor(profile, 1, settings)).toBeNull();
  });

  it('keeps right-corner legends clear of the pane buttons and the scroll button', () => {
    const c = chart({ legend: { position: 'top-right' } });
    c.addPane();
    frame(c);
    const blocks = (c.root as unknown as El).children.filter((e) => e.className === 'pc-legend');
    // Pane buttons sit at pane.top + 4, 22px tall.
    expect(blocks[0]!.style.top).toBe(`${c.panes[0]!.top + 30}px`);
    c.applyOptions({ paneButtons: false });
    frame(c);
    expect(blocks[0]!.style.top).toBe(`${c.panes[0]!.top + 6}px`);
    c.applyOptions({ legend: { position: 'bottom-right' } });
    frame(c);
    const lowest = c.panes[1]!;
    // The scroll button sits 12px above the time axis, 28px tall.
    expect(blocks[1]!.style.bottom).toBe(`${c.height - lowest.top - lowest.height + 44}px`);
    expect(blocks[0]!.style.bottom).toBe(`${c.height - c.panes[0]!.top - c.panes[0]!.height + 6}px`);
    c.applyOptions({ scrollButton: false });
    frame(c);
    expect(blocks[1]!.style.bottom).toBe(`${c.height - lowest.top - lowest.height + 6}px`);
  });

  it('aligns the badge with the rows in right-corner legends', () => {
    const c = chart({ legend: { position: 'top-right' } });
    (c as unknown as { badge: string }).badge = 'Closed';
    frame(c);
    const badge = block(c).children.find((e) => e.className === 'pc-legend-badge')!;
    expect(badge.style.alignSelf ?? '').toBe('');
  });
});
