import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chart } from '@charton/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { h, isolateFromChart } from '../src/dom';
import { createReplayControls } from '../src/replay';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

function chart() {
  const c = new Chart(fakeContainer(), { timezone: 'UTC' });
  charts.push(c);
  c.addCandles({ animate: false }).setData(Array.from({ length: 200 }, (_, i) => ({ time: i * 60, open: 10, high: 20, low: 0, close: 10 })));
  return c;
}

const at = { clientX: 400, clientY: 300, pointerId: 1, pointerType: 'mouse', button: 0 };

describe('isolateFromChart', () => {
  it('keeps presses, wheel and navigation keys on an overlay away from the chart', () => {
    const c = chart();
    const capture = vi.spyOn(c.root, 'setPointerCapture');
    // The chart itself takes these.
    dispatch(c.root, 'pointerdown', at);
    dispatch(c.root, 'pointerup', at);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(dispatch(c.root, 'wheel', { ...at, deltaY: 120 }).defaultPrevented).toBe(true);

    const overlay = h('div');
    isolateFromChart(overlay);
    c.root.append(overlay);
    const range = c.time.visibleRange();
    dispatch(overlay, 'pointerdown', at);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(dispatch(overlay, 'wheel', { ...at, deltaY: 120 }).defaultPrevented).toBe(false);
    dispatch(overlay, 'keydown', { key: 'ArrowLeft' });
    dispatch(overlay, 'dblclick', at);
    expect(c.time.visibleRange()).toEqual(range);
  });
});

describe('replay strip', () => {
  it('lets a mouse press on its buttons end in their own click', () => {
    const c = chart();
    const controls = createReplayControls(c);
    c.replay.start(60 * 60);
    const capture = vi.spyOn(c.root, 'setPointerCapture');
    const play = controls.el.children[1] as HTMLButtonElement & { dispatch(type: string): void };
    // A captured press would retarget the click to the chart root.
    dispatch(play, 'pointerdown', at);
    expect(capture).not.toHaveBeenCalled();
    play.dispatch('click');
    expect(c.replay.state.playing).toBe(true);
    expect(dispatch(play, 'wheel', { ...at, deltaY: 120 }).defaultPrevented).toBe(false);
    c.replay.stop();
    controls.destroy();
  });
});
