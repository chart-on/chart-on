import { englishLocalizer, formatCountdown, type Localizer, type SessionBands, type SessionLaneState } from '@charton/core';
import { h, placePopover } from './dom';
import { shellText } from './messages';

/** Time left as "02:15:00", or "1d 4h" from a day up, in the language's digits and units (`measureDays`, `measureHours`). */
function countdownText(seconds: number, l: Localizer): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 86400) return l.localize(formatCountdown(s));
  const unit = (key: string, n: number) => l.text(key, { n: l.number(n, 0) });
  return `${unit('measureDays', Math.floor(s / 86400))} ${unit('measureHours', Math.floor((s % 86400) / 3600))}`;
}

/** Options for `createSessionChip`, `sessionStatusText` and `sessionChipLabel`. */
export interface SessionChipOptions {
  /**
   * Language of the text, e.g. `chart.localization`; default English. The chip
   * reads it on every tick, so a getter follows language changes.
   */
  localization?: Localizer;
}

/** "Open · closes in 02:15:00", "Closed · opens in 1d 4h" or plain "Open" without a next change. */
export function sessionStatusText(state: SessionLaneState, options: SessionChipOptions = {}): string {
  if (state.remaining === null) return shellText(options, state.open ? 'sessionOpen' : 'sessionClosed');
  return shellText(options, state.open ? 'sessionClosesIn' : 'sessionOpensIn', {
    time: countdownText(state.remaining, options.localization ?? englishLocalizer),
  });
}

/** Accessible name of the chip, e.g. "Market sessions: Asia closed, Europe open". */
export function sessionChipLabel(states: readonly SessionLaneState[], options: SessionChipOptions = {}): string {
  if (states.length === 0) return shellText(options, 'sessionsNone');
  const lanes = states.map((s) => shellText(options, s.open ? 'sessionLaneOpen' : 'sessionLaneClosed', { name: s.lane.name }));
  return shellText(options, 'sessionsList', { list: lanes.join(', ') });
}

/**
 * Bar chip for a session bands primitive: a dot per lane, solid while
 * it is open, and a list with countdowns that opens away from the bar's edge. Ticks once a
 * second and follows lane changes.
 */
export function createSessionChip(
  bands: SessionBands,
  now: () => number = () => Math.floor(Date.now() / 1000),
  options: SessionChipOptions = {},
): {
  el: HTMLElement;
  refresh(): void;
  destroy(): void;
} {
  const t = (key: 'sessions' | 'sessionsEmpty') => shellText(options, key);
  const el = h('div', { class: 'pc-sessions' });
  const trigger = h('button', {
    class: 'pc-chip pc-sessions-trigger',
    'data-tip-side': 'top',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
  });
  const list = h('div', { class: 'pc-popover pc-sessions-list', role: 'dialog' });
  list.hidden = true;
  el.append(trigger, list);

  let dots: HTMLElement[] = [];
  let rows: { status: HTMLElement; row: HTMLElement }[] = [];
  let empty: HTMLElement | null = null;

  /** Rebuild the dots and rows for the current lanes. */
  const build = () => {
    dots = [];
    rows = [];
    trigger.replaceChildren();
    list.replaceChildren();
    for (const lane of bands.lanes) {
      const dot = h('span', { class: 'pc-session-dot', 'aria-hidden': 'true' });
      dot.style.background = lane.color;
      dots.push(dot);
      trigger.append(dot);
      const swatch = h('span', { class: 'pc-session-dot', 'aria-hidden': 'true' });
      swatch.style.background = lane.color;
      const status = h('span', { class: 'pc-session-status' });
      const row = h('div', { class: 'pc-session-row' }, swatch, h('span', { class: 'pc-session-name' }, lane.name), status);
      rows.push({ status, row });
      list.append(row);
    }
    empty = bands.lanes.length === 0 ? h('div', { class: 'pc-session-row pc-session-status' }) : null;
    if (empty) list.append(empty);
    el.hidden = bands.lanes.length === 0;
    refresh();
  };

  const refresh = () => {
    const states = bands.states(now());
    const name = t('sessions');
    trigger.setAttribute('data-tip', name);
    list.setAttribute('aria-label', name);
    if (empty) empty.textContent = t('sessionsEmpty');
    states.forEach((s, i) => {
      dots[i]?.classList.toggle('is-closed', !s.open);
      const r = rows[i];
      if (!r) return;
      r.row.classList.toggle('is-closed', !s.open);
      r.status.textContent = sessionStatusText(s, options);
    });
    trigger.setAttribute('aria-label', sessionChipLabel(states, options));
  };

  const open = () => {
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    refresh();
    // Opens away from the bar's edge (upwards in the bottom bar), on whichever side stays on screen.
    placePopover(list, trigger);
  };
  const close = (refocus: boolean) => {
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (refocus) trigger.focus();
  };
  trigger.addEventListener('click', () => (list.hidden ? open() : close(false)));
  el.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && !list.hidden) close(true);
  });

  build();
  const unsubscribe = bands.on('lanes:change', build);
  const timer = setInterval(refresh, 1000);
  return {
    el,
    refresh,
    destroy() {
      unsubscribe();
      clearInterval(timer);
      el.remove();
    },
  };
}
