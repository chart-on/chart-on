import { describe, expect, it } from 'vitest';
import { createDepthLane } from '@chart-on/core';
import { fakeContainer, runFrame } from '../../core/test/fake-dom';
import { createDepthLadder, depthLadderRows } from '../src/depth-ladder';

const book = {
  bids: [
    { price: 100, size: 4 },
    { price: 99, size: 8 },
    { price: 98, size: 1 },
  ],
  asks: [
    { price: 101, size: 2 },
    { price: 102, size: 6 },
  ],
};

describe('depthLadderRows', () => {
  it('lists asks above bids with the spread in the middle, shaded by size', () => {
    const rows = depthLadderRows(book, 2);
    expect(rows.map((r) => [r.side, r.price, r.fill, r.best])).toEqual([
      ['ask', 102, 0.75, false],
      ['ask', 101, 0.25, true],
      ['bid', 100, 0.5, true],
      ['bid', 99, 1, false],
    ]);
    expect(depthLadderRows({ bids: [], asks: [] }, 5)).toEqual([]);
  });
});

describe('createDepthLadder', () => {
  it('renders the lane levels and follows its changes once per frame', () => {
    const host = fakeContainer();
    const lane = createDepthLane();
    lane.setLevels(book);
    const ladder = createDepthLadder(host, lane, { depth: 1, formatPrice: (p) => p.toFixed(1) });
    const text = () =>
      (ladder.el.children[1] as unknown as { children: { children: { textContent: string }[] }[] }).children.map((row) =>
        row.children.map((cell) => cell.textContent).join(' '),
      );
    expect(text()).toEqual(['101.0 2', '100.0 4']);
    lane.update({ bids: [{ price: 100.5, size: 1500 }] });
    expect(text()).toEqual(['101.0 2', '100.0 4']);
    runFrame(16);
    expect(text()).toEqual(['101.0 2', '100.5 1.5K']);
    ladder.destroy();
    lane.clear();
    runFrame(16);
    expect(text()).toEqual(['101.0 2', '100.5 1.5K']);
  });
});
