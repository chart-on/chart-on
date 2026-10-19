---
description: "Play the visible series as sound: pitch follows the value, with cues for markers, alerts and new sessions."
---

# Sonification

A sonifier plays the visible series as sound, so people who cannot see the chart can hear its shape, trend and outliers. It adds to the text summary and live regions described under [screen readers](./interaction#screen-readers).

Pitch follows the value: the lowest value in view sounds at the low end of the pitch range and the highest at the high end. Up and down bars also differ in timbre (a pure tone for up, a softer buzz for down) and stereo side (right for up, left for down), so the direction is heard without judging the pitch. Short cues mark bar markers, crossed alert lines and the first bar of a new trading day.

```ts
import { createChart, createSonifier } from '@chart-on/core';

const chart = createChart(container);
const sonifier = createSonifier(chart, { durationMs: 5000 });

playButton.addEventListener('click', () => sonifier.toggle());
```

The sonifier is a separate module: the chart never imports it, so apps that do not call `createSonifier` do not bundle it. It uses the Web Audio API and needs no assets or network. Importing it is safe on a server: nothing touches the browser until the first `play` or `step`.

## Starting the sound

Nothing sounds until `play()` or `step()` runs, and browsers only allow sound after a user gesture, so call them from a click or key handler. The audio context is made on that first call. Where there is no Web Audio, both return `false`.

## Keys

With the plot focused (and `keyboard` on):

| Key | Does |
| --- | --- |
| <kbd>P</kbd> | Play the visible range, or pause |
| <kbd>Escape</kbd> | Stop, while playing or paused |
| <kbd>Ctrl</kbd>+<kbd>←</kbd> / <kbd>→</kbd> | The chart moves the crosshair one bar; the sonifier sounds that bar and reads its values |

Any other key, a pointer press or a wheel turn on the chart pauses the sound. Modifier keys pressed on their own (as screen readers do) do not.

The stepped bar's time, open, high, low, close and change are read in a polite live region, for example:

> 2024-05-09 11:00. Open 158.00, high 159.50, low 157.80, close 159.00, up 1.00 (0.63%).

While the chart's own `accessibility.crosshairReadout` is on, the sonifier leaves the reading to it.

The words come from the chart's [localization](./localization) messages (`sonifyBar`, `sonifyPoint`, `sonifyValue`, the `sonifyCue*` keys and `describeUp` / `describeDown` / `describeUnchanged`), so they follow the chart's language.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `series` | main series | The candle, line or histogram series to play |
| `durationMs` | `4000` | Time to play the whole visible range; each bar gets an equal share, held between 10 and 500 ms |
| `pitchRange` | `{ low: 220, high: 880 }` | Frequencies (Hz) for the lowest and highest value in view |
| `mode` | `'close'` | `'close'`: one steady tone at the close. `'range'`: a glide across the bar's low and high, rising on up bars and falling on down bars |
| `volume` | `0.2` | Loudness, 0 to 1 |
| `cues` | all `true` | `{ markers, alerts, sessions }`: which events get a cue |
| `followCrosshair` | `true` | Move the crosshair along with the sound |
| `keyboard` | `true` | The keys above |
| `announce` | `true` | Read the stepped bar's values |
| `createAudioContext` | browser `AudioContext` | Makes the audio context on first use; tests pass a fake |

`sonifier.applyOptions(patch)` merges into the current options. Equal value steps give equal musical intervals; on a log price scale, equal ratios of value do instead.

`valueToPitch(value, { min, max, low, high, log? })` is the mapping on its own, for apps that make their own sound.

## Methods and state

| Member | Does |
| --- | --- |
| `play()` | Play the visible range, oldest bar first, or go on from where `pause` stopped |
| `pause()` | Stop the sound and keep the position |
| `stop()` | Stop the sound and forget the position |
| `toggle()` | Pause while playing, else play |
| `step(1)` / `step(-1)` | Sound the next or previous bar on its own, move the crosshair there and announce it. The first step starts on the newest bar in view |
| `state` | `'idle'`, `'playing'` or `'paused'` |
| `position` | Data index of the bar played last, or `null` |
| `on('state:change', fn)` | Subscribe to state changes; returns an unsubscribe function |
| `destroy()` | Stop, close the audio context and detach |

The sonifier registers itself as a chart plugin (named `sonifier-<n>`), so `chart.destroy()` destroys it too.

```ts
sonifier.on('state:change', ({ state }) => {
  playButton.setAttribute('aria-pressed', String(state === 'playing'));
});
```
