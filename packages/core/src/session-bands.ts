import type { Primitive, PrimitiveEnv, PrimitiveHost, PrimitiveLayer } from './primitives';
import type { Time } from './types';
import { Emitter } from './util/emitter';
import { marketPhase } from './util/market';
import { compileSession, sessionIntervals, type CompiledSession, type SessionSchedule } from './util/session';
import { zoneOf, type Zone } from './util/timezone';
import { isText } from './util/records';
import { clampLow } from './util/math';
import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/**
 * Session bands: when other regional markets are open, drawn along the time
 * axis. Each lane has its own timezone and hours, independent of the chart's
 * `timezone` and `session`. Like the watermark it is an ordinary primitive,
 * written only against the public primitives API.
 */

const DAY = 86400;
/** Visible spans longer than this many days draw nothing: the bands would be thinner than a pixel. */
const MAX_DAYS = 400;

/** One named market session, such as a region's trading hours. */
export interface SessionLane {
  /** Unique within the bands; used to update or remove the lane. */
  id: string;
  /** Shown in the UI's session chip. */
  name: string;
  /** IANA timezone the hours are in, e.g. `'Europe/London'`. */
  timezone: string;
  /** Opening hours as wall-clock times in `timezone`, so they follow its daylight saving changes. */
  hours: SessionSchedule;
  /** Band or column colour (any CSS colour). */
  color: string;
}

/** `'bands'`: thin strips along the bottom of the plot. `'columns'`: shaded full-height columns behind the series. */
export type SessionBandsMode = 'bands' | 'columns';

/** Options for session bands: thin strips or full-height columns, strip height and spacing, and opacity. */
export interface SessionBandsOptions {
  visible: boolean;
  mode: SessionBandsMode;
  /** Height of each lane's strip in `'bands'` mode, css px. */
  bandHeight: number;
  /** Space between strips in `'bands'` mode, css px. */
  bandGap: number;
  /** Multiplies the lane colour's alpha: strips in `'bands'` mode, columns in `'columns'` mode. */
  opacity: number;
  /** Column opacity in `'columns'` mode, multiplied with `opacity`; keeps columns faint behind the series. */
  columnOpacity: number;
}

/** Default values for `SessionBandsOptions`: 3 px strips with a 1 px gap in `'bands'` mode. */
export const defaultSessionBandsOptions: Readonly<SessionBandsOptions> = Object.freeze({
  visible: true,
  mode: 'bands',
  bandHeight: 3,
  bandGap: 1,
  opacity: 0.9,
  columnOpacity: 0.12,
});

/** Where a lane stands at a moment, for countdowns. */
export interface SessionLaneState {
  lane: SessionLane;
  open: boolean;
  /** When the lane next opens (while closed) or closes (while open); null when that is more than three weeks away or never. */
  next: Time | null;
  /** Seconds until `next`, or null with it. */
  remaining: number | null;
}

/** Events emitted by session bands, by name: currently a change of the lanes. */
export interface SessionBandsEvents {
  /** A lane was added, removed or changed, or the lanes were replaced. */
  'lanes:change': { lanes: readonly SessionLane[] };
}

/** A session bands primitive; attach it with `chart.attachPrimitive`. */
export interface SessionBands extends Primitive {
  readonly options: Readonly<SessionBandsOptions>;
  /** The lanes, top to bottom. */
  readonly lanes: readonly SessionLane[];
  /** Merge new options and redraw. */
  applyOptions(options: Partial<SessionBandsOptions>): void;
  /** Add a lane at the bottom. Throws on a duplicate id, an unknown timezone or malformed hours. */
  addLane(lane: SessionLane): void;
  /** Change a lane, e.g. its colour. Throws when the id is unknown or the result is invalid. */
  updateLane(id: string, patch: Partial<Omit<SessionLane, 'id'>>): void;
  /** Remove a lane; false when there was none with that id. */
  removeLane(id: string): boolean;
  /** Replace every lane. Validates all of them first, so an invalid list changes nothing. */
  setLanes(lanes: readonly SessionLane[]): void;
  /** Each lane's state at `now` (unix seconds, default the current time), in lane order. */
  states(now?: Time): SessionLaneState[];
  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof SessionBandsEvents>(event: K, listener: (payload: SessionBandsEvents[K]) => void): () => void;
}

const weekdays = (start: string, end: string): SessionSchedule => {
  const range = () => [{ start, end }];
  return { weekly: { mon: range(), tue: range(), wed: range(), thu: range(), fri: range() } };
};

/** Typical cash-market hours of three regions, weekdays only, without holidays. */
export const DEFAULT_SESSION_LANES: readonly SessionLane[] = Object.freeze([
  { id: 'asia', name: 'Asia', timezone: 'Asia/Tokyo', hours: weekdays('09:00', '15:00'), color: '#e8a33d' },
  { id: 'europe', name: 'Europe', timezone: 'Europe/London', hours: weekdays('08:00', '16:30'), color: '#4f8ef7' },
  { id: 'americas', name: 'Americas', timezone: 'America/New_York', hours: weekdays('09:30', '16:00'), color: '#a77bf3' },
]);

/** A lane with its timezone and compiled hours; `session` is null when always open. */
interface Prepared {
  lane: SessionLane;
  zone: Zone;
  session: CompiledSession | null;
}

/** Validate a lane; throws on an unknown timezone or malformed hours. */
function prepare(lane: SessionLane): Prepared {
  if (!isText(lane.id)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Session lane needs a non-empty id' : '');
  return { lane, zone: zoneOf(lane.timezone), session: compileSession(lane.hours) };
}

function intervalsOf(p: Prepared, from: Time, to: Time): [Time, Time][] {
  if (!(to > from)) return [];
  if (!p.session) return [[from, to]];
  // A day either side covers overnight ranges and the zone's offset.
  const first = Math.floor(p.zone.wall(from) / DAY) - 1;
  const last = Math.floor(p.zone.wall(to) / DAY) + 1;
  const out: [Time, Time][] = [];
  for (const [a, b] of sessionIntervals(p.session, first, last)) {
    const start = p.zone.fromWall(a);
    const end = p.zone.fromWall(b);
    if (end > from && start < to) out.push([Math.max(start, from), Math.min(end, to)]);
  }
  return out;
}

function stateOf(p: Prepared, now: Time): SessionLaneState {
  const status = marketPhase(p.session, null, p.zone, now);
  const next = status.next?.time ?? null;
  return { lane: p.lane, open: status.phase === 'open', next, remaining: next === null ? null : next - now };
}

/**
 * The times a lane is open within `[from, to)` (unix seconds), as sorted
 * `[start, end)` pairs clipped to that span. Throws for an invalid lane.
 */
export function sessionLaneIntervals(lane: SessionLane, from: Time, to: Time): [Time, Time][] {
  return intervalsOf(prepare(lane), from, to);
}

/** Whether a lane is open at `now`, and when that next changes. Throws for an invalid lane. */
export function sessionLaneState(lane: SessionLane, now: Time): SessionLaneState {
  return stateOf(prepare(lane), now);
}

/**
 * Create session bands that show when other markets are open, one lane per
 * market. Without `lanes` it starts with `DEFAULT_SESSION_LANES`. Attach it
 * with `chart.attachPrimitive`.
 */
export function createSessionBands(
  options: Partial<SessionBandsOptions> & { lanes?: readonly SessionLane[] } = {},
): SessionBands {
  const { lanes: initial = DEFAULT_SESSION_LANES, ...rest } = options;
  let opts: SessionBandsOptions = { ...defaultSessionBandsOptions, ...rest };
  let prepared: Prepared[] = initial.map((l) => prepare({ ...l }));
  assertUnique(prepared);
  let host: PrimitiveHost | null = null;
  // Interval lists of the last drawn span, so crosshair redraws reuse them.
  let cache: { from: Time; to: Time; lists: [Time, Time][][] } | null = null;
  const events = new Emitter<SessionBandsEvents>((error) => console.error(error));

  const changed = (): void => {
    cache = null;
    host?.requestRedraw();
    events.emit('lanes:change', { lanes: bands.lanes });
  };
  const indexOf = (id: string): number => prepared.findIndex((p) => p.lane.id === id);

  const bands: SessionBands = {
    get layer(): PrimitiveLayer {
      return opts.mode === 'columns' ? 'below' : 'normal';
    },
    get options() {
      return opts;
    },
    get lanes() {
      return prepared.map((p) => p.lane);
    },
    attached(h) {
      host = h;
    },
    detached() {
      host = null;
    },
    applyOptions(next) {
      opts = { ...opts, ...next };
      host?.requestRedraw();
    },
    addLane(lane) {
      if (indexOf(lane.id) >= 0) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Session lane "${lane.id}" already exists` : '');
      prepared = [...prepared, prepare({ ...lane })];
      changed();
    },
    updateLane(id, patch) {
      const i = indexOf(id);
      if (i < 0) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `No session lane "${id}"` : '');
      const next = [...prepared];
      next[i] = prepare({ ...prepared[i]!.lane, ...patch, id });
      prepared = next;
      changed();
    },
    removeLane(id) {
      const i = indexOf(id);
      if (i < 0) return false;
      prepared = prepared.filter((_, k) => k !== i);
      changed();
      return true;
    },
    setLanes(lanes) {
      const next = lanes.map((l) => prepare({ ...l }));
      assertUnique(next);
      prepared = next;
      changed();
    },
    states(now = Math.floor(Date.now() / 1000)) {
      return prepared.map((p) => stateOf(p, now));
    },
    on(event, listener) {
      return events.on(event, listener);
    },
    drawPlot(ctx, env) {
      if (!opts.visible || prepared.length === 0) return;
      const span = visibleSpan(env);
      if (!span) return;
      if (!cache || cache.from !== span.from || cache.to !== span.to) {
        cache = { ...span, lists: prepared.map((p) => intervalsOf(p, span.from, span.to)) };
      }
      drawLanes(ctx, env, opts, prepared, cache.lists);
    },
  };
  return bands;
}

function assertUnique(list: readonly Prepared[]): void {
  const ids = new Set<string>();
  for (const p of list) {
    if (ids.has(p.lane.id)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Session lane "${p.lane.id}" already exists` : '');
    ids.add(p.lane.id);
  }
}

/** Typical bar spacing in seconds near index `at`: the smallest gap of a few neighbours. */
function barStep(times: readonly Time[], at: number): number {
  const i = clampLow(at, 0, times.length - 2);
  let step = Infinity;
  for (let k = i; k < Math.min(times.length - 1, i + 6); k++) {
    const d = times[k + 1]! - times[k]!;
    if (d > 0 && d < step) step = d;
  }
  return step;
}

/**
 * Times at the plot edges, a bar beyond each; null on daily and longer bars,
 * whose bars cannot show hours, or when the span is too long to draw.
 */
function visibleSpan(env: PrimitiveEnv): { from: Time; to: Time } | null {
  const { times } = env;
  if (times.length < 2) return null;
  const step = barStep(times, Math.floor(env.from));
  if (!(step < DAY)) return null;
  const last = times.length - 1;
  const at = (index: number): Time => {
    if (index < 0) return times[0]! + index * step;
    if (index > last) return times[last]! + (index - last) * step;
    return times[index]!;
  };
  const from = at(Math.floor(env.from) - 1);
  const to = at(Math.ceil(env.to) + 1);
  return to > from && to - from <= MAX_DAYS * DAY ? { from, to } : null;
}

function drawLanes(
  ctx: CanvasRenderingContext2D,
  env: PrimitiveEnv,
  opts: SessionBandsOptions,
  lanes: readonly Prepared[],
  lists: readonly [Time, Time][][],
): void {
  const pr = env.pixelRatio;
  const snap = (v: number) => Math.round(v * pr) / pr;
  const columns = opts.mode === 'columns';
  const h = Math.max(1, opts.bandHeight);
  const gap = Math.max(0, opts.bandGap);
  ctx.globalAlpha = clamp01(opts.opacity) * (columns ? clamp01(opts.columnOpacity) : 1);
  lanes.forEach((p, i) => {
    ctx.fillStyle = p.lane.color;
    // First lane on top: the stack ends at the bottom edge of the plot.
    const y = columns ? 0 : snap(env.height - (lanes.length - i) * (h + gap) + gap);
    const height = columns ? env.height : snap(h);
    for (const [start, end] of lists[i] ?? []) {
      const x0 = snap(env.timeToX(start));
      const x1 = snap(env.timeToX(end));
      if (x1 <= 0 || x0 >= env.width) continue;
      ctx.fillRect(x0, y, Math.max(1 / pr, x1 - x0), height);
    }
  });
  ctx.globalAlpha = 1;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? clampLow(v, 0, 1) : 1;
}
