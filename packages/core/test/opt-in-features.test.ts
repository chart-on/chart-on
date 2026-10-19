import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countingWebgl2, fakeContainer } from './fake-dom';
import { fakeWebgl2 } from '../src/testing/environment';
import type { ChartOptionsPatch } from '../src/chart';
import type { DrawingToolDef } from '../src/drawing/types';

// The test setup gives every chart the built-in plugins. These tests load fresh copies of the
// modules, so they see `createChart` as an app does: without plugins unless it passes them.

type Core = typeof import('../src/index');

let core: Core;
const charts: { destroy(): void }[] = [];

beforeEach(async () => {
  vi.resetModules();
  core = await import('../src/index');
});

afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
});

function chart(options?: ChartOptionsPatch, container = fakeContainer()) {
  const c = core.createChart(container, options);
  charts.push(c);
  return c;
}

/** The error `fn` throws. */
function thrown(fn: () => unknown): { code?: string; message: string; context?: Record<string, unknown> } {
  try {
    fn();
  } catch (error) {
    return error as { code?: string; message: string; context?: Record<string, unknown> };
  }
  throw new Error('did not throw');
}

const tool = (type: string): DrawingToolDef => core.builtinTools.find((t) => t.type === type)!;
/** Run one frame now. */
const draw = (c: object) => (c as { frame(now: number): void }).frame(16);

describe('opt-in features', () => {
  it('a chart without plugins has no heatmaps, volume profiles, point series, depth lanes or drawings', () => {
    const c = chart();
    const heatmap = thrown(() => c.addHeatmap());
    expect(heatmap.code).toBe('not-registered');
    expect(heatmap.message).toContain('heatmap()');
    expect(heatmap.context).toEqual({ call: 'addHeatmap', plugin: 'heatmap()' });
    expect(thrown(() => c.addVolumeProfile()).code).toBe('not-registered');
    expect(thrown(() => c.addPoints()).context).toEqual({ call: 'addPoints', plugin: 'points()' });
    expect(thrown(() => c.setViewportBounds(null)).context).toEqual({ call: 'setViewportBounds', plugin: 'viewportBounds()' });
    expect(c.viewportBounds).toBeNull();
    const depth = thrown(() => c.addDepthLane());
    expect(depth.code).toBe('not-registered');
    expect(depth.message).toContain('depthLane()');
    expect(depth.context).toEqual({ call: 'addDepthLane', plugin: 'depthLane()' });
    const drawings = thrown(() => c.drawings);
    expect(drawings.code).toBe('not-registered');
    expect(drawings.message).toContain('drawingTools()');
    expect(drawings.context).toEqual({ call: 'drawings', plugin: 'drawingTools()' });
    for (const id of ['delete-drawings', 'copy-drawings', 'cut-drawings', 'paste-drawings', 'draw-trendline']) {
      expect(c.actions.has(id)).toBe(false);
    }
    // The selection and its commands come with the drawings and indicators plugins.
    for (const id of ['remove-selected', 'copy', 'cut', 'paste', 'undo', 'redo']) expect(c.actions.has(id)).toBe(false);
    c.setSelection({ kind: 'drawings', ids: ['a'] });
    expect(c.getSelection()).toBeNull();
    // The chart still draws and takes input without them, and saves layouts with only layouts().
    c.addCandles().setData(Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    draw(c);
    c.install(core.layouts());
    expect(c.serializeLayout().drawings).toBeUndefined();
    expect(c.serializeLayout().toolDefaults).toBeUndefined();
  });

  it('a chart with drawings() has the drawing manager and its commands, but no built-in tools', () => {
    const c = chart({ plugins: [core.drawings()] });
    expect(c.drawings.getTools()).toEqual([]);
    expect(c.actions.has('undo')).toBe(true);
    expect(c.actions.has('draw-trendline')).toBe(false);
    const unknown = thrown(() => c.drawings.setTool('trendline'));
    expect(unknown.code).toBe('not-registered');
    expect(unknown.message).toContain('Unknown drawing tool "trendline"');
    expect(unknown.message).toContain('drawingTools()');
    expect(unknown.context).toEqual({ call: 'drawings.setTool', tool: 'trendline', available: [] });
    expect(thrown(() => c.drawings.add({ type: 'hline', pane: 0, points: [{ time: 0, price: 1 }], style: {} })).code).toBe(
      'not-registered',
    );
  });

  it('names the tools the chart has for a type it does not know', () => {
    const c = chart({ plugins: [core.drawingTools([tool('trendline'), tool('hline')])] });
    const typo = thrown(() => c.drawings.setTool('trendlin'));
    expect(typo.message).toBe('Unknown drawing tool "trendlin": this chart has "trendline", "hline"');
    expect(typo.context).toEqual({ call: 'drawings.setTool', tool: 'trendlin', available: ['trendline', 'hline'] });
  });

  it('gives each chart only the plugins it was created with', () => {
    const plain = chart();
    const full = chart({ plugins: core.builtins() });
    expect(full.addHeatmap().kind).toBe('heatmap');
    expect(full.addVolumeProfile().kind).toBe('volumeProfile');
    expect(full.addPoints().kind).toBe('points');
    full.setViewportBounds({ time: { from: 0 } });
    expect(full.viewportBounds).toEqual({ time: { from: 0 } });
    expect(full.addDepthLane().options.width).toBe(80);
    expect(full.drawings.getTools().map((t) => t.type)).toEqual(core.builtinTools.map((t) => t.type));
    expect(full.installedPlugins).toEqual([
      '@chart-on/core/data-source',
      '@chart-on/core/indicators',
      '@chart-on/core/comparisons',
      '@chart-on/core/annotations',
      '@chart-on/core/trading',
      '@chart-on/core/heatmap',
      '@chart-on/core/volume-profile',
      '@chart-on/core/points',
      '@chart-on/core/viewport-bounds',
      '@chart-on/core/depth-lane',
      '@chart-on/core/replay',
      '@chart-on/core/drawings',
      '@chart-on/core/stats-overlay',
      '@chart-on/core/source-markers',
      '@chart-on/core/adjustments',
      '@chart-on/core/watermark',
      '@chart-on/core/layouts',
      '@chart-on/core/reference-lines',
      '@chart-on/core/price-styles',
      '@chart-on/core/grouping',
      '@chart-on/core/last-point-pulse',
      '@chart-on/core/localization',
      '@chart-on/core/countdown',
      '@chart-on/core/image-capture',
      '@chart-on/core/market-status',
      '@chart-on/core/shared-context',
    ]);
    expect(thrown(() => plain.drawings).code).toBe('not-registered');
    expect(thrown(() => plain.addHeatmap()).code).toBe('not-registered');
    // `plugins` is not an option the chart keeps, and `applyOptions` ignores it.
    expect('plugins' in full.options).toBe(false);
    plain.applyOptions({ plugins: core.builtins() });
    expect('plugins' in plain.options).toBe(false);
    expect(thrown(() => plain.drawings).code).toBe('not-registered');
  });

  it('a chart without replay() throws for it; one installed later replays, and uninstalling shows every bar', () => {
    const c = chart();
    const error = thrown(() => c.replay);
    expect(error.code).toBe('not-registered');
    expect(error.context).toEqual({ call: 'replay', plugin: 'replay()' });
    const main = c.addCandles({ animate: false });
    main.setData(Array.from({ length: 5 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    const uninstall = c.install(core.replay());
    expect(c.replay.start(120)).toBe(true);
    expect(main.data).toHaveLength(3);
    const active: boolean[] = [];
    c.on('replay:change', (state) => active.push(state.active));
    uninstall();
    expect(main.data).toHaveLength(5);
    expect(active).toEqual([false]);
    expect(thrown(() => c.replay).code).toBe('not-registered');
  });

  it('a chart without dataSource() throws for a source; one installed later loads, and uninstalling detaches it', async () => {
    const c = chart();
    const bars = Array.from({ length: 5 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 }));
    const source = core.createStaticDataSource({ symbols: [{ symbol: 'A', name: 'A' }], bars: () => bars });
    const error = thrown(() => c.setDataSource(source));
    expect(error.code).toBe('not-registered');
    expect(error.message).toContain('dataSource()');
    expect(error.context).toEqual({ call: 'setDataSource', plugin: 'dataSource()' });
    expect(c.data).toBeNull();
    c.setDataSource(null);

    const uninstall = c.install(core.dataSource());
    c.setDataSource(source);
    await c.setSymbol('A', '1m');
    expect(c.data?.symbol?.name).toBe('A');
    expect(c.main?.data).toHaveLength(5);
    uninstall();
    expect(c.data).toBeNull();
    expect(c.main?.data).toHaveLength(5);
    expect(thrown(() => c.setDataSource(source)).code).toBe('not-registered');
  });

  it('a setDataSource refused for want of dataSource() leaves what the chart shows alone', () => {
    const c = chart();
    const main = c.addCandles({ animate: false });
    main.setData(Array.from({ length: 5 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    c.setStatus({ kind: 'loading' });
    const source = core.createStaticDataSource({ symbols: [{ symbol: 'A', name: 'A' }], bars: () => [] });
    expect(thrown(() => c.setDataSource(source)).code).toBe('not-registered');
    expect(c.getStatus()?.kind).toBe('loading');
    expect(main.data).toHaveLength(5);
  });

  it('a chart without layouts() throws for saving and loading them but reports changes; one installed later does both', () => {
    const c = chart();
    c.addCandles({ animate: false }).setData(Array.from({ length: 5 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    const error = thrown(() => c.serializeLayout());
    expect(error.code).toBe('not-registered');
    expect(error.message).toContain('layouts()');
    expect(error.context).toEqual({ call: 'serializeLayout', plugin: 'layouts()' });
    const load = thrown(() => c.loadLayout({ version: 1, mainSeries: { style: 'line' } }));
    expect(load.context).toEqual({ call: 'loadLayout', plugin: 'layouts()' });
    expect(c.main?.options.style).toBe('candles');
    expect(c.layoutLoading).toBe(false);
    // An app that saves its own way still hears what changed.
    const reasons: string[] = [];
    c.on('state:change', ({ reason }) => reasons.push(reason));
    c.applyOptions({ grid: { vertical: { visible: false } } });
    expect(reasons).toEqual(['options']);

    const uninstall = c.install(core.layouts());
    const saved = c.serializeLayout();
    expect(saved.version).toBe(core.LAYOUT_VERSION);
    expect(c.loadLayout({ ...saved, mainSeries: { style: 'line' } }).errors).toEqual([]);
    expect(c.main?.options.style).toBe('line');
    uninstall();
    expect(thrown(() => c.serializeLayout()).code).toBe('not-registered');
  });

  it('a chart without referenceLines() keeps the option for it and draws no line; one installed later applies it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = chart({ referenceLines: { high: { visible: true } } });
    c.addCandles({ animate: false }).setData(Array.from({ length: 5 }, (_, i) => ({ time: i * 60, open: 1, high: 2 + i, low: 0, close: 1 })));
    const error = thrown(() => c.referenceLines);
    expect(error.code).toBe('not-registered');
    expect(error.message).toContain('referenceLines()');
    expect(error.context).toEqual({ call: 'referenceLines', plugin: 'referenceLines()' });
    c.applyOptions({ referenceLines: { high: { color: '#123456' }, low: { visible: true } } });
    expect(c.options.referenceLines).toEqual({ high: { visible: true, color: '#123456' }, low: { visible: true } });
    // Checked at the call, as with the plugin, and nothing kept.
    expect(() => c.applyOptions({ referenceLines: { nope: { visible: true } } as never })).toThrow(/Unknown reference line/);
    expect(() => c.applyOptions({ referenceLines: { low: { lineStyle: 'wavy' as never } } })).toThrow(/line style/);
    expect(() => chart({ referenceLines: { nope: {} } as never })).toThrow(/Unknown reference line/);
    expect(c.options.referenceLines).toEqual({ high: { visible: true, color: '#123456' }, low: { visible: true } });
    draw(c);
    expect(warn.mock.calls.filter(([message]) => String(message).includes('reference-lines-missing'))).toHaveLength(1);

    const drawn = vi.spyOn(core.ReferenceLines.prototype, 'drawLines');
    const uninstall = c.install(core.referenceLines());
    (c as unknown as { frame(now: number): void }).frame(32);
    // Drawn from the next frame on.
    expect(drawn).toHaveBeenCalled();
    drawn.mockRestore();
    expect(c.referenceLines.options.high).toMatchObject({ visible: true, color: '#123456', title: 'High', lineStyle: 'dotted' });
    expect(c.referenceLines.options.low.visible).toBe(true);
    expect(c.options.referenceLines).toBe(c.referenceLines.options);
    c.referenceLines.setQuote({ bid: 1 });
    expect(c.referenceLines.quote).toEqual({ bid: 1 });
    uninstall();
    expect(thrown(() => c.referenceLines).code).toBe('not-registered');
    draw(c);
    // Kept for a later install, which starts from it.
    expect(c.options.referenceLines).toMatchObject({ high: { visible: true, color: '#123456' }, low: { visible: true } });
    c.install(core.referenceLines());
    expect(c.referenceLines.options.high.color).toBe('#123456');
    warn.mockRestore();
  });

  it('an install of referenceLines() that throws leaves no listeners behind', () => {
    const c = chart();
    const before = [c.listens('data:quote'), c.listens('data:loading')];
    // Options are checked at the call, so only a kept option changed behind the chart's back gets this far.
    (c.options.referenceLines as Record<string, unknown>).nope = { visible: true };
    expect(() => c.install(core.referenceLines())).toThrow(/Unknown reference line/);
    expect(c.installedPlugins).toEqual([]);
    expect([c.listens('data:quote'), c.listens('data:loading')]).toEqual(before);
    expect(thrown(() => c.referenceLines).code).toBe('not-registered');
  });

  it('referenceLines() installed after a quote, or again, shows the latest quote at once', async () => {
    const bars = Array.from({ length: 5 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 }));
    let push: ((quote: { bid?: number; ask?: number }) => void) | null = null;
    const source = Object.assign(core.createStaticDataSource({ symbols: [{ symbol: 'A', name: 'A' }], bars: () => bars }), {
      quotes: (_symbol: unknown, onQuote: (quote: { bid?: number; ask?: number }) => void) => {
        push = onQuote;
        return () => (push = null);
      },
    });
    const c = chart({ plugins: [core.dataSource()] });
    c.setDataSource(source);
    await c.setSymbol('A', '1m');
    push!({ bid: 1, ask: 2 });
    expect(c.data?.quote).toEqual({ bid: 1, ask: 2 });
    const uninstall = c.install(core.referenceLines());
    expect(c.referenceLines.quote).toEqual({ bid: 1, ask: 2 });
    push!({ bid: 3 });
    expect(c.referenceLines.quote).toEqual({ bid: 3 });
    uninstall();
    push!({ bid: 4, ask: 5 });
    c.install(core.referenceLines());
    expect(c.referenceLines.quote).toEqual({ bid: 4, ask: 5 });
    // Another symbol starts without one.
    const load = c.setSymbol('A', '5m');
    expect([c.data?.quote, c.referenceLines.quote]).toEqual([null, null]);
    await load;
  });

  it('a chart without priceStyles() draws no kagi or point & figure style; one installed later draws them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = chart();
    const main = c.addCandles({ style: 'pointFigure', animate: false });
    // Point & figure columns one box apart: the box size reads as 1.
    main.setData([
      { time: 60, open: 10, high: 13, low: 10, close: 13 },
      { time: 120, open: 12, high: 12, low: 9, close: 9 },
    ]);
    const drawer = () => (main as unknown as { priceStyle: { boxes: { count: number } } | null }).priceStyle;
    let now = 16;
    draw(c);
    expect(drawer()).toBeNull();
    // Boxes reach half a box past the bars' prices only while they can draw.
    expect(main.priceRange(-1, 10)).toEqual([9, 13]);
    expect(warn.mock.calls.filter(([message]) => String(message).includes('price-styles-missing'))).toHaveLength(1);

    const uninstall = c.install(core.priceStyles());
    (c as unknown as { frame(now: number): void }).frame((now += 16));
    expect(drawer()!.boxes.count).toBe(8);
    expect(main.priceRange(-1, 10)).toEqual([8.5, 13.5]);
    uninstall();
    (c as unknown as { frame(now: number): void }).frame((now += 16));
    expect(drawer()).toBeNull();
    warn.mockRestore();
  });

  it('a chart without grouping() draws single bars under the grouping option; one installed later groups them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = chart({ grouping: { mode: 'pixel' }, minBarSpacing: 0.5 });
    c.addCandles({ animate: false }).setData(Array.from({ length: 5000 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    const changes: unknown[] = [];
    c.on('grouping:change', (state) => changes.push(state));
    c.fitContent(false);
    draw(c);
    // Zooming stops at minBarSpacing and nothing groups.
    expect(c.time.barSpacing).toBeGreaterThanOrEqual(0.5);
    expect([c.grouping, c.groupLevel, c.buckets]).toEqual([null, 0, null]);
    expect(changes).toEqual([]);
    expect(c.options.grouping).toEqual({ mode: 'pixel' });
    expect(warn.mock.calls.filter(([message]) => String(message).includes('grouping-missing'))).toHaveLength(1);

    const uninstall = c.install(core.grouping());
    c.fitContent(false);
    (c as unknown as { frame(now: number): void }).frame(32);
    expect(c.time.barSpacing).toBeLessThan(0.5);
    expect(c.groupLevel).toBeGreaterThan(0);
    expect(c.grouping).toEqual({ level: c.groupLevel, bars: 2 ** c.groupLevel });
    expect(changes).toEqual([c.grouping]);
    expect(c.time.floorSpacing).toBeLessThan(0.5);
    uninstall();
    // Back to single bars at once: the view zoomed out past minBarSpacing comes back to it, and so does the zoom floor.
    expect(c.time.barSpacing).toBeGreaterThanOrEqual(0.5);
    expect(c.time.floorSpacing).toBe(0.5);
    (c as unknown as { frame(now: number): void }).frame(48);
    expect([c.grouping, c.buckets, c.groupLevels]).toEqual([null, null, null]);
    expect(changes.at(-1)).toBeNull();

    // Installed again, it groups again.
    c.install(core.grouping());
    c.fitContent(false);
    (c as unknown as { frame(now: number): void }).frame(64);
    expect(c.time.barSpacing).toBeLessThan(0.5);
    expect(c.groupLevel).toBeGreaterThan(0);
    expect(changes.at(-1)).toEqual(c.grouping);
    warn.mockRestore();
  });

  it('warns once when applyOptions turns grouping on without grouping(), and checks the option as before', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = chart();
    c.applyOptions({ grouping: { mode: 'calendar' } });
    c.applyOptions({ grouping: { mode: 'pixel' } });
    expect(warn.mock.calls.filter(([message]) => String(message).includes('grouping-missing'))).toHaveLength(1);
    expect(c.options.grouping).toEqual({ mode: 'pixel' });
    expect(() => c.applyOptions({ grouping: { mode: 'nope' as never } })).toThrow(/Unknown grouping mode/);
    expect(c.grouping).toBeNull();
    warn.mockRestore();
  });

  it("gl: 'shared' joins the page's shared context with sharedContext(), and falls back to an own context with a warning without it", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const renderer = (c: object) => (c as { renderer: unknown }).renderer;
    const a = chart({ gl: 'shared', plugins: core.builtins() });
    const b = chart({ gl: 'shared', plugins: [core.sharedContext()] });
    expect(renderer(a)).toBe(renderer(b));
    // Installed ahead of the others, so the chart joins the context before they come.
    expect(a.installedPlugins[0]).toBe('@chart-on/core/shared-context');
    expect(a.options.gl).toBe('shared');
    const missing = () => warn.mock.calls.filter(([message]) => String(message).includes('shared-context-missing'));
    expect(missing()).toEqual([]);
    const own = chart({ gl: 'shared' });
    expect(renderer(own)).not.toBe(renderer(a));
    expect(own.options.gl).toBe('own');
    chart({ gl: 'shared' });
    expect(missing()).toHaveLength(1);
    // Given to a chart with its own context, the plugin changes nothing.
    const later = chart({ plugins: [core.sharedContext()] });
    expect(later.options.gl).toBe('own');
    expect(renderer(later)).not.toBe(renderer(a));
    warn.mockRestore();
  });

  it('a chart without marketStatus() throws on marketStatus() and shows no badge; one installed later brings both until uninstalled', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const day = [{ start: '09:30', end: '16:00' }];
    const session = { weekly: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day } };
    const c = chart({ timezone: 'UTC', session, marketStatus: true });
    const badge = () => (c as unknown as { badge: string }).badge;
    const missing = thrown(() => c.marketStatus());
    expect(missing.code).toBe('not-registered');
    expect(missing.context).toEqual({ call: 'marketStatus', plugin: 'marketStatus()' });
    expect(badge()).toBe('');
    expect(c.options.marketStatus).toBe(true);
    const warned = () => warn.mock.calls.filter(([message]) => String(message).includes('market-status-missing'));
    expect(warned()).toHaveLength(1);
    const uninstall = c.install(core.marketStatus());
    expect(['pre', 'open', 'post', 'closed']).toContain(c.marketStatus().phase);
    expect(badge()).not.toBe('');
    uninstall();
    expect(thrown(() => c.marketStatus()).code).toBe('not-registered');
    expect(badge()).toBe('');
    warn.mockRestore();
  });

  it('a market status install that throws leaves the chart without it', () => {
    const c = chart({ marketStatus: true });
    const broken = { phase: () => { throw new Error('phase failed'); }, badge: () => '' };
    expect(() => c.provideFeature('marketStatus', broken)).toThrow('phase failed');
    // Nothing was left behind: the call still needs the plugin, and a real one installs.
    expect(thrown(() => c.marketStatus()).code).toBe('not-registered');
    c.install(core.marketStatus());
    expect(c.marketStatus().phase).toBe('open');
  });

  it('does not warn about the market status on a chart with the default options', () => {
    // A fresh module (see beforeEach), so the once-per-load warning has not fired yet.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chart();
    expect(warn.mock.calls.filter(([message]) => String(message).includes('market-status-missing'))).toEqual([]);
    warn.mockRestore();
  });

  it('a chart without imageCapture() throws on captureImage; one installed later captures until uninstalled', async () => {
    const c = chart();
    c.addCandles().setData(Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    const missing = thrown(() => c.captureImage());
    expect(missing.code).toBe('not-registered');
    expect(missing.context).toEqual({ call: 'captureImage', plugin: 'imageCapture()' });
    const uninstall = c.install(core.imageCapture());
    expect(c.installedPlugins).toEqual(['@chart-on/core/image-capture']);
    // The test DOM's canvases cannot encode, so check the composited canvas `captureImage` encodes.
    const composite = (o: object) => (c as unknown as { composite(o: object): { width: number } | null }).composite(o);
    expect(composite({ caption: 'Caption', padding: 4 })?.width).toBeGreaterThan(0);
    uninstall();
    expect(thrown(() => c.captureImage()).code).toBe('not-registered');
    // A destroyed chart resolves to null, plugin or not.
    c.destroy();
    await expect(c.captureImage()).resolves.toBeNull();
  });

  it('a chart without countdown() keeps the flag but shows no countdown; one installed later shows it until uninstalled', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = Math.floor(Date.now() / 1000);
    const c = chart({ timezone: 'UTC', features: { countdown: true } });
    c.addCandles({ animate: false }).setData(Array.from({ length: 20 }, (_, i) => ({ time: now - 30 - (19 - i) * 3600, open: 1, high: 1, low: 1, close: 1 })));
    const text = () => (c as unknown as { countdownText(): string | undefined }).countdownText();
    expect(c.features.countdown).toBe(true);
    expect(text()).toBeUndefined();
    const warned = () => warn.mock.calls.filter(([message]) => String(message).includes('countdown-missing'));
    expect(warned()).toHaveLength(1);
    // The flag is on by default: only an explicit true warns, and only once.
    c.applyOptions({ features: { countdown: true } });
    expect(warned()).toHaveLength(1);
    const uninstall = c.install(core.countdown());
    expect(text()).toMatch(/^\d/);
    c.applyOptions({ features: { countdown: false } });
    expect(text()).toBeUndefined();
    c.applyOptions({ features: { countdown: true } });
    uninstall();
    expect(text()).toBeUndefined();
    warn.mockRestore();
  });

  it('does not warn about the countdown on a chart with the default flags', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chart();
    expect(warn.mock.calls.filter(([message]) => String(message).includes('countdown-missing'))).toEqual([]);
    warn.mockRestore();
  });

  it('a chart without localization() keeps the built-in English and checks the option; one installed later applies it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = chart({ localization: { locale: 'de-DE', messages: { chartLabel: 'Diagramm' } } });
    expect(c.localization).toBe(core.englishLocalizer);
    expect(c.options.localization).toEqual({ locale: 'de-DE', messages: { chartLabel: 'Diagramm' } });
    expect(warn.mock.calls.filter(([message]) => String(message).includes('localization-missing'))).toHaveLength(1);
    // Checked at the call, as with the plugin, and nothing kept.
    expect(() => c.applyOptions({ localization: { locale: 'not a locale!' } })).toThrow(RangeError);
    expect(() => c.applyOptions({ localization: { hourCycle: 'h99' as never } })).toThrow(/hourCycle/);
    expect(() => chart({ localization: { decimalSeparator: '' } })).toThrow(/decimalSeparator/);
    expect(c.options.localization.locale).toBe('de-DE');

    const changes: unknown[] = [];
    c.on('localization:change', (event) => changes.push(event));
    const uninstall = c.install(core.localization());
    expect(c.localization.locale).toBe('de-DE');
    expect(c.localization.number(1.5, 1)).toBe('1,5');
    expect(c.localization.text('chartLabel')).toBe('Diagramm');
    c.applyOptions({ localization: { locale: 'fr-FR' } });
    expect(c.localization.locale).toBe('fr-FR');
    uninstall();
    expect(c.localization).toBe(core.englishLocalizer);
    expect(changes).toEqual([{ locale: 'de-DE' }, { locale: 'fr-FR' }, { locale: undefined }]);
    // An empty option localizes nothing: installing keeps the built-in English.
    const plain = chart();
    plain.install(core.localization());
    expect(plain.localization).toBe(core.englishLocalizer);
    warn.mockRestore();
  });

  it('the first frame already draws numbers in the language of the plugins option', () => {
    // Record every canvas text, the frame the constructor draws included.
    const texts: string[] = [];
    const recording = new Proxy({} as Record<string, unknown>, {
      get: (state, key) => {
        if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
        if (key === 'fillText') return (text: string) => texts.push(text);
        if (typeof key === 'string' && key in state) return state[key];
        return () => ({ addColorStop() {} });
      },
      set: (state, key, value) => {
        state[key as string] = value;
        return true;
      },
    });
    const container = fakeContainer();
    const canvas = Object.getPrototypeOf(document.createElement('canvas')) as { getContext(type: string): unknown };
    vi.spyOn(canvas, 'getContext').mockImplementation((type) => (type === 'webgl2' ? fakeWebgl2() : recording));
    // An empty chart: the price axis labels its default range with fractions.
    chart({ localization: { locale: 'ar-EG' }, plugins: [core.localization()] }, container);
    vi.restoreAllMocks();
    expect(texts.join('')).toMatch(/[٠-٩]/);
    expect(texts.filter((t) => /[0-9]/.test(t))).toEqual([]);
  });

  it('a localization() install that throws leaves the chart in English and without the plugin', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = chart();
    // Options are checked at the call, so only one changed behind the chart's back gets this far.
    (c.options.localization as { locale?: string }).locale = 'not a locale!';
    expect(() => c.install(core.localization())).toThrow(RangeError);
    expect(c.installedPlugins).toEqual([]);
    expect(c.localization).toBe(core.englishLocalizer);
    // No localizer maker was left behind: a valid option changes nothing without the plugin.
    c.applyOptions({ localization: { locale: 'de-DE' } });
    expect(c.localization).toBe(core.englishLocalizer);
    warn.mockRestore();
  });

  it('localization() given at creation applies the option there', () => {
    const c = chart({ plugins: [core.localization()], localization: { locale: 'de-DE' } });
    expect(c.installedPlugins).toEqual(['@chart-on/core/localization']);
    expect(c.localization.locale).toBe('de-DE');
    expect(c.localization.number(1.5, 1)).toBe('1,5');
  });

  it('stops the timer of a playing replay on destroy without reporting', () => {
    vi.useFakeTimers();
    const c = chart({ plugins: [core.replay()] });
    c.addCandles({ animate: false }).setData(Array.from({ length: 5 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    c.replay.start(60);
    c.replay.play();
    const changes = vi.fn();
    c.on('replay:change', changes);
    c.destroy();
    vi.runAllTimers();
    expect(changes).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('installs a plugin later, and uninstalling takes it back', () => {
    const c = chart();
    const uninstall = c.install(core.heatmap());
    expect(c.addHeatmap().kind).toBe('heatmap');
    uninstall();
    expect(thrown(() => c.addHeatmap()).code).toBe('not-registered');
    const removeDepth = c.install(core.depthLane());
    expect(c.addDepthLane({ width: 60 }).options.width).toBe(60);
    removeDepth();
    expect(thrown(() => c.addDepthLane()).code).toBe('not-registered');
  });

  it('lays out primitive lanes only with the depthLane() plugin', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = chart();
    c.addCandles().setData([{ time: 0, open: 1, high: 2, low: 0, close: 1 }]);
    draw(c);
    const plotWidth = c.plotWidth;
    const drawLane = vi.fn();
    c.attachPrimitive({ lane: () => ({ side: 'right', width: 50 }), drawLane });
    c.attachPrimitive({ lane: () => null });
    draw(c);
    // Without the lane host: no space, nothing drawn, and one warning.
    expect(c.plotWidth).toBe(plotWidth);
    expect(drawLane).not.toHaveBeenCalled();
    expect(warn.mock.calls.filter(([message]) => String(message).includes('lanes-missing'))).toHaveLength(1);
    const uninstall = c.install(core.depthLane());
    draw(c);
    expect(c.plotWidth).toBe(plotWidth - 50);
    expect(drawLane).toHaveBeenCalled();
    uninstall();
    draw(c);
    expect(c.plotWidth).toBe(plotWidth);
    warn.mockRestore();
  });

  it('keeps the draw actions in step with the tools', () => {
    const c = chart({ plugins: [core.drawingTools([tool('trendline')])] });
    expect(c.actions.has('draw-trendline')).toBe(true);
    expect(c.actions.keys('draw-trendline')).toEqual([]);
    c.drawings.register(tool('hline'));
    expect(c.actions.has('draw-hline')).toBe(true);
    expect(c.actions.run('draw-hline')).toBe(true);
    expect(c.drawings.tool).toBe('hline');
    c.drawings.unregister('hline');
    expect(c.actions.has('draw-hline')).toBe(false);
    c.uninstall('@chart-on/core/drawings');
    expect(c.actions.has('draw-trendline')).toBe(false);
    expect(c.actions.has('delete-drawings')).toBe(false);
    expect(thrown(() => c.drawings).code).toBe('not-registered');
  });

  it('has an empty undo history without drawings or indicators, and the same one once they make steps', () => {
    const c = chart();
    const history = c.history;
    const changes: unknown[] = [];
    c.on('history:change', (e) => changes.push(e));
    expect([history.canUndo, history.canRedo, history.undo(), history.redo()]).toEqual([false, false, false, false]);
    history.clear();
    expect(changes).toEqual([]);
    c.addCandles().setData(Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    const uninstall = c.install(core.drawingTools());
    c.drawings.add({ type: 'hline', pane: 0, points: [{ time: 300, price: 1 }], style: {} });
    expect(c.history).toBe(history);
    expect(history.canUndo).toBe(true);
    expect(changes).toEqual([{ canUndo: true, canRedo: false }]);
    expect(history.undo()).toBe(true);
    expect(c.drawings.getAll()).toEqual([]);
    expect([history.canUndo, history.canRedo]).toEqual([false, true]);
    // The plugin's steps go with it.
    uninstall();
    expect([history.canUndo, history.canRedo]).toEqual([false, false]);
  });

  describe('the undo history shared by drawings and indicators', () => {
    const closeDef = {
      id: 'close',
      name: 'Close',
      placement: 'pane' as const,
      inputs: [],
      plots: [{ id: 'v', type: 'line' as const }],
      compute: (src: { close: ArrayLike<number> }) => ({ v: Float64Array.from(src.close) }),
    };
    const bars = Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 }));
    const hline = { type: 'hline', pane: 0, points: [{ time: 300, price: 1 }], style: {} };

    it('joins drawings installed after indicators into one ordered stack', () => {
      const c = chart({ plugins: [core.indicators()] });
      c.addCandles().setData(bars);
      const ind = c.indicators.add(closeDef);
      c.install(core.drawingTools());
      const line = c.drawings.add(hline);
      expect(c.history.undo()).toBe(true);
      expect(c.drawings.getAll().map((d) => d.id)).not.toContain(line.id);
      expect(c.indicators.getAll()).toEqual([ind]);
      expect(c.history.undo()).toBe(true);
      expect(c.indicators.getAll()).toEqual([]);
      expect(c.history.canUndo).toBe(false);
      expect(c.history.redo()).toBe(true);
      expect(c.indicators.getAll()).toHaveLength(1);
      expect(c.history.redo()).toBe(true);
      expect(c.drawings.getAll()).toHaveLength(1);
    });

    it('joins indicators installed after drawings into one ordered stack', () => {
      const c = chart({ plugins: [core.drawingTools()] });
      c.addCandles().setData(bars);
      c.drawings.add(hline);
      c.install(core.indicators());
      c.indicators.add(closeDef);
      expect(c.history.undo()).toBe(true);
      expect(c.indicators.getAll()).toEqual([]);
      expect(c.drawings.getAll()).toHaveLength(1);
      expect(c.history.undo()).toBe(true);
      expect(c.drawings.getAll()).toEqual([]);
      expect(c.history.canUndo).toBe(false);
    });

    it('drops the indicator steps, moves included, when indicators go, and keeps the drawing steps', () => {
      const c = chart({ plugins: [core.drawingTools()] });
      c.addCandles().setData(bars);
      const uninstall = c.install(core.indicators());
      const ind = c.indicators.add(closeDef);
      c.drawings.add(hline);
      c.moveSeries(ind.series!, 'above');
      uninstall();
      // The move and the add were the indicators'; the drawing's step stays.
      expect(c.history.canUndo).toBe(true);
      expect(c.history.undo()).toBe(true);
      expect(c.drawings.getAll()).toEqual([]);
      expect(c.history.canUndo).toBe(false);
    });
  });

  it('adds drawings later, and takes them away with the plugin', () => {
    const c = chart({ plugins: [core.layouts()], access: { allow: (item) => item.kind !== 'drawing' || item.id === 'hline' } });
    c.addCandles().setData(Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    const uninstall = c.install(core.drawingTools());
    // The access rule set before the plugin applies to its tools.
    expect(c.drawings.isToolAllowed('hline')).toBe(true);
    expect(c.drawings.isToolAllowed('trendline')).toBe(false);
    c.drawings.add({ type: 'hline', pane: 0, points: [{ time: 300, price: 1 }], style: {} });
    expect(c.serializeLayout().drawings?.drawings).toHaveLength(1);
    uninstall();
    expect(thrown(() => c.drawings).code).toBe('not-registered');
    expect(c.actions.has('draw-hline')).toBe(false);
    draw(c);
  });

  it('a chart without annotations throws for them, and one installed later takes what came before', () => {
    const c = chart();
    const error = thrown(() => c.annotations);
    expect(error.code).toBe('not-registered');
    expect(error.message).toContain('annotations()');
    expect(error.context).toEqual({ call: 'annotations', plugin: 'annotations()' });
    const series = c.addCandles();
    series.setData(Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    // An indicator's shape plots, before there is anywhere to draw them.
    const shapes = [{ time: 60, shape: 'circle' as const }];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    c.setPlotMarkers(series, shapes);
    c.setPlotMarkers(series, shapes);
    // Once, in development builds, naming the plugin.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('charton [annotations-missing]: Indicator shape plots draw through annotations');
    warn.mockRestore();
    draw(c);
    const fed = vi.spyOn(core.AnnotationManager.prototype, 'setPlotMarkers');
    const uninstall = c.install(core.annotations());
    expect(fed).toHaveBeenCalledWith(series, shapes);
    c.annotations.setMarkers([{ time: 120, shape: 'circle' }]);
    const line = c.annotations.addPriceLine({ price: 1 });
    expect(c.annotations.priceLines).toEqual([line]);
    draw(c);
    uninstall();
    expect(thrown(() => c.annotations).code).toBe('not-registered');
    draw(c);
  });

  it('trade fills need trading(), which needs annotations and can come later', () => {
    const fill = { id: 'f1', time: 60, side: 'buy' as const, price: 1, quantity: 2 };
    const c = chart({ plugins: [core.annotations()] });
    const error = thrown(() => c.annotations.setTrades([fill]));
    expect(error.code).toBe('not-registered');
    expect(error.context).toEqual({ call: 'annotations.setTrades', plugin: 'trading()' });
    expect(thrown(() => c.annotations.syncTrades({ trades: [] })).code).toBe('not-registered');
    expect(thrown(() => chart().install(core.trading())).context).toEqual({ call: 'trading()', plugin: 'annotations()' });
    const uninstall = c.install(core.trading());
    c.annotations.setTrades([fill]);
    expect(c.annotations.getTrades()).toEqual([fill]);
    draw(c);
    uninstall();
    expect(thrown(() => c.annotations.getTrades()).code).toBe('not-registered');
    // Installed again, it starts empty: fills are never saved.
    c.install(core.trading());
    expect(c.annotations.getTrades()).toEqual([]);
    expect(chart({ plugins: core.builtins() }).annotations.tradeGroups).toEqual([]);
  });

  it('order, position, alert and draft lines need trading(); price lines do not', () => {
    const c = chart({ plugins: [core.annotations()] });
    const calls: [string, () => unknown][] = [
      ['addTradeLine', () => c.annotations.addTradeLine({ price: 1, side: 'buy' })],
      ['addAlertLine', () => c.annotations.addAlertLine({ price: 1 })],
      ['startOrderDraft', () => c.annotations.startOrderDraft({ price: 1, side: 'buy' })],
      ['syncTrades', () => c.annotations.syncTrades({ orders: [{ price: 1, side: 'buy' }] })],
    ];
    for (const [call, run] of calls) expect(thrown(run).context).toEqual({ call: `annotations.${call}`, plugin: 'trading()' });
    // Reads answer empty: there are no such lines without the plugin.
    expect([c.annotations.tradeLines, c.annotations.alertLines, c.annotations.draftLines]).toEqual([[], [], []]);
    expect(c.annotations.alertsCrossed(0, 2)).toEqual([]);
    const price = c.annotations.addPriceLine({ price: 1 });
    const uninstall = c.install(core.trading());
    const order = c.annotations.addTradeLine({ price: 1, side: 'buy', onDrag: () => {} });
    const alert = c.annotations.addAlertLine({ price: 1 });
    expect(c.annotations.tradeLines).toEqual([order]);
    expect(c.annotations.alertsCrossed(0, 2)).toEqual([{ line: alert, direction: 'up' }]);
    draw(c);
    uninstall();
    expect(c.annotations.tradeLines).toEqual([]);
    expect(c.annotations.priceLines).toEqual([price]);
    draw(c);
    // Installed again, it starts empty: annotations are never saved.
    c.install(core.trading());
    expect(c.annotations.alertLines).toEqual([]);
  });

  it('keeps a layout\'s drawings on a chart without drawings, and saves them back untouched', () => {
    const full = chart({ plugins: [core.layouts(), core.drawingTools()] });
    full.drawings.add({ type: 'hline', pane: 0, points: [{ time: 300, price: 1 }], style: {} });
    full.drawings.setToolDefaults('hline', { color: '#ff0000' });
    const saved = full.serializeLayout();
    const plain = chart({ plugins: [core.layouts()] });
    const result = plain.loadLayout(saved);
    expect(result.errors.map((e) => e.part)).toEqual(['drawings']);
    // Kept for the missing plugin, not unknown.
    expect(result.unknown).toEqual([]);
    const again = plain.serializeLayout();
    expect(again.drawings).toEqual(saved.drawings);
    expect(again.toolDefaults).toEqual(saved.toolDefaults);
    expect(plain.serializeLayout({ drawings: false }).drawings).toBeUndefined();
    // Back on a chart with drawings, they are all there.
    const other = chart({ plugins: [core.layouts(), core.drawingTools()] });
    expect(other.loadLayout(again).errors).toEqual([]);
    expect(other.drawings.getAll().map((d) => d.type)).toEqual(['hline']);
    expect(other.drawings.toolDefaults('hline').color).toBe('#ff0000');
    // Or once the plain chart gets drawings.
    plain.install(core.drawingTools());
    expect(plain.drawings.getAll().map((d) => d.type)).toEqual(['hline']);
    expect(plain.serializeLayout().drawings?.drawings).toHaveLength(1);
  });

  it('ends the tool, selection and gestures when drawings are uninstalled', () => {
    const c = chart({ plugins: [core.drawingTools()] });
    c.addCandles().setData(Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    const manager = c.drawings;
    const line = manager.add({ type: 'hline', pane: 0, points: [{ time: 300, price: 1 }], style: {} });
    manager.select(line.id);
    manager.setTool('trendline');
    c.uninstall('@chart-on/core/drawings');
    expect(manager.tool).toBeNull();
    expect(manager.selection).toEqual([]);
    expect(manager.isBusy).toBe(false);
  });

  it('uninstalls drawings and a plugin with tools in either order, and gives the tools back with drawings', () => {
    const mark = { ...tool('hline'), type: 'mark' };
    const marks = { name: 'marks', version: '1.0.0', install: (ctx: { registerDrawingTool(t: DrawingToolDef): void }) => ctx.registerDrawingTool(mark) };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const types = (c: { drawings: { getTools(): DrawingToolDef[] } }) => c.drawings.getTools().map((t) => t.type);
    // Drawings first: the plugin's undo finds nothing to take the tool from.
    const a = chart({ plugins: [core.drawings(), marks] });
    a.uninstall('@chart-on/core/drawings');
    a.install(core.drawings());
    expect(types(a)).toEqual(['mark']);
    a.uninstall('@chart-on/core/drawings');
    a.uninstall('marks');
    a.install(core.drawings());
    expect(types(a)).toEqual([]);
    // The plugin first.
    const b = chart({ plugins: [core.drawings(), marks] });
    b.uninstall('marks');
    expect(types(b)).toEqual([]);
    b.uninstall('@chart-on/core/drawings');
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('takes one drawings plugin per chart', () => {
    const c = chart({ plugins: [core.drawingTools()] });
    expect(() => c.install(core.drawings())).toThrow('already installed');
  });

  it('reports saved drawings a chart without drawings cannot load, and skips tool defaults', () => {
    const full = chart({ plugins: [core.layouts(), core.drawingTools()] });
    full.drawings.add({ type: 'hline', pane: 0, points: [{ time: 300, price: 1 }], style: {} });
    const layout = full.serializeLayout();
    const plain = chart({ plugins: [core.layouts()] });
    const { errors } = plain.loadLayout(layout);
    expect(errors.map((e) => e.part)).toEqual(['drawings']);
    expect(errors[0]!.reason).toContain('drawingTools()');
  });

  it('autosaves a chart without drawings, keeping a loaded layout\'s drawings as saved', async () => {
    const full = chart({ plugins: [core.layouts(), core.drawingTools()] });
    full.drawings.add({ type: 'hline', pane: 0, points: [{ time: 300, price: 1 }], style: {} });
    const layout = full.serializeLayout();
    const plain = chart({ plugins: [core.layouts()] });
    plain.loadLayout(layout);
    const save = vi.fn();
    const onError = vi.fn();
    const saver = core.autosave(plain, { save, onError, flushTarget: null });
    plain.applyOptions({ grid: { vertical: { visible: false } } });
    await saver.flush();
    expect(onError).not.toHaveBeenCalled();
    expect(save.mock.calls[0]![0].drawings).toEqual(layout.drawings);
    expect(save.mock.calls[0]![1]).toEqual(['options']);
    // Leaving drawings out works without the plugin too.
    const bare = core.autosave(plain, { save, onError, serialize: { drawings: false }, flushTarget: null });
    plain.applyOptions({ grid: { vertical: { visible: true } } });
    await bare.flush();
    expect(onError).not.toHaveBeenCalled();
    expect(save.mock.calls.at(-1)![0].drawings).toBeUndefined();
    saver.stop();
    bare.stop();
  });

  it('needs drawings for per-symbol storage and for tools a plugin registers', () => {
    const c = chart();
    expect(thrown(() => core.perSymbolDrawings(c, {})).code).toBe('not-registered');
    const mark = { ...tool('hline'), type: 'mark' };
    const plugin = { name: 'marks', version: '1.0.0', install: (ctx: { registerDrawingTool(t: DrawingToolDef): void }) => ctx.registerDrawingTool(mark) };
    expect(thrown(() => c.install(plugin)).code).toBe('not-registered');
    expect(c.installedPlugins).toEqual([]);
  });

  it('keeps saved drawings of a missing tool, and leaves out ones too short for it once it is there', () => {
    const c = chart({ plugins: [core.drawings()] });
    c.addCandles().setData(Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    const point = { time: 300, price: 1 };
    const saved = {
      version: core.DRAWINGS_VERSION,
      drawings: [
        { id: 'line', type: 'hline', pane: 0, points: [point], style: {} },
        // Checked against one point while the tool was missing; a channel needs three.
        { id: 'short', type: 'parallel-channel', pane: 0, points: [point], style: {} },
      ],
    };
    expect(c.drawings.load(saved)).toEqual({ loaded: 2, errors: [] });
    // A three-point tool that would read points the drawing does not have.
    const render = vi.fn();
    const hitTest = vi.fn(() => false);
    c.drawings.register({ ...tool('parallel-channel'), render, hitTest });
    expect(c.drawings.getAll().map((d) => d.id)).toEqual(['line', 'short']);
    c.drawings.select('short');
    const ctx = document.createElement('canvas').getContext('2d')!;
    c.drawings.render(ctx, 0, 800, 600);
    c.drawings.drawingAt({ x: 100, y: 100 });
    c.drawings.hitRuns(50);
    expect(render).not.toHaveBeenCalled();
    expect(hitTest).not.toHaveBeenCalled();
    // Still saved as it was.
    expect(c.drawings.serialize().drawings.map((d) => d.id)).toEqual(['line', 'short']);
  });

  it('builds the heatmap program in addHeatmap, so a shader failure throws from the call', () => {
    const gl = countingWebgl2();
    const c = chart({ plugins: [core.heatmap()] }, fakeContainer({ webgl: gl.context }));
    const vaos = gl.created.vertexArray;
    c.addHeatmap();
    // The program's quad, made once per renderer.
    expect(gl.created.vertexArray).toBe(vaos + 1);
    c.addHeatmap();
    expect(gl.created.vertexArray).toBe(vaos + 1);
    // A context whose shaders stop compiling once the chart's own programs are built.
    let broken = false;
    const base = fakeWebgl2() as Record<string, unknown>;
    const context = new Proxy({}, { get: (_t, key: string) => (key === 'getShaderParameter' ? () => !broken : base[key]) });
    const failing = chart({ plugins: [core.heatmap()] }, fakeContainer({ webgl: context }));
    broken = true;
    expect(thrown(() => failing.addHeatmap()).code).toBe('webgl-shader');
    expect(failing.panes[0]!.series.some((s) => s.kind === 'heatmap')).toBe(false);
  });

  it('a plugin that fails at creation destroys the chart and throws', () => {
    const container = fakeContainer();
    const broken = { name: 'broken', version: '1.0.0', install: () => { throw new Error('nope'); } };
    expect(() => core.createChart(container, { plugins: [broken] })).toThrow('nope');
    expect((container as unknown as { children: unknown[] }).children).toHaveLength(0);
  });
});
