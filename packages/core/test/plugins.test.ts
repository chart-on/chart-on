import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { drawings, indicators } from '../src/builtins';
import { ChartError } from '../src/errors';
import type { ChartPlugin } from '../src/plugins';
import type { DrawingToolDef } from '../src/drawing/types';
import { builtinTools } from '../src/drawing/tools';
import type { IndicatorDef } from '../src/indicators/types';
import type { CustomSeriesDef } from '../src/series';
import type { Primitive } from '../src/primitives';
import { CORE_VERSION } from '../src/version';

// The tool contributions need drawings, which the charts here get from the `drawings()` plugin.
const DRAWINGS = '@chart-on/core/drawings';
const INDICATORS = '@chart-on/core/indicators';
const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart() {
  const c = new Chart(fakeContainer(), { plugins: [indicators(), drawings()] });
  charts.push(c);
  return c;
}

const tool: DrawingToolDef = {
  type: 'test-mark',
  points: 1,
  draw: () => {},
  hitTest: () => false,
} as unknown as DrawingToolDef;

const indicator: IndicatorDef = {
  id: 'test/half',
  name: 'Half',
  placement: 'pane',
  inputs: [],
  plots: [{ id: 'value', type: 'line' }],
  compute: (src) => ({ value: src.close.map((v) => v / 2) }),
};

const band: CustomSeriesDef<{ time: number }, object> = { type: 'test-band', draw: () => {}, priceRange: () => null };

function plugin(overrides: Partial<ChartPlugin> = {}): ChartPlugin & { disposed: ReturnType<typeof vi.fn>; primitive: Primitive } {
  const disposed = vi.fn();
  const primitive: Primitive = { drawPlot: () => {} } as Primitive;
  return {
    name: 'test-kit',
    version: '1.0.0',
    requires: `^${CORE_VERSION}`,
    install(ctx) {
      ctx.registerDrawingTool(tool);
      ctx.registerIndicator(indicator);
      ctx.addCustomSeries(band, { title: 'Band' });
      ctx.attachPrimitive(primitive);
      return disposed;
    },
    disposed,
    primitive,
    ...overrides,
  };
}

const hasTool = (c: Chart) => c.drawings.getTools().some((t) => t.type === 'test-mark');
const hasIndicator = (c: Chart) => c.indicators.getDefinitions().some((d) => d.id === 'test/half');
const bandSeries = (c: Chart) => c.panes[0]!.series.filter((s) => s.kind === 'custom');

describe('chart.install', () => {
  it('registers every contribution and uninstall removes them all', () => {
    const c = chart();
    const p = plugin();
    const detach = vi.spyOn(c, 'attachPrimitive');
    const uninstall = c.install(p);
    expect(c.installedPlugins).toEqual([INDICATORS, DRAWINGS, 'test-kit']);
    expect(hasTool(c)).toBe(true);
    expect(hasIndicator(c)).toBe(true);
    expect(bandSeries(c)).toHaveLength(1);
    expect(detach).toHaveBeenCalledWith(p.primitive, undefined);
    uninstall();
    expect(p.disposed).toHaveBeenCalledTimes(1);
    expect(hasTool(c)).toBe(false);
    expect(hasIndicator(c)).toBe(false);
    expect(bandSeries(c)).toHaveLength(0);
    expect(c.installedPlugins).toEqual([INDICATORS, DRAWINGS]);
    // Uninstalling again does nothing.
    uninstall();
    expect(c.uninstall('test-kit')).toBe(false);
    expect(p.disposed).toHaveBeenCalledTimes(1);
  });

  it('leaves nothing behind when install throws', () => {
    const c = chart();
    const failing = plugin({
      install(ctx) {
        ctx.registerDrawingTool(tool);
        ctx.registerIndicator(indicator);
        throw new Error('boom');
      },
    });
    expect(() => c.install(failing)).toThrow('boom');
    expect(hasTool(c)).toBe(false);
    expect(hasIndicator(c)).toBe(false);
    expect(c.installedPlugins).toEqual([INDICATORS, DRAWINGS]);
    // It can be installed once fixed.
    c.install(plugin());
    expect(hasTool(c)).toBe(true);
  });

  it('rejects a core version outside its range', () => {
    const c = chart();
    let error: unknown;
    try {
      c.install(plugin({ requires: '>=99.0.0' }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ChartError);
    expect((error as ChartError).code).toBe('plugin-incompatible');
    expect((error as ChartError).context).toMatchObject({ plugin: 'test-kit', requires: '>=99.0.0', coreVersion: CORE_VERSION });
    expect(() => c.install(plugin({ requires: 'next' }))).toThrow(/invalid requires/);
    expect(hasTool(c)).toBe(false);
  });

  it('refuses a second plugin of the same name', () => {
    const c = chart();
    c.install(plugin());
    expect(() => c.install(plugin())).toThrow(/already installed/);
  });

  it('gives back a tool it replaced, and keeps a definition the app registered', () => {
    const c = chart();
    const builtin = builtinTools.find((t) => t.type === 'hline')!;
    c.drawings.register(builtin);
    c.indicators.register(indicator);
    c.install(
      plugin({
        install(ctx) {
          ctx.registerDrawingTool({ ...builtin, label: 'Mine' } as DrawingToolDef);
          ctx.registerIndicator(indicator);
        },
      }),
    );
    expect(c.drawings.getTools().find((t) => t.type === 'hline')).not.toBe(builtin);
    c.uninstall('test-kit');
    expect(c.drawings.getTools().find((t) => t.type === 'hline')).toBe(builtin);
    expect(hasIndicator(c)).toBe(true);
  });

  it('uninstalls every plugin on destroy, newest first', () => {
    const c = chart();
    const order: string[] = [];
    for (const name of ['a', 'b']) c.install({ name, version: '1.0.0', install: () => () => order.push(name) });
    c.destroy();
    expect(order).toEqual(['b', 'a']);
    expect(() => c.install(plugin())).toThrow(/destroy/);
  });
});

describe('frame observers', () => {
  it('see what asked for a frame and each phase of it, until uninstall', () => {
    const c = chart();
    c.addCandles({ animate: false }).setData([{ time: 0, open: 1, high: 2, low: 0, close: 1 }]);
    const steps: string[] = [];
    const remove = c.install({
      name: 'frame-watch',
      version: '1.0.0',
      install: (ctx) =>
        ctx.onFrame({
          request: (reason) => steps.push(`request ${reason}`),
          start: () => steps.push('start'),
          lap: (phase) => steps.push(phase ?? 'between'),
          end: (kind) => steps.push(`end ${kind}`),
        }),
    });
    const render = () => (c as unknown as { render(dt: number): boolean }).render(0);
    c.invalidate();
    render();
    expect(steps).toEqual(['request host', 'start', 'between', 'autoscale', 'drawBottom', 'drawGL', 'between', 'drawTop', 'drawCursor', 'end scene']);
    steps.length = 0;
    c.invalidateOverlay();
    render();
    expect(steps).toEqual(['request host', 'start', 'drawTop', 'drawCursor', 'end overlay']);
    remove();
    steps.length = 0;
    c.invalidate();
    render();
    expect(steps).toEqual([]);
  });
});

describe('drawings.unregister', () => {
  it('drops the active tool back to the cursor', () => {
    const c = chart();
    c.drawings.register(tool);
    c.drawings.setTool('test-mark');
    c.drawings.unregister('test-mark');
    expect(c.drawings.tool).toBeNull();
    expect(hasTool(c)).toBe(false);
  });
});

describe('plugin hosts', () => {
  it('offers what a layer registered, to plugins installed afterwards', () => {
    const c = chart();
    const seen: unknown[] = [];
    const probe = (name: string): ChartPlugin => ({ name, version: '1.0.0', install: (ctx) => void seen.push(ctx.host('shell')) });
    c.install(probe('before'));
    const shell = { addToolbarItem: () => () => {} };
    c.setPluginHost('shell', shell);
    c.install(probe('after'));
    c.setPluginHost('shell', null);
    c.install(probe('withdrawn'));
    expect(seen).toEqual([undefined, shell, undefined]);
  });
});
