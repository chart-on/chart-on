import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chart } from '../src/chart';
import { defaultChartFeatures, resolveFeatures, type ChartFeatures } from '../src/features';
import { ActionRegistry } from '../src/actions';
import { Interaction } from '../src/interaction';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';

type Handler = (e: Record<string, unknown>) => void;

const PLOT_W = 700;
const PLOT_H = 500;

/** Just enough of a chart for `Interaction`: real scales, stubbed drawings and rendering. */
function setup(flags: Partial<ChartFeatures> = {}) {
  const dom = new Map<string, Handler>();
  const events = new Map<string, () => void>();
  const root = {
    style: {} as Record<string, string>,
    addEventListener: (type: string, fn: Handler) => dom.set(type, fn),
    removeEventListener: (type: string) => dom.delete(type),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    focus() {},
    setPointerCapture() {},
    hasPointerCapture: () => false,
    releasePointerCapture() {},
  };
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: -200 });
  time.width = PLOT_W;
  time.barCount = 1000;
  const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  pane.height = PLOT_H;
  pane.price.height = PLOT_H;
  pane.price.fit(0, 100);
  const chart = {
    root,
    time,
    panes: [pane],
    features: { ...defaultChartFeatures, ...flags } as ChartFeatures,
    options: { inertia: true, smoothZoom: false, zoomAnchor: { plot: 'pointer', timeAxis: 'right-edge' } },
    plotWidth: PLOT_W,
    actions: new ActionRegistry(),
    localization: { text: (key: string) => key },
    plotHeight: PLOT_H,
    crosshair: null,
    drawingClipboardKey: () => false,
    drawingLayer: {
      tool: null as string | null,
      selected: null,
      pointerDown: () => false,
      pointerMove() {},
      pointerUp() {},
      keyDown: vi.fn(() => false),
      cursor: () => null,
      doubleClick() {},
    },
    annotationLayer: {
      pointerDown: () => false,
      pointerMove: vi.fn(),
      pointerUp() {},
      cancelGesture: () => false,
      timeMarkMove: () => false,
      timeMarkDown: () => false,
      keyDown: vi.fn(() => false),
      cursor: () => null,
    },
    on: (event: string, fn: () => void) => {
      events.set(event, fn);
      return () => events.delete(event);
    },
    plotLeft: 0,
    regionAt: (x: number, y: number) =>
      y >= PLOT_H
        ? { kind: 'timeAxis' }
        : x >= PLOT_W
          ? { kind: 'priceAxis', pane: 0, scale: pane.price }
          : { kind: 'plot', pane: 0 },
    paneIndexAt: () => 0,
    primitiveAt: () => null,
    plusButtonAt: () => false,
    hoverPlusButton: () => false,
    plusButtonEvent: () => null,
    openContextMenu: vi.fn((_x: number, _y: number, _cx: number, _cy: number) => false),
    legendSeriesAt: vi.fn((_target: unknown): unknown => null),
    openLegendMenu: vi.fn((_series: unknown, _cx: number, _cy: number) => false),
    clickSelect: vi.fn(),
    getSelection: () => null,
    setCrosshair: vi.fn(),
    updateHover: vi.fn(),
    redraw: vi.fn(),
    setAutoScale: vi.fn(),
    scrollToRealtime: vi.fn(),
    resetView: vi.fn(),
    moveSeparator: vi.fn(),
    pointAt: (x: number, y: number) => ({ x, y }),
    emit: vi.fn(),
  };
  const interaction = new Interaction(chart as unknown as Chart);

  const fire = (type: string, init: Record<string, unknown> = {}) => {
    const e = { preventDefault: vi.fn(), pointerId: 1, pointerType: 'mouse', button: 0, timeStamp: 0, ...init };
    dom.get(type)!(e);
    return e;
  };
  const at = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ clientX: x, clientY: y, ...extra });
  /** Press, move through `points` 10 ms apart, release. */
  const drag = (points: [number, number][], extra: Record<string, unknown> = {}) => {
    points.forEach(([x, y], i) => fire(i === 0 ? 'pointerdown' : 'pointermove', at(x, y, { timeStamp: i * 10, ...extra })));
    const [x, y] = points[points.length - 1]!;
    fire('pointerup', at(x, y, { timeStamp: (points.length - 1) * 10 + 5, ...extra }));
  };
  const pinch = (spread: number, extra: Record<string, unknown> = {}) => {
    const touch = { pointerType: 'touch', ...extra };
    fire('pointerdown', at(300, 200, { ...touch, pointerId: 1 }));
    fire('pointerdown', at(400, 200, { ...touch, pointerId: 2 }));
    fire('pointermove', at(400 + spread, 200, { ...touch, pointerId: 2 }));
    fire('pointerup', at(400 + spread, 200, { ...touch, pointerId: 2 }));
    fire('pointerup', at(300, 200, { ...touch, pointerId: 1 }));
  };
  const key = (k: string, extra: Record<string, unknown> = {}) => fire('keydown', { key: k, code: '', ...extra });
  /** What `chart.applyOptions({ features })` does. */
  const toggle = (next: Partial<ChartFeatures>) => {
    chart.features = { ...chart.features, ...next };
    interaction.featuresChanged();
  };
  const emit = (event: string) => events.get(event)?.();
  return { chart, time, pane, interaction, fire, at, drag, pinch, key, toggle, emit };
}

describe('resolveFeatures', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the current behaviour by default', () => {
    const f = resolveFeatures(defaultChartFeatures, {});
    expect(f).toEqual(defaultChartFeatures);
    expect(f.countdown).toBe(true);
    expect(f.watermark).toBe(false);
  });

  it('merges partial updates and ignores undefined values', () => {
    const a = resolveFeatures(defaultChartFeatures, { features: { legend: false } });
    const b = resolveFeatures(a, { features: { zoom: false, legend: undefined } });
    expect(b).toEqual({ ...defaultChartFeatures, legend: false, zoom: false });
    expect(defaultChartFeatures.legend).toBe(true);
  });

  it('takes `legend.visible`, with `features.legend` taking precedence', () => {
    expect(resolveFeatures(defaultChartFeatures, { legend: { visible: false } }).legend).toBe(false);
    expect(resolveFeatures(defaultChartFeatures, { legend: { visible: false }, features: { legend: true } }).legend).toBe(true);
  });

  it('ignores unknown flags (applyOptions warns about them in development builds)', () => {
    const f = resolveFeatures(defaultChartFeatures, {
      features: { legned: false, toString: false } as unknown as Partial<ChartFeatures>,
    });
    expect(f).toEqual(defaultChartFeatures);
  });
});

describe('interaction feature flags', () => {
  describe('scroll', () => {
    it('drag-pans the plot only when on', () => {
      const on = setup();
      on.drag([[400, 250], [300, 250]]);
      expect(on.time.rightOffset).not.toBe(-200);

      const off = setup({ scroll: false });
      off.drag([[400, 250], [300, 250]]);
      expect(off.time.rightOffset).toBe(-200);
      // The pointer still drives the crosshair.
      expect(off.chart.setCrosshair).toHaveBeenCalled();
    });

    it('still emits click for a press without travel when off', () => {
      const off = setup({ scroll: false });
      const up = { type: 'pointerup' };
      off.drag([[400, 250], [401, 250]], up);
      expect(off.chart.emit).toHaveBeenCalledWith('plot:click', { x: 400, y: 250 });
      off.drag([[400, 250], [300, 250]], up);
      expect(off.chart.emit).toHaveBeenCalledOnce();
      expect(off.interaction.step(16)).toBe(false);
    });

    it('pans on horizontal wheel only when on, otherwise leaves it to the page', () => {
      const on = setup();
      const e1 = on.fire('wheel', on.at(300, 200, { deltaX: 50, deltaY: 0, deltaMode: 0 }));
      expect(on.time.rightOffset).not.toBe(-200);
      expect(e1.preventDefault).toHaveBeenCalled();

      const off = setup({ scroll: false });
      const e2 = off.fire('wheel', off.at(300, 200, { deltaX: 50, deltaY: 0, deltaMode: 0 }));
      expect(off.time.rightOffset).toBe(-200);
      expect(e2.preventDefault).not.toHaveBeenCalled();
    });

    it('pans with the arrow keys only when on', () => {
      const on = setup();
      on.key('ArrowLeft');
      expect(on.time.rightOffset).not.toBe(-200);

      const off = setup({ scroll: false });
      const e = off.key('ArrowLeft');
      expect(off.time.rightOffset).toBe(-200);
      expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('blocks the view jumps that pan: time-axis double-click and Shift+End', () => {
      const off = setup({ scroll: false });
      off.fire('dblclick', off.at(300, 510));
      off.key('End', { shiftKey: true });
      expect(off.chart.scrollToRealtime).not.toHaveBeenCalled();
      expect(off.chart.resetView).not.toHaveBeenCalled();

      const noZoom = setup({ zoom: false });
      noZoom.key('End', { shiftKey: true });
      expect(noZoom.chart.resetView).not.toHaveBeenCalled();
    });
  });

  describe('zoom', () => {
    it('zooms on the wheel and trackpad pinch only when on', () => {
      const on = setup();
      on.fire('wheel', on.at(300, 200, { deltaX: 0, deltaY: -100, deltaMode: 0 }));
      expect(on.time.barSpacing).toBeGreaterThan(10);

      const off = setup({ zoom: false });
      const wheel = off.fire('wheel', off.at(300, 200, { deltaX: 0, deltaY: -100, deltaMode: 0 }));
      const ctrl = off.fire('wheel', off.at(300, 200, { deltaX: 0, deltaY: -20, deltaMode: 0, ctrlKey: true }));
      expect(off.time.barSpacing).toBe(10);
      expect(wheel.preventDefault).not.toHaveBeenCalled();
      expect(ctrl.preventDefault).not.toHaveBeenCalled();
    });

    it('zooms with + and - only when on', () => {
      const on = setup();
      on.key('+');
      expect(on.time.barSpacing).toBeGreaterThan(10);

      const off = setup({ zoom: false });
      off.key('+');
      off.key('-');
      expect(off.time.barSpacing).toBe(10);
    });

    it('zooms on a touch pinch only when on', () => {
      const on = setup();
      on.pinch(100);
      expect(on.time.barSpacing).toBeGreaterThan(10);

      const off = setup({ zoom: false });
      off.pinch(100);
      expect(off.time.barSpacing).toBe(10);
    });
  });

  describe('axisDragScale', () => {
    it('rescales the price axis by dragging only when on', () => {
      const on = setup();
      on.drag([[720, 200], [720, 260]]);
      expect(on.pane.price.autoScale).toBe(false);

      const off = setup({ axisDragScale: false });
      const { min, max } = off.pane.price;
      off.drag([[720, 200], [720, 260]]);
      expect(off.pane.price.autoScale).toBe(true);
      expect([off.pane.price.min, off.pane.price.max]).toEqual([min, max]);
    });

    it('rescales the time axis by dragging only when on', () => {
      const on = setup();
      on.drag([[300, 510], [360, 510]]);
      expect(on.time.barSpacing).not.toBe(10);

      const off = setup({ axisDragScale: false });
      off.drag([[300, 510], [360, 510]]);
      expect(off.time.barSpacing).toBe(10);
    });

    it('ignores price axis double-clicks and shows a plain cursor when off', () => {
      const on = setup();
      on.fire('dblclick', on.at(720, 200));
      expect(on.chart.setAutoScale).toHaveBeenCalledWith(true, 0, 'right');

      const off = setup({ axisDragScale: false });
      off.fire('dblclick', off.at(720, 200));
      off.fire('pointermove', off.at(720, 200));
      expect(off.chart.setAutoScale).not.toHaveBeenCalled();
      expect(off.chart.root.style.cursor).toBe('default');
    });

    it('keeps time-axis double-click under scroll only', () => {
      const off = setup({ axisDragScale: false });
      off.fire('dblclick', off.at(300, 510));
      expect(off.chart.scrollToRealtime).toHaveBeenCalled();
    });
  });

  describe('keyboard', () => {
    it('ignores every shortcut, including the drawing ones, when off', () => {
      const off = setup({ keyboard: false });
      const keys = [off.key('ArrowLeft'), off.key('+'), off.key('End', { shiftKey: true }), off.key('Escape')];
      expect(off.time.rightOffset).toBe(-200);
      expect(off.time.barSpacing).toBe(10);
      expect(off.chart.resetView).not.toHaveBeenCalled();
      expect(off.chart.drawingLayer.keyDown).not.toHaveBeenCalled();
      expect(off.chart.annotationLayer.keyDown).not.toHaveBeenCalled();
      for (const e of keys) expect(e.preventDefault).not.toHaveBeenCalled();

      const on = setup();
      on.key('Escape');
      on.key('End', { shiftKey: true });
      expect(on.chart.drawingLayer.keyDown).toHaveBeenCalled();
      expect(on.chart.annotationLayer.keyDown).toHaveBeenCalled();
      expect(on.chart.resetView).toHaveBeenCalled();
    });
  });

  describe('touch long-press', () => {
    afterEach(() => vi.useRealTimers());
    const touch = { pointerType: 'touch' };

    /** Press at (300, 200), hold `ms`, then move to `x` and lift. */
    function hold(t: ReturnType<typeof setup>, ms: number, x = 200) {
      t.fire('pointerdown', t.at(300, 200, touch));
      vi.advanceTimersByTime(ms);
      t.fire('pointermove', t.at(x, 220, { ...touch, timeStamp: ms }));
      t.fire('pointerup', t.at(x, 220, { ...touch, timeStamp: ms + 5 }));
    }

    it('tracks the crosshair without panning, and ends on release', () => {
      vi.useFakeTimers();
      const t = setup();
      hold(t, 500);
      expect(t.time.rightOffset).toBe(-200);
      expect(t.chart.setCrosshair).toHaveBeenCalledWith({ x: 200, y: 220, pane: 0 });
      expect(t.chart.setCrosshair).toHaveBeenLastCalledWith(null);
      expect(t.chart.emit).not.toHaveBeenCalledWith('plot:click', expect.anything());
    });

    it('reports inspecting from the long-press until it ends, and through a kept crosshair', () => {
      vi.useFakeTimers();
      const t = setup();
      t.fire('pointerdown', t.at(300, 200, touch));
      // The press already moves the crosshair, but it is a pan until the timer fires.
      expect(t.interaction.inspecting).toBe(false);
      vi.advanceTimersByTime(500);
      expect(t.interaction.inspecting).toBe(true);
      t.fire('pointerup', t.at(300, 200, { ...touch, timeStamp: 505 }));
      expect(t.interaction.inspecting).toBe(false);

      Object.assign(t.chart.options, { touchInspect: 'tap' });
      hold(t, 500);
      expect(t.interaction.inspecting).toBe(true);
      t.drag([[100, 100]], touch);
      expect(t.interaction.inspecting).toBe(false);
    });

    it('pans when the finger moves before the long-press', () => {
      vi.useFakeTimers();
      const t = setup();
      t.fire('pointerdown', t.at(300, 200, touch));
      t.fire('pointermove', t.at(250, 200, { ...touch, timeStamp: 50 }));
      vi.advanceTimersByTime(500);
      t.fire('pointermove', t.at(200, 200, { ...touch, timeStamp: 600 }));
      t.fire('pointerup', t.at(200, 200, { ...touch, timeStamp: 605 }));
      // 100 px of travel at 10 px per bar, with no inspection crosshair after the timer window.
      expect(t.time.rightOffset).toBe(-190);
      expect(t.chart.setCrosshair.mock.calls).toEqual([[{ x: 300, y: 200, pane: 0 }], [null]]);
      expect(t.chart.updateHover).not.toHaveBeenCalled();
    });

    it('drives the series hover while inspecting and clears it on release', () => {
      vi.useFakeTimers();
      const t = setup();
      hold(t, 500);
      expect(t.chart.updateHover).toHaveBeenCalledWith({ x: 200, y: 220 });
      expect(t.chart.updateHover).toHaveBeenLastCalledWith(null);
    });

    it('does not start for a pen', () => {
      vi.useFakeTimers();
      const t = setup();
      const pen = { pointerType: 'pen' };
      t.fire('pointerdown', t.at(300, 200, pen));
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(500);
      t.fire('pointermove', t.at(200, 200, { ...pen, timeStamp: 500 }));
      t.fire('pointerup', t.at(200, 200, { ...pen, timeStamp: 505 }));
      expect(t.time.rightOffset).toBe(-190);
    });

    it('is cancelled by a second finger', () => {
      vi.useFakeTimers();
      const t = setup();
      t.fire('pointerdown', t.at(300, 200, { ...touch, pointerId: 1 }));
      expect(vi.getTimerCount()).toBe(1);
      t.fire('pointerdown', t.at(400, 200, { ...touch, pointerId: 2, timeStamp: 100 }));
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(500);
      expect(t.chart.updateHover).not.toHaveBeenCalled();
    });

    it('clears a pending long-press on destroy', () => {
      vi.useFakeTimers();
      const t = setup();
      t.fire('pointerdown', t.at(300, 200, touch));
      expect(vi.getTimerCount()).toBe(1);
      t.interaction.destroy();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('suppresses the browser menu on a right click only when the chart opens its own', () => {
      const t = setup();
      expect(t.fire('contextmenu', t.at(300, 200)).preventDefault).not.toHaveBeenCalled();
      expect(t.chart.openContextMenu).toHaveBeenCalledWith(300, 200, 300, 200);
      t.chart.openContextMenu.mockReturnValue(true);
      expect(t.fire('contextmenu', t.at(300, 200)).preventDefault).toHaveBeenCalled();
    });

    it('passes chart-root x to openContextMenu, like pointAt', () => {
      vi.useFakeTimers();
      const t = setup();
      t.chart.plotLeft = 40;
      t.fire('contextmenu', t.at(300, 200));
      expect(t.chart.openContextMenu).toHaveBeenLastCalledWith(300, 200, 300, 200);
      Object.assign(t.chart.options, { touchInspect: 'off' });
      t.fire('pointerdown', t.at(300, 200, touch));
      vi.advanceTimersByTime(500);
      expect(t.chart.openContextMenu).toHaveBeenLastCalledWith(300, 200, 300, 200);
    });

    it('opens a legend row menu on a right click on the row', () => {
      const t = setup();
      const row = { id: 'rsi' };
      t.chart.legendSeriesAt.mockReturnValue(row);
      t.chart.openLegendMenu.mockReturnValue(true);
      expect(t.fire('contextmenu', t.at(300, 200)).preventDefault).toHaveBeenCalled();
      expect(t.chart.openLegendMenu).toHaveBeenCalledWith(row, 300, 200);
      expect(t.chart.openContextMenu).not.toHaveBeenCalled();
    });

    it('opens a legend row menu on a touch long-press on the row instead of inspecting', () => {
      vi.useFakeTimers();
      const t = setup();
      const row = { id: 'rsi' };
      t.chart.legendSeriesAt.mockReturnValue(row);
      t.chart.openLegendMenu.mockReturnValue(true);
      t.fire('pointerdown', t.at(300, 200, touch));
      vi.advanceTimersByTime(500);
      expect(t.chart.openLegendMenu).toHaveBeenCalledWith(row, 300, 200);
      expect(t.chart.openContextMenu).not.toHaveBeenCalled();
      expect(t.chart.setCrosshair).toHaveBeenLastCalledWith(null);
    });

    it('does not open a legend row menu when the press moves first', () => {
      vi.useFakeTimers();
      const t = setup();
      t.chart.legendSeriesAt.mockReturnValue({ id: 'rsi' });
      t.fire('pointerdown', t.at(300, 200, touch));
      t.fire('pointermove', t.at(340, 200, touch));
      vi.advanceTimersByTime(500);
      expect(t.chart.openLegendMenu).not.toHaveBeenCalled();
    });

    it('leaves a touch long-press menu to inspecting, even after the finger lifts', () => {
      vi.useFakeTimers();
      const t = setup();
      t.fire('pointerdown', t.at(300, 200, touch));
      expect(t.fire('contextmenu', t.at(300, 200)).preventDefault).toHaveBeenCalled();
      t.fire('pointerup', t.at(300, 200, touch));
      expect(t.fire('contextmenu', t.at(300, 200)).preventDefault).toHaveBeenCalled();
      t.fire('pointercancel', t.at(300, 200, touch));
      expect(t.fire('contextmenu', t.at(300, 200)).preventDefault).toHaveBeenCalled();
      expect(t.chart.openContextMenu).not.toHaveBeenCalled();
    });

    it('treats a mouse right click after a touch as a mouse', () => {
      const t = setup();
      t.drag([[300, 200]], touch);
      t.fire('pointerdown', t.at(300, 200, { button: 2 }));
      t.chart.openContextMenu.mockReturnValue(true);
      expect(t.fire('contextmenu', t.at(300, 200)).preventDefault).toHaveBeenCalled();
      expect(t.chart.openContextMenu).toHaveBeenCalledWith(300, 200, 300, 200);
    });

    it('opens the menu from the keyboard after a touch', () => {
      const t = setup();
      t.drag([[300, 200]], touch);
      t.key('ContextMenu');
      t.fire('contextmenu', t.at(0, 0));
      expect(t.chart.openContextMenu).toHaveBeenCalledWith(0, 0, 0, 0);
    });

    it('keeps the crosshair until the next tap in tap mode', () => {
      vi.useFakeTimers();
      const t = setup();
      Object.assign(t.chart.options, { touchInspect: 'tap' });
      hold(t, 500);
      expect(t.chart.setCrosshair).not.toHaveBeenLastCalledWith(null);
      t.chart.setCrosshair.mockClear();
      t.drag([[100, 100]], touch);
      expect(t.chart.setCrosshair.mock.calls.every(([c]) => c === null)).toBe(true);
      expect(t.chart.setCrosshair).toHaveBeenLastCalledWith(null);
      expect(t.chart.emit).not.toHaveBeenCalledWith('plot:click', expect.anything());
    });

    it('does not bring the crosshair back when the ending tap drifts', () => {
      vi.useFakeTimers();
      const t = setup();
      Object.assign(t.chart.options, { touchInspect: 'tap' });
      hold(t, 500);
      t.chart.setCrosshair.mockClear();
      t.fire('pointerdown', t.at(100, 100, { ...touch, timeStamp: 1000 }));
      t.fire('pointermove', t.at(103, 101, { ...touch, timeStamp: 1010 }));
      t.fire('pointerup', t.at(103, 101, { ...touch, timeStamp: 1015 }));
      expect(t.chart.setCrosshair).not.toHaveBeenCalledWith(expect.objectContaining({ x: 103 }));
      expect(t.chart.setCrosshair).toHaveBeenLastCalledWith(null);
      expect(t.chart.updateHover).toHaveBeenLastCalledWith(null);
    });

    it('can be turned off', () => {
      vi.useFakeTimers();
      const t = setup();
      Object.assign(t.chart.options, { touchInspect: 'off' });
      hold(t, 500);
      expect(t.time.rightOffset).not.toBe(-200);
    });

    it('opens the context menu instead when inspecting is off and the chart takes it', () => {
      vi.useFakeTimers();
      const t = setup();
      Object.assign(t.chart.options, { touchInspect: 'off' });
      t.chart.openContextMenu.mockReturnValue(true);
      t.fire('pointerdown', t.at(300, 200, touch));
      vi.advanceTimersByTime(500);
      expect(t.chart.openContextMenu).toHaveBeenCalledWith(300, 200, 300, 200);
      t.fire('pointermove', t.at(200, 200, { ...touch, timeStamp: 500 }));
      t.fire('pointerup', t.at(200, 200, { ...touch, timeStamp: 505 }));
      expect(t.time.rightOffset).toBe(-200);
    });

    it('does not start for a mouse', () => {
      vi.useFakeTimers();
      const t = setup();
      t.fire('pointerdown', t.at(300, 200));
      vi.advanceTimersByTime(500);
      t.fire('pointermove', t.at(200, 200, { timeStamp: 500 }));
      t.fire('pointerup', t.at(200, 200, { timeStamp: 505 }));
      expect(t.time.rightOffset).not.toBe(-200);
    });
  });

  describe('touch', () => {
    it('clears the annotation hover when a touch lifts, but not a mouse button', () => {
      const t = setup();
      t.drag([[300, 200]], { pointerType: 'touch' });
      expect(t.chart.annotationLayer.pointerMove).toHaveBeenLastCalledWith(null);
      t.chart.annotationLayer.pointerMove.mockClear();
      t.drag([[300, 200]]);
      expect(t.chart.annotationLayer.pointerMove).not.toHaveBeenCalled();
    });

    it('touchScroll gates one-finger touch panning only', () => {
      const off = setup({ touchScroll: false });
      off.drag([[400, 250], [300, 250]], { pointerType: 'touch' });
      expect(off.time.rightOffset).toBe(-200);
      off.drag([[400, 250], [300, 250]]);
      expect(off.time.rightOffset).not.toBe(-200);
    });

    it('touchZoom gates pinch zoom but keeps pinch panning', () => {
      const off = setup({ touchZoom: false });
      off.pinch(100);
      expect(off.time.barSpacing).toBe(10);
      expect(off.time.rightOffset).not.toBe(-200);
      off.fire('wheel', off.at(300, 200, { deltaX: 0, deltaY: -100, deltaMode: 0 }));
      expect(off.time.barSpacing).toBeGreaterThan(10);
    });

    it('lets vertical swipes scroll the page while touch panning is off', () => {
      const t = setup();
      expect(t.chart.root.style.touchAction).toBe('none');
      t.toggle({ touchScroll: false });
      expect(t.chart.root.style.touchAction).toBe('pan-y');
      // Drawing needs every touch move.
      t.chart.drawingLayer.tool = 'trendline';
      t.emit('tool:change');
      expect(t.chart.root.style.touchAction).toBe('none');
      t.chart.drawingLayer.tool = null;
      t.emit('tool:change');
      t.toggle({ touchScroll: true, scroll: false });
      expect(t.chart.root.style.touchAction).toBe('pan-y');
    });

    it('lets the page take pinches while touch zoom and panning are off', () => {
      const t = setup({ touchScroll: false, touchZoom: false });
      expect(t.chart.root.style.touchAction).toBe('pan-y pinch-zoom');
      t.toggle({ touchZoom: true });
      expect(t.chart.root.style.touchAction).toBe('pan-y');
      t.toggle({ touchZoom: false, touchScroll: true });
      expect(t.chart.root.style.touchAction).toBe('none');
    });
  });

  describe('runtime changes', () => {
    it('apply to the next input on the same instance', () => {
      const t = setup();
      t.toggle({ scroll: false });
      t.drag([[400, 250], [300, 250]]);
      expect(t.time.rightOffset).toBe(-200);
      t.toggle({ scroll: true });
      t.drag([[400, 250], [300, 250]]);
      expect(t.time.rightOffset).not.toBe(-200);
    });

    it('end a pan drag mid-gesture without momentum', () => {
      const t = setup();
      t.fire('pointerdown', t.at(400, 250, { timeStamp: 0 }));
      t.fire('pointermove', t.at(380, 250, { timeStamp: 10 }));
      t.toggle({ scroll: false });
      const offset = t.time.rightOffset;
      t.fire('pointermove', t.at(300, 250, { timeStamp: 20 }));
      t.fire('pointerup', t.at(300, 250, { timeStamp: 25 }));
      expect(t.interaction.step(16)).toBe(false);
      expect(t.time.rightOffset).toBe(offset);
    });

    it('stop running momentum', () => {
      const t = setup();
      t.drag([[400, 250], [380, 250], [340, 250]]);
      expect(t.interaction.step(16)).toBe(true);
      t.toggle({ scroll: false });
      const offset = t.time.rightOffset;
      expect(t.interaction.step(16)).toBe(false);
      expect(t.time.rightOffset).toBe(offset);
    });

    it('stop an eased wheel zoom and end a pinch', () => {
      const t = setup();
      t.chart.options.smoothZoom = true;
      t.fire('wheel', t.at(300, 200, { deltaX: 0, deltaY: -100, deltaMode: 0 }));
      expect(t.interaction.step(16)).toBe(true);
      t.toggle({ zoom: false });
      const spacing = t.time.barSpacing;
      expect(t.interaction.step(16)).toBe(false);
      expect(t.time.barSpacing).toBe(spacing);

      const p = setup();
      const touch = { pointerType: 'touch' };
      p.fire('pointerdown', p.at(300, 200, { ...touch, pointerId: 1 }));
      p.fire('pointerdown', p.at(400, 200, { ...touch, pointerId: 2 }));
      p.toggle({ zoom: false, scroll: false });
      p.fire('pointermove', p.at(500, 200, { ...touch, pointerId: 2 }));
      expect(p.time.barSpacing).toBe(10);
      expect(p.time.rightOffset).toBe(-200);
    });

    it('end an axis drag', () => {
      const t = setup();
      t.fire('pointerdown', t.at(300, 510));
      t.fire('pointermove', t.at(330, 510));
      t.toggle({ axisDragScale: false });
      const spacing = t.time.barSpacing;
      t.fire('pointermove', t.at(400, 510));
      expect(t.time.barSpacing).toBe(spacing);
    });
  });
});

describe('pointer edge cases', () => {
  const pen = { pointerType: 'pen' };
  const clicks = (t: ReturnType<typeof setup>) => t.chart.emit.mock.calls.filter(([name]) => name === 'plot:click').length;

  it('keeps a left drag going when another mouse button is released', () => {
    const t = setup();
    t.fire('pointerdown', t.at(300, 200, { buttons: 1 }));
    t.fire('pointerup', t.at(300, 200, { type: 'pointerup', button: 2, buttons: 1 }));
    expect(clicks(t)).toBe(0);
    t.fire('pointermove', t.at(350, 200, { buttons: 1 }));
    expect(t.time.rightOffset).not.toBe(-200);
    const offset = t.time.rightOffset;
    t.fire('pointerup', t.at(350, 200, { type: 'pointerup', timeStamp: 1000 }));
    expect(t.time.rightOffset).toBe(offset);
    expect(clicks(t)).toBe(0);
  });

  it('clicks once, on the primary release, when another button comes and goes', () => {
    const t = setup();
    t.fire('pointerdown', t.at(300, 200, { buttons: 1 }));
    t.fire('pointerup', t.at(300, 200, { type: 'pointerup', button: 2, buttons: 1 }));
    t.fire('pointerup', t.at(300, 200, { type: 'pointerup', button: 0, buttons: 0 }));
    expect(clicks(t)).toBe(1);
  });

  it('ends a press without a click when the last button released is not the primary', () => {
    const t = setup();
    t.fire('pointerdown', t.at(300, 200, { buttons: 1 }));
    t.fire('pointerup', t.at(300, 200, { type: 'pointerup', button: 2, buttons: 0 }));
    expect(clicks(t)).toBe(0);
    // The press is over: moving now hovers instead of panning.
    t.fire('pointermove', t.at(350, 200));
    expect(t.time.rightOffset).toBe(-200);
  });

  it('clears the crosshair when a hovering pen leaves', () => {
    const t = setup();
    t.fire('pointermove', t.at(300, 200, pen));
    expect(t.chart.setCrosshair).toHaveBeenLastCalledWith({ x: 300, y: 200, pane: 0 });
    t.fire('pointerleave', t.at(300, 200, pen));
    expect(t.chart.setCrosshair).toHaveBeenLastCalledWith(null);
    expect(t.chart.updateHover).toHaveBeenLastCalledWith(null);
  });

  it('leaves the crosshair alone when a touch leaves', () => {
    const t = setup();
    t.chart.setCrosshair.mockClear();
    t.fire('pointerleave', t.at(300, 200, { pointerType: 'touch' }));
    expect(t.chart.setCrosshair).not.toHaveBeenCalled();
  });

  it('scales page-mode wheel deltas by the plot size along each axis', () => {
    const page = setup();
    page.fire('wheel', page.at(300, 200, { deltaX: 0.1, deltaY: 0, deltaMode: 2 }));
    const pixels = setup();
    pixels.fire('wheel', pixels.at(300, 200, { deltaX: 0.1 * PLOT_W, deltaY: 0, deltaMode: 0 }));
    expect(page.time.rightOffset).toBeCloseTo(pixels.time.rightOffset);
    expect(page.time.rightOffset).not.toBe(-200);
  });

  it('scales a shifted page-mode vertical delta by the plot width', () => {
    const page = setup();
    page.fire('wheel', page.at(300, 200, { deltaX: 0, deltaY: 0.1, deltaMode: 2, shiftKey: true }));
    const pixels = setup();
    pixels.fire('wheel', pixels.at(300, 200, { deltaX: 0.1 * PLOT_W, deltaY: 0, deltaMode: 0 }));
    expect(page.time.rightOffset).toBeCloseTo(pixels.time.rightOffset);
  });

  it('measures the chart once per frame, and again after a resize', () => {
    const t = setup();
    const measure = vi.spyOn(t.chart.root, 'getBoundingClientRect');
    t.fire('pointermove', t.at(300, 200));
    t.fire('pointermove', t.at(310, 200));
    t.fire('wheel', t.at(310, 200, { deltaX: 0, deltaY: 0, deltaMode: 0 }));
    expect(measure).toHaveBeenCalledTimes(1);
    t.interaction.step(16);
    t.fire('pointermove', t.at(320, 200));
    expect(measure).toHaveBeenCalledTimes(2);
    t.emit('chart:resize');
    t.fire('pointermove', t.at(330, 200));
    expect(measure).toHaveBeenCalledTimes(3);
    // A new press measures afresh.
    t.fire('pointerdown', t.at(330, 200));
    expect(measure).toHaveBeenCalledTimes(4);
  });

  it('tells the drawing layer whether Shift and Ctrl or Cmd were held on a plot press', () => {
    const t = setup();
    const down = vi.fn(() => false);
    t.chart.drawingLayer.pointerDown = down;
    for (const mods of [{ shiftKey: true }, {}, { ctrlKey: true }, { metaKey: true }]) {
      t.fire('pointerdown', t.at(300, 200, mods));
      t.fire('pointerup', t.at(300, 200));
    }
    expect(down.mock.calls.map((c) => (c as unknown[])[2])).toEqual([
      { shift: true, ctrl: false },
      { shift: false, ctrl: false },
      { shift: false, ctrl: true },
      { shift: false, ctrl: true },
    ]);
  });
});
