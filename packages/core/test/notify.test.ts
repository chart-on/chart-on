import { describe, expect, it } from 'vitest';
import { fakeContainer, pendingFrames, runFrame } from './fake-dom';
import { Chart, type NotifyEvent, type StatusChangeEvent } from '../src/chart';

let now = 0;
const drawFrames = () => {
  for (let i = 0; i < 10 && pendingFrames() > 0; i++) runFrame((now += 16));
};
const statusEl = (c: Chart) => (c.root as unknown as { querySelector(s: string): { style: Record<string, string> } | null }).querySelector('.pc-status');

describe('chart.notify', () => {
  it('emits ui:notify with the defaults filled in', () => {
    const c = new Chart(fakeContainer(), { timezone: 'UTC' });
    const seen: NotifyEvent[] = [];
    c.on('ui:notify', (e) => seen.push(e));
    c.notify({ message: 'Saved', kind: 'success', durationMs: 0 });
    c.notify({ message: 'Interval unavailable' });
    expect(seen.map(({ message, kind, durationMs }) => ({ message, kind, durationMs }))).toEqual([
      { message: 'Saved', kind: 'success', durationMs: 0 },
      { message: 'Interval unavailable', kind: 'info', durationMs: 5000 },
    ]);
    c.destroy();
  });

  it('ignores empty messages and replaces bad kinds and durations', () => {
    const c = new Chart(fakeContainer(), { timezone: 'UTC' });
    const seen: NotifyEvent[] = [];
    c.on('ui:notify', (e) => seen.push(e));
    c.notify({ message: '' });
    c.notify({ message: 'x', kind: 'warning' as never, durationMs: -1 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: 'info', durationMs: 5000 });
    c.destroy();
  });

  it('lets a listener prevent the default toast', () => {
    const c = new Chart(fakeContainer(), { timezone: 'UTC' });
    let event: NotifyEvent | null = null;
    c.on('ui:notify', (e) => e.preventDefault());
    c.on('ui:notify', (e) => (event = e));
    c.notify({ message: 'Image too large', kind: 'error' });
    expect(event!.defaultPrevented).toBe(true);
    c.destroy();
  });
});

type StatusNode = { textContent: string; children: { tagName: string }[]; getAttribute(k: string): string | null };
const statusNode = (c: Chart) => (c as unknown as { statusEl: StatusNode }).statusEl;

describe('loading spinner', () => {
  it('shows a spinner named by the loading text, and text for other statuses', () => {
    const c = new Chart(fakeContainer(), { timezone: 'UTC' });
    c.setStatus({ kind: 'loading' });
    drawFrames();
    const el = statusNode(c);
    expect(el.children.map((n) => n.tagName)).toEqual(['svg']);
    expect(el.getAttribute('aria-label')).toBe('Loading…');
    c.setStatus({ kind: 'loading', message: 'Fetching bars' });
    drawFrames();
    expect(el.textContent).toBe('Fetching bars');
    expect(el.getAttribute('aria-label')).toBeNull();
    c.setStatus({ kind: 'error' });
    drawFrames();
    expect(el.textContent).toBe('Could not load data');
    c.setStatus({ kind: 'loading' });
    drawFrames();
    expect(el.children.map((n) => n.tagName)).toEqual(['svg']);
    c.destroy();
  });

  it('leaves the watermark out while it spins, unless the app hides it', () => {
    const c = new Chart(fakeContainer(), { timezone: 'UTC', features: { watermark: true } });
    c.addCandles().setData(Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 })));
    const draws: number[] = [];
    c.watermark.drawPlot = () => void draws.push(1);
    const scene = () => {
      draws.length = 0;
      (c as unknown as { render(t: number): void }).render(0);
      return draws.length;
    };
    c.invalidate();
    expect(scene()).toBe(1);
    let hide = false;
    c.on('status:change', (e) => hide && e.preventDefault());
    c.setStatus({ kind: 'loading' });
    expect(scene()).toBe(0);
    c.setStatus(null);
    expect(scene()).toBe(1);
    hide = true;
    c.setStatus({ kind: 'loading' });
    c.invalidate();
    expect(scene()).toBe(1);
    c.destroy();
  });
});

describe('status:change', () => {
  it('fires on every setStatus, and preventDefault hides the built-in text', () => {
    const c = new Chart(fakeContainer(), { timezone: 'UTC' });
    const seen: StatusChangeEvent['status'][] = [];
    c.on('status:change', (e) => {
      seen.push(e.status);
      if (e.status?.kind === 'loading') e.preventDefault();
    });
    c.setStatus({ kind: 'loading' });
    drawFrames();
    expect(statusEl(c)?.style.display ?? 'none').toBe('none');
    c.setStatus({ kind: 'error' });
    drawFrames();
    expect(statusEl(c)!.style.display).toBe('');
    c.setStatus(null);
    expect(seen).toEqual([{ kind: 'loading' }, { kind: 'error' }, null]);
    expect(c.getStatus()).toBeNull();
    c.destroy();
  });

  it('ignores preventDefault when the status is cleared', () => {
    const c = new Chart(fakeContainer(), { timezone: 'UTC' });
    let prevented: boolean | null = null;
    c.on('status:change', (e) => {
      e.preventDefault();
      prevented = e.defaultPrevented;
    });
    c.setStatus(null);
    expect(prevented).toBe(false);
    c.destroy();
  });
});
