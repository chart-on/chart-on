import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart, defaultChartOptions, type ChartOptionsPatch } from '../src/chart';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  if (typeof document !== 'undefined') (document as unknown as { activeElement: unknown }).activeElement = null;
});

function chart(options: ChartOptionsPatch = {}) {
  // Wheel zoom applies at once, without easing frames.
  const c = new Chart(fakeContainer(), { smoothZoom: false, ...options });
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 1000 }, (_, i) => ({ time: i * 60, open: 10, high: 20, low: 0, close: 10 })));
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
  return c;
}

const view = (c: Chart) => ({ spacing: c.time.barSpacing, offset: c.time.rightOffset });
const wheel = (c: Chart, init: Record<string, unknown>) =>
  dispatch(c.root, 'wheel', { clientX: 300, clientY: 200, deltaX: 0, deltaY: 0, deltaMode: 0, ...init });
const key = (target: unknown, k: string, extra: Record<string, unknown> = {}) => dispatch(target, 'keydown', { key: k, code: '', ...extra });
/** A focused element outside every chart. */
const outside = () => document.createElement('div');

describe('default shortcuts', () => {
  const action = (key: string, extra: Partial<KeyboardEvent> = {}) =>
    chart().actions.match({ key, code: '', altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, ...extra })[0] ?? null;

  it('maps the default keys to action ids', () => {
    const k = action;
    expect(k('Home')).toBe('oldest-bar');
    expect(k('End')).toBe('newest-bar');
    expect(k('PageUp')).toBe('page-older');
    expect(k('PageDown')).toBe('page-newer');
    expect(k('ArrowLeft')).toBe('scroll-older');
    expect(k('ArrowLeft', { ctrlKey: true })).toBe('crosshair-prev');
    expect(k('ArrowRight', { ctrlKey: true })).toBe('crosshair-next');
    expect(k('=')).toBe('zoom-in');
    expect(k('End', { shiftKey: true })).toBe('reset-view');
    expect(k('0')).toBeNull();
    expect(k('r', { altKey: true, code: 'KeyR' })).toBeNull();
    expect(k('x')).toBeNull();
  });

  it('leaves browser shortcuts with Ctrl or Cmd alone, except Ctrl+arrows', () => {
    const k = action;
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      for (const name of ['+', '=', '-', 'Home', 'End', 'PageUp', 'PageDown']) expect(k(name, mod)).toBeNull();
    }
    expect(k('ArrowLeft', { metaKey: true })).toBeNull();
    expect(k('ArrowRight', { metaKey: true })).toBeNull();
    expect(k('ArrowRight', { ctrlKey: true })).toBe('crosshair-next');
  });
});

describe('wheel modes', () => {
  it('zoom: the wheel zooms and Shift+wheel pans', () => {
    const c = chart();
    const before = view(c);
    wheel(c, { deltaY: -100 });
    expect(c.time.barSpacing).toBeGreaterThan(before.spacing);
    const zoomed = view(c);
    const e = wheel(c, { deltaY: 100, shiftKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(c.time.barSpacing).toBe(zoomed.spacing);
    expect(c.time.rightOffset).not.toBe(zoomed.offset);
  });

  it('pan: the wheel scrolls time and Ctrl+wheel zooms', () => {
    const c = chart({ wheel: 'pan' });
    c.time.pan(500);
    const before = view(c);
    wheel(c, { deltaY: 100 });
    expect(c.time.barSpacing).toBe(before.spacing);
    // Scrolling down moves towards newer bars.
    expect(c.time.rightOffset).toBeGreaterThan(before.offset);
    wheel(c, { deltaY: -20, ctrlKey: true });
    expect(c.time.barSpacing).toBeGreaterThan(before.spacing);
  });

  it('page: the plain wheel scrolls the page; modifiers still pan and zoom', () => {
    const c = chart({ wheel: 'page' });
    const before = view(c);
    const plain = wheel(c, { deltaY: 100 });
    expect(plain.defaultPrevented).toBe(false);
    expect(wheel(c, { deltaX: 80 }).defaultPrevented).toBe(false);
    expect(view(c)).toEqual(before);
    expect(wheel(c, { deltaY: -100, shiftKey: true }).defaultPrevented).toBe(true);
    expect(c.time.rightOffset).not.toBe(before.offset);
    wheel(c, { deltaY: -100, metaKey: true });
    expect(c.time.barSpacing).toBeGreaterThan(before.spacing);
  });

  it('Shift+wheel pans along the dominant axis of a mixed delta', () => {
    const c = chart();
    c.time.pan(500);
    const before = view(c);
    wheel(c, { deltaX: 3, deltaY: 100, shiftKey: true });
    expect(c.time.barSpacing).toBe(before.spacing);
    expect(c.time.rightOffset).toBeCloseTo(before.offset + 100 / before.spacing);
  });

  it('zoom: Cmd with a horizontal swipe still pans', () => {
    const c = chart();
    c.time.pan(500);
    const before = view(c);
    expect(wheel(c, { deltaX: 80, metaKey: true }).defaultPrevented).toBe(true);
    expect(c.time.barSpacing).toBe(before.spacing);
    expect(c.time.rightOffset).not.toBe(before.offset);
  });

  it('leaves a pan wheel to the page when scrolling is off', () => {
    const c = chart({ wheel: 'pan', features: { scroll: false } });
    expect(wheel(c, { deltaY: 100 }).defaultPrevented).toBe(false);
  });
});

describe('navigation keys', () => {
  it('Home and End jump to the oldest and newest bars', () => {
    const c = chart();
    c.root.focus();
    key(c.root, 'Home');
    expect(c.time.visibleRange().from).toBe(0);
    key(c.root, 'End');
    expect(c.time.rightOffset).toBe(c.options.rightOffset);
  });

  it('PageUp and PageDown move one screen', () => {
    const c = chart();
    c.root.focus();
    const left = () => c.time.xToIndex(0);
    const start = left();
    const screen = c.time.width / c.time.barSpacing;
    key(c.root, 'PageUp');
    expect(left()).toBeCloseTo(start - screen);
    key(c.root, 'PageDown');
    expect(left()).toBeCloseTo(start);
  });

  it('Ctrl+arrows step the crosshair one bar and keep it on screen', () => {
    const c = chart();
    c.root.focus();
    const index = () => Math.round(c.time.xToIndex(c.crosshair!.x));
    key(c.root, 'ArrowRight', { ctrlKey: true });
    expect(index()).toBe(999);
    key(c.root, 'ArrowLeft', { ctrlKey: true });
    expect(index()).toBe(998);
    key(c.root, 'Home');
    const first = Math.ceil(c.time.xToIndex(0));
    c.setCrosshair({ x: c.time.indexToX(first), y: 100, pane: 0 });
    key(c.root, 'ArrowLeft', { ctrlKey: true });
    key(c.root, 'ArrowLeft', { ctrlKey: true });
    expect(index()).toBe(Math.max(0, first - 2));
    expect(c.crosshair!.x).toBeGreaterThanOrEqual(0);
  });

  it('leaves page-scroll keys to the page when the view is at an edge', () => {
    const c = chart();
    c.root.focus();
    c.time.pan(1e9);
    for (const name of ['PageUp', 'ArrowLeft']) expect(key(c.root, name).defaultPrevented).toBe(false);
    expect(key(c.root, 'PageDown').defaultPrevented).toBe(true);
  });

  it('Ctrl+arrows need neither scroll nor zoom', () => {
    const c = chart({ features: { scroll: false, zoom: false } });
    c.root.focus();
    expect(key(c.root, 'ArrowLeft', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(c.crosshair).not.toBeNull();
  });

  it('Shift+End resets the view and needs both scroll and zoom; no letter or digit does', () => {
    const reset = (options: ChartOptionsPatch, name = 'End', extra: Record<string, unknown> = { shiftKey: true }) => {
      const c = chart(options);
      c.root.focus();
      c.time.zoom(2, 0);
      c.time.pan(300);
      const before = view(c);
      key(c.root, name, extra);
      return view(c).spacing === before.spacing && view(c).offset === before.offset ? 'kept' : view(c);
    };
    expect(reset({ features: { scroll: false } })).toBe('kept');
    expect(reset({ features: { zoom: false } })).toBe('kept');
    expect(reset({})).toEqual({ spacing: defaultChartOptions.barSpacing, offset: defaultChartOptions.rightOffset });
    // End alone only goes to the newest bar, at the current zoom.
    expect((reset({}, 'End', {}) as { spacing: number }).spacing).toBe(defaultChartOptions.barSpacing * 2);
    // Letters and digits stay free for type-to-search; Alt+R no longer resets.
    for (const [name, code] of [['0', 'Digit0'], ['g', 'KeyG']]) expect(reset({}, name, { code })).toBe('kept');
    expect(reset({}, 'r', { code: 'KeyR', altKey: true })).toBe('kept');
  });

  it('takes no letter or digit by default, so typing on the chart stays free', () => {
    const c = chart();
    const typed = [...'abcdefghijklmnopqrstuvwxyz0123456789'];
    expect(typed.filter((ch) => c.actions.match({ key: ch, code: '', altKey: false, ctrlKey: false, shiftKey: false, metaKey: false }).length > 0)).toEqual([]);
  });

  it('Shift+End lets the view ease back; a key that does nothing leaves a running animation alone', () => {
    // Motion allowed, so resetView animates.
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    try {
      const c = chart();
      c.root.focus();
      c.time.zoom(2, 0);
      c.time.pan(1e9);
      key(c.root, 'End', { shiftKey: true });
      expect(c.time.animating).toBe(true);
      // Still at the oldest bar, PageUp changes nothing: it goes to the page and the reset keeps easing.
      expect(key(c.root, 'PageUp').defaultPrevented).toBe(false);
      expect(c.time.animating).toBe(true);
      while (c.time.step(16));
      expect(c.time.barSpacing).toBeCloseTo(defaultChartOptions.barSpacing);
      expect(c.time.rightOffset).toBeCloseTo(defaultChartOptions.rightOffset);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ignores keys typed into a field or a dialog', () => {
    const c = chart();
    const input = document.createElement('input');
    c.root.append(input);
    const before = view(c);
    key(input, 'Home');
    const inDialog = Object.assign(document.createElement('button'), { closest: () => ({ contains: () => false }) });
    key(inDialog, 'Home');
    expect(view(c)).toEqual(before);
  });

  it('ignores keys in a widget with an interactive role', () => {
    const c = chart({ keyboard: { scope: 'global' } });
    const before = view(c);
    for (const role of ['listbox', 'tablist', 'slider', 'menu', 'grid', 'textbox', 'combobox']) {
      const widget = { contains: () => false };
      const item = Object.assign(document.createElement('div'), {
        closest: (s: string) => (s.includes(`[role="${role}"]`) ? widget : null),
      });
      expect(key(item, 'PageUp').defaultPrevented).toBe(false);
    }
    expect(view(c)).toEqual(before);
  });

  it('ignores keys while a modal dialog without the chart is open', () => {
    const c = chart({ keyboard: { scope: 'global' } });
    const doc = document as unknown as { querySelectorAll: (s: string) => unknown[] };
    const original = doc.querySelectorAll;
    const before = view(c);
    try {
      doc.querySelectorAll = () => [{ contains: () => false }];
      expect(key(outside(), 'PageUp').defaultPrevented).toBe(false);
      expect(view(c)).toEqual(before);
      // A modal holding the chart does not block it.
      doc.querySelectorAll = () => [{ contains: (n: unknown) => n === c.root }];
      key(outside(), 'PageUp');
      expect(view(c)).not.toEqual(before);
    } finally {
      doc.querySelectorAll = original;
    }
  });
});

describe('keyboard scope', () => {
  it('focus: only the focused chart takes keys', () => {
    const a = chart();
    const b = chart();
    const [va, vb] = [view(a), view(b)];
    key(outside(), 'PageUp');
    expect([view(a), view(b)]).toEqual([va, vb]);
    a.root.focus();
    key(a.root, 'PageUp');
    expect(view(a)).not.toEqual(va);
    expect(view(b)).toEqual(vb);
  });

  it('hover: the chart under the pointer takes page keys', () => {
    const a = chart({ keyboard: { scope: 'hover' } });
    const b = chart({ keyboard: { scope: 'hover' } });
    const [va, vb] = [view(a), view(b)];
    dispatch(b.root, 'pointermove', { clientX: 300, clientY: 200 });
    key(outside(), 'PageUp');
    expect(view(a)).toEqual(va);
    expect(view(b)).not.toEqual(vb);
    dispatch(b.root, 'pointerleave', {});
    const moved = view(b);
    key(outside(), 'PageUp');
    expect(view(b)).toEqual(moved);
  });

  it('global: every chart takes page keys, and switching back to focus stops it', () => {
    const a = chart({ keyboard: { scope: 'global' } });
    const b = chart({ keyboard: { scope: 'global' } });
    const [va, vb] = [view(a), view(b)];
    key(outside(), 'PageUp');
    expect(view(a)).not.toEqual(va);
    expect(view(b)).not.toEqual(vb);
    a.applyOptions({ keyboard: { scope: 'focus' } });
    const moved = view(a);
    key(outside(), 'PageUp');
    expect(view(a)).toEqual(moved);
  });

  it('a key a focused chart used is not used again by a global chart', () => {
    const a = chart();
    const b = chart({ keyboard: { scope: 'global' } });
    const [va, vb] = [view(a), view(b)];
    a.root.focus();
    key(a.root, 'PageUp');
    expect(view(a)).not.toEqual(va);
    expect(view(b)).toEqual(vb);
  });

  it('global: browser shortcuts with Ctrl or Cmd are left alone', () => {
    const c = chart({ keyboard: { scope: 'global' } });
    c.time.pan(500);
    const before = view(c);
    for (const [k, mod] of [['=', 'ctrlKey'], ['-', 'metaKey'], ['ArrowLeft', 'metaKey'], ['Home', 'ctrlKey']] as const) {
      expect(key(outside(), k, { [mod]: true }).defaultPrevented).toBe(false);
    }
    expect(view(c)).toEqual(before);
  });

  it('global: skips keys the page already handled', () => {
    const c = chart({ keyboard: { scope: 'global' } });
    const before = view(c);
    const handled = outside();
    handled.addEventListener('keydown', (e) => e.preventDefault());
    key(handled, 'PageUp');
    expect(view(c)).toEqual(before);
  });

  it('focus: hovering is not enough; global: the view keys act page-wide', () => {
    const focus = chart();
    focus.time.zoom(2, 0);
    dispatch(focus.root, 'pointermove', { clientX: 300, clientY: 200 });
    const zoomed = view(focus);
    expect(key(outside(), 'End', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(view(focus)).toEqual(zoomed);
    focus.destroy();
    const global = chart({ keyboard: { scope: 'global' } });
    global.time.zoom(2, 0);
    expect(key(outside(), 'End', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(view(global)).toEqual({ spacing: defaultChartOptions.barSpacing, offset: defaultChartOptions.rightOffset });
    key(outside(), '-');
    expect(global.time.barSpacing).toBeLessThan(defaultChartOptions.barSpacing);
  });

  it('global: drawing keys need the chart focused or hovered', () => {
    const c = chart({ keyboard: { scope: 'global' } });
    c.drawings.setTool('trendline');
    expect(key(outside(), 'Escape').defaultPrevented).toBe(false);
    expect(key(outside(), 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(c.drawings.tool).toBe('trendline');
    dispatch(c.root, 'pointermove', { clientX: 300, clientY: 200 });
    expect(key(outside(), 'Escape').defaultPrevented).toBe(true);
    expect(c.drawings.tool).toBeNull();
  });

  it('respects the keyboard flag', () => {
    const c = chart({ keyboard: { scope: 'global' }, features: { keyboard: false } });
    const before = view(c);
    key(outside(), 'PageUp');
    expect(view(c)).toEqual(before);
  });

  it("hover and global listen on the chart's own document, and destroy stops it", () => {
    type Doc = { activeElement: unknown; listenerCount(type: string): number; invoke(e: unknown, capture: boolean): void };
    for (const scope of ['hover', 'global'] as const) {
      const c = chart();
      // A chart in a popup window: its root belongs to another document than the global one.
      const other = new (document.constructor as new () => Doc)();
      Object.defineProperty(c.root, 'ownerDocument', { value: other });
      c.applyOptions({ keyboard: { scope } });
      const press = () => {
        const e = { type: 'keydown', key: 'PageUp', code: '', target: outside(), defaultPrevented: false, preventDefault: () => (e.defaultPrevented = true), stopPropagation() {} };
        other.invoke(e, false);
      };
      const before = view(c);
      key(outside(), 'PageUp');
      expect(view(c)).toEqual(before);
      if (scope === 'hover') {
        // Focus in the chart's document counts as active, not the global document's.
        other.activeElement = c.root;
        press();
        expect(view(c)).not.toEqual(before);
        other.activeElement = null;
      } else {
        press();
        expect(view(c)).not.toEqual(before);
      }
      expect(other.listenerCount('keydown')).toBe(1);
      charts.splice(charts.indexOf(c), 1);
      c.destroy();
      expect(other.listenerCount('keydown')).toBe(0);
    }
  });
});

describe('plotDragScale', () => {
  const drag = (c: Chart, dy: number) => {
    dispatch(c.root, 'pointerdown', { clientX: 300, clientY: 200 });
    dispatch(c.root, 'pointermove', { clientX: 300, clientY: 200 + dy });
    dispatch(c.root, 'pointerup', { clientX: 300, clientY: 200 + dy });
  };

  it('rescales the main price scale on a vertical plot drag and turns autoscale off', () => {
    const c = chart({ plotDragScale: true });
    const scale = c.panes[0]!.price;
    const span = scale.max - scale.min;
    drag(c, 40);
    expect(scale.autoScale).toBe(false);
    expect(scale.max - scale.min).toBeGreaterThan(span);
  });

  it('a jittery click within the slop leaves autoscale on', () => {
    const c = chart({ plotDragScale: true });
    drag(c, 2);
    expect(c.panes[0]!.price.autoScale).toBe(true);
  });

  it('keeps vertical touch drags from the browser and scales on touch', () => {
    const c = chart({ plotDragScale: true, features: { touchScroll: false } });
    expect(c.root.style.touchAction).toBe('none');
    c.applyOptions({ plotDragScale: false });
    expect(c.root.style.touchAction).not.toBe('none');
    c.applyOptions({ plotDragScale: true });
    const touch = { pointerType: 'touch', clientX: 300 };
    dispatch(c.root, 'pointerdown', { ...touch, clientY: 200 });
    dispatch(c.root, 'pointermove', { ...touch, clientY: 240 });
    dispatch(c.root, 'pointerup', { ...touch, clientY: 240 });
    expect(c.panes[0]!.price.autoScale).toBe(false);
  });

  it('leaves the scale alone when off or without axisDragScale', () => {
    for (const options of [{}, { plotDragScale: true, features: { axisDragScale: false } }]) {
      const c = chart(options);
      drag(c, 40);
      expect(c.panes[0]!.price.autoScale).toBe(true);
    }
  });
});

describe('zoomAnchor', () => {
  /** Plot x of the newest bar. */
  const newestX = (c: Chart) => c.time.indexToX(c.time.barCount - 1);
  /** Bar index under plot x. */
  const indexAt = (c: Chart, x: number) => c.time.xToIndex(x);
  /** Plot x of client x 300, where `wheel` points. */
  const pointerX = (c: Chart) => 300 - c.plotLeft;
  const pinch = (c: Chart, spread: number) => {
    const touch = { pointerType: 'touch', clientY: 200 };
    dispatch(c.root, 'pointerdown', { ...touch, clientX: 300, pointerId: 1 });
    dispatch(c.root, 'pointerdown', { ...touch, clientX: 400, pointerId: 2 });
    dispatch(c.root, 'pointermove', { ...touch, clientX: 400 + spread, pointerId: 2 });
    dispatch(c.root, 'pointerup', { ...touch, clientX: 400 + spread, pointerId: 2 });
    dispatch(c.root, 'pointerup', { ...touch, clientX: 300, pointerId: 1 });
  };
  /** Pinch midpoint, in plot x, after the second finger moved by `spread`. */
  const pinchMid = (c: Chart, spread: number) => (300 + 400 + spread) / 2 - c.plotLeft;
  /** Pinches only zoom, so the pinch pan does not move the anchor. */
  const zoomOnly = { features: { touchScroll: false } };
  const dragTimeAxis = (c: Chart, dx: number) => {
    const y = c.plotHeight + c.options.timeAxis.height / 2;
    dispatch(c.root, 'pointerdown', { clientX: 300, clientY: y });
    dispatch(c.root, 'pointermove', { clientX: 300 + dx, clientY: y });
    dispatch(c.root, 'pointerup', { clientX: 300 + dx, clientY: y });
  };
  /** Scroll back so the newest bar is off screen to the right. */
  const hideNewest = (c: Chart) => {
    c.time.pan(c.plotWidth * 2);
    expect(newestX(c)).toBeGreaterThan(c.plotWidth);
  };

  it('defaults to the pointer for the plot and the right edge for the time axis', () => {
    expect(chart().options.zoomAnchor).toEqual({ plot: 'pointer', timeAxis: 'right-edge' });
  });

  it('takes one anchor for both inputs or merges a partial object', () => {
    const c = chart({ zoomAnchor: 'newest' });
    expect(c.options.zoomAnchor).toEqual({ plot: 'newest', timeAxis: 'newest' });
    c.applyOptions({ zoomAnchor: { timeAxis: 'pointer' } });
    expect(c.options.zoomAnchor).toEqual({ plot: 'newest', timeAxis: 'pointer' });
    c.applyOptions({ wheel: 'zoom' });
    expect(c.options.zoomAnchor).toEqual({ plot: 'newest', timeAxis: 'pointer' });
  });

  describe('wheel', () => {
    it('pointer keeps the bar under the pointer', () => {
      const c = chart();
      const before = indexAt(c, pointerX(c));
      wheel(c, { deltaY: -100 });
      expect(c.time.barSpacing).toBeGreaterThan(8);
      expect(indexAt(c, pointerX(c))).toBeCloseTo(before);
    });

    it('newest keeps the newest bar where it is', () => {
      const c = chart({ zoomAnchor: 'newest' });
      const before = newestX(c);
      wheel(c, { deltaY: -100 });
      expect(c.time.barSpacing).toBeGreaterThan(8);
      expect(newestX(c)).toBeCloseTo(before);
    });

    it('newest falls back to the pointer when the newest bar is off screen', () => {
      const c = chart({ zoomAnchor: 'newest' });
      hideNewest(c);
      const before = indexAt(c, pointerX(c));
      wheel(c, { deltaY: -100 });
      expect(indexAt(c, pointerX(c))).toBeCloseTo(before);
    });

    it('right-edge keeps the plot right edge', () => {
      const c = chart({ zoomAnchor: 'right-edge' });
      hideNewest(c);
      const before = indexAt(c, c.plotWidth);
      wheel(c, { deltaY: -100 });
      expect(c.time.barSpacing).toBeGreaterThan(8);
      expect(indexAt(c, c.plotWidth)).toBeCloseTo(before);
    });

    it('applies to a trackpad pinch (Ctrl+wheel) and eased wheel steps', () => {
      const c = chart({ zoomAnchor: 'newest' });
      const before = newestX(c);
      wheel(c, { deltaY: -20, ctrlKey: true });
      expect(newestX(c)).toBeCloseTo(before);
      c.applyOptions({ smoothZoom: true });
      wheel(c, { deltaY: -100 });
      const render = (c as unknown as { render(t: number): void }).render.bind(c);
      for (let t = 16; t < 2000; t += 16) render(t);
      expect(c.time.barSpacing).toBeGreaterThan(8);
      expect(newestX(c)).toBeCloseTo(before);
    });
  });

  describe('touch pinch', () => {
    it('pointer keeps the bar under the fingers', () => {
      const c = chart(zoomOnly);
      const before = indexAt(c, pinchMid(c, 50));
      pinch(c, 50);
      expect(c.time.barSpacing).toBeGreaterThan(8);
      expect(indexAt(c, pinchMid(c, 50))).toBeCloseTo(before);
    });

    it('newest keeps the newest bar where it is', () => {
      const c = chart({ ...zoomOnly, zoomAnchor: { plot: 'newest' } });
      const before = newestX(c);
      pinch(c, 50);
      expect(c.time.barSpacing).toBeGreaterThan(8);
      expect(newestX(c)).toBeCloseTo(before);
    });

    it('newest falls back to the fingers when the newest bar is off screen', () => {
      const c = chart({ ...zoomOnly, zoomAnchor: { plot: 'newest' } });
      hideNewest(c);
      const before = indexAt(c, pinchMid(c, 50));
      pinch(c, 50);
      expect(indexAt(c, pinchMid(c, 50))).toBeCloseTo(before);
    });

    it('right-edge keeps the plot right edge', () => {
      const c = chart({ ...zoomOnly, zoomAnchor: { plot: 'right-edge' } });
      hideNewest(c);
      const before = indexAt(c, c.plotWidth);
      pinch(c, 50);
      expect(c.time.barSpacing).toBeGreaterThan(8);
      expect(indexAt(c, c.plotWidth)).toBeCloseTo(before);
    });
  });

  describe('+ and - keys', () => {
    const zoomIn = (c: Chart) => {
      c.root.focus();
      key(c.root, '+');
      expect(c.time.barSpacing).toBeGreaterThan(8);
    };

    it('pointer zooms around the right edge, as the keys have no pointer', () => {
      const c = chart();
      hideNewest(c);
      const before = indexAt(c, c.plotWidth);
      zoomIn(c);
      expect(indexAt(c, c.plotWidth)).toBeCloseTo(before);
    });

    it('newest keeps the newest bar where it is', () => {
      const c = chart({ zoomAnchor: 'newest' });
      // The right offset leaves the newest bar short of the right edge.
      const before = newestX(c);
      expect(before).toBeLessThan(c.plotWidth - 1);
      zoomIn(c);
      expect(newestX(c)).toBeCloseTo(before);
    });

    it('newest falls back to the right edge when the newest bar is off screen', () => {
      const c = chart({ zoomAnchor: 'newest' });
      hideNewest(c);
      const before = indexAt(c, c.plotWidth);
      zoomIn(c);
      expect(indexAt(c, c.plotWidth)).toBeCloseTo(before);
    });

    it('right-edge keeps the plot right edge', () => {
      const c = chart({ zoomAnchor: 'right-edge' });
      c.time.pan(c.plotWidth / 2);
      const before = indexAt(c, c.plotWidth);
      zoomIn(c);
      expect(indexAt(c, c.plotWidth)).toBeCloseTo(before);
    });
  });

  describe('time-axis drag', () => {
    it('right-edge (the default) keeps the plot right edge', () => {
      const c = chart();
      hideNewest(c);
      const before = indexAt(c, c.plotWidth);
      dragTimeAxis(c, 40);
      expect(c.time.barSpacing).toBeGreaterThan(8);
      expect(indexAt(c, c.plotWidth)).toBeCloseTo(before);
    });

    it('pointer keeps the bar under the press point', () => {
      const c = chart({ zoomAnchor: { timeAxis: 'pointer' } });
      const before = indexAt(c, pointerX(c));
      dragTimeAxis(c, 40);
      expect(c.time.barSpacing).toBeGreaterThan(8);
      expect(indexAt(c, pointerX(c))).toBeCloseTo(before);
    });

    it('newest keeps the newest bar, or the press point when it is off screen', () => {
      const c = chart({ zoomAnchor: { timeAxis: 'newest' } });
      const before = newestX(c);
      dragTimeAxis(c, 40);
      expect(newestX(c)).toBeCloseTo(before);
      hideNewest(c);
      const under = indexAt(c, pointerX(c));
      dragTimeAxis(c, 40);
      expect(indexAt(c, pointerX(c))).toBeCloseTo(under);
    });
  });
});
