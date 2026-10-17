import { describe, expect, it } from 'vitest';
import { COLLAPSED_PANE_HEIGHT, layoutPanes, removalMap, reorder } from '../src/pane';
import { DrawingManager, type DrawingHost } from '../src/drawing/manager';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { withBuiltinTools } from './builtin-tools';

const p = (stretch: number, collapsed = false) => ({ stretch, collapsed });

describe('layoutPanes', () => {
  it('splits the height by stretch, the last pane absorbing rounding', () => {
    expect(layoutPanes([p(1), p(0.25), p(0.25)], 601)).toEqual([
      { top: 0, height: 401 },
      { top: 401, height: 100 },
      { top: 501, height: 100 },
    ]);
  });

  it('gives collapsed panes a fixed header and the rest to the others', () => {
    const slots = layoutPanes([p(1), p(1, true), p(1)], 524);
    expect(slots.map((s) => s.height)).toEqual([250, COLLAPSED_PANE_HEIGHT, 250]);
    expect(slots[2]!.top).toBe(274);
  });

  it('lets a maximized pane take everything', () => {
    expect(layoutPanes([p(1), p(0.5, true), p(0.5)], 500, 1)).toEqual([
      { top: 0, height: 0 },
      { top: 0, height: 500 },
      { top: 500, height: 0 },
    ]);
  });

  it('keeps filling the plot when every pane is collapsed', () => {
    expect(layoutPanes([p(1, true), p(1, true)], 300).map((s) => s.height)).toEqual([24, 276]);
  });
});

describe('pane order', () => {
  it('reorders and reports where each index went', () => {
    const list = ['main', 'a', 'b', 'c'];
    expect(reorder(list, 3, 1)).toEqual([0, 2, 3, 1]);
    expect(list).toEqual(['main', 'c', 'a', 'b']);
    expect(reorder(list, 1, 2)).toEqual([0, 2, 1, 3]);
  });

  it('maps indices after a removal', () => {
    expect(removalMap(4, 2)).toEqual([0, 1, -1, 2]);
  });
});

describe('drawings follow panes', () => {
  function manager() {
    const timeline = new Timeline();
    timeline.set([0, 60]);
    const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
    const panes = [0, 1, 2].map((i) => new Pane(i, { stretch: 1, marginTop: 0, marginBottom: 0 }));
    const host: DrawingHost = {
      theme: darkTheme,
      timeline,
      time,
      panes,
      magnetPrice: (_i, price) => price,
      formatPrice: (_p, price) => String(price),
      requestOverlay: () => {},
      editText: (_a, _i, done) => done(null),
      emit: () => {},
    };
    return withBuiltinTools(new DrawingManager(host));
  }
  const hline = (pane: number) => ({ type: 'hline', pane, points: [{ time: 0, price: pane }], style: {} });

  it('remaps pane indices and drops drawings of a removed pane, history included', () => {
    const m = manager();
    m.add(hline(0));
    m.add(hline(1));
    m.add(hline(2));
    m.remapPanes(removalMap(3, 1));
    expect(m.getAll().map((d) => d.pane)).toEqual([0, 1]);
    // Undo restores the earlier state with the new indices.
    m.undo();
    expect(m.getAll().map((d) => d.pane)).toEqual([0]);
  });
});
