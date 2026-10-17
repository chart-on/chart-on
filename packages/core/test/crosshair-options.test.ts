import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch, type CrosshairEvent } from '../src/chart';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 200 }, (_, i) => ({ time: i * 60, open: 150, high: 200, low: 100, close: 150 })));
  render(c);
  return c;
}

function render(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
}

interface Call {
  name: string;
  args: unknown[];
  state: { strokeStyle?: unknown; lineWidth?: unknown; dash?: unknown };
}

/** A 2D context that records calls with the stroke state at the time. */
function recorder() {
  const calls: Call[] = [];
  const state: Call['state'] = {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, key: string) => {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (key === 'setLineDash') return (dash: number[]) => (state.dash = [...dash]);
      return (...args: unknown[]) => calls.push({ name: key, args, state: { ...state } });
    },
    set: (_t, key: string, value) => {
      if (key === 'strokeStyle' || key === 'lineWidth') state[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

/** Strokes drawn by `drawCrosshair`, as segments with their style. */
function strokes(c: Chart) {
  const { ctx, calls } = recorder();
  (c as unknown as { drawCrosshair(ctx: CanvasRenderingContext2D): void }).drawCrosshair(ctx);
  const out: { from: unknown[]; to: unknown[]; style: Call['state'] }[] = [];
  calls.forEach((call, i) => {
    if (call.name !== 'moveTo') return;
    const to = calls[i + 1]!;
    out.push({ from: call.args, to: to.args, style: to.state });
  });
  return { lines: out, calls };
}

const at = (c: Chart, x = 200, y = 150, pane = 0) => c.setCrosshair({ x, y, pane });

describe('crosshair options', () => {
  it('merges a partial option at any depth', () => {
    const c = chart();
    c.applyOptions({ crosshair: { vertical: { lineStyle: 'dotted' } } });
    expect(c.options.crosshair.vertical).toEqual({ visible: true, width: 1, lineStyle: 'dotted' });
    expect(c.options.crosshair.horizontal.lineStyle).toBe('dashed');
    c.applyOptions({ crosshair: { mode: 'close', labels: { time: false } } });
    expect(c.options.crosshair.mode).toBe('close');
    expect(c.options.crosshair.labels).toEqual({ price: true, time: false });
    // An explicit undefined keeps a line's value, but clears its colour back to the theme's.
    c.applyOptions({ crosshair: { vertical: { color: '#ff0000' } } });
    c.applyOptions({ crosshair: { vertical: { width: undefined, color: undefined } } });
    expect(c.options.crosshair.vertical).toEqual({ visible: true, width: 1, lineStyle: 'dotted', color: undefined });
  });

  it('rejects invalid values, changing nothing', () => {
    const c = chart();
    expect(() => c.applyOptions({ crosshair: { horizontal: { width: 0 } } })).toThrow(/width/);
    expect(() => c.applyOptions({ crosshair: { vertical: { lineStyle: 'wavy' as never } } })).toThrow(/lineStyle/);
    expect(() => c.applyOptions({ crosshair: { timeLabelPosition: 'left' as never } })).toThrow(/timeLabelPosition/);
    expect(c.options.crosshair.horizontal.width).toBe(1);
  });

  it('rejects a bad crosshair before changing the time scale limits', () => {
    const c = chart();
    const before = c.time.minBarSpacing;
    expect(() => c.applyOptions({ minBarSpacing: before + 1, crosshair: { horizontal: { width: -1 } } })).toThrow(/width/);
    expect(c.time.minBarSpacing).toBe(before);
    expect(c.options.minBarSpacing).toBe(before);
  });

  it('hides the price labels with the horizontal line', () => {
    const c = chart({ crosshair: { horizontal: { visible: false } } });
    const pill = vi.spyOn(c as unknown as { axisPill(...args: unknown[]): void }, 'axisPill');
    at(c);
    strokes(c);
    expect(pill).not.toHaveBeenCalled();
  });

  it('draws both lines dashed in the theme colour by default', () => {
    const c = chart();
    at(c);
    const { lines } = strokes(c);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.style).toEqual({ strokeStyle: c.theme.crosshair, lineWidth: 1, dash: [5, 4] });
  });

  it('styles and hides each line on its own', () => {
    const c = chart({ crosshair: { vertical: { visible: false }, horizontal: { color: '#ff0000', width: 2, lineStyle: 'solid' } } });
    at(c);
    const { lines } = strokes(c);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.from[1]).toBe(lines[0]!.to[1]);
    expect(lines[0]!.style).toEqual({ strokeStyle: '#ff0000', lineWidth: 2, dash: [] });
  });

  it('keeps the labels but draws no lines with the pointer cursor', () => {
    const c = chart({ crosshair: { cursor: 'pointer' } });
    const pill = vi.spyOn(c as unknown as { axisPill(...args: unknown[]): void }, 'axisPill');
    at(c, 200, 150);
    const drawn = strokes(c);
    expect(drawn.lines).toHaveLength(0);
    expect(drawn.calls.some((call) => call.name === 'arc')).toBe(false);
    expect(drawn.calls.some((call) => call.name === 'roundRect')).toBe(true);
    expect(pill).toHaveBeenCalled();
    // Placing a drawing shows the crosshair lines.
    c.drawings.setTool('trendline');
    expect(strokes(c).lines).toHaveLength(2);
    expect(() => c.applyOptions({ crosshair: { cursor: 'hand' as never } })).toThrow(/cursor/);
    expect(c.options.crosshair.cursor).toBe('pointer');
  });

  it('maps the cursor values stored before #862', () => {
    // The plain arrow is the pointer; the dot drew no lines but stood in for the crosshair's position.
    const c = chart({ crosshair: { cursor: 'arrow' as never } });
    expect(c.options.crosshair.cursor).toBe('pointer');
    c.applyOptions({ crosshair: { cursor: 'dot' as never } });
    expect(c.options.crosshair.cursor).toBe('cross');
  });

  it('sets the pointer over the plot from the cursor', () => {
    const c = chart();
    const move = () => dispatch(c.root, 'pointermove', { clientX: c.plotLeft + 200, clientY: 150 });
    move();
    expect(c.root.style.cursor).toBe('crosshair');
    c.applyOptions({ crosshair: { cursor: 'pointer' } });
    move();
    expect(c.root.style.cursor).toBe('default');
    // An armed drawing tool shows the crosshair whatever the choice.
    c.drawings.setTool('trendline');
    move();
    expect(c.root.style.cursor).toBe('crosshair');
  });

  it('puts the time label at the top of the plot', () => {
    const c = chart({ crosshair: { timeLabelPosition: 'top' } });
    at(c);
    const box = strokes(c).calls.find((call) => call.name === 'roundRect' && call.args[1] === 3);
    expect(box).toBeDefined();
  });

  it('repeats the horizontal line in other panes that show the price', () => {
    const c = chart({ crosshair: { horizontalInAllPanes: true } });
    const pane = c.addPane();
    c.addLine({}, pane).setData(Array.from({ length: 200 }, (_, i) => ({ time: i * 60, value: 100 + (i % 2) * 100 })));
    render(c);
    const main = c.panes[0]!;
    at(c, 200, main.top + main.primary.priceToY(150));
    const horizontal = strokes(c).lines.filter((l) => l.from[1] === l.to[1]);
    expect(horizontal).toHaveLength(2);
    c.applyOptions({ crosshair: { horizontalInAllPanes: false } });
    expect(strokes(c).lines.filter((l) => l.from[1] === l.to[1])).toHaveLength(1);
  });
});

describe('lockCrosshair', () => {
  it('holds the crosshair on its bar through pointer moves, pan and zoom', () => {
    const c = chart();
    const events: (CrosshairEvent | null)[] = [];
    c.on('crosshair:move', (e) => events.push(e));
    at(c, 300);
    const bar = Math.round(c.time.xToIndex(300));
    c.lockCrosshair(true);
    expect(c.crosshairLocked).toBe(true);
    expect(events.at(-1)?.locked).toBe(true);
    at(c, 100);
    c.setCrosshair(null);
    c.time.pan(80);
    c.time.zoom(1.5, 200);
    render(c);
    expect(Math.round(c.time.xToIndex(c.crosshair!.x))).toBe(bar);
    expect(events.filter((e) => e === null)).toHaveLength(0);
  });

  it('is released by Escape, and toggled by Alt+click', () => {
    const c = chart();
    const events: (CrosshairEvent | null)[] = [];
    c.on('crosshair:move', (e) => events.push(e));
    at(c);
    c.lockCrosshair(true);
    dispatch(c.root, 'keydown', { key: 'Escape', code: 'Escape' });
    expect(c.crosshairLocked).toBe(false);
    expect(events.at(-1)).toBeNull();
    const click = (x: number) => {
      dispatch(c.root, 'pointerdown', { clientX: x, clientY: 150, altKey: true });
      dispatch(c.root, 'pointerup', { clientX: x, clientY: 150, altKey: true });
    };
    const clicks = vi.fn();
    c.on('plot:click', clicks);
    click(250);
    expect(c.crosshairLocked).toBe(true);
    click(260);
    expect(c.crosshairLocked).toBe(false);
    expect(clicks).not.toHaveBeenCalled();
  });

  it('hides the crosshair on release until the next pointer move', () => {
    const c = chart();
    at(c, 300);
    c.lockCrosshair(true);
    c.lockCrosshair(false);
    expect(c.crosshair).toBeNull();
    c.time.pan(40);
    render(c);
    expect(c.crosshair).toBeNull();
    at(c, 100);
    expect(c.crosshair?.x).toBe(100);
  });

  it('leaves a page-wide Escape alone with the global keyboard scope', () => {
    const c = chart({ keyboard: { scope: 'global' } });
    at(c);
    c.lockCrosshair(true);
    const e = dispatch(document.createElement('div'), 'keydown', { key: 'Escape', code: 'Escape' });
    expect(c.crosshairLocked).toBe(true);
    expect(e.defaultPrevented).toBe(false);
    // Focused, the chart takes it.
    c.root.focus();
    try {
      dispatch(c.root, 'keydown', { key: 'Escape', code: 'Escape' });
    } finally {
      (document as unknown as { activeElement: unknown }).activeElement = null;
    }
    expect(c.crosshairLocked).toBe(false);
  });

  it('leaves Ctrl+arrow keys to the page while locked', () => {
    const c = chart();
    at(c, 5);
    c.lockCrosshair(true);
    const x = c.crosshair!.x;
    const offset = c.time.rightOffset;
    const e = dispatch(c.root, 'keydown', { key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(c.time.rightOffset).toBe(offset);
    expect(c.crosshair!.x).toBe(x);
  });

  it('is released by a touch tap on the plot', () => {
    const c = chart();
    const clicks = vi.fn();
    c.on('plot:click', clicks);
    at(c);
    c.lockCrosshair(true);
    const touch = { pointerType: 'touch', clientX: 250, clientY: 150 };
    dispatch(c.root, 'pointerdown', touch);
    dispatch(c.root, 'pointerup', touch);
    expect(c.crosshairLocked).toBe(false);
    expect(c.crosshair).toBeNull();
    expect(clicks).not.toHaveBeenCalled();
  });

  it('lets a touch hold pan while locked, instead of a long-press inspect', () => {
    vi.useFakeTimers();
    try {
      const c = chart();
      at(c);
      c.lockCrosshair(true);
      const offset = c.time.rightOffset;
      const touch = { pointerType: 'touch', clientY: 150 };
      dispatch(c.root, 'pointerdown', { ...touch, clientX: 300 });
      vi.advanceTimersByTime(1000);
      dispatch(c.root, 'pointermove', { ...touch, clientX: 200, timeStamp: 1000 });
      dispatch(c.root, 'pointerup', { ...touch, clientX: 200, timeStamp: 1005 });
      expect(c.time.rightOffset).not.toBe(offset);
      expect(c.crosshairLocked).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing without a crosshair, and ignores mirrored crosshairs while locked', () => {
    const c = chart();
    c.lockCrosshair(true);
    expect(c.crosshairLocked).toBe(false);
    at(c, 300);
    c.lockCrosshair(true);
    const x = c.crosshair!.x;
    c.setCrosshairAt(60);
    expect(c.crosshair!.x).toBe(x);
  });
});

describe('screenshots', () => {
  it('leave the crosshair out unless asked', () => {
    const c = chart();
    at(c);
    const hidden: boolean[] = [];
    const draw = c as unknown as { drawCrosshair(ctx: CanvasRenderingContext2D): void; hideCrosshair: boolean };
    vi.spyOn(draw, 'drawCrosshair').mockImplementation(function (this: typeof draw) {
      hidden.push(this.hideCrosshair);
    });
    const composite = (o: object) => (c as unknown as { composite(o: object): unknown }).composite(o);
    composite({});
    expect(hidden).toEqual([true, false]);
    hidden.length = 0;
    composite({ crosshair: true });
    expect(hidden).toEqual([false]);
  });

  it('leave a line series crosshair marker out unless asked', () => {
    const c = chart();
    const line = c.addLine({ crosshairMarker: true });
    line.setData(Array.from({ length: 200 }, (_, i) => ({ time: i * 60, value: 150 })));
    render(c);
    at(c);
    // Whether each marker was drawn into the image (true) or back on screen after it.
    const drawn: boolean[] = [];
    const state = c as unknown as { hideCrosshair: boolean; composite(o: object): unknown };
    const series = line as unknown as { drawCrosshairMarker(...args: unknown[]): void };
    vi.spyOn(series, 'drawCrosshairMarker').mockImplementation(() => drawn.push(state.hideCrosshair));
    state.composite({});
    expect(drawn).not.toContain(true);
    drawn.length = 0;
    state.composite({ crosshair: true });
    expect(drawn.length).toBeGreaterThan(0);
  });
});
