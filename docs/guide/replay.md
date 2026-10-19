---
description: "Replay the main series bar by bar from a chosen time, let the user pick a bar, and scroll to a date with history paged in."
---

# Replay and go to date

The UI package has controls for both: a replay toolbar button with floating playback controls, and a go-to-date control (`goToDate()`) for the toolbar or the bottom bar (see [UI shell](./ui-shell#bar-replay)).

## Bar replay

`chart.replay` hides the main series' bars after a chosen time and reveals them again one at a time, to practise reading a chart without seeing what came next. It needs the `replay()` plugin (or `builtins()`; the UI shell adds it), and throws a [`not-registered`](./errors#not-registered) error without it. See [Opt-in features](./features#opt-in-features).

```ts
import { pickBar } from '@chart-on/core';

const picked = await pickBar(chart);       // let the user click the starting bar
if (picked) chart.replay.start(picked.time);

chart.replay.step();     // reveal the next bar (step(5): the next five)
chart.replay.play(2);    // reveal two bars per second until the end
chart.replay.pause();
chart.replay.speed = 5;  // bars per second, above 0 and at most 100
chart.replay.stop();     // show every bar again

chart.on('replay:change', ({ active, playing, time, remaining }) => updateControls());
```

While playing, each bar grows like a live one: it appears flat at its open, moves through a made-up path inside its range (open, the extreme against its direction, the other extreme, then the close) and ends on its real values, and the chart scrolls left at a steady pace to make room for it. Indicators and the legend follow the growing bar. Pausing, stepping or stopping shows its real values at once. Set `chart.replay.smooth = false` for whole bars; they also appear whole with `lowPower`, on a static chart, when the system asks for reduced motion, and above 5 bars per second. `step()` always reveals whole bars.

`start(time)` shows the bars up to the newest one at or before `time` and returns `false` when there is none. Called again during a replay it jumps there, back or forward. The UI package's replay strip uses this to restart from a clicked bar while the replay is paused or has ended. `replay.state` reads `{ active, playing, time, speed, remaining }`, where `time` is the newest bar shown and `remaining` the number still hidden.

`startRandom(options?)` starts at a random bar, so the user does not know where they are. It only picks among the bars already loaded, with at least `minBefore` bars before the start (default 100, so indicators have warmed up) and `minAfter` after it (default 50, to replay). During a replay it moves to another bar whenever more than one fits. It returns `false` and changes nothing when the bars are too few for both margins. Pass `random` (a function returning a number in [0, 1)) for repeatable starts, for example in tests.

```ts
chart.replay.startRandom();                                  // 100 bars before, 50 after
chart.replay.startRandom({ minBefore: 20, minAfter: 200 });
```

While the replay runs, everything derived from the main series only sees the bars shown: the time axis, autoscale, the legend and `valuesAt`, series with a [`follow`](./series#series-derived-from-the-bars) mapper, indicators (including their own data, which aligns to the bars shown) and compared symbols. Series you fill yourself with `setData` keep their own data, so derive them from the bars, or hide them, during a replay.

Bars from the [data source](./data-sources) keep arriving and are held back: live bars wait at the end, history pages loaded by scrolling back are added before the replay time, and refetched bars replace the held ones. They show as the replay reaches them, or all at once on `stop()`. Loading another symbol or interval ends the replay, as does removing the main series. Do not call `setData` on the main series during a replay; stop it first.

## Pick a bar

`pickBar(chart)` resolves with `{ time, index, bar }` (`PickedBar`) for the next bar of the main series the user clicks, showing a crosshair cursor meanwhile. Clicks beyond the bars are ignored. Escape, `cancelPickBar(chart)`, another `pickBar(chart)` or `chart.destroy()` resolve it with `null`; on a chart already destroyed it resolves with `null` at once. Both are standalone exports of `@chart-on/core`, so apps that do not pick bars leave them out.

## Go to a date

`chart.goToTime(time, animate = true)` scrolls to `time`. When it lies before the loaded bars, older history is paged in through the data source first, until it is loaded, the source has no more, or 50 pages were fetched. Each page loads in its own task, so the page stays responsive however fast the source answers. Without a data source it scrolls as far as the bars allow, like `scrollToTime`.
