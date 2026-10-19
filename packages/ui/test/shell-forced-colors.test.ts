import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { darkTheme } from '@chart-on/core';
import { fakeContainer } from '../../core/test/fake-dom';
import { createChartShell, type ChartShell } from '../src/shell';

/** System colours as a browser in forced-colours mode resolves them. */
const SYSTEM: Record<string, string> = {
  Canvas: 'rgb(0, 0, 0)',
  CanvasText: 'rgb(255, 255, 255)',
  LinkText: 'rgb(255, 255, 0)',
  GrayText: 'rgb(63, 242, 63)',
  Highlight: 'rgb(26, 235, 255)',
  HighlightText: 'rgb(0, 0, 0)',
};

const forced = { matches: true, listeners: new Set<() => void>() };
function setForced(on: boolean): void {
  forced.matches = on;
  forced.listeners.forEach((fn) => fn());
}

const shells: ChartShell[] = [];
let container: HTMLElement;
beforeEach(() => {
  container = fakeContainer();
  forced.matches = true;
  forced.listeners.clear();
  // No stylesheet tokens; the probe's colour resolves to the system palette.
  vi.stubGlobal('getComputedStyle', (el: HTMLElement) => ({ getPropertyValue: () => '', color: SYSTEM[el.style?.color ?? ''] ?? '' }));
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', (query: string) =>
    query.includes('forced-colors')
      ? {
          get matches() {
            return forced.matches;
          },
          addEventListener: (_type: string, fn: () => void) => forced.listeners.add(fn),
          removeEventListener: (_type: string, fn: () => void) => forced.listeners.delete(fn),
        }
      : { matches: query.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} },
  );
});
afterEach(() => {
  shells.splice(0).forEach((s) => s.destroy());
  vi.unstubAllGlobals();
});

function shell(options: Parameters<typeof createChartShell>[1] = {}) {
  const s = createChartShell(container, { toolbar: [], ...options });
  shells.push(s);
  return s;
}

const overrides = { load: () => ({ theme: { up: '#ff0000', background: '#222222' } }), save() {} };

describe('shell in forced colours', () => {
  it('draws the chart in the system colours, over app colours and saved overrides', () => {
    const s = shell({ chart: { theme: { down: '#00ff00' } }, appearance: { storage: overrides } });
    expect(s.chart.theme.background).toBe(SYSTEM.Canvas);
    expect(s.chart.theme.up).toBe(SYSTEM.LinkText);
    expect(s.chart.theme.down).toBe(SYSTEM.CanvasText);
    expect(s.chart.theme.labelBackground).toBe(SYSTEM.Highlight);
  });

  it('follows the setting as it turns off and on', () => {
    const s = shell({ appearance: { storage: overrides } });
    const events: string[] = [];
    s.on('theme:change', ({ resolved }) => events.push(resolved));

    setForced(false);
    expect(s.chart.theme.up).toBe('#ff0000');
    expect(s.chart.theme.background).toBe('#222222');
    expect(s.chart.theme.down).toBe(darkTheme.down);

    setForced(true);
    expect(s.chart.theme.up).toBe(SYSTEM.LinkText);
    expect(events).toEqual(['dark', 'dark']);
  });

  it('stops listening when destroyed', () => {
    shell().destroy();
    shells.length = 0;
    expect(forced.listeners.size).toBe(0);
  });
});
