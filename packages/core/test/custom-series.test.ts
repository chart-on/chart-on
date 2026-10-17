import { describe, expect, it, vi } from 'vitest';
import {
  CustomSeries,
  LineSeries,
  reportSeriesError,
  type CustomSeriesDef,
  type PaneEnv,
  type SeriesErrorEvent,
  type SeriesHost,
} from '../src/series';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';

interface BandPoint {
  time: number;
  upper: number;
  lower: number;
}

const band: CustomSeriesDef<BandPoint, { fill: string }> = {
  type: 'band',
  defaultOptions: { fill: 'red' },
  priceRange: (p) => [p.lower, p.upper],
  draw: vi.fn(),
  legend: (p) => (p ? [{ label: 'U', text: String(p.upper) }, { label: 'L', text: String(p.lower) }] : []),
  lastValue: (p) => ({ value: (p.upper + p.lower) / 2, color: 'blue' }),
  step: vi.fn(() => true),
};

function setup(overlay = false, def: CustomSeriesDef<BandPoint, { fill: string }> = band) {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 10 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 100;
  time.barCount = 10;
  const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  pane.height = 200;
  pane.price.height = 200;
  pane.price.fit(0, 200);
  const host = {
    timeline,
    theme: darkTheme,
    maxTextureSize: 4096,
    mainDataChanged: () => {},
    mainLastBarChanged: () => {},
    requestRender: vi.fn(),
    seriesError: vi.fn<(event: SeriesErrorEvent) => void>(),
  } satisfies SeriesHost;
  const options = { title: 'Band', lastValueLabel: true, format: (v: number) => v.toFixed(1), fill: 'red', ...(overlay ? { overlay: { top: 0.5, bottom: 0 } } : {}) };
  const series = new CustomSeries(host, pane, options, def);
  return { series, time, pane, host };
}

const point = (i: number, mid = 100): BandPoint => ({ time: i * 60, upper: mid + i, lower: mid - i });

describe('CustomSeries', () => {
  it('autoscales over visible items through the definition', () => {
    const { series } = setup();
    series.setData([point(1), point(3), point(8)]);
    expect(series.priceRange(0, 4)).toEqual([97, 103]);
    expect(series.priceRange(5, 6)).toBeNull();
  });

  it('skips items that are not on the timeline', () => {
    const { series } = setup();
    series.setData([point(1), { time: 61, upper: 999, lower: -999 }, point(2)]);
    expect(series.priceRange(0, 9)).toEqual([98, 102]);
  });

  it('hands visible items with x positions and scale helpers to draw', () => {
    const { series, time, pane } = setup();
    series.setData([point(0), point(5), point(9)]);
    const ctx = { save: vi.fn(), restore: vi.fn() } as unknown as CanvasRenderingContext2D;
    series.draw2D(ctx, { time, pane, width: 100, height: 200, from: 4, to: 9, dpr: 2, theme: darkTheme });
    const view = vi.mocked(band.draw).mock.calls.at(-1)![1];
    expect(view.items.map((i) => [i.index, i.x])).toEqual([
      [5, time.indexToX(5)],
      [9, time.indexToX(9)],
    ]);
    expect(view.options.fill).toBe('red');
    expect(view.pixelRatio).toBe(2);
    expect(view.yToPrice(view.priceToY(42))).toBeCloseTo(42);
  });

  it('reports legend values and the last value label', () => {
    const { series } = setup();
    series.setData([point(1), point(2)]);
    expect(series.legend(2)).toEqual({ title: 'Band', parts: [{ label: 'U', text: '102' }, { label: 'L', text: '98' }] });
    expect(series.legend(7).parts).toEqual([]);
    expect(series.lastValue()).toEqual({ value: 100, text: '100.0', color: 'blue' });
    series.applyOptions({ lastValueLabel: false });
    expect(series.lastValue()).toBeNull();
  });

  it('replaces or appends on update and drops older items', () => {
    const { series } = setup();
    series.setData([point(1)]);
    series.update({ ...point(1), upper: 500 });
    series.update(point(2));
    expect(series.data.map((p) => p.upper)).toEqual([500, 102]);
    series.update(point(0));
    expect(series.data.map((p) => p.time)).toEqual([point(1).time, point(2).time]);
  });

  it('gets its own overlay scale and forwards step', () => {
    const { series } = setup(true);
    expect(series.overlayScale).not.toBeNull();
    expect(series.scale).toBe(series.overlayScale);
    expect(series.step(16)).toBe(true);
    expect(band.step).toHaveBeenCalledWith(16, series.data, series.options);
  });

  describe('with a throwing hook', () => {
    /** Canvas mock that tracks the save stack and the clip in effect. */
    function mockCtx() {
      const stack: (string | null)[] = [];
      const ctx = {
        clip: null as string | null,
        save: vi.fn(() => {
          stack.push(ctx.clip);
        }),
        restore: vi.fn(() => {
          if (stack.length) ctx.clip = stack.pop()!;
        }),
        get depth() {
          return stack.length;
        },
      };
      return ctx;
    }

    type Ctx = ReturnType<typeof mockCtx>;
    type Band = CustomSeries<BandPoint, { fill: string }>;

    /** One frame the way the chart draws it: per pane save, clip, series, restore; then the axes unclipped. */
    function frame(ctx: Ctx, series: Band, env: PaneEnv): (string | null)[] {
      const clips: (string | null)[] = [];
      for (const pane of ['pane 0', 'pane 1']) {
        ctx.save();
        ctx.clip = pane;
        if (pane === 'pane 0') series.draw2D(ctx as unknown as CanvasRenderingContext2D, env);
        clips.push(ctx.clip);
        ctx.restore();
      }
      clips.push(ctx.clip); // axes
      return clips;
    }

    function drawSetup(def: CustomSeriesDef<BandPoint, { fill: string }>) {
      const s = setup(false, def);
      s.series.setData([point(1), point(2)]);
      const env: PaneEnv = { time: s.time, pane: s.pane, width: 100, height: 200, from: 0, to: 9, dpr: 1, theme: darkTheme };
      return { ...s, env, ctx: mockCtx() };
    }

    it('keeps save/restore balanced so other panes and axes still draw on later frames', () => {
      const def = {
        ...band,
        draw: vi.fn((ctx: CanvasRenderingContext2D) => {
          ctx.save();
          ctx.save();
          throw new Error('missing field'); // leaves both saves open
        }),
      };
      const { series, host, env, ctx } = drawSetup(def);
      for (let f = 0; f < 3; f++) {
        expect(frame(ctx, series, env)).toEqual(['pane 0', 'pane 1', null]);
        expect(ctx.depth).toBe(0);
      }
      expect(def.draw).toHaveBeenCalledTimes(3);
      expect(ctx.save.mock.calls.length).toBe(ctx.restore.mock.calls.length);
      // Reported once, not every frame.
      expect(host.seriesError).toHaveBeenCalledTimes(1);
      expect(host.seriesError).toHaveBeenCalledWith({
        series,
        hook: 'draw',
        error: expect.objectContaining({ message: 'missing field' }),
      });
    });

    it('ignores restores in draw that would pop the chart state', () => {
      const { series, env, ctx } = drawSetup({ ...band, draw: (c) => c.restore() });
      expect(frame(ctx, series, env)).toEqual(['pane 0', 'pane 1', null]);
      expect(ctx.depth).toBe(0);
    });

    it('reports again only after the hook succeeded in between', () => {
      let fail = true;
      const { series, host, env, ctx } = drawSetup({
        ...band,
        draw: () => {
          if (fail) throw new Error('boom');
        },
      });
      frame(ctx, series, env);
      frame(ctx, series, env);
      fail = false;
      frame(ctx, series, env);
      fail = true;
      frame(ctx, series, env);
      expect(host.seriesError).toHaveBeenCalledTimes(2);
      expect(ctx.depth).toBe(0);
    });

    it('leaves the series out of autoscale without breaking other series', () => {
      const def = {
        ...band,
        priceRange: (p: BandPoint): [number, number] => {
          if (p.time === 120) throw new Error('bad item');
          return [p.lower, p.upper];
        },
      };
      const { series, pane, host } = setup(false, def);
      series.setData([point(1), point(2), point(3)]);
      const line = new LineSeries(host, pane, { title: '', lineWidth: 1, area: false, format: String, lastValueLabel: true });
      line.setData([
        { time: 60, value: 50 },
        { time: 180, value: 60 },
      ]);
      // The same merge the chart's autoscale does across a pane's series.
      const fit = () => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const s of [series, line]) {
          const r = s.priceRange(0, 9);
          if (!r) continue;
          lo = Math.min(lo, r[0]);
          hi = Math.max(hi, r[1]);
        }
        return [lo, hi];
      };
      expect(fit()).toEqual([50, 60]);
      expect(fit()).toEqual([50, 60]);
      expect(host.seriesError).toHaveBeenCalledTimes(1);
      expect(host.seriesError).toHaveBeenCalledWith(expect.objectContaining({ series, hook: 'priceRange' }));
      // Back in autoscale once the data is fixed.
      series.setData([point(1), point(3)]);
      expect(fit()).toEqual([50, 103]);
    });

    it('falls back for legend, last value, format and step', () => {
      const fail = (hook: string) => () => {
        throw new Error(hook);
      };
      const { series, host } = setup(false, { ...band, legend: fail('legend'), lastValue: fail('lastValue'), step: fail('step') });
      series.setData([point(1)]);
      expect(series.legend(1)).toEqual({ title: 'Band', parts: [] });
      expect(series.lastValue()).toBeNull();
      expect(series.step(16)).toBe(false);
      expect(host.seriesError.mock.calls.map(([e]) => e.hook)).toEqual(['legend', 'lastValue', 'step']);

      const other = setup(false, { ...band });
      other.series.setData([point(1)]);
      other.series.applyOptions({ format: fail('format') });
      expect(other.series.lastValue()).toBeNull();
      expect(other.host.seriesError).toHaveBeenCalledWith(expect.objectContaining({ hook: 'format' }));
    });

    it('logs to the console once when the host has no error hook', () => {
      const { series, host } = setup(false, {
        ...band,
        step: () => {
          throw new Error('step');
        },
      });
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (host as Partial<SeriesHost>).seriesError = undefined;
      series.step(16);
      series.step(16);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });

  describe('reportSeriesError', () => {
    const event = (): SeriesErrorEvent => ({ series: setup().series, hook: 'draw', error: new Error('draw') });

    it('hands the event to the listener', () => {
      const emit = vi.fn();
      const e = event();
      reportSeriesError(e, emit);
      expect(emit).toHaveBeenCalledWith(e);
    });

    it('logs when nobody listens', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      reportSeriesError(event(), null);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('contains a throwing listener', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const emit = () => {
        throw new Error('listener');
      };
      expect(() => reportSeriesError(event(), emit)).not.toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });
});
