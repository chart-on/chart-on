import { describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import type { PrimitiveEnv, PrimitiveHost } from '../src/primitives';
import {
  createSessionBands,
  DEFAULT_SESSION_LANES,
  sessionLaneIntervals,
  sessionLaneState,
  type SessionLane,
} from '../src/session-bands';
import { darkTheme } from '../src/theme';
import type { SessionSchedule } from '../src/util/session';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000;
const HOUR = 3600;

const weekdays = (start: string, end: string): SessionSchedule => ({
  weekly: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, [{ start, end }]])),
});

const lane = (over: Partial<SessionLane> = {}): SessionLane => ({
  id: 'ny',
  name: 'New York',
  timezone: 'America/New_York',
  hours: weekdays('09:30', '16:00'),
  color: '#ff0000',
  ...over,
});

describe('session lane intervals', () => {
  it('follows the lane timezone across the spring daylight saving change', () => {
    // US clocks went forward on Sunday 2024-03-10.
    const list = sessionLaneIntervals(lane(), utc(2024, 3, 8), utc(2024, 3, 12));
    expect(list).toEqual([
      [utc(2024, 3, 8, 14, 30), utc(2024, 3, 8, 21)], // Friday, UTC-5
      [utc(2024, 3, 11, 13, 30), utc(2024, 3, 11, 20)], // Monday, UTC-4
    ]);
  });

  it('follows the lane timezone across the autumn change', () => {
    // UK clocks went back on Sunday 2024-10-27.
    const london = lane({ id: 'ldn', timezone: 'Europe/London', hours: weekdays('08:00', '16:30') });
    const list = sessionLaneIntervals(london, utc(2024, 10, 25), utc(2024, 10, 29));
    expect(list).toEqual([
      [utc(2024, 10, 25, 7), utc(2024, 10, 25, 15, 30)], // Friday, UTC+1
      [utc(2024, 10, 28, 8), utc(2024, 10, 28, 16, 30)], // Monday, UTC+0
    ]);
  });

  it('keeps an overnight range whole across the change', () => {
    // Sunday 18:00 to Monday 17:00 New York time: opens after the clocks went forward.
    const overnight = lane({ hours: { weekly: { mon: [{ start: '18:00', end: '17:00' }] } } });
    expect(sessionLaneIntervals(overnight, utc(2024, 3, 9), utc(2024, 3, 13))).toEqual([[utc(2024, 3, 10, 22), utc(2024, 3, 11, 21)]]);
  });

  it('keeps fixed hours in a zone without daylight saving', () => {
    const tokyo = DEFAULT_SESSION_LANES.find((l) => l.id === 'asia')!;
    const list = sessionLaneIntervals(tokyo, utc(2024, 3, 8), utc(2024, 3, 12));
    expect(list).toEqual([
      [utc(2024, 3, 8, 0), utc(2024, 3, 8, 6)],
      [utc(2024, 3, 11, 0), utc(2024, 3, 11, 6)],
    ]);
  });

  it('clips to the span and covers it whole when always open', () => {
    expect(sessionLaneIntervals(lane(), utc(2024, 3, 8, 15), utc(2024, 3, 8, 16))).toEqual([[utc(2024, 3, 8, 15), utc(2024, 3, 8, 16)]]);
    const always = lane({ hours: { weekly: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ start: '00:00', end: '24:00' }]])) } });
    expect(sessionLaneIntervals(always, 100, 200)).toEqual([[100, 200]]);
    expect(sessionLaneIntervals(lane(), 200, 100)).toEqual([]);
  });
});

describe('session lane state', () => {
  it('counts down to the close while open', () => {
    const now = utc(2024, 3, 8, 15);
    expect(sessionLaneState(lane(), now)).toMatchObject({ open: true, next: utc(2024, 3, 8, 21), remaining: 6 * HOUR });
  });

  it('counts down to the next open over a weekend and a daylight saving change', () => {
    const now = utc(2024, 3, 9, 12);
    const state = sessionLaneState(lane(), now);
    expect(state).toMatchObject({ open: false, next: utc(2024, 3, 11, 13, 30) });
    expect(state.remaining).toBe(utc(2024, 3, 11, 13, 30) - now);
  });

  it('has no next change when always open', () => {
    const always = lane({ hours: { weekly: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ start: '00:00', end: '24:00' }]])) } });
    expect(sessionLaneState(always, 0)).toMatchObject({ open: true, next: null, remaining: null });
  });

  it('throws for an unknown timezone or malformed hours', () => {
    expect(() => sessionLaneState(lane({ timezone: 'Nowhere/City' }), 0)).toThrow();
    expect(() => sessionLaneState(lane({ hours: weekdays('9:30', '16:00') }), 0)).toThrow(/HH:MM/);
  });
});

describe('session bands lanes at runtime', () => {
  const setup = () => {
    const bands = createSessionBands({ lanes: [] });
    const host = { requestRedraw: vi.fn() } as unknown as PrimitiveHost;
    bands.attached!(host);
    const changes: string[][] = [];
    bands.on('lanes:change', ({ lanes }) => changes.push(lanes.map((l) => l.id)));
    return { bands, host, changes };
  };

  it('starts with the default regional lanes', () => {
    expect(createSessionBands().lanes.map((l) => l.name)).toEqual(['Asia', 'Europe', 'Americas']);
  });

  it('adds, recolours and removes lanes, redrawing and reporting each change', () => {
    const { bands, host, changes } = setup();
    bands.addLane(lane());
    bands.addLane(lane({ id: 'ldn', name: 'London', timezone: 'Europe/London' }));
    bands.updateLane('ny', { color: '#00ff00' });
    expect(bands.lanes.find((l) => l.id === 'ny')!.color).toBe('#00ff00');
    expect(bands.removeLane('ny')).toBe(true);
    expect(bands.removeLane('ny')).toBe(false);
    expect(changes).toEqual([['ny'], ['ny', 'ldn'], ['ny', 'ldn'], ['ldn']]);
    expect(host.requestRedraw).toHaveBeenCalledTimes(4);
  });

  it('rejects invalid changes without touching the lanes', () => {
    const { bands, changes } = setup();
    bands.addLane(lane());
    expect(() => bands.addLane(lane())).toThrow(/already exists/);
    expect(() => bands.updateLane('ny', { timezone: 'Nowhere/City' })).toThrow();
    expect(() => bands.updateLane('missing', { color: 'red' })).toThrow(/No session lane/);
    expect(() => bands.setLanes([lane({ id: 'a' }), lane({ id: 'a' })])).toThrow(/already exists/);
    expect(bands.lanes).toEqual([lane()]);
    expect(changes).toEqual([['ny']]);
  });

  it('does not share lane objects with the caller', () => {
    const own = lane();
    const bands = createSessionBands({ lanes: [own] });
    own.color = 'blue';
    expect(bands.lanes[0]!.color).toBe('#ff0000');
  });

  it('reports every lane state in order', () => {
    const { bands } = setup();
    bands.setLanes([lane(), lane({ id: 'tky', timezone: 'Asia/Tokyo', hours: weekdays('09:00', '15:00') })]);
    expect(bands.states(utc(2024, 3, 8, 15)).map((s) => [s.lane.id, s.open])).toEqual([
      ['ny', true],
      ['tky', false],
    ]);
  });

  it('draws columns under the series and bands with them', () => {
    const bands = createSessionBands({ lanes: [] });
    expect(bands.layer).toBe('normal');
    bands.applyOptions({ mode: 'columns' });
    expect(bands.layer).toBe('below');
  });
});

/** Records fillRect calls with the style in effect. */
function recordingContext() {
  const rects: { x: number; y: number; w: number; h: number; fill: unknown; alpha: number }[] = [];
  const ctx = {
    fillStyle: '#000' as unknown,
    globalAlpha: 1,
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, fill: ctx.fillStyle, alpha: ctx.globalAlpha });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects };
}

/** Hourly bars from Friday 2024-03-08 00:00 UTC; one css px per minute. */
function hourlyEnv(over: Partial<PrimitiveEnv> = {}): PrimitiveEnv {
  const t0 = utc(2024, 3, 8);
  const times = Array.from({ length: 48 }, (_, i) => t0 + i * HOUR);
  return {
    width: 48 * 60,
    height: 300,
    pixelRatio: 1,
    theme: darkTheme,
    from: 0,
    to: 47,
    barSpacing: 60,
    times,
    indexToX: (i) => i * 60,
    xToIndex: (x) => x / 60,
    timeToX: (t) => (t - t0) / 60,
    priceToY: (p) => p,
    yToPrice: (y) => y,
    formatPrice: String,
    ...over,
  };
}

describe('session bands drawing', () => {
  const lanes = [lane(), lane({ id: 'tky', timezone: 'Asia/Tokyo', hours: weekdays('09:00', '15:00'), color: '#0000ff' })];

  it('stacks one strip per lane at the bottom of the plot', () => {
    const bands = createSessionBands({ lanes, bandHeight: 4, bandGap: 1 });
    const { ctx, rects } = recordingContext();
    bands.drawPlot!(ctx, hourlyEnv());
    expect(rects).toEqual([
      // New York, Friday 14:30–21:00 UTC; the upper strip.
      { x: 14.5 * 60, y: 300 - 10 + 1, w: 6.5 * 60, h: 4, fill: '#ff0000', alpha: 0.9 },
      // Tokyo, Friday 00:00–06:00 UTC; the strip on the bottom edge.
      { x: 0, y: 300 - 5 + 1, w: 6 * 60, h: 4, fill: '#0000ff', alpha: 0.9 },
    ]);
  });

  it('shades full-height columns in columns mode', () => {
    const bands = createSessionBands({ lanes: [lanes[0]!], mode: 'columns', opacity: 1, columnOpacity: 0.5 });
    const { ctx, rects } = recordingContext();
    bands.drawPlot!(ctx, hourlyEnv());
    expect(rects).toEqual([{ x: 14.5 * 60, y: 0, w: 6.5 * 60, h: 300, fill: '#ff0000', alpha: 0.5 }]);
  });

  it('draws nothing when hidden, on daily bars, or with nothing to show', () => {
    const { ctx, rects } = recordingContext();
    createSessionBands({ lanes, visible: false }).drawPlot!(ctx, hourlyEnv());
    const daily = Array.from({ length: 10 }, (_, i) => utc(2024, 3, 1) + i * 86400);
    createSessionBands({ lanes }).drawPlot!(ctx, hourlyEnv({ times: daily, from: 0, to: 9 }));
    createSessionBands({ lanes }).drawPlot!(ctx, hourlyEnv({ times: [] }));
    expect(rects).toEqual([]);
  });

  it('redraws a recoloured lane in its new colour', () => {
    const bands = createSessionBands({ lanes: [lanes[0]!] });
    const { ctx, rects } = recordingContext();
    bands.drawPlot!(ctx, hourlyEnv());
    bands.updateLane('ny', { color: '#123456' });
    bands.drawPlot!(ctx, hourlyEnv());
    expect(rects.map((r) => r.fill)).toEqual(['#ff0000', '#123456']);
  });

  it('attaches to a chart as a primitive', () => {
    const chart = new Chart(fakeContainer());
    try {
      const bands = createSessionBands();
      const detached = vi.spyOn(bands, 'detached');
      const detach = chart.attachPrimitive(bands);
      bands.addLane(lane());
      bands.applyOptions({ mode: 'columns' });
      expect(() => chart.attachPrimitive(bands)).toThrow(/already attached/);
      detach();
      expect(detached).toHaveBeenCalledTimes(1);
    } finally {
      chart.destroy();
    }
  });
});
