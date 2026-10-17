import { CalendarBucketing, DEFAULT_CALENDAR_STEPS } from './calendar-buckets';
import type { Chart, GroupingState } from './chart';
import type { Interval } from './data/types';
import { GroupedLine, PowerBuckets, Pyramid, groupLevel, type Buckets } from './lod';
import type { SeriesLevels } from './series';

// How a chart's view groups bars into buckets under the `grouping` option, and the coarser
// levels its series draw them from. The `grouping()` plugin gives a chart this, so a chart
// without it draws single bars and leaves the bucketing and level code out.

/** @internal The buckets of one chart's view at a bar spacing in device px, and the levels its series group with. */
export class Grouping {
  /** Calendar buckets of the timeline per step, for `grouping: { mode: 'calendar' }`. */
  readonly #calendar = new CalendarBucketing();
  /** The power-of-two bucketing last handed out, reused while its level holds. */
  #power: PowerBuckets | null = null;
  readonly levels: SeriesLevels = { pyramid: (merges, source) => new Pyramid(merges, source), line: () => new GroupedLine() };

  constructor(readonly chart: Chart) {}

  /** Pixel grouping: bars per bucket as `2 ** level`; 0 without pixel grouping or while single bars are wide enough. */
  level(spacing: number): number {
    return this.chart.options.grouping?.mode === 'pixel' ? groupLevel(spacing) : 0;
  }

  /** The calendar step the view groups by, or null. */
  step(spacing: number): Interval | null {
    const grouping = this.chart.options.grouping;
    if (grouping?.mode !== 'calendar') return null;
    return this.#calendar.pick(this.chart.timeline, grouping.steps ?? DEFAULT_CALENDAR_STEPS, spacing);
  }

  /** How the view groups bars into buckets, or null when it draws single bars. */
  buckets(spacing: number): Buckets | null {
    const step = this.step(spacing);
    if (step) return this.#calendar.buckets(this.chart.timeline, step);
    const level = this.level(spacing);
    if (level === 0) return null;
    if (this.#power?.level !== level) this.#power = new PowerBuckets(level);
    return this.#power;
  }

  /** `chart.grouping`: how the view groups bars, or null when it draws single bars. */
  state(spacing: number): GroupingState | null {
    const step = this.step(spacing);
    if (step) {
      const g = this.#calendar.buckets(this.chart.timeline, step);
      return { level: 0, bars: Math.round(this.chart.timeline.length / Math.max(1, g.count)), step };
    }
    const level = this.level(spacing);
    return level > 0 ? { level, bars: 2 ** level } : null;
  }

  /** What `grouping:change` follows: a calendar key changes when its boundaries do, but its step is what listeners care about. */
  key(spacing: number): string | null {
    const g = this.buckets(spacing);
    return g ? (g.level > 0 ? g.key : (this.step(spacing) ?? '')) : null;
  }
}
