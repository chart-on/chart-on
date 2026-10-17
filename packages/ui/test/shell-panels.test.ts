import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { createChartGrid, type ChartGrid } from '../src/grid';
import { resolveShellPanels } from '../src/panels';
import { createChartShell, type ChartShell } from '../src/shell';
import css from '../src/style.css?raw';

const shells: ChartShell[] = [];
const grids: ChartGrid[] = [];
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
  grids.splice(0).forEach((g) => g.destroy());
  vi.unstubAllGlobals();
});

function shell(options: Parameters<typeof createChartShell>[1] = {}) {
  const s = createChartShell(fakeContainer(), { toolbar: [], ...options });
  shells.push(s);
  return s;
}

const marks = (s: ChartShell) =>
  ['data-pc-toolbar', 'data-pc-rail', 'data-pc-bottom-bar', 'data-pc-panels'].map((name) => s.el.getAttribute(name));

describe('shell panels', () => {
  it('floats every part by default', () => {
    const s = shell();
    expect(s.panels).toEqual({ toolbar: 'floating', rail: 'floating', bottomBar: 'floating' });
    expect(marks(s)).toEqual(['floating', 'floating', 'floating', 'floating']);
  });

  it('takes one style for every part, or styles part by part', () => {
    expect(marks(shell({ panels: 'docked' }))).toEqual(['docked', 'docked', 'docked', 'docked']);
    const s = shell({ panels: { rail: 'inset' } });
    expect(s.panels).toEqual({ toolbar: 'floating', rail: 'inset', bottomBar: 'floating' });
    expect(marks(s)).toEqual(['floating', 'inset', 'floating', 'mixed']);
  });

  it('restyles at runtime, keeping the parts left out', () => {
    const s = shell({ panels: 'inset' });
    s.setPanels({ bottomBar: 'docked' });
    expect(marks(s)).toEqual(['inset', 'inset', 'docked', 'mixed']);
    s.setPanels('docked');
    expect(marks(s)).toEqual(['docked', 'docked', 'docked', 'docked']);
    // A copy: changing it does not restyle the shell.
    (s.panels as { rail: string }).rail = 'floating';
    expect(s.panels.rail).toBe('docked');
  });

  it('keeps grid cells docked unless the cell options say otherwise', () => {
    const bare = { rail: false, bottomBar: false, appearance: false } as const;
    const g = createChartGrid(fakeContainer(), { cell: bare });
    const own = createChartGrid(fakeContainer(), { cell: { ...bare, panels: 'inset' } });
    grids.push(g, own);
    expect(g.cells[0]!.panels.toolbar).toBe('docked');
    expect(own.cells[0]!.panels.toolbar).toBe('inset');
  });

  it('resolves a partial object over the current styles', () => {
    expect(resolveShellPanels({ toolbar: 'docked', rail: 'docked', bottomBar: 'docked' }, { toolbar: 'inset' })).toEqual({
      toolbar: 'inset',
      rail: 'docked',
      bottomBar: 'docked',
    });
  });
});

describe('panel styles', () => {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('styles every part for each panel style the option takes', () => {
    for (const part of ['toolbar', 'rail', 'bottom-bar']) {
      expect(code).toContain(`[data-pc-${part}='floating']`);
      expect(code).toContain(`[data-pc-${part}='inset']`);
      // Docked parts only move when the shell keeps its edge space, i.e. with mixed styles.
      expect(code).toContain(`[data-pc-panels='mixed'][data-pc-${part}='docked']`);
    }
  });

  it('keeps the flush layout free of edge space, and the rail sheet free of panel margins', () => {
    expect(code).toMatch(/\.pc-shell\[data-pc-panels\]:not\(\[data-pc-panels='docked'\]\)\s*\{\s*padding: var\(--pc-panel-inset\);/);
    for (const rule of code.match(/[^}]*\.pc-shell-side[^{]*\{/g) ?? []) {
      if (rule.includes('data-pc-rail')) expect(rule).toContain(':not([data-sheet])');
    }
  });
});

describe('chart focus ring', () => {
  it('shows only after Tab or F6 moves focus, and hides after a pointer press', () => {
    const s = shell();
    const doc = s.el.ownerDocument;
    // Hidden until the keyboard navigates: shortcuts and Escape do not show it.
    expect(s.el.getAttribute('data-pc-pointer')).toBe('');
    dispatch(doc, 'keydown', { key: 'Escape' });
    dispatch(doc, 'keydown', { key: 'k', ctrlKey: true });
    expect(s.el.getAttribute('data-pc-pointer')).toBe('');
    dispatch(doc, 'keydown', { key: 'Tab' });
    expect(s.el.getAttribute('data-pc-pointer')).toBeNull();
    dispatch(doc, 'pointerdown');
    expect(s.el.getAttribute('data-pc-pointer')).toBe('');
    dispatch(doc, 'keydown', { key: 'F6' });
    expect(s.el.getAttribute('data-pc-pointer')).toBeNull();
    s.destroy();
    dispatch(doc, 'pointerdown');
    expect(s.el.getAttribute('data-pc-pointer')).toBeNull();
  });

  it('keeps the forced-colours ring hidden too', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toMatch(/\.pc-shell\[data-pc-pointer\] \.pc-stage \.pc-chart:focus-visible::after\s*\{\s*box-shadow: none;\s*outline: none;/);
  });
});
