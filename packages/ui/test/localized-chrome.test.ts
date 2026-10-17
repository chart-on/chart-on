import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chart } from '@charton/core';
import { dispatch, documentListeners, fakeContainer } from '../../core/test/fake-dom';
import { createBottomBar, defaultRanges, type BottomBarHandle } from '../src/bottombar';
import { createChartGrid, type ChartGrid } from '../src/grid';
import { defaultShellMessages } from '../src/messages';
import { createChartShell, type ChartShell, type ChartShellOptions } from '../src/shell';
import { favorites } from '../src/favorites';
import { chartStyle, chartStyles, hideMenu, screenshot } from '../src/toolbar-presets';
import { createToolbar, type ToolbarHandle, type ToolbarItem } from '../src/toolbar';

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
const byText = (root: unknown, text: string) => find(root, (n) => n.children.length === 0 && n.textContent === text);

/** Part of a German catalogue, enough to see every part of the chrome switch. */
const german = {
  toolbarMore: 'Mehr',
  toolbarDownloadImage: 'Bild herunterladen',
  toolbarHide: 'Ausblenden',
  toolbarHideDrawings: 'Zeichnungen ausblenden',
  toolbarChartType: 'Diagrammtyp',
  chartStyleCandles: 'Kerzen',
  railLabel: 'Zeichenwerkzeuge',
  railMagnet: 'Magnetmodus',
  railCursor: 'Fadenkreuz',
  railMoreGroup: 'Weitere: {name}',
  railGroupLines: 'Linien',
  favoriteAdd: '{tool} zu Favoriten',
  favoritesLabel: 'Favoriten',
  historyUndo: 'Rückgängig',
  bottomBarLabel: 'Zeitraum und Skala',
  range1D: '1T',
  range1DTitle: '1 Tag',
  rangeText: 'Zeitraum',
  scaleAutoTitle: 'Skala automatisch anpassen',
  goToText: 'Gehe zu',
  goToDate: 'Gehe zu Datum',
};

const shells: ChartShell[] = [];
const charts: Chart[] = [];
const bars: BottomBarHandle[] = [];
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
  bars.splice(0).forEach((b) => b.destroy());
  shells.splice(0).forEach((s) => s.destroy());
  charts.splice(0).forEach((c) => c.destroy());
  vi.unstubAllGlobals();
});

function shell(options: ChartShellOptions = {}) {
  const s = createChartShell(fakeContainer(), {
    toolbar: [screenshot(), hideMenu(), chartStyle(), { ...screenshot(), id: 'own', label: 'Snapshot' }],
    favorites: favorites({ storage: null, tools: ['ray'] }),
    ...options,
  });
  shells.push(s);
  return s;
}

describe('localized shell chrome', () => {
  it('shows the English defaults without a localization option', () => {
    const s = shell();
    expect(byLabel(s.toolbar!.el, defaultShellMessages.toolbarDownloadImage)).not.toBeNull();
    expect(byLabel(s.toolbar!.el, 'More')).not.toBeNull();
    expect(s.rail!.el.getAttribute('aria-label')).toBe('Drawing tools');
    expect(byLabel(s.rail!.el, 'Magnet mode')).not.toBeNull();
    expect(byLabel(s.rail!.el, 'More lines')).not.toBeNull();
    expect(s.toolbar!.get('screenshot')!.item).toMatchObject({ label: 'Download image', labelKey: 'toolbarDownloadImage' });
  });

  it('relabels the toolbar, rail and favourites bar on a language change', () => {
    const s = shell();
    s.chart.applyOptions({ localization: { locale: 'de-DE', messages: german } });
    const toolbar = s.toolbar!.el;
    expect(byLabel(toolbar, 'Bild herunterladen')).not.toBeNull();
    expect(byLabel(toolbar, 'Download image')).toBeNull();
    expect(byLabel(toolbar, 'Mehr')).not.toBeNull();
    expect(byLabel(toolbar, 'Ausblenden')).not.toBeNull();
    expect(byLabel(toolbar, 'Diagrammtyp')).not.toBeNull();
    // A label without a key stays the app's own.
    expect(byLabel(toolbar, 'Snapshot')).not.toBeNull();

    const rail = s.rail!.el;
    expect(rail.getAttribute('aria-label')).toBe('Zeichenwerkzeuge');
    expect(byLabel(rail, 'Magnetmodus')).not.toBeNull();
    expect(byLabel(rail, 'Fadenkreuz')).not.toBeNull();
    expect(byLabel(rail, 'Rückgängig')).not.toBeNull();
    expect(byLabel(rail, 'Weitere: Linien')).not.toBeNull();
    // Keys left out keep their English text.
    expect(byLabel(rail, 'Lock drawings')).not.toBeNull();

    expect(s.favorites!.bar.el.getAttribute('aria-label')).toBe('Favoriten');

    // And back: a new messages object replaces the old one.
    s.chart.applyOptions({ localization: { messages: {} } });
    expect(byLabel(s.toolbar!.el, 'Download image')).not.toBeNull();
    expect(s.rail!.el.getAttribute('aria-label')).toBe('Drawing tools');
  });

  it('translates menu options that carry a message key', () => {
    // The menus place themselves inside the viewport.
    vi.stubGlobal('document', Object.assign(Object.create(document), { documentElement: { clientWidth: 800, clientHeight: 600 } }));
    const s = shell();
    s.chart.applyOptions({ localization: { messages: german } });
    const style = byLabel(s.toolbar!.el, 'Diagrammtyp')!;
    dispatch(style, 'click');
    expect(byText(s.toolbar!.el, 'Kerzen')).not.toBeNull();
    const hide = byLabel(s.toolbar!.el, 'Ausblenden')!;
    dispatch(hide, 'click');
    expect(byText(s.toolbar!.el, 'Zeichnungen ausblenden')).not.toBeNull();
    expect(byText(s.toolbar!.el, 'Hide indicators')).not.toBeNull();
  });

  it('labels the favourite stars in the chart language', () => {
    vi.stubGlobal('document', Object.assign(Object.create(document), { documentElement: { clientWidth: 800, clientHeight: 600 } }));
    const s = shell();
    s.chart.applyOptions({ localization: { messages: german } });
    const more = byLabel(s.rail!.el, 'Weitere: Linien')!;
    dispatch(more, 'click');
    expect(byLabel(s.rail!.el, 'Trend line zu Favoriten')).not.toBeNull();
  });
});

describe('localized bottom bar', () => {
  function setup() {
    const chart = new Chart(fakeContainer(), { timezone: 'UTC' });
    charts.push(chart);
    const bar = createBottomBar(fakeContainer(), chart, { clock: false, ranges: defaultRanges, scaleToggles: 'inline' });
    bars.push(bar);
    return { chart, bar };
  }

  it('relabels the range chips, scale toggles and go-to-date control', () => {
    const { chart, bar } = setup();
    expect(bar.el.getAttribute('aria-label')).toBe('Chart range and scale');
    const day = byText(bar.el, '1D')!;
    expect(day.getAttribute('data-tip')).toBe('1 day');
    expect(byText(bar.el, 'Go to')).not.toBeNull();

    chart.applyOptions({ localization: { messages: german } });
    expect(bar.el.getAttribute('aria-label')).toBe('Zeitraum und Skala');
    expect(day.textContent).toBe('1T');
    expect(day.getAttribute('data-tip')).toBe('1 Tag');
    expect(byText(bar.el, '5D')!.getAttribute('data-tip')).toBe('5 days');
    expect(byText(bar.el, 'Zeitraum')).not.toBeNull();
    expect(byText(bar.el, 'auto')).not.toBeNull();
    expect(byLabel(bar.el, 'Skala automatisch anpassen')!.getAttribute('data-tip')).toBe('Skala automatisch anpassen');
    const goTo = byText(bar.el, 'Gehe zu')!;
    expect(goTo.getAttribute('data-tip')).toBe('Gehe zu Datum');
    expect(chart.actions.get('go-to-date')!.label).toBe('Gehe zu Datum');
  });

  it('keeps a custom range label without a key', () => {
    const { chart } = setup();
    const bar = createBottomBar(fakeContainer(), chart, { clock: false, ranges: [{ label: '2W', span: 14 * 86400, title: 'Two weeks' }] });
    bars.push(bar);
    chart.applyOptions({ localization: { messages: german } });
    expect(byText(bar.el, '2W')!.getAttribute('data-tip')).toBe('Two weeks');
  });
});

describe('relabelling in place', () => {
  const toolbars: ToolbarHandle[] = [];
  const grids: ChartGrid[] = [];
  afterEach(() => {
    toolbars.splice(0).forEach((t) => t.destroy());
    grids.splice(0).forEach((g) => g.destroy());
    vi.useRealTimers();
  });

  function standalone(items: ToolbarItem[] = [screenshot(), hideMenu()]) {
    const chart = new Chart(fakeContainer());
    charts.push(chart);
    const toolbar = createToolbar(fakeContainer(), chart, items);
    toolbars.push(toolbar);
    return { chart, toolbar };
  }

  it('keeps focus on the focused button, the more button included', () => {
    const { chart, toolbar } = standalone();
    const shot = toolbar.get('screenshot')!.el;
    shot.focus();
    chart.applyOptions({ localization: { messages: german } });
    expect(document.activeElement).toBe(shot);
    expect(shot.getAttribute('aria-label')).toBe('Bild herunterladen');
    const more = byLabel(toolbar.el, 'Mehr') as unknown as HTMLElement;
    more.focus();
    chart.applyOptions({ localization: { messages: {} } });
    expect(document.activeElement).toBe(more);
    expect(more.getAttribute('aria-label')).toBe('More');
  });

  it('keeps focus in the rail and the favourites bar', () => {
    const s = shell();
    const magnet = byLabel(s.rail!.el, 'Magnet mode') as unknown as HTMLElement;
    magnet.focus();
    s.chart.applyOptions({ localization: { messages: german } });
    expect((document.activeElement as unknown as FakeNode).getAttribute('aria-label')).toBe('Magnetmodus');
    const ray = byLabel(s.favorites!.bar.el, 'Ray') as unknown as HTMLElement;
    ray.focus();
    s.chart.applyOptions({ localization: { messages: {} } });
    expect((document.activeElement as unknown as FakeNode).getAttribute('aria-label')).toBe('Ray');
  });

  it('closes an open menu and its outside-click listeners, and cleans up on destroy', () => {
    vi.stubGlobal('document', Object.assign(Object.create(document), { documentElement: { clientWidth: 800, clientHeight: 600 } }));
    vi.useFakeTimers();
    const { chart, toolbar } = standalone();
    const before = documentListeners('pointerdown');
    dispatch(byLabel(toolbar.el, 'Hide')!, 'click');
    vi.advanceTimersByTime(1);
    expect(documentListeners('pointerdown')).toBe(before + 1);
    chart.applyOptions({ localization: { messages: german } });
    expect(documentListeners('pointerdown')).toBe(before);
    expect(byText(toolbar.el, 'Zeichnungen ausblenden')).toBeNull();
    // Open again in the new language, then remove the toolbar with the menu open.
    dispatch(byLabel(toolbar.el, 'Ausblenden')!, 'click');
    vi.advanceTimersByTime(1);
    expect(byText(toolbar.el, 'Zeichnungen ausblenden')).not.toBeNull();
    toolbars.splice(0).forEach((t) => t.destroy());
    expect(documentListeners('pointerdown')).toBe(before);
  });

  it('does not render custom items again', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    const render = vi.fn();
    const { chart, toolbar } = standalone([screenshot(), { type: 'custom', id: 'mine', render }]);
    chart.applyOptions({ localization: { messages: german } });
    expect(render).toHaveBeenCalledTimes(1);
    expect(toolbar.get('screenshot')!.el.getAttribute('aria-label')).toBe('Bild herunterladen');
  });

  it("follows the language of a grid's active chart", () => {
    const g = createChartGrid(fakeContainer(), {
      layout: '2x1',
      cell: { rail: false, bottomBar: false, appearance: false },
      toolbar: [screenshot()],
    });
    grids.push(g);
    const [first, second] = g.charts as [Chart, Chart];
    second.applyOptions({ localization: { messages: german } });
    const label = () => g.toolbar!.get('screenshot')!.el.getAttribute('aria-label');
    g.setActive(0);
    expect(label()).toBe('Download image');
    g.setActive(1);
    expect(label()).toBe('Bild herunterladen');
    g.setActive(0);
    expect(label()).toBe('Download image');
    first.applyOptions({ localization: { messages: { toolbarDownloadImage: 'Télécharger l’image' } } });
    expect(label()).toBe('Télécharger l’image');
  });
});

describe('labels the app changed', () => {
  it('win over the message key in every language', () => {
    vi.stubGlobal('document', Object.assign(Object.create(document), { documentElement: { clientWidth: 800, clientHeight: 600 } }));
    const chart = new Chart(fakeContainer(), { timezone: 'UTC' });
    charts.push(chart);
    const styles = chartStyles.map((style) => (style.value === 'candles' ? { ...style, label: 'Sticks' } : style));
    const toolbar = createToolbar(fakeContainer(), chart, [{ ...screenshot(), label: 'Snap' }, chartStyle(styles)]);
    const bar = createBottomBar(fakeContainer(), chart, {
      clock: false,
      ranges: [{ ...defaultRanges[0]!, title: 'One trading day' }, defaultRanges[1]!],
    });
    bars.push(bar);
    chart.applyOptions({ localization: { messages: german } });
    expect(byLabel(toolbar.el, 'Snap')).not.toBeNull();
    expect(byText(bar.el, '1T')!.getAttribute('data-tip')).toBe('One trading day');
    dispatch(byLabel(toolbar.el, 'Diagrammtyp')!, 'click');
    expect(byText(toolbar.el, 'Sticks')).not.toBeNull();
    toolbar.destroy();
  });
});
