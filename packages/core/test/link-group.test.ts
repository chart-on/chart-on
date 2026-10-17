import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer, pendingFrames, runFrame } from './fake-dom';
import { Chart } from '../src/chart';
import { createLinkGroup } from '../src/link-group';
import type { DataSource } from '../src/data/types';
import { intervalSeconds } from '../src/data/util';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = (count: number, step: number): Bar[] =>
  Array.from({ length: count }, (_, i) => ({ time: i * step, open: 1, high: 2 + (i % 5), low: 0, close: 1 }));

function chart(step: number | null = 60, count = 200): Chart {
  const c = new Chart(fakeContainer());
  charts.push(c);
  if (step !== null) c.addCandles({ animate: false }).setData(bars(count, step));
  return c;
}

const render = (c: Chart) => {
  c.invalidate();
  (c as unknown as { render(dt: number): boolean }).render(0);
};

/** Render every chart a few times, as consecutive frames would. */
const frames = (...cs: Chart[]) => {
  for (let i = 0; i < 3; i++) cs.forEach(render);
};

const emit = (c: Chart, event: string, payload: unknown) =>
  (c as unknown as { emit(event: string, payload: unknown): void }).emit(event, payload);

const mirror = (c: Chart) => (c as unknown as { mirror: { time: number } | null }).mirror;

function expectSameRange(a: Chart, b: Chart, tolerance: number) {
  const ra = a.getVisibleRange()!;
  const rb = b.getVisibleRange()!;
  expect(Math.abs(ra.from - rb.from)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(ra.to - rb.to)).toBeLessThanOrEqual(tolerance);
}

describe('link groups', () => {
  it('pans and zooms the other charts to the same time span', () => {
    const a = chart(60);
    const b = chart(60);
    const group = createLinkGroup([a, b]);
    frames(a, b);
    a.setVisibleIndexRange(40, 90, false);
    render(a);
    expectSameRange(a, b, 60);
    expect(b.getVisibleIndexRange()!.from).toBeCloseTo(40, 6);
    expect(b.getVisibleIndexRange()!.to).toBeCloseTo(90, 6);
    group.destroy();
  });

  it('maps the span by time across intervals', () => {
    const a = chart(60, 600);
    const b = chart(300, 120);
    createLinkGroup([a, b]);
    frames(a, b);
    a.setVisibleIndexRange(100, 400, false);
    render(a);
    // 1-minute indices 100..400 are 6000..24000 s: 5-minute indices 20..80.
    expect(b.getVisibleIndexRange()!.from).toBeCloseTo(20, 6);
    expect(b.getVisibleIndexRange()!.to).toBeCloseTo(80, 6);
  });

  it('does not echo a followed range back to its source', () => {
    const a = chart(60);
    const b = chart(60);
    createLinkGroup([a, b]);
    frames(a, b);
    a.setVisibleIndexRange(40, 90, false);
    render(a);
    const followA = vi.spyOn(a, 'followIndexRange');
    const followB = vi.spyOn(b, 'followIndexRange');
    frames(b, a);
    expect(followA).not.toHaveBeenCalled();
    expect(followB).not.toHaveBeenCalled();
  });

  it('settles when the follower clamps the range', () => {
    const a = chart(60, 400);
    const b = chart(60, 20);
    createLinkGroup([a, b]);
    frames(a, b);
    a.setVisibleIndexRange(0, 300, false);
    render(a);
    const followA = vi.spyOn(a, 'followIndexRange');
    frames(b, a, b);
    expect(followA).not.toHaveBeenCalled();
    expect(a.getVisibleIndexRange()!.from).toBeCloseTo(0, 6);
  });

  it('pans four charts together with one move and one frame per chart per step', () => {
    const cs = [chart(60, 2000), chart(60, 2000), chart(60, 2000), chart(60, 2000)];
    const [a, ...followers] = cs as [Chart, ...Chart[]];
    createLinkGroup(cs);
    let now = 1000;
    const settle = () => {
      for (let i = 0; i < 100 && pendingFrames() > 0; i++) runFrame((now += 16));
    };
    settle();
    const draws = cs.map((c) => vi.spyOn(c as unknown as { render(dt: number): boolean }, 'render'));
    const follows = cs.map((c) => vi.spyOn(c, 'followIndexRange'));
    for (let step = 1; step <= 10; step++) {
      a.setVisibleIndexRange(500 + step * 7, 700 + step * 7, false);
      runFrame((now += 16));
      // Followers move in the leader's frame and draw in the next one: at most one frame each is waiting.
      expect(pendingFrames()).toBe(followers.length);
      expect(follows.map((f) => f.mock.calls.length)).toEqual([0, step, step, step]);
      for (const c of followers) expect(c.getVisibleIndexRange()!.from).toBeCloseTo(500 + step * 7, 6);
    }
    expect(draws.map((d) => d.mock.calls.length)).toEqual([10, 9, 9, 9]);
    settle();
    // Nothing echoes back or keeps animating once the pan stops.
    expect(draws.map((d) => d.mock.calls.length)).toEqual([10, 10, 10, 10]);
    expect(follows[0]).not.toHaveBeenCalled();
  });

  it('leaves a follower\'s manual price range alone', () => {
    const a = chart(60);
    const b = chart(60);
    createLinkGroup([a, b]);
    frames(a, b);
    b.setPriceRange({ from: -10, to: 10 });
    a.setVisibleIndexRange(40, 90, false);
    render(a);
    expect(b.getPriceScaleOptions()!.autoScale).toBe(false);
    expect(b.getPriceRange()).toEqual({ from: -10, to: 10 });
  });

  it('lets a chart that gets its first bars take the group\'s range', () => {
    const a = chart(60);
    const b = chart(null);
    createLinkGroup([a, b]);
    frames(a, b);
    a.setVisibleIndexRange(40, 90, false);
    frames(a, b);
    b.addCandles({ animate: false }).setData(bars(200, 60));
    frames(b, a);
    expect(a.getVisibleIndexRange()!.from).toBeCloseTo(40, 6);
    expect(b.getVisibleIndexRange()!.from).toBeCloseTo(40, 6);
  });

  it('brings a chart that joins to the first chart\'s range', () => {
    const a = chart(60);
    const b = chart(60);
    frames(a, b);
    a.setVisibleIndexRange(10, 50, false);
    render(a);
    const group = createLinkGroup([a]);
    group.add(b);
    expect(b.getVisibleIndexRange()!.from).toBeCloseTo(10, 6);
    expect(group.charts).toEqual([a, b]);
  });

  it('mirrors the crosshair time, and clears it when the link is switched off', () => {
    const a = chart(60);
    const b = chart(60);
    const group = createLinkGroup([a, b]);
    frames(a, b);
    emit(a, 'crosshair:move', { time: 600, index: 10, price: 1, pane: 0, locked: false });
    expect(mirror(b)?.time).toBe(600);
    expect(mirror(a)).toBeNull();
    emit(a, 'crosshair:move', null);
    expect(mirror(b)).toBeNull();
    emit(a, 'crosshair:move', { time: 600, index: 10, price: 1, pane: 0, locked: false });
    group.applyOptions({ crosshair: false });
    expect(mirror(b)).toBeNull();
    emit(a, 'crosshair:move', { time: 1200, index: 20, price: 1, pane: 0, locked: false });
    expect(mirror(b)).toBeNull();
  });

  it('keeps the timezone in step', () => {
    const a = chart(60);
    const b = chart(60);
    createLinkGroup([a, b]);
    a.applyOptions({ timezone: 'UTC' });
    expect(b.options.timezone).toBe('UTC');
    b.applyOptions({ timezone: 'America/New_York' });
    expect(a.options.timezone).toBe('America/New_York');
  });

  it('does nothing for links that are off', () => {
    const a = chart(60);
    const b = chart(60);
    createLinkGroup([a, b], { visibleRange: false, timezone: false });
    frames(a, b);
    const before = b.getVisibleIndexRange()!;
    a.setVisibleIndexRange(40, 90, false);
    render(a);
    a.applyOptions({ timezone: 'UTC' });
    expect(b.getVisibleIndexRange()).toEqual(before);
    expect(b.options.timezone).toBe('local');
  });

  it('leaves the group when a chart is destroyed, and stops listening when removed', () => {
    const a = chart(60);
    const b = chart(60);
    const c = chart(60);
    const group = createLinkGroup([a, b, c]);
    b.destroy();
    expect(group.charts).toEqual([a, c]);
    group.remove(c);
    a.applyOptions({ timezone: 'UTC' });
    expect(c.options.timezone).toBe('local');
    group.destroy();
    expect(group.charts).toEqual([]);
    expect(() => group.add(a)).toThrow(expect.objectContaining({ code: 'destroyed' }));
  });

  describe('drawings', () => {
    const line = (pane = 0) => ({ type: 'trendline', pane, points: [{ time: 600, price: 2 }, { time: 1200, price: 3 }], style: {} });

    it('leaves drawings on their own chart by default', () => {
      const a = chart();
      const b = chart();
      createLinkGroup([a, b]);
      a.drawings.add(line());
      expect(b.drawings.getAll()).toEqual([]);
    });

    it('mirrors adding, editing and removing a drawing', () => {
      const a = chart();
      const b = chart();
      const c = chart();
      createLinkGroup([a, b, c], { drawings: true });
      const d = a.drawings.add(line());
      expect(b.drawings.getById(d.id)).toEqual(d);
      expect(c.drawings.getById(d.id)).toEqual(d);
      a.drawings.update(d.id, { points: [{ time: 60, price: 1 }, { time: 120, price: 4 }], style: { color: '#123456' }, text: 'x', locked: true });
      expect(b.drawings.getById(d.id)).toEqual(a.drawings.getById(d.id));
      // An edit on a copy goes back to the chart it came from.
      b.drawings.update(d.id, { locked: false, text: '' });
      expect(a.drawings.getById(d.id)).toEqual(b.drawings.getById(d.id));
      expect(c.drawings.getById(d.id)?.locked).toBeUndefined();
      c.drawings.remove(d.id);
      expect(a.drawings.getAll()).toEqual([]);
      expect(b.drawings.getAll()).toEqual([]);
    });

    it('mirrors undo, and records one step on each chart', () => {
      const a = chart();
      const b = chart();
      createLinkGroup([a, b], { drawings: true });
      a.drawings.add(line());
      expect(b.drawings.canUndo).toBe(true);
      a.drawings.undo();
      expect(b.drawings.getAll()).toEqual([]);
    });

    it('does not echo a mirrored change back to its source', () => {
      const a = chart();
      const b = chart();
      createLinkGroup([a, b], { drawings: true });
      const add = vi.spyOn(a.drawings, 'add');
      const update = vi.spyOn(a.drawings, 'update');
      const d = a.drawings.add(line());
      a.drawings.update(d.id, { text: 'moved' });
      expect(add).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledTimes(1);
    });

    it('settles when two groups link the same charts', () => {
      const a = chart();
      const b = chart();
      createLinkGroup([a, b], { drawings: true });
      createLinkGroup([b, a], { drawings: true });
      const d = a.drawings.add(line());
      a.drawings.update(d.id, { text: 'both' });
      expect(b.drawings.getAll()).toHaveLength(1);
      expect(b.drawings.getById(d.id)?.text).toBe('both');
      // The copy's change went back to a as a no-op: one undo step each.
      a.drawings.undo();
      expect(a.drawings.getById(d.id)?.text).toBeUndefined();
      expect(b.drawings.getById(d.id)?.text ?? '').toBe('');
      a.drawings.undo();
      expect(b.drawings.getAll()).toEqual([]);
    });

    it('keeps app drawings and drawings on other panes on their chart', () => {
      const a = chart();
      const b = chart();
      a.addPane();
      b.addPane();
      createLinkGroup([a, b], { drawings: true });
      a.drawings.add({ ...line(), persist: false });
      a.drawings.add(line(1));
      expect(b.drawings.getAll()).toEqual([]);
    });

    it('adds a drawing the other chart lacks on its next edit, and skips tools it does not have', () => {
      const a = chart();
      const b = chart();
      const group = createLinkGroup([a, b]);
      const d = a.drawings.add(line());
      group.applyOptions({ drawings: true });
      expect(b.drawings.getAll()).toEqual([]);
      a.drawings.update(d.id, { text: 'now' });
      expect(b.drawings.getById(d.id)?.text).toBe('now');
      const tool = a.drawings.getTools().find((t) => t.type === 'trendline')!;
      a.drawings.register({ ...tool, type: 'own-line' });
      expect(() => a.drawings.add({ ...line(), type: 'own-line' })).not.toThrow();
      expect(b.drawings.getAll()).toHaveLength(1);
    });
  });

  describe('symbol and interval', () => {
    const HOUR = 3600;
    const source: DataSource = {
      symbol: async (symbol) => ({ symbol, name: symbol }),
      search: async () => [],
      history: async (_info, interval, req) => {
        const step = intervalSeconds(interval);
        const list: Bar[] = [];
        for (let i = 0; i < req.limit; i++) list.push({ time: 1000 * HOUR + i * step, open: 1, high: 2, low: 0, close: 1 });
        return { bars: list, atStart: true };
      },
    };

    function sourced(symbol: string, interval: '1h' | '1d') {
      const c = chart(null);
      c.setDataSource(source, { initialBars: 50 });
      void c.setSymbol(symbol, interval);
      return c;
    }

    it('loads the linked symbol and keeps each chart\'s interval', () => {
      const a = sourced('AAA', '1h');
      const b = sourced('BBB', '1d');
      createLinkGroup([a, b], { symbol: true });
      const load = vi.spyOn(b, 'setSymbol');
      void a.setSymbol('CCC', '1h');
      expect(load).toHaveBeenCalledWith('CCC', '1d');
      // b's own load request is not sent back to a.
      const loadA = vi.spyOn(a, 'setSymbol');
      void b.setSymbol('CCC', '1d');
      expect(loadA).not.toHaveBeenCalled();
    });

    it('loads the linked interval and keeps each chart\'s symbol', () => {
      const a = sourced('AAA', '1h');
      const b = sourced('BBB', '1h');
      createLinkGroup([a, b], { interval: true });
      const load = vi.spyOn(b, 'setSymbol');
      void a.setSymbol('AAA', '1d');
      expect(load).toHaveBeenCalledWith('BBB', '1d');
    });

    it('mirrors drawings only between charts showing the same symbol', () => {
      const a = sourced('AAA', '1h');
      const b = sourced('BBB', '1h');
      const c = sourced('AAA', '1d');
      createLinkGroup([a, b, c], { drawings: true });
      const d = a.drawings.add({ type: 'hline', pane: 0, points: [{ time: 0, price: 1 }], style: {} });
      expect(b.drawings.getAll()).toEqual([]);
      expect(c.drawings.getById(d.id)).toEqual(d);
    });

    it('brings the other charts to the first chart\'s symbol when the link is switched on', () => {
      const a = sourced('AAA', '1h');
      const b = sourced('BBB', '1d');
      const group = createLinkGroup([a, b]);
      const load = vi.spyOn(b, 'setSymbol');
      group.applyOptions({ symbol: true, interval: true });
      expect(load).toHaveBeenCalledWith('AAA', '1h');
    });
  });
});
