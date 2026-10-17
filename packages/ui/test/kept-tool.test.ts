import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { createChartShell, type ChartShell, type ChartShellOptions } from '../src/shell';
import { favorites } from '../src/favorites';
import { DOUBLE_PRESS_MS, doublePress } from '../src/rail';

interface FakeNode {
  children: FakeNode[];
  textContent: string;
  getAttribute(name: string): string | null;
}
const fake = (el: unknown) => el as FakeNode;

function find(root: unknown, match: (n: FakeNode) => boolean): FakeNode | null {
  for (const child of fake(root).children) {
    if (match(child)) return child;
    const found = find(child, match);
    if (found) return found;
  }
  return null;
}
const byLabel = (root: unknown, label: string) => find(root, (n) => n.getAttribute('aria-label') === label);
/** A flyout entry by its text. */
const entry = (root: unknown, text: string) =>
  find(root, (n) => n.getAttribute('role') === 'menuitemradio' && n.children.some((c) => c.textContent === text));
/** Kept look of a button: the `data-kept` badge and its description. */
const keptState = (b: FakeNode) => ({ kept: b.getAttribute('data-kept') !== null, description: b.getAttribute('aria-description') });

/** The two clicks of a mouse double-click, as the browser numbers them. */
function doubleClick(b: unknown, at = 1000): void {
  dispatch(b, 'click', { detail: 1, timeStamp: at });
  dispatch(b, 'click', { detail: 2, timeStamp: at + 150 });
}

const shells: ChartShell[] = [];
beforeEach(() => {
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
  shells.splice(0).forEach((s) => s.destroy());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function shell(options: ChartShellOptions = {}) {
  const s = createChartShell(fakeContainer(), { toolbar: [], favorites: favorites({ storage: null }), ...options });
  shells.push(s);
  return s;
}

describe('doublePress', () => {
  const click = (detail: number, timeStamp: number) => ({ detail, timeStamp }) as MouseEvent;

  it('pairs a counted double-click, or two taps on one tool in time', () => {
    const paired = doublePress();
    expect(paired('a', click(1, 0))).toBe(false);
    expect(paired('a', click(2, 100))).toBe(true);
    expect(paired('a', click(1, 1000))).toBe(false);
    expect(paired('a', click(1, 1000 + DOUBLE_PRESS_MS))).toBe(true);
  });

  it('does not pair slow presses, other tools or keyboard presses', () => {
    const paired = doublePress();
    paired('a', click(1, 0));
    expect(paired('a', click(1, DOUBLE_PRESS_MS + 1))).toBe(false);
    expect(paired('b', click(1, DOUBLE_PRESS_MS + 50))).toBe(false);
    expect(paired('b', click(0, DOUBLE_PRESS_MS + 60))).toBe(false);
    expect(paired('b', click(1, DOUBLE_PRESS_MS + 70))).toBe(false);
  });
});

describe('kept drawing tool in the shell', () => {
  it('keeps a rail tool on a double-click and shows it', () => {
    const s = shell();
    const channel = byLabel(s.rail!.el, 'Parallel channel')!;
    doubleClick(channel);
    expect(s.chart.drawings.tool).toBe('parallel-channel');
    expect(s.chart.drawings.toolKept).toBe(true);
    expect(s.chart.drawings.stayInDrawingMode).toBe(false);
    expect(channel.getAttribute('aria-pressed')).toBe('true');
    expect(keptState(channel)).toEqual({ kept: true, description: 'Stays active' });

    // A single click on the kept tool ends it, back to the cursor.
    dispatch(channel, 'click', { detail: 1, timeStamp: 5000 });
    expect(s.chart.drawings.tool).toBeNull();
    expect(channel.getAttribute('aria-pressed')).toBe('false');
    expect(keptState(channel)).toEqual({ kept: false, description: null });
  });

  it('keeps a tool on a double-tap the browser counts as two single clicks', () => {
    const s = shell();
    const channel = byLabel(s.rail!.el, 'Parallel channel')!;
    dispatch(channel, 'click', { detail: 1, timeStamp: 1000, pointerType: 'touch' });
    dispatch(channel, 'click', { detail: 1, timeStamp: 1250, pointerType: 'touch' });
    expect(s.chart.drawings.toolKept).toBe(true);
  });

  it('a single click still arms the tool for one drawing', () => {
    const s = shell();
    const channel = byLabel(s.rail!.el, 'Parallel channel')!;
    dispatch(channel, 'click', { detail: 1, timeStamp: 1000 });
    expect(s.chart.drawings.tool).toBe('parallel-channel');
    expect(s.chart.drawings.toolKept).toBe(false);
    expect(keptState(channel).kept).toBe(false);
  });

  it('keeps the focused tool on Shift+Enter', () => {
    const s = shell();
    const channel = byLabel(s.rail!.el, 'Parallel channel')!;
    const e = dispatch(channel, 'keydown', { key: 'Enter', shiftKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(s.chart.drawings.toolKept).toBe(true);
    expect(dispatch(channel, 'keydown', { key: 'Enter' }).defaultPrevented).toBe(false);
  });

  it('ends the kept look on Escape, the cursor or another tool', () => {
    const s = shell();
    const channel = byLabel(s.rail!.el, 'Parallel channel')!;
    doubleClick(channel);
    s.chart.drawings.keyDown({ key: 'Escape' } as KeyboardEvent);
    expect(keptState(channel).kept).toBe(false);
    doubleClick(channel, 3000);
    dispatch(byLabel(s.rail!.el, 'Crosshair')!, 'click');
    expect(keptState(channel).kept).toBe(false);
    doubleClick(channel, 6000);
    s.chart.drawings.setTool('trendline');
    expect(keptState(channel).kept).toBe(false);
    expect(keptState(byLabel(s.rail!.el, 'Trend line')!).kept).toBe(false);
  });

  it('keeps a tool double-clicked in a flyout, leaving the menu open for the second click', () => {
    vi.useFakeTimers();
    const s = shell();
    dispatch(byLabel(s.rail!.el, 'More lines')!, 'click');
    const ray = entry(s.rail!.el, 'Ray')!;
    dispatch(ray, 'click', { detail: 1, timeStamp: 1000 });
    expect(s.chart.drawings.tool).toBe('ray');
    expect(s.rail!.el.querySelector('.pc-popover')).not.toBeNull();
    dispatch(ray, 'click', { detail: 2, timeStamp: 1150 });
    expect(s.chart.drawings.toolKept).toBe(true);
    expect(s.rail!.el.querySelector('.pc-popover')).toBeNull();
    const main = byLabel(s.rail!.el, 'Ray')!;
    expect(keptState(main)).toEqual({ kept: true, description: 'Stays active' });

    // Reopened, the menu marks the kept entry too.
    dispatch(byLabel(s.rail!.el, 'More lines')!, 'click');
    const entries: FakeNode[] = [];
    find(s.rail!.el.querySelector('.pc-popover'), (n) => (n.getAttribute('role') === 'menuitemradio' && entries.push(n), false));
    const kept = entries.filter((n) => keptState(n).kept);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toBe(entry(s.rail!.el, 'Ray'));
  });

  it('closes the flyout shortly after a single click, at once after a key press', () => {
    vi.useFakeTimers();
    const s = shell();
    dispatch(byLabel(s.rail!.el, 'More lines')!, 'click');
    dispatch(entry(s.rail!.el, 'Ray')!, 'click', { detail: 1, timeStamp: 1000 });
    expect(s.rail!.el.querySelector('.pc-popover')).not.toBeNull();
    vi.advanceTimersByTime(DOUBLE_PRESS_MS);
    expect(s.rail!.el.querySelector('.pc-popover')).toBeNull();
    expect(s.chart.drawings.toolKept).toBe(false);

    dispatch(byLabel(s.rail!.el, 'More lines')!, 'click');
    dispatch(entry(s.rail!.el, 'Horizontal line')!, 'click');
    expect(s.rail!.el.querySelector('.pc-popover')).toBeNull();
    expect(s.chart.drawings.tool).toBe('hline');

    dispatch(byLabel(s.rail!.el, 'More lines')!, 'click');
    dispatch(entry(s.rail!.el, 'Vertical line')!, 'keydown', { key: 'Enter', shiftKey: true });
    expect(s.rail!.el.querySelector('.pc-popover')).toBeNull();
    expect(s.chart.drawings.tool).toBe('vline');
    expect(s.chart.drawings.toolKept).toBe(true);
  });

  it('keeps a favourite on a double-click', () => {
    const s = shell({ favorites: favorites({ storage: null, tools: ['ray'] }) });
    const ray = byLabel(s.favorites!.bar.el, 'Ray')!;
    doubleClick(ray);
    expect(s.chart.drawings.toolKept).toBe(true);
    expect(keptState(ray)).toEqual({ kept: true, description: 'Stays active' });
    dispatch(ray, 'click', { detail: 1, timeStamp: 5000 });
    expect(s.chart.drawings.tool).toBeNull();
    expect(keptState(ray).kept).toBe(false);
  });

  it('does not keep a refused tool', () => {
    const s = shell({ chart: { access: { allow: ({ id }) => id !== 'parallel-channel', refused: 'disable' } } });
    const refused: string[] = [];
    s.chart.on('tool:refuse', ({ tool }) => refused.push(tool));
    const channel = byLabel(s.rail!.el, 'Parallel channel')!;
    doubleClick(channel);
    dispatch(channel, 'keydown', { key: 'Enter', shiftKey: true });
    expect(s.chart.drawings.tool).toBeNull();
    expect(s.chart.drawings.toolKept).toBe(false);
    expect(refused).toEqual(['parallel-channel', 'parallel-channel', 'parallel-channel']);
  });

  it('mentions the gesture in tooltips, in the chart language', () => {
    const s = shell({ favorites: favorites({ storage: null, tools: ['ray'] }) });
    expect(byLabel(s.rail!.el, 'Parallel channel')!.getAttribute('data-tip')).toBe('Parallel channel. Double-click to keep drawing');
    expect(byLabel(s.favorites!.bar.el, 'Ray')!.getAttribute('data-tip')).toBe('Ray. Double-click to keep drawing');
    s.chart.applyOptions({ localization: { messages: { toolKeepHint: '{tool} (twice: keep)', toolKept: 'Kept' } } });
    expect(byLabel(s.rail!.el, 'Parallel channel')!.getAttribute('data-tip')).toBe('Parallel channel (twice: keep)');
    expect(byLabel(s.favorites!.bar.el, 'Ray')!.getAttribute('data-tip')).toBe('Ray (twice: keep)');
    doubleClick(byLabel(s.rail!.el, 'Parallel channel')!);
    expect(byLabel(s.rail!.el, 'Parallel channel')!.getAttribute('aria-description')).toBe('Kept');
  });

  it("shows each tool's shortcut in its tooltip, following rebinds", () => {
    const s = shell({ favorites: favorites({ storage: null, tools: ['ray'] }) });
    const trend = () => byLabel(s.rail!.el, 'Trend line')!;
    const ray = () => byLabel(s.favorites!.bar.el, 'Ray')!;
    // Tools have no default keys.
    expect(trend().getAttribute('data-tip')).toBe('Trend line. Double-click to keep drawing');
    expect(ray().getAttribute('data-tip')).toBe('Ray. Double-click to keep drawing');
    s.chart.actions.setKeys('draw-trendline', ['F9']);
    expect(trend().getAttribute('data-tip')).toBe('Trend line (F9). Double-click to keep drawing');
    expect(trend().getAttribute('aria-keyshortcuts')).toBe('F9');
    s.chart.actions.setKeys('draw-ray', ['Alt+Y']);
    s.chart.actions.setKeys('draw-trendline', []);
    expect(ray().getAttribute('data-tip')).toBe('Ray (Alt+Y). Double-click to keep drawing');
    expect(trend().getAttribute('data-tip')).toBe('Trend line. Double-click to keep drawing');
    expect(trend().getAttribute('aria-keyshortcuts')).toBeNull();
  });
});
