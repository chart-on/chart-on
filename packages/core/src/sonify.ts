/**
 * Sonification: the visible series played as sound, so people who cannot see
 * the chart can hear its shape, trend and outliers. Optional: the chart never
 * imports this module, so apps that do not use it pay nothing for it.
 *
 * Nothing here touches the browser at import time. The audio context is made
 * on the first `play` or `step`, which an app calls from a user gesture (a
 * click or a key), as browsers require before they make sound.
 */
import { hiddenText } from './a11y';
import { inField } from './interaction';
import type { Chart } from './chart';
import type { CandleSeries, HistogramSeries, LineSeries } from './series';
import type { Bar, Time, ValuePoint } from './types';
import type { CoreMessageKey } from './util/locale';
import { compileSession, tradingDay } from './util/session';
import { clampNum } from './util/math';
import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** The series kinds a sonifier can play. */
export type SonifiedSeries = CandleSeries | LineSeries | HistogramSeries;

/** What each bar sounds like. */
export type SonifyMode = 'close' | 'range';

/** Where a sonifier is: silent, playing the visible range, or paused part way. */
export type SonifierState = 'idle' | 'playing' | 'paused';

/** Short sounds for events in the played range. */
export interface SonifyCues {
  /** Bar markers on the series (see `annotations.setMarkers`). Default true. */
  markers: boolean;
  /** Alert lines the close crosses from the bar before. Default true. */
  alerts: boolean;
  /** The first bar of a new trading day, on intraday bars. Default true. */
  sessions: boolean;
}

/**
 * Options for a sonifier: the series to play, how long and over which pitch
 * range, the sound of each bar, volume, cues, and crosshair and keyboard
 * behaviour.
 */
export interface SonifierOptions {
  /** The series to play. Default: the chart's main series. */
  series?: SonifiedSeries;
  /** Time to play the whole visible range, ms. Each bar gets an equal share, 10 to 500 ms. Default 4000. */
  durationMs: number;
  /** Frequencies (Hz) for the lowest and the highest value in view. Default 220 to 880 (two octaves). */
  pitchRange: { low: number; high: number };
  /**
   * `close`: one steady tone at the close. `range`: a glide across the bar's
   * low and high, rising on up bars and falling on down bars. Default `close`.
   */
  mode: SonifyMode;
  /** Loudness, 0 to 1. Default 0.2. */
  volume: number;
  /** Which events get a cue. */
  cues: SonifyCues;
  /** Move the crosshair along with the sound. Default true. */
  followCrosshair: boolean;
  /**
   * With the plot focused: P plays or pauses, Escape stops, and the
   * crosshair step keys (Ctrl+Left and Ctrl+Right) sound the bar they reach.
   * Default true.
   */
  keyboard: boolean;
  /** Read the stepped bar's values in a polite live region. Skipped while the chart's `crosshairReadout` already reads them. Default true. */
  announce: boolean;
  /** Makes the audio context, on first use. Default: the browser's `AudioContext`. Tests pass a fake. */
  createAudioContext?: () => SonifyAudioContext;
}

/** Sonifier option changes for `createSonifier` and `applyOptions`: every field is optional, including those of `cues` and `pitchRange`. */
export type SonifierOptionsPatch = Partial<Omit<SonifierOptions, 'cues' | 'pitchRange'>> & {
  cues?: Partial<SonifyCues>;
  pitchRange?: Partial<SonifierOptions['pitchRange']>;
};

/** Default values for `SonifierOptions`: four seconds over two octaves from 220 Hz, one tone per close, at low volume. */
export const defaultSonifierOptions: Readonly<Omit<SonifierOptions, 'series' | 'createAudioContext'>> = {
  durationMs: 4000,
  pitchRange: { low: 220, high: 880 },
  mode: 'close',
  volume: 0.2,
  cues: { markers: true, alerts: true, sessions: true },
  followCrosshair: true,
  keyboard: true,
  announce: true,
};

/** The parts of a Web Audio parameter a sonifier uses. */
export interface SonifyAudioParam {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}

/** The parts of a Web Audio node a sonifier uses. */
export interface SonifyAudioNode {
  connect(target: SonifyAudioNode): unknown;
  disconnect(): void;
}

/** The parts of a Web Audio oscillator a sonifier uses. */
export interface SonifyOscillator extends SonifyAudioNode {
  type: string;
  frequency: SonifyAudioParam;
  start(when?: number): void;
  stop(when?: number): void;
  onended: (() => void) | null;
}

/** The parts of a Web Audio context a sonifier uses, so tests can pass a fake. */
export interface SonifyAudioContext {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: SonifyAudioNode;
  createOscillator(): SonifyOscillator;
  createGain(): SonifyAudioNode & { gain: SonifyAudioParam };
  createStereoPanner?(): SonifyAudioNode & { pan: SonifyAudioParam };
  resume(): Promise<void>;
  close(): Promise<void>;
}

/** Shortest and longest time one bar gets during playback, ms. */
const MIN_STEP_MS = 10;
const MAX_STEP_MS = 500;
/** How long a single stepped bar sounds, ms. */
const STEP_NOTE_MS = 180;
/** Attack and release of each note, seconds: short enough to keep notes apart, long enough not to click. */
const EDGE_S = 0.004;
/** How often the crosshair follows the sound, ms. */
const FOLLOW_MS = 50;
const DAY = 86400;

/**
 * The frequency (Hz) for `value` when values from `min` to `max` span the
 * pitch range `low` to `high`. Equal value steps give equal musical
 * intervals (the frequency grows geometrically); with `log`, equal ratios of
 * value do instead, like a log price scale. Values outside are clamped.
 */
export function valueToPitch(
  value: number,
  range: { min: number; max: number; low: number; high: number; log?: boolean },
): number {
  const { low, high } = range;
  const log = !!range.log && range.min > 0 && value > 0;
  const at = (v: number) => (log ? Math.log10(v) : v);
  const span = at(range.max) - at(range.min);
  const t = span > 0 && Number.isFinite(span) ? clampNum((at(value) - at(range.min)) / span, 0, 1) : 0.5;
  return low * Math.pow(high / low, t);
}

/** A sonifier attached to one chart (see `createSonifier`). */
export interface Sonifier {
  readonly state: SonifierState;
  /** Index into the series' data of the bar played last, or null before the first. */
  readonly position: number | null;
  readonly options: Readonly<SonifierOptions>;
  /**
   * Play the visible range, oldest bar first, or go on from where `pause`
   * stopped. Call it from a user gesture. False when there is nothing to
   * play or no audio.
   */
  play(): boolean;
  /** Stop the sound and keep the position, so `play` goes on from there. */
  pause(): void;
  /** Stop the sound and forget the position. */
  stop(): void;
  /** Pause while playing, else play. Returns whether it plays now. */
  toggle(): boolean;
  /**
   * Sound the next (1) or previous (-1) bar on its own, move the crosshair
   * to it and announce its values. The first step starts on the newest bar
   * in view. Call it from a user gesture. False when there is nothing to play
   * or no audio.
   */
  step(direction: -1 | 1): boolean;
  applyOptions(patch: SonifierOptionsPatch): void;
  /** Subscribe to state changes; returns an unsubscribe function. */
  on(event: 'state:change', listener: (event: { state: SonifierState }) => void): () => void;
  /** Stop, close the audio context and detach from the chart. The chart's own `destroy` does this too. */
  destroy(): void;
}

/** Open, high, low and close of a data point; a value point has the value in all four. */
interface Ohlc {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

type Cue = 'marker' | 'alert' | 'session';

/** Sound of each cue: waveform, frequency (Hz), length (s), loudness relative to the notes. */
const CUE_SOUND: Record<Cue, { type: string; freq: number; length: number; gain: number }> = {
  marker: { type: 'sine', freq: 1760, length: 0.04, gain: 0.8 },
  alert: { type: 'square', freq: 1320, length: 0.06, gain: 0.35 },
  session: { type: 'triangle', freq: 110, length: 0.09, gain: 1 },
};

const CUE_WORDS: Record<Cue, CoreMessageKey> = { marker: 'sonifyCueMarker', alert: 'sonifyCueAlert', session: 'sonifyCueSession' };

function ohlc(point: Bar | ValuePoint): Ohlc {
  if ('close' in point) return point;
  const v = point.value;
  return { time: point.time, open: v, high: v, low: v, close: v };
}

/** Index of the last point at or before `time`, or -1. */
function lastAtOrBefore(data: readonly { time: Time }[], time: Time): number {
  let lo = 0;
  let hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid]!.time <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Index of the first point at or after `time`; `data.length` when none. */
function firstAtOrAfter(data: readonly { time: Time }[], time: Time): number {
  const i = lastAtOrBefore(data, time);
  return i >= 0 && data[i]!.time === time ? i : i + 1;
}

/** Keys that never interrupt playback: modifiers pressed on their own, e.g. by a screen reader. */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

/** The key is bound to a crosshair step on the chart, wherever the app rebound those. */
function isCrosshairStep(chart: Chart, e: KeyboardEvent): boolean {
  return chart.actions.match(e).some((id) => id === 'crosshair-prev' || id === 'crosshair-next');
}

function browserAudioContext(): (() => SonifyAudioContext) | null {
  const g = globalThis as { AudioContext?: new () => SonifyAudioContext; webkitAudioContext?: new () => SonifyAudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? () => new Ctor() : null;
}

function resolveOptions(base: SonifierOptions, patch: SonifierOptionsPatch): SonifierOptions {
  const next: SonifierOptions = {
    ...base,
    ...patch,
    cues: { ...base.cues, ...patch.cues },
    pitchRange: { ...base.pitchRange, ...patch.pitchRange },
  };
  const { low, high } = next.pitchRange;
  if (!(Number.isFinite(next.durationMs) && next.durationMs > 0)) throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Sonifier durationMs must be a positive number' : '');
  if (!(Number.isFinite(low) && Number.isFinite(high) && low > 0 && high > 0)) {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Sonifier pitchRange needs positive frequencies' : '');
  }
  if (next.mode !== 'close' && next.mode !== 'range') throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown sonifier mode: ${String(next.mode)}` : '');
  next.volume = Number.isFinite(next.volume) ? clampNum(next.volume, 0, 1) : defaultSonifierOptions.volume;
  return next;
}

let nextId = 0;

/** A playback in progress: bars `start` to `end`, bar `start` sounding at audio time `t0`, one bar per `stepS` seconds. */
interface Run {
  start: number;
  end: number;
  t0: number;
  stepS: number;
}

class ChartSonifier implements Sonifier {
  #opts: SonifierOptions;
  private ctx: SonifyAudioContext | null = null;
  /** Output of the current playback or step; disconnecting it silences everything at once. */
  #master: (SonifyAudioNode & { gain: SonifyAudioParam }) | null = null;
  readonly #voices = new Set<SonifyOscillator>();
  #current: SonifierState = 'idle';
  #pos: number | null = null;
  private run: Run | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly #listeners = new Set<(event: { state: SonifierState }) => void>();
  private live: HTMLElement | null = null;
  #destroyed = false;
  readonly #doc: Document | null;
  readonly #detach: () => void;

  constructor(
    private readonly chart: Chart,
    options: SonifierOptionsPatch,
  ) {
    this.#opts = resolveOptions({ ...defaultSonifierOptions }, options);
    const root = chart.root;
    root.addEventListener('keydown', this.#onKey);
    root.addEventListener('pointerdown', this.#onInput);
    root.addEventListener('wheel', this.#onInput, { passive: true });
    // Crosshair steps reach the document whatever the chart's `keyboard.scope`.
    this.#doc = (root.ownerDocument as Document | null | undefined) ?? null;
    this.#doc?.addEventListener('keydown', this.#onDocumentKey);
    // Destroying the chart destroys its plugins, and with them this sonifier.
    this.#detach = chart.install({ name: `sonifier-${++nextId}`, version: '0.0.0', install: () => () => this.destroy() });
  }

  get state(): SonifierState {
    return this.#current;
  }

  get position(): number | null {
    return this.#pos;
  }

  get options(): Readonly<SonifierOptions> {
    return this.#opts;
  }

  on(event: 'state:change', listener: (event: { state: SonifierState }) => void): () => void {
    if (event !== 'state:change') return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  applyOptions(patch: SonifierOptionsPatch): void {
    this.#opts = resolveOptions(this.#opts, patch);
    if (this.#master) this.#master.gain.value = this.#opts.volume;
  }

  play(): boolean {
    if (this.#destroyed) return false;
    if (this.#current === 'playing') return true;
    const series = this.series();
    const span = series && this.visible(series);
    if (!series || !span) return false;
    const ctx = this.#audio();
    if (!ctx) return false;
    const [a, b] = span;
    const resume = this.#current === 'paused' && this.#pos !== null && this.#pos >= a && this.#pos < b;
    const start = resume ? this.#pos! : a;
    const stepS = clampNum(this.#opts.durationMs / (b - a + 1), MIN_STEP_MS, MAX_STEP_MS) / 1000;
    this.#silence();
    const master = this.#newMaster(ctx);
    const pitch = this.#pitchFor(series, a, b);
    const cues = this.#cueFinder(series);
    // A little lead, so the first note is not cut by scheduling latency.
    const t0 = ctx.currentTime + 0.03;
    for (let i = start; i <= b; i++) {
      const at = t0 + (i - start) * stepS;
      this.#note(ctx, master, series, i, at, stepS * 0.85, pitch);
      for (const cue of cues(i)) this.#cue(ctx, master, cue, at);
    }
    this.run = { start, end: b, t0, stepS };
    this.#pos = start;
    this.#follow(series, start);
    this.#setState('playing');
    this.timer = setTimeout(this.#tick, FOLLOW_MS);
    return true;
  }

  pause(): void {
    if (this.#current !== 'playing') return;
    const run = this.run;
    if (run && this.ctx) this.#pos = clampNum(this.#runIndex(run, this.ctx), run.start, run.end);
    this.#silence();
    this.#setState('paused');
  }

  stop(): void {
    this.#silence();
    this.#pos = null;
    this.#setState('idle');
  }

  toggle(): boolean {
    if (this.#current === 'playing') {
      this.pause();
      return false;
    }
    return this.play();
  }

  step(direction: -1 | 1): boolean {
    if (this.#destroyed) return false;
    const series = this.series();
    if (!series || series.data.length === 0) return false;
    const last = series.data.length - 1;
    const span = this.visible(series);
    const index = this.#pos === null ? (span ? span[1] : last) : clampNum(this.#pos + direction, 0, last);
    if (this.#current === 'playing') this.pause();
    return this.#sound(series, index, true);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.stop();
    this.#destroyed = true;
    const root = this.chart.root;
    root.removeEventListener('keydown', this.#onKey);
    root.removeEventListener('pointerdown', this.#onInput);
    root.removeEventListener('wheel', this.#onInput);
    this.#doc?.removeEventListener('keydown', this.#onDocumentKey);
    this.live?.remove();
    this.live = null;
    this.#listeners.clear();
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) void ctx.close().catch(() => {});
    try {
      this.#detach();
    } catch {
      // The chart is being destroyed and already removed it.
    }
  }

  /** The series to play: the chosen one while it is on the chart, else the main series. */
  private series(): SonifiedSeries | null {
    const chosen = this.#opts.series;
    if (chosen) return this.chart.panes.some((p) => p.series.includes(chosen)) ? chosen : null;
    return this.chart.main;
  }

  /** Data indices of the first and last point in view, or null. */
  private visible(series: SonifiedSeries): [number, number] | null {
    const range = this.chart.getVisibleRange();
    if (!range) return null;
    const data = series.data as readonly { time: Time }[];
    const a = firstAtOrAfter(data, range.from);
    const b = lastAtOrBefore(data, range.to);
    return b >= a ? [a, b] : null;
  }

  /** The audio context, made on first use; null where there is no Web Audio. */
  #audio(): SonifyAudioContext | null {
    if (!this.ctx) {
      const make = this.#opts.createAudioContext ?? browserAudioContext();
      if (!make) return null;
      this.ctx = make();
    }
    // Browsers start a context suspended until a user gesture; this call comes from one.
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  #newMaster(ctx: SonifyAudioContext): SonifyAudioNode & { gain: SonifyAudioParam } {
    const master = ctx.createGain();
    master.gain.value = this.#opts.volume;
    master.connect(ctx.destination);
    this.#master = master;
    return master;
  }

  /** Cut every sound now and end the playback. */
  #silence(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.run = null;
    for (const osc of this.#voices) {
      osc.onended = null;
      try {
        osc.stop();
      } catch {
        // Already stopped.
      }
      osc.disconnect();
    }
    this.#voices.clear();
    this.#master?.disconnect();
    this.#master = null;
  }

  #runIndex(run: Run, ctx: SonifyAudioContext): number {
    return run.start + Math.floor((ctx.currentTime - run.t0) / run.stepS);
  }

  /** Follow the sound with the position and the crosshair, and notice the end. */
  #tick = () => {
    this.timer = null;
    const run = this.run;
    const ctx = this.ctx;
    const series = this.series();
    if (!run || !ctx || !series) return;
    const index = this.#runIndex(run, ctx);
    if (index > run.end) {
      this.#pos = run.end;
      this.#follow(series, run.end);
      this.run = null;
      // The master stays connected until the next `silence`, so a cue still ringing on the last bar is not cut.
      this.#setState('idle');
      return;
    }
    if (index >= run.start && index !== this.#pos) {
      this.#pos = index;
      this.#follow(series, index);
    }
    this.timer = setTimeout(this.#tick, FOLLOW_MS);
  };

  #follow(series: SonifiedSeries, index: number): void {
    const point = series.data[index];
    if (!this.#opts.followCrosshair || !point) return;
    const pane = this.chart.panes.indexOf(series.pane);
    this.chart.setCrosshairAt(point.time, ohlc(point).close, Math.max(0, pane));
  }

  /** Value-to-pitch for bars `a` to `b`: their lowest low gets the low pitch, the highest high the high one. */
  #pitchFor(series: SonifiedSeries, a: number, b: number): (value: number) => number {
    let min = Infinity;
    let max = -Infinity;
    for (let i = a; i <= b; i++) {
      const p = ohlc(series.data[i]!);
      if (Number.isFinite(p.low)) min = Math.min(min, p.low);
      if (Number.isFinite(p.high)) max = Math.max(max, p.high);
    }
    const range = { min, max, ...this.#opts.pitchRange, log: series.scale.mode === 'log' };
    return (value) => valueToPitch(value, range);
  }

  /** Whether bar `i` closed up: above its open, or for a single value above the one before. */
  #up(series: SonifiedSeries, i: number): boolean {
    const p = ohlc(series.data[i]!);
    if ('close' in series.data[i]!) return p.close >= p.open;
    const before = series.data[i - 1];
    return !before || p.close >= ohlc(before).close;
  }

  #note(
    ctx: SonifyAudioContext,
    master: SonifyAudioNode,
    series: SonifiedSeries,
    i: number,
    at: number,
    length: number,
    pitch: (value: number) => number,
  ): void {
    const p = ohlc(series.data[i]!);
    const up = this.#up(series, i);
    // Up and down bars differ in timbre and side, so the direction is heard without the pitch.
    const type = up ? 'sine' : 'triangle';
    const pan = up ? 0.3 : -0.3;
    if (this.#opts.mode === 'range') {
      const [from, to] = up ? [p.low, p.high] : [p.high, p.low];
      this.#voice(ctx, master, type, pitch(from), at, length, 1, pan, pitch(to));
    } else {
      this.#voice(ctx, master, type, pitch(p.close), at, length, 1, pan);
    }
  }

  #cue(ctx: SonifyAudioContext, master: SonifyAudioNode, cue: Cue, at: number): void {
    const s = CUE_SOUND[cue];
    this.#voice(ctx, master, s.type, s.freq, at, s.length, s.gain, 0);
  }

  /** One oscillator through its own envelope (and pan where supported) into `master`. */
  #voice(
    ctx: SonifyAudioContext,
    master: SonifyAudioNode,
    type: string,
    freq: number,
    at: number,
    length: number,
    level: number,
    pan: number,
    glideTo?: number,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (glideTo !== undefined && glideTo !== freq) osc.frequency.exponentialRampToValueAtTime(glideTo, at + length);
    const env = ctx.createGain();
    const edge = Math.min(EDGE_S, length / 4);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + edge);
    env.gain.setValueAtTime(level, at + length - edge);
    env.gain.linearRampToValueAtTime(0, at + length);
    osc.connect(env);
    const panner = ctx.createStereoPanner?.();
    if (panner) {
      panner.pan.value = pan;
      env.connect(panner);
      panner.connect(master);
    } else {
      env.connect(master);
    }
    osc.onended = () => {
      this.#voices.delete(osc);
      osc.disconnect();
      env.disconnect();
      panner?.disconnect();
    };
    this.#voices.add(osc);
    osc.start(at);
    osc.stop(at + length);
  }

  /** The cues of each bar, as enabled in `cues`. */
  #cueFinder(series: SonifiedSeries): (i: number) => Cue[] {
    const { markers, alerts, sessions } = this.#opts.cues;
    const chart = this.chart;
    const data = series.data as readonly (Bar | ValuePoint)[];
    const marked = new Set<number>();
    if (markers) {
      // A marker between two bars belongs to the bar that contains it.
      for (const m of chart.annotationLayer?.getMarkers(series) ?? []) marked.add(lastAtOrBefore(data, m.time));
    }
    const session = sessions ? compileSession(chart.options.session) : null;
    const zone = chart.zone;
    return (i) => {
      const out: Cue[] = [];
      if (marked.has(i)) out.push('marker');
      const before = data[i - 1];
      if (!before) return out;
      const now = ohlc(data[i]!);
      const prev = ohlc(before);
      if (alerts && (chart.annotationLayer?.alertsCrossed(prev.close, now.close, series).length ?? 0) > 0) out.push('alert');
      // Only on intraday bars: on daily bars every bar starts a day.
      if (sessions && now.time - prev.time < DAY) {
        if (tradingDay(session, zone.wall(now.time)) !== tradingDay(session, zone.wall(prev.time))) out.push('session');
      }
      return out;
    };
  }

  /** Sound bar `index` on its own, move the crosshair there and announce it. */
  #sound(series: SonifiedSeries, index: number, moveCrosshair: boolean): boolean {
    const ctx = this.#audio();
    if (!ctx || !series.data[index]) return false;
    this.#silence();
    const master = this.#newMaster(ctx);
    const span = this.visible(series);
    // Pitch against the bars in view, as during playback, stretched to take in a bar outside it.
    const a = span ? Math.min(span[0], index) : index;
    const b = span ? Math.max(span[1], index) : index;
    const at = ctx.currentTime + 0.01;
    const cues = this.#cueFinder(series)(index);
    this.#note(ctx, master, series, index, at, STEP_NOTE_MS / 1000, this.#pitchFor(series, a, b));
    for (const cue of cues) this.#cue(ctx, master, cue, at);
    this.#pos = index;
    if (moveCrosshair) this.#follow(series, index);
    this.#announce(series, index, cues);
    return true;
  }

  #announce(series: SonifiedSeries, index: number, cues: readonly Cue[]): void {
    if (!this.#opts.announce || this.chart.options.accessibility.crosshairReadout) return;
    if (typeof document === 'undefined') return;
    if (!this.live) {
      // Present for screen readers, invisible and out of the layout.
      const el = hiddenText(true, 'sonifier');
      this.chart.root.append(el);
      this.live = el;
    }
    const words = this.chart.localization;
    let text = [this.#describeBar(series, index), ...cues.map((c) => words.text(CUE_WORDS[c]))].join(' ');
    // The same words again must still change the region, or they are not read.
    if (this.live.textContent === text) text += '\u00a0';
    this.live.textContent = text;
  }

  /** The bar's time and values in a sentence. */
  #describeBar(series: SonifiedSeries, index: number): string {
    const point = series.data[index]!;
    const words = this.chart.localization;
    const time = this.chart.formatTime(point.time);
    const f = (v: number) => series.formatValue(v);
    if ('close' in point) {
      const before = series.data[index - 1] as Bar | undefined;
      const base = before ? before.close : point.open;
      const change = point.close - base;
      const pct = base !== 0 ? ` (${words.percent(Math.abs((change / base) * 100), 2)})` : '';
      const amount = `${f(Math.abs(change))}${pct}`;
      const move =
        change === 0
          ? words.text('describeUnchanged')
          : words.text(change > 0 ? 'describeUp' : 'describeDown', { change: amount });
      return words.text('sonifyBar', { time, open: f(point.open), high: f(point.high), low: f(point.low), close: f(point.close), move });
    }
    const title = series.options.title || words.text('sonifyValue');
    return words.text('sonifyPoint', { time, title, value: f(point.value) });
  }

  #setState(state: SonifierState): void {
    if (state === this.#current) return;
    this.#current = state;
    for (const listener of [...this.#listeners]) {
      try {
        listener({ state });
      } catch (error) {
        console.error('A sonifier state:change listener threw', error);
      }
    }
  }

  #onKey = (e: KeyboardEvent) => {
    if (MODIFIERS.has(e.key)) return;
    const keys = this.#opts.keyboard && !inField(e.target);
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (keys && plain && !e.defaultPrevented && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      this.toggle();
      return;
    }
    if (keys && e.key === 'Escape' && this.#current !== 'idle') {
      e.preventDefault();
      this.stop();
      return;
    }
    // Crosshair steps are handled once the event is done, in `onDocumentKey`.
    if (isCrosshairStep(this.chart, e)) return;
    // Any other input stops the sound.
    this.pause();
  };

  /**
   * Crosshair steps (Ctrl+Left and Ctrl+Right by default). The chart may read keys on
   * the chart or on the document (`keyboard.scope`), and its listener may run
   * before or after this one, so the step is judged after the event is done:
   * when the chart took the key, the crosshair moved and the bar it reached
   * is sounded.
   */
  #onDocumentKey = (e: KeyboardEvent) => {
    if (!isCrosshairStep(this.chart, e)) return;
    const inside = this.chart.root.contains(e.target as Node | null);
    if (!inside && !this.#pageKeys()) return;
    if (!this.#opts.keyboard || inField(e.target)) {
      if (inside) this.pause();
      return;
    }
    setTimeout(() => {
      if (this.#destroyed) return;
      if (e.defaultPrevented) this.#soundCrosshair();
      else this.pause();
    }, 0);
  };

  /** Whether the chart reads keys page-wide (`keyboard.scope` `hover` or `global`). */
  #pageKeys(): boolean {
    const scope = this.chart.options.keyboard?.scope;
    return scope === 'hover' || scope === 'global';
  }

  /** Sound the bar the crosshair is on, after a keyboard step moved it there. */
  #soundCrosshair(): void {
    this.pause();
    const series = this.series();
    const at = this.chart.valuesAt();
    const index = series && at ? lastAtOrBefore(series.data as readonly { time: Time }[], at.time) : -1;
    if (series && index >= 0) this.#sound(series, index, false);
  }

  #onInput = () => {
    this.pause();
  };
}

/**
 * Play `chart`'s visible series as sound: pitch follows the value, and up and
 * down bars differ in timbre and stereo side. Short cues mark bar markers,
 * crossed alert lines and new sessions. Nothing sounds until `play` or `step`
 * runs, which must come from a user gesture; any other input on the chart
 * pauses, and `destroy` (or the chart's) stops for good.
 */
export function createSonifier(chart: Chart, options: SonifierOptionsPatch = {}): Sonifier {
  return new ChartSonifier(chart, options);
}
