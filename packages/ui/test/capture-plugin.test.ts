import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChart, type Chart } from '@chart-on/core';
import { fakeContainer } from '../../core/test/fake-dom';
import { copyChartImage } from '../src/clipboard';
import { printChart } from '../src/print';
import { createChartShell, type ChartShell } from '../src/shell';
import { print, screenshot } from '../src/toolbar-presets';

// `captureImage` needs the core's imageCapture() plugin. The UI shell adds it; the helpers and
// presets used on their own must report a chart without it instead of throwing.

const charts: { destroy(): void }[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A chart without plugins, and the notifications it sends. */
function bare() {
  const chart = createChart(fakeContainer(), { plugins: [] });
  charts.push(chart);
  const notes: string[] = [];
  chart.on('ui:notify', (e) => {
    notes.push(e.message);
    e.preventDefault();
  });
  return { chart, notes };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** The toolbar button a preset's click comes from; these presets do not read it. */
const button = {} as HTMLButtonElement;

describe('image capture without the imageCapture() plugin', () => {
  it('copyChartImage rejects with the not-registered error instead of throwing', async () => {
    const write = vi.fn((items: { items: Record<string, Promise<Blob>> }[]) => items[0]!.items['image/png']!.then(() => {}));
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(readonly items: Record<string, Promise<Blob>>) {}
      },
    );
    const { chart } = bare();
    let copied: Promise<void> | undefined;
    expect(() => (copied = copyChartImage(chart))).not.toThrow();
    await expect(copied).rejects.toMatchObject({ code: 'not-registered', context: { call: 'captureImage', plugin: 'imageCapture()' } });
  });

  it('printChart rejects with the not-registered error', async () => {
    const { chart } = bare();
    await expect(printChart(chart)).rejects.toMatchObject({ code: 'not-registered' });
  });

  it('the screenshot() and print() presets show that images are not available', async () => {
    const { chart, notes } = bare();
    expect(() => screenshot().onClick!(chart as Chart, button)).not.toThrow();
    expect(notes).toEqual(['Images of this chart are not available']);
    print().onClick!(chart as Chart, button);
    await tick();
    expect(notes).toEqual(['Images of this chart are not available', 'Images of this chart are not available']);
  });
});

describe('image capture in the UI shell', () => {
  const shells: ChartShell[] = [];
  beforeEach(() => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
  });
  afterEach(() => shells.splice(0).forEach((s) => s.destroy()));

  it('downloads an image from the screenshot() preset on a shell given its own plugin list', async () => {
    const shell = createChartShell(fakeContainer(), { chart: { plugins: [] } });
    shells.push(shell);
    const chart = shell.chart;
    expect(chart.installedPlugins).toContain('@chart-on/core/image-capture');
    chart.addCandles().setData(Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    const png = new Blob(['png'], { type: 'image/png' });
    const downloads: string[] = [];
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = create(tag) as unknown as Record<string, unknown>;
      if (tag === 'canvas') el.toBlob = (done: (b: Blob | null) => void) => done(png);
      if (tag === 'a') el.click = () => downloads.push(String(el.download));
      return el;
    }) as typeof document.createElement);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:chart');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const notes: string[] = [];
    chart.on('ui:notify', (e) => notes.push(e.message));
    screenshot({ filename: 'shot.png' }).onClick!(chart, button);
    await tick();
    expect(notes).toEqual([]);
    expect(downloads).toEqual(['shot.png']);
  });
});
