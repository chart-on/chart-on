import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chart } from '@chart-on/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { createReplayControls, isReplaying, replayToolbarItem, toggleReplay, topClearOf } from '../src/replay';
import { createBottomBar, wallTime } from '../src/bottombar';
import { createToolbar } from '../src/toolbar';
import { emitPointer, flushFrames, installTestEnvironment } from '@chart-on/core/testing';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

function chart(length = 20) {
  const c = new Chart(fakeContainer(), { timezone: 'UTC' });
  charts.push(c);
  c.addCandles({ animate: false }).setData(Array.from({ length }, (_, i) => ({ time: i * 60, open: 10, high: 20, low: 0, close: 10 })));
  return c;
}

const click = (c: Chart, index: number) =>
  (c as unknown as { emit(event: string, payload: unknown): void }).emit('plot:click', { time: index * 60, index, price: 10, pane: 0, x: 0, y: 0 });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('replay toolbar item', () => {
  it('starts from the picked bar, and stops when pressed again', async () => {
    const c = chart();
    const item = replayToolbarItem();
    expect(item).toMatchObject({ id: 'replay', group: 'view', type: 'button' });
    toggleReplay(c);
    expect(isReplaying(c)).toBe(true);
    click(c, 8);
    await flush();
    expect(c.replay.state).toMatchObject({ active: true, time: 480 });
    toggleReplay(c);
    expect(c.replay.state.active).toBe(false);
    expect(isReplaying(c)).toBe(false);
  });

  it('cancels a pick when pressed while picking', async () => {
    const c = chart();
    toggleReplay(c);
    toggleReplay(c);
    await flush();
    expect(isReplaying(c)).toBe(false);
    click(c, 3);
    await flush();
    expect(c.replay.state.active).toBe(false);
  });
});

describe('replay toolbar button state', () => {
  const press = (el: Element) => (el as unknown as { dispatch(type: string): void }).dispatch('click');

  function mount(length = 200) {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', paddingRight: '0' }));
    const c = chart(length);
    const toolbar = createToolbar(fakeContainer(), c, [replayToolbarItem()]);
    const controls = createReplayControls(c);
    const button = toolbar.get('replay')!.el;
    const strip = (controls.el as unknown as { children: HTMLButtonElement[] }).children;
    // The fake DOM keeps no classes: `aria-pressed` is set alongside `is-active`.
    const pressed = () => button.getAttribute('aria-pressed');
    return {
      c,
      button,
      strip,
      pressed,
      destroy() {
        controls.destroy();
        toolbar.destroy();
        vi.unstubAllGlobals();
      },
    };
  }

  it('clears when the replay stops from the strip', async () => {
    const m = mount();
    press(m.button);
    expect(m.pressed()).toEqual('true');
    click(m.c, 8);
    await flush();
    expect(m.pressed()).toEqual('true');
    press(m.strip[6]!);
    expect(m.c.replay.state.active).toBe(false);
    expect(m.pressed()).toEqual('false');
    m.destroy();
  });

  it('clears when a pick is exited from the strip or cancelled with Escape', async () => {
    const m = mount();
    press(m.button);
    press(m.strip[6]!);
    await flush();
    expect(m.pressed()).toEqual('false');
    press(m.button);
    dispatch(m.c.root, 'keydown', { key: 'Escape' });
    await flush();
    expect(m.pressed()).toEqual('false');
    m.destroy();
  });

  it('follows replays started and stopped outside the button', async () => {
    const m = mount();
    m.c.replay.start(300);
    expect(m.pressed()).toEqual('true');
    m.c.replay.stop();
    expect(m.pressed()).toEqual('false');
    press(m.button);
    press(m.strip[5]!);
    await flush();
    expect(m.c.replay.state.active).toBe(true);
    expect(m.pressed()).toEqual('true');
    m.c.replay.stop();
    expect(m.pressed()).toEqual('false');
    m.destroy();
  });
});

describe('topClearOf', () => {
  const strip = { x: 300, y: 16, width: 200, height: 34 };

  it('keeps the strip where it is when no legend row is under it', () => {
    expect(topClearOf(strip, [])).toBe(16);
    // A short row on the left, and a row below the strip.
    expect(topClearOf(strip, [{ x: 10, y: 10, width: 200, height: 18 }, { x: 10, y: 60, width: 600, height: 18 }])).toBe(16);
  });

  it('moves below each row it would cover, rows it then meets included', () => {
    const price = { x: 10, y: 10, width: 420, height: 18 };
    const indicator = { x: 10, y: 30, width: 350, height: 18 };
    expect(topClearOf(strip, [price])).toBe(32);
    expect(topClearOf(strip, [price, indicator])).toBe(52);
    // A row that ends before the strip starts does not move it.
    expect(topClearOf(strip, [price, { ...indicator, width: 280 }])).toBe(32);
  });
});

describe('replay controls', () => {
  it('show while a replay runs and follow its state', () => {
    const c = chart();
    const controls = createReplayControls(c);
    expect(controls.el.hidden).toBe(true);
    c.replay.start(300);
    expect(controls.el.hidden).toBe(false);
    const [back, play, pause, step] = (controls.el as unknown as { children: HTMLButtonElement[] }).children;
    expect(play!.hidden).toBe(false);
    expect(pause!.hidden).toBe(true);
    (step as unknown as { dispatch(type: string): void }).dispatch('click');
    expect(c.replay.state.time).toBe(360);
    (back as unknown as { dispatch(type: string): void }).dispatch('click');
    expect(c.replay.state.time).toBe(300);
    c.replay.stop();
    expect(controls.el.hidden).toBe(true);
    controls.destroy();
  });
});

describe('restart from a clicked bar', () => {
  it('restarts a paused replay from the clicked bar, paused at the same speed', () => {
    const c = chart();
    const controls = createReplayControls(c);
    c.replay.start(600);
    c.replay.speed = 5;
    click(c, 4);
    expect(c.replay.state).toMatchObject({ active: true, playing: false, time: 240, speed: 5 });
    controls.destroy();
  });

  it('restarts an ended replay, enabling play and step again', () => {
    const c = chart();
    const controls = createReplayControls(c);
    const [, play, , step] = (controls.el as unknown as { children: HTMLButtonElement[] }).children;
    c.replay.start(17 * 60);
    c.replay.step(2);
    expect(c.replay.state.remaining).toBe(0);
    expect([play!.disabled, step!.disabled]).toEqual([true, true]);
    click(c, 5);
    expect(c.replay.state).toMatchObject({ active: true, time: 300, remaining: 14 });
    expect([play!.disabled, step!.disabled]).toEqual([false, false]);
    controls.destroy();
  });

  it('ignores clicks while playing, past the bars, without a replay and after destroy', () => {
    const c = chart();
    const controls = createReplayControls(c);
    click(c, 4);
    expect(c.replay.state.active).toBe(false);
    c.replay.start(600);
    click(c, 15);
    expect(c.replay.state.time).toBe(600);
    c.replay.play();
    click(c, 4);
    expect(c.replay.state.time).toBe(600);
    c.replay.pause();
    controls.destroy();
    click(c, 4);
    expect(c.replay.state.time).toBe(600);
  });

  it('ignores clicks once the replay plugin is uninstalled', () => {
    const c = chart();
    const controls = createReplayControls(c);
    c.replay.start(600);
    expect(c.uninstall('@chart-on/core/replay')).toBe(true);
    const errors = vi.fn();
    c.on('chart:error', errors);
    click(c, 4);
    expect(errors).not.toHaveBeenCalled();
    expect(c.main?.data).toHaveLength(20);
    controls.destroy();
  });

  it('restarts on a plain click but not on a drag, with real pointer input', () => {
    const env = installTestEnvironment({ width: 640, height: 400 });
    try {
      const c = new Chart(env.container(), { timezone: 'UTC' });
      charts.push(c);
      const bars = Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 20, low: 0, close: 10 }));
      c.addCandles({ animate: false }).setData(bars);
      flushFrames();
      const controls = createReplayControls(c);
      c.replay.start(40 * 60);
      flushFrames();
      // A drag from bar 30 pans and keeps the replay where it is.
      const from = c.coordinateFor(30 * 60, 10)!;
      const rect = c.root.getBoundingClientRect();
      const at = (dx: number) => ({ pointerType: 'mouse', pointerId: 1, button: 0, clientX: rect.left + from.x + dx, clientY: rect.top + from.y! });
      dispatch(c.root, 'pointerdown', { ...at(0), buttons: 1 });
      dispatch(c.root, 'pointermove', { ...at(60), buttons: 1 });
      dispatch(c.root, 'pointerup', { ...at(60), buttons: 0 });
      expect(c.replay.state.time).toBe(40 * 60);
      flushFrames();
      expect(c.coordinateFor(30 * 60, 10)!.x).toBeGreaterThan(from.x);
      expect(emitPointer(c, { type: 'click', time: 20 * 60, price: 10 })).toBe(true);
      expect(c.replay.state.time).toBe(20 * 60);
      controls.destroy();
    } finally {
      charts.splice(0).forEach((x) => x.destroy());
      env.uninstall();
    }
  });
});

describe('random bar', () => {
  const press = (el: Element) => (el as unknown as { dispatch(type: string): void }).dispatch('click');
  const randomButton = (el: HTMLElement) => (el as unknown as { children: HTMLButtonElement[] }).children[5]!;

  it('restarts the replay at another random bar', () => {
    const c = chart(200);
    const controls = createReplayControls(c);
    const random = randomButton(controls.el);
    expect(random.getAttribute('aria-label')).toBe('Random bar');
    c.replay.start(120 * 60);
    expect(random.disabled).toBe(false);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    press(random);
    expect(c.replay.state.time).toBe(100 * 60);
    press(random);
    expect(c.replay.state.time).toBe(101 * 60);
    controls.destroy();
  });

  it('starts from the toolbar without clicking a bar', async () => {
    const c = chart(200);
    const controls = createReplayControls(c);
    toggleReplay(c);
    // Picking shows the strip with only random bar and exit.
    expect(controls.el.hidden).toBe(false);
    const [back, play, pause, step, , random, exit] = (controls.el as unknown as { children: HTMLButtonElement[] }).children;
    expect([back, play, pause, step].map((b) => b!.hidden)).toEqual([true, true, true, true]);
    expect([random, exit].map((b) => b!.hidden)).toEqual([false, false]);
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    press(random!);
    await flush();
    expect(c.replay.state).toMatchObject({ active: true, time: 149 * 60 });
    expect(isReplaying(c)).toBe(true);
    // The pick ended: the strip shows the playback buttons.
    expect(play!.hidden).toBe(false);
    controls.destroy();
  });

  it('exit cancels a pick, and the button is disabled on short series', async () => {
    const c = chart();
    const controls = createReplayControls(c);
    toggleReplay(c);
    expect(randomButton(controls.el).disabled).toBe(true);
    press((controls.el as unknown as { children: HTMLButtonElement[] }).children[6]!);
    await flush();
    expect(isReplaying(c)).toBe(false);
    expect(controls.el.hidden).toBe(true);
    controls.destroy();
  });
});

describe('go to date', () => {
  it('reads a date and an optional time as wall clock in the timezone', () => {
    expect(wallTime('2024-03-10', '', 'UTC')).toBe(Date.UTC(2024, 2, 10) / 1000);
    expect(wallTime('2024-03-10', '09:30', 'America/New_York')).toBe(Date.UTC(2024, 2, 10, 13, 30) / 1000);
    expect(wallTime('', '09:30', 'UTC')).toBeNull();
  });

  it('has no default key, opens with a bound one and goes to the submitted date', () => {
    const c = chart();
    const goTo = vi.spyOn(c, 'goToTime').mockResolvedValue();
    const host = fakeContainer();
    // The bar measures its items, and the form the viewport as it opens.
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', paddingRight: '0' }));
    vi.stubGlobal('document', Object.assign(Object.create(document), { documentElement: { clientWidth: 800, clientHeight: 600 } }));
    const bar = createBottomBar(host, c, { clock: false });
    const form = bar.el.querySelector('.pc-goto-form') as unknown as HTMLFormElement & { children: HTMLInputElement[] };
    expect(form.hidden).toBe(true);
    expect(c.actions.keys('go-to-date')).toEqual([]);
    dispatch(c.root, 'keydown', { key: 'g', code: 'KeyG' });
    expect(form.hidden).toBe(true);
    c.actions.setKeys('go-to-date', ['F9']);
    dispatch(c.root, 'keydown', { key: 'F9', code: 'F9' });
    expect(form.hidden).toBe(false);
    form.children[0]!.value = '1970-01-01';
    form.children[1]!.value = '00:05';
    dispatch(form, 'submit');
    expect(goTo).toHaveBeenCalledWith(300);
    expect(form.hidden).toBe(true);
    bar.destroy();
    vi.unstubAllGlobals();
  });
});
