import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chart } from '@charton/core';
import { fakeContainer, installFakeDom } from '../../core/test/fake-dom';
import { openDialogFrame } from '../src/dialog';
import { createChartShell, type ChartShell } from '../src/shell';
import { favorites } from '../src/favorites';
import { createSymbolSearch, type SymbolSearchDialog } from '../src/symbol-search';
import { createToolbar, type ToolbarHandle } from '../src/toolbar';
import { toggleVisibility } from '../src/toolbar-presets';

installFakeDom();

interface FakeNode {
  children: FakeNode[];
  className: string;
  textContent: string;
  placeholder?: string;
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
const byClass = (root: unknown, cls: string) => find(root, (n) => n.className.split(' ').includes(cls));

const german = {
  'tool.ray': 'Strahl',
  dialogClose: 'Schließen',
  actionSymbolSearch: 'Symbolsuche',
  symbolSearchPlaceholder: 'Symbol oder Name',
  symbolSearchInput: 'Symbole suchen',
  toolbarToggleVisibility: '{name} ein- oder ausblenden',
  toolbarToggleDrawings: 'Zeichnungen ein- oder ausblenden',
};

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', paddingRight: '0' }));
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});
afterEach(() => {
  cleanups.splice(0).forEach((done) => done());
  vi.unstubAllGlobals();
});

function chart() {
  const c = new Chart(fakeContainer());
  cleanups.push(() => c.destroy());
  return c;
}

function toolbar(c: Chart, items: Parameters<typeof createToolbar>[2]): ToolbarHandle {
  const t = createToolbar(fakeContainer(), c, items);
  cleanups.unshift(() => t.destroy());
  return t;
}

describe('toggleVisibility label', () => {
  it('follows the chart language, with the target name filled in', () => {
    const c = chart();
    const line = c.addLine({ title: 'Volume' });
    const t = toolbar(c, [toggleVisibility('drawings'), toggleVisibility(line, { id: 'line' })]);
    expect(byLabel(t.el, 'Show or hide drawings')).not.toBeNull();
    expect(byLabel(t.el, 'Show or hide Volume')).not.toBeNull();
    expect(t.get('line')!.item).toMatchObject({ labelKey: 'toolbarToggleVisibility', labelParams: { name: 'Volume' } });

    c.applyOptions({ localization: { messages: german } });
    expect(byLabel(t.el, 'Zeichnungen ein- oder ausblenden')).not.toBeNull();
    expect(byLabel(t.el, 'Volume ein- oder ausblenden')).not.toBeNull();
  });

  it('keeps a label the app passes', () => {
    const c = chart();
    const t = toolbar(c, [toggleVisibility('drawings', { label: 'Drawings on or off' })]);
    expect(t.get('drawings-visibility')!.item).not.toHaveProperty('labelKey');
    c.applyOptions({ localization: { messages: german } });
    expect(byLabel(t.el, 'Drawings on or off')).not.toBeNull();
  });
});

describe('dialog close button', () => {
  it('is named Close unless the caller passes its own name', () => {
    const host = fakeContainer();
    const plain = openDialogFrame(host, { title: 'A', className: 'a', onDismiss: () => {} });
    expect(byLabel(plain.header, 'Close')).not.toBeNull();
    plain.close();
    const named = openDialogFrame(host, { title: 'B', className: 'b', onDismiss: () => {}, closeLabel: 'Schließen' });
    expect(byLabel(named.header, 'Schließen')).not.toBeNull();
    named.close();
  });
});

describe('symbol search text', () => {
  function search(c?: Chart): SymbolSearchDialog {
    const dialog = createSymbolSearch(fakeContainer(), {
      source: { search: async () => [] },
      onSelect: () => {},
      openOnTyping: false,
      ...(c && { chart: c }),
    });
    cleanups.unshift(() => dialog.destroy());
    return dialog;
  }

  it('is English without a chart', () => {
    const dialog = search();
    expect(byClass(dialog.el, 'pc-dialog-title')!.textContent).toBe('Symbol search');
    expect(byLabel(dialog.el, 'Close')).not.toBeNull();
    expect(byLabel(dialog.el, 'Search symbols')!.placeholder).toBe('Symbol or name');
  });

  it("takes the chart's language each time it opens", () => {
    vi.stubGlobal('HTMLElement', class {});
    const c = chart();
    const dialog = search(c);
    c.applyOptions({ localization: { messages: german } });
    Object.assign(byLabel(dialog.el, 'Search symbols')!, { setSelectionRange() {} });
    dialog.open();
    expect(byClass(dialog.el, 'pc-dialog-title')!.textContent).toBe('Symbolsuche');
    expect(byLabel(dialog.el, 'Schließen')).not.toBeNull();
    expect(byLabel(dialog.el, 'Symbole suchen')!.placeholder).toBe('Symbol oder Name');
    dialog.close();
  });
});

describe('drawing tool names in the shell', () => {
  it('relabel the favourites bar from tool.<type> messages', () => {
    const s: ChartShell = createChartShell(fakeContainer(), { favorites: favorites({ storage: null, tools: ['ray'] }), appearance: false, settings: false });
    cleanups.unshift(() => s.destroy());
    const bar = s.favorites!.bar.el;
    expect(byLabel(bar, 'Ray')).not.toBeNull();
    s.chart.applyOptions({ localization: { messages: german } });
    expect(byLabel(bar, 'Strahl')).not.toBeNull();
    expect(byLabel(bar, 'Ray')).toBeNull();
  });
});
