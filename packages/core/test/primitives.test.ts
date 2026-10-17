import { describe, expect, it, vi } from 'vitest';
import { PrimitiveRegistry, crisp, crispLine, resolvePrimitivePane, type Primitive, type PrimitiveEnv } from '../src/primitives';
import { Pane } from '../src/pane';
import type { Series } from '../src/series';

const pane = (id = 0) => new Pane(id, { stretch: 1, marginTop: 0, marginBottom: 0 });

describe('PrimitiveRegistry', () => {
  it('runs the attach / detach lifecycle and requests redraws', () => {
    const redraw = vi.fn();
    const registry = new PrimitiveRegistry(redraw);
    const p = pane();
    const primitive: Primitive = { attached: vi.fn(), detached: vi.fn() };
    const detach = registry.attach(primitive, p, null);
    expect(primitive.attached).toHaveBeenCalledWith(expect.objectContaining({ pane: p, series: null }));
    expect(redraw).toHaveBeenCalledTimes(1);
    // The host's requestRedraw goes to the chart.
    vi.mocked(primitive.attached!).mock.calls[0]![0].requestRedraw();
    expect(redraw).toHaveBeenCalledTimes(2);
    expect(() => registry.attach(primitive, p, null)).toThrow(/already/);
    detach();
    expect(primitive.detached).toHaveBeenCalledTimes(1);
    expect(registry.all).toHaveLength(0);
    detach();
    expect(primitive.detached).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale detach handle after the primitive is attached again', () => {
    const registry = new PrimitiveRegistry(() => {});
    const primitive: Primitive = { detached: vi.fn() };
    const first = registry.attach(primitive, pane(), null);
    first();
    const second = registry.attach(primitive, pane(), null);
    first();
    expect(registry.all.map((e) => e.primitive)).toEqual([primitive]);
    expect(primitive.detached).toHaveBeenCalledTimes(1);
    second();
    expect(registry.all).toHaveLength(0);
    expect(primitive.detached).toHaveBeenCalledTimes(2);
  });

  it('rolls back the attachment when attached() throws', () => {
    const redraw = vi.fn();
    const registry = new PrimitiveRegistry(redraw);
    const error = new Error('boom');
    const primitive: Primitive = {
      attached: vi.fn(() => {
        throw error;
      }),
      detached: vi.fn(),
    };
    expect(() => registry.attach(primitive, pane(), null)).toThrow(error);
    expect(registry.all).toHaveLength(0);
    expect(primitive.detached).not.toHaveBeenCalled();
    expect(redraw).not.toHaveBeenCalled();
    // Not left half-registered: it can be attached again.
    vi.mocked(primitive.attached!).mockImplementation(() => {});
    registry.attach(primitive, pane(), null);
    expect(registry.all.map((e) => e.primitive)).toEqual([primitive]);
  });

  it('detaches everything matching, e.g. a removed pane', () => {
    const registry = new PrimitiveRegistry(() => {});
    const [a, b] = [pane(0), pane(1)];
    const onA: Primitive = { detached: vi.fn() };
    const onB: Primitive = { detached: vi.fn() };
    registry.attach(onA, a, null);
    registry.attach(onB, b, null);
    registry.detachWhere((e) => e.pane === b);
    expect(onB.detached).toHaveBeenCalled();
    expect(onA.detached).not.toHaveBeenCalled();
    expect(registry.all.map((e) => e.primitive)).toEqual([onA]);
  });

  it('detaches everything on dispose and stops redraw requests', () => {
    const redraw = vi.fn();
    const registry = new PrimitiveRegistry(redraw);
    const a: Primitive = { attached: vi.fn(), detached: vi.fn() };
    const b: Primitive = { detached: vi.fn() };
    registry.attach(a, pane(0), null);
    registry.attach(b, pane(1), null);
    const host = vi.mocked(a.attached!).mock.calls[0]![0];
    redraw.mockClear();
    registry.dispose();
    expect(a.detached).toHaveBeenCalledTimes(1);
    expect(b.detached).toHaveBeenCalledTimes(1);
    expect(registry.all).toHaveLength(0);
    // A leftover timer in the primitive must not schedule frames on a dead chart.
    host.requestRedraw();
    expect(redraw).not.toHaveBeenCalled();
  });

  it('orders layers and hit testing', () => {
    const registry = new PrimitiveRegistry(() => {});
    const p = pane();
    const below: Primitive = { layer: 'below' };
    const normal1: Primitive = {};
    const top: Primitive = { layer: 'top' };
    const normal2: Primitive = { layer: 'normal' };
    for (const x of [below, normal1, top, normal2]) registry.attach(x, p, null);
    registry.attach({}, pane(1), null);
    expect(registry.layer(p, 'normal').map((e) => e.primitive)).toEqual([normal1, normal2]);
    expect(registry.layer(p, 'below').map((e) => e.primitive)).toEqual([below]);
    expect(registry.topDown(p).map((e) => e.primitive)).toEqual([top, normal2, normal1, below]);
  });

  it('hit tests top-down and skips primitives on hidden series', () => {
    const registry = new PrimitiveRegistry(() => {});
    const p = pane();
    const series = { pane: p, visible: true } as unknown as Series;
    const onPane: Primitive = { hitTest: () => ({ cursor: 'pointer', part: 'pane' }) };
    const onSeries: Primitive = { layer: 'top', hitTest: vi.fn(() => ({ cursor: 'ns-resize', part: 'line' })) };
    registry.attach(onPane, p, null);
    registry.attach(onSeries, p, series);
    const env = vi.fn(() => ({}) as PrimitiveEnv);
    expect(registry.hitTest(p, { x: 1, y: 1 }, env)).toEqual({ primitive: onSeries, hit: { cursor: 'ns-resize', part: 'line' } });
    // Hidden: not drawn, so it can't be hovered or grabbed; the pane primitive below gets the hit.
    series.visible = false;
    vi.mocked(onSeries.hitTest!).mockClear();
    expect(registry.hitTest(p, { x: 1, y: 1 }, env)).toEqual({ primitive: onPane, hit: { cursor: 'pointer', part: 'pane' } });
    expect(onSeries.hitTest).not.toHaveBeenCalled();
    registry.detach(onPane);
    expect(registry.hitTest(p, { x: 1, y: 1 }, env)).toBeNull();
  });

  it('merges autoscale contributions', () => {
    const registry = new PrimitiveRegistry(() => {});
    const p = pane();
    const fixed: Primitive = { priceRange: () => [90, 120] };
    const visibleOnly: Primitive = { priceRange: (from, to) => (to < 10 ? null : [from, to]) };
    registry.attach(fixed, p, null);
    registry.attach(visibleOnly, p, null);
    registry.attach({ priceRange: () => [5, 1] }, p, null); // invalid: ignored
    expect(registry.mergeRange(registry.all, 0, 5, null)).toEqual([90, 120]);
    expect(registry.mergeRange(registry.all, 50, 200, [100, 110])).toEqual([50, 200]);
    expect(new PrimitiveRegistry(() => {}).mergeRange([], 0, 1, null)).toBeNull();
  });
});

describe('resolvePrimitivePane', () => {
  const [main, second] = [pane(0), pane(1)];
  const panes = [main, second];
  const seriesOn = (p: Pane) => {
    const series = { pane: p } as unknown as Series;
    p.series.push(series);
    return series;
  };

  it('defaults to the main pane only when no target is given', () => {
    expect(resolvePrimitivePane(panes, {})).toBe(main);
    expect(resolvePrimitivePane(panes, { pane: undefined })).toBe(main);
  });

  it('resolves pane indices, pane objects and series', () => {
    expect(resolvePrimitivePane(panes, { pane: 1 })).toBe(second);
    expect(resolvePrimitivePane(panes, { pane: second })).toBe(second);
    expect(resolvePrimitivePane(panes, { series: seriesOn(second) })).toBe(second);
  });

  it('throws for a pane index that does not exist instead of using the main pane', () => {
    // e.g. pane 1 after it was removed
    expect(() => resolvePrimitivePane([main], { pane: 1 })).toThrow(/no pane at index 1/);
    expect(() => resolvePrimitivePane(panes, { pane: -1 })).toThrow(/no pane at index -1/);
    expect(() => resolvePrimitivePane(panes, { pane: 0.5 })).toThrow(/no pane at index/);
  });

  it('throws for a pane or series pane that is not in the chart', () => {
    const foreign = pane(1);
    expect(() => resolvePrimitivePane(panes, { pane: foreign })).toThrow(/unknown pane/);
    expect(() => resolvePrimitivePane(panes, { series: seriesOn(foreign) })).toThrow(/unknown pane/);
  });

  it('throws for a series that was removed from its pane', () => {
    // removeSeries takes the series out of its pane but leaves `series.pane` set.
    const removed = { pane: second } as unknown as Series;
    expect(() => resolvePrimitivePane(panes, { series: removed })).toThrow(/unknown series/);
  });
});

describe('crisp lines', () => {
  it('snaps odd device widths to pixel centers and even ones to edges', () => {
    expect(crisp(10.2)).toBe(10.5);
    expect(crisp(10.2, 2)).toBe(10);
    expect(crisp(10.2, 1, 2)).toBe(10);
    expect(crisp(10.2, 1.5, 2)).toBe(10.25);
  });

  it('strokes axis-aligned lines on device pixels', () => {
    const calls: unknown[][] = [];
    const ctx = new Proxy({}, {
      get: (_t, k) => (...a: unknown[]) => calls.push([k, ...a]),
      set: (_t, k, v) => (calls.push(['set', k, v]), true),
    }) as CanvasRenderingContext2D;
    crispLine(ctx, 0, 10.2, 100, 10.2, 1, 1);
    expect(calls).toEqual([['set', 'lineWidth', 1], ['beginPath'], ['moveTo', 0, 10.5], ['lineTo', 100, 10.5], ['stroke']]);
  });
});
