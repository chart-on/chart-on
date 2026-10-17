/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { createSonifier, valueToPitch, type SonifierOptionsPatch } from '../src/sonify';
import type { Bar } from '../src/types';

/** An audio parameter that records its automation. */
class FakeParam {
  value = 0;
  readonly events: [kind: string, value: number, time: number][] = [];
  setValueAtTime(v: number, t: number) {
    this.events.push(['set', v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(['linear', v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push(['exp', v, t]);
  }
}

class FakeNode {
  connected = 0;
  disconnected = 0;
  connect() {
    this.connected++;
  }
  disconnect() {
    this.disconnected++;
  }
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  readonly frequency = new FakeParam();
  startAt: number | null = null;
  stopAt: number | null = null;
  /** `stop()` without a time: cut short. */
  cut = false;
  onended: (() => void) | null = null;
  start(t = 0) {
    this.startAt = t;
  }
  stop(t?: number) {
    if (t === undefined) this.cut = true;
    else this.stopAt = t;
  }
  /** The first frequency it was set to. */
  get pitch(): number {
    return this.frequency.events[0]![1];
  }
}

function fakeAudio() {
  const oscillators: FakeOscillator[] = [];
  const gains: (FakeNode & { gain: FakeParam })[] = [];
  const pans: (FakeNode & { pan: FakeParam })[] = [];
  const ctx = {
    currentTime: 0,
    state: 'suspended',
    resumes: 0,
    closed: false,
    destination: new FakeNode(),
    createOscillator() {
      const o = new FakeOscillator();
      oscillators.push(o);
      return o;
    },
    createGain() {
      const g = Object.assign(new FakeNode(), { gain: new FakeParam() });
      gains.push(g);
      return g;
    },
    createStereoPanner() {
      const p = Object.assign(new FakeNode(), { pan: new FakeParam() });
      pans.push(p);
      return p;
    },
    resume() {
      ctx.resumes++;
      ctx.state = 'running';
      return Promise.resolve();
    },
    close() {
      ctx.closed = true;
      return Promise.resolve();
    },
  };
  const made = vi.fn(() => ctx);
  /** Notes only: cues use fixed frequencies on their own oscillators. */
  const notes = () => oscillators.filter((o) => o.type === 'sine' || o.type === 'triangle');
  return { ctx, made, oscillators, gains, pans, notes };
}

const charts: Chart[] = [];
beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.useRealTimers();
});

/** Flat minute bars (open = high = low = close) with the given closes. */
const flat = (closes: number[]): Bar[] => closes.map((c, i) => ({ time: i * 60, open: c, high: c, low: c, close: c }));

function chart(bars: Bar[]) {
  const c = new Chart(fakeContainer(), { timezone: 'UTC' });
  charts.push(c);
  c.addCandles().setData(bars);
  c.fitContent(false);
  render(c);
  return c;
}

function render(c: Chart): void {
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(16);
}

function setup(bars: Bar[], options: SonifierOptionsPatch = {}) {
  const c = chart(bars);
  const audio = fakeAudio();
  const s = createSonifier(c, { createAudioContext: audio.made, ...options });
  return { c, s, audio };
}

const live = (c: Chart) =>
  (c.root as unknown as { children: { dataset: Record<string, string>; textContent: string }[] }).children.find(
    (el) => el.dataset.role === 'sonifier',
  );

describe('valueToPitch', () => {
  const range = { min: 10, max: 30, low: 220, high: 880 };

  it('maps the lowest and highest values to the ends of the pitch range', () => {
    expect(valueToPitch(10, range)).toBeCloseTo(220);
    expect(valueToPitch(30, range)).toBeCloseTo(880);
  });

  it('gives equal value steps equal musical intervals on a linear scale', () => {
    // Halfway in value is halfway in pitch: one octave up of two.
    expect(valueToPitch(20, range)).toBeCloseTo(440);
    expect(valueToPitch(15, range)).toBeCloseTo(220 * Math.SQRT2);
  });

  it('gives equal ratios equal intervals on a log scale', () => {
    const log = { min: 1, max: 100, low: 220, high: 880, log: true };
    expect(valueToPitch(10, log)).toBeCloseTo(440);
    expect(valueToPitch(10, { ...log, log: false })).toBeCloseTo(220 * Math.pow(4, 9 / 99));
  });

  it('falls back to linear when a log range is not positive', () => {
    expect(valueToPitch(0, { min: -10, max: 10, low: 220, high: 880, log: true })).toBeCloseTo(440);
  });

  it('clamps values outside the range and uses the middle for a flat one', () => {
    expect(valueToPitch(5, range)).toBeCloseTo(220);
    expect(valueToPitch(99, range)).toBeCloseTo(880);
    expect(valueToPitch(7, { min: 7, max: 7, low: 220, high: 880 })).toBeCloseTo(440);
  });
});

describe('sonifier playback', () => {
  const closes = [10, 20, 30, 20, 10, 15, 25, 30, 12, 18];

  it('makes no audio context until play, and resumes a suspended one', () => {
    const { s, audio } = setup(flat(closes));
    expect(audio.made).not.toHaveBeenCalled();
    expect(s.state).toBe('idle');
    expect(s.play()).toBe(true);
    expect(audio.made).toHaveBeenCalledTimes(1);
    expect(audio.ctx.resumes).toBe(1);
    expect(s.state).toBe('playing');
  });

  it('plays nothing without Web Audio', () => {
    const c = chart(flat(closes));
    const s = createSonifier(c);
    expect(s.play()).toBe(false);
    expect(s.step(1)).toBe(false);
    expect(s.state).toBe('idle');
  });

  it('schedules one note per visible bar, evenly spread over durationMs', () => {
    const { c, s, audio } = setup(flat(closes), { durationMs: 1000 });
    const range = c.getVisibleRange()!;
    expect(range).toEqual({ from: 0, to: 540 });
    s.play();
    const notes = audio.notes();
    expect(notes).toHaveLength(closes.length);
    const step = 1000 / closes.length / 1000;
    notes.forEach((n, i) => {
      expect(n.startAt).toBeCloseTo(notes[0]!.startAt! + i * step);
      expect(n.stopAt! - n.startAt!).toBeCloseTo(step * 0.85);
    });
  });

  it('maps the lowest close to the low pitch and the highest to the high one', () => {
    const { s, audio } = setup(flat(closes), { pitchRange: { low: 200, high: 800 } });
    s.play();
    const pitches = audio.notes().map((n) => n.pitch);
    expect(pitches[0]).toBeCloseTo(200);
    expect(pitches[2]).toBeCloseTo(800);
    expect(pitches[1]).toBeCloseTo(400);
  });

  it('follows a log price scale', () => {
    const { c, s, audio } = setup(flat([1, 10, 100]));
    c.setPriceScaleMode('log');
    s.play();
    expect(audio.notes()[1]!.pitch).toBeCloseTo(440);
  });

  it('marks up and down bars by timbre and side', () => {
    const bars: Bar[] = [
      { time: 0, open: 10, high: 12, low: 9, close: 11 },
      { time: 60, open: 11, high: 12, low: 8, close: 9 },
    ];
    const { s, audio } = setup(bars);
    s.play();
    const [up, down] = audio.notes();
    expect(up!.type).toBe('sine');
    expect(down!.type).toBe('triangle');
    expect(audio.pans.map((p) => p.pan.value)).toEqual([0.3, -0.3]);
  });

  it('glides across the bar in range mode', () => {
    const bars: Bar[] = [
      { time: 0, open: 10, high: 20, low: 10, close: 20 },
      { time: 60, open: 20, high: 20, low: 10, close: 10 },
    ];
    const { s, audio } = setup(bars, { mode: 'range' });
    s.play();
    const [up, down] = audio.notes();
    expect(up!.pitch).toBeCloseTo(220);
    expect(up!.frequency.events[1]).toEqual(['exp', expect.closeTo(880), expect.any(Number)]);
    expect(down!.pitch).toBeCloseTo(880);
    expect(down!.frequency.events[1]![1]).toBeCloseTo(220);
  });

  it('adds a cue for a bar marker', () => {
    const { c, s, audio } = setup(flat(closes));
    c.annotations.setMarkers([{ time: 130, shape: 'circle' }]);
    s.play();
    const cue = audio.oscillators.find((o) => o.pitch === 1760)!;
    // 130 lies inside the bar at 120, the third.
    expect(cue.startAt).toBeCloseTo(audio.notes()[2]!.startAt!);
  });

  it('adds a cue for the first bar of a new day on intraday bars', () => {
    const bars = flat([10, 11, 12]).map((b, i) => ({ ...b, time: 86400 - 3600 + i * 3600 }));
    const { s, audio } = setup(bars);
    s.play();
    expect(audio.oscillators.filter((o) => o.pitch === 110)).toHaveLength(1);
  });
});

describe('sonifier timing and control', () => {
  const closes = [10, 20, 30, 20, 10, 15, 25, 30, 12, 18];

  it('follows the sound with the position and the crosshair, then ends idle', () => {
    const { c, s, audio } = setup(flat(closes), { durationMs: 1000 });
    const states: string[] = [];
    s.on('state:change', (e) => states.push(e.state));
    s.play();
    const t0 = audio.notes()[0]!.startAt!;
    audio.ctx.currentTime = t0 + 0.35;
    vi.advanceTimersByTime(50);
    expect(s.position).toBe(3);
    expect(c.crosshair).not.toBeNull();
    expect(c.xToIndex(c.crosshair!.x)).toBeCloseTo(3, 9);
    audio.ctx.currentTime = t0 + 1.2;
    vi.advanceTimersByTime(50);
    expect(s.state).toBe('idle');
    expect(s.position).toBe(9);
    expect(states).toEqual(['playing', 'idle']);
  });

  it('pauses with the position kept, and goes on from there', () => {
    const { s, audio } = setup(flat(closes), { durationMs: 1000 });
    s.play();
    const first = audio.notes();
    audio.ctx.currentTime = first[0]!.startAt! + 0.45;
    s.pause();
    expect(s.state).toBe('paused');
    expect(s.position).toBe(4);
    // Pending notes are cut and the output disconnected.
    expect(first.every((n) => n.cut)).toBe(true);
    expect(audio.gains[0]!.disconnected).toBe(1);
    s.play();
    expect(audio.notes().length - first.length).toBe(closes.length - 4);
  });

  it('stops and forgets the position', () => {
    const { s } = setup(flat(closes));
    s.play();
    s.stop();
    expect(s.state).toBe('idle');
    expect(s.position).toBeNull();
  });

  it('steps bar by bar from the newest bar in view and announces the values', () => {
    const { c, s, audio } = setup(flat(closes));
    expect(s.step(-1)).toBe(true);
    expect(s.position).toBe(9);
    expect(audio.notes()).toHaveLength(1);
    expect(s.step(-1)).toBe(true);
    expect(s.position).toBe(8);
    expect(c.xToIndex(c.crosshair!.x)).toBe(8);
    expect(live(c)!.textContent).toContain('close 12');
    expect(live(c)!.textContent).toContain('down');
    expect(s.state).toBe('idle');
  });

  it('announces in the chart language', () => {
    const { c, s } = setup(flat(closes));
    c.applyOptions({ localization: { messages: { sonifyBar: '{time}: Schluss {close}, {move}.', describeDown: 'minus {change}' } } });
    s.step(-1);
    s.step(-1);
    expect(live(c)!.textContent).toMatch(/: Schluss 12\S*, minus /);
  });

  it('leaves the reading to the chart while its crosshair readout is on', () => {
    const { c, s } = setup(flat(closes));
    c.applyOptions({ accessibility: { crosshairReadout: true } });
    s.step(1);
    expect(live(c)).toBeUndefined();
  });
});

describe('sonifier keyboard', () => {
  const closes = [10, 20, 30, 20, 10, 15, 25, 30, 12, 18];
  const key = (c: Chart, k: string, extra: Record<string, unknown> = {}) =>
    dispatch(c.root, 'keydown', { key: k, code: '', ...extra });

  it('plays and pauses with P, and stops with Escape', () => {
    const { c, s } = setup(flat(closes));
    expect(key(c, 'p').defaultPrevented).toBe(true);
    expect(s.state).toBe('playing');
    key(c, 'P', { shiftKey: true });
    expect(s.state).toBe('paused');
    key(c, 'p');
    expect(s.state).toBe('playing');
    expect(key(c, 'Escape').defaultPrevented).toBe(true);
    expect(s.state).toBe('idle');
  });

  it('sounds and announces the bar a Ctrl+Arrow crosshair step reaches', () => {
    const { c, s, audio } = setup(flat(closes));
    key(c, 'ArrowLeft', { ctrlKey: true });
    vi.advanceTimersByTime(0);
    key(c, 'ArrowLeft', { ctrlKey: true });
    vi.advanceTimersByTime(0);
    const index = c.xToIndex(c.crosshair!.x)!;
    expect(s.position).toBe(index);
    expect(audio.notes()).toHaveLength(2);
    expect(live(c)!.textContent).toContain(`close ${closes[index]}`);
  });

  it('sounds Ctrl+Arrow steps when the chart reads keys page-wide', () => {
    const { c, s, audio } = setup(flat(closes));
    c.applyOptions({ keyboard: { scope: 'global' } });
    dispatch(document.createElement('div'), 'keydown', { key: 'ArrowLeft', code: '', ctrlKey: true });
    vi.advanceTimersByTime(0);
    expect(s.position).toBe(c.xToIndex(c.crosshair!.x));
    expect(audio.notes()).toHaveLength(1);
  });

  it('pauses on any other input, but not on a modifier alone', () => {
    const { c, s } = setup(flat(closes));
    s.play();
    key(c, 'Shift');
    expect(s.state).toBe('playing');
    key(c, 'ArrowLeft');
    expect(s.state).toBe('paused');
    s.play();
    dispatch(c.root, 'pointerdown', { clientX: 10, clientY: 10 });
    expect(s.state).toBe('paused');
    s.play();
    dispatch(c.root, 'wheel', { deltaY: 10 });
    expect(s.state).toBe('paused');
  });

  it('leaves the keys alone with keyboard off', () => {
    const { c, s } = setup(flat(closes), { keyboard: false });
    expect(key(c, 'p').defaultPrevented).toBe(false);
    expect(s.state).toBe('idle');
  });
});

describe('sonifier cleanup', () => {
  const closes = [10, 20, 30];

  it('destroy stops the sound, closes the context and detaches', () => {
    const { c, s, audio } = setup(flat(closes));
    s.step(1);
    s.play();
    s.destroy();
    expect(s.state).toBe('idle');
    expect(audio.ctx.closed).toBe(true);
    expect(live(c)).toBeUndefined();
    // The test setup's built-in plugins stay; the sonifier's own is gone.
    expect(c.installedPlugins.filter((name) => !name.startsWith('@charton/core/'))).toEqual([]);
    expect(dispatch(c.root, 'keydown', { key: 'p', code: '' }).defaultPrevented).toBe(false);
    expect(s.play()).toBe(false);
  });

  it('disconnects the output of a playback that ended on its own when the next one starts', () => {
    const { s, audio } = setup(flat(closes));
    s.play();
    const master = audio.gains[0]!;
    audio.ctx.currentTime = 60;
    vi.advanceTimersByTime(100);
    expect(s.state).toBe('idle');
    expect(master.disconnected).toBe(0);
    s.play();
    expect(master.disconnected).toBe(1);
  });

  it('is destroyed with the chart', () => {
    const { c, s, audio } = setup(flat(closes));
    s.play();
    c.destroy();
    expect(s.state).toBe('idle');
    expect(audio.ctx.closed).toBe(true);
  });

  it('rejects invalid options', () => {
    const c = chart(flat(closes));
    expect(() => createSonifier(c, { durationMs: 0 })).toThrow(RangeError);
    expect(() => createSonifier(c, { pitchRange: { low: -1 } })).toThrow(RangeError);
  });
});

describe('sonifier bundle cost', () => {
  it('is imported by nothing but the package entry, so apps that skip it do not bundle it', () => {
    const sources = import.meta.glob<string>('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });
    const importers = Object.entries(sources)
      .filter(([, text]) => /from '\.{1,2}\/(?:[\w-]+\/)*sonify'/.test(text))
      .map(([path]) => path);
    expect(importers).toEqual(['../src/index.ts']);
  });
});
