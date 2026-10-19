import { cancelPickBar, pickBar, type Chart, type Rect, type Replay, type ReplayState } from '@chart-on/core';
import { History, Pause, Play, Shuffle, StepBack, StepForward, X } from 'lucide';
import { iconButton, menuButton } from './controls';
import { h, isolateFromChart } from './dom';
import type { ToolbarItem } from './toolbar';
import { labelOf, shellText, type ShellMessageKey } from './messages';
import { devRequirePlugin } from './options-schema';

/** Returned by `createReplayControls`: the floating replay strip's element and `destroy`. */
export interface ReplayControlsHandle {
  el: HTMLElement;
  destroy(): void;
}

/** Bars per second the speed menu offers. */
const SPEEDS = [1, 2, 5, 10];

/** Bars a random start keeps before (indicator warm-up) and after (to replay) its bar. */
const RANDOM = { minBefore: 100, minAfter: 50 };

/** Whether a bar is being picked to start a replay on `chart`. */
const picking = new WeakSet<Chart>();
/** Per chart, refreshes run when picking starts or ends: the replay strip's and the top-bar button's. */
const pickWatchers = new WeakMap<Chart, Set<() => void>>();

/** Run `fn` whenever picking a bar for a replay on `chart` starts or ends; returns the unsubscribe. */
function onPick(chart: Chart, fn: () => void): () => void {
  const set = pickWatchers.get(chart) ?? new Set();
  pickWatchers.set(chart, set.add(fn));
  return () => void set.delete(fn);
}

const pickChanged = (chart: Chart) => pickWatchers.get(chart)?.forEach((fn) => fn());

/** Gap between the strip and a legend row above it (css px). */
const ROW_GAP = 4;

/**
 * Top for `box` (moved only down) so it covers none of `rows`, which are in
 * order from the top: below each row it would overlap, `gap` px clear.
 */
export function topClearOf(box: Rect, rows: readonly Rect[], gap = ROW_GAP): number {
  let top = box.y;
  for (const r of rows) {
    if (r.x < box.x + box.width && box.x < r.x + r.width && r.y < top + box.height && top < r.y + r.height) top = r.y + r.height + gap;
  }
  return top;
}

/** `el`'s box relative to `origin`'s. */
function boxIn(el: Element, origin: DOMRect): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height };
}

/** The chart's bar replay, or null on a chart without the `replay()` plugin. */
export const replayOf = (chart: Chart): Replay | null => (chart.installedPlugins.includes('@chart-on/core/replay') ? chart.replay : null);

/**
 * Start a replay from a bar the user picks, or stop the running one. While
 * picking, pressing again cancels the pick.
 */
export function toggleReplay(chart: Chart): void {
  if (chart.replay.state.active) {
    chart.replay.stop();
    return;
  }
  if (picking.has(chart)) {
    cancelPickBar(chart);
    return;
  }
  picking.add(chart);
  const pick = pickBar(chart);
  pickChanged(chart);
  void pick.then((picked) => {
    picking.delete(chart);
    pickChanged(chart);
    if (picked) chart.replay.start(picked.time);
  });
}

/** Whether a replay runs, or a bar is being picked for one, on `chart`. */
export function isReplaying(chart: Chart): boolean {
  return !!replayOf(chart)?.state.active || picking.has(chart);
}

/**
 * The top-bar button for bar replay (`view` group, see
 * `roadmap/toolbar-layout.md`): press it, then click the bar to start from;
 * press it again to stop. Pair it with `createReplayControls` (the shell
 * mounts them) for play, pause, step and speed while replaying.
 */
export function replayToolbarItem(): ToolbarItem {
  return {
    type: 'button',
    id: 'replay',
    ...labelOf('replayLabel'),
    icon: History,
    group: 'view',
    priority: 3,
    onClick: (chart) => toggleReplay(chart),
    isActive: (chart) => isReplaying(chart),
    // A replay also starts and stops from the strip, from code and when a pick ends.
    watch(chart, refresh) {
      const offReplay = chart.on('replay:change', refresh);
      const offPick = onPick(chart, refresh);
      return () => {
        offReplay();
        offPick();
      };
    },
  };
}

/**
 * A floating strip at the top of the chart while a replay runs: back one
 * bar, play or pause, step forward, speed, random bar and exit. While a bar
 * is picked for a replay it offers only random bar and exit. Hidden otherwise.
 * While the replay is paused or ended, a click on a bar restarts it there.
 */
export function createReplayControls(chart: Chart): ReplayControlsHandle {
  const el = h('div', { class: 'pc-replay-bar', role: 'toolbar', 'aria-label': shellText(chart, 'replayLabel') });
  el.hidden = true;
  // Otherwise a press starts a chart gesture whose pointer capture takes the click from the buttons.
  isolateFromChart(el);
  const back = iconButton({
    icon: StepBack,
    label: shellText(chart, 'replayBack'),
    onClick: () => {
      const shown = chart.main?.data ?? [];
      const previous = shown[shown.length - 2];
      if (previous) chart.replay.start(previous.time);
    },
  });
  const play = iconButton({
    icon: Play,
    label: shellText(chart, 'replayPlay'),
    onClick: () => {
      if (chart.replay.state.playing) chart.replay.pause();
      else chart.replay.play();
    },
  });
  const pause = iconButton({ icon: Pause, label: shellText(chart, 'replayPause'), onClick: () => chart.replay.pause() });
  const step = iconButton({ icon: StepForward, label: shellText(chart, 'replayStep'), onClick: () => chart.replay.step() });
  const speed = menuButton({
    label: shellText(chart, 'replaySpeed'),
    options: SPEEDS.map((s) => ({ value: String(s), label: `${s}×` })),
    value: '1',
    onSelect: (value) => {
      chart.replay.speed = Number(value);
    },
  });
  const random = iconButton({
    icon: Shuffle,
    label: shellText(chart, 'replayRandom'),
    // Starting ends a pick in progress: the replay then runs from the random bar.
    onClick: () => {
      if (chart.replay.startRandom(RANDOM) && picking.has(chart)) cancelPickBar(chart);
    },
  });
  const stop = iconButton({
    icon: X,
    label: shellText(chart, 'replayExit'),
    onClick: () => {
      if (picking.has(chart)) cancelPickBar(chart);
      chart.replay.stop();
    },
  });
  el.append(back, play, pause, step, speed.el, random, stop);
  chart.root.append(el);

  // Below the main pane's legend rows it would cover: a wide price row reaches the middle of a narrow chart.
  let legend: Element | null = null;
  const legendResize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => place()) : null;
  const place = () => {
    if (el.hidden) return;
    // The legend's first block is the main pane's (core legend.ts).
    const block = [...chart.root.children].find((c) => c.className === 'pc-legend') ?? null;
    if (block !== legend) {
      if (legend) legendResize?.unobserve(legend);
      if (block) legendResize?.observe(block);
      legend = block;
    }
    el.style.top = '';
    const origin = chart.root.getBoundingClientRect();
    const box = boxIn(el, origin);
    const rows = block && (block as HTMLElement).style.display !== 'none' ? [...block.children].map((row) => boxIn(row, origin)) : [];
    const top = topClearOf(box, rows);
    if (top !== box.y) el.style.top = `${top}px`;
  };

  const refresh = (state: ReplayState = chart.replay.state) => {
    const { active, playing } = state;
    el.hidden = !active && !picking.has(chart);
    back.hidden = step.hidden = speed.el.hidden = !active;
    play.hidden = !active || playing;
    pause.hidden = !active || !playing;
    const ended = state.remaining === 0;
    play.disabled = ended;
    step.disabled = ended;
    speed.set(String(state.speed));
    const bars = (chart.main?.data.length ?? 0) + state.remaining;
    random.disabled = bars <= RANDOM.minBefore + RANDOM.minAfter;
    place();
  };
  refresh();
  // Paused or ended, a plain click on a bar (not a drag) restarts the replay there.
  const offClick = chart.on('plot:click', (e) => {
    // The replay plugin may have been uninstalled since.
    const replay = replayOf(chart);
    const bar = replay?.state.active && !replay.state.playing ? chart.main?.data[e.index] : undefined;
    if (bar) replay?.start(bar.time);
  });
  const off = chart.on('replay:change', refresh);
  const offResize = chart.on('chart:resize', place);
  const offPick = onPick(chart, () => refresh());
  // Relabel in the new language; the buttons keep their state.
  const labelled: [Element | null, ShellMessageKey][] = [
    [el, 'replayLabel'],
    [back, 'replayBack'],
    [play, 'replayPlay'],
    [pause, 'replayPause'],
    [step, 'replayStep'],
    [speed.el.querySelector('.pc-menu-trigger'), 'replaySpeed'],
    [random, 'replayRandom'],
    [stop, 'replayExit'],
  ];
  const offLocale = chart.on('localization:change', () => {
    for (const [node, key] of labelled) {
      if (!node) continue;
      const label = shellText(chart, key);
      node.setAttribute('aria-label', label);
      if (node.getAttribute('data-tip') !== null) node.setAttribute('data-tip', label);
    }
  });
  return {
    el,
    destroy() {
      off();
      offResize();
      legendResize?.disconnect();
      offClick();
      offLocale();
      offPick();
      el.remove();
    },
  };
}

/** The shell's `replayControls` part, made by `replayControls()`: the shell calls it with its chart. */
export type ReplayControlsPart = (chart: Chart) => ReplayControlsHandle;

/**
 * The floating replay strip for the shell's `replayControls` option (see
 * `createReplayControls`). Needs the `replay()` plugin. Without it a replay
 * started by `replayToolbarItem()` or `toggleReplay` has no strip.
 */
export function replayControls(): ReplayControlsPart {
  return (chart) => {
    devRequirePlugin(chart, 'replayControls', 'replay');
    return createReplayControls(chart);
  };
}
