import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { IndicatorDef } from '../src/indicators/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.useRealTimers();
});

function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  c.addCandles().setData([0, 60, 120].map((time) => ({ time, open: 1, high: 2, low: 0, close: 1 })));
  return c;
}

describe('series dispose', () => {
  it('runs once on removeSeries', () => {
    const c = chart();
    const line = c.addLine();
    const dispose = vi.spyOn(line, 'dispose');
    c.removeSeries(line);
    c.removeSeries(line);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('runs once for every series of a removed pane', () => {
    const c = chart();
    const pane = c.addPane();
    const a = vi.spyOn(c.addLine({}, pane), 'dispose');
    const b = vi.spyOn(c.addHistogram({}, pane), 'dispose');
    c.removePane(pane);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('runs once on destroy, and not again for series removed before', () => {
    const c = chart();
    const removed = c.addLine();
    const kept = c.addLine();
    const main = vi.spyOn(c.main!, 'dispose');
    const gone = vi.spyOn(removed, 'dispose');
    const stays = vi.spyOn(kept, 'dispose');
    c.removeSeries(removed);
    charts.splice(charts.indexOf(c), 1);
    c.destroy();
    expect(main).toHaveBeenCalledTimes(1);
    expect(stays).toHaveBeenCalledTimes(1);
    expect(gone).toHaveBeenCalledTimes(1);
  });
});

/** Run one frame's scene work; frames never run on their own under the fake DOM. */
function frame(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
}

const asyncDef = (result: Promise<unknown>): IndicatorDef => ({
  id: 'slow',
  name: 'Slow',
  placement: 'pane',
  inputs: [],
  plots: [{ id: 'v', type: 'line' }],
  compute: (src) => result.then(() => ({ v: new Float64Array(src.length) })),
});

describe('series dispose on other removal paths', () => {
  it('runs once when an indicator is removed', () => {
    const c = chart();
    const ind = c.indicators.add(asyncDef(new Promise(() => {})));
    const dispose = vi.spyOn(ind.series!, 'dispose');
    ind.remove();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('does not run for a series moved to another pane, even when its old pane goes', () => {
    const c = chart();
    const pane = c.addPane();
    const line = c.addLine({}, pane);
    const dispose = vi.spyOn(line, 'dispose');
    c.moveSeries(line, 'above');
    expect(c.panes).not.toContain(pane);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('stops an async indicator from scheduling frames after destroy', async () => {
    let finish!: () => void;
    const c = chart();
    c.indicators.add(asyncDef(new Promise<void>((resolve) => (finish = resolve))));
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    charts.splice(charts.indexOf(c), 1);
    c.destroy();
    raf.mockClear();
    finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(raf).not.toHaveBeenCalled();
  });

  it('stops the volume profile throttle once removed', () => {
    vi.useFakeTimers();
    const c = chart();
    const profile = c.addVolumeProfile({ range: 'visible', throttleMs: 1000 });
    frame(c);
    // A live tick inside the throttle window arms the redraw timer.
    c.main!.update({ time: 120, open: 1, high: 3, low: 0, close: 2 });
    frame(c);
    expect((profile as unknown as { timer: unknown }).timer).toBeDefined();
    const redraw = vi.spyOn(c, 'requestRender');
    c.removeSeries(profile);
    frame(c);
    vi.advanceTimersByTime(2000);
    expect(redraw).not.toHaveBeenCalled();
  });
});
