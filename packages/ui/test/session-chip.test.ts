import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionBands, type SessionLane, type SessionLaneState } from '@charton/core';
import { installFakeDom } from '../../core/test/fake-dom';
import { createSessionChip, sessionChipLabel, sessionStatusText } from '../src/session-chip';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000;

const lane = (over: Partial<SessionLane> = {}): SessionLane => ({
  id: 'ny',
  name: 'New York',
  timezone: 'America/New_York',
  hours: { weekly: { mon: [{ start: '09:30', end: '16:00' }], fri: [{ start: '09:30', end: '16:00' }] } },
  color: '#ff0000',
  ...over,
});

const state = (over: Partial<SessionLaneState>): SessionLaneState => ({ lane: lane(), open: true, next: null, remaining: null, ...over });

interface FakeNode {
  children: FakeNode[];
  hidden: boolean;
  textContent: string;
  className: string;
  getAttribute(name: string): string | null;
  dispatchEvent?: unknown;
}

function all(root: unknown, cls: string, out: FakeNode[] = []): FakeNode[] {
  for (const child of (root as FakeNode).children) {
    if (child.className.split(' ').includes(cls)) out.push(child);
    all(child, cls, out);
  }
  return out;
}

describe('session chip text', () => {
  it('describes the state with a countdown', () => {
    expect(sessionStatusText(state({ open: true, remaining: 2 * 3600 + 15 * 60 }))).toBe('Open · closes in 02:15:00');
    expect(sessionStatusText(state({ open: false, remaining: 28 * 3600 }))).toBe('Closed · opens in 1d 4h');
    expect(sessionStatusText(state({ open: true }))).toBe('Open');
  });

  it('names every lane and whether it is open', () => {
    const asia = lane({ id: 'asia', name: 'Asia' });
    expect(sessionChipLabel([state({ lane: asia, open: false }), state({ open: true })])).toBe('Market sessions: Asia closed, New York open');
    expect(sessionChipLabel([])).toBe('Market sessions: none');
  });
});

describe('session chip', () => {
  afterEach(() => vi.useRealTimers());

  it('lists the lanes with countdowns and follows lane changes', () => {
    installFakeDom();
    vi.useFakeTimers();
    let now = utc(2024, 3, 8, 15); // Friday, New York open until 21:00 UTC
    const bands = createSessionBands({ lanes: [lane()] });
    const chip = createSessionChip(bands, () => now);
    const statuses = () => all(chip.el, 'pc-session-status').map((n) => n.textContent);
    expect(all(chip.el, 'pc-session-dot')).toHaveLength(2); // trigger dot and list swatch
    expect(statuses()).toEqual(['Open · closes in 06:00:00']);

    now += 60;
    vi.advanceTimersByTime(1000);
    expect(statuses()).toEqual(['Open · closes in 05:59:00']);

    bands.addLane(lane({ id: 'tky', name: 'Tokyo', timezone: 'Asia/Tokyo', color: '#0000ff' }));
    expect(statuses()).toEqual(['Open · closes in 05:59:00', 'Closed · opens in 2d 9h']);
    const trigger = all(chip.el, 'pc-sessions-trigger')[0]!;
    expect(trigger.getAttribute('aria-label')).toBe('Market sessions: New York open, Tokyo closed');

    bands.setLanes([]);
    expect(chip.el.hidden).toBe(true);
    chip.destroy();
  });
});
