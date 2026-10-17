import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { createChartShell, type ChartShell } from '../src/shell';
import { favorites } from '../src/favorites';

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
  vi.unstubAllGlobals();
});

function shell() {
  const s = createChartShell(fakeContainer(), { toolbar: [], favorites: favorites({ storage: null }) });
  shells.push(s);
  return s;
}

/** Pick `name` from the cursor flyout. */
function pick(s: ChartShell, name: string): void {
  dispatch(byLabel(s.rail!.el, 'More cursors'), 'click');
  dispatch(entry(s.rail!.el, name), 'click');
}

describe('rail cursors', () => {
  it('picks the pointer without crosshair lines from the cursor flyout', () => {
    const s = shell();
    const main = () => fake(s.rail!.el).children[0]!.children[0]!;
    expect(main().getAttribute('aria-label')).toBe('Crosshair');
    expect(main().getAttribute('aria-pressed')).toBe('true');
    pick(s, 'Pointer');
    expect(s.chart.options.crosshair.cursor).toBe('pointer');
    expect(main().getAttribute('aria-label')).toBe('Pointer');
    expect(entry(s.rail!.el, 'Pointer')).toBeNull();
  });

  it('is a named vertical toolbar whose flyout is a named menu of checked choices', () => {
    const s = shell();
    const rail = fake(s.rail!.el);
    expect([rail.getAttribute('role'), rail.getAttribute('aria-orientation'), rail.getAttribute('aria-label')]).toEqual(['toolbar', 'vertical', 'Drawing tools']);
    const more = byLabel(s.rail!.el, 'More cursors')!;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    dispatch(more, 'click');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const menu = find(s.rail!.el, (n) => n.getAttribute('role') === 'menu')!;
    expect(menu.getAttribute('aria-label')).toBe('Cursors');
    expect(['Crosshair', 'Pointer'].map((name) => entry(s.rail!.el, name)!.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    dispatch(more, 'click');
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('disarms a drawing tool when a cursor is picked', () => {
    const s = shell();
    s.chart.drawings.setTool('trendline');
    expect(byLabel(s.rail!.el, 'Crosshair')!.getAttribute('aria-pressed')).toBe('false');
    pick(s, 'Pointer');
    expect(s.chart.drawings.tool).toBeNull();
    expect(s.chart.options.crosshair.cursor).toBe('pointer');
    expect(byLabel(s.rail!.el, 'Pointer')!.getAttribute('aria-pressed')).toBe('true');
    pick(s, 'Crosshair');
    expect(s.chart.options.crosshair.cursor).toBe('cross');
  });
});
