import { afterEach, describe, expect, it } from 'vitest';
import { Chart, type ChartContextMenuEvent } from '@chart-on/core';
import { fakeContainer } from '../../core/test/fake-dom';
import { defaultContextMenuItems, type ContextMenuItem } from '../src/context-menu';
import { createReplayControls } from '../src/replay';
import { defaultShellMessages, shellText } from '../src/messages';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

function chart(options: ConstructorParameters<typeof Chart>[1] = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 10, high: 20, low: 0, close: 10 })));
  return c;
}

const event = (patch: Partial<ChartContextMenuEvent>): ChartContextMenuEvent => ({
  target: 'plot',
  x: 100,
  y: 100,
  clientX: 100,
  clientY: 100,
  pane: 0,
  time: 120,
  index: 2,
  price: 12.5,
  scale: 'right',
  drawing: null,
  ...patch,
});

const labels = (items: ContextMenuItem[]) => items.flatMap((i) => (i.type === 'action' || i.type === 'check' ? [i.label] : []));

describe('shell messages', () => {
  it('uses the English defaults without a localization option', () => {
    const c = chart();
    expect(shellText(c, 'menuResetView')).toBe('Reset view');
    expect(shellText(null, 'menuCopyPrice', { price: '1.5' })).toBe('Copy price 1.5');
    expect(labels(defaultContextMenuItems(c, event({ target: 'timeAxis', pane: -1, price: null, scale: null })))).toEqual([
      defaultShellMessages.menuResetView,
      defaultShellMessages.menuScrollToNewest,
    ]);
  });

  it('takes overrides and the locale from the chart', () => {
    const c = chart({
      localization: {
        locale: 'de-DE',
        messages: { menuResetView: 'Ansicht zurücksetzen', menuCopyPrice: 'Preis {price} kopieren' },
        translate: (key) => (key === 'menuLogScale' ? 'Logarithmisch' : undefined),
      },
    });
    const items = labels(defaultContextMenuItems(c, event({})));
    expect(items[0]).toBe('Ansicht zurücksetzen');
    expect(items[1]).toBe(`Preis ${c.formatAxis(0, 12.5)} kopieren`);
    expect(items[1]).toContain(',');
    expect(items).toContain('Logarithmisch');
    expect(items).toContain('Auto scale');
  });

  it('relabels the replay controls when the language changes', () => {
    const c = chart();
    const controls = createReplayControls(c);
    expect(controls.el.getAttribute('aria-label')).toBe('Bar replay');
    c.applyOptions({ localization: { messages: { replayLabel: 'Wiedergabe', replayExit: 'Beenden' } } });
    expect(controls.el.getAttribute('aria-label')).toBe('Wiedergabe');
    const exit = [...controls.el.children].at(-1)!;
    expect(exit.getAttribute('aria-label')).toBe('Beenden');
    controls.destroy();
  });
});
