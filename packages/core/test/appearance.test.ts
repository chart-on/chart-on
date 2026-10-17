import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, mergeGrid, resolveGrid, type ChartAppearance, type ChartOptionsPatch } from '../src/chart';
import { darkTheme } from '../src/theme';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  return c;
}

const solid = { visible: true, lineStyle: 'solid' } as const;

describe('grid options', () => {
  it('resolves each direction: own color, the theme per-direction color, then theme grid', () => {
    const theme = { ...darkTheme, grid: '#111111', gridVertical: '#222222' };
    expect(resolveGrid({ horizontal: { ...solid }, vertical: { ...solid } }, theme)).toEqual({
      horizontal: { visible: true, lineStyle: 'solid', color: '#111111' },
      vertical: { visible: true, lineStyle: 'solid', color: '#222222' },
    });
    expect(resolveGrid({ horizontal: { ...solid, color: 'rgba(0, 255, 0, 0.5)' }, vertical: { ...solid } }, theme).horizontal.color).toBe(
      'rgba(0, 255, 0, 0.5)',
    );
  });

  it('merges a partial grid per direction, and an undefined color clears it', () => {
    const grid = { horizontal: { ...solid, color: '#ff0000' }, vertical: { ...solid } };
    expect(mergeGrid(grid, { vertical: { visible: false } })).toEqual({
      horizontal: { ...solid, color: '#ff0000' },
      vertical: { visible: false, lineStyle: 'solid' },
    });
    expect(mergeGrid(grid, { horizontal: { color: undefined, lineStyle: 'dotted' } }).horizontal).toEqual({
      visible: true,
      lineStyle: 'dotted',
      color: undefined,
    });
    expect(mergeGrid(grid, undefined)).toBe(grid);
  });

  it('ignores an explicit undefined visible or line style instead of storing it', () => {
    const grid = { horizontal: { ...solid, color: '#ff0000' }, vertical: { visible: false, lineStyle: 'dashed' } } as const;
    expect(mergeGrid(grid, { horizontal: { visible: undefined, lineStyle: undefined }, vertical: { lineStyle: undefined } })).toEqual(grid);
    const c = chart();
    c.applyOptions({ grid: { horizontal: { visible: undefined, lineStyle: undefined, color: undefined } } });
    expect(c.options.grid.horizontal).toEqual({ ...solid, color: undefined });
  });
});

describe('chart appearance', () => {
  it('takes a partial grid at creation and at runtime', () => {
    const c = chart({ grid: { vertical: { lineStyle: 'dashed' } } });
    expect(c.options.grid).toEqual({ horizontal: { ...solid }, vertical: { visible: true, lineStyle: 'dashed' } });
    c.applyOptions({ grid: { horizontal: { visible: false } } });
    expect(c.options.grid).toEqual({ horizontal: { visible: false, lineStyle: 'solid' }, vertical: { visible: true, lineStyle: 'dashed' } });
  });

  it('reports resolved theme and grid colors', () => {
    const c = chart({ theme: { grid: '#222222', up: 'rgba(1, 2, 3, 0.5)' }, grid: { horizontal: { color: '#333333' }, vertical: { visible: false } } });
    const a = c.appearance();
    expect(a.theme.up).toBe('rgba(1, 2, 3, 0.5)');
    expect(a.theme.background).toBe(darkTheme.background);
    expect(a.grid).toEqual({
      horizontal: { visible: true, lineStyle: 'solid', color: '#333333' },
      vertical: { visible: false, lineStyle: 'solid', color: '#222222' },
    });
    a.theme.heatmap.push('#000000');
    expect(c.appearance().theme.heatmap).toEqual(darkTheme.heatmap);
  });

  it('emits appearance:change for theme and grid changes only', () => {
    const c = chart();
    const seen: ChartAppearance[] = [];
    c.on('appearance:change', (a) => seen.push(a));
    c.applyOptions({ barSpacing: 12 });
    expect(seen).toHaveLength(0);
    c.applyOptions({ theme: { crosshair: 'rgba(255, 0, 0, 0.25)' } });
    c.applyOptions({ grid: { horizontal: { visible: false } } });
    expect(seen.map((a) => [a.theme.crosshair, a.grid.horizontal.visible])).toEqual([
      ['rgba(255, 0, 0, 0.25)', true],
      ['rgba(255, 0, 0, 0.25)', false],
    ]);
  });

  it('leaves a translucent background to the canvas so it is painted once', () => {
    const c = chart();
    const root = c.root as unknown as { style: Record<string, string> };
    expect(root.style.background).toBe(darkTheme.background);
    c.applyOptions({ theme: { background: 'rgba(0, 0, 0, 0.4)' } });
    expect(root.style.background).toBe('transparent');
    c.applyOptions({ theme: { background: '#ffffff' } });
    expect(root.style.background).toBe('#ffffff');
  });

  it('takes candle wick and border colors from the theme, with series options winning', () => {
    const c = chart({ theme: { upWick: '#010203', downBorder: 'rgba(4, 5, 6, 0.5)' } });
    const candles = c.addCandles();
    const rgba = (key: string) => (candles as unknown as Record<string, unknown>)[key];
    expect(rgba('wickRgba')).toEqual([
      [1, 2, 3, 255],
      expect.any(Array),
    ]);
    expect(rgba('borderRgba')).toEqual([null, [4, 5, 6, 128]]);
    candles.applyOptions({ upWickColor: '#0a0b0c' });
    expect((rgba('wickRgba') as number[][])[0]).toEqual([10, 11, 12, 255]);
  });
});

/** A 2D context that records background fills and clears; everything else is a no-op. */
function recordingContext(log: string[], name: string) {
  const state: Record<string, unknown> = {};
  return new Proxy(state, {
    get: (_t, key) => {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (key === 'fillRect' || key === 'clearRect') return () => log.push(`${name} ${key} ${key === 'fillRect' ? String(state.fillStyle) : ''}`.trim());
      if (typeof key === 'string' && key in state) return state[key];
      return () => ({ addColorStop() {} });
    },
    set: (_t, key, value) => {
      state[key as string] = value;
      return true;
    },
  });
}

describe('translucent background', () => {
  const bg = 'rgba(10, 20, 30, 0.4)';

  function recorded(background: string) {
    const c = chart({ theme: { background } });
    const log: string[] = [];
    const layers = c as unknown as { bottom: { getContext(): unknown }; top: { getContext(): unknown } };
    const bottom = recordingContext(log, 'bottom');
    const top = recordingContext(log, 'top');
    layers.bottom.getContext = () => bottom;
    layers.top.getContext = () => top;
    return { c, log, fills: () => log.filter((l) => l.endsWith(background)) };
  }

  it('paints a translucent background once, not again over the axis strips', () => {
    const { c, log, fills } = recorded(bg);
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
    expect(fills()).toEqual([`bottom fillRect ${bg}`]);
    // Cleared before each fill, so frames do not stack the translucent color.
    expect(log.filter((l) => l.startsWith('bottom')).slice(0, 2)).toEqual(['bottom clearRect', `bottom fillRect ${bg}`]);
  });

  it('still covers the axis strips with an opaque background', () => {
    const { c, fills } = recorded('#101010');
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
    expect(fills().filter((l) => l.startsWith('top')).length).toBeGreaterThan(0);
  });

  it('paints a translucent background once in a screenshot', async () => {
    const { c, fills } = recorded(bg);
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = create(tag) as unknown as { toBlob(done: (b: Blob | null) => void): void };
      el.toBlob = (done) => done(new Blob(['png']));
      return el as unknown as HTMLElement;
    });
    await c.captureImage({ legend: false });
    vi.restoreAllMocks();
    expect(fills()).toEqual([`bottom fillRect ${bg}`]);
  });
});

describe('background gradient', () => {
  const top = '#101820';
  const bottom = '#304050';

  /** A chart whose layers log their background fills, with gradients as `gradient(y0,y1:stops)`. */
  function recorded(theme: Partial<ChartAppearance['theme']>) {
    const c = chart({ theme });
    const log: string[] = [];
    const layers = c as unknown as { bottom: { getContext(): unknown }; top: { getContext(): unknown } };
    for (const [name, layer] of [['bottom', layers.bottom], ['top', layers.top]] as const) {
      const ctx = recordingContext(log, name) as Record<string, unknown>;
      ctx.createLinearGradient = (_x0: number, y0: number, _x1: number, y1: number) => {
        const stops: string[] = [];
        return { addColorStop: (_at: number, color: string) => stops.push(color), toString: () => `gradient(${y0},${y1}:${stops.join(',')})` };
      };
      layer.getContext = () => ctx;
    }
    return { c, log };
  }
  const render = (c: Chart) => {
    c.invalidate();
    (c as unknown as { render(t: number): void }).render(0);
  };

  it('fills the canvas and the axis strips from the top color down to the bottom color', () => {
    const { c, log } = recorded({ background: top, backgroundBottom: bottom });
    render(c);
    const gradient = `gradient(0,${c.height}:${top},${bottom})`;
    expect(log).toContain(`bottom fillRect ${gradient}`);
    expect(log.filter((l) => l.startsWith('top fillRect')).every((l) => l === `top fillRect ${gradient}`)).toBe(true);
    expect(log.some((l) => l.startsWith('top fillRect'))).toBe(true);
  });

  it('is solid without a bottom color, and again once the bottom color is cleared', () => {
    const { c, log } = recorded({ background: top, backgroundBottom: bottom });
    c.applyOptions({ theme: { backgroundBottom: undefined } });
    log.length = 0;
    render(c);
    expect(log).toContain(`bottom fillRect ${top}`);
    expect(log.some((l) => l.includes('gradient'))).toBe(false);
  });

  it('falls back to the solid color when the canvas cannot read the bottom color', () => {
    const { c, log } = recorded({ background: top });
    const layers = c as unknown as Record<'bottom' | 'top', { getContext(): Record<string, unknown> }>;
    for (const layer of [layers.bottom, layers.top]) {
      layer.getContext().createLinearGradient = () => ({
        addColorStop: () => {
          throw new SyntaxError('bad color');
        },
      });
    }
    (c as unknown as { theme: ChartAppearance['theme'] }).theme.backgroundBottom = 'not a color';
    render(c);
    expect(log).toContain(`bottom fillRect ${top}`);
    expect(log.some((l) => l.startsWith('top fillRect'))).toBe(true);
  });

  it('is in a screenshot, also when the image adds padding around the chart', async () => {
    const { c, log } = recorded({ background: top, backgroundBottom: bottom });
    const image: string[] = [];
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = create(tag) as unknown as { getContext(): unknown; toBlob(done: (b: Blob | null) => void): void };
      if (tag === 'canvas') {
        const ctx = recordingContext(image, 'image') as Record<string, unknown>;
        ctx.createLinearGradient = (_x0: number, y0: number, _x1: number, y1: number) => ({
          addColorStop() {},
          toString: () => `gradient(${y0},${y1})`,
        });
        el.getContext = () => ctx;
        el.toBlob = (done) => done(new Blob(['png']));
      }
      return el as unknown as HTMLElement;
    });
    log.length = 0;
    await c.captureImage({ legend: false });
    expect(log).toContain(`bottom fillRect gradient(0,${c.height}:${top},${bottom})`);
    await c.captureImage({ legend: false, padding: 10, scale: 1 });
    vi.restoreAllMocks();
    // Painted once under the whole image, padding included.
    expect(image).toContain(`image fillRect gradient(0,${c.height + 20})`);
  });
});
