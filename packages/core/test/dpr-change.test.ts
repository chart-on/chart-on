import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeDevicePixelRatio, fakeContainer, fireWindowResize, mediaListeners, windowListeners } from './fake-dom';
import { Chart } from '../src/chart';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  changeDevicePixelRatio(1, 'never matches');
});

interface Sized {
  width: number;
  height: number;
}

function canvases(c: Chart): Sized[] {
  const internals = c as unknown as { bottom: Sized; top: Sized; glCanvas: Sized };
  return [internals.bottom, internals.top, internals.glCanvas];
}

describe('device pixel ratio changes', () => {
  it('resizes every canvas and redraws without a container resize', () => {
    const c = new Chart(fakeContainer(), { maxGlDpr: 1.5 });
    charts.push(c);
    expect(canvases(c).map((x) => [x.width, x.height])).toEqual([
      [800, 600],
      [800, 600],
      [800, 600],
    ]);
    const render = vi.spyOn(c as unknown as { render(t: number): boolean }, 'render');
    changeDevicePixelRatio(2);
    expect(c.dpr).toBe(2);
    expect(canvases(c).map((x) => [x.width, x.height])).toEqual([
      [1600, 1200],
      [1600, 1200],
      [1200, 900],
    ]);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('watches the new ratio after a change, one listener at a time', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    expect(mediaListeners('(resolution: 1dppx)')).toBe(1);
    changeDevicePixelRatio(1.25);
    expect(mediaListeners('(resolution: 1dppx)')).toBe(0);
    expect(mediaListeners('(resolution: 1.25dppx)')).toBe(1);
  });

  it('stops watching on destroy', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    changeDevicePixelRatio(3);
    expect(mediaListeners('(resolution: 3dppx)')).toBe(1);
    expect(windowListeners('resize')).toBe(1);
    charts.splice(0).forEach((x) => x.destroy());
    expect(mediaListeners('(resolution: 3dppx)')).toBe(0);
    expect(windowListeners('resize')).toBe(0);
  });

  it('does not watch again when resized after destroy', () => {
    const c = new Chart(fakeContainer());
    c.destroy();
    changeDevicePixelRatio(2, 'never matches');
    c.resize();
    expect(mediaListeners('resolution')).toBe(0);
    expect(windowListeners('resize')).toBe(0);
    expect(c.dpr).toBe(1);
  });

  it('catches a ratio change the media query misses through window resize', () => {
    // Fractional ratios may never match `(resolution: …dppx)`, so its change never fires.
    const c = new Chart(fakeContainer());
    charts.push(c);
    changeDevicePixelRatio(1.1, 'never matches');
    expect(c.dpr).toBe(1);
    fireWindowResize();
    expect(c.dpr).toBe(1.1);
    expect(canvases(c)[0]).toMatchObject({ width: 880, height: 660 });
    expect(mediaListeners('resolution')).toBe(1);
    expect(windowListeners('resize')).toBe(1);
  });

  it('falls back to window resize without matchMedia', () => {
    const g = globalThis as { matchMedia?: unknown };
    const saved = g.matchMedia;
    delete g.matchMedia;
    try {
      const c = new Chart(fakeContainer());
      charts.push(c);
      expect(windowListeners('resize')).toBe(1);
      changeDevicePixelRatio(2);
      expect(c.dpr).toBe(1);
      fireWindowResize();
      expect(c.dpr).toBe(2);
      expect(windowListeners('resize')).toBe(1);
      charts.splice(0).forEach((x) => x.destroy());
      expect(windowListeners('resize')).toBe(0);
    } finally {
      g.matchMedia = saved;
    }
  });
});
