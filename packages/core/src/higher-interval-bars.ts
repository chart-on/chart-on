import type { Chart } from './chart';
import { intervalSeconds, isCalendarInterval, isTimeInterval, nextIntervalStart, safeIntervalSeconds, symbolZone } from './data/interval';
import type { Interval } from './data/types';
import type { Indicator } from './indicators/indicator';
import type { BarArrays, IndicatorDef, IndicatorOutputs, IntervalBars } from './indicators/types';
import type { ChartPlugin } from './plugins';
import type { Primitive, PrimitiveEnv } from './primitives';
import type { Series } from './series';
import type { Zone } from './util/timezone';
import { CORE_VERSION } from './version';

/** Inputs of the `higher-interval-bars` indicator. */
export type HigherIntervalBarsInputs = {
  /** Interval of the boxes, or `'auto'` for the next step up from the chart's. */
  interval: Interval | 'auto';
  style: 'filled' | 'outline';
  /** How many of the newest higher bars to draw, the forming one included; 0 draws all. */
  count: number;
  /** Colours of rising and falling higher bars; empty uses the theme's. */
  upColor: string;
  downColor: string;
};

/** Steps `'auto'` picks from: the first longer than the chart's interval. */
const STEPS: readonly Interval[] = ['5m', '15m', '1h', '4h', '1d', '1w', '1M'];
const ID = 'higher-interval-bars';
const OUTPUTS = ['open', 'high', 'low', 'close'] as const;
const NONE = { length: 0 } as BarArrays;
const DAY = 86400;

/** The interval `'auto'` stands for on a chart of `chartInterval`: the next step up, or null past the last. */
export function nextIntervalUp(chartInterval: Interval | null | undefined): Interval | null {
  const seconds = chartInterval ? safeIntervalSeconds(chartInterval) : null;
  if (seconds === null) return null;
  return STEPS.find((step) => intervalSeconds(step) > seconds) ?? null;
}

/**
 * End of the higher bar starting at `time`: a calendar bar moves on by its
 * months, a bar of a day or longer by wall-clock days in `zone` (so a DST day
 * is 23 or 25 hours), a shorter one by its length.
 */
export function higherBarEnd(time: number, interval: Interval, zone: Zone): number {
  if (isCalendarInterval(interval)) return nextIntervalStart(time, interval, zone);
  const length = intervalSeconds(interval);
  return length >= DAY ? zone.fromWall(zone.wall(time) + length) : time + length;
}

function write(out: IndicatorOutputs, k: number, higher: BarArrays, j: number): void {
  out.slot![k] = j;
  for (const key of OUTPUTS) out[key]![k] = higher[key][j]!;
}

/**
 * Per chart bar, the open, high, low and close of the higher bar it falls in,
 * and `slot`, that higher bar's index. A higher bar holds the chart bars from
 * its time up to the next one's time or its own end (`end`), whichever comes
 * first, so a missing higher bar leaves a gap. NaN outside every higher bar
 * and on those of higher bars older than the newest `count` (0 keeps all).
 */
export function higherBarSteps(times: ArrayLike<number>, higher: BarArrays, count: number, end: (time: number) => number): IndicatorOutputs {
  const n = times.length;
  const out: IndicatorOutputs = { slot: new Float64Array(n).fill(NaN) };
  for (const key of OUTPUTS) out[key] = new Float64Array(n).fill(NaN);
  const first = count > 0 ? higher.length - count : 0;
  let j = -1;
  let until = -Infinity;
  for (let k = 0; k < n; k++) {
    const t = times[k]!;
    while (j + 1 < higher.length && higher.time[j + 1]! <= t) until = end(higher.time[++j]!);
    if (j >= first && j >= 0 && t < until) write(out, k, higher, j);
  }
  return out;
}

function definition(chart: Chart): IndicatorDef<HigherIntervalBarsInputs> {
  const resolve = (interval: string, chartInterval = chart.data?.interval): Interval | null =>
    interval === 'auto' ? nextIntervalUp(chartInterval) : isTimeInterval(interval) ? interval : null;
  const zone = () => symbolZone(chart.data?.symbol?.timezone);
  const pick = ({ interval }: HigherIntervalBarsInputs, bars: IntervalBars) => {
    const resolved = resolve(interval);
    return { higher: (resolved && bars[resolved]) || NONE, end: (t: number) => higherBarEnd(t, resolved!, zone()) };
  };
  return {
    id: ID,
    name: 'Higher-interval bars',
    description: 'Boxes of a longer interval’s bars behind the chart’s bars.',
    category: 'trend',
    title: ({ interval }) => `Higher-interval bars ${interval}`,
    placement: 'overlay',
    inputs: [
      { id: 'interval', type: 'select', label: 'Interval', default: 'auto', options: ['auto', ...STEPS].map((value) => ({ value })) },
      { id: 'style', type: 'select', label: 'Style', default: 'filled', options: [{ value: 'filled' }, { value: 'outline' }] },
      { id: 'count', type: 'number', label: 'Bars (0 = all)', default: 0, min: 0, step: 1 },
      { id: 'upColor', type: 'color', label: 'Up', default: '', role: 'up' },
      { id: 'downColor', type: 'color', label: 'Down', default: '', role: 'down' },
    ],
    plots: [],
    intervals: ({ interval }) => {
      const resolved = resolve(interval);
      return resolved ? [{ interval: resolved }] : [];
    },
    supports: ({ interval, inputs }) =>
      resolve(inputs.interval, interval) !== null || `No longer interval above ${interval}`,
    compute: (src, inputs, _data, bars) => {
      const { higher, end } = pick(inputs, bars);
      return higherBarSteps(src.time, higher, inputs.count, end);
    },
    // A tick or a new chart bar in the same higher bar writes one bar; anything else starts over.
    update: (src, inputs, index, out, _data, bars) => {
      const { higher, end } = pick(inputs, bars);
      const j = higher.length - 1;
      if (index > 0 && j >= 0 && out.slot![index - 1] === j && src.time[index]! < end(higher.time[j]!)) {
        write(out, index, higher, j);
        return;
      }
      const all = higherBarSteps(src.time, higher, inputs.count, end);
      for (const key in all) out[key]!.set(all[key]!);
    },
  };
}

const shows = (ind: Indicator) => ind.visible && !ind.hiddenByInterval && ind.values.slot !== undefined;

/** Calls `fn` with the first and last chart bar of each box that overlaps bars [from, to]. */
function eachBox(slot: Float64Array, from: number, to: number, fn: (first: number, last: number) => void): void {
  const last = Math.min(slot.length - 1, Math.ceil(to));
  let k = Math.max(0, Math.floor(from));
  // Start at the first chart bar of the box the range starts in.
  while (k > 0 && k <= last && slot[k - 1] === slot[k]) k--;
  while (k <= last) {
    let end = k;
    while (end + 1 < slot.length && slot[end + 1] === slot[k]) end++;
    if (!Number.isNaN(slot[k]!)) fn(k, end);
    k = end + 1;
  }
}

/**
 * Draws one indicator's boxes, attached to its series so they follow its
 * pane and price scale. A box reads its values at its last chart bar, the
 * one `update` keeps current.
 */
function boxes(ind: Indicator): Primitive {
  return {
    layer: 'below',
    priceRange(from, to) {
      if (!shows(ind)) return null;
      const { slot, low, high } = ind.values;
      let lo = Infinity;
      let hi = -Infinity;
      eachBox(slot!, from, to, (_, e) => {
        lo = Math.min(lo, low![e]!);
        hi = Math.max(hi, high![e]!);
      });
      return lo <= hi ? [lo, hi] : null;
    },
    drawPlot(ctx, env) {
      if (shows(ind)) draw(ctx, env, ind.values, ind.inputs as HigherIntervalBarsInputs);
    },
  };
}

function draw(ctx: CanvasRenderingContext2D, env: PrimitiveEnv, v: Readonly<Record<string, Float64Array>>, inputs: HigherIntervalBarsInputs): void {
  const half = env.barSpacing / 2;
  const outline = inputs.style === 'outline';
  ctx.lineWidth = 1;
  eachBox(v.slot!, env.from, env.to, (first, last) => {
    const open = v.open![last]!;
    const close = v.close![last]!;
    ctx.fillStyle = ctx.strokeStyle = close >= open ? inputs.upColor || env.theme.up : inputs.downColor || env.theme.down;
    const x = env.indexToX(first) - half;
    const w = env.indexToX(last) + half - x;
    const box = (a: number, b: number, alpha: number, dash: number[]) => {
      const ya = env.priceToY(a);
      const yb = env.priceToY(b);
      const y = Math.min(ya, yb);
      const h = Math.max(1, Math.abs(ya - yb));
      ctx.globalAlpha = outline ? 1 : alpha;
      if (outline) {
        ctx.setLineDash(dash);
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      } else ctx.fillRect(x, y, w, h);
    };
    box(v.high![last]!, v.low![last]!, 0.1, [4, 3]);
    box(open, close, 0.25, []);
  });
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

/**
 * Plugin that adds the `higher-interval-bars` overlay indicator: each bar of a
 * longer interval (e.g. hourly on a 5-minute chart) as a range box (high to
 * low) and a body box (open to close) spanning the chart bars it holds. The
 * bars load through the chart's data source like any indicator `intervals`,
 * and the forming one is built from the chart's bars, so it follows every
 * tick. Draws nothing while the chart interval is equal to or longer.
 * Uninstalling removes the chart's indicators of this type. Needs indicators:
 * list it after `indicators()` (or `builtins()`), or install it once they are
 * there; without them it throws `not-registered`.
 */
export function higherIntervalBars(): ChartPlugin {
  return {
    name: '@chart-on/core/higher-interval-bars',
    version: CORE_VERSION,
    install: (ctx) => {
      const chart = ctx.chart;
      ctx.registerIndicator(definition(chart));
      // One primitive per indicator, attached to its series (and gone with it).
      const attached = new Map<Indicator, Series>();
      const sync = () => {
        for (const ind of chart.indicators.getAll()) {
          const series = ind.series as Series | null;
          if (ind.type !== ID || !series || attached.get(ind) === series) continue;
          attached.set(ind, series);
          ctx.attachPrimitive(boxes(ind), { series });
        }
      };
      for (const event of ['indicator:add', 'indicator:change'] as const) ctx.onDispose(chart.on(event, sync));
      ctx.onDispose(chart.on('indicator:remove', ({ indicator }) => attached.delete(indicator)));
      sync();
      // Runs first on uninstall, while the definition is still registered.
      ctx.onDispose(() => {
        for (const ind of chart.indicatorLayer?.getAll() ?? []) if (ind.type === ID) ind.remove();
      });
    },
  };
}
