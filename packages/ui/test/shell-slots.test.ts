import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer, installFakeDom } from '../../core/test/fake-dom';
import { createChartShell, type ChartShellOptions } from '../src/shell';
import { symbolSearch } from '../src/symbol-search';
import { createStatusSlot } from '../src/slots';
import { createToastStack, toasts } from '../src/toasts';
import type { ChartShell } from '../src/index';

type Node = { children: Node[]; className: string; hidden: boolean; parent: Node | null; textContent: string; dispatch(type: string): void };

function byClass(root: unknown, cls: string): Node | null {
  for (const child of (root as Node).children) {
    if (child.className.split(/\s+/).includes(cls)) return child;
    const found = byClass(child, cls);
    if (found) return found;
  }
  return null;
}

installFakeDom();
const tag = () => document.createElement('span') as unknown as Element;

function shell(options: ChartShellOptions): ChartShell {
  return createChartShell(fakeContainer(), { appearance: false, bottomBar: true, toasts: toasts(), ...options });
}

beforeEach(() => {
  // The shell reads its theme from CSS custom properties; none are set here.
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shell slots', () => {
  it('mounts rail and bottom bar slots in place and removes them on destroy', () => {
    const railTop = tag();
    const bottomEnd = tag();
    let built: unknown = null;
    const s = shell({
      slots: {
        railTop,
        railBottom: (chart) => {
          built = chart;
          return tag();
        },
        bottomBarStart: tag(),
        bottomBarEnd: bottomEnd,
      },
    });
    expect(built).toBe(s.chart);
    const side = s.rail!.el.parentElement ?? (s.rail!.el as unknown as Node).parent!;
    const parts = (side as unknown as Node).children.map((c) => c.className.split(' ').pop());
    expect(parts).toEqual(['pc-slot--rail-top', 'pc-rail', 'pc-slot--rail-bottom']);
    expect((side as unknown as Node).className).toContain('pc-shell-side--slots');
    // The strip around the bottom bar's toolbar.
    const bar = (s.bottomBar!.el as unknown as Node).parent!;
    expect(bar.children[0]!.className).toBe('pc-slot pc-slot--bottom-bar-start');
    expect(bar.children.at(-1)!.className).toBe('pc-slot pc-slot--bottom-bar-end');
    expect((railTop as unknown as Node).parent!.className).toBe('pc-slot pc-slot--rail-top');

    s.destroy();
    expect(byClass(s.el, 'pc-slot--rail-top')).toBeNull();
    expect(byClass(s.el, 'pc-slot--bottom-bar-end')).toBeNull();
    expect((bottomEnd as unknown as Node).parent).not.toBeNull(); // still in its wrapper, which left the page
    expect((s.el as unknown as Node).parent).toBeNull();
  });

  it('skips rail and bottom bar slots when those parts are off', () => {
    const s = shell({ rail: false, bottomBar: false, slots: { railTop: tag(), bottomBarEnd: tag() } });
    expect(byClass(s.el, 'pc-slot')).toBeNull();
    s.destroy();
  });

  it('shows the loading and empty slots instead of the chart text, then cleans up', () => {
    const s = shell({ slots: { loading: tag(), empty: () => tag() } });
    const overlay = byClass(s.el, 'pc-status-slot')!;
    expect(overlay.hidden).toBe(true);
    const prevented: boolean[] = [];
    s.chart.on('status:change', (e) => prevented.push(e.defaultPrevented));

    s.chart.setStatus({ kind: 'loading' });
    expect(overlay.hidden).toBe(false);
    expect(overlay.children[0]!.className).toBe('pc-slot pc-slot--loading');
    s.chart.setStatus({ kind: 'no-data' });
    expect(overlay.children[0]!.className).toBe('pc-slot pc-slot--empty');
    // Errors keep the chart's own text.
    s.chart.setStatus({ kind: 'error' });
    expect(overlay.hidden).toBe(true);
    expect(prevented).toEqual([true, true, false]);

    s.destroy();
    expect(overlay.parent).toBeNull();
  });

  it('takes over a status the chart already shows', () => {
    const s = shell({});
    s.chart.setStatus({ kind: 'loading' });
    const slot = createStatusSlot(s.el, s.chart, { loading: tag() })!;
    expect(slot.showing).toBe('loading');
    expect(slot.el.hidden).toBe(false);
    slot.destroy();
    expect(createStatusSlot(s.el, s.chart, {})).toBeNull();
    s.destroy();
  });
});

describe('shell class names', () => {
  it('adds the class map to the parts and to dialogs opened in the shell', () => {
    const s = shell({
      className: 'app',
      toolbar: [{ type: 'spacer' }],
      symbolSearch: symbolSearch({ source: { search: async () => [] }, onSelect: () => {} }),
      classNames: { root: 'app-root', toolbar: 'app-toolbar', rail: 'app-rail', bottomBar: 'app-bar', dialog: 'app-dialog' },
    });
    expect(s.el.className).toBe('pc-shell app app-root');
    expect(s.toolbar!.el.className).toContain('app-toolbar');
    expect(s.rail!.el.className).toContain('app-rail');
    expect((s.bottomBar!.el as unknown as Node).parent!.className).toContain('app-bar');
    expect(byClass(s.el, 'pc-symbol-search')!.className).toContain('app-dialog');
    s.destroy();
  });
});

describe('shell toasts', () => {
  it('shows a toast for an unhandled notification and dismisses it after its duration', async () => {
    vi.useFakeTimers();
    const s = shell({});
    s.chart.notify({ message: 'Interval unavailable', durationMs: 3000 });
    await Promise.resolve();
    const toast = byClass(s.el, 'pc-toast')!;
    expect(toast.className).toBe('pc-toast pc-toast--info');
    expect(toast.children[0]!.textContent).toBe('Interval unavailable');
    expect(s.toasts!.toasts).toHaveLength(1);
    vi.advanceTimersByTime(2999);
    expect(s.toasts!.toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(s.toasts!.toasts).toHaveLength(0);
    expect(byClass(s.el, 'pc-toast')).toBeNull();
    s.destroy();
  });

  it('closes from the dismiss button and keeps a toast with no duration until then', async () => {
    vi.useFakeTimers();
    const s = shell({});
    s.chart.notify({ message: 'Image too large', kind: 'error', durationMs: 0 });
    await Promise.resolve();
    vi.advanceTimersByTime(60_000);
    const toast = byClass(s.el, 'pc-toast')!;
    expect(toast.className).toBe('pc-toast pc-toast--error');
    toast.children[1]!.dispatch('click');
    expect(s.toasts!.toasts).toHaveLength(0);
    s.destroy();
  });

  it('shows nothing when the host handles the event, even from a listener added later', async () => {
    const s = shell({});
    s.chart.on('ui:notify', (e) => e.preventDefault());
    s.chart.notify({ message: 'Handled' });
    await Promise.resolve();
    expect(byClass(s.el, 'pc-toast')).toBeNull();
    s.destroy();
  });

  it('pauses while hovered and keeps at most four', async () => {
    vi.useFakeTimers();
    const s = shell({});
    for (let i = 0; i < 6; i++) s.chart.notify({ message: `m${i}`, durationMs: 1000 });
    await Promise.resolve();
    expect(s.toasts!.toasts.map((t) => t.textContent || (t as unknown as Node).children[0]!.textContent)).toEqual(['m2', 'm3', 'm4', 'm5']);
    const first = s.toasts!.toasts[0] as unknown as Node;
    first.dispatch('pointerenter');
    vi.advanceTimersByTime(5000);
    expect(s.toasts!.toasts).toEqual([first]);
    first.dispatch('pointerleave');
    vi.advanceTimersByTime(1000);
    expect(s.toasts!.toasts).toHaveLength(0);
    s.destroy();
  });

  const bars = (s: ChartShell) => s.chart.addCandles().setData([{ time: 60, open: 1, high: 2, low: 0, close: 1 }]);
  const statusToast = (s: ChartShell) => byClass(s.el, 'pc-toast--status') as (Node & { getAttribute(k: string): string | null }) | null;

  it('shows a status over bars as one toast, updated in place and removed when it clears', async () => {
    const s = shell({});
    bars(s);
    const prevented: boolean[] = [];
    s.chart.on('status:change', (e) => prevented.push(e.defaultPrevented));

    s.chart.setStatus({ kind: 'reconnecting' });
    const toast = statusToast(s)!;
    expect(toast.className).toBe('pc-toast pc-toast--info pc-toast--status');
    expect(toast.getAttribute('role')).toBe('status');
    // A spinner, then the localized text.
    expect(toast.children).toHaveLength(2);
    expect(toast.children[1]!.textContent).toBe('Reconnecting…');

    s.chart.setStatus({ kind: 'stale' });
    expect(statusToast(s)).toBe(toast);
    expect(toast.children).toHaveLength(1);
    expect(toast.children[0]!.textContent).toBe('Data may be out of date');

    s.chart.setStatus({ kind: 'error', message: 'Feed closed' });
    expect(statusToast(s)).toBe(toast);
    expect(toast.className).toBe('pc-toast pc-toast--error pc-toast--status');
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast.children[0]!.textContent).toBe('Feed closed');

    // The same status again leaves the content (and the announcement) alone.
    const message = toast.children[0];
    s.chart.setStatus({ kind: 'error', message: 'Feed closed' });
    expect(toast.children[0]).toBe(message);

    s.chart.setStatus({ kind: 'loading' });
    expect(toast.children[1]!.textContent).toBe('Loading…');
    s.chart.applyOptions({ localization: { messages: { statusLoading: 'Laden…' } } });
    expect(statusToast(s)).toBe(toast);
    expect(toast.children[1]!.textContent).toBe('Laden…');

    s.chart.setStatus(null);
    expect(statusToast(s)).toBeNull();
    expect(prevented).toEqual([true, true, true, true, true, false]);
    s.destroy();
  });

  it('leaves the empty pane its own text and the loading and empty slots', () => {
    const s = shell({ slots: { loading: tag(), empty: tag() } });
    const overlay = byClass(s.el, 'pc-status-slot')!;
    s.chart.setStatus({ kind: 'loading' });
    expect(statusToast(s)).toBeNull();
    expect(overlay.hidden).toBe(false);
    s.chart.setStatus({ kind: 'error' });
    expect(statusToast(s)).toBeNull();
    s.chart.setStatus({ kind: 'no-data' });
    expect(overlay.children[0]!.className).toBe('pc-slot pc-slot--empty');

    // A dropped feed goes to the toast even before bars arrive.
    s.chart.setStatus({ kind: 'reconnecting' });
    expect(statusToast(s)).not.toBeNull();
    expect(overlay.hidden).toBe(true);

    // With bars, loading is a toast and the loading slot stays hidden.
    bars(s);
    s.chart.setStatus({ kind: 'loading' });
    expect(statusToast(s)).not.toBeNull();
    expect(overlay.hidden).toBe(true);
    for (const kind of ['no-data', 'unknown-symbol', 'expired'] as const) {
      s.chart.setStatus({ kind });
      expect(statusToast(s)).toBeNull();
    }
    s.destroy();
  });

  it('keeps the status toast and notification toasts apart', async () => {
    const s = shell({});
    bars(s);
    s.chart.setStatus({ kind: 'reconnecting' });
    s.chart.notify({ message: 'Saved', durationMs: 0 });
    await Promise.resolve();
    const stack = byClass(s.el, 'pc-toasts')!;
    expect(stack.children.map((c) => c.className.split(' ').pop())).toEqual(['pc-toast--status', 'pc-toast--info']);
    s.toasts!.dismissAll();
    expect(statusToast(s)).not.toBeNull();
    s.chart.setStatus(null);
    s.chart.notify({ message: 'Again', durationMs: 0 });
    await Promise.resolve();
    expect(s.toasts!.toasts).toHaveLength(1);
    s.destroy();
  });

  it('takes over a status shown before the shell, and leaves it to the pane without toasts', () => {
    const off = shell({ toasts: undefined });
    bars(off);
    const prevented: boolean[] = [];
    off.chart.on('status:change', (e) => prevented.push(e.defaultPrevented));
    off.chart.setStatus({ kind: 'reconnecting' });
    expect(prevented).toEqual([false]);
    expect(statusToast(off)).toBeNull();

    // A stack made later takes over the status already shown.
    const stack = createToastStack(off.el, off.chart);
    expect(prevented).toHaveLength(2);
    expect(stack.el.children[0]!.className).toBe('pc-toast pc-toast--info pc-toast--status');
    stack.destroy();
    off.destroy();
  });

  it('can be turned off, and destroy removes open toasts', async () => {
    const off = shell({ toasts: undefined });
    expect(off.toasts).toBeNull();
    off.destroy();
    const s = shell({});
    s.chart.notify({ message: 'x', durationMs: 0 });
    await Promise.resolve();
    const stack = byClass(s.el, 'pc-toasts')!;
    s.destroy();
    expect(stack.parent).toBeNull();
    expect(s.toasts!.toasts).toHaveLength(0);
  });
});
