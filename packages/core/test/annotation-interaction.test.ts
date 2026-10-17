import { describe, expect, it, vi } from 'vitest';
import { AnnotationManager, type AnnotationHost } from '../src/annotations/manager';
import { lines, tradingManager } from './trading-manager';
import type { ClusterClickEvent } from '../src/annotations/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { darkTheme } from '../src/theme';
import { Timeline } from '../src/timeline';

// Linear scale: price = 500 - y. Blocks are 20 px tall, text 7 px per character.
function setup(plotLeft = 0) {
  const tl = new Timeline();
  tl.set(Array.from({ length: 100 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = 100;
  const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  pane.height = 500;
  pane.price.height = 500;
  pane.price.fit(0, 500);
  const clusters: ClusterClickEvent[] = [];
  const measureText = vi.fn((text: string) => text.length * 7);
  const host: AnnotationHost = {
    theme: darkTheme,
    timeline: tl,
    time,
    panes: [pane],
    plotLeft,
    main: null,
    formatPrice: (_pane, price) => price.toFixed(2),
    formatAxis: (_pane, price) => price.toFixed(2),
    measureText,
    axisLabel: () => {},
    requestOverlay: () => {},
    attachPrimitive: () => () => {},
    clusterClick: (e) => clusters.push(e),
  };
  return { manager: tradingManager(host), clusters, measureText };
}

const click = (m: AnnotationManager, x: number, y: number) => {
  const taken = m.pointerDown({ x, y });
  m.pointerUp({ x, y });
  return taken;
};

/** A context that records the text drawn on it. */
function textContext(texts: string[]): CanvasRenderingContext2D {
  return new Proxy(
    {},
    {
      get: (_t, key) => (key === 'fillText' ? (text: string) => texts.push(text) : () => {}),
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
}

describe('line hover and click', () => {
  it('fires hover once per enter and leave, not per button or move', () => {
    const { manager } = setup();
    const onHover = vi.fn();
    const onHoverEnd = vi.fn();
    const line = manager.addTradeLine({ price: 300, side: 'buy', onHover, onHoverEnd, onAction: () => {} });
    manager.pointerMove({ x: 300, y: 200 });
    manager.pointerMove({ x: 320, y: 201 });
    manager.pointerMove({ x: 990, y: 200 }); // onto the block's cancel button
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onHover).toHaveBeenCalledWith({ line, part: 'entry', price: 300, point: { x: 300, y: 200 } });
    manager.pointerMove({ x: 300, y: 400 });
    manager.pointerMove(null);
    expect(onHoverEnd).toHaveBeenCalledTimes(1);
  });

  it('clicks a draggable line only when it was not dragged', () => {
    const { manager } = setup();
    const onClick = vi.fn();
    const onChange = vi.fn();
    manager.addTradeLine({ price: 300, side: 'buy', tickSize: 1, confirmChanges: false, onClick, onChange });
    expect(click(manager, 300, 200)).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0]![0]).toMatchObject({ part: 'entry', price: 300 });
    manager.pointerDown({ x: 300, y: 200 });
    manager.pointerMove({ x: 300, y: 150 });
    manager.pointerUp({ x: 300, y: 150 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('takes the press for a click-only line, and leaves other lines to panning', () => {
    const { manager } = setup();
    const onClick = vi.fn();
    manager.addTradeLine({ price: 300, side: 'buy', onClick });
    manager.addTradeLine({ price: 100, side: 'sell' });
    expect(click(manager, 300, 200)).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(manager.pointerDown({ x: 300, y: 400 })).toBe(false);
  });

  it('does not click when the press moves away', () => {
    const { manager } = setup();
    const onClick = vi.fn();
    manager.addAlertLine({ price: 300, onClick });
    manager.pointerDown({ x: 300, y: 200 });
    manager.pointerUp({ x: 340, y: 200 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('hit-tests price lines only with pointer callbacks or a tooltip', () => {
    const { manager } = setup();
    manager.addPriceLine({ price: 300 });
    expect(manager.pointerDown({ x: 300, y: 200 })).toBe(false);
    const onClick = vi.fn();
    const line = manager.addPriceLine({ price: 300, onClick });
    expect(click(manager, 300, 200)).toBe(true);
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ line, part: 'entry', price: 300 }));
    line.applyOptions({ lineOnly: true });
    expect(manager.pointerDown({ x: 300, y: 200 })).toBe(false);
  });
});

describe('pointer coordinates and lifecycle', () => {
  it('reports hover and click points in chart-root css px, past a left axis', () => {
    const { manager } = setup(60);
    const onHover = vi.fn();
    const onClick = vi.fn();
    manager.addTradeLine({ price: 300, side: 'buy', onHover, onClick });
    manager.pointerMove({ x: 300, y: 200 });
    expect(onHover.mock.calls[0]![0].point).toEqual({ x: 360, y: 200 });
    click(manager, 310, 200);
    expect(onClick.mock.calls[0]![0].point).toEqual({ x: 370, y: 200 });
    const onChange = vi.fn();
    const drag = vi.fn();
    manager.addTradeLine({ price: 100, side: 'buy', onChange, onClick: drag });
    click(manager, 320, 400);
    expect(drag.mock.calls[0]![0].point).toEqual({ x: 380, y: 400 });
  });

  it('anchors a cluster click in chart-root css px', () => {
    const { manager, clusters } = setup(60);
    manager.applyOptions({ overlap: 'cluster' });
    manager.addTradeLine({ price: 300, side: 'buy' });
    manager.addTradeLine({ price: 305, side: 'buy' });
    const summaryX = 1000 - 8 - (8 * 7 + 12) / 2;
    click(manager, summaryX, 200);
    expect(clusters[0]!.anchor).toEqual({ x: summaryX + 60, y: 200 });
  });

  it('ends the hover of a removed or cleared line', () => {
    const { manager } = setup();
    const onHoverEnd = vi.fn();
    const line = manager.addTradeLine({ price: 300, side: 'buy', onHoverEnd });
    manager.pointerMove({ x: 300, y: 200 });
    line.remove();
    expect(onHoverEnd).toHaveBeenCalledTimes(1);
    expect(manager.isHovering).toBe(false);
    manager.addPriceLine({ price: 300, onHoverEnd });
    manager.pointerMove({ x: 300, y: 200 });
    manager.clear();
    expect(onHoverEnd).toHaveBeenCalledTimes(2);
    manager.pointerMove(null);
    expect(onHoverEnd).toHaveBeenCalledTimes(2);
  });

  it('uses a wider click slop for touch presses', () => {
    const { manager } = setup();
    const onClick = vi.fn();
    manager.addTradeLine({ price: 300, side: 'buy', onClick });
    manager.pointerDown({ x: 300, y: 200 }, true);
    manager.pointerUp({ x: 306, y: 200 });
    expect(onClick).toHaveBeenCalledTimes(1);
    manager.pointerDown({ x: 300, y: 200 });
    manager.pointerUp({ x: 306, y: 200 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('draws no title for a line-only price line', () => {
    const { manager } = setup();
    manager.addPriceLine({ price: 300, title: 'Target', lineOnly: true });
    const texts: string[] = [];
    manager.render(textContext(texts));
    expect(texts).not.toContain('Target');
    manager.addPriceLine({ price: 200, title: 'Stop' });
    manager.render(textContext(texts));
    expect(texts).toContain('Stop');
  });
});

describe('line labels', () => {
  it('anchors the block left, centre or right, and brackets follow', () => {
    const { manager } = setup();
    const onAction = vi.fn();
    const line = manager.addTradeLine({ price: 300, side: 'buy', takeProfit: 350, labelAnchor: 'left', onAction });
    // Left blocks start 8 px from the edge; the cancel button ends the block.
    const blockWidth = (text: string) => text.length * 7 + 12;
    const cancelX = (label: string) => 8 + blockWidth(label) + blockWidth('300.00') + 10;
    expect(click(manager, cancelX('Buy'), 200)).toBe(true);
    expect(onAction).toHaveBeenLastCalledWith({ action: 'cancel', part: 'entry' });
    expect(click(manager, 8 + blockWidth('TP') + blockWidth('350.00') + 10, 150)).toBe(true);
    expect(onAction).toHaveBeenLastCalledWith({ action: 'cancel', part: 'takeProfit' });
    line.applyOptions({ labelAnchor: 'right' });
    expect(click(manager, cancelX('Buy'), 230)).toBe(false);
  });

  it('skips label layout and hit testing for line-only lines', () => {
    const { manager, measureText } = setup();
    for (let i = 0; i < 300; i++) manager.addTradeLine({ price: 100 + i, side: 'buy', lineOnly: true, onChange: () => {} });
    measureText.mockClear();
    manager.pointerMove({ x: 300, y: 250 });
    expect(manager.pointerDown({ x: 300, y: 250 })).toBe(false);
    expect(measureText).not.toHaveBeenCalled();
  });

  it('draws a hovered line tooltip with every line of text', () => {
    const { manager } = setup();
    manager.addTradeLine({ price: 300, side: 'buy', tooltip: ['Margin 120', 'Risk 2%'] });
    manager.pointerMove({ x: 300, y: 200 });
    const texts: string[] = [];
    manager.renderLabels(textContext(texts));
    expect(texts).toEqual(expect.arrayContaining(['Margin 120', 'Risk 2%']));
  });
});

describe('label clustering', () => {
  const clustered = (m: AnnotationManager) => (lines(m) as unknown as { clusterOf: Map<unknown, number> }).clusterOf;

  it('folds overlapping orders into one label whose click lists them', () => {
    const { manager, clusters } = setup();
    manager.applyOptions({ overlap: 'cluster' });
    const a = manager.addTradeLine({ price: 300, side: 'buy' });
    const b = manager.addTradeLine({ price: 305, side: 'buy' });
    manager.addTradeLine({ price: 100, side: 'sell' });
    const onClusterClick = vi.fn((e: ClusterClickEvent) => expect(e.defaultPrevented).toBe(false));
    manager.applyOptions({ onClusterClick });
    // The summary sits at the lowest line (price 300, y 200), right-aligned: "2 orders".
    const summaryX = 1000 - 8 - (8 * 7 + 12) / 2;
    expect(click(manager, summaryX, 200)).toBe(true);
    expect(onClusterClick).toHaveBeenCalledTimes(1);
    expect(clusters[0]!.lines).toEqual([b, a]);
    expect(clustered(manager).size).toBe(2);
  });

  it('lets onClusterClick stop the default list', () => {
    const { manager, clusters } = setup();
    manager.applyOptions({ overlap: 'cluster', onClusterClick: (e) => e.preventDefault() });
    manager.addTradeLine({ price: 300, side: 'buy' });
    manager.addTradeLine({ price: 302, side: 'buy' });
    click(manager, 1000 - 8 - 30, 200);
    expect(clusters[0]!.defaultPrevented).toBe(true);
  });

  it('splits only past splitGapPx and needs minLines', () => {
    const { manager } = setup();
    manager.applyOptions({ overlap: 'cluster', cluster: { mergeGapPx: 0, splitGapPx: 6 } });
    const lower = manager.addTradeLine({ price: 310, side: 'buy' });
    manager.addTradeLine({ price: 320, side: 'buy' });
    manager.pointerMove({ x: 0, y: 0 });
    expect(clustered(manager).size).toBe(2);
    // 3 px apart: still together (below the split gap).
    lower.applyOptions({ price: 297 });
    manager.pointerMove({ x: 1, y: 0 });
    expect(clustered(manager).size).toBe(2);
    // 10 px apart: split.
    lower.applyOptions({ price: 290 });
    manager.pointerMove({ x: 2, y: 0 });
    expect(clustered(manager).size).toBe(0);
    // 3 px apart again: not merged, since only overlapping blocks merge.
    lower.applyOptions({ price: 297 });
    manager.pointerMove({ x: 3, y: 0 });
    expect(clustered(manager).size).toBe(0);
    manager.applyOptions({ cluster: { minLines: 3 } });
    lower.applyOptions({ price: 315 });
    manager.pointerMove({ x: 4, y: 0 });
    expect(clustered(manager).size).toBe(0);
  });

  it('folds only labels that overlap across the plot too', () => {
    const { manager } = setup();
    manager.applyOptions({ overlap: 'cluster' });
    const a = manager.addTradeLine({ price: 300, side: 'buy', labelAnchor: 'left' });
    manager.addTradeLine({ price: 302, side: 'buy' });
    manager.pointerMove({ x: 0, y: 0 });
    expect(clustered(manager).size).toBe(0);
    // A third left label near the first folds with it, past the right one between them.
    const c = manager.addTradeLine({ price: 304, side: 'buy', labelAnchor: 'left' });
    manager.pointerMove({ x: 1, y: 0 });
    expect([...clustered(manager).keys()]).toEqual([c, a]);
  });

  it('drags a clustered line from inside the summary label once the press moves', () => {
    const { manager, clusters } = setup();
    manager.applyOptions({ overlap: 'cluster' });
    const onChange = vi.fn();
    manager.addTradeLine({ price: 300, side: 'buy', tickSize: 1, confirmChanges: false, onChange });
    manager.addTradeLine({ price: 305, side: 'buy', tickSize: 1, onChange: () => {} });
    const summaryX = 1000 - 8 - (8 * 7 + 12) / 2;
    expect(manager.pointerDown({ x: summaryX, y: 200 })).toBe(true);
    manager.pointerMove({ x: summaryX, y: 150 });
    manager.pointerUp({ x: summaryX, y: 150 });
    expect(onChange).toHaveBeenCalledWith({ part: 'entry', price: 350, from: 300 });
    expect(clusters).toHaveLength(0);
    // A still press is still the summary's click.
    manager.addTradeLine({ price: 100, side: 'buy', onChange: () => {} });
    manager.addTradeLine({ price: 103, side: 'buy', onChange: () => {} });
    click(manager, summaryX, 400);
    expect(clusters).toHaveLength(1);
  });

  it('keeps cluster hysteresis when unrelated options change', () => {
    const { manager } = setup();
    manager.applyOptions({ overlap: 'cluster', cluster: { mergeGapPx: 0, splitGapPx: 6 } });
    const lower = manager.addTradeLine({ price: 310, side: 'buy' });
    manager.addTradeLine({ price: 320, side: 'buy' });
    manager.pointerMove({ x: 0, y: 0 });
    // 3 px apart: together only through hysteresis.
    lower.applyOptions({ price: 297 });
    manager.pointerMove({ x: 1, y: 0 });
    expect(clustered(manager).size).toBe(2);
    manager.applyOptions({ onClusterClick: () => {} });
    manager.pointerMove({ x: 2, y: 0 });
    expect(clustered(manager).size).toBe(2);
    manager.applyOptions({ cluster: { mergeGapPx: 1 } });
    manager.pointerMove({ x: 3, y: 0 });
    expect(clustered(manager).size).toBe(0);
  });
});
