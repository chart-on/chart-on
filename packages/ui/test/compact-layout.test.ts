import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { size } from '../../core/src/testing/environment';
import { createChartShell, type ChartShell } from '../src/shell';

interface FakeNode {
  parent: FakeNode | null;
  children: FakeNode[];
  getAttribute(name: string): string | null;
}
const fake = (el: unknown) => el as FakeNode;

const resizes: (() => void)[] = [];
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {}
      observe(): void {
        resizes.push(this.callback);
      }
      unobserve(): void {}
      disconnect(): void {
        resizes.splice(resizes.indexOf(this.callback) >>> 0, 1);
      }
    },
  );
});
afterEach(() => {
  shells.splice(0).forEach((s) => s.destroy());
  resizes.length = 0;
  size.width = 800;
  vi.unstubAllGlobals();
});

/** The fake shell is 800 px wide; a 1000 px breakpoint makes it compact. */
function shell(options: Parameters<typeof createChartShell>[1] = {}) {
  const s = createChartShell(fakeContainer(), { toolbar: [], bottomBar: true, railBreakpoint: 1000, features: { railSheet: true }, ...options });
  shells.push(s);
  return s;
}

const side = (s: ChartShell) => fake(s.rail!.el).parent!;
const sheet = (s: ChartShell) => side(s).getAttribute('data-sheet');
/** The bottom bar's strip, around its toolbar. */
const strip = (s: ChartShell) => fake(s.bottomBar!.el).parent!;
const toggle = (s: ChartShell) => strip(s).children[0]!;

describe('compact layout', () => {
  it('is off by default', () => {
    const s = shell({ features: {} });
    expect(s.features.railSheet).toBe(false);
    expect(s.el.getAttribute('data-pc-layout')).toBeNull();
    expect(sheet(s)).toBeNull();
  });

  it('stays wide above the breakpoint', () => {
    const s = shell({ railBreakpoint: undefined });
    expect(s.el.getAttribute('data-pc-layout')).toBeNull();
  });

  it('turns the rail into a closed bottom sheet with a button in the bottom bar', () => {
    const s = shell();
    expect(s.el.getAttribute('data-pc-layout')).toBe('compact');
    expect(sheet(s)).toBe('closed');
    expect(s.rail!.el.dataset.orientation).toBe('horizontal');
    expect(s.rail!.el.getAttribute('aria-orientation')).toBe('horizontal');
    expect(toggle(s).getAttribute('aria-label')).toBe('Drawing tools');
    expect(toggle(s).getAttribute('aria-expanded')).toBe('false');
  });

  it('opens from the button and closes on a picked tool, Escape or an outside press', () => {
    const s = shell();
    const button = toggle(s);
    dispatch(button, 'click');
    expect(sheet(s)).toBe('open');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    s.chart.drawings.setTool('trendline');
    expect(sheet(s)).toBe('closed');

    dispatch(button, 'click');
    dispatch(s.rail!.el, 'pointerdown');
    expect(sheet(s)).toBe('open');
    dispatch(s.chart.root, 'keydown', { key: 'Escape' });
    expect(sheet(s)).toBe('closed');

    dispatch(button, 'click');
    dispatch(s.chart.root, 'pointerdown');
    expect(sheet(s)).toBe('closed');
  });

  it('floats the button over the stage without a bottom bar, and drops it with the rail', () => {
    const s = shell();
    const button = toggle(s);
    s.applyFeatures({ bottomBar: false });
    expect(button.parent).toBe(fake(s.chart.root).parent);
    expect(button.getAttribute('data-float')).toBe('');
    s.applyFeatures({ rail: false });
    expect(button.parent).toBeNull();
    s.applyFeatures({ rail: true, bottomBar: true });
    expect(toggle(s)).toBe(button);
    expect(button.getAttribute('data-float')).toBeNull();
  });

  it('follows the shell width and the flag', () => {
    const s = shell({ railBreakpoint: 600 });
    expect(s.el.getAttribute('data-pc-layout')).toBeNull();
    size.width = 375;
    resizes.forEach((r) => r());
    expect(s.el.getAttribute('data-pc-layout')).toBe('compact');
    s.applyFeatures({ railSheet: false });
    expect(s.el.getAttribute('data-pc-layout')).toBeNull();
    expect(sheet(s)).toBeNull();
    expect(s.rail!.el.dataset.orientation).toBeUndefined();
    expect(s.rail!.el.getAttribute('aria-orientation')).toBe('vertical');
  });
});

describe('shell tooltip flag', () => {
  it('creates the pointer tooltip while on', () => {
    const s = shell({ features: { tooltip: true } });
    expect(s.chart.root.querySelector('.pc-pointer-tip')).not.toBeNull();
    s.applyFeatures({ tooltip: false });
    expect(s.chart.root.querySelector('.pc-pointer-tip')).toBeNull();
  });
});

describe('compact layout language', () => {
  it('names the drawing tools button in the chart language and follows a change', () => {
    const s = shell();
    const button = toggle(s);
    expect(button.getAttribute('aria-label')).toBe('Drawing tools');
    s.chart.applyOptions({ localization: { messages: { toolbarDrawingTools: 'Zeichenwerkzeuge' } } });
    expect(button.getAttribute('aria-label')).toBe('Zeichenwerkzeuge');
    expect(button.getAttribute('data-tip')).toBe('Zeichenwerkzeuge');
  });
});
