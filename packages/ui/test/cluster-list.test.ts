import { describe, expect, it, vi } from 'vitest';
import { createLocalizer, darkTheme, TimeScale } from '@chart-on/core';
import { Pane, Timeline } from '@chart-on/core/internal';
import type { AnnotationHost } from '../../core/src/annotations/manager';
import { tradingManager } from '../../core/test/trading-manager';
import { canCancel, clusterRowText } from '../src/cluster-list';

function manager() {
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  const host: AnnotationHost = {
    theme: darkTheme,
    timeline: new Timeline(),
    time,
    panes: [new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 })],
    plotLeft: 0,
    main: null,
    formatPrice: (_p, price) => price.toFixed(2),
    formatAxis: (_p, price) => price.toFixed(2),
    measureText: (t) => t.length * 7,
    axisLabel: () => {},
    requestOverlay: () => {},
    attachPrimitive: () => () => {},
  };
  return tradingManager(host);
}

describe('cluster list rows', () => {
  const format = (p: number) => p.toFixed(2);

  it('names the side or label, quantity and price', () => {
    const m = manager();
    expect(clusterRowText(m.addTradeLine({ price: 101.5, side: 'buy', quantity: 2 }), format)).toBe('Buy 2 @ 101.50');
    expect(clusterRowText(m.addTradeLine({ price: 99, side: 'sell' }), format)).toBe('Sell @ 99.00');
    expect(clusterRowText(m.addTradeLine({ price: 99, side: 'sell', kind: 'position' }), format)).toBe('Short @ 99.00');
    expect(clusterRowText(m.addTradeLine({ price: 99, side: 'buy', label: 'Limit' }), format)).toBe('Limit @ 99.00');
  });

  it('names the side in the given language, and keeps a label the app set', () => {
    const m = manager();
    const localization = createLocalizer({ messages: { clusterBuy: 'Kauf', clusterShort: 'Leerverkauf' } });
    expect(clusterRowText(m.addTradeLine({ price: 101.5, side: 'buy', quantity: 2 }), format, { localization })).toBe('Kauf 2 @ 101.50');
    expect(clusterRowText(m.addTradeLine({ price: 99, side: 'sell', kind: 'position' }), format, { localization })).toBe('Leerverkauf @ 99.00');
    expect(clusterRowText(m.addTradeLine({ price: 99, side: 'buy', label: 'Limit' }), format, { localization })).toBe('Limit @ 99.00');
  });

  it('offers cancel only for lines that handle it', () => {
    const m = manager();
    expect(canCancel(m.addTradeLine({ price: 1, side: 'buy' }))).toBe(false);
    expect(canCancel(m.addTradeLine({ price: 1, side: 'buy', onAction: vi.fn() }))).toBe(true);
    expect(canCancel(m.addTradeLine({ price: 1, side: 'buy', onAction: vi.fn(), actions: [] }))).toBe(false);
  });
});
